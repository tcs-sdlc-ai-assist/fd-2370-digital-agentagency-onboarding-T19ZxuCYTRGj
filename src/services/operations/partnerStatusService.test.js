import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createPartnerStatusService,
  DEFAULT_PARTNER_STATUS_RECENT_DAYS,
  PARTNER_STATUS_LOOKUP_TYPES,
  PARTNER_STATUS_SERVICE_ERROR_CODES,
} from './partnerStatusService.js';

const TEST_TIME = '2026-08-24T12:00:00.000Z';
const PARTNER_CODE = 'DEMO_PARTNER';

function createPrincipal(partnerCode = PARTNER_CODE) {
  return {
    isAuthenticated: true,
    status: 'authenticated',
    role: 'partner',
    user: {
      id: 'usr_partner_demo',
      role: 'partner',
      partnerCode,
      organization: 'Demo Partner Network',
    },
    partnerContext: {
      partnerCode,
      organization: 'Demo Partner Network',
      scopeType: 'own_organization',
    },
  };
}

function createRecord(overrides = {}) {
  return {
    id: 'record_partner_status_1001',
    applicationId: 'APP-STATUS-1001',
    trackingId: 'TRK-STATUS-1001',
    applicationNumber: 'APP-NUMBER-1001',
    partnerCode: PARTNER_CODE,
    status: 'in_review',
    workflowStage: 'APPOINTMENT_PENDING',
    priority: 'normal',
    company: 'Banner',
    carrierCode: 'BANNER',
    gaCode: 'NATIONAL_DEMO',
    agentCode: 'PSTAT001',
    applicant: {
      type: 'individual',
      firstName: 'Jordan',
      lastName: 'Status',
      npn: '8701001',
      agentCode: 'PSTAT001',
    },
    contract: {
      type: 'PRODUCER',
      level: 'PRODUCER',
      commissionSchedule: 'STANDARD',
      advanceCommission: false,
      status: 'pending',
    },
    agency: {
      name: 'Synthetic Status Agency',
      type: 'BGA',
      code: 'AGY-STATUS-1001',
    },
    background: {
      status: 'accepted',
      completedAt: '2026-08-22T10:00:00.000Z',
    },
    appointment: {
      status: 'pending',
      states: ['PA'],
    },
    createdAt: '2026-08-20T09:00:00.000Z',
    updatedAt: '2026-08-24T10:00:00.000Z',
    ...overrides,
  };
}

function createHarness({
  records = [createRecord()],
  cacheTtlMs,
  clock,
} = {}) {
  const repository = {
    list: vi.fn(() => structuredClone(records)),
  };
  const lifecycleService = {
    getLifecycle: vi.fn((trackingId, options = {}) => ({
      trackingId,
      applicationId: options.record?.applicationId ?? null,
      currentStatus: 'Appointment',
      currentWorkflowStage:
        options.record?.workflowStage ?? null,
      updatedAt:
        options.record?.updatedAt ??
        '2026-08-24T10:00:00.000Z',
      milestones: [
        {
          status: 'Application Submitted',
          timestamp: '2026-08-21T09:00:00.000Z',
          actorType: 'partner_user',
          actorId: 'usr_partner_demo',
          source: 'partner_dashboard',
          summary: 'The application was submitted.',
        },
        {
          status: 'Appointment',
          timestamp: '2026-08-24T10:00:00.000Z',
          actorType: 'system',
          actorId: 'system',
          source: 'appointment_provider',
          summary: 'The appointment is pending.',
        },
      ],
      completedStatuses: [
        'New',
        'Application Started',
        'Application Submitted',
        'Application Under Review',
        'Background Check',
        'Appointment',
      ],
      remainingStatuses: ['Contracted'],
    })),
  };
  const syncStatusService = {
    getStatusBadges: vi.fn(() => ({
      agent_db: {
        system: 'agent_db',
        status: 'success',
        operation: 'upsert_pending_agent',
      },
      lifepro: {
        system: 'lifepro',
        status: 'unknown',
        operation: null,
      },
    })),
  };
  const notificationService = {
    getVisibilityFlags: vi.fn((trackingId) => ({
      trackingId,
      carrierSubmissionBlocked: false,
      hasWelcomeNotification: false,
      hasReminder: true,
      latestNotificationAt: '2026-08-24T09:00:00.000Z',
      notificationCount: 1,
    })),
  };
  const principal = createPrincipal();
  const service = createPartnerStatusService({
    repository,
    lifecycleService,
    syncStatusService,
    notificationService,
    auditService: false,
    principal,
    partnerContext: principal.partnerContext,
    clock: clock ?? (() => new Date(TEST_TIME)),
    ...(cacheTtlMs === undefined ? {} : { cacheTtlMs }),
  });

  return {
    lifecycleService,
    notificationService,
    principal,
    repository,
    service,
    syncStatusService,
  };
}

