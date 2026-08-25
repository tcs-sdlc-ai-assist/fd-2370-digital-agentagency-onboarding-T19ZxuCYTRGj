import { z } from 'zod';
import { STORAGE_KEYS } from '../constants/storageKeys.js';
import { BrowserStorageAdapter } from '../persistence/browserStorageAdapter.js';
import { toIsoTimestamp } from '../utils/dates.js';
import { createDeterministicId } from '../utils/ids.js';

const identifierSchema = z.string().trim().min(1);
const dateTimeSchema = z.string().datetime({ offset: true });
const nullableIdentifierSchema = identifierSchema.nullable();
const nullableDateTimeSchema = dateTimeSchema.nullable();
const metadataSchema = z.record(z.unknown());

export const DOCUMENT_PACKAGE_REPOSITORY_STORAGE_KEY =
  `${STORAGE_KEYS.ONBOARDING}:document-packages`;

export const DOCUMENT_PACKAGE_STATUSES = Object.freeze({
  DRAFT: 'DRAFT',
  GENERATED: 'GENERATED',
  CONSENTED: 'CONSENTED',
  SIGNED: 'SIGNED',
  COMPLETE: 'COMPLETE',
  DECLINED: 'DECLINED',
  EXPIRED: 'EXPIRED',
});

export const DOCUMENT_SIGNATURE_STATES = Object.freeze({
  NOT_STARTED: 'NOT_STARTED',
  CONSENTED: 'CONSENTED',
  SIGNED: 'SIGNED',
  DECLINED: 'DECLINED',
  EXPIRED: 'EXPIRED',
});

export const DOCUMENT_ARTIFACT_STATUSES = Object.freeze({
  PENDING: 'PENDING',
  GENERATED: 'GENERATED',
  READY_FOR_SIGNATURE: 'READY_FOR_SIGNATURE',
  SIGNED: 'SIGNED',
  SUPERSEDED: 'SUPERSEDED',
  FAILED: 'FAILED',
});

export const documentManifestItemSchema = z
  .object({
    code: identifierSchema,
    name: z.string().trim().min(1).optional(),
    description: z.string().trim().min(1).optional(),
    required: z.boolean().default(true),
    status: identifierSchema.default('REQUIRED'),
    signatureRequired: z.boolean().default(false),
    signerType: identifierSchema.nullable().optional(),
    metadata: metadataSchema.default({}),
  })
  .passthrough();

export const documentArtifactReferenceSchema = z
  .object({
    artifactId: identifierSchema,
    referenceId: nullableIdentifierSchema.optional(),
    documentCode: nullableIdentifierSchema.optional(),
    name: z.string().trim().min(1),
    fileName: z.string().trim().min(1),
    mimeType: identifierSchema,
    status: z
      .enum(Object.values(DOCUMENT_ARTIFACT_STATUSES))
      .default(DOCUMENT_ARTIFACT_STATUSES.GENERATED),
    size: z.number().int().nonnegative().optional(),
    checksum: identifierSchema.nullable().optional(),
    downloadUrl: identifierSchema.nullable().optional(),
    generatedAt: dateTimeSchema,
    signedAt: nullableDateTimeSchema.optional(),
    metadata: metadataSchema.default({}),
  })
  .passthrough();

export const retainedSignatureSchema = z
  .object({
    signatureId: identifierSchema,
    signatureType: identifierSchema,
    signerType: identifierSchema,
    signerNameMasked: z.string().trim().min(1).nullable().optional(),
    status: z
      .enum(Object.values(DOCUMENT_SIGNATURE_STATES))
      .default(DOCUMENT_SIGNATURE_STATES.NOT_STARTED),
    retained: z.boolean().default(true),
    sourceArtifactId: nullableIdentifierSchema.optional(),
    capturedAt: nullableDateTimeSchema.optional(),
    expiresAt: nullableDateTimeSchema.optional(),
    metadata: metadataSchema.default({}),
  })
  .passthrough();

export const documentSignOffSchema = z
  .object({
    status: z
      .enum(Object.values(DOCUMENT_SIGNATURE_STATES))
      .default(DOCUMENT_SIGNATURE_STATES.NOT_STARTED),
    consented: z.boolean().default(false),
    signedBy: nullableIdentifierSchema.optional(),
    consentedAt: nullableDateTimeSchema.optional(),
    signedAt: nullableDateTimeSchema.optional(),
    declinedAt: nullableDateTimeSchema.optional(),
    expiresAt: nullableDateTimeSchema.optional(),
    envelopeId: nullableIdentifierSchema.optional(),
    metadata: metadataSchema.default({}),
  })
  .passthrough();

const requiredFormSchema = z.union([
  identifierSchema,
  documentManifestItemSchema,
]);

export const documentPackageSchema = z
  .object({
    trackingId: identifierSchema,
    applicationId: nullableIdentifierSchema.optional(),
    packageVersion: z.number().int().positive().default(1),
    status: z
      .enum(Object.values(DOCUMENT_PACKAGE_STATUSES))
      .default(DOCUMENT_PACKAGE_STATUSES.DRAFT),
    requiredForms: z.array(requiredFormSchema).default([]),
    generatedArtifacts: z
      .array(documentArtifactReferenceSchema)
      .default([]),
    retainedSignatures: z.record(retainedSignatureSchema).default({}),
    retainedGaSignature: z.boolean().default(false),
    agentSignatureState: z
      .enum(Object.values(DOCUMENT_SIGNATURE_STATES))
      .default(DOCUMENT_SIGNATURE_STATES.NOT_STARTED),
    signOff: documentSignOffSchema.default({}),
    packageComplete: z.boolean().default(false),
    generatedAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    completedAt: nullableDateTimeSchema.optional(),
    metadata: metadataSchema.default({}),
  })
  .passthrough()
  .superRefine((documentPackage, context) => {
    if (
      documentPackage.packageComplete &&
      documentPackage.agentSignatureState !==
        DOCUMENT_SIGNATURE_STATES.SIGNED
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A complete package must have a signed agent signature.',
        path: ['agentSignatureState'],
      });
    }

    if (
      documentPackage.packageComplete &&
      documentPackage.status !== DOCUMENT_PACKAGE_STATUSES.COMPLETE
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A complete package must use the COMPLETE status.',
        path: ['status'],
      });
    }
  });

