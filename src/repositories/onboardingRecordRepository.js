import { z } from 'zod';
import {
  ONBOARDING_STATUSES,
  WORKFLOW_STAGES,
} from '../constants/domain.js';
import { STORAGE_KEYS } from '../constants/storageKeys.js';
import { onboardingRecordSchema } from '../contracts/schemas.js';
import { BrowserStorageAdapter } from '../persistence/browserStorageAdapter.js';
import { getSeeds } from '../persistence/seedLoader.js';
import { toIsoTimestamp } from '../utils/dates.js';

const identifierSchema = z.string().trim().min(1);

export const onboardingRepositoryStateSchema = z
  .object({
    overlays: z.record(z.unknown()).default({}),
    removedApplicationIds: z.array(identifierSchema).default([]),
  })
  .passthrough();

export const ONBOARDING_REPOSITORY_ERROR_CODES = Object.freeze({
  INVALID_RECORD: 'ONBOARDING_RECORD_INVALID',
  NOT_FOUND: 'ONBOARDING_RECORD_NOT_FOUND',
  DUPLICATE_IDENTIFIER: 'ONBOARDING_DUPLICATE_IDENTIFIER',
  IDENTIFIER_CHANGE: 'ONBOARDING_IDENTIFIER_CHANGE',
  CONFLICT: 'ONBOARDING_UPDATE_CONFLICT',
  PERSISTENCE_FAILED: 'ONBOARDING_PERSISTENCE_FAILED',
});

const CANONICAL_IDENTIFIER_FIELDS = Object.freeze([
  'id',
  'applicationId',
  'trackingId',
]);

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

function assertOptions(options) {
  if (!isObject(options)) {
    throw new TypeError('Onboarding repository options must be an object.');
  }

  return options;
}

function normalizeIdentifier(identifier, description = 'Record identifier') {
  if (
    identifier === null ||
    identifier === undefined ||
    String(identifier).trim() === ''
  ) {
    throw new TypeError(`${description} must be a non-empty value.`);
  }

  return String(identifier).trim();
}

function normalizeIdentifierForLookup(identifier) {
  return normalizeIdentifier(identifier).normalize('NFKC').toLowerCase();
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
    if (
      isObject(value) &&
      isObject(mergedValue[key])
    ) {
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
      const path = issue.path.length > 0 ? issue.path.join('.') : 'record';

      return `${path}: ${issue.message}`;
    })
    .join('; ');
}

function createRepositoryError(code, message, details, cause) {
  const error = new Error(message, {
    ...(cause === undefined ? {} : { cause }),
  });

  error.name = 'OnboardingRecordRepositoryError';
  error.code = code;
  error.details = details ?? null;

  return error;
}

function parseRecord(record) {
  const result = onboardingRecordSchema.safeParse(record);

  if (!result.success) {
    throw createRepositoryError(
      ONBOARDING_REPOSITORY_ERROR_CODES.INVALID_RECORD,
      `Invalid onboarding record: ${formatValidationIssues(result.error)}`,
      { issues: result.error.issues },
      result.error,
    );
  }

  return result.data;
}

function validateSeedRecords(seedRecords) {
  if (!Array.isArray(seedRecords)) {
    throw new TypeError('Onboarding seed records must be an array.');
  }

  return seedRecords.map((record) => parseRecord(record));
}

function createEmptyState() {
  return {
    overlays: {},
    removedApplicationIds: [],
  };
}

function createIdentifierIndex(records) {
  const index = new Map();

  records.forEach((record) => {
    CANONICAL_IDENTIFIER_FIELDS.forEach((field) => {
      const value = normalizeIdentifierForLookup(record[field]);
      const existingRecord = index.get(value);

      if (
        existingRecord &&
        existingRecord.applicationId !== record.applicationId
      ) {
        throw createRepositoryError(
          ONBOARDING_REPOSITORY_ERROR_CODES.DUPLICATE_IDENTIFIER,
          `Duplicate onboarding identifier: ${record[field]}`,
          {
            field,
            identifier: record[field],
            applicationIds: [
              existingRecord.applicationId,
              record.applicationId,
            ],
          },
        );
      }

      index.set(value, record);
    });
  });

  return index;
}

function assertUniqueIdentifiers(records) {
  createIdentifierIndex(records);
}

