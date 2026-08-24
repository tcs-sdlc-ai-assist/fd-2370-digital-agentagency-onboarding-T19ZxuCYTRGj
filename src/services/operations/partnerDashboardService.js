import { PartnerScopeGuard } from '../../auth/partnerScopeGuard.js';
import { JourneyDraftRepository } from '../../repositories/journeyDraftRepository.js';
import { toIsoTimestamp } from '../../utils/dates.js';
import {
  DEFAULT_JOURNEY_PARTNER_CODE,
  JourneyService,
} from '../onboarding/journeyService.js';

export const PARTNER_DASHBOARD_SERVICE_ERROR_CODES = Object.freeze({
  INVALID_OPTIONS: 'PARTNER_DASHBOARD_INVALID_OPTIONS',
  INVALID_REQUEST: 'PARTNER_DASHBOARD_INVALID_REQUEST',
  INVALID_DEPENDENCY: 'PARTNER_DASHBOARD_INVALID_DEPENDENCY',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  PARTNER_SCOPE_VIOLATION: 'PARTNER_SCOPE_VIOLATION',
  DRAFT_NOT_FOUND: 'PARTNER_DASHBOARD_DRAFT_NOT_FOUND',
  STALE_DRAFT: 'PARTNER_DASHBOARD_STALE_DRAFT',
  OPERATION_FAILED: 'PARTNER_DASHBOARD_OPERATION_FAILED',
  AUDIT_FAILED: 'PARTNER_DASHBOARD_AUDIT_FAILED',
});

export const DEFAULT_PARTNER_DASHBOARD_PAGE_SIZE = 25;
export const MAX_PARTNER_DASHBOARD_PAGE_SIZE = 100;

