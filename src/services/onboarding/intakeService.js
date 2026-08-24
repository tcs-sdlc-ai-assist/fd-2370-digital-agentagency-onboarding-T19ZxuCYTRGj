import {
  AUDIT_SOURCES,
  ONBOARDING_STATUSES,
  RULE_IDENTIFIERS,
  SOURCE_CHANNELS,
  WORKFLOW_STAGES,
} from '../../constants/domain.js';
import {
  generateApplicationId,
  generateCorrelationId,
  generateTrackingId,
} from '../../utils/ids.js';
import { toIsoTimestamp } from '../../utils/dates.js';
import {
  normalizeIntakeSubmission,
  INTAKE_NORMALIZER_ERROR_CODES,
} from './intakeNormalizers.js';
import {
  createValidationService,
  ONBOARDING_VALIDATION_CODES,
  VALIDATION_SCOPES,
} from './validationService.js';

export const INTAKE_SERVICE_ERROR_CODES = Object.freeze({
  INVALID_REQUEST: 'INTAKE_SERVICE_INVALID_REQUEST',
  INVALID_OPTIONS: 'INTAKE_SERVICE_INVALID_OPTIONS',
  INVALID_NORMALIZER: 'INTAKE_SERVICE_INVALID_NORMALIZER',
  INVALID_VALIDATOR: 'INTAKE_SERVICE_INVALID_VALIDATOR',
  INVALID_REPOSITORY: 'INTAKE_SERVICE_INVALID_REPOSITORY',
  BATCH_LIMIT_EXCEEDED: 'INTAKE_SERVICE_BATCH_LIMIT_EXCEEDED',
  NORMALIZATION_FAILED: 'INTAKE_SERVICE_NORMALIZATION_FAILED',
  TRACKING_ID_COLLISION: 'INTAKE_SERVICE_TRACKING_ID_COLLISION',
  PERSISTENCE_FAILED: 'INTAKE_SERVICE_PERSISTENCE_FAILED',
  AUTO_SUBMIT_FAILED: 'INTAKE_SERVICE_AUTO_SUBMIT_FAILED',
});

export const INTAKE_COMPLETENESS_STATUSES = Object.freeze({
  COMPLETE: 'COMPLETE',
  INCOMPLETE_ONLINE_COMPLETABLE:
    'INCOMPLETE_ONLINE_COMPLETABLE',
  MANUAL_EXCEPTION: 'MANUAL_EXCEPTION',
  REJECTED: 'REJECTED',
});

export const INTAKE_NEXT_ACTIONS = Object.freeze({
  AUTO_SUBMIT_ELIGIBLE: 'AUTO_SUBMIT_ELIGIBLE',
  JOURNEY_REQUIRED: 'JOURNEY_REQUIRED',
  MANUAL_EXCEPTION: 'MANUAL_EXCEPTION',
  REJECT: 'REJECT',
  SUBMITTED: 'SUBMITTED',
  PER_RECORD_ROUTING: 'PER_RECORD_ROUTING',
});

export const DEFAULT_MAX_INTAKE_BATCH_SIZE = 100;

const REJECTING_VALIDATION_CODES = new Set([
  ONBOARDING_VALIDATION_CODES.COMPANY_REQUIRED,
  ONBOARDING_VALIDATION_CODES.GA_CODE_REQUIRED,
  ONBOARDING_VALIDATION_CODES.AGENCY_TYPE_REQUIRED,
  ONBOARDING_VALIDATION_CODES.CONTRACT_TYPE_REQUIRED,
  ONBOARDING_VALIDATION_CODES.APPLICANT_IDENTITY_REQUIRED,
]);

const MANUAL_EXCEPTION_VALIDATION_CODES = new Set([
  ONBOARDING_VALIDATION_CODES.ABNCA_NO_ADVANCE,
  ONBOARDING_VALIDATION_CODES.CARRIER_UNSUPPORTED,
  ONBOARDING_VALIDATION_CODES.CORPORATE_LICENSED_PRINCIPAL_REQUIRED,
  ONBOARDING_VALIDATION_CODES.HIERARCHY_NOT_ELIGIBLE,
  ONBOARDING_VALIDATION_CODES.HIERARCHY_NOT_RESOLVED,
  ONBOARDING_VALIDATION_CODES.MONTHLY_CHECK_UNSUPPORTED,
  ONBOARDING_VALIDATION_CODES.SOURCE_AUTHORIZATION_FORBIDDEN,
  ONBOARDING_VALIDATION_CODES.SOURCE_AUTHORIZATION_REQUIRED,
  ONBOARDING_VALIDATION_CODES.SOURCE_FORMAT_NOT_AUTHORIZED,
  ONBOARDING_VALIDATION_CODES.SOURCE_PARTNER_MISMATCH,
  ONBOARDING_VALIDATION_CODES.WILLIAM_PENN_LEVEL_30_UNSUPPORTED,
  ONBOARDING_VALIDATION_CODES
    .WILLIAM_PENN_NON_TRADITIONAL_UNSUPPORTED,
  RULE_IDENTIFIERS.DUPLICATE_APPLICATION_IN_PROGRESS,
  RULE_IDENTIFIERS.DUPLICATE_PARTNER_SUBMISSION,
  RULE_IDENTIFIERS.FOR_CAUSE_TERMINATION_BLOCK,
  RULE_IDENTIFIERS.SUITABILITY_TERMINATION_BLOCK,
  RULE_IDENTIFIERS.TERMINATION_HISTORY_REVIEW_REQUIRED,
]);