function normalizeQuery(query) {
  if (query === undefined) {
    return {};
  }

  if (!isObject(query)) {
    throw new TypeError('Onboarding query options must be an object.');
  }

  const normalizedQuery = { ...query };

  if (
    normalizedQuery.limit !== undefined &&
    (!Number.isInteger(normalizedQuery.limit) || normalizedQuery.limit < 1)
  ) {
    throw new RangeError('Onboarding query limit must be a positive integer.');
  }

  if (
    normalizedQuery.offset !== undefined &&
    (!Number.isInteger(normalizedQuery.offset) || normalizedQuery.offset < 0)
  ) {
    throw new RangeError(
      'Onboarding query offset must be a nonnegative integer.',
    );
  }

  return normalizedQuery;
}

function matchesQuery(record, query) {
  if (
    query.partnerCode !== undefined &&
    record.partnerCode !== query.partnerCode
  ) {
    return false;
  }

  if (query.status !== undefined && record.status !== query.status) {
    return false;
  }

  if (
    query.workflowStage !== undefined &&
    record.workflowStage !== query.workflowStage
  ) {
    return false;
  }

  if (
    query.assignedTo !== undefined &&
    record.assignment?.assigneeUserId !== query.assignedTo
  ) {
    return false;
  }

  if (
    query.includeCompleted === false &&
    record.status === ONBOARDING_STATUSES.COMPLETED
  ) {
    return false;
  }

  return true;
}

function assertCanonicalIdentifiersUnchanged(currentRecord, nextRecord) {
  CANONICAL_IDENTIFIER_FIELDS.forEach((field) => {
    if (currentRecord[field] !== nextRecord[field]) {
      throw createRepositoryError(
        ONBOARDING_REPOSITORY_ERROR_CODES.IDENTIFIER_CHANGE,
        `The canonical onboarding identifier "${field}" cannot be changed.`,
        {
          field,
          currentValue: currentRecord[field],
          requestedValue: nextRecord[field],
        },
      );
    }
  });
}

