import {
  AUDIT_SOURCES,
  ONBOARDING_STATUSES,
  WORKFLOW_STAGES,
} from '../../constants/domain.js';
import { PERMISSIONS } from '../../constants/roles.js';
import { canPerformAction } from '../../auth/permissionPolicy.js';
import { OnboardingRecordRepository } from '../../repositories/onboardingRecordRepository.js';
import { toIsoTimestamp } from '../../utils/dates.js';
import { AuditService } from '../shared/auditService.js';
import { DocumentPackageService } from './documentPackageService.js';
import { EligibilityService } from './eligibilityService.js';
import {
  OnboardingEventPublisher,
  ONBOARDING_EVENT_NAMES,
} from './onboardingEventPublisher.js';
import {
  ValidationService,
  VALIDATION_SCOPES,
} from './validationService.js';

export const SUBMISSION_SERVICE_ERROR_CODES = Object.freeze({
  INVALID_OPTIONS: 'SUBMISSION_SERVICE_INVALID_OPTIONS',
  INVALID_REQUEST: 'SUBMISSION_SERVICE_INVALID_REQUEST',
  INVALID_DEPENDENCY: 'SUBMISSION_SERVICE_INVALID_DEPENDENCY',
  UNAUTHORIZED: 'SUBMISSION_SERVICE_UNAUTHORIZED',
  APPLICATION_NOT_FOUND: 'SUBMISSION_SERVICE_APPLICATION_NOT_FOUND',
  ALREADY_SUBMITTED: 'SUBMISSION_SERVICE_ALREADY_SUBMITTED',
  VERSION_CONFLICT: 'SUBMISSION_SERVICE_VERSION_CONFLICT',
  FINAL_VALIDATION_FAILED: 'SUBMISSION_SERVICE_VALIDATION_FAILED',
  ELIGIBILITY_FAILED: 'SUBMISSION_SERVICE_ELIGIBILITY_FAILED',
  MANUAL_REVIEW_REQUIRED: 'SUBMISSION_SERVICE_MANUAL_REVIEW_REQUIRED',
  DOCUMENT_PACKAGE_NOT_FOUND:
    'SUBMISSION_SERVICE_DOCUMENT_PACKAGE_NOT_FOUND',
  DOCUMENT_PACKAGE_INCOMPLETE:
    'SUBMISSION_SERVICE_DOCUMENT_PACKAGE_INCOMPLETE',
  SIGNATURE_REQUIRED: 'SUBMISSION_SERVICE_SIGNATURE_REQUIRED',
  STATE_TRANSITION_FAILED:
    'SUBMISSION_SERVICE_STATE_TRANSITION_FAILED',
  HANDOFF_FAILED: 'SUBMISSION_SERVICE_HANDOFF_FAILED',
  AUDIT_FAILED: 'SUBMISSION_SERVICE_AUDIT_FAILED',
  EVENT_PUBLICATION_FAILED:
    'SUBMISSION_SERVICE_EVENT_PUBLICATION_FAILED',
});

export const SUBMISSION_ACTIONS = Object.freeze({
  VALIDATED: 'APPLICATION_SUBMISSION_VALIDATED',
  SUBMITTED: 'APPLICATION_SUBMITTED',
  EXCEPTION_ROUTED: 'APPLICATION_EXCEPTION_ROUTED',
});

