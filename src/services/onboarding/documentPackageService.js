import {
  DOCUMENT_ARTIFACT_STATUSES,
  DOCUMENT_PACKAGE_STATUSES,
  DOCUMENT_SIGNATURE_STATES,
  DocumentPackageRepository,
} from '../../repositories/documentPackageRepository.js';
import { toIsoTimestamp } from '../../utils/dates.js';
import { createDeterministicId } from '../../utils/ids.js';

export const DOCUMENT_PACKAGE_SERVICE_ERROR_CODES = Object.freeze({
  INVALID_OPTIONS: 'DOCUMENT_PACKAGE_SERVICE_INVALID_OPTIONS',
  INVALID_APPLICATION: 'DOCUMENT_PACKAGE_SERVICE_INVALID_APPLICATION',
  APPLICATION_NOT_FOUND: 'DOCUMENT_PACKAGE_SERVICE_APPLICATION_NOT_FOUND',
  PACKAGE_NOT_FOUND: 'DOCUMENT_PACKAGE_SERVICE_PACKAGE_NOT_FOUND',
  INVALID_REPOSITORY: 'DOCUMENT_PACKAGE_SERVICE_INVALID_REPOSITORY',
  INVALID_SIGNATURE: 'DOCUMENT_PACKAGE_SERVICE_INVALID_SIGNATURE',
  SIGNATURE_REQUIRED: 'DOCUMENT_PACKAGE_SERVICE_SIGNATURE_REQUIRED',
  PACKAGE_INCOMPLETE: 'DOCUMENT_PACKAGE_SERVICE_PACKAGE_INCOMPLETE',
  PERSISTENCE_FAILED: 'DOCUMENT_PACKAGE_SERVICE_PERSISTENCE_FAILED',
  AUDIT_FAILED: 'DOCUMENT_PACKAGE_SERVICE_AUDIT_FAILED',
});

export const DOCUMENT_FORM_CODES = Object.freeze({
  BK_12: 'BK-12',
  BK_14: 'BK-14',
  BK_23: 'BK-23',
  W_9: 'W-9',
  BIOGRAPHICAL: 'BIOGRAPHICAL',
  ADOPTION: 'ADOPTION',
  CONTRACT: 'CONTRACT',
});

export const DOCUMENT_SIGNATURE_TYPES = Object.freeze({
  AGENT: 'agent_signature',
  GENERAL_AGENCY: 'ga_signature',
  PRINCIPAL: 'principal_signature',
});

export const DOCUMENT_PACKAGE_ACTIONS = Object.freeze({
  BUILT: 'DOCUMENT_PACKAGE_BUILT',
  CONSENT_RECORDED: 'DOCUMENT_ESIGN_CONSENT_RECORDED',
  SIGNATURE_RETAINED: 'DOCUMENT_SIGNATURE_RETAINED',
  AGENT_SIGNED: 'DOCUMENT_PACKAGE_AGENT_SIGNED',
  COMPLETED: 'DOCUMENT_PACKAGE_COMPLETED',
});

const FORM_DEFINITIONS = Object.freeze({
  [DOCUMENT_FORM_CODES.BK_12]: Object.freeze({
    code: DOCUMENT_FORM_CODES.BK_12,
    name: 'BK-12 Producer Contracting Form',
    description:
      'Producer contracting and appointment information form.',
    required: true,
    signatureRequired: true,
    signerType: 'agent',
  }),
  [DOCUMENT_FORM_CODES.BK_14]: Object.freeze({
    code: DOCUMENT_FORM_CODES.BK_14,
    name: 'BK-14 Advance Commission Agreement',
    description:
      'Advance commission acknowledgment and repayment agreement.',
    required: true,
    signatureRequired: true,
    signerType: 'agent',
  }),
  [DOCUMENT_FORM_CODES.BK_23]: Object.freeze({
    code: DOCUMENT_FORM_CODES.BK_23,
    name: 'BK-23 Agency Contracting Form',
    description:
      'Agency and corporate contracting information form.',
    required: true,
    signatureRequired: true,
    signerType: 'general_agency',
  }),
  [DOCUMENT_FORM_CODES.W_9]: Object.freeze({
    code: DOCUMENT_FORM_CODES.W_9,
    name: 'W-9 Tax Certification',
    description: 'Request for taxpayer identification and certification.',
    required: true,
    signatureRequired: true,
    signerType: 'applicant',
  }),
  [DOCUMENT_FORM_CODES.BIOGRAPHICAL]: Object.freeze({
    code: DOCUMENT_FORM_CODES.BIOGRAPHICAL,
    name: 'Biographical Information Form',
    description:
      'Biographical and suitability information for an individual applicant.',
    required: true,
    signatureRequired: true,
    signerType: 'agent',
  }),
  [DOCUMENT_FORM_CODES.ADOPTION]: Object.freeze({
    code: DOCUMENT_FORM_CODES.ADOPTION,
    name: 'Contract Adoption Agreement',
    description:
      'Agreement adopting an existing contract, hierarchy, or signature.',
    required: true,
    signatureRequired: true,
    signerType: 'agent',
  }),
  [DOCUMENT_FORM_CODES.CONTRACT]: Object.freeze({
    code: DOCUMENT_FORM_CODES.CONTRACT,
    name: 'Carrier Contract Package',
    description:
      'Carrier-specific contract terms and applicant acknowledgments.',
    required: true,
    signatureRequired: true,
    signerType: 'agent',
  }),
});

