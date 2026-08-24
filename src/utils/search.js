const DEFAULT_IDENTIFIER_FIELDS = Object.freeze([
  'id',
  'applicationId',
  'trackingId',
  'workItemId',
  'userId',
  'notificationId',
  'syncAttemptId',
  'changeRequestId',
  'lifecycleEventId',
  'auditEventId',
]);

const SEARCH_INDEX_TYPE = 'normalized-search-index';

function assertRecords(records) {
  if (!Array.isArray(records)) {
    throw new TypeError('Search records must be an array.');
  }
}

function normalizeFieldSelectors(fields, defaultFields) {
  const selectors = fields ?? defaultFields;

  if (
    typeof selectors === 'string' ||
    typeof selectors === 'function'
  ) {
    return [selectors];
  }

  if (!Array.isArray(selectors)) {
    throw new TypeError(
      'Search fields must be a field name, accessor, or array.',
    );
  }

  if (
    selectors.some(
      (selector) =>
        (typeof selector !== 'string' ||
          selector.trim() === '') &&
        typeof selector !== 'function',
    )
  ) {
    throw new TypeError(
      'Search fields must contain non-empty field names or accessors.',
    );
  }

  return selectors;
}

function getValueAtPath(record, path) {
  return path.split('.').reduce((value, pathSegment) => {
    if (value === null || value === undefined) {
      return undefined;
    }

    return value[pathSegment];
  }, record);
}

function readFieldValue(record, selector) {
  if (typeof selector === 'function') {
    return selector(record);
  }

  return getValueAtPath(record, selector);
}

function collectSearchValues(value, values, ancestors) {
  if (value === null || value === undefined) {
    return;
  }

  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'bigint' ||
    typeof value === 'boolean'
  ) {
    values.push(String(value));
    return;
  }

  if (value instanceof Date) {
    if (!Number.isNaN(value.getTime())) {
      values.push(value.toISOString());
    }

    return;
  }

  if (typeof value !== 'object') {
    return;
  }

  if (ancestors.has(value)) {
    return;
  }

  ancestors.add(value);

  if (Array.isArray(value)) {
    value.forEach((item) => {
      collectSearchValues(item, values, ancestors);
    });
  } else {
    Object.values(value).forEach((fieldValue) => {
      collectSearchValues(fieldValue, values, ancestors);
    });
  }

  ancestors.delete(value);
}

function getRecordSearchValues(record, fieldSelectors) {
  const values = [];
  const ancestors = new WeakSet();

  if (fieldSelectors === undefined) {
    collectSearchValues(record, values, ancestors);
    return values;
  }

  fieldSelectors.forEach((selector) => {
    collectSearchValues(
      readFieldValue(record, selector),
      values,
      ancestors,
    );
  });

  return values;
}

function isSearchIndex(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    value.type === SEARCH_INDEX_TYPE &&
    Array.isArray(value.entries) &&
    value.identifierIndex instanceof Map
  );
}

function normalizeSearchLimit(limit) {
  if (limit === undefined) {
    return Number.POSITIVE_INFINITY;
  }

  if (!Number.isInteger(limit) || limit < 0) {
    throw new RangeError('Search result limit must be a nonnegative integer.');
  }

  return limit;
}

/**
 * Normalizes an identifier for case-insensitive exact matching.
 *
 * Identifier punctuation is preserved so distinct identifier formats do not
 * collapse into the same index key.
 *
 * @param {unknown} value Identifier value.
 * @returns {string} Normalized identifier, or an empty string when missing.
 */
export function normalizeIdentifier(value) {
  if (value === null || value === undefined) {
    return '';
  }

  if (
    typeof value !== 'string' &&
    typeof value !== 'number' &&
    typeof value !== 'bigint'
  ) {
    throw new TypeError(
      'Identifiers must be strings, numbers, or big integers.',
    );
  }

  return String(value).normalize('NFKC').trim().toLowerCase();
}

