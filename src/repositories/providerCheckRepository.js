import { z } from 'zod';
import { STORAGE_KEYS } from '../constants/storageKeys.js';
import {
  providerCheckSchema,
  providerResponseSchema,
} from '../contracts/schemas.js';
import { BrowserStorageAdapter } from '../persistence/browserStorageAdapter.js';
import { toIsoTimestamp } from '../utils/dates.js';
import { createDeterministicId } from '../utils/ids.js';

const identifierSchema = z.string().trim().min(1);
const dateTimeSchema = z.string().datetime({ offset: true });
const nullableIdentifierSchema = identifierSchema.nullable();
const nullableDateTimeSchema = dateTimeSchema.nullable();
const metadataSchema = z.record(z.unknown());

export const PROVIDER_CHECK_REPOSITORY_STORAGE_KEY =
  `${STORAGE_KEYS.ONBOARDING}:provider-checks`;

export const providerResultReferenceSchema = z
  .object({
    referenceId: identifierSchema,
    checkId: identifierSchema,
    providerCode: identifierSchema,
    service: identifierSchema,
    trackingId: nullableIdentifierSchema.optional(),
    applicationId: nullableIdentifierSchema.optional(),
    subjectKey: nullableIdentifierSchema.optional(),
    status: identifierSchema,
    outcome: nullableIdentifierSchema.optional(),
    eligibleForReuse: z.boolean().default(false),
    completedAt: nullableDateTimeSchema,
    reusableThrough: nullableDateTimeSchema,
    result: z.unknown().nullable().default(null),
    validationCodes: z.array(identifierSchema).default([]),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    metadata: metadataSchema.default({}),
  })
  .passthrough();

export const providerCheckRepositoryStateSchema = z
  .object({
    checks: z.record(z.unknown()).default({}),
    reusableResults: z.record(z.unknown()).default({}),
  })
  .passthrough();

export const PROVIDER_CHECK_REPOSITORY_ERROR_CODES = Object.freeze({
  INVALID_CHECK: 'PROVIDER_CHECK_INVALID',
  INVALID_REFERENCE: 'PROVIDER_RESULT_REFERENCE_INVALID',
  NOT_FOUND: 'PROVIDER_CHECK_NOT_FOUND',
  REFERENCE_NOT_FOUND: 'PROVIDER_RESULT_REFERENCE_NOT_FOUND',
  DUPLICATE: 'PROVIDER_CHECK_DUPLICATE',
  DUPLICATE_REFERENCE: 'PROVIDER_RESULT_REFERENCE_DUPLICATE',
  IDENTIFIER_CHANGE: 'PROVIDER_CHECK_IDENTIFIER_CHANGE',
  REFERENCE_IDENTIFIER_CHANGE:
    'PROVIDER_RESULT_REFERENCE_IDENTIFIER_CHANGE',
  CONFLICT: 'PROVIDER_CHECK_UPDATE_CONFLICT',
  PERSISTENCE_FAILED: 'PROVIDER_CHECK_PERSISTENCE_FAILED',
});

const CHECK_CANONICAL_FIELDS = Object.freeze([
  'checkId',
  'providerCode',
  'service',
]);

