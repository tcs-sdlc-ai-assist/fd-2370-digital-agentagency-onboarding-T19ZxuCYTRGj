export const JOURNEY_DEFINITION_ERROR_CODES = Object.freeze({
  INVALID_DEFINITION: 'JOURNEY_DEFINITION_INVALID',
  INVALID_STEP: 'JOURNEY_STEP_INVALID',
  INVALID_OPTIONS: 'JOURNEY_DEFINITION_OPTIONS_INVALID',
  UNSUPPORTED_JOURNEY: 'JOURNEY_TYPE_UNSUPPORTED',
  STEP_NOT_FOUND: 'JOURNEY_STEP_NOT_FOUND',
});

export const JOURNEY_TYPES = Object.freeze({
  GA_AGENCY: 'ga_agency',
  AGENCY: 'agency',
  AGENT_CONTRACTING: 'agent_contracting',
  INDIVIDUAL: 'individual',
  CORPORATE: 'corporate',
  PRINCIPAL: 'principal',
  FINANCIAL_INSTITUTION: 'financial_institution',
  FINANCIAL_INSTITUTION_EMPLOYEE: 'financial_institution_employee',
  REGISTERED_REP: 'registered_rep',
  REGISTERED_REPRESENTATIVE: 'registered_representative',
});

export const JOURNEY_STEP_IDS = Object.freeze({
  START: 'start',
  SOURCE_REVIEW: 'source-review',
  ORGANIZATION: 'organization',
  AGENCY: 'agency',
  APPLICANT: 'applicant',
  PRINCIPALS: 'principals',
  LICENSING: 'licensing',
  REGISTRATION: 'registration',
  CONTRACT: 'contract',
  COMMISSION: 'commission',
  BANKING: 'banking',
  ERRORS_AND_OMISSIONS: 'errors-and-omissions',
  HIERARCHY: 'hierarchy',
  DOCUMENTS: 'documents',
  ATTESTATIONS: 'attestations',
  REVIEW: 'review',
  SIGNATURE: 'signature',
  COMPLETE: 'complete',
});

