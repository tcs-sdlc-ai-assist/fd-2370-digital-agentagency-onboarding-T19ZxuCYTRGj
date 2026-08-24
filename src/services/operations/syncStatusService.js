import {
  AUDIT_SOURCES,
  INTEGRATION_SYSTEMS,
  PRIORITIES,
  WORK_ITEM_STATES,
  WORK_ITEM_TYPES,
} from '../../constants/domain.js';
import { PERMISSIONS } from '../../constants/roles.js';
import { canPerformAction } from '../../auth/permissionPolicy.js';
import { PartnerScopeGuard } from '../../auth/partnerScopeGuard.js';
import { getSeeds } from '../../persistence/seedLoader.js';
import {
  SYNC_ATTEMPT_STATUSES,
  SyncAttemptRepository,
} from '../../repositories/syncAttemptRepository.js';
import { WorkItemRepository } from '../../repositories/workItemRepository.js';
import { OnboardingRecordRepository } from '../../repositories/onboardingRecordRepository.js';
import { toIsoTimestamp } from '../../utils/dates.js';
import {
  generateCorrelationId,
  generateWorkItemId,
} from '../../utils/ids.js';
import { AuditService } from '../shared/auditService.js';

export const SYNC_STATUS_SERVICE_ERROR_CODES = Object.freeze({
  INVALID_OPTIONS: 'SYNC_STATUS_INVALID_OPTIONS',
  INVALID_REQUEST: 'SYNC_STATUS_INVALID_REQUEST',
  INVALID_DEPENDENCY: 'SYNC_STATUS_INVALID_DEPENDENCY',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN_ROLE: 'FORBIDDEN_ROLE',
  PARTNER_SCOPE_VIOLATION: 'PARTNER_SCOPE_VIOLATION',
  RECORD_NOT_FOUND: 'SYNC_STATUS_RECORD_NOT_FOUND',
  EVENT_ALREADY_RECONCILED: 'SYNC_STATUS_EVENT_ALREADY_RECONCILED',
  OPERATION_FAILED: 'SYNC_STATUS_OPERATION_FAILED',
  AUDIT_FAILED: 'SYNC_STATUS_AUDIT_FAILED',
});

export const SYNC_STATUS_ACTIONS = Object.freeze({
  SEARCHED: 'SYNC_STATUS_SEARCHED',
  ATTEMPT_CREATED: 'SYNC_ATTEMPT_CREATED',
  FAILURE_ROUTED: 'SYNC_FAILURE_ROUTED',
  HORIZON_REDIRECTED: 'HORIZON_EVENT_REDIRECTED',
  HORIZON_SKIPPED: 'HORIZON_EVENT_SKIPPED',
  LEVEL_40_LIFEPRO_ACTIVATED: 'LEVEL_40_LIFEPRO_ACTIVATED',
});

export const HORIZON_RECONCILIATION_ACTIONS = Object.freeze({
  REDIRECTED: 'redirected_to_digital_appointment_flow',
  SKIPPED_NO_MATCH: 'skipped_no_digital_match',
  SKIPPED_INELIGIBLE: 'skipped_status_not_eligible',
  DUPLICATE: 'duplicate_event_prevented',
});

export const DEFAULT_SYNC_STATUS_PAGE_SIZE = 25;
export const MAX_SYNC_STATUS_PAGE_SIZE = 100;

const HORIZON_REDIRECTABLE_STAGES = new Set([
  'application_submitted',
  'application_under_review',
  'licensing_review',
  'background_check',
  'appointment',
  'appointment_pending',
  'contracted',
]);

const HORIZON_TERMINAL_STATUSES = new Set([
  'declined',
  'terminated',
  'withdrawn',
]);

