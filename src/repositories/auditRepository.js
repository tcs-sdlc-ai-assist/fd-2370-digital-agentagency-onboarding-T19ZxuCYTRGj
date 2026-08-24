import { z } from 'zod';
import { STORAGE_KEYS } from '../constants/storageKeys.js';
import { auditEventSchema } from '../contracts/schemas.js';
import { BrowserStorageAdapter } from '../persistence/browserStorageAdapter.js';
import { getSeeds } from '../persistence/seedLoader.js';
import { toIsoTimestamp } from '../utils/dates.js';
import { generateAuditEventId } from '../utils/ids.js';

const identifierSchema = z.string().trim().min(1);

export const AUDIT_REPOSITORY_STORAGE_KEY =
  `${STORAGE_KEYS.OPERATIONS}:audit-events`;

export const auditRepositoryStateSchema = z
  .object({
    events: z.record(z.unknown()).default({}),
  })
  .passthrough();

export const AUDIT_REPOSITORY_ERROR_CODES = Object.freeze({
  INVALID_EVENT: 'AUDIT_EVENT_INVALID',
  NOT_FOUND: 'AUDIT_EVENT_NOT_FOUND',
  DUPLICATE_IDENTIFIER: 'AUDIT_EVENT_DUPLICATE_IDENTIFIER',
  PERSISTENCE_FAILED: 'AUDIT_EVENT_PERSISTENCE_FAILED',
});

const RECORD_IDENTIFIER_FIELDS = Object.freeze([
  'applicationId',
  'trackingId',
  'sourceRecordId',
  'intakeId',
  'draftId',
  'workItemId',
  'assignmentId',
  'changeRequestId',
  'notificationId',
  'syncAttemptId',
  'userId',
  'checkId',
  'referenceId',
  'documentPackageId',
]);