const REFERENCE_CANONICAL_FIELDS = Object.freeze([
  'referenceId',
  'checkId',
  'providerCode',
  'service',
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

function assertOptions(options, description = 'Provider check options') {
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

function normalizeIdentifierArray(values, description) {
  if (!Array.isArray(values)) {
    throw new TypeError(`${description} must be an array.`);
  }

  return [
    ...new Set(
      values.map((value) => normalizeIdentifier(value, description)),
    ),
  ];
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
      const path = issue.path.length > 0 ? issue.path.join('.') : 'value';

      return `${path}: ${issue.message}`;
    })
    .join('; ');
}

function createRepositoryError(code, message, details, cause) {
  const error = new Error(message, {
    ...(cause === undefined ? {} : { cause }),
  });

  error.name = 'ProviderCheckRepositoryError';
  error.code = code;
  error.details = details ?? null;

  return error;
}

function parseCheck(check) {
  const result = providerCheckSchema.safeParse(check);

  if (!result.success) {
    throw createRepositoryError(
      PROVIDER_CHECK_REPOSITORY_ERROR_CODES.INVALID_CHECK,
      `Invalid provider check: ${formatValidationIssues(result.error)}`,
      { issues: result.error.issues },
      result.error,
    );
  }

  return result.data;
}

function parseReference(reference) {
  const result = providerResultReferenceSchema.safeParse(reference);

  if (!result.success) {
    throw createRepositoryError(
      PROVIDER_CHECK_REPOSITORY_ERROR_CODES.INVALID_REFERENCE,
      `Invalid provider result reference: ${formatValidationIssues(
        result.error,
      )}`,
      { issues: result.error.issues },
      result.error,
    );
  }

  return result.data;
}

function createEmptyState() {
  return {
    checks: {},
    reusableResults: {},
  };
}

function assertCanonicalFieldsUnchanged(
  currentValue,
  nextValue,
  fields,
  errorCode,
  description,
) {
  fields.forEach((field) => {
    const currentFieldValue = currentValue[field] ?? null;
    const nextFieldValue = nextValue[field] ?? null;

    if (currentFieldValue !== nextFieldValue) {
      throw createRepositoryError(
        errorCode,
        `The canonical ${description} field "${field}" cannot be changed.`,
        {
          field,
          currentValue: currentFieldValue,
          requestedValue: nextFieldValue,
        },
      );
    }
  });
}

function normalizeQuery(query) {
  if (query === undefined) {
    return {};
  }

  const normalizedQuery = assertOptions(query, 'Provider check query');

  if (
    normalizedQuery.limit !== undefined &&
    (!Number.isInteger(normalizedQuery.limit) ||
      normalizedQuery.limit < 1)
  ) {
    throw new RangeError(
      'Provider check query limit must be a positive integer.',
    );
  }

  if (
    normalizedQuery.offset !== undefined &&
    (!Number.isInteger(normalizedQuery.offset) ||
      normalizedQuery.offset < 0)
  ) {
    throw new RangeError(
      'Provider check query offset must be a nonnegative integer.',
    );
  }

  return normalizedQuery;
}

function matchesCheckQuery(check, query) {
  if (
    query.trackingId !== undefined &&
    check.trackingId !== query.trackingId
  ) {
    return false;
  }

  if (
    query.applicationId !== undefined &&
    check.applicationId !== query.applicationId
  ) {
    return false;
  }

  if (
    query.providerCode !== undefined &&
    check.providerCode !== query.providerCode
  ) {
    return false;
  }

  if (query.service !== undefined && check.service !== query.service) {
    return false;
  }

  if (query.status !== undefined && check.status !== query.status) {
    return false;
  }

  if (query.outcome !== undefined && check.outcome !== query.outcome) {
    return false;
  }

  if (
    query.correlationId !== undefined &&
    check.correlationId !== query.correlationId
  ) {
    return false;
  }

  if (
    query.manualReviewRequired !== undefined &&
    check.manualReviewRequired !== query.manualReviewRequired
  ) {
    return false;
  }

  if (
    query.validationCode !== undefined &&
    !check.validationCodes.includes(query.validationCode)
  ) {
    return false;
  }

  return true;
}

function matchesReferenceQuery(reference, query, referenceTime) {
  if (
    query.checkId !== undefined &&
    reference.checkId !== query.checkId
  ) {
    return false;
  }

  if (
    query.trackingId !== undefined &&
    reference.trackingId !== query.trackingId
  ) {
    return false;
  }

  if (
    query.applicationId !== undefined &&
    reference.applicationId !== query.applicationId
  ) {
    return false;
  }

  if (
    query.providerCode !== undefined &&
    reference.providerCode !== query.providerCode
  ) {
    return false;
  }

  if (
    query.service !== undefined &&
    reference.service !== query.service
  ) {
    return false;
  }

  if (
    query.subjectKey !== undefined &&
    reference.subjectKey !== query.subjectKey
  ) {
    return false;
  }

  if (query.status !== undefined && reference.status !== query.status) {
    return false;
  }

  if (
    query.eligibleForReuse !== undefined &&
    reference.eligibleForReuse !== query.eligibleForReuse
  ) {
    return false;
  }

  if (
    query.reusableAt !== undefined &&
    !isReferenceReusable(reference, referenceTime)
  ) {
    return false;
  }

  return true;
}

function isReferenceReusable(reference, referenceTime) {
  if (!reference.eligibleForReuse || reference.completedAt === null) {
    return false;
  }

  const completedAt = Date.parse(reference.completedAt);

  if (Number.isNaN(completedAt) || referenceTime < completedAt) {
    return false;
  }

  if (reference.reusableThrough === null) {
    return true;
  }

  const reusableThrough = Date.parse(reference.reusableThrough);

  return (
    !Number.isNaN(reusableThrough) && referenceTime <= reusableThrough
  );
}

function createCheckIdentifier(check) {
  return createDeterministicId(
    'CHK',
    {
      applicationId: check.applicationId ?? null,
      correlationId: check.correlationId ?? null,
      providerCode: check.providerCode,
      scenario: check.scenario ?? null,
      service: check.service,
      trackingId: check.trackingId ?? null,
      request: check.request ?? {},
    },
    { length: 16 },
  );
}

function createReferenceIdentifier(reference) {
  return createDeterministicId(
    'REF',
    {
      checkId: reference.checkId,
      providerCode: reference.providerCode,
      service: reference.service,
      subjectKey: reference.subjectKey ?? null,
    },
    { length: 16 },
  );
}

function resolveStorageAdapter(options) {
  if (options.storageAdapter !== undefined) {
    if (!isRepositoryStorageAdapter(options.storageAdapter)) {
      throw new TypeError(
        'The provider check storage adapter must provide get, set, and remove methods.',
      );
    }

    return options.storageAdapter;
  }

  if (options.storage !== undefined && !isStorageLike(options.storage)) {
    throw new TypeError(
      'The supplied provider check storage implementation is invalid.',
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
 * Persists deterministic provider checks and references to reusable results.
 */
export class ProviderCheckRepository {
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
        'The provider check repository clock must be a function.',
      );
    }

    this.clock = normalizedOptions.clock ?? (() => new Date());
    this.storageAdapter = resolveStorageAdapter(normalizedOptions);
    this.storageKey = normalizeIdentifier(
      normalizedOptions.storageKey ??
        PROVIDER_CHECK_REPOSITORY_STORAGE_KEY,
      'Provider check repository storage key',
    );
  }

  /**
   * Lists provider checks.
   *
   * @param {{
   *   trackingId?: string,
   *   applicationId?: string,
   *   providerCode?: string,
   *   service?: string,
   *   status?: string,
   *   outcome?: string,
   *   correlationId?: string,
   *   manualReviewRequired?: boolean,
   *   validationCode?: string,
   *   limit?: number,
   *   offset?: number
   * }} [query] Check filters.
   * @returns {object[]} Matching provider checks.
   */
  list(query = {}) {
    const normalizedQuery = normalizeQuery(query);
    const offset = normalizedQuery.offset ?? 0;
    const limit = normalizedQuery.limit ?? Number.POSITIVE_INFINITY;

    return this.readChecks()
      .filter((check) => matchesCheckQuery(check, normalizedQuery))
      .sort(
        (left, right) =>
          Date.parse(right.requestedAt) - Date.parse(left.requestedAt),
      )
      .slice(offset, offset + limit)
      .map((check) => cloneValue(check));
  }

  /**
   * Alias for list.
   *
   * @param {object} [query] Check filters.
   * @returns {object[]} Matching checks.
   */
  getAll(query = {}) {
    return this.list(query);
  }

  /**
   * Finds a provider check by identifier.
   *
   * @param {string | number} checkId Provider check identifier.
   * @returns {object | undefined} Matching provider check.
   */
  find(checkId) {
    const state = this.readState();
    const check = this.findCheckInState(state, checkId);

    return check ? cloneValue(check) : undefined;
  }

  /**
   * Alias for find.
   *
   * @param {string | number} checkId Provider check identifier.
   * @returns {object | undefined} Matching provider check.
   */
  findById(checkId) {
    return this.find(checkId);
  }

  /**
   * Finds checks for a tracking identifier.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @returns {object[]} Matching provider checks.
   */
  findByTrackingId(trackingId) {
    const normalizedTrackingId = normalizeIdentifier(
      trackingId,
      'Tracking identifier',
    );

    return this.list({ trackingId: normalizedTrackingId });
  }

  /**
   * Finds checks for an application identifier.
   *
   * @param {string | number} applicationId Application identifier.
   * @returns {object[]} Matching provider checks.
   */
  findByApplicationId(applicationId) {
    const normalizedApplicationId = normalizeIdentifier(
      applicationId,
      'Application identifier',
    );

    return this.list({ applicationId: normalizedApplicationId });
  }

  /**
   * Finds a check using a correlation identifier.
   *
   * @param {string | number} correlationId Correlation identifier.
   * @returns {object | undefined} Matching provider check.
   */
  findByCorrelationId(correlationId) {
    const normalizedCorrelationId = normalizeIdentifierForLookup(
      correlationId,
      'Correlation identifier',
    );
    const check = this.readChecks().find(
      (candidate) =>
        candidate.correlationId !== undefined &&
        normalizeIdentifierForLookup(
          candidate.correlationId,
          'Correlation identifier',
        ) === normalizedCorrelationId,
    );

    return check ? cloneValue(check) : undefined;
  }

  /**
   * Returns a provider check or throws when it is absent.
   *
   * @param {string | number} checkId Provider check identifier.
   * @returns {object} Matching provider check.
   */
  get(checkId) {
    const check = this.find(checkId);

    if (!check) {
      throw createRepositoryError(
        PROVIDER_CHECK_REPOSITORY_ERROR_CODES.NOT_FOUND,
        `Provider check not found: ${checkId}`,
        { checkId: String(checkId) },
      );
    }

    return check;
  }

  /**
   * Creates a deterministic provider check.
   *
   * @param {object} check Initial provider check values.
   * @returns {object} Created provider check.
   */
  create(check) {
    if (!isObject(check)) {
      throw new TypeError('A provider check must be an object.');
    }

    const timestamp = toIsoTimestamp(this.clock());
    const providerCode = normalizeIdentifier(
      check.providerCode,
      'Provider code',
    );
    const service = normalizeIdentifier(check.service, 'Provider service');
    const candidate = {
      ...cloneValue(check),
      providerCode,
      service,
      checkId:
        check.checkId ??
        createCheckIdentifier({
          ...check,
          providerCode,
          service,
        }),
      status: check.status ?? 'queued',
      request: check.request ?? check.payload ?? {},
      manualReviewRequired: check.manualReviewRequired ?? false,
      validationCodes: normalizeIdentifierArray(
        check.validationCodes ?? [],
        'Provider validation codes',
      ),
      requestedAt: check.requestedAt ?? timestamp,
      completedAt: check.completedAt ?? null,
    };
    const parsedCheck = parseCheck(candidate);

    if (this.find(parsedCheck.checkId)) {
      throw createRepositoryError(
        PROVIDER_CHECK_REPOSITORY_ERROR_CODES.DUPLICATE,
        `A provider check already exists: ${parsedCheck.checkId}`,
        { checkId: parsedCheck.checkId },
      );
    }

    const state = this.readState();

    state.checks[parsedCheck.checkId] = cloneValue(parsedCheck);
    this.persistState(state);

    return cloneValue(parsedCheck);
  }

  /**
   * Persists a complete provider check.
   *
   * @param {object} check Provider check to persist.
   * @param {{expectedStatus?: string, expectedRequestedAt?: string}} [options]
   * Save options.
   * @returns {object} Persisted provider check.
   */
  save(check, options = {}) {
    const normalizedOptions = assertOptions(
      options,
      'Provider check save options',
    );
    const parsedCheck = parseCheck(check);
    const state = this.readState();
    const currentCheck = this.findCheckInState(
      state,
      parsedCheck.checkId,
    );

    this.assertExpectedCheck(currentCheck, normalizedOptions);

    if (currentCheck) {
      assertCanonicalFieldsUnchanged(
        currentCheck,
        parsedCheck,
        CHECK_CANONICAL_FIELDS,
        PROVIDER_CHECK_REPOSITORY_ERROR_CODES.IDENTIFIER_CHANGE,
        'provider check',
      );
    }

    state.checks[parsedCheck.checkId] = cloneValue(parsedCheck);
    this.persistState(state);

    return cloneValue(parsedCheck);
  }

  /**
   * Alias for save.
   *
   * @param {object} check Provider check.
   * @param {object} [options] Save options.
   * @returns {object} Persisted provider check.
   */
  upsert(check, options = {}) {
    return this.save(check, options);
  }

  /**
   * Atomically patches a provider check.
   *
   * @param {string | number} checkId Provider check identifier.
   * @param {object | ((check: object) => object)} update Patch or updater.
   * @param {{expectedStatus?: string, expectedRequestedAt?: string}} [options]
   * Update options.
   * @returns {object} Updated provider check.
   */
  update(checkId, update, options = {}) {
    const normalizedOptions = assertOptions(
      options,
      'Provider check update options',
    );

    if (typeof update !== 'function' && !isObject(update)) {
      throw new TypeError(
        'A provider check update must be an object or updater function.',
      );
    }

    const state = this.readState();
    const currentCheck = this.findCheckInState(state, checkId);

    if (!currentCheck) {
      throw createRepositoryError(
        PROVIDER_CHECK_REPOSITORY_ERROR_CODES.NOT_FOUND,
        `Provider check not found: ${checkId}`,
        { checkId: String(checkId) },
      );
    }

    this.assertExpectedCheck(currentCheck, normalizedOptions);

    const updateValue =
      typeof update === 'function'
        ? update(cloneValue(currentCheck))
        : update;

    if (!isObject(updateValue)) {
      throw new TypeError(
        'The provider check updater must return a check or patch object.',
      );
    }

    const nextCheck = parseCheck(deepMerge(currentCheck, updateValue));

    assertCanonicalFieldsUnchanged(
      currentCheck,
      nextCheck,
      CHECK_CANONICAL_FIELDS,
      PROVIDER_CHECK_REPOSITORY_ERROR_CODES.IDENTIFIER_CHANGE,
      'provider check',
    );

    state.checks[currentCheck.checkId] = cloneValue(nextCheck);
    this.persistState(state);

    return cloneValue(nextCheck);
  }

  /**
   * Alias for update emphasizing transactional behavior.
   *
   * @param {string | number} checkId Provider check identifier.
   * @param {object | ((check: object) => object)} update Patch or updater.
   * @param {object} [options] Update options.
   * @returns {object} Updated provider check.
   */
  atomicUpdate(checkId, update, options = {}) {
    return this.update(checkId, update, options);
  }

  /**
   * Completes a provider check from a canonical provider response.
   *
   * @param {string | number} checkId Provider check identifier.
   * @param {object} response Provider response.
   * @param {{
   *   status?: string,
   *   completedAt?: Date | string | number,
   *   expectedStatus?: string
   * }} [options] Completion options.
   * @returns {object} Completed provider check.
   */
  complete(checkId, response, options = {}) {
    const normalizedOptions = assertOptions(
      options,
      'Provider check completion options',
    );
    const responseResult = providerResponseSchema.safeParse(response);

    if (!responseResult.success) {
      throw createRepositoryError(
        PROVIDER_CHECK_REPOSITORY_ERROR_CODES.INVALID_CHECK,
        `Invalid provider response: ${formatValidationIssues(
          responseResult.error,
        )}`,
        { issues: responseResult.error.issues },
        responseResult.error,
      );
    }

    const parsedResponse = responseResult.data;
    const completedAt = toIsoTimestamp(
      normalizedOptions.completedAt ??
        parsedResponse.receivedAt ??
        this.clock(),
    );

    return this.update(
      checkId,
      {
        status: normalizedOptions.status ?? 'completed',
        outcome: parsedResponse.outcome,
        httpStatus: parsedResponse.httpStatus,
        response: cloneValue(parsedResponse.response),
        latencyMs: parsedResponse.latencyMs,
        validationCodes: normalizeIdentifierArray(
          parsedResponse.validationCodes ?? [],
          'Provider validation codes',
        ),
        completedAt,
      },
      {
        expectedStatus: normalizedOptions.expectedStatus,
      },
    );
  }

  /**
   * Alias for complete.
   *
   * @param {string | number} checkId Provider check identifier.
   * @param {object} response Provider response.
   * @param {object} [options] Completion options.
   * @returns {object} Completed provider check.
   */
  completeProviderCheck(checkId, response, options = {}) {
    return this.complete(checkId, response, options);
  }

  /**
   * Lists reusable provider result references.
   *
   * @param {{
   *   checkId?: string,
   *   trackingId?: string,
   *   applicationId?: string,
   *   providerCode?: string,
   *   service?: string,
   *   subjectKey?: string,
   *   status?: string,
   *   eligibleForReuse?: boolean,
   *   reusableAt?: Date | string | number,
   *   limit?: number,
   *   offset?: number
   * }} [query] Reference filters.
   * @returns {object[]} Matching result references.
   */
  listReusableResultReferences(query = {}) {
    const normalizedQuery = normalizeQuery(query);
    const offset = normalizedQuery.offset ?? 0;
    const limit = normalizedQuery.limit ?? Number.POSITIVE_INFINITY;
    const referenceTime = new Date(
      normalizedQuery.reusableAt ?? this.clock(),
    ).getTime();

    if (Number.isNaN(referenceTime)) {
      throw new RangeError('The reusable result reference time is invalid.');
    }

    return this.readReferences()
      .filter((reference) =>
        matchesReferenceQuery(
          reference,
          normalizedQuery,
          referenceTime,
        ),
      )
      .sort(
        (left, right) =>
          Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
      )
      .slice(offset, offset + limit)
      .map((reference) => cloneValue(reference));
  }

  /**
   * Saves a reusable provider result reference.
   *
   * @param {object} reference Result reference.
   * @returns {object} Persisted result reference.
   */
  saveReusableResultReference(reference) {
    if (!isObject(reference)) {
      throw new TypeError(
        'A reusable provider result reference must be an object.',
      );
    }

    const state = this.readState();
    const check = this.findCheckInState(state, reference.checkId);

    if (!check) {
      throw createRepositoryError(
        PROVIDER_CHECK_REPOSITORY_ERROR_CODES.NOT_FOUND,
        `Provider check not found: ${reference.checkId}`,
        { checkId: String(reference.checkId) },
      );
    }

    const timestamp = toIsoTimestamp(this.clock());
    const candidate = {
      ...cloneValue(reference),
      referenceId:
        reference.referenceId ??
        createReferenceIdentifier({
          ...reference,
          checkId: check.checkId,
          providerCode: check.providerCode,
          service: check.service,
        }),
      checkId: check.checkId,
      providerCode: reference.providerCode ?? check.providerCode,
      service: reference.service ?? check.service,
      trackingId:
        reference.trackingId ?? check.trackingId ?? null,
      applicationId:
        reference.applicationId ?? check.applicationId ?? null,
      subjectKey: normalizeNullableIdentifier(
        reference.subjectKey,
        'Reusable result subject key',
      ),
      status: reference.status ?? check.status,
      outcome: reference.outcome ?? check.outcome ?? null,
      eligibleForReuse: reference.eligibleForReuse ?? true,
      completedAt:
        reference.completedAt ?? check.completedAt ?? null,
      reusableThrough: reference.reusableThrough ?? null,
      result:
        reference.result === undefined
          ? check.response ?? null
          : cloneValue(reference.result),
      validationCodes: normalizeIdentifierArray(
        reference.validationCodes ?? check.validationCodes ?? [],
        'Reusable result validation codes',
      ),
      createdAt: reference.createdAt ?? timestamp,
      updatedAt: timestamp,
      metadata: reference.metadata ?? {},
    };
    const parsedReference = parseReference(candidate);
    const currentReference = this.findReferenceInState(
      state,
      parsedReference.referenceId,
    );

    if (currentReference) {
      assertCanonicalFieldsUnchanged(
        currentReference,
        parsedReference,
        REFERENCE_CANONICAL_FIELDS,
        PROVIDER_CHECK_REPOSITORY_ERROR_CODES
          .REFERENCE_IDENTIFIER_CHANGE,
        'provider result reference',
      );
    }

    state.reusableResults[parsedReference.referenceId] =
      cloneValue(parsedReference);
    this.persistState(state);

    return cloneValue(parsedReference);
  }

  /**
   * Creates a reusable result reference and rejects duplicate identifiers.
   *
   * @param {object} reference Result reference.
   * @returns {object} Created result reference.
   */
  createReusableResultReference(reference) {
    if (!isObject(reference)) {
      throw new TypeError(
        'A reusable provider result reference must be an object.',
      );
    }

    const check = this.get(reference.checkId);
    const referenceId =
      reference.referenceId ??
      createReferenceIdentifier({
        ...reference,
        checkId: check.checkId,
        providerCode: reference.providerCode ?? check.providerCode,
        service: reference.service ?? check.service,
      });

    if (this.findReusableResultReference(referenceId)) {
      throw createRepositoryError(
        PROVIDER_CHECK_REPOSITORY_ERROR_CODES.DUPLICATE_REFERENCE,
        `A provider result reference already exists: ${referenceId}`,
        { referenceId },
      );
    }

    return this.saveReusableResultReference({
      ...reference,
      referenceId,
    });
  }

  /**
   * Finds a reusable result reference by identifier.
   *
   * @param {string | number} referenceId Reference identifier.
   * @returns {object | undefined} Matching reference.
   */
  findReusableResultReference(referenceId) {
    const state = this.readState();
    const reference = this.findReferenceInState(state, referenceId);

    return reference ? cloneValue(reference) : undefined;
  }

  /**
   * Returns the most recent currently reusable provider result.
   *
   * @param {{
   *   providerCode: string,
   *   service?: string,
   *   subjectKey?: string,
   *   reusableAt?: Date | string | number
   * }} query Reuse lookup criteria.
   * @returns {object | undefined} Reusable result reference.
   */
  findReusableResult(query) {
    const normalizedQuery = assertOptions(
      query,
      'Reusable provider result query',
    );

    normalizeIdentifier(
      normalizedQuery.providerCode,
      'Provider code',
    );

    return this.listReusableResultReferences({
      ...normalizedQuery,
      eligibleForReuse: true,
      reusableAt: normalizedQuery.reusableAt ?? this.clock(),
      limit: 1,
    })[0];
  }

  /**
   * Returns a reusable result reference or throws when absent.
   *
   * @param {string | number} referenceId Reference identifier.
   * @returns {object} Matching reference.
   */
  getReusableResultReference(referenceId) {
    const reference = this.findReusableResultReference(referenceId);

    if (!reference) {
      throw createRepositoryError(
        PROVIDER_CHECK_REPOSITORY_ERROR_CODES.REFERENCE_NOT_FOUND,
        `Provider result reference not found: ${referenceId}`,
        { referenceId: String(referenceId) },
      );
    }

    return reference;
  }

  /**
   * Marks a reusable result reference as unavailable for future reuse.
   *
   * @param {string | number} referenceId Reference identifier.
   * @returns {object} Updated reference.
   */
  invalidateReusableResult(referenceId) {
    const state = this.readState();
    const currentReference = this.findReferenceInState(state, referenceId);

    if (!currentReference) {
      throw createRepositoryError(
        PROVIDER_CHECK_REPOSITORY_ERROR_CODES.REFERENCE_NOT_FOUND,
        `Provider result reference not found: ${referenceId}`,
        { referenceId: String(referenceId) },
      );
    }

    const nextReference = parseReference({
      ...currentReference,
      eligibleForReuse: false,
      updatedAt: toIsoTimestamp(this.clock()),
    });

    state.reusableResults[currentReference.referenceId] =
      cloneValue(nextReference);
    this.persistState(state);

    return cloneValue(nextReference);
  }

  /**
   * Removes a provider check and its reusable result references.
   *
   * @param {string | number} checkId Provider check identifier.
   * @returns {boolean} Whether a check was removed.
   */
  remove(checkId) {
    const state = this.readState();
    const check = this.findCheckInState(state, checkId);

    if (!check) {
      return false;
    }

    delete state.checks[check.checkId];

    Object.entries(state.reusableResults).forEach(
      ([referenceId, storedReference]) => {
        if (
          isObject(storedReference) &&
          storedReference.checkId === check.checkId
        ) {
          delete state.reusableResults[referenceId];
        }
      },
    );

    this.persistState(state);
    return true;
  }

  /**
   * Alias for remove.
   *
   * @param {string | number} checkId Provider check identifier.
   * @returns {boolean} Whether a check was removed.
   */
  delete(checkId) {
    return this.remove(checkId);
  }

  /**
   * Removes a reusable result reference.
   *
   * @param {string | number} referenceId Reference identifier.
   * @returns {boolean} Whether a reference was removed.
   */
  removeReusableResultReference(referenceId) {
    const state = this.readState();
    const reference = this.findReferenceInState(state, referenceId);

    if (!reference) {
      return false;
    }

    delete state.reusableResults[reference.referenceId];
    this.persistState(state);

    return true;
  }

  /**
   * Removes all provider checks and reusable references.
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
      providerCheckRepositoryStateSchema,
      createEmptyState(),
    );

    return cloneValue(state);
  }

  readChecks() {
    const state = this.readState();

    try {
      return Object.entries(state.checks).map(
        ([checkId, storedCheck]) => {
          if (!isObject(storedCheck)) {
            throw createRepositoryError(
              PROVIDER_CHECK_REPOSITORY_ERROR_CODES.INVALID_CHECK,
              `Invalid persisted provider check: ${checkId}`,
              { checkId },
            );
          }

          const check = parseCheck(storedCheck);

          if (check.checkId !== checkId) {
            throw createRepositoryError(
              PROVIDER_CHECK_REPOSITORY_ERROR_CODES.INVALID_CHECK,
              'A persisted provider check has a mismatched identifier.',
              {
                storageCheckId: checkId,
                checkId: check.checkId,
              },
            );
          }

          return check;
        },
      );
    } catch {
      this.storageAdapter.remove(this.storageKey);
      return [];
    }
  }

  readReferences() {
    const state = this.readState();

    try {
      return Object.entries(state.reusableResults).map(
        ([referenceId, storedReference]) => {
          if (!isObject(storedReference)) {
            throw createRepositoryError(
              PROVIDER_CHECK_REPOSITORY_ERROR_CODES.INVALID_REFERENCE,
              `Invalid persisted provider result reference: ${referenceId}`,
              { referenceId },
            );
          }

          const reference = parseReference(storedReference);

          if (reference.referenceId !== referenceId) {
            throw createRepositoryError(
              PROVIDER_CHECK_REPOSITORY_ERROR_CODES.INVALID_REFERENCE,
              'A persisted provider result reference has a mismatched identifier.',
              {
                storageReferenceId: referenceId,
                referenceId: reference.referenceId,
              },
            );
          }

          return reference;
        },
      );
    } catch {
      this.storageAdapter.remove(this.storageKey);
      return [];
    }
  }

  findCheckInState(state, checkId) {
    const normalizedCheckId = normalizeIdentifierForLookup(
      checkId,
      'Provider check identifier',
    );

    for (const [storedCheckId, storedCheck] of Object.entries(
      state.checks,
    )) {
      if (
        normalizeIdentifierForLookup(
          storedCheckId,
          'Provider check identifier',
        ) !== normalizedCheckId
      ) {
        continue;
      }

      const check = parseCheck(storedCheck);

      if (check.checkId !== storedCheckId) {
        throw createRepositoryError(
          PROVIDER_CHECK_REPOSITORY_ERROR_CODES.INVALID_CHECK,
          'A persisted provider check has a mismatched identifier.',
          {
            storageCheckId: storedCheckId,
            checkId: check.checkId,
          },
        );
      }

      return check;
    }

    return undefined;
  }

  findReferenceInState(state, referenceId) {
    const normalizedReferenceId = normalizeIdentifierForLookup(
      referenceId,
      'Provider result reference identifier',
    );

    for (const [storedReferenceId, storedReference] of Object.entries(
      state.reusableResults,
    )) {
      if (
        normalizeIdentifierForLookup(
          storedReferenceId,
          'Provider result reference identifier',
        ) !== normalizedReferenceId
      ) {
        continue;
      }

      const reference = parseReference(storedReference);

      if (reference.referenceId !== storedReferenceId) {
        throw createRepositoryError(
          PROVIDER_CHECK_REPOSITORY_ERROR_CODES.INVALID_REFERENCE,
          'A persisted provider result reference has a mismatched identifier.',
          {
            storageReferenceId: storedReferenceId,
            referenceId: reference.referenceId,
          },
        );
      }

      return reference;
    }

    return undefined;
  }

  assertExpectedCheck(currentCheck, options) {
    if (!currentCheck) {
      return;
    }

    if (
      options.expectedStatus !== undefined &&
      currentCheck.status !== options.expectedStatus
    ) {
      throw this.createConflictError(currentCheck, {
        expectedStatus: options.expectedStatus,
        actualStatus: currentCheck.status,
      });
    }

    if (
      options.expectedRequestedAt !== undefined &&
      currentCheck.requestedAt !== options.expectedRequestedAt
    ) {
      throw this.createConflictError(currentCheck, {
        expectedRequestedAt: options.expectedRequestedAt,
        actualRequestedAt: currentCheck.requestedAt,
      });
    }
  }

  persistState(state) {
    const result = providerCheckRepositoryStateSchema.safeParse(state);

    if (!result.success) {
      throw createRepositoryError(
        PROVIDER_CHECK_REPOSITORY_ERROR_CODES.PERSISTENCE_FAILED,
        'The provider check repository state is invalid.',
        { issues: result.error.issues },
        result.error,
      );
    }

    if (
      !this.storageAdapter.set(
        this.storageKey,
        result.data,
        providerCheckRepositoryStateSchema,
      )
    ) {
      throw this.createPersistenceError('write');
    }
  }

  createConflictError(currentCheck, details) {
    return createRepositoryError(
      PROVIDER_CHECK_REPOSITORY_ERROR_CODES.CONFLICT,
      'The provider check was changed after it was last read.',
      {
        checkId: currentCheck.checkId,
        ...details,
      },
    );
  }

  createPersistenceError(operation) {
    const storageError =
      typeof this.storageAdapter.getLastError === 'function'
        ? this.storageAdapter.getLastError()
        : undefined;

    return createRepositoryError(
      PROVIDER_CHECK_REPOSITORY_ERROR_CODES.PERSISTENCE_FAILED,
      `Unable to ${operation} persisted provider checks.`,
      {
        operation,
        storageError: storageError ?? null,
      },
      storageError,
    );
  }
}

/**
 * Creates a provider check repository.
 *
 * @param {ConstructorParameters<typeof ProviderCheckRepository>[0]} [options]
 * Repository options.
 * @returns {ProviderCheckRepository} Repository instance.
 */
export function createProviderCheckRepository(options = {}) {
  return new ProviderCheckRepository(options);
}

export const ProviderResultRepository = ProviderCheckRepository;
export const createProviderResultRepository =
  createProviderCheckRepository;

export default ProviderCheckRepository;