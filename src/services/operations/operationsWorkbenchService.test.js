import { beforeEach, describe, expect, it } from 'vitest';
import {
  WORKFLOW_STAGES,
  WORK_ITEM_STATES,
  WORK_ITEM_TYPES,
} from '../../constants/domain.js';
import {
  PARTNER_SCOPE_TYPES,
  ROLES,
} from '../../constants/roles.js';
import {
  createOperationsWorkbenchService,
  OPERATIONS_WORKBENCH_ERROR_CODES,
} from './operationsWorkbenchService.js';

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

function createLicensingPrincipal() {
  return createPrincipal(ROLES.LICENSING, 'usr_licensing_demo', {
    scopeType: PARTNER_SCOPE_TYPES.ASSIGNED_WORK,
  });
}

function createPartnerPrincipal() {
  return createPrincipal(ROLES.PARTNER, 'usr_partner_demo', {
    partnerCode: 'DEMO_PARTNER',
    scopeType: PARTNER_SCOPE_TYPES.OWN_ORGANIZATION,
  });
}

function createService(principal = createAdminPrincipal()) {
  return createOperationsWorkbenchService({
    principal,
    partnerContext: principal.partnerContext,
    storage: globalThis.localStorage,
    clock: () => new Date(TEST_TIME),
    auditService: false,
  });
}

