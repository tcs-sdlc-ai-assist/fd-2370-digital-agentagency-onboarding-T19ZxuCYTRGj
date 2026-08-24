import {
  AUDIT_ACTOR_TYPES,
  AUDIT_SOURCES,
} from '../../constants/domain.js';
import { AuditRepository } from '../../repositories/auditRepository.js';
import { toIsoTimestamp } from '../../utils/dates.js';
import {
  generateAuditEventId,
  generateCorrelationId,
} from '../../utils/ids.js';
import { redactForAudit } from '../../utils/redaction.js';

export const AUDIT_SERVICE_ERROR_CODES = Object.freeze({
  INVALID_EVENT: 'AUDIT_SERVICE_INVALID_EVENT',
  INVALID_QUERY: 'AUDIT_SERVICE_INVALID_QUERY',
  INVALID_ACTOR: 'AUDIT_SERVICE_INVALID_ACTOR',
  REPOSITORY_UNAVAILABLE: 'AUDIT_SERVICE_REPOSITORY_UNAVAILABLE',
  APPEND_FAILED: 'AUDIT_SERVICE_APPEND_FAILED',
  QUERY_FAILED: 'AUDIT_SERVICE_QUERY_FAILED',
});

const PARTNER_ROLES = new Set(['partner', 'agency']);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertOptions(options, description = 'Audit service options') {
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

function cloneValue(value) {
  if (value === undefined) {
    return undefined;
  }

  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value));
}

function createAuditServiceError(code, message, details, cause) {
  const error = new Error(message, {
    ...(cause === undefined ? {} : { cause }),
  });

  error.name = 'AuditServiceError';
  error.code = code;
  error.details = details ?? null;

  return error;
}

function assertRepository(repository) {
  if (
    !isObject(repository) ||
    typeof repository.append !== 'function' ||
    typeof repository.list !== 'function'
  ) {
    throw createAuditServiceError(
      AUDIT_SERVICE_ERROR_CODES.REPOSITORY_UNAVAILABLE,
      'The audit repository must provide append and list methods.',
      null,
    );
  }

  return repository;
}

function normalizeActorType(actorType, role) {
  if (actorType !== undefined && actorType !== null) {
    return normalizeIdentifier(actorType, 'Audit actor type');
  }

  if (role && PARTNER_ROLES.has(String(role).trim().toLowerCase())) {
    return AUDIT_ACTOR_TYPES.PARTNER_USER;
  }

  return role
    ? AUDIT_ACTOR_TYPES.INTERNAL_USER
    : AUDIT_ACTOR_TYPES.SYSTEM;
}

function resolveActor(event, options, defaultActor) {
  const actorCandidate =
    options.actor ??
    event.actor ??
    defaultActor ??
    {};
  const actor = isObject(actorCandidate) ? actorCandidate : {};
  const role =
    options.actorRole ??
    event.actorRole ??
    actor.role ??
    actor.user?.role;
  const actorId =
    options.actorId ??
    event.actorId ??
    actor.actorId ??
    actor.userId ??
    actor.id ??
    actor.user?.id ??
    'system';
  const actorType = normalizeActorType(
    options.actorType ?? event.actorType ?? actor.actorType,
    role,
  );

  return {
    actorId: normalizeIdentifier(actorId, 'Audit actor identifier'),
    actorType,
    metadata: {
      id: actor.id ?? actor.user?.id ?? null,
      userId: actor.userId ?? actor.user?.id ?? null,
      role: role ?? null,
      organization:
        actor.organization ?? actor.user?.organization ?? null,
      partnerCode:
        actor.partnerCode ??
        actor.partnerContext?.partnerCode ??
        actor.user?.partnerCode ??
        null,
      displayName:
        actor.displayName ??
        actor.name ??
        (actor.firstName || actor.lastName
          ? [actor.firstName, actor.lastName].filter(Boolean).join(' ')
          : null),
    },
  };
}

function normalizeAppendArguments(
  eventOrAction,
  detailsOrOptions,
  appendOptions,
) {
  if (typeof eventOrAction === 'string') {
    const details = assertOptions(
      detailsOrOptions,
      'Audit event details',
    );

    return {
      event: {
        ...cloneValue(details),
        action: eventOrAction,
      },
      options: assertOptions(
        appendOptions,
        'Audit append options',
      ),
    };
  }

  if (!isObject(eventOrAction)) {
    throw createAuditServiceError(
      AUDIT_SERVICE_ERROR_CODES.INVALID_EVENT,
      'An audit event must be an object or an action string.',
      null,
    );
  }

  return {
    event: cloneValue(eventOrAction),
    options: assertOptions(
      detailsOrOptions,
      'Audit append options',
    ),
  };
}

