import { redactForExport } from './redaction.js';

export const DOWNLOAD_MIME_TYPES = Object.freeze({
  JSON: 'application/json;charset=utf-8',
  XML: 'application/xml;charset=utf-8',
  TEXT: 'text/plain;charset=utf-8',
  PDF: 'application/pdf',
  TIFF: 'image/tiff',
  OCTET_STREAM: 'application/octet-stream',
});

export const DOWNLOAD_EXTENSIONS = Object.freeze({
  JSON: '.json',
  XML: '.xml',
  TEXT: '.txt',
  PDF: '.pdf',
  TIFF: '.tif',
  DOCUMENT: '.txt',
});

const DEFAULT_FILE_NAME = 'download';
const DEFAULT_XML_ROOT_ELEMENT = 'artifact';
const DEFAULT_PLACEHOLDER_TITLE = 'Synthetic Document Placeholder';
const MAX_FILE_NAME_LENGTH = 180;
const INVALID_FILE_NAME_CHARACTERS = /[<>:"/\\|?*\u0000-\u001f\u007f]/g;
const LEADING_OR_TRAILING_DOTS_AND_SPACES = /^[.\s]+|[.\s]+$/g;
const WINDOWS_RESERVED_FILE_NAME =
  /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const XML_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

function assertOptions(options, description = 'Download options') {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError(`${description} must be an object.`);
  }

  return options;
}

function normalizeExtension(extension) {
  if (typeof extension !== 'string' || extension.trim() === '') {
    throw new TypeError('A non-empty file extension is required.');
  }

  const normalizedExtension = extension.trim().toLowerCase();
  const extensionWithPrefix = normalizedExtension.startsWith('.')
    ? normalizedExtension
    : `.${normalizedExtension}`;

  if (!/^\.[a-z0-9]+$/.test(extensionWithPrefix)) {
    throw new TypeError('File extensions must contain only letters or numbers.');
  }

  return extensionWithPrefix;
}

function appendExtension(fileName, extension) {
  const normalizedExtension = normalizeExtension(extension);

  return fileName.toLowerCase().endsWith(normalizedExtension)
    ? fileName
    : `${fileName}${normalizedExtension}`;
}

function truncateFileName(fileName, maximumLength = MAX_FILE_NAME_LENGTH) {
  if (fileName.length <= maximumLength) {
    return fileName;
  }

  const extensionSeparatorIndex = fileName.lastIndexOf('.');
  const hasExtension =
    extensionSeparatorIndex > 0 &&
    extensionSeparatorIndex < fileName.length - 1;
  const extension = hasExtension
    ? fileName.slice(extensionSeparatorIndex)
    : '';
  const baseName = hasExtension
    ? fileName.slice(0, extensionSeparatorIndex)
    : fileName;
  const availableBaseLength = Math.max(
    1,
    maximumLength - extension.length,
  );

  return `${baseName.slice(0, availableBaseLength)}${extension}`;
}

function normalizeContent(content, description = 'Download content') {
  if (typeof content !== 'string') {
    throw new TypeError(`${description} must be a string.`);
  }

  return content;
}

function normalizeMimeType(mimeType) {
  if (typeof mimeType !== 'string' || mimeType.trim() === '') {
    throw new TypeError('A non-empty MIME type is required.');
  }

  const normalizedMimeType = mimeType.trim();

  if (/[\r\n]/.test(normalizedMimeType)) {
    throw new TypeError('The MIME type cannot contain line breaks.');
  }

  return normalizedMimeType;
}

function normalizeIndentation(space) {
  if (space === undefined) {
    return 2;
  }

  if (
    (typeof space !== 'number' && typeof space !== 'string') ||
    (typeof space === 'number' &&
      (!Number.isInteger(space) || space < 0 || space > 10))
  ) {
    throw new TypeError(
      'JSON indentation must be a string or an integer from 0 to 10.',
    );
  }

  return space;
}

