import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createSubmissionService,
  SUBMISSION_ACTIONS,
  SUBMISSION_OUTCOMES,
  SUBMISSION_SERVICE_ERROR_CODES,
} from './submissionService.js';

const TEST_TIME = '2026-08-24T12:00:00.000Z';

function createApplication(overrides = {}) {
  return {
    id: 'submission_record_1001',
    applicationId: 'APP-SUBMISSION-1001',
    trackingId: 'TRK-SUBMISSION-1001',
    partnerCode: 'DEMO_PARTNER',
    journeyType: 'agent_contracting',
    status: 'draft',
    workflowStage: 'APPLICATION_STARTED',
    company: 'Banner',
    carrierCode: 'BANNER',
    gaCode: 'NATIONAL_DEMO',
    agency: {
      name: 'Synthetic Submission Agency',
      type: 'BGA',
    },
    contract: {
      type: 'PRODUCER',
      level: 'PRODUCER',
      commissionSchedule: 'STANDARD',
      advanceCommission: false,
      status: 'pending',
    },
    applicant: {
      type: 'individual',
      firstName: 'Jordan',
      lastName: 'Submission',
      npn: '8601001',
      residenceState: 'PA',
    },
    licensing: {
      residentState: 'PA',
      licenseNumber: 'PA-DEMO-8601001',
      linesOfAuthority: ['LIFE'],
    },
    assignment: {
      team: 'operations',
      assigneeUserId: null,
    },
    exceptions: [],
    version: 1,
    submittedAt: null,
    createdAt: '2026-08-24T10:00:00.000Z',
    updatedAt: '2026-08-24T10:00:00.000Z',
    ...overrides,
  };
}

function createDocumentPackage(overrides = {}) {
  return {
    trackingId: 'TRK-SUBMISSION-1001',
    applicationId: 'APP-SUBMISSION-1001',
    packageVersion: 2,
    status: 'COMPLETE',
    requiredForms: [
      {
        code: 'BK-12',
        name: 'BK-12 Producer Contracting Form',
        required: true,
        status: 'SIGNED',
        signatureRequired: true,
        signerType: 'agent',
      },
    ],
    generatedArtifacts: [
      {
        artifactId: 'DOC-SUBMISSION-1001',
        referenceId: 'DOC-SUBMISSION-1001',
        documentCode: 'BK-12',
        name: 'BK-12 Producer Contracting Form',
        fileName: 'bk-12.txt',
        mimeType: 'text/plain',
        status: 'SIGNED',
        checksum: null,
        generatedAt: '2026-08-24T11:45:00.000Z',
        signedAt: '2026-08-24T11:55:00.000Z',
      },
    ],
    retainedSignatures: {},
    retainedGaSignature: false,
    agentSignatureState: 'SIGNED',
    signOff: {
      status: 'SIGNED',
      consented: true,
      signedBy: 'Jordan Submission',
      consentedAt: '2026-08-24T11:50:00.000Z',
      signedAt: '2026-08-24T11:55:00.000Z',
    },
    packageComplete: true,
    generatedAt: '2026-08-24T11:45:00.000Z',
    updatedAt: '2026-08-24T11:55:00.000Z',
    completedAt: '2026-08-24T11:55:00.000Z',
    ...overrides,
  };
}

function createValidationResult(overrides = {}) {
  return {
    valid: true,
    issues: [],
    errors: [],
    warnings: [],
    validationCodes: [],
    manualReviewRequired: false,
    checkedAt: TEST_TIME,
    ...overrides,
  };
}

function createEligibilityResult(overrides = {}) {
  return {
    eligible: true,
    valid: true,
    outcome: 'ELIGIBLE',
    issues: [],
    errors: [],
    warnings: [],
    validationCodes: [],
    manualReviewRequired: false,
    derivedValues: {
      agentCode: {
        code: 'JSUB1001',
        generated: true,
      },
    },
    checkedAt: TEST_TIME,
    ...overrides,
  };
}

