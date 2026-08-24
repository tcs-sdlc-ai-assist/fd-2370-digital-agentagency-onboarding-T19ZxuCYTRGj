import { PERSISTENCE_SCHEMA_VERSION } from '../config/appConfig.js';
import { STORAGE_NAMESPACE } from '../constants/storageKeys.js';
import {
  createStorageEnvelopeSchema,
  storageEnvelopeSchema,
} from '../contracts/schemas.js';
import { toIsoTimestamp } from '../utils/dates.js';

export const STORAGE_ERROR_CODES = Object.freeze({
  UNAVAILABLE: 'STORAGE_UNAVAILABLE',
  READ_FAILED: 'STORAGE_READ_FAILED',
  WRITE_FAILED: 'STORAGE_WRITE_FAILED',
  REMOVE_FAILED: 'STORAGE_REMOVE_FAILED',
  CLEAR_FAILED: 'STORAGE_CLEAR_FAILED',
  QUOTA_EXCEEDED: 'STORAGE_QUOTA_EXCEEDED',
  INVALID_ENVELOPE: 'STORAGE_INVALID_ENVELOPE',
  VERSION_MISMATCH: 'STORAGE_VERSION_MISMATCH',
});

const QUOTA_ERROR_NAMES = new Set([
  'NS_ERROR_DOM_QUOTA_REACHED',
  'QuotaExceededError',
]);

const QUOTA_ERROR_CODES = new Set([22, 1014]);

function isStorageLike(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof value.getItem === 'function' &&
    typeof value.setItem === 'function' &&
    typeof value.removeItem === 'function' &&
    typeof value.key === 'function'
  );
}

