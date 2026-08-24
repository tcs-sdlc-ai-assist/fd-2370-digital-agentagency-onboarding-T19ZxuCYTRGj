import { z } from 'zod';
import { STORAGE_KEYS } from '../constants/storageKeys.js';
import { notificationSchema } from '../contracts/schemas.js';
import { BrowserStorageAdapter } from '../persistence/browserStorageAdapter.js';
import { getSeeds } from '../persistence/seedLoader.js';
import { toIsoTimestamp } from '../utils/dates.js';
import { createDeterministicId } from '../utils/ids.js';

const identifierSchema = z.string().trim().min(1);

export const NOTIFICATION_REPOSITORY_STORAGE_KEY =
  `${STORAGE_KEYS.OPERATIONS}:notifications`;

export const NOTIFICATION_CHANNELS = Object.freeze({
  EMAIL: 'email',
  IN_APP: 'in_app',
  SMS: 'sms',
  PUSH: 'push',
});

export const NOTIFICATION_STATUSES = Object.freeze({
  PREVIEWED: 'previewed',
  QUEUED: 'queued',
  SENT: 'sent',
  DELIVERED: 'delivered',
  FAILED: 'failed',
  SUPPRESSED: 'suppressed',
  READ: 'read',
});

export const NOTIFICATION_TYPES = Object.freeze({
  WELCOME: 'welcome',
  REMINDER: 'reminder',
  AGENCY_COPY: 'agency_copy',
  AGENCY_REVIEW_REQUEST: 'agency_review_request',
  AGENCY_REVIEW_COMPLETED: 'agency_review_completed',
  STATUS_UPDATE: 'status_update',
  EXCEPTION_NOTICE: 'exception_notice',
});

export const notificationRepositoryStateSchema = z
  .object({
    overlays: z.record(z.unknown()).default({}),
    removedNotificationIds: z.array(identifierSchema).default([]),
  })
  .passthrough();

export const NOTIFICATION_REPOSITORY_ERROR_CODES = Object.freeze({
  INVALID_NOTIFICATION: 'NOTIFICATION_INVALID',
  NOT_FOUND: 'NOTIFICATION_NOT_FOUND',
  DUPLICATE_IDENTIFIER: 'NOTIFICATION_DUPLICATE_IDENTIFIER',
  IDENTIFIER_CHANGE: 'NOTIFICATION_IDENTIFIER_CHANGE',
  CONFLICT: 'NOTIFICATION_UPDATE_CONFLICT',
  PERSISTENCE_FAILED: 'NOTIFICATION_PERSISTENCE_FAILED',
});

const CANONICAL_FIELDS = Object.freeze([
  'notificationId',
  'trackingId',
  'partnerCode',
  'channel',
  'type',
  'templateCode',
  'createdAt',
]);

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

function assertOptions(options, description = 'Notification options') {
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
        issue.path.length > 0 ? issue.path.join('.') : 'notification';

      return `${path}: ${issue.message}`;
    })
    .join('; ');
}

function createRepositoryError(code, message, details, cause) {
  const error = new Error(message, {
    ...(cause === undefined ? {} : { cause }),
  });

  error.name = 'NotificationRepositoryError';
  error.code = code;
  error.details = details ?? null;

  return error;
}

function parseNotification(notification) {
  const result = notificationSchema.safeParse(notification);

  if (!result.success) {
    throw createRepositoryError(
      NOTIFICATION_REPOSITORY_ERROR_CODES.INVALID_NOTIFICATION,
      `Invalid notification: ${formatValidationIssues(result.error)}`,
      { issues: result.error.issues },
      result.error,
    );
  }

  return result.data;
}

function validateSeedNotifications(seedNotifications) {
  if (!Array.isArray(seedNotifications)) {
    throw new TypeError('Notification seed records must be an array.');
  }

  const parsedNotifications = seedNotifications.map((notification) =>
    parseNotification(notification),
  );

  assertUniqueIdentifiers(parsedNotifications);
  return parsedNotifications;
}

function createEmptyState() {
  return {
    overlays: {},
    removedNotificationIds: [],
  };
}