function normalizeQueryArguments(queryOrRecordId, options) {
  if (
    typeof queryOrRecordId === 'string' ||
    typeof queryOrRecordId === 'number'
  ) {
    return {
      ...assertOptions(options, 'Audit query options'),
      recordId: normalizeIdentifier(
        queryOrRecordId,
        'Audit record identifier',
      ),
    };
  }

  if (queryOrRecordId === undefined) {
    return {};
  }

  return assertOptions(queryOrRecordId, 'Audit query');
}

function createRepository(options) {
  if (options.repository !== undefined) {
    return assertRepository(options.repository);
  }

  return new AuditRepository({
    ...(options.seedEvents === undefined
      ? {}
      : { seedEvents: options.seedEvents }),
    ...(options.storageAdapter === undefined
      ? {}
      : { storageAdapter: options.storageAdapter }),
    ...(options.storage === undefined
      ? {}
      : { storage: options.storage }),
    ...(options.storageKey === undefined
      ? {}
      : { storageKey: options.storageKey }),
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
  });
}

/**
 * Appends and queries redacted audit events.
 */
export class AuditService {
  /**
   * @param {{
   *   repository?: object,
   *   seedEvents?: object[],
   *   storageAdapter?: object,
   *   storage?: Storage,
   *   storageKey?: string,
   *   namespace?: string,
   *   schemaVersion?: number,
   *   clock?: () => Date | string | number,
   *   defaultActor?: object,
   *   defaultSource?: string,
   *   redact?: (value: unknown) => unknown,
   *   onStorageError?: (error: object) => void
   * }} [options] Audit service options.
   */
  constructor(options = {}) {
    const normalizedOptions = assertOptions(options);

    if (
      normalizedOptions.clock !== undefined &&
      typeof normalizedOptions.clock !== 'function'
    ) {
      throw new TypeError('The audit service clock must be a function.');
    }

    if (
      normalizedOptions.redact !== undefined &&
      typeof normalizedOptions.redact !== 'function'
    ) {
      throw new TypeError(
        'The audit service redaction handler must be a function.',
      );
    }

    if (
      normalizedOptions.defaultActor !== undefined &&
      !isObject(normalizedOptions.defaultActor)
    ) {
      throw new TypeError(
        'The default audit actor must be an object.',
      );
    }

    this.clock = normalizedOptions.clock ?? (() => new Date());
    this.defaultActor = normalizedOptions.defaultActor ?? null;
    this.defaultSource =
      normalizedOptions.defaultSource ?? AUDIT_SOURCES.WORKFLOW_ENGINE;
    this.redact = normalizedOptions.redact ?? redactForAudit;
    this.repository = createRepository(normalizedOptions);
  }

  /**
   * Appends a generated, correlated, timestamped, and redacted audit event.
   *
   * The preferred signature is `append(event, options)`. The
   * `append(action, event, options)` form is also supported.
   *
   * @param {object | string} eventOrAction Audit event or action.
   * @param {object} [detailsOrOptions] Event details or append options.
   * @param {object} [appendOptions] Options for the action-first form.
   * @returns {object} Persisted audit event.
   */
  append(eventOrAction, detailsOrOptions = {}, appendOptions = {}) {
    const { event, options } = normalizeAppendArguments(
      eventOrAction,
      detailsOrOptions,
      appendOptions,
    );

    try {
      const timestamp = toIsoTimestamp(
        options.timestamp ?? event.timestamp ?? this.clock(),
      );
      const actor = resolveActor(
        event,
        options,
        this.defaultActor,
      );
      const action =
        event.action === undefined
          ? undefined
          : normalizeIdentifier(event.action, 'Audit action');
      const source = normalizeIdentifier(
        options.source ??
          event.source ??
          this.defaultSource,
        'Audit source',
      );
      const summary = normalizeIdentifier(
        options.summary ??
          event.summary ??
          event.message ??
          action ??
          'Audit event recorded.',
        'Audit event summary',
      );
      const sourceRecordId =
        options.sourceRecordId ??
        options.recordId ??
        event.sourceRecordId ??
        event.recordId;
      const correlationId = normalizeIdentifier(
        options.correlationId ??
          event.correlationId ??
          event.metadata?.correlationId ??
          generateCorrelationId({
            action: action ?? null,
            actorId: actor.actorId,
            applicationId: event.applicationId ?? null,
            source,
            sourceRecordId: sourceRecordId ?? null,
            timestamp,
            trackingId: event.trackingId ?? null,
          }),
        'Audit correlation identifier',
      );
      const auditEventId =
        event.auditEventId ??
        (event.lifecycleEventId === undefined
          ? generateAuditEventId({
              action: action ?? null,
              actorId: actor.actorId,
              actorType: actor.actorType,
              applicationId: event.applicationId ?? null,
              correlationId,
              source,
              sourceRecordId: sourceRecordId ?? null,
              timestamp,
              trackingId: event.trackingId ?? null,
            })
          : undefined);
      const metadata = {
        ...(isObject(event.metadata)
          ? cloneValue(event.metadata)
          : {}),
        ...(isObject(options.metadata)
          ? cloneValue(options.metadata)
          : {}),
        correlationId,
        actor: actor.metadata,
      };
      const candidate = {
        ...event,
        ...(auditEventId === undefined ? {} : { auditEventId }),
        ...(action === undefined ? {} : { action }),
        actorId: actor.actorId,
        actorType: actor.actorType,
        source,
        summary,
        timestamp,
        correlationId,
        metadata,
        trackingId: event.trackingId ?? null,
        ...(sourceRecordId === undefined
          ? {}
          : {
              sourceRecordId: normalizeIdentifier(
                sourceRecordId,
                'Audit source record identifier',
              ),
            }),
      };

      delete candidate.actor;
      delete candidate.message;
      delete candidate.recordId;

      const redactedEvent = this.redact(candidate);
      const persistedEvent = this.repository.append(redactedEvent);

      return cloneValue(this.redact(persistedEvent));
    } catch (error) {
      if (
        error?.name === 'AuditRepositoryError' ||
        error?.name === 'AuditServiceError' ||
        error instanceof TypeError ||
        error instanceof RangeError
      ) {
        throw error;
      }

      throw createAuditServiceError(
        AUDIT_SERVICE_ERROR_CODES.APPEND_FAILED,
        'Unable to append the audit event.',
        {
          action: event.action ?? null,
          recordId:
            event.sourceRecordId ?? event.recordId ?? null,
        },
        error,
      );
    }
  }