function assertNonEmptyString(value, description) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${description} must be a non-empty string.`);
  }

  return value.trim();
}

function assertSchema(schema) {
  if (
    schema !== undefined &&
    (!schema ||
      typeof schema.parse !== 'function' ||
      typeof schema.safeParse !== 'function')
  ) {
    throw new TypeError('A valid Zod data schema is required.');
  }
}

function normalizeSchemaVersion(schemaVersion) {
  if (!Number.isInteger(schemaVersion) || schemaVersion < 1) {
    throw new RangeError(
      'The persistence schema version must be a positive integer.',
    );
  }

  return schemaVersion;
}

function normalizeOptions(options) {
  if (isStorageLike(options)) {
    return { storage: options };
  }

  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('Browser storage adapter options must be an object.');
  }

  return options;
}

function createStorageError(code, message, operation, key, cause) {
  return Object.freeze({
    name: 'BrowserStorageError',
    code,
    message,
    operation,
    key: key ?? null,
    quotaExceeded: code === STORAGE_ERROR_CODES.QUOTA_EXCEEDED,
    cause,
  });
}

/**
 * Determines whether an error represents exhausted browser storage quota.
 *
 * @param {unknown} error Error raised by the Storage API.
 * @returns {boolean} Whether the error is a quota-exceeded error.
 */
export function isStorageQuotaExceededError(error) {
  if (!error || typeof error !== 'object') {
    return false;
  }

  return (
    QUOTA_ERROR_NAMES.has(error.name) ||
    QUOTA_ERROR_CODES.has(error.code)
  );
}

/**
 * Creates a defensive, versioned adapter around the browser Storage API.
 */
export class BrowserStorageAdapter {
  /**
   * @param {{
   *   storage?: Storage,
   *   namespace?: string,
   *   schemaVersion?: number,
   *   clock?: () => Date | string | number,
   *   onError?: (error: object) => void
   * } | Storage} [options] Adapter options or a Storage implementation.
   */
  constructor(options = {}) {
    const normalizedOptions = normalizeOptions(options);

    if (
      normalizedOptions.storage !== undefined &&
      !isStorageLike(normalizedOptions.storage)
    ) {
      throw new TypeError(
        'The supplied browser storage implementation is invalid.',
      );
    }

    if (
      normalizedOptions.clock !== undefined &&
      typeof normalizedOptions.clock !== 'function'
    ) {
      throw new TypeError('The storage clock must be a function.');
    }

    if (
      normalizedOptions.onError !== undefined &&
      typeof normalizedOptions.onError !== 'function'
    ) {
      throw new TypeError('The storage error handler must be a function.');
    }

    this.storage = normalizedOptions.storage;
    this.namespace = assertNonEmptyString(
      normalizedOptions.namespace ?? STORAGE_NAMESPACE,
      'The storage namespace',
    );
    this.schemaVersion = normalizeSchemaVersion(
      normalizedOptions.schemaVersion ?? PERSISTENCE_SCHEMA_VERSION,
    );
    this.clock = normalizedOptions.clock ?? (() => new Date());
    this.onError = normalizedOptions.onError;
    this.lastError = null;
  }

  /**
   * Returns the most recent recoverable storage error.
   *
   * @returns {object | null} The latest storage error.
   */
  getLastError() {
    return this.lastError;
  }

  /**
   * Clears the recorded recoverable storage error.
   *
   * @returns {void}
   */
  clearLastError() {
    this.lastError = null;
  }

  /**
   * Reads and validates a versioned value from storage.
   *
   * Invalid or obsolete entries are removed and the fallback is returned.
   *
   * @param {string} key Storage key or namespace-relative key.
   * @param {import('zod').ZodTypeAny} [dataSchema] Payload schema.
   * @param {unknown} [fallback] Value returned when no valid entry exists.
   * @returns {unknown} Persisted payload or fallback.
   */
  get(key, dataSchema, fallback = null) {
    assertSchema(dataSchema);

    const resolvedKey = this.resolveKey(key);
    const storage = this.getStorage('read', resolvedKey);

    if (!storage) {
      return fallback;
    }

    let serializedEnvelope;

    try {
      serializedEnvelope = storage.getItem(resolvedKey);
    } catch (error) {
      this.reportError(
        STORAGE_ERROR_CODES.READ_FAILED,
        'Unable to read browser storage.',
        'read',
        resolvedKey,
        error,
      );
      return fallback;
    }

    if (serializedEnvelope === null) {
      return fallback;
    }

    let parsedValue;

    try {
      parsedValue = JSON.parse(serializedEnvelope);
    } catch (error) {
      this.reportError(
        STORAGE_ERROR_CODES.INVALID_ENVELOPE,
        'The persisted value is not valid JSON.',
        'read',
        resolvedKey,
        error,
      );
      this.removeInvalidEntry(storage, resolvedKey);
      return fallback;
    }

    const envelopeResult = storageEnvelopeSchema.safeParse(parsedValue);

    if (!envelopeResult.success) {
      this.reportError(
        STORAGE_ERROR_CODES.INVALID_ENVELOPE,
        'The persisted value does not contain a valid storage envelope.',
        'read',
        resolvedKey,
        envelopeResult.error,
      );
      this.removeInvalidEntry(storage, resolvedKey);
      return fallback;
    }

    if (envelopeResult.data.schemaVersion !== this.schemaVersion) {
      this.reportError(
        STORAGE_ERROR_CODES.VERSION_MISMATCH,
        'The persisted value uses an unsupported schema version.',
        'read',
        resolvedKey,
      );
      this.removeInvalidEntry(storage, resolvedKey);
      return fallback;
    }

    if (dataSchema === undefined) {
      return envelopeResult.data.data;
    }

    const payloadResult = dataSchema.safeParse(envelopeResult.data.data);

    if (!payloadResult.success) {
      this.reportError(
        STORAGE_ERROR_CODES.INVALID_ENVELOPE,
        'The persisted payload does not satisfy its runtime contract.',
        'read',
        resolvedKey,
        payloadResult.error,
      );
      this.removeInvalidEntry(storage, resolvedKey);
      return fallback;
    }

    return payloadResult.data;
  }

  /**
   * Reads a complete validated storage envelope.
   *
   * @param {string} key Storage key or namespace-relative key.
   * @param {import('zod').ZodTypeAny} [dataSchema] Payload schema.
   * @returns {{schemaVersion: number, savedAt: string, data: unknown} | null}
   * Valid envelope, when present.
   */
  getEnvelope(key, dataSchema) {
    assertSchema(dataSchema);

    const resolvedKey = this.resolveKey(key);
    const storage = this.getStorage('read', resolvedKey);

    if (!storage) {
      return null;
    }

    let serializedEnvelope;

    try {
      serializedEnvelope = storage.getItem(resolvedKey);
    } catch (error) {
      this.reportError(
        STORAGE_ERROR_CODES.READ_FAILED,
        'Unable to read browser storage.',
        'read',
        resolvedKey,
        error,
      );
      return null;
    }

    if (serializedEnvelope === null) {
      return null;
    }

    try {
      const parsedValue = JSON.parse(serializedEnvelope);
      const schema =
        dataSchema === undefined
          ? storageEnvelopeSchema
          : createStorageEnvelopeSchema(dataSchema);
      const result = schema.safeParse(parsedValue);

      if (
        !result.success ||
        result.data.schemaVersion !== this.schemaVersion
      ) {
        this.reportError(
          result.success
            ? STORAGE_ERROR_CODES.VERSION_MISMATCH
            : STORAGE_ERROR_CODES.INVALID_ENVELOPE,
          result.success
            ? 'The persisted value uses an unsupported schema version.'
            : 'The persisted value does not contain a valid storage envelope.',
          'read',
          resolvedKey,
          result.success ? undefined : result.error,
        );
        this.removeInvalidEntry(storage, resolvedKey);
        return null;
      }

      return result.data;
    } catch (error) {
      this.reportError(
        STORAGE_ERROR_CODES.INVALID_ENVELOPE,
        'The persisted value is not valid JSON.',
        'read',
        resolvedKey,
        error,
      );
      this.removeInvalidEntry(storage, resolvedKey);
      return null;
    }
  }

  /**
   * Validates and writes a versioned payload to storage.
   *
   * @param {string} key Storage key or namespace-relative key.
   * @param {unknown} data Payload to persist.
   * @param {import('zod').ZodTypeAny} [dataSchema] Payload schema.
   * @returns {boolean} Whether the write succeeded.
   */
  set(key, data, dataSchema) {
    assertSchema(dataSchema);

    const resolvedKey = this.resolveKey(key);
    const storage = this.getStorage('write', resolvedKey);

    if (!storage) {
      return false;
    }

    let parsedData = data;

    if (dataSchema !== undefined) {
      const dataResult = dataSchema.safeParse(data);

      if (!dataResult.success) {
        this.reportError(
          STORAGE_ERROR_CODES.INVALID_ENVELOPE,
          'The payload does not satisfy its runtime contract.',
          'write',
          resolvedKey,
          dataResult.error,
        );
        return false;
      }

      parsedData = dataResult.data;
    }

    let envelope;
    let serializedEnvelope;

    try {
      envelope = storageEnvelopeSchema.parse({
        schemaVersion: this.schemaVersion,
        savedAt: toIsoTimestamp(this.clock()),
        data: parsedData,
      });
      serializedEnvelope = JSON.stringify(envelope);

      if (serializedEnvelope === undefined) {
        throw new TypeError('The storage envelope cannot be serialized.');
      }
    } catch (error) {
      this.reportError(
        STORAGE_ERROR_CODES.INVALID_ENVELOPE,
        'Unable to create a valid storage envelope.',
        'write',
        resolvedKey,
        error,
      );
      return false;
    }

    try {
      storage.setItem(resolvedKey, serializedEnvelope);
      this.clearLastError();
      return true;
    } catch (error) {
      const quotaExceeded = isStorageQuotaExceededError(error);

      this.reportError(
        quotaExceeded
          ? STORAGE_ERROR_CODES.QUOTA_EXCEEDED
          : STORAGE_ERROR_CODES.WRITE_FAILED,
        quotaExceeded
          ? 'Browser storage quota was exceeded.'
          : 'Unable to write browser storage.',
        'write',
        resolvedKey,
        error,
      );
      return false;
    }
  }

  /**
   * Removes an entry from storage.
   *
   * @param {string} key Storage key or namespace-relative key.
   * @returns {boolean} Whether the removal succeeded.
   */
  remove(key) {
    const resolvedKey = this.resolveKey(key);
    const storage = this.getStorage('remove', resolvedKey);

    if (!storage) {
      return false;
    }

    try {
      storage.removeItem(resolvedKey);
      this.clearLastError();
      return true;
    } catch (error) {
      this.reportError(
        STORAGE_ERROR_CODES.REMOVE_FAILED,
        'Unable to remove the browser storage entry.',
        'remove',
        resolvedKey,
        error,
      );
      return false;
    }
  }

  /**
   * Removes all entries belonging to a namespace.
   *
   * @param {string} [namespace] Namespace to clear.
   * @returns {number} Number of entries removed.
   */
  clearNamespace(namespace = this.namespace) {
    const normalizedNamespace = assertNonEmptyString(
      namespace,
      'The storage namespace',
    );
    const storage = this.getStorage('clear');

    if (!storage) {
      return 0;
    }

    const prefix = `${normalizedNamespace}:`;
    const matchingKeys = [];

    try {
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);

        if (key === normalizedNamespace || key?.startsWith(prefix)) {
          matchingKeys.push(key);
        }
      }

      matchingKeys.forEach((key) => {
        storage.removeItem(key);
      });

      this.clearLastError();
      return matchingKeys.length;
    } catch (error) {
      this.reportError(
        STORAGE_ERROR_CODES.CLEAR_FAILED,
        'Unable to clear the browser storage namespace.',
        'clear',
        normalizedNamespace,
        error,
      );
      return 0;
    }
  }

  /**
   * Alias for get, compatible with storage-oriented consumers.
   *
   * @param {string} key Storage key.
   * @param {import('zod').ZodTypeAny} [dataSchema] Payload schema.
   * @param {unknown} [fallback] Missing-value fallback.
   * @returns {unknown} Persisted payload or fallback.
   */
  getItem(key, dataSchema, fallback = null) {
    return this.get(key, dataSchema, fallback);
  }

  /**
   * Alias for set, compatible with storage-oriented consumers.
   *
   * @param {string} key Storage key.
   * @param {unknown} data Payload to persist.
   * @param {import('zod').ZodTypeAny} [dataSchema] Payload schema.
   * @returns {boolean} Whether the write succeeded.
   */
  setItem(key, data, dataSchema) {
    return this.set(key, data, dataSchema);
  }

  /**
   * Alias for remove, compatible with storage-oriented consumers.
   *
   * @param {string} key Storage key.
   * @returns {boolean} Whether the removal succeeded.
   */
  removeItem(key) {
    return this.remove(key);
  }

  resolveKey(key) {
    const normalizedKey = assertNonEmptyString(key, 'The storage key');

    if (
      normalizedKey === this.namespace ||
      normalizedKey.startsWith(`${this.namespace}:`)
    ) {
      return normalizedKey;
    }

    return `${this.namespace}:${normalizedKey}`;
  }

  getStorage(operation, key) {
    if (this.storage) {
      return this.storage;
    }

    try {
      const browserStorage = globalThis.localStorage;

      if (!isStorageLike(browserStorage)) {
        throw new TypeError(
          'The browser does not provide a valid localStorage implementation.',
        );
      }

      return browserStorage;
    } catch (error) {
      this.reportError(
        STORAGE_ERROR_CODES.UNAVAILABLE,
        'Browser localStorage is unavailable.',
        operation,
        key,
        error,
      );
      return null;
    }
  }

  removeInvalidEntry(storage, key) {
    try {
      storage.removeItem(key);
    } catch (error) {
      this.reportError(
        STORAGE_ERROR_CODES.REMOVE_FAILED,
        'Unable to remove an invalid browser storage entry.',
        'remove',
        key,
        error,
      );
    }
  }

  reportError(code, message, operation, key, cause) {
    const storageError = createStorageError(
      code,
      message,
      operation,
      key,
      cause,
    );

    this.lastError = storageError;

    if (this.onError) {
      try {
        this.onError(storageError);
      } catch {
        return storageError;
      }
    }

    return storageError;
  }
}

/**
 * Creates a browser storage adapter.
 *
 * @param {ConstructorParameters<typeof BrowserStorageAdapter>[0]} [options]
 * Adapter options.
 * @returns {BrowserStorageAdapter} Browser storage adapter.
 */
export function createBrowserStorageAdapter(options = {}) {
  return new BrowserStorageAdapter(options);
}

export default BrowserStorageAdapter;