const ONLINE_COMPLETABLE_VALIDATION_CODES = new Set([
  ONBOARDING_VALIDATION_CODES.EO_REQUIRED,
  ONBOARDING_VALIDATION_CODES.NPN_INVALID_FORMAT,
  ONBOARDING_VALIDATION_CODES.REQUIRED_FORM_INCOMPLETE,
  ONBOARDING_VALIDATION_CODES.REQUIRED_FORM_MISSING,
  RULE_IDENTIFIERS.BANKING_DETAILS_REQUIRED,
  RULE_IDENTIFIERS.ESIGN_CONSENT_REQUIRED,
  RULE_IDENTIFIERS.OCR_LOW_CONFIDENCE,
]);

const ONLINE_COMPLETABLE_SCENARIOS = new Set([
  'fax_low_confidence',
  'incomplete_online_completable',
  'manual_start',
  'ocr_review_required',
  'unstructured_email',
]);

const REJECTED_SCENARIOS = new Set([
  'missing_mandatory_fields',
  'parse_error',
]);

const MANUAL_EXCEPTION_SCENARIOS = new Set([
  'carrier_rule_failure',
  'commission_rule_failure',
  'corporate_principal_ineligible',
  'duplicate_in_progress',
]);

const SCENARIO_MISSING_FIELDS = Object.freeze({
  incomplete_online_completable: Object.freeze([
    'banking.paymentMethod',
    'banking.routingNumber',
    'banking.accountNumber',
    'errorsAndOmissions.policyNumber',
  ]),
  ocr_review_required: Object.freeze([
    'banking.routingNumber',
    'banking.accountNumber',
  ]),
  fax_low_confidence: Object.freeze([
    'agent.phone',
    'licensing.licenseNumber',
    'attestations.electronicDeliveryConsent',
  ]),
  unstructured_email: Object.freeze([
    'agent.phone',
    'licensing.licenseNumber',
    'licensing.linesOfAuthority',
    'banking.paymentMethod',
    'attestations.backgroundQuestionsClear',
    'attestations.electronicDeliveryConsent',
  ]),
  manual_start: Object.freeze([
    'organization.address',
    'principals',
    'licensing',
    'banking',
    'attestations',
  ]),
  missing_mandatory_fields: Object.freeze([
    'company',
    'gaCode',
    'agencyType',
    'contractType',
    'agent.firstName',
    'agent.lastName',
    'agent.npn',
  ]),
});

const SOURCE_AUDIT_MAP = Object.freeze({
  [SOURCE_CHANNELS.SFTP]: AUDIT_SOURCES.SFTP_INTAKE,
  [SOURCE_CHANNELS.EMAIL]: AUDIT_SOURCES.EMAIL_INTAKE,
  [SOURCE_CHANNELS.MAIL]: AUDIT_SOURCES.EMAIL_INTAKE,
  [SOURCE_CHANNELS.FAX]: AUDIT_SOURCES.EMAIL_INTAKE,
  [SOURCE_CHANNELS.API]: AUDIT_SOURCES.WORKFLOW_ENGINE,
  [SOURCE_CHANNELS.PARTNER_DASHBOARD]:
    AUDIT_SOURCES.PARTNER_DASHBOARD,
  [SOURCE_CHANNELS.MANUAL]: AUDIT_SOURCES.WORKFLOW_ENGINE,
});

