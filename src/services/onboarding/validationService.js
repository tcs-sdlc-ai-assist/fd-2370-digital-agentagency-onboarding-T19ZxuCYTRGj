import { z } from 'zod';
import {
  ONBOARDING_STATUSES,
  RULE_IDENTIFIERS,
  SOURCE_CHANNELS,
  SOURCE_FORMATS,
} from '../../constants/domain.js';
import {
  PERMISSIONS,
  ROLE_PERMISSION_MATRIX,
} from '../../constants/roles.js';
import { validationResultSchema } from '../../contracts/schemas.js';
import { toIsoTimestamp } from '../../utils/dates.js';

export const VALIDATION_SERVICE_ERROR_CODES = Object.freeze({
  INVALID_APPLICATION: 'VALIDATION_APPLICATION_INVALID',
  INVALID_CHANGE_REQUEST: 'VALIDATION_CHANGE_REQUEST_INVALID',
  INVALID_OPTIONS: 'VALIDATION_OPTIONS_INVALID',
  INVALID_RULE: 'VALIDATION_RULE_INVALID',
  INVALID_SCOPE: 'VALIDATION_SCOPE_INVALID',
  PERSISTENCE_FAILED: 'VALIDATION_PERSISTENCE_FAILED',
});

export const VALIDATION_SCOPES = Object.freeze({
  FULL: 'full',
  INITIAL: 'initial',
  SECTIONAL: 'sectional',
  SUBMISSION: 'submission',
  CHANGE_REQUEST: 'change_request',
});

export const VALIDATION_SEVERITIES = Object.freeze({
  INFO: 'info',
  WARNING: 'warning',
  ERROR: 'error',
  BLOCKING: 'blocking',
});

export const ONBOARDING_VALIDATION_CODES = Object.freeze({
  ...RULE_IDENTIFIERS,
  AGENCY_TYPE_REQUIRED: 'AGENCY_TYPE_REQUIRED',
  SOURCE_CHANNEL_INVALID: 'SOURCE_CHANNEL_INVALID',
  SOURCE_FORMAT_INVALID: 'SOURCE_FORMAT_INVALID',
  SOURCE_FORMAT_NOT_AUTHORIZED: 'SOURCE_FORMAT_NOT_AUTHORIZED',
  SOURCE_PARTNER_MISMATCH: 'SOURCE_PARTNER_MISMATCH',
  PAYLOAD_REQUIRED: 'PAYLOAD_REQUIRED',
  PAYLOAD_INVALID: 'PAYLOAD_INVALID',
  REQUIRED_FORM_MISSING: 'REQUIRED_FORM_MISSING',
  REQUIRED_FORM_INCOMPLETE: 'REQUIRED_FORM_INCOMPLETE',
  MONTHLY_CHECK_UNSUPPORTED: 'MONTHLY_CHECK_UNSUPPORTED',
  HIERARCHY_REQUIRED: 'HIERARCHY_REQUIRED',
  HIERARCHY_NOT_ELIGIBLE: 'HIERARCHY_NOT_ELIGIBLE',
  CARRIER_UNSUPPORTED: 'CARRIER_UNSUPPORTED',
  SOURCE_AUTHORIZATION_REQUIRED: 'SOURCE_AUTHORIZATION_REQUIRED',
  SOURCE_AUTHORIZATION_FORBIDDEN: 'SOURCE_AUTHORIZATION_FORBIDDEN',
  CHANGE_TYPE_REQUIRED: 'CHANGE_TYPE_REQUIRED',
  CHANGE_TYPE_UNSUPPORTED: 'CHANGE_TYPE_UNSUPPORTED',
  CHANGE_VALUES_REQUIRED: 'CHANGE_VALUES_REQUIRED',
});

export const SUPPORTED_COMPANIES = Object.freeze([
  'Banner',
  'WilliamPenn',
]);

export const SUPPORTED_CHANGE_TYPES = Object.freeze([
  'hierarchy',
  'hierarchy_change',
  'commission_schedule',
  'commission_schedule_change',
  'level',
  'level_change',
  'assignee',
  'assignee_change',
]);

export const SOURCE_FORMAT_AUTHORIZATION_MATRIX = Object.freeze({
  [SOURCE_CHANNELS.SFTP]: Object.freeze([
    SOURCE_FORMATS.QUILITY_JSON,
    SOURCE_FORMATS.DTCC_FLAT_FILE,
  ]),
  [SOURCE_CHANNELS.EMAIL]: Object.freeze([
    SOURCE_FORMATS.QUILITY_JSON,
    SOURCE_FORMATS.ETHOS_XML,
    SOURCE_FORMATS.SURELC_TIF,
    SOURCE_FORMATS.MANUAL_FORM,
  ]),
  [SOURCE_CHANNELS.MAIL]: Object.freeze([
    SOURCE_FORMATS.MANUAL_FORM,
    SOURCE_FORMATS.SURELC_TIF,
  ]),
  [SOURCE_CHANNELS.FAX]: Object.freeze([
    SOURCE_FORMATS.MANUAL_FORM,
    SOURCE_FORMATS.SURELC_TIF,
  ]),
  [SOURCE_CHANNELS.API]: Object.freeze([
    SOURCE_FORMATS.QUILITY_JSON,
    SOURCE_FORMATS.ETHOS_XML,
    SOURCE_FORMATS.DTCC_FLAT_FILE,
    SOURCE_FORMATS.CHANGE_REQUEST,
  ]),
  [SOURCE_CHANNELS.PARTNER_DASHBOARD]: Object.freeze([
    SOURCE_FORMATS.MANUAL_FORM,
    SOURCE_FORMATS.CHANGE_REQUEST,
  ]),
  [SOURCE_CHANNELS.MANUAL]: Object.freeze([
    SOURCE_FORMATS.MANUAL_FORM,
    SOURCE_FORMATS.CHANGE_REQUEST,
  ]),
});

const metadataSchema = z.record(z.unknown());

export const validationApplicationSchema = z
  .object({
    id: z.string().trim().min(1).optional(),
    trackingId: z.string().trim().min(1).optional(),
    applicationId: z.string().trim().min(1).nullable().optional(),
    partnerCode: z.string().trim().min(1).optional(),
    sourceChannel: z.string().trim().min(1).optional(),
    sourceFormat: z.string().trim().min(1).optional(),
    company: z.string().trim().min(1).optional(),
    carrierCode: z.string().trim().min(1).optional(),
    gaCode: z.string().trim().min(1).optional(),
    agencyType: z.string().trim().min(1).optional(),
    contractType: z.string().trim().min(1).optional(),
    agency: metadataSchema.optional(),
    contract: metadataSchema.optional(),
    applicant: metadataSchema.optional(),
    agent: metadataSchema.optional(),
    organization: metadataSchema.optional(),
    principals: z.array(metadataSchema).optional(),
    licensing: metadataSchema.optional(),
    commission: metadataSchema.optional(),
    banking: metadataSchema.nullable().optional(),
    hierarchy: metadataSchema.optional(),
    documents: metadataSchema.optional(),
    documentPackage: metadataSchema.optional(),
    applicationPayload: metadataSchema.optional(),
    payload: metadataSchema.optional(),
    formState: metadataSchema.optional(),
    requiredForms: z.array(z.unknown()).optional(),
  })
  .passthrough();

