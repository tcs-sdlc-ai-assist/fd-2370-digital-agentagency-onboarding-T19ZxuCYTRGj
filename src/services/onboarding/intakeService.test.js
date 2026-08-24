import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSeeds } from '../../persistence/seedLoader.js';
import {
  createIntakeService,
  INTAKE_COMPLETENESS_STATUSES,
  INTAKE_NEXT_ACTIONS,
} from './intakeService.js';

const TEST_TIME = '2026-08-24T12:00:00.000Z';

function getSample(sampleId) {
  const sample = getSeeds().intakeSamples.find(
    (candidate) => candidate.id === sampleId,
  );

  if (!sample) {
    throw new Error(`Intake fixture not found: ${sampleId}`);
  }

  return sample;
}

function createRequest(sample, overrides = {}) {
  return {
    sourceChannel: sample.sourceChannel,
    sourceFormat: sample.sourceFormat,
    partnerCode: sample.partnerCode,
    rawContent: sample.rawContent,
    fileName: sample.fileName,
    mimeType: sample.mimeType,
    bulk: sample.bulk,
    simulateScenario: sample.simulateScenario,
    layout: sample.layout,
    envelope: sample.envelope,
    scenarioContext: sample.scenarioContext,
    enforcePartnerScope: false,
    requireAuthorization: false,
    ...overrides,
  };
}

function createService(options = {}) {
  return createIntakeService({
    clock: () => new Date(TEST_TIME),
    ...options,
  });
}

beforeEach(() => {
  globalThis.localStorage.clear();
});

