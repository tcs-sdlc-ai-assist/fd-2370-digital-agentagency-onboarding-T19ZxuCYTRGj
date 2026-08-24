import { z } from 'zod';
import { STORAGE_KEYS } from '../constants/storageKeys.js';
import {
  validationIssueSchema,
  validationResultSchema,
} from '../contracts/schemas.js';
import { BrowserStorageAdapter } from '../persistence/browserStorageAdapter.js';
import { toIsoTimestamp } from '../utils/dates.js';

const identifierSchema = z.string().trim().min(1);
const dateTimeSchema = z.string().datetime({ offset: true });
const nullableIdentifierSchema = identifierSchema.nullable();
const metadataSchema = z.record(z.unknown());

export const VALIDATION_REPOSITORY_STORAGE_KEY =
  `${STORAGE_KEYS.ONBOARDING}:validation-results`;

export const validationEligibilityOutcomeSchema = z
  .object({
    trackingId: identifierSchema,
    applicationId: nullableIdentifierSchema.optional(),
    applicationVersion: z.number().int().positive().optional(),
    valid: z.boolean(),
    status: identifierSchema.optional(),
    issues: z.array(validationIssueSchema).default([]),
    validationCodes: z.array(identifierSchema).default([]),
    manualReviewRequired: z.boolean().default(false),
    schemaErrors: z.array(validationIssueSchema).default([]),
    businessErrors: z.array(validationIssueSchema).default([]),
    warnings: z.array(validationIssueSchema).default([]),
    derivedValues: metadataSchema.default({}),
    validatedSections: z.array(identifierSchema).default([]),
    validationHash: identifierSchema.optional(),
    eligibility: metadataSchema.nullable().default(null),
    providerChecks: z.record(z.unknown()).default({}),
    documentPackageSummary: z.unknown().nullable().default(null),
    validatedAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
  })
  .passthrough();

export const validationRepositoryStateSchema = z
  .object({
    outcomes: z.record(z.unknown()).default({}),
  })
  .passthrough();

export const VALIDATION_REPOSITORY_ERROR_CODES = Object.freeze({
  INVALID_OUTCOME: 'VALIDATION_OUTCOME_INVALID',
  NOT_FOUND: 'VALIDATION_OUTCOME_NOT_FOUND',
  DUPLICATE_APPLICATION: 'VALIDATION_DUPLICATE_APPLICATION',
  IDENTIFIER_CHANGE: 'VALIDATION_IDENTIFIER_CHANGE',
  CONFLICT: 'VALIDATION_UPDATE_CONFLICT',
  PERSISTENCE_FAILED: 'VALIDATION_PERSISTENCE_FAILED',
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

function assertOptions(options, description = 'Validation repository options') {
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
        issue.path.length > 0 ? issue.path.join('.') : 'outcome';

      return `${path}: ${issue.message}`;
    })
    .join('; ');
}

function createRepositoryError(code, message, details, cause) {
  const error = new Error(message, {
    ...(cause === undefined ? {} : { cause }),
  });

  error.name = 'ValidationRepositoryError';
  error.code = code;
  error.details = details ?? null;

  return error;
}

function parseOutcome(outcome) {
  const result = validationEligibilityOutcomeSchema.safeParse(outcome);

  if (!result.success) {
    throw createRepositoryError(
      VALIDATION_REPOSITORY_ERROR_CODES.INVALID_OUTCOME,
      `Invalid validation outcome: ${formatValidationIssues(result.error)}`,
      { issues: result.error.issues },
      result.error,
    );
  }

  return result.data;
}

function createEmptyState() {
  return {
    outcomes: {},
  };
}

function classifyIssues(issues) {
  return {
    businessErrors: issues.filter(
      (issue) =>
        issue.severity === 'error' || issue.severity === 'blocking',
    ),
    warnings: issues.filter(
      (issue) =>
        issue.severity === 'warning' || issue.severity === 'info',
    ),
  };
}

