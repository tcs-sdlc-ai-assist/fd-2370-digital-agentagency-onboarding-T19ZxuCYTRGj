import { AUDIT_ACTOR_TYPES, AUDIT_SOURCES } from '../../constants/domain.js';
import { PartnerScopeGuard } from '../../auth/partnerScopeGuard.js';
import { getSeeds } from '../../persistence/seedLoader.js';
import { NotificationRepository } from '../../repositories/notificationRepository.js';
import { OnboardingRecordRepository } from '../../repositories/onboardingRecordRepository.js';
import { SyncAttemptRepository } from '../../repositories/syncAttemptRepository.js';
import { toIsoTimestamp } from '../../utils/dates.js';
import { generateCorrelationId } from '../../utils/ids.js';
import { LifecycleProjectionService } from './lifecycleProjectionService.js';

export const PARTNER_STATUS_LOOKUP_TYPES = Object.freeze({
  TRACKING_ID: 'tracking_id',
  APPLICATION_NUMBER: 'application_number',
  NPN: 'npn',
  AGENT_CODE: 'agent_code',
  RECENT_DAYS: 'recent_days',
});

export const PARTNER_STATUS_SERVICE_ERROR_CODES = Object.freeze({
  INVALID_OPTIONS: 'PARTNER_STATUS_INVALID_OPTIONS',
  INVALID_REQUEST: 'PARTNER_STATUS_INVALID_REQUEST',
  INVALID_LOOKUP_TYPE: 'PARTNER_STATUS_INVALID_LOOKUP_TYPE',
  INVALID_PAGINATION: 'PARTNER_STATUS_INVALID_PAGINATION',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  PARTNER_SCOPE_VIOLATION: 'PARTNER_SCOPE_VIOLATION',
  INVALID_DEPENDENCY: 'PARTNER_STATUS_INVALID_DEPENDENCY',
  QUERY_FAILED: 'PARTNER_STATUS_QUERY_FAILED',
});

export const DEFAULT_PARTNER_STATUS_RECENT_DAYS = 30;
export const DEFAULT_PARTNER_STATUS_PAGE_SIZE = 25;
export const MAX_PARTNER_STATUS_PAGE_SIZE = 100;
export const MAX_PARTNER_STATUS_RECENT_DAYS = 365;
export const DEFAULT_PARTNER_STATUS_CACHE_TTL_MS = 5 * 60 * 1000;
export const DEFAULT_PARTNER_STATUS_CACHE_SIZE = 100;

const LOOKUP_TYPE_ALIASES = Object.freeze({
  tracking: PARTNER_STATUS_LOOKUP_TYPES.TRACKING_ID,
  trackingid: PARTNER_STATUS_LOOKUP_TYPES.TRACKING_ID,
  tracking_id: PARTNER_STATUS_LOOKUP_TYPES.TRACKING_ID,
  application: PARTNER_STATUS_LOOKUP_TYPES.APPLICATION_NUMBER,
  applicationid: PARTNER_STATUS_LOOKUP_TYPES.APPLICATION_NUMBER,
  application_id: PARTNER_STATUS_LOOKUP_TYPES.APPLICATION_NUMBER,
  applicationnumber: PARTNER_STATUS_LOOKUP_TYPES.APPLICATION_NUMBER,
  application_number: PARTNER_STATUS_LOOKUP_TYPES.APPLICATION_NUMBER,
  npn: PARTNER_STATUS_LOOKUP_TYPES.NPN,
  agentcode: PARTNER_STATUS_LOOKUP_TYPES.AGENT_CODE,
  agent_code: PARTNER_STATUS_LOOKUP_TYPES.AGENT_CODE,
  recent: PARTNER_STATUS_LOOKUP_TYPES.RECENT_DAYS,
  recentdays: PARTNER_STATUS_LOOKUP_TYPES.RECENT_DAYS,
  recent_days: PARTNER_STATUS_LOOKUP_TYPES.RECENT_DAYS,
});

