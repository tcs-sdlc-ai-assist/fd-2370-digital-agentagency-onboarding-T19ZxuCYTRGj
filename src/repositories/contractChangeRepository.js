import { z } from 'zod';
import { STORAGE_KEYS } from '../constants/storageKeys.js';
import { changeRequestSchema } from '../contracts/schemas.js';
import { BrowserStorageAdapter } from '../persistence/browserStorageAdapter.js';
import { getSeeds } from '../persistence/seedLoader.js';
import { toIsoTimestamp } from '../utils/dates.js';
import { createDeterministicId } from '../utils/ids.js';

const identifierSchema = z.string().trim().min(1);

export const CONTRACT_CHANGE_REPOSITORY_STORAGE_KEY =
  `${STORAGE_KEYS.OPERATIONS}:contract-changes`;

export const CONTRACT_CHANGE_TYPES = Object.freeze({
  HIERARCHY: 'hierarchy',
  COMMISSION_SCHEDULE: 'commission_schedule',
  LEVEL: 'level',
  ASSIGNEE: 'assignee',
});

export const CONTRACT_CHANGE_STATUSES = Object.freeze({
  SUBMITTED: 'submitted',
  UNDER_REVIEW: 'under_review',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  MANUAL_ROUTED: 'manual_routed',
  COMPLETED: 'completed',
});

export const TERMINAL_CONTRACT_CHANGE_STATUSES = Object.freeze([
  CONTRACT_CHANGE_STATUSES.REJECTED,
  CONTRACT_CHANGE_STATUSES.COMPLETED,
]);

export const contractChangeRepositoryStateSchema = z
  .object({
    overlays: z.record(z.unknown()).default({}),
    removedChangeRequestIds: z.array(identifierSchema).default([]),
  })
  .passthrough();

export const CONTRACT_CHANGE_REPOSITORY_ERROR_CODES = Object.freeze({
  INVALID_CHANGE_REQUEST: 'CONTRACT_CHANGE_INVALID',
  NOT_FOUND: 'CONTRACT_CHANGE_NOT_FOUND',
  DUPLICATE_IDENTIFIER: 'CONTRACT_CHANGE_DUPLICATE_IDENTIFIER',
  IDENTIFIER_CHANGE: 'CONTRACT_CHANGE_IDENTIFIER_CHANGE',
  INVALID_CHANGE_TYPE: 'CONTRACT_CHANGE_INVALID_TYPE',
  INVALID_STATUS: 'CONTRACT_CHANGE_INVALID_STATUS',
  INVALID_STATUS_TRANSITION: 'CONTRACT_CHANGE_INVALID_STATUS_TRANSITION',
  CONFLICT: 'CONTRACT_CHANGE_UPDATE_CONFLICT',
  PERSISTENCE_FAILED: 'CONTRACT_CHANGE_PERSISTENCE_FAILED',
});

const CANONICAL_FIELDS = Object.freeze([
  'changeRequestId',
  'trackingId',
  'partnerCode',
  'changeType',
  'requestedBy',
  'createdAt',
]);

const ALLOWED_STATUS_TRANSITIONS = Object.freeze({
  [CONTRACT_CHANGE_STATUSES.SUBMITTED]: Object.freeze([
    CONTRACT_CHANGE_STATUSES.UNDER_REVIEW,
    CONTRACT_CHANGE_STATUSES.APPROVED,
    CONTRACT_CHANGE_STATUSES.REJECTED,
    CONTRACT_CHANGE_STATUSES.MANUAL_ROUTED,
    CONTRACT_CHANGE_STATUSES.COMPLETED,
  ]),
  [CONTRACT_CHANGE_STATUSES.UNDER_REVIEW]: Object.freeze([
    CONTRACT_CHANGE_STATUSES.APPROVED,
    CONTRACT_CHANGE_STATUSES.REJECTED,
    CONTRACT_CHANGE_STATUSES.MANUAL_ROUTED,
    CONTRACT_CHANGE_STATUSES.COMPLETED,
  ]),
  [CONTRACT_CHANGE_STATUSES.APPROVED]: Object.freeze([
    CONTRACT_CHANGE_STATUSES.COMPLETED,
  ]),
  [CONTRACT_CHANGE_STATUSES.REJECTED]: Object.freeze([]),
  [CONTRACT_CHANGE_STATUSES.MANUAL_ROUTED]: Object.freeze([
    CONTRACT_CHANGE_STATUSES.UNDER_REVIEW,
    CONTRACT_CHANGE_STATUSES.APPROVED,
    CONTRACT_CHANGE_STATUSES.REJECTED,
    CONTRACT_CHANGE_STATUSES.COMPLETED,
  ]),
  [CONTRACT_CHANGE_STATUSES.COMPLETED]: Object.freeze([]),
});

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

function assertOptions(options, description = 'Contract change options') {
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
        issue.path.length > 0 ? issue.path.join('.') : 'changeRequest';

      return `${path}: ${issue.message}`;
    })
    .join('; ');
}