export const documentPackageRepositoryStateSchema = z
  .object({
    packages: z.record(z.unknown()).default({}),
  })
  .passthrough();

export const DOCUMENT_PACKAGE_REPOSITORY_ERROR_CODES = Object.freeze({
  INVALID_PACKAGE: 'DOCUMENT_PACKAGE_INVALID',
  INVALID_ARTIFACT: 'DOCUMENT_ARTIFACT_INVALID',
  INVALID_SIGNATURE: 'DOCUMENT_SIGNATURE_INVALID',
  NOT_FOUND: 'DOCUMENT_PACKAGE_NOT_FOUND',
  DUPLICATE: 'DOCUMENT_PACKAGE_DUPLICATE',
  DUPLICATE_APPLICATION: 'DOCUMENT_PACKAGE_DUPLICATE_APPLICATION',
  DUPLICATE_ARTIFACT: 'DOCUMENT_ARTIFACT_DUPLICATE',
  IDENTIFIER_CHANGE: 'DOCUMENT_PACKAGE_IDENTIFIER_CHANGE',
  CONFLICT: 'DOCUMENT_PACKAGE_UPDATE_CONFLICT',
  PERSISTENCE_FAILED: 'DOCUMENT_PACKAGE_PERSISTENCE_FAILED',
});

const CANONICAL_FIELDS = Object.freeze(['trackingId', 'applicationId']);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isStorageLike(value) {
  return (
    isObject(value) &&
    typeof value.getItem === 'function' &&
    typeof value.setItem === 'function' &&
    typeof value.removeItem === 'function'
  );
}

function isRepositoryStorageAdapter(value) {
  return (
    isObject(value) &&
    typeof value.get === 'function' &&
    typeof value.set === 'function' &&
    typeof value.remove === 'function'
  );
}

function assertOptions(options, description = 'Document package options') {
  if (!isObject(options)) {
    throw new TypeError(`${description} must be an object.`);
  }

  return options;
}

function normalizeIdentifier(value, description = 'Identifier') {
  if (
    value === null ||
    value === undefined ||
    String(value).trim() === ''
  ) {
    throw new TypeError(`${description} must be a non-empty value.`);
  }

  return String(value).trim();
}

function normalizeNullableIdentifier(value, description) {
  if (value === null || value === undefined) {
    return null;
  }

  return normalizeIdentifier(value, description);
}

function normalizeIdentifierForLookup(value, description = 'Identifier') {
  return normalizeIdentifier(value, description)
    .normalize('NFKC')
    .toLowerCase();
}

function cloneValue(value) {
  if (value === undefined) {
    return undefined;
  }

  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value));
}

function deepMerge(baseValue, overlayValue) {
  if (!isObject(baseValue) || !isObject(overlayValue)) {
    return cloneValue(overlayValue);
  }

  const mergedValue = {
    ...cloneValue(baseValue),
  };

  Object.entries(overlayValue).forEach(([key, value]) => {
    if (value === undefined) {
      return;
    }

    if (isObject(value) && isObject(mergedValue[key])) {
      mergedValue[key] = deepMerge(mergedValue[key], value);
      return;
    }

    mergedValue[key] = cloneValue(value);
  });

  return mergedValue;
}

function formatValidationIssues(error) {
  return error.issues
    .map((issue) => {
      const path =
        issue.path.length > 0 ? issue.path.join('.') : 'documentPackage';

      return `${path}: ${issue.message}`;
    })
    .join('; ');
}

function createRepositoryError(code, message, details, cause) {
  const error = new Error(message, {
    ...(cause === undefined ? {} : { cause }),
  });

  error.name = 'DocumentPackageRepositoryError';
  error.code = code;
  error.details = details ?? null;

  return error;
}

function parseDocumentPackage(documentPackage) {
  const result = documentPackageSchema.safeParse(documentPackage);

  if (!result.success) {
    throw createRepositoryError(
      DOCUMENT_PACKAGE_REPOSITORY_ERROR_CODES.INVALID_PACKAGE,
      `Invalid document package: ${formatValidationIssues(result.error)}`,
      { issues: result.error.issues },
      result.error,
    );
  }

  return result.data;
}

function parseArtifact(artifact) {
  const result = documentArtifactReferenceSchema.safeParse(artifact);

  if (!result.success) {
    throw createRepositoryError(
      DOCUMENT_PACKAGE_REPOSITORY_ERROR_CODES.INVALID_ARTIFACT,
      `Invalid document artifact: ${formatValidationIssues(result.error)}`,
      { issues: result.error.issues },
      result.error,
    );
  }

  return result.data;
}

function parseSignature(signature) {
  const result = retainedSignatureSchema.safeParse(signature);

  if (!result.success) {
    throw createRepositoryError(
      DOCUMENT_PACKAGE_REPOSITORY_ERROR_CODES.INVALID_SIGNATURE,
      `Invalid retained signature: ${formatValidationIssues(result.error)}`,
      { issues: result.error.issues },
      result.error,
    );
  }

  return result.data;
}

