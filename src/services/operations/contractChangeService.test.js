import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  WORK_ITEM_STATES,
  WORK_ITEM_TYPES,
} from '../../constants/domain.js';
import {
  PARTNER_SCOPE_TYPES,
  ROLES,
} from '../../constants/roles.js';
import {
  CONTRACT_CHANGE_STATUSES,
  CONTRACT_CHANGE_TYPES,
} from '../../repositories/contractChangeRepository.js';
import {
  COMPLEX_CONTRACT_CHANGE_TYPES,
  CONTRACT_CHANGE_SERVICE_ACTIONS,
  CONTRACT_CHANGE_SERVICE_ERROR_CODES,
  createContractChangeService,
  SIMPLE_CONTRACT_CHANGE_TYPES,
} from './contractChangeService.js';

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

function createChangeRequest(overrides = {}) {
  return {
    applicationId: 'APP-DEMO-1006',
    trackingId: 'TRK-DEMO-1006',
    partnerCode: 'QUILITY',
    changeType: CONTRACT_CHANGE_TYPES.COMMISSION_SCHEDULE,
    requestedBy: 'usr_admin_demo',
    payload: {
      currentValue: 'SENIOR',
      requestedValue: 'STANDARD',
      reason: 'Apply the synthetic standard commission schedule.',
    },
    ...overrides,
  };
}

function createHarness(principal = createAdminPrincipal()) {
  const auditService = {
    append: vi.fn((event, options) => ({
      ...structuredClone(event),
      auditEventId: `AUD-CONTRACT-CHANGE-${auditService.append.mock.calls.length}`,
      auditOptions: structuredClone(options),
    })),
  };
  const eventPublisher = {
    publishChangeRequestSubmitted: vi.fn((payload, options) => ({
      eventId: `EVT-CONTRACT-CHANGE-${eventPublisher.publishChangeRequestSubmitted.mock.calls.length}`,
      eventName: 'onboarding:change-request-submitted',
      occurredAt: options.occurredAt,
      payload: structuredClone(payload),
    })),
  };
  const service = createContractChangeService({
    principal,
    partnerContext: principal.partnerContext,
    storage: globalThis.localStorage,
    clock: () => new Date(TEST_TIME),
    auditService,
    eventPublisher,
    strictAudit: true,
    strictPublication: true,
  });

  return {
    auditService,
    eventPublisher,
    principal,
    service,
  };
}

beforeEach(() => {
  globalThis.localStorage.clear();
});