function normalizeXmlElementName(name, fallback = 'item') {
  const normalizedName = String(name).trim();

  if (XML_NAME_PATTERN.test(normalizedName)) {
    return normalizedName;
  }

  const sanitizedName = normalizedName
    .replace(/[^A-Za-z0-9_.-]+/g, '-')
    .replace(/^[^A-Za-z_]+/, '');

  return XML_NAME_PATTERN.test(sanitizedName)
    ? sanitizedName
    : fallback;
}

function escapeXmlText(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\r/g, '&#13;');
}

function serializeXmlValue(name, value, indentation, level, ancestors) {
  const elementName = normalizeXmlElementName(name);
  const currentIndentation = indentation.repeat(level);
  const nextIndentation = indentation.repeat(level + 1);

  if (value === null || value === undefined) {
    return `${currentIndentation}<${elementName} />`;
  }

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new TypeError('XML values cannot contain invalid dates.');
    }

    return `${currentIndentation}<${elementName}>${escapeXmlText(
      value.toISOString(),
    )}</${elementName}>`;
  }

  if (typeof value === 'bigint') {
    return `${currentIndentation}<${elementName}>${value.toString()}</${elementName}>`;
  }

  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new TypeError('XML values cannot contain non-finite numbers.');
    }

    return `${currentIndentation}<${elementName}>${escapeXmlText(
      value,
    )}</${elementName}>`;
  }

  if (typeof value !== 'object') {
    throw new TypeError('XML values must contain serializable data.');
  }

  if (ancestors.has(value)) {
    throw new TypeError('XML values cannot contain circular references.');
  }

  ancestors.add(value);

  let children;

  if (Array.isArray(value)) {
    children = value.map((item) =>
      serializeXmlValue('item', item, indentation, level + 1, ancestors),
    );
  } else {
    children = Object.entries(value).map(([childName, childValue]) =>
      serializeXmlValue(
        childName,
        childValue,
        indentation,
        level + 1,
        ancestors,
      ),
    );
  }

  ancestors.delete(value);

  if (children.length === 0) {
    return `${currentIndentation}<${elementName} />`;
  }

  return [
    `${currentIndentation}<${elementName}>`,
    ...children.map((child) =>
      child.startsWith(nextIndentation)
        ? child
        : `${nextIndentation}${child.trimStart()}`,
    ),
    `${currentIndentation}</${elementName}>`,
  ].join('\n');
}

function getBrowserDownloadDependencies() {
  if (
    typeof document === 'undefined' ||
    typeof document.createElement !== 'function'
  ) {
    throw new Error('Client-side downloads require a browser document.');
  }

  if (
    typeof URL === 'undefined' ||
    typeof URL.createObjectURL !== 'function' ||
    typeof URL.revokeObjectURL !== 'function'
  ) {
    throw new Error('Client-side downloads require object URL support.');
  }

  return {
    document,
    urlApi: URL,
  };
}

/**
 * Creates a safe local file name suitable for a download attribute.
 *
 * @param {unknown} fileName Requested file name.
 * @param {{extension?: string, fallback?: string}} [options] Name options.
 * @returns {string} Sanitized file name.
 */
export function sanitizeDownloadFileName(fileName, options = {}) {
  const normalizedOptions = assertOptions(options);
  const fallback =
    typeof normalizedOptions.fallback === 'string' &&
    normalizedOptions.fallback.trim() !== ''
      ? normalizedOptions.fallback
      : DEFAULT_FILE_NAME;
  const sourceName =
    typeof fileName === 'string' && fileName.trim() !== ''
      ? fileName
      : fallback;
  const pathSegments = sourceName.replace(/\\/g, '/').split('/');
  const baseName = pathSegments[pathSegments.length - 1];
  let safeFileName = baseName
    .normalize('NFKC')
    .replace(INVALID_FILE_NAME_CHARACTERS, '_')
    .replace(/\s+/g, ' ')
    .replace(LEADING_OR_TRAILING_DOTS_AND_SPACES, '');

  if (safeFileName === '' || safeFileName === '.' || safeFileName === '..') {
    safeFileName = DEFAULT_FILE_NAME;
  }

  if (WINDOWS_RESERVED_FILE_NAME.test(safeFileName)) {
    safeFileName = `_${safeFileName}`;
  }

  if (normalizedOptions.extension !== undefined) {
    safeFileName = appendExtension(
      safeFileName,
      normalizedOptions.extension,
    );
  }

  return truncateFileName(safeFileName);
}