const DEFAULT_PROJECTION_FIELDS = Object.freeze([
  'trackingId',
  'applicationNumber',
  'applicationId',
  'partnerId',
  'partnerCode',
  'agent',
  'contract',
  'hierarchy',
  'backgroundCheck',
  'appointment',
  'lifecycle',
  'syncStatuses',
  'notificationFlags',
  'status',
  'workflowStage',
  'priority',
  'createdAt',
  'updatedAt',
]);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertOptions(options, description = 'Partner status options') {
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

function createPartnerStatusError(code, message, details, cause) {
  const error = new Error(message, {
    ...(cause === undefined ? {} : { cause }),
  });

  error.name = 'PartnerStatusServiceError';
  error.code = code;
  error.details = details ?? null;
  error.recoverable = true;

  return error;
}

function assertRepository(repository) {
  if (
    !isObject(repository) ||
    typeof repository.list !== 'function'
  ) {
    throw createPartnerStatusError(
      PARTNER_STATUS_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
      'The onboarding repository must provide a list method.',
      { requiredMethods: ['list'] },
    );
  }

  return repository;
}

function assertScopeGuard(scopeGuard) {
  if (
    !isObject(scopeGuard) ||
    typeof scopeGuard.filterRecords !== 'function' ||
    typeof scopeGuard.canAccessRecord !== 'function'
  ) {
    throw createPartnerStatusError(
      PARTNER_STATUS_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
      'The partner scope guard must provide filterRecords and canAccessRecord.',
      {
        requiredMethods: ['filterRecords', 'canAccessRecord'],
      },
    );
  }

  return scopeGuard;
}

function assertOptionalService(service, methods, description) {
  if (service === undefined || service === null || service === false) {
    return null;
  }

  if (
    !isObject(service) ||
    methods.every((method) => typeof service[method] !== 'function')
  ) {
    throw createPartnerStatusError(
      PARTNER_STATUS_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
      `${description} does not provide a supported method.`,
      { supportedMethods: methods },
    );
  }

  return service;
}

function normalizePositiveInteger(value, fallback, maximum, description) {
  const candidate = value ?? fallback;

  if (
    !Number.isInteger(candidate) ||
    candidate < 1 ||
    candidate > maximum
  ) {
    throw createPartnerStatusError(
      PARTNER_STATUS_SERVICE_ERROR_CODES.INVALID_PAGINATION,
      `${description} must be an integer from 1 to ${maximum}.`,
      { value: candidate, maximum },
    );
  }

  return candidate;
}

function normalizeLookupType(value) {
  const token = normalizeToken(value);

  if (!token) {
    throw createPartnerStatusError(
      PARTNER_STATUS_SERVICE_ERROR_CODES.INVALID_LOOKUP_TYPE,
      'A partner status lookup type is required.',
      {
        supportedLookupTypes: Object.values(
          PARTNER_STATUS_LOOKUP_TYPES,
        ),
      },
    );
  }

  const lookupType = LOOKUP_TYPE_ALIASES[token];

  if (!lookupType) {
    throw createPartnerStatusError(
      PARTNER_STATUS_SERVICE_ERROR_CODES.INVALID_LOOKUP_TYPE,
      `Unsupported partner status lookup type: ${value}.`,
      {
        lookupType: String(value),
        supportedLookupTypes: Object.values(
          PARTNER_STATUS_LOOKUP_TYPES,
        ),
      },
    );
  }

  return lookupType;
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

function resolveRequestedPartner(request, partnerContext, principal) {
  const user = getPrincipalUser(principal);

  return normalizeOptionalIdentifier(
    request.partnerId ??
      request.partnerCode ??
      partnerContext?.partnerCode ??
      partnerContext?.partnerId ??
      user?.partnerCode ??
      user?.partnerId,
  );
}

function getRecordPartnerCode(record) {
  return normalizeOptionalIdentifier(
    record.partnerCode ??
      record.partnerId ??
      record.organizationCode ??
      record.organizationId ??
      record.gaCode,
  );
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

function getRecordTimestamp(record) {
  return (
    normalizeOptionalIdentifier(
      record.updatedAt ??
        record.completedAt ??
        record.submittedAt ??
        record.createdAt,
    ) ?? null
  );
}

function getTimestampValue(record) {
  const timestamp = getRecordTimestamp(record);
  const value = timestamp === null ? Number.NaN : Date.parse(timestamp);

  return Number.isNaN(value) ? Number.NEGATIVE_INFINITY : value;
}

function normalizeFieldList(fields) {
  if (fields === undefined) {
    return DEFAULT_PROJECTION_FIELDS;
  }

  if (!Array.isArray(fields)) {
    throw new TypeError('Partner status projection fields must be an array.');
  }

  return [
    ...new Set(
      fields.map((field) =>
        normalizeIdentifier(field, 'Partner status projection field'),
      ),
    ),
  ];
}

function getValueAtPath(source, path) {
  return path.split('.').reduce((value, segment) => {
    if (value === null || value === undefined) {
      return undefined;
    }

    return value[segment];
  }, source);
}

function setValueAtPath(target, path, value) {
  const segments = path.split('.');
  let current = target;

  segments.forEach((segment, index) => {
    if (index === segments.length - 1) {
      current[segment] = cloneValue(value);
      return;
    }

    if (!isObject(current[segment])) {
      current[segment] = {};
    }

    current = current[segment];
  });
}

function projectFields(record, fields) {
  const projected = {};

  fields.forEach((field) => {
    const value = getValueAtPath(record, field);

    if (value !== undefined) {
      setValueAtPath(projected, field, value);
    }
  });

  return projected;
}

function getApplicantName(applicant) {
  if (!isObject(applicant)) {
    return null;
  }

  return (
    normalizeOptionalIdentifier(applicant.legalName) ??
    normalizeOptionalIdentifier(
      [applicant.firstName, applicant.lastName]
        .filter(Boolean)
        .join(' '),
    ) ??
    null
  );
}

function createFallbackLifecycle(record) {
  return {
    trackingId: record.trackingId,
    applicationId: record.applicationId ?? null,
    currentStatus:
      record.lifecycleStatus ??
      record.currentStatus ??
      record.workflowStage ??
      record.status ??
      'New',
    currentWorkflowStage: record.workflowStage ?? null,
    updatedAt: getRecordTimestamp(record),
    milestones: [],
    completedStatuses: [],
    remainingStatuses: [],
  };
}

function normalizeSearchRequest(request) {
  const normalizedRequest = assertOptions(
    request,
    'Partner status search request',
  );
  const lookupType = normalizeLookupType(
    normalizedRequest.lookupType ??
      PARTNER_STATUS_LOOKUP_TYPES.RECENT_DAYS,
  );
  const page = normalizePositiveInteger(
    normalizedRequest.page,
    1,
    Number.MAX_SAFE_INTEGER,
    'Partner status page',
  );
  const pageSize = normalizePositiveInteger(
    normalizedRequest.pageSize,
    DEFAULT_PARTNER_STATUS_PAGE_SIZE,
    MAX_PARTNER_STATUS_PAGE_SIZE,
    'Partner status page size',
  );
  const recentDays =
    lookupType === PARTNER_STATUS_LOOKUP_TYPES.RECENT_DAYS
      ? normalizePositiveInteger(
          normalizedRequest.recentDays,
          DEFAULT_PARTNER_STATUS_RECENT_DAYS,
          MAX_PARTNER_STATUS_RECENT_DAYS,
          'Partner status recentDays',
        )
      : normalizedRequest.recentDays === undefined
        ? DEFAULT_PARTNER_STATUS_RECENT_DAYS
        : normalizePositiveInteger(
            normalizedRequest.recentDays,
            DEFAULT_PARTNER_STATUS_RECENT_DAYS,
            MAX_PARTNER_STATUS_RECENT_DAYS,
            'Partner status recentDays',
          );
  const lookupValue = normalizeOptionalIdentifier(
    normalizedRequest.lookupValue,
  );

  if (
    lookupType !== PARTNER_STATUS_LOOKUP_TYPES.RECENT_DAYS &&
    lookupValue === undefined
  ) {
    throw createPartnerStatusError(
      PARTNER_STATUS_SERVICE_ERROR_CODES.INVALID_REQUEST,
      'A lookup value is required for direct partner status searches.',
      { lookupType },
    );
  }

  return {
    ...normalizedRequest,
    lookupType,
    lookupValue,
    recentDays,
    includeHistory: normalizedRequest.includeHistory === true,
    page,
    pageSize,
    fields: normalizeFieldList(normalizedRequest.fields),
  };
}

function principalCacheKey(principal, partnerContext) {
  if (typeof principal === 'string') {
    return `role:${principal}`;
  }

  const user = getPrincipalUser(principal);

  return [
    principal?.role ?? user?.role ?? 'unknown',
    user?.id ?? principal?.id ?? 'unknown',
    partnerContext?.partnerCode ??
      partnerContext?.partnerId ??
      'unscoped',
    partnerContext?.scopeType ?? 'default',
  ].join(':');
}

function createCacheKey(request, principal, partnerContext, partnerCode) {
  return JSON.stringify({
    principal: principalCacheKey(principal, partnerContext),
    partnerCode: partnerCode ?? null,
    lookupType: request.lookupType,
    lookupValue:
      normalizeIdentifierForLookup(request.lookupValue) ?? null,
    recentDays: request.recentDays,
    includeHistory: request.includeHistory,
    page: request.page,
    pageSize: request.pageSize,
    fields: request.fields,
  });
}

function createRepositoryOptions(options) {
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
    ...(options.clock === undefined ? {} : { clock: options.clock }),
    ...(options.onStorageError === undefined
      ? {}
      : { onStorageError: options.onStorageError }),
  };
}

function actorTypeForPrincipal(principal) {
  const user = getPrincipalUser(principal);
  const role = principal?.role ?? user?.role;

  return ['partner', 'agency'].includes(role)
    ? AUDIT_ACTOR_TYPES.PARTNER_USER
    : AUDIT_ACTOR_TYPES.INTERNAL_USER;
}

export class PartnerStatusService {
  /**
   * @param {{
   *   repository?: object,
   *   onboardingRepository?: object,
   *   partnerScopeGuard?: object,
   *   lifecycleService?: object,
   *   syncStatusService?: object,
   *   syncAttemptRepository?: object,
   *   notificationService?: object,
   *   notificationRepository?: object,
   *   auditService?: object | false,
   *   principal?: string | object,
   *   partnerContext?: object,
   *   generatedCodes?: object[],
   *   cacheTtlMs?: number,
   *   cacheSize?: number,
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
      throw new TypeError('The partner status clock must be a function.');
    }

    if (
      normalizedOptions.cacheTtlMs !== undefined &&
      (!Number.isInteger(normalizedOptions.cacheTtlMs) ||
        normalizedOptions.cacheTtlMs < 0)
    ) {
      throw new RangeError(
        'The partner status cache TTL must be a nonnegative integer.',
      );
    }

    if (
      normalizedOptions.cacheSize !== undefined &&
      (!Number.isInteger(normalizedOptions.cacheSize) ||
        normalizedOptions.cacheSize < 1)
    ) {
      throw new RangeError(
        'The partner status cache size must be a positive integer.',
      );
    }

    this.clock = normalizedOptions.clock ?? (() => new Date());
    const repositoryOptions = createRepositoryOptions({
      ...normalizedOptions,
      clock: this.clock,
    });

    this.repository = assertRepository(
      normalizedOptions.repository ??
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
    this.lifecycleService = assertOptionalService(
      normalizedOptions.lifecycleService ??
        new LifecycleProjectionService({
          ...repositoryOptions,
          onboardingRepository: this.repository,
        }),
      ['getLifecycle', 'get'],
      'The lifecycle projection service',
    );
    this.syncStatusService = assertOptionalService(
      normalizedOptions.syncStatusService ??
        normalizedOptions.syncAttemptRepository ??
        new SyncAttemptRepository(repositoryOptions),
      ['getStatusBadges', 'getLatestStatusBySystem'],
      'The synchronization status service',
    );
    this.notificationService = assertOptionalService(
      normalizedOptions.notificationService ??
        normalizedOptions.notificationRepository ??
        new NotificationRepository(repositoryOptions),
      ['getVisibilityFlags'],
      'The notification visibility service',
    );
    this.auditService = assertOptionalService(
      normalizedOptions.auditService,
      ['append', 'create'],
      'The audit service',
    );
    this.principal = normalizedOptions.principal ?? null;
    this.partnerContext = normalizedOptions.partnerContext ?? null;
    this.generatedCodeIndex = createGeneratedCodeIndex(
      normalizedOptions.generatedCodes ?? getSeeds().generatedCodes,
    );
    this.cacheTtlMs =
      normalizedOptions.cacheTtlMs ??
      DEFAULT_PARTNER_STATUS_CACHE_TTL_MS;
    this.cacheSize =
      normalizedOptions.cacheSize ??
      DEFAULT_PARTNER_STATUS_CACHE_SIZE;
    this.cache = new Map();
  }

  /**
   * Searches partner-visible onboarding statuses.
   *
   * @param {object} request Search request.
   * @param {string | object} [session] Authenticated principal.
   * @returns {object} Paginated partner status response.
   */
  search(request, session) {
    const normalizedRequest = normalizeSearchRequest(request);
    const principal = resolvePrincipal(
      normalizedRequest,
      session,
      this.principal,
    );

    if (!isAuthenticatedPrincipal(principal)) {
      throw createPartnerStatusError(
        PARTNER_STATUS_SERVICE_ERROR_CODES.UNAUTHENTICATED,
        'An authenticated principal is required.',
        null,
      );
    }

    const partnerContext = resolvePartnerContext(
      normalizedRequest,
      principal,
      this.partnerContext,
    );
    const requestedPartner = resolveRequestedPartner(
      normalizedRequest,
      partnerContext,
      principal,
    );

    this.assertPartnerAccess(
      requestedPartner,
      principal,
      partnerContext,
    );

    const cacheKey = createCacheKey(
      normalizedRequest,
      principal,
      partnerContext,
      requestedPartner,
    );
    const cachedResponse = this.readCache(cacheKey);

    if (cachedResponse) {
      const response = this.withRequestMetadata(
        cachedResponse,
        normalizedRequest,
        true,
      );

      this.appendSearchAudit(
        normalizedRequest,
        principal,
        requestedPartner,
        response.total,
        response.requestId,
      );

      return response;
    }

    try {
      const records = this.repository.list({
        includeCompleted: true,
      });

      if (!Array.isArray(records)) {
        throw createPartnerStatusError(
          PARTNER_STATUS_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
          'The onboarding repository returned an invalid collection.',
          null,
        );
      }

      let scopedRecords = this.scopeGuard.filterRecords(
        records,
        principal,
        partnerContext,
      );

      if (requestedPartner) {
        const normalizedPartner =
          normalizeIdentifierForLookup(requestedPartner);

        scopedRecords = scopedRecords.filter(
          (record) =>
            normalizeIdentifierForLookup(
              getRecordPartnerCode(record),
            ) === normalizedPartner,
        );
      }

      const matchedRecords = this.applyLookup(
        scopedRecords,
        normalizedRequest,
      ).sort(
        (left, right) =>
          getTimestampValue(right) - getTimestampValue(left),
      );
      const total = matchedRecords.length;
      const start = (normalizedRequest.page - 1) *
        normalizedRequest.pageSize;
      const pageRecords = matchedRecords.slice(
        start,
        start + normalizedRequest.pageSize,
      );
      const data = pageRecords.map((record) =>
        this.projectRecord(record, normalizedRequest),
      );
      const responseData = {
        data,
        page: normalizedRequest.page,
        pageSize: normalizedRequest.pageSize,
        total,
        totalPages:
          total === 0
            ? 0
            : Math.ceil(total / normalizedRequest.pageSize),
        errors: [],
      };

      this.writeCache(cacheKey, responseData);

      const response = this.withRequestMetadata(
        responseData,
        normalizedRequest,
        false,
      );

      this.appendSearchAudit(
        normalizedRequest,
        principal,
        requestedPartner,
        total,
        response.requestId,
      );

      return response;
    } catch (error) {
      if (
        error?.name === 'PartnerStatusServiceError' ||
        error?.name === 'PartnerScopeGuardError' ||
        error instanceof TypeError ||
        error instanceof RangeError
      ) {
        throw error;
      }

      throw createPartnerStatusError(
        PARTNER_STATUS_SERVICE_ERROR_CODES.QUERY_FAILED,
        'Unable to search partner onboarding statuses.',
        {
          lookupType: normalizedRequest.lookupType,
          partnerId: requestedPartner ?? null,
        },
        error,
      );
    }
  }

  /**
   * Alias for search.
   *
   * @param {object} request Search request.
   * @param {string | object} [session] Authenticated principal.
   * @returns {object} Partner status response.
   */
  searchStatus(request, session) {
    return this.search(request, session);
  }

  /**
   * Returns a partner-visible status by tracking identifier.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @param {string | object} [session] Authenticated principal.
   * @param {object} [options] Projection options.
   * @returns {object | null} Matching status record.
   */
  getByTrackingId(trackingId, session, options = {}) {
    const normalizedTrackingId = normalizeIdentifier(
      trackingId,
      'Tracking identifier',
    );
    const normalizedOptions = assertOptions(
      options,
      'Partner status detail options',
    );
    const response = this.search(
      {
        ...normalizedOptions,
        lookupType: PARTNER_STATUS_LOOKUP_TYPES.TRACKING_ID,
        lookupValue: normalizedTrackingId,
        includeHistory:
          normalizedOptions.includeHistory !== false,
        page: 1,
        pageSize: 1,
      },
      session,
    );

    return response.data[0] ?? null;
  }

  /**
   * Alias for getByTrackingId.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @param {string | object} [session] Authenticated principal.
   * @param {object} [options] Projection options.
   * @returns {object | null} Matching status record.
   */
  get(trackingId, session, options = {}) {
    return this.getByTrackingId(trackingId, session, options);
  }

  /**
   * Clears all cached partner status responses.
   *
   * @returns {number} Number of removed cache entries.
   */
  clearCache() {
    const size = this.cache.size;

    this.cache.clear();
    return size;
  }

  /**
   * Invalidates cache entries, optionally limiting invalidation to a partner.
   *
   * @param {string | number} [partnerCode] Partner code.
   * @returns {number} Number of removed cache entries.
   */
  invalidateCache(partnerCode) {
    if (partnerCode === undefined || partnerCode === null) {
      return this.clearCache();
    }

    const normalizedPartner =
      normalizeIdentifierForLookup(partnerCode);
    let removed = 0;

    [...this.cache.entries()].forEach(([key, entry]) => {
      if (
        normalizeIdentifierForLookup(entry.partnerCode) ===
        normalizedPartner
      ) {
        this.cache.delete(key);
        removed += 1;
      }
    });

    return removed;
  }

  assertPartnerAccess(partnerCode, principal, partnerContext) {
    if (!partnerCode) {
      return;
    }

    if (
      typeof this.scopeGuard.canAccessPartner === 'function' &&
      !this.scopeGuard.canAccessPartner(
        partnerCode,
        principal,
        partnerContext,
      )
    ) {
      throw createPartnerStatusError(
        PARTNER_STATUS_SERVICE_ERROR_CODES.PARTNER_SCOPE_VIOLATION,
        'Requested records are outside the current partner scope.',
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

  applyLookup(records, request) {
    const normalizedLookupValue =
      normalizeIdentifierForLookup(request.lookupValue);

    switch (request.lookupType) {
      case PARTNER_STATUS_LOOKUP_TYPES.TRACKING_ID:
        return records.filter(
          (record) =>
            normalizeIdentifierForLookup(record.trackingId) ===
            normalizedLookupValue,
        );

      case PARTNER_STATUS_LOOKUP_TYPES.APPLICATION_NUMBER:
        return records.filter(
          (record) =>
            [
              record.applicationId,
              record.applicationNumber,
              record.id,
            ].some(
              (identifier) =>
                normalizeIdentifierForLookup(identifier) ===
                normalizedLookupValue,
            ),
        );

      case PARTNER_STATUS_LOOKUP_TYPES.NPN:
        return records.filter(
          (record) =>
            normalizeIdentifierForLookup(getRecordNpn(record)) ===
            normalizedLookupValue,
        );

      case PARTNER_STATUS_LOOKUP_TYPES.AGENT_CODE:
        return records.filter(
          (record) =>
            normalizeIdentifierForLookup(
              getRecordAgentCode(
                record,
                this.generatedCodeIndex,
              ),
            ) === normalizedLookupValue,
        );

      case PARTNER_STATUS_LOOKUP_TYPES.RECENT_DAYS: {
        const referenceTime = Date.parse(toIsoTimestamp(this.clock()));
        const cutoff =
          referenceTime -
          request.recentDays * 24 * 60 * 60 * 1000;

        return records.filter((record) => {
          const timestamp = getTimestampValue(record);

          return timestamp >= cutoff && timestamp <= referenceTime;
        });
      }

      default:
        return [];
    }
  }

  projectRecord(record, request) {
    const applicant = record.applicant ?? record.agent ?? {};
    const agentCode = getRecordAgentCode(
      record,
      this.generatedCodeIndex,
    );
    const lifecycle = this.getLifecycle(record);
    const syncStatuses = this.getSyncStatuses(record.trackingId);
    const notificationFlags = this.getNotificationFlags(
      record.trackingId,
    );
    const projection = {
      trackingId: record.trackingId,
      applicationNumber:
        record.applicationNumber ?? record.applicationId,
      applicationId: record.applicationId,
      partnerId: getRecordPartnerCode(record),
      partnerCode: getRecordPartnerCode(record),
      agent: {
        fullName: getApplicantName(applicant),
        npn: getRecordNpn(record) ?? null,
        agentCode: agentCode ?? null,
      },
      contract: {
        company: record.company ?? record.carrierCode ?? null,
        carrierCode: record.carrierCode ?? null,
        contractType:
          record.contractType ?? record.contract?.type ?? null,
        level: record.contract?.level ?? record.level ?? null,
        gaCode: record.gaCode ?? null,
        commissionSchedule:
          record.contract?.commissionSchedule ??
          record.commissionSchedule ??
          null,
        advanceCommissionEligible:
          record.contract?.advanceCommission ?? false,
        status: record.contract?.status ?? null,
      },
      hierarchy: cloneValue(
        record.hierarchy ?? {
          gaCode: record.gaCode ?? null,
          agencyCode: record.agency?.code ?? null,
          agencyName: record.agency?.name ?? null,
        },
      ),
      backgroundCheck: cloneValue(record.background ?? null),
      appointment: cloneValue(record.appointment ?? null),
      lifecycle: {
        currentStatus: lifecycle.currentStatus,
        updatedAt:
          lifecycle.updatedAt ?? getRecordTimestamp(record),
        ...(request.includeHistory
          ? {
              history: cloneValue(lifecycle.milestones ?? []),
              milestones: cloneValue(lifecycle.milestones ?? []),
            }
          : {}),
      },
      syncStatuses,
      notificationFlags,
      status: record.status,
      workflowStage: record.workflowStage,
      priority: record.priority,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };

    return projectFields(projection, request.fields);
  }

  getLifecycle(record) {
    if (!this.lifecycleService) {
      return createFallbackLifecycle(record);
    }

    try {
      if (typeof this.lifecycleService.getLifecycle === 'function') {
        return this.lifecycleService.getLifecycle(
          record.trackingId,
          { record },
        );
      }

      return this.lifecycleService.get(record.trackingId, {
        record,
      });
    } catch {
      return createFallbackLifecycle(record);
    }
  }

  getSyncStatuses(trackingId) {
    if (!this.syncStatusService || !trackingId) {
      return {};
    }

    try {
      if (
        typeof this.syncStatusService.getStatusBadges === 'function'
      ) {
        return cloneValue(
          this.syncStatusService.getStatusBadges(trackingId),
        );
      }

      return cloneValue(
        this.syncStatusService.getLatestStatusBySystem(trackingId),
      );
    } catch {
      return {};
    }
  }

  getNotificationFlags(trackingId) {
    if (!this.notificationService || !trackingId) {
      return {
        carrierSubmissionBlocked: false,
        hasWelcomeNotification: false,
        hasReminder: false,
        latestNotificationAt: null,
        notificationCount: 0,
      };
    }

    try {
      return cloneValue(
        this.notificationService.getVisibilityFlags(trackingId),
      );
    } catch {
      return {
        carrierSubmissionBlocked: false,
        hasWelcomeNotification: false,
        hasReminder: false,
        latestNotificationAt: null,
        notificationCount: 0,
      };
    }
  }

  readCache(key) {
    const entry = this.cache.get(key);

    if (!entry) {
      return undefined;
    }

    const currentTime = Date.parse(toIsoTimestamp(this.clock()));

    if (currentTime >= entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }

    this.cache.delete(key);
    this.cache.set(key, entry);

    return cloneValue(entry.value);
  }

  writeCache(key, value) {
    if (this.cacheTtlMs === 0) {
      return;
    }

    const currentTime = Date.parse(toIsoTimestamp(this.clock()));
    const partnerCode =
      value.data[0]?.partnerCode ??
      value.data[0]?.partnerId ??
      null;

    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    this.cache.set(key, {
      value: cloneValue(value),
      partnerCode,
      expiresAt: currentTime + this.cacheTtlMs,
    });

    while (this.cache.size > this.cacheSize) {
      const oldestKey = this.cache.keys().next().value;

      this.cache.delete(oldestKey);
    }
  }

  withRequestMetadata(response, request, cached) {
    const requestedAt = toIsoTimestamp(this.clock());
    const requestId = generateCorrelationId({
      type: 'partner-status-search',
      lookupType: request.lookupType,
      lookupValue: request.lookupValue ?? null,
      page: request.page,
      requestedAt,
    }).replace(/^corr-/i, 'req-');

    return Object.freeze({
      requestId,
      data: Object.freeze(cloneValue(response.data)),
      page: response.page,
      pageSize: response.pageSize,
      total: response.total,
      totalPages: response.totalPages,
      errors: Object.freeze(cloneValue(response.errors ?? [])),
      cached,
      requestedAt,
    });
  }

  appendSearchAudit(
    request,
    principal,
    partnerCode,
    resultCount,
    requestId,
  ) {
    if (!this.auditService) {
      return null;
    }

    const append =
      typeof this.auditService.append === 'function'
        ? this.auditService.append.bind(this.auditService)
        : this.auditService.create.bind(this.auditService);
    const user = getPrincipalUser(principal);
    const actorId =
      user?.id ?? principal?.id ?? principal?.actorId ?? 'system';

    try {
      return append(
        {
          action: 'PARTNER_STATUS_SEARCHED',
          actorId,
          actorType: actorTypeForPrincipal(principal),
          source: AUDIT_SOURCES.PARTNER_DASHBOARD,
          summary: 'Partner status records were searched.',
          trackingId: null,
          metadata: {
            requestId,
            partnerCode: partnerCode ?? null,
            lookupType: request.lookupType,
            resultCount,
            page: request.page,
            pageSize: request.pageSize,
          },
          timestamp: toIsoTimestamp(this.clock()),
        },
        {
          actor: principal,
          source: AUDIT_SOURCES.PARTNER_DASHBOARD,
        },
      );
    } catch {
      return null;
    }
  }
}

/**
 * Creates a partner status service.
 *
 * @param {ConstructorParameters<typeof PartnerStatusService>[0]} [options]
 * Service options.
 * @returns {PartnerStatusService} Partner status service.
 */
export function createPartnerStatusService(options = {}) {
  return new PartnerStatusService(options);
}

/**
 * Searches partner statuses with a newly created service.
 *
 * @param {object} request Search request.
 * @param {string | object} session Authenticated principal.
 * @param {ConstructorParameters<typeof PartnerStatusService>[0]}
 * [serviceOptions] Service options.
 * @returns {object} Partner status response.
 */
export function searchPartnerStatus(
  request,
  session,
  serviceOptions = {},
) {
  return createPartnerStatusService(serviceOptions).search(
    request,
    session,
  );
}

export const PartnerStatusAPI = PartnerStatusService;
export const PartnerStatusQueryAPI = PartnerStatusService;
export const createPartnerStatusAPI = createPartnerStatusService;
export const searchPartnerStatuses = searchPartnerStatus;

export default PartnerStatusService;