const TERMINAL_APPLICATION_STATUSES = new Set([
  ONBOARDING_STATUSES.COMPLETED,
  ONBOARDING_STATUSES.DECLINED,
  ONBOARDING_STATUSES.WITHDRAWN,
]);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertOptions(options, description = 'Intake service options') {
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

function normalizeIdentifierForLookup(value) {
  return normalizeOptionalIdentifier(value)
    ?.normalize('NFKC')
    .toLowerCase();
}

function normalizeBatchSize(value) {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(
      'The maximum intake batch size must be a positive integer.',
    );
  }

  return value;
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

function createIntakeServiceError(code, message, details, cause) {
  const error = new Error(message, {
    ...(cause === undefined ? {} : { cause }),
  });

  error.name = 'IntakeServiceError';
  error.code = code;
  error.details = details ?? null;
  error.recoverable = true;

  return error;
}

function assertNormalizer(normalizer) {
  if (typeof normalizer === 'function') {
    return normalizer;
  }

  if (
    isObject(normalizer) &&
    typeof normalizer.normalize === 'function'
  ) {
    return (request) => normalizer.normalize(request);
  }

  throw createIntakeServiceError(
    INTAKE_SERVICE_ERROR_CODES.INVALID_NORMALIZER,
    'The intake normalizer must be a function or provide normalize.',
    null,
  );
}

function assertValidationService(validationService) {
  if (
    !isObject(validationService) ||
    typeof validationService.validateApplication !== 'function'
  ) {
    throw createIntakeServiceError(
      INTAKE_SERVICE_ERROR_CODES.INVALID_VALIDATOR,
      'The intake validation service must provide validateApplication.',
      null,
    );
  }

  return validationService;
}

function assertOptionalRepository(repository, description) {
  if (repository === undefined || repository === null) {
    return null;
  }

  if (!isObject(repository)) {
    throw createIntakeServiceError(
      INTAKE_SERVICE_ERROR_CODES.INVALID_REPOSITORY,
      `${description} must be an object.`,
      null,
    );
  }

  return repository;
}

function getIssueCodes(validationResult) {
  const codes = [
    ...(Array.isArray(validationResult?.validationCodes)
      ? validationResult.validationCodes
      : []),
    ...(Array.isArray(validationResult?.issues)
      ? validationResult.issues.map((issue) => issue.code)
      : []),
  ];

  return [
    ...new Set(
      codes
        .map((code) => normalizeOptionalIdentifier(code))
        .filter(Boolean),
    ),
  ];
}

function getSourceScenario(payload, context) {
  return (
    normalizeOptionalIdentifier(context.simulateScenario) ??
    normalizeOptionalIdentifier(
      payload.sourceMetadata?.simulateScenario,
    )
  );
}

function getApplicant(payload) {
  return payload.applicant ?? payload.agent ?? payload.organization;
}

function collectMandatoryMissingFields(payload) {
  const missingFields = [];
  const applicant = getApplicant(payload);
  const contractType = normalizeIdentifierForLookup(
    payload.contractType ?? payload.contract?.type,
  );
  const organizationContract = [
    'agency',
    'corporate',
    'entity',
    'organization',
  ].includes(contractType);

  if (!normalizeOptionalIdentifier(payload.company)) {
    missingFields.push('company');
  }

  if (!normalizeOptionalIdentifier(payload.gaCode)) {
    missingFields.push('gaCode');
  }

  if (
    !normalizeOptionalIdentifier(
      payload.agencyType ?? payload.agency?.type,
    )
  ) {
    missingFields.push('agencyType');
  }

  if (
    !normalizeOptionalIdentifier(
      payload.contractType ?? payload.contract?.type,
    )
  ) {
    missingFields.push('contractType');
  }

  if (!isObject(applicant)) {
    missingFields.push('applicant');
    return missingFields;
  }

  if (organizationContract || applicant.type === 'organization') {
    if (
      !normalizeOptionalIdentifier(
        applicant.legalName ?? applicant.name,
      )
    ) {
      missingFields.push('organization.legalName');
    }

    return missingFields;
  }

  if (!normalizeOptionalIdentifier(applicant.firstName)) {
    missingFields.push('agent.firstName');
  }

  if (!normalizeOptionalIdentifier(applicant.lastName)) {
    missingFields.push('agent.lastName');
  }

  if (!normalizeOptionalIdentifier(applicant.npn)) {
    missingFields.push('agent.npn');
  }

  return missingFields;
}

function collectOnlineMissingFields(payload, scenario) {
  const fields = new Set(SCENARIO_MISSING_FIELDS[scenario] ?? []);
  const extractionMetadata = payload.extractionMetadata;

  if (isObject(extractionMetadata)) {
    if (Array.isArray(extractionMetadata.unreadableFields)) {
      extractionMetadata.unreadableFields.forEach((field) => {
        const normalizedField = normalizeOptionalIdentifier(field);

        if (normalizedField) {
          fields.add(normalizedField);
        }
      });
    }

    if (Array.isArray(extractionMetadata.ambiguousFields)) {
      extractionMetadata.ambiguousFields.forEach((entry) => {
        const field = isObject(entry) ? entry.field : entry;
        const normalizedField = normalizeOptionalIdentifier(field);

        if (normalizedField) {
          fields.add(
            normalizedField.includes('.')
              ? normalizedField
              : `agent.${normalizedField}`,
          );
        }
      });
    }
  }

  return [...fields];
}

function createCompletenessMessage(code, field, message, severity) {
  return {
    code,
    message,
    severity,
    ...(field === undefined ? {} : { field }),
  };
}

/**
 * Evaluates normalized intake completeness and progression routing.
 *
 * @param {object} payload Normalized onboarding payload.
 * @param {object} [validationResult] Initial validation result.
 * @param {{
 *   simulateScenario?: string,
 *   duplicate?: object | null,
 *   additionalValidationCodes?: string[]
 * }} [context] Completeness context.
 * @returns {{
 *   status: string,
 *   nextAction: string,
 *   missingFields: string[],
 *   validationCodes: string[],
 *   manualReviewRequired: boolean,
 *   messages: object[]
 * }} Completeness result.
 */
export function evaluateIntakeCompleteness(
  payload,
  validationResult = {},
  context = {},
) {
  if (!isObject(payload)) {
    throw new TypeError(
      'A normalized intake payload must be an object.',
    );
  }

  const normalizedContext = assertOptions(
    context,
    'Intake completeness context',
  );
  const scenario = getSourceScenario(payload, normalizedContext);
  const mandatoryMissingFields = collectMandatoryMissingFields(payload);
  const onlineMissingFields = collectOnlineMissingFields(
    payload,
    scenario,
  );
  const validationCodes = new Set([
    ...getIssueCodes(validationResult),
    ...(Array.isArray(normalizedContext.additionalValidationCodes)
      ? normalizedContext.additionalValidationCodes
      : []),
  ]);

  if (normalizedContext.duplicate) {
    validationCodes.add(
      RULE_IDENTIFIERS.DUPLICATE_APPLICATION_IN_PROGRESS,
    );
  }

  const hasRejectingCode = [...validationCodes].some((code) =>
    REJECTING_VALIDATION_CODES.has(code),
  );
  const hasManualExceptionCode = [...validationCodes].some((code) =>
    MANUAL_EXCEPTION_VALIDATION_CODES.has(code),
  );
  const hasOnlineCompletableCode = [...validationCodes].some((code) =>
    ONLINE_COMPLETABLE_VALIDATION_CODES.has(code),
  );
  let status;
  let nextAction;

  if (
    mandatoryMissingFields.length > 0 ||
    hasRejectingCode ||
    REJECTED_SCENARIOS.has(scenario)
  ) {
    status = INTAKE_COMPLETENESS_STATUSES.REJECTED;
    nextAction = INTAKE_NEXT_ACTIONS.REJECT;
  } else if (
    normalizedContext.duplicate ||
    hasManualExceptionCode ||
    validationResult.manualReviewRequired === true ||
    MANUAL_EXCEPTION_SCENARIOS.has(scenario)
  ) {
    status = INTAKE_COMPLETENESS_STATUSES.MANUAL_EXCEPTION;
    nextAction = INTAKE_NEXT_ACTIONS.MANUAL_EXCEPTION;
  } else if (
    onlineMissingFields.length > 0 ||
    hasOnlineCompletableCode ||
    ONLINE_COMPLETABLE_SCENARIOS.has(scenario)
  ) {
    status =
      INTAKE_COMPLETENESS_STATUSES.INCOMPLETE_ONLINE_COMPLETABLE;
    nextAction = INTAKE_NEXT_ACTIONS.JOURNEY_REQUIRED;
  } else if (validationResult.valid === false) {
    status = INTAKE_COMPLETENESS_STATUSES.MANUAL_EXCEPTION;
    nextAction = INTAKE_NEXT_ACTIONS.MANUAL_EXCEPTION;
  } else {
    status = INTAKE_COMPLETENESS_STATUSES.COMPLETE;
    nextAction = INTAKE_NEXT_ACTIONS.AUTO_SUBMIT_ELIGIBLE;
  }

  const missingFields = [
    ...new Set([
      ...mandatoryMissingFields,
      ...onlineMissingFields,
    ]),
  ];
  const messages = [
    ...missingFields.map((field) =>
      createCompletenessMessage(
        status === INTAKE_COMPLETENESS_STATUSES.REJECTED
          ? 'REQUIRED_FIELD_MISSING'
          : 'ONLINE_COMPLETION_REQUIRED',
        field,
        `${field} is required.`,
        status === INTAKE_COMPLETENESS_STATUSES.REJECTED
          ? 'error'
          : 'warning',
      ),
    ),
    ...(Array.isArray(validationResult.issues)
      ? validationResult.issues.map((issue) => cloneValue(issue))
      : []),
  ];

  if (normalizedContext.duplicate) {
    messages.push(
      createCompletenessMessage(
        RULE_IDENTIFIERS.DUPLICATE_APPLICATION_IN_PROGRESS,
        'applicant.npn',
        'An onboarding application for this producer and carrier is already in progress.',
        'blocking',
      ),
    );
  }

  return Object.freeze({
    status,
    completenessStatus: status,
    nextAction,
    missingFields: Object.freeze(missingFields),
    validationCodes: Object.freeze([...validationCodes]),
    manualReviewRequired:
      status === INTAKE_COMPLETENESS_STATUSES.MANUAL_EXCEPTION ||
      validationResult.manualReviewRequired === true,
    messages: Object.freeze(messages),
  });
}

function getDuplicateCandidateRecords(request, repository) {
  const suppliedRecords = [
    ...(Array.isArray(request.existingApplications)
      ? request.existingApplications
      : []),
    ...(isObject(request.scenarioContext?.existingApplication)
      ? [request.scenarioContext.existingApplication]
      : []),
  ];

  if (repository && typeof repository.list === 'function') {
    const records = repository.list({ includeCompleted: true });

    if (!Array.isArray(records)) {
      throw createIntakeServiceError(
        INTAKE_SERVICE_ERROR_CODES.INVALID_REPOSITORY,
        'The duplicate-screening repository returned an invalid collection.',
        null,
      );
    }

    suppliedRecords.push(...records);
  }

  return suppliedRecords;
}

function recordIsInProgress(record) {
  if (!isObject(record)) {
    return false;
  }

  const status = normalizeIdentifierForLookup(record.status);

  if (status && TERMINAL_APPLICATION_STATUSES.has(status)) {
    return false;
  }

  return ![
    'completed',
    'contracted',
    'declined',
    'rejected',
    'terminated',
    'withdrawn',
  ].includes(status);
}

function findDuplicateApplication(payload, candidates) {
  const applicant = getApplicant(payload);
  const npn = normalizeIdentifierForLookup(
    applicant?.npn ?? payload.npn,
  );
  const company = normalizeIdentifierForLookup(
    payload.company ?? payload.carrierCode,
  );
  const submissionId = normalizeIdentifierForLookup(
    payload.submissionId,
  );

  if (!npn && !submissionId) {
    return undefined;
  }

  return candidates.find((candidate) => {
    if (!recordIsInProgress(candidate)) {
      return false;
    }

    const candidateApplicant =
      candidate.applicant ??
      candidate.agent ??
      candidate.applicationPayload?.applicant ??
      candidate.applicationPayload?.agent;
    const candidateNpn = normalizeIdentifierForLookup(
      candidateApplicant?.npn ?? candidate.npn,
    );
    const candidateCompany = normalizeIdentifierForLookup(
      candidate.company ?? candidate.carrierCode,
    );
    const candidateSubmissionId = normalizeIdentifierForLookup(
      candidate.submissionId ??
        candidate.applicationPayload?.submissionId,
    );
    const sameProducer =
      Boolean(npn && candidateNpn && npn === candidateNpn) ||
      Boolean(
        submissionId &&
          candidateSubmissionId &&
          submissionId === candidateSubmissionId,
      );
    const sameCompany =
      !company || !candidateCompany || company === candidateCompany;

    return sameProducer && sameCompany;
  });
}

function createTrackingSeed(request, payload, recordIndex) {
  return {
    partnerCode:
      payload.partnerCode ??
      request.partnerCode ??
      request.requestedBy?.partnerCode ??
      null,
    sourceChannel: request.sourceChannel,
    sourceFormat: request.sourceFormat,
    submissionId: payload.submissionId ?? null,
    fileName: request.fileName ?? null,
    recordIndex,
    rawContent:
      payload.submissionId === undefined
        ? request.rawContent
        : undefined,
  };
}

function createImportBatchId(request, timestamp) {
  return generateCorrelationId({
    type: 'intake-import',
    sourceChannel: request.sourceChannel,
    sourceFormat: request.sourceFormat,
    partnerCode: request.partnerCode ?? null,
    fileName: request.fileName ?? null,
    timestamp,
  }).replace(/^corr-/i, 'imp-');
}

function createJourneyUrl(journeyType, trackingId) {
  return `/journeys/${encodeURIComponent(
    journeyType ?? 'agent-contracting',
  )}/${encodeURIComponent(trackingId)}/start`;
}

function createDraftRecord(
  payload,
  trackingId,
  applicationId,
  timestamp,
  actor,
) {
  const partnerCode = normalizeIdentifier(
    payload.partnerCode ??
      payload.sourceMetadata?.partnerCode ??
      actor?.partnerCode ??
      'UNSCOPED',
    'Draft partner code',
  );
  const journeyType =
    normalizeOptionalIdentifier(payload.journeyType) ??
    'agent_contracting';

  return {
    trackingId,
    applicationId,
    partnerCode,
    journeyType,
    status: WORKFLOW_STAGES.APPLICATION_STARTED,
    currentStepId: 'start',
    resumeUrl: createJourneyUrl(journeyType, trackingId),
    formState: cloneValue(payload),
    dirtySections: [],
    completedSteps: [],
    skippedSteps: [],
    completionState: {
      completed: false,
      percentComplete: 0,
      completedSteps: [],
      skippedSteps: [],
      packageComplete: false,
      submissionReady: false,
    },
    signatures: {},
    lastValidationResult: null,
    saveMode: 'MANUAL',
    version: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    lastSavedAt: timestamp,
    expiresAt: null,
    metadata: {
      sourceChannel: payload.sourceMetadata?.sourceChannel ?? null,
      sourceFormat: payload.sourceMetadata?.sourceFormat ?? null,
      createdBy:
        actor?.userId ?? actor?.id ?? actor?.actorId ?? 'system',
    },
  };
}

function buildMessagesFromError(error) {
  return [
    {
      code:
        normalizeOptionalIdentifier(error?.code) ??
        INTAKE_SERVICE_ERROR_CODES.NORMALIZATION_FAILED,
      message:
        normalizeOptionalIdentifier(error?.message) ??
        'The intake submission could not be normalized.',
      severity: 'error',
      details: error?.details ?? null,
    },
  ];
}

function summarizeRecords(records) {
  const summary = {
    received: records.length,
    normalized: 0,
    rejected: 0,
    requiresJourney: 0,
    manualExceptions: 0,
    autoSubmitEligible: 0,
    submitted: 0,
  };

  records.forEach((record) => {
    if (
      record.completenessStatus ===
      INTAKE_COMPLETENESS_STATUSES.REJECTED
    ) {
      summary.rejected += 1;
      return;
    }

    summary.normalized += 1;

    if (
      record.nextAction === INTAKE_NEXT_ACTIONS.JOURNEY_REQUIRED
    ) {
      summary.requiresJourney += 1;
    } else if (
      record.nextAction === INTAKE_NEXT_ACTIONS.MANUAL_EXCEPTION
    ) {
      summary.manualExceptions += 1;
    } else if (
      record.nextAction ===
      INTAKE_NEXT_ACTIONS.AUTO_SUBMIT_ELIGIBLE
    ) {
      summary.autoSubmitEligible += 1;
    } else if (record.nextAction === INTAKE_NEXT_ACTIONS.SUBMITTED) {
      summary.submitted += 1;
    }
  });

  return Object.freeze(summary);
}

function resolveBatchNextAction(records) {
  if (records.length === 1) {
    return records[0].nextAction;
  }

  const actions = new Set(records.map((record) => record.nextAction));

  return actions.size === 1
    ? records[0].nextAction
    : INTAKE_NEXT_ACTIONS.PER_RECORD_ROUTING;
}

function invokeSubmitter(submissionService, trackingId, request) {
  if (!submissionService) {
    return undefined;
  }

  let result;

  if (typeof submissionService === 'function') {
    result = submissionService(trackingId, request);
  } else if (
    typeof submissionService.submitApplication === 'function'
  ) {
    result = submissionService.submitApplication(
      trackingId,
      request,
    );
  } else if (typeof submissionService.submit === 'function') {
    result = submissionService.submit(trackingId, request);
  } else {
    throw createIntakeServiceError(
      INTAKE_SERVICE_ERROR_CODES.AUTO_SUBMIT_FAILED,
      'The submission service does not provide a supported submit method.',
      { trackingId },
    );
  }

  if (result && typeof result.then === 'function') {
    throw createIntakeServiceError(
      INTAKE_SERVICE_ERROR_CODES.AUTO_SUBMIT_FAILED,
      'Asynchronous submission services are not supported by synchronous intake processing.',
      { trackingId },
    );
  }

  return result;
}

/**
 * Orchestrates mock intake normalization, validation, duplicate screening,
 * draft creation, and progression routing.
 */
export class IntakeService {
  /**
   * @param {{
   *   normalizer?: Function | {normalize: Function},
   *   validationService?: object,
   *   completenessEvaluator?: Function,
   *   applicationRepository?: object,
   *   draftRepository?: object,
   *   duplicateRepository?: object,
   *   auditService?: object | false,
   *   submissionService?: object | Function,
   *   recordFactory?: Function,
   *   clock?: () => Date | string | number,
   *   maxBatchSize?: number,
   *   autoSubmit?: boolean
   * }} [options] Intake service options.
   */
  constructor(options = {}) {
    const normalizedOptions = assertOptions(options);

    if (
      normalizedOptions.clock !== undefined &&
      typeof normalizedOptions.clock !== 'function'
    ) {
      throw new TypeError('The intake service clock must be a function.');
    }

    if (
      normalizedOptions.completenessEvaluator !== undefined &&
      typeof normalizedOptions.completenessEvaluator !== 'function'
    ) {
      throw new TypeError(
        'The intake completeness evaluator must be a function.',
      );
    }

    if (
      normalizedOptions.recordFactory !== undefined &&
      typeof normalizedOptions.recordFactory !== 'function'
    ) {
      throw new TypeError('The intake record factory must be a function.');
    }

    this.normalizer = assertNormalizer(
      normalizedOptions.normalizer ?? normalizeIntakeSubmission,
    );
    this.validationService = assertValidationService(
      normalizedOptions.validationService ??
        createValidationService(),
    );
    this.completenessEvaluator =
      normalizedOptions.completenessEvaluator ??
      evaluateIntakeCompleteness;
    this.applicationRepository = assertOptionalRepository(
      normalizedOptions.applicationRepository,
      'The intake application repository',
    );
    this.draftRepository = assertOptionalRepository(
      normalizedOptions.draftRepository,
      'The intake draft repository',
    );
    this.duplicateRepository = assertOptionalRepository(
      normalizedOptions.duplicateRepository ??
        normalizedOptions.applicationRepository,
      'The intake duplicate repository',
    );
    this.auditService =
      normalizedOptions.auditService === false
        ? null
        : assertOptionalRepository(
            normalizedOptions.auditService,
            'The intake audit service',
          );
    this.submissionService =
      normalizedOptions.submissionService ?? null;
    this.recordFactory = normalizedOptions.recordFactory ?? null;
    this.clock = normalizedOptions.clock ?? (() => new Date());
    this.maxBatchSize = normalizeBatchSize(
      normalizedOptions.maxBatchSize ??
        DEFAULT_MAX_INTAKE_BATCH_SIZE,
    );
    this.autoSubmit = normalizedOptions.autoSubmit ?? false;
  }

  /**
   * Imports and routes a mock intake submission.
   *
   * @param {{
   *   sourceChannel: string,
   *   sourceFormat: string,
   *   rawContent: string | object,
   *   partnerCode?: string,
   *   fileName?: string | null,
   *   mimeType?: string | null,
   *   bulk?: boolean,
   *   simulateScenario?: string,
   *   layout?: object,
   *   requestedBy?: object,
   *   autoSubmit?: boolean,
   *   existingApplications?: object[],
   *   scenarioContext?: object
   * }} request Intake request.
   * @returns {object} Import response.
   */
  importSubmission(request) {
    const normalizedRequest = assertOptions(request, 'Intake request');
    const sourceChannel = normalizeIdentifier(
      normalizedRequest.sourceChannel,
      'Intake source channel',
    );
    const sourceFormat = normalizeIdentifier(
      normalizedRequest.sourceFormat,
      'Intake source format',
    );
    const timestamp = toIsoTimestamp(this.clock());
    const importBatchId = createImportBatchId(
      {
        ...normalizedRequest,
        sourceChannel,
        sourceFormat,
      },
      timestamp,
    );
    let normalizedPayloads;

    try {
      normalizedPayloads = this.normalizer({
        ...cloneValue(normalizedRequest),
        sourceChannel,
        sourceFormat,
        importedAt: normalizedRequest.importedAt ?? timestamp,
      });
    } catch (error) {
      return this.createRejectedImportResponse(
        normalizedRequest,
        importBatchId,
        timestamp,
        error,
      );
    }

    if (!Array.isArray(normalizedPayloads)) {
      normalizedPayloads = [normalizedPayloads];
    }

    if (normalizedPayloads.length > this.maxBatchSize) {
      throw createIntakeServiceError(
        INTAKE_SERVICE_ERROR_CODES.BATCH_LIMIT_EXCEEDED,
        `The intake batch exceeds the maximum of ${this.maxBatchSize} records.`,
        {
          recordCount: normalizedPayloads.length,
          maxBatchSize: this.maxBatchSize,
        },
      );
    }

    const duplicateCandidates = getDuplicateCandidateRecords(
      normalizedRequest,
      this.duplicateRepository,
    );
    const records = normalizedPayloads.map((payload, recordIndex) =>
      this.processNormalizedRecord(payload, {
        request: normalizedRequest,
        importBatchId,
        recordIndex,
        timestamp,
        duplicateCandidates,
      }),
    );
    const summary = summarizeRecords(records);

    return Object.freeze({
      importBatchId,
      sourceChannel,
      sourceFormat,
      bulk:
        normalizedRequest.bulk === true || records.length > 1,
      records: Object.freeze(records),
      summary,
      nextAction: resolveBatchNextAction(records),
      importedAt: timestamp,
    });
  }

  /**
   * Alias for importSubmission.
   *
   * @param {object} request Intake request.
   * @returns {object} Import response.
   */
  import(request) {
    return this.importSubmission(request);
  }

  /**
   * Alias for importSubmission used by facade consumers.
   *
   * @param {object} request Intake request.
   * @returns {object} Import response.
   */
  normalizeAndImport(request) {
    return this.importSubmission(request);
  }

  /**
   * Creates and optionally persists a journey draft from normalized data.
   *
   * @param {object} normalizedPayload Normalized onboarding payload.
   * @param {{
   *   trackingId?: string,
   *   applicationId?: string,
   *   actor?: object,
   *   timestamp?: Date | string | number
   * }} [options] Draft creation options.
   * @returns {object} Created draft.
   */
  createDraftFromNormalizedRecord(
    normalizedPayload,
    options = {},
  ) {
    if (!isObject(normalizedPayload)) {
      throw new TypeError(
        'A normalized onboarding payload must be an object.',
      );
    }

    const normalizedOptions = assertOptions(
      options,
      'Intake draft options',
    );
    const timestamp = toIsoTimestamp(
      normalizedOptions.timestamp ?? this.clock(),
    );
    const trackingId =
      normalizedOptions.trackingId ??
      generateTrackingId({
        submissionId: normalizedPayload.submissionId ?? null,
        partnerCode: normalizedPayload.partnerCode ?? null,
        timestamp,
      });
    const applicationId =
      normalizedOptions.applicationId ??
      generateApplicationId({ trackingId });
    const draft = createDraftRecord(
      normalizedPayload,
      trackingId,
      applicationId,
      timestamp,
      normalizedOptions.actor,
    );

    if (!this.draftRepository) {
      return draft;
    }

    if (typeof this.draftRepository.create !== 'function') {
      throw createIntakeServiceError(
        INTAKE_SERVICE_ERROR_CODES.INVALID_REPOSITORY,
        'The intake draft repository must provide create.',
        { trackingId },
      );
    }

    try {
      return this.draftRepository.create(draft);
    } catch (error) {
      throw createIntakeServiceError(
        INTAKE_SERVICE_ERROR_CODES.PERSISTENCE_FAILED,
        'Unable to persist the normalized intake draft.',
        { trackingId },
        error,
      );
    }
  }

  processNormalizedRecord(payload, context) {
    if (!isObject(payload)) {
      throw createIntakeServiceError(
        INTAKE_SERVICE_ERROR_CODES.NORMALIZATION_FAILED,
        'The intake normalizer returned an invalid payload.',
        { recordIndex: context.recordIndex },
      );
    }

    const request = context.request;
    const trackingId =
      normalizeOptionalIdentifier(payload.trackingId) ??
      generateTrackingId(
        createTrackingSeed(request, payload, context.recordIndex),
      );
    const applicationId =
      normalizeOptionalIdentifier(payload.applicationId) ??
      generateApplicationId({ trackingId });
    const duplicate = findDuplicateApplication(
      payload,
      context.duplicateCandidates,
    );
    const validationResult =
      this.validationService.validateApplication(payload, {
        scope: VALIDATION_SCOPES.INITIAL,
        principal: request.requestedBy,
        requireAuthorization:
          request.requireAuthorization ?? false,
        enforcePartnerScope:
          request.enforcePartnerScope ?? true,
        persist: false,
      });
    const completeness = this.completenessEvaluator(
      payload,
      validationResult,
      {
        simulateScenario: request.simulateScenario,
        duplicate,
      },
    );
    let persistedApplication;
    let draft;
    let submission;
    let nextAction = completeness.nextAction;
    const auditWarnings = [];

    if (
      completeness.status !==
      INTAKE_COMPLETENESS_STATUSES.REJECTED
    ) {
      persistedApplication = this.persistApplicationRecord(
        payload,
        {
          trackingId,
          applicationId,
          timestamp: context.timestamp,
          request,
          completeness,
          validationResult,
        },
      );

      if (
        completeness.nextAction ===
        INTAKE_NEXT_ACTIONS.JOURNEY_REQUIRED
      ) {
        draft = this.createDraftFromNormalizedRecord(payload, {
          trackingId,
          applicationId,
          actor: request.requestedBy,
          timestamp: context.timestamp,
        });
      }

      if (
        completeness.nextAction ===
          INTAKE_NEXT_ACTIONS.AUTO_SUBMIT_ELIGIBLE &&
        (request.autoSubmit ?? this.autoSubmit)
      ) {
        try {
          submission = invokeSubmitter(
            this.submissionService,
            trackingId,
            {
              applicationId,
              applicationVersion:
                persistedApplication?.version ?? 1,
              submittedBy:
                request.requestedBy?.userId ??
                request.requestedBy?.id ??
                'system',
              source: 'intake_auto_submit',
            },
          );

          if (submission?.submitted !== false) {
            nextAction = INTAKE_NEXT_ACTIONS.SUBMITTED;
          }
        } catch (error) {
          throw createIntakeServiceError(
            INTAKE_SERVICE_ERROR_CODES.AUTO_SUBMIT_FAILED,
            'The normalized intake record could not be auto-submitted.',
            { trackingId, applicationId },
            error,
          );
        }
      }
    }

    const auditError = this.appendAuditEvent(
      {
        trackingId,
        applicationId,
        sourceRecordId: applicationId,
        action:
          completeness.status ===
          INTAKE_COMPLETENESS_STATUSES.REJECTED
            ? 'INTAKE_REJECTED'
            : 'INTAKE_NORMALIZED',
        summary:
          completeness.status ===
          INTAKE_COMPLETENESS_STATUSES.REJECTED
            ? 'The intake record was rejected during completeness processing.'
            : 'The intake record was normalized and routed.',
        metadata: {
          importBatchId: context.importBatchId,
          recordIndex: context.recordIndex,
          completenessStatus: completeness.status,
          nextAction,
          validationCodes: completeness.validationCodes,
          duplicateApplicationId:
            duplicate?.applicationId ?? null,
        },
      },
      request,
    );

    if (auditError) {
      auditWarnings.push(auditError);
    }

    return Object.freeze({
      trackingId,
      applicationId,
      normalizedPayload: cloneValue(payload),
      completenessStatus: completeness.status,
      nextAction,
      missingFields: cloneValue(completeness.missingFields),
      validationCodes: cloneValue(completeness.validationCodes),
      manualReviewRequired: completeness.manualReviewRequired,
      messages: cloneValue(completeness.messages),
      validation: cloneValue(validationResult),
      duplicate: duplicate
        ? {
            applicationId: duplicate.applicationId ?? null,
            trackingId: duplicate.trackingId ?? null,
            status: duplicate.status ?? null,
          }
        : null,
      journeyUrl:
        nextAction === INTAKE_NEXT_ACTIONS.JOURNEY_REQUIRED
          ? draft?.resumeUrl ??
            createJourneyUrl(payload.journeyType, trackingId)
          : null,
      draft: draft ? cloneValue(draft) : null,
      application: persistedApplication
        ? cloneValue(persistedApplication)
        : null,
      submission: submission ? cloneValue(submission) : null,
      warnings: Object.freeze(auditWarnings),
    });
  }

  persistApplicationRecord(payload, context) {
    if (!this.applicationRepository || !this.recordFactory) {
      return null;
    }

    const repositoryMethod =
      typeof this.applicationRepository.create === 'function'
        ? 'create'
        : typeof this.applicationRepository.save === 'function'
          ? 'save'
          : undefined;

    if (!repositoryMethod) {
      throw createIntakeServiceError(
        INTAKE_SERVICE_ERROR_CODES.INVALID_REPOSITORY,
        'The intake application repository must provide create or save.',
        { trackingId: context.trackingId },
      );
    }

    let application;

    try {
      application = this.recordFactory(cloneValue(payload), {
        trackingId: context.trackingId,
        applicationId: context.applicationId,
        timestamp: context.timestamp,
        request: cloneValue(context.request),
        completeness: cloneValue(context.completeness),
        validation: cloneValue(context.validationResult),
      });
    } catch (error) {
      throw createIntakeServiceError(
        INTAKE_SERVICE_ERROR_CODES.PERSISTENCE_FAILED,
        'The normalized intake application could not be created.',
        { trackingId: context.trackingId },
        error,
      );
    }

    if (!isObject(application)) {
      throw createIntakeServiceError(
        INTAKE_SERVICE_ERROR_CODES.PERSISTENCE_FAILED,
        'The intake record factory returned an invalid application.',
        { trackingId: context.trackingId },
      );
    }

    try {
      return this.applicationRepository[repositoryMethod](application);
    } catch (error) {
      throw createIntakeServiceError(
        INTAKE_SERVICE_ERROR_CODES.PERSISTENCE_FAILED,
        'Unable to persist the normalized intake application.',
        { trackingId: context.trackingId },
        error,
      );
    }
  }

  appendAuditEvent(event, request) {
    if (!this.auditService) {
      return null;
    }

    const append =
      typeof this.auditService.append === 'function'
        ? this.auditService.append.bind(this.auditService)
        : typeof this.auditService.create === 'function'
          ? this.auditService.create.bind(this.auditService)
          : undefined;

    if (!append) {
      return Object.freeze({
        code: INTAKE_SERVICE_ERROR_CODES.INVALID_REPOSITORY,
        message:
          'The intake audit service does not provide append or create.',
      });
    }

    try {
      append(event, {
        actor: request.requestedBy,
        source:
          SOURCE_AUDIT_MAP[request.sourceChannel] ??
          AUDIT_SOURCES.WORKFLOW_ENGINE,
      });
      return null;
    } catch (error) {
      return Object.freeze({
        code: INTAKE_SERVICE_ERROR_CODES.PERSISTENCE_FAILED,
        message: 'The intake audit event could not be persisted.',
        cause: error,
      });
    }
  }

  createRejectedImportResponse(
    request,
    importBatchId,
    timestamp,
    error,
  ) {
    const validationCode =
      error?.code === INTAKE_NORMALIZER_ERROR_CODES.INVALID_XML ||
      error?.code === INTAKE_NORMALIZER_ERROR_CODES.INVALID_JSON ||
      error?.code === INTAKE_NORMALIZER_ERROR_CODES.PARSE_ERROR
        ? RULE_IDENTIFIERS.IMPORT_PARSE_ERROR
        : normalizeOptionalIdentifier(error?.code) ??
          RULE_IDENTIFIERS.IMPORT_PARSE_ERROR;
    const record = Object.freeze({
      trackingId: null,
      applicationId: null,
      normalizedPayload: null,
      completenessStatus:
        INTAKE_COMPLETENESS_STATUSES.REJECTED,
      nextAction: INTAKE_NEXT_ACTIONS.REJECT,
      missingFields: Object.freeze([]),
      validationCodes: Object.freeze([validationCode]),
      manualReviewRequired: false,
      messages: Object.freeze(buildMessagesFromError(error)),
      validation: null,
      duplicate: null,
      journeyUrl: null,
      draft: null,
      application: null,
      submission: null,
      warnings: Object.freeze([]),
    });
    const records = Object.freeze([record]);

    this.appendAuditEvent(
      {
        action: 'INTAKE_REJECTED',
        summary:
          'The intake submission was rejected because it could not be normalized.',
        metadata: {
          importBatchId,
          validationCodes: [validationCode],
          errorCode: error?.code ?? null,
        },
      },
      request,
    );

    return Object.freeze({
      importBatchId,
      sourceChannel: request.sourceChannel,
      sourceFormat: request.sourceFormat,
      bulk: request.bulk === true,
      records,
      summary: summarizeRecords(records),
      nextAction: INTAKE_NEXT_ACTIONS.REJECT,
      importedAt: timestamp,
    });
  }
}

/**
 * Creates an intake orchestration service.
 *
 * @param {ConstructorParameters<typeof IntakeService>[0]} [options]
 * Intake service options.
 * @returns {IntakeService} Intake service.
 */
export function createIntakeService(options = {}) {
  return new IntakeService(options);
}

/**
 * Imports a mock intake submission with a newly created service.
 *
 * @param {object} request Intake request.
 * @param {ConstructorParameters<typeof IntakeService>[0]} [options]
 * Intake service options.
 * @returns {object} Import response.
 */
export function importIntakeSubmission(request, options = {}) {
  return createIntakeService(options).importSubmission(request);
}

export const IntakeOrchestrator = IntakeService;
export const createIntakeOrchestrator = createIntakeService;
export const importSubmission = importIntakeSubmission;
export const evaluateCompleteness = evaluateIntakeCompleteness;

export default IntakeService;