const RESUMABLE_STATUSES = new Set([
  'draft',
  'saved',
  'new',
  'application_started',
]);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertOptions(
  options,
  description = 'Partner dashboard options',
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

function createPartnerDashboardError(code, message, details, cause) {
  const error = new Error(message, {
    ...(cause === undefined ? {} : { cause }),
  });

  error.name = 'PartnerDashboardServiceError';
  error.code = code;
  error.details = details ?? null;
  error.recoverable = true;

  return error;
}

function assertDraftRepository(repository) {
  const requiredMethods = ['find', 'list'];

  if (
    !isObject(repository) ||
    requiredMethods.some(
      (method) => typeof repository[method] !== 'function',
    )
  ) {
    throw createPartnerDashboardError(
      PARTNER_DASHBOARD_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
      'The partner dashboard draft repository must provide find and list methods.',
      { requiredMethods },
    );
  }

  return repository;
}

function assertJourneyService(service) {
  const requiredMethods = ['initiateJourney', 'loadDraft'];

  if (
    !isObject(service) ||
    requiredMethods.some(
      (method) => typeof service[method] !== 'function',
    )
  ) {
    throw createPartnerDashboardError(
      PARTNER_DASHBOARD_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
      'The partner dashboard journey service must provide initiateJourney and loadDraft methods.',
      { requiredMethods },
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
    throw createPartnerDashboardError(
      PARTNER_DASHBOARD_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
      'The partner scope guard must provide canAccessRecord and filterRecords methods.',
      {
        requiredMethods: ['canAccessRecord', 'filterRecords'],
      },
    );
  }

  return scopeGuard;
}

function assertOptionalApplicationRepository(repository) {
  if (repository === undefined || repository === null) {
    return null;
  }

  if (
    !isObject(repository) ||
    (typeof repository.find !== 'function' &&
      typeof repository.findByTrackingId !== 'function' &&
      typeof repository.findByApplicationId !== 'function')
  ) {
    throw createPartnerDashboardError(
      PARTNER_DASHBOARD_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
      'The application repository must provide a supported find method.',
      {
        supportedMethods: [
          'find',
          'findByTrackingId',
          'findByApplicationId',
        ],
      },
    );
  }

  return repository;
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
    throw createPartnerDashboardError(
      PARTNER_DASHBOARD_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
      'The partner dashboard audit service must provide append or create.',
      null,
    );
  }

  return service;
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

function getPrincipalPartnerContext(principal) {
  const user = getPrincipalUser(principal);

  return (
    principal?.partnerContext ??
    user?.partnerContext ??
    null
  );
}

function resolvePartnerCode(
  request,
  principal,
  defaultPartnerCode,
  defaultPartnerContext,
) {
  const user = getPrincipalUser(principal);
  const partnerContext =
    request.partnerContext ??
    getPrincipalPartnerContext(principal) ??
    defaultPartnerContext;

  return normalizeIdentifier(
    request.partnerId ??
      request.partnerCode ??
      partnerContext?.partnerCode ??
      partnerContext?.partnerId ??
      user?.partnerCode ??
      user?.partnerId ??
      defaultPartnerCode,
    'Partner code',
  );
}

function normalizePagination(request) {
  const page = request.page ?? 1;
  const pageSize =
    request.pageSize ?? DEFAULT_PARTNER_DASHBOARD_PAGE_SIZE;

  if (!Number.isInteger(page) || page < 1) {
    throw new RangeError(
      'The partner dashboard page must be a positive integer.',
    );
  }

  if (
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > MAX_PARTNER_DASHBOARD_PAGE_SIZE
  ) {
    throw new RangeError(
      `The partner dashboard page size must be from 1 to ${MAX_PARTNER_DASHBOARD_PAGE_SIZE}.`,
    );
  }

  return { page, pageSize };
}

function normalizeListArguments(
  partnerOrRequest,
  session,
  options,
  defaultPartnerCode,
) {
  if (isObject(partnerOrRequest)) {
    return {
      request: partnerOrRequest,
      principal:
        session ??
        partnerOrRequest.principal ??
        partnerOrRequest.session,
    };
  }

  const normalizedOptions = assertOptions(
    options,
    'Partner dashboard list options',
  );

  return {
    request: {
      ...normalizedOptions,
      partnerId:
        partnerOrRequest ??
        normalizedOptions.partnerId ??
        normalizedOptions.partnerCode ??
        defaultPartnerCode,
    },
    principal:
      session ??
      normalizedOptions.principal ??
      normalizedOptions.session,
  };
}

function isDraftResumable(draft, referenceTime) {
  if (!isObject(draft)) {
    return false;
  }

  if (draft.completionState?.completed === true) {
    return false;
  }

  if (
    draft.expiresAt &&
    Date.parse(draft.expiresAt) < referenceTime
  ) {
    return false;
  }

  const status = normalizeIdentifierForLookup(draft.status);

  if (!status) {
    return true;
  }

  return (
    RESUMABLE_STATUSES.has(status) ||
    ![
      'application_submitted',
      'submitted',
      'completed',
      'contracted',
      'declined',
      'terminated',
      'withdrawn',
    ].includes(status)
  );
}

function getApplicationPayload(draft) {
  return draft.formState ?? draft.applicationPayload ?? draft.payload ?? {};
}

function getApplicant(draft) {
  const payload = getApplicationPayload(draft);

  return (
    payload.applicant ??
    payload.agent ??
    payload.organization ??
    draft.applicant ??
    draft.agent ??
    draft.organization ??
    {}
  );
}

function getApplicantName(draft) {
  const applicant = getApplicant(draft);

  return (
    normalizeOptionalIdentifier(applicant.legalName) ??
    normalizeOptionalIdentifier(applicant.name) ??
    normalizeOptionalIdentifier(
      [applicant.firstName, applicant.lastName]
        .filter(Boolean)
        .join(' '),
    ) ??
    'Applicant not yet provided'
  );
}

function getCompletionPercent(draft) {
  const value =
    draft.completionState?.percentComplete ??
    draft.progress?.percentComplete ??
    0;

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(value)));
}

function createResumeRoute(draft) {
  return (
    normalizeOptionalIdentifier(draft.resumeUrl) ??
    `/journeys/${encodeURIComponent(
      draft.journeyType ?? 'agent_contracting',
    )}/${encodeURIComponent(draft.trackingId)}/${encodeURIComponent(
      draft.currentStepId ?? 'start',
    )}`
  );
}

