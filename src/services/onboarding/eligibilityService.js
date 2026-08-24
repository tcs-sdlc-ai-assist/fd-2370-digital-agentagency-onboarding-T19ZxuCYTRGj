import {
  RULE_IDENTIFIERS,
  WORKFLOW_STAGES,
} from '../../constants/domain.js';
import { getSeeds } from '../../persistence/seedLoader.js';
import {
  calculateReusePeriod,
  toIsoTimestamp,
} from '../../utils/dates.js';
import { generateAgentCode } from '../../utils/ids.js';
import { createGAConfigResolver } from '../shared/gaConfigResolver.js';
import {
  createProviderSimulationService,
  SIMULATED_PROVIDER_CODES,
} from './providerSimulationService.js';

export const ELIGIBILITY_SERVICE_ERROR_CODES = Object.freeze({
  INVALID_APPLICATION: 'ELIGIBILITY_APPLICATION_INVALID',
  INVALID_OPTIONS: 'ELIGIBILITY_OPTIONS_INVALID',
  INVALID_DEPENDENCY: 'ELIGIBILITY_DEPENDENCY_INVALID',
  PROVIDER_CHECK_FAILED: 'ELIGIBILITY_PROVIDER_CHECK_FAILED',
  PERSISTENCE_FAILED: 'ELIGIBILITY_PERSISTENCE_FAILED',
  AUDIT_FAILED: 'ELIGIBILITY_AUDIT_FAILED',
});

export const ELIGIBILITY_CODES = Object.freeze({
  ...RULE_IDENTIFIERS,
  AGENCY_TYPE_REQUIRED: 'AGENCY_TYPE_REQUIRED',
  CARRIER_UNSUPPORTED: 'CARRIER_UNSUPPORTED',
  DUAL_CONTRACT_DETECTED: 'DUAL_CONTRACT_DETECTED',
  EXISTING_ACTIVE_CONTRACT: 'EXISTING_ACTIVE_CONTRACT',
  REQUIRED_TRAINING_INCOMPLETE: 'REQUIRED_TRAINING_INCOMPLETE',
  COMPLIANCE_REVIEW_REQUIRED: 'COMPLIANCE_REVIEW_REQUIRED',
  IDENTITY_REVIEW_REQUIRED: 'IDENTITY_REVIEW_REQUIRED',
  PROVIDER_CHECK_FAILED: 'PROVIDER_CHECK_FAILED',
});

export const ELIGIBILITY_SEVERITIES = Object.freeze({
  INFO: 'info',
  WARNING: 'warning',
  ERROR: 'error',
  BLOCKING: 'blocking',
});

export const ELIGIBILITY_OUTCOMES = Object.freeze({
  ELIGIBLE: 'ELIGIBLE',
  INELIGIBLE: 'INELIGIBLE',
  MANUAL_REVIEW: 'MANUAL_REVIEW',
});

export const BACKGROUND_DECISIONS = Object.freeze({
  REQUIRED: 'REQUIRED',
  REUSED: 'REUSED',
  NOT_REQUIRED: 'NOT_REQUIRED',
});

export const APPOINTMENT_DECISIONS = Object.freeze({
  REQUIRED: 'REQUIRED',
  REUSED: 'REUSED',
  NOT_REQUIRED: 'NOT_REQUIRED',
  PARTIALLY_REUSED: 'PARTIALLY_REUSED',
});

export const DEFAULT_BACKGROUND_REUSE_WINDOW_DAYS = 180;

const SUPPORTED_COMPANIES = Object.freeze(['Banner', 'WilliamPenn']);

const TERMINAL_APPLICATION_STATUSES = new Set([
  'completed',
  'contracted',
  'declined',
  'rejected',
  'terminated',
  'withdrawn',
]);

const BLOCKING_CODES = new Set([
  ELIGIBILITY_CODES.ABNCA_NO_ADVANCE,
  ELIGIBILITY_CODES.APPLICANT_IDENTITY_REQUIRED,
  ELIGIBILITY_CODES.CARRIER_UNSUPPORTED,
  ELIGIBILITY_CODES.COMPANY_REQUIRED,
  ELIGIBILITY_CODES.CONTRACT_TYPE_REQUIRED,
  ELIGIBILITY_CODES.CORPORATE_LICENSED_PRINCIPAL_REQUIRED,
  ELIGIBILITY_CODES.FOR_CAUSE_TERMINATION_BLOCK,
  ELIGIBILITY_CODES.GA_CODE_REQUIRED,
  ELIGIBILITY_CODES.HIERARCHY_NOT_ELIGIBLE,
  ELIGIBILITY_CODES.HIERARCHY_NOT_RESOLVED,
  ELIGIBILITY_CODES.SUITABILITY_TERMINATION_BLOCK,
  ELIGIBILITY_CODES.WILLIAM_PENN_LEVEL_30_UNSUPPORTED,
  ELIGIBILITY_CODES.WILLIAM_PENN_NON_TRADITIONAL_UNSUPPORTED,
]);

const MANUAL_REVIEW_CODES = new Set([
  ELIGIBILITY_CODES.AGENT_CODE_COLLISION,
  ELIGIBILITY_CODES.BACKGROUND_ADJUDICATION_REQUIRED,
  ELIGIBILITY_CODES.COMPLIANCE_REVIEW_REQUIRED,
  ELIGIBILITY_CODES.CORPORATE_LICENSED_PRINCIPAL_REQUIRED,
  ELIGIBILITY_CODES.DTCC_IDENTITY_MISMATCH,
  ELIGIBILITY_CODES.DTCC_REGISTRATION_INACTIVE,
  ELIGIBILITY_CODES.DUPLICATE_APPLICATION_IN_PROGRESS,
  ELIGIBILITY_CODES.FOR_CAUSE_TERMINATION_BLOCK,
  ELIGIBILITY_CODES.HIERARCHY_NOT_ELIGIBLE,
  ELIGIBILITY_CODES.HIERARCHY_NOT_RESOLVED,
  ELIGIBILITY_CODES.IDENTITY_REVIEW_REQUIRED,
  ELIGIBILITY_CODES.MANUAL_AGENT_CODE_REQUIRED,
  ELIGIBILITY_CODES.NIPR_IDENTITY_MISMATCH,
  ELIGIBILITY_CODES.NIPR_PRODUCER_NOT_FOUND,
  ELIGIBILITY_CODES.PROVIDER_CHECK_FAILED,
  ELIGIBILITY_CODES.SUITABILITY_TERMINATION_BLOCK,
  ELIGIBILITY_CODES.TERMINATION_HISTORY_REVIEW_REQUIRED,
  ELIGIBILITY_CODES.WILLIAM_PENN_LEVEL_30_UNSUPPORTED,
  ELIGIBILITY_CODES.WILLIAM_PENN_NON_TRADITIONAL_UNSUPPORTED,
]);