beforeEach(() => {
  globalThis.localStorage.clear();
});

describe('PartnerStatusService', () => {
  it.each([
    {
      lookupType: PARTNER_STATUS_LOOKUP_TYPES.TRACKING_ID,
      lookupValue: 'trk-status-1001',
    },
    {
      lookupType:
        PARTNER_STATUS_LOOKUP_TYPES.APPLICATION_NUMBER,
      lookupValue: 'app-number-1001',
    },
    {
      lookupType: PARTNER_STATUS_LOOKUP_TYPES.NPN,
      lookupValue: '8701001',
    },
    {
      lookupType: PARTNER_STATUS_LOOKUP_TYPES.AGENT_CODE,
      lookupValue: 'pstat001',
    },
  ])(
    'finds a partner-scoped record using $lookupType',
    ({ lookupType, lookupValue }) => {
      const { principal, service } = createHarness();
      const response = service.search(
        {
          partnerCode: PARTNER_CODE,
          lookupType,
          lookupValue,
          page: 1,
          pageSize: 10,
        },
        principal,
      );

      expect(response.total).toBe(1);
      expect(response.data).toHaveLength(1);
      expect(response.data[0]).toEqual(
        expect.objectContaining({
          trackingId: 'TRK-STATUS-1001',
          applicationId: 'APP-STATUS-1001',
          applicationNumber: 'APP-NUMBER-1001',
          partnerCode: PARTNER_CODE,
        }),
      );
    },
  );

  it('uses the 30-day default and excludes old or cross-partner records', () => {
    const records = [
      createRecord(),
      createRecord({
        id: 'record_partner_status_1002',
        applicationId: 'APP-STATUS-1002',
        trackingId: 'TRK-STATUS-1002',
        applicationNumber: 'APP-NUMBER-1002',
        agentCode: 'PSTAT002',
        applicant: {
          type: 'individual',
          firstName: 'Avery',
          lastName: 'Recent',
          npn: '8701002',
          agentCode: 'PSTAT002',
        },
        createdAt: '2026-08-10T09:00:00.000Z',
        updatedAt: '2026-08-10T10:00:00.000Z',
      }),
      createRecord({
        id: 'record_partner_status_old',
        applicationId: 'APP-STATUS-OLD',
        trackingId: 'TRK-STATUS-OLD',
        applicationNumber: 'APP-NUMBER-OLD',
        agentCode: 'PSTATOLD',
        applicant: {
          type: 'individual',
          firstName: 'Taylor',
          lastName: 'Old',
          npn: '8701098',
          agentCode: 'PSTATOLD',
        },
        createdAt: '2026-06-30T09:00:00.000Z',
        updatedAt: '2026-07-01T10:00:00.000Z',
      }),
      createRecord({
        id: 'record_other_partner',
        applicationId: 'APP-OTHER-1001',
        trackingId: 'TRK-OTHER-1001',
        applicationNumber: 'APP-OTHER-NUMBER-1001',
        partnerCode: 'OTHER_PARTNER',
        agentCode: 'OTHER001',
        applicant: {
          type: 'individual',
          firstName: 'Casey',
          lastName: 'Other',
          npn: '8799999',
          agentCode: 'OTHER001',
        },
      }),
    ];
    const { principal, service } = createHarness({ records });
    const response = service.search(
      {
        partnerCode: PARTNER_CODE,
        lookupType: PARTNER_STATUS_LOOKUP_TYPES.RECENT_DAYS,
        page: 1,
        pageSize: 25,
      },
      principal,
    );

    expect(DEFAULT_PARTNER_STATUS_RECENT_DAYS).toBe(30);
    expect(response.total).toBe(2);
    expect(response.data.map((record) => record.trackingId)).toEqual([
      'TRK-STATUS-1001',
      'TRK-STATUS-1002',
    ]);
    expect(response.data).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          partnerCode: 'OTHER_PARTNER',
        }),
      ]),
    );
  });

  it('projects only requested fields while preserving nested lifecycle values', () => {
    const { principal, service } = createHarness();
    const response = service.search(
      {
        partnerCode: PARTNER_CODE,
        lookupType: PARTNER_STATUS_LOOKUP_TYPES.TRACKING_ID,
        lookupValue: 'TRK-STATUS-1001',
        fields: [
          'trackingId',
          'lifecycle.currentStatus',
          'notificationFlags.carrierSubmissionBlocked',
        ],
        page: 1,
        pageSize: 10,
      },
      principal,
    );

    expect(response.data[0]).toEqual({
      trackingId: 'TRK-STATUS-1001',
      lifecycle: {
        currentStatus: 'Appointment',
      },
      notificationFlags: {
        carrierSubmissionBlocked: false,
      },
    });
    expect(response.data[0]).not.toHaveProperty('agent');
    expect(response.data[0]).not.toHaveProperty('contract');
    expect(response.data[0]).not.toHaveProperty('applicationId');
  });

  it('uses the lifecycle projection consistently and includes history only when requested', () => {
    const { lifecycleService, principal, service } = createHarness();
    const withoutHistory = service.search(
      {
        partnerCode: PARTNER_CODE,
        lookupType: PARTNER_STATUS_LOOKUP_TYPES.TRACKING_ID,
        lookupValue: 'TRK-STATUS-1001',
        includeHistory: false,
        page: 1,
        pageSize: 10,
      },
      principal,
    );
    const withHistory = service.search(
      {
        partnerCode: PARTNER_CODE,
        lookupType: PARTNER_STATUS_LOOKUP_TYPES.TRACKING_ID,
        lookupValue: 'TRK-STATUS-1001',
        includeHistory: true,
        page: 1,
        pageSize: 10,
      },
      principal,
    );

    expect(lifecycleService.getLifecycle).toHaveBeenCalledWith(
      'TRK-STATUS-1001',
      expect.objectContaining({
        record: expect.objectContaining({
          trackingId: 'TRK-STATUS-1001',
        }),
      }),
    );
    expect(withoutHistory.data[0].lifecycle).toEqual({
      currentStatus: 'Appointment',
      updatedAt: '2026-08-24T10:00:00.000Z',
    });
    expect(withHistory.data[0].lifecycle.currentStatus).toBe(
      'Appointment',
    );
    expect(withHistory.data[0].lifecycle.history).toEqual(
      withHistory.data[0].lifecycle.milestones,
    );
    expect(withHistory.data[0].lifecycle.history).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: 'Appointment',
        }),
      ]),
    );
  });

  it('serves repeated searches from cache and recomputes them after TTL expiry', () => {
    let currentTime = Date.parse(TEST_TIME);
    const clock = () => new Date(currentTime);
    const { principal, repository, service } = createHarness({
      cacheTtlMs: 1_000,
      clock,
    });
    const request = {
      partnerCode: PARTNER_CODE,
      lookupType: PARTNER_STATUS_LOOKUP_TYPES.TRACKING_ID,
      lookupValue: 'TRK-STATUS-1001',
      page: 1,
      pageSize: 10,
    };

    const firstResponse = service.search(request, principal);
    const cachedResponse = service.search(request, principal);

    expect(firstResponse.cached).toBe(false);
    expect(cachedResponse.cached).toBe(true);
    expect(cachedResponse.data).toEqual(firstResponse.data);
    expect(repository.list).toHaveBeenCalledTimes(1);

    currentTime += 1_001;

    const refreshedResponse = service.search(request, principal);

    expect(refreshedResponse.cached).toBe(false);
    expect(repository.list).toHaveBeenCalledTimes(2);
  });

  it('denies a search for a partner outside the authenticated scope', () => {
    const { principal, repository, service } = createHarness();

    expect(() =>
      service.search(
        {
          partnerCode: 'OTHER_PARTNER',
          lookupType: PARTNER_STATUS_LOOKUP_TYPES.RECENT_DAYS,
          page: 1,
          pageSize: 10,
        },
        principal,
      ),
    ).toThrow(
      expect.objectContaining({
        code:
          PARTNER_STATUS_SERVICE_ERROR_CODES.PARTNER_SCOPE_VIOLATION,
      }),
    );
    expect(repository.list).not.toHaveBeenCalled();
  });

  it('rejects a direct lookup without a lookup value', () => {
    const { principal, repository, service } = createHarness();

    expect(() =>
      service.search(
        {
          partnerCode: PARTNER_CODE,
          lookupType: PARTNER_STATUS_LOOKUP_TYPES.NPN,
          page: 1,
          pageSize: 10,
        },
        principal,
      ),
    ).toThrow(
      expect.objectContaining({
        code: PARTNER_STATUS_SERVICE_ERROR_CODES.INVALID_REQUEST,
      }),
    );
    expect(repository.list).not.toHaveBeenCalled();
  });
});