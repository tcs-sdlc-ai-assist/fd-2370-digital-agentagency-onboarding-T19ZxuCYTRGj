import { z } from 'zod';
import {
  AUDIT_ACTOR_TYPES,
  PRIORITIES,
  WORK_ITEM_STATES,
} from '../constants/domain.js';
import { STORAGE_KEYS } from '../constants/storageKeys.js';
import {
  assignmentRecordSchema,
  workItemSchema,
} from '../contracts/schemas.js';
import { BrowserStorageAdapter } from '../persistence/browserStorageAdapter.js';
import { getSeeds } from '../persistence/seedLoader.js';
import { toIsoTimestamp } from '../utils/dates.js';
import { createDeterministicId } from '../utils/ids.js';

const identifierSchema = z.string().trim().min(1);

export const WORK_ITEM_REPOSITORY_STORAGE_KEY =
  `${STORAGE_KEYS.OPERATIONS}:work-items`;

export const workItemRepositoryStateSchema = z
  .object({
    overlays: z.record(z.unknown()).default({}),
    removedWorkItemIds: z.array(identifierSchema).default([]),
    assignmentOverlays: z.record(z.unknown()).default({}),
    removedAssignmentIds: z.array(identifierSchema).default([]),
  })
  .passthrough();

export const WORK_ITEM_REPOSITORY_ERROR_CODES = Object.freeze({
  INVALID_WORK_ITEM: 'WORK_ITEM_INVALID',
  INVALID_ASSIGNMENT: 'WORK_ITEM_ASSIGNMENT_INVALID',
  NOT_FOUND: 'WORK_ITEM_NOT_FOUND',
  ASSIGNMENT_NOT_FOUND: 'WORK_ITEM_ASSIGNMENT_NOT_FOUND',
  DUPLICATE_IDENTIFIER: 'WORK_ITEM_DUPLICATE_IDENTIFIER',
  DUPLICATE_ASSIGNMENT: 'WORK_ITEM_ASSIGNMENT_DUPLICATE',
  IDENTIFIER_CHANGE: 'WORK_ITEM_IDENTIFIER_CHANGE',
  ASSIGNMENT_IDENTIFIER_CHANGE:
    'WORK_ITEM_ASSIGNMENT_IDENTIFIER_CHANGE',
  INVALID_STATE_TRANSITION: 'WORK_ITEM_INVALID_STATE_TRANSITION',
  CONFLICT: 'WORK_ITEM_UPDATE_CONFLICT',
  PERSISTENCE_FAILED: 'WORK_ITEM_PERSISTENCE_FAILED',
});

const CANONICAL_WORK_ITEM_FIELDS = Object.freeze([
  'workItemId',
  'trackingId',
  'sourceRecordId',
  'cardType',
]);

const CANONICAL_ASSIGNMENT_FIELDS = Object.freeze([
  'assignmentId',
  'workItemId',
  'trackingId',
]);

const ALLOWED_STATE_TRANSITIONS = Object.freeze({
  [WORK_ITEM_STATES.PENDING]: Object.freeze([
    WORK_ITEM_STATES.ACTION_NEEDED,
    WORK_ITEM_STATES.COMPLETED,
  ]),
  [WORK_ITEM_STATES.ACTION_NEEDED]: Object.freeze([
    WORK_ITEM_STATES.PENDING,
    WORK_ITEM_STATES.COMPLETED,
  ]),
  [WORK_ITEM_STATES.COMPLETED]: Object.freeze([]),
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

function assertOptions(options, description = 'Work item options') {
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
        issue.path.length > 0 ? issue.path.join('.') : 'workItem';

      return `${path}: ${issue.message}`;
    })
    .join('; ');
}

function createRepositoryError(code, message, details, cause) {
  const error = new Error(message, {
    ...(cause === undefined ? {} : { cause }),
  });

  error.name = 'WorkItemRepositoryError';
  error.code = code;
  error.details = details ?? null;

  return error;
}

function parseWorkItem(workItem) {
  const result = workItemSchema.safeParse(workItem);

  if (!result.success) {
    throw createRepositoryError(
      WORK_ITEM_REPOSITORY_ERROR_CODES.INVALID_WORK_ITEM,
      `Invalid work item: ${formatValidationIssues(result.error)}`,
      { issues: result.error.issues },
      result.error,
    );
  }

  return result.data;
}

function parseAssignment(assignment) {
  const result = assignmentRecordSchema.safeParse(assignment);

  if (!result.success) {
    throw createRepositoryError(
      WORK_ITEM_REPOSITORY_ERROR_CODES.INVALID_ASSIGNMENT,
      `Invalid work item assignment: ${formatValidationIssues(
        result.error,
      )}`,
      { issues: result.error.issues },
      result.error,
    );
  }

  return result.data;
}

function validateSeedWorkItems(seedWorkItems) {
  if (!Array.isArray(seedWorkItems)) {
    throw new TypeError('Work item seed records must be an array.');
  }

  return seedWorkItems.map((workItem) => parseWorkItem(workItem));
}

function validateSeedAssignments(seedAssignments) {
  if (!Array.isArray(seedAssignments)) {
    throw new TypeError('Work item assignment seeds must be an array.');
  }

  return seedAssignments.map((assignment) =>
    parseAssignment(assignment),
  );
}

function createEmptyState() {
  return {
    overlays: {},
    removedWorkItemIds: [],
    assignmentOverlays: {},
    removedAssignmentIds: [],
  };
}

function assertUniqueWorkItemIdentifiers(workItems) {
  const identifiers = new Map();

  workItems.forEach((workItem) => {
    const normalizedIdentifier = normalizeIdentifierForLookup(
      workItem.workItemId,
      'Work item identifier',
    );
    const existing = identifiers.get(normalizedIdentifier);

    if (existing) {
      throw createRepositoryError(
        WORK_ITEM_REPOSITORY_ERROR_CODES.DUPLICATE_IDENTIFIER,
        `Duplicate work item identifier: ${workItem.workItemId}`,
        {
          workItemId: workItem.workItemId,
          existingWorkItemId: existing.workItemId,
        },
      );
    }

    identifiers.set(normalizedIdentifier, workItem);
  });
}