/**
 * Serializes data as formatted JSON.
 *
 * @param {unknown} data Value to serialize.
 * @param {{redact?: boolean, space?: number | string}} [options]
 * Serialization options.
 * @returns {string} JSON document.
 */
export function serializeJsonDownload(data, options = {}) {
  const normalizedOptions = assertOptions(options, 'JSON options');
  const value = normalizedOptions.redact ? redactForExport(data) : data;
  const indentation = normalizeIndentation(normalizedOptions.space);
  let serializedValue;

  try {
    serializedValue = JSON.stringify(value, null, indentation);
  } catch (error) {
    throw new TypeError('Download data must be JSON serializable.', {
      cause: error,
    });
  }

  if (serializedValue === undefined) {
    throw new TypeError('Download data must be JSON serializable.');
  }

  return `${serializedValue}\n`;
}

/**
 * Serializes a string or data object as an XML document.
 *
 * Existing XML strings are preserved. Object values are escaped and wrapped
 * in the configured root element.
 *
 * @param {unknown} data XML string or serializable value.
 * @param {{rootElement?: string, redact?: boolean, indentation?: string}}
 * [options] Serialization options.
 * @returns {string} XML document.
 */
export function serializeXmlDownload(data, options = {}) {
  const normalizedOptions = assertOptions(options, 'XML options');

  if (typeof data === 'string') {
    const xml = data.trim();

    if (xml === '') {
      throw new TypeError('XML download content cannot be empty.');
    }

    return `${xml}\n`;
  }

  const rootElement = normalizeXmlElementName(
    normalizedOptions.rootElement ?? DEFAULT_XML_ROOT_ELEMENT,
    DEFAULT_XML_ROOT_ELEMENT,
  );
  const indentation = normalizedOptions.indentation ?? '  ';

  if (
    typeof indentation !== 'string' ||
    /[^\t ]/.test(indentation) ||
    indentation.length > 10
  ) {
    throw new TypeError(
      'XML indentation must contain no more than 10 spaces or tabs.',
    );
  }

  const value = normalizedOptions.redact
    ? redactForExport(data)
    : data;
  const body = serializeXmlValue(
    rootElement,
    value,
    indentation,
    0,
    new WeakSet(),
  );

  return `<?xml version="1.0" encoding="UTF-8"?>\n${body}\n`;
}

/**
 * Creates a downloadable Blob artifact without starting a browser download.
 *
 * @param {string} content Artifact content.
 * @param {string} fileName Requested file name.
 * @param {string} mimeType Artifact MIME type.
 * @returns {{blob: Blob, fileName: string, mimeType: string, size: number}}
 * Download artifact.
 */
export function createDownloadArtifact(
  content,
  fileName,
  mimeType = DOWNLOAD_MIME_TYPES.TEXT,
) {
  const normalizedContent = normalizeContent(content);
  const normalizedMimeType = normalizeMimeType(mimeType);
  const safeFileName = sanitizeDownloadFileName(fileName);
  const blob = new Blob([normalizedContent], {
    type: normalizedMimeType,
  });

  return Object.freeze({
    blob,
    fileName: safeFileName,
    mimeType: normalizedMimeType,
    size: blob.size,
  });
}

/**
 * Starts a browser download for an existing artifact.
 *
 * @param {{blob: Blob, fileName: string, mimeType?: string}} artifact
 * Download artifact.
 * @returns {{blob: Blob, fileName: string, mimeType: string, size: number}}
 * Normalized downloaded artifact.
 */
