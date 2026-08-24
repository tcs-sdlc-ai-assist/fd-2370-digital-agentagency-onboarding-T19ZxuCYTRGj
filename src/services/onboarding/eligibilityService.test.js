import { beforeEach, describe, expect, it } from 'vitest';
import { getSeeds } from '../../persistence/seedLoader.js';
import { generateAgentCode } from '../../utils/ids.js';
import {
  APPOINTMENT_DECISIONS,
  BACKGROUND_DECISIONS,
  createEligibilityService,
  ELIGIBILITY_CODES,
  ELIGIBILITY_OUTCOMES,
  evaluateAppointmentRequirement,
  evaluateBackgroundRequirement,
  evaluateDuplicateInProgress,
  evaluateTerminationRestriction,
} from './eligibilityService.js';

const TEST_TIME = '2026-08-24T12:00:00.000Z';

function createApplication(overrides = {}) {
  return {
    id: 'eligibility_record_1001',
    applicationId: 'APP-ELIG-1001',
    trackingId: 'TRK-ELIG-1001',
    partnerCode: 'DEMO_PARTNER',
    journeyType: 'agent_contracting',
    requestType: 'new_onboarding',
    status: 'draft',
    workflowStage: 'APPLICATION_STARTED',
    company: 'Banner',
    carrierCode: 'BANNER',
    gaCode: 'NATIONAL_DEMO',
    agencyType: 'BGA',
    agency: {
      name: 'Synthetic Eligibility Agency',
      type: 'BGA',
      code: 'AGY-DEMO-ELIGIBILITY',
    },
    contractType: 'PRODUCER',
    contract: {
      type: 'PRODUCER',
      level: 'PRODUCER',
      commissionSchedule: 'STANDARD',
      advanceCommission: false,
    },
    applicant: {
      type: 'individual',
      firstName: 'Jordan',
      lastName: 'Eligible',
      email: 'jordan.eligible@example.test',
      npn: '8501001',
      residenceState: 'PA',
    },
    licensing: {
      residentState: 'PA',
      licenseNumber: 'PA-DEMO-8501001',
      linesOfAuthority: ['LIFE'],
    },
    appointment: {
      states: ['PA'],
    },
    errorsAndOmissions: {
      policyNumber: 'EO-DEMO-8501001',
      status: 'active',
    },
    ...overrides,
  };
}

function createService(options = {}) {
  return createEligibilityService({
    clock: () => new Date(TEST_TIME),
    auditService: false,
    configResolver: false,
    ...options,
  });
}

beforeEach(() => {
  globalThis.localStorage.clear();
});