export const validationChangeRequestSchema = z
  .object({
    changeRequestId: z.string().trim().min(1).optional(),
    applicationId: z.string().trim().min(1).optional(),
    trackingId: z.string().trim().min(1).nullable().optional(),
    partnerCode: z.string().trim().min(1).optional(),
    changeType: z.string().trim().min(1).optional(),
    requestedValues: metadataSchema.optional(),
    payload: metadataSchema.optional(),
  })
  .passthrough();

const DEFAULT_REQUIRED_FORM_STATUSES = Object.freeze([
  'accepted',
  'complete',
  'completed',
  'generated',
  'ready',
  'signed',
]);

const BLOCKING_VALIDATION_CODES = new Set([
  ONBOARDING_VALIDATION_CODES.ABNCA_NO_ADVANCE,
  ONBOARDING_VALIDATION_CODES.APPLICANT_IDENTITY_REQUIRED,
  ONBOARDING_VALIDATION_CODES.COMPANY_REQUIRED,
  ONBOARDING_VALIDATION_CODES.CONTRACT_TYPE_REQUIRED,
  ONBOARDING_VALIDATION_CODES.CORPORATE_LICENSED_PRINCIPAL_REQUIRED,
  ONBOARDING_VALIDATION_CODES.GA_CODE_REQUIRED,
  ONBOARDING_VALIDATION_CODES.HIERARCHY_NOT_ELIGIBLE,
  ONBOARDING_VALIDATION_CODES.HIERARCHY_NOT_RESOLVED,
  ONBOARDING_VALIDATION_CODES.MONTHLY_CHECK_UNSUPPORTED,
  ONBOARDING_VALIDATION_CODES.SOURCE_AUTHORIZATION_FORBIDDEN,
  ONBOARDING_VALIDATION_CODES.SOURCE_AUTHORIZATION_REQUIRED,
  ONBOARDING_VALIDATION_CODES.SOURCE_FORMAT_NOT_AUTHORIZED,
  ONBOARDING_VALIDATION_CODES.WILLIAM_PENN_LEVEL_30_UNSUPPORTED,
  ONBOARDING_VALIDATION_CODES
    .WILLIAM_PENN_NON_TRADITIONAL_UNSUPPORTED,
]);

const MANUAL_REVIEW_VALIDATION_CODES = new Set([
  ONBOARDING_VALIDATION_CODES.CORPORATE_LICENSED_PRINCIPAL_REQUIRED,
  ONBOARDING_VALIDATION_CODES.HIERARCHY_NOT_ELIGIBLE,
  ONBOARDING_VALIDATION_CODES.HIERARCHY_NOT_RESOLVED,
  ONBOARDING_VALIDATION_CODES.NIPR_IDENTITY_MISMATCH,
  ONBOARDING_VALIDATION_CODES.REQUIRED_FORM_INCOMPLETE,
  ONBOARDING_VALIDATION_CODES.SOURCE_PARTNER_MISMATCH,
  ONBOARDING_VALIDATION_CODES.WILLIAM_PENN_LEVEL_30_UNSUPPORTED,
  ONBOARDING_VALIDATION_CODES
    .WILLIAM_PENN_NON_TRADITIONAL_UNSUPPORTED,
]);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertOptions(options, description = 'Validation options') {
  if (!isObject(options)) {
    throw new TypeError(`${description} must be an object.`);
  }

  return options;
}

function normalizeIdentifier(value) {
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
  const identifier = normalizeIdentifier(value);

  return identifier?.normalize('NFKC').toLowerCase();
}