export function downloadArtifact(artifact) {
  if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) {
    throw new TypeError('A valid download artifact is required.');
  }

  if (!(artifact.blob instanceof Blob)) {
    throw new TypeError('The download artifact must contain a Blob.');
  }

  const fileName = sanitizeDownloadFileName(artifact.fileName);
  const mimeType = normalizeMimeType(
    artifact.mimeType || artifact.blob.type || DOWNLOAD_MIME_TYPES.OCTET_STREAM,
  );
  const normalizedArtifact = Object.freeze({
    blob: artifact.blob,
    fileName,
    mimeType,
    size: artifact.blob.size,
  });
  const { document: browserDocument, urlApi } =
    getBrowserDownloadDependencies();
  const objectUrl = urlApi.createObjectURL(normalizedArtifact.blob);
  const link = browserDocument.createElement('a');

  link.href = objectUrl;
  link.download = normalizedArtifact.fileName;
  link.rel = 'noopener';
  link.setAttribute('aria-hidden', 'true');

  try {
    browserDocument.body.append(link);
    link.click();
  } finally {
    link.remove();
    urlApi.revokeObjectURL(objectUrl);
  }

  return normalizedArtifact;
}

/**
 * Creates and optionally downloads a text artifact.
 *
 * @param {string} content Text content.
 * @param {string} fileName Requested file name.
 * @param {{download?: boolean, mimeType?: string}} [options] Download options.
 * @returns {{blob: Blob, fileName: string, mimeType: string, size: number}}
 * Text artifact.
 */
export function downloadText(content, fileName, options = {}) {
  const normalizedOptions = assertOptions(options, 'Text download options');
  const safeFileName = sanitizeDownloadFileName(fileName, {
    extension: DOWNLOAD_EXTENSIONS.TEXT,
  });
  const artifact = createDownloadArtifact(
    normalizeContent(content, 'Text download content'),
    safeFileName,
    normalizedOptions.mimeType ?? DOWNLOAD_MIME_TYPES.TEXT,
  );

  return normalizedOptions.download === false
    ? artifact
    : downloadArtifact(artifact);
}

/**
 * Creates and optionally downloads a JSON artifact.
 *
 * @param {unknown} data Data to serialize.
 * @param {string} fileName Requested file name.
 * @param {{download?: boolean, redact?: boolean, space?: number | string}}
 * [options] Download options.
 * @returns {{blob: Blob, fileName: string, mimeType: string, size: number}}
 * JSON artifact.
 */
export function downloadJson(data, fileName, options = {}) {
  const normalizedOptions = assertOptions(options, 'JSON download options');
  const safeFileName = sanitizeDownloadFileName(fileName, {
    extension: DOWNLOAD_EXTENSIONS.JSON,
  });
  const content = serializeJsonDownload(data, normalizedOptions);
  const artifact = createDownloadArtifact(
    content,
    safeFileName,
    DOWNLOAD_MIME_TYPES.JSON,
  );

  return normalizedOptions.download === false
    ? artifact
    : downloadArtifact(artifact);
}

/**
 * Creates and optionally downloads an XML artifact.
 *
 * @param {unknown} data XML string or serializable data.
 * @param {string} fileName Requested file name.
 * @param {{
 *   download?: boolean,
 *   redact?: boolean,
 *   rootElement?: string,
 *   indentation?: string
 * }} [options] Download options.
 * @returns {{blob: Blob, fileName: string, mimeType: string, size: number}}
 * XML artifact.
 */
export function downloadXml(data, fileName, options = {}) {
  const normalizedOptions = assertOptions(options, 'XML download options');
  const safeFileName = sanitizeDownloadFileName(fileName, {
    extension: DOWNLOAD_EXTENSIONS.XML,
  });
  const content = serializeXmlDownload(data, normalizedOptions);
  const artifact = createDownloadArtifact(
    content,
    safeFileName,
    DOWNLOAD_MIME_TYPES.XML,
  );

  return normalizedOptions.download === false
    ? artifact
    : downloadArtifact(artifact);
}

