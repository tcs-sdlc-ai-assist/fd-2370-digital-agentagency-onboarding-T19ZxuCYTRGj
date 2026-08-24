import { z } from 'zod';
import { INTEGRATION_SYSTEMS } from '../constants/domain.js';
import { STORAGE_KEYS } from '../constants/storageKeys.js';
import { syncAttemptSchema } from '../contracts/schemas.js';
import { BrowserStorageAdapter } from '../persistence/browserStorageAdapter.js';
import { getSeeds } from '../persistence/seedLoader.js';
import { toIsoTimestamp } from '../utils/dates.js';
import {
  createDeterministicId,
  generateCorrelationId,
} from '../utils/ids.js';

const identifierSchema = z.string().trim().min(1);

export const SYNC_ATTEMPT_REPOSITORY_STORAGE_KEY =
  `${STORAGE_KEYS.OPERATIONS}:sync-attempts`;

export const SYNC_ATTEMPT_STATUSES = Object.freeze({
  QUEUED: 'queued',
  PENDING: 'pending',
  SUCCESS: 'success',
  FAILED: 'failed',
  SKIPPED: 'skipped',
  CANCELLED: 'cancelled',
});

export const TERMINAL_SYNC_ATTEMPT_STATUSES = Object.freeze([
  SYNC_ATTEMPT_STATUSES.SUCCESS,
  SYNC_ATTEMPT_STATUSES.FAILED,
  SYNC_ATTEMPT_STATUSES.SKIPPED,
  SYNC_ATTEMPT_STATUSES.CANCELLED,
]);

export const syncAttemptRepositoryStateSchema = z
  .object({
    overlays: z.record(z.unknown()).default({}),
    removedSyncAttemptIds: z.array(identifierSchema).default([]),
  })
  .passthrough();

export const SYNC_ATTEMPT_REPOSITORY_ERROR_CODES = Object.freeze({
  INVALID_ATTEMPT: 'SYNC_ATTEMPT_INVALID',
  NOT_FOUND: 'SYNC_ATTEMPT_NOT_FOUND',
  DUPLICATE_IDENTIFIER: 'SYNC_ATTEMPT_DUPLICATE_IDENTIFIER',
  IDENTIFIER_CHANGE: 'SYNC_ATTEMPT_IDENTIFIER_CHANGE',
  INVALID_STATUS: 'SYNC_ATTEMPT_INVALID_STATUS',
  CONFLICT: 'SYNC_ATTEMPT_UPDATE_CONFLICT',
  PERSISTENCE_FAILED: 'SYNC_ATTEMPT_PERSISTENCE_FAILED',
});

const CANONICAL_FIELDS = Object.freeze([
  'syncAttemptId',
  'trackingId',
  'system',
  'operation',
  'correlationId',
  'attemptedAt',
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

function assertOptions(options, description = 'Sync attempt options') {
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
        issue.path.length > 0 ? issue.path.join('.') : 'syncAttempt';

      return `${path}: ${issue.message}`;
    })
    .join('; ');
}

function createRepositoryError(code, message, details, cause) {
  const error = new Error(message, {
    ...(cause === undefined ? {} : { cause }),
  });

  error.name = 'SyncAttemptRepositoryError';
  error.code = code;
  error.details = details ?? null;

  return error;
}

function parseSyncAttempt(syncAttempt) {
  const result = syncAttemptSchema.safeParse(syncAttempt);

  if (!result.success) {
    throw createRepositoryError(
      SYNC_ATTEMPT_REPOSITORY_ERROR_CODES.INVALID_ATTEMPT,
      `Invalid sync attempt: ${formatValidationIssues(result.error)}`,
      { issues: result.error.issues },
      result.error,
    );
  }

  return result.data;
}

function validateSeedAttempts(seedAttempts) {
  if (!Array.isArray(seedAttempts)) {
    throw new TypeError('Sync attempt seed records must be an array.');
  }

  const parsedAttempts = seedAttempts.map((attempt) =>
    parseSyncAttempt(attempt),
  );

  assertUniqueIdentifiers(parsedAttempts);
  return parsedAttempts;
}

function createEmptyState() {
  return {
    overlays: {},
    removedSyncAttemptIds: [],
  };
}

function assertUniqueIdentifiers(attempts) {
  const identifiers = new Map();

  attempts.forEach((attempt) => {
    const normalizedIdentifier = normalizeIdentifierForLookup(
      attempt.syncAttemptId,
      'Sync attempt identifier',
    );
    const existingAttempt = identifiers.get(normalizedIdentifier);

    if (existingAttempt) {
      throw createRepositoryError(
        SYNC_ATTEMPT_REPOSITORY_ERROR_CODES.DUPLICATE_IDENTIFIER,
        `Duplicate sync attempt identifier: ${attempt.syncAttemptId}`,
        {
          syncAttemptId: attempt.syncAttemptId,
          existingSyncAttemptId: existingAttempt.syncAttemptId,
        },
      );
    }

    identifiers.set(normalizedIdentifier, attempt);
  });
}

