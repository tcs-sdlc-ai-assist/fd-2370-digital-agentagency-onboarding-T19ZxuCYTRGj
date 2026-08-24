import {
  AUDIT_ACTOR_TYPES,
  LIFECYCLE_STATUSES,
  WORKFLOW_STAGES,
  WORK_ITEM_STATES,
  WORK_ITEM_TYPES,
} from '../../constants/domain.js';
import { AuditRepository } from '../../repositories/auditRepository.js';
import { OnboardingRecordRepository } from '../../repositories/onboardingRecordRepository.js';
import { ProviderCheckRepository } from '../../repositories/providerCheckRepository.js';
import { SyncAttemptRepository } from '../../repositories/syncAttemptRepository.js';
import { WorkItemRepository } from '../../repositories/workItemRepository.js';
import { toIsoTimestamp } from '../../utils/dates.js';

export const LIFECYCLE_PROJECTION_ERROR_CODES = Object.freeze({
  INVALID_OPTIONS: 'LIFECYCLE_PROJECTION_INVALID_OPTIONS',
  INVALID_RECORD: 'LIFECYCLE_PROJECTION_INVALID_RECORD',
  INVALID_DEPENDENCY: 'LIFECYCLE_PROJECTION_INVALID_DEPENDENCY',
  NOT_FOUND: 'LIFECYCLE_PROJECTION_NOT_FOUND',
  QUERY_FAILED: 'LIFECYCLE_PROJECTION_QUERY_FAILED',
});

export const LIFECYCLE_STATUS_ORDER = Object.freeze([
  LIFECYCLE_STATUSES.NEW,
  LIFECYCLE_STATUSES.APPLICATION_STARTED,
  LIFECYCLE_STATUSES.APPLICATION_SUBMITTED,
  LIFECYCLE_STATUSES.APPLICATION_UNDER_REVIEW,
  LIFECYCLE_STATUSES.BACKGROUND_CHECK,
  LIFECYCLE_STATUSES.APPOINTMENT,
  LIFECYCLE_STATUSES.CONTRACTED,
  LIFECYCLE_STATUSES.TERMINATED,
]);

const STATUS_RANKS = Object.freeze(
  Object.fromEntries(
    LIFECYCLE_STATUS_ORDER.map((status, index) => [status, index]),
  ),
);

const REVIEW_WORKFLOW_STAGES = new Set([
  WORKFLOW_STAGES.APPLICATION_UNDER_REVIEW,
  WORKFLOW_STAGES.LICENSING_REVIEW,
  WORKFLOW_STAGES.DUPLICATE_REVIEW,
  WORKFLOW_STAGES.MANUAL_EXCEPTION,
]);

const BACKGROUND_PROVIDER_SERVICES = new Set([
  'backgroundcheck',
  'backgroundscreening',
]);

const APPOINTMENT_PROVIDER_SERVICES = new Set([
  'appointmentverification',
  'appointment',
]);

