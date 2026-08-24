import { beforeEach, describe, expect, it } from 'vitest';
import {
  JOURNEY_STEP_IDS,
  JOURNEY_TYPES,
} from './journeyDefinitions.js';
import {
  buildJourneyRoute,
  createJourneyService,
  JOURNEY_SAVE_MODES,
  JOURNEY_SERVICE_ERROR_CODES,
  JOURNEY_SIGN_OFF_STATES,
} from './journeyService.js';

const TEST_TIME = '2026-08-24T12:00:00.000Z';
const PARTNER_CODE = 'DEMO_PARTNER';

function createService(partnerCode = PARTNER_CODE) {
  return createJourneyService({
    partnerCode,
    storage: globalThis.localStorage,
    clock: () => new Date(TEST_TIME),
    auditService: false,
  });
}

function createIndividualApplication(overrides = {}) {
  return {
    partnerCode: PARTNER_CODE,
    journeyType: JOURNEY_TYPES.AGENT_CONTRACTING,
    requestType: 'new_onboarding',
    company: 'Banner',
    carrierCode: 'BANNER',
    gaCode: 'NATIONAL_DEMO',
    sourceMetadata: {
      sourceChannel: 'PARTNER_DASHBOARD',
      sourceFormat: 'MANUAL_FORM',
      partnerCode: PARTNER_CODE,
    },
    agency: {
      name: 'Synthetic Journey Agency',
      type: 'BGA',
      code: 'AGY-DEMO-JOURNEY',
    },
    agent: {
      type: 'individual',
      firstName: 'Jamie',
      lastName: 'Journey',
      email: 'jamie.journey@example.test',
      npn: '8401001',
      residenceState: 'PA',
    },
    licensing: {
      residentState: 'PA',
      licenseNumber: 'PA-DEMO-8401001',
      linesOfAuthority: ['LIFE'],
    },
    contract: {
      type: 'PRODUCER',
      level: 'PRODUCER',
      commissionSchedule: 'STANDARD',
      advanceCommission: false,
    },
    banking: {
      paymentMethod: 'EFT',
      routingNumber: '021000021',
      accountNumber: '0000123456',
      accountType: 'checking',
      accountHolderName: 'Jamie Journey',
    },
    attestations: {
      backgroundQuestionsClear: true,
      informationAccurate: true,
      electronicDeliveryConsent: true,
    },
    ...overrides,
  };
}

beforeEach(() => {
  globalThis.localStorage.clear();
});

