import {
  AUDIT_ACTOR_TYPES,
  AUDIT_SOURCES,
  PRIORITIES,
  WORKFLOW_STAGES,
  WORK_ITEM_STATES,
  WORK_ITEM_TYPES,
} from '../../constants/domain.js';
import { PERMISSIONS, ROLES } from '../../constants/roles.js';
import { canPerformAction } from '../../auth/permissionPolicy.js';
import { PartnerScopeGuard } from '../../auth/partnerScopeGuard.js';
import { WorkItemRepository } from '../../repositories/workItemRepository.js';
import { toIsoTimestamp } from '../../utils/dates.js';
import { AuditService } from '../shared/auditService.js';

export const OPERATIONS_WORKBENCH_ERROR_CODES = Object.freeze({
  INVALID_OPTIONS: 'OPERATIONS_WORKBENCH_INVALID_OPTIONS',
  INVALID_REQUEST: 'OPERATIONS_WORKBENCH_INVALID_REQUEST',
  INVALID_DEPENDENCY: 'OPERATIONS_WORKBENCH_INVALID_DEPENDENCY',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN_ROLE: 'FORBIDDEN_ROLE',
  PARTNER_SCOPE_VIOLATION: 'PARTNER_SCOPE_VIOLATION',
  WORK_ITEM_NOT_FOUND: 'OPERATIONS_WORKBENCH_WORK_ITEM_NOT_FOUND',
  INVALID_STATE_TRANSITION:
    'OPERATIONS_WORKBENCH_INVALID_STATE_TRANSITION',
  INVALID_ASSIGNMENT: 'OPERATIONS_WORKBENCH_INVALID_ASSIGNMENT',
  DUPLICATE_WORK_ITEM: 'OPERATIONS_WORKBENCH_DUPLICATE_WORK_ITEM',
  OPERATION_FAILED: 'OPERATIONS_WORKBENCH_OPERATION_FAILED',
  AUDIT_FAILED: 'OPERATIONS_WORKBENCH_AUDIT_FAILED',
});

export const OPERATIONS_WORKBENCH_ACTIONS = Object.freeze({
  SEARCHED: 'OPERATIONS_WORK_ITEMS_SEARCHED',
  DERIVED: 'OPERATIONS_WORK_ITEM_DERIVED',
  TRANSITIONED: 'OPERATIONS_WORK_ITEM_TRANSITIONED',
  ASSIGNED: 'OPERATIONS_WORK_ITEM_ASSIGNED',
  ASSIGNMENT_RELEASED: 'OPERATIONS_WORK_ITEM_ASSIGNMENT_RELEASED',
  DTCC_MANUALLY_ROUTED: 'DTCC_CHANGE_MANUALLY_ROUTED',
});

export const DEFAULT_OPERATIONS_WORKBENCH_PAGE_SIZE = 25;
export const MAX_OPERATIONS_WORKBENCH_PAGE_SIZE = 100;

const REOPEN_ROLES = new Set([ROLES.MANAGER, ROLES.ADMIN]);