const CORPORATE_CONTRACT_TYPES = new Set([
  'agency',
  'corporate',
  'entity',
  'organization',
]);

const ADOPTION_REQUEST_TYPES = new Set([
  'adoption',
  'contract_adoption',
  'hierarchy_change',
  'transfer',
  'upline_change',
]);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertOptions(options, description = 'Document package options') {
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

function normalizeToken(value) {
  return normalizeOptionalIdentifier(value)
    ?.normalize('NFKC')
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

function createDocumentPackageServiceError(
  code,
  message,
  details,
  cause,
) {
  const error = new Error(message, {
    ...(cause === undefined ? {} : { cause }),
  });

  error.name = 'DocumentPackageServiceError';
  error.code = code;
  error.details = details ?? null;
  error.recoverable = true;

  return error;
}

function assertPackageRepository(repository) {
  const requiredMethods = [
    'create',
    'find',
    'update',
    'markESignConsent',
    'markSigned',
    'markComplete',
  ];

  if (
    !isObject(repository) ||
    requiredMethods.some(
      (method) => typeof repository[method] !== 'function',
    )
  ) {
    throw createDocumentPackageServiceError(
      DOCUMENT_PACKAGE_SERVICE_ERROR_CODES.INVALID_REPOSITORY,
      'The document package repository does not provide the required methods.',
      { requiredMethods },
    );
  }

  return repository;
}

function assertOptionalApplicationRepository(repository) {
  if (repository === undefined || repository === null) {
    return null;
  }

  if (
    !isObject(repository) ||
    (typeof repository.find !== 'function' &&
      typeof repository.findByTrackingId !== 'function')
  ) {
    throw createDocumentPackageServiceError(
      DOCUMENT_PACKAGE_SERVICE_ERROR_CODES.INVALID_REPOSITORY,
      'The application repository must provide find or findByTrackingId.',
      null,
    );
  }

  return repository;
}

function assertOptionalAuditService(auditService) {
  if (auditService === undefined || auditService === null) {
    return null;
  }

  if (
    !isObject(auditService) ||
    (typeof auditService.append !== 'function' &&
      typeof auditService.create !== 'function')
  ) {
    throw createDocumentPackageServiceError(
      DOCUMENT_PACKAGE_SERVICE_ERROR_CODES.INVALID_REPOSITORY,
      'The document package audit service must provide append or create.',
      null,
    );
  }

  return auditService;
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

function isCorporateApplication(application) {
  const applicantType = normalizeToken(
    getFirstValue(application, [
      'applicant.type',
      'organization.type',
    ]),
  );
  const contractType = normalizeToken(
    getFirstValue(application, [
      'contractType',
      'contract.type',
    ]),
  );

  return (
    applicantType === 'organization' ||
    CORPORATE_CONTRACT_TYPES.has(contractType)
  );
}

function isRegisteredRepresentative(application) {
  const journeyType = normalizeToken(
    getFirstValue(application, ['journeyType']),
  );
  const contractType = normalizeToken(
    getFirstValue(application, [
      'contractType',
      'contract.type',
    ]),
  );

  return (
    journeyType === 'registered_rep' ||
    journeyType === 'registered_representative' ||
    contractType === 'registered_rep' ||
    contractType === 'registered_representative'
  );
}

function requiresAdvanceAgreement(application) {
  return (
    getFirstValue(application, [
      'advanceCommission',
      'commission.advanceCommission',
      'contract.advanceCommission',
    ]) === true
  );
}

function requiresAdoptionAgreement(application, options) {
  if (typeof options.includeAdoption === 'boolean') {
    return options.includeAdoption;
  }

  const requestType = normalizeToken(
    getFirstValue(application, ['requestType']),
  );
  const adoptionRequired = getFirstValue(application, [
    'adoption.required',
    'contract.adoptionRequired',
    'documentPackage.adoptionRequired',
  ]);

  return (
    adoptionRequired === true ||
    ADOPTION_REQUEST_TYPES.has(requestType)
  );
}

function normalizeFormOverride(form) {
  if (typeof form === 'string' || typeof form === 'number') {
    const code = normalizeIdentifier(form, 'Document form code');

    return cloneValue(
      FORM_DEFINITIONS[code] ?? {
        code,
        name: code,
        description: 'Configured onboarding document.',
        required: true,
        signatureRequired: false,
        signerType: null,
      },
    );
  }

  if (!isObject(form)) {
    throw new TypeError(
      'Document form overrides must contain form codes or objects.',
    );
  }

  const code = normalizeIdentifier(
    form.code ?? form.id ?? form.documentCode,
    'Document form code',
  );

  return {
    ...(FORM_DEFINITIONS[code] ?? {}),
    ...cloneValue(form),
    code,
    name: form.name ?? FORM_DEFINITIONS[code]?.name ?? code,
    required: form.required ?? true,
    status: form.status ?? 'REQUIRED',
    signatureRequired: form.signatureRequired ?? false,
    signerType: form.signerType ?? null,
    metadata: cloneValue(form.metadata ?? {}),
  };
}

function createManifestItem(form, application) {
  return {
    ...cloneValue(form),
    status: form.status ?? 'REQUIRED',
    metadata: {
      ...cloneValue(form.metadata ?? {}),
      company:
        getFirstValue(application, ['company', 'carrierCode']) ?? null,
      journeyType:
        getFirstValue(application, ['journeyType']) ?? null,
    },
  };
}

/**
 * Selects required document forms for an onboarding application.
 *
 * @param {object} application Onboarding application or journey draft.
 * @param {{
 *   includeAdoption?: boolean,
 *   includeForms?: Array<string | object>,
 *   excludeForms?: string[],
 *   additionalForms?: Array<string | object>
 * }} [options] Form selection options.
 * @returns {object[]} Selected form manifest items.
 */
export function selectRequiredDocumentForms(
  application,
  options = {},
) {
  if (!isObject(application)) {
    throw createDocumentPackageServiceError(
      DOCUMENT_PACKAGE_SERVICE_ERROR_CODES.INVALID_APPLICATION,
      'An onboarding application must be an object.',
      null,
    );
  }

  const normalizedOptions = assertOptions(
    options,
    'Document form selection options',
  );
  let forms;

  if (normalizedOptions.includeForms !== undefined) {
    if (!Array.isArray(normalizedOptions.includeForms)) {
      throw new TypeError('includeForms must be an array.');
    }

    forms = normalizedOptions.includeForms.map(normalizeFormOverride);
  } else {
    const selectedCodes = new Set([
      DOCUMENT_FORM_CODES.W_9,
      DOCUMENT_FORM_CODES.CONTRACT,
    ]);

    if (isCorporateApplication(application)) {
      selectedCodes.add(DOCUMENT_FORM_CODES.BK_23);
    } else {
      selectedCodes.add(DOCUMENT_FORM_CODES.BK_12);

      if (!isRegisteredRepresentative(application)) {
        selectedCodes.add(DOCUMENT_FORM_CODES.BIOGRAPHICAL);
      }
    }

    if (requiresAdvanceAgreement(application)) {
      selectedCodes.add(DOCUMENT_FORM_CODES.BK_14);
    }

    if (requiresAdoptionAgreement(application, normalizedOptions)) {
      selectedCodes.add(DOCUMENT_FORM_CODES.ADOPTION);
    }

    forms = [...selectedCodes].map((code) =>
      cloneValue(FORM_DEFINITIONS[code]),
    );
  }

  if (normalizedOptions.additionalForms !== undefined) {
    if (!Array.isArray(normalizedOptions.additionalForms)) {
      throw new TypeError('additionalForms must be an array.');
    }

    forms.push(
      ...normalizedOptions.additionalForms.map(normalizeFormOverride),
    );
  }

  const excludedCodes = new Set(
    (normalizedOptions.excludeForms ?? []).map((code) =>
      normalizeIdentifier(code, 'Excluded document form code'),
    ),
  );
  const uniqueForms = new Map();

  forms.forEach((form) => {
    if (!excludedCodes.has(form.code)) {
      uniqueForms.set(
        form.code,
        createManifestItem(form, application),
      );
    }
  });

  return [...uniqueForms.values()];
}

function createArtifactReference(form, trackingId, generatedAt) {
  const artifactId = createDeterministicId(
    'DOC',
    {
      trackingId,
      documentCode: form.code,
      generatedAt,
    },
    { length: 16 },
  );

  return {
    artifactId,
    referenceId: artifactId,
    documentCode: form.code,
    name: form.name,
    fileName: `${form.code
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')}.txt`,
    mimeType: 'text/plain',
    status: form.signatureRequired
      ? DOCUMENT_ARTIFACT_STATUSES.READY_FOR_SIGNATURE
      : DOCUMENT_ARTIFACT_STATUSES.GENERATED,
    size: 0,
    checksum: null,
    downloadUrl: null,
    generatedAt,
    signedAt: null,
    metadata: {
      synthetic: true,
      signatureRequired: form.signatureRequired,
      signerType: form.signerType,
    },
  };
}

function getTrackingId(application, fallback) {
  return normalizeIdentifier(
    fallback ??
      getFirstValue(application, ['trackingId']),
    'Tracking identifier',
  );
}

function resolveActorId(actor) {
  if (typeof actor === 'string' || typeof actor === 'number') {
    return String(actor).trim() || 'system';
  }

  if (!isObject(actor)) {
    return 'system';
  }

  return (
    normalizeOptionalIdentifier(
      actor.actorId ??
        actor.userId ??
        actor.id ??
        actor.user?.id ??
        actor.currentUser?.id,
    ) ?? 'system'
  );
}

function getSignatureByType(signatures, signatureType) {
  const normalizedType = normalizeToken(signatureType);

  return Object.entries(signatures ?? {}).find(
    ([type]) => normalizeToken(type) === normalizedType,
  )?.[1];
}

function signatureIsValid(signature) {
  return (
    isObject(signature) &&
    signature.retained !== false &&
    signature.status === DOCUMENT_SIGNATURE_STATES.SIGNED &&
    normalizeOptionalIdentifier(signature.signatureId) !== undefined
  );
}

/**
 * Validates retained and agent signature state for a package.
 *
 * @param {object} documentPackage Document package.
 * @param {{
 *   requireAgentSignature?: boolean,
 *   requireGaSignature?: boolean,
 *   requirePrincipalSignature?: boolean
 * }} [options] Signature requirements.
 * @returns {object} Signature validation result.
 */
export function validateDocumentPackageSignatures(
  documentPackage,
  options = {},
) {
  if (!isObject(documentPackage)) {
    throw new TypeError('A document package must be an object.');
  }

  const normalizedOptions = assertOptions(
    options,
    'Document signature validation options',
  );
  const retainedSignatures =
    documentPackage.retainedSignatures ?? {};
  const agentSignature = getSignatureByType(
    retainedSignatures,
    DOCUMENT_SIGNATURE_TYPES.AGENT,
  );
  const gaSignature = getSignatureByType(
    retainedSignatures,
    DOCUMENT_SIGNATURE_TYPES.GENERAL_AGENCY,
  );
  const principalSignature = getSignatureByType(
    retainedSignatures,
    DOCUMENT_SIGNATURE_TYPES.PRINCIPAL,
  );
  const agentSigned =
    documentPackage.agentSignatureState ===
      DOCUMENT_SIGNATURE_STATES.SIGNED ||
    documentPackage.signOff?.status ===
      DOCUMENT_SIGNATURE_STATES.SIGNED ||
    signatureIsValid(agentSignature);
  const gaSigned =
    documentPackage.retainedGaSignature === true &&
    signatureIsValid(gaSignature);
  const principalSigned = signatureIsValid(principalSignature);
  const requireAgentSignature =
    normalizedOptions.requireAgentSignature !== false;
  const requireGaSignature =
    normalizedOptions.requireGaSignature === true;
  const requirePrincipalSignature =
    normalizedOptions.requirePrincipalSignature === true;
  const issues = [];

  if (requireAgentSignature && !agentSigned) {
    issues.push({
      code: DOCUMENT_PACKAGE_SERVICE_ERROR_CODES.SIGNATURE_REQUIRED,
      field: 'agentSignatureState',
      message: 'A signed agent signature is required.',
      severity: 'blocking',
    });
  }

  if (requireGaSignature && !gaSigned) {
    issues.push({
      code: DOCUMENT_PACKAGE_SERVICE_ERROR_CODES.SIGNATURE_REQUIRED,
      field: 'retainedSignatures.ga_signature',
      message: 'A valid retained general agency signature is required.',
      severity: 'blocking',
    });
  }

  if (requirePrincipalSignature && !principalSigned) {
    issues.push({
      code: DOCUMENT_PACKAGE_SERVICE_ERROR_CODES.SIGNATURE_REQUIRED,
      field: 'retainedSignatures.principal_signature',
      message: 'A valid retained principal signature is required.',
      severity: 'blocking',
    });
  }

  return Object.freeze({
    valid: issues.length === 0,
    agentSigned,
    gaSigned,
    principalSigned,
    requireAgentSignature,
    requireGaSignature,
    requirePrincipalSignature,
    issues: Object.freeze(issues),
  });
}

/**
 * Builds and validates synthetic onboarding document packages.
 */
export class DocumentPackageService {
  /**
   * @param {{
   *   repository?: object,
   *   applicationRepository?: object,
   *   auditService?: object | false,
   *   storage?: Storage,
   *   namespace?: string,
   *   schemaVersion?: number,
   *   clock?: () => Date | string | number,
   *   onStorageError?: (error: object) => void
   * }} [options] Service options.
   */
  constructor(options = {}) {
    const normalizedOptions = assertOptions(options);

    if (
      normalizedOptions.clock !== undefined &&
      typeof normalizedOptions.clock !== 'function'
    ) {
      throw new TypeError(
        'The document package service clock must be a function.',
      );
    }

    this.clock = normalizedOptions.clock ?? (() => new Date());
    this.repository = assertPackageRepository(
      normalizedOptions.repository ??
        new DocumentPackageRepository({
          ...(normalizedOptions.storage === undefined
            ? {}
            : { storage: normalizedOptions.storage }),
          ...(normalizedOptions.namespace === undefined
            ? {}
            : { namespace: normalizedOptions.namespace }),
          ...(normalizedOptions.schemaVersion === undefined
            ? {}
            : { schemaVersion: normalizedOptions.schemaVersion }),
          clock: this.clock,
          ...(normalizedOptions.onStorageError === undefined
            ? {}
            : {
                onStorageError:
                  normalizedOptions.onStorageError,
              }),
        }),
    );
    this.applicationRepository =
      assertOptionalApplicationRepository(
        normalizedOptions.applicationRepository,
      );
    this.auditService =
      normalizedOptions.auditService === false
        ? null
        : assertOptionalAuditService(
            normalizedOptions.auditService,
          );
  }

  /**
   * Builds and persists a package for an application.
   *
   * @param {string | number | object} applicationOrTrackingId Application or
   * tracking identifier.
   * @param {object} [options] Package generation options.
   * @returns {object} Generated document package.
   */
  buildPackage(applicationOrTrackingId, options = {}) {
    const normalizedOptions = assertOptions(
      options,
      'Document package build options',
    );
    const application = this.resolveApplication(
      applicationOrTrackingId,
      normalizedOptions.application,
    );
    const trackingId = getTrackingId(
      application,
      isObject(applicationOrTrackingId)
        ? undefined
        : applicationOrTrackingId,
    );
    const generatedAt = toIsoTimestamp(
      normalizedOptions.generatedAt ?? this.clock(),
    );
    const requiredForms = selectRequiredDocumentForms(
      application,
      normalizedOptions,
    );
    const generatedArtifacts = requiredForms.map((form) =>
      createArtifactReference(form, trackingId, generatedAt),
    );
    const existingPackage = this.repository.find(trackingId);
    const packageValues = {
      trackingId,
      applicationId:
        normalizeOptionalIdentifier(
          getFirstValue(application, ['applicationId', 'id']),
        ) ?? null,
      packageVersion: existingPackage?.packageVersion ?? 1,
      status: DOCUMENT_PACKAGE_STATUSES.GENERATED,
      requiredForms,
      generatedArtifacts,
      retainedSignatures: cloneValue(
        existingPackage?.retainedSignatures ?? {},
      ),
      retainedGaSignature:
        existingPackage?.retainedGaSignature ?? false,
      agentSignatureState:
        existingPackage?.agentSignatureState ??
        DOCUMENT_SIGNATURE_STATES.NOT_STARTED,
      signOff: cloneValue(existingPackage?.signOff ?? {}),
      packageComplete: false,
      generatedAt: existingPackage?.generatedAt ?? generatedAt,
      updatedAt: generatedAt,
      completedAt: null,
      metadata: {
        ...cloneValue(existingPackage?.metadata ?? {}),
        synthetic: true,
        company:
          getFirstValue(application, ['company', 'carrierCode']) ?? null,
        journeyType:
          getFirstValue(application, ['journeyType']) ?? null,
        generatedBy: resolveActorId(normalizedOptions.actor),
      },
    };

    try {
      const documentPackage = existingPackage
        ? this.repository.update(
            trackingId,
            packageValues,
            {
              expectedVersion:
                normalizedOptions.expectedVersion,
            },
          )
        : this.repository.create(packageValues);

      this.appendAuditEvent(
        DOCUMENT_PACKAGE_ACTIONS.BUILT,
        documentPackage,
        normalizedOptions.actor,
        {
          requiredFormCodes: requiredForms.map((form) => form.code),
          generatedArtifactCount: generatedArtifacts.length,
        },
      );

      return cloneValue(documentPackage);
    } catch (error) {
      if (
        error?.name === 'DocumentPackageRepositoryError' ||
        error?.name === 'DocumentPackageServiceError'
      ) {
        throw error;
      }

      throw createDocumentPackageServiceError(
        DOCUMENT_PACKAGE_SERVICE_ERROR_CODES.PERSISTENCE_FAILED,
        'Unable to persist the generated document package.',
        { trackingId },
        error,
      );
    }
  }

  /**
   * Alias for buildPackage.
   *
   * @param {string | number | object} applicationOrTrackingId Application.
   * @param {object} [options] Build options.
   * @returns {object} Generated package.
   */
  generatePackage(applicationOrTrackingId, options = {}) {
    return this.buildPackage(applicationOrTrackingId, options);
  }

  /**
   * Returns a package or throws when it is absent.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @returns {object} Document package.
   */
  getPackage(trackingId) {
    const documentPackage = this.repository.find(trackingId);

    if (!documentPackage) {
      throw createDocumentPackageServiceError(
        DOCUMENT_PACKAGE_SERVICE_ERROR_CODES.PACKAGE_NOT_FOUND,
        `Document package not found: ${trackingId}`,
        { trackingId: String(trackingId) },
      );
    }

    return cloneValue(documentPackage);
  }

  /**
   * Returns the package summary.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @returns {object} Package summary.
   */
  getDocumentPackageSummary(trackingId) {
    if (
      typeof this.repository.getDocumentPackageSummary === 'function'
    ) {
      return cloneValue(
        this.repository.getDocumentPackageSummary(trackingId),
      );
    }

    return this.getPackage(trackingId);
  }

  /**
   * Records electronic-signature consent.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @param {object} [consent] Consent details.
   * @param {object} [options] Update options.
   * @returns {object} Updated package.
   */
  markESignConsent(
    trackingId,
    consent = {},
    options = {},
  ) {
    const normalizedConsent = assertOptions(
      consent,
      'Electronic-signature consent',
    );
    const normalizedOptions = assertOptions(
      options,
      'Electronic-signature consent options',
    );

    try {
      const documentPackage = this.repository.markESignConsent(
        trackingId,
        normalizedConsent,
        {
          expectedVersion: normalizedOptions.expectedVersion,
        },
      );

      this.appendAuditEvent(
        DOCUMENT_PACKAGE_ACTIONS.CONSENT_RECORDED,
        documentPackage,
        normalizedOptions.actor,
        {
          consented: documentPackage.signOff.consented,
          envelopeId:
            documentPackage.signOff.envelopeId ?? null,
        },
      );

      return cloneValue(documentPackage);
    } catch (error) {
      throw this.normalizePersistenceError(
        error,
        trackingId,
        'record electronic-signature consent',
      );
    }
  }

  /**
   * Retains a reusable signature.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @param {string} signatureType Signature type.
   * @param {object} signature Signature details.
   * @param {object} [options] Update options.
   * @returns {object} Updated package.
   */
  retainSignature(
    trackingId,
    signatureType,
    signature,
    options = {},
  ) {
    const normalizedOptions = assertOptions(
      options,
      'Retained signature options',
    );

    if (typeof this.repository.retainSignature !== 'function') {
      throw createDocumentPackageServiceError(
        DOCUMENT_PACKAGE_SERVICE_ERROR_CODES.INVALID_REPOSITORY,
        'The document package repository cannot retain signatures.',
        { trackingId: String(trackingId) },
      );
    }

    try {
      const documentPackage = this.repository.retainSignature(
        trackingId,
        signatureType,
        signature,
        {
          expectedVersion: normalizedOptions.expectedVersion,
        },
      );

      this.appendAuditEvent(
        DOCUMENT_PACKAGE_ACTIONS.SIGNATURE_RETAINED,
        documentPackage,
        normalizedOptions.actor,
        {
          signatureType,
          retained: true,
        },
      );

      return cloneValue(documentPackage);
    } catch (error) {
      throw this.normalizePersistenceError(
        error,
        trackingId,
        'retain the document signature',
      );
    }
  }

  /**
   * Marks the package as signed by the agent.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @param {object} signature Agent signature details.
   * @param {object} [options] Update options.
   * @returns {object} Updated package.
   */
  markAgentSigned(trackingId, signature, options = {}) {
    const normalizedSignature = assertOptions(
      signature,
      'Agent signature',
    );
    const normalizedOptions = assertOptions(
      options,
      'Agent signature options',
    );

    normalizeIdentifier(
      normalizedSignature.signedBy,
      'Agent signer identifier',
    );

    try {
      const documentPackage = this.repository.markSigned(
        trackingId,
        normalizedSignature,
        {
          expectedVersion: normalizedOptions.expectedVersion,
        },
      );

      this.appendAuditEvent(
        DOCUMENT_PACKAGE_ACTIONS.AGENT_SIGNED,
        documentPackage,
        normalizedOptions.actor,
        {
          signedAt: documentPackage.signOff.signedAt ?? null,
          envelopeId:
            documentPackage.signOff.envelopeId ?? null,
        },
      );

      return cloneValue(documentPackage);
    } catch (error) {
      throw this.normalizePersistenceError(
        error,
        trackingId,
        'record the agent signature',
      );
    }
  }

  /**
   * Alias for markAgentSigned.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @param {object} signature Signature details.
   * @param {object} [options] Update options.
   * @returns {object} Updated package.
   */
  markSigned(trackingId, signature, options = {}) {
    return this.markAgentSigned(trackingId, signature, options);
  }

  /**
   * Validates signature requirements for a package.
   *
   * @param {string | number | object} packageOrTrackingId Package or ID.
   * @param {object} [options] Signature requirements.
   * @returns {object} Validation result.
   */
  validateSignatures(packageOrTrackingId, options = {}) {
    const documentPackage = isObject(packageOrTrackingId)
      ? packageOrTrackingId
      : this.getPackage(packageOrTrackingId);

    return validateDocumentPackageSignatures(
      documentPackage,
      options,
    );
  }

  /**
   * Validates signatures and marks the package complete.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @param {object} [options] Completion and signature options.
   * @returns {object} Completed package.
   */
  completePackage(trackingId, options = {}) {
    const normalizedOptions = assertOptions(
      options,
      'Document package completion options',
    );
    const documentPackage = this.getPackage(trackingId);
    const signatureValidation =
      validateDocumentPackageSignatures(
        documentPackage,
        normalizedOptions,
      );

    if (!signatureValidation.valid) {
      throw createDocumentPackageServiceError(
        DOCUMENT_PACKAGE_SERVICE_ERROR_CODES.SIGNATURE_REQUIRED,
        'The document package cannot be completed while required signatures are missing.',
        {
          trackingId: documentPackage.trackingId,
          issues: signatureValidation.issues,
        },
      );
    }

    const incompleteArtifacts =
      documentPackage.generatedArtifacts.filter(
        (artifact) =>
          artifact.status ===
            DOCUMENT_ARTIFACT_STATUSES.FAILED ||
          artifact.status ===
            DOCUMENT_ARTIFACT_STATUSES.PENDING,
      );

    if (incompleteArtifacts.length > 0) {
      throw createDocumentPackageServiceError(
        DOCUMENT_PACKAGE_SERVICE_ERROR_CODES.PACKAGE_INCOMPLETE,
        'The document package contains incomplete artifacts.',
        {
          trackingId: documentPackage.trackingId,
          artifactIds: incompleteArtifacts.map(
            (artifact) => artifact.artifactId,
          ),
        },
      );
    }

    try {
      const completedPackage = this.repository.markComplete(
        trackingId,
        {
          expectedVersion: normalizedOptions.expectedVersion,
        },
      );

      this.appendAuditEvent(
        DOCUMENT_PACKAGE_ACTIONS.COMPLETED,
        completedPackage,
        normalizedOptions.actor,
        {
          completedAt: completedPackage.completedAt,
          artifactCount:
            completedPackage.generatedArtifacts.length,
        },
      );

      return cloneValue(completedPackage);
    } catch (error) {
      throw this.normalizePersistenceError(
        error,
        trackingId,
        'complete the document package',
      );
    }
  }

  resolveApplication(applicationOrTrackingId, suppliedApplication) {
    if (isObject(applicationOrTrackingId)) {
      return cloneValue(applicationOrTrackingId);
    }

    if (isObject(suppliedApplication)) {
      return cloneValue(suppliedApplication);
    }

    if (!this.applicationRepository) {
      throw createDocumentPackageServiceError(
        DOCUMENT_PACKAGE_SERVICE_ERROR_CODES.INVALID_APPLICATION,
        'An application or application repository is required to build a document package.',
        {
          trackingId: String(applicationOrTrackingId),
        },
      );
    }

    const find =
      typeof this.applicationRepository.findByTrackingId ===
      'function'
        ? this.applicationRepository.findByTrackingId.bind(
            this.applicationRepository,
          )
        : this.applicationRepository.find.bind(
            this.applicationRepository,
          );
    const application = find(applicationOrTrackingId);

    if (!application) {
      throw createDocumentPackageServiceError(
        DOCUMENT_PACKAGE_SERVICE_ERROR_CODES.APPLICATION_NOT_FOUND,
        `Onboarding application not found: ${applicationOrTrackingId}`,
        {
          trackingId: String(applicationOrTrackingId),
        },
      );
    }

    return cloneValue(application);
  }

  appendAuditEvent(action, documentPackage, actor, metadata) {
    if (!this.auditService) {
      return null;
    }

    const append =
      typeof this.auditService.append === 'function'
        ? this.auditService.append.bind(this.auditService)
        : this.auditService.create.bind(this.auditService);

    try {
      return append(
        {
          trackingId: documentPackage.trackingId,
          applicationId:
            documentPackage.applicationId ?? undefined,
          sourceRecordId:
            documentPackage.applicationId ??
            documentPackage.trackingId,
          action,
          summary: action.toLowerCase().replace(/_/g, ' '),
          metadata: {
            packageVersion: documentPackage.packageVersion,
            packageStatus: documentPackage.status,
            actorId: resolveActorId(actor),
            ...cloneValue(metadata),
          },
          timestamp: toIsoTimestamp(this.clock()),
        },
        { actor },
      );
    } catch (error) {
      throw createDocumentPackageServiceError(
        DOCUMENT_PACKAGE_SERVICE_ERROR_CODES.AUDIT_FAILED,
        'Unable to persist the document package audit event.',
        {
          action,
          trackingId: documentPackage.trackingId,
        },
        error,
      );
    }
  }

  normalizePersistenceError(error, trackingId, operation) {
    if (
      error?.name === 'DocumentPackageRepositoryError' ||
      error?.name === 'DocumentPackageServiceError'
    ) {
      return error;
    }

    return createDocumentPackageServiceError(
      DOCUMENT_PACKAGE_SERVICE_ERROR_CODES.PERSISTENCE_FAILED,
      `Unable to ${operation}.`,
      { trackingId: String(trackingId) },
      error,
    );
  }
}

/**
 * Creates a document package service.
 *
 * @param {ConstructorParameters<typeof DocumentPackageService>[0]} [options]
 * Service options.
 * @returns {DocumentPackageService} Document package service.
 */
export function createDocumentPackageService(options = {}) {
  return new DocumentPackageService(options);
}

/**
 * Builds a package with a newly created service.
 *
 * @param {string | number | object} applicationOrTrackingId Application.
 * @param {object} [buildOptions] Build options.
 * @param {ConstructorParameters<typeof DocumentPackageService>[0]}
 * [serviceOptions] Service options.
 * @returns {object} Generated package.
 */
export function buildDocumentPackage(
  applicationOrTrackingId,
  buildOptions = {},
  serviceOptions = {},
) {
  return createDocumentPackageService(
    serviceOptions,
  ).buildPackage(applicationOrTrackingId, buildOptions);
}

export const DocumentPackageModule = DocumentPackageService;
export const ContractPackageService = DocumentPackageService;
export const createContractPackageService =
  createDocumentPackageService;
export const selectRequiredForms = selectRequiredDocumentForms;
export const validatePackageSignatures =
  validateDocumentPackageSignatures;
export const generateDocumentPackage = buildDocumentPackage;

export default DocumentPackageService;