/**
 * Normalizes text for case-insensitive token matching.
 *
 * @param {unknown} value Text value.
 * @returns {string} Lowercase, accent-insensitive search text.
 */
export function normalizeSearchText(value) {
  if (value === null || value === undefined) {
    return '';
  }

  return String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Converts a search query into unique normalized tokens.
 *
 * @param {unknown} query Search query.
 * @returns {string[]} Normalized query tokens.
 */
export function tokenizeSearchQuery(query) {
  const normalizedQuery = normalizeSearchText(query);

  if (normalizedQuery === '') {
    return [];
  }

  return [...new Set(normalizedQuery.split(' '))];
}

/**
 * Builds normalized searchable text for a record.
 *
 * When fields are omitted, all primitive leaf values are included.
 *
 * @param {unknown} record Record to index.
 * @param {Array<string | ((record: unknown) => unknown)>} [fields]
 * Search field names, nested paths, or accessors.
 * @returns {string} Normalized search document.
 */
export function buildSearchDocument(record, fields) {
  const selectors =
    fields === undefined
      ? undefined
      : normalizeFieldSelectors(fields, undefined);
  const values = getRecordSearchValues(record, selectors);

  return normalizeSearchText(values.join(' '));
}

/**
 * Creates a normalized exact identifier index.
 *
 * If multiple records contain the same normalized identifier, the first
 * record is retained to keep lookups deterministic.
 *
 * @param {unknown[]} records Records to index.
 * @param {string | ((record: unknown) => unknown) | Array<string | ((record: unknown) => unknown)>} [identifierFields]
 * Identifier field names, nested paths, or accessors.
 * @returns {Map<string, unknown>} Identifier-to-record index.
 */
export function createIdentifierIndex(
  records,
  identifierFields = DEFAULT_IDENTIFIER_FIELDS,
) {
  assertRecords(records);

  const selectors = normalizeFieldSelectors(
    identifierFields,
    DEFAULT_IDENTIFIER_FIELDS,
  );
  const identifierIndex = new Map();

  records.forEach((record) => {
    selectors.forEach((selector) => {
      const value = readFieldValue(record, selector);
      const identifiers = Array.isArray(value) ? value : [value];

      identifiers.forEach((identifier) => {
        const normalizedIdentifier = normalizeIdentifier(identifier);

        if (
          normalizedIdentifier !== '' &&
          !identifierIndex.has(normalizedIdentifier)
        ) {
          identifierIndex.set(normalizedIdentifier, record);
        }
      });
    });
  });

  return identifierIndex;
}

/**
 * Finds a record by an exact normalized identifier.
 *
 * @param {Map<string, unknown> | object} index Identifier or search index.
 * @param {unknown} identifier Identifier to find.
 * @returns {unknown | undefined} Matching record, when present.
 */
export function findByIdentifier(index, identifier) {
  const identifierIndex = isSearchIndex(index)
    ? index.identifierIndex
    : index;

  if (!(identifierIndex instanceof Map)) {
    throw new TypeError('A valid identifier index is required.');
  }

  const normalizedIdentifier = normalizeIdentifier(identifier);

  if (normalizedIdentifier === '') {
    return undefined;
  }

  return identifierIndex.get(normalizedIdentifier);
}

/**
 * Determines whether a record matches every supplied search token.
 *
 * @param {unknown} record Record to evaluate.
 * @param {string[] | string} tokens Normalized tokens or a raw query.
 * @param {Array<string | ((record: unknown) => unknown)>} [fields]
 * Search field names, nested paths, or accessors.
 * @returns {boolean} Whether every token is present.
 */
export function recordMatchesSearchTokens(record, tokens, fields) {
  const normalizedTokens = Array.isArray(tokens)
    ? tokens.flatMap((token) => tokenizeSearchQuery(token))
    : tokenizeSearchQuery(tokens);
  const uniqueTokens = [...new Set(normalizedTokens)];

  if (uniqueTokens.length === 0) {
    return true;
  }

  const document = buildSearchDocument(record, fields);

  return uniqueTokens.every((token) => document.includes(token));
}

/**
 * Filters records using case-insensitive AND token matching.
 *
 * Empty queries return a shallow copy of the supplied records.
 *
 * @param {unknown[]} records Records to filter.
 * @param {unknown} query Search query.
 * @param {Array<string | ((record: unknown) => unknown)>} [fields]
 * Search field names, nested paths, or accessors.
 * @returns {unknown[]} Matching records in their original order.
 */
export function filterBySearchTokens(records, query, fields) {
  assertRecords(records);

  const tokens = tokenizeSearchQuery(query);

  if (tokens.length === 0) {
    return [...records];
  }

  return records.filter((record) =>
    recordMatchesSearchTokens(record, tokens, fields),
  );
}

/**
 * Creates a reusable search index for repeated filtering and identifier
 * lookups.
 *
 * @param {unknown[]} records Records to index.
 * @param {{
 *   identifierFields?: string | ((record: unknown) => unknown) | Array<string | ((record: unknown) => unknown)>,
 *   searchFields?: Array<string | ((record: unknown) => unknown)>
 * }} [options] Index options.
 * @returns {{
 *   type: string,
 *   records: unknown[],
 *   entries: Array<{record: unknown, document: string}>,
 *   identifierIndex: Map<string, unknown>
 * }} Search index.
 */
export function createSearchIndex(records, options = {}) {
  assertRecords(records);

  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('Search index options must be an object.');
  }

  const searchFields =
    options.searchFields === undefined
      ? undefined
      : normalizeFieldSelectors(options.searchFields, undefined);
  const indexedRecords = [...records];
  const entries = indexedRecords.map((record) =>
    Object.freeze({
      record,
      document: buildSearchDocument(record, searchFields),
    }),
  );

  return Object.freeze({
    type: SEARCH_INDEX_TYPE,
    records: Object.freeze(indexedRecords),
    entries: Object.freeze(entries),
    identifierIndex: createIdentifierIndex(
      indexedRecords,
      options.identifierFields ?? DEFAULT_IDENTIFIER_FIELDS,
    ),
  });
}