function createEmptyState() {
  return {
    packages: {},
  };
}

function assertCanonicalFieldsUnchanged(currentPackage, nextPackage) {
  CANONICAL_FIELDS.forEach((field) => {
    const currentValue = currentPackage[field] ?? null;
    const nextValue = nextPackage[field] ?? null;

    if (currentValue !== nextValue) {
      throw createRepositoryError(
        DOCUMENT_PACKAGE_REPOSITORY_ERROR_CODES.IDENTIFIER_CHANGE,
        `The canonical document package field "${field}" cannot be changed.`,
        {
          field,
          currentValue,
          requestedValue: nextValue,
        },
      );
    }
  });
}

function normalizeQuery(query) {
  if (query === undefined) {
    return {};
  }

  const normalizedQuery = assertOptions(query, 'Document package query');

  if (
    normalizedQuery.limit !== undefined &&
    (!Number.isInteger(normalizedQuery.limit) ||
      normalizedQuery.limit < 1)
  ) {
    throw new RangeError(
      'Document package query limit must be a positive integer.',
    );
  }

  if (
    normalizedQuery.offset !== undefined &&
    (!Number.isInteger(normalizedQuery.offset) ||
      normalizedQuery.offset < 0)
  ) {
    throw new RangeError(
      'Document package query offset must be a nonnegative integer.',
    );
  }

  if (
    normalizedQuery.packageComplete !== undefined &&
    typeof normalizedQuery.packageComplete !== 'boolean'
  ) {
    throw new TypeError(
      'Document package complete filter must be a boolean.',
    );
  }

  if (
    normalizedQuery.retainedGaSignature !== undefined &&
    typeof normalizedQuery.retainedGaSignature !== 'boolean'
  ) {
    throw new TypeError(
      'Retained GA signature filter must be a boolean.',
    );
  }

  return normalizedQuery;
}

function matchesQuery(documentPackage, query) {
  if (
    query.applicationId !== undefined &&
    documentPackage.applicationId !== query.applicationId
  ) {
    return false;
  }

  if (
    query.status !== undefined &&
    documentPackage.status !== query.status
  ) {
    return false;
  }

  if (
    query.agentSignatureState !== undefined &&
    documentPackage.agentSignatureState !== query.agentSignatureState
  ) {
    return false;
  }

  if (
    query.packageComplete !== undefined &&
    documentPackage.packageComplete !== query.packageComplete
  ) {
    return false;
  }

  if (
    query.retainedGaSignature !== undefined &&
    documentPackage.retainedGaSignature !== query.retainedGaSignature
  ) {
    return false;
  }

  if (
    query.documentCode !== undefined &&
    !documentPackage.generatedArtifacts.some(
      (artifact) => artifact.documentCode === query.documentCode,
    )
  ) {
    return false;
  }

  return true;
}

function createArtifactIdentifier(trackingId, artifact) {
  return createDeterministicId(
    'DOC',
    {
      trackingId,
      documentCode: artifact.documentCode ?? null,
      fileName: artifact.fileName,
      referenceId: artifact.referenceId ?? null,
      generatedAt: artifact.generatedAt,
    },
    { length: 16 },
  );
}

function createSignatureIdentifier(trackingId, signatureType, signature) {
  return createDeterministicId(
    'SIG',
    {
      trackingId,
      signatureType,
      signerType: signature.signerType,
      sourceArtifactId: signature.sourceArtifactId ?? null,
    },
    { length: 16 },
  );
}

function resolveStorageAdapter(options) {
  if (options.storageAdapter !== undefined) {
    if (!isRepositoryStorageAdapter(options.storageAdapter)) {
      throw new TypeError(
        'The document package storage adapter must provide get, set, and remove methods.',
      );
    }

    return options.storageAdapter;
  }

  if (options.storage !== undefined && !isStorageLike(options.storage)) {
    throw new TypeError(
      'The supplied document package storage implementation is invalid.',
    );
  }

  return new BrowserStorageAdapter({
    ...(options.storage === undefined ? {} : { storage: options.storage }),
    ...(options.namespace === undefined
      ? {}
      : { namespace: options.namespace }),
    ...(options.schemaVersion === undefined
      ? {}
      : { schemaVersion: options.schemaVersion }),
    ...(options.clock === undefined ? {} : { clock: options.clock }),
    ...(options.onStorageError === undefined
      ? {}
      : { onError: options.onStorageError }),
  });
}

/**
 * Persists mock document package manifests, artifacts, signatures, and
 * sign-off state.
 */
export class DocumentPackageRepository {
  /**
   * @param {{
   *   storageAdapter?: object,
   *   storage?: Storage,
   *   storageKey?: string,
   *   namespace?: string,
   *   schemaVersion?: number,
   *   clock?: () => Date | string | number,
   *   onStorageError?: (error: object) => void
   * }} [options] Repository options.
   */
  constructor(options = {}) {
    const normalizedOptions = assertOptions(options);

    if (
      normalizedOptions.clock !== undefined &&
      typeof normalizedOptions.clock !== 'function'
    ) {
      throw new TypeError(
        'The document package repository clock must be a function.',
      );
    }

    this.clock = normalizedOptions.clock ?? (() => new Date());
    this.storageAdapter = resolveStorageAdapter(normalizedOptions);
    this.storageKey = normalizeIdentifier(
      normalizedOptions.storageKey ??
        DOCUMENT_PACKAGE_REPOSITORY_STORAGE_KEY,
      'Document package repository storage key',
    );
  }