function createRepositoryError(code, message, details, cause) {
  const error = new Error(message, {
    ...(cause === undefined ? {} : { cause }),
  });

  error.name = 'ContractChangeRepositoryError';
  error.code = code;
  error.details = details ?? null;

  return error;
}

function assertSupportedChangeType(changeType) {
  if (!Object.values(CONTRACT_CHANGE_TYPES).includes(changeType)) {
    throw createRepositoryError(
      CONTRACT_CHANGE_REPOSITORY_ERROR_CODES.INVALID_CHANGE_TYPE,
      `Unsupported contract change type: ${changeType}`,
      {
        changeType,
        supportedChangeTypes: Object.values(CONTRACT_CHANGE_TYPES),
      },
    );
  }
}

function assertSupportedStatus(status) {
  if (!Object.values(CONTRACT_CHANGE_STATUSES).includes(status)) {
    throw createRepositoryError(
      CONTRACT_CHANGE_REPOSITORY_ERROR_CODES.INVALID_STATUS,
      `Unsupported contract change status: ${status}`,
      {
        status,
        supportedStatuses: Object.values(CONTRACT_CHANGE_STATUSES),
      },
    );
  }
}

function parseChangeRequest(changeRequest) {
  const result = changeRequestSchema.safeParse(changeRequest);

  if (!result.success) {
    throw createRepositoryError(
      CONTRACT_CHANGE_REPOSITORY_ERROR_CODES.INVALID_CHANGE_REQUEST,
      `Invalid contract change request: ${formatValidationIssues(
        result.error,
      )}`,
      { issues: result.error.issues },
      result.error,
    );
  }

  assertSupportedChangeType(result.data.changeType);
  assertSupportedStatus(result.data.status);

  return result.data;
}

function validateSeedChangeRequests(seedChangeRequests) {
  if (!Array.isArray(seedChangeRequests)) {
    throw new TypeError('Contract change seed records must be an array.');
  }

  const parsedChangeRequests = seedChangeRequests.map((changeRequest) =>
    parseChangeRequest(changeRequest),
  );

  assertUniqueIdentifiers(parsedChangeRequests);
  return parsedChangeRequests;
}

function createEmptyState() {
  return {
    overlays: {},
    removedChangeRequestIds: [],
  };
}

function assertUniqueIdentifiers(changeRequests) {
  const identifiers = new Map();

  changeRequests.forEach((changeRequest) => {
    const normalizedIdentifier = normalizeIdentifierForLookup(
      changeRequest.changeRequestId,
      'Contract change request identifier',
    );
    const existingChangeRequest = identifiers.get(normalizedIdentifier);

    if (existingChangeRequest) {
      throw createRepositoryError(
        CONTRACT_CHANGE_REPOSITORY_ERROR_CODES.DUPLICATE_IDENTIFIER,
        `Duplicate contract change request identifier: ${changeRequest.changeRequestId}`,
        {
          changeRequestId: changeRequest.changeRequestId,
          existingChangeRequestId:
            existingChangeRequest.changeRequestId,
        },
      );
    }

    identifiers.set(normalizedIdentifier, changeRequest);
  });
}

