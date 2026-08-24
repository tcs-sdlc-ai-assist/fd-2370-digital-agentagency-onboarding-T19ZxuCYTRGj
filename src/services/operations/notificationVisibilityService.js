import {
  AUDIT_SOURCES,
} from '../../constants/domain.js';
import { PERMISSIONS } from '../../constants/roles.js';
import { canPerformAction } from '../../auth/permissionPolicy.js';
import { PartnerScopeGuard } from '../../auth/partnerScopeGuard.js';
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_STATUSES,
  NOTIFICATION_TYPES,
  NotificationRepository,
} from '../../repositories/notificationRepository.js';
import { toIsoTimestamp } from '../../utils/dates.js';
import { AuditService } from '../shared/auditService.js';

export const NOTIFICATION_VISIBILITY_ERROR_CODES = Object.freeze({
  INVALID_OPTIONS: 'NOTIFICATION_VISIBILITY_INVALID_OPTIONS',
  INVALID_REQUEST: 'NOTIFICATION_VISIBILITY_INVALID_REQUEST',
  INVALID_DEPENDENCY: 'NOTIFICATION_VISIBILITY_INVALID_DEPENDENCY',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN_ROLE: 'FORBIDDEN_ROLE',
  PARTNER_SCOPE_VIOLATION: 'PARTNER_SCOPE_VIOLATION',
  NOT_FOUND: 'NOTIFICATION_VISIBILITY_NOT_FOUND',
  OPERATION_FAILED: 'NOTIFICATION_VISIBILITY_OPERATION_FAILED',
  AUDIT_FAILED: 'NOTIFICATION_VISIBILITY_AUDIT_FAILED',
});

export const NOTIFICATION_VISIBILITY_ACTIONS = Object.freeze({
  SEARCHED: 'NOTIFICATION_LOGS_SEARCHED',
  PREVIEW_CREATED: 'NOTIFICATION_PREVIEW_CREATED',
  REMINDER_CREATED: 'ONBOARDING_REMINDER_CREATED',
  AGENCY_COPY_CREATED: 'AGENCY_NOTIFICATION_COPY_CREATED',
  WELCOME_CREATED: 'WELCOME_EMAIL_PREVIEW_CREATED',
  AGENCY_REVIEW_REQUESTED: 'AGENCY_REVIEW_REQUESTED',
  AGENCY_REVIEW_COMPLETED: 'AGENCY_REVIEW_COMPLETED',
});