function projectDraft(draft) {
  return Object.freeze({
    draftId:
      draft.id ??
      draft.draftId ??
      draft.trackingId,
    trackingId: draft.trackingId,
    applicationId: draft.applicationId ?? null,
    partnerId: draft.partnerCode,
    partnerCode: draft.partnerCode,
    applicantName: getApplicantName(draft),
    journeyType: draft.journeyType,
    status: draft.status,
    currentStepId: draft.currentStepId,
    lastSavedAt:
      draft.lastSavedAt ??
      draft.updatedAt ??
      draft.createdAt,
    resumeRoute: createResumeRoute(draft),
    resumeUrl: createResumeRoute(draft),
    completionPercent: getCompletionPercent(draft),
    version: draft.version ?? 1,
    expiresAt: draft.expiresAt ?? null,
  });
}

function findApplication(repository, draft) {
  if (!repository) {
    return undefined;
  }

  if (
    draft.applicationId &&
    typeof repository.findByApplicationId === 'function'
  ) {
    const application = repository.findByApplicationId(
      draft.applicationId,
    );

    if (application) {
      return application;
    }
  }

  if (
    draft.trackingId &&
    typeof repository.findByTrackingId === 'function'
  ) {
    const application = repository.findByTrackingId(
      draft.trackingId,
    );

    if (application) {
      return application;
    }
  }

  if (typeof repository.find === 'function') {
    return repository.find(
      draft.applicationId ?? draft.trackingId,
    );
  }

  return undefined;
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
 * Provides partner-scoped dashboard, onboarding initiation, and journey
 * resume operations.
 */
export class PartnerDashboardService {
  /**
   * @param {{
   *   partnerCode?: string,
   *   principal?: string | object,
   *   partnerContext?: object,
   *   draftRepository?: object,
   *   applicationRepository?: object,
   *   journeyService?: object,
   *   partnerScopeGuard?: object,
   *   auditService?: object | false,
   *   storage?: Storage,
   *   namespace?: string,
   *   schemaVersion?: number,
   *   clock?: () => Date | string | number,
   *   onStorageError?: (error: object) => void,
   *   validateDraftReferences?: boolean,
   *   removeStaleDrafts?: boolean,
   *   strictAudit?: boolean
   * }} [options] Service options.
   */
  constructor(options = {}) {
    const normalizedOptions = assertOptions(options);

    if (
      normalizedOptions.clock !== undefined &&
      typeof normalizedOptions.clock !== 'function'
    ) {
      throw new TypeError(
        'The partner dashboard clock must be a function.',
      );
    }

    this.clock = normalizedOptions.clock ?? (() => new Date());
    this.principal = normalizedOptions.principal ?? null;
    this.partnerContext =
      normalizedOptions.partnerContext ?? null;
    this.partnerCode = normalizeIdentifier(
      normalizedOptions.partnerCode ??
        this.partnerContext?.partnerCode ??
        this.partnerContext?.partnerId ??
        DEFAULT_JOURNEY_PARTNER_CODE,
      'Partner code',
    );

    const repositoryOptions = createRepositoryOptions(
      normalizedOptions,
      this.clock,
    );

    this.draftRepository = assertDraftRepository(
      normalizedOptions.draftRepository ??
        new JourneyDraftRepository({
          partnerCode: this.partnerCode,
          ...repositoryOptions,
        }),
    );
    this.applicationRepository =
      assertOptionalApplicationRepository(
        normalizedOptions.applicationRepository,
      );
    this.scopeGuard = assertScopeGuard(
      normalizedOptions.partnerScopeGuard ??
        new PartnerScopeGuard({
          principal: this.principal,
          partnerContext: this.partnerContext,
        }),
    );
    this.journeyService = assertJourneyService(
      normalizedOptions.journeyService ??
        new JourneyService({
          partnerCode: this.partnerCode,
          draftRepository: this.draftRepository,
          applicationRepository:
            this.applicationRepository ?? undefined,
          clock: this.clock,
          auditService: false,
        }),
    );
    this.auditService =
      normalizedOptions.auditService === false
        ? null
        : assertOptionalAuditService(
            normalizedOptions.auditService,
          );
    this.validateDraftReferences =
      normalizedOptions.validateDraftReferences ?? false;
    this.removeStaleDrafts =
      normalizedOptions.removeStaleDrafts ?? false;
    this.strictAudit = normalizedOptions.strictAudit ?? false;
  }

  /**
   * Lists resumable drafts for the authenticated partner or agency.
   *
   * @param {string | number | object} [partnerOrRequest] Partner identifier
   * or request options.
   * @param {string | object} [session] Authenticated principal.
   * @param {object} [options] List options for the identifier-first form.
   * @returns {{
   *   partnerId: string,
   *   partnerCode: string,
   *   drafts: object[],
   *   data: object[],
   *   page: number,
   *   pageSize: number,
   *   total: number,
   *   totalPages: number,
   *   staleDraftsRemoved: number
   * }} Partner-scoped resumable drafts.
   */
  listResumableDrafts(
    partnerOrRequest = this.partnerCode,
    session,
    options = {},
  ) {
    const { request, principal: suppliedPrincipal } =
      normalizeListArguments(
        partnerOrRequest,
        session,
        options,
        this.partnerCode,
      );
    const principal = suppliedPrincipal ?? this.principal;

    this.assertAuthenticated(principal);

    const partnerContext =
      request.partnerContext ??
      getPrincipalPartnerContext(principal) ??
      this.partnerContext;
    const partnerCode = resolvePartnerCode(
      request,
      principal,
      this.partnerCode,
      this.partnerContext,
    );

    this.assertPartnerAccess(
      partnerCode,
      principal,
      partnerContext,
    );

    const { page, pageSize } = normalizePagination(request);
    const referenceTime = Date.parse(toIsoTimestamp(this.clock()));

    try {
      const repositoryQuery = {
        resumable: true,
        ...(request.journeyType === undefined
          ? {}
          : { journeyType: request.journeyType }),
        ...(request.status === undefined
          ? {}
          : { status: request.status }),
      };
      const drafts = this.draftRepository.list(repositoryQuery);

      if (!Array.isArray(drafts)) {
        throw createPartnerDashboardError(
          PARTNER_DASHBOARD_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
          'The journey draft repository returned an invalid collection.',
          null,
        );
      }

      let scopedDrafts = this.scopeGuard.filterRecords(
        drafts,
        principal,
        partnerContext,
      );

      scopedDrafts = scopedDrafts.filter(
        (draft) =>
          normalizeIdentifierForLookup(draft.partnerCode) ===
            normalizeIdentifierForLookup(partnerCode) &&
          isDraftResumable(draft, referenceTime),
      );

      let staleDraftsRemoved = 0;

      if (
        this.validateDraftReferences &&
        this.applicationRepository
      ) {
        scopedDrafts = scopedDrafts.filter((draft) => {
          const application = findApplication(
            this.applicationRepository,
            draft,
          );

          if (application) {
            return true;
          }

          if (
            this.removeStaleDrafts &&
            typeof this.draftRepository.remove === 'function'
          ) {
            try {
              if (this.draftRepository.remove(draft.trackingId)) {
                staleDraftsRemoved += 1;
              }
            } catch {
              return false;
            }
          }

          return false;
        });
      }

      scopedDrafts.sort(
        (left, right) =>
          Date.parse(
            right.lastSavedAt ??
              right.updatedAt ??
              right.createdAt,
          ) -
          Date.parse(
            left.lastSavedAt ??
              left.updatedAt ??
              left.createdAt,
          ),
      );

      const total = scopedDrafts.length;
      const start = (page - 1) * pageSize;
      const projectedDrafts = scopedDrafts
        .slice(start, start + pageSize)
        .map(projectDraft);
      const response = Object.freeze({
        partnerId: partnerCode,
        partnerCode,
        drafts: Object.freeze(projectedDrafts),
        data: Object.freeze(projectedDrafts),
        page,
        pageSize,
        total,
        totalPages:
          total === 0 ? 0 : Math.ceil(total / pageSize),
        staleDraftsRemoved,
      });

      this.appendAuditEvent(
        'PARTNER_RESUMABLE_DRAFTS_VIEWED',
        principal,
        {
          partnerCode,
          resultCount: total,
          page,
          pageSize,
          staleDraftsRemoved,
        },
      );

      return response;
    } catch (error) {
      if (
        error?.name === 'PartnerDashboardServiceError' ||
        error?.name === 'PartnerScopeGuardError' ||
        error instanceof TypeError ||
        error instanceof RangeError
      ) {
        throw error;
      }

      throw createPartnerDashboardError(
        PARTNER_DASHBOARD_SERVICE_ERROR_CODES.OPERATION_FAILED,
        'Unable to list partner resumable drafts.',
        { partnerCode },
        error,
      );
    }
  }

  /**
   * Alias for listResumableDrafts.
   *
   * @param {string | number | object} [partnerOrRequest] Partner or request.
   * @param {string | object} [session] Authenticated principal.
   * @param {object} [options] List options.
   * @returns {object} Resumable draft response.
   */
  listDrafts(partnerOrRequest, session, options = {}) {
    return this.listResumableDrafts(
      partnerOrRequest,
      session,
      options,
    );
  }

  /**
   * Initiates a partner-scoped onboarding journey.
   *
   * @param {object} request Journey initiation request.
   * @param {string | object} [session] Authenticated principal.
   * @returns {object} Journey initiation result.
   */
  initiateOnboarding(request, session) {
    const normalizedRequest = assertOptions(
      request,
      'Partner onboarding initiation request',
    );
    const principal =
      session ??
      normalizedRequest.principal ??
      normalizedRequest.session ??
      this.principal;

    this.assertAuthenticated(principal);

    const partnerContext =
      normalizedRequest.partnerContext ??
      getPrincipalPartnerContext(principal) ??
      this.partnerContext;
    const partnerCode = resolvePartnerCode(
      normalizedRequest,
      principal,
      this.partnerCode,
      this.partnerContext,
    );

    this.assertPartnerAccess(
      partnerCode,
      principal,
      partnerContext,
    );

    try {
      const result = this.journeyService.initiateJourney({
        ...cloneValue(normalizedRequest),
        partnerCode,
        requestedBy:
          normalizedRequest.requestedBy ?? principal,
        actor: normalizedRequest.actor ?? principal,
      });
      const draft = result.draft ?? result;

      this.assertDraftAccess(
        draft,
        principal,
        partnerContext,
        partnerCode,
      );
      this.appendAuditEvent(
        'PARTNER_ONBOARDING_INITIATED',
        principal,
        {
          partnerCode,
          trackingId: draft.trackingId ?? null,
          applicationId: draft.applicationId ?? null,
          journeyType: draft.journeyType ?? null,
        },
      );

      return cloneValue(result);
    } catch (error) {
      if (
        error?.name === 'PartnerDashboardServiceError' ||
        error?.name === 'PartnerScopeGuardError' ||
        error?.name === 'JourneyServiceError' ||
        error?.name === 'JourneyDraftRepositoryError' ||
        error instanceof TypeError ||
        error instanceof RangeError
      ) {
        throw error;
      }

      throw createPartnerDashboardError(
        PARTNER_DASHBOARD_SERVICE_ERROR_CODES.OPERATION_FAILED,
        'Unable to initiate the partner onboarding journey.',
        { partnerCode },
        error,
      );
    }
  }

  /**
   * Alias for initiateOnboarding.
   *
   * @param {object} request Journey initiation request.
   * @param {string | object} [session] Authenticated principal.
   * @returns {object} Journey initiation result.
   */
  initiateJourney(request, session) {
    return this.initiateOnboarding(request, session);
  }

  /**
   * Loads a partner-scoped journey resume view.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @param {string | object} [session] Authenticated principal.
   * @param {object} [options] Resume options.
   * @returns {object} Journey resume view.
   */
  resumeJourney(trackingId, session, options = {}) {
    const normalizedTrackingId = normalizeIdentifier(
      trackingId,
      'Tracking identifier',
    );
    const normalizedOptions = assertOptions(
      options,
      'Partner journey resume options',
    );
    const principal =
      session ??
      normalizedOptions.principal ??
      normalizedOptions.session ??
      this.principal;

    this.assertAuthenticated(principal);

    const partnerContext =
      normalizedOptions.partnerContext ??
      getPrincipalPartnerContext(principal) ??
      this.partnerContext;
    const partnerCode = resolvePartnerCode(
      normalizedOptions,
      principal,
      this.partnerCode,
      this.partnerContext,
    );

    this.assertPartnerAccess(
      partnerCode,
      principal,
      partnerContext,
    );

    const draft = this.draftRepository.find(
      normalizedTrackingId,
    );

    if (!draft) {
      throw createPartnerDashboardError(
        PARTNER_DASHBOARD_SERVICE_ERROR_CODES.DRAFT_NOT_FOUND,
        `Partner journey draft not found: ${normalizedTrackingId}`,
        { trackingId: normalizedTrackingId },
      );
    }

    this.assertDraftAccess(
      draft,
      principal,
      partnerContext,
      partnerCode,
    );

    if (
      !isDraftResumable(
        draft,
        Date.parse(toIsoTimestamp(this.clock())),
      )
    ) {
      throw createPartnerDashboardError(
        PARTNER_DASHBOARD_SERVICE_ERROR_CODES.STALE_DRAFT,
        'The selected journey draft is no longer resumable.',
        {
          trackingId: normalizedTrackingId,
          status: draft.status ?? null,
          expiresAt: draft.expiresAt ?? null,
        },
      );
    }

    try {
      const result = this.journeyService.loadDraft(
        normalizedTrackingId,
        {
          ...cloneValue(normalizedOptions),
          partnerCode,
        },
      );

      this.appendAuditEvent(
        'PARTNER_ONBOARDING_RESUMED',
        principal,
        {
          partnerCode,
          trackingId: normalizedTrackingId,
          applicationId: draft.applicationId ?? null,
          currentStepId: draft.currentStepId ?? null,
        },
      );

      return cloneValue(result);
    } catch (error) {
      if (
        error?.name === 'PartnerDashboardServiceError' ||
        error?.name === 'PartnerScopeGuardError' ||
        error?.name === 'JourneyServiceError' ||
        error?.name === 'JourneyDraftRepositoryError' ||
        error instanceof TypeError ||
        error instanceof RangeError
      ) {
        throw error;
      }

      throw createPartnerDashboardError(
        PARTNER_DASHBOARD_SERVICE_ERROR_CODES.OPERATION_FAILED,
        'Unable to resume the partner onboarding journey.',
        {
          trackingId: normalizedTrackingId,
          partnerCode,
        },
        error,
      );
    }
  }

  /**
   * Alias for resumeJourney.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @param {string | object} [session] Authenticated principal.
   * @param {object} [options] Resume options.
   * @returns {object} Journey resume view.
   */
  resume(trackingId, session, options = {}) {
    return this.resumeJourney(trackingId, session, options);
  }

  /**
   * Returns partner-scoped resume metadata.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @param {string | object} [session] Authenticated principal.
   * @param {object} [options] Resume options.
   * @returns {object} Resume context.
   */
  getResumeContext(trackingId, session, options = {}) {
    const view = this.resumeJourney(
      trackingId,
      session,
      options,
    );

    return cloneValue(
      view.resumeContext ??
        projectDraft(view.draft ?? view),
    );
  }

  /**
   * Alias for getResumeContext.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @param {string | object} [session] Authenticated principal.
   * @param {object} [options] Resume options.
   * @returns {object} Resume context.
   */
  getResumeContextByTrackingId(
    trackingId,
    session,
    options = {},
  ) {
    return this.getResumeContext(
      trackingId,
      session,
      options,
    );
  }

  assertAuthenticated(principal) {
    if (!isAuthenticatedPrincipal(principal)) {
      throw createPartnerDashboardError(
        PARTNER_DASHBOARD_SERVICE_ERROR_CODES.UNAUTHENTICATED,
        'An authenticated principal is required.',
        null,
      );
    }
  }

  assertPartnerAccess(partnerCode, principal, partnerContext) {
    const accessible =
      typeof this.scopeGuard.canAccessPartner === 'function'
        ? this.scopeGuard.canAccessPartner(
            partnerCode,
            principal,
            partnerContext,
          )
        : this.scopeGuard.canAccessRecord(
            { partnerCode },
            principal,
            partnerContext,
          );

    if (!accessible) {
      throw createPartnerDashboardError(
        PARTNER_DASHBOARD_SERVICE_ERROR_CODES
          .PARTNER_SCOPE_VIOLATION,
        'The requested partner is outside the current partner scope.',
        {
          requestedPartnerId: partnerCode,
          sessionPartnerId:
            partnerContext?.partnerCode ??
            partnerContext?.partnerId ??
            null,
        },
      );
    }
  }

  assertDraftAccess(
    draft,
    principal,
    partnerContext,
    partnerCode,
  ) {
    if (
      !isObject(draft) ||
      normalizeIdentifierForLookup(draft.partnerCode) !==
        normalizeIdentifierForLookup(partnerCode) ||
      !this.scopeGuard.canAccessRecord(
        draft,
        principal,
        partnerContext,
      )
    ) {
      throw createPartnerDashboardError(
        PARTNER_DASHBOARD_SERVICE_ERROR_CODES
          .PARTNER_SCOPE_VIOLATION,
        'The requested draft is outside the current partner scope.',
        {
          trackingId: draft?.trackingId ?? null,
          requestedPartnerId: partnerCode,
          draftPartnerId: draft?.partnerCode ?? null,
        },
      );
    }
  }

  appendAuditEvent(action, principal, metadata) {
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
          trackingId: metadata.trackingId ?? null,
          applicationId: metadata.applicationId ?? undefined,
          sourceRecordId:
            metadata.applicationId ??
            metadata.trackingId ??
            undefined,
          action,
          summary: action.toLowerCase().replace(/_/g, ' '),
          metadata: cloneValue(metadata),
          timestamp: toIsoTimestamp(this.clock()),
        },
        {
          actor: principal,
          source: 'partner_dashboard',
        },
      );
    } catch (error) {
      if (this.strictAudit) {
        throw createPartnerDashboardError(
          PARTNER_DASHBOARD_SERVICE_ERROR_CODES.AUDIT_FAILED,
          'Unable to persist the partner dashboard audit event.',
          {
            action,
            trackingId: metadata.trackingId ?? null,
          },
          error,
        );
      }

      return null;
    }
  }
}

