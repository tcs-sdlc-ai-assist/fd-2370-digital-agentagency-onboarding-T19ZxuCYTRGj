import { beforeEach, describe, expect, it } from 'vitest';
import {
  INTEGRATION_SYSTEMS,
  WORK_ITEM_STATES,
  WORK_ITEM_TYPES,
} from '../../constants/domain.js';
import {
  PARTNER_SCOPE_TYPES,
  ROLES,
} from '../../constants/roles.js';
import {
  createSyncAttemptRepository,
  SYNC_ATTEMPT_STATUSES,
} from '../../repositories/syncAttemptRepository.js';
import { createWorkItemRepository } from '../../repositories/workItemRepository.js';
import {
  createSyncStatusService,
  HORIZON_RECONCILIATION_ACTIONS,
  SYNC_STATUS_SERVICE_ERROR_CODES,
} from './syncStatusService.js';

const TEST_TIME = '2026-08-24T12:00:00.000Z';

function createPrincipal(role, userId, partnerContext = {}) {
  return {
    isAuthenticated: true,
    status: 'authenticated',
    role,
    user: {
      id: userId,
      role,
    },
    partnerContext: {
      ...partnerContext,
    },
  };
}

function createAdminPrincipal() {
  return createPrincipal(ROLES.ADMIN, 'usr_admin_demo', {
    scopeType: PARTNER_SCOPE_TYPES.GLOBAL,
  });
}

function createPartnerPrincipal() {
  return createPrincipal(ROLES.PARTNER, 'usr_partner_demo', {
    partnerCode: 'DEMO_PARTNER',
    scopeType: PARTNER_SCOPE_TYPES.OWN_ORGANIZATION,
  });
}

function createService(
  principal = createAdminPrincipal(),
  options = {},
) {
  return createSyncStatusService({
    principal,
    partnerContext: principal.partnerContext,
    storage: globalThis.localStorage,
    clock: () => new Date(TEST_TIME),
    auditService: false,
    ...options,
  });
}

beforeEach(() => {
  globalThis.localStorage.clear();
});