export const DEFAULT_NOTIFICATION_PAGE_SIZE = 25;
export const MAX_NOTIFICATION_PAGE_SIZE = 100;
export const DEFAULT_REMINDER_INTERVAL_HOURS = 24;

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertOptions(
  options,
  description = 'Notification visibility options',
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

function createVisibilityError(code, message, details, cause) {
  const error = new Error(message, {
    ...(cause === undefined ? {} : { cause }),
  });

  error.name = 'NotificationVisibilityServiceError';
  error.code = code;
  error.details = details ?? null;
  error.recoverable = true;

  return error;
}

function assertRepository(repository) {
  const requiredMethods = ['create', 'find', 'list'];

  if (
    !isObject(repository) ||
    requiredMethods.some(
      (method) => typeof repository[method] !== 'function',
    )
  ) {
    throw createVisibilityError(
      NOTIFICATION_VISIBILITY_ERROR_CODES.INVALID_DEPENDENCY,
      'The notification repository must provide create, find, and list methods.',
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
    throw createVisibilityError(
      NOTIFICATION_VISIBILITY_ERROR_CODES.INVALID_DEPENDENCY,
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
    throw createVisibilityError(
      NOTIFICATION_VISIBILITY_ERROR_CODES.INVALID_DEPENDENCY,
      'The notification audit service must provide append or create.',
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
  if (
    request.limit !== undefined &&
    (!Number.isInteger(request.limit) || request.limit < 1)
  ) {
    throw new RangeError(
      'The notification result limit must be a positive integer.',
    );
  }

  if (
    request.offset !== undefined &&
    (!Number.isInteger(request.offset) || request.offset < 0)
  ) {
    throw new RangeError(
      'The notification result offset must be a nonnegative integer.',
    );
  }

  const page = request.page ?? 1;
  const pageSize =
    request.pageSize ??
    request.limit ??
    DEFAULT_NOTIFICATION_PAGE_SIZE;

  if (!Number.isInteger(page) || page < 1) {
    throw new RangeError(
      'The notification page must be a positive integer.',
    );
  }

  if (
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > MAX_NOTIFICATION_PAGE_SIZE
  ) {
    throw new RangeError(
      `The notification page size must be from 1 to ${MAX_NOTIFICATION_PAGE_SIZE}.`,
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
  const channels = normalizeFilter(
    request.channels ?? request.channel,
    'Notification channel',
  );
  const types = normalizeFilter(
    request.types ?? request.type,
    'Notification type',
  );
  const statuses = normalizeFilter(
    request.statuses ?? request.status,
    'Notification status',
  );

  return {
    ...(request.trackingId === undefined
      ? {}
      : { trackingId: request.trackingId }),
    ...(request.partnerCode === undefined &&
    request.partnerId === undefined
      ? {}
      : {
          partnerCode:
            request.partnerCode ?? request.partnerId,
        }),
    ...(channels === undefined ? {} : { channels }),
    ...(types === undefined ? {} : { types }),
    ...(statuses === undefined ? {} : { statuses }),
    ...(request.templateCode === undefined
      ? {}
      : { templateCode: request.templateCode }),
    ...(request.recipientMasked === undefined
      ? {}
      : { recipientMasked: request.recipientMasked }),
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

function matchesSearch(notification, search) {
  const normalizedSearch = normalizeSearchText(search);

  if (!normalizedSearch) {
    return true;
  }

  const values = [
    notification.notificationId,
    notification.trackingId,
    notification.partnerCode,
    notification.channel,
    notification.type,
    notification.templateCode,
    notification.recipientMasked,
    notification.status,
    ...Object.values(notification.previewPayload ?? {}),
  ];

  return values.some((value) => {
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

function latestNotification(notifications, type) {
  return notifications
    .filter((notification) => notification.type === type)
    .sort(
      (left, right) =>
        Date.parse(right.createdAt) - Date.parse(left.createdAt),
    )[0];
}

function isAfter(left, right) {
  if (!left) {
    return false;
  }

  if (!right) {
    return true;
  }

  return Date.parse(left.createdAt) > Date.parse(right.createdAt);
}

function createStatusCounts(notifications) {
  const counts = Object.fromEntries(
    Object.values(NOTIFICATION_STATUSES).map((status) => [status, 0]),
  );

  notifications.forEach((notification) => {
    counts[notification.status] =
      (counts[notification.status] ?? 0) + 1;
  });

  return Object.freeze(counts);
}

function normalizePreviewRequest(request, defaults) {
  const normalizedRequest = assertOptions(
    request,
    'Notification preview request',
  );

  if (
    normalizedRequest.previewPayload !== undefined &&
    !isObject(normalizedRequest.previewPayload)
  ) {
    throw new TypeError(
      'The notification preview payload must be an object.',
    );
  }

  return {
    ...cloneValue(normalizedRequest),
    trackingId:
      normalizedRequest.trackingId === undefined
        ? null
        : normalizedRequest.trackingId,
    partnerCode: normalizeIdentifier(
      normalizedRequest.partnerCode ??
        normalizedRequest.partnerId,
      'Notification partner code',
    ),
    channel:
      normalizedRequest.channel ?? defaults.channel,
    type: normalizedRequest.type ?? defaults.type,
    recipientMasked: normalizeIdentifier(
      normalizedRequest.recipientMasked,
      'Masked notification recipient',
    ),
    templateCode:
      normalizedRequest.templateCode ?? defaults.templateCode,
    previewPayload: cloneValue(
      normalizedRequest.previewPayload ?? {},
    ),
    status:
      normalizedRequest.status ?? defaults.status,
  };
}

/**
 * Searches role-visible notification logs and evaluates notification
 * visibility and agency-review blocking behavior.
 */
export class NotificationVisibilityService {
  /**
   * @param {{
   *   repository?: object,
   *   notificationRepository?: object,
   *   partnerScopeGuard?: object,
   *   auditService?: object | false,
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
        'The notification visibility clock must be a function.',
      );
    }

    this.clock = normalizedOptions.clock ?? (() => new Date());
    const repositoryOptions = createRepositoryOptions(
      normalizedOptions,
      this.clock,
    );

    this.repository = assertRepository(
      normalizedOptions.repository ??
        normalizedOptions.notificationRepository ??
        new NotificationRepository(repositoryOptions),
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
    this.strictAudit = normalizedOptions.strictAudit ?? false;
  }

  /**
   * Searches notification logs visible to the current principal.
   *
   * @param {object} [request] Search filters and pagination.
   * @param {string | object} [session] Authenticated principal.
   * @returns {object} Paginated notification response.
   */
  search(request = {}, session) {
    const normalizedRequest = assertOptions(
      request,
      'Notification search request',
    );
    const principal = resolvePrincipal(
      normalizedRequest,
      session,
      this.principal,
    );

    this.assertAuthorization(principal);

    const partnerContext = resolvePartnerContext(
      normalizedRequest,
      principal,
      this.partnerContext,
    );
    const pagination = normalizePagination(normalizedRequest);

    try {
      const notifications = this.repository.list(
        createRepositoryQuery(normalizedRequest),
      );

      if (!Array.isArray(notifications)) {
        throw createVisibilityError(
          NOTIFICATION_VISIBILITY_ERROR_CODES.INVALID_DEPENDENCY,
          'The notification repository returned an invalid collection.',
          null,
        );
      }

      const scopedNotifications = this.filterByScope(
        notifications,
        principal,
        partnerContext,
      ).filter((notification) =>
        matchesSearch(notification, normalizedRequest.search),
      );
      const total = scopedNotifications.length;
      const records = scopedNotifications
        .slice(
          pagination.offset,
          pagination.offset + pagination.pageSize,
        )
        .map((notification) => cloneValue(notification));
      const response = Object.freeze({
        notifications: Object.freeze(records),
        records: Object.freeze(records),
        data: Object.freeze(records),
        counts: createStatusCounts(scopedNotifications),
        page: pagination.page,
        pageSize: pagination.pageSize,
        total,
        totalPages:
          total === 0
            ? 0
            : Math.ceil(total / pagination.pageSize),
      });

      this.appendAuditEvent(
        NOTIFICATION_VISIBILITY_ACTIONS.SEARCHED,
        null,
        principal,
        {
          resultCount: total,
          trackingId: normalizedRequest.trackingId ?? null,
          channels:
            normalizedRequest.channels ??
            normalizedRequest.channel ??
            null,
          types:
            normalizedRequest.types ??
            normalizedRequest.type ??
            null,
        },
        false,
      );

      return response;
    } catch (error) {
      if (
        error?.name === 'NotificationVisibilityServiceError' ||
        error?.name === 'NotificationRepositoryError' ||
        error?.name === 'PartnerScopeGuardError' ||
        error instanceof TypeError ||
        error instanceof RangeError
      ) {
        throw error;
      }

      throw createVisibilityError(
        NOTIFICATION_VISIBILITY_ERROR_CODES.OPERATION_FAILED,
        'Unable to search notification logs.',
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
   * @returns {object} Notification response.
   */
  searchNotifications(request = {}, session) {
    return this.search(request, session);
  }

  /**
   * Returns a role-visible notification by identifier.
   *
   * @param {string | number} notificationId Notification identifier.
   * @param {string | object} [session] Authenticated principal.
   * @param {object} [options] Access options.
   * @returns {object} Notification.
   */
  get(notificationId, session, options = {}) {
    const normalizedOptions = assertOptions(
      options,
      'Notification access options',
    );
    const principal = resolvePrincipal(
      normalizedOptions,
      session,
      this.principal,
    );

    this.assertAuthorization(principal);

    const notification = this.repository.find(notificationId);

    if (!notification) {
      throw createVisibilityError(
        NOTIFICATION_VISIBILITY_ERROR_CODES.NOT_FOUND,
        `Notification not found: ${notificationId}`,
        { notificationId: String(notificationId) },
      );
    }

    this.assertRecordAccess(
      notification,
      principal,
      resolvePartnerContext(
        normalizedOptions,
        principal,
        this.partnerContext,
      ),
    );

    return cloneValue(notification);
  }

  /**
   * Alias for get.
   *
   * @param {string | number} notificationId Notification identifier.
   * @param {string | object} [session] Authenticated principal.
   * @param {object} [options] Access options.
   * @returns {object} Notification.
   */
  getNotification(notificationId, session, options = {}) {
    return this.get(notificationId, session, options);
  }

  /**
   * Creates a notification preview.
   *
   * @param {object} request Preview values.
   * @param {string | object} [session] Authenticated principal.
   * @param {object} [options] Creation options.
   * @returns {object} Created notification.
   */
  createPreview(request, session, options = {}) {
    const normalizedOptions = assertOptions(
      options,
      'Notification creation options',
    );
    const principal = resolvePrincipal(
      normalizedOptions,
      session,
      this.principal,
    );

    this.assertAuthorization(principal);

    const notification = normalizePreviewRequest(request, {
      channel: NOTIFICATION_CHANNELS.EMAIL,
      type: NOTIFICATION_TYPES.STATUS_UPDATE,
      templateCode: 'STATUS_UPDATE',
      status: NOTIFICATION_STATUSES.PREVIEWED,
    });
    const partnerContext = resolvePartnerContext(
      normalizedOptions,
      principal,
      this.partnerContext,
    );

    this.assertRecordAccess(notification, principal, partnerContext);

    try {
      const created = this.repository.create(notification);

      this.appendAuditEvent(
        normalizedOptions.auditAction ??
          NOTIFICATION_VISIBILITY_ACTIONS.PREVIEW_CREATED,
        created,
        principal,
        {
          notificationId: created.notificationId,
          channel: created.channel,
          type: created.type,
          templateCode: created.templateCode,
        },
      );

      return cloneValue(created);
    } catch (error) {
      if (
        error?.name === 'NotificationRepositoryError' ||
        error?.name === 'NotificationVisibilityServiceError'
      ) {
        throw error;
      }

      throw createVisibilityError(
        NOTIFICATION_VISIBILITY_ERROR_CODES.OPERATION_FAILED,
        'Unable to create the notification preview.',
        {
          trackingId: notification.trackingId,
          partnerCode: notification.partnerCode,
        },
        error,
      );
    }
  }

  /**
   * Creates an onboarding reminder preview.
   *
   * @param {object} request Reminder values.
   * @param {string | object} [session] Authenticated principal.
   * @param {object} [options] Creation options.
   * @returns {object} Created reminder.
   */
  createReminderPreview(request, session, options = {}) {
    const normalizedRequest = assertOptions(
      request,
      'Reminder preview request',
    );

    return this.createPreview(
      {
        ...cloneValue(normalizedRequest),
        channel:
          normalizedRequest.channel ??
          NOTIFICATION_CHANNELS.EMAIL,
        type: NOTIFICATION_TYPES.REMINDER,
        templateCode:
          normalizedRequest.templateCode ??
          'ONBOARDING_DRAFT_REMINDER',
      },
      session,
      {
        ...assertOptions(options, 'Reminder creation options'),
        auditAction:
          NOTIFICATION_VISIBILITY_ACTIONS.REMINDER_CREATED,
      },
    );
  }

  /**
   * Creates a partner or agency copy preview.
   *
   * @param {object} request Agency-copy values.
   * @param {string | object} [session] Authenticated principal.
   * @param {object} [options] Creation options.
   * @returns {object} Created agency copy.
   */
  createAgencyCopyPreview(request, session, options = {}) {
    const normalizedRequest = assertOptions(
      request,
      'Agency copy preview request',
    );

    return this.createPreview(
      {
        ...cloneValue(normalizedRequest),
        channel:
          normalizedRequest.channel ??
          NOTIFICATION_CHANNELS.EMAIL,
        type: NOTIFICATION_TYPES.AGENCY_COPY,
        templateCode:
          normalizedRequest.templateCode ??
          'AGENCY_NOTIFICATION_COPY',
      },
      session,
      {
        ...assertOptions(options, 'Agency copy creation options'),
        auditAction:
          NOTIFICATION_VISIBILITY_ACTIONS.AGENCY_COPY_CREATED,
      },
    );
  }

  /**
   * Creates a welcome-email preview.
   *
   * @param {object} request Welcome-email values.
   * @param {string | object} [session] Authenticated principal.
   * @param {object} [options] Creation options.
   * @returns {object} Created welcome preview.
   */
  createWelcomeEmailPreview(request, session, options = {}) {
    const normalizedRequest = assertOptions(
      request,
      'Welcome email preview request',
    );

    return this.createPreview(
      {
        ...cloneValue(normalizedRequest),
        channel: NOTIFICATION_CHANNELS.EMAIL,
        type: NOTIFICATION_TYPES.WELCOME,
        templateCode:
          normalizedRequest.templateCode ?? 'PRODUCER_WELCOME',
      },
      session,
      {
        ...assertOptions(options, 'Welcome email creation options'),
        auditAction:
          NOTIFICATION_VISIBILITY_ACTIONS.WELCOME_CREATED,
      },
    );
  }

  /**
   * Records an agency-review request that blocks carrier submission.
   *
   * @param {object} request Agency review request values.
   * @param {string | object} [session] Authenticated principal.
   * @param {object} [options] Creation options.
   * @returns {object} Created review request notification.
   */
  requestAgencyReview(request, session, options = {}) {
    const normalizedRequest = assertOptions(
      request,
      'Agency review request',
    );

    return this.createPreview(
      {
        ...cloneValue(normalizedRequest),
        channel:
          normalizedRequest.channel ??
          NOTIFICATION_CHANNELS.EMAIL,
        type: NOTIFICATION_TYPES.AGENCY_REVIEW_REQUEST,
        templateCode:
          normalizedRequest.templateCode ??
          'AGENCY_REVIEW_REQUEST',
        status:
          normalizedRequest.status ??
          NOTIFICATION_STATUSES.QUEUED,
        previewPayload: {
          ...cloneValue(normalizedRequest.previewPayload ?? {}),
          submissionBlocked: true,
        },
      },
      session,
      {
        ...assertOptions(options, 'Agency review request options'),
        auditAction:
          NOTIFICATION_VISIBILITY_ACTIONS.AGENCY_REVIEW_REQUESTED,
      },
    );
  }

  /**
   * Records completion of an agency review.
   *
   * @param {object} request Agency review completion values.
   * @param {string | object} [session] Authenticated principal.
   * @param {object} [options] Creation options.
   * @returns {object} Created review-completion notification.
   */
  completeAgencyReview(request, session, options = {}) {
    const normalizedRequest = assertOptions(
      request,
      'Agency review completion request',
    );

    return this.createPreview(
      {
        ...cloneValue(normalizedRequest),
        channel:
          normalizedRequest.channel ??
          NOTIFICATION_CHANNELS.IN_APP,
        type: NOTIFICATION_TYPES.AGENCY_REVIEW_COMPLETED,
        templateCode:
          normalizedRequest.templateCode ??
          'AGENCY_REVIEW_COMPLETED',
        previewPayload: {
          ...cloneValue(normalizedRequest.previewPayload ?? {}),
          submissionBlocked: false,
        },
      },
      session,
      {
        ...assertOptions(options, 'Agency review completion options'),
        auditAction:
          NOTIFICATION_VISIBILITY_ACTIONS.AGENCY_REVIEW_COMPLETED,
      },
    );
  }

  /**
   * Determines whether an outstanding agency review blocks submission.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @param {string | object} [session] Authenticated principal.
   * @param {object} [options] Access options.
   * @returns {boolean} Whether submission remains blocked.
   */
  shouldBlockCarrierSubmission(
    trackingId,
    session,
    options = {},
  ) {
    return this.getVisibilityFlags(
      trackingId,
      session,
      options,
    ).carrierSubmissionBlocked;
  }

  /**
   * Returns notification visibility and behavior flags.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @param {string | object} [session] Authenticated principal.
   * @param {{
   *   partnerContext?: object,
   *   reminderIntervalHours?: number
   * }} [options] Visibility options.
   * @returns {object} Notification behavior flags.
   */
  getVisibilityFlags(trackingId, session, options = {}) {
    const normalizedTrackingId = normalizeIdentifier(
      trackingId,
      'Tracking identifier',
    );
    const normalizedOptions = assertOptions(
      options,
      'Notification visibility options',
    );
    const principal = resolvePrincipal(
      normalizedOptions,
      session,
      this.principal,
    );

    this.assertAuthorization(principal);

    const reminderIntervalHours =
      normalizedOptions.reminderIntervalHours ??
      DEFAULT_REMINDER_INTERVAL_HOURS;

    if (
      typeof reminderIntervalHours !== 'number' ||
      !Number.isFinite(reminderIntervalHours) ||
      reminderIntervalHours < 0
    ) {
      throw new RangeError(
        'The reminder interval must be a nonnegative number of hours.',
      );
    }

    const partnerContext = resolvePartnerContext(
      normalizedOptions,
      principal,
      this.partnerContext,
    );
    const notifications = this.filterByScope(
      this.repository.list({
        trackingId: normalizedTrackingId,
        sortOrder: 'desc',
      }),
      principal,
      partnerContext,
    );
    const latestReviewRequest = latestNotification(
      notifications,
      NOTIFICATION_TYPES.AGENCY_REVIEW_REQUEST,
    );
    const latestReviewCompletion = latestNotification(
      notifications,
      NOTIFICATION_TYPES.AGENCY_REVIEW_COMPLETED,
    );
    const latestReminder = latestNotification(
      notifications,
      NOTIFICATION_TYPES.REMINDER,
    );
    const latestWelcome = latestNotification(
      notifications,
      NOTIFICATION_TYPES.WELCOME,
    );
    const latestAgencyCopy = latestNotification(
      notifications,
      NOTIFICATION_TYPES.AGENCY_COPY,
    );
    const carrierSubmissionBlocked = isAfter(
      latestReviewRequest,
      latestReviewCompletion,
    );
    const referenceTime = Date.parse(toIsoTimestamp(this.clock()));
    const latestReminderTime = latestReminder
      ? Date.parse(latestReminder.createdAt)
      : Number.NEGATIVE_INFINITY;
    const reminderDue =
      !latestReminder ||
      referenceTime - latestReminderTime >=
        reminderIntervalHours * 60 * 60 * 1000;

    return Object.freeze({
      trackingId: normalizedTrackingId,
      carrierSubmissionBlocked,
      agencyReviewPending: carrierSubmissionBlocked,
      hasAgencyReviewRequest: Boolean(latestReviewRequest),
      hasAgencyReviewCompletion: Boolean(latestReviewCompletion),
      hasWelcomeNotification: Boolean(latestWelcome),
      hasWelcomeEmail: Boolean(latestWelcome),
      hasReminder: Boolean(latestReminder),
      reminderDue,
      hasAgencyCopy: Boolean(latestAgencyCopy),
      latestNotificationAt:
        notifications[0]?.createdAt ?? null,
      latestReminderAt: latestReminder?.createdAt ?? null,
      latestWelcomeAt: latestWelcome?.createdAt ?? null,
      latestAgencyCopyAt: latestAgencyCopy?.createdAt ?? null,
      latestAgencyReviewRequestAt:
        latestReviewRequest?.createdAt ?? null,
      latestAgencyReviewCompletedAt:
        latestReviewCompletion?.createdAt ?? null,
      notificationCount: notifications.length,
    });
  }

  /**
   * Alias for getVisibilityFlags.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @param {string | object} [session] Authenticated principal.
   * @param {object} [options] Visibility options.
   * @returns {object} Notification behavior flags.
   */
  evaluateNotificationBehavior(
    trackingId,
    session,
    options = {},
  ) {
    return this.getVisibilityFlags(
      trackingId,
      session,
      options,
    );
  }

  filterByScope(notifications, principal, partnerContext) {
    if (
      principal === null ||
      principal === undefined ||
      this.enforceRecordScope === false
    ) {
      return notifications.map((notification) =>
        cloneValue(notification),
      );
    }

    return this.scopeGuard.filterRecords(
      notifications,
      principal,
      partnerContext,
    );
  }

  assertAuthorization(principal) {
    if (principal === null || principal === undefined) {
      if (this.requireAuthorization) {
        throw createVisibilityError(
          NOTIFICATION_VISIBILITY_ERROR_CODES.UNAUTHENTICATED,
          'An authenticated principal is required.',
          null,
        );
      }

      return;
    }

    if (!isAuthenticatedPrincipal(principal)) {
      throw createVisibilityError(
        NOTIFICATION_VISIBILITY_ERROR_CODES.UNAUTHENTICATED,
        'An authenticated principal is required.',
        null,
      );
    }

    if (
      !canPerformAction(
        principal,
        PERMISSIONS.VIEW_NOTIFICATIONS,
      )
    ) {
      throw createVisibilityError(
        NOTIFICATION_VISIBILITY_ERROR_CODES.FORBIDDEN_ROLE,
        'The current principal cannot access notification logs.',
        null,
      );
    }
  }

  assertRecordAccess(notification, principal, partnerContext) {
    if (
      principal === null ||
      principal === undefined ||
      this.enforceRecordScope === false
    ) {
      return;
    }

    if (
      !this.scopeGuard.canAccessRecord(
        notification,
        principal,
        partnerContext,
      )
    ) {
      throw createVisibilityError(
        NOTIFICATION_VISIBILITY_ERROR_CODES.PARTNER_SCOPE_VIOLATION,
        'The notification is outside the current record scope.',
        {
          notificationId: notification.notificationId ?? null,
          trackingId: notification.trackingId ?? null,
          partnerCode: notification.partnerCode ?? null,
        },
      );
    }
  }

  appendAuditEvent(
    action,
    notification,
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
          trackingId: notification?.trackingId ?? null,
          notificationId:
            notification?.notificationId ?? undefined,
          sourceRecordId:
            notification?.notificationId ??
            notification?.trackingId ??
            undefined,
          action,
          summary: action.toLowerCase().replace(/_/g, ' '),
          metadata: {
            actorId: getPrincipalId(principal),
            partnerCode:
              notification?.partnerCode ?? null,
            material,
            ...cloneValue(metadata),
          },
          timestamp: toIsoTimestamp(this.clock()),
        },
        {
          actor: principal,
          source: AUDIT_SOURCES.WORKFLOW_ENGINE,
        },
      );
    } catch (error) {
      if (this.strictAudit && material) {
        throw createVisibilityError(
          NOTIFICATION_VISIBILITY_ERROR_CODES.AUDIT_FAILED,
          'Unable to persist the notification audit event.',
          {
            action,
            notificationId:
              notification?.notificationId ?? null,
          },
          error,
        );
      }

      return null;
    }
  }
}

/**
 * Creates a notification visibility service.
 *
 * @param {ConstructorParameters<typeof NotificationVisibilityService>[0]}
 * [options] Service options.
 * @returns {NotificationVisibilityService} Service instance.
 */
export function createNotificationVisibilityService(options = {}) {
  return new NotificationVisibilityService(options);
}

/**
 * Searches notification logs with a newly created service.
 *
 * @param {object} request Search request.
 * @param {string | object} session Authenticated principal.
 * @param {ConstructorParameters<typeof NotificationVisibilityService>[0]}
 * [serviceOptions] Service options.
 * @returns {object} Notification search response.
 */
export function searchNotificationLogs(
  request,
  session,
  serviceOptions = {},
) {
  return createNotificationVisibilityService(
    serviceOptions,
  ).search(request, session);
}

/**
 * Returns notification visibility flags with a newly created service.
 *
 * @param {string | number} trackingId Tracking identifier.
 * @param {string | object} session Authenticated principal.
 * @param {object} [options] Visibility options.
 * @param {ConstructorParameters<typeof NotificationVisibilityService>[0]}
 * [serviceOptions] Service options.
 * @returns {object} Notification visibility flags.
 */
export function getNotificationVisibilityFlags(
  trackingId,
  session,
  options = {},
  serviceOptions = {},
) {
  return createNotificationVisibilityService(
    serviceOptions,
  ).getVisibilityFlags(trackingId, session, options);
}

export const NotificationLogAPI = NotificationVisibilityService;
export const NotificationVisibilityAPI =
  NotificationVisibilityService;
export const createNotificationLogAPI =
  createNotificationVisibilityService;
export const createNotificationVisibilityAPI =
  createNotificationVisibilityService;
export const searchNotifications = searchNotificationLogs;

export default NotificationVisibilityService;