function assertUniqueAssignmentIdentifiers(assignments) {
  const identifiers = new Map();

  assignments.forEach((assignment) => {
    const normalizedIdentifier = normalizeIdentifierForLookup(
      assignment.assignmentId,
      'Assignment identifier',
    );
    const existing = identifiers.get(normalizedIdentifier);

    if (existing) {
      throw createRepositoryError(
        WORK_ITEM_REPOSITORY_ERROR_CODES.DUPLICATE_ASSIGNMENT,
        `Duplicate work item assignment: ${assignment.assignmentId}`,
        {
          assignmentId: assignment.assignmentId,
          existingAssignmentId: existing.assignmentId,
        },
      );
    }

    identifiers.set(normalizedIdentifier, assignment);
  });
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

  const normalizedQuery = assertOptions(query, 'Work item query');

  if (
    normalizedQuery.limit !== undefined &&
    (!Number.isInteger(normalizedQuery.limit) ||
      normalizedQuery.limit < 1)
  ) {
    throw new RangeError(
      'Work item query limit must be a positive integer.',
    );
  }

  if (
    normalizedQuery.offset !== undefined &&
    (!Number.isInteger(normalizedQuery.offset) ||
      normalizedQuery.offset < 0)
  ) {
    throw new RangeError(
      'Work item query offset must be a nonnegative integer.',
    );
  }

  if (
    normalizedQuery.includeCompleted !== undefined &&
    typeof normalizedQuery.includeCompleted !== 'boolean'
  ) {
    throw new TypeError(
      'Work item includeCompleted filter must be a boolean.',
    );
  }

  return normalizedQuery;
}

function valueMatchesFilter(value, filter) {
  if (Array.isArray(filter)) {
    return filter.includes(value);
  }

  return value === filter;
}

function matchesWorkItemQuery(workItem, query) {
  if (
    query.trackingId !== undefined &&
    !valueMatchesFilter(workItem.trackingId, query.trackingId)
  ) {
    return false;
  }

  if (
    query.sourceRecordId !== undefined &&
    !valueMatchesFilter(workItem.sourceRecordId, query.sourceRecordId)
  ) {
    return false;
  }

  if (
    query.cardType !== undefined &&
    !valueMatchesFilter(workItem.cardType, query.cardType)
  ) {
    return false;
  }

  if (
    query.cardTypes !== undefined &&
    !valueMatchesFilter(workItem.cardType, query.cardTypes)
  ) {
    return false;
  }

  if (
    query.state !== undefined &&
    !valueMatchesFilter(workItem.state, query.state)
  ) {
    return false;
  }

  if (
    query.states !== undefined &&
    !valueMatchesFilter(workItem.state, query.states)
  ) {
    return false;
  }

  if (
    query.priority !== undefined &&
    !valueMatchesFilter(workItem.priority, query.priority)
  ) {
    return false;
  }

  if (
    query.priorities !== undefined &&
    !valueMatchesFilter(workItem.priority, query.priorities)
  ) {
    return false;
  }

  if (
    query.assignedTo !== undefined &&
    !valueMatchesFilter(workItem.assignedTo, query.assignedTo)
  ) {
    return false;
  }

  if (
    query.assignedGroup !== undefined &&
    !valueMatchesFilter(workItem.assignedGroup, query.assignedGroup)
  ) {
    return false;
  }

  if (
    query.partnerCode !== undefined &&
    !valueMatchesFilter(workItem.partnerCode, query.partnerCode)
  ) {
    return false;
  }

  if (
    query.validationCode !== undefined &&
    !Array.isArray(workItem.metadata?.validationCodes)
  ) {
    return false;
  }

  if (
    query.validationCode !== undefined &&
    !workItem.metadata.validationCodes.includes(query.validationCode)
  ) {
    return false;
  }

  if (
    query.includeCompleted === false &&
    workItem.state === WORK_ITEM_STATES.COMPLETED
  ) {
    return false;
  }

  return true;
}

function matchesAssignmentQuery(assignment, query) {
  if (
    query.workItemId !== undefined &&
    !valueMatchesFilter(assignment.workItemId, query.workItemId)
  ) {
    return false;
  }

  if (
    query.trackingId !== undefined &&
    !valueMatchesFilter(assignment.trackingId, query.trackingId)
  ) {
    return false;
  }

  if (
    query.assignedTo !== undefined &&
    !valueMatchesFilter(assignment.assignedTo, query.assignedTo)
  ) {
    return false;
  }

  if (
    query.assignedGroup !== undefined &&
    !valueMatchesFilter(
      assignment.assignedGroup,
      query.assignedGroup,
    )
  ) {
    return false;
  }

  if (
    query.status !== undefined &&
    !valueMatchesFilter(assignment.status, query.status)
  ) {
    return false;
  }

  return true;
}

function createWorkItemIdentifier(workItem) {
  return createDeterministicId(
    'WI',
    {
      trackingId: workItem.trackingId ?? null,
      sourceRecordId: workItem.sourceRecordId,
      cardType: workItem.cardType,
      partnerCode: workItem.partnerCode,
      title: workItem.title,
    },
    { length: 16 },
  );
}

function createAssignmentIdentifier(assignment) {
  return createDeterministicId(
    'ASN',
    {
      workItemId: assignment.workItemId,
      assignedTo: assignment.assignedTo ?? null,
      assignedGroup: assignment.assignedGroup,
      assignedAt: assignment.assignedAt,
      assignedBy: assignment.assignedBy,
    },
    { length: 16 },
  );
}

