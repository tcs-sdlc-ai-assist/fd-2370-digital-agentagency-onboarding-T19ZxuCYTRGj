import { z } from 'zod';
import { STORAGE_KEYS } from '../constants/storageKeys.js';
import { BrowserStorageAdapter } from '../persistence/browserStorageAdapter.js';
import { toIsoTimestamp } from '../utils/dates.js';

const identifierSchema = z.string().trim().min(1);
const dateTimeSchema = z.string().datetime({ offset: true });
const nullableDateTimeSchema = dateTimeSchema.nullable();
const metadataSchema = z.record(z.unknown());

export const JOURNEY_DRAFT_SAVE_MODES = Object.freeze({
  AUTO: 'AUTO',
  MANUAL: 'MANUAL',
  SAVE_AND_EXIT: 'SAVE_AND_EXIT',
});

export const JOURNEY_SIGNATURE_STATES = Object.freeze({
  NOT_STARTED: 'NOT_STARTED',
  CONSENTED: 'CONSENTED',
  SIGNED: 'SIGNED',
  DECLINED: 'DECLINED',
  EXPIRED: 'EXPIRED',
});

export const journeySignatureSchema = z
  .object({
    status: z
      .enum(Object.values(JOURNEY_SIGNATURE_STATES))
      .default(JOURNEY_SIGNATURE_STATES.NOT_STARTED),
    consented: z.boolean().default(false),
    signedBy: identifierSchema.nullable().optional(),
    consentedAt: nullableDateTimeSchema.optional(),
    signedAt: nullableDateTimeSchema.optional(),
    declinedAt: nullableDateTimeSchema.optional(),
    expiresAt: nullableDateTimeSchema.optional(),
    envelopeId: identifierSchema.nullable().optional(),
    metadata: metadataSchema.optional(),
  })
  .passthrough();

export const journeyCompletionStateSchema = z
  .object({
    completed: z.boolean().default(false),
    percentComplete: z.number().min(0).max(100).default(0),
    completedSteps: z.array(identifierSchema).default([]),
    skippedSteps: z.array(identifierSchema).default([]),
    packageComplete: z.boolean().default(false),
    submissionReady: z.boolean().default(false),
  })
  .passthrough();

export const journeyDraftSchema = z
  .object({
    trackingId: identifierSchema,
    applicationId: identifierSchema.nullable().optional(),
    partnerCode: identifierSchema,
    journeyType: identifierSchema,
    status: identifierSchema.default('APPLICATION_STARTED'),
    currentStepId: identifierSchema.default('start'),
    resumeUrl: identifierSchema,
    formState: metadataSchema.default({}),
    dirtySections: z.array(identifierSchema).default([]),
    completedSteps: z.array(identifierSchema).default([]),
    skippedSteps: z.array(identifierSchema).default([]),
    completionState: journeyCompletionStateSchema.default({}),
    signatures: z.record(journeySignatureSchema).default({}),
    lastValidationResult: z.unknown().nullable().default(null),
    saveMode: z
      .enum(Object.values(JOURNEY_DRAFT_SAVE_MODES))
      .default(JOURNEY_DRAFT_SAVE_MODES.MANUAL),
    version: z.number().int().positive().default(1),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    lastSavedAt: dateTimeSchema,
    expiresAt: nullableDateTimeSchema.default(null),
    submittedAt: nullableDateTimeSchema.optional(),
    metadata: metadataSchema.default({}),
  })
  .passthrough();

export const journeyDraftRepositoryStateSchema = z
  .object({
    drafts: z.record(z.unknown()).default({}),
  })
  .passthrough();

export const JOURNEY_DRAFT_REPOSITORY_ERROR_CODES = Object.freeze({
  INVALID_DRAFT: 'JOURNEY_DRAFT_INVALID',
  NOT_FOUND: 'JOURNEY_DRAFT_NOT_FOUND',
  DUPLICATE: 'JOURNEY_DRAFT_DUPLICATE',
  PARTNER_SCOPE_MISMATCH: 'JOURNEY_DRAFT_PARTNER_SCOPE_MISMATCH',
  IDENTIFIER_CHANGE: 'JOURNEY_DRAFT_IDENTIFIER_CHANGE',
  CONFLICT: 'JOURNEY_DRAFT_UPDATE_CONFLICT',
  PERSISTENCE_FAILED: 'JOURNEY_DRAFT_PERSISTENCE_FAILED',
});

