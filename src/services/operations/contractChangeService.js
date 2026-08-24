import {
  AUDIT_ACTOR_TYPES,
  AUDIT_SOURCES,
  PRIORITIES,
  WORK_ITEM_STATES,
  WORK_ITEM_TYPES,
} from '../../constants/domain.js';
import { PERMISSIONS } from '../../constants/roles.js';
import { canPerformAction } from '../../auth/permissionPolicy.js';
import { PartnerScopeGuard } from '../../auth/partnerScopeGuard.js';
import {
  CONTRACT_CHANGE_STATUSES,
  CONTRACT_CHANGE_TYPES,
  ContractChangeRepository,
} from '../../repositories/contractChangeRepository.js';
import { OnboardingRecordRepository } from '../../repositories/onboardingRecordRepository.js';
import { WorkItemRepository } from '../../repositories/workItemRepository.js';
import { toIsoTimestamp } from '../../utils/dates.js';
import { AuditService } from '../shared/auditService.js';
import { EligibilityService } from '../onboarding/eligibilityService.js';
import { OnboardingEventPublisher } from '../onboarding/onboardingEventPublisher.js';
import { ValidationService } from '../onboarding/validationService.js';

export const CONTRACT_CHANGE_SERVICE_ERROR_CODES = Object.freeze({
  INVALID_OPTIONS: 'CONTRACT_CHANGE_SERVICE_INVALID_OPTIONS',
  INVALID_REQUEST: 'CONTRACT_CHANGE_SERVICE_INVALID_REQUEST',
  INVALID_DEPENDENCY: 'CONTRACT_CHANGE_SERVICE_INVALID_DEPENDENCY',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN_ROLE: 'FORBIDDEN_ROLE',
  PARTNER_SCOPE_VIOLATION: 'PARTNER_SCOPE_VIOLATION',
  APPLICATION_NOT_FOUND: 'CONTRACT_CHANGE_SERVICE_APPLICATION_NOT_FOUND',
  VALIDATION_FAILED: 'CONTRACT_CHANGE_SERVICE_VALIDATION_FAILED',
  ELIGIBILITY_FAILED: 'CONTRACT_CHANGE_SERVICE_ELIGIBILITY_FAILED',
  WORKBENCH_ROUTING_FAILED:
    'CONTRACT_CHANGE_SERVICE_WORKBENCH_ROUTING_FAILED',
  OPERATION_FAILED: 'CONTRACT_CHANGE_SERVICE_OPERATION_FAILED',
  AUDIT_FAILED: 'CONTRACT_CHANGE_SERVICE_AUDIT_FAILED',
  EVENT_PUBLICATION_FAILED:
    'CONTRACT_CHANGE_SERVICE_EVENT_PUBLICATION_FAILED',
});

export const CONTRACT_CHANGE_SERVICE_ACTIONS = Object.freeze({
  SEARCHED: 'CONTRACT_CHANGES_SEARCHED',
  CREATED: 'CONTRACT_CHANGE_CREATED',
  AUTO_ACCEPTED: 'CONTRACT_CHANGE_AUTO_ACCEPTED',
  REJECTED: 'CONTRACT_CHANGE_REJECTED',
  MANUAL_ROUTED: 'CONTRACT_CHANGE_MANUAL_ROUTED',
});

export const SIMPLE_CONTRACT_CHANGE_TYPES = Object.freeze([
  CONTRACT_CHANGE_TYPES.COMMISSION_SCHEDULE,
  CONTRACT_CHANGE_TYPES.ASSIGNEE,
]);

export const COMPLEX_CONTRACT_CHANGE_TYPES = Object.freeze([
  CONTRACT_CHANGE_TYPES.HIERARCHY,
  CONTRACT_CHANGE_TYPES.LEVEL,
]);

export const DEFAULT_CONTRACT_CHANGE_PAGE_SIZE = 25;
export const MAX_CONTRACT_CHANGE_PAGE_SIZE = 100;
export const DEFAULT_MASS_CHANGE_THRESHOLD = 1;