  /**
   * Lists document packages.
   *
   * @param {{
   *   applicationId?: string,
   *   status?: string,
   *   agentSignatureState?: string,
   *   packageComplete?: boolean,
   *   retainedGaSignature?: boolean,
   *   documentCode?: string,
   *   limit?: number,
   *   offset?: number
   * }} [query] Package filters.
   * @returns {object[]} Matching document packages.
   */
  list(query = {}) {
    const normalizedQuery = normalizeQuery(query);
    const offset = normalizedQuery.offset ?? 0;
    const limit = normalizedQuery.limit ?? Number.POSITIVE_INFINITY;

    return this.readPackages()
      .filter((documentPackage) =>
        matchesQuery(documentPackage, normalizedQuery),
      )
      .sort(
        (left, right) =>
          Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
      )
      .slice(offset, offset + limit)
      .map((documentPackage) => cloneValue(documentPackage));
  }

  /**
   * Alias for list.
   *
   * @param {object} [query] Package filters.
   * @returns {object[]} Matching document packages.
   */
  getAll(query = {}) {
    return this.list(query);
  }

  /**
   * Finds a document package by tracking identifier.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @returns {object | undefined} Matching document package.
   */
  find(trackingId) {
    const state = this.readState();
    const documentPackage = this.findInState(state, trackingId);

    return documentPackage ? cloneValue(documentPackage) : undefined;
  }

  /**
   * Alias for find.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @returns {object | undefined} Matching document package.
   */
  findByTrackingId(trackingId) {
    return this.find(trackingId);
  }

  /**
   * Finds a document package by application identifier.
   *
   * @param {string | number} applicationId Application identifier.
   * @returns {object | undefined} Matching document package.
   */
  findByApplicationId(applicationId) {
    const normalizedApplicationId = normalizeIdentifierForLookup(
      applicationId,
      'Application identifier',
    );
    const documentPackage = this.readPackages().find(
      (candidate) =>
        candidate.applicationId !== null &&
        candidate.applicationId !== undefined &&
        normalizeIdentifierForLookup(
          candidate.applicationId,
          'Application identifier',
        ) === normalizedApplicationId,
    );

    return documentPackage ? cloneValue(documentPackage) : undefined;
  }

  /**
   * Returns a document package or throws when absent.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @returns {object} Matching document package.
   */
  get(trackingId) {
    const documentPackage = this.find(trackingId);

    if (!documentPackage) {
      throw createRepositoryError(
        DOCUMENT_PACKAGE_REPOSITORY_ERROR_CODES.NOT_FOUND,
        `Document package not found: ${trackingId}`,
        { trackingId: String(trackingId) },
      );
    }

    return documentPackage;
  }

  /**
   * Creates a new document package.
   *
   * @param {object} documentPackage Initial package values.
   * @returns {object} Created document package.
   */
  create(documentPackage) {
    if (!isObject(documentPackage)) {
      throw new TypeError('A document package must be an object.');
    }

    const trackingId = normalizeIdentifier(
      documentPackage.trackingId,
      'Tracking identifier',
    );

    if (this.find(trackingId)) {
      throw createRepositoryError(
        DOCUMENT_PACKAGE_REPOSITORY_ERROR_CODES.DUPLICATE,
        `A document package already exists: ${trackingId}`,
        { trackingId },
      );
    }

    if (
      documentPackage.applicationId !== null &&
      documentPackage.applicationId !== undefined &&
      this.findByApplicationId(documentPackage.applicationId)
    ) {
      throw createRepositoryError(
        DOCUMENT_PACKAGE_REPOSITORY_ERROR_CODES.DUPLICATE_APPLICATION,
        `A document package already exists for application identifier: ${documentPackage.applicationId}`,
        {
          applicationId: String(documentPackage.applicationId),
        },
      );
    }

    const timestamp = toIsoTimestamp(this.clock());
    const candidate = {
      ...cloneValue(documentPackage),
      trackingId,
      applicationId:
        documentPackage.applicationId === undefined
          ? undefined
          : normalizeNullableIdentifier(
              documentPackage.applicationId,
              'Application identifier',
            ),
      packageVersion: documentPackage.packageVersion ?? 1,
      generatedAt: documentPackage.generatedAt ?? timestamp,
      updatedAt: documentPackage.updatedAt ?? timestamp,
    };
    const parsedPackage = parseDocumentPackage(candidate);
    const state = this.readState();

    state.packages[parsedPackage.trackingId] = cloneValue(parsedPackage);
    this.persistState(state);

    return cloneValue(parsedPackage);
  }

  /**
   * Saves a complete document package.
   *
   * @param {object} documentPackage Package to persist.
   * @param {{expectedVersion?: number}} [options] Save options.
   * @returns {object} Persisted document package.
   */
  save(documentPackage, options = {}) {
    const normalizedOptions = assertOptions(
      options,
      'Document package save options',
    );

    if (!isObject(documentPackage)) {
      throw new TypeError('A document package must be an object.');
    }

    const timestamp = toIsoTimestamp(this.clock());
    const parsedPackage = parseDocumentPackage({
      ...cloneValue(documentPackage),
      generatedAt: documentPackage.generatedAt ?? timestamp,
      updatedAt: documentPackage.updatedAt ?? timestamp,
    });
    const state = this.readState();
    const currentPackage = this.findInState(
      state,
      parsedPackage.trackingId,
    );

    this.assertExpectedVersion(currentPackage, normalizedOptions);

    if (currentPackage) {
      assertCanonicalFieldsUnchanged(currentPackage, parsedPackage);
    }

    this.assertApplicationIdAvailable(
      state,
      parsedPackage.applicationId,
      parsedPackage.trackingId,
    );

    state.packages[parsedPackage.trackingId] = cloneValue(parsedPackage);
    this.persistState(state);

    return cloneValue(parsedPackage);
  }