const CANONICAL_FIELDS = Object.freeze(['trackingId', 'partnerCode']);

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

function assertOptions(options, description = 'Journey draft options') {
  if (!isObject(options)) {
    throw new TypeError(`${description} must be an object.`);
  }

  return options;
}

function normalizeIdentifier(value, description) {
  if (
    value === null ||
    value === undefined ||
    String(value).trim() === ''
  ) {
    throw new TypeError(`${description} must be a non-empty value.`);
  }

  return String(value).trim();
}

function normalizeIdentifierForLookup(value, description) {
  return normalizeIdentifier(value, description)
    .normalize('NFKC')
    .toLowerCase();
}

function normalizeStringArray(values, description) {
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
      const path = issue.path.length > 0 ? issue.path.join('.') : 'draft';

      return `${path}: ${issue.message}`;
    })
    .join('; ');
}

function createRepositoryError(code, message, details, cause) {
  const error = new Error(message, {
    ...(cause === undefined ? {} : { cause }),
  });

  error.name = 'JourneyDraftRepositoryError';
  error.code = code;
  error.details = details ?? null;

  return error;
}

function parseDraft(draft) {
  const result = journeyDraftSchema.safeParse(draft);

  if (!result.success) {
    throw createRepositoryError(
      JOURNEY_DRAFT_REPOSITORY_ERROR_CODES.INVALID_DRAFT,
      `Invalid journey draft: ${formatValidationIssues(result.error)}`,
      { issues: result.error.issues },
      result.error,
    );
  }

  return synchronizeCompletionState(result.data);
}

function createEmptyState() {
  return {
    drafts: {},
  };
}

function synchronizeCompletionState(draft) {
  const completedSteps = normalizeStringArray(
    draft.completedSteps ?? draft.completionState.completedSteps,
    'Completed journey steps',
  );
  const skippedSteps = normalizeStringArray(
    draft.skippedSteps ?? draft.completionState.skippedSteps,
    'Skipped journey steps',
  );

  return {
    ...draft,
    completedSteps,
    skippedSteps,
    completionState: {
      ...draft.completionState,
      completedSteps,
      skippedSteps,
    },
  };
}

function assertCanonicalFieldsUnchanged(currentDraft, nextDraft) {
  CANONICAL_FIELDS.forEach((field) => {
    if (currentDraft[field] !== nextDraft[field]) {
      throw createRepositoryError(
        JOURNEY_DRAFT_REPOSITORY_ERROR_CODES.IDENTIFIER_CHANGE,
        `The canonical journey draft field "${field}" cannot be changed.`,
        {
          field,
          currentValue: currentDraft[field],
          requestedValue: nextDraft[field],
        },
      );
    }
  });
}

function normalizeQuery(query) {
  if (query === undefined) {
    return {};
  }

  const normalizedQuery = assertOptions(query, 'Journey draft query');

  if (
    normalizedQuery.limit !== undefined &&
    (!Number.isInteger(normalizedQuery.limit) || normalizedQuery.limit < 1)
  ) {
    throw new RangeError(
      'Journey draft query limit must be a positive integer.',
    );
  }

  if (
    normalizedQuery.offset !== undefined &&
    (!Number.isInteger(normalizedQuery.offset) ||
      normalizedQuery.offset < 0)
  ) {
    throw new RangeError(
      'Journey draft query offset must be a nonnegative integer.',
    );
  }

  if (
    normalizedQuery.resumable !== undefined &&
    typeof normalizedQuery.resumable !== 'boolean'
  ) {
    throw new TypeError(
      'Journey draft resumable filter must be a boolean.',
    );
  }

  return normalizedQuery;
}

function isExpired(draft, referenceTime) {
  if (draft.expiresAt === null || draft.expiresAt === undefined) {
    return false;
  }

  return Date.parse(draft.expiresAt) < referenceTime;
}