const SIMPLE_CHANGE_TYPE_SET = new Set(SIMPLE_CONTRACT_CHANGE_TYPES);
const COMPLEX_CHANGE_TYPE_SET = new Set(COMPLEX_CONTRACT_CHANGE_TYPES);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertOptions(
  options,
  description = 'Contract change service options',
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

function deepMerge(baseValue, overlayValue) {
  if (overlayValue === undefined) {
    return cloneValue(baseValue);
  }

  if (!isObject(baseValue) || !isObject(overlayValue)) {
    return cloneValue(overlayValue);
  }

  const mergedValue = cloneValue(baseValue);

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

function createServiceError(code, message, details, cause) {
  const error = new Error(message, {
    ...(cause === undefined ? {} : { cause }),
  });

  error.name = 'ContractChangeServiceError';
  error.code = code;
  error.details = details ?? null;
  error.recoverable = true;

  return error;
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

function assertContractChangeRepository(repository) {
  const requiredMethods = [
    'create',
    'find',
    'list',
    'routeForManualReview',
    'transition',
  ];

  if (
    !isObject(repository) ||
    requiredMethods.some(
      (method) => typeof repository[method] !== 'function',
    )
  ) {
    throw createServiceError(
      CONTRACT_CHANGE_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
      'The contract change repository does not provide the required methods.',
      { requiredMethods },
    );
  }

  return repository;
}

function assertApplicationRepository(repository) {
  if (
    !isObject(repository) ||
    typeof repository.list !== 'function'
  ) {
    throw createServiceError(
      CONTRACT_CHANGE_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
      'The onboarding repository must provide a list method.',
      { requiredMethods: ['list'] },
    );
  }

  return repository;
}

function assertWorkItemRepository(repository) {
  if (
    !isObject(repository) ||
    typeof repository.create !== 'function' ||
    typeof repository.list !== 'function'
  ) {
    throw createServiceError(
      CONTRACT_CHANGE_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
      'The work item repository must provide create and list methods.',
      { requiredMethods: ['create', 'list'] },
    );
  }

  return repository;
}

function assertValidationService(service) {
  if (
    !isObject(service) ||
    typeof service.validateChangeRequest !== 'function'
  ) {
    throw createServiceError(
      CONTRACT_CHANGE_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
      'The validation service must provide validateChangeRequest.',
      { requiredMethods: ['validateChangeRequest'] },
    );
  }

  return service;
}

function assertEligibilityService(service) {
  if (
    !isObject(service) ||
    typeof service.runEligibilityChecks !== 'function'
  ) {
    throw createServiceError(
      CONTRACT_CHANGE_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
      'The eligibility service must provide runEligibilityChecks.',
      { requiredMethods: ['runEligibilityChecks'] },
    );
  }

  return service;
}

function assertScopeGuard(scopeGuard) {
  if (
    !isObject(scopeGuard) ||
    typeof scopeGuard.canAccessRecord !== 'function' ||
    typeof scopeGuard.filterRecords !== 'function'
  ) {
    throw createServiceError(
      CONTRACT_CHANGE_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
      'The partner scope guard must provide canAccessRecord and filterRecords.',
      {
        requiredMethods: ['canAccessRecord', 'filterRecords'],
      },
    );
  }

  return scopeGuard;
}

function assertOptionalAuditService(service) {
  if (service === undefined || service === null || service === false) {
    return null;
  }

  if (
    !isObject(service) ||
    (typeof service.append !== 'function' &&
      typeof service.create !== 'function')
  ) {
    throw createServiceError(
      CONTRACT_CHANGE_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
      'The audit service must provide append or create.',
      null,
    );
  }

  return service;
}

function assertOptionalEventPublisher(publisher) {
  if (
    publisher === undefined ||
    publisher === null ||
    publisher === false
  ) {
    return null;
  }

  if (
    !isObject(publisher) ||
    typeof publisher.publishChangeRequestSubmitted !== 'function'
  ) {
    throw createServiceError(
      CONTRACT_CHANGE_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
      'The event publisher must provide publishChangeRequestSubmitted.',
      null,
    );
  }

  return publisher;
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

function getPrincipalRole(principal) {
  if (typeof principal === 'string') {
    return principal;
  }

  const user = getPrincipalUser(principal);

  return principal?.role ?? user?.role ?? null;
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

function getActorType(principal) {
  const role = getPrincipalRole(principal);

  return ['partner', 'agency'].includes(role)
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
    request.requestedByPrincipal ??
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
    request.pageSize ??
    request.limit ??
    DEFAULT_CONTRACT_CHANGE_PAGE_SIZE;

  if (!Number.isInteger(page) || page < 1) {
    throw new RangeError(
      'The contract change page must be a positive integer.',
    );
  }

  if (
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > MAX_CONTRACT_CHANGE_PAGE_SIZE
  ) {
    throw new RangeError(
      `The contract change page size must be from 1 to ${MAX_CONTRACT_CHANGE_PAGE_SIZE}.`,
    );
  }

  if (
    request.offset !== undefined &&
    (!Number.isInteger(request.offset) || request.offset < 0)
  ) {
    throw new RangeError(
      'The contract change offset must be a nonnegative integer.',
    );
  }

  return {
    page,
    pageSize,
    offset: request.offset ?? (page - 1) * pageSize,
  };
}

function normalizeFilter(value, description) {
  if (value === undefined) {
    return undefined;
  }

  const values = Array.isArray(value) ? value : [value];

  return [
    ...new Set(
      values.map((entry) => normalizeIdentifier(entry, description)),
    ),
  ];
}

function createRepositoryQuery(request) {
  const statuses = normalizeFilter(
    request.statuses ?? request.status,
    'Contract change status',
  );
  const changeTypes = normalizeFilter(
    request.changeTypes ?? request.changeType,
    'Contract change type',
  );

  return {
    ...(request.trackingId === undefined
      ? {}
      : { trackingId: request.trackingId }),
    ...(request.partnerCode === undefined
      ? {}
      : { partnerCode: request.partnerCode }),
    ...(changeTypes === undefined ? {} : { changeTypes }),
    ...(statuses === undefined ? {} : { statuses }),
    ...(request.requestedBy === undefined
      ? {}
      : { requestedBy: request.requestedBy }),
    ...(request.createdWorkItemId === undefined
      ? {}
      : { createdWorkItemId: request.createdWorkItemId }),
    ...(request.manualReviewRequired === undefined
      ? {}
      : {
          manualReviewRequired:
            request.manualReviewRequired,
        }),
    ...(request.validationCode === undefined
      ? {}
      : { validationCode: request.validationCode }),
    ...(request.createdFrom === undefined
      ? {}
      : { createdFrom: request.createdFrom }),
    ...(request.createdTo === undefined
      ? {}
      : { createdTo: request.createdTo }),
    sortOrder: request.sortOrder ?? request.sortDirection ?? 'desc',
  };
}

function normalizeSearchText(value) {
  return normalizeOptionalIdentifier(value)
    ?.normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function matchesSearch(changeRequest, search) {
  const normalizedSearch = normalizeSearchText(search);

  if (!normalizedSearch) {
    return true;
  }

  const searchableValues = [
    changeRequest.changeRequestId,
    changeRequest.trackingId,
    changeRequest.partnerCode,
    changeRequest.changeType,
    changeRequest.status,
    changeRequest.requestedBy,
    changeRequest.createdWorkItemId,
    changeRequest.payload?.currentValue,
    changeRequest.payload?.requestedValue,
    changeRequest.payload?.reason,
    changeRequest.outcome?.result,
    ...(Array.isArray(changeRequest.outcome?.validationCodes)
      ? changeRequest.outcome.validationCodes
      : []),
  ];

  return searchableValues.some((value) => {
    if (
      value === null ||
      value === undefined ||
      typeof value === 'object'
    ) {
      return false;
    }

    return normalizeSearchText(value)?.includes(normalizedSearch);
  });
}

function findApplication(repository, request) {
  const identifier =
    normalizeOptionalIdentifier(request.applicationId) ??
    normalizeOptionalIdentifier(request.trackingId);

  if (!identifier) {
    return undefined;
  }

  if (
    request.applicationId &&
    typeof repository.findByApplicationId === 'function'
  ) {
    const application = repository.findByApplicationId(
      request.applicationId,
    );

    if (application) {
      return application;
    }
  }

  if (
    request.trackingId &&
    typeof repository.findByTrackingId === 'function'
  ) {
    const application = repository.findByTrackingId(
      request.trackingId,
    );

    if (application) {
      return application;
    }
  }

  if (typeof repository.find === 'function') {
    return repository.find(identifier);
  }

  return repository
    .list({ includeCompleted: true })
    .find(
      (application) =>
        normalizeIdentifierForLookup(application.applicationId) ===
          normalizeIdentifierForLookup(request.applicationId) ||
        normalizeIdentifierForLookup(application.trackingId) ===
          normalizeIdentifierForLookup(request.trackingId),
    );
}

function buildChangedApplication(application, changeType, payload) {
  if (!application) {
    return undefined;
  }

  const requestedValue =
    payload.requestedValue ??
    payload.newValue ??
    payload.value;
  let patch = payload.requestedValues ?? payload.changes ?? {};

  if (!isObject(patch)) {
    patch = {};
  }

  switch (changeType) {
    case CONTRACT_CHANGE_TYPES.COMMISSION_SCHEDULE:
      patch = deepMerge(patch, {
        contract: {
          commissionSchedule:
            payload.commissionSchedule ?? requestedValue,
        },
      });
      break;

    case CONTRACT_CHANGE_TYPES.LEVEL:
      patch = deepMerge(patch, {
        contract: {
          level: payload.level ?? requestedValue,
        },
      });
      break;

    case CONTRACT_CHANGE_TYPES.HIERARCHY:
      patch = deepMerge(patch, {
        gaCode:
          payload.gaCode ??
          payload.requestedGaCode ??
          requestedValue,
        hierarchy: isObject(payload.hierarchy)
          ? payload.hierarchy
          : undefined,
      });
      break;

    case CONTRACT_CHANGE_TYPES.ASSIGNEE:
      patch = deepMerge(patch, {
        assignment: {
          assigneeUserId:
            payload.assignedTo ??
            payload.assigneeUserId ??
            requestedValue ??
            null,
          team:
            payload.assignedGroup ??
            payload.team ??
            application.assignment?.team ??
            null,
        },
      });
      break;

    default:
      break;
  }

  return deepMerge(application, patch);
}

function getAffectedCount(request, payload) {
  const explicitCount =
    request.affectedCount ??
    request.bulkAffectedCount ??
    payload.affectedCount ??
    payload.bulkAffectedCount;

  if (explicitCount !== undefined) {
    if (!Number.isInteger(explicitCount) || explicitCount < 1) {
      throw new RangeError(
        'The contract change affected count must be a positive integer.',
      );
    }

    return explicitCount;
  }

  const collections = [
    request.applicationIds,
    request.trackingIds,
    payload.applicationIds,
    payload.trackingIds,
    payload.affectedRecords,
  ];

  return Math.max(
    1,
    ...collections
      .filter(Array.isArray)
      .map((collection) => collection.length),
  );
}

function isComplexChange(
  changeType,
  request,
  payload,
  affectedCount,
  massChangeThreshold,
) {
  if (
    request.forceManualReview === true ||
    request.manualReviewRequired === true ||
    payload.manualReviewRequired === true ||
    payload.complex === true
  ) {
    return true;
  }

  if (affectedCount > massChangeThreshold) {
    return true;
  }

  if (COMPLEX_CHANGE_TYPE_SET.has(changeType)) {
    return true;
  }

  return !SIMPLE_CHANGE_TYPE_SET.has(changeType);
}

function collectValidationCodes(validation, eligibility) {
  return [
    ...new Set([
      ...(Array.isArray(validation?.validationCodes)
        ? validation.validationCodes
        : []),
      ...(Array.isArray(eligibility?.validationCodes)
        ? eligibility.validationCodes
        : []),
    ]),
  ];
}

function createStatusCounts(changeRequests) {
  const counts = Object.fromEntries(
    Object.values(CONTRACT_CHANGE_STATUSES).map((status) => [
      status,
      0,
    ]),
  );

  changeRequests.forEach((changeRequest) => {
    counts[changeRequest.status] =
      (counts[changeRequest.status] ?? 0) + 1;
  });

  return Object.freeze(counts);
}

/**
 * Creates, evaluates, searches, and routes contract change requests.
 */
export class ContractChangeService {
  /**
   * @param {{
   *   repository?: object,
   *   contractChangeRepository?: object,
   *   applicationRepository?: object,
   *   workItemRepository?: object,
   *   validationService?: object,
   *   eligibilityService?: object,
   *   partnerScopeGuard?: object,
   *   auditService?: object | false,
   *   eventPublisher?: object | false,
   *   principal?: string | object,
   *   partnerContext?: object,
   *   requireAuthorization?: boolean,
   *   enforceRecordScope?: boolean,
   *   massChangeThreshold?: number,
   *   strictAudit?: boolean,
   *   strictPublication?: boolean,
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
        'The contract change service clock must be a function.',
      );
    }

    const massChangeThreshold =
      normalizedOptions.massChangeThreshold ??
      DEFAULT_MASS_CHANGE_THRESHOLD;

    if (
      !Number.isInteger(massChangeThreshold) ||
      massChangeThreshold < 1
    ) {
      throw new RangeError(
        'The mass change threshold must be a positive integer.',
      );
    }

    this.clock = normalizedOptions.clock ?? (() => new Date());
    const repositoryOptions = createRepositoryOptions(
      normalizedOptions,
      this.clock,
    );

    this.repository = assertContractChangeRepository(
      normalizedOptions.repository ??
        normalizedOptions.contractChangeRepository ??
        new ContractChangeRepository(repositoryOptions),
    );
    this.applicationRepository = assertApplicationRepository(
      normalizedOptions.applicationRepository ??
        new OnboardingRecordRepository(repositoryOptions),
    );
    this.workItemRepository = assertWorkItemRepository(
      normalizedOptions.workItemRepository ??
        new WorkItemRepository(repositoryOptions),
    );
    this.validationService = assertValidationService(
      normalizedOptions.validationService ??
        new ValidationService({
          clock: this.clock,
        }),
    );
    this.eligibilityService = assertEligibilityService(
      normalizedOptions.eligibilityService ??
        new EligibilityService({
          applicationRepository: this.applicationRepository,
          clock: this.clock,
          auditService: false,
        }),
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
    this.eventPublisher =
      normalizedOptions.eventPublisher === false
        ? null
        : assertOptionalEventPublisher(
            normalizedOptions.eventPublisher ??
              new OnboardingEventPublisher({
                clock: this.clock,
                source: 'contract-change-service',
              }),
          );
    this.principal = normalizedOptions.principal ?? null;
    this.partnerContext = normalizedOptions.partnerContext ?? null;
    this.requireAuthorization =
      normalizedOptions.requireAuthorization ?? false;
    this.enforceRecordScope =
      normalizedOptions.enforceRecordScope ?? true;
    this.massChangeThreshold = massChangeThreshold;
    this.strictAudit = normalizedOptions.strictAudit ?? false;
    this.strictPublication =
      normalizedOptions.strictPublication ?? false;
  }

  /**
   * Creates and evaluates a contract change request.
   *
   * @param {{
   *   changeRequestId?: string,
   *   applicationId?: string,
   *   trackingId?: string | null,
   *   partnerCode: string,
   *   changeType: string,
   *   requestedBy?: string,
   *   payload?: Record<string, unknown>,
   *   requestedValues?: Record<string, unknown>,
   *   affectedCount?: number,
   *   bulkAffectedCount?: number,
   *   forceManualReview?: boolean,
   *   manualReviewRequired?: boolean,
   *   principal?: string | object,
   *   partnerContext?: object
   * }} request Change request.
   * @param {string | object} [session] Authenticated principal.
   * @returns {object} Created and processed change request.
   */
  create(request, session) {
    const normalizedRequest = assertOptions(
      request,
      'Contract change request',
    );
    const principal = resolvePrincipal(
      normalizedRequest,
      session,
      this.principal,
    );

    this.assertMutationAuthorization(principal);

    const partnerContext = resolvePartnerContext(
      normalizedRequest,
      principal,
      this.partnerContext,
    );
    const changeType = normalizeIdentifier(
      normalizedRequest.changeType,
      'Contract change type',
    );
    const partnerCode = normalizeIdentifier(
      normalizedRequest.partnerCode,
      'Partner code',
    );
    const trackingId =
      normalizedRequest.trackingId === undefined
        ? null
        : normalizeNullableIdentifier(
            normalizedRequest.trackingId,
            'Tracking identifier',
          );
    const requestedBy = normalizeIdentifier(
      normalizedRequest.requestedBy ?? getPrincipalId(principal),
      'Requesting actor identifier',
    );
    const payload = cloneValue(
      normalizedRequest.payload ??
        normalizedRequest.requestedValues ??
        {},
    );

    if (!isObject(payload)) {
      throw createServiceError(
        CONTRACT_CHANGE_SERVICE_ERROR_CODES.INVALID_REQUEST,
        'Contract change payload must be an object.',
        null,
      );
    }

    const application = findApplication(
      this.applicationRepository,
      {
        applicationId: normalizedRequest.applicationId,
        trackingId,
      },
    );

    if (
      normalizedRequest.applicationId !== undefined &&
      !application
    ) {
      throw createServiceError(
        CONTRACT_CHANGE_SERVICE_ERROR_CODES.APPLICATION_NOT_FOUND,
        `Onboarding application not found: ${normalizedRequest.applicationId}`,
        {
          applicationId: String(normalizedRequest.applicationId),
          trackingId,
        },
      );
    }

    this.assertScopeAccess(
      application ?? { partnerCode, trackingId },
      principal,
      partnerContext,
    );

    const changedApplication = buildChangedApplication(
      application,
      changeType,
      payload,
    );
    const validation = this.validationService.validateChangeRequest(
      {
        ...cloneValue(normalizedRequest),
        trackingId,
        partnerCode,
        changeType,
        requestedValues: payload,
        payload,
      },
      {
        application: changedApplication,
        persist: false,
      },
    );
    let eligibility = null;

    if (changedApplication && validation.valid === true) {
      try {
        eligibility =
          this.eligibilityService.runEligibilityChecks(
            changedApplication,
            {
              includeProviders: false,
              applicationRecords:
                this.applicationRepository.list({
                  includeCompleted: true,
                }),
              persist: false,
            },
          );
      } catch (error) {
        throw createServiceError(
          CONTRACT_CHANGE_SERVICE_ERROR_CODES.ELIGIBILITY_FAILED,
          'Contract change eligibility could not be evaluated.',
          {
            trackingId,
            applicationId:
              application?.applicationId ?? null,
          },
          error,
        );
      }
    }

    const validationCodes = collectValidationCodes(
      validation,
      eligibility,
    );
    const affectedCount = getAffectedCount(
      normalizedRequest,
      payload,
    );
    const complex = isComplexChange(
      changeType,
      normalizedRequest,
      payload,
      affectedCount,
      this.massChangeThreshold,
    );
    const validationFailed = validation.valid !== true;
    const eligibilityFailed =
      eligibility !== null &&
      eligibility.eligible !== true &&
      eligibility.valid !== true;
    const manualReviewRequired =
      complex ||
      validation.manualReviewRequired === true ||
      eligibility?.manualReviewRequired === true;
    const timestamp = toIsoTimestamp(
      normalizedRequest.createdAt ?? this.clock(),
    );
    const initialChangeRequest = this.repository.create({
      ...(normalizedRequest.changeRequestId === undefined
        ? {}
        : {
            changeRequestId: normalizeIdentifier(
              normalizedRequest.changeRequestId,
              'Change request identifier',
            ),
          }),
      trackingId,
      partnerCode,
      changeType,
      status: CONTRACT_CHANGE_STATUSES.SUBMITTED,
      manualReviewRequired,
      createdWorkItemId: null,
      requestedBy,
      payload: {
        ...payload,
        affectedCount,
      },
      outcome: {
        result: 'submitted',
        validationCodes,
      },
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    let processedChangeRequest = initialChangeRequest;
    let workItem = null;
    let action = CONTRACT_CHANGE_SERVICE_ACTIONS.CREATED;

    if (validationFailed || eligibilityFailed) {
      processedChangeRequest = this.repository.transition(
        initialChangeRequest.changeRequestId,
        CONTRACT_CHANGE_STATUSES.REJECTED,
        {
          manualReviewRequired:
            validation.manualReviewRequired === true ||
            eligibility?.manualReviewRequired === true,
          outcome: {
            result: 'rejected',
            validationCodes,
            validationValid: validation.valid,
            eligibilityOutcome:
              eligibility?.outcome ??
              eligibility?.status ??
              null,
          },
        },
      );
      action = CONTRACT_CHANGE_SERVICE_ACTIONS.REJECTED;
    } else if (manualReviewRequired) {
      workItem = this.createManualReviewWorkItem(
        initialChangeRequest,
        application,
        principal,
        {
          affectedCount,
          validationCodes,
        },
      );
      processedChangeRequest =
        this.repository.routeForManualReview(
          initialChangeRequest.changeRequestId,
          workItem.workItemId,
          {
            outcome: {
              result: 'pending_manual_review',
              targetGroup: workItem.assignedGroup,
              affectedCount,
              validationCodes,
            },
          },
        );
      action = CONTRACT_CHANGE_SERVICE_ACTIONS.MANUAL_ROUTED;
    } else {
      processedChangeRequest = this.repository.transition(
        initialChangeRequest.changeRequestId,
        CONTRACT_CHANGE_STATUSES.COMPLETED,
        {
          manualReviewRequired: false,
          outcome: {
            result: 'updated',
            approvedBy: 'system',
            autoAccepted: true,
            affectedCount,
            validationCodes,
          },
        },
      );
      action = CONTRACT_CHANGE_SERVICE_ACTIONS.AUTO_ACCEPTED;
    }

    const warnings = [];

    try {
      this.appendAuditEvent(
        action,
        processedChangeRequest,
        principal,
        {
          applicationId:
            application?.applicationId ?? null,
          workItemId: workItem?.workItemId ?? null,
          affectedCount,
          validationCodes,
        },
      );
    } catch (error) {
      if (this.strictAudit) {
        throw error;
      }

      warnings.push(this.createWarning(error));
    }

    try {
      this.publishCreatedEvent(processedChangeRequest, {
        applicationId:
          application?.applicationId ?? null,
        affectedCount,
        validationCodes,
      });
    } catch (error) {
      if (this.strictPublication) {
        throw error;
      }

      warnings.push(this.createWarning(error));
    }

    return Object.freeze({
      ...cloneValue(processedChangeRequest),
      changeRequest: cloneValue(processedChangeRequest),
      application: cloneValue(application ?? null),
      validation: cloneValue(validation),
      eligibility: cloneValue(eligibility),
      workItem: cloneValue(workItem),
      autoAccepted:
        processedChangeRequest.status ===
        CONTRACT_CHANGE_STATUSES.COMPLETED,
      manuallyRouted:
        processedChangeRequest.status ===
        CONTRACT_CHANGE_STATUSES.MANUAL_ROUTED,
      warnings: Object.freeze(warnings),
    });
  }

  /**
   * Alias for create.
   *
   * @param {object} request Change request.
   * @param {string | object} [session] Authenticated principal.
   * @returns {object} Processed change request.
   */
  createChangeRequest(request, session) {
    return this.create(request, session);
  }

  /**
   * Searches contract change requests.
   *
   * @param {object} [request] Search filters and pagination.
   * @param {string | object} [session] Authenticated principal.
   * @returns {object} Paginated search response.
   */
  search(request = {}, session) {
    const normalizedRequest = assertOptions(
      request,
      'Contract change search request',
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
    const pagination = normalizePagination(normalizedRequest);

    try {
      const changeRequests = this.repository.list(
        createRepositoryQuery(normalizedRequest),
      );

      if (!Array.isArray(changeRequests)) {
        throw createServiceError(
          CONTRACT_CHANGE_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
          'The contract change repository returned an invalid collection.',
          null,
        );
      }

      const scopedChangeRequests = this.filterByScope(
        changeRequests,
        principal,
        partnerContext,
      ).filter((changeRequest) =>
        matchesSearch(
          changeRequest,
          normalizedRequest.search,
        ),
      );
      const total = scopedChangeRequests.length;
      const records = scopedChangeRequests
        .slice(
          pagination.offset,
          pagination.offset + pagination.pageSize,
        )
        .map((changeRequest) => cloneValue(changeRequest));
      const response = Object.freeze({
        changeRequests: Object.freeze(records),
        records: Object.freeze(records),
        data: Object.freeze(records),
        counts: createStatusCounts(scopedChangeRequests),
        page: pagination.page,
        pageSize: pagination.pageSize,
        total,
        totalPages:
          total === 0
            ? 0
            : Math.ceil(total / pagination.pageSize),
      });

      this.appendAuditEvent(
        CONTRACT_CHANGE_SERVICE_ACTIONS.SEARCHED,
        null,
        principal,
        {
          resultCount: total,
          partnerCode:
            normalizedRequest.partnerCode ?? null,
          trackingId:
            normalizedRequest.trackingId ?? null,
        },
        false,
      );

      return response;
    } catch (error) {
      if (
        error?.name === 'ContractChangeServiceError' ||
        error?.name === 'ContractChangeRepositoryError' ||
        error?.name === 'PartnerScopeGuardError' ||
        error instanceof TypeError ||
        error instanceof RangeError
      ) {
        throw error;
      }

      throw createServiceError(
        CONTRACT_CHANGE_SERVICE_ERROR_CODES.OPERATION_FAILED,
        'Unable to search contract change requests.',
        null,
        error,
      );
    }
  }

  /**
   * Lists matching change request records without response metadata.
   *
   * @param {object} [request] Search filters.
   * @param {string | object} [session] Authenticated principal.
   * @returns {object[]} Matching change requests.
   */
  list(request = {}, session) {
    return this.search(request, session).records;
  }

  /**
   * Finds a scoped change request.
   *
   * @param {string | number} changeRequestId Change request identifier.
   * @param {string | object} [session] Authenticated principal.
   * @param {object} [options] Access options.
   * @returns {object | undefined} Matching change request.
   */
  find(changeRequestId, session, options = {}) {
    const normalizedOptions = assertOptions(
      options,
      'Contract change access options',
    );
    const principal = resolvePrincipal(
      normalizedOptions,
      session,
      this.principal,
    );

    this.assertReadAuthorization(principal);

    const changeRequest = this.repository.find(
      normalizeIdentifier(
        changeRequestId,
        'Change request identifier',
      ),
    );

    if (!changeRequest) {
      return undefined;
    }

    this.assertScopeAccess(
      changeRequest,
      principal,
      resolvePartnerContext(
        normalizedOptions,
        principal,
        this.partnerContext,
      ),
    );

    return cloneValue(changeRequest);
  }

  createManualReviewWorkItem(
    changeRequest,
    application,
    principal,
    context,
  ) {
    const existing = this.workItemRepository.list({
      sourceRecordId: changeRequest.changeRequestId,
      cardType: WORK_ITEM_TYPES.DTCC_MANUAL_CHANGE,
      includeCompleted: true,
    })[0];

    if (existing) {
      return cloneValue(existing);
    }

    const timestamp = toIsoTimestamp(this.clock());
    const assignedGroup =
      changeRequest.changeType === CONTRACT_CHANGE_TYPES.HIERARCHY
        ? 'distribution'
        : changeRequest.changeType === CONTRACT_CHANGE_TYPES.LEVEL
          ? 'manager'
          : 'operations';

    try {
      return this.workItemRepository.create({
        trackingId: changeRequest.trackingId,
        sourceRecordId: changeRequest.changeRequestId,
        cardType: WORK_ITEM_TYPES.DTCC_MANUAL_CHANGE,
        state: WORK_ITEM_STATES.ACTION_NEEDED,
        priority:
          context.affectedCount > this.massChangeThreshold
            ? PRIORITIES.HIGH
            : PRIORITIES.MEDIUM,
        assignedTo: null,
        assignedGroup,
        partnerCode: changeRequest.partnerCode,
        title: `Review ${changeRequest.changeType.replace(
          /_/g,
          ' ',
        )} contract change`,
        summary:
          changeRequest.payload.reason ??
          'The contract change requires manual operational review.',
        metadata: {
          applicationId:
            application?.applicationId ?? null,
          changeRequestId: changeRequest.changeRequestId,
          changeType: changeRequest.changeType,
          affectedCount: context.affectedCount,
          requestedBy: changeRequest.requestedBy,
          validationCodes: cloneValue(context.validationCodes),
        },
        createdAt: timestamp,
        updatedAt: timestamp,
        completedAt: null,
        history: [
          {
            previousState: null,
            currentState: WORK_ITEM_STATES.ACTION_NEEDED,
            actorType: getActorType(principal),
            actorId: getPrincipalId(principal),
            comment:
              'A complex or mass contract change was routed for manual review.',
            timestamp,
          },
        ],
      });
    } catch (error) {
      throw createServiceError(
        CONTRACT_CHANGE_SERVICE_ERROR_CODES.WORKBENCH_ROUTING_FAILED,
        'The contract change could not be routed to the operations workbench.',
        {
          changeRequestId: changeRequest.changeRequestId,
          trackingId: changeRequest.trackingId,
        },
        error,
      );
    }
  }

  filterByScope(changeRequests, principal, partnerContext) {
    if (
      principal === null ||
      principal === undefined ||
      this.enforceRecordScope === false
    ) {
      return changeRequests.map((changeRequest) =>
        cloneValue(changeRequest),
      );
    }

    return this.scopeGuard.filterRecords(
      changeRequests,
      principal,
      partnerContext,
    );
  }

  assertReadAuthorization(principal) {
    if (principal === null || principal === undefined) {
      if (this.requireAuthorization) {
        throw createServiceError(
          CONTRACT_CHANGE_SERVICE_ERROR_CODES.UNAUTHENTICATED,
          'An authenticated principal is required.',
          null,
        );
      }

      return;
    }

    if (!isAuthenticatedPrincipal(principal)) {
      throw createServiceError(
        CONTRACT_CHANGE_SERVICE_ERROR_CODES.UNAUTHENTICATED,
        'An authenticated principal is required.',
        null,
      );
    }

    if (
      !canPerformAction(
        principal,
        PERMISSIONS.MANAGE_CONTRACT_CHANGES,
      ) &&
      !canPerformAction(principal, PERMISSIONS.VIEW_ONBOARDING)
    ) {
      throw createServiceError(
        CONTRACT_CHANGE_SERVICE_ERROR_CODES.FORBIDDEN_ROLE,
        'The current principal cannot view contract changes.',
        { role: getPrincipalRole(principal) },
      );
    }
  }

  assertMutationAuthorization(principal) {
    if (principal === null || principal === undefined) {
      if (this.requireAuthorization) {
        throw createServiceError(
          CONTRACT_CHANGE_SERVICE_ERROR_CODES.UNAUTHENTICATED,
          'An authenticated principal is required.',
          null,
        );
      }

      return;
    }

    if (!isAuthenticatedPrincipal(principal)) {
      throw createServiceError(
        CONTRACT_CHANGE_SERVICE_ERROR_CODES.UNAUTHENTICATED,
        'An authenticated principal is required.',
        null,
      );
    }

    if (
      !canPerformAction(
        principal,
        PERMISSIONS.MANAGE_CONTRACT_CHANGES,
      )
    ) {
      throw createServiceError(
        CONTRACT_CHANGE_SERVICE_ERROR_CODES.FORBIDDEN_ROLE,
        'The current principal cannot create contract changes.',
        { role: getPrincipalRole(principal) },
      );
    }
  }

  assertScopeAccess(record, principal, partnerContext) {
    if (
      principal === null ||
      principal === undefined ||
      this.enforceRecordScope === false
    ) {
      return;
    }

    if (
      !this.scopeGuard.canAccessRecord(
        record,
        principal,
        partnerContext,
      )
    ) {
      throw createServiceError(
        CONTRACT_CHANGE_SERVICE_ERROR_CODES.PARTNER_SCOPE_VIOLATION,
        'The contract change is outside the current record scope.',
        {
          changeRequestId: record.changeRequestId ?? null,
          applicationId: record.applicationId ?? null,
          trackingId: record.trackingId ?? null,
          partnerCode: record.partnerCode ?? null,
        },
      );
    }
  }

  appendAuditEvent(
    action,
    changeRequest,
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
          trackingId: changeRequest?.trackingId ?? null,
          changeRequestId:
            changeRequest?.changeRequestId ?? undefined,
          sourceRecordId:
            changeRequest?.changeRequestId ??
            changeRequest?.trackingId ??
            undefined,
          action,
          actorId: getPrincipalId(principal),
          actorType: getActorType(principal),
          source: AUDIT_SOURCES.CONTRACT_CHANGE,
          summary: action.toLowerCase().replace(/_/g, ' '),
          metadata: {
            changeRequestId:
              changeRequest?.changeRequestId ?? null,
            changeType: changeRequest?.changeType ?? null,
            partnerCode: changeRequest?.partnerCode ?? null,
            status: changeRequest?.status ?? null,
            material,
            ...cloneValue(metadata),
          },
          timestamp: toIsoTimestamp(this.clock()),
        },
        {
          actor: principal,
          source: AUDIT_SOURCES.CONTRACT_CHANGE,
        },
      );
    } catch (error) {
      throw createServiceError(
        CONTRACT_CHANGE_SERVICE_ERROR_CODES.AUDIT_FAILED,
        'Unable to persist the contract change audit event.',
        {
          action,
          changeRequestId:
            changeRequest?.changeRequestId ?? null,
        },
        error,
      );
    }
  }

  publishCreatedEvent(changeRequest, metadata) {
    if (!this.eventPublisher) {
      return null;
    }

    try {
      return this.eventPublisher.publishChangeRequestSubmitted(
        {
          changeRequestId: changeRequest.changeRequestId,
          trackingId: changeRequest.trackingId,
          partnerCode: changeRequest.partnerCode,
          changeType: changeRequest.changeType,
          requestedBy: changeRequest.requestedBy,
          status: changeRequest.status,
          manualReviewRequired:
            changeRequest.manualReviewRequired,
          createdWorkItemId:
            changeRequest.createdWorkItemId,
          validationCodes:
            changeRequest.outcome?.validationCodes ?? [],
          outcome: cloneValue(changeRequest.outcome),
        },
        {
          occurredAt: changeRequest.createdAt,
          metadata: cloneValue(metadata),
        },
      );
    } catch (error) {
      throw createServiceError(
        CONTRACT_CHANGE_SERVICE_ERROR_CODES.EVENT_PUBLICATION_FAILED,
        'The change-request-submitted event could not be published.',
        {
          changeRequestId: changeRequest.changeRequestId,
        },
        error,
      );
    }
  }

  createWarning(error) {
    return Object.freeze({
      code:
        normalizeOptionalIdentifier(error?.code) ??
        CONTRACT_CHANGE_SERVICE_ERROR_CODES.OPERATION_FAILED,
      message:
        normalizeOptionalIdentifier(error?.message) ??
        'A contract change side effect could not be completed.',
      details: cloneValue(error?.details ?? null),
    });
  }
}

/**
 * Creates a contract change service.
 *
 * @param {ConstructorParameters<typeof ContractChangeService>[0]} [options]
 * Service options.
 * @returns {ContractChangeService} Contract change service.
 */
export function createContractChangeService(options = {}) {
  return new ContractChangeService(options);
}

/**
 * Creates a contract change with a newly created service.
 *
 * @param {object} request Change request.
 * @param {string | object} session Authenticated principal.
 * @param {ConstructorParameters<typeof ContractChangeService>[0]}
 * [serviceOptions] Service options.
 * @returns {object} Processed change request.
 */
export function createContractChange(
  request,
  session,
  serviceOptions = {},
) {
  return createContractChangeService(serviceOptions).create(
    request,
    session,
  );
}

/**
 * Searches contract changes with a newly created service.
 *
 * @param {object} request Search request.
 * @param {string | object} session Authenticated principal.
 * @param {ConstructorParameters<typeof ContractChangeService>[0]}
 * [serviceOptions] Service options.
 * @returns {object} Search response.
 */
export function searchContractChanges(
  request,
  session,
  serviceOptions = {},
) {
  return createContractChangeService(serviceOptions).search(
    request,
    session,
  );
}

export const ChangeRequestModule = ContractChangeService;
export const ContractChangeModule = ContractChangeService;
export const ContractChangeAPI = ContractChangeService;
export const createChangeRequestModule = createContractChangeService;
export const createContractChangeAPI = createContractChangeService;
export const submitContractChange = createContractChange;
export const searchChangeRequests = searchContractChanges;

export default ContractChangeService;