function resolveStorageAdapter(options) {
  if (options.storageAdapter !== undefined) {
    if (!isRepositoryStorageAdapter(options.storageAdapter)) {
      throw new TypeError(
        'The onboarding storage adapter must provide get, set, and remove methods.',
      );
    }

    return options.storageAdapter;
  }

  if (
    options.storage !== undefined &&
    !isStorageLike(options.storage)
  ) {
    throw new TypeError(
      'The supplied onboarding storage implementation is invalid.',
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
 * Repository for seeded and locally persisted onboarding records.
 */
export class OnboardingRecordRepository {
  /**
   * @param {{
   *   seedRecords?: object[],
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
      throw new TypeError('The onboarding repository clock must be a function.');
    }

    this.seedRecords = validateSeedRecords(
      normalizedOptions.seedRecords ?? getSeeds().onboardingRecords,
    );
    assertUniqueIdentifiers(this.seedRecords);

    this.storageAdapter = resolveStorageAdapter(normalizedOptions);
    this.storageKey = normalizeIdentifier(
      normalizedOptions.storageKey ?? STORAGE_KEYS.ONBOARDING,
      'Onboarding repository storage key',
    );
    this.clock = normalizedOptions.clock ?? (() => new Date());
  }

  /**
   * Returns all records after applying persisted overlays.
   *
   * @param {{
   *   partnerCode?: string,
   *   status?: string,
   *   workflowStage?: string,
   *   assignedTo?: string,
   *   includeCompleted?: boolean,
   *   limit?: number,
   *   offset?: number
   * }} [query] Query filters.
   * @returns {object[]} Matching onboarding records.
   */
  list(query = {}) {
    const normalizedQuery = normalizeQuery(query);
    const offset = normalizedQuery.offset ?? 0;
    const limit = normalizedQuery.limit ?? Number.POSITIVE_INFINITY;
    const records = this.readRecords().filter((record) =>
      matchesQuery(record, normalizedQuery),
    );

    return records
      .slice(offset, offset + limit)
      .map((record) => cloneValue(record));
  }

  /**
   * Alias for list.
   *
   * @param {object} [query] Query filters.
   * @returns {object[]} Matching onboarding records.
   */
  getAll(query = {}) {
    return this.list(query);
  }

  /**
   * Returns a record by any canonical identifier.
   *
   * @param {string | number} identifier Canonical identifier.
   * @returns {object | undefined} Matching record.
   */
  find(identifier) {
    const record = this.findInternalRecord(this.readRecords(), identifier);

    return record ? cloneValue(record) : undefined;
  }

  /**
   * Alias for find.
   *
   * @param {string | number} identifier Canonical identifier.
   * @returns {object | undefined} Matching record.
   */
  findById(identifier) {
    return this.find(identifier);
  }

  /**
   * Returns a record by application identifier.
   *
   * @param {string | number} applicationId Application identifier.
   * @returns {object | undefined} Matching record.
   */
  findByApplicationId(applicationId) {
    return this.findByField('applicationId', applicationId);
  }

  /**
   * Returns a record by tracking identifier.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @returns {object | undefined} Matching record.
   */
  findByTrackingId(trackingId) {
    return this.findByField('trackingId', trackingId);
  }

  /**
   * Returns a record by its internal record identifier.
   *
   * @param {string | number} id Record identifier.
   * @returns {object | undefined} Matching record.
   */
  findByRecordId(id) {
    return this.findByField('id', id);
  }

  /**
   * Returns a record by any canonical identifier or throws when absent.
   *
   * @param {string | number} identifier Canonical identifier.
   * @returns {object} Matching record.
   */
  get(identifier) {
    const record = this.find(identifier);

    if (!record) {
      throw createRepositoryError(
        ONBOARDING_REPOSITORY_ERROR_CODES.NOT_FOUND,
        `Onboarding record not found: ${identifier}`,
        { identifier: String(identifier) },
      );
    }

    return record;
  }

  /**
   * Alias for get.
   *
   * @param {string | number} identifier Canonical identifier.
   * @returns {object} Matching record.
   */
  getById(identifier) {
    return this.get(identifier);
  }

  /**
   * Persists a complete onboarding record.
   *
   * Existing records are replaced while new records are added as overlays.
   *
   * @param {object} record Complete onboarding record.
   * @returns {object} Persisted record.
   */
  save(record) {
    const parsedRecord = parseRecord(record);
    const state = this.readState();
    const records = this.buildRecords(state);
    const existingRecord = this.findInternalRecord(
      records,
      parsedRecord.applicationId,
    );

    if (existingRecord) {
      assertCanonicalIdentifiersUnchanged(existingRecord, parsedRecord);
    }

    const nextRecords = existingRecord
      ? records.map((currentRecord) =>
          currentRecord.applicationId === parsedRecord.applicationId
            ? parsedRecord
            : currentRecord,
        )
      : [...records, parsedRecord];

    assertUniqueIdentifiers(nextRecords);

    const nextState = cloneValue(state);

    nextState.overlays[parsedRecord.applicationId] = cloneValue(parsedRecord);
    nextState.removedApplicationIds =
      nextState.removedApplicationIds.filter(
        (applicationId) =>
          applicationId !== parsedRecord.applicationId,
      );

    this.persistState(nextState);
    return cloneValue(parsedRecord);
  }

  /**
   * Alias for save.
   *
   * @param {object} record Complete onboarding record.
   * @returns {object} Persisted record.
   */
  upsert(record) {
    return this.save(record);
  }

  /**
   * Creates a record and rejects canonical identifier collisions.
   *
   * @param {object} record Complete onboarding record.
   * @returns {object} Persisted record.
   */
  create(record) {
    const parsedRecord = parseRecord(record);
    const records = this.readRecords();
    const index = createIdentifierIndex(records);
    const collision = CANONICAL_IDENTIFIER_FIELDS.find((field) =>
      index.has(normalizeIdentifierForLookup(parsedRecord[field])),
    );

    if (collision) {
      throw createRepositoryError(
        ONBOARDING_REPOSITORY_ERROR_CODES.DUPLICATE_IDENTIFIER,
        `An onboarding record already uses ${collision}: ${parsedRecord[collision]}`,
        {
          field: collision,
          identifier: parsedRecord[collision],
        },
      );
    }

    return this.save(parsedRecord);
  }

  /**
   * Atomically applies a patch or updater to an existing record.
   *
   * The complete next state is validated before browser storage is changed.
   *
   * @param {string | number} identifier Canonical identifier.
   * @param {object | ((record: object) => object)} update Patch or updater.
   * @param {{
   *   expectedUpdatedAt?: string,
   *   touchUpdatedAt?: boolean
   * }} [options] Update options.
   * @returns {object} Updated record.
   */
  update(identifier, update, options = {}) {
    if (!isObject(options)) {
      throw new TypeError('Onboarding update options must be an object.');
    }

    if (typeof update !== 'function' && !isObject(update)) {
      throw new TypeError(
        'An onboarding update must be an object or updater function.',
      );
    }

    const state = this.readState();
    const records = this.buildRecords(state);
    const currentRecord = this.findInternalRecord(records, identifier);

    if (!currentRecord) {
      throw createRepositoryError(
        ONBOARDING_REPOSITORY_ERROR_CODES.NOT_FOUND,
        `Onboarding record not found: ${identifier}`,
        { identifier: String(identifier) },
      );
    }

    if (
      options.expectedUpdatedAt !== undefined &&
      currentRecord.updatedAt !== options.expectedUpdatedAt
    ) {
      throw createRepositoryError(
        ONBOARDING_REPOSITORY_ERROR_CODES.CONFLICT,
        'The onboarding record was changed after it was last read.',
        {
          applicationId: currentRecord.applicationId,
          expectedUpdatedAt: options.expectedUpdatedAt,
          actualUpdatedAt: currentRecord.updatedAt,
        },
      );
    }

    const updateValue =
      typeof update === 'function'
        ? update(cloneValue(currentRecord))
        : update;

    if (!isObject(updateValue)) {
      throw new TypeError(
        'The onboarding updater must return a record or patch object.',
      );
    }

    let nextRecord = deepMerge(currentRecord, updateValue);

    if (options.touchUpdatedAt !== false) {
      nextRecord = {
        ...nextRecord,
        updatedAt: toIsoTimestamp(this.clock()),
      };
    }

    nextRecord = parseRecord(nextRecord);
    assertCanonicalIdentifiersUnchanged(currentRecord, nextRecord);

    const nextRecords = records.map((record) =>
      record.applicationId === currentRecord.applicationId
        ? nextRecord
        : record,
    );

    assertUniqueIdentifiers(nextRecords);

    const nextState = cloneValue(state);

    nextState.overlays[currentRecord.applicationId] =
      cloneValue(nextRecord);
    nextState.removedApplicationIds =
      nextState.removedApplicationIds.filter(
        (applicationId) =>
          applicationId !== currentRecord.applicationId,
      );

    this.persistState(nextState);
    return cloneValue(nextRecord);
  }

  /**
   * Alias for update emphasizing transactional behavior.
   *
   * @param {string | number} identifier Canonical identifier.
   * @param {object | ((record: object) => object)} update Patch or updater.
   * @param {object} [options] Update options.
   * @returns {object} Updated record.
   */
  atomicUpdate(identifier, update, options = {}) {
    return this.update(identifier, update, options);
  }

  /**
   * Marks an onboarding application as submitted.
   *
   * @param {string | number} identifier Canonical identifier.
   * @param {{
   *   submittedBy?: string,
   *   expectedUpdatedAt?: string
   * }} [options] Submission options.
   * @returns {object} Submitted record.
   */
  submit(identifier, options = {}) {
    if (!isObject(options)) {
      throw new TypeError('Onboarding submission options must be an object.');
    }

    const submittedAt = toIsoTimestamp(this.clock());

    return this.update(
      identifier,
      {
        status: ONBOARDING_STATUSES.SUBMITTED,
        workflowStage: WORKFLOW_STAGES.APPLICATION_SUBMITTED,
        submittedAt,
        ...(options.submittedBy === undefined
          ? {}
          : { submittedBy: normalizeIdentifier(options.submittedBy) }),
      },
      {
        expectedUpdatedAt: options.expectedUpdatedAt,
        touchUpdatedAt: true,
      },
    );
  }

  /**
   * Removes a record, retaining a tombstone for seeded applications.
   *
   * @param {string | number} identifier Canonical identifier.
   * @returns {boolean} Whether a record was removed.
   */
  remove(identifier) {
    const state = this.readState();
    const records = this.buildRecords(state);
    const record = this.findInternalRecord(records, identifier);

    if (!record) {
      return false;
    }

    const nextState = cloneValue(state);
    const isSeedRecord = this.seedRecords.some(
      (seedRecord) =>
        seedRecord.applicationId === record.applicationId,
    );

    delete nextState.overlays[record.applicationId];

    if (
      isSeedRecord &&
      !nextState.removedApplicationIds.includes(record.applicationId)
    ) {
      nextState.removedApplicationIds.push(record.applicationId);
    }

    this.persistState(nextState);
    return true;
  }

  /**
   * Alias for remove.
   *
   * @param {string | number} identifier Canonical identifier.
   * @returns {boolean} Whether a record was removed.
   */
  delete(identifier) {
    return this.remove(identifier);
  }

  /**
   * Removes all persisted overlays and returns the seeded records.
   *
   * @returns {object[]} Seeded onboarding records.
   */
  reset() {
    const removed = this.storageAdapter.remove(this.storageKey);

    if (!removed) {
      throw this.createPersistenceError('reset');
    }

    return this.seedRecords.map((record) => cloneValue(record));
  }

  readState() {
    const state = this.storageAdapter.get(
      this.storageKey,
      onboardingRepositoryStateSchema,
      createEmptyState(),
    );

    return cloneValue(state);
  }

  buildRecords(state) {
    const removedApplicationIds = new Set(state.removedApplicationIds);
    const recordsByApplicationId = new Map();

    this.seedRecords.forEach((seedRecord) => {
      if (!removedApplicationIds.has(seedRecord.applicationId)) {
        recordsByApplicationId.set(
          seedRecord.applicationId,
          cloneValue(seedRecord),
        );
      }
    });

    Object.entries(state.overlays).forEach(
      ([applicationId, overlay]) => {
        if (removedApplicationIds.has(applicationId)) {
          return;
        }

        if (!isObject(overlay)) {
          throw createRepositoryError(
            ONBOARDING_REPOSITORY_ERROR_CODES.INVALID_RECORD,
            `Invalid persisted onboarding overlay: ${applicationId}`,
            { applicationId },
          );
        }

        const existingRecord = recordsByApplicationId.get(applicationId);
        const mergedRecord = existingRecord
          ? deepMerge(existingRecord, overlay)
          : cloneValue(overlay);
        const parsedRecord = parseRecord(mergedRecord);

        if (parsedRecord.applicationId !== applicationId) {
          throw createRepositoryError(
            ONBOARDING_REPOSITORY_ERROR_CODES.INVALID_RECORD,
            'A persisted onboarding overlay has a mismatched application identifier.',
            {
              overlayKey: applicationId,
              applicationId: parsedRecord.applicationId,
            },
          );
        }

        recordsByApplicationId.set(applicationId, parsedRecord);
      },
    );

    const records = [...recordsByApplicationId.values()];

    assertUniqueIdentifiers(records);
    return records;
  }

  readRecords() {
    try {
      return this.buildRecords(this.readState());
    } catch (error) {
      this.storageAdapter.remove(this.storageKey);
      return this.seedRecords.map((record) => cloneValue(record));
    }
  }

  findInternalRecord(records, identifier) {
    const normalizedIdentifier = normalizeIdentifierForLookup(identifier);

    return createIdentifierIndex(records).get(normalizedIdentifier);
  }

  findByField(field, identifier) {
    const normalizedIdentifier = normalizeIdentifierForLookup(identifier);
    const record = this.readRecords().find(
      (candidate) =>
        normalizeIdentifierForLookup(candidate[field]) ===
        normalizedIdentifier,
    );

    return record ? cloneValue(record) : undefined;
  }

  persistState(state) {
    const result = onboardingRepositoryStateSchema.safeParse(state);

    if (!result.success) {
      throw createRepositoryError(
        ONBOARDING_REPOSITORY_ERROR_CODES.PERSISTENCE_FAILED,
        'The onboarding repository state is invalid.',
        { issues: result.error.issues },
        result.error,
      );
    }

    if (
      !this.storageAdapter.set(
        this.storageKey,
        result.data,
        onboardingRepositoryStateSchema,
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
      ONBOARDING_REPOSITORY_ERROR_CODES.PERSISTENCE_FAILED,
      `Unable to ${operation} persisted onboarding records.`,
      {
        operation,
        storageError: storageError ?? null,
      },
      storageError,
    );
  }
}

export const OnboardingApplicationRepository =
  OnboardingRecordRepository;

/**
 * Creates an onboarding record repository.
 *
 * @param {ConstructorParameters<typeof OnboardingRecordRepository>[0]}
 * [options] Repository options.
 * @returns {OnboardingRecordRepository} Repository instance.
 */
export function createOnboardingRecordRepository(options = {}) {
  return new OnboardingRecordRepository(options);
}

/**
 * Creates an onboarding application repository.
 *
 * @param {ConstructorParameters<typeof OnboardingRecordRepository>[0]}
 * [options] Repository options.
 * @returns {OnboardingRecordRepository} Repository instance.
 */
export function createOnboardingApplicationRepository(options = {}) {
  return new OnboardingRecordRepository(options);
}

export default OnboardingRecordRepository;