function normalizeOutcomeInput(outcome, timestamp) {
  if (!isObject(outcome)) {
    throw new TypeError('A validation outcome must be an object.');
  }

  const nestedValidation = isObject(outcome.validation)
    ? outcome.validation
    : {};
  const mergedOutcome = {
    ...cloneValue(outcome),
    ...cloneValue(nestedValidation),
  };
  const issues = mergedOutcome.issues ?? [];
  const classifiedIssues = classifyIssues(issues);

  return {
    ...mergedOutcome,
    trackingId: normalizeIdentifier(
      mergedOutcome.trackingId,
      'Tracking identifier',
    ),
    applicationId:
      mergedOutcome.applicationId === undefined
        ? undefined
        : mergedOutcome.applicationId === null
          ? null
          : normalizeIdentifier(
              mergedOutcome.applicationId,
              'Application identifier',
            ),
    valid: mergedOutcome.valid ?? false,
    issues,
    validationCodes: normalizeIdentifierArray(
      mergedOutcome.validationCodes ?? [],
      'Validation codes',
    ),
    manualReviewRequired:
      mergedOutcome.manualReviewRequired ?? false,
    schemaErrors: mergedOutcome.schemaErrors ?? [],
    businessErrors:
      mergedOutcome.businessErrors ?? classifiedIssues.businessErrors,
    warnings: mergedOutcome.warnings ?? classifiedIssues.warnings,
    derivedValues:
      mergedOutcome.derivedValues ?? mergedOutcome.derived ?? {},
    validatedSections: normalizeIdentifierArray(
      mergedOutcome.validatedSections ?? [],
      'Validated sections',
    ),
    eligibility: mergedOutcome.eligibility ?? null,
    providerChecks: mergedOutcome.providerChecks ?? {},
    documentPackageSummary:
      mergedOutcome.documentPackageSummary ?? null,
    validatedAt:
      mergedOutcome.validatedAt ??
      mergedOutcome.checkedAt ??
      timestamp,
    updatedAt: mergedOutcome.updatedAt ?? timestamp,
  };
}