/**
 * Searches either a record array or a reusable search index.
 *
 * @param {unknown[] | object} recordsOrIndex Records or search index.
 * @param {unknown} query Search query.
 * @param {{
 *   fields?: Array<string | ((record: unknown) => unknown)>,
 *   limit?: number
 * }} [options] Search options.
 * @returns {unknown[]} Matching records.
 */
export function searchRecords(recordsOrIndex, query, options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('Search options must be an object.');
  }

  const limit = normalizeSearchLimit(options.limit);

  if (limit === 0) {
    return [];
  }

  if (!isSearchIndex(recordsOrIndex)) {
    const matches = filterBySearchTokens(
      recordsOrIndex,
      query,
      options.fields,
    );

    return matches.slice(0, limit);
  }

  const tokens = tokenizeSearchQuery(query);
  const matches = [];

  for (const entry of recordsOrIndex.entries) {
    if (
      tokens.every((token) => entry.document.includes(token))
    ) {
      matches.push(entry.record);
    }

    if (matches.length >= limit) {
      break;
    }
  }

  return matches;
}

export const createExactIdentifierIndex = createIdentifierIndex;
export const findExactIdentifier = findByIdentifier;
export const filterRecordsBySearch = filterBySearchTokens;
export const filterRecordsByTokens = filterBySearchTokens;
export const normalizeSearchQuery = normalizeSearchText;
export const tokenizeSearch = tokenizeSearchQuery;

export const SEARCH_DEFAULTS = Object.freeze({
  identifierFields: DEFAULT_IDENTIFIER_FIELDS,
});

export default Object.freeze({
  buildSearchDocument,
  createIdentifierIndex,
  createSearchIndex,
  filterBySearchTokens,
  findByIdentifier,
  normalizeIdentifier,
  normalizeSearchText,
  recordMatchesSearchTokens,
  searchRecords,
  tokenizeSearchQuery,
});