describe('IntakeService', () => {
  it.each([
    {
      sampleId: 'intake_quility_complete_valid',
      expectedFormat: 'QUILITY_JSON',
      expectedFirstName: 'Jamie',
    },
    {
      sampleId: 'intake_ethos_complete_valid',
      expectedFormat: 'ETHOS_XML',
      expectedFirstName: 'Jordan',
    },
    {
      sampleId: 'intake_dtcc_single_registered_rep',
      expectedFormat: 'DTCC_FLAT_FILE',
      expectedFirstName: 'Avery',
    },
  ])(
    'normalizes $expectedFormat and retains its source metadata',
    ({ expectedFirstName, expectedFormat, sampleId }) => {
      const sample = getSample(sampleId);
      const result = createService().importSubmission(
        createRequest(sample),
      );
      const record = result.records[0];

      expect(result.summary.received).toBe(1);
      expect(result.summary.normalized).toBe(1);
      expect(record.normalizedPayload.agent.firstName).toBe(
        expectedFirstName,
      );
      expect(record.normalizedPayload.sourceMetadata).toEqual(
        expect.objectContaining({
          sourceChannel: sample.sourceChannel,
          sourceFormat: expectedFormat,
          partnerCode: sample.partnerCode,
          fileName: sample.fileName,
          bulk: sample.bulk,
        }),
      );
    },
  );

  it('rejects an intake record when minimum routing and identity fields are missing', () => {
    const sample = getSample(
      'intake_rejected_missing_mandatory_fields',
    );
    const result = createService().importSubmission(
      createRequest(sample),
    );
    const record = result.records[0];

    expect(record.completenessStatus).toBe(
      INTAKE_COMPLETENESS_STATUSES.REJECTED,
    );
    expect(record.nextAction).toBe(INTAKE_NEXT_ACTIONS.REJECT);
    expect(record.trackingId).toBeNull();
    expect(record.applicationId).toBeNull();
    expect(record.missingFields).toEqual(
      expect.arrayContaining([
        'company',
        'gaCode',
        'agencyType',
        'contractType',
        'agent.firstName',
        'agent.lastName',
        'agent.npn',
      ]),
    );
    expect(record.validationCodes).toEqual(
      expect.arrayContaining([
        'COMPANY_REQUIRED',
        'GA_CODE_REQUIRED',
        'AGENCY_TYPE_REQUIRED',
        'CONTRACT_TYPE_REQUIRED',
        'APPLICANT_IDENTITY_REQUIRED',
      ]),
    );
    expect(result.summary.rejected).toBe(1);
  });

  it('accepts corrected source data after an initial minimum-field rejection', () => {
    const rejectedSample = getSample(
      'intake_rejected_missing_mandatory_fields',
    );
    const service = createService();
    const rejectedResult = service.importSubmission(
      createRequest(rejectedSample),
    );
    const correctedContent = JSON.stringify({
      submissionId: 'MANUAL-DEMO-CORRECTED-1001',
      requestType: 'new_onboarding',
      company: 'Banner',
      gaCode: 'NATIONAL_DEMO',
      agency: {
        name: 'Corrected Synthetic Agency',
        type: 'traditional',
      },
      contract: {
        type: 'individual',
        level: 'PRODUCER',
        commissionSchedule: 'STANDARD',
        advanceCommission: false,
      },
      agent: {
        firstName: 'Casey',
        lastName: 'Corrected',
        email: 'casey.corrected@example.test',
        npn: '8301001',
        residenceState: 'PA',
      },
      licensing: {
        residentState: 'PA',
        licenseNumber: 'PA-DEMO-8301001',
        linesOfAuthority: ['LIFE'],
      },
      attestations: {
        backgroundQuestionsClear: true,
        electronicDeliveryConsent: true,
      },
    });
    const correctedResult = service.importSubmission(
      createRequest(rejectedSample, {
        rawContent: correctedContent,
        simulateScenario: 'complete_valid',
      }),
    );
    const correctedRecord = correctedResult.records[0];

    expect(rejectedResult.records[0].nextAction).toBe(
      INTAKE_NEXT_ACTIONS.REJECT,
    );
    expect(correctedRecord.completenessStatus).toBe(
      INTAKE_COMPLETENESS_STATUSES.COMPLETE,
    );
    expect(correctedRecord.nextAction).toBe(
      INTAKE_NEXT_ACTIONS.AUTO_SUBMIT_ELIGIBLE,
    );
    expect(correctedRecord.trackingId).toMatch(/^TRK-/);
    expect(correctedRecord.applicationId).toMatch(/^APP-/);
    expect(correctedRecord.normalizedPayload.agent.firstName).toBe(
      'Casey',
    );
  });

  it('generates stable tracking and application identifiers from the same source submission', () => {
    const sample = getSample('intake_quility_complete_valid');
    const service = createService();
    const request = createRequest(sample);
    const firstResult = service.importSubmission(request);
    const secondResult = service.importSubmission(request);
    const firstRecord = firstResult.records[0];
    const secondRecord = secondResult.records[0];

    expect(firstRecord.trackingId).toMatch(/^TRK-/);
    expect(firstRecord.applicationId).toMatch(/^APP-/);
    expect(secondRecord.trackingId).toBe(firstRecord.trackingId);
    expect(secondRecord.applicationId).toBe(firstRecord.applicationId);
  });

  it('auto-submits a complete normalized record when auto-submit is enabled', () => {
    const sample = getSample('intake_quility_complete_valid');
    const submissionService = vi.fn(() => ({
      submitted: true,
      status: 'submitted',
    }));
    const service = createService({
      autoSubmit: true,
      submissionService,
    });
    const result = service.importSubmission(createRequest(sample));
    const record = result.records[0];

    expect(submissionService).toHaveBeenCalledTimes(1);
    expect(submissionService).toHaveBeenCalledWith(
      record.trackingId,
      expect.objectContaining({
        applicationId: record.applicationId,
        source: 'intake_auto_submit',
      }),
    );
    expect(record.nextAction).toBe(INTAKE_NEXT_ACTIONS.SUBMITTED);
    expect(record.submission).toEqual(
      expect.objectContaining({
        submitted: true,
        status: 'submitted',
      }),
    );
    expect(result.summary.submitted).toBe(1);
  });

  it('routes an online-completable record to a resumable guided journey', () => {
    const sample = getSample('intake_quility_incomplete_online');
    const result = createService().importSubmission(
      createRequest(sample),
    );
    const record = result.records[0];

    expect(record.completenessStatus).toBe(
      INTAKE_COMPLETENESS_STATUSES.INCOMPLETE_ONLINE_COMPLETABLE,
    );
    expect(record.nextAction).toBe(
      INTAKE_NEXT_ACTIONS.JOURNEY_REQUIRED,
    );
    expect(record.missingFields).toEqual(
      expect.arrayContaining([
        'banking.paymentMethod',
        'banking.routingNumber',
        'banking.accountNumber',
        'errorsAndOmissions.policyNumber',
      ]),
    );
    expect(record.draft).toEqual(
      expect.objectContaining({
        trackingId: record.trackingId,
        applicationId: record.applicationId,
        partnerCode: sample.partnerCode,
        currentStepId: 'start',
      }),
    );
    expect(record.journeyUrl).toContain(
      encodeURIComponent(record.trackingId),
    );
    expect(result.summary.requiresJourney).toBe(1);
  });

  it('returns a structured rejection when source content cannot be parsed', () => {
    const sample = getSample('intake_ethos_malformed_xml');
    const result = createService().importSubmission(
      createRequest(sample),
    );
    const record = result.records[0];

    expect(result.nextAction).toBe(INTAKE_NEXT_ACTIONS.REJECT);
    expect(result.summary).toEqual(
      expect.objectContaining({
        received: 1,
        normalized: 0,
        rejected: 1,
      }),
    );
    expect(record.completenessStatus).toBe(
      INTAKE_COMPLETENESS_STATUSES.REJECTED,
    );
    expect(record.validationCodes).toContain('IMPORT_PARSE_ERROR');
    expect(record.normalizedPayload).toBeNull();
    expect(record.messages[0]).toEqual(
      expect.objectContaining({
        severity: 'error',
      }),
    );
  });
});