  /**
   * Alias for save.
   *
   * @param {object} documentPackage Package to persist.
   * @param {object} [options] Save options.
   * @returns {object} Persisted document package.
   */
  upsert(documentPackage, options = {}) {
    return this.save(documentPackage, options);
  }

  /**
   * Atomically patches a document package.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @param {object | ((documentPackage: object) => object)} update
   * Package patch or updater.
   * @param {{
   *   expectedVersion?: number,
   *   incrementVersion?: boolean
   * }} [options] Update options.
   * @returns {object} Updated document package.
   */
  update(trackingId, update, options = {}) {
    const normalizedOptions = assertOptions(
      options,
      'Document package update options',
    );

    if (typeof update !== 'function' && !isObject(update)) {
      throw new TypeError(
        'A document package update must be an object or updater function.',
      );
    }

    const state = this.readState();
    const currentPackage = this.findInState(state, trackingId);

    if (!currentPackage) {
      throw createRepositoryError(
        DOCUMENT_PACKAGE_REPOSITORY_ERROR_CODES.NOT_FOUND,
        `Document package not found: ${trackingId}`,
        { trackingId: String(trackingId) },
      );
    }

    this.assertExpectedVersion(currentPackage, normalizedOptions);

    const updateValue =
      typeof update === 'function'
        ? update(cloneValue(currentPackage))
        : update;

    if (!isObject(updateValue)) {
      throw new TypeError(
        'The document package updater must return a package or patch object.',
      );
    }

    const timestamp = toIsoTimestamp(this.clock());
    const nextPackage = parseDocumentPackage({
      ...deepMerge(currentPackage, updateValue),
      packageVersion:
        normalizedOptions.incrementVersion === false
          ? currentPackage.packageVersion
          : currentPackage.packageVersion + 1,
      updatedAt: timestamp,
    });

    assertCanonicalFieldsUnchanged(currentPackage, nextPackage);
    this.assertApplicationIdAvailable(
      state,
      nextPackage.applicationId,
      nextPackage.trackingId,
    );

    state.packages[currentPackage.trackingId] = cloneValue(nextPackage);
    this.persistState(state);

    return cloneValue(nextPackage);
  }

  /**
   * Alias for update emphasizing transactional behavior.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @param {object | ((documentPackage: object) => object)} update
   * Package patch or updater.
   * @param {object} [options] Update options.
   * @returns {object} Updated document package.
   */
  atomicUpdate(trackingId, update, options = {}) {
    return this.update(trackingId, update, options);
  }

  /**
   * Replaces the package manifest.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @param {Array<string | object>} requiredForms Required forms.
   * @param {{expectedVersion?: number}} [options] Update options.
   * @returns {object} Updated document package.
   */
  setManifest(trackingId, requiredForms, options = {}) {
    if (!Array.isArray(requiredForms)) {
      throw new TypeError('Document package required forms must be an array.');
    }

    return this.update(
      trackingId,
      {
        requiredForms: cloneValue(requiredForms),
        status: DOCUMENT_PACKAGE_STATUSES.GENERATED,
      },
      options,
    );
  }

  /**
   * Alias for setManifest.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @param {Array<string | object>} requiredForms Required forms.
   * @param {object} [options] Update options.
   * @returns {object} Updated document package.
   */
  saveManifest(trackingId, requiredForms, options = {}) {
    return this.setManifest(trackingId, requiredForms, options);
  }

  /**
   * Adds a generated artifact reference.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @param {object} artifact Artifact details.
   * @param {{expectedVersion?: number}} [options] Update options.
   * @returns {object} Updated document package.
   */
  addArtifactReference(trackingId, artifact, options = {}) {
    if (!isObject(artifact)) {
      throw new TypeError('A document artifact must be an object.');
    }

    const timestamp = toIsoTimestamp(this.clock());
    const candidate = {
      ...cloneValue(artifact),
      artifactId:
        artifact.artifactId ??
        createArtifactIdentifier(String(trackingId), {
          ...artifact,
          generatedAt: artifact.generatedAt ?? timestamp,
        }),
      referenceId:
        artifact.referenceId === undefined
          ? null
          : normalizeNullableIdentifier(
              artifact.referenceId,
              'Artifact reference identifier',
            ),
      documentCode:
        artifact.documentCode === undefined
          ? null
          : normalizeNullableIdentifier(
              artifact.documentCode,
              'Document code',
            ),
      name:
        artifact.name ??
        artifact.fileName ??
        artifact.documentCode ??
        'Generated document',
      fileName:
        artifact.fileName ??
        `${artifact.documentCode ?? 'document'}.txt`,
      mimeType: artifact.mimeType ?? 'text/plain',
      generatedAt: artifact.generatedAt ?? timestamp,
    };
    const parsedArtifact = parseArtifact(candidate);

    return this.update(
      trackingId,
      (documentPackage) => {
        const duplicate = documentPackage.generatedArtifacts.some(
          (existingArtifact) =>
            normalizeIdentifierForLookup(
              existingArtifact.artifactId,
              'Artifact identifier',
            ) ===
            normalizeIdentifierForLookup(
              parsedArtifact.artifactId,
              'Artifact identifier',
            ),
        );

        if (duplicate) {
          throw createRepositoryError(
            DOCUMENT_PACKAGE_REPOSITORY_ERROR_CODES.DUPLICATE_ARTIFACT,
            `A document artifact already exists: ${parsedArtifact.artifactId}`,
            { artifactId: parsedArtifact.artifactId },
          );
        }

        return {
          generatedArtifacts: [
            ...documentPackage.generatedArtifacts,
            parsedArtifact,
          ],
          status: DOCUMENT_PACKAGE_STATUSES.GENERATED,
        };
      },
      options,
    );
  }