const SUCCESS_SYNC_STATUSES = new Set(['success', 'completed']);
const TERMINATION_OPERATIONS = new Set([
  'terminateagent',
  'terminatecontract',
  'termination',
]);
const ACTIVATION_OPERATIONS = new Set([
  'activateagent',
  'activatecontract',
  'createagencycontract',
]);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertOptions(
  options,
  description = 'Lifecycle projection options',
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

function normalizeToken(value) {
  return normalizeOptionalIdentifier(value)
    ?.normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
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

function createProjectionError(code, message, details, cause) {
  const error = new Error(message, {
    ...(cause === undefined ? {} : { cause }),
  });

  error.name = 'LifecycleProjectionServiceError';
  error.code = code;
  error.details = details ?? null;
  error.recoverable = true;

  return error;
}

function assertRepository(repository, methods, description) {
  if (
    !isObject(repository) ||
    methods.some((method) => typeof repository[method] !== 'function')
  ) {
    throw createProjectionError(
      LIFECYCLE_PROJECTION_ERROR_CODES.INVALID_DEPENDENCY,
      `${description} must provide ${methods.join(', ')}.`,
      { requiredMethods: methods },
    );
  }

  return repository;
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

function normalizeTimestamp(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  try {
    return toIsoTimestamp(value);
  } catch {
    return null;
  }
}

function latestTimestamp(...values) {
  const timestamps = values
    .flat()
    .map(normalizeTimestamp)
    .filter(Boolean)
    .sort((left, right) => Date.parse(right) - Date.parse(left));

  return timestamps[0] ?? null;
}

function statusFromValue(value) {
  const token = normalizeToken(value);

  switch (token) {
    case 'new':
      return LIFECYCLE_STATUSES.NEW;

    case 'draft':
    case 'applicationstarted':
      return LIFECYCLE_STATUSES.APPLICATION_STARTED;

    case 'submitted':
    case 'applicationsubmitted':
      return LIFECYCLE_STATUSES.APPLICATION_SUBMITTED;

    case 'inreview':
    case 'actionrequired':
    case 'applicationunderreview':
    case 'licensingreview':
    case 'duplicatereview':
    case 'manualexception':
      return LIFECYCLE_STATUSES.APPLICATION_UNDER_REVIEW;

    case 'background':
    case 'backgroundcheck':
      return LIFECYCLE_STATUSES.BACKGROUND_CHECK;

    case 'approved':
    case 'appointment':
    case 'appointmentpending':
      return LIFECYCLE_STATUSES.APPOINTMENT;

    case 'active':
    case 'completed':
    case 'contracted':
      return LIFECYCLE_STATUSES.CONTRACTED;

    case 'terminated':
    case 'termination':
      return LIFECYCLE_STATUSES.TERMINATED;

    default:
      return undefined;
  }
}

function createEvidence(status, timestamp, source, sourceRecord) {
  if (!status || !Object.hasOwn(STATUS_RANKS, status)) {
    return undefined;
  }

  return {
    status,
    timestamp: normalizeTimestamp(timestamp),
    source,
    sourceRecord: sourceRecord ? cloneValue(sourceRecord) : null,
  };
}

function collectRecordEvidence(record) {
  const evidence = [];
  const createdAt = record.createdAt ?? record.updatedAt;
  const explicitStatus =
    statusFromValue(record.workflowStage) ??
    statusFromValue(record.lifecycleStatus) ??
    statusFromValue(record.currentStatus) ??
    statusFromValue(record.status);

  evidence.push(
    createEvidence(
      LIFECYCLE_STATUSES.NEW,
      createdAt,
      'onboarding_record',
      record,
    ),
  );

  if (
    record.status === 'draft' ||
    record.workflowStage === WORKFLOW_STAGES.APPLICATION_STARTED ||
    Number(record.progress?.percentComplete ?? 0) > 0
  ) {
    evidence.push(
      createEvidence(
        LIFECYCLE_STATUSES.APPLICATION_STARTED,
        record.updatedAt ?? createdAt,
        'onboarding_record',
        record,
      ),
    );
  }

  if (record.submittedAt) {
    evidence.push(
      createEvidence(
        LIFECYCLE_STATUSES.APPLICATION_SUBMITTED,
        record.submittedAt,
        'onboarding_record',
        record,
      ),
    );
  }

  if (REVIEW_WORKFLOW_STAGES.has(record.workflowStage)) {
    evidence.push(
      createEvidence(
        LIFECYCLE_STATUSES.APPLICATION_UNDER_REVIEW,
        record.updatedAt,
        'onboarding_record',
        record,
      ),
    );
  }

  if (
    record.background?.status &&
    !['not_started', 'not_required'].includes(
      String(record.background.status).toLowerCase(),
    )
  ) {
    evidence.push(
      createEvidence(
        LIFECYCLE_STATUSES.BACKGROUND_CHECK,
        record.background.completedAt ??
          record.background.initiatedAt ??
          record.updatedAt,
        'onboarding_record',
        record.background,
      ),
    );
  }

  if (
    record.appointment?.status &&
    record.appointment.status !== 'not_started'
  ) {
    evidence.push(
      createEvidence(
        record.appointment.status === 'terminated'
          ? LIFECYCLE_STATUSES.TERMINATED
          : LIFECYCLE_STATUSES.APPOINTMENT,
        record.appointment.completedAt ??
          record.appointment.submittedAt ??
          record.updatedAt,
        'onboarding_record',
        record.appointment,
      ),
    );
  }

  if (explicitStatus) {
    evidence.push(
      createEvidence(
        explicitStatus,
        record.completedAt ??
          record.submittedAt ??
          record.updatedAt ??
          createdAt,
        'onboarding_record',
        record,
      ),
    );
  }

  if (
    normalizeToken(record.contract?.status) === 'terminated' ||
    record.contract?.terminationDate
  ) {
    evidence.push(
      createEvidence(
        LIFECYCLE_STATUSES.TERMINATED,
        record.contract.terminationDate ??
          record.completedAt ??
          record.updatedAt,
        'onboarding_record',
        record.contract,
      ),
    );
  } else if (normalizeToken(record.contract?.status) === 'active') {
    evidence.push(
      createEvidence(
        LIFECYCLE_STATUSES.CONTRACTED,
        record.completedAt ??
          record.contract.effectiveDate ??
          record.updatedAt,
        'onboarding_record',
        record.contract,
      ),
    );
  }

  return evidence.filter(Boolean);
}

function collectAuditEvidence(auditEvents) {
  return auditEvents
    .map((event) => {
      const status =
        statusFromValue(event.workflowStage) ??
        statusFromValue(event.status) ??
        statusFromValue(event.action);

      return createEvidence(
        status,
        event.timestamp,
        'audit_event',
        event,
      );
    })
    .filter(Boolean);
}

function collectWorkItemEvidence(workItems) {
  return workItems
    .flatMap((workItem) => {
      const evidence = [];
      let status;

      if (workItem.cardType === WORK_ITEM_TYPES.BACKGROUND_CHECK) {
        status = LIFECYCLE_STATUSES.BACKGROUND_CHECK;
      } else if (workItem.cardType === WORK_ITEM_TYPES.APPOINTMENT) {
        status = LIFECYCLE_STATUSES.APPOINTMENT;
      } else if (
        workItem.state !== WORK_ITEM_STATES.COMPLETED ||
        [
          WORK_ITEM_TYPES.EXCEPTION,
          WORK_ITEM_TYPES.DISTRIBUTION_APPROVAL,
          WORK_ITEM_TYPES.AGENCY_REVIEW,
          WORK_ITEM_TYPES.EXPLANATION_LETTER,
        ].includes(workItem.cardType)
      ) {
        status = LIFECYCLE_STATUSES.APPLICATION_UNDER_REVIEW;
      }

      if (status) {
        evidence.push(
          createEvidence(
            status,
            workItem.updatedAt ?? workItem.createdAt,
            'work_item',
            workItem,
          ),
        );
      }

      return evidence;
    })
    .filter(Boolean);
}

function collectProviderEvidence(providerChecks) {
  return providerChecks
    .map((check) => {
      const service = normalizeToken(check.service);
      let status;

      if (BACKGROUND_PROVIDER_SERVICES.has(service)) {
        status = LIFECYCLE_STATUSES.BACKGROUND_CHECK;
      } else if (APPOINTMENT_PROVIDER_SERVICES.has(service)) {
        status = LIFECYCLE_STATUSES.APPOINTMENT;
      }

      return createEvidence(
        status,
        check.completedAt ?? check.requestedAt,
        'provider_check',
        check,
      );
    })
    .filter(Boolean);
}

function collectSyncEvidence(syncAttempts) {
  return syncAttempts
    .map((attempt) => {
      if (!SUCCESS_SYNC_STATUSES.has(normalizeToken(attempt.status))) {
        return undefined;
      }

      const operation = normalizeToken(attempt.operation);
      let status;

      if (TERMINATION_OPERATIONS.has(operation)) {
        status = LIFECYCLE_STATUSES.TERMINATED;
      } else if (ACTIVATION_OPERATIONS.has(operation)) {
        status = LIFECYCLE_STATUSES.CONTRACTED;
      }

      return createEvidence(
        status,
        attempt.resolvedAt ?? attempt.attemptedAt,
        'sync_attempt',
        attempt,
      );
    })
    .filter(Boolean);
}

function collectEvidence(record, context) {
  return [
    ...collectRecordEvidence(record),
    ...collectAuditEvidence(context.auditEvents ?? []),
    ...collectWorkItemEvidence(context.workItems ?? []),
    ...collectProviderEvidence(context.providerChecks ?? []),
    ...collectSyncEvidence(context.syncAttempts ?? []),
  ];
}

function selectCurrentEvidence(evidence) {
  return evidence.reduce((current, candidate) => {
    if (!current) {
      return candidate;
    }

    const currentRank = STATUS_RANKS[current.status] ?? -1;
    const candidateRank = STATUS_RANKS[candidate.status] ?? -1;

    if (candidateRank > currentRank) {
      return candidate;
    }

    if (candidateRank < currentRank) {
      return current;
    }

    const currentTime = current.timestamp
      ? Date.parse(current.timestamp)
      : Number.NEGATIVE_INFINITY;
    const candidateTime = candidate.timestamp
      ? Date.parse(candidate.timestamp)
      : Number.NEGATIVE_INFINITY;

    return candidateTime > currentTime ? candidate : current;
  }, undefined);
}

function getMilestoneActor(evidence) {
  const sourceRecord = evidence.sourceRecord ?? {};

  if (evidence.source === 'audit_event') {
    return {
      actorType:
        sourceRecord.actorType ?? AUDIT_ACTOR_TYPES.SYSTEM,
      actorId: sourceRecord.actorId ?? 'system',
    };
  }

  if (evidence.source === 'work_item') {
    const latestHistory = Array.isArray(sourceRecord.history)
      ? sourceRecord.history.at(-1)
      : undefined;

    return {
      actorType:
        latestHistory?.actorType ?? AUDIT_ACTOR_TYPES.SYSTEM,
      actorId: latestHistory?.actorId ?? 'system',
    };
  }

  return {
    actorType: AUDIT_ACTOR_TYPES.SYSTEM,
    actorId: 'system',
  };
}

function getMilestoneSummary(evidence) {
  const sourceRecord = evidence.sourceRecord ?? {};

  return (
    sourceRecord.summary ??
    sourceRecord.message ??
    `Lifecycle status moved to ${evidence.status}.`
  );
}

function createMilestones(evidence) {
  const milestonesByStatus = new Map();

  evidence.forEach((item) => {
    const existing = milestonesByStatus.get(item.status);
    const itemTime = item.timestamp
      ? Date.parse(item.timestamp)
      : Number.POSITIVE_INFINITY;
    const existingTime = existing?.timestamp
      ? Date.parse(existing.timestamp)
      : Number.POSITIVE_INFINITY;

    if (!existing || itemTime < existingTime) {
      const actor = getMilestoneActor(item);

      milestonesByStatus.set(item.status, {
        status: item.status,
        timestamp: item.timestamp,
        actorType: actor.actorType,
        actorId: actor.actorId,
        source: item.source,
        summary: getMilestoneSummary(item),
      });
    }
  });

  return [...milestonesByStatus.values()].sort((left, right) => {
    const leftTime = left.timestamp
      ? Date.parse(left.timestamp)
      : Number.POSITIVE_INFINITY;
    const rightTime = right.timestamp
      ? Date.parse(right.timestamp)
      : Number.POSITIVE_INFINITY;

    if (leftTime !== rightTime) {
      return leftTime - rightTime;
    }

    return (
      (STATUS_RANKS[left.status] ?? 0) -
      (STATUS_RANKS[right.status] ?? 0)
    );
  });
}

function findRecord(repository, trackingId) {
  if (typeof repository.findByTrackingId === 'function') {
    return repository.findByTrackingId(trackingId);
  }

  return repository.find(trackingId);
}

function listRelated(repository, method, trackingId, query = {}) {
  if (typeof repository[method] === 'function') {
    const records = repository[method](trackingId, query);

    return Array.isArray(records) ? records : [];
  }

  if (typeof repository.list === 'function') {
    const records = repository.list({
      ...query,
      trackingId,
    });

    return Array.isArray(records) ? records : [];
  }

  return [];
}

/**
 * Derives the canonical current lifecycle status from all supplied evidence.
 *
 * @param {object} record Onboarding record.
 * @param {{
 *   auditEvents?: object[],
 *   workItems?: object[],
 *   providerChecks?: object[],
 *   syncAttempts?: object[]
 * }} [context] Supplemental lifecycle evidence.
 * @returns {string} Canonical lifecycle status.
 */
export function deriveCurrentStatus(record, context = {}) {
  if (!isObject(record)) {
    throw createProjectionError(
      LIFECYCLE_PROJECTION_ERROR_CODES.INVALID_RECORD,
      'An onboarding record must be an object.',
      null,
    );
  }

  const normalizedContext = assertOptions(
    context,
    'Lifecycle evidence context',
  );
  const currentEvidence = selectCurrentEvidence(
    collectEvidence(record, normalizedContext),
  );

  return currentEvidence?.status ?? LIFECYCLE_STATUSES.NEW;
}

/**
 * Projects onboarding records and related operational evidence into a
 * canonical lifecycle timeline.
 */
export class LifecycleProjectionService {
  /**
   * @param {{
   *   onboardingRepository?: object,
   *   recordRepository?: object,
   *   auditRepository?: object,
   *   workItemRepository?: object,
   *   providerCheckRepository?: object,
   *   syncAttemptRepository?: object,
   *   storage?: Storage,
   *   namespace?: string,
   *   schemaVersion?: number,
   *   clock?: () => Date | string | number,
   *   onStorageError?: (error: object) => void
   * }} [options] Service options.
   */
  constructor(options = {}) {
    const normalizedOptions = assertOptions(options);
    const repositoryOptions = createRepositoryOptions(normalizedOptions);

    if (
      normalizedOptions.clock !== undefined &&
      typeof normalizedOptions.clock !== 'function'
    ) {
      throw new TypeError(
        'The lifecycle projection clock must be a function.',
      );
    }

    this.clock = normalizedOptions.clock ?? (() => new Date());
    this.onboardingRepository = assertRepository(
      normalizedOptions.onboardingRepository ??
        normalizedOptions.recordRepository ??
        new OnboardingRecordRepository(repositoryOptions),
      ['find'],
      'The onboarding repository',
    );
    this.auditRepository = assertRepository(
      normalizedOptions.auditRepository ??
        new AuditRepository(repositoryOptions),
      ['list'],
      'The audit repository',
    );
    this.workItemRepository = assertRepository(
      normalizedOptions.workItemRepository ??
        new WorkItemRepository(repositoryOptions),
      ['list'],
      'The work item repository',
    );
    this.providerCheckRepository = assertRepository(
      normalizedOptions.providerCheckRepository ??
        new ProviderCheckRepository(repositoryOptions),
      ['list'],
      'The provider check repository',
    );
    this.syncAttemptRepository = assertRepository(
      normalizedOptions.syncAttemptRepository ??
        new SyncAttemptRepository(repositoryOptions),
      ['list'],
      'The sync attempt repository',
    );
  }

  /**
   * Derives current status using the service projection rules.
   *
   * @param {object} record Onboarding record.
   * @param {object} [context] Supplemental lifecycle evidence.
   * @returns {string} Canonical lifecycle status.
   */
  deriveCurrentStatus(record, context = {}) {
    return deriveCurrentStatus(record, context);
  }

  /**
   * Returns the canonical lifecycle for a tracking identifier.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @param {{
   *   record?: object,
   *   auditEvents?: object[],
   *   workItems?: object[],
   *   providerChecks?: object[],
   *   syncAttempts?: object[],
   *   includeSources?: boolean
   * }} [options] Projection options.
   * @returns {object} Lifecycle projection.
   */
  getLifecycle(trackingId, options = {}) {
    const normalizedTrackingId = normalizeIdentifier(
      trackingId,
      'Tracking identifier',
    );
    const normalizedOptions = assertOptions(
      options,
      'Lifecycle query options',
    );

    try {
      const record =
        normalizedOptions.record ??
        findRecord(this.onboardingRepository, normalizedTrackingId);

      if (!record) {
        throw createProjectionError(
          LIFECYCLE_PROJECTION_ERROR_CODES.NOT_FOUND,
          `Onboarding lifecycle not found: ${normalizedTrackingId}`,
          { trackingId: normalizedTrackingId },
        );
      }

      const auditEvents =
        normalizedOptions.auditEvents ??
        listRelated(
          this.auditRepository,
          'findByTrackingId',
          normalizedTrackingId,
          { sortOrder: 'asc' },
        );
      const workItems =
        normalizedOptions.workItems ??
        listRelated(
          this.workItemRepository,
          'findByTrackingId',
          normalizedTrackingId,
        );
      const providerChecks =
        normalizedOptions.providerChecks ??
        listRelated(
          this.providerCheckRepository,
          'findByTrackingId',
          normalizedTrackingId,
        );
      const syncAttempts =
        normalizedOptions.syncAttempts ??
        listRelated(
          this.syncAttemptRepository,
          'findByTrackingId',
          normalizedTrackingId,
        );
      const context = {
        auditEvents,
        workItems,
        providerChecks,
        syncAttempts,
      };
      const evidence = collectEvidence(record, context);
      const currentEvidence = selectCurrentEvidence(evidence);
      const currentStatus =
        currentEvidence?.status ?? LIFECYCLE_STATUSES.NEW;
      const milestones = createMilestones(evidence);
      const updatedAt =
        currentEvidence?.timestamp ??
        latestTimestamp(
          record.updatedAt,
          record.createdAt,
          auditEvents.map((event) => event.timestamp),
          workItems.map((workItem) => workItem.updatedAt),
          providerChecks.map(
            (check) => check.completedAt ?? check.requestedAt,
          ),
          syncAttempts.map(
            (attempt) =>
              attempt.resolvedAt ?? attempt.attemptedAt,
          ),
        ) ??
        toIsoTimestamp(this.clock());
      const currentIndex = STATUS_RANKS[currentStatus] ?? 0;
      const response = {
        trackingId: record.trackingId ?? normalizedTrackingId,
        applicationId: record.applicationId ?? null,
        currentStatus,
        currentWorkflowStage: record.workflowStage ?? null,
        updatedAt,
        milestones: cloneValue(milestones),
        completedStatuses: LIFECYCLE_STATUS_ORDER.slice(
          0,
          currentIndex + 1,
        ),
        remainingStatuses:
          currentStatus === LIFECYCLE_STATUSES.TERMINATED
            ? []
            : LIFECYCLE_STATUS_ORDER.slice(currentIndex + 1).filter(
                (status) =>
                  status !== LIFECYCLE_STATUSES.TERMINATED,
              ),
      };

      if (normalizedOptions.includeSources === true) {
        response.sources = {
          record: cloneValue(record),
          auditEvents: cloneValue(auditEvents),
          workItems: cloneValue(workItems),
          providerChecks: cloneValue(providerChecks),
          syncAttempts: cloneValue(syncAttempts),
        };
      }

      return Object.freeze(response);
    } catch (error) {
      if (
        error?.name === 'LifecycleProjectionServiceError' ||
        error instanceof TypeError ||
        error instanceof RangeError
      ) {
        throw error;
      }

      throw createProjectionError(
        LIFECYCLE_PROJECTION_ERROR_CODES.QUERY_FAILED,
        'Unable to project the onboarding lifecycle.',
        { trackingId: normalizedTrackingId },
        error,
      );
    }
  }

  /**
   * Alias for getLifecycle.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @param {object} [options] Projection options.
   * @returns {object} Lifecycle projection.
   */
  get(trackingId, options = {}) {
    return this.getLifecycle(trackingId, options);
  }

  /**
   * Projects lifecycle summaries for multiple records.
   *
   * @param {object[]} records Onboarding records.
   * @param {object} [options] Projection options.
   * @returns {object[]} Lifecycle projections.
   */
  projectRecords(records, options = {}) {
    if (!Array.isArray(records)) {
      throw new TypeError(
        'Lifecycle projection records must be an array.',
      );
    }

    const normalizedOptions = assertOptions(
      options,
      'Lifecycle collection options',
    );

    return records.map((record) => {
      if (!isObject(record)) {
        throw createProjectionError(
          LIFECYCLE_PROJECTION_ERROR_CODES.INVALID_RECORD,
          'Lifecycle projection records must contain objects.',
          null,
        );
      }

      const trackingId = normalizeIdentifier(
        record.trackingId,
        'Tracking identifier',
      );

      return this.getLifecycle(trackingId, {
        ...normalizedOptions,
        record,
      });
    });
  }
}

/**
 * Creates a lifecycle projection service.
 *
 * @param {ConstructorParameters<typeof LifecycleProjectionService>[0]}
 * [options] Service options.
 * @returns {LifecycleProjectionService} Lifecycle projection service.
 */
export function createLifecycleProjectionService(options = {}) {
  return new LifecycleProjectionService(options);
}

/**
 * Returns a lifecycle projection using a newly created service.
 *
 * @param {string | number} trackingId Tracking identifier.
 * @param {object} [queryOptions] Projection options.
 * @param {ConstructorParameters<typeof LifecycleProjectionService>[0]}
 * [serviceOptions] Service options.
 * @returns {object} Lifecycle projection.
 */
export function getLifecycle(
  trackingId,
  queryOptions = {},
  serviceOptions = {},
) {
  return createLifecycleProjectionService(
    serviceOptions,
  ).getLifecycle(trackingId, queryOptions);
}

export const LifecycleService = LifecycleProjectionService;
export const LifecycleTrackerService = LifecycleProjectionService;
export const createLifecycleService =
  createLifecycleProjectionService;
export const createLifecycleTrackerService =
  createLifecycleProjectionService;
export const projectLifecycle = getLifecycle;

export default LifecycleProjectionService;