function createApplicationRepository(application) {
  let currentApplication = structuredClone(application);

  return {
    find: vi.fn((identifier) => {
      if (
        [
          currentApplication.id,
          currentApplication.applicationId,
          currentApplication.trackingId,
        ].includes(String(identifier))
      ) {
        return structuredClone(currentApplication);
      }

      return undefined;
    }),
    update: vi.fn((identifier, patch) => {
      if (identifier !== currentApplication.applicationId) {
        throw new Error(`Application not found: ${identifier}`);
      }

      currentApplication = {
        ...currentApplication,
        ...structuredClone(patch),
        updatedAt: TEST_TIME,
      };

      return structuredClone(currentApplication);
    }),
    getCurrent: () => structuredClone(currentApplication),
  };
}

function createHarness({
  application = createApplication(),
  documentPackage = createDocumentPackage(),
  validation = createValidationResult(),
  eligibility = createEligibilityResult(),
  packageOverrides = {},
} = {}) {
  const applicationRepository =
    createApplicationRepository(application);
  const validationService = {
    validateForSubmission: vi.fn(() => structuredClone(validation)),
  };
  const eligibilityService = {
    runEligibilityChecks: vi.fn(() => structuredClone(eligibility)),
  };
  const documentPackageService = {
    getPackage: vi.fn(() => structuredClone(documentPackage)),
    validateSignatures: vi.fn(() => ({
      valid: true,
      agentSigned: true,
      gaSigned: false,
      principalSigned: false,
      issues: [],
    })),
    completePackage: vi.fn(() =>
      structuredClone({
        ...documentPackage,
        status: 'COMPLETE',
        packageComplete: true,
        completedAt: TEST_TIME,
      }),
    ),
    ...packageOverrides,
  };
  const auditService = {
    append: vi.fn((event) => ({
      ...structuredClone(event),
      auditEventId: 'AUD-SUBMISSION-1001',
    })),
  };
  const eventPublisher = {
    publishApplicationSubmitted: vi.fn((payload, options) => ({
      eventId: 'EVT-SUBMISSION-1001',
      eventName: 'onboarding:application-submitted',
      occurredAt: options.occurredAt,
      payload: structuredClone(payload),
    })),
    publishApplicationExceptionRouted: vi.fn((payload, options) => ({
      eventId: 'EVT-EXCEPTION-1001',
      eventName: 'onboarding:application-exception-routed',
      occurredAt: options.occurredAt,
      payload: structuredClone(payload),
    })),
  };
  const handoffGateway = {
    receiveApplication: vi.fn(() => ({
      accepted: true,
      handoffId: 'HANDOFF-SUBMISSION-1001',
    })),
  };
  const service = createSubmissionService({
    applicationRepository,
    validationService,
    eligibilityService,
    documentPackageService,
    auditService,
    eventPublisher,
    handoffGateway,
    clock: () => new Date(TEST_TIME),
  });

  return {
    applicationRepository,
    auditService,
    documentPackageService,
    eligibilityService,
    eventPublisher,
    handoffGateway,
    service,
    validationService,
  };
}

beforeEach(() => {
  globalThis.localStorage.clear();
});