  /**
   * Alias for addArtifactReference.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @param {object} artifact Artifact details.
   * @param {object} [options] Update options.
   * @returns {object} Updated document package.
   */
  addArtifact(trackingId, artifact, options = {}) {
    return this.addArtifactReference(trackingId, artifact, options);
  }

  /**
   * Removes a generated artifact reference.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @param {string | number} artifactId Artifact identifier.
   * @param {{expectedVersion?: number}} [options] Update options.
   * @returns {object} Updated document package.
   */
  removeArtifactReference(trackingId, artifactId, options = {}) {
    const normalizedArtifactId = normalizeIdentifierForLookup(
      artifactId,
      'Artifact identifier',
    );

    return this.update(
      trackingId,
      (documentPackage) => ({
        generatedArtifacts: documentPackage.generatedArtifacts.filter(
          (artifact) =>
            normalizeIdentifierForLookup(
              artifact.artifactId,
              'Artifact identifier',
            ) !== normalizedArtifactId,
        ),
      }),
      options,
    );
  }

  /**
   * Retains a reusable signature with the package.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @param {string} signatureType Signature type.
   * @param {object} signature Signature details.
   * @param {{expectedVersion?: number}} [options] Update options.
   * @returns {object} Updated document package.
   */
  retainSignature(
    trackingId,
    signatureType,
    signature,
    options = {},
  ) {
    const normalizedSignatureType = normalizeIdentifier(
      signatureType,
      'Signature type',
    );

    if (!isObject(signature)) {
      throw new TypeError('Retained signature details must be an object.');
    }

    const timestamp = toIsoTimestamp(this.clock());
    const parsedSignature = parseSignature({
      ...cloneValue(signature),
      signatureId:
        signature.signatureId ??
        createSignatureIdentifier(
          String(trackingId),
          normalizedSignatureType,
          signature,
        ),
      signatureType: normalizedSignatureType,
      signerType:
        signature.signerType ??
        normalizedSignatureType.replace(/_signature$/i, ''),
      capturedAt: signature.capturedAt ?? timestamp,
      retained: signature.retained ?? true,
    });
    const isGaSignature =
      normalizedSignatureType
        .normalize('NFKC')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .includes('ga');

    return this.update(
      trackingId,
      (documentPackage) => ({
        retainedSignatures: {
          ...documentPackage.retainedSignatures,
          [normalizedSignatureType]: parsedSignature,
        },
        retainedGaSignature:
          documentPackage.retainedGaSignature ||
          (isGaSignature && parsedSignature.retained),
      }),
      options,
    );
  }

  /**
   * Alias for retainSignature.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @param {string} signatureType Signature type.
   * @param {object} signature Signature details.
   * @param {object} [options] Update options.
   * @returns {object} Updated document package.
   */
  setRetainedSignature(
    trackingId,
    signatureType,
    signature,
    options = {},
  ) {
    return this.retainSignature(
      trackingId,
      signatureType,
      signature,
      options,
    );
  }

  /**
   * Removes a retained signature.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @param {string} signatureType Signature type.
   * @param {{expectedVersion?: number}} [options] Update options.
   * @returns {object} Updated document package.
   */
  removeRetainedSignature(
    trackingId,
    signatureType,
    options = {},
  ) {
    const normalizedSignatureType = normalizeIdentifierForLookup(
      signatureType,
      'Signature type',
    );

    return this.update(
      trackingId,
      (documentPackage) => {
        const retainedSignatures = Object.fromEntries(
          Object.entries(documentPackage.retainedSignatures).filter(
            ([type]) =>
              normalizeIdentifierForLookup(type, 'Signature type') !==
              normalizedSignatureType,
          ),
        );
        const retainedGaSignature = Object.entries(
          retainedSignatures,
        ).some(
          ([type, signature]) =>
            type
              .normalize('NFKC')
              .toLowerCase()
              .replace(/[^a-z0-9]/g, '')
              .includes('ga') && signature.retained,
        );

        return {
          retainedSignatures,
          retainedGaSignature,
        };
      },
      options,
    );
  }

  /**
   * Updates package sign-off state.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @param {object} signOff Sign-off state.
   * @param {{expectedVersion?: number}} [options] Update options.
   * @returns {object} Updated document package.
   */
  setSignOff(trackingId, signOff, options = {}) {
    if (!isObject(signOff)) {
      throw new TypeError('Document package sign-off must be an object.');
    }

    const result = documentSignOffSchema.safeParse(signOff);

    if (!result.success) {
      throw createRepositoryError(
        DOCUMENT_PACKAGE_REPOSITORY_ERROR_CODES.INVALID_SIGNATURE,
        `Invalid document sign-off: ${formatValidationIssues(result.error)}`,
        { issues: result.error.issues },
        result.error,
      );
    }

    const status = result.data.status;
    const packageStatus =
      status === DOCUMENT_SIGNATURE_STATES.SIGNED
        ? DOCUMENT_PACKAGE_STATUSES.SIGNED
        : status === DOCUMENT_SIGNATURE_STATES.CONSENTED
          ? DOCUMENT_PACKAGE_STATUSES.CONSENTED
          : status === DOCUMENT_SIGNATURE_STATES.DECLINED
            ? DOCUMENT_PACKAGE_STATUSES.DECLINED
            : status === DOCUMENT_SIGNATURE_STATES.EXPIRED
              ? DOCUMENT_PACKAGE_STATUSES.EXPIRED
              : undefined;

    return this.update(
      trackingId,
      {
        signOff: result.data,
        agentSignatureState: status,
        ...(packageStatus === undefined
          ? {}
          : { status: packageStatus }),
        packageComplete: false,
        completedAt: null,
      },
      options,
    );
  }