describe('SyncStatusService', () => {
  it('returns synchronization history for all configured systems', () => {
    const principal = createAdminPrincipal();
    const service = createService(principal);
    const response = service.search(
      {
        page: 1,
        pageSize: 100,
      },
      principal,
    );
    const systems = new Set(
      response.records.map((attempt) => attempt.system),
    );

    expect(response.total).toBeGreaterThan(0);
    expect(response.records).toHaveLength(response.total);
    expect(systems).toEqual(
      new Set(Object.values(INTEGRATION_SYSTEMS)),
    );
    expect(response.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          syncAttemptId: 'SYN-DEMO-1006',
          system: INTEGRATION_SYSTEMS.AGENT_DB,
          status: SYNC_ATTEMPT_STATUSES.SUCCESS,
        }),
        expect.objectContaining({
          syncAttemptId: 'SYN-DEMO-1007',
          system: INTEGRATION_SYSTEMS.LIFE_PRO,
          status: SYNC_ATTEMPT_STATUSES.SUCCESS,
        }),
        expect.objectContaining({
          syncAttemptId: 'SYN-DEMO-1012',
          system: INTEGRATION_SYSTEMS.ALI,
          status: SYNC_ATTEMPT_STATUSES.FAILED,
        }),
        expect.objectContaining({
          syncAttemptId: 'SYN-DEMO-1008',
          system: INTEGRATION_SYSTEMS.HORIZON,
          status: SYNC_ATTEMPT_STATUSES.SUCCESS,
        }),
      ]),
    );
  });

  it('returns the latest source-of-truth badge for each system', () => {
    const principal = createAdminPrincipal();
    const service = createService(principal);
    const badges = service.getStatusBadges(
      'TRK-DEMO-1006',
      principal,
    );

    expect(badges[INTEGRATION_SYSTEMS.AGENT_DB]).toEqual(
      expect.objectContaining({
        syncAttemptId: 'SYN-DEMO-1006',
        operation: 'activate_agent',
        status: SYNC_ATTEMPT_STATUSES.SUCCESS,
      }),
    );
    expect(badges[INTEGRATION_SYSTEMS.LIFE_PRO]).toEqual(
      expect.objectContaining({
        syncAttemptId: 'SYN-DEMO-1007',
        operation: 'activate_agent',
        status: SYNC_ATTEMPT_STATUSES.SUCCESS,
      }),
    );
    expect(badges[INTEGRATION_SYSTEMS.ALI]).toEqual(
      expect.objectContaining({
        syncAttemptId: 'SYN-DEMO-1013',
        operation: 'activate_agent',
        status: SYNC_ATTEMPT_STATUSES.SUCCESS,
      }),
    );
    expect(badges[INTEGRATION_SYSTEMS.HORIZON]).toEqual(
      expect.objectContaining({
        syncAttemptId: 'SYN-DEMO-1008',
        operation: 'close_digital_routing',
        status: SYNC_ATTEMPT_STATUSES.SUCCESS,
      }),
    );
  });

  it('records a failed synchronization and creates one operational failure work item', () => {
    const principal = createAdminPrincipal();
    const syncAttemptRepository = createSyncAttemptRepository({
      storage: globalThis.localStorage,
      clock: () => new Date(TEST_TIME),
    });
    const workItemRepository = createWorkItemRepository({
      storage: globalThis.localStorage,
      clock: () => new Date(TEST_TIME),
    });
    const service = createService(principal, {
      repository: syncAttemptRepository,
      workItemRepository,
    });

    const attempt = service.createAttempt(
      {
        trackingId: 'TRK-DEMO-1004',
        system: INTEGRATION_SYSTEMS.AGENT_DB,
        operation: 'update_background_status',
        status: SYNC_ATTEMPT_STATUSES.FAILED,
        correlationId: 'corr-sync-failure-test-1001',
        message:
          'The Agent DB simulation rejected the synthetic background update.',
        payloadSummary: {
          applicationId: 'APP-DEMO-1004',
          errorCode: 'SYNTHETIC_AGENT_DB_FAILURE',
        },
        attemptedAt: TEST_TIME,
        resolvedAt: TEST_TIME,
      },
      principal,
    );
    const failureWorkItem = workItemRepository.find(
      attempt.createdWorkItemId,
    );

    expect(attempt).toEqual(
      expect.objectContaining({
        trackingId: 'TRK-DEMO-1004',
        system: INTEGRATION_SYSTEMS.AGENT_DB,
        status: SYNC_ATTEMPT_STATUSES.FAILED,
        createdWorkItemId: expect.any(String),
      }),
    );
    expect(failureWorkItem).toEqual(
      expect.objectContaining({
        workItemId: attempt.createdWorkItemId,
        trackingId: attempt.trackingId,
        sourceRecordId: attempt.syncAttemptId,
        cardType: WORK_ITEM_TYPES.SYNC_FAILURE,
        state: WORK_ITEM_STATES.ACTION_NEEDED,
        priority: 'high',
      }),
    );
    expect(failureWorkItem.metadata).toEqual(
      expect.objectContaining({
        failedSyncAttemptId: attempt.syncAttemptId,
        system: INTEGRATION_SYSTEMS.AGENT_DB,
        validationCodes: ['SYNC_RETRY_REQUIRED'],
      }),
    );

    const repeatedWorkItem = service.createFailureWorkItem(
      attempt.syncAttemptId,
      {
        principal,
      },
    );

    expect(repeatedWorkItem.workItemId).toBe(
      attempt.createdWorkItemId,
    );
    expect(
      workItemRepository.list({
        sourceRecordId: attempt.syncAttemptId,
        cardType: WORK_ITEM_TYPES.SYNC_FAILURE,
        includeCompleted: true,
      }),
    ).toHaveLength(1);
  });

  it('redirects a matching Horizon event and prevents duplicate reconciliation', () => {
    const principal = createAdminPrincipal();
    const service = createService(principal);
    const request = {
      eventId: 'HZ-DEMO-TEST-1001',
      eventType: 'jit_appointment_requested',
      agentCode: 'MCON1006',
      npn: '8101006',
      requestedStates: ['OH'],
      principal,
    };

    const firstResult = service.reconcileHorizonEvent(
      request,
      principal,
    );
    const repeatedResult = service.reconcileHorizonEvent(
      request,
      principal,
    );

    expect(firstResult).toEqual(
      expect.objectContaining({
        eventId: request.eventId,
        matchedDigitalRecord: true,
        trackingId: 'TRK-DEMO-1006',
        applicationId: 'APP-DEMO-1006',
        action: HORIZON_RECONCILIATION_ACTIONS.REDIRECTED,
        duplicatePrevented: true,
        syncAttemptId: expect.any(String),
      }),
    );
    expect(repeatedResult).toEqual(
      expect.objectContaining({
        eventId: request.eventId,
        matchedDigitalRecord: true,
        trackingId: 'TRK-DEMO-1006',
        action: HORIZON_RECONCILIATION_ACTIONS.DUPLICATE,
        duplicatePrevented: true,
        idempotent: true,
        syncAttemptId: firstResult.syncAttemptId,
      }),
    );

    const history = service.search(
      {
        trackingId: 'TRK-DEMO-1006',
        system: INTEGRATION_SYSTEMS.HORIZON,
        correlationId: firstResult.correlationId,
        page: 1,
        pageSize: 100,
      },
      principal,
    );

    expect(history.total).toBe(1);
    expect(history.records[0]).toEqual(
      expect.objectContaining({
        syncAttemptId: firstResult.syncAttemptId,
        operation: 'redirect_jit_appointment',
        status: SYNC_ATTEMPT_STATUSES.SUCCESS,
        payloadSummary: expect.objectContaining({
          eventId: request.eventId,
          matchedDigitalRecord: true,
          duplicatePrevented: true,
        }),
      }),
    );
  });

  it('records an unmatched Horizon event as a skipped synchronization', () => {
    const principal = createAdminPrincipal();
    const service = createService(principal);
    const result = service.reconcileHorizonEvent(
      {
        eventId: 'HZ-DEMO-UNMATCHED-1001',
        eventType: 'jit_appointment_requested',
        npn: '8999999',
        requestedStates: ['PA'],
        principal,
      },
      principal,
    );

    expect(result).toEqual(
      expect.objectContaining({
        eventId: 'HZ-DEMO-UNMATCHED-1001',
        matchedDigitalRecord: false,
        trackingId: null,
        action: HORIZON_RECONCILIATION_ACTIONS.SKIPPED_NO_MATCH,
        duplicatePrevented: false,
        syncAttemptId: expect.any(String),
      }),
    );

    const response = service.search(
      {
        system: INTEGRATION_SYSTEMS.HORIZON,
        correlationId: result.correlationId,
        page: 1,
        pageSize: 100,
      },
      principal,
    );

    expect(response.records).toEqual([
      expect.objectContaining({
        syncAttemptId: result.syncAttemptId,
        trackingId: null,
        operation: 'reconcile_jit_event',
        status: SYNC_ATTEMPT_STATUSES.SKIPPED,
        payloadSummary: expect.objectContaining({
          matchedDigitalRecord: false,
        }),
      }),
    ]);
  });

  it('activates level-40 agencies directly in LifePro and leaves Agent DB unchanged', () => {
    const principal = createAdminPrincipal();
    const service = createService(principal);
    const record = {
      id: 'level_40_record_1001',
      applicationId: 'APP-LEVEL-40-1001',
      trackingId: 'TRK-LEVEL-40-1001',
      partnerCode: 'LEVEL_40_DEMO',
      company: 'Banner',
      carrierCode: 'BANNER',
      status: 'approved',
      workflowStage: 'APPOINTMENT',
      contract: {
        type: 'AGENCY',
        level: 'GENERAL_AGENCY',
        commissionSchedule: 'GENERAL_AGENCY',
      },
    };

    const result = service.recordLevel40LifeProActivation(
      record,
      {},
      principal,
    );
    const repeatedResult =
      service.recordLevel40LifeProActivation(
        record,
        {},
        principal,
      );
    const badges = service.getStatusBadges(
      record.trackingId,
      principal,
    );

    expect(result).toEqual(
      expect.objectContaining({
        trackingId: record.trackingId,
        applicationId: record.applicationId,
        system: INTEGRATION_SYSTEMS.LIFE_PRO,
        directLifeProActivation: true,
        agentDbBypassed: true,
        idempotent: false,
        attempt: expect.objectContaining({
          operation: 'activate_level_40_agency',
          status: SYNC_ATTEMPT_STATUSES.SUCCESS,
        }),
      }),
    );
    expect(repeatedResult).toEqual(
      expect.objectContaining({
        directLifeProActivation: true,
        agentDbBypassed: true,
        idempotent: true,
        attempt: expect.objectContaining({
          syncAttemptId: result.attempt.syncAttemptId,
        }),
      }),
    );
    expect(badges[INTEGRATION_SYSTEMS.LIFE_PRO]).toEqual(
      expect.objectContaining({
        syncAttemptId: result.attempt.syncAttemptId,
        operation: 'activate_level_40_agency',
        status: SYNC_ATTEMPT_STATUSES.SUCCESS,
      }),
    );
    expect(badges[INTEGRATION_SYSTEMS.AGENT_DB]).toEqual(
      expect.objectContaining({
        status: 'unknown',
        syncAttemptId: null,
      }),
    );
  });

  it('rejects Horizon reconciliation for a principal without mutation permission', () => {
    const principal = createPartnerPrincipal();
    const service = createService(principal);

    expect(() =>
      service.reconcileHorizonEvent(
        {
          eventId: 'HZ-DEMO-FORBIDDEN-1001',
          npn: '8101001',
          requestedStates: ['MI'],
          principal,
        },
        principal,
      ),
    ).toThrow(
      expect.objectContaining({
        code: SYNC_STATUS_SERVICE_ERROR_CODES.FORBIDDEN_ROLE,
      }),
    );
  });

  it('rejects a Horizon event without an agent code or NPN', () => {
    const principal = createAdminPrincipal();
    const service = createService(principal);

    expect(() =>
      service.reconcileHorizonEvent(
        {
          eventId: 'HZ-DEMO-INVALID-1001',
          requestedStates: ['PA'],
          principal,
        },
        principal,
      ),
    ).toThrow(
      expect.objectContaining({
        code: SYNC_STATUS_SERVICE_ERROR_CODES.INVALID_REQUEST,
      }),
    );
  });
});