describe('SubmissionService', () => {
  it('blocks submission when the document package is incomplete', () => {
    const documentPackage = createDocumentPackage({
      status: 'SIGNED',
      packageComplete: false,
      completedAt: null,
    });
    const harness = createHarness({ documentPackage });

    expect(() =>
      harness.service.submitApplication(
        documentPackage.applicationId,
        {
          submittedBy: 'usr_partner_demo',
        },
      ),
    ).toThrow(
      expect.objectContaining({
        code:
          SUBMISSION_SERVICE_ERROR_CODES.DOCUMENT_PACKAGE_INCOMPLETE,
      }),
    );

    expect(
      harness.documentPackageService.validateSignatures,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        trackingId: documentPackage.trackingId,
      }),
      expect.objectContaining({
        requireAgentSignature: true,
      }),
    );
    expect(
      harness.applicationRepository.update,
    ).not.toHaveBeenCalled();
    expect(
      harness.eventPublisher.publishApplicationSubmitted,
    ).not.toHaveBeenCalled();
    expect(harness.auditService.append).not.toHaveBeenCalled();
  });

  it('auto-completes a signed package and submits the application', () => {
    const incompletePackage = createDocumentPackage({
      status: 'SIGNED',
      packageComplete: false,
      completedAt: null,
    });
    const harness = createHarness({
      documentPackage: incompletePackage,
    });

    const result = harness.service.submitApplication(
      incompletePackage.applicationId,
      {
        autoCompletePackage: true,
        submittedBy: 'usr_partner_demo',
        metadata: {
          source: 'submission_test',
        },
      },
    );

    expect(
      harness.documentPackageService.completePackage,
    ).toHaveBeenCalledWith(
      incompletePackage.trackingId,
      expect.objectContaining({
        requireAgentSignature: true,
      }),
    );
    expect(result.submitted).toBe(true);
    expect(result.outcome).toBe(SUBMISSION_OUTCOMES.SUBMITTED);
    expect(result.status).toBe('submitted');
    expect(result.workflowStage).toBe('APPLICATION_SUBMITTED');
    expect(result.submittedAt).toBe(TEST_TIME);
    expect(result.documentPackage).toEqual(
      expect.objectContaining({
        packageComplete: true,
        packageVersion: 2,
      }),
    );
  });

  it('associates validation, eligibility, and generated artifacts with the submitted outcome', () => {
    const validation = createValidationResult({
      validationCodes: ['BACKGROUND_REUSE_AVAILABLE'],
      warnings: [
        {
          code: 'BACKGROUND_REUSE_AVAILABLE',
          severity: 'info',
          message: 'A recent background check can be reused.',
        },
      ],
    });
    const eligibility = createEligibilityResult({
      validationCodes: ['APPOINTMENT_REUSE_AVAILABLE'],
      derivedValues: {
        agentCode: {
          code: 'JSUB1001',
          generated: true,
          reused: false,
        },
        background: {
          reused: true,
          linkedCheckId: 'BGC-HIST-DEMO-1002',
        },
      },
    });
    const harness = createHarness({
      validation,
      eligibility,
    });

    const result = harness.service.submitApplication(
      'TRK-SUBMISSION-1001',
      {
        submittedBy: 'usr_partner_demo',
      },
    );
    const persistedApplication =
      harness.applicationRepository.getCurrent();

    expect(result.validationCodes).toEqual([
      'BACKGROUND_REUSE_AVAILABLE',
      'APPOINTMENT_REUSE_AVAILABLE',
    ]);
    expect(result.documentPackage.generatedArtifacts).toEqual([
      expect.objectContaining({
        artifactId: 'DOC-SUBMISSION-1001',
        documentCode: 'BK-12',
        status: 'SIGNED',
      }),
    ]);
    expect(persistedApplication.processingSnapshot).toEqual(
      expect.objectContaining({
        validation: expect.objectContaining({
          valid: true,
        }),
        eligibility: expect.objectContaining({
          eligible: true,
          derivedValues: expect.objectContaining({
            agentCode: expect.objectContaining({
              code: 'JSUB1001',
              generated: true,
            }),
          }),
        }),
        documentPackage: expect.objectContaining({
          packageComplete: true,
          generatedArtifacts: [
            expect.objectContaining({
              artifactId: 'DOC-SUBMISSION-1001',
            }),
          ],
        }),
      }),
    );
    expect(result.submittedSnapshot).toEqual(
      expect.objectContaining({
        submittedBy: 'usr_partner_demo',
        submittedAt: TEST_TIME,
        processingSnapshot: expect.objectContaining({
          validationCodes: [
            'BACKGROUND_REUSE_AVAILABLE',
            'APPOINTMENT_REUSE_AVAILABLE',
          ],
        }),
      }),
    );
  });

  it('publishes audit, browser-domain, and downstream handoff events after submission', () => {
    const harness = createHarness();

    const result = harness.service.submitApplication(
      'APP-SUBMISSION-1001',
      {
        submittedBy: 'usr_operations_demo',
        metadata: {
          testScenario: 'event_publication',
        },
      },
    );

    expect(harness.handoffGateway.receiveApplication).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'ONBOARDING_APPLICATION_SUBMITTED',
        recordRef: 'APP-SUBMISSION-1001',
        trackingId: 'TRK-SUBMISSION-1001',
        documentPackage: expect.objectContaining({
          generatedArtifacts: [
            expect.objectContaining({
              artifactId: 'DOC-SUBMISSION-1001',
            }),
          ],
        }),
      }),
    );
    expect(harness.auditService.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: SUBMISSION_ACTIONS.SUBMITTED,
        applicationId: 'APP-SUBMISSION-1001',
        trackingId: 'TRK-SUBMISSION-1001',
        metadata: expect.objectContaining({
          documentPackageVersion: 2,
          generatedArtifactIds: ['DOC-SUBMISSION-1001'],
        }),
      }),
      expect.objectContaining({
        source: 'submission_service',
      }),
    );
    expect(
      harness.eventPublisher.publishApplicationSubmitted,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        applicationId: 'APP-SUBMISSION-1001',
        trackingId: 'TRK-SUBMISSION-1001',
        submittedBy: 'usr_operations_demo',
        documentPackage: expect.objectContaining({
          packageComplete: true,
        }),
      }),
      expect.objectContaining({
        occurredAt: TEST_TIME,
        metadata: {
          testScenario: 'event_publication',
        },
      }),
    );
    expect(result.gatewayResult).toEqual({
      accepted: true,
      handoffId: 'HANDOFF-SUBMISSION-1001',
    });
    expect(result.auditEvent).toEqual(
      expect.objectContaining({
        auditEventId: 'AUD-SUBMISSION-1001',
      }),
    );
    expect(result.event).toEqual(
      expect.objectContaining({
        eventId: 'EVT-SUBMISSION-1001',
      }),
    );
  });

  it('routes manual-review outcomes and publishes an exception event without generating a handoff', () => {
    const validation = createValidationResult({
      manualReviewRequired: true,
      validationCodes: ['NIPR_IDENTITY_MISMATCH'],
      issues: [
        {
          code: 'NIPR_IDENTITY_MISMATCH',
          severity: 'warning',
          message: 'The supplied identity requires review.',
        },
      ],
    });
    const harness = createHarness({ validation });

    const result = harness.service.submitApplication(
      'APP-SUBMISSION-1001',
      {
        submittedBy: 'usr_operations_demo',
      },
    );

    expect(result.submitted).toBe(false);
    expect(result.outcome).toBe(
      SUBMISSION_OUTCOMES.EXCEPTION_ROUTED,
    );
    expect(result.status).toBe('action_required');
    expect(result.workflowStage).toBe('MANUAL_EXCEPTION');
    expect(result.manualReviewRequired).toBe(true);
    expect(result.validationCodes).toContain(
      'NIPR_IDENTITY_MISMATCH',
    );
    expect(
      harness.documentPackageService.getPackage,
    ).not.toHaveBeenCalled();
    expect(
      harness.handoffGateway.receiveApplication,
    ).not.toHaveBeenCalled();
    expect(
      harness.eventPublisher.publishApplicationSubmitted,
    ).not.toHaveBeenCalled();
    expect(
      harness.eventPublisher.publishApplicationExceptionRouted,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        applicationId: 'APP-SUBMISSION-1001',
        trackingId: 'TRK-SUBMISSION-1001',
        exceptionCode: 'NIPR_IDENTITY_MISMATCH',
        validationCodes: ['NIPR_IDENTITY_MISMATCH'],
        workflowStage: 'MANUAL_EXCEPTION',
      }),
      expect.objectContaining({
        occurredAt: TEST_TIME,
      }),
    );
    expect(harness.auditService.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: SUBMISSION_ACTIONS.EXCEPTION_ROUTED,
        metadata: expect.objectContaining({
          validationCodes: ['NIPR_IDENTITY_MISMATCH'],
        }),
      }),
      expect.any(Object),
    );
  });

  it('returns an idempotent result for an application already submitted', () => {
    const harness = createHarness({
      application: createApplication({
        status: 'submitted',
        workflowStage: 'APPLICATION_SUBMITTED',
        submittedAt: '2026-08-24T11:30:00.000Z',
        submittedBy: 'usr_partner_demo',
      }),
    });

    const result = harness.service.submitApplication(
      'APP-SUBMISSION-1001',
      {
        submittedBy: 'usr_partner_demo',
      },
    );

    expect(result.submitted).toBe(true);
    expect(result.idempotent).toBe(true);
    expect(result.submittedAt).toBe('2026-08-24T11:30:00.000Z');
    expect(
      harness.validationService.validateForSubmission,
    ).not.toHaveBeenCalled();
    expect(
      harness.eligibilityService.runEligibilityChecks,
    ).not.toHaveBeenCalled();
    expect(
      harness.documentPackageService.getPackage,
    ).not.toHaveBeenCalled();
    expect(
      harness.applicationRepository.update,
    ).not.toHaveBeenCalled();
    expect(harness.auditService.append).not.toHaveBeenCalled();
  });
});