const MUTATION_PERMISSIONS = Object.freeze({
  [WORK_ITEM_TYPES.APPOINTMENT]: PERMISSIONS.MANAGE_APPOINTMENTS,
  [WORK_ITEM_TYPES.BACKGROUND_CHECK]: PERMISSIONS.MANAGE_WORK_ITEMS,
  [WORK_ITEM_TYPES.EXCEPTION]: PERMISSIONS.RESOLVE_EXCEPTIONS,
  [WORK_ITEM_TYPES.DISTRIBUTION_APPROVAL]:
    PERMISSIONS.REVIEW_DISTRIBUTION,
  [WORK_ITEM_TYPES.AGENCY_REVIEW]: PERMISSIONS.MANAGE_WORK_ITEMS,
  [WORK_ITEM_TYPES.SYNC_FAILURE]: PERMISSIONS.RESOLVE_EXCEPTIONS,
  [WORK_ITEM_TYPES.DTCC_MANUAL_CHANGE]:
    PERMISSIONS.MANAGE_CONTRACT_CHANGES,
  [WORK_ITEM_TYPES.EXPLANATION_LETTER]:
    PERMISSIONS.REVIEW_LICENSING,
});

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertOptions(
  options,
  description = 'Operations workbench options',
) {
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

function normalizeOptionalIdentifier(value) {
  if (
    value === null ||
    value === undefined ||
    String(value).trim() === ''
  ) {
    return undefined;
  }

  return String(value).trim();
}

function normalizeNullableIdentifier(value, description) {
  if (value === null || value === undefined) {
    return null;
  }

  return normalizeIdentifier(value, description);
}

function normalizeIdentifierForLookup(value) {
  return normalizeOptionalIdentifier(value)
    ?.normalize('NFKC')
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

function createWorkbenchError(code, message, details, cause) {
  const error = new Error(message, {
    ...(cause === undefined ? {} : { cause }),
  });

  error.name = 'OperationsWorkbenchServiceError';
  error.code = code;
  error.details = details ?? null;
  error.recoverable = true;

  return error;
}

function assertRepository(repository) {
  const requiredMethods = [
    'assign',
    'create',
    'find',
    'getStateCounts',
    'list',
    'releaseAssignment',
    'transition',
  ];

  if (
    !isObject(repository) ||
    requiredMethods.some(
      (method) => typeof repository[method] !== 'function',
    )
  ) {
    throw createWorkbenchError(
      OPERATIONS_WORKBENCH_ERROR_CODES.INVALID_DEPENDENCY,
      'The work item repository does not provide the required methods.',
      { requiredMethods },
    );
  }

  return repository;
}

function assertScopeGuard(scopeGuard) {
  if (
    !isObject(scopeGuard) ||
    typeof scopeGuard.canAccessRecord !== 'function' ||
    typeof scopeGuard.filterRecords !== 'function'
  ) {
    throw createWorkbenchError(
      OPERATIONS_WORKBENCH_ERROR_CODES.INVALID_DEPENDENCY,
      'The partner scope guard must provide canAccessRecord and filterRecords.',
      {
        requiredMethods: ['canAccessRecord', 'filterRecords'],
      },
    );
  }

  return scopeGuard;
}

function assertOptionalAuditService(auditService) {
  if (
    auditService === undefined ||
    auditService === null ||
    auditService === false
  ) {
    return null;
  }

  if (
    !isObject(auditService) ||
    (typeof auditService.append !== 'function' &&
      typeof auditService.create !== 'function')
  ) {
    throw createWorkbenchError(
      OPERATIONS_WORKBENCH_ERROR_CODES.INVALID_DEPENDENCY,
      'The operations audit service must provide append or create.',
      null,
    );
  }

  return auditService;
}

function getPrincipalUser(principal) {
  if (!isObject(principal)) {
    return null;
  }

  if (isObject(principal.user)) {
    return principal.user;
  }

  if (isObject(principal.currentUser)) {
    return principal.currentUser;
  }

  return principal;
}

function getPrincipalRole(principal) {
  if (typeof principal === 'string') {
    return principal;
  }

  const user = getPrincipalUser(principal);

  return principal?.role ?? user?.role ?? null;
}

function getPrincipalId(principal) {
  if (typeof principal === 'string') {
    return 'system';
  }

  const user = getPrincipalUser(principal);

  return (
    normalizeOptionalIdentifier(
      principal?.actorId ??
        principal?.userId ??
        principal?.id ??
        user?.id,
    ) ?? 'system'
  );
}

function isAuthenticatedPrincipal(principal) {
  if (typeof principal === 'string') {
    return principal.trim() !== '';
  }

  if (!isObject(principal)) {
    return false;
  }

  if (
    Object.hasOwn(principal, 'isAuthenticated') ||
    Object.hasOwn(principal, 'status')
  ) {
    return (
      principal.isAuthenticated === true ||
      principal.status === 'authenticated'
    );
  }

  return Boolean(normalizeOptionalIdentifier(getPrincipalRole(principal)));
}

function actorTypeForPrincipal(principal) {
  const role = getPrincipalRole(principal);

  return [ROLES.PARTNER, ROLES.AGENCY].includes(role)
    ? AUDIT_ACTOR_TYPES.PARTNER_USER
    : role
      ? AUDIT_ACTOR_TYPES.INTERNAL_USER
      : AUDIT_ACTOR_TYPES.SYSTEM;
}

function resolvePrincipal(request, session, defaultPrincipal) {
  return (
    session ??
    request.principal ??
    request.session ??
    request.actor ??
    defaultPrincipal
  );
}

function resolvePartnerContext(request, principal, defaultContext) {
  const user = getPrincipalUser(principal);

  return (
    request.partnerContext ??
    principal?.partnerContext ??
    user?.partnerContext ??
    defaultContext ??
    null
  );
}

function normalizePagination(request) {
  const page = request.page ?? 1;
  const pageSize =
    request.pageSize ?? DEFAULT_OPERATIONS_WORKBENCH_PAGE_SIZE;

  if (!Number.isInteger(page) || page < 1) {
    throw new RangeError(
      'The operations workbench page must be a positive integer.',
    );
  }

  if (
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > MAX_OPERATIONS_WORKBENCH_PAGE_SIZE
  ) {
    throw new RangeError(
      `The operations workbench page size must be from 1 to ${MAX_OPERATIONS_WORKBENCH_PAGE_SIZE}.`,
    );
  }

  return { page, pageSize };
}

function normalizeSortDirection(value) {
  const direction = value ?? 'desc';

  if (!['asc', 'desc'].includes(direction)) {
    throw new TypeError(
      'The operations workbench sort direction must be "asc" or "desc".',
    );
  }

  return direction;
}

function normalizeFilterArray(value, description) {
  if (value === undefined) {
    return undefined;
  }

  const values = Array.isArray(value) ? value : [value];

  return [
    ...new Set(
      values.map((item) => normalizeIdentifier(item, description)),
    ),
  ];
}

function createRepositoryQuery(request) {
  return {
    ...(request.trackingId === undefined
      ? {}
      : { trackingId: request.trackingId }),
    ...(request.sourceRecordId === undefined
      ? {}
      : { sourceRecordId: request.sourceRecordId }),
    ...(request.cardType === undefined &&
    request.cardTypes === undefined
      ? {}
      : {
          cardTypes: normalizeFilterArray(
            request.cardTypes ?? request.cardType,
            'Work item card type',
          ),
        }),
    ...(request.state === undefined && request.states === undefined
      ? {}
      : {
          states: normalizeFilterArray(
            request.states ?? request.state,
            'Work item state',
          ),
        }),
    ...(request.priority === undefined &&
    request.priorities === undefined
      ? {}
      : {
          priorities: normalizeFilterArray(
            request.priorities ?? request.priority,
            'Work item priority',
          ),
        }),
    ...(request.assignedTo === undefined
      ? {}
      : { assignedTo: request.assignedTo }),
    ...(request.assignedGroup === undefined
      ? {}
      : { assignedGroup: request.assignedGroup }),
    ...(request.partnerCode === undefined &&
    request.partnerId === undefined
      ? {}
      : {
          partnerCode:
            request.partnerCode ?? request.partnerId,
        }),
    ...(request.validationCode === undefined
      ? {}
      : { validationCode: request.validationCode }),
    ...(request.includeCompleted === undefined
      ? {}
      : { includeCompleted: request.includeCompleted }),
  };
}

function normalizeSearchText(value) {
  return normalizeOptionalIdentifier(value)
    ?.normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function matchesSearchText(workItem, search) {
  const normalizedSearch = normalizeSearchText(search);

  if (!normalizedSearch) {
    return true;
  }

  const searchableValues = [
    workItem.workItemId,
    workItem.trackingId,
    workItem.sourceRecordId,
    workItem.title,
    workItem.summary,
    workItem.partnerCode,
    workItem.assignedTo,
    workItem.assignedGroup,
    workItem.metadata?.applicantName,
    workItem.metadata?.company,
    ...(Array.isArray(workItem.metadata?.validationCodes)
      ? workItem.metadata.validationCodes
      : []),
  ];

  return searchableValues.some((value) =>
    normalizeSearchText(value)?.includes(normalizedSearch),
  );
}

function getValueAtPath(source, path) {
  return path.split('.').reduce((value, segment) => {
    if (value === null || value === undefined) {
      return undefined;
    }

    return value[segment];
  }, source);
}

function compareValues(left, right) {
  if (left === right) {
    return 0;
  }

  if (left === null || left === undefined) {
    return -1;
  }

  if (right === null || right === undefined) {
    return 1;
  }

  if (
    typeof left === 'string' &&
    typeof right === 'string'
  ) {
    const leftTimestamp = Date.parse(left);
    const rightTimestamp = Date.parse(right);

    if (
      !Number.isNaN(leftTimestamp) &&
      !Number.isNaN(rightTimestamp)
    ) {
      return leftTimestamp - rightTimestamp;
    }

    return left.localeCompare(right, undefined, {
      sensitivity: 'base',
      numeric: true,
    });
  }

  return left < right ? -1 : 1;
}

function sortWorkItems(workItems, sortBy, sortDirection) {
  const direction = sortDirection === 'asc' ? 1 : -1;
  const field = sortBy ?? 'updatedAt';

  return [...workItems].sort(
    (left, right) =>
      direction *
      compareValues(
        getValueAtPath(left, field),
        getValueAtPath(right, field),
      ),
  );
}

function getStateCounts(workItems) {
  const counts = {
    [WORK_ITEM_STATES.PENDING]: 0,
    [WORK_ITEM_STATES.ACTION_NEEDED]: 0,
    [WORK_ITEM_STATES.COMPLETED]: 0,
  };

  workItems.forEach((workItem) => {
    counts[workItem.state] = (counts[workItem.state] ?? 0) + 1;
  });

  return Object.freeze(counts);
}

function getApplicantName(record) {
  const applicant = record.applicant ?? record.agent ?? {};

  return (
    normalizeOptionalIdentifier(applicant.legalName) ??
    normalizeOptionalIdentifier(
      [applicant.firstName, applicant.lastName]
        .filter(Boolean)
        .join(' '),
    ) ??
    'Applicant'
  );
}

function getValidationCodes(record) {
  return [
    ...new Set([
      ...(Array.isArray(record.validationCodes)
        ? record.validationCodes
        : []),
      ...(Array.isArray(record.exceptions)
        ? record.exceptions
            .filter((exception) => exception.status !== 'resolved')
            .map((exception) => exception.code)
        : []),
      ...(Array.isArray(record.background?.validationCodes)
        ? record.background.validationCodes
        : []),
      ...(Array.isArray(record.appointment?.validationCodes)
        ? record.appointment.validationCodes
        : []),
    ]),
  ];
}

function createHistoryEntry(
  state,
  actorId,
  actorType,
  comment,
  timestamp,
) {
  return {
    previousState: null,
    currentState: state,
    actorType,
    actorId,
    comment,
    timestamp,
  };
}

function deriveCandidates(record, timestamp) {
  if (!isObject(record)) {
    throw new TypeError(
      'Operations work item derivation records must contain objects.',
    );
  }

  const trackingId =
    normalizeOptionalIdentifier(record.trackingId) ?? null;
  const sourceRecordId = normalizeIdentifier(
    record.applicationId ?? record.id ?? record.sourceRecordId,
    'Derived work item source record identifier',
  );
  const partnerCode = normalizeIdentifier(
    record.partnerCode ?? record.partnerId ?? record.gaCode,
    'Derived work item partner code',
  );
  const applicantName = getApplicantName(record);
  const company = record.company ?? record.carrierCode ?? null;
  const validationCodes = getValidationCodes(record);
  const common = {
    trackingId,
    sourceRecordId,
    partnerCode,
    metadata: {
      applicationId: record.applicationId ?? null,
      company,
      applicantName,
      validationCodes,
    },
    createdAt: timestamp,
    updatedAt: timestamp,
    completedAt: null,
    history: [],
  };
  const candidates = [];
  const backgroundStatus =
    normalizeIdentifierForLookup(record.background?.status);
  const appointmentStatus =
    normalizeIdentifierForLookup(record.appointment?.status);
  const openExceptions = Array.isArray(record.exceptions)
    ? record.exceptions.filter(
        (exception) =>
          !['resolved', 'closed', 'completed'].includes(
            normalizeIdentifierForLookup(exception.status),
          ),
      )
    : [];

  if (
    ['pending', 'review', 'manual_review'].includes(backgroundStatus)
  ) {
    candidates.push({
      ...common,
      cardType: WORK_ITEM_TYPES.BACKGROUND_CHECK,
      state:
        backgroundStatus === 'review'
          ? WORK_ITEM_STATES.ACTION_NEEDED
          : WORK_ITEM_STATES.PENDING,
      priority:
        backgroundStatus === 'review'
          ? PRIORITIES.HIGH
          : PRIORITIES.MEDIUM,
      assignedTo:
        record.assignment?.assigneeUserId ?? null,
      assignedGroup:
        record.assignment?.team ?? 'operations',
      title: `Review background screening for ${applicantName}`,
      summary:
        backgroundStatus === 'review'
          ? 'The background screening requires manual adjudication.'
          : 'The background screening remains pending.',
      metadata: {
        ...common.metadata,
        providerCode: record.background?.providerCode ?? null,
        providerReferenceId:
          record.background?.referenceId ?? null,
      },
    });
  }

  if (
    ['pending', 'review', 'rejected'].includes(appointmentStatus)
  ) {
    candidates.push({
      ...common,
      cardType: WORK_ITEM_TYPES.APPOINTMENT,
      state:
        appointmentStatus === 'pending'
          ? WORK_ITEM_STATES.PENDING
          : WORK_ITEM_STATES.ACTION_NEEDED,
      priority:
        appointmentStatus === 'rejected'
          ? PRIORITIES.HIGH
          : PRIORITIES.MEDIUM,
      assignedTo:
        record.assignment?.assigneeUserId ?? null,
      assignedGroup:
        record.assignment?.team ?? 'licensing',
      title: `Review appointment status for ${applicantName}`,
      summary:
        appointmentStatus === 'pending'
          ? 'Carrier appointment confirmation remains pending.'
          : 'The appointment requires licensing review.',
      metadata: {
        ...common.metadata,
        states: cloneValue(record.appointment?.states ?? []),
        providerCode: record.appointment?.providerCode ?? null,
        providerReferenceId:
          record.appointment?.referenceId ?? null,
      },
    });
  }

  if (
    openExceptions.length > 0 ||
    record.workflowStage === WORKFLOW_STAGES.MANUAL_EXCEPTION ||
    record.workflowStage === WORKFLOW_STAGES.DUPLICATE_REVIEW
  ) {
    candidates.push({
      ...common,
      cardType: WORK_ITEM_TYPES.EXCEPTION,
      state: WORK_ITEM_STATES.ACTION_NEEDED,
      priority: PRIORITIES.HIGH,
      assignedTo:
        record.assignment?.assigneeUserId ?? null,
      assignedGroup:
        record.assignment?.team ?? 'operations',
      title: `Resolve onboarding exception for ${applicantName}`,
      summary:
        openExceptions[0]?.message ??
        'The onboarding application requires manual exception review.',
      metadata: {
        ...common.metadata,
        exceptions: cloneValue(openExceptions),
      },
    });
  }

  if (
    record.assignment?.team === 'manager' &&
    record.workflowStage === WORKFLOW_STAGES.MANUAL_EXCEPTION
  ) {
    candidates.push({
      ...common,
      cardType: WORK_ITEM_TYPES.DISTRIBUTION_APPROVAL,
      state: WORK_ITEM_STATES.ACTION_NEEDED,
      priority: PRIORITIES.HIGH,
      assignedTo:
        record.assignment?.assigneeUserId ?? null,
      assignedGroup: 'manager',
      title: `Review distribution approval for ${applicantName}`,
      summary:
        'The contracting arrangement requires distribution approval.',
    });
  }

  return candidates;
}

function candidateMatchesWorkItem(candidate, workItem) {
  return (
    normalizeIdentifierForLookup(candidate.trackingId) ===
      normalizeIdentifierForLookup(workItem.trackingId) &&
    normalizeIdentifierForLookup(candidate.sourceRecordId) ===
      normalizeIdentifierForLookup(workItem.sourceRecordId) &&
    candidate.cardType === workItem.cardType
  );
}

function createRepositoryOptions(options, clock) {
  return {
    ...(options.storage === undefined
      ? {}
      : { storage: options.storage }),
    ...(options.namespace === undefined
      ? {}
      : { namespace: options.namespace }),
    ...(options.schemaVersion === undefined
      ? {}
      : { schemaVersion: options.schemaVersion }),
    clock,
    ...(options.onStorageError === undefined
      ? {}
      : { onStorageError: options.onStorageError }),
  };
}

/**
 * Searches, derives, assigns, and transitions operational workbench cards.
 */
export class OperationsWorkbenchService {
  /**
   * @param {{
   *   repository?: object,
   *   workItemRepository?: object,
   *   auditService?: object | false,
   *   partnerScopeGuard?: object,
   *   principal?: string | object,
   *   partnerContext?: object,
   *   requireAuthorization?: boolean,
   *   enforceRecordScope?: boolean,
   *   strictAudit?: boolean,
   *   storage?: Storage,
   *   namespace?: string,
   *   schemaVersion?: number,
   *   clock?: () => Date | string | number,
   *   onStorageError?: (error: object) => void
   * }} [options] Service options.
   */
  constructor(options = {}) {
    const normalizedOptions = assertOptions(options);

    if (
      normalizedOptions.clock !== undefined &&
      typeof normalizedOptions.clock !== 'function'
    ) {
      throw new TypeError(
        'The operations workbench clock must be a function.',
      );
    }

    this.clock = normalizedOptions.clock ?? (() => new Date());
    const repositoryOptions = createRepositoryOptions(
      normalizedOptions,
      this.clock,
    );

    this.repository = assertRepository(
      normalizedOptions.repository ??
        normalizedOptions.workItemRepository ??
        new WorkItemRepository(repositoryOptions),
    );
    this.scopeGuard = assertScopeGuard(
      normalizedOptions.partnerScopeGuard ??
        new PartnerScopeGuard({
          principal: normalizedOptions.principal,
          partnerContext: normalizedOptions.partnerContext,
        }),
    );
    this.auditService =
      normalizedOptions.auditService === false
        ? null
        : assertOptionalAuditService(
            normalizedOptions.auditService ??
              new AuditService(repositoryOptions),
          );
    this.principal = normalizedOptions.principal ?? null;
    this.partnerContext =
      normalizedOptions.partnerContext ?? null;
    this.requireAuthorization =
      normalizedOptions.requireAuthorization ?? false;
    this.enforceRecordScope =
      normalizedOptions.enforceRecordScope ?? true;
    this.strictAudit = normalizedOptions.strictAudit ?? true;
  }

  /**
   * Searches operational work items.
   *
   * @param {object} [request] Search filters and pagination.
   * @param {string | object} [session] Authenticated principal.
   * @returns {object} Paginated work item response.
   */
  search(request = {}, session) {
    const normalizedRequest = assertOptions(
      request,
      'Operations workbench search request',
    );
    const principal = resolvePrincipal(
      normalizedRequest,
      session,
      this.principal,
    );

    this.assertReadAuthorization(principal);

    const partnerContext = resolvePartnerContext(
      normalizedRequest,
      principal,
      this.partnerContext,
    );
    const { page, pageSize } = normalizePagination(normalizedRequest);
    const sortDirection = normalizeSortDirection(
      normalizedRequest.sortDirection,
    );

    try {
      const repositoryQuery = createRepositoryQuery(
        normalizedRequest,
      );
      const stateFilteredQuery = { ...repositoryQuery };

      delete stateFilteredQuery.state;
      delete stateFilteredQuery.states;

      const baseItems = this.repository.list(stateFilteredQuery);

      if (!Array.isArray(baseItems)) {
        throw createWorkbenchError(
          OPERATIONS_WORKBENCH_ERROR_CODES.INVALID_DEPENDENCY,
          'The work item repository returned an invalid collection.',
          null,
        );
      }

      const scopedBaseItems = this.filterByScope(
        baseItems,
        principal,
        partnerContext,
      ).filter((workItem) =>
        matchesSearchText(workItem, normalizedRequest.search),
      );
      const stateFilters = normalizeFilterArray(
        normalizedRequest.states ?? normalizedRequest.state,
        'Work item state',
      );
      const matchingItems =
        stateFilters === undefined
          ? scopedBaseItems
          : scopedBaseItems.filter((workItem) =>
              stateFilters.includes(workItem.state),
            );
      const sortedItems = sortWorkItems(
        matchingItems,
        normalizedRequest.sortBy,
        sortDirection,
      );
      const total = sortedItems.length;
      const start = (page - 1) * pageSize;
      const items = sortedItems
        .slice(start, start + pageSize)
        .map((workItem) => cloneValue(workItem));
      const counts = getStateCounts(scopedBaseItems);
      const response = Object.freeze({
        items: Object.freeze(items),
        data: Object.freeze(items),
        counts,
        page,
        pageSize,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
      });

      this.appendAuditEvent(
        OPERATIONS_WORKBENCH_ACTIONS.SEARCHED,
        null,
        principal,
        {
          resultCount: total,
          page,
          pageSize,
          filters: {
            states: stateFilters ?? null,
            cardTypes:
              repositoryQuery.cardTypes ?? null,
            assignedTo:
              repositoryQuery.assignedTo ?? null,
            assignedGroup:
              repositoryQuery.assignedGroup ?? null,
          },
        },
        false,
      );

      return response;
    } catch (error) {
      if (
        error?.name === 'OperationsWorkbenchServiceError' ||
        error?.name === 'WorkItemRepositoryError' ||
        error?.name === 'PartnerScopeGuardError' ||
        error instanceof TypeError ||
        error instanceof RangeError
      ) {
        throw error;
      }

      throw createWorkbenchError(
        OPERATIONS_WORKBENCH_ERROR_CODES.OPERATION_FAILED,
        'Unable to search operational work items.',
        null,
        error,
      );
    }
  }

  /**
   * Alias for search.
   *
   * @param {object} [request] Search request.
   * @param {string | object} [session] Authenticated principal.
   * @returns {object} Search response.
   */
  searchWorkItems(request = {}, session) {
    return this.search(request, session);
  }

  /**
   * Returns a scoped work item by identifier.
   *
   * @param {string | number} workItemId Work item identifier.
   * @param {string | object} [session] Authenticated principal.
   * @param {object} [options] Access options.
   * @returns {object} Work item.
   */
  get(workItemId, session, options = {}) {
    const normalizedOptions = assertOptions(
      options,
      'Work item access options',
    );
    const principal = resolvePrincipal(
      normalizedOptions,
      session,
      this.principal,
    );

    this.assertReadAuthorization(principal);

    const workItem = this.repository.find(workItemId);

    if (!workItem) {
      throw createWorkbenchError(
        OPERATIONS_WORKBENCH_ERROR_CODES.WORK_ITEM_NOT_FOUND,
        `Work item not found: ${workItemId}`,
        { workItemId: String(workItemId) },
      );
    }

    this.assertRecordAccess(
      workItem,
      principal,
      resolvePartnerContext(
        normalizedOptions,
        principal,
        this.partnerContext,
      ),
    );

    return cloneValue(workItem);
  }

  /**
   * Alias for get.
   *
   * @param {string | number} workItemId Work item identifier.
   * @param {string | object} [session] Authenticated principal.
   * @param {object} [options] Access options.
   * @returns {object} Work item.
   */
  getWorkItem(workItemId, session, options = {}) {
    return this.get(workItemId, session, options);
  }

  /**
   * Derives missing operational cards from onboarding records.
   *
   * @param {object | object[]} records Onboarding records.
   * @param {{
   *   persist?: boolean,
   *   actor?: object,
   *   principal?: object,
   *   partnerContext?: object
   * }} [options] Derivation options.
   * @returns {object[]} Existing or newly derived work items.
   */
  deriveWorkItems(records, options = {}) {
    const normalizedOptions = assertOptions(
      options,
      'Work item derivation options',
    );
    const recordCollection = Array.isArray(records)
      ? records
      : [records];
    const principal =
      normalizedOptions.principal ??
      normalizedOptions.actor ??
      this.principal;

    this.assertMutationAuthorization(
      principal,
      PERMISSIONS.MANAGE_WORK_ITEMS,
    );

    const timestamp = toIsoTimestamp(this.clock());
    const existingItems = this.repository.list({
      includeCompleted: true,
    });
    const results = [];

    recordCollection.forEach((record) => {
      const candidates = deriveCandidates(record, timestamp);

      candidates.forEach((candidate) => {
        const existing = existingItems.find((workItem) =>
          candidateMatchesWorkItem(candidate, workItem),
        );

        if (existing) {
          results.push(cloneValue(existing));
          return;
        }

        if (normalizedOptions.persist === false) {
          results.push(cloneValue(candidate));
          return;
        }

        const actorId = getPrincipalId(principal);
        const actorType = actorTypeForPrincipal(principal);
        const candidateWithHistory = {
          ...candidate,
          history: [
            createHistoryEntry(
              candidate.state,
              actorId,
              actorType,
              'Operational work item derived from onboarding state.',
              timestamp,
            ),
          ],
        };
        const created = this.repository.create(candidateWithHistory);

        existingItems.push(created);
        results.push(cloneValue(created));

        this.appendAuditEvent(
          OPERATIONS_WORKBENCH_ACTIONS.DERIVED,
          created,
          principal,
          {
            cardType: created.cardType,
            sourceRecordId: created.sourceRecordId,
          },
        );
      });
    });

    return results;
  }

  /**
   * Alias for deriveWorkItems.
   *
   * @param {object | object[]} records Onboarding records.
   * @param {object} [options] Derivation options.
   * @returns {object[]} Derived cards.
   */
  deriveCards(records, options = {}) {
    return this.deriveWorkItems(records, options);
  }

  /**
   * Transitions a work item and records history and audit data.
   *
   * @param {string | number} workItemId Work item identifier.
   * @param {{
   *   targetState: string,
   *   actorId?: string,
   *   actorType?: string,
   *   reasonCode?: string,
   *   comment?: string,
   *   expectedUpdatedAt?: string,
   *   allowReopen?: boolean,
   *   principal?: object,
   *   partnerContext?: object
   * }} request Transition request.
   * @param {string | object} [session] Authenticated principal.
   * @returns {object} Transition response.
   */
  transition(workItemId, request, session) {
    const normalizedRequest = assertOptions(
      request,
      'Work item transition request',
    );
    const targetState = normalizeIdentifier(
      normalizedRequest.targetState,
      'Target work item state',
    );
    const principal = resolvePrincipal(
      normalizedRequest,
      session,
      this.principal,
    );
    const workItem = this.get(workItemId, principal, normalizedRequest);

    this.assertCardMutationAuthorization(principal, workItem);

    const allowReopen =
      normalizedRequest.allowReopen === true &&
      REOPEN_ROLES.has(getPrincipalRole(principal));

    if (
      normalizedRequest.allowReopen === true &&
      !allowReopen
    ) {
      throw createWorkbenchError(
        OPERATIONS_WORKBENCH_ERROR_CODES.FORBIDDEN_ROLE,
        'The current role cannot reopen completed work items.',
        {
          workItemId: workItem.workItemId,
          role: getPrincipalRole(principal),
        },
      );
    }

    const previousState = workItem.state;

    try {
      const updatedWorkItem = this.repository.transition(
        workItem.workItemId,
        {
          targetState,
          actorId:
            normalizedRequest.actorId ??
            getPrincipalId(principal),
          actorType:
            normalizedRequest.actorType ??
            actorTypeForPrincipal(principal),
          comment: normalizedRequest.comment,
          reasonCode: normalizedRequest.reasonCode,
        },
        {
          expectedUpdatedAt:
            normalizedRequest.expectedUpdatedAt,
          allowReopen,
        },
      );
      const auditEvent = this.appendAuditEvent(
        OPERATIONS_WORKBENCH_ACTIONS.TRANSITIONED,
        updatedWorkItem,
        principal,
        {
          previousState,
          currentState: updatedWorkItem.state,
          reasonCode: normalizedRequest.reasonCode ?? null,
          comment: normalizedRequest.comment ?? null,
        },
      );

      return Object.freeze({
        workItemId: updatedWorkItem.workItemId,
        previousState,
        currentState: updatedWorkItem.state,
        updatedAt: updatedWorkItem.updatedAt,
        completedAt: updatedWorkItem.completedAt,
        auditEventId:
          auditEvent?.auditEventId ??
          auditEvent?.lifecycleEventId ??
          null,
        workItem: cloneValue(updatedWorkItem),
      });
    } catch (error) {
      if (
        error?.name === 'WorkItemRepositoryError' &&
        error.code === 'WORK_ITEM_INVALID_STATE_TRANSITION'
      ) {
        throw createWorkbenchError(
          OPERATIONS_WORKBENCH_ERROR_CODES.INVALID_STATE_TRANSITION,
          error.message,
          error.details,
          error,
        );
      }

      if (
        error?.name === 'OperationsWorkbenchServiceError' ||
        error?.name === 'WorkItemRepositoryError'
      ) {
        throw error;
      }

      throw createWorkbenchError(
        OPERATIONS_WORKBENCH_ERROR_CODES.OPERATION_FAILED,
        'Unable to transition the work item.',
        { workItemId: workItem.workItemId },
        error,
      );
    }
  }

  /**
   * Alias for transition.
   *
   * @param {string | number} workItemId Work item identifier.
   * @param {object} request Transition request.
   * @param {string | object} [session] Authenticated principal.
   * @returns {object} Transition response.
   */
  transitionWorkItem(workItemId, request, session) {
    return this.transition(workItemId, request, session);
  }

  /**
   * Assigns a work item.
   *
   * @param {string | number} workItemId Work item identifier.
   * @param {{
   *   assignedTo: string | null,
   *   assignedGroup: string,
   *   assignedBy?: string,
   *   assignmentReason: string,
   *   comment?: string,
   *   expectedUpdatedAt?: string,
   *   principal?: object,
   *   partnerContext?: object
   * }} request Assignment request.
   * @param {string | object} [session] Authenticated principal.
   * @returns {object} Assignment response.
   */
  assign(workItemId, request, session) {
    const normalizedRequest = assertOptions(
      request,
      'Work item assignment request',
    );
    const principal = resolvePrincipal(
      normalizedRequest,
      session,
      this.principal,
    );
    const workItem = this.get(workItemId, principal, normalizedRequest);

    this.assertMutationAuthorization(
      principal,
      PERMISSIONS.ASSIGN_ONBOARDING,
    );

    try {
      const assignment = this.repository.assign(
        workItem.workItemId,
        {
          assignedTo: normalizeNullableIdentifier(
            normalizedRequest.assignedTo,
            'Assigned user identifier',
          ),
          assignedGroup: normalizeIdentifier(
            normalizedRequest.assignedGroup,
            'Assigned group',
          ),
          assignedBy:
            normalizedRequest.assignedBy ??
            getPrincipalId(principal),
          assignmentReason: normalizeIdentifier(
            normalizedRequest.assignmentReason,
            'Assignment reason',
          ),
          actorType: actorTypeForPrincipal(principal),
          comment: normalizedRequest.comment,
          assignmentId: normalizedRequest.assignmentId,
          assignedAt: normalizedRequest.assignedAt,
        },
        {
          expectedUpdatedAt:
            normalizedRequest.expectedUpdatedAt,
        },
      );
      const updatedWorkItem = this.repository.find(
        workItem.workItemId,
      );
      const auditEvent = this.appendAuditEvent(
        OPERATIONS_WORKBENCH_ACTIONS.ASSIGNED,
        updatedWorkItem,
        principal,
        {
          assignmentId: assignment.assignmentId,
          assignedTo: assignment.assignedTo,
          assignedGroup: assignment.assignedGroup,
          assignmentReason: assignment.assignmentReason,
        },
      );

      return Object.freeze({
        assignment: cloneValue(assignment),
        workItem: cloneValue(updatedWorkItem),
        auditEventId:
          auditEvent?.auditEventId ??
          auditEvent?.lifecycleEventId ??
          null,
      });
    } catch (error) {
      if (
        error?.name === 'OperationsWorkbenchServiceError' ||
        error?.name === 'WorkItemRepositoryError'
      ) {
        throw error;
      }

      throw createWorkbenchError(
        OPERATIONS_WORKBENCH_ERROR_CODES.INVALID_ASSIGNMENT,
        'Unable to assign the work item.',
        { workItemId: workItem.workItemId },
        error,
      );
    }
  }

  /**
   * Alias for assign.
   *
   * @param {string | number} workItemId Work item identifier.
   * @param {object} request Assignment request.
   * @param {string | object} [session] Authenticated principal.
   * @returns {object} Assignment response.
   */
  assignWorkItem(workItemId, request, session) {
    return this.assign(workItemId, request, session);
  }

  /**
   * Releases active assignments for a work item.
   *
   * @param {string | number} workItemId Work item identifier.
   * @param {object} request Release request.
   * @param {string | object} [session] Authenticated principal.
   * @returns {object} Release response.
   */
  releaseAssignment(workItemId, request, session) {
    const normalizedRequest = assertOptions(
      request,
      'Work item assignment release request',
    );
    const principal = resolvePrincipal(
      normalizedRequest,
      session,
      this.principal,
    );
    const workItem = this.get(workItemId, principal, normalizedRequest);

    this.assertMutationAuthorization(
      principal,
      PERMISSIONS.ASSIGN_ONBOARDING,
    );

    const releasedAssignments = this.repository.releaseAssignment(
      workItem.workItemId,
      {
        releasedBy:
          normalizedRequest.releasedBy ??
          getPrincipalId(principal),
        actorType: actorTypeForPrincipal(principal),
        comment: normalizedRequest.comment,
        releasedAt: normalizedRequest.releasedAt,
      },
      {
        expectedUpdatedAt:
          normalizedRequest.expectedUpdatedAt,
      },
    );
    const updatedWorkItem = this.repository.find(
      workItem.workItemId,
    );
    const auditEvent = this.appendAuditEvent(
      OPERATIONS_WORKBENCH_ACTIONS.ASSIGNMENT_RELEASED,
      updatedWorkItem,
      principal,
      {
        assignmentIds: releasedAssignments.map(
          (assignment) => assignment.assignmentId,
        ),
      },
    );

    return Object.freeze({
      releasedAssignments: cloneValue(releasedAssignments),
      workItem: cloneValue(updatedWorkItem),
      auditEventId:
        auditEvent?.auditEventId ??
        auditEvent?.lifecycleEventId ??
        null,
    });
  }

  /**
   * Creates a manual workbench route for a non-onboarding DTCC change.
   *
   * @param {{
   *   sourceRecordId: string,
   *   transactionType: string,
   *   partnerCode: string,
   *   rawSummary: string,
   *   requestedBy?: string,
   *   assignedTo?: string | null,
   *   assignedGroup?: string,
   *   priority?: string,
   *   metadata?: object,
   *   principal?: object
   * }} request Manual route request.
   * @param {string | object} [session] Authenticated principal.
   * @returns {object} Created work item.
   */
  createFromDtccManualRoute(request, session) {
    const normalizedRequest = assertOptions(
      request,
      'DTCC manual route request',
    );
    const principal = resolvePrincipal(
      normalizedRequest,
      session,
      this.principal,
    );

    this.assertMutationAuthorization(
      principal,
      PERMISSIONS.MANAGE_CONTRACT_CHANGES,
    );

    if (
      normalizedRequest.metadata !== undefined &&
      !isObject(normalizedRequest.metadata)
    ) {
      throw new TypeError(
        'DTCC manual route metadata must be an object.',
      );
    }

    const sourceRecordId = normalizeIdentifier(
      normalizedRequest.sourceRecordId,
      'DTCC source record identifier',
    );
    const transactionType = normalizeIdentifier(
      normalizedRequest.transactionType,
      'DTCC transaction type',
    );
    const partnerCode = normalizeIdentifier(
      normalizedRequest.partnerCode,
      'DTCC partner code',
    );
    const rawSummary = normalizeIdentifier(
      normalizedRequest.rawSummary,
      'DTCC transaction summary',
    );
    const existing = this.repository.list({
      sourceRecordId,
      cardType: WORK_ITEM_TYPES.DTCC_MANUAL_CHANGE,
      includeCompleted: true,
    })[0];

    if (existing) {
      return cloneValue(existing);
    }

    const timestamp = toIsoTimestamp(this.clock());
    const requestedBy =
      normalizedRequest.requestedBy ??
      getPrincipalId(principal);
    const assignedGroup =
      normalizedRequest.assignedGroup ?? 'operations';
    const workItem = this.repository.create({
      trackingId: null,
      sourceRecordId,
      cardType: WORK_ITEM_TYPES.DTCC_MANUAL_CHANGE,
      state: WORK_ITEM_STATES.PENDING,
      priority:
        normalizedRequest.priority ?? PRIORITIES.MEDIUM,
      assignedTo:
        normalizedRequest.assignedTo === undefined
          ? null
          : normalizeNullableIdentifier(
              normalizedRequest.assignedTo,
              'Assigned user identifier',
            ),
      assignedGroup: normalizeIdentifier(
        assignedGroup,
        'Assigned group',
      ),
      partnerCode,
      title: `Process DTCC ${transactionType.replace(/_/g, ' ')}`,
      summary: rawSummary,
      metadata: {
        ...cloneValue(normalizedRequest.metadata ?? {}),
        transactionType,
        rawSummary,
        requestedBy,
        receivedAt:
          normalizedRequest.receivedAt ?? timestamp,
        validationCodes: cloneValue(
          normalizedRequest.validationCodes ?? [],
        ),
      },
      createdAt: timestamp,
      updatedAt: timestamp,
      completedAt: null,
      history: [
        createHistoryEntry(
          WORK_ITEM_STATES.PENDING,
          requestedBy,
          actorTypeForPrincipal(principal),
          'Non-onboarding DTCC transaction routed for manual processing.',
          timestamp,
        ),
      ],
    });

    this.appendAuditEvent(
      OPERATIONS_WORKBENCH_ACTIONS.DTCC_MANUALLY_ROUTED,
      workItem,
      principal,
      {
        transactionType,
        sourceRecordId,
        requestedBy,
      },
    );

    return cloneValue(workItem);
  }

  /**
   * Alias for createFromDtccManualRoute.
   *
   * @param {object} request Manual route request.
   * @param {string | object} [session] Authenticated principal.
   * @returns {object} Created work item.
   */
  routeDtccManualChange(request, session) {
    return this.createFromDtccManualRoute(request, session);
  }

  filterByScope(records, principal, partnerContext) {
    if (
      principal === null ||
      principal === undefined ||
      this.enforceRecordScope === false
    ) {
      return records.map((record) => cloneValue(record));
    }

    return this.scopeGuard.filterRecords(
      records,
      principal,
      partnerContext,
    );
  }

  assertReadAuthorization(principal) {
    if (principal === null || principal === undefined) {
      if (this.requireAuthorization) {
        throw createWorkbenchError(
          OPERATIONS_WORKBENCH_ERROR_CODES.UNAUTHENTICATED,
          'An authenticated principal is required.',
          null,
        );
      }

      return;
    }

    if (!isAuthenticatedPrincipal(principal)) {
      throw createWorkbenchError(
        OPERATIONS_WORKBENCH_ERROR_CODES.UNAUTHENTICATED,
        'An authenticated principal is required.',
        null,
      );
    }

    if (
      !canPerformAction(principal, PERMISSIONS.VIEW_WORKBENCH)
    ) {
      throw createWorkbenchError(
        OPERATIONS_WORKBENCH_ERROR_CODES.FORBIDDEN_ROLE,
        'The current principal cannot access the operations workbench.',
        { role: getPrincipalRole(principal) },
      );
    }
  }

  assertMutationAuthorization(principal, permission) {
    if (principal === null || principal === undefined) {
      if (this.requireAuthorization) {
        throw createWorkbenchError(
          OPERATIONS_WORKBENCH_ERROR_CODES.UNAUTHENTICATED,
          'An authenticated principal is required.',
          null,
        );
      }

      return;
    }

    if (!isAuthenticatedPrincipal(principal)) {
      throw createWorkbenchError(
        OPERATIONS_WORKBENCH_ERROR_CODES.UNAUTHENTICATED,
        'An authenticated principal is required.',
        null,
      );
    }

    if (!canPerformAction(principal, permission)) {
      throw createWorkbenchError(
        OPERATIONS_WORKBENCH_ERROR_CODES.FORBIDDEN_ROLE,
        'The current principal cannot perform this workbench action.',
        {
          role: getPrincipalRole(principal),
          permission,
        },
      );
    }
  }

  assertCardMutationAuthorization(principal, workItem) {
    this.assertMutationAuthorization(
      principal,
      MUTATION_PERMISSIONS[workItem.cardType] ??
        PERMISSIONS.MANAGE_WORK_ITEMS,
    );
  }

  assertRecordAccess(workItem, principal, partnerContext) {
    if (
      principal === null ||
      principal === undefined ||
      this.enforceRecordScope === false
    ) {
      return;
    }

    if (
      !this.scopeGuard.canAccessRecord(
        workItem,
        principal,
        partnerContext,
      )
    ) {
      throw createWorkbenchError(
        OPERATIONS_WORKBENCH_ERROR_CODES.PARTNER_SCOPE_VIOLATION,
        'The requested work item is outside the current record scope.',
        {
          workItemId: workItem.workItemId,
          partnerCode: workItem.partnerCode,
        },
      );
    }
  }

  appendAuditEvent(
    action,
    workItem,
    principal,
    metadata,
    material = true,
  ) {
    if (!this.auditService) {
      return null;
    }

    const append =
      typeof this.auditService.append === 'function'
        ? this.auditService.append.bind(this.auditService)
        : this.auditService.create.bind(this.auditService);

    try {
      return append(
        {
          trackingId: workItem?.trackingId ?? null,
          sourceRecordId:
            workItem?.workItemId ??
            workItem?.sourceRecordId,
          workItemId: workItem?.workItemId,
          action,
          actorId: getPrincipalId(principal),
          actorType: actorTypeForPrincipal(principal),
          source: AUDIT_SOURCES.OPERATIONS_WORKBENCH,
          summary: action.toLowerCase().replace(/_/g, ' '),
          metadata: {
            workItemId: workItem?.workItemId ?? null,
            cardType: workItem?.cardType ?? null,
            partnerCode: workItem?.partnerCode ?? null,
            material,
            ...cloneValue(metadata),
          },
          timestamp: toIsoTimestamp(this.clock()),
        },
        {
          actor: principal,
          source: AUDIT_SOURCES.OPERATIONS_WORKBENCH,
        },
      );
    } catch (error) {
      if (this.strictAudit && material) {
        throw createWorkbenchError(
          OPERATIONS_WORKBENCH_ERROR_CODES.AUDIT_FAILED,
          'Unable to persist the operations workbench audit event.',
          {
            action,
            workItemId: workItem?.workItemId ?? null,
            stateCommitted: workItem !== null,
          },
          error,
        );
      }

      return null;
    }
  }
}

/**
 * Creates an operations workbench service.
 *
 * @param {ConstructorParameters<typeof OperationsWorkbenchService>[0]}
 * [options] Service options.
 * @returns {OperationsWorkbenchService} Service instance.
 */
export function createOperationsWorkbenchService(options = {}) {
  return new OperationsWorkbenchService(options);
}

/**
 * Searches work items with a newly created service.
 *
 * @param {object} request Search request.
 * @param {string | object} session Authenticated principal.
 * @param {ConstructorParameters<typeof OperationsWorkbenchService>[0]}
 * [serviceOptions] Service options.
 * @returns {object} Work item search response.
 */
export function searchOperationsWorkItems(
  request,
  session,
  serviceOptions = {},
) {
  return createOperationsWorkbenchService(serviceOptions).search(
    request,
    session,
  );
}

/**
 * Transitions a work item with a newly created service.
 *
 * @param {string | number} workItemId Work item identifier.
 * @param {object} request Transition request.
 * @param {string | object} session Authenticated principal.
 * @param {ConstructorParameters<typeof OperationsWorkbenchService>[0]}
 * [serviceOptions] Service options.
 * @returns {object} Transition response.
 */
export function transitionOperationsWorkItem(
  workItemId,
  request,
  session,
  serviceOptions = {},
) {
  return createOperationsWorkbenchService(
    serviceOptions,
  ).transition(workItemId, request, session);
}

/**
 * Manually routes a DTCC change with a newly created service.
 *
 * @param {object} request Manual route request.
 * @param {string | object} session Authenticated principal.
 * @param {ConstructorParameters<typeof OperationsWorkbenchService>[0]}
 * [serviceOptions] Service options.
 * @returns {object} Created work item.
 */
export function routeDtccManualChange(
  request,
  session,
  serviceOptions = {},
) {
  return createOperationsWorkbenchService(
    serviceOptions,
  ).createFromDtccManualRoute(request, session);
}

export const OperationsWorkbenchAPI =
  OperationsWorkbenchService;
export const WorkbenchService = OperationsWorkbenchService;
export const createOperationsWorkbenchAPI =
  createOperationsWorkbenchService;
export const createWorkbenchService =
  createOperationsWorkbenchService;
export const searchWorkItems = searchOperationsWorkItems;
export const transitionWorkItem =
  transitionOperationsWorkItem;
export const createDtccManualWorkItem =
  routeDtccManualChange;

export default OperationsWorkbenchService;