const METADATA_RECORD_IDENTIFIER_FIELDS = Object.freeze([
  ...RECORD_IDENTIFIER_FIELDS,
  'recordId',
  'entityId',
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

function assertOptions(options, description = 'Audit repository options') {
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

function normalizeIdentifierForLookup(
  value,
  description = 'Identifier',
) {
  return normalizeIdentifier(value, description)
    .normalize('NFKC')
    .toLowerCase();
}

function normalizeOptionalIdentifier(value, description) {
  if (value === null || value === undefined) {
    return null;
  }

  return normalizeIdentifier(value, description);
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

function formatValidationIssues(error) {
  return error.issues
    .map((issue) => {
      const path =
        issue.path.length > 0 ? issue.path.join('.') : 'auditEvent';

      return `${path}: ${issue.message}`;
    })
    .join('; ');
}

function createRepositoryError(code, message, details, cause) {
  const error = new Error(message, {
    ...(cause === undefined ? {} : { cause }),
  });

  error.name = 'AuditRepositoryError';
  error.code = code;
  error.details = details ?? null;

  return error;
}

function parseAuditEvent(event) {
  const result = auditEventSchema.safeParse(event);

  if (!result.success) {
    throw createRepositoryError(
      AUDIT_REPOSITORY_ERROR_CODES.INVALID_EVENT,
      `Invalid audit event: ${formatValidationIssues(result.error)}`,
      { issues: result.error.issues },
      result.error,
    );
  }

  return result.data;
}

function getEventIdentifier(event) {
  return event.auditEventId ?? event.lifecycleEventId;
}

function validateSeedEvents(seedEvents) {
  if (!Array.isArray(seedEvents)) {
    throw new TypeError('Audit event seed records must be an array.');
  }

  const parsedEvents = seedEvents.map((event) => parseAuditEvent(event));

  assertUniqueEventIdentifiers(parsedEvents);
  return parsedEvents;
}

function createEmptyState() {
  return {
    events: {},
  };
}

function assertUniqueEventIdentifiers(events) {
  const identifiers = new Map();

  events.forEach((event) => {
    const eventId = getEventIdentifier(event);
    const normalizedEventId = normalizeIdentifierForLookup(
      eventId,
      'Audit event identifier',
    );
    const existingEvent = identifiers.get(normalizedEventId);

    if (existingEvent) {
      throw createRepositoryError(
        AUDIT_REPOSITORY_ERROR_CODES.DUPLICATE_IDENTIFIER,
        `Duplicate audit event identifier: ${eventId}`,
        {
          eventId,
          existingEventId: getEventIdentifier(existingEvent),
        },
      );
    }

    identifiers.set(normalizedEventId, event);
  });
}

function addIndexEntry(index, key, event) {
  if (
    key === null ||
    key === undefined ||
    String(key).trim() === ''
  ) {
    return;
  }

  const normalizedKey = normalizeIdentifierForLookup(key);
  const events = index.get(normalizedKey) ?? [];

  events.push(event);
  index.set(normalizedKey, events);
}

function collectRecordIdentifiers(event) {
  const identifiers = new Set();

  RECORD_IDENTIFIER_FIELDS.forEach((field) => {
    const value = event[field];

    if (
      value !== null &&
      value !== undefined &&
      String(value).trim() !== ''
    ) {
      identifiers.add(String(value).trim());
    }
  });

  if (isObject(event.metadata)) {
    METADATA_RECORD_IDENTIFIER_FIELDS.forEach((field) => {
      const value = event.metadata[field];

      if (Array.isArray(value)) {
        value.forEach((identifier) => {
          if (
            identifier !== null &&
            identifier !== undefined &&
            String(identifier).trim() !== ''
          ) {
            identifiers.add(String(identifier).trim());
          }
        });

        return;
      }

      if (
        value !== null &&
        value !== undefined &&
        String(value).trim() !== ''
      ) {
        identifiers.add(String(value).trim());
      }
    });
  }

  return [...identifiers];
}

function buildEventIndexes(events) {
  const byId = new Map();
  const byRecordId = new Map();
  const byActorId = new Map();
  const byActor = new Map();

  events.forEach((event) => {
    const eventId = getEventIdentifier(event);

    byId.set(
      normalizeIdentifierForLookup(eventId, 'Audit event identifier'),
      event,
    );

    collectRecordIdentifiers(event).forEach((recordId) => {
      addIndexEntry(byRecordId, recordId, event);
    });

    addIndexEntry(byActorId, event.actorId, event);
    addIndexEntry(
      byActor,
      `${event.actorType}:${event.actorId}`,
      event,
    );
  });

  return {
    byId,
    byRecordId,
    byActorId,
    byActor,
  };
}

function normalizeQuery(query) {
  if (query === undefined) {
    return {};
  }

  const normalizedQuery = assertOptions(query, 'Audit event query');

  if (
    normalizedQuery.limit !== undefined &&
    (!Number.isInteger(normalizedQuery.limit) ||
      normalizedQuery.limit < 1)
  ) {
    throw new RangeError(
      'Audit event query limit must be a positive integer.',
    );
  }

  if (
    normalizedQuery.offset !== undefined &&
    (!Number.isInteger(normalizedQuery.offset) ||
      normalizedQuery.offset < 0)
  ) {
    throw new RangeError(
      'Audit event query offset must be a nonnegative integer.',
    );
  }

  if (
    normalizedQuery.sortOrder !== undefined &&
    !['asc', 'desc'].includes(normalizedQuery.sortOrder)
  ) {
    throw new TypeError(
      'Audit event sort order must be either "asc" or "desc".',
    );
  }

  const normalizedSince =
    normalizedQuery.since === undefined
      ? undefined
      : Date.parse(toIsoTimestamp(normalizedQuery.since));
  const normalizedUntil =
    normalizedQuery.until === undefined
      ? undefined
      : Date.parse(toIsoTimestamp(normalizedQuery.until));

  if (
    normalizedSince !== undefined &&
    normalizedUntil !== undefined &&
    normalizedSince > normalizedUntil
  ) {
    throw new RangeError(
      'The audit query start time cannot be after its end time.',
    );
  }

  return {
    ...normalizedQuery,
    normalizedSince,
    normalizedUntil,
  };
}

function valueMatchesFilter(value, filter) {
  if (Array.isArray(filter)) {
    return filter.includes(value);
  }

  return value === filter;
}

function eventHasRecordIdentifier(event, recordId) {
  const normalizedRecordId = normalizeIdentifierForLookup(
    recordId,
    'Record identifier',
  );

  return collectRecordIdentifiers(event).some(
    (identifier) =>
      normalizeIdentifierForLookup(identifier, 'Record identifier') ===
      normalizedRecordId,
  );
}

function matchesQuery(event, query) {
  if (
    query.recordId !== undefined &&
    !eventHasRecordIdentifier(event, query.recordId)
  ) {
    return false;
  }

  if (
    query.trackingId !== undefined &&
    !valueMatchesFilter(event.trackingId, query.trackingId)
  ) {
    return false;
  }

  if (
    query.applicationId !== undefined &&
    !valueMatchesFilter(event.applicationId, query.applicationId)
  ) {
    return false;
  }

  if (
    query.actorId !== undefined &&
    !valueMatchesFilter(event.actorId, query.actorId)
  ) {
    return false;
  }

  if (
    query.actorType !== undefined &&
    !valueMatchesFilter(event.actorType, query.actorType)
  ) {
    return false;
  }

  if (
    query.source !== undefined &&
    !valueMatchesFilter(event.source, query.source)
  ) {
    return false;
  }

  if (
    query.action !== undefined &&
    !valueMatchesFilter(event.action, query.action)
  ) {
    return false;
  }

  if (
    query.status !== undefined &&
    !valueMatchesFilter(event.status, query.status)
  ) {
    return false;
  }

  if (
    query.workflowStage !== undefined &&
    !valueMatchesFilter(event.workflowStage, query.workflowStage)
  ) {
    return false;
  }

  const timestamp = Date.parse(event.timestamp);

  if (
    query.normalizedSince !== undefined &&
    timestamp < query.normalizedSince
  ) {
    return false;
  }

  if (
    query.normalizedUntil !== undefined &&
    timestamp > query.normalizedUntil
  ) {
    return false;
  }

  return true;
}

function selectIndexedEvents(events, indexes, query) {
  if (query.recordId !== undefined && !Array.isArray(query.recordId)) {
    const normalizedRecordId = normalizeIdentifierForLookup(
      query.recordId,
      'Record identifier',
    );

    return indexes.byRecordId.get(normalizedRecordId) ?? [];
  }

  if (query.actorId !== undefined && !Array.isArray(query.actorId)) {
    const normalizedActorId = normalizeIdentifierForLookup(
      query.actorId,
      'Actor identifier',
    );

    if (
      query.actorType !== undefined &&
      !Array.isArray(query.actorType)
    ) {
      const actorKey = normalizeIdentifierForLookup(
        `${query.actorType}:${query.actorId}`,
        'Actor index key',
      );

      return indexes.byActor.get(actorKey) ?? [];
    }

    return indexes.byActorId.get(normalizedActorId) ?? [];
  }

  return events;
}

function resolveStorageAdapter(options) {
  if (options.storageAdapter !== undefined) {
    if (!isRepositoryStorageAdapter(options.storageAdapter)) {
      throw new TypeError(
        'The audit storage adapter must provide get, set, and remove methods.',
      );
    }

    return options.storageAdapter;
  }

  if (options.storage !== undefined && !isStorageLike(options.storage)) {
    throw new TypeError(
      'The supplied audit storage implementation is invalid.',
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
 * Append-only repository for audit and lifecycle events.
 */
export class AuditRepository {
  /**
   * @param {{
   *   seedEvents?: object[],
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
      throw new TypeError('The audit repository clock must be a function.');
    }

    this.seedEvents = validateSeedEvents(
      normalizedOptions.seedEvents ?? getSeeds().lifecycleEvents,
    );
    this.clock = normalizedOptions.clock ?? (() => new Date());
    this.storageAdapter = resolveStorageAdapter(normalizedOptions);
    this.storageKey = normalizeIdentifier(
      normalizedOptions.storageKey ?? AUDIT_REPOSITORY_STORAGE_KEY,
      'Audit repository storage key',
    );
  }

  /**
   * Lists audit events using indexed record and actor selection where
   * possible.
   *
   * @param {{
   *   recordId?: string,
   *   trackingId?: string | string[] | null,
   *   applicationId?: string | string[],
   *   actorId?: string | string[],
   *   actorType?: string | string[],
   *   source?: string | string[],
   *   action?: string | string[],
   *   status?: string | string[],
   *   workflowStage?: string | string[],
   *   since?: Date | string | number,
   *   until?: Date | string | number,
   *   sortOrder?: 'asc' | 'desc',
   *   limit?: number,
   *   offset?: number
   * }} [query] Audit event filters.
   * @returns {object[]} Matching audit events.
   */
  list(query = {}) {
    const normalizedQuery = normalizeQuery(query);
    const events = this.readEvents();
    const indexes = buildEventIndexes(events);
    const candidates = selectIndexedEvents(
      events,
      indexes,
      normalizedQuery,
    );
    const offset = normalizedQuery.offset ?? 0;
    const limit = normalizedQuery.limit ?? Number.POSITIVE_INFINITY;
    const direction =
      normalizedQuery.sortOrder === 'asc' ? 1 : -1;

    return candidates
      .filter((event) => matchesQuery(event, normalizedQuery))
      .sort(
        (left, right) =>
          direction *
          (Date.parse(left.timestamp) - Date.parse(right.timestamp)),
      )
      .slice(offset, offset + limit)
      .map((event) => cloneValue(event));
  }

  /**
   * Alias for list.
   *
   * @param {object} [query] Audit event filters.
   * @returns {object[]} Matching audit events.
   */
  getAll(query = {}) {
    return this.list(query);
  }

  /**
   * Finds an audit event by its audit or lifecycle identifier.
   *
   * @param {string | number} eventId Event identifier.
   * @returns {object | undefined} Matching event.
   */
  find(eventId) {
    const normalizedEventId = normalizeIdentifierForLookup(
      eventId,
      'Audit event identifier',
    );
    const event = buildEventIndexes(this.readEvents()).byId.get(
      normalizedEventId,
    );

    return event ? cloneValue(event) : undefined;
  }

  /**
   * Alias for find.
   *
   * @param {string | number} eventId Event identifier.
   * @returns {object | undefined} Matching event.
   */
  findById(eventId) {
    return this.find(eventId);
  }

  /**
   * Returns an audit event or throws when it is absent.
   *
   * @param {string | number} eventId Event identifier.
   * @returns {object} Matching event.
   */
  get(eventId) {
    const event = this.find(eventId);

    if (!event) {
      throw createRepositoryError(
        AUDIT_REPOSITORY_ERROR_CODES.NOT_FOUND,
        `Audit event not found: ${eventId}`,
        { eventId: String(eventId) },
      );
    }

    return event;
  }

  /**
   * Lists events associated with any indexed record identifier.
   *
   * @param {string | number} recordId Record identifier.
   * @param {object} [query] Additional audit event filters.
   * @returns {object[]} Matching audit events.
   */
  findByRecordId(recordId, query = {}) {
    return this.list({
      ...assertOptions(query, 'Record audit query'),
      recordId: normalizeIdentifier(recordId, 'Record identifier'),
    });
  }

  /**
   * Alias for findByRecordId.
   *
   * @param {string | number} recordId Record identifier.
   * @param {object} [query] Additional filters.
   * @returns {object[]} Matching audit events.
   */
  listByRecordId(recordId, query = {}) {
    return this.findByRecordId(recordId, query);
  }

  /**
   * Returns application audit history.
   *
   * @param {string | number} applicationId Application identifier.
   * @param {object} [query] Additional filters.
   * @returns {object[]} Matching audit events.
   */
  findByApplicationId(applicationId, query = {}) {
    return this.list({
      ...assertOptions(query, 'Application audit query'),
      applicationId: normalizeIdentifier(
        applicationId,
        'Application identifier',
      ),
    });
  }

  /**
   * Returns tracking audit history.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @param {object} [query] Additional filters.
   * @returns {object[]} Matching audit events.
   */
  findByTrackingId(trackingId, query = {}) {
    return this.list({
      ...assertOptions(query, 'Tracking audit query'),
      trackingId: normalizeIdentifier(
        trackingId,
        'Tracking identifier',
      ),
    });
  }

  /**
   * Lists audit events for an actor.
   *
   * @param {string | number} actorId Actor identifier.
   * @param {object} [query] Additional audit event filters.
   * @returns {object[]} Matching audit events.
   */
  findByActorId(actorId, query = {}) {
    return this.list({
      ...assertOptions(query, 'Actor audit query'),
      actorId: normalizeIdentifier(actorId, 'Actor identifier'),
    });
  }

  /**
   * Alias for findByActorId.
   *
   * @param {string | number} actorId Actor identifier.
   * @param {object} [query] Additional filters.
   * @returns {object[]} Matching audit events.
   */
  listByActorId(actorId, query = {}) {
    return this.findByActorId(actorId, query);
  }

  /**
   * Lists audit events for a specific actor type and identifier.
   *
   * @param {string} actorType Actor type.
   * @param {string | number} actorId Actor identifier.
   * @param {object} [query] Additional filters.
   * @returns {object[]} Matching audit events.
   */
  findByActor(actorType, actorId, query = {}) {
    return this.list({
      ...assertOptions(query, 'Actor audit query'),
      actorType: normalizeIdentifier(actorType, 'Actor type'),
      actorId: normalizeIdentifier(actorId, 'Actor identifier'),
    });
  }

  /**
   * Appends an immutable audit event.
   *
   * @param {object} event Audit event values.
   * @returns {object} Appended audit event.
   */
  append(event) {
    if (!isObject(event)) {
      throw new TypeError('An audit event must be an object.');
    }

    const timestamp = toIsoTimestamp(event.timestamp ?? this.clock());
    const candidate = {
      ...cloneValue(event),
      trackingId:
        event.trackingId === undefined
          ? null
          : normalizeOptionalIdentifier(
              event.trackingId,
              'Tracking identifier',
            ),
      timestamp,
    };

    if (
      candidate.auditEventId === undefined &&
      candidate.lifecycleEventId === undefined
    ) {
      candidate.auditEventId = generateAuditEventId({
        action: candidate.action ?? null,
        actorId: candidate.actorId,
        actorType: candidate.actorType,
        applicationId: candidate.applicationId ?? null,
        source: candidate.source,
        sourceRecordId: candidate.sourceRecordId ?? null,
        summary: candidate.summary,
        timestamp,
        trackingId: candidate.trackingId,
      });
    }

    const parsedEvent = parseAuditEvent(candidate);
    const state = this.readState();
    const events = this.buildEvents(state);
    const eventId = getEventIdentifier(parsedEvent);
    const normalizedEventId = normalizeIdentifierForLookup(
      eventId,
      'Audit event identifier',
    );
    const duplicate = events.some(
      (existingEvent) =>
        normalizeIdentifierForLookup(
          getEventIdentifier(existingEvent),
          'Audit event identifier',
        ) === normalizedEventId,
    );

    if (duplicate) {
      throw createRepositoryError(
        AUDIT_REPOSITORY_ERROR_CODES.DUPLICATE_IDENTIFIER,
        `An audit event already exists: ${eventId}`,
        { eventId },
      );
    }

    state.events[eventId] = cloneValue(parsedEvent);
    this.persistState(state);

    return cloneValue(parsedEvent);
  }

  /**
   * Alias for append.
   *
   * @param {object} event Audit event values.
   * @returns {object} Appended audit event.
   */
  create(event) {
    return this.append(event);
  }

  /**
   * Appends an event associated with a source record.
   *
   * @param {string | number} recordId Source record identifier.
   * @param {object} event Audit event values.
   * @returns {object} Appended audit event.
   */
  appendForRecord(recordId, event) {
    if (!isObject(event)) {
      throw new TypeError('An audit event must be an object.');
    }

    return this.append({
      ...cloneValue(event),
      sourceRecordId:
        event.sourceRecordId ??
        normalizeIdentifier(recordId, 'Record identifier'),
    });
  }

  /**
   * Atomically appends multiple audit events.
   *
   * @param {object[]} events Audit events.
   * @returns {object[]} Appended audit events.
   */
  appendMany(events) {
    if (!Array.isArray(events)) {
      throw new TypeError('Audit events must be an array.');
    }

    if (events.length === 0) {
      return [];
    }

    const state = this.readState();
    const existingEvents = this.buildEvents(state);
    const identifiers = new Set(
      existingEvents.map((event) =>
        normalizeIdentifierForLookup(
          getEventIdentifier(event),
          'Audit event identifier',
        ),
      ),
    );
    const parsedEvents = events.map((event, index) => {
      if (!isObject(event)) {
        throw new TypeError(`Audit event at index ${index} must be an object.`);
      }

      const timestamp = toIsoTimestamp(event.timestamp ?? this.clock());
      const candidate = {
        ...cloneValue(event),
        trackingId:
          event.trackingId === undefined
            ? null
            : normalizeOptionalIdentifier(
                event.trackingId,
                'Tracking identifier',
              ),
        timestamp,
      };

      if (
        candidate.auditEventId === undefined &&
        candidate.lifecycleEventId === undefined
      ) {
        candidate.auditEventId = generateAuditEventId({
          action: candidate.action ?? null,
          actorId: candidate.actorId,
          actorType: candidate.actorType,
          applicationId: candidate.applicationId ?? null,
          index,
          source: candidate.source,
          sourceRecordId: candidate.sourceRecordId ?? null,
          summary: candidate.summary,
          timestamp,
          trackingId: candidate.trackingId,
        });
      }

      const parsedEvent = parseAuditEvent(candidate);
      const eventId = getEventIdentifier(parsedEvent);
      const normalizedEventId = normalizeIdentifierForLookup(
        eventId,
        'Audit event identifier',
      );

      if (identifiers.has(normalizedEventId)) {
        throw createRepositoryError(
          AUDIT_REPOSITORY_ERROR_CODES.DUPLICATE_IDENTIFIER,
          `An audit event already exists: ${eventId}`,
          { eventId },
        );
      }

      identifiers.add(normalizedEventId);
      return parsedEvent;
    });

    parsedEvents.forEach((event) => {
      state.events[getEventIdentifier(event)] = cloneValue(event);
    });

    this.persistState(state);
    return parsedEvents.map((event) => cloneValue(event));
  }

  /**
   * Returns counts grouped by actor type.
   *
   * @param {object} [query] Base audit event filters.
   * @returns {Record<string, number>} Actor type counts.
   */
  getActorCounts(query = {}) {
    const counts = Object.create(null);

    this.list({
      ...assertOptions(query, 'Audit count query'),
      limit: undefined,
      offset: undefined,
    }).forEach((event) => {
      counts[event.actorType] = (counts[event.actorType] ?? 0) + 1;
    });

    return Object.freeze({ ...counts });
  }

  /**
   * Removes persisted appended events and restores seed-only history.
   *
   * @returns {object[]} Seed audit events.
   */
  reset() {
    const removed = this.storageAdapter.remove(this.storageKey);

    if (!removed) {
      throw this.createPersistenceError('reset');
    }

    return this.seedEvents.map((event) => cloneValue(event));
  }

  readState() {
    const state = this.storageAdapter.get(
      this.storageKey,
      auditRepositoryStateSchema,
      createEmptyState(),
    );

    return cloneValue(state);
  }

  buildEvents(state) {
    const events = this.seedEvents.map((event) => cloneValue(event));

    Object.entries(state.events).forEach(([eventId, storedEvent]) => {
      if (!isObject(storedEvent)) {
        throw createRepositoryError(
          AUDIT_REPOSITORY_ERROR_CODES.INVALID_EVENT,
          `Invalid persisted audit event: ${eventId}`,
          { eventId },
        );
      }

      const event = parseAuditEvent(storedEvent);
      const parsedEventId = getEventIdentifier(event);

      if (parsedEventId !== eventId) {
        throw createRepositoryError(
          AUDIT_REPOSITORY_ERROR_CODES.INVALID_EVENT,
          'A persisted audit event has a mismatched identifier.',
          {
            storageEventId: eventId,
            eventId: parsedEventId,
          },
        );
      }

      events.push(event);
    });

    assertUniqueEventIdentifiers(events);
    return events;
  }

  readEvents() {
    try {
      return this.buildEvents(this.readState());
    } catch {
      this.storageAdapter.remove(this.storageKey);
      return this.seedEvents.map((event) => cloneValue(event));
    }
  }

  persistState(state) {
    const result = auditRepositoryStateSchema.safeParse(state);

    if (!result.success) {
      throw createRepositoryError(
        AUDIT_REPOSITORY_ERROR_CODES.PERSISTENCE_FAILED,
        'The audit repository state is invalid.',
        { issues: result.error.issues },
        result.error,
      );
    }

    if (
      !this.storageAdapter.set(
        this.storageKey,
        result.data,
        auditRepositoryStateSchema,
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
      AUDIT_REPOSITORY_ERROR_CODES.PERSISTENCE_FAILED,
      `Unable to ${operation} persisted audit events.`,
      {
        operation,
        storageError: storageError ?? null,
      },
      storageError,
    );
  }
}

/**
 * Creates an audit repository.
 *
 * @param {ConstructorParameters<typeof AuditRepository>[0]} [options]
 * Repository options.
 * @returns {AuditRepository} Repository instance.
 */
export function createAuditRepository(options = {}) {
  return new AuditRepository(options);
}

export const AuditEventRepository = AuditRepository;
export const createAuditEventRepository = createAuditRepository;

export default AuditRepository;