function normalizeToken(value) {
  return normalizeIdentifierForLookup(value)?.replace(/[^a-z0-9]/g, '');
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

function getValueAtPath(value, path) {
  return path.split('.').reduce((currentValue, segment) => {
    if (currentValue === null || currentValue === undefined) {
      return undefined;
    }

    return currentValue[segment];
  }, value);
}

function getFirstValue(value, paths) {
  for (const path of paths) {
    const candidate = getValueAtPath(value, path);

    if (
      candidate !== null &&
      candidate !== undefined &&
      (typeof candidate !== 'string' || candidate.trim() !== '')
    ) {
      return candidate;
    }
  }

  return undefined;
}

function isMissingValue(value) {
  return (
    value === null ||
    value === undefined ||
    (typeof value === 'string' && value.trim() === '')
  );
}

function isTruthyFlag(value) {
  if (value === true) {
    return true;
  }

  if (typeof value !== 'string') {
    return false;
  }

  return ['true', 'yes', 'eligible', 'active', 'valid'].includes(
    value.trim().toLowerCase(),
  );
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

  return normalizeIdentifier(value);
}

function normalizeScope(scope, options) {
  if (scope === undefined || scope === null) {
    return {
      name: VALIDATION_SCOPES.FULL,
      sections: undefined,
    };
  }

  if (Array.isArray(scope)) {
    return {
      name: VALIDATION_SCOPES.SECTIONAL,
      sections: normalizeSections(scope),
    };
  }

  if (isObject(scope)) {
    const scopeOptions = scope;
    const name =
      scopeOptions.scope ??
      scopeOptions.name ??
      (scopeOptions.sections
        ? VALIDATION_SCOPES.SECTIONAL
        : VALIDATION_SCOPES.FULL);

    return normalizeScope(name, {
      ...options,
      sections: scopeOptions.sections ?? options.sections,
    });
  }

  const normalizedScope = normalizeIdentifierForLookup(scope);

  if (!Object.values(VALIDATION_SCOPES).includes(normalizedScope)) {
    throw createValidationServiceError(
      VALIDATION_SERVICE_ERROR_CODES.INVALID_SCOPE,
      `Unsupported validation scope: ${scope}`,
      {
        scope: String(scope),
        supportedScopes: Object.values(VALIDATION_SCOPES),
      },
    );
  }

  return {
    name: normalizedScope,
    sections:
      normalizedScope === VALIDATION_SCOPES.SECTIONAL
        ? normalizeSections(options.sections ?? [])
        : options.sections === undefined
          ? undefined
          : normalizeSections(options.sections),
  };
}

function normalizeSections(sections) {
  if (!Array.isArray(sections)) {
    throw new TypeError('Validation sections must be an array.');
  }

  return [
    ...new Set(
      sections.map((section) => {
        const normalizedSection = normalizeIdentifierForLookup(section);

        if (!normalizedSection) {
          throw new TypeError(
            'Validation section identifiers must be non-empty.',
          );
        }

        return normalizedSection;
      }),
    ),
  ];
}

function createValidationServiceError(code, message, details, cause) {
  const error = new Error(message, {
    ...(cause === undefined ? {} : { cause }),
  });

  error.name = 'ValidationServiceError';
  error.code = code;
  error.details = details ?? null;
  error.recoverable = true;

  return error;
}

function createIssue({
  code,
  message,
  path = [],
  field,
  severity,
  metadata,
}) {
  const normalizedSeverity =
    severity ??
    (BLOCKING_VALIDATION_CODES.has(code)
      ? VALIDATION_SEVERITIES.BLOCKING
      : VALIDATION_SEVERITIES.ERROR);

  return {
    code,
    message,
    path,
    severity: normalizedSeverity,
    ...(field === undefined ? {} : { field }),
    ...(metadata === undefined ? {} : { metadata }),
  };
}

function normalizeRuleResult(result) {
  if (result === undefined || result === null || result === false) {
    return {
      issues: [],
      derivedValues: {},
    };
  }

  if (Array.isArray(result)) {
    return {
      issues: result,
      derivedValues: {},
    };
  }

  if (isObject(result) && Array.isArray(result.issues)) {
    return {
      issues: result.issues,
      derivedValues: isObject(result.derivedValues)
        ? result.derivedValues
        : {},
    };
  }

  if (isObject(result) && result.code) {
    return {
      issues: [result],
      derivedValues: {},
    };
  }

  throw createValidationServiceError(
    VALIDATION_SERVICE_ERROR_CODES.INVALID_RULE,
    'A validation rule returned an unsupported result.',
    { result },
  );
}

function mergeDerivedValues(target, values) {
  Object.entries(values).forEach(([key, value]) => {
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

function issueKey(issue) {
  return [
    issue.code,
    issue.field ?? '',
    issue.path.join('.'),
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

function getApplicationPayload(application) {
  return (
    application.applicationPayload ??
    application.payload ??
    application.formState
  );
}

function getAgencyType(application) {
  return getFirstValue(application, [
    'agencyType',
    'agency.type',
    'applicationPayload.agencyType',
    'applicationPayload.agency.type',
    'payload.agencyType',
    'payload.agency.type',
    'formState.agencyType',
    'formState.agency.type',
  ]);
}

function getContractType(application) {
  return getFirstValue(application, [
    'contractType',
    'contract.type',
    'applicationPayload.contractType',
    'applicationPayload.contract.type',
    'payload.contractType',
    'payload.contract.type',
    'formState.contractType',
    'formState.contract.type',
  ]);
}

function getApplicant(application) {
  return (
    application.applicant ??
    application.agent ??
    application.organization ??
    getFirstValue(application, [
      'applicationPayload.applicant',
      'applicationPayload.agent',
      'applicationPayload.organization',
      'payload.applicant',
      'payload.agent',
      'payload.organization',
      'formState.applicant',
      'formState.agent',
      'formState.organization',
    ])
  );
}

function getCommissionSchedule(application) {
  return getFirstValue(application, [
    'commissionSchedule',
    'commission.schedule',
    'contract.commissionSchedule',
    'applicationPayload.commissionSchedule',
    'applicationPayload.commission.schedule',
    'applicationPayload.contract.commissionSchedule',
    'payload.commissionSchedule',
    'payload.commission.schedule',
    'payload.contract.commissionSchedule',
    'formState.commissionSchedule',
    'formState.commission.schedule',
    'formState.contract.commissionSchedule',
  ]);
}

function getAdvanceCommission(application) {
  return getFirstValue(application, [
    'advanceCommission',
    'commission.advanceCommission',
    'contract.advanceCommission',
    'applicationPayload.advanceCommission',
    'applicationPayload.commission.advanceCommission',
    'applicationPayload.contract.advanceCommission',
    'payload.advanceCommission',
    'payload.commission.advanceCommission',
    'payload.contract.advanceCommission',
    'formState.advanceCommission',
    'formState.commission.advanceCommission',
    'formState.contract.advanceCommission',
  ]);
}

function getPaymentMethod(application) {
  return getFirstValue(application, [
    'paymentMethod',
    'commission.paymentMethod',
    'banking.paymentMethod',
    'applicationPayload.paymentMethod',
    'applicationPayload.commission.paymentMethod',
    'applicationPayload.banking.paymentMethod',
    'payload.paymentMethod',
    'payload.commission.paymentMethod',
    'payload.banking.paymentMethod',
    'formState.paymentMethod',
    'formState.commission.paymentMethod',
    'formState.banking.paymentMethod',
  ]);
}

function getResidenceState(application) {
  return getFirstValue(application, [
    'residenceState',
    'applicant.residenceState',
    'agent.residenceState',
    'licensing.residentState',
    'applicationPayload.residenceState',
    'applicationPayload.agent.residenceState',
    'applicationPayload.applicant.residenceState',
    'payload.residenceState',
    'payload.agent.residenceState',
    'payload.applicant.residenceState',
    'formState.residenceState',
    'formState.agent.residenceState',
    'formState.applicant.residenceState',
  ]);
}

function getContractLevel(application) {
  return getFirstValue(application, [
    'level',
    'contract.level',
    'commission.level',
    'applicationPayload.level',
    'applicationPayload.contract.level',
    'payload.level',
    'payload.contract.level',
    'formState.level',
    'formState.contract.level',
  ]);
}

function getPrincipals(application) {
  const principals = getFirstValue(application, [
    'principals',
    'applicationPayload.principals',
    'payload.principals',
    'formState.principals',
  ]);

  return Array.isArray(principals) ? principals : [];
}

function getRequiredForms(application, options) {
  const requiredForms =
    options.requiredForms ??
    getFirstValue(application, [
      'requiredForms',
      'documentPackage.requiredForms',
      'processingSnapshot.documentPackage.requiredForms',
      'applicationPayload.requiredForms',
      'payload.requiredForms',
      'formState.requiredForms',
    ]);

  return Array.isArray(requiredForms) ? requiredForms : undefined;
}

function getCompletedForms(application, options) {
  const completedForms =
    options.completedForms ??
    getFirstValue(application, [
      'completedForms',
      'documentPackage.completedForms',
      'processingSnapshot.documentPackage.completedForms',
      'applicationPayload.completedForms',
      'payload.completedForms',
      'formState.completedForms',
    ]);

  return Array.isArray(completedForms) ? completedForms : [];
}

function normalizeFormCode(form) {
  if (typeof form === 'string' || typeof form === 'number') {
    return normalizeIdentifier(form);
  }

  if (!isObject(form)) {
    return undefined;
  }

  return normalizeIdentifier(
    form.code ?? form.id ?? form.documentCode ?? form.name,
  );
}

function getPrincipalEligibility(principal) {
  return (
    isTruthyFlag(principal.isLicensedEligible) ||
    isTruthyFlag(principal.licensedEligible) ||
    isTruthyFlag(principal.eligible) ||
    (isTruthyFlag(principal.isLicensed) &&
      principal.eligible !== false)
  );
}

function getPrincipalName(principal) {
  return (
    normalizeIdentifier(principal.firstName) &&
    normalizeIdentifier(principal.lastName)
  );
}

function isCorporateContract(application) {
  const contractType = normalizeToken(getContractType(application));
  const applicant = getApplicant(application);

  return (
    ['agency', 'corporate', 'entity', 'organization'].includes(
      contractType,
    ) ||
    normalizeToken(applicant?.type) === 'organization'
  );
}

function requiresProducerIdentity(application) {
  const contractType = normalizeToken(getContractType(application));

  return ![
    'agency',
    'corporate',
    'entity',
    'organization',
  ].includes(contractType);
}

function hasApplicantIdentity(application) {
  const applicant = getApplicant(application);

  if (!isObject(applicant)) {
    return false;
  }

  if (
    normalizeToken(applicant.type) === 'organization' ||
    normalizeIdentifier(applicant.legalName)
  ) {
    return Boolean(normalizeIdentifier(applicant.legalName));
  }

  return Boolean(
    normalizeIdentifier(applicant.firstName) &&
      normalizeIdentifier(applicant.lastName),
  );
}

function getPrincipal(options) {
  return (
    options.principal ??
    options.actor ??
    options.requestedBy ??
    null
  );
}

function isPrincipalAuthenticated(principal) {
  if (!principal) {
    return false;
  }

  if (typeof principal === 'string') {
    return principal.trim() !== '';
  }

  if (!isObject(principal)) {
    return false;
  }

  if (
    Object.hasOwn(principal, 'isAuthenticated') ||
    Object.hasOwn(principal, 'status')
  ) {
    return (
      principal.isAuthenticated === true ||
      principal.status === 'authenticated'
    );
  }

  return Boolean(
    normalizeIdentifier(
      principal.role ??
        principal.user?.role ??
        principal.currentUser?.role,
    ),
  );
}

function principalCanCreateOnboarding(principal) {
  if (!isPrincipalAuthenticated(principal)) {
    return false;
  }

  if (typeof principal === 'string') {
    return (
      ROLE_PERMISSION_MATRIX[principal]?.includes(
        PERMISSIONS.CREATE_ONBOARDING,
      ) ?? false
    );
  }

  const role =
    principal.role ??
    principal.user?.role ??
    principal.currentUser?.role;
  const rolePermissions = ROLE_PERMISSION_MATRIX[role] ?? [];
  const explicitPermissions = Array.isArray(principal.permissions)
    ? principal.permissions
    : rolePermissions;

  return (
    rolePermissions.includes(PERMISSIONS.CREATE_ONBOARDING) &&
    explicitPermissions.includes(PERMISSIONS.CREATE_ONBOARDING)
  );
}

function getPrincipalPartnerCode(principal) {
  if (!isObject(principal)) {
    return undefined;
  }

  return getFirstValue(principal, [
    'partnerContext.partnerCode',
    'partnerCode',
    'user.partnerCode',
    'currentUser.partnerCode',
  ]);
}

function createRule(definition) {
  if (
    !isObject(definition) ||
    !normalizeIdentifier(definition.id) ||
    typeof definition.evaluate !== 'function'
  ) {
    throw createValidationServiceError(
      VALIDATION_SERVICE_ERROR_CODES.INVALID_RULE,
      'Validation rules require an id and evaluate function.',
      { definition },
    );
  }

  return Object.freeze({
    id: definition.id,
    sections: Object.freeze(
      normalizeSections(definition.sections ?? ['general']),
    ),
    scopes: Object.freeze(
      definition.scopes ?? Object.values(VALIDATION_SCOPES),
    ),
    evaluate: definition.evaluate,
  });
}

function ruleIsSelected(rule, scope) {
  if (!rule.scopes.includes(scope.name)) {
    return false;
  }

  if (!scope.sections || scope.sections.length === 0) {
    return true;
  }

  return rule.sections.some((section) =>
    scope.sections.includes(section),
  );
}

const minimumFieldsRule = createRule({
  id: 'minimum-fields',
  sections: ['minimum', 'identity', 'contract', 'hierarchy'],
  evaluate(application) {
    const issues = [];
    const company = normalizeCompany(
      getFirstValue(application, [
        'company',
        'applicationPayload.company',
        'payload.company',
        'formState.company',
      ]),
    );
    const gaCode = getFirstValue(application, [
      'gaCode',
      'applicationPayload.gaCode',
      'payload.gaCode',
      'formState.gaCode',
    ]);
    const agencyType = getAgencyType(application);
    const contractType = getContractType(application);

    if (isMissingValue(company)) {
      issues.push(
        createIssue({
          code: ONBOARDING_VALIDATION_CODES.COMPANY_REQUIRED,
          message: 'A carrier company is required.',
          path: ['company'],
          field: 'company',
        }),
      );
    }

    if (isMissingValue(gaCode)) {
      issues.push(
        createIssue({
          code: ONBOARDING_VALIDATION_CODES.GA_CODE_REQUIRED,
          message: 'A general agency code is required.',
          path: ['gaCode'],
          field: 'gaCode',
        }),
      );
    }

    if (isMissingValue(agencyType)) {
      issues.push(
        createIssue({
          code: ONBOARDING_VALIDATION_CODES.AGENCY_TYPE_REQUIRED,
          message: 'An agency type is required.',
          path: ['agencyType'],
          field: 'agencyType',
        }),
      );
    }

    if (isMissingValue(contractType)) {
      issues.push(
        createIssue({
          code: ONBOARDING_VALIDATION_CODES.CONTRACT_TYPE_REQUIRED,
          message: 'A contract type is required.',
          path: ['contractType'],
          field: 'contractType',
        }),
      );
    }

    if (!hasApplicantIdentity(application)) {
      issues.push(
        createIssue({
          code:
            ONBOARDING_VALIDATION_CODES.APPLICANT_IDENTITY_REQUIRED,
          message: 'Applicant identity information is required.',
          path: ['applicant'],
          field: 'applicant',
        }),
      );
    }

    return {
      issues,
      derivedValues: {
        company: company ?? null,
        gaCode: gaCode ?? null,
        agencyType: agencyType ?? null,
        contractType: contractType ?? null,
      },
    };
  },
});

const sourceRule = createRule({
  id: 'source-authorization',
  sections: ['source', 'authorization'],
  evaluate(application, context) {
    const issues = [];
    const sourceChannel = getFirstValue(application, [
      'sourceChannel',
      'sourceMetadata.sourceChannel',
      'applicationPayload.sourceChannel',
      'applicationPayload.sourceMetadata.sourceChannel',
      'payload.sourceChannel',
      'payload.sourceMetadata.sourceChannel',
    ]);
    const sourceFormat = getFirstValue(application, [
      'sourceFormat',
      'sourceMetadata.sourceFormat',
      'applicationPayload.sourceFormat',
      'applicationPayload.sourceMetadata.sourceFormat',
      'payload.sourceFormat',
      'payload.sourceMetadata.sourceFormat',
    ]);

    if (
      sourceChannel !== undefined &&
      !Object.values(SOURCE_CHANNELS).includes(sourceChannel)
    ) {
      issues.push(
        createIssue({
          code:
            ONBOARDING_VALIDATION_CODES.SOURCE_CHANNEL_INVALID,
          message: `Unsupported source channel: ${sourceChannel}.`,
          path: ['sourceChannel'],
          field: 'sourceChannel',
        }),
      );
    }

    if (
      sourceFormat !== undefined &&
      !Object.values(SOURCE_FORMATS).includes(sourceFormat)
    ) {
      issues.push(
        createIssue({
          code:
            ONBOARDING_VALIDATION_CODES.SOURCE_FORMAT_INVALID,
          message: `Unsupported source format: ${sourceFormat}.`,
          path: ['sourceFormat'],
          field: 'sourceFormat',
        }),
      );
    }

    if (
      Object.values(SOURCE_CHANNELS).includes(sourceChannel) &&
      Object.values(SOURCE_FORMATS).includes(sourceFormat) &&
      !SOURCE_FORMAT_AUTHORIZATION_MATRIX[sourceChannel]?.includes(
        sourceFormat,
      )
    ) {
      issues.push(
        createIssue({
          code:
            ONBOARDING_VALIDATION_CODES
              .SOURCE_FORMAT_NOT_AUTHORIZED,
          message: `${sourceFormat} is not authorized for ${sourceChannel} intake.`,
          path: ['sourceFormat'],
          field: 'sourceFormat',
          metadata: {
            sourceChannel,
            sourceFormat,
          },
        }),
      );
    }

    const principal = getPrincipal(context.options);

    if (
      context.options.requireAuthorization === true &&
      !isPrincipalAuthenticated(principal)
    ) {
      issues.push(
        createIssue({
          code:
            ONBOARDING_VALIDATION_CODES
              .SOURCE_AUTHORIZATION_REQUIRED,
          message: 'An authenticated principal is required.',
          path: ['requestedBy'],
          field: 'requestedBy',
        }),
      );
    } else if (
      principal &&
      !principalCanCreateOnboarding(principal)
    ) {
      issues.push(
        createIssue({
          code:
            ONBOARDING_VALIDATION_CODES
              .SOURCE_AUTHORIZATION_FORBIDDEN,
          message:
            'The current principal cannot create onboarding applications.',
          path: ['requestedBy'],
          field: 'requestedBy',
        }),
      );
    }

    const principalPartnerCode = getPrincipalPartnerCode(principal);
    const applicationPartnerCode = getFirstValue(application, [
      'partnerCode',
      'sourceMetadata.partnerCode',
      'applicationPayload.partnerCode',
      'applicationPayload.sourceMetadata.partnerCode',
      'payload.partnerCode',
      'payload.sourceMetadata.partnerCode',
    ]);

    if (
      context.options.enforcePartnerScope !== false &&
      principalPartnerCode &&
      applicationPartnerCode &&
      normalizeIdentifierForLookup(principalPartnerCode) !==
        normalizeIdentifierForLookup(applicationPartnerCode)
    ) {
      issues.push(
        createIssue({
          code:
            ONBOARDING_VALIDATION_CODES.SOURCE_PARTNER_MISMATCH,
          message:
            'The intake partner does not match the current partner scope.',
          path: ['partnerCode'],
          field: 'partnerCode',
          severity: VALIDATION_SEVERITIES.BLOCKING,
          metadata: {
            requestedPartnerCode: applicationPartnerCode,
          },
        }),
      );
    }

    return {
      issues,
      derivedValues: {
        sourceAuthorized: issues.length === 0,
      },
    };
  },
});

const payloadRule = createRule({
  id: 'payload',
  sections: ['payload', 'source'],
  scopes: [
    VALIDATION_SCOPES.FULL,
    VALIDATION_SCOPES.INITIAL,
    VALIDATION_SCOPES.SECTIONAL,
    VALIDATION_SCOPES.SUBMISSION,
  ],
  evaluate(application, context) {
    const payload = getApplicationPayload(application);

    if (
      context.options.requirePayload !== true &&
      payload === undefined
    ) {
      return undefined;
    }

    if (payload === undefined) {
      return createIssue({
        code: ONBOARDING_VALIDATION_CODES.PAYLOAD_REQUIRED,
        message: 'An onboarding payload is required.',
        path: ['applicationPayload'],
        field: 'applicationPayload',
      });
    }

    if (!isObject(payload)) {
      return createIssue({
        code: ONBOARDING_VALIDATION_CODES.PAYLOAD_INVALID,
        message: 'The onboarding payload must be an object.',
        path: ['applicationPayload'],
        field: 'applicationPayload',
      });
    }

    return undefined;
  },
});

const formsRule = createRule({
  id: 'required-forms',
  sections: ['forms', 'documents'],
  scopes: [
    VALIDATION_SCOPES.FULL,
    VALIDATION_SCOPES.SECTIONAL,
    VALIDATION_SCOPES.SUBMISSION,
  ],
  evaluate(application, context) {
    const requiredForms = getRequiredForms(
      application,
      context.options,
    );

    if (requiredForms === undefined) {
      return undefined;
    }

    const completedForms = getCompletedForms(
      application,
      context.options,
    );
    const completedFormCodes = new Set(
      completedForms
        .map(normalizeFormCode)
        .filter(Boolean)
        .map(normalizeIdentifierForLookup),
    );
    const issues = [];

    requiredForms.forEach((form, index) => {
      const code = normalizeFormCode(form);
      const required = !isObject(form) || form.required !== false;
      const status = isObject(form)
        ? normalizeIdentifierForLookup(form.status)
        : undefined;
      const completeByStatus =
        status && DEFAULT_REQUIRED_FORM_STATUSES.includes(status);
      const completeByReference =
        code &&
        completedFormCodes.has(normalizeIdentifierForLookup(code));

      if (!required || completeByStatus || completeByReference) {
        return;
      }

      issues.push(
        createIssue({
          code:
            context.scope.name === VALIDATION_SCOPES.SUBMISSION
              ? ONBOARDING_VALIDATION_CODES.REQUIRED_FORM_INCOMPLETE
              : ONBOARDING_VALIDATION_CODES.REQUIRED_FORM_MISSING,
          message: `${code ?? `Form ${index + 1}`} is required before submission.`,
          path: ['requiredForms', index],
          field: code ?? `requiredForms.${index}`,
          severity:
            context.scope.name === VALIDATION_SCOPES.SUBMISSION
              ? VALIDATION_SEVERITIES.BLOCKING
              : VALIDATION_SEVERITIES.ERROR,
          metadata: {
            formCode: code ?? null,
          },
        }),
      );
    });

    return {
      issues,
      derivedValues: {
        requiredFormCount: requiredForms.filter(
          (form) => !isObject(form) || form.required !== false,
        ).length,
        requiredFormsComplete: issues.length === 0,
      },
    };
  },
});

const errorsAndOmissionsRule = createRule({
  id: 'errors-and-omissions',
  sections: ['commission', 'eo', 'contract'],
  evaluate(application) {
    const advanceCommission = isTruthyFlag(
      getAdvanceCommission(application),
    );
    const residenceState = normalizeIdentifier(
      getResidenceState(application),
    )?.toUpperCase();
    const eoRequired =
      advanceCommission || ['UT', 'RI'].includes(residenceState);
    const eoPolicyNumber = getFirstValue(application, [
      'eoPolicyNumber',
      'errorsAndOmissions.policyNumber',
      'eAndO.policyNumber',
      'applicationPayload.errorsAndOmissions.policyNumber',
      'payload.errorsAndOmissions.policyNumber',
      'formState.errorsAndOmissions.policyNumber',
    ]);
    const eoStatus = normalizeIdentifierForLookup(
      getFirstValue(application, [
        'errorsAndOmissions.status',
        'eAndO.status',
        'applicationPayload.errorsAndOmissions.status',
        'payload.errorsAndOmissions.status',
        'formState.errorsAndOmissions.status',
      ]),
    );
    const eoSatisfied =
      !isMissingValue(eoPolicyNumber) ||
      ['active', 'approved', 'verified'].includes(eoStatus);

    return {
      issues:
        eoRequired && !eoSatisfied
          ? [
              createIssue({
                code: ONBOARDING_VALIDATION_CODES.EO_REQUIRED,
                message:
                  'Errors and omissions coverage is required for the selected contracting options.',
                path: ['errorsAndOmissions', 'policyNumber'],
                field: 'errorsAndOmissions.policyNumber',
              }),
            ]
          : [],
      derivedValues: {
        errorsAndOmissionsRequired: eoRequired,
      },
    };
  },
});

const principalsRule = createRule({
  id: 'corporate-principals',
  sections: ['principals', 'identity', 'contract'],
  evaluate(application) {
    if (!isCorporateContract(application)) {
      return {
        issues: [],
        derivedValues: {
          licensedPrincipalRequired: false,
        },
      };
    }

    const principals = getPrincipals(application);
    const eligiblePrincipal = principals.some(
      (principal) =>
        isObject(principal) &&
        getPrincipalName(principal) &&
        getPrincipalEligibility(principal),
    );

    return {
      issues: eligiblePrincipal
        ? []
        : [
            createIssue({
              code:
                ONBOARDING_VALIDATION_CODES
                  .CORPORATE_LICENSED_PRINCIPAL_REQUIRED,
              message:
                'A corporate contract requires at least one licensed and eligible principal.',
              path: ['principals'],
              field: 'principals',
            }),
          ],
      derivedValues: {
        licensedPrincipalRequired: true,
        eligiblePrincipalPresent: eligiblePrincipal,
      },
    };
  },
});

const commissionRule = createRule({
  id: 'commission',
  sections: ['commission', 'contract', 'banking'],
  evaluate(application) {
    const issues = [];
    const schedule = normalizeToken(
      getCommissionSchedule(application),
    );
    const advanceCommission = isTruthyFlag(
      getAdvanceCommission(application),
    );
    const paymentMethod = normalizeToken(
      getPaymentMethod(application),
    );

    if (schedule === 'abnca' && advanceCommission) {
      issues.push(
        createIssue({
          code: ONBOARDING_VALIDATION_CODES.ABNCA_NO_ADVANCE,
          message: 'ABNCA prohibits advance commission.',
          path: ['contract', 'advanceCommission'],
          field: 'contract.advanceCommission',
        }),
      );
    }

    if (
      ['monthlycheck', 'monthlypapercheck'].includes(paymentMethod)
    ) {
      issues.push(
        createIssue({
          code:
            ONBOARDING_VALIDATION_CODES.MONTHLY_CHECK_UNSUPPORTED,
          message: 'Monthly check is not a supported payment method.',
          path: ['commission', 'paymentMethod'],
          field: 'commission.paymentMethod',
        }),
      );
    }

    return {
      issues,
      derivedValues: {
        commissionSchedule: getCommissionSchedule(application) ?? null,
        advanceCommission,
        paymentMethod: getPaymentMethod(application) ?? null,
      },
    };
  },
});

const hierarchyRule = createRule({
  id: 'hierarchy',
  sections: ['hierarchy', 'agency', 'contract'],
  evaluate(application) {
    const issues = [];
    const gaCode = getFirstValue(application, [
      'gaCode',
      'applicationPayload.gaCode',
      'payload.gaCode',
      'formState.gaCode',
    ]);
    const hierarchy = getFirstValue(application, [
      'hierarchy',
      'applicationPayload.hierarchy',
      'payload.hierarchy',
      'formState.hierarchy',
    ]);
    const hierarchyStatus = normalizeIdentifierForLookup(
      hierarchy?.status,
    );
    const hierarchyPath = hierarchy?.path ?? hierarchy?.hierarchyPath;
    const explicitlyRequired =
      hierarchy?.required === true ||
      application.hierarchyRequired === true;

    if (explicitlyRequired && isMissingValue(gaCode)) {
      issues.push(
        createIssue({
          code: ONBOARDING_VALIDATION_CODES.HIERARCHY_REQUIRED,
          message:
            'A general agency hierarchy is required for this application.',
          path: ['hierarchy'],
          field: 'hierarchy',
        }),
      );
    }

    if (
      ['invalid', 'ineligible', 'unresolved'].includes(
        hierarchyStatus,
      ) ||
      (Array.isArray(hierarchyPath) &&
        hierarchyPath.length === 0 &&
        hierarchy?.resolved === false)
    ) {
      issues.push(
        createIssue({
          code:
            hierarchyStatus === 'ineligible'
              ? ONBOARDING_VALIDATION_CODES.HIERARCHY_NOT_ELIGIBLE
              : ONBOARDING_VALIDATION_CODES.HIERARCHY_NOT_RESOLVED,
          message:
            hierarchyStatus === 'ineligible'
              ? 'The selected hierarchy is not eligible.'
              : 'The selected hierarchy could not be resolved.',
          path: ['hierarchy'],
          field: 'hierarchy',
        }),
      );
    }

    return {
      issues,
      derivedValues: {
        hierarchyResolved: issues.length === 0,
      },
    };
  },
});

const carrierRule = createRule({
  id: 'carrier',
  sections: ['carrier', 'agency', 'contract'],
  evaluate(application) {
    const issues = [];
    const company = normalizeCompany(
      getFirstValue(application, [
        'company',
        'carrier',
        'carrierCode',
        'applicationPayload.company',
        'payload.company',
        'formState.company',
      ]),
    );
    const agencyType = normalizeToken(getAgencyType(application));
    const level = normalizeToken(getContractLevel(application));

    if (company && !SUPPORTED_COMPANIES.includes(company)) {
      issues.push(
        createIssue({
          code: ONBOARDING_VALIDATION_CODES.CARRIER_UNSUPPORTED,
          message: `The selected carrier is not supported: ${company}.`,
          path: ['company'],
          field: 'company',
        }),
      );
    }

    if (
      company === 'WilliamPenn' &&
      [
        'nontraditional',
        'financialinstitution',
        'imobga',
      ].includes(agencyType)
    ) {
      issues.push(
        createIssue({
          code:
            ONBOARDING_VALIDATION_CODES
              .WILLIAM_PENN_NON_TRADITIONAL_UNSUPPORTED,
          message:
            'William Penn does not support the selected non-traditional agency arrangement.',
          path: ['agencyType'],
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
          code:
            ONBOARDING_VALIDATION_CODES
              .WILLIAM_PENN_LEVEL_30_UNSUPPORTED,
          message:
            'William Penn does not support level 30 for this onboarding arrangement.',
          path: ['contract', 'level'],
          field: 'contract.level',
        }),
      );
    }

    return {
      issues,
      derivedValues: {
        carrierEligibility:
          issues.length === 0 ? 'ELIGIBLE' : 'INELIGIBLE',
      },
    };
  },
});

const licensingRule = createRule({
  id: 'licensing',
  sections: ['licensing', 'identity'],
  evaluate(application) {
    if (!requiresProducerIdentity(application)) {
      return undefined;
    }

    const applicant = getApplicant(application);
    const npn = getFirstValue(
      {
        ...application,
        applicant,
      },
      [
        'npn',
        'applicant.npn',
        'licensing.npn',
        'applicationPayload.npn',
        'applicationPayload.agent.npn',
        'payload.npn',
        'payload.agent.npn',
        'formState.npn',
        'formState.agent.npn',
      ],
    );

    if (isMissingValue(npn)) {
      return createIssue({
        code: ONBOARDING_VALIDATION_CODES.NPN_REQUIRED,
        message: 'A national producer number is required.',
        path: ['applicant', 'npn'],
        field: 'applicant.npn',
      });
    }

    if (!/^\d{5,10}$/.test(String(npn).trim())) {
      return createIssue({
        code: ONBOARDING_VALIDATION_CODES.NPN_INVALID_FORMAT,
        message:
          'The national producer number must contain 5 to 10 digits.',
        path: ['applicant', 'npn'],
        field: 'applicant.npn',
      });
    }

    return undefined;
  },
});

export const DEFAULT_VALIDATION_RULES = Object.freeze([
  minimumFieldsRule,
  sourceRule,
  payloadRule,
  formsRule,
  errorsAndOmissionsRule,
  principalsRule,
  commissionRule,
  hierarchyRule,
  carrierRule,
  licensingRule,
]);

export const VALIDATION_RULE_REGISTRY = Object.freeze(
  Object.fromEntries(
    DEFAULT_VALIDATION_RULES.map((rule) => [rule.id, rule]),
  ),
);

function normalizeRules(rules) {
  if (rules === undefined) {
    return [...DEFAULT_VALIDATION_RULES];
  }

  if (!Array.isArray(rules)) {
    throw new TypeError('Validation rules must be an array.');
  }

  const normalizedRules = rules.map((rule) =>
    Object.isFrozen(rule) &&
    typeof rule.evaluate === 'function' &&
    Array.isArray(rule.sections)
      ? rule
      : createRule(rule),
  );
  const identifiers = new Set();

  normalizedRules.forEach((rule) => {
    if (identifiers.has(rule.id)) {
      throw createValidationServiceError(
        VALIDATION_SERVICE_ERROR_CODES.INVALID_RULE,
        `Duplicate validation rule identifier: ${rule.id}`,
        { ruleId: rule.id },
      );
    }

    identifiers.add(rule.id);
  });

  return normalizedRules;
}

function formatSchemaIssues(error, rootPath = []) {
  return error.issues.map((issue) =>
    createIssue({
      code: ONBOARDING_VALIDATION_CODES.PAYLOAD_INVALID,
      message: issue.message,
      path: [...rootPath, ...issue.path],
      field: [...rootPath, ...issue.path].join('.') || undefined,
      severity: VALIDATION_SEVERITIES.ERROR,
      metadata: {
        zodCode: issue.code,
      },
    }),
  );
}

function createValidationResult(issues, derivedValues, checkedAt) {
  const uniqueIssues = deduplicateIssues(issues);
  const errors = uniqueIssues.filter((issue) =>
    [
      VALIDATION_SEVERITIES.ERROR,
      VALIDATION_SEVERITIES.BLOCKING,
    ].includes(issue.severity),
  );
  const warnings = uniqueIssues.filter((issue) =>
    [
      VALIDATION_SEVERITIES.INFO,
      VALIDATION_SEVERITIES.WARNING,
    ].includes(issue.severity),
  );
  const validationCodes = [
    ...new Set(uniqueIssues.map((issue) => issue.code)),
  ];
  const manualReviewRequired = uniqueIssues.some(
    (issue) =>
      MANUAL_REVIEW_VALIDATION_CODES.has(issue.code) ||
      issue.metadata?.manualReviewRequired === true,
  );
  const result = {
    valid: errors.length === 0,
    issues: uniqueIssues,
    validationCodes,
    manualReviewRequired,
    checkedAt,
    errors,
    warnings,
    derived: cloneValue(derivedValues),
    derivedValues: cloneValue(derivedValues),
    autoSubmittable:
      errors.length === 0 && !manualReviewRequired,
  };

  return validationResultSchema.parse(result);
}

function normalizeValidationArguments(scopeOrOptions, maybeOptions) {
  if (isObject(scopeOrOptions)) {
    const options = assertOptions(
      scopeOrOptions,
      'Application validation options',
    );

    return {
      scope: options.scope ?? VALIDATION_SCOPES.FULL,
      options,
    };
  }

  return {
    scope: scopeOrOptions ?? VALIDATION_SCOPES.FULL,
    options: assertOptions(
      maybeOptions,
      'Application validation options',
    ),
  };
}

function assertRepository(repository) {
  if (
    repository !== undefined &&
    (!isObject(repository) ||
      typeof repository.saveValidationResult !== 'function')
  ) {
    throw new TypeError(
      'The validation repository must provide saveValidationResult.',
    );
  }

  return repository;
}

function validateRuleFilter(ruleIds) {
  if (ruleIds === undefined) {
    return undefined;
  }

  if (!Array.isArray(ruleIds)) {
    throw new TypeError('Validation ruleIds must be an array.');
  }

  return new Set(
    ruleIds.map((ruleId) => {
      const identifier = normalizeIdentifier(ruleId);

      if (!identifier) {
        throw new TypeError(
          'Validation rule identifiers must be non-empty.',
        );
      }

      return identifier;
    }),
  );
}

/**
 * Executes onboarding schema and business-rule validation.
 */
export class ValidationService {
  /**
   * @param {{
   *   rules?: object[],
   *   repository?: object,
   *   clock?: () => Date | string | number,
   *   requireAuthorization?: boolean,
   *   enforcePartnerScope?: boolean,
   *   requirePayload?: boolean
   * }} [options] Validation service options.
   */
  constructor(options = {}) {
    const normalizedOptions = assertOptions(
      options,
      'Validation service options',
    );

    if (
      normalizedOptions.clock !== undefined &&
      typeof normalizedOptions.clock !== 'function'
    ) {
      throw new TypeError('The validation service clock must be a function.');
    }

    this.rules = Object.freeze(
      normalizeRules(normalizedOptions.rules),
    );
    this.repository = assertRepository(normalizedOptions.repository);
    this.clock = normalizedOptions.clock ?? (() => new Date());
    this.defaultOptions = Object.freeze({
      requireAuthorization:
        normalizedOptions.requireAuthorization ?? false,
      enforcePartnerScope:
        normalizedOptions.enforcePartnerScope ?? true,
      requirePayload: normalizedOptions.requirePayload ?? false,
    });
  }

  /**
   * Validates an onboarding application.
   *
   * @param {object} application Application or draft to validate.
   * @param {string | string[] | object} [scopeOrOptions] Scope or options.
   * @param {object} [maybeOptions] Validation options.
   * @returns {object} Canonical validation result.
   */
  validateApplication(
    application,
    scopeOrOptions = VALIDATION_SCOPES.FULL,
    maybeOptions = {},
  ) {
    if (!isObject(application)) {
      throw createValidationServiceError(
        VALIDATION_SERVICE_ERROR_CODES.INVALID_APPLICATION,
        'An onboarding application must be an object.',
        null,
      );
    }

    const normalizedArguments = normalizeValidationArguments(
      scopeOrOptions,
      maybeOptions,
    );
    const options = {
      ...this.defaultOptions,
      ...normalizedArguments.options,
    };
    const scope = normalizeScope(
      normalizedArguments.scope,
      options,
    );
    const ruleFilter = validateRuleFilter(options.ruleIds);
    const schemaResult =
      validationApplicationSchema.safeParse(application);
    const parsedApplication = schemaResult.success
      ? schemaResult.data
      : application;
    const issues = schemaResult.success
      ? []
      : formatSchemaIssues(schemaResult.error);
    const derivedValues = {};
    const context = Object.freeze({
      options,
      scope,
      service: this,
    });

    this.rules
      .filter(
        (rule) =>
          ruleIsSelected(rule, scope) &&
          (!ruleFilter || ruleFilter.has(rule.id)),
      )
      .forEach((rule) => {
        let result;

        try {
          result = normalizeRuleResult(
            rule.evaluate(parsedApplication, context),
          );
        } catch (error) {
          if (
            error?.name === 'ValidationServiceError' ||
            error instanceof TypeError ||
            error instanceof RangeError
          ) {
            throw error;
          }

          throw createValidationServiceError(
            VALIDATION_SERVICE_ERROR_CODES.INVALID_RULE,
            `Validation rule failed: ${rule.id}`,
            { ruleId: rule.id },
            error,
          );
        }

        issues.push(...result.issues);
        mergeDerivedValues(
          derivedValues,
          result.derivedValues,
        );
      });

    const result = createValidationResult(
      issues,
      derivedValues,
      toIsoTimestamp(options.checkedAt ?? this.clock()),
    );

    if (options.persist === true) {
      this.persistResult(application, result, options);
    }

    return cloneValue(result);
  }

  /**
   * Alias for validateApplication.
   *
   * @param {object} application Application to validate.
   * @param {string | string[] | object} [scopeOrOptions] Scope or options.
   * @param {object} [maybeOptions] Validation options.
   * @returns {object} Validation result.
   */
  validate(
    application,
    scopeOrOptions = VALIDATION_SCOPES.FULL,
    maybeOptions = {},
  ) {
    return this.validateApplication(
      application,
      scopeOrOptions,
      maybeOptions,
    );
  }

  /**
   * Validates only selected application sections.
   *
   * @param {object} application Application to validate.
   * @param {string[]} sections Section identifiers.
   * @param {object} [options] Validation options.
   * @returns {object} Validation result.
   */
  validateSections(application, sections, options = {}) {
    return this.validateApplication(application, {
      ...assertOptions(options, 'Section validation options'),
      scope: VALIDATION_SCOPES.SECTIONAL,
      sections,
    });
  }

  /**
   * Runs submission-gating validation.
   *
   * @param {object} application Application to validate.
   * @param {object} [options] Validation options.
   * @returns {object} Submission validation result.
   */
  validateForSubmission(application, options = {}) {
    return this.validateApplication(application, {
      ...assertOptions(options, 'Submission validation options'),
      scope: VALIDATION_SCOPES.SUBMISSION,
      requirePayload: options.requirePayload ?? false,
    });
  }

  /**
   * Validates a supported contract change request.
   *
   * @param {object} changeRequest Change request.
   * @param {object} [options] Validation options.
   * @returns {object} Validation result.
   */
  validateChangeRequest(changeRequest, options = {}) {
    if (!isObject(changeRequest)) {
      throw createValidationServiceError(
        VALIDATION_SERVICE_ERROR_CODES.INVALID_CHANGE_REQUEST,
        'A contract change request must be an object.',
        null,
      );
    }

    const normalizedOptions = assertOptions(
      options,
      'Change request validation options',
    );
    const schemaResult =
      validationChangeRequestSchema.safeParse(changeRequest);
    const issues = schemaResult.success
      ? []
      : formatSchemaIssues(schemaResult.error, ['changeRequest']);
    const requestedValues =
      changeRequest.requestedValues ?? changeRequest.payload;
    const normalizedChangeType = normalizeIdentifierForLookup(
      changeRequest.changeType,
    );

    if (!normalizedChangeType) {
      issues.push(
        createIssue({
          code:
            ONBOARDING_VALIDATION_CODES.CHANGE_TYPE_REQUIRED,
          message: 'A contract change type is required.',
          path: ['changeType'],
          field: 'changeType',
        }),
      );
    } else if (
      !SUPPORTED_CHANGE_TYPES.includes(normalizedChangeType)
    ) {
      issues.push(
        createIssue({
          code:
            ONBOARDING_VALIDATION_CODES.CHANGE_TYPE_UNSUPPORTED,
          message: `Unsupported contract change type: ${changeRequest.changeType}.`,
          path: ['changeType'],
          field: 'changeType',
        }),
      );
    }

    if (
      !isObject(requestedValues) ||
      Object.keys(requestedValues).length === 0
    ) {
      issues.push(
        createIssue({
          code:
            ONBOARDING_VALIDATION_CODES.CHANGE_VALUES_REQUIRED,
          message: 'Requested contract change values are required.',
          path: ['requestedValues'],
          field: 'requestedValues',
        }),
      );
    }

    let derivedValues = {
      changeType: normalizedChangeType ?? null,
      supportedChange:
        normalizedChangeType !== undefined &&
        SUPPORTED_CHANGE_TYPES.includes(normalizedChangeType),
    };

    if (
      isObject(normalizedOptions.application) &&
      isObject(requestedValues)
    ) {
      const applicationResult = this.validateApplication(
        {
          ...cloneValue(normalizedOptions.application),
          ...cloneValue(requestedValues),
        },
        {
          ...normalizedOptions,
          persist: false,
          scope: VALIDATION_SCOPES.FULL,
        },
      );

      issues.push(...applicationResult.issues);
      derivedValues = mergeDerivedValues(
        derivedValues,
        applicationResult.derivedValues,
      );
    }

    const result = createValidationResult(
      issues,
      derivedValues,
      toIsoTimestamp(
        normalizedOptions.checkedAt ?? this.clock(),
      ),
    );

    if (
      normalizedOptions.persist === true &&
      this.repository &&
      changeRequest.trackingId
    ) {
      this.persistResult(changeRequest, result, normalizedOptions);
    }

    return cloneValue(result);
  }

  /**
   * Returns the configured rule registry.
   *
   * @returns {Readonly<Record<string, object>>} Rules keyed by identifier.
   */
  getRuleRegistry() {
    return Object.freeze(
      Object.fromEntries(
        this.rules.map((rule) => [rule.id, rule]),
      ),
    );
  }

  /**
   * Returns rules associated with a section.
   *
   * @param {string} section Section identifier.
   * @returns {object[]} Matching rules.
   */
  getRulesForSection(section) {
    const normalizedSection = normalizeIdentifierForLookup(section);

    if (!normalizedSection) {
      throw new TypeError(
        'A validation section identifier is required.',
      );
    }

    return this.rules.filter((rule) =>
      rule.sections.includes(normalizedSection),
    );
  }

  persistResult(application, result, options) {
    if (!this.repository) {
      throw createValidationServiceError(
        VALIDATION_SERVICE_ERROR_CODES.PERSISTENCE_FAILED,
        'A validation repository is required to persist results.',
        null,
      );
    }

    const trackingId = normalizeIdentifier(application.trackingId);

    if (!trackingId) {
      throw createValidationServiceError(
        VALIDATION_SERVICE_ERROR_CODES.PERSISTENCE_FAILED,
        'A tracking identifier is required to persist validation.',
        null,
      );
    }

    try {
      this.repository.saveValidationResult(trackingId, result, {
        applicationId: application.applicationId ?? null,
        applicationVersion:
          options.applicationVersion ?? application.version,
        status:
          options.status ??
          (result.valid
            ? ONBOARDING_STATUSES.SUBMITTED
            : ONBOARDING_STATUSES.ACTION_REQUIRED),
        schemaErrors: result.issues.filter(
          (issue) =>
            issue.code ===
            ONBOARDING_VALIDATION_CODES.PAYLOAD_INVALID,
        ),
        derivedValues: result.derivedValues,
        validatedSections: options.sections ?? [],
        validationHash: options.validationHash,
        expectedUpdatedAt: options.expectedUpdatedAt,
      });
    } catch (error) {
      throw createValidationServiceError(
        VALIDATION_SERVICE_ERROR_CODES.PERSISTENCE_FAILED,
        'Unable to persist the validation result.',
        { trackingId },
        error,
      );
    }
  }
}

/**
 * Creates an onboarding validation service.
 *
 * @param {ConstructorParameters<typeof ValidationService>[0]} [options]
 * Validation service options.
 * @returns {ValidationService} Validation service instance.
 */
export function createValidationService(options = {}) {
  return new ValidationService(options);
}

/**
 * Validates an application with a newly created service.
 *
 * @param {object} application Application to validate.
 * @param {string | string[] | object} [scopeOrOptions] Scope or options.
 * @param {object} [options] Validation options.
 * @returns {object} Validation result.
 */
export function validateApplication(
  application,
  scopeOrOptions = VALIDATION_SCOPES.FULL,
  options = {},
) {
  return createValidationService().validateApplication(
    application,
    scopeOrOptions,
    options,
  );
}

/**
 * Validates a contract change with a newly created service.
 *
 * @param {object} changeRequest Change request.
 * @param {object} [options] Validation options.
 * @returns {object} Validation result.
 */
export function validateChangeRequest(changeRequest, options = {}) {
  return createValidationService().validateChangeRequest(
    changeRequest,
    options,
  );
}

export const OnboardingValidationService = ValidationService;
export const ValidationEngine = ValidationService;
export const createValidationEngine = createValidationService;
export const businessRuleRegistry = VALIDATION_RULE_REGISTRY;
export const validationRuleRegistry = VALIDATION_RULE_REGISTRY;

export default ValidationService;