const DEFAULT_PROVIDER_CODES = Object.freeze([
  SIMULATED_PROVIDER_CODES.NIPR,
  SIMULATED_PROVIDER_CODES.GIACT,
  SIMULATED_PROVIDER_CODES.AML_DEMO,
]);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertOptions(options, description = 'Eligibility options') {
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

function normalizeToken(value) {
  return normalizeIdentifierForLookup(value)?.replace(/[^a-z0-9]/g, '');
}

function normalizeCompany(value) {
  const token = normalizeToken(value);

  if (token === 'banner' || token === 'bannerlife') {
    return 'Banner';
  }

  if (
    token === 'williampenn' ||
    token === 'williampennlife' ||
    token === 'williampennlifeinsurancecompanyofnewyork'
  ) {
    return 'WilliamPenn';
  }

  return normalizeOptionalIdentifier(value);
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

function createEligibilityError(code, message, details, cause) {
  const error = new Error(message, {
    ...(cause === undefined ? {} : { cause }),
  });

  error.name = 'EligibilityServiceError';
  error.code = code;
  error.details = details ?? null;
  error.recoverable = true;

  return error;
}

function createIssue({
  code,
  message,
  severity,
  field,
  path,
  metadata,
}) {
  return {
    code,
    message,
    severity:
      severity ??
      (BLOCKING_CODES.has(code)
        ? ELIGIBILITY_SEVERITIES.BLOCKING
        : ELIGIBILITY_SEVERITIES.ERROR),
    path:
      path ??
      (field === undefined ? [] : String(field).split('.')),
    ...(field === undefined ? {} : { field }),
    ...(metadata === undefined
      ? {}
      : { metadata: cloneValue(metadata) }),
  };
}

function issueKey(issue) {
  return [
    issue.code,
    issue.field ?? '',
    issue.path?.join('.') ?? '',
    issue.message,
  ].join(':');
}

function deduplicateIssues(issues) {
  const seen = new Set();

  return issues.filter((issue) => {
    const key = issueKey(issue);

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function getApplicationPayload(application) {
  return (
    application.applicationPayload ??
    application.formState ??
    application.payload ??
    application
  );
}

function getValueAtPath(value, path) {
  return path.split('.').reduce((currentValue, segment) => {
    if (currentValue === null || currentValue === undefined) {
      return undefined;
    }

    return currentValue[segment];
  }, value);
}

function getFirstValue(application, paths) {
  const payload = getApplicationPayload(application);

  for (const path of paths) {
    const directValue = getValueAtPath(application, path);

    if (
      directValue !== null &&
      directValue !== undefined &&
      (typeof directValue !== 'string' ||
        directValue.trim() !== '')
    ) {
      return directValue;
    }

    const payloadValue = getValueAtPath(payload, path);

    if (
      payloadValue !== null &&
      payloadValue !== undefined &&
      (typeof payloadValue !== 'string' ||
        payloadValue.trim() !== '')
    ) {
      return payloadValue;
    }
  }

  return undefined;
}

function getApplicant(application) {
  return (
    getFirstValue(application, ['applicant']) ??
    getFirstValue(application, ['agent']) ??
    getFirstValue(application, ['organization']) ??
    {}
  );
}

function getNpn(application) {
  const applicant = getApplicant(application);

  return normalizeOptionalIdentifier(
    applicant.npn ??
      getFirstValue(application, ['npn', 'licensing.npn']),
  );
}

function getCompany(application) {
  return normalizeCompany(
    getFirstValue(application, [
      'company',
      'carrier',
      'carrierCode',
    ]),
  );
}

function getCarrierCode(application) {
  const company = getCompany(application);

  return (
    normalizeOptionalIdentifier(
      getFirstValue(application, ['carrierCode']),
    ) ??
    (company === 'WilliamPenn'
      ? 'WILLIAM_PENN'
      : company === 'Banner'
        ? 'BANNER'
        : undefined)
  );
}

function getGaCode(application) {
  return normalizeOptionalIdentifier(
    getFirstValue(application, ['gaCode', 'hierarchy.gaCode']),
  );
}

function getContractType(application) {
  return normalizeOptionalIdentifier(
    getFirstValue(application, [
      'contractType',
      'contract.type',
    ]),
  );
}

function getContractLevel(application) {
  return getFirstValue(application, [
    'level',
    'contract.level',
    'commission.level',
  ]);
}

function getAgencyType(application) {
  return normalizeOptionalIdentifier(
    getFirstValue(application, [
      'agencyType',
      'agency.type',
    ]),
  );
}

function getTrackingId(application) {
  return normalizeOptionalIdentifier(
    getFirstValue(application, ['trackingId']),
  );
}

function getApplicationId(application) {
  return normalizeOptionalIdentifier(
    getFirstValue(application, ['applicationId', 'id']),
  );
}

function getRequestedAppointmentStates(application) {
  const states = getFirstValue(application, [
    'appointment.states',
    'appointmentStates',
    'licensing.appointmentStates',
  ]);
  const fallbackState = getFirstValue(application, [
    'licensing.residentState',
    'applicant.residenceState',
    'agent.residenceState',
    'residenceState',
  ]);
  const values = Array.isArray(states)
    ? states
    : states === undefined
      ? fallbackState === undefined
        ? []
        : [fallbackState]
      : [states];

  return [
    ...new Set(
      values
        .map((state) => normalizeOptionalIdentifier(state)?.toUpperCase())
        .filter(Boolean),
    ),
  ];
}

function isCorporateApplication(application) {
  const contractType = normalizeToken(getContractType(application));
  const applicant = getApplicant(application);

  return (
    normalizeToken(applicant.type) === 'organization' ||
    Boolean(normalizeOptionalIdentifier(applicant.legalName)) ||
    ['agency', 'corporate', 'entity', 'organization'].includes(
      contractType,
    )
  );
}

function isRegisteredRepresentative(application) {
  const contractType = normalizeToken(getContractType(application));
  const journeyType = normalizeToken(
    getFirstValue(application, ['journeyType']),
  );

  return (
    ['registeredrep', 'registeredrepresentative'].includes(
      contractType,
    ) ||
    ['registeredrep', 'registeredrepresentative'].includes(
      journeyType,
    )
  );
}

function isInProgressRecord(record) {
  if (!isObject(record)) {
    return false;
  }

  const status = normalizeIdentifierForLookup(
    record.status ?? record.workflowStage,
  );

  if (!status) {
    return true;
  }

  return !TERMINAL_APPLICATION_STATUSES.has(status);
}

function sameIdentifier(left, right) {
  const normalizedLeft = normalizeIdentifierForLookup(left);
  const normalizedRight = normalizeIdentifierForLookup(right);

  return Boolean(
    normalizedLeft &&
      normalizedRight &&
      normalizedLeft === normalizedRight,
  );
}

function recordMatchesApplication(record, application) {
  const currentApplicationId = getApplicationId(application);
  const currentTrackingId = getTrackingId(application);

  return (
    sameIdentifier(record.applicationId, currentApplicationId) ||
    sameIdentifier(record.trackingId, currentTrackingId) ||
    sameIdentifier(record.id, currentApplicationId)
  );
}

function findRecordNpn(record) {
  return normalizeOptionalIdentifier(
    record.applicant?.npn ??
      record.agent?.npn ??
      record.applicationPayload?.applicant?.npn ??
      record.applicationPayload?.agent?.npn ??
      record.formState?.applicant?.npn ??
      record.formState?.agent?.npn ??
      record.npn,
  );
}

function getHistoricalAssets(options) {
  return options.historicalAssets ?? getSeeds().historicalAssets;
}

function normalizeAsOf(value, clock) {
  return toIsoTimestamp(value ?? clock());
}

function getReferenceTime(value) {
  return Date.parse(value);
}

function assertCollection(value, description) {
  if (!Array.isArray(value)) {
    throw new TypeError(`${description} must be an array.`);
  }

  return value;
}

function resolveApplicationRecords(options, repository) {
  if (options.applicationRecords !== undefined) {
    return assertCollection(
      options.applicationRecords,
      'Eligibility application records',
    );
  }

  if (options.existingApplications !== undefined) {
    return assertCollection(
      options.existingApplications,
      'Existing applications',
    );
  }

  if (repository && typeof repository.list === 'function') {
    const records = repository.list({ includeCompleted: true });

    return assertCollection(
      records,
      'The application repository result',
    );
  }

  return getSeeds().onboardingRecords;
}

function getActiveHistoricalContracts(application, historicalAssets) {
  const npn = getNpn(application);

  if (!npn) {
    return [];
  }

  return normalizeArray(historicalAssets.contracts).filter(
    (contract) =>
      sameIdentifier(contract.npn, npn) &&
      ['active', 'pending'].includes(
        normalizeIdentifierForLookup(contract.status),
      ),
  );
}

function evaluateCarrierRules(application) {
  const issues = [];
  const company = getCompany(application);
  const agencyType = normalizeToken(getAgencyType(application));
  const level = normalizeToken(getContractLevel(application));

  if (!company) {
    issues.push(
      createIssue({
        code: ELIGIBILITY_CODES.COMPANY_REQUIRED,
        message: 'A carrier company is required.',
        field: 'company',
      }),
    );
  } else if (!SUPPORTED_COMPANIES.includes(company)) {
    issues.push(
      createIssue({
        code: ELIGIBILITY_CODES.CARRIER_UNSUPPORTED,
        message: `The selected carrier is not supported: ${company}.`,
        field: 'company',
      }),
    );
  }

  if (
    company === 'WilliamPenn' &&
    ['nontraditional', 'financialinstitution', 'imobga'].includes(
      agencyType,
    )
  ) {
    issues.push(
      createIssue({
        code:
          ELIGIBILITY_CODES.WILLIAM_PENN_NON_TRADITIONAL_UNSUPPORTED,
        message:
          'William Penn does not support the selected non-traditional agency arrangement.',
        field: 'agencyType',
      }),
    );
  }

  if (
    company === 'WilliamPenn' &&
    ['30', 'agency', 'level30'].includes(level)
  ) {
    issues.push(
      createIssue({
        code: ELIGIBILITY_CODES.WILLIAM_PENN_LEVEL_30_UNSUPPORTED,
        message:
          'William Penn does not support level 30 for this contracting arrangement.',
        field: 'contract.level',
      }),
    );
  }

  return {
    issues,
    derivedValues: {
      company: company ?? null,
      carrierCode: getCarrierCode(application) ?? null,
      carrierEligible: issues.length === 0,
    },
  };
}

function evaluateLicensingHistory(application, historicalAssets, options) {
  const issues = [];
  const npn = getNpn(application);
  const matchingLicenses = npn
    ? normalizeArray(historicalAssets.licenses).filter((license) =>
        sameIdentifier(license.npn, npn),
      )
    : [];
  const activeLicenses = matchingLicenses.filter(
    (license) =>
      normalizeIdentifierForLookup(license.licenseStatus) ===
        'active' &&
      license.eligible !== false &&
      license.identityMatch !== false,
  );

  if (!npn && !isCorporateApplication(application)) {
    issues.push(
      createIssue({
        code: ELIGIBILITY_CODES.NPN_REQUIRED,
        message: 'A national producer number is required.',
        field: 'applicant.npn',
      }),
    );
  } else if (npn && !/^\d{5,10}$/.test(npn)) {
    issues.push(
      createIssue({
        code: ELIGIBILITY_CODES.NPN_INVALID_FORMAT,
        message:
          'The national producer number must contain 5 to 10 digits.',
        field: 'applicant.npn',
      }),
    );
  }

  if (
    options.requireLicensingHistory === true &&
    npn &&
    matchingLicenses.length === 0
  ) {
    issues.push(
      createIssue({
        code: ELIGIBILITY_CODES.NIPR_PRODUCER_NOT_FOUND,
        message:
          'No licensing history was found for the supplied producer.',
        field: 'applicant.npn',
        severity: ELIGIBILITY_SEVERITIES.BLOCKING,
      }),
    );
  }

  matchingLicenses.forEach((license) => {
    normalizeArray(license.validationCodes).forEach((code) => {
      issues.push(
        createIssue({
          code,
          message:
            code === ELIGIBILITY_CODES.LICENSE_EXPIRED
              ? 'The producer license is expired.'
              : code ===
                  ELIGIBILITY_CODES.REQUIRED_LINE_OF_AUTHORITY_MISSING
                ? 'A required line of authority is missing.'
                : code === ELIGIBILITY_CODES.NIPR_IDENTITY_MISMATCH
                  ? 'The supplied identity does not match licensing history.'
                  : 'Licensing history requires review.',
          field: 'licensing',
          severity:
            license.manualReviewRequired === true
              ? ELIGIBILITY_SEVERITIES.BLOCKING
              : undefined,
          metadata: {
            licenseHistoryId: license.licenseHistoryId,
          },
        }),
      );
    });
  });

  return {
    issues,
    derivedValues: {
      npn: npn ?? null,
      licensingHistoryFound: matchingLicenses.length > 0,
      activeLicenseFound: activeLicenses.length > 0,
      licenses: cloneValue(matchingLicenses),
    },
  };
}

function evaluatePrincipalEligibility(application) {
  if (!isCorporateApplication(application)) {
    return {
      issues: [],
      derivedValues: {
        licensedPrincipalRequired: false,
        eligiblePrincipalPresent: null,
      },
    };
  }

  const principals = normalizeArray(
    getFirstValue(application, ['principals']),
  );
  const eligiblePrincipal = principals.find(
    (principal) =>
      isObject(principal) &&
      normalizeOptionalIdentifier(principal.firstName) &&
      normalizeOptionalIdentifier(principal.lastName) &&
      (principal.isLicensedEligible === true ||
        principal.licensedEligible === true ||
        principal.eligible === true),
  );

  return {
    issues: eligiblePrincipal
      ? []
      : [
          createIssue({
            code:
              ELIGIBILITY_CODES.CORPORATE_LICENSED_PRINCIPAL_REQUIRED,
            message:
              'A corporate contract requires at least one licensed and eligible principal.',
            field: 'principals',
          }),
        ],
    derivedValues: {
      licensedPrincipalRequired: true,
      eligiblePrincipalPresent: Boolean(eligiblePrincipal),
      eligiblePrincipal: eligiblePrincipal
        ? cloneValue(eligiblePrincipal)
        : null,
    },
  };
}

function evaluateCommissionRules(application) {
  const issues = [];
  const commissionSchedule = normalizeToken(
    getFirstValue(application, [
      'commissionSchedule',
      'commission.schedule',
      'contract.commissionSchedule',
    ]),
  );
  const advanceCommission =
    getFirstValue(application, [
      'advanceCommission',
      'commission.advanceCommission',
      'contract.advanceCommission',
    ]) === true;
  const residenceState = normalizeOptionalIdentifier(
    getFirstValue(application, [
      'licensing.residentState',
      'applicant.residenceState',
      'agent.residenceState',
      'residenceState',
    ]),
  )?.toUpperCase();
  const errorsAndOmissions = getFirstValue(application, [
    'errorsAndOmissions',
    'eAndO',
  ]);
  const eoRequired =
    advanceCommission || ['RI', 'UT'].includes(residenceState);
  const eoSatisfied =
    !eoRequired ||
    Boolean(
      normalizeOptionalIdentifier(errorsAndOmissions?.policyNumber) ||
        ['active', 'approved', 'verified'].includes(
          normalizeIdentifierForLookup(errorsAndOmissions?.status),
        ),
    );

  if (commissionSchedule === 'abnca' && advanceCommission) {
    issues.push(
      createIssue({
        code: ELIGIBILITY_CODES.ABNCA_NO_ADVANCE,
        message: 'ABNCA prohibits advance commission.',
        field: 'contract.advanceCommission',
      }),
    );
  }

  if (!eoSatisfied) {
    issues.push(
      createIssue({
        code: ELIGIBILITY_CODES.EO_REQUIRED,
        message:
          'Errors and omissions coverage is required for the selected contracting options.',
        field: 'errorsAndOmissions.policyNumber',
      }),
    );
  }

  return {
    issues,
    derivedValues: {
      commissionSchedule:
        getFirstValue(application, [
          'commissionSchedule',
          'commission.schedule',
          'contract.commissionSchedule',
        ]) ?? null,
      advanceCommission,
      errorsAndOmissionsRequired: eoRequired,
      errorsAndOmissionsSatisfied: eoSatisfied,
    },
  };
}

function evaluateHierarchy(application, historicalAssets) {
  const gaCode = getGaCode(application);
  const carrierCode = getCarrierCode(application);
  const company = getCompany(application);
  const issues = [];

  if (!gaCode) {
    issues.push(
      createIssue({
        code: ELIGIBILITY_CODES.GA_CODE_REQUIRED,
        message: 'A general agency code is required.',
        field: 'gaCode',
      }),
    );

    return {
      issues,
      derivedValues: {
        hierarchyResolved: false,
        hierarchy: null,
      },
    };
  }

  const hierarchy = normalizeArray(historicalAssets.uplines).find(
    (upline) =>
      sameIdentifier(upline.gaCode, gaCode) &&
      (sameIdentifier(upline.carrierCode, carrierCode) ||
        sameIdentifier(upline.company, company)),
  );

  if (!hierarchy) {
    issues.push(
      createIssue({
        code: ELIGIBILITY_CODES.HIERARCHY_NOT_RESOLVED,
        message:
          'The contracting hierarchy could not be resolved for the selected general agency.',
        field: 'hierarchy',
      }),
    );
  } else {
    normalizeArray(hierarchy.validationCodes).forEach((code) => {
      issues.push(
        createIssue({
          code,
          message:
            code === ELIGIBILITY_CODES.HIERARCHY_NOT_RESOLVED
              ? 'The contracting hierarchy could not be resolved.'
              : 'The selected contracting hierarchy is not eligible.',
          field: 'hierarchy',
          severity:
            hierarchy.manualReviewRequired === true
              ? ELIGIBILITY_SEVERITIES.BLOCKING
              : undefined,
          metadata: {
            uplineHistoryId: hierarchy.uplineHistoryId,
          },
        }),
      );
    });

    if (hierarchy.eligible === false && issues.length === 0) {
      issues.push(
        createIssue({
          code: ELIGIBILITY_CODES.HIERARCHY_NOT_ELIGIBLE,
          message: 'The selected contracting hierarchy is not eligible.',
          field: 'hierarchy',
        }),
      );
    }
  }

  return {
    issues,
    derivedValues: {
      hierarchyResolved: Boolean(hierarchy),
      hierarchyEligible: hierarchy?.eligible ?? false,
      hierarchy: hierarchy ? cloneValue(hierarchy) : null,
    },
  };
}

function evaluateAssignee(application, historicalAssets) {
  const trackingId = getTrackingId(application);
  const applicationId = getApplicationId(application);
  const assignee = normalizeArray(historicalAssets.assignees)
    .filter(
      (candidate) =>
        candidate.status === 'active' &&
        (sameIdentifier(candidate.trackingId, trackingId) ||
          sameIdentifier(candidate.applicationId, applicationId)),
    )
    .sort(
      (left, right) =>
        Date.parse(right.assignedAt) - Date.parse(left.assignedAt),
    )[0];

  return {
    issues: [],
    derivedValues: {
      assignee: assignee
        ? {
            userId: assignee.userId,
            group: assignee.group,
            assignmentReason: assignee.assignmentReason,
            assignedAt: assignee.assignedAt,
          }
        : null,
    },
  };
}

function evaluateDualContracting(application, historicalAssets) {
  const contracts = getActiveHistoricalContracts(
    application,
    historicalAssets,
  );
  const company = getCompany(application);
  const sameCarrierContracts = contracts.filter(
    (contract) =>
      sameIdentifier(contract.company, company) ||
      sameIdentifier(contract.carrierCode, getCarrierCode(application)),
  );
  const otherCarrierContracts = contracts.filter(
    (contract) => !sameCarrierContracts.includes(contract),
  );
  const issues = [];

  if (sameCarrierContracts.length > 0) {
    issues.push(
      createIssue({
        code: ELIGIBILITY_CODES.EXISTING_ACTIVE_CONTRACT,
        message:
          'An active or pending contract already exists for this producer and carrier.',
        field: 'contract',
        severity: ELIGIBILITY_SEVERITIES.WARNING,
        metadata: {
          historicalContractIds: sameCarrierContracts.map(
            (contract) => contract.historicalContractId,
          ),
        },
      }),
    );
  }

  if (otherCarrierContracts.length > 0) {
    issues.push(
      createIssue({
        code: ELIGIBILITY_CODES.DUAL_CONTRACT_DETECTED,
        message:
          'Existing contracts were found for this producer with another carrier.',
        field: 'contract',
        severity: ELIGIBILITY_SEVERITIES.INFO,
        metadata: {
          historicalContractIds: otherCarrierContracts.map(
            (contract) => contract.historicalContractId,
          ),
        },
      }),
    );
  }

  return {
    issues,
    derivedValues: {
      existingContracts: cloneValue(contracts),
      existingCarrierContract: sameCarrierContracts.length > 0,
      dualContracting: otherCarrierContracts.length > 0,
    },
  };
}

function evaluateTerminations(application, historicalAssets) {
  const npn = getNpn(application);
  const terminations = npn
    ? normalizeArray(historicalAssets.terminations).filter(
        (termination) => sameIdentifier(termination.npn, npn),
      )
    : [];
  const issues = [];

  terminations.forEach((termination) => {
    const validationCodes = new Set(
      normalizeArray(termination.validationCodes),
    );

    if (
      termination.blocksOnboarding === true ||
      termination.manualReviewRequired === true ||
      termination.forCause === true
    ) {
      validationCodes.add(
        ELIGIBILITY_CODES.TERMINATION_HISTORY_REVIEW_REQUIRED,
      );
    }

    if (
      termination.forCause === true &&
      normalizeIdentifierForLookup(termination.terminationCode) === 'cc'
    ) {
      validationCodes.add(
        ELIGIBILITY_CODES.FOR_CAUSE_TERMINATION_BLOCK,
      );
    }

    if (
      normalizeIdentifierForLookup(termination.terminationCode) === 'su'
    ) {
      validationCodes.add(
        ELIGIBILITY_CODES.SUITABILITY_TERMINATION_BLOCK,
      );
    }

    validationCodes.forEach((code) => {
      issues.push(
        createIssue({
          code,
          message:
            code === ELIGIBILITY_CODES.FOR_CAUSE_TERMINATION_BLOCK
              ? 'A for-cause termination blocks onboarding.'
              : code ===
                  ELIGIBILITY_CODES.SUITABILITY_TERMINATION_BLOCK
                ? 'Suitability termination history blocks onboarding.'
                : 'Termination history requires manual review.',
          field: 'terminationHistory',
          severity:
            termination.blocksOnboarding === true
              ? ELIGIBILITY_SEVERITIES.BLOCKING
              : ELIGIBILITY_SEVERITIES.WARNING,
          metadata: {
            terminationId: termination.terminationId,
            effectiveDate: termination.effectiveDate,
            terminationCode: termination.terminationCode,
          },
        }),
      );
    });
  });

  return {
    issues,
    derivedValues: {
      terminationHistory: cloneValue(terminations),
      terminationRestriction: terminations.some(
        (termination) => termination.blocksOnboarding === true,
      ),
    },
  };
}

function evaluateBackgroundReuse(
  application,
  historicalAssets,
  asOf,
  reuseWindowDays,
) {
  if (isRegisteredRepresentative(application)) {
    return {
      issues: [],
      derivedValues: {
        background: {
          decision: BACKGROUND_DECISIONS.NOT_REQUIRED,
          required: false,
          reused: false,
          reason: 'REGISTERED_REP_EXEMPT',
          linkedCheckId: null,
        },
      },
    };
  }

  const npn = getNpn(application);
  const referenceTime = getReferenceTime(asOf);
  const checks = npn
    ? normalizeArray(historicalAssets.backgroundChecks).filter(
        (check) => sameIdentifier(check.npn, npn),
      )
    : [];
  const reusableCheck = checks
    .filter((check) => {
      if (
        check.eligibleForReuse !== true ||
        normalizeIdentifierForLookup(check.disposition) !== 'clear' ||
        !check.completedAt
      ) {
        return false;
      }

      const reusableThrough =
        check.reusableThrough ?? check.expiresAt;

      if (reusableThrough) {
        return (
          Date.parse(check.completedAt) <= referenceTime &&
          referenceTime <= Date.parse(reusableThrough)
        );
      }

      return calculateReusePeriod(
        check.completedAt,
        reuseWindowDays,
        asOf,
      ).eligibleForReuse;
    })
    .sort(
      (left, right) =>
        Date.parse(right.completedAt) - Date.parse(left.completedAt),
    )[0];

  if (reusableCheck) {
    return {
      issues: [
        createIssue({
          code: ELIGIBILITY_CODES.BACKGROUND_REUSE_AVAILABLE,
          message:
            'A recent clear background check can be reused.',
          field: 'background',
          severity: ELIGIBILITY_SEVERITIES.INFO,
          metadata: {
            backgroundCheckId: reusableCheck.backgroundCheckId,
          },
        }),
      ],
      derivedValues: {
        background: {
          decision: BACKGROUND_DECISIONS.REUSED,
          required: false,
          reused: true,
          reason: 'RECENT_CLEAR_REUSED',
          linkedCheckId: reusableCheck.backgroundCheckId,
          completedAt: reusableCheck.completedAt,
          reusableThrough:
            reusableCheck.reusableThrough ??
            reusableCheck.expiresAt ??
            calculateReusePeriod(
              reusableCheck.completedAt,
              reuseWindowDays,
              asOf,
            ).reusableThrough,
        },
      },
    };
  }

  return {
    issues: [],
    derivedValues: {
      background: {
        decision: BACKGROUND_DECISIONS.REQUIRED,
        required: true,
        reused: false,
        reason: 'DEFAULT_REQUIRED',
        linkedCheckId: null,
      },
    },
  };
}

function evaluateAppointmentReuse(application, historicalAssets) {
  const npn = getNpn(application);
  const company = getCompany(application);
  const carrierCode = getCarrierCode(application);
  const requestedStates = getRequestedAppointmentStates(application);
  const appointments = npn
    ? normalizeArray(historicalAssets.appointments).filter(
        (appointment) =>
          sameIdentifier(appointment.npn, npn) &&
          (sameIdentifier(appointment.company, company) ||
            sameIdentifier(appointment.carrierCode, carrierCode)),
      )
    : [];
  const reusableAppointments = appointments.filter(
    (appointment) =>
      appointment.eligibleForReuse === true &&
      ['active', 'accepted'].includes(
        normalizeIdentifierForLookup(appointment.status),
      ),
  );
  const reusableStates = new Set(
    reusableAppointments.map((appointment) =>
      String(appointment.state).toUpperCase(),
    ),
  );
  const missingStates = requestedStates.filter(
    (state) => !reusableStates.has(state),
  );
  const fullyReusable =
    requestedStates.length > 0 && missingStates.length === 0;
  const partiallyReusable =
    reusableAppointments.length > 0 && missingStates.length > 0;
  const decision = fullyReusable
    ? APPOINTMENT_DECISIONS.REUSED
    : partiallyReusable
      ? APPOINTMENT_DECISIONS.PARTIALLY_REUSED
      : APPOINTMENT_DECISIONS.REQUIRED;

  return {
    issues:
      fullyReusable || partiallyReusable
        ? [
            createIssue({
              code: ELIGIBILITY_CODES.APPOINTMENT_REUSE_AVAILABLE,
              message: fullyReusable
                ? 'Existing active appointments can be reused.'
                : 'Some existing active appointments can be reused.',
              field: 'appointment',
              severity: ELIGIBILITY_SEVERITIES.INFO,
              metadata: {
                appointmentIds: reusableAppointments.map(
                  (appointment) => appointment.appointmentId,
                ),
                reusableStates: [...reusableStates],
                missingStates,
              },
            }),
          ]
        : [],
    derivedValues: {
      appointment: {
        decision,
        required: !fullyReusable,
        reused: fullyReusable || partiallyReusable,
        requestedStates,
        reusableStates: [...reusableStates],
        missingStates,
        linkedAppointments: cloneValue(reusableAppointments),
      },
    },
  };
}

function evaluateAgentCode(application, historicalAssets) {
  const npn = getNpn(application);
  const company = getCompany(application);
  const generatedCodes = normalizeArray(historicalAssets.generatedCodes);
  const existingForProducer = generatedCodes.find(
    (entry) =>
      npn &&
      sameIdentifier(entry.npn, npn) &&
      sameIdentifier(entry.company, company) &&
      normalizeOptionalIdentifier(entry.generatedCode),
  );

  if (existingForProducer) {
    return {
      issues: [],
      derivedValues: {
        agentCode: {
          code: existingForProducer.generatedCode,
          generated: false,
          reused: true,
          manualReviewRequired: false,
          collisionDetected: false,
          sourceGeneratedCodeId:
            existingForProducer.generatedCodeId,
        },
      },
    };
  }

  const applicant = getApplicant(application);
  const discriminator =
    getApplicationId(application) ??
    getTrackingId(application) ??
    npn;

  if (
    !normalizeOptionalIdentifier(
      applicant.firstName ?? applicant.contactFirstName,
    ) ||
    !normalizeOptionalIdentifier(
      applicant.lastName ?? applicant.contactLastName,
    ) ||
    !discriminator
  ) {
    return {
      issues: [
        createIssue({
          code: ELIGIBILITY_CODES.MANUAL_AGENT_CODE_REQUIRED,
          message:
            'An agent code cannot be generated without complete applicant identity.',
          field: 'agentCode',
          severity: ELIGIBILITY_SEVERITIES.WARNING,
        }),
      ],
      derivedValues: {
        agentCode: {
          code: null,
          generated: false,
          reused: false,
          manualReviewRequired: true,
          collisionDetected: false,
        },
      },
    };
  }

  const generatedCode = generateAgentCode(
    {
      ...applicant,
      discriminator,
    },
  );
  const collision = generatedCodes.find(
    (entry) =>
      entry.generatedCode &&
      sameIdentifier(entry.generatedCode, generatedCode) &&
      (!npn || !sameIdentifier(entry.npn, npn)),
  );

  return {
    issues: collision
      ? [
          createIssue({
            code: ELIGIBILITY_CODES.AGENT_CODE_COLLISION,
            message:
              'The generated agent code is already assigned to another producer.',
            field: 'agentCode',
            severity: ELIGIBILITY_SEVERITIES.WARNING,
            metadata: {
              generatedCode,
              conflictingGeneratedCodeId:
                collision.generatedCodeId,
            },
          }),
          createIssue({
            code: ELIGIBILITY_CODES.MANUAL_AGENT_CODE_REQUIRED,
            message:
              'A manual agent code is required because the generated code conflicts.',
            field: 'agentCode',
            severity: ELIGIBILITY_SEVERITIES.WARNING,
          }),
        ]
      : [],
    derivedValues: {
      agentCode: {
        code: collision ? null : generatedCode,
        generated: !collision,
        reused: false,
        manualReviewRequired: Boolean(collision),
        collisionDetected: Boolean(collision),
        conflictingCode: collision?.generatedCode ?? null,
      },
    },
  };
}

function mergeDerivedValues(target, source) {
  Object.entries(source).forEach(([key, value]) => {
    if (isObject(value) && isObject(target[key])) {
      target[key] = mergeDerivedValues(
        { ...target[key] },
        value,
      );
      return;
    }

    target[key] = cloneValue(value);
  });

  return target;
}

function getProviderValidationCodes(check) {
  return [
    ...new Set([
      ...normalizeArray(check.validationCodes),
      ...normalizeArray(check.response?.validationCodes),
      ...normalizeArray(check.result?.validationCodes),
    ]),
  ];
}

function providerCodeToMethod(providerCode) {
  const normalizedCode = normalizeToken(providerCode);

  if (normalizedCode === 'nipr') {
    return 'runNiprCheck';
  }

  if (normalizedCode === 'giact') {
    return 'runGiactCheck';
  }

  if (normalizedCode === 'amldemo' || normalizedCode === 'aml') {
    return 'runAmlCheck';
  }

  if (normalizedCode === 'limra') {
    return 'runLimraCheck';
  }

  if (normalizedCode === 'reged') {
    return 'runRegEdCheck';
  }

  if (normalizedCode === 'big' || normalizedCode === 'background') {
    return 'runBackgroundFlow';
  }

  if (
    normalizedCode === 'sirconvertafore' ||
    normalizedCode === 'sircon' ||
    normalizedCode === 'vertafore'
  ) {
    return 'runAppointmentFlow';
  }

  if (normalizedCode === 'dtcc') {
    return 'runDtccRules';
  }

  if (normalizedCode === 'ethos') {
    return 'runEthosRules';
  }

  if (normalizedCode === 'horizon') {
    return 'runHorizonJitRouting';
  }

  if (normalizedCode === 'docusign') {
    return 'runElectronicSignatureFlow';
  }

  if (normalizedCode === 'verint') {
    return 'runVerintCheck';
  }

  return 'runProviderCheck';
}

function resolveProviderCodes(options, derivedValues) {
  if (Array.isArray(options.providerCodes)) {
    return [...new Set(options.providerCodes)];
  }

  if (isObject(options.providerScenarios)) {
    return Object.keys(options.providerScenarios);
  }

  if (options.includeProviders !== true) {
    return [];
  }

  const providerCodes = [...DEFAULT_PROVIDER_CODES];

  if (derivedValues.background?.required === true) {
    providerCodes.push(SIMULATED_PROVIDER_CODES.BIG);
  }

  if (derivedValues.appointment?.required === true) {
    providerCodes.push(SIMULATED_PROVIDER_CODES.SIRCON_VERTAFORE);
  }

  if (isRegisteredRepresentative(options.application)) {
    providerCodes.push(SIMULATED_PROVIDER_CODES.DTCC);
  }

  return [...new Set(providerCodes)];
}

function assertOptionalDependency(
  dependency,
  methods,
  description,
) {
  if (dependency === undefined || dependency === null) {
    return null;
  }

  if (
    !isObject(dependency) ||
    methods.some(
      (method) => typeof dependency[method] !== 'function',
    )
  ) {
    throw createEligibilityError(
      ELIGIBILITY_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
      `${description} must provide ${methods.join(', ')}.`,
      null,
    );
  }

  return dependency;
}

function normalizeRunArguments(options) {
  return assertOptions(options, 'Eligibility run options');
}

/**
 * Evaluates duplicate and in-progress application conflicts.
 *
 * @param {object} application Application to evaluate.
 * @param {object[]} records Existing application records.
 * @returns {object} Duplicate evaluation result.
 */
export function evaluateDuplicateInProgress(
  application,
  records = getSeeds().onboardingRecords,
) {
  if (!isObject(application)) {
    throw new TypeError(
      'An onboarding application must be an object.',
    );
  }

  assertCollection(records, 'Duplicate application records');

  const npn = getNpn(application);
  const company = getCompany(application);
  const submissionId = normalizeOptionalIdentifier(
    getFirstValue(application, ['submissionId']),
  );
  const duplicate = records.find((record) => {
    if (
      !isObject(record) ||
      recordMatchesApplication(record, application) ||
      !isInProgressRecord(record)
    ) {
      return false;
    }

    const recordNpn = findRecordNpn(record);
    const recordCompany = normalizeCompany(
      record.company ?? record.carrierCode,
    );
    const recordSubmissionId = normalizeOptionalIdentifier(
      record.submissionId ??
        record.applicationPayload?.submissionId ??
        record.formState?.submissionId,
    );
    const producerMatches =
      Boolean(npn && recordNpn && sameIdentifier(npn, recordNpn)) ||
      Boolean(
        submissionId &&
          recordSubmissionId &&
          sameIdentifier(submissionId, recordSubmissionId),
      );
    const companyMatches =
      !company ||
      !recordCompany ||
      sameIdentifier(company, recordCompany);

    return producerMatches && companyMatches;
  });

  return Object.freeze({
    duplicate: Boolean(duplicate),
    inProgress: Boolean(duplicate),
    applicationId: duplicate?.applicationId ?? null,
    trackingId: duplicate?.trackingId ?? null,
    status: duplicate?.status ?? null,
    record: duplicate ? cloneValue(duplicate) : null,
    issues: Object.freeze(
      duplicate
        ? [
            createIssue({
              code:
                ELIGIBILITY_CODES.DUPLICATE_APPLICATION_IN_PROGRESS,
              message:
                'An onboarding application for this producer and carrier is already in progress.',
              field: 'applicant.npn',
              severity: ELIGIBILITY_SEVERITIES.WARNING,
              metadata: {
                duplicateApplicationId:
                  duplicate.applicationId ?? null,
                duplicateTrackingId: duplicate.trackingId ?? null,
              },
            }),
          ]
        : [],
    ),
  });
}

/**
 * Evaluates blocking and reviewable termination history.
 *
 * @param {object} application Application to evaluate.
 * @param {object[]} terminations Historical terminations.
 * @returns {object} Termination evaluation result.
 */
export function evaluateTerminationRestriction(
  application,
  terminations = getSeeds().terminations,
) {
  if (!isObject(application)) {
    throw new TypeError(
      'An onboarding application must be an object.',
    );
  }

  assertCollection(terminations, 'Historical terminations');

  const result = evaluateTerminations(application, {
    terminations,
  });
  const blocked = result.derivedValues.terminationRestriction;

  return Object.freeze({
    blocked,
    manualReviewRequired: result.issues.some((issue) =>
      MANUAL_REVIEW_CODES.has(issue.code),
    ),
    terminations: Object.freeze(
      result.derivedValues.terminationHistory,
    ),
    issues: Object.freeze(result.issues),
    validationCodes: Object.freeze([
      ...new Set(result.issues.map((issue) => issue.code)),
    ]),
  });
}

/**
 * Evaluates reusable background-check history.
 *
 * @param {object} application Application to evaluate.
 * @param {object[]} backgroundChecks Historical checks.
 * @param {{
 *   asOf?: Date | string | number,
 *   reuseWindowDays?: number
 * }} [options] Reuse options.
 * @returns {object} Background decision.
 */
export function evaluateBackgroundRequirement(
  application,
  backgroundChecks = getSeeds().backgroundChecks,
  options = {},
) {
  if (!isObject(application)) {
    throw new TypeError(
      'An onboarding application must be an object.',
    );
  }

  assertCollection(backgroundChecks, 'Historical background checks');

  const normalizedOptions = assertOptions(
    options,
    'Background eligibility options',
  );
  const reuseWindowDays =
    normalizedOptions.reuseWindowDays ??
    DEFAULT_BACKGROUND_REUSE_WINDOW_DAYS;

  if (!Number.isInteger(reuseWindowDays) || reuseWindowDays < 0) {
    throw new RangeError(
      'The background reuse window must be a nonnegative integer.',
    );
  }

  const result = evaluateBackgroundReuse(
    application,
    { backgroundChecks },
    toIsoTimestamp(normalizedOptions.asOf ?? Date.now()),
    reuseWindowDays,
  );

  return Object.freeze({
    ...result.derivedValues.background,
    issues: Object.freeze(result.issues),
  });
}

/**
 * Evaluates reusable carrier appointment history.
 *
 * @param {object} application Application to evaluate.
 * @param {object[]} appointments Historical appointments.
 * @returns {object} Appointment decision.
 */
export function evaluateAppointmentRequirement(
  application,
  appointments = getSeeds().appointments,
) {
  if (!isObject(application)) {
    throw new TypeError(
      'An onboarding application must be an object.',
    );
  }

  assertCollection(appointments, 'Historical appointments');

  const result = evaluateAppointmentReuse(application, {
    appointments,
  });

  return Object.freeze({
    ...result.derivedValues.appointment,
    issues: Object.freeze(result.issues),
  });
}

/**
 * Executes carrier, licensing, contracting, history, reuse, provider, and
 * code-generation eligibility checks.
 */
export class EligibilityService {
  /**
   * @param {{
   *   applicationRepository?: object,
   *   validationRepository?: object,
   *   providerSimulationService?: object,
   *   configResolver?: object | false,
   *   auditService?: object | false,
   *   historicalAssets?: object,
   *   clock?: () => Date | string | number,
   *   backgroundReuseWindowDays?: number,
   *   includeProviders?: boolean
   * }} [options] Eligibility service options.
   */
  constructor(options = {}) {
    const normalizedOptions = assertOptions(
      options,
      'Eligibility service options',
    );

    if (
      normalizedOptions.clock !== undefined &&
      typeof normalizedOptions.clock !== 'function'
    ) {
      throw new TypeError(
        'The eligibility service clock must be a function.',
      );
    }

    const reuseWindowDays =
      normalizedOptions.backgroundReuseWindowDays ??
      normalizedOptions.historicalAssets?.defaults
        ?.backgroundReuseWindowDays ??
      getSeeds().historicalAssets.defaults
        .backgroundReuseWindowDays ??
      DEFAULT_BACKGROUND_REUSE_WINDOW_DAYS;

    if (
      !Number.isInteger(reuseWindowDays) ||
      reuseWindowDays < 0
    ) {
      throw new RangeError(
        'The background reuse window must be a nonnegative integer.',
      );
    }

    this.clock = normalizedOptions.clock ?? (() => new Date());
    this.historicalAssets =
      normalizedOptions.historicalAssets ??
      getSeeds().historicalAssets;
    this.applicationRepository = assertOptionalDependency(
      normalizedOptions.applicationRepository,
      ['list'],
      'The eligibility application repository',
    );
    this.validationRepository = assertOptionalDependency(
      normalizedOptions.validationRepository,
      ['setEligibilityOutcome'],
      'The eligibility validation repository',
    );
    this.providerSimulationService =
      normalizedOptions.providerSimulationService === undefined
        ? createProviderSimulationService({
            persist: false,
            clock: this.clock,
          })
        : assertOptionalDependency(
            normalizedOptions.providerSimulationService,
            [],
            'The provider simulation service',
          );
    this.configResolver =
      normalizedOptions.configResolver === false
        ? null
        : normalizedOptions.configResolver ??
          createGAConfigResolver();
    this.auditService =
      normalizedOptions.auditService === false
        ? null
        : normalizedOptions.auditService ?? null;
    this.backgroundReuseWindowDays = reuseWindowDays;
    this.includeProviders =
      normalizedOptions.includeProviders ?? false;
  }

  /**
   * Runs the complete eligibility pipeline.
   *
   * @param {object} application Application or normalized payload.
   * @param {{
   *   applicationRecords?: object[],
   *   existingApplications?: object[],
   *   historicalAssets?: object,
   *   asOf?: Date | string | number,
   *   includeProviders?: boolean,
   *   providerCodes?: string[],
   *   providerScenarios?: Record<string, string>,
   *   providerOptions?: Record<string, object>,
   *   requireLicensingHistory?: boolean,
   *   persist?: boolean,
   *   actor?: object,
   *   strictProviders?: boolean,
   *   strictConfiguration?: boolean
   * }} [options] Eligibility options.
   * @returns {object} Eligibility result.
   */
  runEligibilityChecks(application, options = {}) {
    if (!isObject(application)) {
      throw createEligibilityError(
        ELIGIBILITY_SERVICE_ERROR_CODES.INVALID_APPLICATION,
        'An onboarding application must be an object.',
        null,
      );
    }

    const normalizedOptions = normalizeRunArguments(options);
    const historicalAssets = getHistoricalAssets({
      historicalAssets:
        normalizedOptions.historicalAssets ??
        this.historicalAssets,
    });
    const asOf = normalizeAsOf(
      normalizedOptions.asOf,
      this.clock,
    );
    const applicationRecords = resolveApplicationRecords(
      normalizedOptions,
      this.applicationRepository,
    );
    const issues = [];
    const derivedValues = {};
    const providerChecks = {};
    const providerErrors = {};
    const duplicateResult = evaluateDuplicateInProgress(
      application,
      applicationRecords,
    );
    const evaluations = [
      evaluateCarrierRules(application),
      evaluateLicensingHistory(
        application,
        historicalAssets,
        normalizedOptions,
      ),
      evaluatePrincipalEligibility(application),
      evaluateCommissionRules(application),
      evaluateHierarchy(application, historicalAssets),
      evaluateAssignee(application, historicalAssets),
      evaluateDualContracting(application, historicalAssets),
      evaluateTerminations(application, historicalAssets),
      evaluateBackgroundReuse(
        application,
        historicalAssets,
        asOf,
        this.backgroundReuseWindowDays,
      ),
      evaluateAppointmentReuse(application, historicalAssets),
      evaluateAgentCode(application, historicalAssets),
    ];

    issues.push(...duplicateResult.issues);
    mergeDerivedValues(derivedValues, {
      duplicate: {
        found: duplicateResult.duplicate,
        applicationId: duplicateResult.applicationId,
        trackingId: duplicateResult.trackingId,
        status: duplicateResult.status,
      },
    });

    evaluations.forEach((evaluation) => {
      issues.push(...evaluation.issues);
      mergeDerivedValues(
        derivedValues,
        evaluation.derivedValues,
      );
    });

    const configuration = this.resolveConfiguration(
      application,
      normalizedOptions,
      issues,
    );

    if (configuration) {
      derivedValues.configuration = configuration;
    }

    const providerCodes = resolveProviderCodes(
      {
        ...normalizedOptions,
        application,
        includeProviders:
          normalizedOptions.includeProviders ??
          this.includeProviders,
      },
      derivedValues,
    );

    providerCodes.forEach((providerCode) => {
      const providerResult = this.runProviderCheck(
        providerCode,
        application,
        normalizedOptions,
      );

      if (providerResult.ok) {
        providerChecks[providerCode] = providerResult.check;

        getProviderValidationCodes(providerResult.check).forEach(
          (code) => {
            issues.push(
              createIssue({
                code,
                message:
                  providerResult.check.description ??
                  `${providerCode} eligibility check returned ${providerResult.check.outcome ?? providerResult.check.status}.`,
                field: 'providerChecks',
                severity:
                  providerResult.check.manualReviewRequired === true
                    ? ELIGIBILITY_SEVERITIES.WARNING
                    : undefined,
                metadata: {
                  providerCode,
                  checkId:
                    providerResult.check.checkId ?? null,
                },
              }),
            );
          },
        );

        if (
          providerResult.check.manualReviewRequired === true &&
          getProviderValidationCodes(providerResult.check).length === 0
        ) {
          issues.push(
            createIssue({
              code: ELIGIBILITY_CODES.PROVIDER_CHECK_FAILED,
              message: `${providerCode} requires manual review.`,
              field: 'providerChecks',
              severity: ELIGIBILITY_SEVERITIES.WARNING,
              metadata: {
                providerCode,
                checkId:
                  providerResult.check.checkId ?? null,
                manualReviewRequired: true,
              },
            }),
          );
        }
      } else {
        providerErrors[providerCode] = providerResult.error;

        if (normalizedOptions.strictProviders === true) {
          throw createEligibilityError(
            ELIGIBILITY_SERVICE_ERROR_CODES.PROVIDER_CHECK_FAILED,
            `The ${providerCode} eligibility check failed.`,
            {
              providerCode,
              error: providerResult.error,
            },
          );
        }

        issues.push(
          createIssue({
            code: ELIGIBILITY_CODES.PROVIDER_CHECK_FAILED,
            message: `The ${providerCode} eligibility check could not be completed.`,
            field: 'providerChecks',
            severity: ELIGIBILITY_SEVERITIES.WARNING,
            metadata: {
              providerCode,
              errorCode: providerResult.error.code,
              manualReviewRequired: true,
            },
          }),
        );
      }
    });

    const uniqueIssues = deduplicateIssues(issues);
    const blockingIssues = uniqueIssues.filter(
      (issue) =>
        issue.severity === ELIGIBILITY_SEVERITIES.BLOCKING ||
        BLOCKING_CODES.has(issue.code),
    );
    const errorIssues = uniqueIssues.filter(
      (issue) =>
        issue.severity === ELIGIBILITY_SEVERITIES.ERROR,
    );
    const manualReviewRequired = uniqueIssues.some(
      (issue) =>
        MANUAL_REVIEW_CODES.has(issue.code) ||
        issue.metadata?.manualReviewRequired === true,
    );
    const eligible =
      blockingIssues.length === 0 && errorIssues.length === 0;
    const outcome = !eligible
      ? ELIGIBILITY_OUTCOMES.INELIGIBLE
      : manualReviewRequired
        ? ELIGIBILITY_OUTCOMES.MANUAL_REVIEW
        : ELIGIBILITY_OUTCOMES.ELIGIBLE;
    const validationCodes = [
      ...new Set(uniqueIssues.map((issue) => issue.code)),
    ];
    const result = Object.freeze({
      trackingId: getTrackingId(application) ?? null,
      applicationId: getApplicationId(application) ?? null,
      eligible,
      valid: eligible,
      outcome,
      status: outcome,
      manualReviewRequired,
      issues: Object.freeze(uniqueIssues),
      errors: Object.freeze([
        ...blockingIssues,
        ...errorIssues.filter(
          (issue) => !blockingIssues.includes(issue),
        ),
      ]),
      warnings: Object.freeze(
        uniqueIssues.filter((issue) =>
          [
            ELIGIBILITY_SEVERITIES.INFO,
            ELIGIBILITY_SEVERITIES.WARNING,
          ].includes(issue.severity),
        ),
      ),
      validationCodes: Object.freeze(validationCodes),
      derived: cloneValue(derivedValues),
      derivedValues: cloneValue(derivedValues),
      providerChecks: Object.freeze(cloneValue(providerChecks)),
      providerErrors: Object.freeze(cloneValue(providerErrors)),
      checkedAt: asOf,
    });

    if (normalizedOptions.persist === true) {
      this.persistResult(application, result);
    }

    this.appendAuditEvent(application, result, normalizedOptions.actor);

    return result;
  }

  /**
   * Alias for runEligibilityChecks.
   *
   * @param {object} application Application to evaluate.
   * @param {object} [options] Eligibility options.
   * @returns {object} Eligibility result.
   */
  evaluate(application, options = {}) {
    return this.runEligibilityChecks(application, options);
  }

  /**
   * Alias for runEligibilityChecks.
   *
   * @param {object} application Application to evaluate.
   * @param {object} [options] Eligibility options.
   * @returns {object} Eligibility result.
   */
  checkEligibility(application, options = {}) {
    return this.runEligibilityChecks(application, options);
  }

  /**
   * Evaluates duplicate and in-progress applications.
   *
   * @param {object} application Application to evaluate.
   * @param {object[]} [records] Candidate records.
   * @returns {object} Duplicate result.
   */
  evaluateDuplicateInProgress(application, records) {
    return evaluateDuplicateInProgress(
      application,
      records ??
        resolveApplicationRecords({}, this.applicationRepository),
    );
  }

  /**
   * Evaluates termination restrictions.
   *
   * @param {object} application Application to evaluate.
   * @param {object[]} [terminations] Historical terminations.
   * @returns {object} Termination result.
   */
  evaluateTerminationRestriction(application, terminations) {
    return evaluateTerminationRestriction(
      application,
      terminations ?? this.historicalAssets.terminations,
    );
  }

  /**
   * Evaluates reusable background history.
   *
   * @param {object} application Application to evaluate.
   * @param {object} [options] Background options.
   * @returns {object} Background decision.
   */
  evaluateBackgroundRequirement(application, options = {}) {
    return evaluateBackgroundRequirement(
      application,
      this.historicalAssets.backgroundChecks,
      {
        reuseWindowDays: this.backgroundReuseWindowDays,
        ...assertOptions(options, 'Background eligibility options'),
      },
    );
  }

  /**
   * Evaluates reusable appointment history.
   *
   * @param {object} application Application to evaluate.
   * @returns {object} Appointment decision.
   */
  evaluateAppointmentRequirement(application) {
    return evaluateAppointmentRequirement(
      application,
      this.historicalAssets.appointments,
    );
  }

  resolveConfiguration(application, options, issues) {
    if (!this.configResolver || options.resolveConfiguration === false) {
      return null;
    }

    const gaCode = getGaCode(application);

    if (!gaCode) {
      return null;
    }

    const resolve =
      typeof this.configResolver.resolve === 'function'
        ? this.configResolver.resolve.bind(this.configResolver)
        : typeof this.configResolver.resolveConfiguration === 'function'
          ? this.configResolver.resolveConfiguration.bind(
              this.configResolver,
            )
          : undefined;

    if (!resolve) {
      if (options.strictConfiguration === true) {
        throw createEligibilityError(
          ELIGIBILITY_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
          'The GA configuration resolver does not provide resolve.',
          null,
        );
      }

      return null;
    }

    try {
      return resolve(gaCode, {
        carrierCode: getCarrierCode(application),
        journeyType: getFirstValue(application, ['journeyType']),
        state: getFirstValue(application, [
          'licensing.residentState',
          'applicant.residenceState',
          'agent.residenceState',
        ]),
      });
    } catch (error) {
      if (options.strictConfiguration === true) {
        throw error;
      }

      issues.push(
        createIssue({
          code: ELIGIBILITY_CODES.HIERARCHY_NOT_RESOLVED,
          message:
            'The effective general agency configuration could not be resolved.',
          field: 'gaCode',
          severity: ELIGIBILITY_SEVERITIES.WARNING,
          metadata: {
            gaCode,
            errorCode: error?.code ?? null,
            manualReviewRequired: true,
          },
        }),
      );

      return null;
    }
  }

  runProviderCheck(providerCode, application, options) {
    if (!this.providerSimulationService) {
      return {
        ok: false,
        error: {
          code:
            ELIGIBILITY_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
          message: 'The provider simulation service is unavailable.',
        },
      };
    }

    const method = providerCodeToMethod(providerCode);
    const scenario =
      options.providerScenarios?.[providerCode] ??
      options.providerScenarios?.[
        normalizeIdentifierForLookup(providerCode)
      ];
    const runOptions = {
      ...(options.providerOptions?.[providerCode] ?? {}),
      ...(scenario === undefined ? {} : { scenario }),
      persist: options.persistProviderChecks ?? false,
    };

    try {
      const check =
        method === 'runProviderCheck'
          ? this.providerSimulationService.runProviderCheck(
              providerCode,
              application,
              runOptions,
            )
          : this.providerSimulationService[method](
              application,
              runOptions,
            );

      return {
        ok: true,
        check: cloneValue(check),
      };
    } catch (error) {
      return {
        ok: false,
        error: {
          name: error?.name ?? 'Error',
          code:
            error?.code ??
            ELIGIBILITY_SERVICE_ERROR_CODES.PROVIDER_CHECK_FAILED,
          message:
            error?.message ??
            'The provider eligibility check failed.',
          details: cloneValue(error?.details ?? null),
        },
      };
    }
  }

  persistResult(application, result) {
    if (!this.validationRepository) {
      throw createEligibilityError(
        ELIGIBILITY_SERVICE_ERROR_CODES.PERSISTENCE_FAILED,
        'A validation repository is required to persist eligibility.',
        {
          trackingId: getTrackingId(application) ?? null,
        },
      );
    }

    const trackingId = getTrackingId(application);

    if (!trackingId) {
      throw createEligibilityError(
        ELIGIBILITY_SERVICE_ERROR_CODES.PERSISTENCE_FAILED,
        'A tracking identifier is required to persist eligibility.',
        null,
      );
    }

    try {
      this.validationRepository.setEligibilityOutcome(
        trackingId,
        cloneValue(result),
      );

      if (
        typeof this.validationRepository.setProviderCheck ===
        'function'
      ) {
        Object.entries(result.providerChecks).forEach(
          ([providerCode, check]) => {
            this.validationRepository.setProviderCheck(
              trackingId,
              providerCode,
              check,
            );
          },
        );
      }
    } catch (error) {
      throw createEligibilityError(
        ELIGIBILITY_SERVICE_ERROR_CODES.PERSISTENCE_FAILED,
        'Unable to persist the eligibility result.',
        { trackingId },
        error,
      );
    }
  }

  appendAuditEvent(application, result, actor) {
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
      return null;
    }

    try {
      return append(
        {
          trackingId: result.trackingId,
          applicationId: result.applicationId ?? undefined,
          sourceRecordId:
            result.applicationId ??
            result.trackingId ??
            undefined,
          action: 'ELIGIBILITY_EVALUATED',
          summary: 'Onboarding eligibility checks completed.',
          status:
            result.eligible
              ? WORKFLOW_STAGES.APPLICATION_UNDER_REVIEW
              : WORKFLOW_STAGES.MANUAL_EXCEPTION,
          metadata: {
            outcome: result.outcome,
            eligible: result.eligible,
            manualReviewRequired:
              result.manualReviewRequired,
            validationCodes: result.validationCodes,
            providerCodes: Object.keys(result.providerChecks),
          },
          timestamp: result.checkedAt,
        },
        { actor },
      );
    } catch {
      return null;
    }
  }
}

/**
 * Creates an eligibility service.
 *
 * @param {ConstructorParameters<typeof EligibilityService>[0]} [options]
 * Eligibility service options.
 * @returns {EligibilityService} Eligibility service.
 */
export function createEligibilityService(options = {}) {
  return new EligibilityService(options);
}

/**
 * Runs eligibility checks using a newly created service.
 *
 * @param {object} application Application to evaluate.
 * @param {object} [runOptions] Eligibility run options.
 * @param {ConstructorParameters<typeof EligibilityService>[0]}
 * [serviceOptions] Eligibility service options.
 * @returns {object} Eligibility result.
 */
export function runEligibilityChecks(
  application,
  runOptions = {},
  serviceOptions = {},
) {
  return createEligibilityService(
    serviceOptions,
  ).runEligibilityChecks(application, runOptions);
}

export const EligibilityModule = EligibilityService;
export const EligibilityEngine = EligibilityService;
export const createEligibilityEngine = createEligibilityService;
export const evaluateEligibility = runEligibilityChecks;
export const runEligibility = runEligibilityChecks;
export const determineBackgroundNeed =
  evaluateBackgroundRequirement;
export const determineAppointmentNeed =
  evaluateAppointmentRequirement;

export default EligibilityService;