const LEVEL_40_TOKENS = new Set([
  '40',
  'generalagency',
  'mastergeneralagency',
  'level40',
]);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertOptions(options, description = 'Sync status options') {
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

function normalizeIdentifierForLookup(value) {
  return normalizeOptionalIdentifier(value)
    ?.normalize('NFKC')
    .toLowerCase();
}

function normalizeToken(value) {
  return normalizeIdentifierForLookup(value)?.replace(/[^a-z0-9]/g, '');
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

function createSyncStatusError(code, message, details, cause) {
  const error = new Error(message, {
    ...(cause === undefined ? {} : { cause }),
  });

  error.name = 'SyncStatusServiceError';
  error.code = code;
  error.details = details ?? null;
  error.recoverable = true;

  return error;
}

function assertSyncRepository(repository) {
  const requiredMethods = ['create', 'find', 'list'];

  if (
    !isObject(repository) ||
    requiredMethods.some(
      (method) => typeof repository[method] !== 'function',
    )
  ) {
    throw createSyncStatusError(
      SYNC_STATUS_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
      'The synchronization repository must provide create, find, and list methods.',
      { requiredMethods },
    );
  }

  return repository;
}

function assertWorkItemRepository(repository) {
  const requiredMethods = ['create', 'list'];

  if (
    !isObject(repository) ||
    requiredMethods.some(
      (method) => typeof repository[method] !== 'function',
    )
  ) {
    throw createSyncStatusError(
      SYNC_STATUS_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
      'The work item repository must provide create and list methods.',
      { requiredMethods },
    );
  }

  return repository;
}

function assertOnboardingRepository(repository) {
  if (
    !isObject(repository) ||
    typeof repository.list !== 'function'
  ) {
    throw createSyncStatusError(
      SYNC_STATUS_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
      'The onboarding repository must provide a list method.',
      { requiredMethods: ['list'] },
    );
  }

  return repository;
}

function assertScopeGuard(scopeGuard) {
  if (
    !isObject(scopeGuard) ||
    typeof scopeGuard.canAccessRecord !== 'function'
  ) {
    throw createSyncStatusError(
      SYNC_STATUS_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
      'The partner scope guard must provide canAccessRecord.',
      { requiredMethods: ['canAccessRecord'] },
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
    throw createSyncStatusError(
      SYNC_STATUS_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
      'The sync status audit service must provide append or create.',
      null,
    );
  }

  return auditService;
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

function normalizeFilter(value, description) {
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

function normalizePagination(request) {
  const page = request.page ?? 1;
  const pageSize = request.pageSize ?? DEFAULT_SYNC_STATUS_PAGE_SIZE;

  if (!Number.isInteger(page) || page < 1) {
    throw new RangeError(
      'The sync status page must be a positive integer.',
    );
  }

  if (
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > MAX_SYNC_STATUS_PAGE_SIZE
  ) {
    throw new RangeError(
      `The sync status page size must be from 1 to ${MAX_SYNC_STATUS_PAGE_SIZE}.`,
    );
  }

  return { page, pageSize };
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

  const user = getPrincipalUser(principal);
  const role = principal.role ?? user?.role;

  return typeof role === 'string' && role.trim() !== '';
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

function getActorId(principal) {
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

function createAttemptQuery(request) {
  const systems = normalizeFilter(
    request.systems ?? request.system,
    'Integration system',
  );
  const statuses = normalizeFilter(
    request.statuses ?? request.status,
    'Synchronization status',
  );
  const operations = normalizeFilter(
    request.operations ?? request.operation,
    'Synchronization operation',
  );

  return {
    ...(request.trackingId === undefined
      ? {}
      : {
          trackingId: normalizeIdentifier(
            request.trackingId,
            'Tracking identifier',
          ),
        }),
    ...(systems === undefined ? {} : { systems }),
    ...(statuses === undefined ? {} : { statuses }),
    ...(operations === undefined ? {} : { operations }),
    ...(request.correlationId === undefined
      ? {}
      : {
          correlationId: normalizeIdentifier(
            request.correlationId,
            'Correlation identifier',
          ),
        }),
    ...(request.resolved === undefined
      ? {}
      : { resolved: request.resolved }),
    ...(request.attemptedFrom === undefined
      ? {}
      : { attemptedFrom: request.attemptedFrom }),
    ...(request.attemptedTo === undefined
      ? {}
      : { attemptedTo: request.attemptedTo }),
    sortOrder: request.sortDirection ?? request.sortOrder ?? 'desc',
  };
}

function findApplication(repository, identifier) {
  if (!identifier) {
    return undefined;
  }

  if (typeof repository.find === 'function') {
    const record = repository.find(identifier);

    if (record) {
      return record;
    }
  }

  if (typeof repository.findByTrackingId === 'function') {
    const record = repository.findByTrackingId(identifier);

    if (record) {
      return record;
    }
  }

  if (typeof repository.findByApplicationId === 'function') {
    return repository.findByApplicationId(identifier);
  }

  return undefined;
}

function getRecordNpn(record) {
  return normalizeOptionalIdentifier(
    record.applicant?.npn ??
      record.agent?.npn ??
      record.licensing?.npn ??
      record.applicationPayload?.applicant?.npn ??
      record.applicationPayload?.agent?.npn ??
      record.formState?.applicant?.npn ??
      record.formState?.agent?.npn ??
      record.npn,
  );
}

function getRecordAgentCode(record, generatedCodeIndex) {
  const directCode = normalizeOptionalIdentifier(
    record.agentCode ??
      record.applicant?.agentCode ??
      record.agent?.agentCode ??
      record.contract?.agentCode ??
      record.processingSnapshot?.eligibility?.derivedValues?.agentCode
        ?.code ??
      record.processingSnapshot?.eligibility?.derived?.agentCode?.code,
  );

  if (directCode) {
    return directCode;
  }

  const generatedCode =
    generatedCodeIndex.get(
      normalizeIdentifierForLookup(record.trackingId),
    ) ??
    generatedCodeIndex.get(
      normalizeIdentifierForLookup(record.applicationId),
    );

  return normalizeOptionalIdentifier(generatedCode?.generatedCode);
}

function createGeneratedCodeIndex(generatedCodes) {
  const index = new Map();

  if (!Array.isArray(generatedCodes)) {
    return index;
  }

  generatedCodes.forEach((entry) => {
    [entry.trackingId, entry.applicationId].forEach((identifier) => {
      const normalizedIdentifier =
        normalizeIdentifierForLookup(identifier);

      if (normalizedIdentifier && !index.has(normalizedIdentifier)) {
        index.set(normalizedIdentifier, entry);
      }
    });
  });

  return index;
}

function recordMatchesHorizonEvent(record, event, generatedCodeIndex) {
  const requestedAgentCode = normalizeIdentifierForLookup(
    event.agentCode,
  );
  const requestedNpn = normalizeIdentifierForLookup(event.npn);
  const recordAgentCode = normalizeIdentifierForLookup(
    getRecordAgentCode(record, generatedCodeIndex),
  );
  const recordNpn = normalizeIdentifierForLookup(getRecordNpn(record));

  return Boolean(
    (requestedAgentCode &&
      recordAgentCode &&
      requestedAgentCode === recordAgentCode) ||
      (requestedNpn && recordNpn && requestedNpn === recordNpn),
  );
}

function isHorizonRedirectEligible(record) {
  const workflowStage = normalizeIdentifierForLookup(
    record.workflowStage,
  );
  const status = normalizeIdentifierForLookup(record.status);

  if (status && HORIZON_TERMINAL_STATUSES.has(status)) {
    return false;
  }

  if (workflowStage && HORIZON_REDIRECTABLE_STAGES.has(workflowStage)) {
    return true;
  }

  return [
    'approved',
    'completed',
    'in_review',
    'submitted',
  ].includes(status);
}

function isLevel40Record(record) {
  return LEVEL_40_TOKENS.has(
    normalizeToken(
      record.contract?.level ??
        record.level ??
        record.contractLevel,
    ),
  );
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

function createUnknownBadge(system) {
  return Object.freeze({
    system,
    status: 'unknown',
    operation: null,
    message: 'No synchronization attempt.',
    attemptedAt: null,
    resolvedAt: null,
    correlationId: null,
    syncAttemptId: null,
  });
}

/**
 * Queries synchronization history and reconciles synthetic Horizon events.
 */
export class SyncStatusService {
  /**
   * @param {{
   *   repository?: object,
   *   syncAttemptRepository?: object,
   *   workItemRepository?: object,
   *   onboardingRepository?: object,
   *   partnerScopeGuard?: object,
   *   auditService?: object | false,
   *   principal?: string | object,
   *   partnerContext?: object,
   *   generatedCodes?: object[],
   *   requireAuthorization?: boolean,
   *   enforceRecordScope?: boolean,
   *   createFailureWorkItems?: boolean,
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
      throw new TypeError('The sync status clock must be a function.');
    }

    this.clock = normalizedOptions.clock ?? (() => new Date());
    const repositoryOptions = createRepositoryOptions(
      normalizedOptions,
      this.clock,
    );

    this.repository = assertSyncRepository(
      normalizedOptions.repository ??
        normalizedOptions.syncAttemptRepository ??
        new SyncAttemptRepository(repositoryOptions),
    );
    this.workItemRepository = assertWorkItemRepository(
      normalizedOptions.workItemRepository ??
        new WorkItemRepository(repositoryOptions),
    );
    this.onboardingRepository = assertOnboardingRepository(
      normalizedOptions.onboardingRepository ??
        new OnboardingRecordRepository(repositoryOptions),
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
    this.partnerContext = normalizedOptions.partnerContext ?? null;
    this.requireAuthorization =
      normalizedOptions.requireAuthorization ?? false;
    this.enforceRecordScope =
      normalizedOptions.enforceRecordScope ?? true;
    this.createFailureWorkItems =
      normalizedOptions.createFailureWorkItems ?? true;
    this.strictAudit = normalizedOptions.strictAudit ?? false;
    this.generatedCodeIndex = createGeneratedCodeIndex(
      normalizedOptions.generatedCodes ?? getSeeds().generatedCodes,
    );
  }

  /**
   * Searches synchronization attempts and returns latest system badges.
   *
   * @param {object} [request] Search filters.
   * @param {string | object} [session] Authenticated principal.
   * @returns {object} Paginated synchronization response.
   */
  search(request = {}, session) {
    const normalizedRequest = assertOptions(
      request,
      'Sync status search request',
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

    try {
      const attempts = this.repository.list(
        createAttemptQuery(normalizedRequest),
      );

      if (!Array.isArray(attempts)) {
        throw createSyncStatusError(
          SYNC_STATUS_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
          'The synchronization repository returned an invalid collection.',
          null,
        );
      }

      const scopedAttempts = attempts.filter((attempt) =>
        this.canAccessAttempt(attempt, principal, partnerContext),
      );
      const total = scopedAttempts.length;
      const start = (page - 1) * pageSize;
      const records = scopedAttempts
        .slice(start, start + pageSize)
        .map((attempt) => cloneValue(attempt));
      const trackingIds = [
        ...new Set(
          scopedAttempts
            .map((attempt) => attempt.trackingId)
            .filter(Boolean),
        ),
      ];
      const badges = Object.fromEntries(
        trackingIds.map((trackingId) => [
          trackingId,
          this.getStatusBadges(trackingId, principal, {
            partnerContext,
          }),
        ]),
      );
      const response = Object.freeze({
        records: Object.freeze(records),
        data: Object.freeze(records),
        badges: Object.freeze(badges),
        page,
        pageSize,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
      });

      this.appendAuditEvent(
        SYNC_STATUS_ACTIONS.SEARCHED,
        null,
        principal,
        {
          resultCount: total,
          trackingId: normalizedRequest.trackingId ?? null,
          systems:
            normalizedRequest.systems ??
            normalizedRequest.system ??
            null,
          statuses:
            normalizedRequest.statuses ??
            normalizedRequest.status ??
            null,
        },
        false,
      );

      return response;
    } catch (error) {
      if (
        error?.name === 'SyncStatusServiceError' ||
        error?.name === 'SyncAttemptRepositoryError' ||
        error instanceof TypeError ||
        error instanceof RangeError
      ) {
        throw error;
      }

      throw createSyncStatusError(
        SYNC_STATUS_SERVICE_ERROR_CODES.OPERATION_FAILED,
        'Unable to search synchronization attempts.',
        null,
        error,
      );
    }
  }

  /**
   * Alias for search.
   *
   * @param {object} [request] Search filters.
   * @param {string | object} [session] Authenticated principal.
   * @returns {object} Search response.
   */
  searchSyncStatus(request = {}, session) {
    return this.search(request, session);
  }

  /**
   * Returns latest status badges for all configured systems.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @param {string | object} [session] Authenticated principal.
   * @param {object} [options] Access options.
   * @returns {Record<string, object>} Status badges.
   */
  getStatusBadges(trackingId, session, options = {}) {
    const normalizedTrackingId = normalizeIdentifier(
      trackingId,
      'Tracking identifier',
    );
    const normalizedOptions = assertOptions(
      options,
      'Sync status badge options',
    );
    const principal = resolvePrincipal(
      normalizedOptions,
      session,
      this.principal,
    );

    this.assertReadAuthorization(principal);

    const partnerContext = resolvePartnerContext(
      normalizedOptions,
      principal,
      this.partnerContext,
    );
    const record = findApplication(
      this.onboardingRepository,
      normalizedTrackingId,
    );

    if (
      record &&
      !this.canAccessRecord(record, principal, partnerContext)
    ) {
      throw createSyncStatusError(
        SYNC_STATUS_SERVICE_ERROR_CODES.PARTNER_SCOPE_VIOLATION,
        'The requested synchronization status is outside the current record scope.',
        { trackingId: normalizedTrackingId },
      );
    }

    const attempts = this.repository.list({
      trackingId: normalizedTrackingId,
      sortOrder: 'desc',
    });
    const latestBySystem = new Map();

    attempts.forEach((attempt) => {
      if (!latestBySystem.has(attempt.system)) {
        latestBySystem.set(attempt.system, attempt);
      }
    });

    return Object.freeze(
      Object.fromEntries(
        Object.values(INTEGRATION_SYSTEMS).map((system) => {
          const attempt = latestBySystem.get(system);

          return [
            system,
            attempt
              ? Object.freeze({
                  system,
                  status: attempt.status,
                  operation: attempt.operation,
                  message: attempt.message,
                  attemptedAt: attempt.attemptedAt,
                  resolvedAt: attempt.resolvedAt,
                  correlationId: attempt.correlationId,
                  syncAttemptId: attempt.syncAttemptId,
                })
              : createUnknownBadge(system),
          ];
        }),
      ),
    );
  }

  /**
   * Alias for getStatusBadges.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @param {string | object} [session] Authenticated principal.
   * @param {object} [options] Access options.
   * @returns {Record<string, object>} Status badges.
   */
  getLatestStatusBySystem(trackingId, session, options = {}) {
    return this.getStatusBadges(trackingId, session, options);
  }

  /**
   * Reconciles a synthetic Horizon JIT event with a digital record.
   *
   * @param {{
   *   eventId: string,
   *   agentCode?: string,
   *   npn?: string,
   *   eventType?: string,
   *   requestedStates?: string[],
   *   correlationId?: string,
   *   principal?: object,
   *   partnerContext?: object
   * }} request Horizon event.
   * @param {string | object} [session] Authenticated principal.
   * @returns {object} Reconciliation result.
   */
  reconcileHorizonEvent(request, session) {
    const normalizedRequest = assertOptions(
      request,
      'Horizon reconciliation request',
    );
    const eventId = normalizeIdentifier(
      normalizedRequest.eventId,
      'Horizon event identifier',
    );
    const agentCode = normalizeOptionalIdentifier(
      normalizedRequest.agentCode,
    );
    const npn = normalizeOptionalIdentifier(normalizedRequest.npn);

    if (!agentCode && !npn) {
      throw createSyncStatusError(
        SYNC_STATUS_SERVICE_ERROR_CODES.INVALID_REQUEST,
        'A Horizon event requires an agent code or NPN.',
        { eventId },
      );
    }

    if (
      normalizedRequest.requestedStates !== undefined &&
      !Array.isArray(normalizedRequest.requestedStates)
    ) {
      throw new TypeError(
        'Horizon requested states must be an array.',
      );
    }

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
    const existingAttempt = this.findHorizonEventAttempt(eventId);

    if (existingAttempt) {
      const matchedDigitalRecord =
        existingAttempt.status === SYNC_ATTEMPT_STATUSES.SUCCESS;

      return Object.freeze({
        eventId,
        matchedDigitalRecord,
        trackingId: existingAttempt.trackingId,
        action: HORIZON_RECONCILIATION_ACTIONS.DUPLICATE,
        duplicatePrevented: true,
        correlationId: existingAttempt.correlationId,
        syncAttemptId: existingAttempt.syncAttemptId,
        workItemId:
          existingAttempt.payloadSummary?.createdWorkItemId ?? null,
        idempotent: true,
      });
    }

    const records = this.onboardingRepository.list({
      includeCompleted: true,
    });
    const matches = records.filter((record) =>
      recordMatchesHorizonEvent(
        record,
        { agentCode, npn },
        this.generatedCodeIndex,
      ),
    );
    const scopedMatches = matches.filter((record) =>
      this.canAccessRecord(record, principal, partnerContext),
    );
    const matchedRecord =
      scopedMatches.find(isHorizonRedirectEligible) ??
      scopedMatches[0];
    const timestamp = toIsoTimestamp(this.clock());
    const correlationId = normalizeIdentifier(
      normalizedRequest.correlationId ??
        generateCorrelationId({
          eventId,
          agentCode: agentCode ?? null,
          npn: npn ?? null,
          eventType:
            normalizedRequest.eventType ??
            'jit_appointment_requested',
        }),
      'Horizon correlation identifier',
    );

    if (!matchedRecord) {
      if (
        matches.length > 0 &&
        principal !== null &&
        principal !== undefined
      ) {
        throw createSyncStatusError(
          SYNC_STATUS_SERVICE_ERROR_CODES.PARTNER_SCOPE_VIOLATION,
          'The matched digital record is outside the current record scope.',
          { eventId },
        );
      }

      const attempt = this.createAttempt(
        {
          trackingId: null,
          system: INTEGRATION_SYSTEMS.HORIZON,
          operation: 'reconcile_jit_event',
          status: SYNC_ATTEMPT_STATUSES.SKIPPED,
          correlationId,
          message:
            'No matching digital onboarding record was found for the Horizon event.',
          payloadSummary: {
            eventId,
            eventType:
              normalizedRequest.eventType ??
              'jit_appointment_requested',
            agentCode: agentCode ?? null,
            npn: npn ?? null,
            requestedStates: cloneValue(
              normalizedRequest.requestedStates ?? [],
            ),
            matchedDigitalRecord: false,
            duplicatePrevented: false,
          },
          attemptedAt: timestamp,
          resolvedAt: timestamp,
        },
        principal,
      );

      this.appendAuditEvent(
        SYNC_STATUS_ACTIONS.HORIZON_SKIPPED,
        attempt,
        principal,
        {
          eventId,
          reason: 'no_digital_match',
        },
      );

      return Object.freeze({
        eventId,
        matchedDigitalRecord: false,
        trackingId: null,
        action: HORIZON_RECONCILIATION_ACTIONS.SKIPPED_NO_MATCH,
        duplicatePrevented: false,
        correlationId,
        syncAttemptId: attempt.syncAttemptId,
        workItemId: null,
      });
    }

    if (!isHorizonRedirectEligible(matchedRecord)) {
      const attempt = this.createAttempt(
        {
          trackingId: matchedRecord.trackingId,
          system: INTEGRATION_SYSTEMS.HORIZON,
          operation: 'reconcile_jit_event',
          status: SYNC_ATTEMPT_STATUSES.SKIPPED,
          correlationId,
          message:
            'A digital record matched, but its status is not eligible for Horizon redirection.',
          payloadSummary: {
            eventId,
            applicationId: matchedRecord.applicationId,
            workflowStage: matchedRecord.workflowStage,
            status: matchedRecord.status,
            matchedDigitalRecord: true,
            duplicatePrevented: false,
          },
          attemptedAt: timestamp,
          resolvedAt: timestamp,
        },
        principal,
      );

      this.appendAuditEvent(
        SYNC_STATUS_ACTIONS.HORIZON_SKIPPED,
        attempt,
        principal,
        {
          eventId,
          reason: 'status_not_eligible',
          applicationId: matchedRecord.applicationId,
        },
      );

      return Object.freeze({
        eventId,
        matchedDigitalRecord: true,
        trackingId: matchedRecord.trackingId,
        applicationId: matchedRecord.applicationId,
        action: HORIZON_RECONCILIATION_ACTIONS.SKIPPED_INELIGIBLE,
        duplicatePrevented: false,
        correlationId,
        syncAttemptId: attempt.syncAttemptId,
        workItemId: null,
      });
    }

    const attempt = this.createAttempt(
      {
        trackingId: matchedRecord.trackingId,
        system: INTEGRATION_SYSTEMS.HORIZON,
        operation: 'redirect_jit_appointment',
        status: SYNC_ATTEMPT_STATUSES.SUCCESS,
        correlationId,
        message:
          'The Horizon event was redirected to the existing digital appointment flow.',
        payloadSummary: {
          eventId,
          eventType:
            normalizedRequest.eventType ??
            'jit_appointment_requested',
          applicationId: matchedRecord.applicationId,
          agentCode:
            agentCode ??
            getRecordAgentCode(
              matchedRecord,
              this.generatedCodeIndex,
            ) ??
            null,
          npn: npn ?? getRecordNpn(matchedRecord) ?? null,
          requestedStates: cloneValue(
            normalizedRequest.requestedStates ?? [],
          ),
          matchedDigitalRecord: true,
          duplicatePrevented: true,
        },
        attemptedAt: timestamp,
        resolvedAt: timestamp,
      },
      principal,
    );

    this.appendAuditEvent(
      SYNC_STATUS_ACTIONS.HORIZON_REDIRECTED,
      attempt,
      principal,
      {
        eventId,
        applicationId: matchedRecord.applicationId,
        duplicatePrevented: true,
      },
    );

    return Object.freeze({
      eventId,
      matchedDigitalRecord: true,
      trackingId: matchedRecord.trackingId,
      applicationId: matchedRecord.applicationId,
      action: HORIZON_RECONCILIATION_ACTIONS.REDIRECTED,
      duplicatePrevented: true,
      correlationId,
      syncAttemptId: attempt.syncAttemptId,
      workItemId: null,
    });
  }

  /**
   * Records direct LifePro activation for a level-40 agency.
   *
   * Level-40 records intentionally bypass Agent DB activation in this demo.
   *
   * @param {string | number | object} recordOrIdentifier Record or identifier.
   * @param {object} [options] Activation options.
   * @param {string | object} [session] Authenticated principal.
   * @returns {object} LifePro synchronization result.
   */
  recordLevel40LifeProActivation(
    recordOrIdentifier,
    options = {},
    session,
  ) {
    const normalizedOptions = assertOptions(
      options,
      'Level-40 LifePro activation options',
    );
    const principal = resolvePrincipal(
      normalizedOptions,
      session,
      this.principal,
    );

    this.assertMutationAuthorization(principal);

    const record = isObject(recordOrIdentifier)
      ? cloneValue(recordOrIdentifier)
      : findApplication(
          this.onboardingRepository,
          normalizeIdentifier(
            recordOrIdentifier,
            'Onboarding record identifier',
          ),
        );

    if (!record) {
      throw createSyncStatusError(
        SYNC_STATUS_SERVICE_ERROR_CODES.RECORD_NOT_FOUND,
        `Onboarding record not found: ${recordOrIdentifier}`,
        { identifier: String(recordOrIdentifier) },
      );
    }

    const partnerContext = resolvePartnerContext(
      normalizedOptions,
      principal,
      this.partnerContext,
    );

    if (!this.canAccessRecord(record, principal, partnerContext)) {
      throw createSyncStatusError(
        SYNC_STATUS_SERVICE_ERROR_CODES.PARTNER_SCOPE_VIOLATION,
        'The requested onboarding record is outside the current record scope.',
        {
          trackingId: record.trackingId ?? null,
          applicationId: record.applicationId ?? null,
        },
      );
    }

    if (!isLevel40Record(record)) {
      throw createSyncStatusError(
        SYNC_STATUS_SERVICE_ERROR_CODES.INVALID_REQUEST,
        'Direct LifePro activation is limited to level-40 agency records.',
        {
          trackingId: record.trackingId ?? null,
          level: record.contract?.level ?? record.level ?? null,
        },
      );
    }

    const timestamp = toIsoTimestamp(
      normalizedOptions.attemptedAt ?? this.clock(),
    );
    const correlationId =
      normalizedOptions.correlationId ??
      generateCorrelationId({
        type: 'level-40-lifepro-activation',
        trackingId: record.trackingId,
        applicationId: record.applicationId,
        timestamp,
      });
    const existing = this.repository.list({
      trackingId: record.trackingId,
      system: INTEGRATION_SYSTEMS.LIFE_PRO,
      operation: 'activate_level_40_agency',
      correlationId,
    })[0];

    if (existing) {
      return Object.freeze({
        trackingId: record.trackingId,
        applicationId: record.applicationId ?? null,
        system: INTEGRATION_SYSTEMS.LIFE_PRO,
        directLifeProActivation: true,
        agentDbBypassed: true,
        idempotent: true,
        attempt: cloneValue(existing),
      });
    }

    const attempt = this.createAttempt(
      {
        trackingId: record.trackingId,
        system: INTEGRATION_SYSTEMS.LIFE_PRO,
        operation: 'activate_level_40_agency',
        status: SYNC_ATTEMPT_STATUSES.SUCCESS,
        correlationId,
        message:
          'The level-40 agency was activated directly in the LifePro simulation.',
        payloadSummary: {
          applicationId: record.applicationId ?? null,
          company: record.company ?? null,
          carrierCode: record.carrierCode ?? null,
          level: record.contract?.level ?? record.level ?? 40,
          directLifeProActivation: true,
          agentDbBypassed: true,
        },
        attemptedAt: timestamp,
        resolvedAt: timestamp,
      },
      principal,
    );

    this.appendAuditEvent(
      SYNC_STATUS_ACTIONS.LEVEL_40_LIFEPRO_ACTIVATED,
      attempt,
      principal,
      {
        applicationId: record.applicationId ?? null,
        level: record.contract?.level ?? record.level ?? 40,
        agentDbBypassed: true,
      },
    );

    return Object.freeze({
      trackingId: record.trackingId,
      applicationId: record.applicationId ?? null,
      system: INTEGRATION_SYSTEMS.LIFE_PRO,
      directLifeProActivation: true,
      agentDbBypassed: true,
      idempotent: false,
      attempt: cloneValue(attempt),
    });
  }

  /**
   * Alias for recordLevel40LifeProActivation.
   *
   * @param {string | number | object} recordOrIdentifier Record or identifier.
   * @param {object} [options] Activation options.
   * @param {string | object} [session] Authenticated principal.
   * @returns {object} Activation result.
   */
  syncLevel40Agency(recordOrIdentifier, options = {}, session) {
    return this.recordLevel40LifeProActivation(
      recordOrIdentifier,
      options,
      session,
    );
  }

  /**
   * Creates a synchronization attempt and optionally routes failures.
   *
   * @param {object} attempt Synchronization attempt.
   * @param {string | object} [session] Authenticated principal.
   * @returns {object} Created attempt.
   */
  createAttempt(attempt, session) {
    if (!isObject(attempt)) {
      throw new TypeError(
        'A synchronization attempt must be an object.',
      );
    }

    const principal = session ?? this.principal;
    const createdAttempt = this.repository.create(attempt);
    let workItem = null;

    if (
      this.createFailureWorkItems &&
      createdAttempt.status === SYNC_ATTEMPT_STATUSES.FAILED
    ) {
      workItem = this.createFailureWorkItem(
        createdAttempt,
        { principal },
      );
    }

    this.appendAuditEvent(
      SYNC_STATUS_ACTIONS.ATTEMPT_CREATED,
      createdAttempt,
      principal,
      {
        status: createdAttempt.status,
        system: createdAttempt.system,
        operation: createdAttempt.operation,
        workItemId: workItem?.workItemId ?? null,
      },
    );

    return cloneValue(
      workItem
        ? {
            ...createdAttempt,
            createdWorkItemId: workItem.workItemId,
          }
        : createdAttempt,
    );
  }

  /**
   * Creates an idempotent sync-failure work item.
   *
   * @param {object | string | number} attemptOrId Attempt or identifier.
   * @param {object} [options] Work item options.
   * @returns {object} Existing or created work item.
   */
  createFailureWorkItem(attemptOrId, options = {}) {
    const normalizedOptions = assertOptions(
      options,
      'Sync failure work item options',
    );
    const attempt = isObject(attemptOrId)
      ? attemptOrId
      : this.repository.find(attemptOrId);

    if (!attempt) {
      throw createSyncStatusError(
        SYNC_STATUS_SERVICE_ERROR_CODES.RECORD_NOT_FOUND,
        `Synchronization attempt not found: ${attemptOrId}`,
        { syncAttemptId: String(attemptOrId) },
      );
    }

    const existing = this.workItemRepository.list({
      sourceRecordId: attempt.syncAttemptId,
      cardType: WORK_ITEM_TYPES.SYNC_FAILURE,
      includeCompleted: true,
    })[0];

    if (existing) {
      return cloneValue(existing);
    }

    const record = findApplication(
      this.onboardingRepository,
      attempt.trackingId,
    );
    const timestamp = toIsoTimestamp(this.clock());
    const actorId = getActorId(
      normalizedOptions.principal ?? this.principal,
    );
    const workItemId = generateWorkItemId({
      syncAttemptId: attempt.syncAttemptId,
      trackingId: attempt.trackingId,
      system: attempt.system,
      operation: attempt.operation,
    });
    const workItem = this.workItemRepository.create({
      workItemId,
      trackingId: attempt.trackingId,
      sourceRecordId: attempt.syncAttemptId,
      cardType: WORK_ITEM_TYPES.SYNC_FAILURE,
      state: WORK_ITEM_STATES.ACTION_NEEDED,
      priority: PRIORITIES.HIGH,
      assignedTo:
        normalizedOptions.assignedTo ??
        record?.assignment?.assigneeUserId ??
        null,
      assignedGroup:
        normalizedOptions.assignedGroup ??
        record?.assignment?.team ??
        'operations',
      partnerCode:
        normalizedOptions.partnerCode ??
        record?.partnerCode ??
        'UNSCOPED',
      title: `Resolve ${attempt.system} synchronization failure`,
      summary: attempt.message,
      metadata: {
        applicationId: record?.applicationId ?? null,
        applicantName: record ? getApplicantName(record) : null,
        company: record?.company ?? null,
        system: attempt.system,
        operation: attempt.operation,
        failedSyncAttemptId: attempt.syncAttemptId,
        correlationId: attempt.correlationId,
        validationCodes: ['SYNC_RETRY_REQUIRED'],
      },
      createdAt: timestamp,
      updatedAt: timestamp,
      completedAt: null,
      history: [
        {
          previousState: null,
          currentState: WORK_ITEM_STATES.ACTION_NEEDED,
          actorType: 'system',
          actorId,
          comment:
            'A synchronization failure created an operational work item.',
          timestamp,
        },
      ],
    });

    this.appendAuditEvent(
      SYNC_STATUS_ACTIONS.FAILURE_ROUTED,
      attempt,
      normalizedOptions.principal ?? this.principal,
      {
        workItemId: workItem.workItemId,
        system: attempt.system,
        operation: attempt.operation,
      },
    );

    return cloneValue(workItem);
  }

  findHorizonEventAttempt(eventId) {
    const normalizedEventId =
      normalizeIdentifierForLookup(eventId);

    return this.repository
      .list({
        system: INTEGRATION_SYSTEMS.HORIZON,
        sortOrder: 'desc',
      })
      .find(
        (attempt) =>
          normalizeIdentifierForLookup(
            attempt.payloadSummary?.eventId,
          ) === normalizedEventId,
      );
  }

  canAccessAttempt(attempt, principal, partnerContext) {
    if (
      principal === null ||
      principal === undefined ||
      this.enforceRecordScope === false
    ) {
      return true;
    }

    if (!attempt.trackingId) {
      return canPerformAction(
        principal,
        PERMISSIONS.VIEW_OPERATIONS,
      );
    }

    const record = findApplication(
      this.onboardingRepository,
      attempt.trackingId,
    );

    if (!record) {
      return canPerformAction(
        principal,
        PERMISSIONS.VIEW_OPERATIONS,
      );
    }

    return this.canAccessRecord(record, principal, partnerContext);
  }

  canAccessRecord(record, principal, partnerContext) {
    if (
      principal === null ||
      principal === undefined ||
      this.enforceRecordScope === false
    ) {
      return true;
    }

    return this.scopeGuard.canAccessRecord(
      record,
      principal,
      partnerContext,
    );
  }

  assertReadAuthorization(principal) {
    if (principal === null || principal === undefined) {
      if (this.requireAuthorization) {
        throw createSyncStatusError(
          SYNC_STATUS_SERVICE_ERROR_CODES.UNAUTHENTICATED,
          'An authenticated principal is required.',
          null,
        );
      }

      return;
    }

    if (!isAuthenticatedPrincipal(principal)) {
      throw createSyncStatusError(
        SYNC_STATUS_SERVICE_ERROR_CODES.UNAUTHENTICATED,
        'An authenticated principal is required.',
        null,
      );
    }

    const permitted =
      canPerformAction(principal, PERMISSIONS.VIEW_OPERATIONS) ||
      canPerformAction(principal, PERMISSIONS.VIEW_WORKBENCH) ||
      canPerformAction(principal, PERMISSIONS.VIEW_ONBOARDING);

    if (!permitted) {
      throw createSyncStatusError(
        SYNC_STATUS_SERVICE_ERROR_CODES.FORBIDDEN_ROLE,
        'The current principal cannot view synchronization status.',
        null,
      );
    }
  }

  assertMutationAuthorization(principal) {
    if (principal === null || principal === undefined) {
      if (this.requireAuthorization) {
        throw createSyncStatusError(
          SYNC_STATUS_SERVICE_ERROR_CODES.UNAUTHENTICATED,
          'An authenticated principal is required.',
          null,
        );
      }

      return;
    }

    if (!isAuthenticatedPrincipal(principal)) {
      throw createSyncStatusError(
        SYNC_STATUS_SERVICE_ERROR_CODES.UNAUTHENTICATED,
        'An authenticated principal is required.',
        null,
      );
    }

    const permitted =
      canPerformAction(principal, PERMISSIONS.RESOLVE_EXCEPTIONS) ||
      canPerformAction(principal, PERMISSIONS.MANAGE_WORK_ITEMS) ||
      canPerformAction(
        principal,
        PERMISSIONS.MANAGE_CONTRACT_CHANGES,
      );

    if (!permitted) {
      throw createSyncStatusError(
        SYNC_STATUS_SERVICE_ERROR_CODES.FORBIDDEN_ROLE,
        'The current principal cannot reconcile synchronization events.',
        null,
      );
    }
  }

  appendAuditEvent(
    action,
    attempt,
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
          trackingId: attempt?.trackingId ?? null,
          sourceRecordId: attempt?.syncAttemptId,
          syncAttemptId: attempt?.syncAttemptId,
          action,
          summary: action.toLowerCase().replace(/_/g, ' '),
          metadata: {
            syncAttemptId: attempt?.syncAttemptId ?? null,
            correlationId: attempt?.correlationId ?? null,
            material,
            ...cloneValue(metadata),
          },
          timestamp: toIsoTimestamp(this.clock()),
        },
        {
          actor: principal,
          source: AUDIT_SOURCES.ACTIVATION_SYNC,
        },
      );
    } catch (error) {
      if (this.strictAudit && material) {
        throw createSyncStatusError(
          SYNC_STATUS_SERVICE_ERROR_CODES.AUDIT_FAILED,
          'Unable to persist the synchronization audit event.',
          {
            action,
            syncAttemptId: attempt?.syncAttemptId ?? null,
          },
          error,
        );
      }

      return null;
    }
  }
}

/**
 * Creates a synchronization status service.
 *
 * @param {ConstructorParameters<typeof SyncStatusService>[0]} [options]
 * Service options.
 * @returns {SyncStatusService} Service instance.
 */
export function createSyncStatusService(options = {}) {
  return new SyncStatusService(options);
}

/**
 * Searches synchronization attempts with a newly created service.
 *
 * @param {object} request Search request.
 * @param {string | object} session Authenticated principal.
 * @param {ConstructorParameters<typeof SyncStatusService>[0]}
 * [serviceOptions] Service options.
 * @returns {object} Search response.
 */
export function searchSyncStatus(
  request,
  session,
  serviceOptions = {},
) {
  return createSyncStatusService(serviceOptions).search(
    request,
    session,
  );
}

/**
 * Reconciles a Horizon event with a newly created service.
 *
 * @param {object} request Horizon event.
 * @param {string | object} session Authenticated principal.
 * @param {ConstructorParameters<typeof SyncStatusService>[0]}
 * [serviceOptions] Service options.
 * @returns {object} Reconciliation result.
 */
export function reconcileHorizonEvent(
  request,
  session,
  serviceOptions = {},
) {
  return createSyncStatusService(
    serviceOptions,
  ).reconcileHorizonEvent(request, session);
}

export const SyncStatusAPI = SyncStatusService;
export const SynchronizationStatusService = SyncStatusService;
export const HorizonReconciliationService = SyncStatusService;
export const createSyncStatusAPI = createSyncStatusService;
export const createSynchronizationStatusService =
  createSyncStatusService;
export const createHorizonReconciliationService =
  createSyncStatusService;
export const searchSynchronizationStatus = searchSyncStatus;
export const reconcileHorizonJitEvent = reconcileHorizonEvent;

export default SyncStatusService;