/**
 * Creates and optionally downloads a synthetic placeholder document.
 *
 * The placeholder is plain text and contains no embedded or executable
 * content.
 *
 * @param {string} fileName Requested file name.
 * @param {{
 *   download?: boolean,
 *   title?: string,
 *   description?: string,
 *   documentType?: string,
 *   referenceId?: string,
 *   generatedAt?: Date | string | number,
 *   metadata?: Record<string, unknown>,
 *   redact?: boolean
 * }} [options] Placeholder options.
 * @returns {{blob: Blob, fileName: string, mimeType: string, size: number}}
 * Placeholder document artifact.
 */
export function downloadPlaceholderDocument(fileName, options = {}) {
  const normalizedOptions = assertOptions(
    options,
    'Placeholder document options',
  );
  const title =
    typeof normalizedOptions.title === 'string' &&
    normalizedOptions.title.trim() !== ''
      ? normalizedOptions.title.trim()
      : DEFAULT_PLACEHOLDER_TITLE;
  const description =
    typeof normalizedOptions.description === 'string' &&
    normalizedOptions.description.trim() !== ''
      ? normalizedOptions.description.trim()
      : 'This file is a non-production placeholder for a synthetic artifact.';
  const documentType =
    typeof normalizedOptions.documentType === 'string' &&
    normalizedOptions.documentType.trim() !== ''
      ? normalizedOptions.documentType.trim()
      : 'document';
  const generatedAtValue = normalizedOptions.generatedAt ?? Date.now();
  const generatedAt = new Date(generatedAtValue);

  if (Number.isNaN(generatedAt.getTime())) {
    throw new RangeError('Placeholder generatedAt must be a valid date.');
  }

  if (
    normalizedOptions.metadata !== undefined &&
    (!normalizedOptions.metadata ||
      typeof normalizedOptions.metadata !== 'object' ||
      Array.isArray(normalizedOptions.metadata))
  ) {
    throw new TypeError('Placeholder metadata must be an object.');
  }

  const metadata = normalizedOptions.redact
    ? redactForExport(normalizedOptions.metadata ?? {})
    : normalizedOptions.metadata ?? {};
  const metadataContent =
    Object.keys(metadata).length > 0
      ? serializeJsonDownload(metadata, { space: 2 }).trimEnd()
      : '{}';
  const content = [
    title,
    '='.repeat(Math.min(title.length, 80)),
    '',
    description,
    '',
    `Document type: ${documentType}`,
    `Reference ID: ${normalizedOptions.referenceId ?? 'Not provided'}`,
    `Generated at: ${generatedAt.toISOString()}`,
    '',
    'Metadata:',
    metadataContent,
    '',
    'Synthetic artifact only. This is not an official document.',
    '',
  ].join('\n');
  const safeFileName = sanitizeDownloadFileName(fileName, {
    extension: DOWNLOAD_EXTENSIONS.DOCUMENT,
    fallback: 'synthetic-document',
  });
  const artifact = createDownloadArtifact(
    content,
    safeFileName,
    DOWNLOAD_MIME_TYPES.TEXT,
  );

  return normalizedOptions.download === false
    ? artifact
    : downloadArtifact(artifact);
}

export const sanitizeFileName = sanitizeDownloadFileName;
export const serializeJson = serializeJsonDownload;
export const serializeXml = serializeXmlDownload;
export const createArtifact = createDownloadArtifact;
export const triggerDownload = downloadArtifact;
export const downloadJSON = downloadJson;
export const downloadXML = downloadXml;
export const downloadDocumentPlaceholder = downloadPlaceholderDocument;
export const createPlaceholderDocumentDownload =
  downloadPlaceholderDocument;

export default Object.freeze({
  createDownloadArtifact,
  downloadArtifact,
  downloadJson,
  downloadPlaceholderDocument,
  downloadText,
  downloadXml,
  sanitizeDownloadFileName,
  serializeJsonDownload,
  serializeXmlDownload,
});