  /**
   * Records electronic-signature consent.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @param {{
   *   consented?: boolean,
   *   signedBy?: string | null,
   *   envelopeId?: string | null,
   *   metadata?: Record<string, unknown>
   * }} [consent] Consent details.
   * @param {{expectedVersion?: number}} [options] Update options.
   * @returns {object} Updated document package.
   */
  markESignConsent(
    trackingId,
    consent = {},
    options = {},
  ) {
    const normalizedConsent = assertOptions(
      consent,
      'Electronic-signature consent',
    );
    const consented = normalizedConsent.consented ?? true;

    if (typeof consented !== 'boolean') {
      throw new TypeError(
        'Electronic-signature consented must be a boolean.',
      );
    }

    return this.setSignOff(
      trackingId,
      {
        ...cloneValue(normalizedConsent),
        status: consented
          ? DOCUMENT_SIGNATURE_STATES.CONSENTED
          : DOCUMENT_SIGNATURE_STATES.NOT_STARTED,
        consented,
        consentedAt: consented ? toIsoTimestamp(this.clock()) : null,
      },
      options,
    );
  }

  /**
   * Marks the package as signed.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @param {{
   *   signedBy: string,
   *   envelopeId?: string | null,
   *   signedAt?: Date | string | number,
   *   metadata?: Record<string, unknown>
   * }} signature Sign-off details.
   * @param {{expectedVersion?: number}} [options] Update options.
   * @returns {object} Updated document package.
   */
  markSigned(trackingId, signature, options = {}) {
    const normalizedSignature = assertOptions(
      signature,
      'Document package signature',
    );
    const signedBy = normalizeIdentifier(
      normalizedSignature.signedBy,
      'Document package signer',
    );
    const signedAt = toIsoTimestamp(
      normalizedSignature.signedAt ?? this.clock(),
    );

    return this.setSignOff(
      trackingId,
      {
        ...cloneValue(normalizedSignature),
        signedBy,
        status: DOCUMENT_SIGNATURE_STATES.SIGNED,
        consented: true,
        consentedAt:
          normalizedSignature.consentedAt ?? signedAt,
        signedAt,
      },
      options,
    );
  }

  /**
   * Marks a signed package as complete.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @param {{expectedVersion?: number}} [options] Completion options.
   * @returns {object} Completed document package.
   */
  markComplete(trackingId, options = {}) {
    const normalizedOptions = assertOptions(
      options,
      'Document package completion options',
    );
    const documentPackage = this.get(trackingId);

    if (
      documentPackage.agentSignatureState !==
      DOCUMENT_SIGNATURE_STATES.SIGNED
    ) {
      throw createRepositoryError(
        DOCUMENT_PACKAGE_REPOSITORY_ERROR_CODES.INVALID_PACKAGE,
        'The document package cannot be completed before agent sign-off.',
        {
          trackingId: documentPackage.trackingId,
          agentSignatureState: documentPackage.agentSignatureState,
        },
      );
    }

    return this.update(
      trackingId,
      {
        status: DOCUMENT_PACKAGE_STATUSES.COMPLETE,
        packageComplete: true,
        completedAt: toIsoTimestamp(this.clock()),
      },
      {
        expectedVersion: normalizedOptions.expectedVersion,
      },
    );
  }

  /**
   * Alias for markComplete.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @param {object} [options] Completion options.
   * @returns {object} Completed document package.
   */
  completePackage(trackingId, options = {}) {
    return this.markComplete(trackingId, options);
  }

  /**
   * Returns a display-safe document package summary.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @returns {object} Package summary.
   */
  getDocumentPackageSummary(trackingId) {
    const documentPackage = this.get(trackingId);

    return {
      trackingId: documentPackage.trackingId,
      applicationId: documentPackage.applicationId ?? null,
      packageVersion: documentPackage.packageVersion,
      status: documentPackage.status,
      requiredFormCount: documentPackage.requiredForms.length,
      generatedArtifactCount:
        documentPackage.generatedArtifacts.length,
      requiredForms: cloneValue(documentPackage.requiredForms),
      generatedArtifacts: cloneValue(
        documentPackage.generatedArtifacts,
      ),
      retainedSignatureTypes: Object.keys(
        documentPackage.retainedSignatures,
      ),
      retainedGaSignature: documentPackage.retainedGaSignature,
      agentSignatureState: documentPackage.agentSignatureState,
      signOff: cloneValue(documentPackage.signOff),
      packageComplete: documentPackage.packageComplete,
      generatedAt: documentPackage.generatedAt,
      updatedAt: documentPackage.updatedAt,
      completedAt: documentPackage.completedAt ?? null,
    };
  }

  /**
   * Alias for getDocumentPackageSummary.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @returns {object} Package summary.
   */
  getSummary(trackingId) {
    return this.getDocumentPackageSummary(trackingId);
  }

  /**
   * Removes a document package.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @returns {boolean} Whether a package was removed.
   */
  remove(trackingId) {
    const state = this.readState();
    const documentPackage = this.findInState(state, trackingId);

    if (!documentPackage) {
      return false;
    }

    delete state.packages[documentPackage.trackingId];
    this.persistState(state);

    return true;
  }

  /**
   * Alias for remove.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @returns {boolean} Whether a package was removed.
   */
  delete(trackingId) {
    return this.remove(trackingId);
  }