function resolveStorageAdapter(options) {
  if (options.storageAdapter !== undefined) {
    if (!isRepositoryStorageAdapter(options.storageAdapter)) {
      throw new TypeError(
        'The work item storage adapter must provide get, set, and remove methods.',
      );
    }

    return options.storageAdapter;
  }

  if (options.storage !== undefined && !isStorageLike(options.storage)) {
    throw new TypeError(
      'The supplied work item storage implementation is invalid.',
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
 * Stores seeded and derived operational work items and assignment history.
 */
export class WorkItemRepository {
  /**
   * @param {{
   *   seedWorkItems?: object[],
   *   seedAssignments?: object[],
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
    const seeds = getSeeds();

    if (
      normalizedOptions.clock !== undefined &&
      typeof normalizedOptions.clock !== 'function'
    ) {
      throw new TypeError(
        'The work item repository clock must be a function.',
      );
    }

    this.seedWorkItems = validateSeedWorkItems(
      normalizedOptions.seedWorkItems ?? seeds.workItems,
    );
    this.seedAssignments = validateSeedAssignments(
      normalizedOptions.seedAssignments ?? seeds.assignments,
    );

    assertUniqueWorkItemIdentifiers(this.seedWorkItems);
    assertUniqueAssignmentIdentifiers(this.seedAssignments);

    this.clock = normalizedOptions.clock ?? (() => new Date());
    this.storageAdapter = resolveStorageAdapter(normalizedOptions);
    this.storageKey = normalizeIdentifier(
      normalizedOptions.storageKey ??
        WORK_ITEM_REPOSITORY_STORAGE_KEY,
      'Work item repository storage key',
    );
  }

  /**
   * Lists work items after applying persisted overlays.
   *
   * @param {{
   *   trackingId?: string | string[],
   *   sourceRecordId?: string | string[],
   *   cardType?: string | string[],
   *   cardTypes?: string[],
   *   state?: string | string[],
   *   states?: string[],
   *   priority?: string | string[],
   *   priorities?: string[],
   *   assignedTo?: string | null | Array<string | null>,
   *   assignedGroup?: string | string[],
   *   partnerCode?: string | string[],
   *   validationCode?: string,
   *   includeCompleted?: boolean,
   *   limit?: number,
   *   offset?: number
   * }} [query] Work item filters.
   * @returns {object[]} Matching work items.
   */
  list(query = {}) {
    const normalizedQuery = normalizeQuery(query);
    const offset = normalizedQuery.offset ?? 0;
    const limit = normalizedQuery.limit ?? Number.POSITIVE_INFINITY;

    return this.readWorkItems()
      .filter((workItem) =>
        matchesWorkItemQuery(workItem, normalizedQuery),
      )
      .sort(
        (left, right) =>
          Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
      )
      .slice(offset, offset + limit)
      .map((workItem) => cloneValue(workItem));
  }

  /**
   * Alias for list.
   *
   * @param {object} [query] Work item filters.
   * @returns {object[]} Matching work items.
   */
  getAll(query = {}) {
    return this.list(query);
  }

  /**
   * Finds a work item by identifier.
   *
   * @param {string | number} workItemId Work item identifier.
   * @returns {object | undefined} Matching work item.
   */
  find(workItemId) {
    const workItem = this.findWorkItemInCollection(
      this.readWorkItems(),
      workItemId,
    );

    return workItem ? cloneValue(workItem) : undefined;
  }

  /**
   * Alias for find.
   *
   * @param {string | number} workItemId Work item identifier.
   * @returns {object | undefined} Matching work item.
   */
  findById(workItemId) {
    return this.find(workItemId);
  }

  /**
   * Finds work items associated with a tracking identifier.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @returns {object[]} Matching work items.
   */
  findByTrackingId(trackingId) {
    return this.list({
      trackingId: normalizeIdentifier(
        trackingId,
        'Tracking identifier',
      ),
    });
  }

  /**
   * Finds work items associated with a source record.
   *
   * @param {string | number} sourceRecordId Source record identifier.
   * @returns {object[]} Matching work items.
   */
  findBySourceRecordId(sourceRecordId) {
    return this.list({
      sourceRecordId: normalizeIdentifier(
        sourceRecordId,
        'Source record identifier',
      ),
    });
  }

  /**
   * Returns a work item or throws when absent.
   *
   * @param {string | number} workItemId Work item identifier.
   * @returns {object} Matching work item.
   */
  get(workItemId) {
    const workItem = this.find(workItemId);

    if (!workItem) {
      throw createRepositoryError(
        WORK_ITEM_REPOSITORY_ERROR_CODES.NOT_FOUND,
        `Work item not found: ${workItemId}`,
        { workItemId: String(workItemId) },
      );
    }

    return workItem;
  }

  /**
   * Creates a derived operational work item.
   *
   * @param {object} workItem Initial work item values.
   * @returns {object} Created work item.
   */
  create(workItem) {
    if (!isObject(workItem)) {
      throw new TypeError('A work item must be an object.');
    }

    const timestamp = toIsoTimestamp(this.clock());
    const candidate = {
      ...cloneValue(workItem),
      workItemId:
        workItem.workItemId ?? createWorkItemIdentifier(workItem),
      trackingId:
        workItem.trackingId === undefined
          ? null
          : normalizeNullableIdentifier(
              workItem.trackingId,
              'Tracking identifier',
            ),
      state: workItem.state ?? WORK_ITEM_STATES.PENDING,
      priority: workItem.priority ?? PRIORITIES.NORMAL,
      assignedTo:
        workItem.assignedTo === undefined
          ? null
          : normalizeNullableIdentifier(
              workItem.assignedTo,
              'Assigned user identifier',
            ),
      metadata: workItem.metadata ?? {},
      createdAt: workItem.createdAt ?? timestamp,
      updatedAt: workItem.updatedAt ?? timestamp,
      completedAt: workItem.completedAt ?? null,
      history: workItem.history ?? [],
    };
    const parsedWorkItem = parseWorkItem(candidate);

    if (this.find(parsedWorkItem.workItemId)) {
      throw createRepositoryError(
        WORK_ITEM_REPOSITORY_ERROR_CODES.DUPLICATE_IDENTIFIER,
        `A work item already exists: ${parsedWorkItem.workItemId}`,
        { workItemId: parsedWorkItem.workItemId },
      );
    }

    const state = this.readState();
    const nextWorkItems = [...this.buildWorkItems(state), parsedWorkItem];

    assertUniqueWorkItemIdentifiers(nextWorkItems);

    state.overlays[parsedWorkItem.workItemId] =
      cloneValue(parsedWorkItem);
    state.removedWorkItemIds = state.removedWorkItemIds.filter(
      (workItemId) => workItemId !== parsedWorkItem.workItemId,
    );
    this.persistState(state);

    return cloneValue(parsedWorkItem);
  }

  /**
   * Alias for create used by operational derivation services.
   *
   * @param {object} workItem Initial work item values.
   * @returns {object} Created work item.
   */
  createDerivedWorkItem(workItem) {
    return this.create(workItem);
  }

  /**
   * Saves a complete work item.
   *
   * @param {object} workItem Work item to persist.
   * @param {{expectedUpdatedAt?: string}} [options] Save options.
   * @returns {object} Persisted work item.
   */
  save(workItem, options = {}) {
    const normalizedOptions = assertOptions(
      options,
      'Work item save options',
    );
    const parsedWorkItem = parseWorkItem(workItem);
    const state = this.readState();
    const workItems = this.buildWorkItems(state);
    const currentWorkItem = this.findWorkItemInCollection(
      workItems,
      parsedWorkItem.workItemId,
    );

    this.assertExpectedUpdatedAt(currentWorkItem, normalizedOptions);

    if (currentWorkItem) {
      assertCanonicalFieldsUnchanged(
        currentWorkItem,
        parsedWorkItem,
        CANONICAL_WORK_ITEM_FIELDS,
        WORK_ITEM_REPOSITORY_ERROR_CODES.IDENTIFIER_CHANGE,
        'work item',
      );
    }

    const nextWorkItems = currentWorkItem
      ? workItems.map((candidate) =>
          candidate.workItemId === currentWorkItem.workItemId
            ? parsedWorkItem
            : candidate,
        )
      : [...workItems, parsedWorkItem];

    assertUniqueWorkItemIdentifiers(nextWorkItems);

    state.overlays[parsedWorkItem.workItemId] =
      cloneValue(parsedWorkItem);
    state.removedWorkItemIds = state.removedWorkItemIds.filter(
      (workItemId) => workItemId !== parsedWorkItem.workItemId,
    );
    this.persistState(state);

    return cloneValue(parsedWorkItem);
  }

  /**
   * Alias for save.
   *
   * @param {object} workItem Work item to persist.
   * @param {object} [options] Save options.
   * @returns {object} Persisted work item.
   */
  upsert(workItem, options = {}) {
    return this.save(workItem, options);
  }

  /**
   * Atomically patches an existing work item.
   *
   * @param {string | number} workItemId Work item identifier.
   * @param {object | ((workItem: object) => object)} update Patch or updater.
   * @param {{expectedUpdatedAt?: string, touchUpdatedAt?: boolean}} [options]
   * Update options.
   * @returns {object} Updated work item.
   */
  update(workItemId, update, options = {}) {
    const normalizedOptions = assertOptions(
      options,
      'Work item update options',
    );

    if (typeof update !== 'function' && !isObject(update)) {
      throw new TypeError(
        'A work item update must be an object or updater function.',
      );
    }

    const state = this.readState();
    const workItems = this.buildWorkItems(state);
    const currentWorkItem = this.findWorkItemInCollection(
      workItems,
      workItemId,
    );

    if (!currentWorkItem) {
      throw createRepositoryError(
        WORK_ITEM_REPOSITORY_ERROR_CODES.NOT_FOUND,
        `Work item not found: ${workItemId}`,
        { workItemId: String(workItemId) },
      );
    }

    this.assertExpectedUpdatedAt(currentWorkItem, normalizedOptions);

    const updateValue =
      typeof update === 'function'
        ? update(cloneValue(currentWorkItem))
        : update;

    if (!isObject(updateValue)) {
      throw new TypeError(
        'The work item updater must return a work item or patch object.',
      );
    }

    const timestamp = toIsoTimestamp(this.clock());
    const nextWorkItem = parseWorkItem({
      ...deepMerge(currentWorkItem, updateValue),
      ...(normalizedOptions.touchUpdatedAt === false
        ? {}
        : { updatedAt: timestamp }),
    });

    assertCanonicalFieldsUnchanged(
      currentWorkItem,
      nextWorkItem,
      CANONICAL_WORK_ITEM_FIELDS,
      WORK_ITEM_REPOSITORY_ERROR_CODES.IDENTIFIER_CHANGE,
      'work item',
    );

    state.overlays[currentWorkItem.workItemId] =
      cloneValue(nextWorkItem);
    state.removedWorkItemIds = state.removedWorkItemIds.filter(
      (removedWorkItemId) =>
        removedWorkItemId !== currentWorkItem.workItemId,
    );
    this.persistState(state);

    return cloneValue(nextWorkItem);
  }

  /**
   * Alias for update emphasizing transactional behavior.
   *
   * @param {string | number} workItemId Work item identifier.
   * @param {object | ((workItem: object) => object)} update Patch or updater.
   * @param {object} [options] Update options.
   * @returns {object} Updated work item.
   */
  atomicUpdate(workItemId, update, options = {}) {
    return this.update(workItemId, update, options);
  }

  /**
   * Transitions a work item to a valid state and appends history.
   *
   * @param {string | number} workItemId Work item identifier.
   * @param {{
   *   targetState: string,
   *   actorId: string,
   *   actorType?: string,
   *   comment?: string,
   *   reasonCode?: string
   * }} transition Transition details.
   * @param {{
   *   expectedUpdatedAt?: string,
   *   allowReopen?: boolean
   * }} [options] Transition options.
   * @returns {object} Updated work item.
   */
  transition(workItemId, transition, options = {}) {
    const normalizedTransition = assertOptions(
      transition,
      'Work item transition',
    );
    const normalizedOptions = assertOptions(
      options,
      'Work item transition options',
    );
    const targetState = normalizeIdentifier(
      normalizedTransition.targetState,
      'Target work item state',
    );
    const actorId = normalizeIdentifier(
      normalizedTransition.actorId,
      'Transition actor identifier',
    );
    const actorType =
      normalizedTransition.actorType ??
      AUDIT_ACTOR_TYPES.INTERNAL_USER;
    const currentWorkItem = this.get(workItemId);

    this.assertValidStateTransition(
      currentWorkItem.state,
      targetState,
      normalizedOptions.allowReopen === true,
    );

    const comment =
      typeof normalizedTransition.comment === 'string'
        ? normalizedTransition.comment.trim()
        : '';

    if (
      targetState === WORK_ITEM_STATES.ACTION_NEEDED &&
      comment === ''
    ) {
      throw createRepositoryError(
        WORK_ITEM_REPOSITORY_ERROR_CODES.INVALID_STATE_TRANSITION,
        'A comment is required when a work item needs action.',
        {
          workItemId: currentWorkItem.workItemId,
          targetState,
        },
      );
    }

    const historyComment =
      comment ||
      (normalizedTransition.reasonCode
        ? `State changed: ${normalizedTransition.reasonCode}`
        : `State changed to ${targetState}.`);
    const timestamp = toIsoTimestamp(this.clock());

    return this.update(
      currentWorkItem.workItemId,
      {
        state: targetState,
        completedAt:
          targetState === WORK_ITEM_STATES.COMPLETED
            ? timestamp
            : null,
        history: [
          ...currentWorkItem.history,
          {
            previousState: currentWorkItem.state,
            currentState: targetState,
            actorType,
            actorId,
            comment: historyComment,
            timestamp,
            ...(normalizedTransition.reasonCode === undefined
              ? {}
              : { reasonCode: normalizedTransition.reasonCode }),
          },
        ],
      },
      {
        expectedUpdatedAt: normalizedOptions.expectedUpdatedAt,
      },
    );
  }

  /**
   * Alias for transition.
   *
   * @param {string | number} workItemId Work item identifier.
   * @param {object} transition Transition details.
   * @param {object} [options] Transition options.
   * @returns {object} Updated work item.
   */
  transitionState(workItemId, transition, options = {}) {
    return this.transition(workItemId, transition, options);
  }

  /**
   * Appends an informational history entry without changing state.
   *
   * @param {string | number} workItemId Work item identifier.
   * @param {{
   *   actorId: string,
   *   actorType?: string,
   *   comment: string,
   *   timestamp?: Date | string | number
   * }} entry History entry.
   * @param {{expectedUpdatedAt?: string}} [options] Update options.
   * @returns {object} Updated work item.
   */
  appendHistory(workItemId, entry, options = {}) {
    const normalizedEntry = assertOptions(
      entry,
      'Work item history entry',
    );
    const workItem = this.get(workItemId);
    const comment = normalizeIdentifier(
      normalizedEntry.comment,
      'Work item history comment',
    );
    const actorId = normalizeIdentifier(
      normalizedEntry.actorId,
      'History actor identifier',
    );

    return this.update(
      workItem.workItemId,
      {
        history: [
          ...workItem.history,
          {
            previousState: workItem.state,
            currentState: workItem.state,
            actorType:
              normalizedEntry.actorType ??
              AUDIT_ACTOR_TYPES.INTERNAL_USER,
            actorId,
            comment,
            timestamp: toIsoTimestamp(
              normalizedEntry.timestamp ?? this.clock(),
            ),
          },
        ],
      },
      options,
    );
  }

  /**
   * Assigns a work item and records an assignment entity.
   *
   * @param {string | number} workItemId Work item identifier.
   * @param {{
   *   assignedTo: string | null,
   *   assignedGroup: string,
   *   assignedBy: string,
   *   assignmentReason: string,
   *   actorType?: string,
   *   comment?: string,
   *   assignmentId?: string,
   *   assignedAt?: Date | string | number
   * }} assignment Assignment details.
   * @param {{expectedUpdatedAt?: string}} [options] Assignment options.
   * @returns {object} Created assignment record.
   */
  assign(workItemId, assignment, options = {}) {
    const normalizedAssignment = assertOptions(
      assignment,
      'Work item assignment',
    );
    const normalizedOptions = assertOptions(
      options,
      'Work item assignment options',
    );
    const state = this.readState();
    const workItems = this.buildWorkItems(state);
    const currentWorkItem = this.findWorkItemInCollection(
      workItems,
      workItemId,
    );

    if (!currentWorkItem) {
      throw createRepositoryError(
        WORK_ITEM_REPOSITORY_ERROR_CODES.NOT_FOUND,
        `Work item not found: ${workItemId}`,
        { workItemId: String(workItemId) },
      );
    }

    this.assertExpectedUpdatedAt(currentWorkItem, normalizedOptions);

    const assignedAt = toIsoTimestamp(
      normalizedAssignment.assignedAt ?? this.clock(),
    );
    const assignedTo = normalizeNullableIdentifier(
      normalizedAssignment.assignedTo,
      'Assigned user identifier',
    );
    const assignedGroup = normalizeIdentifier(
      normalizedAssignment.assignedGroup,
      'Assigned group',
    );
    const assignedBy = normalizeIdentifier(
      normalizedAssignment.assignedBy,
      'Assigning actor identifier',
    );
    const assignmentReason = normalizeIdentifier(
      normalizedAssignment.assignmentReason,
      'Assignment reason',
    );
    const candidate = {
      assignmentId:
        normalizedAssignment.assignmentId ??
        createAssignmentIdentifier({
          workItemId: currentWorkItem.workItemId,
          assignedTo,
          assignedGroup,
          assignedBy,
          assignedAt,
        }),
      workItemId: currentWorkItem.workItemId,
      trackingId: currentWorkItem.trackingId,
      assignedTo,
      assignedGroup,
      assignedBy,
      assignmentReason,
      status: 'active',
      assignedAt,
      releasedAt: null,
    };
    const parsedAssignment = parseAssignment(candidate);
    const assignments = this.buildAssignments(state);

    if (
      this.findAssignmentInCollection(
        assignments,
        parsedAssignment.assignmentId,
      )
    ) {
      throw createRepositoryError(
        WORK_ITEM_REPOSITORY_ERROR_CODES.DUPLICATE_ASSIGNMENT,
        `A work item assignment already exists: ${parsedAssignment.assignmentId}`,
        { assignmentId: parsedAssignment.assignmentId },
      );
    }

    assignments
      .filter(
        (currentAssignment) =>
          currentAssignment.workItemId === currentWorkItem.workItemId &&
          currentAssignment.status === 'active',
      )
      .forEach((currentAssignment) => {
        state.assignmentOverlays[currentAssignment.assignmentId] = {
          ...cloneValue(currentAssignment),
          status: 'released',
          releasedAt: assignedAt,
        };
      });

    const comment =
      typeof normalizedAssignment.comment === 'string' &&
      normalizedAssignment.comment.trim() !== ''
        ? normalizedAssignment.comment.trim()
        : `Assigned to ${assignedTo ?? assignedGroup}.`;
    const updatedWorkItem = parseWorkItem({
      ...currentWorkItem,
      assignedTo,
      assignedGroup,
      updatedAt: assignedAt,
      history: [
        ...currentWorkItem.history,
        {
          previousState: currentWorkItem.state,
          currentState: currentWorkItem.state,
          actorType:
            normalizedAssignment.actorType ??
            AUDIT_ACTOR_TYPES.INTERNAL_USER,
          actorId: assignedBy,
          comment,
          timestamp: assignedAt,
          assignmentId: parsedAssignment.assignmentId,
          assignmentReason,
        },
      ],
    });

    state.overlays[currentWorkItem.workItemId] =
      cloneValue(updatedWorkItem);
    state.assignmentOverlays[parsedAssignment.assignmentId] =
      cloneValue(parsedAssignment);
    state.removedAssignmentIds = state.removedAssignmentIds.filter(
      (assignmentId) =>
        assignmentId !== parsedAssignment.assignmentId,
    );
    this.persistState(state);

    return cloneValue(parsedAssignment);
  }

  /**
   * Alias for assign.
   *
   * @param {string | number} workItemId Work item identifier.
   * @param {object} assignment Assignment details.
   * @param {object} [options] Assignment options.
   * @returns {object} Created assignment record.
   */
  assignWorkItem(workItemId, assignment, options = {}) {
    return this.assign(workItemId, assignment, options);
  }

  /**
   * Releases the active assignment for a work item.
   *
   * @param {string | number} workItemId Work item identifier.
   * @param {{
   *   releasedBy: string,
   *   actorType?: string,
   *   comment?: string,
   *   releasedAt?: Date | string | number
   * }} release Release details.
   * @param {{expectedUpdatedAt?: string}} [options] Release options.
   * @returns {object[]} Released assignment records.
   */
  releaseAssignment(workItemId, release, options = {}) {
    const normalizedRelease = assertOptions(
      release,
      'Work item assignment release',
    );
    const normalizedOptions = assertOptions(
      options,
      'Work item assignment release options',
    );
    const state = this.readState();
    const workItems = this.buildWorkItems(state);
    const currentWorkItem = this.findWorkItemInCollection(
      workItems,
      workItemId,
    );

    if (!currentWorkItem) {
      throw createRepositoryError(
        WORK_ITEM_REPOSITORY_ERROR_CODES.NOT_FOUND,
        `Work item not found: ${workItemId}`,
        { workItemId: String(workItemId) },
      );
    }

    this.assertExpectedUpdatedAt(currentWorkItem, normalizedOptions);

    const releasedBy = normalizeIdentifier(
      normalizedRelease.releasedBy,
      'Releasing actor identifier',
    );
    const releasedAt = toIsoTimestamp(
      normalizedRelease.releasedAt ?? this.clock(),
    );
    const activeAssignments = this.buildAssignments(state).filter(
      (assignment) =>
        assignment.workItemId === currentWorkItem.workItemId &&
        assignment.status === 'active',
    );

    if (activeAssignments.length === 0) {
      throw createRepositoryError(
        WORK_ITEM_REPOSITORY_ERROR_CODES.ASSIGNMENT_NOT_FOUND,
        `No active assignment exists for work item: ${workItemId}`,
        { workItemId: currentWorkItem.workItemId },
      );
    }

    const releasedAssignments = activeAssignments.map((assignment) =>
      parseAssignment({
        ...assignment,
        status: 'released',
        releasedAt,
      }),
    );

    releasedAssignments.forEach((assignment) => {
      state.assignmentOverlays[assignment.assignmentId] =
        cloneValue(assignment);
    });

    state.overlays[currentWorkItem.workItemId] = parseWorkItem({
      ...currentWorkItem,
      assignedTo: null,
      updatedAt: releasedAt,
      history: [
        ...currentWorkItem.history,
        {
          previousState: currentWorkItem.state,
          currentState: currentWorkItem.state,
          actorType:
            normalizedRelease.actorType ??
            AUDIT_ACTOR_TYPES.INTERNAL_USER,
          actorId: releasedBy,
          comment:
            normalizedRelease.comment?.trim() ||
            'The work item assignment was released.',
          timestamp: releasedAt,
        },
      ],
    });

    this.persistState(state);
    return cloneValue(releasedAssignments);
  }

  /**
   * Lists assignment records.
   *
   * @param {{
   *   workItemId?: string | string[],
   *   trackingId?: string | string[] | null,
   *   assignedTo?: string | string[] | null,
   *   assignedGroup?: string | string[],
   *   status?: string | string[],
   *   limit?: number,
   *   offset?: number
   * }} [query] Assignment filters.
   * @returns {object[]} Matching assignment records.
   */
  listAssignments(query = {}) {
    const normalizedQuery = normalizeQuery(query);
    const offset = normalizedQuery.offset ?? 0;
    const limit = normalizedQuery.limit ?? Number.POSITIVE_INFINITY;

    return this.readAssignments()
      .filter((assignment) =>
        matchesAssignmentQuery(assignment, normalizedQuery),
      )
      .sort(
        (left, right) =>
          Date.parse(right.assignedAt) - Date.parse(left.assignedAt),
      )
      .slice(offset, offset + limit)
      .map((assignment) => cloneValue(assignment));
  }

  /**
   * Finds an assignment by identifier.
   *
   * @param {string | number} assignmentId Assignment identifier.
   * @returns {object | undefined} Matching assignment.
   */
  findAssignment(assignmentId) {
    const assignment = this.findAssignmentInCollection(
      this.readAssignments(),
      assignmentId,
    );

    return assignment ? cloneValue(assignment) : undefined;
  }

  /**
   * Returns assignment history for a work item.
   *
   * @param {string | number} workItemId Work item identifier.
   * @returns {object[]} Assignment records.
   */
  findAssignmentsByWorkItemId(workItemId) {
    return this.listAssignments({
      workItemId: normalizeIdentifier(
        workItemId,
        'Work item identifier',
      ),
    });
  }

  /**
   * Returns state counts for the supplied work item filters.
   *
   * @param {object} [query] Base work item filters.
   * @returns {{pending: number, action_needed: number, completed: number}}
   * Work item state counts.
   */
  getStateCounts(query = {}) {
    const normalizedQuery = normalizeQuery(query);
    const baseQuery = {
      ...normalizedQuery,
    };

    delete baseQuery.state;
    delete baseQuery.states;
    delete baseQuery.limit;
    delete baseQuery.offset;
    delete baseQuery.includeCompleted;

    const counts = {
      [WORK_ITEM_STATES.PENDING]: 0,
      [WORK_ITEM_STATES.ACTION_NEEDED]: 0,
      [WORK_ITEM_STATES.COMPLETED]: 0,
    };

    this.readWorkItems()
      .filter((workItem) => matchesWorkItemQuery(workItem, baseQuery))
      .forEach((workItem) => {
        counts[workItem.state] += 1;
      });

    return Object.freeze(counts);
  }

  /**
   * Removes a work item and its assignment records.
   *
   * @param {string | number} workItemId Work item identifier.
   * @returns {boolean} Whether a work item was removed.
   */
  remove(workItemId) {
    const state = this.readState();
    const workItems = this.buildWorkItems(state);
    const workItem = this.findWorkItemInCollection(
      workItems,
      workItemId,
    );

    if (!workItem) {
      return false;
    }

    const isSeedWorkItem = this.seedWorkItems.some(
      (seedWorkItem) =>
        seedWorkItem.workItemId === workItem.workItemId,
    );

    delete state.overlays[workItem.workItemId];

    if (
      isSeedWorkItem &&
      !state.removedWorkItemIds.includes(workItem.workItemId)
    ) {
      state.removedWorkItemIds.push(workItem.workItemId);
    }

    this.buildAssignments(state)
      .filter(
        (assignment) =>
          assignment.workItemId === workItem.workItemId,
      )
      .forEach((assignment) => {
        delete state.assignmentOverlays[assignment.assignmentId];

        if (
          this.seedAssignments.some(
            (seedAssignment) =>
              seedAssignment.assignmentId ===
              assignment.assignmentId,
          ) &&
          !state.removedAssignmentIds.includes(
            assignment.assignmentId,
          )
        ) {
          state.removedAssignmentIds.push(assignment.assignmentId);
        }
      });

    this.persistState(state);
    return true;
  }

  /**
   * Alias for remove.
   *
   * @param {string | number} workItemId Work item identifier.
   * @returns {boolean} Whether a work item was removed.
   */
  delete(workItemId) {
    return this.remove(workItemId);
  }

  /**
   * Removes persisted changes and restores seeded work items.
   *
   * @returns {object[]} Seeded work items.
   */
  reset() {
    const removed = this.storageAdapter.remove(this.storageKey);

    if (!removed) {
      throw this.createPersistenceError('reset');
    }

    return this.seedWorkItems.map((workItem) => cloneValue(workItem));
  }

  readState() {
    const state = this.storageAdapter.get(
      this.storageKey,
      workItemRepositoryStateSchema,
      createEmptyState(),
    );

    return cloneValue(state);
  }

  buildWorkItems(state) {
    const removedWorkItemIds = new Set(state.removedWorkItemIds);
    const workItemsById = new Map();

    this.seedWorkItems.forEach((workItem) => {
      if (!removedWorkItemIds.has(workItem.workItemId)) {
        workItemsById.set(workItem.workItemId, cloneValue(workItem));
      }
    });

    Object.entries(state.overlays).forEach(
      ([workItemId, overlay]) => {
        if (removedWorkItemIds.has(workItemId)) {
          return;
        }

        if (!isObject(overlay)) {
          throw createRepositoryError(
            WORK_ITEM_REPOSITORY_ERROR_CODES.INVALID_WORK_ITEM,
            `Invalid persisted work item overlay: ${workItemId}`,
            { workItemId },
          );
        }

        const existingWorkItem = workItemsById.get(workItemId);
        const mergedWorkItem = existingWorkItem
          ? deepMerge(existingWorkItem, overlay)
          : cloneValue(overlay);
        const parsedWorkItem = parseWorkItem(mergedWorkItem);

        if (parsedWorkItem.workItemId !== workItemId) {
          throw createRepositoryError(
            WORK_ITEM_REPOSITORY_ERROR_CODES.INVALID_WORK_ITEM,
            'A persisted work item overlay has a mismatched identifier.',
            {
              overlayKey: workItemId,
              workItemId: parsedWorkItem.workItemId,
            },
          );
        }

        workItemsById.set(workItemId, parsedWorkItem);
      },
    );

    const workItems = [...workItemsById.values()];

    assertUniqueWorkItemIdentifiers(workItems);
    return workItems;
  }

  buildAssignments(state) {
    const removedAssignmentIds = new Set(
      state.removedAssignmentIds,
    );
    const assignmentsById = new Map();

    this.seedAssignments.forEach((assignment) => {
      if (!removedAssignmentIds.has(assignment.assignmentId)) {
        assignmentsById.set(
          assignment.assignmentId,
          cloneValue(assignment),
        );
      }
    });

    Object.entries(state.assignmentOverlays).forEach(
      ([assignmentId, overlay]) => {
        if (removedAssignmentIds.has(assignmentId)) {
          return;
        }

        if (!isObject(overlay)) {
          throw createRepositoryError(
            WORK_ITEM_REPOSITORY_ERROR_CODES.INVALID_ASSIGNMENT,
            `Invalid persisted assignment overlay: ${assignmentId}`,
            { assignmentId },
          );
        }

        const existingAssignment = assignmentsById.get(assignmentId);
        const mergedAssignment = existingAssignment
          ? deepMerge(existingAssignment, overlay)
          : cloneValue(overlay);
        const parsedAssignment = parseAssignment(mergedAssignment);

        if (parsedAssignment.assignmentId !== assignmentId) {
          throw createRepositoryError(
            WORK_ITEM_REPOSITORY_ERROR_CODES.INVALID_ASSIGNMENT,
            'A persisted assignment overlay has a mismatched identifier.',
            {
              overlayKey: assignmentId,
              assignmentId: parsedAssignment.assignmentId,
            },
          );
        }

        assignmentsById.set(assignmentId, parsedAssignment);
      },
    );

    const assignments = [...assignmentsById.values()];

    assertUniqueAssignmentIdentifiers(assignments);
    return assignments;
  }

  readWorkItems() {
    try {
      return this.buildWorkItems(this.readState());
    } catch {
      this.storageAdapter.remove(this.storageKey);
      return this.seedWorkItems.map((workItem) => cloneValue(workItem));
    }
  }

  readAssignments() {
    try {
      return this.buildAssignments(this.readState());
    } catch {
      this.storageAdapter.remove(this.storageKey);
      return this.seedAssignments.map((assignment) =>
        cloneValue(assignment),
      );
    }
  }

  findWorkItemInCollection(workItems, workItemId) {
    const normalizedWorkItemId = normalizeIdentifierForLookup(
      workItemId,
      'Work item identifier',
    );

    return workItems.find(
      (workItem) =>
        normalizeIdentifierForLookup(
          workItem.workItemId,
          'Work item identifier',
        ) === normalizedWorkItemId,
    );
  }

  findAssignmentInCollection(assignments, assignmentId) {
    const normalizedAssignmentId = normalizeIdentifierForLookup(
      assignmentId,
      'Assignment identifier',
    );

    return assignments.find(
      (assignment) =>
        normalizeIdentifierForLookup(
          assignment.assignmentId,
          'Assignment identifier',
        ) === normalizedAssignmentId,
    );
  }

  assertExpectedUpdatedAt(workItem, options) {
    if (
      workItem &&
      options.expectedUpdatedAt !== undefined &&
      workItem.updatedAt !== options.expectedUpdatedAt
    ) {
      throw createRepositoryError(
        WORK_ITEM_REPOSITORY_ERROR_CODES.CONFLICT,
        'The work item was changed after it was last read.',
        {
          workItemId: workItem.workItemId,
          expectedUpdatedAt: options.expectedUpdatedAt,
          actualUpdatedAt: workItem.updatedAt,
        },
      );
    }
  }

  assertValidStateTransition(currentState, targetState, allowReopen) {
    if (!Object.values(WORK_ITEM_STATES).includes(targetState)) {
      throw createRepositoryError(
        WORK_ITEM_REPOSITORY_ERROR_CODES.INVALID_STATE_TRANSITION,
        `Unsupported work item state: ${targetState}`,
        { currentState, targetState },
      );
    }

    const allowedStates =
      ALLOWED_STATE_TRANSITIONS[currentState] ?? [];
    const isReopen =
      currentState === WORK_ITEM_STATES.COMPLETED &&
      allowReopen &&
      (targetState === WORK_ITEM_STATES.PENDING ||
        targetState === WORK_ITEM_STATES.ACTION_NEEDED);

    if (!allowedStates.includes(targetState) && !isReopen) {
      throw createRepositoryError(
        WORK_ITEM_REPOSITORY_ERROR_CODES.INVALID_STATE_TRANSITION,
        `Work item state cannot transition from ${currentState} to ${targetState}.`,
        {
          currentState,
          targetState,
          allowedStates,
          allowReopen,
        },
      );
    }
  }

  persistState(state) {
    const result = workItemRepositoryStateSchema.safeParse(state);

    if (!result.success) {
      throw createRepositoryError(
        WORK_ITEM_REPOSITORY_ERROR_CODES.PERSISTENCE_FAILED,
        'The work item repository state is invalid.',
        { issues: result.error.issues },
        result.error,
      );
    }

    if (
      !this.storageAdapter.set(
        this.storageKey,
        result.data,
        workItemRepositoryStateSchema,
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
      WORK_ITEM_REPOSITORY_ERROR_CODES.PERSISTENCE_FAILED,
      `Unable to ${operation} persisted work items.`,
      {
        operation,
        storageError: storageError ?? null,
      },
      storageError,
    );
  }
}

/**
 * Creates a work item repository.
 *
 * @param {ConstructorParameters<typeof WorkItemRepository>[0]} [options]
 * Repository options.
 * @returns {WorkItemRepository} Repository instance.
 */
export function createWorkItemRepository(options = {}) {
  return new WorkItemRepository(options);
}

export const OperationsWorkItemRepository = WorkItemRepository;
export const createOperationsWorkItemRepository =
  createWorkItemRepository;

export default WorkItemRepository;