function createDerivationRecord(overrides = {}) {
  return {
    id: 'record_workbench_derivation_1001',
    applicationId: 'APP-WORKBENCH-DERIVE-1001',
    trackingId: 'TRK-WORKBENCH-DERIVE-1001',
    partnerCode: 'DERIVATION_DEMO',
    company: 'Banner',
    workflowStage: WORKFLOW_STAGES.MANUAL_EXCEPTION,
    status: 'action_required',
    applicant: {
      type: 'individual',
      firstName: 'Jordan',
      lastName: 'Workbench',
      npn: '8801001',
    },
    assignment: {
      team: 'manager',
      assigneeUserId: 'usr_manager_demo',
    },
    background: {
      status: 'review',
      providerCode: 'BIG',
      referenceId: 'BGC-WORKBENCH-DERIVE-1001',
      validationCodes: ['BACKGROUND_ADJUDICATION_REQUIRED'],
    },
    appointment: {
      status: 'rejected',
      providerCode: 'SIRCON_VERTAFORE',
      referenceId: 'APT-WORKBENCH-DERIVE-1001',
      states: ['PA'],
      validationCodes: ['APPOINTMENT_STATE_ELIGIBILITY_FAILED'],
    },
    exceptions: [
      {
        code: 'DERIVATION_REVIEW_REQUIRED',
        status: 'open',
        message: 'The synthetic application requires operational review.',
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  globalThis.localStorage.clear();
});

describe('OperationsWorkbenchService', () => {
  it('returns every supported operational card type for an administrator', () => {
    const principal = createAdminPrincipal();
    const service = createService(principal);
    const response = service.search(
      {
        includeCompleted: true,
        page: 1,
        pageSize: 100,
      },
      principal,
    );
    const returnedCardTypes = new Set(
      response.items.map((workItem) => workItem.cardType),
    );

    expect(response.total).toBeGreaterThan(0);
    expect(returnedCardTypes).toEqual(
      new Set(Object.values(WORK_ITEM_TYPES)),
    );
    expect(response.counts).toEqual(
      expect.objectContaining({
        [WORK_ITEM_STATES.PENDING]: expect.any(Number),
        [WORK_ITEM_STATES.ACTION_NEEDED]: expect.any(Number),
        [WORK_ITEM_STATES.COMPLETED]: expect.any(Number),
      }),
    );
  });

  it('derives background, appointment, exception, and distribution cards from onboarding state', () => {
    const principal = createAdminPrincipal();
    const service = createService(principal);
    const derivedItems = service.deriveWorkItems(
      createDerivationRecord(),
      {
        principal,
      },
    );
    const cardTypes = derivedItems.map(
      (workItem) => workItem.cardType,
    );

    expect(cardTypes).toEqual(
      expect.arrayContaining([
        WORK_ITEM_TYPES.BACKGROUND_CHECK,
        WORK_ITEM_TYPES.APPOINTMENT,
        WORK_ITEM_TYPES.EXCEPTION,
        WORK_ITEM_TYPES.DISTRIBUTION_APPROVAL,
      ]),
    );
    expect(derivedItems).toHaveLength(4);
    expect(derivedItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          cardType: WORK_ITEM_TYPES.BACKGROUND_CHECK,
          state: WORK_ITEM_STATES.ACTION_NEEDED,
          trackingId: 'TRK-WORKBENCH-DERIVE-1001',
        }),
        expect.objectContaining({
          cardType: WORK_ITEM_TYPES.APPOINTMENT,
          state: WORK_ITEM_STATES.ACTION_NEEDED,
        }),
        expect.objectContaining({
          cardType: WORK_ITEM_TYPES.EXCEPTION,
          assignedGroup: 'manager',
        }),
        expect.objectContaining({
          cardType: WORK_ITEM_TYPES.DISTRIBUTION_APPROVAL,
          assignedGroup: 'manager',
        }),
      ]),
    );

    const persisted = service.search(
      {
        trackingId: 'TRK-WORKBENCH-DERIVE-1001',
        includeCompleted: true,
        page: 1,
        pageSize: 100,
      },
      principal,
    );

    expect(persisted.items).toHaveLength(4);
  });

  it('does not create duplicate derived cards for the same source record', () => {
    const principal = createAdminPrincipal();
    const service = createService(principal);
    const record = createDerivationRecord();

    const firstResult = service.deriveWorkItems(record, {
      principal,
    });
    const secondResult = service.deriveWorkItems(record, {
      principal,
    });

    expect(secondResult.map((item) => item.workItemId)).toEqual(
      firstResult.map((item) => item.workItemId),
    );

    const persisted = service.search(
      {
        trackingId: record.trackingId,
        includeCompleted: true,
        page: 1,
        pageSize: 100,
      },
      principal,
    );

    expect(persisted.total).toBe(4);
  });

  it('filters assigned-work results to the licensing principal scope', () => {
    const principal = createLicensingPrincipal();
    const service = createService(principal);
    const response = service.search(
      {
        includeCompleted: true,
        page: 1,
        pageSize: 100,
      },
      principal,
    );

    expect(response.items.length).toBeGreaterThan(0);
    expect(
      response.items.every(
        (workItem) =>
          workItem.assignedTo === principal.user.id ||
          workItem.assignedGroup === principal.role,
      ),
    ).toBe(true);
    expect(response.items.map((item) => item.workItemId)).toEqual(
      expect.arrayContaining([
        'WI-DEMO-1001',
        'WI-DEMO-1003',
        'WI-DEMO-1009',
      ]),
    );
    expect(response.items).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          workItemId: 'WI-DEMO-1004',
        }),
      ]),
    );
  });

  it('rejects workbench searches from a role without workbench permission', () => {
    const principal = createPartnerPrincipal();
    const service = createService(principal);

    expect(() =>
      service.search(
        {
          page: 1,
          pageSize: 25,
        },
        principal,
      ),
    ).toThrow(
      expect.objectContaining({
        code: OPERATIONS_WORKBENCH_ERROR_CODES.FORBIDDEN_ROLE,
      }),
    );
  });

  it('assigns a work item and records assignment history on the card', () => {
    const principal = createAdminPrincipal();
    const service = createService(principal);
    const workItem = service.get(
      'WI-DEMO-1002',
      principal,
    );

    const response = service.assign(
      workItem.workItemId,
      {
        assignedTo: 'usr_manager_demo',
        assignedGroup: 'manager',
        assignmentReason: 'SYNTHETIC_ESCALATION',
        comment: 'Escalated to the demo manager for review.',
        expectedUpdatedAt: workItem.updatedAt,
        principal,
      },
      principal,
    );

    expect(response.assignment).toEqual(
      expect.objectContaining({
        workItemId: workItem.workItemId,
        trackingId: workItem.trackingId,
        assignedTo: 'usr_manager_demo',
        assignedGroup: 'manager',
        assignedBy: 'usr_admin_demo',
        assignmentReason: 'SYNTHETIC_ESCALATION',
        status: 'active',
      }),
    );
    expect(response.workItem).toEqual(
      expect.objectContaining({
        assignedTo: 'usr_manager_demo',
        assignedGroup: 'manager',
      }),
    );
    expect(response.workItem.history.at(-1)).toEqual(
      expect.objectContaining({
        actorId: 'usr_admin_demo',
        comment: 'Escalated to the demo manager for review.',
        assignmentReason: 'SYNTHETIC_ESCALATION',
      }),
    );

    const persisted = service.get(workItem.workItemId, principal);

    expect(persisted.assignedTo).toBe('usr_manager_demo');
    expect(persisted.assignedGroup).toBe('manager');
  });

  it('transitions a card through action needed and completed while preserving history', () => {
    const principal = createAdminPrincipal();
    const service = createService(principal);
    const original = service.get('WI-DEMO-1001', principal);

    const actionNeeded = service.transition(
      original.workItemId,
      {
        targetState: WORK_ITEM_STATES.ACTION_NEEDED,
        comment: 'Additional appointment evidence is required.',
        reasonCode: 'EVIDENCE_REQUIRED',
        expectedUpdatedAt: original.updatedAt,
        principal,
      },
      principal,
    );

    expect(actionNeeded.previousState).toBe(
      WORK_ITEM_STATES.PENDING,
    );
    expect(actionNeeded.currentState).toBe(
      WORK_ITEM_STATES.ACTION_NEEDED,
    );
    expect(actionNeeded.workItem.history.at(-1)).toEqual(
      expect.objectContaining({
        previousState: WORK_ITEM_STATES.PENDING,
        currentState: WORK_ITEM_STATES.ACTION_NEEDED,
        actorId: 'usr_admin_demo',
        comment: 'Additional appointment evidence is required.',
        reasonCode: 'EVIDENCE_REQUIRED',
      }),
    );

    const completed = service.transition(
      original.workItemId,
      {
        targetState: WORK_ITEM_STATES.COMPLETED,
        comment: 'Synthetic appointment evidence was accepted.',
        expectedUpdatedAt: actionNeeded.updatedAt,
        principal,
      },
      principal,
    );

    expect(completed.previousState).toBe(
      WORK_ITEM_STATES.ACTION_NEEDED,
    );
    expect(completed.currentState).toBe(
      WORK_ITEM_STATES.COMPLETED,
    );
    expect(completed.completedAt).toBe(TEST_TIME);
    expect(completed.workItem.history).toHaveLength(
      original.history.length + 2,
    );
    expect(completed.workItem.history.at(-1)).toEqual(
      expect.objectContaining({
        previousState: WORK_ITEM_STATES.ACTION_NEEDED,
        currentState: WORK_ITEM_STATES.COMPLETED,
        actorId: 'usr_admin_demo',
      }),
    );
  });

  it('requires a comment before transitioning a card to action needed', () => {
    const principal = createAdminPrincipal();
    const service = createService(principal);
    const workItem = service.get('WI-DEMO-1001', principal);

    expect(() =>
      service.transition(
        workItem.workItemId,
        {
          targetState: WORK_ITEM_STATES.ACTION_NEEDED,
          comment: '   ',
          expectedUpdatedAt: workItem.updatedAt,
          principal,
        },
        principal,
      ),
    ).toThrow(
      expect.objectContaining({
        code:
          OPERATIONS_WORKBENCH_ERROR_CODES.INVALID_STATE_TRANSITION,
      }),
    );

    expect(
      service.get(workItem.workItemId, principal).state,
    ).toBe(WORK_ITEM_STATES.PENDING);
  });

  it('prevents completed cards from reopening without explicit authorization', () => {
    const principal = createLicensingPrincipal();
    const service = createService(principal);
    const workItem = service.get('WI-DEMO-1009', principal);

    expect(workItem.state).toBe(WORK_ITEM_STATES.COMPLETED);
    expect(() =>
      service.transition(
        workItem.workItemId,
        {
          targetState: WORK_ITEM_STATES.PENDING,
          allowReopen: true,
          comment: 'Attempt to reopen completed work.',
          expectedUpdatedAt: workItem.updatedAt,
          principal,
        },
        principal,
      ),
    ).toThrow(
      expect.objectContaining({
        code: OPERATIONS_WORKBENCH_ERROR_CODES.FORBIDDEN_ROLE,
      }),
    );
  });

  it('creates an idempotent manual DTCC route with operational history', () => {
    const principal = createAdminPrincipal();
    const service = createService(principal);
    const request = {
      sourceRecordId: 'DTCC-DEMO-CHANGE-TEST-1001',
      transactionType: 'name_change',
      partnerCode: 'DTCC_DEMO',
      rawSummary:
        'Synthetic representative name correction for workbench testing.',
      assignedGroup: 'operations',
      metadata: {
        synthetic: true,
      },
      principal,
    };

    const created = service.createFromDtccManualRoute(
      request,
      principal,
    );
    const repeated = service.createFromDtccManualRoute(
      request,
      principal,
    );

    expect(created).toEqual(
      expect.objectContaining({
        workItemId: repeated.workItemId,
        trackingId: null,
        sourceRecordId: request.sourceRecordId,
        cardType: WORK_ITEM_TYPES.DTCC_MANUAL_CHANGE,
        state: WORK_ITEM_STATES.PENDING,
        assignedGroup: 'operations',
        partnerCode: 'DTCC_DEMO',
      }),
    );
    expect(created.metadata).toEqual(
      expect.objectContaining({
        transactionType: 'name_change',
        rawSummary: request.rawSummary,
        requestedBy: 'usr_admin_demo',
        synthetic: true,
      }),
    );
    expect(created.history).toEqual([
      expect.objectContaining({
        previousState: null,
        currentState: WORK_ITEM_STATES.PENDING,
        actorId: 'usr_admin_demo',
        comment:
          'Non-onboarding DTCC transaction routed for manual processing.',
      }),
    ]);

    const searchResult = service.search(
      {
        sourceRecordId: request.sourceRecordId,
        includeCompleted: true,
        page: 1,
        pageSize: 25,
      },
      principal,
    );

    expect(searchResult.total).toBe(1);
    expect(searchResult.items[0].workItemId).toBe(
      created.workItemId,
    );
  });
});