function matchesQuery(draft, query, referenceTime) {
  if (
    query.applicationId !== undefined &&
    draft.applicationId !== query.applicationId
  ) {
    return false;
  }

  if (
    query.journeyType !== undefined &&
    draft.journeyType !== query.journeyType
  ) {
    return false;
  }

  if (query.status !== undefined && draft.status !== query.status) {
    return false;
  }

  if (
    query.currentStepId !== undefined &&
    draft.currentStepId !== query.currentStepId
  ) {
    return false;
  }

  if (
    query.resumable === true &&
    (draft.completionState.completed || isExpired(draft, referenceTime))
  ) {
    return false;
  }

  if (
    query.resumable === false &&
    !draft.completionState.completed &&
    !isExpired(draft, referenceTime)
  ) {
    return false;
  }

  return true;
}

function buildDefaultResumeUrl(journeyType, trackingId, currentStepId) {
  return `/journeys/${encodeURIComponent(
    journeyType,
  )}/${encodeURIComponent(trackingId)}/${encodeURIComponent(currentStepId)}`;
}

function resolveStorageAdapter(options) {
  if (options.storageAdapter !== undefined) {
    if (!isRepositoryStorageAdapter(options.storageAdapter)) {
      throw new TypeError(
        'The journey draft storage adapter must provide get, set, and remove methods.',
      );
    }

    return options.storageAdapter;
  }

  if (options.storage !== undefined && !isStorageLike(options.storage)) {
    throw new TypeError(
      'The supplied journey draft storage implementation is invalid.',
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
 * Builds the partner-scoped storage key used for journey drafts.
 *
 * @param {string} partnerCode Partner organization code.
 * @param {string} [baseStorageKey] Base onboarding storage key.
 * @returns {string} Partner-scoped journey draft storage key.
 */
export function getJourneyDraftStorageKey(
  partnerCode,
  baseStorageKey = STORAGE_KEYS.ONBOARDING,
) {
  const normalizedPartnerCode = normalizeIdentifierForLookup(
    partnerCode,
    'Partner code',
  );
  const normalizedBaseKey = normalizeIdentifier(
    baseStorageKey,
    'Journey draft base storage key',
  );

  return `${normalizedBaseKey}:journey-drafts:${encodeURIComponent(
    normalizedPartnerCode,
  )}`;
}

/**
 * Local, partner-scoped repository for guided journey drafts.
 */
export class JourneyDraftRepository {
  /**
   * @param {{
   *   partnerCode: string,
   *   storageAdapter?: object,
   *   storage?: Storage,
   *   storageKey?: string,
   *   baseStorageKey?: string,
   *   namespace?: string,
   *   schemaVersion?: number,
   *   clock?: () => Date | string | number,
   *   onStorageError?: (error: object) => void
   * }} options Repository options.
   */
  constructor(options) {
    const normalizedOptions = assertOptions(options);

    if (
      normalizedOptions.clock !== undefined &&
      typeof normalizedOptions.clock !== 'function'
    ) {
      throw new TypeError('The journey draft repository clock must be a function.');
    }

    this.partnerCode = normalizeIdentifier(
      normalizedOptions.partnerCode,
      'Partner code',
    );
    this.normalizedPartnerCode = normalizeIdentifierForLookup(
      this.partnerCode,
      'Partner code',
    );
    this.clock = normalizedOptions.clock ?? (() => new Date());
    this.storageAdapter = resolveStorageAdapter(normalizedOptions);
    this.storageKey =
      normalizedOptions.storageKey === undefined
        ? getJourneyDraftStorageKey(
            this.partnerCode,
            normalizedOptions.baseStorageKey ?? STORAGE_KEYS.ONBOARDING,
          )
        : normalizeIdentifier(
            normalizedOptions.storageKey,
            'Journey draft storage key',
          );
  }

  /**
   * Lists drafts within the repository partner scope.
   *
   * @param {{
   *   applicationId?: string,
   *   journeyType?: string,
   *   status?: string,
   *   currentStepId?: string,
   *   resumable?: boolean,
   *   limit?: number,
   *   offset?: number
   * }} [query] Draft filters.
   * @returns {object[]} Matching drafts.
   */
  list(query = {}) {
    const normalizedQuery = normalizeQuery(query);
    const offset = normalizedQuery.offset ?? 0;
    const limit = normalizedQuery.limit ?? Number.POSITIVE_INFINITY;
    const referenceTime = new Date(this.clock()).getTime();

    if (Number.isNaN(referenceTime)) {
      throw new RangeError('The journey draft repository clock is invalid.');
    }

    return this.readDrafts()
      .filter((draft) =>
        matchesQuery(draft, normalizedQuery, referenceTime),
      )
      .sort(
        (left, right) =>
          Date.parse(right.lastSavedAt) - Date.parse(left.lastSavedAt),
      )
      .slice(offset, offset + limit)
      .map((draft) => cloneValue(draft));
  }

  /**
   * Alias for list.
   *
   * @param {object} [query] Draft filters.
   * @returns {object[]} Matching drafts.
   */
  getAll(query = {}) {
    return this.list(query);
  }

  /**
   * Finds a draft by tracking identifier.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @returns {object | undefined} Matching draft.
   */
  find(trackingId) {
    const normalizedTrackingId = normalizeIdentifierForLookup(
      trackingId,
      'Tracking identifier',
    );
    const draft = this.readDrafts().find(
      (candidate) =>
        normalizeIdentifierForLookup(
          candidate.trackingId,
          'Tracking identifier',
        ) === normalizedTrackingId,
    );

    return draft ? cloneValue(draft) : undefined;
  }

  /**
   * Alias for find.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @returns {object | undefined} Matching draft.
   */
  findByTrackingId(trackingId) {
    return this.find(trackingId);
  }

  /**
   * Finds a draft by application identifier.
   *
   * @param {string | number} applicationId Application identifier.
   * @returns {object | undefined} Matching draft.
   */
  findByApplicationId(applicationId) {
    const normalizedApplicationId = normalizeIdentifierForLookup(
      applicationId,
      'Application identifier',
    );
    const draft = this.readDrafts().find(
      (candidate) =>
        candidate.applicationId !== null &&
        candidate.applicationId !== undefined &&
        normalizeIdentifierForLookup(
          candidate.applicationId,
          'Application identifier',
        ) === normalizedApplicationId,
    );

    return draft ? cloneValue(draft) : undefined;
  }

  /**
   * Returns a draft or throws when it is absent.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @returns {object} Matching draft.
   */
  get(trackingId) {
    const draft = this.find(trackingId);

    if (!draft) {
      throw createRepositoryError(
        JOURNEY_DRAFT_REPOSITORY_ERROR_CODES.NOT_FOUND,
        `Journey draft not found: ${trackingId}`,
        { trackingId: String(trackingId) },
      );
    }

    return draft;
  }

  /**
   * Alias for get used by journey orchestration services.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @returns {object} Matching draft.
   */
  loadDraft(trackingId) {
    return this.get(trackingId);
  }

  /**
   * Creates a new partner-scoped journey draft.
   *
   * @param {object} draft Initial draft values.
   * @returns {object} Created draft.
   */
  create(draft) {
    if (!isObject(draft)) {
      throw new TypeError('A journey draft must be an object.');
    }

    const trackingId = normalizeIdentifier(
      draft.trackingId,
      'Tracking identifier',
    );

    if (this.find(trackingId)) {
      throw createRepositoryError(
        JOURNEY_DRAFT_REPOSITORY_ERROR_CODES.DUPLICATE,
        `A journey draft already exists for tracking identifier: ${trackingId}`,
        { trackingId },
      );
    }

    const journeyType = normalizeIdentifier(
      draft.journeyType,
      'Journey type',
    );
    const currentStepId =
      draft.currentStepId === undefined
        ? 'start'
        : normalizeIdentifier(draft.currentStepId, 'Current step identifier');
    const timestamp = toIsoTimestamp(this.clock());
    const candidate = {
      ...cloneValue(draft),
      trackingId,
      partnerCode: draft.partnerCode ?? this.partnerCode,
      journeyType,
      currentStepId,
      resumeUrl:
        draft.resumeUrl ??
        buildDefaultResumeUrl(journeyType, trackingId, currentStepId),
      createdAt: draft.createdAt ?? timestamp,
      updatedAt: draft.updatedAt ?? timestamp,
      lastSavedAt: draft.lastSavedAt ?? timestamp,
      version: draft.version ?? 1,
    };
    const parsedDraft = parseDraft(candidate);

    this.assertPartnerScope(parsedDraft);
    this.persistDraft(parsedDraft);

    return cloneValue(parsedDraft);
  }

  /**
   * Persists a complete draft, creating it when it does not yet exist.
   *
   * @param {object} draft Complete draft.
   * @param {{expectedVersion?: number}} [options] Save options.
   * @returns {object} Persisted draft.
   */
  save(draft, options = {}) {
    const normalizedOptions = assertOptions(
      options,
      'Journey draft save options',
    );

    if (!isObject(draft)) {
      throw new TypeError('A journey draft must be an object.');
    }

    const timestamp = toIsoTimestamp(this.clock());
    const candidate = {
      ...cloneValue(draft),
      partnerCode: draft.partnerCode ?? this.partnerCode,
      createdAt: draft.createdAt ?? timestamp,
      updatedAt: draft.updatedAt ?? timestamp,
      lastSavedAt: draft.lastSavedAt ?? timestamp,
      version: draft.version ?? 1,
    };
    const parsedDraft = parseDraft(candidate);

    this.assertPartnerScope(parsedDraft);

    const currentDraft = this.find(parsedDraft.trackingId);

    if (
      currentDraft &&
      normalizedOptions.expectedVersion !== undefined &&
      currentDraft.version !== normalizedOptions.expectedVersion
    ) {
      throw this.createConflictError(
        currentDraft,
        normalizedOptions.expectedVersion,
      );
    }

    if (currentDraft) {
      assertCanonicalFieldsUnchanged(currentDraft, parsedDraft);
    }

    this.persistDraft(parsedDraft);
    return cloneValue(parsedDraft);
  }

  /**
   * Alias for save.
   *
   * @param {object} draft Complete draft.
   * @param {object} [options] Save options.
   * @returns {object} Persisted draft.
   */
  upsert(draft, options = {}) {
    return this.save(draft, options);
  }

  /**
   * Atomically patches an existing draft and increments its version.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @param {object | ((draft: object) => object)} update Patch or updater.
   * @param {{
   *   expectedVersion?: number,
   *   saveMode?: 'AUTO' | 'MANUAL' | 'SAVE_AND_EXIT',
   *   touchUpdatedAt?: boolean
   * }} [options] Update options.
   * @returns {object} Updated draft.
   */
  update(trackingId, update, options = {}) {
    const normalizedOptions = assertOptions(
      options,
      'Journey draft update options',
    );

    if (typeof update !== 'function' && !isObject(update)) {
      throw new TypeError(
        'A journey draft update must be an object or updater function.',
      );
    }

    const state = this.readState();
    const currentDraft = this.findInState(state, trackingId);

    if (!currentDraft) {
      throw createRepositoryError(
        JOURNEY_DRAFT_REPOSITORY_ERROR_CODES.NOT_FOUND,
        `Journey draft not found: ${trackingId}`,
        { trackingId: String(trackingId) },
      );
    }

    if (
      normalizedOptions.expectedVersion !== undefined &&
      currentDraft.version !== normalizedOptions.expectedVersion
    ) {
      throw this.createConflictError(
        currentDraft,
        normalizedOptions.expectedVersion,
      );
    }

    const updateValue =
      typeof update === 'function'
        ? update(cloneValue(currentDraft))
        : update;

    if (!isObject(updateValue)) {
      throw new TypeError(
        'The journey draft updater must return a draft or patch object.',
      );
    }

    const timestamp = toIsoTimestamp(this.clock());
    let nextDraft = deepMerge(currentDraft, updateValue);

    nextDraft = {
      ...nextDraft,
      version: currentDraft.version + 1,
      saveMode:
        normalizedOptions.saveMode ??
        nextDraft.saveMode ??
        JOURNEY_DRAFT_SAVE_MODES.MANUAL,
      lastSavedAt: timestamp,
      ...(normalizedOptions.touchUpdatedAt === false
        ? {}
        : { updatedAt: timestamp }),
    };

    nextDraft = parseDraft(nextDraft);

    this.assertPartnerScope(nextDraft);
    assertCanonicalFieldsUnchanged(currentDraft, nextDraft);
    this.persistDraft(nextDraft, state);

    return cloneValue(nextDraft);
  }

  /**
   * Alias for update emphasizing transactional behavior.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @param {object | ((draft: object) => object)} update Patch or updater.
   * @param {object} [options] Update options.
   * @returns {object} Updated draft.
   */
  atomicUpdate(trackingId, update, options = {}) {
    return this.update(trackingId, update, options);
  }

  /**
   * Saves form and resume state for a journey.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @param {{
   *   formState?: Record<string, unknown>,
   *   currentStepId?: string,
   *   resumeUrl?: string,
   *   dirtySections?: string[],
   *   lastValidationResult?: unknown,
   *   completedSteps?: string[],
   *   skippedSteps?: string[]
   * }} patch Draft patch.
   * @param {object} [options] Save options.
   * @returns {object} Updated draft.
   */
  saveDraft(trackingId, patch, options = {}) {
    return this.update(trackingId, patch, options);
  }

  /**
   * Marks a journey step as complete.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @param {string} stepId Completed step identifier.
   * @param {{
   *   nextStepId?: string,
   *   resumeUrl?: string,
   *   percentComplete?: number,
   *   expectedVersion?: number
   * }} [options] Completion options.
   * @returns {object} Updated draft.
   */
  markStepCompleted(trackingId, stepId, options = {}) {
    const normalizedOptions = assertOptions(
      options,
      'Journey step completion options',
    );
    const normalizedStepId = normalizeIdentifier(
      stepId,
      'Journey step identifier',
    );

    return this.update(
      trackingId,
      (draft) => {
        const completedSteps = normalizeStringArray(
          [...draft.completedSteps, normalizedStepId],
          'Completed journey steps',
        );
        const currentStepId =
          normalizedOptions.nextStepId ?? draft.currentStepId;

        return {
          completedSteps,
          currentStepId,
          resumeUrl:
            normalizedOptions.resumeUrl ??
            (normalizedOptions.nextStepId === undefined
              ? draft.resumeUrl
              : buildDefaultResumeUrl(
                  draft.journeyType,
                  draft.trackingId,
                  currentStepId,
                )),
          completionState: {
            ...draft.completionState,
            completedSteps,
            ...(normalizedOptions.percentComplete === undefined
              ? {}
              : {
                  percentComplete: normalizedOptions.percentComplete,
                }),
          },
        };
      },
      {
        expectedVersion: normalizedOptions.expectedVersion,
        saveMode:
          normalizedOptions.saveMode ?? JOURNEY_DRAFT_SAVE_MODES.MANUAL,
      },
    );
  }

  /**
   * Marks or replaces the journey's skipped steps.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @param {string[]} skippedSteps Skipped step identifiers.
   * @param {{expectedVersion?: number}} [options] Update options.
   * @returns {object} Updated draft.
   */
  setSkippedSteps(trackingId, skippedSteps, options = {}) {
    const normalizedSkippedSteps = normalizeStringArray(
      skippedSteps,
      'Skipped journey steps',
    );

    return this.update(
      trackingId,
      {
        skippedSteps: normalizedSkippedSteps,
        completionState: {
          skippedSteps: normalizedSkippedSteps,
        },
      },
      options,
    );
  }

  /**
   * Stores a signature or e-signature state.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @param {string} signatureType Signature type.
   * @param {object} signature Signature state.
   * @param {{expectedVersion?: number}} [options] Update options.
   * @returns {object} Updated draft.
   */
  setSignature(trackingId, signatureType, signature, options = {}) {
    const normalizedSignatureType = normalizeIdentifier(
      signatureType,
      'Signature type',
    );

    if (!isObject(signature)) {
      throw new TypeError('Journey signature state must be an object.');
    }

    return this.update(
      trackingId,
      (draft) => ({
        signatures: {
          ...draft.signatures,
          [normalizedSignatureType]: {
            ...(draft.signatures[normalizedSignatureType] ?? {}),
            ...cloneValue(signature),
          },
        },
      }),
      options,
    );
  }

  /**
   * Records electronic-signature consent.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @param {string} signatureType Signature type.
   * @param {{consented?: boolean, signedBy?: string, metadata?: object}}
   * consent Consent details.
   * @param {{expectedVersion?: number}} [options] Update options.
   * @returns {object} Updated draft.
   */
  markESignConsent(
    trackingId,
    signatureType,
    consent,
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

    return this.setSignature(
      trackingId,
      signatureType,
      {
        ...cloneValue(normalizedConsent),
        consented,
        status: consented
          ? JOURNEY_SIGNATURE_STATES.CONSENTED
          : JOURNEY_SIGNATURE_STATES.NOT_STARTED,
        consentedAt: consented ? toIsoTimestamp(this.clock()) : null,
      },
      options,
    );
  }

  /**
   * Marks the journey as complete and optionally submission-ready.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @param {{
   *   submissionReady?: boolean,
   *   packageComplete?: boolean,
   *   status?: string,
   *   expectedVersion?: number
   * }} [options] Completion options.
   * @returns {object} Updated draft.
   */
  markCompleted(trackingId, options = {}) {
    const normalizedOptions = assertOptions(
      options,
      'Journey completion options',
    );

    return this.update(
      trackingId,
      {
        ...(normalizedOptions.status === undefined
          ? {}
          : { status: normalizedOptions.status }),
        completionState: {
          completed: true,
          percentComplete: 100,
          submissionReady: normalizedOptions.submissionReady ?? true,
          packageComplete: normalizedOptions.packageComplete ?? false,
        },
      },
      {
        expectedVersion: normalizedOptions.expectedVersion,
        saveMode: JOURNEY_DRAFT_SAVE_MODES.MANUAL,
      },
    );
  }

  /**
   * Returns resume-safe metadata without the full form payload.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @returns {object} Resume metadata.
   */
  getResumeContext(trackingId) {
    return this.toResumeContext(this.get(trackingId));
  }

  /**
   * Alias for getResumeContext.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @returns {object} Resume metadata.
   */
  getResumeContextByTrackingId(trackingId) {
    return this.getResumeContext(trackingId);
  }

  /**
   * Lists resumable draft metadata for the repository partner.
   *
   * @param {object} [query] Additional draft filters.
   * @returns {object[]} Resume metadata.
   */
  listResumeContexts(query = {}) {
    return this.list({
      ...query,
      resumable: true,
    }).map((draft) => this.toResumeContext(draft));
  }

  /**
   * Alias for listResumeContexts.
   *
   * @param {object} [query] Additional draft filters.
   * @returns {object[]} Resume metadata.
   */
  listDraftsByPartnerCode(query = {}) {
    return this.listResumeContexts(query);
  }

  /**
   * Removes a journey draft.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @returns {boolean} Whether a draft was removed.
   */
  remove(trackingId) {
    const state = this.readState();
    const draft = this.findInState(state, trackingId);

    if (!draft) {
      return false;
    }

    delete state.drafts[draft.trackingId];
    this.persistState(state);

    return true;
  }

  /**
   * Alias for remove.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @returns {boolean} Whether a draft was removed.
   */
  delete(trackingId) {
    return this.remove(trackingId);
  }

  /**
   * Removes all drafts for this repository's partner scope.
   *
   * @returns {boolean} Whether the scoped storage removal succeeded.
   */
  reset() {
    const removed = this.storageAdapter.remove(this.storageKey);

    if (!removed) {
      throw this.createPersistenceError('reset');
    }

    return true;
  }

  assertPartnerScope(draft) {
    const draftPartnerCode = normalizeIdentifierForLookup(
      draft.partnerCode,
      'Draft partner code',
    );

    if (draftPartnerCode !== this.normalizedPartnerCode) {
      throw createRepositoryError(
        JOURNEY_DRAFT_REPOSITORY_ERROR_CODES.PARTNER_SCOPE_MISMATCH,
        'The journey draft does not belong to this partner scope.',
        {
          repositoryPartnerCode: this.partnerCode,
          draftPartnerCode: draft.partnerCode,
          trackingId: draft.trackingId,
        },
      );
    }
  }

  readState() {
    const state = this.storageAdapter.get(
      this.storageKey,
      journeyDraftRepositoryStateSchema,
      createEmptyState(),
    );

    return cloneValue(state);
  }

  readDrafts() {
    const state = this.readState();

    try {
      return Object.entries(state.drafts).map(
        ([trackingId, storedDraft]) => {
          if (!isObject(storedDraft)) {
            throw createRepositoryError(
              JOURNEY_DRAFT_REPOSITORY_ERROR_CODES.INVALID_DRAFT,
              `Invalid persisted journey draft: ${trackingId}`,
              { trackingId },
            );
          }

          const draft = parseDraft(storedDraft);

          if (draft.trackingId !== trackingId) {
            throw createRepositoryError(
              JOURNEY_DRAFT_REPOSITORY_ERROR_CODES.INVALID_DRAFT,
              'A persisted journey draft has a mismatched tracking identifier.',
              {
                storageTrackingId: trackingId,
                draftTrackingId: draft.trackingId,
              },
            );
          }

          this.assertPartnerScope(draft);
          return draft;
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

    for (const [storedTrackingId, storedDraft] of Object.entries(
      state.drafts,
    )) {
      if (
        normalizeIdentifierForLookup(
          storedTrackingId,
          'Tracking identifier',
        ) !== normalizedTrackingId
      ) {
        continue;
      }

      const draft = parseDraft(storedDraft);

      this.assertPartnerScope(draft);
      return draft;
    }

    return undefined;
  }

  persistDraft(draft, existingState) {
    const state = existingState ?? this.readState();

    state.drafts[draft.trackingId] = cloneValue(draft);
    this.persistState(state);
  }

  persistState(state) {
    const result = journeyDraftRepositoryStateSchema.safeParse(state);

    if (!result.success) {
      throw createRepositoryError(
        JOURNEY_DRAFT_REPOSITORY_ERROR_CODES.PERSISTENCE_FAILED,
        'The journey draft repository state is invalid.',
        { issues: result.error.issues },
        result.error,
      );
    }

    if (
      !this.storageAdapter.set(
        this.storageKey,
        result.data,
        journeyDraftRepositoryStateSchema,
      )
    ) {
      throw this.createPersistenceError('write');
    }
  }

  toResumeContext(draft) {
    return {
      trackingId: draft.trackingId,
      applicationId: draft.applicationId ?? null,
      partnerCode: draft.partnerCode,
      journeyType: draft.journeyType,
      status: draft.status,
      currentStepId: draft.currentStepId,
      resumeUrl: draft.resumeUrl,
      completedSteps: cloneValue(draft.completedSteps),
      skippedSteps: cloneValue(draft.skippedSteps),
      completionState: cloneValue(draft.completionState),
      version: draft.version,
      lastSavedAt: draft.lastSavedAt,
      expiresAt: draft.expiresAt,
    };
  }

  createConflictError(currentDraft, expectedVersion) {
    return createRepositoryError(
      JOURNEY_DRAFT_REPOSITORY_ERROR_CODES.CONFLICT,
      'The journey draft was changed after it was last read.',
      {
        trackingId: currentDraft.trackingId,
        expectedVersion,
        actualVersion: currentDraft.version,
      },
    );
  }

  createPersistenceError(operation) {
    const storageError =
      typeof this.storageAdapter.getLastError === 'function'
        ? this.storageAdapter.getLastError()
        : undefined;

    return createRepositoryError(
      JOURNEY_DRAFT_REPOSITORY_ERROR_CODES.PERSISTENCE_FAILED,
      `Unable to ${operation} persisted journey drafts.`,
      {
        operation,
        partnerCode: this.partnerCode,
        storageError: storageError ?? null,
      },
      storageError,
    );
  }
}

/**
 * Creates a partner-scoped journey draft repository.
 *
 * @param {ConstructorParameters<typeof JourneyDraftRepository>[0]} options
 * Repository options.
 * @returns {JourneyDraftRepository} Repository instance.
 */
export function createJourneyDraftRepository(options) {
  return new JourneyDraftRepository(options);
}

export const JourneyRepository = JourneyDraftRepository;
export const createJourneyRepository = createJourneyDraftRepository;

export default JourneyDraftRepository;