  /**
   * Queries audit events and redacts returned values.
   *
   * A record identifier may be supplied directly as shorthand for a
   * `recordId` query.
   *
   * @param {object | string | number} [queryOrRecordId] Query or record ID.
   * @param {object} [options] Additional record query options.
   * @returns {object[]} Matching redacted audit events.
   */
  query(queryOrRecordId = {}, options = {}) {
    let query;

    try {
      query = normalizeQueryArguments(queryOrRecordId, options);
      const events = this.repository.list(query);

      if (!Array.isArray(events)) {
        throw createAuditServiceError(
          AUDIT_SERVICE_ERROR_CODES.QUERY_FAILED,
          'The audit repository returned an invalid event collection.',
          null,
        );
      }

      return events.map((event) =>
        cloneValue(this.redact(event)),
      );
    } catch (error) {
      if (
        error?.name === 'AuditRepositoryError' ||
        error?.name === 'AuditServiceError' ||
        error instanceof TypeError ||
        error instanceof RangeError
      ) {
        throw error;
      }

      throw createAuditServiceError(
        AUDIT_SERVICE_ERROR_CODES.QUERY_FAILED,
        'Unable to query audit events.',
        { query: query ?? null },
        error,
      );
    }
  }

  /**
   * Alias for query.
   *
   * @param {object | string | number} [queryOrRecordId] Query or record ID.
   * @param {object} [options] Additional query options.
   * @returns {object[]} Matching audit events.
   */
  list(queryOrRecordId = {}, options = {}) {
    return this.query(queryOrRecordId, options);
  }

  /**
   * Returns audit events for a record identifier.
   *
   * @param {string | number} recordId Record identifier.
   * @param {object} [query] Additional query filters.
   * @returns {object[]} Matching audit events.
   */
  queryByRecordId(recordId, query = {}) {
    return this.query(recordId, query);
  }

  /**
   * Returns audit events for an actor.
   *
   * @param {string | number} actorId Actor identifier.
   * @param {object} [query] Additional query filters.
   * @returns {object[]} Matching audit events.
   */
  queryByActorId(actorId, query = {}) {
    return this.query({
      ...assertOptions(query, 'Actor audit query'),
      actorId: normalizeIdentifier(actorId, 'Audit actor identifier'),
    });
  }
}

/**
 * Creates an audit service.
 *
 * @param {ConstructorParameters<typeof AuditService>[0]} [options]
 * Audit service options.
 * @returns {AuditService} Audit service instance.
 */
export function createAuditService(options = {}) {
  return new AuditService(options);
}

export const auditService = createAuditService();

/**
 * Appends an event using the shared audit service.
 *
 * @param {object | string} eventOrAction Audit event or action.
 * @param {object} [detailsOrOptions] Event details or options.
 * @param {object} [appendOptions] Action-first append options.
 * @returns {object} Persisted audit event.
 */
export function append(
  eventOrAction,
  detailsOrOptions = {},
  appendOptions = {},
) {
  return auditService.append(
    eventOrAction,
    detailsOrOptions,
    appendOptions,
  );
}

/**
 * Queries events using the shared audit service.
 *
 * @param {object | string | number} [queryOrRecordId] Query or record ID.
 * @param {object} [options] Additional query options.
 * @returns {object[]} Matching audit events.
 */
export function query(queryOrRecordId = {}, options = {}) {
  return auditService.query(queryOrRecordId, options);
}

export const appendAuditEvent = append;
export const queryAuditEvents = query;

export const AuditModule = Object.freeze({
  append,
  query,
  service: auditService,
  createAuditService,
});

export default AuditService;