describe('JourneyService', () => {
  it('prefills normalized application data and skips completed steps', () => {
    const service = createService();
    const application = createIndividualApplication();
    const view = service.initiateJourney({
      partnerCode: PARTNER_CODE,
      journeyType: JOURNEY_TYPES.AGENT_CONTRACTING,
      prefillPayload: application,
      skipPrefilled: true,
    });

    expect(view.trackingId).toMatch(/^TRK-/);
    expect(view.applicationId).toMatch(/^APP-/);
    expect(view.draft.formState).toEqual(
      expect.objectContaining({
        company: 'Banner',
        gaCode: 'NATIONAL_DEMO',
        agent: expect.objectContaining({
          firstName: 'Jamie',
          lastName: 'Journey',
          npn: '8401001',
        }),
      }),
    );
    expect(view.prefill[JOURNEY_STEP_IDS.APPLICANT]).toEqual(
      expect.objectContaining({
        agent: expect.objectContaining({
          firstName: 'Jamie',
          lastName: 'Journey',
        }),
      }),
    );
    expect(view.prefill[JOURNEY_STEP_IDS.SOURCE_REVIEW]).toEqual(
      expect.objectContaining({
        sourceMetadata: expect.objectContaining({
          sourceChannel: 'PARTNER_DASHBOARD',
          sourceFormat: 'MANUAL_FORM',
        }),
      }),
    );
    expect(view.skippedSteps).toEqual(
      expect.arrayContaining([
        JOURNEY_STEP_IDS.SOURCE_REVIEW,
        JOURNEY_STEP_IDS.AGENCY,
        JOURNEY_STEP_IDS.APPLICANT,
        JOURNEY_STEP_IDS.LICENSING,
        JOURNEY_STEP_IDS.CONTRACT,
        JOURNEY_STEP_IDS.COMMISSION,
        JOURNEY_STEP_IDS.BANKING,
        JOURNEY_STEP_IDS.HIERARCHY,
        JOURNEY_STEP_IDS.ATTESTATIONS,
      ]),
    );
  });

  it('selects dynamic registered-representative steps and omits inapplicable steps', () => {
    const service = createService();
    const application = createIndividualApplication({
      journeyType: JOURNEY_TYPES.REGISTERED_REP,
      agent: {
        type: 'individual',
        firstName: 'Avery',
        lastName: 'Representative',
        email: 'avery.representative@example.test',
        npn: '8401002',
        crd: '740002',
        residenceState: 'NJ',
      },
      contract: {
        type: 'registered_representative',
        level: 'PRODUCER',
        commissionSchedule: 'STANDARD',
        advanceCommission: false,
      },
      registration: {
        brokerDealer: 'Synthetic Broker Dealer',
        status: 'ACTIVE',
      },
    });
    const view = service.initiateJourney({
      partnerCode: PARTNER_CODE,
      journeyType: JOURNEY_TYPES.REGISTERED_REP,
      prefillPayload: application,
      skipPrefilled: false,
    });
    const stepIds = view.steps.map((step) => step.id);

    expect(stepIds).toContain(JOURNEY_STEP_IDS.REGISTRATION);
    expect(stepIds).toContain(JOURNEY_STEP_IDS.LICENSING);
    expect(stepIds).toContain(JOURNEY_STEP_IDS.CONTRACT);
    expect(stepIds).not.toContain(JOURNEY_STEP_IDS.BANKING);
    expect(stepIds).not.toContain(
      JOURNEY_STEP_IDS.ERRORS_AND_OMISSIONS,
    );
    expect(stepIds).not.toContain(JOURNEY_STEP_IDS.PRINCIPALS);
    expect(stepIds).not.toContain(JOURNEY_STEP_IDS.HIERARCHY);
  });

  it('persists Save and Exit state and resumes it from a new service instance', () => {
    const service = createService();
    const initiated = service.initiateJourney({
      partnerCode: PARTNER_CODE,
      journeyType: JOURNEY_TYPES.AGENT_CONTRACTING,
      prefillPayload: createIndividualApplication(),
      skipPrefilled: false,
    });
    const resumeUrl = buildJourneyRoute(
      JOURNEY_TYPES.AGENT_CONTRACTING,
      initiated.trackingId,
      JOURNEY_STEP_IDS.BANKING,
    );
    const saved = service.saveDraft(
      initiated.trackingId,
      {
        currentStepId: JOURNEY_STEP_IDS.BANKING,
        resumeUrl,
        formState: {
          banking: {
            paymentMethod: 'DIRECT_DEPOSIT',
            routingNumber: '021000021',
            accountNumber: '0000998877',
            accountType: 'checking',
            accountHolderName: 'Jamie Journey',
          },
        },
      },
      {
        expectedVersion: initiated.version,
        saveMode: JOURNEY_SAVE_MODES.SAVE_AND_EXIT,
      },
    );

    expect(saved.version).toBe(2);
    expect(saved.draft.saveMode).toBe(
      JOURNEY_SAVE_MODES.SAVE_AND_EXIT,
    );
    expect(saved.currentStepId).toBe(JOURNEY_STEP_IDS.BANKING);
    expect(saved.resumeUrl).toBe(resumeUrl);

    const resumed = createService().loadDraft(initiated.trackingId, {
      partnerCode: PARTNER_CODE,
    });

    expect(resumed.version).toBe(2);
    expect(resumed.currentStepId).toBe(JOURNEY_STEP_IDS.BANKING);
    expect(resumed.draft.formState.banking).toEqual(
      expect.objectContaining({
        paymentMethod: 'DIRECT_DEPOSIT',
        accountNumber: '0000998877',
      }),
    );
  });

  it('isolates resumable drafts by partner storage namespace', () => {
    const service = createService();
    const initiated = service.initiateJourney({
      partnerCode: PARTNER_CODE,
      journeyType: JOURNEY_TYPES.AGENT_CONTRACTING,
      prefillPayload: createIndividualApplication(),
    });
    const otherPartnerService = createService('OTHER_DEMO_PARTNER');

    expect(() =>
      otherPartnerService.loadDraft(initiated.trackingId, {
        partnerCode: 'OTHER_DEMO_PARTNER',
      }),
    ).toThrow(
      expect.objectContaining({
        code: JOURNEY_SERVICE_ERROR_CODES.NOT_FOUND,
      }),
    );

    expect(
      createService().loadDraft(initiated.trackingId, {
        partnerCode: PARTNER_CODE,
      }).trackingId,
    ).toBe(initiated.trackingId);
  });

  it('saves repeated section edits without discarding unrelated form data', () => {
    const service = createService();
    const initiated = service.initiateJourney({
      partnerCode: PARTNER_CODE,
      journeyType: JOURNEY_TYPES.AGENT_CONTRACTING,
      prefillPayload: createIndividualApplication(),
      skipPrefilled: false,
    });
    const firstEdit = service.saveSection(
      initiated.trackingId,
      'agency',
      {
        name: 'First Synthetic Agency',
        type: 'BGA',
        code: 'AGY-FIRST',
      },
      {
        expectedVersion: initiated.version,
      },
    );
    const secondEdit = service.saveSection(
      initiated.trackingId,
      'agency',
      {
        name: 'Updated Synthetic Agency',
        type: 'IMO',
        code: 'AGY-UPDATED',
      },
      {
        expectedVersion: firstEdit.version,
      },
    );

    expect(firstEdit.version).toBe(2);
    expect(secondEdit.version).toBe(3);
    expect(secondEdit.draft.dirtySections).toContain('agency');
    expect(secondEdit.draft.formState.agency).toEqual({
      name: 'Updated Synthetic Agency',
      type: 'IMO',
      code: 'AGY-UPDATED',
    });
    expect(secondEdit.draft.formState.agent).toEqual(
      expect.objectContaining({
        firstName: 'Jamie',
        npn: '8401001',
      }),
    );
    expect(secondEdit.draft.formState.contract).toEqual(
      expect.objectContaining({
        commissionSchedule: 'STANDARD',
      }),
    );
  });

  it('records consent and a signed signature in resumable journey state', () => {
    const service = createService();
    const initiated = service.initiateJourney({
      partnerCode: PARTNER_CODE,
      journeyType: JOURNEY_TYPES.AGENT_CONTRACTING,
      prefillPayload: createIndividualApplication(),
      skipPrefilled: false,
    });
    const consented = service.markESignConsent(
      initiated.trackingId,
      'agent_signature',
      {
        signedBy: 'Jamie Journey',
        metadata: {
          synthetic: true,
        },
      },
      {
        expectedVersion: initiated.version,
      },
    );
    const signed = service.markSigned(
      initiated.trackingId,
      'agent_signature',
      {
        signedBy: 'Jamie Journey',
        metadata: {
          synthetic: true,
        },
      },
      {
        expectedVersion: consented.version,
      },
    );

    expect(consented.draft.signatures.agent_signature).toEqual(
      expect.objectContaining({
        status: JOURNEY_SIGN_OFF_STATES.CONSENTED,
        consented: true,
        consentedAt: TEST_TIME,
      }),
    );
    expect(signed.draft.signatures.agent_signature).toEqual(
      expect.objectContaining({
        status: JOURNEY_SIGN_OFF_STATES.SIGNED,
        consented: true,
        signedBy: 'Jamie Journey',
        signedAt: TEST_TIME,
      }),
    );

    const resumed = createService().loadDraft(initiated.trackingId);

    expect(resumed.draft.signatures.agent_signature.status).toBe(
      JOURNEY_SIGN_OFF_STATES.SIGNED,
    );
    expect(resumed.draft.signatures.agent_signature.signedBy).toBe(
      'Jamie Journey',
    );
  });

  it('rejects a signature without a signer and leaves the draft unchanged', () => {
    const service = createService();
    const initiated = service.initiateJourney({
      partnerCode: PARTNER_CODE,
      journeyType: JOURNEY_TYPES.AGENT_CONTRACTING,
      prefillPayload: createIndividualApplication(),
    });

    expect(() =>
      service.markSigned(
        initiated.trackingId,
        'agent_signature',
        {
          signedBy: '',
        },
        {
          expectedVersion: initiated.version,
        },
      ),
    ).toThrow('Journey signer must be a non-empty value.');

    const unchanged = service.loadDraft(initiated.trackingId);

    expect(unchanged.version).toBe(initiated.version);
    expect(unchanged.draft.signatures).toEqual({});
  });
});