export const SUBMISSION_OUTCOMES = Object.freeze({
  SUBMITTED: 'SUBMITTED',
  EXCEPTION_ROUTED: 'EXCEPTION_ROUTED',
});

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertOptions(options, description = 'Submission service options') {
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

function createSubmissionError(code, message, details, cause) {
  const error = new Error(message, {
    ...(cause === undefined ? {} : { cause }),
  });

  error.name = 'SubmissionServiceError';
  error.code = code;
  error.details = details ?? null;
  error.recoverable = true;

  return error;
}

function createRepositoryOptions(options, clock) {
  return {
    ...(options.storage === undefined
      ? {}
      : { storage: options.storage }),
    ...(options.namespace === undefined
      ? {}
      : { namespace: options.namespace }),
    ...(options.schemaVersion === undefined
      ? {}
      : { schemaVersion: options.schemaVersion }),
    clock,
    ...(options.onStorageError === undefined
      ? {}
      : { onStorageError: options.onStorageError }),
  };
}

function assertApplicationRepository(repository) {
  if (
    !isObject(repository) ||
    typeof repository.find !== 'function' ||
    (typeof repository.update !== 'function' &&
      typeof repository.submit !== 'function')
  ) {
    throw createSubmissionError(
      SUBMISSION_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
      'The application repository must provide find and update or submit methods.',
      {
        requiredMethods: ['find', 'update or submit'],
      },
    );
  }

  return repository;
}

function assertValidationService(service) {
  if (
    !isObject(service) ||
    (typeof service.validateForSubmission !== 'function' &&
      typeof service.validateApplication !== 'function')
  ) {
    throw createSubmissionError(
      SUBMISSION_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
      'The validation service must provide validateForSubmission or validateApplication.',
      null,
    );
  }

  return service;
}

function assertEligibilityService(service) {
  if (
    !isObject(service) ||
    typeof service.runEligibilityChecks !== 'function'
  ) {
    throw createSubmissionError(
      SUBMISSION_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
      'The eligibility service must provide runEligibilityChecks.',
      null,
    );
  }

  return service;
}

function assertDocumentPackageService(service) {
  if (
    !isObject(service) ||
    (typeof service.getPackage !== 'function' &&
      typeof service.getDocumentPackageSummary !== 'function')
  ) {
    throw createSubmissionError(
      SUBMISSION_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
      'The document package service must provide getPackage or getDocumentPackageSummary.',
      null,
    );
  }

  return service;
}

function assertOptionalAuditService(service) {
  if (service === undefined || service === null || service === false) {
    return null;
  }

  if (
    !isObject(service) ||
    (typeof service.append !== 'function' &&
      typeof service.create !== 'function')
  ) {
    throw createSubmissionError(
      SUBMISSION_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
      'The submission audit service must provide append or create.',
      null,
    );
  }

  return service;
}

function assertEventPublisher(publisher) {
  if (
    !isObject(publisher) ||
    typeof publisher.publishApplicationSubmitted !== 'function' ||
    typeof publisher.publishApplicationExceptionRouted !== 'function'
  ) {
    throw createSubmissionError(
      SUBMISSION_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
      'The onboarding event publisher must provide submission and exception publication methods.',
      null,
    );
  }

  return publisher;
}

function assertOptionalHandoffGateway(gateway) {
  if (gateway === undefined || gateway === null || gateway === false) {
    return null;
  }

  const supported = [
    'receiveApplication',
    'handoff',
    'submit',
    'publish',
  ].some((method) => typeof gateway[method] === 'function');

  if (!isObject(gateway) || !supported) {
    throw createSubmissionError(
      SUBMISSION_SERVICE_ERROR_CODES.INVALID_DEPENDENCY,
      'The onboarding handoff gateway does not provide a supported handoff method.',
      null,
    );
  }

  return gateway;
}

function resolveActor(request, actor) {
  if (isObject(actor)) {
    return actor;
  }

  if (isObject(request.actor)) {
    return request.actor;
  }

  if (isObject(request.requestedBy)) {
    return request.requestedBy;
  }

  if (isObject(request.principal)) {
    return request.principal;
  }

  return null;
}

function resolveActorId(request, actor) {
  if (typeof actor === 'string' || typeof actor === 'number') {
    return normalizeIdentifier(actor, 'Submitting actor identifier');
  }

  if (isObject(actor)) {
    return normalizeIdentifier(
      actor.actorId ??
        actor.userId ??
        actor.id ??
        actor.user?.id ??
        actor.currentUser?.id ??
        request.submittedBy ??
        'system',
      'Submitting actor identifier',
    );
  }

  return normalizeIdentifier(
    request.submittedBy ?? 'system',
    'Submitting actor identifier',
  );
}

function collectValidationCodes(validation, eligibility) {
  return [
    ...new Set([
      ...(Array.isArray(validation?.validationCodes)
        ? validation.validationCodes
        : []),
      ...(Array.isArray(eligibility?.validationCodes)
        ? eligibility.validationCodes
        : []),
    ]),
  ];
}

function getValidationErrors(validation) {
  if (Array.isArray(validation?.errors)) {
    return validation.errors;
  }

  return Array.isArray(validation?.issues)
    ? validation.issues.filter((issue) =>
        ['error', 'blocking'].includes(issue.severity),
      )
    : [];
}

function getEligibilityErrors(eligibility) {
  if (Array.isArray(eligibility?.errors)) {
    return eligibility.errors;
  }

  return Array.isArray(eligibility?.issues)
    ? eligibility.issues.filter((issue) =>
        ['error', 'blocking'].includes(issue.severity),
      )
    : [];
}

function createArtifactHandoff(documentPackage) {
  return (documentPackage.generatedArtifacts ?? []).map((artifact) => ({
    artifactId: artifact.artifactId,
    referenceId: artifact.referenceId ?? null,
    documentCode: artifact.documentCode ?? null,
    name: artifact.name,
    fileName: artifact.fileName,
    mimeType: artifact.mimeType,
    status: artifact.status,
    checksum: artifact.checksum ?? null,
    generatedAt: artifact.generatedAt,
    signedAt: artifact.signedAt ?? null,
  }));
}

function createDocumentHandoff(documentPackage) {
  return deepFreeze({
    trackingId: documentPackage.trackingId,
    applicationId: documentPackage.applicationId ?? null,
    packageVersion: documentPackage.packageVersion,
    status: documentPackage.status,
    packageComplete: documentPackage.packageComplete === true,
    agentSignatureState: documentPackage.agentSignatureState,
    retainedGaSignature:
      documentPackage.retainedGaSignature === true,
    requiredForms: cloneValue(documentPackage.requiredForms ?? []),
    generatedArtifacts: createArtifactHandoff(documentPackage),
    completedAt: documentPackage.completedAt ?? null,
  });
}

function invokeGateway(gateway, handoff) {
  if (!gateway) {
    return null;
  }

  const method = [
    'receiveApplication',
    'handoff',
    'submit',
    'publish',
  ].find((candidate) => typeof gateway[candidate] === 'function');
  const result = gateway[method](cloneValue(handoff));

  if (result && typeof result.then === 'function') {
    throw createSubmissionError(
      SUBMISSION_SERVICE_ERROR_CODES.HANDOFF_FAILED,
      'Asynchronous handoff gateways are not supported by synchronous submission processing.',
      {
        applicationId: handoff.applicationId,
        trackingId: handoff.trackingId,
      },
    );
  }

  return result === undefined ? null : cloneValue(result);
}

/**
 * Coordinates final onboarding validation, eligibility, document package
 * enforcement, state transition, audit, and downstream handoff publication.
 */
export class SubmissionService {
  /**
   * @param {{
   *   applicationRepository?: object,
   *   repository?: object,
   *   validationService?: object,
   *   eligibilityService?: object,
   *   documentPackageService?: object,
   *   auditService?: object | false,
   *   eventPublisher?: object,
   *   handoffGateway?: object | false,
   *   storage?: Storage,
   *   namespace?: string,
   *   schemaVersion?: number,
   *   clock?: () => Date | string | number,
   *   onStorageError?: (error: object) => void,
   *   requireAuthorization?: boolean,
   *   requireDocumentPackage?: boolean,
   *   autoCompletePackage?: boolean,
   *   routeManualReview?: boolean,
   *   strictAudit?: boolean,
   *   strictPublication?: boolean,
   *   strictHandoff?: boolean
   * }} [options] Submission service options.
   */
  constructor(options = {}) {
    const normalizedOptions = assertOptions(options);

    if (
      normalizedOptions.clock !== undefined &&
      typeof normalizedOptions.clock !== 'function'
    ) {
      throw new TypeError('The submission service clock must be a function.');
    }

    this.clock = normalizedOptions.clock ?? (() => new Date());
    const repositoryOptions = createRepositoryOptions(
      normalizedOptions,
      this.clock,
    );

    this.applicationRepository = assertApplicationRepository(
      normalizedOptions.applicationRepository ??
        normalizedOptions.repository ??
        new OnboardingRecordRepository(repositoryOptions),
    );
    this.validationService = assertValidationService(
      normalizedOptions.validationService ??
        new ValidationService({
          clock: this.clock,
        }),
    );
    this.eligibilityService = assertEligibilityService(
      normalizedOptions.eligibilityService ??
        new EligibilityService({
          applicationRepository: this.applicationRepository,
          clock: this.clock,
          auditService: false,
        }),
    );
    this.documentPackageService = assertDocumentPackageService(
      normalizedOptions.documentPackageService ??
        new DocumentPackageService({
          ...repositoryOptions,
          applicationRepository: this.applicationRepository,
          auditService: false,
        }),
    );
    this.auditService =
      normalizedOptions.auditService === false
        ? null
        : assertOptionalAuditService(
            normalizedOptions.auditService ??
              new AuditService(repositoryOptions),
          );
    this.eventPublisher = assertEventPublisher(
      normalizedOptions.eventPublisher ??
        new OnboardingEventPublisher({
          clock: this.clock,
          source: 'submission-service',
        }),
    );
    this.handoffGateway = assertOptionalHandoffGateway(
      normalizedOptions.handoffGateway,
    );
    this.requireAuthorization =
      normalizedOptions.requireAuthorization ?? false;
    this.requireDocumentPackage =
      normalizedOptions.requireDocumentPackage ?? true;
    this.autoCompletePackage =
      normalizedOptions.autoCompletePackage ?? false;
    this.routeManualReview =
      normalizedOptions.routeManualReview ?? true;
    this.strictAudit = normalizedOptions.strictAudit ?? true;
    this.strictPublication =
      normalizedOptions.strictPublication ?? true;
    this.strictHandoff = normalizedOptions.strictHandoff ?? true;
  }

  /**
   * Finalizes an onboarding application or routes it for manual review.
   *
   * @param {string | number} identifier Application or tracking identifier.
   * @param {{
   *   applicationVersion?: number,
   *   expectedVersion?: number,
   *   expectedUpdatedAt?: string,
   *   submittedBy?: string,
   *   principal?: object | string,
   *   actor?: object,
   *   requestedBy?: object,
   *   includeProviders?: boolean,
   *   providerCodes?: string[],
   *   providerScenarios?: Record<string, string>,
   *   providerOptions?: Record<string, object>,
   *   requiredForms?: unknown[],
   *   completedForms?: unknown[],
   *   requireAuthorization?: boolean,
   *   requireDocumentPackage?: boolean,
   *   autoCompletePackage?: boolean,
   *   requireAgentSignature?: boolean,
   *   requireGaSignature?: boolean,
   *   requirePrincipalSignature?: boolean,
   *   allowManualReview?: boolean,
   *   routeManualReview?: boolean,
   *   strictAudit?: boolean,
   *   strictPublication?: boolean,
   *   strictHandoff?: boolean,
   *   metadata?: Record<string, unknown>
   * }} [request] Submission request.
   * @param {object | string} [actor] Submitting actor.
   * @returns {object} Submission or exception-routing result.
   */
  submitApplication(identifier, request = {}, actor) {
    const normalizedRequest = assertOptions(
      request,
      'Application submission request',
    );
    const application = this.getApplication(identifier);
    const resolvedActor = resolveActor(normalizedRequest, actor);
    const submittedBy = resolveActorId(
      normalizedRequest,
      resolvedActor ?? actor,
    );

    this.assertExpectedVersion(application, normalizedRequest);
    this.assertAuthorization(
      application,
      normalizedRequest,
      resolvedActor,
    );

    if (
      application.status === ONBOARDING_STATUSES.SUBMITTED ||
      application.workflowStage ===
        WORKFLOW_STAGES.APPLICATION_SUBMITTED
    ) {
      return this.createExistingSubmissionResult(application);
    }

    const validation = this.runFinalValidation(
      application,
      normalizedRequest,
      resolvedActor,
    );

    if (validation.valid !== true) {
      throw createSubmissionError(
        SUBMISSION_SERVICE_ERROR_CODES.FINAL_VALIDATION_FAILED,
        'The onboarding application cannot be submitted while validation errors remain.',
        {
          applicationId: application.applicationId,
          trackingId: application.trackingId,
          validationCodes: validation.validationCodes ?? [],
          errors: cloneValue(getValidationErrors(validation)),
        },
      );
    }

    const eligibility = this.runEligibility(
      application,
      normalizedRequest,
    );

    if (
      eligibility.eligible !== true &&
      eligibility.valid !== true
    ) {
      throw createSubmissionError(
        SUBMISSION_SERVICE_ERROR_CODES.ELIGIBILITY_FAILED,
        'The onboarding application is not eligible for submission.',
        {
          applicationId: application.applicationId,
          trackingId: application.trackingId,
          outcome: eligibility.outcome ?? eligibility.status ?? null,
          validationCodes: eligibility.validationCodes ?? [],
          errors: cloneValue(getEligibilityErrors(eligibility)),
        },
      );
    }

    const validationCodes = collectValidationCodes(
      validation,
      eligibility,
    );
    const manualReviewRequired =
      validation.manualReviewRequired === true ||
      eligibility.manualReviewRequired === true;

    if (
      manualReviewRequired &&
      normalizedRequest.allowManualReview !== true
    ) {
      const shouldRoute =
        normalizedRequest.routeManualReview ??
        this.routeManualReview;

      if (shouldRoute) {
        return this.routeApplicationException(application, {
          request: normalizedRequest,
          actor: resolvedActor,
          submittedBy,
          validation,
          eligibility,
          validationCodes,
        });
      }

      throw createSubmissionError(
        SUBMISSION_SERVICE_ERROR_CODES.MANUAL_REVIEW_REQUIRED,
        'The onboarding application requires manual review before submission.',
        {
          applicationId: application.applicationId,
          trackingId: application.trackingId,
          validationCodes,
        },
      );
    }

    const documentPackage = this.resolveCompletePackage(
      application,
      normalizedRequest,
    );
    const submittedAt = toIsoTimestamp(
      normalizedRequest.submittedAt ?? this.clock(),
    );
    const processingSnapshot = {
      validation: cloneValue(validation),
      eligibility: cloneValue(eligibility),
      documentPackage: createDocumentHandoff(documentPackage),
      validationCodes,
      manualReviewRequired,
      finalizedAt: submittedAt,
    };
    const submittedSnapshot = deepFreeze({
      application: cloneValue(application),
      processingSnapshot: cloneValue(processingSnapshot),
      submittedBy,
      submittedAt,
    });
    const updatedApplication = this.transitionToSubmitted(
      application,
      {
        submittedAt,
        submittedBy,
        validationCodes,
        manualReviewRequired,
        processingSnapshot,
        submittedSnapshot,
      },
      normalizedRequest,
    );
    const documentHandoff = createDocumentHandoff(documentPackage);
    const handoff = deepFreeze({
      eventType: 'ONBOARDING_APPLICATION_SUBMITTED',
      recordRef: updatedApplication.applicationId,
      applicationId: updatedApplication.applicationId,
      trackingId: updatedApplication.trackingId,
      partnerCode: updatedApplication.partnerCode,
      status: updatedApplication.status,
      workflowStage: updatedApplication.workflowStage,
      submittedBy,
      submittedAt,
      manualReviewRequired,
      validationCodes,
      documentPackage: documentHandoff,
      application: cloneValue(updatedApplication),
      metadata: cloneValue(normalizedRequest.metadata ?? {}),
    });
    const warnings = [];
    let gatewayResult = null;
    let auditEvent = null;
    let publishedEvent = null;

    try {
      gatewayResult = invokeGateway(this.handoffGateway, handoff);
    } catch (error) {
      if (
        normalizedRequest.strictHandoff ??
        this.strictHandoff
      ) {
        throw this.normalizeSideEffectError(
          SUBMISSION_SERVICE_ERROR_CODES.HANDOFF_FAILED,
          'The submitted application could not be handed off.',
          updatedApplication,
          error,
        );
      }

      warnings.push(this.createWarning(error));
    }

    try {
      auditEvent = this.appendAuditEvent(
        SUBMISSION_ACTIONS.SUBMITTED,
        updatedApplication,
        resolvedActor,
        {
          submittedBy,
          submittedAt,
          validationCodes,
          manualReviewRequired,
          documentPackageVersion:
            documentPackage.packageVersion,
          generatedArtifactIds:
            documentPackage.generatedArtifacts.map(
              (artifact) => artifact.artifactId,
            ),
        },
      );
    } catch (error) {
      if (
        normalizedRequest.strictAudit ??
        this.strictAudit
      ) {
        throw error;
      }

      warnings.push(this.createWarning(error));
    }

    try {
      publishedEvent =
        this.eventPublisher.publishApplicationSubmitted(
          {
            applicationId: updatedApplication.applicationId,
            trackingId: updatedApplication.trackingId,
            partnerCode: updatedApplication.partnerCode,
            submittedBy,
            status: updatedApplication.status,
            workflowStage: updatedApplication.workflowStage,
            validationCodes,
            manualReviewRequired,
            documentPackage: documentHandoff,
            handoff,
          },
          {
            occurredAt: submittedAt,
            metadata: cloneValue(normalizedRequest.metadata ?? {}),
          },
        );
    } catch (error) {
      if (
        normalizedRequest.strictPublication ??
        this.strictPublication
      ) {
        throw this.normalizeSideEffectError(
          SUBMISSION_SERVICE_ERROR_CODES.EVENT_PUBLICATION_FAILED,
          'The application-submitted event could not be published.',
          updatedApplication,
          error,
        );
      }

      warnings.push(this.createWarning(error));
    }

    return deepFreeze({
      submitted: true,
      outcome: SUBMISSION_OUTCOMES.SUBMITTED,
      trackingId: updatedApplication.trackingId,
      applicationId: updatedApplication.applicationId,
      status: updatedApplication.status,
      workflowStage: updatedApplication.workflowStage,
      submittedAt,
      submittedBy,
      manualReviewRequired,
      validationCodes,
      validation: cloneValue(validation),
      eligibility: cloneValue(eligibility),
      documentPackage: documentHandoff,
      application: cloneValue(updatedApplication),
      submittedSnapshot: cloneValue(submittedSnapshot),
      handoff,
      gatewayResult,
      auditEvent: cloneValue(auditEvent),
      event: cloneValue(publishedEvent),
      warnings,
    });
  }

  /**
   * Alias for submitApplication.
   *
   * @param {string | number} identifier Application identifier.
   * @param {object} [request] Submission request.
   * @param {object | string} [actor] Submitting actor.
   * @returns {object} Submission result.
   */
  submit(identifier, request = {}, actor) {
    return this.submitApplication(identifier, request, actor);
  }

  /**
   * Runs submission gates without changing application state.
   *
   * @param {string | number} identifier Application identifier.
   * @param {object} [options] Validation options.
   * @returns {object} Submission readiness result.
   */
  validateSubmission(identifier, options = {}) {
    const normalizedOptions = assertOptions(
      options,
      'Submission validation options',
    );
    const application = this.getApplication(identifier);
    const actor = resolveActor(normalizedOptions);
    const validation = this.runFinalValidation(
      application,
      normalizedOptions,
      actor,
    );
    const eligibility =
      validation.valid === true
        ? this.runEligibility(application, normalizedOptions)
        : null;
    let documentPackage = null;
    let packageError = null;

    if (
      validation.valid === true &&
      (eligibility?.eligible === true ||
        eligibility?.valid === true)
    ) {
      try {
        documentPackage = this.resolveCompletePackage(
          application,
          normalizedOptions,
        );
      } catch (error) {
        packageError = error;
      }
    }

    const validationCodes = collectValidationCodes(
      validation,
      eligibility,
    );
    const manualReviewRequired =
      validation.manualReviewRequired === true ||
      eligibility?.manualReviewRequired === true;
    const ready =
      validation.valid === true &&
      (eligibility?.eligible === true ||
        eligibility?.valid === true) &&
      !manualReviewRequired &&
      packageError === null;

    return deepFreeze({
      ready,
      submissionReady: ready,
      trackingId: application.trackingId,
      applicationId: application.applicationId,
      validation: cloneValue(validation),
      eligibility: cloneValue(eligibility),
      documentPackage: cloneValue(documentPackage),
      validationCodes,
      manualReviewRequired,
      errors: [
        ...cloneValue(getValidationErrors(validation)),
        ...cloneValue(getEligibilityErrors(eligibility)),
        ...(packageError
          ? [
              {
                code: packageError.code,
                message: packageError.message,
                details: cloneValue(packageError.details),
              },
            ]
          : []),
      ],
      checkedAt: toIsoTimestamp(this.clock()),
    });
  }

  /**
   * Alias for validateSubmission.
   *
   * @param {string | number} identifier Application identifier.
   * @param {object} [options] Validation options.
   * @returns {object} Readiness result.
   */
  checkSubmissionReadiness(identifier, options = {}) {
    return this.validateSubmission(identifier, options);
  }

  getApplication(identifier) {
    const normalizedIdentifier = normalizeIdentifier(
      identifier,
      'Application identifier',
    );
    const application = this.applicationRepository.find(
      normalizedIdentifier,
    );

    if (!application) {
      throw createSubmissionError(
        SUBMISSION_SERVICE_ERROR_CODES.APPLICATION_NOT_FOUND,
        `Onboarding application not found: ${normalizedIdentifier}`,
        { identifier: normalizedIdentifier },
      );
    }

    return cloneValue(application);
  }

  assertExpectedVersion(application, request) {
    const expectedVersion =
      request.applicationVersion ?? request.expectedVersion;

    if (
      expectedVersion !== undefined &&
      (!Number.isInteger(expectedVersion) || expectedVersion < 1)
    ) {
      throw new RangeError(
        'The expected application version must be a positive integer.',
      );
    }

    if (
      expectedVersion !== undefined &&
      (application.version ?? 1) !== expectedVersion
    ) {
      throw createSubmissionError(
        SUBMISSION_SERVICE_ERROR_CODES.VERSION_CONFLICT,
        'The onboarding application was changed after it was last read.',
        {
          applicationId: application.applicationId,
          expectedVersion,
          actualVersion: application.version ?? 1,
        },
      );
    }

    if (
      request.expectedUpdatedAt !== undefined &&
      application.updatedAt !== request.expectedUpdatedAt
    ) {
      throw createSubmissionError(
        SUBMISSION_SERVICE_ERROR_CODES.VERSION_CONFLICT,
        'The onboarding application was changed after it was last read.',
        {
          applicationId: application.applicationId,
          expectedUpdatedAt: request.expectedUpdatedAt,
          actualUpdatedAt: application.updatedAt,
        },
      );
    }
  }

  assertAuthorization(application, request, actor) {
    const requireAuthorization =
      request.requireAuthorization ??
      this.requireAuthorization;
    const principal = request.principal ?? actor;

    if (!requireAuthorization && principal === null) {
      return;
    }

    if (
      !principal ||
      !canPerformAction(
        principal,
        PERMISSIONS.SUBMIT_ONBOARDING,
        application,
      )
    ) {
      throw createSubmissionError(
        SUBMISSION_SERVICE_ERROR_CODES.UNAUTHORIZED,
        'The current principal cannot submit this onboarding application.',
        {
          applicationId: application.applicationId,
          trackingId: application.trackingId,
        },
      );
    }
  }

  runFinalValidation(application, request, actor) {
    try {
      const options = {
        scope: VALIDATION_SCOPES.SUBMISSION,
        requiredForms: request.requiredForms,
        completedForms: request.completedForms,
        principal: request.principal ?? actor,
        requireAuthorization: false,
        enforcePartnerScope: true,
        persist: false,
      };

      return cloneValue(
        typeof this.validationService.validateForSubmission ===
        'function'
          ? this.validationService.validateForSubmission(
              application,
              options,
            )
          : this.validationService.validateApplication(
              application,
              options,
            ),
      );
    } catch (error) {
      if (error?.name === 'SubmissionServiceError') {
        throw error;
      }

      throw createSubmissionError(
        SUBMISSION_SERVICE_ERROR_CODES.FINAL_VALIDATION_FAILED,
        'Final onboarding validation could not be completed.',
        {
          applicationId: application.applicationId,
          trackingId: application.trackingId,
        },
        error,
      );
    }
  }

  runEligibility(application, request) {
    try {
      return cloneValue(
        this.eligibilityService.runEligibilityChecks(application, {
          includeProviders: request.includeProviders,
          providerCodes: request.providerCodes,
          providerScenarios: request.providerScenarios,
          providerOptions: request.providerOptions,
          strictProviders: request.strictProviders,
          strictConfiguration: request.strictConfiguration,
          applicationRecords: request.applicationRecords,
          historicalAssets: request.historicalAssets,
          persist: false,
        }),
      );
    } catch (error) {
      if (error?.name === 'SubmissionServiceError') {
        throw error;
      }

      throw createSubmissionError(
        SUBMISSION_SERVICE_ERROR_CODES.ELIGIBILITY_FAILED,
        'Final onboarding eligibility checks could not be completed.',
        {
          applicationId: application.applicationId,
          trackingId: application.trackingId,
        },
        error,
      );
    }
  }

  resolveCompletePackage(application, request) {
    const requirePackage =
      request.requireDocumentPackage ??
      this.requireDocumentPackage;
    let documentPackage;

    try {
      documentPackage =
        typeof this.documentPackageService.getPackage === 'function'
          ? this.documentPackageService.getPackage(
              application.trackingId,
            )
          : this.documentPackageService.getDocumentPackageSummary(
              application.trackingId,
            );
    } catch (error) {
      if (!requirePackage) {
        return {
          trackingId: application.trackingId,
          applicationId: application.applicationId,
          packageVersion: 0,
          status: 'NOT_REQUIRED',
          requiredForms: [],
          generatedArtifacts: [],
          retainedSignatures: {},
          retainedGaSignature: false,
          agentSignatureState: 'NOT_STARTED',
          signOff: {},
          packageComplete: true,
          generatedAt: application.updatedAt,
          updatedAt: application.updatedAt,
          completedAt: application.updatedAt,
        };
      }

      throw createSubmissionError(
        SUBMISSION_SERVICE_ERROR_CODES.DOCUMENT_PACKAGE_NOT_FOUND,
        'A document package is required before submission.',
        {
          applicationId: application.applicationId,
          trackingId: application.trackingId,
        },
        error,
      );
    }

    if (
      typeof this.documentPackageService.validateSignatures ===
      'function'
    ) {
      const signatureValidation =
        this.documentPackageService.validateSignatures(
          documentPackage,
          {
            requireAgentSignature:
              request.requireAgentSignature !== false,
            requireGaSignature:
              request.requireGaSignature === true,
            requirePrincipalSignature:
              request.requirePrincipalSignature === true,
          },
        );

      if (!signatureValidation.valid) {
        throw createSubmissionError(
          SUBMISSION_SERVICE_ERROR_CODES.SIGNATURE_REQUIRED,
          'Required document package signatures are missing.',
          {
            applicationId: application.applicationId,
            trackingId: application.trackingId,
            issues: cloneValue(signatureValidation.issues),
          },
        );
      }
    }

    if (
      documentPackage.packageComplete !== true &&
      (request.autoCompletePackage ?? this.autoCompletePackage) &&
      typeof this.documentPackageService.completePackage === 'function'
    ) {
      documentPackage =
        this.documentPackageService.completePackage(
          application.trackingId,
          {
            expectedVersion: request.packageVersion,
            actor: request.actor ?? request.requestedBy,
            requireAgentSignature:
              request.requireAgentSignature !== false,
            requireGaSignature:
              request.requireGaSignature === true,
            requirePrincipalSignature:
              request.requirePrincipalSignature === true,
          },
        );
    }

    if (
      requirePackage &&
      documentPackage.packageComplete !== true
    ) {
      throw createSubmissionError(
        SUBMISSION_SERVICE_ERROR_CODES.DOCUMENT_PACKAGE_INCOMPLETE,
        'The document package must be complete before submission.',
        {
          applicationId: application.applicationId,
          trackingId: application.trackingId,
          packageVersion: documentPackage.packageVersion ?? null,
          packageStatus: documentPackage.status ?? null,
        },
      );
    }

    return cloneValue(documentPackage);
  }

  transitionToSubmitted(application, submission, request) {
    const patch = {
      status: ONBOARDING_STATUSES.SUBMITTED,
      workflowStage: WORKFLOW_STAGES.APPLICATION_SUBMITTED,
      submittedAt: submission.submittedAt,
      submittedBy: submission.submittedBy,
      manualReviewRequired: submission.manualReviewRequired,
      validationCodes: cloneValue(submission.validationCodes),
      processingSnapshot: cloneValue(submission.processingSnapshot),
      submittedSnapshot: cloneValue(submission.submittedSnapshot),
      version: (application.version ?? 1) + 1,
    };

    try {
      if (typeof this.applicationRepository.update === 'function') {
        return cloneValue(
          this.applicationRepository.update(
            application.applicationId,
            patch,
            {
              expectedUpdatedAt: request.expectedUpdatedAt,
              touchUpdatedAt: true,
            },
          ),
        );
      }

      return cloneValue(
        this.applicationRepository.submit(
          application.applicationId,
          {
            submittedBy: submission.submittedBy,
            expectedUpdatedAt: request.expectedUpdatedAt,
          },
        ),
      );
    } catch (error) {
      throw createSubmissionError(
        SUBMISSION_SERVICE_ERROR_CODES.STATE_TRANSITION_FAILED,
        'The onboarding application could not transition to submitted.',
        {
          applicationId: application.applicationId,
          trackingId: application.trackingId,
        },
        error,
      );
    }
  }

  routeApplicationException(application, context) {
    const routedAt = toIsoTimestamp(this.clock());
    const patch = {
      status: ONBOARDING_STATUSES.ACTION_REQUIRED,
      workflowStage: WORKFLOW_STAGES.MANUAL_EXCEPTION,
      manualReviewRequired: true,
      validationCodes: cloneValue(context.validationCodes),
      processingSnapshot: {
        validation: cloneValue(context.validation),
        eligibility: cloneValue(context.eligibility),
        validationCodes: cloneValue(context.validationCodes),
        manualReviewRequired: true,
        finalizedAt: routedAt,
      },
      version: (application.version ?? 1) + 1,
    };
    let updatedApplication;

    try {
      updatedApplication =
        this.applicationRepository.update(
          application.applicationId,
          patch,
          {
            expectedUpdatedAt:
              context.request.expectedUpdatedAt,
            touchUpdatedAt: true,
          },
        );
    } catch (error) {
      throw createSubmissionError(
        SUBMISSION_SERVICE_ERROR_CODES.STATE_TRANSITION_FAILED,
        'The onboarding application could not be routed for manual review.',
        {
          applicationId: application.applicationId,
          trackingId: application.trackingId,
        },
        error,
      );
    }

    const warnings = [];
    let auditEvent = null;
    let publishedEvent = null;

    try {
      auditEvent = this.appendAuditEvent(
        SUBMISSION_ACTIONS.EXCEPTION_ROUTED,
        updatedApplication,
        context.actor,
        {
          routedAt,
          validationCodes: context.validationCodes,
          outcome:
            context.eligibility.outcome ??
            context.eligibility.status ??
            null,
        },
      );
    } catch (error) {
      if (
        context.request.strictAudit ??
        this.strictAudit
      ) {
        throw error;
      }

      warnings.push(this.createWarning(error));
    }

    try {
      publishedEvent =
        this.eventPublisher.publishApplicationExceptionRouted(
          {
            applicationId: updatedApplication.applicationId,
            trackingId: updatedApplication.trackingId,
            partnerCode: updatedApplication.partnerCode,
            exceptionCode:
              context.validationCodes[0] ?? null,
            validationCodes: context.validationCodes,
            reason: 'Manual review is required.',
            routedTo:
              context.request.routedTo ??
              updatedApplication.assignment?.team ??
              'operations',
            status: updatedApplication.status,
            workflowStage: updatedApplication.workflowStage,
          },
          {
            occurredAt: routedAt,
            metadata: cloneValue(context.request.metadata ?? {}),
          },
        );
    } catch (error) {
      if (
        context.request.strictPublication ??
        this.strictPublication
      ) {
        throw this.normalizeSideEffectError(
          SUBMISSION_SERVICE_ERROR_CODES.EVENT_PUBLICATION_FAILED,
          'The application exception event could not be published.',
          updatedApplication,
          error,
        );
      }

      warnings.push(this.createWarning(error));
    }

    return deepFreeze({
      submitted: false,
      outcome: SUBMISSION_OUTCOMES.EXCEPTION_ROUTED,
      trackingId: updatedApplication.trackingId,
      applicationId: updatedApplication.applicationId,
      status: updatedApplication.status,
      workflowStage: updatedApplication.workflowStage,
      submittedAt: null,
      submittedBy: context.submittedBy,
      manualReviewRequired: true,
      validationCodes: cloneValue(context.validationCodes),
      validation: cloneValue(context.validation),
      eligibility: cloneValue(context.eligibility),
      documentPackage: null,
      application: cloneValue(updatedApplication),
      handoff: {
        eventType: 'ONBOARDING_APPLICATION_EXCEPTION_ROUTED',
        recordRef: updatedApplication.applicationId,
      },
      auditEvent: cloneValue(auditEvent),
      event: cloneValue(publishedEvent),
      warnings,
    });
  }

  appendAuditEvent(action, application, actor, metadata) {
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
          trackingId: application.trackingId,
          applicationId: application.applicationId,
          sourceRecordId: application.applicationId,
          action,
          summary:
            action === SUBMISSION_ACTIONS.SUBMITTED
              ? 'The onboarding application was submitted.'
              : 'The onboarding application was routed for manual review.',
          status: application.workflowStage,
          metadata: cloneValue(metadata),
          timestamp: toIsoTimestamp(this.clock()),
        },
        {
          actor,
          source: AUDIT_SOURCES.SUBMISSION_SERVICE,
        },
      );
    } catch (error) {
      throw createSubmissionError(
        SUBMISSION_SERVICE_ERROR_CODES.AUDIT_FAILED,
        'The submission audit event could not be persisted.',
        {
          action,
          applicationId: application.applicationId,
          trackingId: application.trackingId,
        },
        error,
      );
    }
  }

  createExistingSubmissionResult(application) {
    return deepFreeze({
      submitted: true,
      idempotent: true,
      outcome: SUBMISSION_OUTCOMES.SUBMITTED,
      trackingId: application.trackingId,
      applicationId: application.applicationId,
      status: application.status,
      workflowStage: application.workflowStage,
      submittedAt: application.submittedAt ?? null,
      submittedBy: application.submittedBy ?? null,
      manualReviewRequired:
        application.manualReviewRequired ?? false,
      validationCodes: cloneValue(
        application.validationCodes ?? [],
      ),
      validation: cloneValue(
        application.processingSnapshot?.validation ?? null,
      ),
      eligibility: cloneValue(
        application.processingSnapshot?.eligibility ?? null,
      ),
      documentPackage: cloneValue(
        application.processingSnapshot?.documentPackage ?? null,
      ),
      application: cloneValue(application),
      submittedSnapshot: cloneValue(
        application.submittedSnapshot ?? null,
      ),
      handoff: {
        eventType: ONBOARDING_EVENT_NAMES.APPLICATION_SUBMITTED,
        recordRef: application.applicationId,
      },
      gatewayResult: null,
      auditEvent: null,
      event: null,
      warnings: [],
    });
  }

  normalizeSideEffectError(code, message, application, error) {
    if (error?.name === 'SubmissionServiceError') {
      return error;
    }

    return createSubmissionError(
      code,
      message,
      {
        applicationId: application.applicationId,
        trackingId: application.trackingId,
        stateCommitted: true,
      },
      error,
    );
  }

  createWarning(error) {
    return Object.freeze({
      code:
        normalizeOptionalIdentifier(error?.code) ??
        SUBMISSION_SERVICE_ERROR_CODES.INVALID_REQUEST,
      message:
        normalizeOptionalIdentifier(error?.message) ??
        'A submission side effect could not be completed.',
      details: cloneValue(error?.details ?? null),
    });
  }
}

/**
 * Creates a submission service.
 *
 * @param {ConstructorParameters<typeof SubmissionService>[0]} [options]
 * Submission service options.
 * @returns {SubmissionService} Submission service.
 */
export function createSubmissionService(options = {}) {
  return new SubmissionService(options);
}

/**
 * Submits an application with a newly created service.
 *
 * @param {string | number} identifier Application identifier.
 * @param {object} [request] Submission request.
 * @param {ConstructorParameters<typeof SubmissionService>[0]}
 * [serviceOptions] Service options.
 * @returns {object} Submission result.
 */
export function submitApplication(
  identifier,
  request = {},
  serviceOptions = {},
) {
  return createSubmissionService(serviceOptions).submitApplication(
    identifier,
    request,
  );
}

export const SubmissionModule = SubmissionService;
export const OnboardingSubmissionService = SubmissionService;
export const createOnboardingSubmissionService =
  createSubmissionService;
export const finalizeApplicationSubmission = submitApplication;

export default SubmissionService;