/**
 * Creates a partner dashboard service.
 *
 * @param {ConstructorParameters<typeof PartnerDashboardService>[0]}
 * [options] Service options.
 * @returns {PartnerDashboardService} Partner dashboard service.
 */
export function createPartnerDashboardService(options = {}) {
  return new PartnerDashboardService(options);
}

/**
 * Lists resumable partner drafts using a newly created service.
 *
 * @param {string | number | object} partnerOrRequest Partner or request.
 * @param {string | object} session Authenticated principal.
 * @param {object} [listOptions] List options.
 * @param {ConstructorParameters<typeof PartnerDashboardService>[0]}
 * [serviceOptions] Service options.
 * @returns {object} Resumable draft response.
 */
export function listPartnerResumableDrafts(
  partnerOrRequest,
  session,
  listOptions = {},
  serviceOptions = {},
) {
  return createPartnerDashboardService(
    serviceOptions,
  ).listResumableDrafts(
    partnerOrRequest,
    session,
    listOptions,
  );
}

export const PartnerDashboardAPI = PartnerDashboardService;
export const PartnerResumeService = PartnerDashboardService;
export const createPartnerDashboardAPI =
  createPartnerDashboardService;
export const createPartnerResumeService =
  createPartnerDashboardService;
export const listResumableDrafts =
  listPartnerResumableDrafts;

export default PartnerDashboardService;