function assertUniqueIdentifiers(notifications) {
  const identifiers = new Map();

  notifications.forEach((notification) => {
    const normalizedIdentifier = normalizeIdentifierForLookup(
      notification.notificationId,
      'Notification identifier',
    );
    const existingNotification = identifiers.get(normalizedIdentifier);

    if (existingNotification) {
      throw createRepositoryError(
        NOTIFICATION_REPOSITORY_ERROR_CODES.DUPLICATE_IDENTIFIER,
        `Duplicate notification identifier: ${notification.notificationId}`,
        {
          notificationId: notification.notificationId,
          existingNotificationId: existingNotification.notificationId,
        },
      );
    }

    identifiers.set(normalizedIdentifier, notification);
  });
}

function assertCanonicalFieldsUnchanged(
  currentNotification,
  nextNotification,
) {
  CANONICAL_FIELDS.forEach((field) => {
    const currentValue = currentNotification[field] ?? null;
    const nextValue = nextNotification[field] ?? null;

    if (currentValue !== nextValue) {
      throw createRepositoryError(
        NOTIFICATION_REPOSITORY_ERROR_CODES.IDENTIFIER_CHANGE,
        `The canonical notification field "${field}" cannot be changed.`,
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

  const normalizedQuery = assertOptions(query, 'Notification query');

  if (
    normalizedQuery.limit !== undefined &&
    (!Number.isInteger(normalizedQuery.limit) ||
      normalizedQuery.limit < 1)
  ) {
    throw new RangeError(
      'Notification query limit must be a positive integer.',
    );
  }

  if (
    normalizedQuery.offset !== undefined &&
    (!Number.isInteger(normalizedQuery.offset) ||
      normalizedQuery.offset < 0)
  ) {
    throw new RangeError(
      'Notification query offset must be a nonnegative integer.',
    );
  }

  if (
    normalizedQuery.sortOrder !== undefined &&
    !['asc', 'desc'].includes(normalizedQuery.sortOrder)
  ) {
    throw new TypeError(
      'Notification sort order must be either "asc" or "desc".',
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
      'The notification start time cannot be after its end time.',
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

function matchesQuery(notification, query) {
  if (
    query.trackingId !== undefined &&
    !valueMatchesFilter(notification.trackingId, query.trackingId)
  ) {
    return false;
  }

  if (
    query.partnerCode !== undefined &&
    !valueMatchesFilter(notification.partnerCode, query.partnerCode)
  ) {
    return false;
  }

  if (
    query.channel !== undefined &&
    !valueMatchesFilter(notification.channel, query.channel)
  ) {
    return false;
  }

  if (
    query.channels !== undefined &&
    !valueMatchesFilter(notification.channel, query.channels)
  ) {
    return false;
  }

  if (
    query.type !== undefined &&
    !valueMatchesFilter(notification.type, query.type)
  ) {
    return false;
  }

  if (
    query.types !== undefined &&
    !valueMatchesFilter(notification.type, query.types)
  ) {
    return false;
  }

  if (
    query.status !== undefined &&
    !valueMatchesFilter(notification.status, query.status)
  ) {
    return false;
  }

  if (
    query.statuses !== undefined &&
    !valueMatchesFilter(notification.status, query.statuses)
  ) {
    return false;
  }

  if (
    query.templateCode !== undefined &&
    !valueMatchesFilter(
      notification.templateCode,
      query.templateCode,
    )
  ) {
    return false;
  }

  if (
    query.recipientMasked !== undefined &&
    !valueMatchesFilter(
      notification.recipientMasked,
      query.recipientMasked,
    )
  ) {
    return false;
  }

  const createdAt = Date.parse(notification.createdAt);

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

function createNotificationIdentifier(notification) {
  return createDeterministicId(
    'NTF',
    {
      trackingId: notification.trackingId ?? null,
      partnerCode: notification.partnerCode,
      channel: notification.channel,
      type: notification.type,
      templateCode: notification.templateCode,
      recipientMasked: notification.recipientMasked,
      createdAt: notification.createdAt,
    },
    { length: 16 },
  );
}

function resolveStorageAdapter(options) {
  if (options.storageAdapter !== undefined) {
    if (!isRepositoryStorageAdapter(options.storageAdapter)) {
      throw new TypeError(
        'The notification storage adapter must provide get, set, and remove methods.',
      );
    }

    return options.storageAdapter;
  }

  if (options.storage !== undefined && !isStorageLike(options.storage)) {
    throw new TypeError(
      'The supplied notification storage implementation is invalid.',
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
 * Stores seeded and locally generated notification previews and delivery logs.
 */
export class NotificationRepository {
  /**
   * @param {{
   *   seedNotifications?: object[],
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
        'The notification repository clock must be a function.',
      );
    }

    this.seedNotifications = validateSeedNotifications(
      normalizedOptions.seedNotifications ?? getSeeds().notificationLogs,
    );
    this.clock = normalizedOptions.clock ?? (() => new Date());
    this.storageAdapter = resolveStorageAdapter(normalizedOptions);
    this.storageKey = normalizeIdentifier(
      normalizedOptions.storageKey ??
        NOTIFICATION_REPOSITORY_STORAGE_KEY,
      'Notification repository storage key',
    );
  }

  /**
   * Lists notification logs after applying persisted overlays.
   *
   * @param {{
   *   trackingId?: string | string[] | null,
   *   partnerCode?: string | string[],
   *   channel?: string | string[],
   *   channels?: string[],
   *   type?: string | string[],
   *   types?: string[],
   *   status?: string | string[],
   *   statuses?: string[],
   *   templateCode?: string | string[],
   *   recipientMasked?: string | string[],
   *   createdFrom?: Date | string | number,
   *   createdTo?: Date | string | number,
   *   sortOrder?: 'asc' | 'desc',
   *   limit?: number,
   *   offset?: number
   * }} [query] Notification filters.
   * @returns {object[]} Matching notifications.
   */
  list(query = {}) {
    const normalizedQuery = normalizeQuery(query);
    const offset = normalizedQuery.offset ?? 0;
    const limit = normalizedQuery.limit ?? Number.POSITIVE_INFINITY;
    const direction = normalizedQuery.sortOrder === 'asc' ? 1 : -1;

    return this.readNotifications()
      .filter((notification) =>
        matchesQuery(notification, normalizedQuery),
      )
      .sort(
        (left, right) =>
          direction *
          (Date.parse(left.createdAt) - Date.parse(right.createdAt)),
      )
      .slice(offset, offset + limit)
      .map((notification) => cloneValue(notification));
  }

  /**
   * Alias for list.
   *
   * @param {object} [query] Notification filters.
   * @returns {object[]} Matching notifications.
   */
  getAll(query = {}) {
    return this.list(query);
  }

  /**
   * Finds a notification by identifier.
   *
   * @param {string | number} notificationId Notification identifier.
   * @returns {object | undefined} Matching notification.
   */
  find(notificationId) {
    const notification = this.findInCollection(
      this.readNotifications(),
      notificationId,
    );

    return notification ? cloneValue(notification) : undefined;
  }

  /**
   * Alias for find.
   *
   * @param {string | number} notificationId Notification identifier.
   * @returns {object | undefined} Matching notification.
   */
  findById(notificationId) {
    return this.find(notificationId);
  }

  /**
   * Returns notifications for a tracking identifier.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @param {object} [query] Additional filters.
   * @returns {object[]} Matching notifications.
   */
  findByTrackingId(trackingId, query = {}) {
    return this.list({
      ...assertOptions(query, 'Tracking notification query'),
      trackingId: normalizeIdentifier(
        trackingId,
        'Tracking identifier',
      ),
    });
  }

  /**
   * Returns notifications for a partner.
   *
   * @param {string | number} partnerCode Partner code.
   * @param {object} [query] Additional filters.
   * @returns {object[]} Matching notifications.
   */
  findByPartnerCode(partnerCode, query = {}) {
    return this.list({
      ...assertOptions(query, 'Partner notification query'),
      partnerCode: normalizeIdentifier(partnerCode, 'Partner code'),
    });
  }

  /**
   * Returns a notification or throws when it is absent.
   *
   * @param {string | number} notificationId Notification identifier.
   * @returns {object} Matching notification.
   */
  get(notificationId) {
    const notification = this.find(notificationId);

    if (!notification) {
      throw createRepositoryError(
        NOTIFICATION_REPOSITORY_ERROR_CODES.NOT_FOUND,
        `Notification not found: ${notificationId}`,
        { notificationId: String(notificationId) },
      );
    }

    return notification;
  }

  /**
   * Creates a simulated notification log.
   *
   * @param {object} notification Initial notification values.
   * @returns {object} Created notification.
   */
  create(notification) {
    if (!isObject(notification)) {
      throw new TypeError('A notification must be an object.');
    }

    const createdAt = toIsoTimestamp(
      notification.createdAt ?? this.clock(),
    );
    const candidate = {
      ...cloneValue(notification),
      trackingId:
        notification.trackingId === undefined
          ? null
          : normalizeNullableIdentifier(
              notification.trackingId,
              'Tracking identifier',
            ),
      partnerCode: normalizeIdentifier(
        notification.partnerCode,
        'Partner code',
      ),
      channel: normalizeIdentifier(
        notification.channel,
        'Notification channel',
      ),
      type: normalizeIdentifier(
        notification.type,
        'Notification type',
      ),
      recipientMasked: normalizeIdentifier(
        notification.recipientMasked,
        'Masked notification recipient',
      ),
      templateCode: normalizeIdentifier(
        notification.templateCode,
        'Notification template code',
      ),
      previewPayload: notification.previewPayload ?? {},
      status:
        notification.status ?? NOTIFICATION_STATUSES.PREVIEWED,
      createdAt,
      sentAt: notification.sentAt ?? null,
      failureReason: notification.failureReason ?? null,
    };

    candidate.notificationId =
      notification.notificationId ??
      createNotificationIdentifier(candidate);

    const parsedNotification = parseNotification(candidate);

    if (this.find(parsedNotification.notificationId)) {
      throw createRepositoryError(
        NOTIFICATION_REPOSITORY_ERROR_CODES.DUPLICATE_IDENTIFIER,
        `A notification already exists: ${parsedNotification.notificationId}`,
        { notificationId: parsedNotification.notificationId },
      );
    }

    const state = this.readState();
    const notifications = [
      ...this.buildNotifications(state),
      parsedNotification,
    ];

    assertUniqueIdentifiers(notifications);

    state.overlays[parsedNotification.notificationId] =
      cloneValue(parsedNotification);
    state.removedNotificationIds =
      state.removedNotificationIds.filter(
        (notificationId) =>
          notificationId !== parsedNotification.notificationId,
      );
    this.persistState(state);

    return cloneValue(parsedNotification);
  }

  /**
   * Alias for create.
   *
   * @param {object} notification Initial notification values.
   * @returns {object} Created notification.
   */
  createNotification(notification) {
    return this.create(notification);
  }

  /**
   * Creates a previewed notification log.
   *
   * @param {object} notification Initial notification values.
   * @returns {object} Created notification preview.
   */
  createPreview(notification) {
    if (!isObject(notification)) {
      throw new TypeError('A notification preview must be an object.');
    }

    return this.create({
      ...cloneValue(notification),
      status: NOTIFICATION_STATUSES.PREVIEWED,
    });
  }

  /**
   * Persists a complete notification.
   *
   * @param {object} notification Notification to persist.
   * @param {{expectedStatus?: string, expectedSentAt?: string | null}}
   * [options] Save options.
   * @returns {object} Persisted notification.
   */
  save(notification, options = {}) {
    const normalizedOptions = assertOptions(
      options,
      'Notification save options',
    );
    const parsedNotification = parseNotification(notification);
    const state = this.readState();
    const notifications = this.buildNotifications(state);
    const currentNotification = this.findInCollection(
      notifications,
      parsedNotification.notificationId,
    );

    this.assertExpectedState(currentNotification, normalizedOptions);

    if (currentNotification) {
      assertCanonicalFieldsUnchanged(
        currentNotification,
        parsedNotification,
      );
    }

    const nextNotifications = currentNotification
      ? notifications.map((candidate) =>
          candidate.notificationId ===
          currentNotification.notificationId
            ? parsedNotification
            : candidate,
        )
      : [...notifications, parsedNotification];

    assertUniqueIdentifiers(nextNotifications);

    state.overlays[parsedNotification.notificationId] =
      cloneValue(parsedNotification);
    state.removedNotificationIds =
      state.removedNotificationIds.filter(
        (notificationId) =>
          notificationId !== parsedNotification.notificationId,
      );
    this.persistState(state);

    return cloneValue(parsedNotification);
  }

  /**
   * Alias for save.
   *
   * @param {object} notification Notification to persist.
   * @param {object} [options] Save options.
   * @returns {object} Persisted notification.
   */
  upsert(notification, options = {}) {
    return this.save(notification, options);
  }

  /**
   * Atomically patches a notification.
   *
   * @param {string | number} notificationId Notification identifier.
   * @param {object | ((notification: object) => object)} update
   * Notification patch or updater.
   * @param {{expectedStatus?: string, expectedSentAt?: string | null}}
   * [options] Update options.
   * @returns {object} Updated notification.
   */
  update(notificationId, update, options = {}) {
    const normalizedOptions = assertOptions(
      options,
      'Notification update options',
    );

    if (typeof update !== 'function' && !isObject(update)) {
      throw new TypeError(
        'A notification update must be an object or updater function.',
      );
    }

    const state = this.readState();
    const notifications = this.buildNotifications(state);
    const currentNotification = this.findInCollection(
      notifications,
      notificationId,
    );

    if (!currentNotification) {
      throw createRepositoryError(
        NOTIFICATION_REPOSITORY_ERROR_CODES.NOT_FOUND,
        `Notification not found: ${notificationId}`,
        { notificationId: String(notificationId) },
      );
    }

    this.assertExpectedState(currentNotification, normalizedOptions);

    const updateValue =
      typeof update === 'function'
        ? update(cloneValue(currentNotification))
        : update;

    if (!isObject(updateValue)) {
      throw new TypeError(
        'The notification updater must return a notification or patch object.',
      );
    }

    const nextNotification = parseNotification(
      deepMerge(currentNotification, updateValue),
    );

    assertCanonicalFieldsUnchanged(
      currentNotification,
      nextNotification,
    );

    state.overlays[currentNotification.notificationId] =
      cloneValue(nextNotification);
    state.removedNotificationIds =
      state.removedNotificationIds.filter(
        (removedNotificationId) =>
          removedNotificationId !==
          currentNotification.notificationId,
      );
    this.persistState(state);

    return cloneValue(nextNotification);
  }

  /**
   * Alias for update emphasizing transactional behavior.
   *
   * @param {string | number} notificationId Notification identifier.
   * @param {object | ((notification: object) => object)} update
   * Notification patch or updater.
   * @param {object} [options] Update options.
   * @returns {object} Updated notification.
   */
  atomicUpdate(notificationId, update, options = {}) {
    return this.update(notificationId, update, options);
  }

  /**
   * Updates notification delivery status.
   *
   * @param {string | number} notificationId Notification identifier.
   * @param {string} status New notification status.
   * @param {{
   *   failureReason?: string | null,
   *   sentAt?: Date | string | number | null,
   *   expectedStatus?: string
   * }} [options] Status options.
   * @returns {object} Updated notification.
   */
  setStatus(notificationId, status, options = {}) {
    const normalizedOptions = assertOptions(
      options,
      'Notification status options',
    );
    const normalizedStatus = normalizeIdentifier(
      status,
      'Notification status',
    );
    const validStatuses = Object.values(NOTIFICATION_STATUSES);

    if (!validStatuses.includes(normalizedStatus)) {
      throw createRepositoryError(
        NOTIFICATION_REPOSITORY_ERROR_CODES.INVALID_NOTIFICATION,
        `Unsupported notification status: ${normalizedStatus}`,
        {
          status: normalizedStatus,
          supportedStatuses: validStatuses,
        },
      );
    }

    let sentAt;

    if (normalizedOptions.sentAt === null) {
      sentAt = null;
    } else if (normalizedOptions.sentAt !== undefined) {
      sentAt = toIsoTimestamp(normalizedOptions.sentAt);
    } else if (
      [
        NOTIFICATION_STATUSES.SENT,
        NOTIFICATION_STATUSES.DELIVERED,
      ].includes(normalizedStatus)
    ) {
      sentAt = toIsoTimestamp(this.clock());
    }

    const failureReason =
      normalizedOptions.failureReason === undefined
        ? normalizedStatus === NOTIFICATION_STATUSES.FAILED
          ? 'The simulated notification delivery failed.'
          : null
        : normalizedOptions.failureReason === null
          ? null
          : normalizeIdentifier(
              normalizedOptions.failureReason,
              'Notification failure reason',
            );

    return this.update(
      notificationId,
      {
        status: normalizedStatus,
        failureReason,
        ...(sentAt === undefined ? {} : { sentAt }),
      },
      {
        expectedStatus: normalizedOptions.expectedStatus,
      },
    );
  }

  /**
   * Marks a notification as queued.
   *
   * @param {string | number} notificationId Notification identifier.
   * @param {object} [options] Status options.
   * @returns {object} Updated notification.
   */
  markQueued(notificationId, options = {}) {
    return this.setStatus(
      notificationId,
      NOTIFICATION_STATUSES.QUEUED,
      options,
    );
  }

  /**
   * Marks a notification as sent.
   *
   * @param {string | number} notificationId Notification identifier.
   * @param {object} [options] Status options.
   * @returns {object} Updated notification.
   */
  markSent(notificationId, options = {}) {
    return this.setStatus(
      notificationId,
      NOTIFICATION_STATUSES.SENT,
      options,
    );
  }

  /**
   * Marks a notification as delivered.
   *
   * @param {string | number} notificationId Notification identifier.
   * @param {object} [options] Status options.
   * @returns {object} Updated notification.
   */
  markDelivered(notificationId, options = {}) {
    return this.setStatus(
      notificationId,
      NOTIFICATION_STATUSES.DELIVERED,
      options,
    );
  }

  /**
   * Marks a notification as failed.
   *
   * @param {string | number} notificationId Notification identifier.
   * @param {string} failureReason Failure reason.
   * @param {object} [options] Status options.
   * @returns {object} Updated notification.
   */
  markFailed(notificationId, failureReason, options = {}) {
    return this.setStatus(
      notificationId,
      NOTIFICATION_STATUSES.FAILED,
      {
        ...assertOptions(options, 'Failed notification options'),
        failureReason: normalizeIdentifier(
          failureReason,
          'Notification failure reason',
        ),
      },
    );
  }

  /**
   * Marks a notification as suppressed.
   *
   * @param {string | number} notificationId Notification identifier.
   * @param {object} [options] Status options.
   * @returns {object} Updated notification.
   */
  markSuppressed(notificationId, options = {}) {
    return this.setStatus(
      notificationId,
      NOTIFICATION_STATUSES.SUPPRESSED,
      options,
    );
  }

  /**
   * Marks an in-app notification as read.
   *
   * @param {string | number} notificationId Notification identifier.
   * @param {object} [options] Status options.
   * @returns {object} Updated notification.
   */
  markRead(notificationId, options = {}) {
    return this.setStatus(
      notificationId,
      NOTIFICATION_STATUSES.READ,
      options,
    );
  }

  /**
   * Determines whether an outstanding agency review request blocks carrier
   * submission for a tracking identifier.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @returns {boolean} Whether carrier submission remains blocked.
   */
  shouldBlockCarrierSubmission(trackingId) {
    const notifications = this.findByTrackingId(trackingId, {
      types: [
        NOTIFICATION_TYPES.AGENCY_REVIEW_REQUEST,
        NOTIFICATION_TYPES.AGENCY_REVIEW_COMPLETED,
      ],
      sortOrder: 'desc',
    });
    const latestRequest = notifications.find(
      (notification) =>
        notification.type ===
        NOTIFICATION_TYPES.AGENCY_REVIEW_REQUEST,
    );

    if (!latestRequest) {
      return false;
    }

    const latestCompletion = notifications.find(
      (notification) =>
        notification.type ===
        NOTIFICATION_TYPES.AGENCY_REVIEW_COMPLETED,
    );

    return (
      !latestCompletion ||
      Date.parse(latestRequest.createdAt) >
        Date.parse(latestCompletion.createdAt)
    );
  }

  /**
   * Returns notification visibility flags for an onboarding record.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @returns {{
   *   trackingId: string,
   *   carrierSubmissionBlocked: boolean,
   *   hasWelcomeNotification: boolean,
   *   hasReminder: boolean,
   *   latestNotificationAt: string | null,
   *   notificationCount: number
   * }} Notification visibility flags.
   */
  getVisibilityFlags(trackingId) {
    const normalizedTrackingId = normalizeIdentifier(
      trackingId,
      'Tracking identifier',
    );
    const notifications = this.findByTrackingId(normalizedTrackingId);

    return Object.freeze({
      trackingId: normalizedTrackingId,
      carrierSubmissionBlocked:
        this.shouldBlockCarrierSubmission(normalizedTrackingId),
      hasWelcomeNotification: notifications.some(
        (notification) =>
          notification.type === NOTIFICATION_TYPES.WELCOME,
      ),
      hasReminder: notifications.some(
        (notification) =>
          notification.type === NOTIFICATION_TYPES.REMINDER,
      ),
      latestNotificationAt: notifications[0]?.createdAt ?? null,
      notificationCount: notifications.length,
    });
  }

  /**
   * Returns counts grouped by notification status.
   *
   * @param {object} [query] Base notification filters.
   * @returns {Record<string, number>} Notification status counts.
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
      Object.values(NOTIFICATION_STATUSES).map((status) => [status, 0]),
    );

    this.readNotifications()
      .filter((notification) =>
        matchesQuery(notification, baseQuery),
      )
      .forEach((notification) => {
        counts[notification.status] =
          (counts[notification.status] ?? 0) + 1;
      });

    return Object.freeze(counts);
  }

  /**
   * Removes a notification.
   *
   * @param {string | number} notificationId Notification identifier.
   * @returns {boolean} Whether a notification was removed.
   */
  remove(notificationId) {
    const state = this.readState();
    const notifications = this.buildNotifications(state);
    const notification = this.findInCollection(
      notifications,
      notificationId,
    );

    if (!notification) {
      return false;
    }

    const isSeedNotification = this.seedNotifications.some(
      (seedNotification) =>
        seedNotification.notificationId ===
        notification.notificationId,
    );

    delete state.overlays[notification.notificationId];

    if (
      isSeedNotification &&
      !state.removedNotificationIds.includes(
        notification.notificationId,
      )
    ) {
      state.removedNotificationIds.push(notification.notificationId);
    }

    this.persistState(state);
    return true;
  }

  /**
   * Alias for remove.
   *
   * @param {string | number} notificationId Notification identifier.
   * @returns {boolean} Whether a notification was removed.
   */
  delete(notificationId) {
    return this.remove(notificationId);
  }

  /**
   * Removes persisted changes and restores seeded notification logs.
   *
   * @returns {object[]} Seeded notification logs.
   */
  reset() {
    const removed = this.storageAdapter.remove(this.storageKey);

    if (!removed) {
      throw this.createPersistenceError('reset');
    }

    return this.seedNotifications.map((notification) =>
      cloneValue(notification),
    );
  }

  readState() {
    const state = this.storageAdapter.get(
      this.storageKey,
      notificationRepositoryStateSchema,
      createEmptyState(),
    );

    return cloneValue(state);
  }

  buildNotifications(state) {
    const removedIdentifiers = new Set(
      state.removedNotificationIds,
    );
    const notificationsById = new Map();

    this.seedNotifications.forEach((notification) => {
      if (!removedIdentifiers.has(notification.notificationId)) {
        notificationsById.set(
          notification.notificationId,
          cloneValue(notification),
        );
      }
    });

    Object.entries(state.overlays).forEach(
      ([notificationId, overlay]) => {
        if (removedIdentifiers.has(notificationId)) {
          return;
        }

        if (!isObject(overlay)) {
          throw createRepositoryError(
            NOTIFICATION_REPOSITORY_ERROR_CODES.INVALID_NOTIFICATION,
            `Invalid persisted notification overlay: ${notificationId}`,
            { notificationId },
          );
        }

        const existingNotification =
          notificationsById.get(notificationId);
        const mergedNotification = existingNotification
          ? deepMerge(existingNotification, overlay)
          : cloneValue(overlay);
        const parsedNotification = parseNotification(
          mergedNotification,
        );

        if (parsedNotification.notificationId !== notificationId) {
          throw createRepositoryError(
            NOTIFICATION_REPOSITORY_ERROR_CODES.INVALID_NOTIFICATION,
            'A persisted notification has a mismatched identifier.',
            {
              overlayKey: notificationId,
              notificationId: parsedNotification.notificationId,
            },
          );
        }

        notificationsById.set(notificationId, parsedNotification);
      },
    );

    const notifications = [...notificationsById.values()];

    assertUniqueIdentifiers(notifications);
    return notifications;
  }

  readNotifications() {
    try {
      return this.buildNotifications(this.readState());
    } catch {
      this.storageAdapter.remove(this.storageKey);
      return this.seedNotifications.map((notification) =>
        cloneValue(notification),
      );
    }
  }

  findInCollection(notifications, notificationId) {
    const normalizedNotificationId = normalizeIdentifierForLookup(
      notificationId,
      'Notification identifier',
    );

    return notifications.find(
      (notification) =>
        normalizeIdentifierForLookup(
          notification.notificationId,
          'Notification identifier',
        ) === normalizedNotificationId,
    );
  }

  assertExpectedState(notification, options) {
    if (!notification) {
      return;
    }

    if (
      options.expectedStatus !== undefined &&
      notification.status !== options.expectedStatus
    ) {
      throw createRepositoryError(
        NOTIFICATION_REPOSITORY_ERROR_CODES.CONFLICT,
        'The notification status changed after it was last read.',
        {
          notificationId: notification.notificationId,
          expectedStatus: options.expectedStatus,
          actualStatus: notification.status,
        },
      );
    }

    if (
      options.expectedSentAt !== undefined &&
      (notification.sentAt ?? null) !== options.expectedSentAt
    ) {
      throw createRepositoryError(
        NOTIFICATION_REPOSITORY_ERROR_CODES.CONFLICT,
        'The notification delivery state changed after it was last read.',
        {
          notificationId: notification.notificationId,
          expectedSentAt: options.expectedSentAt,
          actualSentAt: notification.sentAt ?? null,
        },
      );
    }
  }

  persistState(state) {
    const result = notificationRepositoryStateSchema.safeParse(state);

    if (!result.success) {
      throw createRepositoryError(
        NOTIFICATION_REPOSITORY_ERROR_CODES.PERSISTENCE_FAILED,
        'The notification repository state is invalid.',
        { issues: result.error.issues },
        result.error,
      );
    }

    if (
      !this.storageAdapter.set(
        this.storageKey,
        result.data,
        notificationRepositoryStateSchema,
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
      NOTIFICATION_REPOSITORY_ERROR_CODES.PERSISTENCE_FAILED,
      `Unable to ${operation} persisted notifications.`,
      {
        operation,
        storageError: storageError ?? null,
      },
      storageError,
    );
  }
}

/**
 * Creates a notification repository.
 *
 * @param {ConstructorParameters<typeof NotificationRepository>[0]} [options]
 * Repository options.
 * @returns {NotificationRepository} Repository instance.
 */
export function createNotificationRepository(options = {}) {
  return new NotificationRepository(options);
}

export const NotificationLogRepository = NotificationRepository;
export const NotificationVisibilityRepository = NotificationRepository;
export const createNotificationLogRepository =
  createNotificationRepository;
export const createNotificationVisibilityRepository =
  createNotificationRepository;

export default NotificationRepository;