function assertCanonicalFieldsUnchanged(currentOutcome, nextOutcome) {
  CANONICAL_FIELDS.forEach((field) => {
    const currentValue = currentOutcome[field] ?? null;
    const nextValue = nextOutcome[field] ?? null;

    if (currentValue !== nextValue) {
      throw createRepositoryError(
        VALIDATION_REPOSITORY_ERROR_CODES.IDENTIFIER_CHANGE,
        `The canonical validation field "${field}" cannot be changed.`,
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

  const normalizedQuery = assertOptions(
    query,
    'Validation outcome query',
  );

  if (
    normalizedQuery.limit !== undefined &&
    (!Number.isInteger(normalizedQuery.limit) ||
      normalizedQuery.limit < 1)
  ) {
    throw new RangeError(
      'Validation outcome query limit must be a positive integer.',
    );
  }

  if (
    normalizedQuery.offset !== undefined &&
    (!Number.isInteger(normalizedQuery.offset) ||
      normalizedQuery.offset < 0)
  ) {
    throw new RangeError(
      'Validation outcome query offset must be a nonnegative integer.',
    );
  }

  if (
    normalizedQuery.valid !== undefined &&
    typeof normalizedQuery.valid !== 'boolean'
  ) {
    throw new TypeError(
      'Validation outcome valid filter must be a boolean.',
    );
  }

  if (
    normalizedQuery.manualReviewRequired !== undefined &&
    typeof normalizedQuery.manualReviewRequired !== 'boolean'
  ) {
    throw new TypeError(
      'Validation manual review filter must be a boolean.',
    );
  }

  return normalizedQuery;
}

function matchesQuery(outcome, query) {
  if (
    query.applicationId !== undefined &&
    outcome.applicationId !== query.applicationId
  ) {
    return false;
  }

  if (
    query.valid !== undefined &&
    outcome.valid !== query.valid
  ) {
    return false;
  }

  if (
    query.status !== undefined &&
    outcome.status !== query.status
  ) {
    return false;
  }

  if (
    query.manualReviewRequired !== undefined &&
    outcome.manualReviewRequired !== query.manualReviewRequired
  ) {
    return false;
  }

  if (
    query.validationCode !== undefined &&
    !outcome.validationCodes.includes(query.validationCode)
  ) {
    return false;
  }

  if (
    query.providerCode !== undefined &&
    !Object.hasOwn(outcome.providerChecks, query.providerCode)
  ) {
    return false;
  }

  return true;
}

function resolveStorageAdapter(options) {
  if (options.storageAdapter !== undefined) {
    if (!isRepositoryStorageAdapter(options.storageAdapter)) {
      throw new TypeError(
        'The validation storage adapter must provide get, set, and remove methods.',
      );
    }

    return options.storageAdapter;
  }

  if (options.storage !== undefined && !isStorageLike(options.storage)) {
    throw new TypeError(
      'The supplied validation storage implementation is invalid.',
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
 * Persists validation, eligibility, and provider-check outcomes correlated to
 * onboarding applications.
 */
export class ValidationRepository {
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
        'The validation repository clock must be a function.',
      );
    }

    this.clock = normalizedOptions.clock ?? (() => new Date());
    this.storageAdapter = resolveStorageAdapter(normalizedOptions);
    this.storageKey = normalizeIdentifier(
      normalizedOptions.storageKey ??
        VALIDATION_REPOSITORY_STORAGE_KEY,
      'Validation repository storage key',
    );
  }

  /**
   * Lists persisted outcomes.
   *
   * @param {{
   *   applicationId?: string,
   *   valid?: boolean,
   *   status?: string,
   *   manualReviewRequired?: boolean,
   *   validationCode?: string,
   *   providerCode?: string,
   *   limit?: number,
   *   offset?: number
   * }} [query] Outcome filters.
   * @returns {object[]} Matching outcomes.
   */
  list(query = {}) {
    const normalizedQuery = normalizeQuery(query);
    const offset = normalizedQuery.offset ?? 0;
    const limit = normalizedQuery.limit ?? Number.POSITIVE_INFINITY;

    return this.readOutcomes()
      .filter((outcome) => matchesQuery(outcome, normalizedQuery))
      .sort(
        (left, right) =>
          Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
      )
      .slice(offset, offset + limit)
      .map((outcome) => cloneValue(outcome));
  }

  /**
   * Alias for list.
   *
   * @param {object} [query] Outcome filters.
   * @returns {object[]} Matching outcomes.
   */
  getAll(query = {}) {
    return this.list(query);
  }

  /**
   * Finds an outcome by tracking identifier.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @returns {object | undefined} Matching outcome.
   */
  find(trackingId) {
    const normalizedTrackingId = normalizeIdentifierForLookup(
      trackingId,
      'Tracking identifier',
    );
    const outcome = this.readOutcomes().find(
      (candidate) =>
        normalizeIdentifierForLookup(
          candidate.trackingId,
          'Tracking identifier',
        ) === normalizedTrackingId,
    );

    return outcome ? cloneValue(outcome) : undefined;
  }

  /**
   * Alias for find.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @returns {object | undefined} Matching outcome.
   */
  findByTrackingId(trackingId) {
    return this.find(trackingId);
  }

  /**
   * Finds an outcome by application identifier.
   *
   * @param {string | number} applicationId Application identifier.
   * @returns {object | undefined} Matching outcome.
   */
  findByApplicationId(applicationId) {
    const normalizedApplicationId = normalizeIdentifierForLookup(
      applicationId,
      'Application identifier',
    );
    const outcome = this.readOutcomes().find(
      (candidate) =>
        candidate.applicationId !== null &&
        candidate.applicationId !== undefined &&
        normalizeIdentifierForLookup(
          candidate.applicationId,
          'Application identifier',
        ) === normalizedApplicationId,
    );

    return outcome ? cloneValue(outcome) : undefined;
  }

  /**
   * Returns an outcome or throws when it is absent.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @returns {object} Matching outcome.
   */
  get(trackingId) {
    const outcome = this.find(trackingId);

    if (!outcome) {
      throw createRepositoryError(
        VALIDATION_REPOSITORY_ERROR_CODES.NOT_FOUND,
        `Validation outcome not found: ${trackingId}`,
        { trackingId: String(trackingId) },
      );
    }

    return outcome;
  }

  /**
   * Persists a complete validation and eligibility outcome.
   *
   * @param {object} outcome Outcome to persist.
   * @param {{expectedUpdatedAt?: string}} [options] Save options.
   * @returns {object} Persisted outcome.
   */
  save(outcome, options = {}) {
    const normalizedOptions = assertOptions(
      options,
      'Validation save options',
    );
    const timestamp = toIsoTimestamp(this.clock());
    const parsedOutcome = parseOutcome(
      normalizeOutcomeInput(outcome, timestamp),
    );
    const state = this.readState();
    const currentOutcome = this.findInState(
      state,
      parsedOutcome.trackingId,
    );

    if (
      currentOutcome &&
      normalizedOptions.expectedUpdatedAt !== undefined &&
      currentOutcome.updatedAt !== normalizedOptions.expectedUpdatedAt
    ) {
      throw this.createConflictError(
        currentOutcome,
        normalizedOptions.expectedUpdatedAt,
      );
    }

    if (currentOutcome) {
      assertCanonicalFieldsUnchanged(currentOutcome, parsedOutcome);
    }

    this.assertApplicationIdAvailable(
      state,
      parsedOutcome.applicationId,
      parsedOutcome.trackingId,
    );

    state.outcomes[parsedOutcome.trackingId] =
      cloneValue(parsedOutcome);
    this.persistState(state);

    return cloneValue(parsedOutcome);
  }

  /**
   * Alias for save.
   *
   * @param {object} outcome Outcome to persist.
   * @param {object} [options] Save options.
   * @returns {object} Persisted outcome.
   */
  upsert(outcome, options = {}) {
    return this.save(outcome, options);
  }

  /**
   * Saves a canonical validation result for a tracking identifier.
   *
   * Existing eligibility and provider outcomes are retained.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @param {object} validationResult Validation result.
   * @param {{
   *   applicationId?: string | null,
   *   applicationVersion?: number,
   *   status?: string,
   *   schemaErrors?: object[],
   *   derivedValues?: Record<string, unknown>,
   *   validatedSections?: string[],
   *   validationHash?: string,
   *   expectedUpdatedAt?: string
   * }} [options] Validation metadata.
   * @returns {object} Persisted outcome.
   */
  saveValidationResult(trackingId, validationResult, options = {}) {
    const normalizedOptions = assertOptions(
      options,
      'Validation result options',
    );
    const result = validationResultSchema.safeParse(validationResult);

    if (!result.success) {
      throw createRepositoryError(
        VALIDATION_REPOSITORY_ERROR_CODES.INVALID_OUTCOME,
        `Invalid validation result: ${formatValidationIssues(result.error)}`,
        { issues: result.error.issues },
        result.error,
      );
    }

    const normalizedTrackingId = normalizeIdentifier(
      trackingId,
      'Tracking identifier',
    );
    const currentOutcome = this.find(normalizedTrackingId);
    const classifiedIssues = classifyIssues(result.data.issues);
    const timestamp = toIsoTimestamp(this.clock());
    const nextOutcome = {
      ...(currentOutcome ?? {}),
      trackingId: normalizedTrackingId,
      applicationId:
        normalizedOptions.applicationId ??
        currentOutcome?.applicationId ??
        undefined,
      applicationVersion:
        normalizedOptions.applicationVersion ??
        currentOutcome?.applicationVersion,
      valid: result.data.valid,
      status: normalizedOptions.status ?? currentOutcome?.status,
      issues: result.data.issues,
      validationCodes: result.data.validationCodes,
      manualReviewRequired: result.data.manualReviewRequired,
      schemaErrors: normalizedOptions.schemaErrors ?? [],
      businessErrors: classifiedIssues.businessErrors,
      warnings: classifiedIssues.warnings,
      derivedValues:
        normalizedOptions.derivedValues ??
        currentOutcome?.derivedValues ??
        {},
      validatedSections:
        normalizedOptions.validatedSections ??
        currentOutcome?.validatedSections ??
        [],
      validationHash:
        normalizedOptions.validationHash ??
        currentOutcome?.validationHash,
      eligibility: currentOutcome?.eligibility ?? null,
      providerChecks: currentOutcome?.providerChecks ?? {},
      documentPackageSummary:
        currentOutcome?.documentPackageSummary ?? null,
      validatedAt: result.data.checkedAt ?? timestamp,
      updatedAt: timestamp,
    };

    return this.save(nextOutcome, {
      expectedUpdatedAt: normalizedOptions.expectedUpdatedAt,
    });
  }

  /**
   * Atomically patches an existing outcome.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @param {object | ((outcome: object) => object)} update Patch or updater.
   * @param {{expectedUpdatedAt?: string, touchValidatedAt?: boolean}}
   * [options] Update options.
   * @returns {object} Updated outcome.
   */
  update(trackingId, update, options = {}) {
    const normalizedOptions = assertOptions(
      options,
      'Validation update options',
    );

    if (typeof update !== 'function' && !isObject(update)) {
      throw new TypeError(
        'A validation update must be an object or updater function.',
      );
    }

    const state = this.readState();
    const currentOutcome = this.findInState(state, trackingId);

    if (!currentOutcome) {
      throw createRepositoryError(
        VALIDATION_REPOSITORY_ERROR_CODES.NOT_FOUND,
        `Validation outcome not found: ${trackingId}`,
        { trackingId: String(trackingId) },
      );
    }

    if (
      normalizedOptions.expectedUpdatedAt !== undefined &&
      currentOutcome.updatedAt !== normalizedOptions.expectedUpdatedAt
    ) {
      throw this.createConflictError(
        currentOutcome,
        normalizedOptions.expectedUpdatedAt,
      );
    }

    const updateValue =
      typeof update === 'function'
        ? update(cloneValue(currentOutcome))
        : update;

    if (!isObject(updateValue)) {
      throw new TypeError(
        'The validation updater must return an outcome or patch object.',
      );
    }

    const timestamp = toIsoTimestamp(this.clock());
    const candidate = deepMerge(currentOutcome, updateValue);
    const nextOutcome = parseOutcome(
      normalizeOutcomeInput(
        {
          ...candidate,
          updatedAt: timestamp,
          ...(normalizedOptions.touchValidatedAt === true
            ? { validatedAt: timestamp }
            : {}),
        },
        timestamp,
      ),
    );

    assertCanonicalFieldsUnchanged(currentOutcome, nextOutcome);
    this.assertApplicationIdAvailable(
      state,
      nextOutcome.applicationId,
      nextOutcome.trackingId,
    );

    delete state.outcomes[currentOutcome.trackingId];
    state.outcomes[nextOutcome.trackingId] = cloneValue(nextOutcome);
    this.persistState(state);

    return cloneValue(nextOutcome);
  }

  /**
   * Alias for update emphasizing transactional behavior.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @param {object | ((outcome: object) => object)} update Patch or updater.
   * @param {object} [options] Update options.
   * @returns {object} Updated outcome.
   */
  atomicUpdate(trackingId, update, options = {}) {
    return this.update(trackingId, update, options);
  }

  /**
   * Stores the derived eligibility outcome.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @param {Record<string, unknown>} eligibility Eligibility outcome.
   * @param {{expectedUpdatedAt?: string}} [options] Update options.
   * @returns {object} Updated outcome.
   */
  setEligibilityOutcome(trackingId, eligibility, options = {}) {
    if (!isObject(eligibility)) {
      throw new TypeError('Eligibility outcome must be an object.');
    }

    return this.update(
      trackingId,
      {
        eligibility: cloneValue(eligibility),
        derivedValues: isObject(eligibility.derivedValues)
          ? cloneValue(eligibility.derivedValues)
          : undefined,
        manualReviewRequired:
          typeof eligibility.manualReviewRequired === 'boolean'
            ? eligibility.manualReviewRequired
            : undefined,
      },
      options,
    );
  }

  /**
   * Stores a provider check outcome under its provider code.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @param {string} providerCode Provider code.
   * @param {unknown} providerCheck Provider check outcome.
   * @param {{expectedUpdatedAt?: string}} [options] Update options.
   * @returns {object} Updated outcome.
   */
  setProviderCheck(
    trackingId,
    providerCode,
    providerCheck,
    options = {},
  ) {
    const normalizedProviderCode = normalizeIdentifier(
      providerCode,
      'Provider code',
    );

    if (providerCheck === undefined) {
      throw new TypeError('Provider check outcome is required.');
    }

    return this.update(
      trackingId,
      (outcome) => ({
        providerChecks: {
          ...outcome.providerChecks,
          [normalizedProviderCode]: cloneValue(providerCheck),
        },
      }),
      options,
    );
  }

  /**
   * Returns a provider check by tracking identifier and provider code.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @param {string} providerCode Provider code.
   * @returns {unknown | undefined} Provider check outcome.
   */
  getProviderCheck(trackingId, providerCode) {
    const outcome = this.get(trackingId);
    const normalizedProviderCode = normalizeIdentifierForLookup(
      providerCode,
      'Provider code',
    );
    const matchingEntry = Object.entries(outcome.providerChecks).find(
      ([code]) =>
        normalizeIdentifierForLookup(code, 'Provider code') ===
        normalizedProviderCode,
    );

    return matchingEntry
      ? cloneValue(matchingEntry[1])
      : undefined;
  }

  /**
   * Removes a provider check from an outcome.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @param {string} providerCode Provider code.
   * @param {{expectedUpdatedAt?: string}} [options] Update options.
   * @returns {object} Updated outcome.
   */
  removeProviderCheck(trackingId, providerCode, options = {}) {
    const normalizedProviderCode = normalizeIdentifierForLookup(
      providerCode,
      'Provider code',
    );

    return this.update(
      trackingId,
      (outcome) => ({
        providerChecks: Object.fromEntries(
          Object.entries(outcome.providerChecks).filter(
            ([code]) =>
              normalizeIdentifierForLookup(code, 'Provider code') !==
              normalizedProviderCode,
          ),
        ),
      }),
      options,
    );
  }

  /**
   * Stores a document package summary used by submission readiness checks.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @param {unknown} summary Document package summary.
   * @param {{expectedUpdatedAt?: string}} [options] Update options.
   * @returns {object} Updated outcome.
   */
  setDocumentPackageSummary(trackingId, summary, options = {}) {
    return this.update(
      trackingId,
      {
        documentPackageSummary: cloneValue(summary),
      },
      options,
    );
  }

  /**
   * Returns a display-safe validation summary.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @returns {object} Validation summary.
   */
  getValidationSummary(trackingId) {
    const outcome = this.get(trackingId);

    return {
      trackingId: outcome.trackingId,
      applicationId: outcome.applicationId ?? null,
      applicationVersion: outcome.applicationVersion ?? null,
      valid: outcome.valid,
      status: outcome.status ?? null,
      issues: cloneValue(outcome.issues),
      validationCodes: cloneValue(outcome.validationCodes),
      manualReviewRequired: outcome.manualReviewRequired,
      schemaErrors: cloneValue(outcome.schemaErrors),
      businessErrors: cloneValue(outcome.businessErrors),
      warnings: cloneValue(outcome.warnings),
      derivedValues: cloneValue(outcome.derivedValues),
      validatedSections: cloneValue(outcome.validatedSections),
      validationHash: outcome.validationHash ?? null,
      validatedAt: outcome.validatedAt,
      updatedAt: outcome.updatedAt,
    };
  }

  /**
   * Returns provider-check summary data.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @returns {object} Provider-check summary.
   */
  getProviderCheckSummary(trackingId) {
    const outcome = this.get(trackingId);

    return {
      trackingId: outcome.trackingId,
      applicationId: outcome.applicationId ?? null,
      manualReviewRequired: outcome.manualReviewRequired,
      providerChecks: cloneValue(outcome.providerChecks),
      updatedAt: outcome.updatedAt,
    };
  }

  /**
   * Returns document package summary data.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @returns {object} Document package summary.
   */
  getDocumentPackageSummary(trackingId) {
    const outcome = this.get(trackingId);

    return {
      trackingId: outcome.trackingId,
      applicationId: outcome.applicationId ?? null,
      documentPackageSummary: cloneValue(
        outcome.documentPackageSummary,
      ),
      updatedAt: outcome.updatedAt,
    };
  }

  /**
   * Removes an outcome.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @returns {boolean} Whether an outcome was removed.
   */
  remove(trackingId) {
    const state = this.readState();
    const outcome = this.findInState(state, trackingId);

    if (!outcome) {
      return false;
    }

    delete state.outcomes[outcome.trackingId];
    this.persistState(state);

    return true;
  }

  /**
   * Alias for remove.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @returns {boolean} Whether an outcome was removed.
   */
  delete(trackingId) {
    return this.remove(trackingId);
  }

  /**
   * Removes all persisted validation outcomes.
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
      validationRepositoryStateSchema,
      createEmptyState(),
    );

    return cloneValue(state);
  }

  readOutcomes() {
    const state = this.readState();

    try {
      return Object.entries(state.outcomes).map(
        ([trackingId, storedOutcome]) => {
          if (!isObject(storedOutcome)) {
            throw createRepositoryError(
              VALIDATION_REPOSITORY_ERROR_CODES.INVALID_OUTCOME,
              `Invalid persisted validation outcome: ${trackingId}`,
              { trackingId },
            );
          }

          const outcome = parseOutcome(storedOutcome);

          if (outcome.trackingId !== trackingId) {
            throw createRepositoryError(
              VALIDATION_REPOSITORY_ERROR_CODES.INVALID_OUTCOME,
              'A persisted validation outcome has a mismatched tracking identifier.',
              {
                storageTrackingId: trackingId,
                outcomeTrackingId: outcome.trackingId,
              },
            );
          }

          return outcome;
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

    for (const [storedTrackingId, storedOutcome] of Object.entries(
      state.outcomes,
    )) {
      if (
        normalizeIdentifierForLookup(
          storedTrackingId,
          'Tracking identifier',
        ) !== normalizedTrackingId
      ) {
        continue;
      }

      const outcome = parseOutcome(storedOutcome);

      if (outcome.trackingId !== storedTrackingId) {
        throw createRepositoryError(
          VALIDATION_REPOSITORY_ERROR_CODES.INVALID_OUTCOME,
          'A persisted validation outcome has a mismatched tracking identifier.',
          {
            storageTrackingId: storedTrackingId,
            outcomeTrackingId: outcome.trackingId,
          },
        );
      }

      return outcome;
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

    const collision = Object.values(state.outcomes).find(
      (storedOutcome) => {
        if (!isObject(storedOutcome)) {
          return false;
        }

        const outcome = parseOutcome(storedOutcome);

        return (
          outcome.applicationId !== null &&
          outcome.applicationId !== undefined &&
          normalizeIdentifierForLookup(
            outcome.applicationId,
            'Application identifier',
          ) === normalizedApplicationId &&
          normalizeIdentifierForLookup(
            outcome.trackingId,
            'Tracking identifier',
          ) !== normalizedTrackingId
        );
      },
    );

    if (collision) {
      throw createRepositoryError(
        VALIDATION_REPOSITORY_ERROR_CODES.DUPLICATE_APPLICATION,
        `A validation outcome already exists for application identifier: ${applicationId}`,
        {
          applicationId,
          trackingId,
          existingTrackingId: collision.trackingId,
        },
      );
    }
  }

  persistState(state) {
    const result = validationRepositoryStateSchema.safeParse(state);

    if (!result.success) {
      throw createRepositoryError(
        VALIDATION_REPOSITORY_ERROR_CODES.PERSISTENCE_FAILED,
        'The validation repository state is invalid.',
        { issues: result.error.issues },
        result.error,
      );
    }

    if (
      !this.storageAdapter.set(
        this.storageKey,
        result.data,
        validationRepositoryStateSchema,
      )
    ) {
      throw this.createPersistenceError('write');
    }
  }

  createConflictError(currentOutcome, expectedUpdatedAt) {
    return createRepositoryError(
      VALIDATION_REPOSITORY_ERROR_CODES.CONFLICT,
      'The validation outcome was changed after it was last read.',
      {
        trackingId: currentOutcome.trackingId,
        expectedUpdatedAt,
        actualUpdatedAt: currentOutcome.updatedAt,
      },
    );
  }

  createPersistenceError(operation) {
    const storageError =
      typeof this.storageAdapter.getLastError === 'function'
        ? this.storageAdapter.getLastError()
        : undefined;

    return createRepositoryError(
      VALIDATION_REPOSITORY_ERROR_CODES.PERSISTENCE_FAILED,
      `Unable to ${operation} persisted validation outcomes.`,
      {
        operation,
        storageError: storageError ?? null,
      },
      storageError,
    );
  }
}

/**
 * Creates a validation result repository.
 *
 * @param {ConstructorParameters<typeof ValidationRepository>[0]} [options]
 * Repository options.
 * @returns {ValidationRepository} Repository instance.
 */
export function createValidationRepository(options = {}) {
  return new ValidationRepository(options);
}

export const ValidationResultRepository = ValidationRepository;
export const EligibilityOutcomeRepository = ValidationRepository;
export const createValidationResultRepository =
  createValidationRepository;
export const createEligibilityOutcomeRepository =
  createValidationRepository;

export default ValidationRepository;