describe('EligibilityService', () => {
  it('returns an eligible outcome and generates an agent code for a valid application', () => {
    const application = createApplication();
    const result = createService().runEligibilityChecks(application);

    expect(result.eligible).toBe(true);
    expect(result.valid).toBe(true);
    expect(result.outcome).toBe(ELIGIBILITY_OUTCOMES.ELIGIBLE);
    expect(result.manualReviewRequired).toBe(false);
    expect(result.validationCodes).toEqual([]);
    expect(result.derivedValues.carrierEligible).toBe(true);
    expect(result.derivedValues.hierarchyResolved).toBe(true);
    expect(result.derivedValues.agentCode).toEqual(
      expect.objectContaining({
        generated: true,
        reused: false,
        collisionDetected: false,
        manualReviewRequired: false,
      }),
    );
    expect(result.derivedValues.agentCode.code).toMatch(
      /^[A-Z0-9]{8}$/,
    );
  });

  it('blocks unsupported William Penn agency and level combinations', () => {
    const application = createApplication({
      company: 'WilliamPenn',
      carrierCode: 'WILLIAM_PENN',
      gaCode: 'REGIONAL_DEMO',
      agencyType: 'non_traditional',
      agency: {
        name: 'Synthetic Non-Traditional Agency',
        type: 'non_traditional',
        code: 'AGY-DEMO-WP',
      },
      contract: {
        type: 'PRODUCER',
        level: 'AGENCY',
        commissionSchedule: 'STANDARD',
        advanceCommission: false,
      },
    });
    const result = createService().runEligibilityChecks(application);

    expect(result.eligible).toBe(false);
    expect(result.outcome).toBe(
      ELIGIBILITY_OUTCOMES.INELIGIBLE,
    );
    expect(result.validationCodes).toEqual(
      expect.arrayContaining([
        ELIGIBILITY_CODES.WILLIAM_PENN_NON_TRADITIONAL_UNSUPPORTED,
        ELIGIBILITY_CODES.WILLIAM_PENN_LEVEL_30_UNSUPPORTED,
      ]),
    );
  });

  it('blocks a corporate application without a licensed eligible principal', () => {
    const application = createApplication({
      journeyType: 'corporate',
      contractType: 'AGENCY',
      contract: {
        type: 'AGENCY',
        level: 'AGENCY',
        commissionSchedule: 'AGENCY',
        advanceCommission: false,
      },
      applicant: {
        type: 'organization',
        legalName: 'Synthetic Eligibility Holdings LLC',
        stateOfFormation: 'PA',
      },
      principals: [
        {
          firstName: 'Robin',
          lastName: 'Principal',
          ownershipPercent: 100,
          isLicensedEligible: false,
        },
      ],
    });
    const result = createService().runEligibilityChecks(application);

    expect(result.eligible).toBe(false);
    expect(result.manualReviewRequired).toBe(true);
    expect(result.validationCodes).toContain(
      ELIGIBILITY_CODES.CORPORATE_LICENSED_PRINCIPAL_REQUIRED,
    );
    expect(result.derivedValues.licensedPrincipalRequired).toBe(true);
    expect(result.derivedValues.eligiblePrincipalPresent).toBe(false);
  });

  it('blocks ABNCA advance commission even when E&O coverage is present', () => {
    const application = createApplication({
      contract: {
        type: 'PRODUCER',
        level: 'PRODUCER',
        commissionSchedule: 'ABNCA',
        advanceCommission: true,
      },
    });
    const result = createService().runEligibilityChecks(application);

    expect(result.eligible).toBe(false);
    expect(result.validationCodes).toContain(
      ELIGIBILITY_CODES.ABNCA_NO_ADVANCE,
    );
    expect(result.validationCodes).not.toContain(
      ELIGIBILITY_CODES.EO_REQUIRED,
    );
  });

  it('requires E&O coverage for advance commission or a triggering residence state', () => {
    const application = createApplication({
      applicant: {
        type: 'individual',
        firstName: 'Jordan',
        lastName: 'Eligible',
        npn: '8501002',
        residenceState: 'UT',
      },
      licensing: {
        residentState: 'UT',
        licenseNumber: 'UT-DEMO-8501002',
        linesOfAuthority: ['LIFE'],
      },
      errorsAndOmissions: null,
    });
    const result = createService().runEligibilityChecks(application);

    expect(result.eligible).toBe(false);
    expect(result.validationCodes).toContain(
      ELIGIBILITY_CODES.EO_REQUIRED,
    );
    expect(result.derivedValues.errorsAndOmissionsRequired).toBe(true);
    expect(result.derivedValues.errorsAndOmissionsSatisfied).toBe(
      false,
    );
  });

  it('routes an unresolved hierarchy to manual review', () => {
    const application = createApplication({
      gaCode: 'UNKNOWN_DEMO',
    });
    const result = createService().runEligibilityChecks(application);

    expect(result.eligible).toBe(false);
    expect(result.manualReviewRequired).toBe(true);
    expect(result.validationCodes).toContain(
      ELIGIBILITY_CODES.HIERARCHY_NOT_RESOLVED,
    );
    expect(result.derivedValues.hierarchyResolved).toBe(false);
    expect(result.derivedValues.hierarchy).toBeNull();
  });

  it('detects a duplicate in-progress producer and carrier application', () => {
    const application = createApplication();
    const duplicate = {
      id: 'duplicate_record',
      applicationId: 'APP-ELIG-DUPLICATE',
      trackingId: 'TRK-ELIG-DUPLICATE',
      status: 'in_review',
      workflowStage: 'APPLICATION_UNDER_REVIEW',
      company: 'Banner',
      applicant: {
        type: 'individual',
        firstName: 'Jordan',
        lastName: 'Eligible',
        npn: '8501001',
      },
    };
    const result = evaluateDuplicateInProgress(application, [
      duplicate,
    ]);

    expect(result.duplicate).toBe(true);
    expect(result.inProgress).toBe(true);
    expect(result.applicationId).toBe('APP-ELIG-DUPLICATE');
    expect(result.trackingId).toBe('TRK-ELIG-DUPLICATE');
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: ELIGIBILITY_CODES.DUPLICATE_APPLICATION_IN_PROGRESS,
        }),
      ]),
    );
  });

  it('ignores duplicate producer records that have reached a terminal status', () => {
    const application = createApplication();
    const completedRecord = {
      id: 'completed_duplicate_record',
      applicationId: 'APP-ELIG-COMPLETED',
      trackingId: 'TRK-ELIG-COMPLETED',
      status: 'completed',
      workflowStage: 'CONTRACTED',
      company: 'Banner',
      applicant: {
        type: 'individual',
        firstName: 'Jordan',
        lastName: 'Eligible',
        npn: '8501001',
      },
    };
    const result = evaluateDuplicateInProgress(application, [
      completedRecord,
    ]);

    expect(result.duplicate).toBe(false);
    expect(result.applicationId).toBeNull();
    expect(result.issues).toEqual([]);
  });

  it('blocks onboarding when for-cause termination history exists', () => {
    const application = createApplication({
      applicant: {
        type: 'individual',
        firstName: 'Cameron',
        lastName: 'Forcause',
        npn: '8101204',
        residenceState: 'OH',
      },
    });
    const result = evaluateTerminationRestriction(
      application,
      getSeeds().terminations,
    );

    expect(result.blocked).toBe(true);
    expect(result.manualReviewRequired).toBe(true);
    expect(result.validationCodes).toEqual(
      expect.arrayContaining([
        ELIGIBILITY_CODES.TERMINATION_HISTORY_REVIEW_REQUIRED,
        ELIGIBILITY_CODES.FOR_CAUSE_TERMINATION_BLOCK,
      ]),
    );
    expect(result.terminations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          terminationId: 'TERM-DEMO-1002',
          forCause: true,
          blocksOnboarding: true,
        }),
      ]),
    );
  });

  it('requires manual agent-code assignment when the generated code collides', () => {
    const application = createApplication();
    const generatedCode = generateAgentCode({
      ...application.applicant,
      discriminator: application.applicationId,
    });
    const historicalAssets = structuredClone(
      getSeeds().historicalAssets,
    );

    historicalAssets.generatedCodes.push({
      generatedCodeId: 'CODE-ELIG-COLLISION',
      trackingId: 'TRK-ELIG-OTHER',
      applicationId: 'APP-ELIG-OTHER',
      npn: '8501999',
      company: 'Banner',
      generatedCode,
      status: 'assigned',
    });

    const result = createService({
      historicalAssets,
    }).runEligibilityChecks(application);

    expect(result.eligible).toBe(true);
    expect(result.manualReviewRequired).toBe(true);
    expect(result.validationCodes).toEqual(
      expect.arrayContaining([
        ELIGIBILITY_CODES.AGENT_CODE_COLLISION,
        ELIGIBILITY_CODES.MANUAL_AGENT_CODE_REQUIRED,
      ]),
    );
    expect(result.derivedValues.agentCode).toEqual(
      expect.objectContaining({
        code: null,
        generated: false,
        reused: false,
        collisionDetected: true,
        manualReviewRequired: true,
        conflictingCode: generatedCode,
      }),
    );
  });

  it('reuses a recent clear background check within the configured window', () => {
    const application = createApplication({
      applicant: {
        type: 'individual',
        firstName: 'Rowan',
        lastName: 'Reuse',
        npn: '8101201',
        residenceState: 'PA',
      },
    });
    const result = evaluateBackgroundRequirement(
      application,
      getSeeds().backgroundChecks,
      {
        asOf: TEST_TIME,
        reuseWindowDays: 180,
      },
    );

    expect(result.decision).toBe(BACKGROUND_DECISIONS.REUSED);
    expect(result.required).toBe(false);
    expect(result.reused).toBe(true);
    expect(result.linkedCheckId).toBe('BGC-HIST-DEMO-1002');
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: ELIGIBILITY_CODES.BACKGROUND_REUSE_AVAILABLE,
        }),
      ]),
    );
  });

  it('requires a new background check when the reuse window has expired', () => {
    const application = createApplication({
      applicant: {
        type: 'individual',
        firstName: 'Ellis',
        lastName: 'Expired',
        npn: '8101203',
        residenceState: 'FL',
      },
    });
    const result = evaluateBackgroundRequirement(
      application,
      getSeeds().backgroundChecks,
      {
        asOf: TEST_TIME,
        reuseWindowDays: 180,
      },
    );

    expect(result.decision).toBe(BACKGROUND_DECISIONS.REQUIRED);
    expect(result.required).toBe(true);
    expect(result.reused).toBe(false);
    expect(result.linkedCheckId).toBeNull();
  });

  it('exempts registered representatives from the standard background flow', () => {
    const application = createApplication({
      journeyType: 'registered_rep',
      contractType: 'registered_representative',
      contract: {
        type: 'registered_representative',
        level: 'PRODUCER',
        commissionSchedule: 'STANDARD',
        advanceCommission: false,
      },
    });
    const result = evaluateBackgroundRequirement(
      application,
      getSeeds().backgroundChecks,
      {
        asOf: TEST_TIME,
      },
    );

    expect(result.decision).toBe(
      BACKGROUND_DECISIONS.NOT_REQUIRED,
    );
    expect(result.required).toBe(false);
    expect(result.reused).toBe(false);
    expect(result.reason).toBe('REGISTERED_REP_EXEMPT');
  });

  it('reuses an active appointment for every requested state', () => {
    const application = createApplication({
      company: 'Banner',
      carrierCode: 'BANNER',
      applicant: {
        type: 'individual',
        firstName: 'Rowan',
        lastName: 'Reuse',
        npn: '8101201',
        residenceState: 'PA',
      },
      appointment: {
        states: ['PA'],
      },
    });
    const result = evaluateAppointmentRequirement(
      application,
      getSeeds().appointments,
    );

    expect(result.decision).toBe(APPOINTMENT_DECISIONS.REUSED);
    expect(result.required).toBe(false);
    expect(result.reused).toBe(true);
    expect(result.reusableStates).toContain('PA');
    expect(result.missingStates).toEqual([]);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: ELIGIBILITY_CODES.APPOINTMENT_REUSE_AVAILABLE,
        }),
      ]),
    );
  });

  it('partially reuses appointments and identifies states still requiring processing', () => {
    const application = createApplication({
      company: 'Banner',
      carrierCode: 'BANNER',
      applicant: {
        type: 'individual',
        firstName: 'Morgan',
        lastName: 'Contracted',
        npn: '8101006',
        residenceState: 'OH',
      },
      appointment: {
        states: ['OH', 'MI'],
      },
    });
    const result = evaluateAppointmentRequirement(
      application,
      getSeeds().appointments,
    );

    expect(result.decision).toBe(
      APPOINTMENT_DECISIONS.PARTIALLY_REUSED,
    );
    expect(result.required).toBe(true);
    expect(result.reused).toBe(true);
    expect(result.reusableStates).toContain('OH');
    expect(result.missingStates).toEqual(['MI']);
  });

  it('rejects invalid application input without running eligibility rules', () => {
    const service = createService();

    expect(() => service.runEligibilityChecks(null)).toThrow(
      expect.objectContaining({
        code: 'ELIGIBILITY_APPLICATION_INVALID',
      }),
    );
    expect(() =>
      evaluateBackgroundRequirement(null),
    ).toThrow(TypeError);
  });
});