describe('ContractChangeService', () => {
  it.each([
    {
      changeType: CONTRACT_CHANGE_TYPES.COMMISSION_SCHEDULE,
      payload: {
        currentValue: 'SENIOR',
        requestedValue: 'STANDARD',
        reason: 'Apply the synthetic standard commission schedule.',
      },
      expectedStatus: CONTRACT_CHANGE_STATUSES.COMPLETED,
      expectedManualRouting: false,
    },
    {
      changeType: CONTRACT_CHANGE_TYPES.ASSIGNEE,
      payload: {
        currentValue: 'usr_operations_demo',
        requestedValue: 'usr_manager_demo',
        assignedTo: 'usr_manager_demo',
        assignedGroup: 'manager',
        reason: 'Assign the synthetic record to the manager queue.',
      },
      expectedStatus: CONTRACT_CHANGE_STATUSES.COMPLETED,
      expectedManualRouting: false,
    },
    {
      changeType: CONTRACT_CHANGE_TYPES.HIERARCHY,
      payload: {
        currentValue: 'NATIONAL_DEMO',
        requestedValue: 'REGIONAL_DEMO',
        requestedGaCode: 'REGIONAL_DEMO',
        reason: 'Move the synthetic contract to a regional hierarchy.',
      },
      expectedStatus: CONTRACT_CHANGE_STATUSES.MANUAL_ROUTED,
      expectedManualRouting: true,
    },
    {
      changeType: CONTRACT_CHANGE_TYPES.LEVEL,
      payload: {
        currentValue: 'SENIOR_PRODUCER',
        requestedValue: 'GENERAL_AGENCY',
        level: 'GENERAL_AGENCY',
        reason: 'Review a synthetic general agency level change.',
      },
      expectedStatus: CONTRACT_CHANGE_STATUSES.MANUAL_ROUTED,
      expectedManualRouting: true,
    },
  ])(
    'supports $changeType changes and applies the expected routing outcome',
    ({
      changeType,
      expectedManualRouting,
      expectedStatus,
      payload,
    }) => {
      const { principal, service } = createHarness();
      const result = service.create(
        createChangeRequest({
          changeType,
          payload,
        }),
        principal,
      );

      expect(result.changeRequest).toEqual(
        expect.objectContaining({
          applicationId: undefined,
          trackingId: 'TRK-DEMO-1006',
          partnerCode: 'QUILITY',
          changeType,
          status: expectedStatus,
          manualReviewRequired: expectedManualRouting,
        }),
      );
      expect(result.validation.valid).toBe(true);
      expect(result.eligibility).toEqual(
        expect.objectContaining({
          eligible: true,
        }),
      );
      expect(result.manuallyRouted).toBe(expectedManualRouting);
      expect(result.autoAccepted).toBe(!expectedManualRouting);

      if (expectedManualRouting) {
        expect(result.workItem).toEqual(
          expect.objectContaining({
            cardType: WORK_ITEM_TYPES.DTCC_MANUAL_CHANGE,
            state: WORK_ITEM_STATES.ACTION_NEEDED,
            sourceRecordId: result.changeRequestId,
            trackingId: 'TRK-DEMO-1006',
          }),
        );
      } else {
        expect(result.workItem).toBeNull();
      }
    },
  );

  it('auto-accepts a simple commission change and records audit and publication events', () => {
    const {
      auditService,
      eventPublisher,
      principal,
      service,
    } = createHarness();

    const result = service.create(
      createChangeRequest(),
      principal,
    );

    expect(SIMPLE_CONTRACT_CHANGE_TYPES).toContain(
      CONTRACT_CHANGE_TYPES.COMMISSION_SCHEDULE,
    );
    expect(result).toEqual(
      expect.objectContaining({
        status: CONTRACT_CHANGE_STATUSES.COMPLETED,
        autoAccepted: true,
        manuallyRouted: false,
        workItem: null,
      }),
    );
    expect(result.changeRequest.outcome).toEqual(
      expect.objectContaining({
        result: 'updated',
        approvedBy: 'system',
        autoAccepted: true,
        affectedCount: 1,
      }),
    );

    expect(auditService.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: CONTRACT_CHANGE_SERVICE_ACTIONS.AUTO_ACCEPTED,
        trackingId: 'TRK-DEMO-1006',
        changeRequestId: result.changeRequestId,
        source: 'contract_change',
        metadata: expect.objectContaining({
          changeRequestId: result.changeRequestId,
          changeType: CONTRACT_CHANGE_TYPES.COMMISSION_SCHEDULE,
          partnerCode: 'QUILITY',
          status: CONTRACT_CHANGE_STATUSES.COMPLETED,
          affectedCount: 1,
        }),
      }),
      expect.objectContaining({
        actor: principal,
        source: 'contract_change',
      }),
    );
    expect(
      eventPublisher.publishChangeRequestSubmitted,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        changeRequestId: result.changeRequestId,
        trackingId: 'TRK-DEMO-1006',
        partnerCode: 'QUILITY',
        changeType: CONTRACT_CHANGE_TYPES.COMMISSION_SCHEDULE,
        requestedBy: 'usr_admin_demo',
        status: CONTRACT_CHANGE_STATUSES.COMPLETED,
        manualReviewRequired: false,
      }),
      expect.objectContaining({
        occurredAt: TEST_TIME,
      }),
    );

    const persisted = service.find(
      result.changeRequestId,
      principal,
    );

    expect(persisted).toEqual(
      expect.objectContaining({
        changeRequestId: result.changeRequestId,
        status: CONTRACT_CHANGE_STATUSES.COMPLETED,
      }),
    );
  });

  it('rejects a commission change that violates the shared ABNCA advance rule', () => {
    const {
      auditService,
      principal,
      service,
    } = createHarness();

    const result = service.create(
      createChangeRequest({
        payload: {
          currentValue: 'SENIOR',
          requestedValue: 'ABNCA',
          reason:
            'Exercise the synthetic ABNCA advance validation rule.',
          requestedValues: {
            contract: {
              advanceCommission: true,
            },
          },
        },
      }),
      principal,
    );

    expect(result).toEqual(
      expect.objectContaining({
        status: CONTRACT_CHANGE_STATUSES.REJECTED,
        autoAccepted: false,
        manuallyRouted: false,
        workItem: null,
      }),
    );
    expect(result.validation.valid).toBe(false);
    expect(result.validation.validationCodes).toEqual(
      expect.arrayContaining(['ABNCA_NO_ADVANCE']),
    );
    expect(result.eligibility).toBeNull();
    expect(result.changeRequest.outcome).toEqual(
      expect.objectContaining({
        result: 'rejected',
        validationValid: false,
        validationCodes: expect.arrayContaining([
          'ABNCA_NO_ADVANCE',
        ]),
      }),
    );
    expect(auditService.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: CONTRACT_CHANGE_SERVICE_ACTIONS.REJECTED,
        metadata: expect.objectContaining({
          validationCodes: expect.arrayContaining([
            'ABNCA_NO_ADVANCE',
          ]),
        }),
      }),
      expect.any(Object),
    );
  });

  it('routes a complex hierarchy change to the distribution workbench', () => {
    const {
      auditService,
      principal,
      service,
    } = createHarness();

    const result = service.create(
      createChangeRequest({
        changeType: CONTRACT_CHANGE_TYPES.HIERARCHY,
        payload: {
          currentValue: 'NATIONAL_DEMO',
          requestedValue: 'REGIONAL_DEMO',
          requestedGaCode: 'REGIONAL_DEMO',
          reason:
            'Move the synthetic producer to the regional hierarchy.',
        },
      }),
      principal,
    );

    expect(COMPLEX_CONTRACT_CHANGE_TYPES).toContain(
      CONTRACT_CHANGE_TYPES.HIERARCHY,
    );
    expect(result.changeRequest).toEqual(
      expect.objectContaining({
        status: CONTRACT_CHANGE_STATUSES.MANUAL_ROUTED,
        manualReviewRequired: true,
        createdWorkItemId: result.workItem.workItemId,
      }),
    );
    expect(result.workItem).toEqual(
      expect.objectContaining({
        cardType: WORK_ITEM_TYPES.DTCC_MANUAL_CHANGE,
        state: WORK_ITEM_STATES.ACTION_NEEDED,
        priority: 'medium',
        assignedGroup: 'distribution',
        partnerCode: 'QUILITY',
      }),
    );
    expect(result.workItem.metadata).toEqual(
      expect.objectContaining({
        applicationId: 'APP-DEMO-1006',
        changeRequestId: result.changeRequestId,
        changeType: CONTRACT_CHANGE_TYPES.HIERARCHY,
        affectedCount: 1,
      }),
    );
    expect(auditService.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: CONTRACT_CHANGE_SERVICE_ACTIONS.MANUAL_ROUTED,
        metadata: expect.objectContaining({
          workItemId: result.workItem.workItemId,
          affectedCount: 1,
        }),
      }),
      expect.any(Object),
    );
  });

  it('routes a mass simple change for high-priority manual review', () => {
    const { principal, service } = createHarness();

    const result = service.create(
      createChangeRequest({
        affectedCount: 4,
      }),
      principal,
    );

    expect(result).toEqual(
      expect.objectContaining({
        status: CONTRACT_CHANGE_STATUSES.MANUAL_ROUTED,
        manuallyRouted: true,
        autoAccepted: false,
      }),
    );
    expect(result.changeRequest.payload).toEqual(
      expect.objectContaining({
        affectedCount: 4,
      }),
    );
    expect(result.workItem).toEqual(
      expect.objectContaining({
        cardType: WORK_ITEM_TYPES.DTCC_MANUAL_CHANGE,
        state: WORK_ITEM_STATES.ACTION_NEEDED,
        priority: 'high',
        assignedGroup: 'operations',
      }),
    );
    expect(result.workItem.metadata).toEqual(
      expect.objectContaining({
        affectedCount: 4,
      }),
    );
  });

  it('rejects contract change creation for a role without management permission', () => {
    const principal = createPartnerPrincipal();
    const { auditService, eventPublisher, service } =
      createHarness(principal);

    expect(() =>
      service.create(
        createChangeRequest({
          partnerCode: 'DEMO_PARTNER',
          requestedBy: 'usr_partner_demo',
        }),
        principal,
      ),
    ).toThrow(
      expect.objectContaining({
        code: CONTRACT_CHANGE_SERVICE_ERROR_CODES.FORBIDDEN_ROLE,
      }),
    );
    expect(auditService.append).not.toHaveBeenCalled();
    expect(
      eventPublisher.publishChangeRequestSubmitted,
    ).not.toHaveBeenCalled();
  });
});