  /**
   * Removes all persisted document packages.
   *
   * @returns {boolean} Whether the reset succeeded.
   */
  reset() {
    const removed = this.storageAdapter.remove(this.storageKey);

    if (!removed) {
      throw this.createPersistenceError('reset');
    }

    return true;
  }

  readState() {
    const state = this.storageAdapter.get(
      this.storageKey,
      documentPackageRepositoryStateSchema,
      createEmptyState(),
    );

    return cloneValue(state);
  }

  readPackages() {
    const state = this.readState();

    try {
      return Object.entries(state.packages).map(
        ([trackingId, storedPackage]) => {
          if (!isObject(storedPackage)) {
            throw createRepositoryError(
              DOCUMENT_PACKAGE_REPOSITORY_ERROR_CODES.INVALID_PACKAGE,
              `Invalid persisted document package: ${trackingId}`,
              { trackingId },
            );
          }

          const documentPackage = parseDocumentPackage(storedPackage);

          if (documentPackage.trackingId !== trackingId) {
            throw createRepositoryError(
              DOCUMENT_PACKAGE_REPOSITORY_ERROR_CODES.INVALID_PACKAGE,
              'A persisted document package has a mismatched tracking identifier.',
              {
                storageTrackingId: trackingId,
                packageTrackingId: documentPackage.trackingId,
              },
            );
          }

          return documentPackage;
        },
      );
    } catch {
      this.storageAdapter.remove(this.storageKey);
      return [];
    }
  }

  findInState(state, trackingId) {
    const normalizedTrackingId = normalizeIdentifierForLookup(
      trackingId,
      'Tracking identifier',
    );

    for (const [storedTrackingId, storedPackage] of Object.entries(
      state.packages,
    )) {
      if (
        normalizeIdentifierForLookup(
          storedTrackingId,
          'Tracking identifier',
        ) !== normalizedTrackingId
      ) {
        continue;
      }

      const documentPackage = parseDocumentPackage(storedPackage);

      if (documentPackage.trackingId !== storedTrackingId) {
        throw createRepositoryError(
          DOCUMENT_PACKAGE_REPOSITORY_ERROR_CODES.INVALID_PACKAGE,
          'A persisted document package has a mismatched tracking identifier.',
          {
            storageTrackingId: storedTrackingId,
            packageTrackingId: documentPackage.trackingId,
          },
        );
      }

      return documentPackage;
    }

    return undefined;
  }

  assertApplicationIdAvailable(state, applicationId, trackingId) {
    if (applicationId === null || applicationId === undefined) {
      return;
    }

    const normalizedApplicationId = normalizeIdentifierForLookup(
      applicationId,
      'Application identifier',
    );
    const normalizedTrackingId = normalizeIdentifierForLookup(
      trackingId,
      'Tracking identifier',
    );

    const collision = Object.values(state.packages).find(
      (storedPackage) => {
        if (!isObject(storedPackage)) {
          return false;
        }

        const documentPackage = parseDocumentPackage(storedPackage);

        return (
          documentPackage.applicationId !== null &&
          documentPackage.applicationId !== undefined &&
          normalizeIdentifierForLookup(
            documentPackage.applicationId,
            'Application identifier',
          ) === normalizedApplicationId &&
          normalizeIdentifierForLookup(
            documentPackage.trackingId,
            'Tracking identifier',
          ) !== normalizedTrackingId
        );
      },
    );

    if (collision) {
      throw createRepositoryError(
        DOCUMENT_PACKAGE_REPOSITORY_ERROR_CODES.DUPLICATE_APPLICATION,
        `A document package already exists for application identifier: ${applicationId}`,
        {
          applicationId,
          trackingId,
          existingTrackingId: collision.trackingId,
        },
      );
    }
  }

  assertExpectedVersion(currentPackage, options) {
    if (
      currentPackage &&
      options.expectedVersion !== undefined &&
      currentPackage.packageVersion !== options.expectedVersion
    ) {
      throw createRepositoryError(
        DOCUMENT_PACKAGE_REPOSITORY_ERROR_CODES.CONFLICT,
        'The document package was changed after it was last read.',
        {
          trackingId: currentPackage.trackingId,
          expectedVersion: options.expectedVersion,
          actualVersion: currentPackage.packageVersion,
        },
      );
    }
  }

  persistState(state) {
    const result = documentPackageRepositoryStateSchema.safeParse(state);

    if (!result.success) {
      throw createRepositoryError(
        DOCUMENT_PACKAGE_REPOSITORY_ERROR_CODES.PERSISTENCE_FAILED,
        'The document package repository state is invalid.',
        { issues: result.error.issues },
        result.error,
      );
    }

    if (
      !this.storageAdapter.set(
        this.storageKey,
        result.data,
        documentPackageRepositoryStateSchema,
      )
    ) {
      throw this.createPersistenceError('write');
    }
  }

  createPersistenceError(operation) {
    const storageError =
      typeof this.storageAdapter.getLastError === 'function'
        ? this.storageAdapter.getLastError()
        : undefined;

    return createRepositoryError(
      DOCUMENT_PACKAGE_REPOSITORY_ERROR_CODES.PERSISTENCE_FAILED,
      `Unable to ${operation} persisted document packages.`,
      {
        operation,
        storageError: storageError ?? null,
      },
      storageError,
    );
  }
}

/**
 * Creates a document package repository.
 *
 * @param {ConstructorParameters<typeof DocumentPackageRepository>[0]}
 * [options] Repository options.
 * @returns {DocumentPackageRepository} Repository instance.
 */
export function createDocumentPackageRepository(options = {}) {
  return new DocumentPackageRepository(options);
}

export const DocumentRepository = DocumentPackageRepository;
export const createDocumentRepository = createDocumentPackageRepository;

export default DocumentPackageRepository;