function assertCanonicalFieldsUnchanged(
  currentChangeRequest,
  nextChangeRequest,
) {
  CANONICAL_FIELDS.forEach((field) => {
    const currentValue = currentChangeRequest[field] ?? null;
    const nextValue = nextChangeRequest[field] ?? null;

    if (currentValue !== nextValue) {
      throw createRepositoryError(
        CONTRACT_CHANGE_REPOSITORY_ERROR_CODES.IDENTIFIER_CHANGE,
        `The canonical contract change field "${field}" cannot be changed.`,
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

  const normalizedQuery = assertOptions(query, 'Contract change query');

  if (
    normalizedQuery.limit !== undefined &&
    (!Number.isInteger(normalizedQuery.limit) ||
      normalizedQuery.limit < 1)
  ) {
    throw new RangeError(
      'Contract change query limit must be a positive integer.',
    );
  }

  if (
    normalizedQuery.offset !== undefined &&
    (!Number.isInteger(normalizedQuery.offset) ||
      normalizedQuery.offset < 0)
  ) {
    throw new RangeError(
      'Contract change query offset must be a nonnegative integer.',
    );
  }

  if (
    normalizedQuery.sortOrder !== undefined &&
    !['asc', 'desc'].includes(normalizedQuery.sortOrder)
  ) {
    throw new TypeError(
      'Contract change sort order must be either "asc" or "desc".',
    );
  }

  if (
    normalizedQuery.manualReviewRequired !== undefined &&
    typeof normalizedQuery.manualReviewRequired !== 'boolean'
  ) {
    throw new TypeError(
      'Contract change manual review filter must be a boolean.',
    );
  }

  const createdFrom =
    normalizedQuery.createdFrom === undefined
      ? undefined
      : Date.parse(toIsoTimestamp(normalizedQuery.createdFrom));
  const createdTo =
    normalizedQuery.createdTo === undefined
      ? undefined
      : Date.parse(toIsoTimestamp(normalizedQuery.createdTo));

  if (
    createdFrom !== undefined &&
    createdTo !== undefined &&
    createdFrom > createdTo
  ) {
    throw new RangeError(
      'The contract change start time cannot be after its end time.',
    );
  }

  return {
    ...normalizedQuery,
    createdFrom,
    createdTo,
  };
}

function valueMatchesFilter(value, filter) {
  if (Array.isArray(filter)) {
    return filter.includes(value);
  }

  return value === filter;
}

function matchesQuery(changeRequest, query) {
  if (
    query.trackingId !== undefined &&
    !valueMatchesFilter(changeRequest.trackingId, query.trackingId)
  ) {
    return false;
  }

  if (
    query.partnerCode !== undefined &&
    !valueMatchesFilter(changeRequest.partnerCode, query.partnerCode)
  ) {
    return false;
  }

  if (
    query.changeType !== undefined &&
    !valueMatchesFilter(changeRequest.changeType, query.changeType)
  ) {
    return false;
  }

  if (
    query.changeTypes !== undefined &&
    !valueMatchesFilter(changeRequest.changeType, query.changeTypes)
  ) {
    return false;
  }

  if (
    query.status !== undefined &&
    !valueMatchesFilter(changeRequest.status, query.status)
  ) {
    return false;
  }

  if (
    query.statuses !== undefined &&
    !valueMatchesFilter(changeRequest.status, query.statuses)
  ) {
    return false;
  }

  if (
    query.requestedBy !== undefined &&
    !valueMatchesFilter(changeRequest.requestedBy, query.requestedBy)
  ) {
    return false;
  }

  if (
    query.createdWorkItemId !== undefined &&
    !valueMatchesFilter(
      changeRequest.createdWorkItemId,
      query.createdWorkItemId,
    )
  ) {
    return false;
  }

  if (
    query.manualReviewRequired !== undefined &&
    changeRequest.manualReviewRequired !==
      query.manualReviewRequired
  ) {
    return false;
  }

  if (
    query.validationCode !== undefined &&
    !Array.isArray(changeRequest.outcome?.validationCodes)
  ) {
    return false;
  }

  if (
    query.validationCode !== undefined &&
    !changeRequest.outcome.validationCodes.includes(
      query.validationCode,
    )
  ) {
    return false;
  }

  const createdAt = Date.parse(changeRequest.createdAt);

  if (
    query.createdFrom !== undefined &&
    createdAt < query.createdFrom
  ) {
    return false;
  }

  if (query.createdTo !== undefined && createdAt > query.createdTo) {
    return false;
  }

  return true;
}

function createChangeRequestIdentifier(changeRequest) {
  return createDeterministicId(
    'CHG',
    {
      trackingId: changeRequest.trackingId ?? null,
      partnerCode: changeRequest.partnerCode,
      changeType: changeRequest.changeType,
      requestedBy: changeRequest.requestedBy,
      payload: changeRequest.payload,
      createdAt: changeRequest.createdAt,
    },
    { length: 16 },
  );
}

function resolveStorageAdapter(options) {
  if (options.storageAdapter !== undefined) {
    if (!isRepositoryStorageAdapter(options.storageAdapter)) {
      throw new TypeError(
        'The contract change storage adapter must provide get, set, and remove methods.',
      );
    }

    return options.storageAdapter;
  }

  if (options.storage !== undefined && !isStorageLike(options.storage)) {
    throw new TypeError(
      'The supplied contract change storage implementation is invalid.',
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
 * Stores supported and manually routed contract change requests.
 */
export class ContractChangeRepository {
  /**
   * @param {{
   *   seedChangeRequests?: object[],
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
        'The contract change repository clock must be a function.',
      );
    }

    this.seedChangeRequests = validateSeedChangeRequests(
      normalizedOptions.seedChangeRequests ??
        getSeeds().contractChanges,
    );
    this.clock = normalizedOptions.clock ?? (() => new Date());
    this.storageAdapter = resolveStorageAdapter(normalizedOptions);
    this.storageKey = normalizeIdentifier(
      normalizedOptions.storageKey ??
        CONTRACT_CHANGE_REPOSITORY_STORAGE_KEY,
      'Contract change repository storage key',
    );
  }

  /**
   * Lists contract change requests.
   *
   * @param {{
   *   trackingId?: string | string[] | null,
   *   partnerCode?: string | string[],
   *   changeType?: string | string[],
   *   changeTypes?: string[],
   *   status?: string | string[],
   *   statuses?: string[],
   *   requestedBy?: string | string[],
   *   createdWorkItemId?: string | string[] | null,
   *   manualReviewRequired?: boolean,
   *   validationCode?: string,
   *   createdFrom?: Date | string | number,
   *   createdTo?: Date | string | number,
   *   sortOrder?: 'asc' | 'desc',
   *   limit?: number,
   *   offset?: number
   * }} [query] Contract change filters.
   * @returns {object[]} Matching contract change requests.
   */
  list(query = {}) {
    const normalizedQuery = normalizeQuery(query);
    const offset = normalizedQuery.offset ?? 0;
    const limit = normalizedQuery.limit ?? Number.POSITIVE_INFINITY;
    const direction = normalizedQuery.sortOrder === 'asc' ? 1 : -1;

    return this.readChangeRequests()
      .filter((changeRequest) =>
        matchesQuery(changeRequest, normalizedQuery),
      )
      .sort(
        (left, right) =>
          direction *
          (Date.parse(left.updatedAt) - Date.parse(right.updatedAt)),
      )
      .slice(offset, offset + limit)
      .map((changeRequest) => cloneValue(changeRequest));
  }

  /**
   * Alias for list.
   *
   * @param {object} [query] Contract change filters.
   * @returns {object[]} Matching contract change requests.
   */
  getAll(query = {}) {
    return this.list(query);
  }

  /**
   * Alias for list used by mock API facades.
   *
   * @param {object} [query] Contract change filters.
   * @returns {object[]} Matching contract change requests.
   */
  search(query = {}) {
    return this.list(query);
  }

  /**
   * Finds a contract change request by identifier.
   *
   * @param {string | number} changeRequestId Change request identifier.
   * @returns {object | undefined} Matching change request.
   */
  find(changeRequestId) {
    const changeRequest = this.findInCollection(
      this.readChangeRequests(),
      changeRequestId,
    );

    return changeRequest ? cloneValue(changeRequest) : undefined;
  }

  /**
   * Alias for find.
   *
   * @param {string | number} changeRequestId Change request identifier.
   * @returns {object | undefined} Matching change request.
   */
  findById(changeRequestId) {
    return this.find(changeRequestId);
  }

  /**
   * Finds change requests for a tracking identifier.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @param {object} [query] Additional filters.
   * @returns {object[]} Matching change requests.
   */
  findByTrackingId(trackingId, query = {}) {
    return this.list({
      ...assertOptions(query, 'Tracking contract change query'),
      trackingId: normalizeIdentifier(
        trackingId,
        'Tracking identifier',
      ),
    });
  }

  /**
   * Finds change requests for a partner.
   *
   * @param {string | number} partnerCode Partner code.
   * @param {object} [query] Additional filters.
   * @returns {object[]} Matching change requests.
   */
  findByPartnerCode(partnerCode, query = {}) {
    return this.list({
      ...assertOptions(query, 'Partner contract change query'),
      partnerCode: normalizeIdentifier(partnerCode, 'Partner code'),
    });
  }

  /**
   * Returns a contract change request or throws when absent.
   *
   * @param {string | number} changeRequestId Change request identifier.
   * @returns {object} Matching change request.
   */
  get(changeRequestId) {
    const changeRequest = this.find(changeRequestId);

    if (!changeRequest) {
      throw createRepositoryError(
        CONTRACT_CHANGE_REPOSITORY_ERROR_CODES.NOT_FOUND,
        `Contract change request not found: ${changeRequestId}`,
        { changeRequestId: String(changeRequestId) },
      );
    }

    return changeRequest;
  }

  /**
   * Creates a supported contract change request.
   *
   * @param {object} changeRequest Initial change request values.
   * @returns {object} Created change request.
   */
  create(changeRequest) {
    if (!isObject(changeRequest)) {
      throw new TypeError(
        'A contract change request must be an object.',
      );
    }

    const timestamp = toIsoTimestamp(
      changeRequest.createdAt ?? this.clock(),
    );
    const trackingId =
      changeRequest.trackingId === undefined
        ? null
        : normalizeNullableIdentifier(
            changeRequest.trackingId,
            'Tracking identifier',
          );
    const partnerCode = normalizeIdentifier(
      changeRequest.partnerCode,
      'Partner code',
    );
    const changeType = normalizeIdentifier(
      changeRequest.changeType,
      'Contract change type',
    );
    const requestedBy = normalizeIdentifier(
      changeRequest.requestedBy,
      'Requesting actor identifier',
    );

    assertSupportedChangeType(changeType);

    const status =
      changeRequest.status ?? CONTRACT_CHANGE_STATUSES.SUBMITTED;

    assertSupportedStatus(status);

    if (
      changeRequest.payload !== undefined &&
      !isObject(changeRequest.payload)
    ) {
      throw new TypeError(
        'Contract change request payload must be an object.',
      );
    }

    if (
      changeRequest.outcome !== undefined &&
      !isObject(changeRequest.outcome)
    ) {
      throw new TypeError(
        'Contract change request outcome must be an object.',
      );
    }

    const candidate = {
      ...cloneValue(changeRequest),
      trackingId,
      partnerCode,
      changeType,
      status,
      manualReviewRequired:
        changeRequest.manualReviewRequired ?? false,
      createdWorkItemId:
        changeRequest.createdWorkItemId === undefined
          ? null
          : normalizeNullableIdentifier(
              changeRequest.createdWorkItemId,
              'Created work item identifier',
            ),
      requestedBy,
      payload: cloneValue(changeRequest.payload ?? {}),
      outcome: cloneValue(changeRequest.outcome ?? {}),
      createdAt: timestamp,
      updatedAt: toIsoTimestamp(
        changeRequest.updatedAt ?? timestamp,
      ),
    };

    candidate.changeRequestId =
      changeRequest.changeRequestId ??
      createChangeRequestIdentifier(candidate);

    const parsedChangeRequest = parseChangeRequest(candidate);

    if (this.find(parsedChangeRequest.changeRequestId)) {
      throw createRepositoryError(
        CONTRACT_CHANGE_REPOSITORY_ERROR_CODES.DUPLICATE_IDENTIFIER,
        `A contract change request already exists: ${parsedChangeRequest.changeRequestId}`,
        {
          changeRequestId: parsedChangeRequest.changeRequestId,
        },
      );
    }

    const state = this.readState();
    const changeRequests = [
      ...this.buildChangeRequests(state),
      parsedChangeRequest,
    ];

    assertUniqueIdentifiers(changeRequests);

    state.overlays[parsedChangeRequest.changeRequestId] =
      cloneValue(parsedChangeRequest);
    state.removedChangeRequestIds =
      state.removedChangeRequestIds.filter(
        (changeRequestId) =>
          changeRequestId !== parsedChangeRequest.changeRequestId,
      );
    this.persistState(state);

    return cloneValue(parsedChangeRequest);
  }

  /**
   * Alias for create.
   *
   * @param {object} changeRequest Initial change request values.
   * @returns {object} Created change request.
   */
  createContractChange(changeRequest) {
    return this.create(changeRequest);
  }

  /**
   * Saves a complete contract change request.
   *
   * @param {object} changeRequest Change request to persist.
   * @param {{expectedUpdatedAt?: string, expectedStatus?: string}} [options]
   * Save options.
   * @returns {object} Persisted change request.
   */
  save(changeRequest, options = {}) {
    const normalizedOptions = assertOptions(
      options,
      'Contract change save options',
    );
    const parsedChangeRequest = parseChangeRequest(changeRequest);
    const state = this.readState();
    const changeRequests = this.buildChangeRequests(state);
    const currentChangeRequest = this.findInCollection(
      changeRequests,
      parsedChangeRequest.changeRequestId,
    );

    this.assertExpectedState(currentChangeRequest, normalizedOptions);

    if (currentChangeRequest) {
      assertCanonicalFieldsUnchanged(
        currentChangeRequest,
        parsedChangeRequest,
      );
    }

    const nextChangeRequests = currentChangeRequest
      ? changeRequests.map((candidate) =>
          candidate.changeRequestId ===
          currentChangeRequest.changeRequestId
            ? parsedChangeRequest
            : candidate,
        )
      : [...changeRequests, parsedChangeRequest];

    assertUniqueIdentifiers(nextChangeRequests);

    state.overlays[parsedChangeRequest.changeRequestId] =
      cloneValue(parsedChangeRequest);
    state.removedChangeRequestIds =
      state.removedChangeRequestIds.filter(
        (changeRequestId) =>
          changeRequestId !== parsedChangeRequest.changeRequestId,
      );
    this.persistState(state);

    return cloneValue(parsedChangeRequest);
  }

  /**
   * Alias for save.
   *
   * @param {object} changeRequest Change request to persist.
   * @param {object} [options] Save options.
   * @returns {object} Persisted change request.
   */
  upsert(changeRequest, options = {}) {
    return this.save(changeRequest, options);
  }

  /**
   * Atomically patches a contract change request.
   *
   * @param {string | number} changeRequestId Change request identifier.
   * @param {object | ((changeRequest: object) => object)} update
   * Change request patch or updater.
   * @param {{
   *   expectedUpdatedAt?: string,
   *   expectedStatus?: string,
   *   touchUpdatedAt?: boolean
   * }} [options] Update options.
   * @returns {object} Updated change request.
   */
  update(changeRequestId, update, options = {}) {
    const normalizedOptions = assertOptions(
      options,
      'Contract change update options',
    );

    if (typeof update !== 'function' && !isObject(update)) {
      throw new TypeError(
        'A contract change update must be an object or updater function.',
      );
    }

    const state = this.readState();
    const changeRequests = this.buildChangeRequests(state);
    const currentChangeRequest = this.findInCollection(
      changeRequests,
      changeRequestId,
    );

    if (!currentChangeRequest) {
      throw createRepositoryError(
        CONTRACT_CHANGE_REPOSITORY_ERROR_CODES.NOT_FOUND,
        `Contract change request not found: ${changeRequestId}`,
        { changeRequestId: String(changeRequestId) },
      );
    }

    this.assertExpectedState(
      currentChangeRequest,
      normalizedOptions,
    );

    const updateValue =
      typeof update === 'function'
        ? update(cloneValue(currentChangeRequest))
        : update;

    if (!isObject(updateValue)) {
      throw new TypeError(
        'The contract change updater must return a request or patch object.',
      );
    }

    const nextChangeRequest = parseChangeRequest({
      ...deepMerge(currentChangeRequest, updateValue),
      ...(normalizedOptions.touchUpdatedAt === false
        ? {}
        : { updatedAt: toIsoTimestamp(this.clock()) }),
    });

    assertCanonicalFieldsUnchanged(
      currentChangeRequest,
      nextChangeRequest,
    );

    state.overlays[currentChangeRequest.changeRequestId] =
      cloneValue(nextChangeRequest);
    state.removedChangeRequestIds =
      state.removedChangeRequestIds.filter(
        (removedChangeRequestId) =>
          removedChangeRequestId !==
          currentChangeRequest.changeRequestId,
      );
    this.persistState(state);

    return cloneValue(nextChangeRequest);
  }

  /**
   * Alias for update emphasizing transactional behavior.
   *
   * @param {string | number} changeRequestId Change request identifier.
   * @param {object | ((changeRequest: object) => object)} update
   * Change request patch or updater.
   * @param {object} [options] Update options.
   * @returns {object} Updated change request.
   */
  atomicUpdate(changeRequestId, update, options = {}) {
    return this.update(changeRequestId, update, options);
  }

  /**
   * Transitions a contract change request to another supported status.
   *
   * @param {string | number} changeRequestId Change request identifier.
   * @param {string} targetStatus Target status.
   * @param {{
   *   outcome?: Record<string, unknown>,
   *   manualReviewRequired?: boolean,
   *   createdWorkItemId?: string | null,
   *   expectedUpdatedAt?: string,
   *   expectedStatus?: string,
   *   allowReopen?: boolean
   * }} [options] Transition options.
   * @returns {object} Updated change request.
   */
  transition(changeRequestId, targetStatus, options = {}) {
    const normalizedOptions = assertOptions(
      options,
      'Contract change transition options',
    );
    const normalizedStatus = normalizeIdentifier(
      targetStatus,
      'Contract change target status',
    );
    const currentChangeRequest = this.get(changeRequestId);

    assertSupportedStatus(normalizedStatus);
    this.assertValidStatusTransition(
      currentChangeRequest.status,
      normalizedStatus,
      normalizedOptions.allowReopen === true,
    );

    if (
      normalizedOptions.outcome !== undefined &&
      !isObject(normalizedOptions.outcome)
    ) {
      throw new TypeError(
        'Contract change outcome must be an object.',
      );
    }

    const createdWorkItemId =
      normalizedOptions.createdWorkItemId === undefined
        ? currentChangeRequest.createdWorkItemId
        : normalizeNullableIdentifier(
            normalizedOptions.createdWorkItemId,
            'Created work item identifier',
          );

    return this.update(
      currentChangeRequest.changeRequestId,
      {
        status: normalizedStatus,
        createdWorkItemId,
        manualReviewRequired:
          normalizedOptions.manualReviewRequired ??
          currentChangeRequest.manualReviewRequired,
        outcome:
          normalizedOptions.outcome === undefined
            ? currentChangeRequest.outcome
            : deepMerge(
                currentChangeRequest.outcome,
                normalizedOptions.outcome,
              ),
      },
      {
        expectedUpdatedAt: normalizedOptions.expectedUpdatedAt,
        expectedStatus: normalizedOptions.expectedStatus,
      },
    );
  }

  /**
   * Routes a change request to a manually managed work item.
   *
   * @param {string | number} changeRequestId Change request identifier.
   * @param {string | number} workItemId Created work item identifier.
   * @param {{
   *   outcome?: Record<string, unknown>,
   *   expectedUpdatedAt?: string,
   *   expectedStatus?: string
   * }} [options] Routing options.
   * @returns {object} Manually routed change request.
   */
  routeForManualReview(
    changeRequestId,
    workItemId,
    options = {},
  ) {
    const normalizedOptions = assertOptions(
      options,
      'Manual contract change routing options',
    );

    return this.transition(
      changeRequestId,
      CONTRACT_CHANGE_STATUSES.MANUAL_ROUTED,
      {
        ...normalizedOptions,
        manualReviewRequired: true,
        createdWorkItemId: normalizeIdentifier(
          workItemId,
          'Created work item identifier',
        ),
        outcome: {
          result: 'pending_manual_review',
          ...cloneValue(normalizedOptions.outcome ?? {}),
        },
      },
    );
  }

  /**
   * Alias for routeForManualReview.
   *
   * @param {string | number} changeRequestId Change request identifier.
   * @param {string | number} workItemId Created work item identifier.
   * @param {object} [options] Routing options.
   * @returns {object} Manually routed change request.
   */
  markManualRouted(changeRequestId, workItemId, options = {}) {
    return this.routeForManualReview(
      changeRequestId,
      workItemId,
      options,
    );
  }

  /**
   * Records approval for a change request.
   *
   * @param {string | number} changeRequestId Change request identifier.
   * @param {Record<string, unknown>} [outcome] Approval outcome.
   * @param {object} [options] Transition options.
   * @returns {object} Approved change request.
   */
  approve(changeRequestId, outcome = {}, options = {}) {
    return this.transition(
      changeRequestId,
      CONTRACT_CHANGE_STATUSES.APPROVED,
      {
        ...assertOptions(options, 'Contract change approval options'),
        outcome: {
          result: 'approved',
          ...assertOptions(outcome, 'Contract change approval outcome'),
        },
      },
    );
  }

  /**
   * Records rejection for a change request.
   *
   * @param {string | number} changeRequestId Change request identifier.
   * @param {Record<string, unknown>} [outcome] Rejection outcome.
   * @param {object} [options] Transition options.
   * @returns {object} Rejected change request.
   */
  reject(changeRequestId, outcome = {}, options = {}) {
    return this.transition(
      changeRequestId,
      CONTRACT_CHANGE_STATUSES.REJECTED,
      {
        ...assertOptions(options, 'Contract change rejection options'),
        outcome: {
          result: 'rejected',
          ...assertOptions(outcome, 'Contract change rejection outcome'),
        },
      },
    );
  }

  /**
   * Marks a change request as completed.
   *
   * @param {string | number} changeRequestId Change request identifier.
   * @param {Record<string, unknown>} [outcome] Completion outcome.
   * @param {object} [options] Transition options.
   * @returns {object} Completed change request.
   */
  complete(changeRequestId, outcome = {}, options = {}) {
    return this.transition(
      changeRequestId,
      CONTRACT_CHANGE_STATUSES.COMPLETED,
      {
        ...assertOptions(options, 'Contract change completion options'),
        outcome: {
          result: 'completed',
          ...assertOptions(outcome, 'Contract change completion outcome'),
        },
      },
    );
  }

  /**
   * Returns counts grouped by contract change status.
   *
   * @param {object} [query] Base contract change filters.
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
      Object.values(CONTRACT_CHANGE_STATUSES).map((status) => [
        status,
        0,
      ]),
    );

    this.readChangeRequests()
      .filter((changeRequest) =>
        matchesQuery(changeRequest, baseQuery),
      )
      .forEach((changeRequest) => {
        counts[changeRequest.status] =
          (counts[changeRequest.status] ?? 0) + 1;
      });

    return Object.freeze(counts);
  }

  /**
   * Removes a contract change request.
   *
   * @param {string | number} changeRequestId Change request identifier.
   * @returns {boolean} Whether a change request was removed.
   */
  remove(changeRequestId) {
    const state = this.readState();
    const changeRequests = this.buildChangeRequests(state);
    const changeRequest = this.findInCollection(
      changeRequests,
      changeRequestId,
    );

    if (!changeRequest) {
      return false;
    }

    const isSeedChangeRequest = this.seedChangeRequests.some(
      (seedChangeRequest) =>
        seedChangeRequest.changeRequestId ===
        changeRequest.changeRequestId,
    );

    delete state.overlays[changeRequest.changeRequestId];

    if (
      isSeedChangeRequest &&
      !state.removedChangeRequestIds.includes(
        changeRequest.changeRequestId,
      )
    ) {
      state.removedChangeRequestIds.push(
        changeRequest.changeRequestId,
      );
    }

    this.persistState(state);
    return true;
  }

  /**
   * Alias for remove.
   *
   * @param {string | number} changeRequestId Change request identifier.
   * @returns {boolean} Whether a change request was removed.
   */
  delete(changeRequestId) {
    return this.remove(changeRequestId);
  }

  /**
   * Removes persisted changes and restores seeded change requests.
   *
   * @returns {object[]} Seeded contract change requests.
   */
  reset() {
    const removed = this.storageAdapter.remove(this.storageKey);

    if (!removed) {
      throw this.createPersistenceError('reset');
    }

    return this.seedChangeRequests.map((changeRequest) =>
      cloneValue(changeRequest),
    );
  }

  readState() {
    const state = this.storageAdapter.get(
      this.storageKey,
      contractChangeRepositoryStateSchema,
      createEmptyState(),
    );

    return cloneValue(state);
  }

  buildChangeRequests(state) {
    const removedIdentifiers = new Set(
      state.removedChangeRequestIds,
    );
    const changeRequestsById = new Map();

    this.seedChangeRequests.forEach((changeRequest) => {
      if (!removedIdentifiers.has(changeRequest.changeRequestId)) {
        changeRequestsById.set(
          changeRequest.changeRequestId,
          cloneValue(changeRequest),
        );
      }
    });

    Object.entries(state.overlays).forEach(
      ([changeRequestId, overlay]) => {
        if (removedIdentifiers.has(changeRequestId)) {
          return;
        }

        if (!isObject(overlay)) {
          throw createRepositoryError(
            CONTRACT_CHANGE_REPOSITORY_ERROR_CODES
              .INVALID_CHANGE_REQUEST,
            `Invalid persisted contract change overlay: ${changeRequestId}`,
            { changeRequestId },
          );
        }

        const existingChangeRequest =
          changeRequestsById.get(changeRequestId);
        const mergedChangeRequest = existingChangeRequest
          ? deepMerge(existingChangeRequest, overlay)
          : cloneValue(overlay);
        const parsedChangeRequest = parseChangeRequest(
          mergedChangeRequest,
        );

        if (
          parsedChangeRequest.changeRequestId !== changeRequestId
        ) {
          throw createRepositoryError(
            CONTRACT_CHANGE_REPOSITORY_ERROR_CODES
              .INVALID_CHANGE_REQUEST,
            'A persisted contract change request has a mismatched identifier.',
            {
              overlayKey: changeRequestId,
              changeRequestId:
                parsedChangeRequest.changeRequestId,
            },
          );
        }

        changeRequestsById.set(
          changeRequestId,
          parsedChangeRequest,
        );
      },
    );

    const changeRequests = [...changeRequestsById.values()];

    assertUniqueIdentifiers(changeRequests);
    return changeRequests;
  }

  readChangeRequests() {
    try {
      return this.buildChangeRequests(this.readState());
    } catch {
      this.storageAdapter.remove(this.storageKey);
      return this.seedChangeRequests.map((changeRequest) =>
        cloneValue(changeRequest),
      );
    }
  }

  findInCollection(changeRequests, changeRequestId) {
    const normalizedIdentifier = normalizeIdentifierForLookup(
      changeRequestId,
      'Contract change request identifier',
    );

    return changeRequests.find(
      (changeRequest) =>
        normalizeIdentifierForLookup(
          changeRequest.changeRequestId,
          'Contract change request identifier',
        ) === normalizedIdentifier,
    );
  }

  assertExpectedState(changeRequest, options) {
    if (!changeRequest) {
      return;
    }

    if (
      options.expectedUpdatedAt !== undefined &&
      changeRequest.updatedAt !== options.expectedUpdatedAt
    ) {
      throw createRepositoryError(
        CONTRACT_CHANGE_REPOSITORY_ERROR_CODES.CONFLICT,
        'The contract change request was changed after it was last read.',
        {
          changeRequestId: changeRequest.changeRequestId,
          expectedUpdatedAt: options.expectedUpdatedAt,
          actualUpdatedAt: changeRequest.updatedAt,
        },
      );
    }

    if (
      options.expectedStatus !== undefined &&
      changeRequest.status !== options.expectedStatus
    ) {
      throw createRepositoryError(
        CONTRACT_CHANGE_REPOSITORY_ERROR_CODES.CONFLICT,
        'The contract change request status changed after it was last read.',
        {
          changeRequestId: changeRequest.changeRequestId,
          expectedStatus: options.expectedStatus,
          actualStatus: changeRequest.status,
        },
      );
    }
  }

  assertValidStatusTransition(
    currentStatus,
    targetStatus,
    allowReopen,
  ) {
    if (currentStatus === targetStatus) {
      return;
    }

    const allowedStatuses =
      ALLOWED_STATUS_TRANSITIONS[currentStatus] ?? [];
    const isReopen =
      allowReopen &&
      TERMINAL_CONTRACT_CHANGE_STATUSES.includes(currentStatus) &&
      targetStatus === CONTRACT_CHANGE_STATUSES.UNDER_REVIEW;

    if (!allowedStatuses.includes(targetStatus) && !isReopen) {
      throw createRepositoryError(
        CONTRACT_CHANGE_REPOSITORY_ERROR_CODES
          .INVALID_STATUS_TRANSITION,
        `Contract change status cannot transition from ${currentStatus} to ${targetStatus}.`,
        {
          currentStatus,
          targetStatus,
          allowedStatuses,
          allowReopen,
        },
      );
    }
  }

  persistState(state) {
    const result = contractChangeRepositoryStateSchema.safeParse(state);

    if (!result.success) {
      throw createRepositoryError(
        CONTRACT_CHANGE_REPOSITORY_ERROR_CODES.PERSISTENCE_FAILED,
        'The contract change repository state is invalid.',
        { issues: result.error.issues },
        result.error,
      );
    }

    if (
      !this.storageAdapter.set(
        this.storageKey,
        result.data,
        contractChangeRepositoryStateSchema,
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
      CONTRACT_CHANGE_REPOSITORY_ERROR_CODES.PERSISTENCE_FAILED,
      `Unable to ${operation} persisted contract change requests.`,
      {
        operation,
        storageError: storageError ?? null,
      },
      storageError,
    );
  }
}

/**
 * Creates a contract change repository.
 *
 * @param {ConstructorParameters<typeof ContractChangeRepository>[0]}
 * [options] Repository options.
 * @returns {ContractChangeRepository} Repository instance.
 */
export function createContractChangeRepository(options = {}) {
  return new ContractChangeRepository(options);
}

export const ContractingChangeRepository = ContractChangeRepository;
export const createContractingChangeRepository =
  createContractChangeRepository;

export default ContractChangeRepository;