const JOURNEY_TYPE_ALIASES = Object.freeze({
  ga: JOURNEY_TYPES.GA_AGENCY,
  general_agency: JOURNEY_TYPES.GA_AGENCY,
  generalagency: JOURNEY_TYPES.GA_AGENCY,
  ga_agency: JOURNEY_TYPES.GA_AGENCY,
  agency: JOURNEY_TYPES.AGENCY,
  agency_contracting: JOURNEY_TYPES.AGENCY,
  agent: JOURNEY_TYPES.AGENT_CONTRACTING,
  agent_contracting: JOURNEY_TYPES.AGENT_CONTRACTING,
  individual: JOURNEY_TYPES.AGENT_CONTRACTING,
  individual_producer: JOURNEY_TYPES.AGENT_CONTRACTING,
  producer: JOURNEY_TYPES.AGENT_CONTRACTING,
  corporate: JOURNEY_TYPES.CORPORATE,
  corporate_contracting: JOURNEY_TYPES.CORPORATE,
  organization: JOURNEY_TYPES.CORPORATE,
  entity: JOURNEY_TYPES.CORPORATE,
  principal: JOURNEY_TYPES.PRINCIPAL,
  licensed_principal: JOURNEY_TYPES.PRINCIPAL,
  financial_institution: JOURNEY_TYPES.FINANCIAL_INSTITUTION,
  financial_institution_employee:
    JOURNEY_TYPES.FINANCIAL_INSTITUTION,
  fi: JOURNEY_TYPES.FINANCIAL_INSTITUTION,
  fi_employee: JOURNEY_TYPES.FINANCIAL_INSTITUTION,
  registered_rep: JOURNEY_TYPES.REGISTERED_REP,
  registered_representative: JOURNEY_TYPES.REGISTERED_REP,
  rep: JOURNEY_TYPES.REGISTERED_REP,
});

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertOptions(options, description = 'Journey options') {
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

function normalizeToken(value) {
  return normalizeIdentifier(value, 'Journey type')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
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

function deepFreeze(value, visited = new WeakSet()) {
  if (
    value === null ||
    typeof value !== 'object' ||
    visited.has(value)
  ) {
    return value;
  }

  visited.add(value);

  Object.values(value).forEach((nestedValue) => {
    deepFreeze(nestedValue, visited);
  });

  return Object.freeze(value);
}

function createJourneyDefinitionError(
  code,
  message,
  details,
  cause,
) {
  const error = new Error(message, {
    ...(cause === undefined ? {} : { cause }),
  });

  error.name = 'JourneyDefinitionError';
  error.code = code;
  error.details = details ?? null;
  error.recoverable = true;

  return error;
}

function getValueAtPath(value, path) {
  return path.split('.').reduce((currentValue, segment) => {
    if (currentValue === null || currentValue === undefined) {
      return undefined;
    }

    return currentValue[segment];
  }, value);
}

function setValueAtPath(target, path, value) {
  const segments = path.split('.');
  let current = target;

  segments.forEach((segment, index) => {
    if (index === segments.length - 1) {
      current[segment] = cloneValue(value);
      return;
    }

    if (!isObject(current[segment])) {
      current[segment] = {};
    }

    current = current[segment];
  });
}

function getFirstValue(source, paths) {
  for (const path of paths) {
    const value = getValueAtPath(source, path);

    if (hasMeaningfulValue(value)) {
      return value;
    }
  }

  return undefined;
}

function hasMeaningfulValue(value) {
  if (value === null || value === undefined) {
    return false;
  }

  if (typeof value === 'string') {
    return value.trim() !== '';
  }

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  if (isObject(value)) {
    return Object.keys(value).length > 0;
  }

  return true;
}

function normalizeFieldList(fields, description) {
  if (!Array.isArray(fields)) {
    throw new TypeError(`${description} must be an array.`);
  }

  return Object.freeze(
    [
      ...new Set(
        fields.map((field) =>
          normalizeIdentifier(field, `${description} entry`),
        ),
      ),
    ],
  );
}

function getApplicationPayload(application) {
  if (!isObject(application)) {
    return {};
  }

  return (
    application.formState ??
    application.applicationPayload ??
    application.payload ??
    application
  );
}

function readApplicationValue(application, path) {
  const payload = getApplicationPayload(application);

  return getFirstValue(application, [
    path,
    `formState.${path}`,
    `applicationPayload.${path}`,
    `payload.${path}`,
  ]) ?? getValueAtPath(payload, path);
}

function createFieldPrefill(fields) {
  const normalizedFields = normalizeFieldList(
    fields,
    'Journey prefill fields',
  );

  return (application) => {
    const prefill = {};

    normalizedFields.forEach((field) => {
      const value = readApplicationValue(application, field);

      if (value !== undefined) {
        setValueAtPath(prefill, field, value);
      }
    });

    return prefill;
  };
}

function isCorporateApplication(application) {
  const applicantType = normalizeOptionalToken(
    readApplicationValue(application, 'applicant.type') ??
      readApplicationValue(application, 'organization.type'),
  );
  const contractType = normalizeOptionalToken(
    readApplicationValue(application, 'contractType') ??
      readApplicationValue(application, 'contract.type'),
  );

  return (
    applicantType === 'organization' ||
    ['agency', 'corporate', 'entity', 'organization'].includes(
      contractType,
    )
  );
}

function isRegisteredRepresentative(application) {
  const contractType = normalizeOptionalToken(
    readApplicationValue(application, 'contractType') ??
      readApplicationValue(application, 'contract.type'),
  );
  const journeyType = normalizeOptionalToken(application?.journeyType);

  return (
    journeyType === JOURNEY_TYPES.REGISTERED_REP ||
    ['registered_rep', 'registered_representative'].includes(
      contractType,
    )
  );
}

function isFinancialInstitutionApplication(application) {
  const contractType = normalizeOptionalToken(
    readApplicationValue(application, 'contractType') ??
      readApplicationValue(application, 'contract.type'),
  );
  const agencyType = normalizeOptionalToken(
    readApplicationValue(application, 'agencyType') ??
      readApplicationValue(application, 'agency.type'),
  );
  const journeyType = normalizeOptionalToken(application?.journeyType);

  return (
    journeyType === JOURNEY_TYPES.FINANCIAL_INSTITUTION ||
    contractType === 'financial_institution_employee' ||
    agencyType === 'financial_institution'
  );
}

function normalizeOptionalToken(value) {
  if (
    value === null ||
    value === undefined ||
    String(value).trim() === ''
  ) {
    return undefined;
  }

  return String(value)
    .trim()
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function requiresLicensing(application) {
  const contract = readApplicationValue(application, 'contract');
  const contractType = normalizeOptionalToken(
    readApplicationValue(application, 'contractType') ??
      contract?.type,
  );

  if (
    contract?.requiresLicense === false ||
    readApplicationValue(application, 'licensing.required') === false
  ) {
    return false;
  }

  return !['referral', 'unlicensed'].includes(contractType);
}

function requiresBanking(application) {
  if (
    readApplicationValue(application, 'banking.required') === false ||
    readApplicationValue(application, 'commission.payable') === false
  ) {
    return false;
  }

  return !isFinancialInstitutionApplication(application);
}

function requiresErrorsAndOmissions(application) {
  const explicitRequirement = readApplicationValue(
    application,
    'errorsAndOmissions.required',
  );

  if (typeof explicitRequirement === 'boolean') {
    return explicitRequirement;
  }

  const advanceCommission = readApplicationValue(
    application,
    'contract.advanceCommission',
  );
  const residenceState = String(
    readApplicationValue(application, 'agent.residenceState') ??
      readApplicationValue(application, 'applicant.residenceState') ??
      readApplicationValue(application, 'licensing.residentState') ??
      '',
  ).toUpperCase();

  return advanceCommission === true || ['RI', 'UT'].includes(residenceState);
}

function requiresHierarchy(application) {
  const explicitRequirement = readApplicationValue(
    application,
    'hierarchy.required',
  );

  if (typeof explicitRequirement === 'boolean') {
    return explicitRequirement;
  }

  return !isRegisteredRepresentative(application);
}

function normalizeStep(step) {
  if (!isObject(step)) {
    throw createJourneyDefinitionError(
      JOURNEY_DEFINITION_ERROR_CODES.INVALID_STEP,
      'A journey step must be an object.',
      null,
    );
  }

  const id = normalizeIdentifier(step.id, 'Journey step identifier');
  const title = normalizeIdentifier(step.title, 'Journey step title');

  if (
    step.when !== undefined &&
    typeof step.when !== 'function'
  ) {
    throw createJourneyDefinitionError(
      JOURNEY_DEFINITION_ERROR_CODES.INVALID_STEP,
      `Journey step "${id}" has an invalid when predicate.`,
      { stepId: id },
    );
  }

  if (
    step.skipWhen !== undefined &&
    typeof step.skipWhen !== 'function'
  ) {
    throw createJourneyDefinitionError(
      JOURNEY_DEFINITION_ERROR_CODES.INVALID_STEP,
      `Journey step "${id}" has an invalid skip predicate.`,
      { stepId: id },
    );
  }

  if (
    step.prefill !== undefined &&
    typeof step.prefill !== 'function'
  ) {
    throw createJourneyDefinitionError(
      JOURNEY_DEFINITION_ERROR_CODES.INVALID_STEP,
      `Journey step "${id}" has an invalid prefill function.`,
      { stepId: id },
    );
  }

  return Object.freeze({
    id,
    title,
    description: step.description ?? '',
    section: step.section ?? id,
    requiredFields: normalizeFieldList(
      step.requiredFields ?? [],
      `Required fields for journey step "${id}"`,
    ),
    prefillFields: normalizeFieldList(
      step.prefillFields ?? step.requiredFields ?? [],
      `Prefill fields for journey step "${id}"`,
    ),
    skippable: step.skippable ?? true,
    navigationOnly: step.navigationOnly ?? false,
    when: step.when ?? (() => true),
    skipWhen: step.skipWhen,
    prefill:
      step.prefill ??
      createFieldPrefill(
        step.prefillFields ?? step.requiredFields ?? [],
      ),
    metadata: deepFreeze(cloneValue(step.metadata ?? {})),
  });
}

function createStep({
  id,
  title,
  description,
  section,
  requiredFields = [],
  prefillFields,
  skippable = true,
  navigationOnly = false,
  when,
  skipWhen,
  metadata,
}) {
  return normalizeStep({
    id,
    title,
    description,
    section,
    requiredFields,
    prefillFields,
    skippable,
    navigationOnly,
    when,
    skipWhen,
    metadata,
  });
}

const START_STEP = createStep({
  id: JOURNEY_STEP_IDS.START,
  title: 'Start',
  description: 'Review the journey before entering onboarding details.',
  section: 'start',
  skippable: false,
  navigationOnly: true,
});

const SOURCE_REVIEW_STEP = createStep({
  id: JOURNEY_STEP_IDS.SOURCE_REVIEW,
  title: 'Source review',
  description: 'Review information imported from the source submission.',
  section: 'source',
  requiredFields: [
    'sourceMetadata.sourceChannel',
    'sourceMetadata.sourceFormat',
  ],
  prefillFields: [
    'submissionId',
    'sourceMetadata.sourceChannel',
    'sourceMetadata.sourceFormat',
    'sourceMetadata.fileName',
    'sourceMetadata.partnerCode',
  ],
});

const ORGANIZATION_STEP = createStep({
  id: JOURNEY_STEP_IDS.ORGANIZATION,
  title: 'Organization details',
  description: 'Capture the organization identity and contact details.',
  section: 'organization',
  requiredFields: ['organization.legalName'],
  prefillFields: [
    'organization',
    'applicant',
    'company',
    'carrierCode',
    'gaCode',
  ],
});

const AGENCY_STEP = createStep({
  id: JOURNEY_STEP_IDS.AGENCY,
  title: 'Agency details',
  description: 'Capture agency type, identity, and general agency details.',
  section: 'agency',
  requiredFields: ['agency.name', 'agency.type', 'gaCode'],
  prefillFields: ['agency', 'agencyType', 'gaCode'],
});

const APPLICANT_STEP = createStep({
  id: JOURNEY_STEP_IDS.APPLICANT,
  title: 'Applicant details',
  description: 'Capture the applicant identity and contact details.',
  section: 'identity',
  requiredFields: [
    'agent.firstName',
    'agent.lastName',
    'agent.npn',
  ],
  prefillFields: ['agent', 'applicant'],
});

const PRINCIPALS_STEP = createStep({
  id: JOURNEY_STEP_IDS.PRINCIPALS,
  title: 'Licensed principals',
  description:
    'Capture ownership and licensing eligibility for corporate principals.',
  section: 'principals',
  requiredFields: ['principals'],
  prefillFields: ['principals'],
  when: isCorporateApplication,
});

const LICENSING_STEP = createStep({
  id: JOURNEY_STEP_IDS.LICENSING,
  title: 'Licensing',
  description: 'Capture producer licensing and lines of authority.',
  section: 'licensing',
  requiredFields: [
    'licensing.residentState',
    'licensing.licenseNumber',
    'licensing.linesOfAuthority',
  ],
  prefillFields: ['licensing', 'agent.npn', 'applicant.npn'],
  when: requiresLicensing,
});

const REGISTRATION_STEP = createStep({
  id: JOURNEY_STEP_IDS.REGISTRATION,
  title: 'Registration',
  description: 'Capture registered-representative and broker-dealer details.',
  section: 'registration',
  requiredFields: ['agent.crd'],
  prefillFields: [
    'agent.crd',
    'agent.npn',
    'registration',
    'brokerDealer',
  ],
  when: isRegisteredRepresentative,
});

const CONTRACT_STEP = createStep({
  id: JOURNEY_STEP_IDS.CONTRACT,
  title: 'Contract details',
  description: 'Select contract type, level, carrier, and schedule.',
  section: 'contract',
  requiredFields: [
    'company',
    'contract.type',
    'contract.level',
    'contract.commissionSchedule',
  ],
  prefillFields: [
    'company',
    'carrierCode',
    'contractType',
    'contract',
  ],
});

const COMMISSION_STEP = createStep({
  id: JOURNEY_STEP_IDS.COMMISSION,
  title: 'Commission',
  description: 'Review commission and payment selections.',
  section: 'commission',
  requiredFields: ['contract.commissionSchedule'],
  prefillFields: ['contract', 'commission'],
});

const BANKING_STEP = createStep({
  id: JOURNEY_STEP_IDS.BANKING,
  title: 'Banking',
  description: 'Capture payment method and masked banking details.',
  section: 'banking',
  requiredFields: [
    'banking.paymentMethod',
    'banking.routingNumber',
    'banking.accountNumber',
  ],
  prefillFields: ['banking'],
  when: requiresBanking,
});

const ERRORS_AND_OMISSIONS_STEP = createStep({
  id: JOURNEY_STEP_IDS.ERRORS_AND_OMISSIONS,
  title: 'Errors and omissions',
  description: 'Capture required errors and omissions coverage.',
  section: 'errorsAndOmissions',
  requiredFields: ['errorsAndOmissions.policyNumber'],
  prefillFields: ['errorsAndOmissions'],
  when: requiresErrorsAndOmissions,
});

const HIERARCHY_STEP = createStep({
  id: JOURNEY_STEP_IDS.HIERARCHY,
  title: 'Hierarchy',
  description: 'Review the contracting and distribution hierarchy.',
  section: 'hierarchy',
  requiredFields: ['gaCode'],
  prefillFields: ['gaCode', 'hierarchy', 'agency'],
  when: requiresHierarchy,
});

const DOCUMENTS_STEP = createStep({
  id: JOURNEY_STEP_IDS.DOCUMENTS,
  title: 'Documents',
  description: 'Review required forms and generated documents.',
  section: 'documents',
  requiredFields: [],
  prefillFields: [
    'documents',
    'documentPackage',
    'requiredForms',
    'completedForms',
  ],
  skipWhen: (application) =>
    readApplicationValue(application, 'documents.required') === false,
});

const ATTESTATIONS_STEP = createStep({
  id: JOURNEY_STEP_IDS.ATTESTATIONS,
  title: 'Attestations',
  description: 'Complete required declarations and electronic consent.',
  section: 'attestations',
  requiredFields: [
    'attestations.backgroundQuestionsClear',
    'attestations.electronicDeliveryConsent',
  ],
  prefillFields: ['attestations'],
});

const REVIEW_STEP = createStep({
  id: JOURNEY_STEP_IDS.REVIEW,
  title: 'Review',
  description: 'Review all onboarding information before signing.',
  section: 'review',
  skippable: false,
  navigationOnly: true,
});

const SIGNATURE_STEP = createStep({
  id: JOURNEY_STEP_IDS.SIGNATURE,
  title: 'Signature',
  description: 'Provide electronic-signature consent and sign the package.',
  section: 'signature',
  requiredFields: [],
  prefillFields: ['signatures', 'signOff'],
  skippable: false,
});

const COMPLETE_STEP = createStep({
  id: JOURNEY_STEP_IDS.COMPLETE,
  title: 'Complete',
  description: 'Confirm the onboarding journey result.',
  section: 'complete',
  skippable: false,
  navigationOnly: true,
});

function createDefinition({
  type,
  label,
  description,
  aliases = [],
  steps,
  metadata = {},
}) {
  const normalizedType = normalizeToken(type);

  if (!Array.isArray(steps) || steps.length === 0) {
    throw createJourneyDefinitionError(
      JOURNEY_DEFINITION_ERROR_CODES.INVALID_DEFINITION,
      `Journey definition "${normalizedType}" must contain steps.`,
      { journeyType: normalizedType },
    );
  }

  const normalizedSteps = steps.map((step) =>
    Object.isFrozen(step) ? step : normalizeStep(step),
  );
  const identifiers = new Set();

  normalizedSteps.forEach((step) => {
    if (identifiers.has(step.id)) {
      throw createJourneyDefinitionError(
        JOURNEY_DEFINITION_ERROR_CODES.INVALID_DEFINITION,
        `Duplicate journey step identifier: ${step.id}`,
        {
          journeyType: normalizedType,
          stepId: step.id,
        },
      );
    }

    identifiers.add(step.id);
  });

  return deepFreeze({
    type: normalizedType,
    id: normalizedType,
    journeyType: normalizedType,
    label: normalizeIdentifier(label, 'Journey label'),
    description: description ?? '',
    aliases: [
      ...new Set(
        aliases.map((alias) => normalizeToken(alias)),
      ),
    ],
    steps: normalizedSteps,
    stepIds: normalizedSteps.map((step) => step.id),
    initialStepId: normalizedSteps[0].id,
    reviewStepId: identifiers.has(JOURNEY_STEP_IDS.REVIEW)
      ? JOURNEY_STEP_IDS.REVIEW
      : normalizedSteps.at(-1).id,
    completionStepId: identifiers.has(JOURNEY_STEP_IDS.COMPLETE)
      ? JOURNEY_STEP_IDS.COMPLETE
      : normalizedSteps.at(-1).id,
    metadata: cloneValue(metadata),
  });
}

export const GA_AGENCY_JOURNEY_DEFINITION = createDefinition({
  type: JOURNEY_TYPES.GA_AGENCY,
  label: 'General agency onboarding',
  description:
    'Guided onboarding for a general agency or agency organization.',
  aliases: ['ga', 'general_agency', 'generalagency'],
  steps: [
    START_STEP,
    SOURCE_REVIEW_STEP,
    ORGANIZATION_STEP,
    AGENCY_STEP,
    PRINCIPALS_STEP,
    LICENSING_STEP,
    CONTRACT_STEP,
    COMMISSION_STEP,
    BANKING_STEP,
    HIERARCHY_STEP,
    DOCUMENTS_STEP,
    ATTESTATIONS_STEP,
    REVIEW_STEP,
    SIGNATURE_STEP,
    COMPLETE_STEP,
  ],
  metadata: {
    applicantType: 'organization',
    supportsPrincipals: true,
  },
});

export const AGENCY_JOURNEY_DEFINITION = createDefinition({
  type: JOURNEY_TYPES.AGENCY,
  label: 'Agency onboarding',
  description: 'Guided onboarding for a contracting agency.',
  aliases: ['agency_contracting'],
  steps: [
    START_STEP,
    SOURCE_REVIEW_STEP,
    ORGANIZATION_STEP,
    AGENCY_STEP,
    PRINCIPALS_STEP,
    LICENSING_STEP,
    CONTRACT_STEP,
    COMMISSION_STEP,
    BANKING_STEP,
    HIERARCHY_STEP,
    DOCUMENTS_STEP,
    ATTESTATIONS_STEP,
    REVIEW_STEP,
    SIGNATURE_STEP,
    COMPLETE_STEP,
  ],
  metadata: {
    applicantType: 'organization',
    supportsPrincipals: true,
  },
});

export const INDIVIDUAL_JOURNEY_DEFINITION = createDefinition({
  type: JOURNEY_TYPES.AGENT_CONTRACTING,
  label: 'Individual producer onboarding',
  description: 'Guided onboarding for an individual producer.',
  aliases: ['agent', 'individual', 'individual_producer', 'producer'],
  steps: [
    START_STEP,
    SOURCE_REVIEW_STEP,
    AGENCY_STEP,
    APPLICANT_STEP,
    LICENSING_STEP,
    CONTRACT_STEP,
    COMMISSION_STEP,
    BANKING_STEP,
    ERRORS_AND_OMISSIONS_STEP,
    HIERARCHY_STEP,
    DOCUMENTS_STEP,
    ATTESTATIONS_STEP,
    REVIEW_STEP,
    SIGNATURE_STEP,
    COMPLETE_STEP,
  ],
  metadata: {
    applicantType: 'individual',
    supportsPrincipals: false,
  },
});

export const CORPORATE_JOURNEY_DEFINITION = createDefinition({
  type: JOURNEY_TYPES.CORPORATE,
  label: 'Corporate onboarding',
  description:
    'Guided onboarding for a corporate applicant and licensed principals.',
  aliases: ['corporate_contracting', 'organization', 'entity'],
  steps: [
    START_STEP,
    SOURCE_REVIEW_STEP,
    ORGANIZATION_STEP,
    AGENCY_STEP,
    PRINCIPALS_STEP,
    LICENSING_STEP,
    CONTRACT_STEP,
    COMMISSION_STEP,
    BANKING_STEP,
    HIERARCHY_STEP,
    DOCUMENTS_STEP,
    ATTESTATIONS_STEP,
    REVIEW_STEP,
    SIGNATURE_STEP,
    COMPLETE_STEP,
  ],
  metadata: {
    applicantType: 'organization',
    supportsPrincipals: true,
  },
});

export const PRINCIPAL_JOURNEY_DEFINITION = createDefinition({
  type: JOURNEY_TYPES.PRINCIPAL,
  label: 'Principal onboarding',
  description:
    'Guided onboarding for a licensed principal associated with an agency.',
  aliases: ['licensed_principal'],
  steps: [
    START_STEP,
    SOURCE_REVIEW_STEP,
    AGENCY_STEP,
    APPLICANT_STEP,
    LICENSING_STEP,
    CONTRACT_STEP,
    DOCUMENTS_STEP,
    ATTESTATIONS_STEP,
    REVIEW_STEP,
    SIGNATURE_STEP,
    COMPLETE_STEP,
  ],
  metadata: {
    applicantType: 'individual',
    principalJourney: true,
  },
});

export const FINANCIAL_INSTITUTION_JOURNEY_DEFINITION =
  createDefinition({
    type: JOURNEY_TYPES.FINANCIAL_INSTITUTION,
    label: 'Financial institution employee onboarding',
    description:
      'Guided onboarding for an employee sponsored by a financial institution.',
    aliases: [
      'financial_institution_employee',
      'fi',
      'fi_employee',
    ],
    steps: [
      START_STEP,
      SOURCE_REVIEW_STEP,
      AGENCY_STEP,
      APPLICANT_STEP,
      LICENSING_STEP,
      REGISTRATION_STEP,
      CONTRACT_STEP,
      COMMISSION_STEP,
      DOCUMENTS_STEP,
      ATTESTATIONS_STEP,
      REVIEW_STEP,
      SIGNATURE_STEP,
      COMPLETE_STEP,
    ],
    metadata: {
      applicantType: 'individual',
      sponsored: true,
    },
  });

export const REGISTERED_REP_JOURNEY_DEFINITION = createDefinition({
  type: JOURNEY_TYPES.REGISTERED_REP,
  label: 'Registered representative onboarding',
  description:
    'Guided onboarding for a registered representative using CRD verification.',
  aliases: ['registered_representative', 'rep'],
  steps: [
    START_STEP,
    SOURCE_REVIEW_STEP,
    AGENCY_STEP,
    APPLICANT_STEP,
    REGISTRATION_STEP,
    LICENSING_STEP,
    CONTRACT_STEP,
    COMMISSION_STEP,
    DOCUMENTS_STEP,
    ATTESTATIONS_STEP,
    REVIEW_STEP,
    SIGNATURE_STEP,
    COMPLETE_STEP,
  ],
  metadata: {
    applicantType: 'individual',
    backgroundExempt: true,
    requiresCrd: true,
  },
});

export const JOURNEY_DEFINITIONS = Object.freeze({
  [JOURNEY_TYPES.GA_AGENCY]: GA_AGENCY_JOURNEY_DEFINITION,
  [JOURNEY_TYPES.AGENCY]: AGENCY_JOURNEY_DEFINITION,
  [JOURNEY_TYPES.AGENT_CONTRACTING]:
    INDIVIDUAL_JOURNEY_DEFINITION,
  [JOURNEY_TYPES.CORPORATE]: CORPORATE_JOURNEY_DEFINITION,
  [JOURNEY_TYPES.PRINCIPAL]: PRINCIPAL_JOURNEY_DEFINITION,
  [JOURNEY_TYPES.FINANCIAL_INSTITUTION]:
    FINANCIAL_INSTITUTION_JOURNEY_DEFINITION,
  [JOURNEY_TYPES.REGISTERED_REP]:
    REGISTERED_REP_JOURNEY_DEFINITION,
});

export const JOURNEY_DEFINITION_REGISTRY = JOURNEY_DEFINITIONS;

function resolveJourneyType(value) {
  const normalizedType = normalizeToken(value);

  return (
    JOURNEY_TYPE_ALIASES[normalizedType] ??
    (Object.hasOwn(JOURNEY_DEFINITIONS, normalizedType)
      ? normalizedType
      : undefined)
  );
}

/**
 * Returns the canonical journey type for a supported alias.
 *
 * @param {string} journeyType Journey type or alias.
 * @returns {string} Canonical journey type.
 */
export function normalizeJourneyType(journeyType) {
  const resolvedType = resolveJourneyType(journeyType);

  if (!resolvedType) {
    throw createJourneyDefinitionError(
      JOURNEY_DEFINITION_ERROR_CODES.UNSUPPORTED_JOURNEY,
      `Unsupported journey type: ${journeyType}.`,
      {
        journeyType: String(journeyType),
        supportedJourneyTypes: Object.keys(JOURNEY_DEFINITIONS),
      },
    );
  }

  return resolvedType;
}

/**
 * Infers a journey type from normalized onboarding data.
 *
 * @param {object} application Onboarding application or normalized payload.
 * @returns {string} Canonical journey type.
 */
export function inferJourneyType(application) {
  if (!isObject(application)) {
    throw new TypeError(
      'An onboarding application must be an object.',
    );
  }

  if (application.journeyType) {
    const resolvedType = resolveJourneyType(application.journeyType);

    if (resolvedType) {
      return resolvedType;
    }
  }

  if (isRegisteredRepresentative(application)) {
    return JOURNEY_TYPES.REGISTERED_REP;
  }

  if (isFinancialInstitutionApplication(application)) {
    return JOURNEY_TYPES.FINANCIAL_INSTITUTION;
  }

  if (isCorporateApplication(application)) {
    const agencyType = normalizeOptionalToken(
      readApplicationValue(application, 'agencyType') ??
        readApplicationValue(application, 'agency.type'),
    );

    return agencyType === 'general_agency'
      ? JOURNEY_TYPES.GA_AGENCY
      : JOURNEY_TYPES.CORPORATE;
  }

  return JOURNEY_TYPES.AGENT_CONTRACTING;
}

/**
 * Returns a declarative journey definition.
 *
 * @param {string} journeyType Journey type or alias.
 * @returns {object} Journey definition.
 */
export function getJourneyDefinition(journeyType) {
  return JOURNEY_DEFINITIONS[normalizeJourneyType(journeyType)];
}

/**
 * Returns a journey definition inferred from an application.
 *
 * @param {object} application Onboarding application.
 * @returns {object} Journey definition.
 */
export function getJourneyDefinitionForApplication(application) {
  return getJourneyDefinition(inferJourneyType(application));
}

/**
 * Returns a step from a journey definition.
 *
 * @param {string} journeyType Journey type.
 * @param {string} stepId Step identifier.
 * @returns {object} Journey step.
 */
export function getJourneyStep(journeyType, stepId) {
  const definition = getJourneyDefinition(journeyType);
  const normalizedStepId = normalizeIdentifier(
    stepId,
    'Journey step identifier',
  );
  const step = definition.steps.find(
    (candidate) => candidate.id === normalizedStepId,
  );

  if (!step) {
    throw createJourneyDefinitionError(
      JOURNEY_DEFINITION_ERROR_CODES.STEP_NOT_FOUND,
      `Journey step not found: ${normalizedStepId}.`,
      {
        journeyType: definition.type,
        stepId: normalizedStepId,
      },
    );
  }

  return step;
}

function allRequiredFieldsSatisfied(step, application) {
  return (
    step.requiredFields.length > 0 &&
    step.requiredFields.every((field) =>
      hasMeaningfulValue(readApplicationValue(application, field)),
    )
  );
}

/**
 * Evaluates whether a journey step applies.
 *
 * @param {object} step Journey step.
 * @param {object} application Onboarding application.
 * @param {object} [context] Predicate context.
 * @returns {boolean} Whether the step applies.
 */
export function isJourneyStepApplicable(
  step,
  application,
  context = {},
) {
  if (!isObject(step) || typeof step.when !== 'function') {
    throw new TypeError('A valid journey step is required.');
  }

  return step.when(
    application,
    assertOptions(context, 'Journey step context'),
  ) !== false;
}

/**
 * Evaluates whether a step can be skipped.
 *
 * A step is skipped when its condition does not apply, its explicit skip
 * predicate returns true, or all required fields are already populated.
 *
 * @param {object} step Journey step.
 * @param {object} application Onboarding application.
 * @param {{
 *   skipPrefilled?: boolean,
 *   completedSteps?: string[],
 *   forceIncludedSteps?: string[]
 * }} [options] Skip options.
 * @returns {boolean} Whether the step should be skipped.
 */
export function shouldSkipJourneyStep(
  step,
  application,
  options = {},
) {
  const normalizedOptions = assertOptions(
    options,
    'Journey step skip options',
  );

  if (!isObject(step) || typeof step.when !== 'function') {
    throw new TypeError('A valid journey step is required.');
  }

  if (
    Array.isArray(normalizedOptions.forceIncludedSteps) &&
    normalizedOptions.forceIncludedSteps.includes(step.id)
  ) {
    return false;
  }

  if (
    Array.isArray(normalizedOptions.completedSteps) &&
    normalizedOptions.completedSteps.includes(step.id)
  ) {
    return true;
  }

  if (!isJourneyStepApplicable(step, application, normalizedOptions)) {
    return true;
  }

  if (
    typeof step.skipWhen === 'function' &&
    step.skipWhen(application, normalizedOptions) === true
  ) {
    return true;
  }

  return (
    step.skippable &&
    !step.navigationOnly &&
    normalizedOptions.skipPrefilled !== false &&
    allRequiredFieldsSatisfied(step, application)
  );
}

function resolveDefinitionArguments(
  application,
  journeyTypeOrOptions,
  maybeOptions,
) {
  if (isObject(journeyTypeOrOptions)) {
    const options = assertOptions(
      journeyTypeOrOptions,
      'Journey definition options',
    );

    return {
      definition: getJourneyDefinition(
        options.journeyType ?? inferJourneyType(application),
      ),
      options,
    };
  }

  return {
    definition: getJourneyDefinition(
      journeyTypeOrOptions ?? inferJourneyType(application),
    ),
    options: assertOptions(
      maybeOptions,
      'Journey definition options',
    ),
  };
}

/**
 * Computes skipped journey step identifiers.
 *
 * @param {object} application Onboarding application or normalized payload.
 * @param {string | object} [journeyTypeOrOptions] Journey type or options.
 * @param {object} [maybeOptions] Skip options.
 * @returns {string[]} Skipped step identifiers.
 */
export function computeSkippedSteps(
  application,
  journeyTypeOrOptions,
  maybeOptions = {},
) {
  if (!isObject(application)) {
    throw new TypeError(
      'An onboarding application must be an object.',
    );
  }

  const { definition, options } = resolveDefinitionArguments(
    application,
    journeyTypeOrOptions,
    maybeOptions,
  );

  return definition.steps
    .filter((step) =>
      shouldSkipJourneyStep(step, application, options),
    )
    .map((step) => step.id);
}

/**
 * Returns journey steps that should be presented to the user.
 *
 * @param {object} application Onboarding application.
 * @param {string | object} [journeyTypeOrOptions] Journey type or options.
 * @param {object} [maybeOptions] Step options.
 * @returns {object[]} Active journey steps.
 */
export function getActiveJourneySteps(
  application,
  journeyTypeOrOptions,
  maybeOptions = {},
) {
  const { definition, options } = resolveDefinitionArguments(
    application,
    journeyTypeOrOptions,
    maybeOptions,
  );
  const skippedSteps = new Set(
    computeSkippedSteps(application, {
      ...options,
      journeyType: definition.type,
    }),
  );

  return definition.steps.filter(
    (step) => !skippedSteps.has(step.id),
  );
}

/**
 * Builds prefill data for a journey step.
 *
 * @param {string} journeyType Journey type.
 * @param {string} stepId Step identifier.
 * @param {object} application Onboarding application.
 * @param {object} [context] Prefill context.
 * @returns {object} Step prefill data.
 */
export function getJourneyStepPrefill(
  journeyType,
  stepId,
  application,
  context = {},
) {
  const step = getJourneyStep(journeyType, stepId);
  const prefill = step.prefill(
    application,
    assertOptions(context, 'Journey prefill context'),
  );

  if (!isObject(prefill)) {
    throw createJourneyDefinitionError(
      JOURNEY_DEFINITION_ERROR_CODES.INVALID_STEP,
      `Journey step "${step.id}" returned invalid prefill data.`,
      {
        journeyType: normalizeJourneyType(journeyType),
        stepId: step.id,
      },
    );
  }

  return cloneValue(prefill);
}

/**
 * Builds prefill data keyed by journey step identifier.
 *
 * @param {object} application Onboarding application.
 * @param {string | object} [journeyTypeOrOptions] Journey type or options.
 * @param {object} [maybeOptions] Prefill options.
 * @returns {Record<string, object>} Step prefill data.
 */
export function buildJourneyPrefill(
  application,
  journeyTypeOrOptions,
  maybeOptions = {},
) {
  if (!isObject(application)) {
    throw new TypeError(
      'An onboarding application must be an object.',
    );
  }

  const { definition, options } = resolveDefinitionArguments(
    application,
    journeyTypeOrOptions,
    maybeOptions,
  );

  return Object.fromEntries(
    definition.steps.map((step) => [
      step.id,
      cloneValue(step.prefill(application, options)),
    ]),
  );
}

/**
 * Returns navigation details for a journey.
 *
 * @param {object} application Onboarding application.
 * @param {string} currentStepId Current step identifier.
 * @param {string | object} [journeyTypeOrOptions] Journey type or options.
 * @param {object} [maybeOptions] Navigation options.
 * @returns {{currentStep: object, previousStep: object | null, nextStep: object | null}}
 * Journey navigation details.
 */
export function getJourneyNavigation(
  application,
  currentStepId,
  journeyTypeOrOptions,
  maybeOptions = {},
) {
  const { definition, options } = resolveDefinitionArguments(
    application,
    journeyTypeOrOptions,
    maybeOptions,
  );
  const activeSteps = getActiveJourneySteps(application, {
    ...options,
    journeyType: definition.type,
  });
  const normalizedStepId = normalizeIdentifier(
    currentStepId,
    'Current journey step identifier',
  );
  const currentIndex = activeSteps.findIndex(
    (step) => step.id === normalizedStepId,
  );

  if (currentIndex < 0) {
    throw createJourneyDefinitionError(
      JOURNEY_DEFINITION_ERROR_CODES.STEP_NOT_FOUND,
      `Active journey step not found: ${normalizedStepId}.`,
      {
        journeyType: definition.type,
        stepId: normalizedStepId,
      },
    );
  }

  return Object.freeze({
    currentStep: activeSteps[currentIndex],
    previousStep: activeSteps[currentIndex - 1] ?? null,
    nextStep: activeSteps[currentIndex + 1] ?? null,
  });
}

/**
 * Registry for declarative journey definitions.
 */
export class JourneyDefinitionRegistry {
  /**
   * @param {Record<string, object>} [definitions] Journey definitions.
   */
  constructor(definitions = JOURNEY_DEFINITIONS) {
    if (!isObject(definitions)) {
      throw new TypeError('Journey definitions must be an object.');
    }

    const normalizedDefinitions = {};

    Object.values(definitions).forEach((definition) => {
      if (
        !isObject(definition) ||
        !Array.isArray(definition.steps)
      ) {
        throw createJourneyDefinitionError(
          JOURNEY_DEFINITION_ERROR_CODES.INVALID_DEFINITION,
          'The journey definition registry contains an invalid definition.',
          null,
        );
      }

      const normalizedDefinition = createDefinition({
        type: definition.type ?? definition.journeyType ?? definition.id,
        label: definition.label,
        description: definition.description,
        aliases: definition.aliases,
        steps: definition.steps,
        metadata: definition.metadata,
      });

      normalizedDefinitions[normalizedDefinition.type] =
        normalizedDefinition;
    });

    this.definitions = Object.freeze(normalizedDefinitions);
  }

  /**
   * Returns whether a journey type is registered.
   *
   * @param {string} journeyType Journey type.
   * @returns {boolean} Whether the journey is registered.
   */
  has(journeyType) {
    try {
      const normalizedType = normalizeToken(journeyType);
      const directMatch = Object.hasOwn(
        this.definitions,
        normalizedType,
      );

      if (directMatch) {
        return true;
      }

      return Object.values(this.definitions).some(
        (definition) =>
          definition.aliases.includes(normalizedType),
      );
    } catch {
      return false;
    }
  }

  /**
   * Returns a registered journey definition.
   *
   * @param {string} journeyType Journey type or alias.
   * @returns {object} Journey definition.
   */
  get(journeyType) {
    const normalizedType = normalizeToken(journeyType);
    const definition =
      this.definitions[normalizedType] ??
      Object.values(this.definitions).find((candidate) =>
        candidate.aliases.includes(normalizedType),
      );

    if (!definition) {
      throw createJourneyDefinitionError(
        JOURNEY_DEFINITION_ERROR_CODES.UNSUPPORTED_JOURNEY,
        `Unsupported journey type: ${journeyType}.`,
        {
          journeyType: String(journeyType),
          supportedJourneyTypes: this.listTypes(),
        },
      );
    }

    return definition;
  }

  /**
   * Infers and returns a journey definition for an application.
   *
   * @param {object} application Onboarding application.
   * @returns {object} Journey definition.
   */
  resolve(application) {
    return this.get(inferJourneyType(application));
  }

  /**
   * Lists registered canonical journey types.
   *
   * @returns {string[]} Journey types.
   */
  listTypes() {
    return Object.keys(this.definitions);
  }

  /**
   * Lists registered journey definitions.
   *
   * @returns {object[]} Journey definitions.
   */
  list() {
    return Object.values(this.definitions);
  }

  /**
   * Computes skipped steps using a registered definition.
   *
   * @param {object} application Onboarding application.
   * @param {string} [journeyType] Journey type.
   * @param {object} [options] Skip options.
   * @returns {string[]} Skipped step identifiers.
   */
  computeSkippedSteps(application, journeyType, options = {}) {
    const definition =
      journeyType === undefined
        ? this.resolve(application)
        : this.get(journeyType);

    return definition.steps
      .filter((step) =>
        shouldSkipJourneyStep(step, application, options),
      )
      .map((step) => step.id);
  }

  /**
   * Builds step prefill data using a registered definition.
   *
   * @param {object} application Onboarding application.
   * @param {string} [journeyType] Journey type.
   * @param {object} [options] Prefill options.
   * @returns {Record<string, object>} Step prefill data.
   */
  buildPrefill(application, journeyType, options = {}) {
    const definition =
      journeyType === undefined
        ? this.resolve(application)
        : this.get(journeyType);

    return Object.fromEntries(
      definition.steps.map((step) => [
        step.id,
        cloneValue(step.prefill(application, options)),
      ]),
    );
  }
}

/**
 * Creates a journey definition registry.
 *
 * @param {Record<string, object>} [definitions] Journey definitions.
 * @returns {JourneyDefinitionRegistry} Journey definition registry.
 */
export function createJourneyDefinitionRegistry(
  definitions = JOURNEY_DEFINITIONS,
) {
  return new JourneyDefinitionRegistry(definitions);
}

export const journeyDefinitionRegistry =
  createJourneyDefinitionRegistry();
export const journeyRegistry = journeyDefinitionRegistry;
export const getDefinition = getJourneyDefinition;
export const getDefinitionForApplication =
  getJourneyDefinitionForApplication;
export const getStep = getJourneyStep;
export const computeJourneySkippedSteps = computeSkippedSteps;
export const getJourneyPrefill = buildJourneyPrefill;
export const prefillJourney = buildJourneyPrefill;

export default JOURNEY_DEFINITIONS;