function assertCanonicalFieldsUnchanged(currentAttempt, nextAttempt) {
  CANONICAL_FIELDS.forEach((field) => {
    const currentValue = currentAttempt[field] ?? null;
    const nextValue = nextAttempt[field] ?? null;

    if (currentValue !== nextValue) {
      throw createRepositoryError(
        SYNC_ATTEMPT_REPOSITORY_ERROR_CODES.IDENTIFIER_CHANGE,
        `The canonical sync attempt field "${field}" cannot be changed.`,
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

  const normalizedQuery = assertOptions(query, 'Sync attempt query');

  if (
    normalizedQuery.limit !== undefined &&
    (!Number.isInteger(normalizedQuery.limit) ||
      normalizedQuery.limit < 1)
  ) {
    throw new RangeError(
      'Sync attempt query limit must be a positive integer.',
    );
  }

  if (
    normalizedQuery.offset !== undefined &&
    (!Number.isInteger(normalizedQuery.offset) ||
      normalizedQuery.offset < 0)
  ) {
    throw new RangeError(
      'Sync attempt query offset must be a nonnegative integer.',
    );
  }

  if (
    normalizedQuery.sortOrder !== undefined &&
    !['asc', 'desc'].includes(normalizedQuery.sortOrder)
  ) {
    throw new TypeError(
      'Sync attempt sort order must be either "asc" or "desc".',
    );
  }

  if (
    normalizedQuery.resolved !== undefined &&
    typeof normalizedQuery.resolved !== 'boolean'
  ) {
    throw new TypeError(
      'Sync attempt resolved filter must be a boolean.',
    );
  }

  const attemptedFrom =
    normalizedQuery.attemptedFrom === undefined
      ? undefined
      : Date.parse(toIsoTimestamp(normalizedQuery.attemptedFrom));
  const attemptedTo =
    normalizedQuery.attemptedTo === undefined
      ? undefined
      : Date.parse(toIsoTimestamp(normalizedQuery.attemptedTo));

  if (
    attemptedFrom !== undefined &&
    attemptedTo !== undefined &&
    attemptedFrom > attemptedTo
  ) {
    throw new RangeError(
      'The sync attempt start time cannot be after its end time.',
    );
  }

  return {
    ...normalizedQuery,
    attemptedFrom,
    attemptedTo,
  };
}

function valueMatchesFilter(value, filter) {
  if (Array.isArray(filter)) {
    return filter.includes(value);
  }

  return value === filter;
}

function matchesQuery(attempt, query) {
  if (
    query.trackingId !== undefined &&
    !valueMatchesFilter(attempt.trackingId, query.trackingId)
  ) {
    return false;
  }

  if (
    query.system !== undefined &&
    !valueMatchesFilter(attempt.system, query.system)
  ) {
    return false;
  }

  if (
    query.systems !== undefined &&
    !valueMatchesFilter(attempt.system, query.systems)
  ) {
    return false;
  }

  if (
    query.operation !== undefined &&
    !valueMatchesFilter(attempt.operation, query.operation)
  ) {
    return false;
  }

  if (
    query.operations !== undefined &&
    !valueMatchesFilter(attempt.operation, query.operations)
  ) {
    return false;
  }

  if (
    query.status !== undefined &&
    !valueMatchesFilter(attempt.status, query.status)
  ) {
    return false;
  }

  if (
    query.statuses !== undefined &&
    !valueMatchesFilter(attempt.status, query.statuses)
  ) {
    return false;
  }

  if (
    query.correlationId !== undefined &&
    !valueMatchesFilter(attempt.correlationId, query.correlationId)
  ) {
    return false;
  }

  if (
    query.resolved === true &&
    attempt.resolvedAt === null
  ) {
    return false;
  }

  if (
    query.resolved === false &&
    attempt.resolvedAt !== null
  ) {
    return false;
  }

  const attemptedAt = Date.parse(attempt.attemptedAt);

  if (
    query.attemptedFrom !== undefined &&
    attemptedAt < query.attemptedFrom
  ) {
    return false;
  }

  if (
    query.attemptedTo !== undefined &&
    attemptedAt > query.attemptedTo
  ) {
    return false;
  }

  return true;
}

function createSyncAttemptIdentifier(attempt) {
  return createDeterministicId(
    'SYN',
    {
      trackingId: attempt.trackingId ?? null,
      system: attempt.system,
      operation: attempt.operation,
      correlationId: attempt.correlationId,
      attemptedAt: attempt.attemptedAt,
    },
    { length: 16 },
  );
}

function resolveStorageAdapter(options) {
  if (options.storageAdapter !== undefined) {
    if (!isRepositoryStorageAdapter(options.storageAdapter)) {
      throw new TypeError(
        'The sync attempt storage adapter must provide get, set, and remove methods.',
      );
    }

    return options.storageAdapter;
  }

  if (options.storage !== undefined && !isStorageLike(options.storage)) {
    throw new TypeError(
      'The supplied sync attempt storage implementation is invalid.',
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
 * Stores seeded and locally generated synchronization attempts for Agent DB,
 * LifePro, ALI, and Horizon.
 */
export class SyncAttemptRepository {
  /**
   * @param {{
   *   seedAttempts?: object[],
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
        'The sync attempt repository clock must be a function.',
      );
    }

    this.seedAttempts = validateSeedAttempts(
      normalizedOptions.seedAttempts ?? getSeeds().syncAttempts,
    );
    this.clock = normalizedOptions.clock ?? (() => new Date());
    this.storageAdapter = resolveStorageAdapter(normalizedOptions);
    this.storageKey = normalizeIdentifier(
      normalizedOptions.storageKey ??
        SYNC_ATTEMPT_REPOSITORY_STORAGE_KEY,
      'Sync attempt repository storage key',
    );
  }

  /**
   * Lists synchronization attempts.
   *
   * @param {{
   *   trackingId?: string | string[] | null,
   *   system?: string | string[],
   *   systems?: string[],
   *   operation?: string | string[],
   *   operations?: string[],
   *   status?: string | string[],
   *   statuses?: string[],
   *   correlationId?: string | string[],
   *   resolved?: boolean,
   *   attemptedFrom?: Date | string | number,
   *   attemptedTo?: Date | string | number,
   *   sortOrder?: 'asc' | 'desc',
   *   limit?: number,
   *   offset?: number
   * }} [query] Sync attempt filters.
   * @returns {object[]} Matching sync attempts.
   */
  list(query = {}) {
    const normalizedQuery = normalizeQuery(query);
    const offset = normalizedQuery.offset ?? 0;
    const limit = normalizedQuery.limit ?? Number.POSITIVE_INFINITY;
    const direction = normalizedQuery.sortOrder === 'asc' ? 1 : -1;

    return this.readAttempts()
      .filter((attempt) => matchesQuery(attempt, normalizedQuery))
      .sort(
        (left, right) =>
          direction *
          (Date.parse(left.attemptedAt) - Date.parse(right.attemptedAt)),
      )
      .slice(offset, offset + limit)
      .map((attempt) => cloneValue(attempt));
  }

  /**
   * Alias for list.
   *
   * @param {object} [query] Sync attempt filters.
   * @returns {object[]} Matching sync attempts.
   */
  getAll(query = {}) {
    return this.list(query);
  }

  /**
   * Finds a sync attempt by identifier.
   *
   * @param {string | number} syncAttemptId Sync attempt identifier.
   * @returns {object | undefined} Matching attempt.
   */
  find(syncAttemptId) {
    const attempt = this.findAttemptInCollection(
      this.readAttempts(),
      syncAttemptId,
    );

    return attempt ? cloneValue(attempt) : undefined;
  }

  /**
   * Alias for find.
   *
   * @param {string | number} syncAttemptId Sync attempt identifier.
   * @returns {object | undefined} Matching attempt.
   */
  findById(syncAttemptId) {
    return this.find(syncAttemptId);
  }

  /**
   * Returns synchronization attempts for a tracking identifier.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @param {object} [query] Additional filters.
   * @returns {object[]} Matching attempts.
   */
  findByTrackingId(trackingId, query = {}) {
    return this.list({
      ...assertOptions(query, 'Tracking sync attempt query'),
      trackingId: normalizeIdentifier(
        trackingId,
        'Tracking identifier',
      ),
    });
  }

  /**
   * Returns synchronization attempts for a correlation identifier.
   *
   * @param {string | number} correlationId Correlation identifier.
   * @param {object} [query] Additional filters.
   * @returns {object[]} Matching attempts.
   */
  findByCorrelationId(correlationId, query = {}) {
    return this.list({
      ...assertOptions(query, 'Correlation sync attempt query'),
      correlationId: normalizeIdentifier(
        correlationId,
        'Correlation identifier',
      ),
    });
  }

  /**
   * Returns synchronization attempts for a system.
   *
   * @param {string} system Integration system.
   * @param {object} [query] Additional filters.
   * @returns {object[]} Matching attempts.
   */
  findBySystem(system, query = {}) {
    return this.list({
      ...assertOptions(query, 'System sync attempt query'),
      system: normalizeIdentifier(system, 'Integration system'),
    });
  }

  /**
   * Returns a sync attempt or throws when absent.
   *
   * @param {string | number} syncAttemptId Sync attempt identifier.
   * @returns {object} Matching attempt.
   */
  get(syncAttemptId) {
    const attempt = this.find(syncAttemptId);

    if (!attempt) {
      throw createRepositoryError(
        SYNC_ATTEMPT_REPOSITORY_ERROR_CODES.NOT_FOUND,
        `Sync attempt not found: ${syncAttemptId}`,
        { syncAttemptId: String(syncAttemptId) },
      );
    }

    return attempt;
  }

  /**
   * Creates a deterministic synchronization attempt.
   *
   * @param {object} syncAttempt Initial attempt values.
   * @returns {object} Created attempt.
   */
  create(syncAttempt) {
    if (!isObject(syncAttempt)) {
      throw new TypeError('A sync attempt must be an object.');
    }

    const attemptedAt = toIsoTimestamp(
      syncAttempt.attemptedAt ?? this.clock(),
    );
    const trackingId =
      syncAttempt.trackingId === undefined
        ? null
        : normalizeNullableIdentifier(
            syncAttempt.trackingId,
            'Tracking identifier',
          );
    const system = normalizeIdentifier(
      syncAttempt.system,
      'Integration system',
    );
    const operation = normalizeIdentifier(
      syncAttempt.operation,
      'Synchronization operation',
    );
    const correlationId =
      syncAttempt.correlationId ??
      generateCorrelationId({
        trackingId,
        system,
        operation,
        attemptedAt,
      });
    const candidate = {
      ...cloneValue(syncAttempt),
      trackingId,
      system,
      operation,
      correlationId: normalizeIdentifier(
        correlationId,
        'Correlation identifier',
      ),
      status: syncAttempt.status ?? SYNC_ATTEMPT_STATUSES.QUEUED,
      message:
        syncAttempt.message ??
        `${system} synchronization was queued.`,
      payloadSummary: syncAttempt.payloadSummary ?? {},
      attemptedAt,
      resolvedAt:
        syncAttempt.resolvedAt === undefined
          ? null
          : syncAttempt.resolvedAt,
    };

    candidate.syncAttemptId =
      syncAttempt.syncAttemptId ??
      createSyncAttemptIdentifier(candidate);

    const parsedAttempt = parseSyncAttempt(candidate);

    if (this.find(parsedAttempt.syncAttemptId)) {
      throw createRepositoryError(
        SYNC_ATTEMPT_REPOSITORY_ERROR_CODES.DUPLICATE_IDENTIFIER,
        `A sync attempt already exists: ${parsedAttempt.syncAttemptId}`,
        { syncAttemptId: parsedAttempt.syncAttemptId },
      );
    }

    const state = this.readState();
    const attempts = [...this.buildAttempts(state), parsedAttempt];

    assertUniqueIdentifiers(attempts);

    state.overlays[parsedAttempt.syncAttemptId] =
      cloneValue(parsedAttempt);
    state.removedSyncAttemptIds =
      state.removedSyncAttemptIds.filter(
        (syncAttemptId) =>
          syncAttemptId !== parsedAttempt.syncAttemptId,
      );
    this.persistState(state);

    return cloneValue(parsedAttempt);
  }

  /**
   * Alias for create.
   *
   * @param {object} syncAttempt Initial attempt values.
   * @returns {object} Created attempt.
   */
  createSyncAttempt(syncAttempt) {
    return this.create(syncAttempt);
  }

  /**
   * Saves a complete synchronization attempt.
   *
   * @param {object} syncAttempt Attempt to persist.
   * @param {{expectedStatus?: string, expectedResolvedAt?: string | null}}
   * [options] Save options.
   * @returns {object} Persisted attempt.
   */
  save(syncAttempt, options = {}) {
    const normalizedOptions = assertOptions(
      options,
      'Sync attempt save options',
    );
    const parsedAttempt = parseSyncAttempt(syncAttempt);
    const state = this.readState();
    const attempts = this.buildAttempts(state);
    const currentAttempt = this.findAttemptInCollection(
      attempts,
      parsedAttempt.syncAttemptId,
    );

    this.assertExpectedState(currentAttempt, normalizedOptions);

    if (currentAttempt) {
      assertCanonicalFieldsUnchanged(currentAttempt, parsedAttempt);
    }

    const nextAttempts = currentAttempt
      ? attempts.map((attempt) =>
          attempt.syncAttemptId === currentAttempt.syncAttemptId
            ? parsedAttempt
            : attempt,
        )
      : [...attempts, parsedAttempt];

    assertUniqueIdentifiers(nextAttempts);

    state.overlays[parsedAttempt.syncAttemptId] =
      cloneValue(parsedAttempt);
    state.removedSyncAttemptIds =
      state.removedSyncAttemptIds.filter(
        (syncAttemptId) =>
          syncAttemptId !== parsedAttempt.syncAttemptId,
      );
    this.persistState(state);

    return cloneValue(parsedAttempt);
  }

  /**
   * Alias for save.
   *
   * @param {object} syncAttempt Attempt to persist.
   * @param {object} [options] Save options.
   * @returns {object} Persisted attempt.
   */
  upsert(syncAttempt, options = {}) {
    return this.save(syncAttempt, options);
  }

  /**
   * Atomically patches a synchronization attempt.
   *
   * @param {string | number} syncAttemptId Sync attempt identifier.
   * @param {object | ((attempt: object) => object)} update Patch or updater.
   * @param {{expectedStatus?: string, expectedResolvedAt?: string | null}}
   * [options] Update options.
   * @returns {object} Updated attempt.
   */
  update(syncAttemptId, update, options = {}) {
    const normalizedOptions = assertOptions(
      options,
      'Sync attempt update options',
    );

    if (typeof update !== 'function' && !isObject(update)) {
      throw new TypeError(
        'A sync attempt update must be an object or updater function.',
      );
    }

    const state = this.readState();
    const attempts = this.buildAttempts(state);
    const currentAttempt = this.findAttemptInCollection(
      attempts,
      syncAttemptId,
    );

    if (!currentAttempt) {
      throw createRepositoryError(
        SYNC_ATTEMPT_REPOSITORY_ERROR_CODES.NOT_FOUND,
        `Sync attempt not found: ${syncAttemptId}`,
        { syncAttemptId: String(syncAttemptId) },
      );
    }

    this.assertExpectedState(currentAttempt, normalizedOptions);

    const updateValue =
      typeof update === 'function'
        ? update(cloneValue(currentAttempt))
        : update;

    if (!isObject(updateValue)) {
      throw new TypeError(
        'The sync attempt updater must return an attempt or patch object.',
      );
    }

    const nextAttempt = parseSyncAttempt(
      deepMerge(currentAttempt, updateValue),
    );

    assertCanonicalFieldsUnchanged(currentAttempt, nextAttempt);

    state.overlays[currentAttempt.syncAttemptId] =
      cloneValue(nextAttempt);
    state.removedSyncAttemptIds =
      state.removedSyncAttemptIds.filter(
        (removedSyncAttemptId) =>
          removedSyncAttemptId !== currentAttempt.syncAttemptId,
      );
    this.persistState(state);

    return cloneValue(nextAttempt);
  }

  /**
   * Alias for update emphasizing transactional behavior.
   *
   * @param {string | number} syncAttemptId Sync attempt identifier.
   * @param {object | ((attempt: object) => object)} update Patch or updater.
   * @param {object} [options] Update options.
   * @returns {object} Updated attempt.
   */
  atomicUpdate(syncAttemptId, update, options = {}) {
    return this.update(syncAttemptId, update, options);
  }

  /**
   * Resolves an attempt with a terminal outcome.
   *
   * @param {string | number} syncAttemptId Sync attempt identifier.
   * @param {{
   *   status: 'success' | 'failed' | 'skipped' | 'cancelled',
   *   message?: string,
   *   payloadSummary?: Record<string, unknown>,
   *   resolvedAt?: Date | string | number
   * }} outcome Resolution values.
   * @param {{expectedStatus?: string}} [options] Resolution options.
   * @returns {object} Resolved attempt.
   */
  resolve(syncAttemptId, outcome, options = {}) {
    const normalizedOutcome = assertOptions(
      outcome,
      'Sync attempt outcome',
    );
    const normalizedOptions = assertOptions(
      options,
      'Sync attempt resolution options',
    );
    const status = normalizeIdentifier(
      normalizedOutcome.status,
      'Sync attempt outcome status',
    );

    if (!TERMINAL_SYNC_ATTEMPT_STATUSES.includes(status)) {
      throw createRepositoryError(
        SYNC_ATTEMPT_REPOSITORY_ERROR_CODES.INVALID_STATUS,
        `Sync attempt outcome must be terminal: ${status}`,
        {
          status,
          supportedStatuses: TERMINAL_SYNC_ATTEMPT_STATUSES,
        },
      );
    }

    if (
      normalizedOutcome.payloadSummary !== undefined &&
      !isObject(normalizedOutcome.payloadSummary)
    ) {
      throw new TypeError(
        'Sync attempt payload summary must be an object.',
      );
    }

    const currentAttempt = this.get(syncAttemptId);
    const message =
      normalizedOutcome.message === undefined
        ? currentAttempt.message
        : normalizeIdentifier(
            normalizedOutcome.message,
            'Sync attempt message',
          );

    return this.update(
      syncAttemptId,
      {
        status,
        message,
        payloadSummary:
          normalizedOutcome.payloadSummary === undefined
            ? currentAttempt.payloadSummary
            : deepMerge(
                currentAttempt.payloadSummary,
                normalizedOutcome.payloadSummary,
              ),
        resolvedAt: toIsoTimestamp(
          normalizedOutcome.resolvedAt ?? this.clock(),
        ),
      },
      {
        expectedStatus: normalizedOptions.expectedStatus,
      },
    );
  }

  /**
   * Marks an attempt as successful.
   *
   * @param {string | number} syncAttemptId Sync attempt identifier.
   * @param {object} [outcome] Outcome values.
   * @param {object} [options] Resolution options.
   * @returns {object} Resolved attempt.
   */
  markSuccess(syncAttemptId, outcome = {}, options = {}) {
    return this.resolve(
      syncAttemptId,
      {
        ...assertOptions(outcome, 'Successful sync outcome'),
        status: SYNC_ATTEMPT_STATUSES.SUCCESS,
      },
      options,
    );
  }

  /**
   * Marks an attempt as failed.
   *
   * @param {string | number} syncAttemptId Sync attempt identifier.
   * @param {object} [outcome] Outcome values.
   * @param {object} [options] Resolution options.
   * @returns {object} Resolved attempt.
   */
  markFailed(syncAttemptId, outcome = {}, options = {}) {
    return this.resolve(
      syncAttemptId,
      {
        ...assertOptions(outcome, 'Failed sync outcome'),
        status: SYNC_ATTEMPT_STATUSES.FAILED,
      },
      options,
    );
  }

  /**
   * Marks an attempt as skipped.
   *
   * @param {string | number} syncAttemptId Sync attempt identifier.
   * @param {object} [outcome] Outcome values.
   * @param {object} [options] Resolution options.
   * @returns {object} Resolved attempt.
   */
  markSkipped(syncAttemptId, outcome = {}, options = {}) {
    return this.resolve(
      syncAttemptId,
      {
        ...assertOptions(outcome, 'Skipped sync outcome'),
        status: SYNC_ATTEMPT_STATUSES.SKIPPED,
      },
      options,
    );
  }

  /**
   * Creates a queued retry linked to an existing synchronization attempt.
   *
   * @param {string | number} syncAttemptId Source attempt identifier.
   * @param {{
   *   syncAttemptId?: string,
   *   correlationId?: string,
   *   message?: string,
   *   payloadSummary?: Record<string, unknown>,
   *   attemptedAt?: Date | string | number
   * }} [overrides] Retry values.
   * @returns {object} Created retry attempt.
   */
  retry(syncAttemptId, overrides = {}) {
    const normalizedOverrides = assertOptions(
      overrides,
      'Sync attempt retry options',
    );
    const sourceAttempt = this.get(syncAttemptId);

    if (
      normalizedOverrides.payloadSummary !== undefined &&
      !isObject(normalizedOverrides.payloadSummary)
    ) {
      throw new TypeError(
        'Sync attempt payload summary must be an object.',
      );
    }

    return this.create({
      syncAttemptId: normalizedOverrides.syncAttemptId,
      trackingId: sourceAttempt.trackingId,
      system: sourceAttempt.system,
      operation: sourceAttempt.operation,
      status: SYNC_ATTEMPT_STATUSES.QUEUED,
      correlationId:
        normalizedOverrides.correlationId ??
        sourceAttempt.correlationId,
      message:
        normalizedOverrides.message ??
        `Retry queued for sync attempt ${sourceAttempt.syncAttemptId}.`,
      payloadSummary: deepMerge(sourceAttempt.payloadSummary, {
        ...(normalizedOverrides.payloadSummary ?? {}),
        retryOfSyncAttemptId: sourceAttempt.syncAttemptId,
      }),
      attemptedAt:
        normalizedOverrides.attemptedAt ?? this.clock(),
      resolvedAt: null,
    });
  }

  /**
   * Alias for retry.
   *
   * @param {string | number} syncAttemptId Source attempt identifier.
   * @param {object} [overrides] Retry values.
   * @returns {object} Created retry attempt.
   */
  retrySyncAttempt(syncAttemptId, overrides = {}) {
    return this.retry(syncAttemptId, overrides);
  }

  /**
   * Returns the latest attempt for each integration system.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @returns {Record<string, object>} Latest attempts keyed by system.
   */
  getLatestAttemptsBySystem(trackingId) {
    const attempts = this.findByTrackingId(trackingId);
    const latestBySystem = Object.create(null);

    attempts.forEach((attempt) => {
      if (!Object.hasOwn(latestBySystem, attempt.system)) {
        latestBySystem[attempt.system] = cloneValue(attempt);
      }
    });

    return Object.freeze({ ...latestBySystem });
  }

  /**
   * Returns display-safe latest synchronization badges.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @returns {Record<string, object>} Badges keyed by integration system.
   */
  getStatusBadges(trackingId) {
    const latestAttempts = this.getLatestAttemptsBySystem(trackingId);
    const badges = Object.fromEntries(
      Object.values(INTEGRATION_SYSTEMS).map((system) => {
        const attempt = latestAttempts[system];

        return [
          system,
          Object.freeze({
            system,
            status: attempt?.status ?? 'unknown',
            operation: attempt?.operation ?? null,
            message: attempt?.message ?? 'No synchronization attempt.',
            attemptedAt: attempt?.attemptedAt ?? null,
            resolvedAt: attempt?.resolvedAt ?? null,
            correlationId: attempt?.correlationId ?? null,
            syncAttemptId: attempt?.syncAttemptId ?? null,
          }),
        ];
      }),
    );

    return Object.freeze(badges);
  }

  /**
   * Alias for getStatusBadges.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @returns {Record<string, object>} Status badges.
   */
  getLatestStatusBySystem(trackingId) {
    return this.getStatusBadges(trackingId);
  }

  /**
   * Returns counts grouped by synchronization status.
   *
   * @param {object} [query] Base filters.
   * @returns {Record<string, number>} Status counts.
   */
  getStatusCounts(query = {}) {
    const normalizedQuery = normalizeQuery(query);
    const baseQuery = {
      ...normalizedQuery,
    };

    delete baseQuery.status;
    delete baseQuery.statuses;
    delete baseQuery.limit;
    delete baseQuery.offset;

    const counts = Object.fromEntries(
      Object.values(SYNC_ATTEMPT_STATUSES).map((status) => [status, 0]),
    );

    this.readAttempts()
      .filter((attempt) => matchesQuery(attempt, baseQuery))
      .forEach((attempt) => {
        counts[attempt.status] = (counts[attempt.status] ?? 0) + 1;
      });

    return Object.freeze(counts);
  }

  /**
   * Removes a synchronization attempt.
   *
   * @param {string | number} syncAttemptId Sync attempt identifier.
   * @returns {boolean} Whether an attempt was removed.
   */
  remove(syncAttemptId) {
    const state = this.readState();
    const attempts = this.buildAttempts(state);
    const attempt = this.findAttemptInCollection(
      attempts,
      syncAttemptId,
    );

    if (!attempt) {
      return false;
    }

    const isSeedAttempt = this.seedAttempts.some(
      (seedAttempt) =>
        seedAttempt.syncAttemptId === attempt.syncAttemptId,
    );

    delete state.overlays[attempt.syncAttemptId];

    if (
      isSeedAttempt &&
      !state.removedSyncAttemptIds.includes(attempt.syncAttemptId)
    ) {
      state.removedSyncAttemptIds.push(attempt.syncAttemptId);
    }

    this.persistState(state);
    return true;
  }

  /**
   * Alias for remove.
   *
   * @param {string | number} syncAttemptId Sync attempt identifier.
   * @returns {boolean} Whether an attempt was removed.
   */
  delete(syncAttemptId) {
    return this.remove(syncAttemptId);
  }

  /**
   * Removes persisted changes and restores seeded synchronization attempts.
   *
   * @returns {object[]} Seeded attempts.
   */
  reset() {
    const removed = this.storageAdapter.remove(this.storageKey);

    if (!removed) {
      throw this.createPersistenceError('reset');
    }

    return this.seedAttempts.map((attempt) => cloneValue(attempt));
  }

  readState() {
    const state = this.storageAdapter.get(
      this.storageKey,
      syncAttemptRepositoryStateSchema,
      createEmptyState(),
    );

    return cloneValue(state);
  }

  buildAttempts(state) {
    const removedIdentifiers = new Set(state.removedSyncAttemptIds);
    const attemptsById = new Map();

    this.seedAttempts.forEach((attempt) => {
      if (!removedIdentifiers.has(attempt.syncAttemptId)) {
        attemptsById.set(
          attempt.syncAttemptId,
          cloneValue(attempt),
        );
      }
    });

    Object.entries(state.overlays).forEach(
      ([syncAttemptId, overlay]) => {
        if (removedIdentifiers.has(syncAttemptId)) {
          return;
        }

        if (!isObject(overlay)) {
          throw createRepositoryError(
            SYNC_ATTEMPT_REPOSITORY_ERROR_CODES.INVALID_ATTEMPT,
            `Invalid persisted sync attempt overlay: ${syncAttemptId}`,
            { syncAttemptId },
          );
        }

        const existingAttempt = attemptsById.get(syncAttemptId);
        const mergedAttempt = existingAttempt
          ? deepMerge(existingAttempt, overlay)
          : cloneValue(overlay);
        const parsedAttempt = parseSyncAttempt(mergedAttempt);

        if (parsedAttempt.syncAttemptId !== syncAttemptId) {
          throw createRepositoryError(
            SYNC_ATTEMPT_REPOSITORY_ERROR_CODES.INVALID_ATTEMPT,
            'A persisted sync attempt has a mismatched identifier.',
            {
              overlayKey: syncAttemptId,
              syncAttemptId: parsedAttempt.syncAttemptId,
            },
          );
        }

        attemptsById.set(syncAttemptId, parsedAttempt);
      },
    );

    const attempts = [...attemptsById.values()];

    assertUniqueIdentifiers(attempts);
    return attempts;
  }

  readAttempts() {
    try {
      return this.buildAttempts(this.readState());
    } catch {
      this.storageAdapter.remove(this.storageKey);
      return this.seedAttempts.map((attempt) => cloneValue(attempt));
    }
  }

  findAttemptInCollection(attempts, syncAttemptId) {
    const normalizedIdentifier = normalizeIdentifierForLookup(
      syncAttemptId,
      'Sync attempt identifier',
    );

    return attempts.find(
      (attempt) =>
        normalizeIdentifierForLookup(
          attempt.syncAttemptId,
          'Sync attempt identifier',
        ) === normalizedIdentifier,
    );
  }

  assertExpectedState(currentAttempt, options) {
    if (!currentAttempt) {
      return;
    }

    if (
      options.expectedStatus !== undefined &&
      currentAttempt.status !== options.expectedStatus
    ) {
      throw createRepositoryError(
        SYNC_ATTEMPT_REPOSITORY_ERROR_CODES.CONFLICT,
        'The sync attempt status changed after it was last read.',
        {
          syncAttemptId: currentAttempt.syncAttemptId,
          expectedStatus: options.expectedStatus,
          actualStatus: currentAttempt.status,
        },
      );
    }

    if (
      options.expectedResolvedAt !== undefined &&
      currentAttempt.resolvedAt !== options.expectedResolvedAt
    ) {
      throw createRepositoryError(
        SYNC_ATTEMPT_REPOSITORY_ERROR_CODES.CONFLICT,
        'The sync attempt outcome changed after it was last read.',
        {
          syncAttemptId: currentAttempt.syncAttemptId,
          expectedResolvedAt: options.expectedResolvedAt,
          actualResolvedAt: currentAttempt.resolvedAt,
        },
      );
    }
  }

  persistState(state) {
    const result = syncAttemptRepositoryStateSchema.safeParse(state);

    if (!result.success) {
      throw createRepositoryError(
        SYNC_ATTEMPT_REPOSITORY_ERROR_CODES.PERSISTENCE_FAILED,
        'The sync attempt repository state is invalid.',
        { issues: result.error.issues },
        result.error,
      );
    }

    if (
      !this.storageAdapter.set(
        this.storageKey,
        result.data,
        syncAttemptRepositoryStateSchema,
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
      SYNC_ATTEMPT_REPOSITORY_ERROR_CODES.PERSISTENCE_FAILED,
      `Unable to ${operation} persisted sync attempts.`,
      {
        operation,
        storageError: storageError ?? null,
      },
      storageError,
    );
  }
}

/**
 * Creates a synchronization attempt repository.
 *
 * @param {ConstructorParameters<typeof SyncAttemptRepository>[0]} [options]
 * Repository options.
 * @returns {SyncAttemptRepository} Repository instance.
 */
export function createSyncAttemptRepository(options = {}) {
  return new SyncAttemptRepository(options);
}

export const SynchronizationAttemptRepository = SyncAttemptRepository;
export const createSynchronizationAttemptRepository =
  createSyncAttemptRepository;

export default SyncAttemptRepository;