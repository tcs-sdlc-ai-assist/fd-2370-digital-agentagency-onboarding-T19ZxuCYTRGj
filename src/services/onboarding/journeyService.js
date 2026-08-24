import {
  AUDIT_ACTOR_TYPES,
  AUDIT_SOURCES,
  WORKFLOW_STAGES,
} from '../../constants/domain.js';
import { JourneyDraftRepository } from '../../repositories/journeyDraftRepository.js';
import { toIsoTimestamp } from '../../utils/dates.js';
import {
  generateApplicationId,
  generateTrackingId,
} from '../../utils/ids.js';
import {
  buildJourneyPrefill,
  computeSkippedSteps,
  getActiveJourneySteps,
  getJourneyDefinition,
  getJourneyDefinitionForApplication,
  getJourneyNavigation,
  getJourneyStep,
  inferJourneyType,
  JOURNEY_STEP_IDS,
  shouldSkipJourneyStep,
} from './journeyDefinitions.js';
import {
  createValidationService,
  VALIDATION_SCOPES,
} from './validationService.js';

export const JOURNEY_SERVICE_ERROR_CODES = Object.freeze({
  INVALID_OPTIONS: 'JOURNEY_SERVICE_INVALID_OPTIONS',
  INVALID_REQUEST: 'JOURNEY_SERVICE_INVALID_REQUEST',
  INVALID_REPOSITORY: 'JOURNEY_SERVICE_INVALID_REPOSITORY',
  INVALID_VALIDATOR: 'JOURNEY_SERVICE_INVALID_VALIDATOR',
  INVALID_STEP: 'JOURNEY_SERVICE_INVALID_STEP',
  NOT_FOUND: 'JOURNEY_SERVICE_NOT_FOUND',
  PARTNER_SCOPE_MISMATCH: 'JOURNEY_SERVICE_PARTNER_SCOPE_MISMATCH',
  STEP_NOT_AVAILABLE: 'JOURNEY_SERVICE_STEP_NOT_AVAILABLE',
  STEP_VALIDATION_FAILED: 'JOURNEY_SERVICE_STEP_VALIDATION_FAILED',
  SIGNATURE_REQUIRED: 'JOURNEY_SERVICE_SIGNATURE_REQUIRED',
  REVIEW_FAILED: 'JOURNEY_SERVICE_REVIEW_FAILED',
  PERSISTENCE_FAILED: 'JOURNEY_SERVICE_PERSISTENCE_FAILED',
  AUDIT_FAILED: 'JOURNEY_SERVICE_AUDIT_FAILED',
});

export const JOURNEY_SAVE_MODES = Object.freeze({
  AUTO: 'AUTO',
  MANUAL: 'MANUAL',
  SAVE_AND_EXIT: 'SAVE_AND_EXIT',
});

export const JOURNEY_SIGN_OFF_STATES = Object.freeze({
  NOT_STARTED: 'NOT_STARTED',
  CONSENTED: 'CONSENTED',
  SIGNED: 'SIGNED',
  DECLINED: 'DECLINED',
  EXPIRED: 'EXPIRED',
});

export const DEFAULT_JOURNEY_PARTNER_CODE = 'DEMO_PARTNER';

const MATERIAL_ACTIONS = Object.freeze({
  INITIATED: 'JOURNEY_INITIATED',
  DRAFT_SAVED: 'JOURNEY_DRAFT_SAVED',
  SECTION_SAVED: 'JOURNEY_SECTION_SAVED',
  STEP_COMPLETED: 'JOURNEY_STEP_COMPLETED',
  SIGN_OFF_UPDATED: 'JOURNEY_SIGN_OFF_UPDATED',
  REVIEW_COMPLETED: 'JOURNEY_REVIEW_COMPLETED',
  COMPLETED: 'JOURNEY_COMPLETED',
});

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertOptions(options, description = 'Journey service options') {
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

function normalizeIdentifierForLookup(value, description = 'Identifier') {
  return normalizeIdentifier(value, description)
    .normalize('NFKC')
    .toLowerCase();
}

function normalizeStringArray(values, description) {
  if (!Array.isArray(values)) {
    throw new TypeError(`${description} must be an array.`);
  }

  return [
    ...new Set(
      values.map((value) =>
        normalizeIdentifier(value, `${description} entry`),
      ),
    ),
  ];
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

function deepMerge(baseValue, overlayValue) {
  if (overlayValue === undefined) {
    return cloneValue(baseValue);
  }

  if (!isObject(baseValue) || !isObject(overlayValue)) {
    return cloneValue(overlayValue);
  }

  const mergedValue = cloneValue(baseValue);

  Object.entries(overlayValue).forEach(([key, value]) => {
    if (value === undefined) {
      return;
    }

    if (isObject(value) && isObject(mergedValue[key])) {
      mergedValue[key] = deepMerge(mergedValue[key], value);
      return;
    }

    mergedValue[key] = cloneValue(value);
  });

  return mergedValue;
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

function createJourneyServiceError(code, message, details, cause) {
  const error = new Error(message, {
    ...(cause === undefined ? {} : { cause }),
  });

  error.name = 'JourneyServiceError';
  error.code = code;
  error.details = details ?? null;
  error.recoverable = true;

  return error;
}

function assertDraftRepository(repository) {
  const requiredMethods = ['create', 'find', 'list', 'update'];

  if (
    !isObject(repository) ||
    requiredMethods.some(
      (method) => typeof repository[method] !== 'function',
    )
  ) {
    throw createJourneyServiceError(
      JOURNEY_SERVICE_ERROR_CODES.INVALID_REPOSITORY,
      'The journey draft repository must provide create, find, list, and update methods.',
      null,
    );
  }

  return repository;
}

function assertValidationService(validationService) {
  if (
    !isObject(validationService) ||
    typeof validationService.validateApplication !== 'function'
  ) {
    throw createJourneyServiceError(
      JOURNEY_SERVICE_ERROR_CODES.INVALID_VALIDATOR,
      'The journey validation service must provide validateApplication.',
      null,
    );
  }

  return validationService;
}

function assertOptionalApplicationRepository(repository) {
  if (repository === undefined || repository === null) {
    return null;
  }

  if (
    !isObject(repository) ||
    typeof repository.find !== 'function'
  ) {
    throw createJourneyServiceError(
      JOURNEY_SERVICE_ERROR_CODES.INVALID_REPOSITORY,
      'The application repository must provide a find method.',
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
    throw createJourneyServiceError(
      JOURNEY_SERVICE_ERROR_CODES.INVALID_REPOSITORY,
      'The journey audit service must provide append or create.',
      null,
    );
  }

  return auditService;
}

function buildJourneyRoute(journeyType, trackingId, stepId) {
  return `/journeys/${encodeURIComponent(
    normalizeIdentifier(journeyType, 'Journey type'),
  )}/${encodeURIComponent(
    normalizeIdentifier(trackingId, 'Tracking identifier'),
  )}/${encodeURIComponent(
    normalizeIdentifier(stepId, 'Journey step identifier'),
  )}`;
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

function resolveActorType(actor) {
  if (!isObject(actor)) {
    return AUDIT_ACTOR_TYPES.SYSTEM;
  }

  const role =
    actor.role ?? actor.user?.role ?? actor.currentUser?.role;

  return ['partner', 'agency'].includes(role)
    ? AUDIT_ACTOR_TYPES.PARTNER_USER
    : AUDIT_ACTOR_TYPES.INTERNAL_USER;
}

function resolvePartnerCode(request, fallbackPartnerCode) {
  return normalizeIdentifier(
    request.partnerCode ??
      request.prefillPayload?.partnerCode ??
      request.application?.partnerCode ??
      request.requestedBy?.partnerCode ??
      request.requestedBy?.partnerContext?.partnerCode ??
      request.actor?.partnerCode ??
      request.actor?.partnerContext?.partnerCode ??
      fallbackPartnerCode,
    'Partner code',
  );
}

function createApplicationView(draft) {
  return {
    ...cloneValue(draft.formState),
    trackingId: draft.trackingId,
    applicationId: draft.applicationId ?? null,
    partnerCode: draft.partnerCode,
    journeyType: draft.journeyType,
    status: draft.status,
    currentStepId: draft.currentStepId,
    completedSteps: cloneValue(draft.completedSteps),
    skippedSteps: cloneValue(draft.skippedSteps),
    signatures: cloneValue(draft.signatures),
    completionState: cloneValue(draft.completionState),
  };
}

function getPresentableSteps(application, journeyType, options = {}) {
  return getActiveJourneySteps(application, {
    ...options,
    journeyType,
    skipPrefilled: options.skipPrefilled ?? false,
  });
}

function calculateProgress(draft, definition) {
  const application = createApplicationView(draft);
  const skippedSteps = new Set(draft.skippedSteps);
  const completedSteps = new Set(draft.completedSteps);
  const progressSteps = definition.steps.filter(
    (step) =>
      !step.navigationOnly &&
      step.id !== JOURNEY_STEP_IDS.COMPLETE,
  );
  const applicableSteps = progressSteps.filter(
    (step) => !skippedSteps.has(step.id),
  );
  const completedCount = applicableSteps.filter((step) =>
    completedSteps.has(step.id),
  ).length;
  const totalSteps = applicableSteps.length;
  const percentComplete =
    totalSteps === 0
      ? 100
      : Math.min(100, Math.round((completedCount / totalSteps) * 100));

  return Object.freeze({
    completed: draft.completionState.completed,
    percentComplete: draft.completionState.completed
      ? 100
      : percentComplete,
    completedCount,
    totalSteps,
    remainingCount: Math.max(0, totalSteps - completedCount),
    currentStepId: draft.currentStepId,
    skippedSteps: Object.freeze([...draft.skippedSteps]),
    completedSteps: Object.freeze([...draft.completedSteps]),
    application,
  });
}

function resolveInitialStep(definition, application, skippedSteps) {
  const skippedStepSet = new Set(skippedSteps);

  return (
    definition.steps.find(
      (step) =>
        !skippedStepSet.has(step.id) &&
        !shouldSkipJourneyStep(step, application, {
          skippedSteps,
          skipPrefilled: false,
        }),
    ) ?? definition.steps[0]
  );
}

function normalizeSaveMode(saveMode) {
  const normalizedSaveMode =
    saveMode ?? JOURNEY_SAVE_MODES.MANUAL;

  if (!Object.values(JOURNEY_SAVE_MODES).includes(normalizedSaveMode)) {
    throw new TypeError(
      `Unsupported journey save mode: ${normalizedSaveMode}.`,
    );
  }

  return normalizedSaveMode;
}

function hasSignedSignature(signatures) {
  return Object.values(signatures ?? {}).some(
    (signature) =>
      isObject(signature) &&
      signature.status === JOURNEY_SIGN_OFF_STATES.SIGNED,
  );
}

/**
 * Orchestrates journey initiation, navigation, persistence, validation,
 * progress, resume state, and sign-off.
 */
export class JourneyService {
  /**
   * @param {{
   *   partnerCode?: string,
   *   draftRepository?: object,
   *   applicationRepository?: object,
   *   validationService?: object,
   *   auditService?: object | false,
   *   storage?: Storage,
   *   namespace?: string,
   *   schemaVersion?: number,
   *   clock?: () => Date | string | number,
   *   onStorageError?: (error: object) => void
   * }} [options] Journey service options.
   */
  constructor(options = {}) {
    const normalizedOptions = assertOptions(options);

    if (
      normalizedOptions.clock !== undefined &&
      typeof normalizedOptions.clock !== 'function'
    ) {
      throw new TypeError('The journey service clock must be a function.');
    }

    this.partnerCode = normalizeIdentifier(
      normalizedOptions.partnerCode ?? DEFAULT_JOURNEY_PARTNER_CODE,
      'Partner code',
    );
    this.clock = normalizedOptions.clock ?? (() => new Date());
    this.draftRepository = assertDraftRepository(
      normalizedOptions.draftRepository ??
        new JourneyDraftRepository({
          partnerCode: this.partnerCode,
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
    this.applicationRepository = assertOptionalApplicationRepository(
      normalizedOptions.applicationRepository,
    );
    this.validationService = assertValidationService(
      normalizedOptions.validationService ??
        createValidationService(),
    );
    this.auditService =
      normalizedOptions.auditService === false
        ? null
        : assertOptionalAuditService(normalizedOptions.auditService);
  }

  /**
   * Initiates a guided journey from normalized or manually supplied data.
   *
   * @param {{
   *   trackingId?: string,
   *   applicationId?: string | null,
   *   partnerCode?: string,
   *   journeyType?: string,
   *   prefillPayload?: object,
   *   application?: object,
   *   requestedBy?: object,
   *   actor?: object,
   *   skipPrefilled?: boolean,
   *   forceIncludedSteps?: string[],
   *   expiresAt?: string | null,
   *   metadata?: object
   * }} request Journey initiation request.
   * @returns {object} Journey initiation result.
   */
  initiateJourney(request) {
    const normalizedRequest = assertOptions(
      request,
      'Journey initiation request',
    );
    const suppliedApplication =
      normalizedRequest.application ??
      normalizedRequest.prefillPayload ??
      {};

    if (!isObject(suppliedApplication)) {
      throw createJourneyServiceError(
        JOURNEY_SERVICE_ERROR_CODES.INVALID_REQUEST,
        'Journey prefill data must be an object.',
        null,
      );
    }

    const timestamp = toIsoTimestamp(this.clock());
    const partnerCode = resolvePartnerCode(
      normalizedRequest,
      this.partnerCode,
    );

    this.assertPartnerScope(partnerCode);

    const trackingId =
      normalizeOptionalIdentifier(normalizedRequest.trackingId) ??
      normalizeOptionalIdentifier(suppliedApplication.trackingId) ??
      generateTrackingId({
        partnerCode,
        journeyType:
          normalizedRequest.journeyType ??
          suppliedApplication.journeyType ??
          null,
        timestamp,
        sourceSubmissionId:
          suppliedApplication.submissionId ?? null,
      });

    const existingDraft = this.draftRepository.find(trackingId);

    if (existingDraft) {
      return this.buildJourneyView(existingDraft);
    }

    const applicationId =
      normalizeOptionalIdentifier(normalizedRequest.applicationId) ??
      normalizeOptionalIdentifier(suppliedApplication.applicationId) ??
      generateApplicationId({ trackingId });
    const journeyType =
      normalizedRequest.journeyType ??
      inferJourneyType(suppliedApplication);
    const definition = getJourneyDefinition(journeyType);
    const formState = deepMerge(
      buildJourneyPrefill(suppliedApplication, {
        journeyType: definition.type,
      }),
      suppliedApplication,
    );
    const application = {
      ...cloneValue(suppliedApplication),
      ...cloneValue(formState),
      trackingId,
      applicationId,
      partnerCode,
      journeyType: definition.type,
    };
    const skippedSteps = computeSkippedSteps(application, {
      journeyType: definition.type,
      skipPrefilled: normalizedRequest.skipPrefilled !== false,
      forceIncludedSteps:
        normalizedRequest.forceIncludedSteps ?? [],
    });
    const initialStep = resolveInitialStep(
      definition,
      application,
      skippedSteps,
    );
    const draft = {
      trackingId,
      applicationId,
      partnerCode,
      journeyType: definition.type,
      status: WORKFLOW_STAGES.APPLICATION_STARTED,
      currentStepId: initialStep.id,
      resumeUrl: buildJourneyRoute(
        definition.type,
        trackingId,
        initialStep.id,
      ),
      formState: cloneValue(formState),
      dirtySections: [],
      completedSteps: [],
      skippedSteps,
      completionState: {
        completed: false,
        percentComplete: 0,
        completedSteps: [],
        skippedSteps,
        packageComplete: false,
        submissionReady: false,
      },
      signatures: {},
      lastValidationResult: null,
      saveMode: JOURNEY_SAVE_MODES.MANUAL,
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      lastSavedAt: timestamp,
      expiresAt: normalizedRequest.expiresAt ?? null,
      submittedAt: null,
      metadata: {
        ...cloneValue(normalizedRequest.metadata ?? {}),
        initiatedBy: resolveActorId(
          normalizedRequest.requestedBy ??
            normalizedRequest.actor,
        ),
      },
    };

    try {
      const createdDraft = this.draftRepository.create(draft);

      this.appendAuditEvent(
        MATERIAL_ACTIONS.INITIATED,
        createdDraft,
        normalizedRequest.requestedBy ??
          normalizedRequest.actor,
        {
          journeyType: definition.type,
          initialStepId: initialStep.id,
          skippedSteps,
        },
      );

      return this.buildJourneyView(createdDraft);
    } catch (error) {
      if (
        error?.name === 'JourneyDraftRepositoryError' ||
        error?.name === 'JourneyServiceError'
      ) {
        throw error;
      }

      throw createJourneyServiceError(
        JOURNEY_SERVICE_ERROR_CODES.PERSISTENCE_FAILED,
        'Unable to create the journey draft.',
        { trackingId },
        error,
      );
    }
  }

  /**
   * Alias for initiateJourney.
   *
   * @param {object} request Journey initiation request.
   * @returns {object} Journey initiation result.
   */
  initiate(request) {
    return this.initiateJourney(request);
  }

  /**
   * Loads a partner-scoped journey draft for resume.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @param {{partnerCode?: string}} [options] Resume options.
   * @returns {object} Journey view.
   */
  loadDraft(trackingId, options = {}) {
    const normalizedOptions = assertOptions(
      options,
      'Journey load options',
    );

    if (normalizedOptions.partnerCode !== undefined) {
      this.assertPartnerScope(normalizedOptions.partnerCode);
    }

    const draft = this.draftRepository.find(trackingId);

    if (!draft) {
      throw createJourneyServiceError(
        JOURNEY_SERVICE_ERROR_CODES.NOT_FOUND,
        `Journey draft not found: ${trackingId}`,
        { trackingId: String(trackingId) },
      );
    }

    this.assertPartnerScope(draft.partnerCode);
    return this.buildJourneyView(draft);
  }

  /**
   * Alias for loadDraft.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @param {object} [options] Resume options.
   * @returns {object} Journey view.
   */
  resumeJourney(trackingId, options = {}) {
    return this.loadDraft(trackingId, options);
  }

  /**
   * Persists a draft patch.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @param {object} patch Draft patch.
   * @param {{
   *   expectedVersion?: number,
   *   saveMode?: 'AUTO' | 'MANUAL' | 'SAVE_AND_EXIT',
   *   actor?: object,
   *   validate?: boolean,
   *   validationScope?: string | string[] | object
   * }} [options] Save options.
   * @returns {object} Updated journey view.
   */
  saveDraft(trackingId, patch, options = {}) {
    if (!isObject(patch)) {
      throw new TypeError('A journey draft patch must be an object.');
    }

    const normalizedOptions = assertOptions(
      options,
      'Journey save options',
    );
    const currentDraft = this.getDraftRecord(trackingId);
    const saveMode = normalizeSaveMode(normalizedOptions.saveMode);
    const canonicalFields = ['trackingId', 'partnerCode'];

    canonicalFields.forEach((field) => {
      if (
        patch[field] !== undefined &&
        patch[field] !== currentDraft[field]
      ) {
        throw createJourneyServiceError(
          JOURNEY_SERVICE_ERROR_CODES.INVALID_REQUEST,
          `The canonical journey field "${field}" cannot be changed.`,
          {
            field,
            currentValue: currentDraft[field],
            requestedValue: patch[field],
          },
        );
      }
    });

    let validationResult = currentDraft.lastValidationResult;

    if (normalizedOptions.validate === true) {
      const application = createApplicationView({
        ...currentDraft,
        ...cloneValue(patch),
        formState: deepMerge(
          currentDraft.formState,
          patch.formState ?? {},
        ),
      });

      validationResult =
        this.validationService.validateApplication(
          application,
          normalizedOptions.validationScope ??
            VALIDATION_SCOPES.FULL,
          { persist: false },
        );
    }

    try {
      const updatedDraft = this.draftRepository.update(
        currentDraft.trackingId,
        {
          ...cloneValue(patch),
          saveMode,
          ...(validationResult === undefined
            ? {}
            : { lastValidationResult: validationResult }),
        },
        {
          expectedVersion: normalizedOptions.expectedVersion,
          saveMode,
        },
      );

      this.appendAuditEvent(
        MATERIAL_ACTIONS.DRAFT_SAVED,
        updatedDraft,
        normalizedOptions.actor,
        {
          saveMode,
          version: updatedDraft.version,
          currentStepId: updatedDraft.currentStepId,
        },
      );

      return this.buildJourneyView(updatedDraft);
    } catch (error) {
      if (
        error?.name === 'JourneyDraftRepositoryError' ||
        error?.name === 'JourneyServiceError'
      ) {
        throw error;
      }

      throw createJourneyServiceError(
        JOURNEY_SERVICE_ERROR_CODES.PERSISTENCE_FAILED,
        'Unable to save the journey draft.',
        { trackingId: currentDraft.trackingId },
        error,
      );
    }
  }

  /**
   * Saves a form section and runs sectional validation.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @param {string} section Section identifier or dotted form path.
   * @param {unknown} data Section data.
   * @param {{
   *   expectedVersion?: number,
   *   saveMode?: string,
   *   actor?: object,
   *   validate?: boolean
   * }} [options] Section save options.
   * @returns {object} Updated journey view.
   */
  saveSection(trackingId, section, data, options = {}) {
    const normalizedSection = normalizeIdentifier(
      section,
      'Journey section',
    );
    const normalizedOptions = assertOptions(
      options,
      'Journey section save options',
    );
    const draft = this.getDraftRecord(trackingId);
    const nextFormState = cloneValue(draft.formState);

    setValueAtPath(nextFormState, normalizedSection, data);

    const dirtySections = normalizeStringArray(
      [...draft.dirtySections, normalizedSection],
      'Dirty journey sections',
    );
    const application = createApplicationView({
      ...draft,
      formState: nextFormState,
    });
    const validationResult =
      normalizedOptions.validate === false
        ? draft.lastValidationResult
        : this.validationService.validateSections(
            application,
            [normalizedSection],
            { persist: false },
          );
    const skippedSteps = computeSkippedSteps(application, {
      journeyType: draft.journeyType,
      skipPrefilled: true,
      completedSteps: draft.completedSteps,
      forceIncludedSteps: [draft.currentStepId],
    });
    const updatedView = this.saveDraft(
      trackingId,
      {
        formState: nextFormState,
        dirtySections,
        skippedSteps,
        completionState: {
          ...draft.completionState,
          skippedSteps,
        },
        lastValidationResult: validationResult,
      },
      {
        expectedVersion: normalizedOptions.expectedVersion,
        saveMode:
          normalizedOptions.saveMode ??
          JOURNEY_SAVE_MODES.MANUAL,
        actor: normalizedOptions.actor,
      },
    );

    this.appendAuditEvent(
      MATERIAL_ACTIONS.SECTION_SAVED,
      updatedView.draft,
      normalizedOptions.actor,
      {
        section: normalizedSection,
        valid: validationResult?.valid ?? null,
      },
    );

    return updatedView;
  }

  /**
   * Marks the current or supplied step complete and advances navigation.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @param {string} stepId Step identifier.
   * @param {{
   *   expectedVersion?: number,
   *   actor?: object,
   *   validate?: boolean,
   *   allowInvalid?: boolean
   * }} [options] Completion options.
   * @returns {object} Updated journey view.
   */
  completeStep(trackingId, stepId, options = {}) {
    const normalizedOptions = assertOptions(
      options,
      'Journey step completion options',
    );
    const draft = this.getDraftRecord(trackingId);
    const step = getJourneyStep(draft.journeyType, stepId);
    const application = createApplicationView(draft);
    const activeSteps = getPresentableSteps(
      application,
      draft.journeyType,
      {
        completedSteps: [],
        forceIncludedSteps: [step.id],
      },
    );

    if (!activeSteps.some((candidate) => candidate.id === step.id)) {
      throw createJourneyServiceError(
        JOURNEY_SERVICE_ERROR_CODES.STEP_NOT_AVAILABLE,
        `Journey step is not available: ${step.id}`,
        {
          trackingId: draft.trackingId,
          stepId: step.id,
        },
      );
    }

    const validationResult =
      normalizedOptions.validate === false ||
      step.navigationOnly
        ? draft.lastValidationResult
        : this.validationService.validateSections(
            application,
            [step.section],
            { persist: false },
          );

    if (
      validationResult?.valid === false &&
      normalizedOptions.allowInvalid !== true
    ) {
      throw createJourneyServiceError(
        JOURNEY_SERVICE_ERROR_CODES.STEP_VALIDATION_FAILED,
        `Journey step validation failed: ${step.id}`,
        {
          trackingId: draft.trackingId,
          stepId: step.id,
          validation: cloneValue(validationResult),
        },
      );
    }

    const completedSteps = normalizeStringArray(
      [...draft.completedSteps, step.id],
      'Completed journey steps',
    );
    const navigableSteps = getPresentableSteps(
      {
        ...application,
        completedSteps,
      },
      draft.journeyType,
      {
        completedSteps: [],
        forceIncludedSteps: [step.id],
      },
    );
    const currentIndex = navigableSteps.findIndex(
      (candidate) => candidate.id === step.id,
    );
    const nextStep =
      navigableSteps[currentIndex + 1] ??
      getJourneyStep(draft.journeyType, JOURNEY_STEP_IDS.COMPLETE);
    const progressDraft = {
      ...draft,
      completedSteps,
      lastValidationResult: validationResult,
    };
    const progress = calculateProgress(
      progressDraft,
      getJourneyDefinition(draft.journeyType),
    );
    const updatedView = this.saveDraft(
      trackingId,
      {
        completedSteps,
        currentStepId: nextStep.id,
        resumeUrl: buildJourneyRoute(
          draft.journeyType,
          draft.trackingId,
          nextStep.id,
        ),
        lastValidationResult: validationResult,
        completionState: {
          ...draft.completionState,
          completedSteps,
          percentComplete: progress.percentComplete,
        },
      },
      {
        expectedVersion: normalizedOptions.expectedVersion,
        saveMode: JOURNEY_SAVE_MODES.MANUAL,
        actor: normalizedOptions.actor,
      },
    );

    this.appendAuditEvent(
      MATERIAL_ACTIONS.STEP_COMPLETED,
      updatedView.draft,
      normalizedOptions.actor,
      {
        stepId: step.id,
        nextStepId: nextStep.id,
        percentComplete: updatedView.progress.percentComplete,
      },
    );

    return updatedView;
  }

  /**
   * Navigates to an active journey step without completing the current step.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @param {string} stepId Target step identifier.
   * @param {{expectedVersion?: number, actor?: object}} [options]
   * Navigation options.
   * @returns {object} Updated journey view.
   */
  goToStep(trackingId, stepId, options = {}) {
    const normalizedOptions = assertOptions(
      options,
      'Journey navigation options',
    );
    const draft = this.getDraftRecord(trackingId);
    const step = getJourneyStep(draft.journeyType, stepId);
    const application = createApplicationView(draft);
    const activeSteps = getPresentableSteps(
      application,
      draft.journeyType,
      {
        forceIncludedSteps: [step.id],
      },
    );

    if (!activeSteps.some((candidate) => candidate.id === step.id)) {
      throw createJourneyServiceError(
        JOURNEY_SERVICE_ERROR_CODES.STEP_NOT_AVAILABLE,
        `Journey step is not available: ${step.id}`,
        {
          trackingId: draft.trackingId,
          stepId: step.id,
        },
      );
    }

    return this.saveDraft(
      trackingId,
      {
        currentStepId: step.id,
        resumeUrl: buildJourneyRoute(
          draft.journeyType,
          draft.trackingId,
          step.id,
        ),
      },
      {
        expectedVersion: normalizedOptions.expectedVersion,
        saveMode: JOURNEY_SAVE_MODES.AUTO,
        actor: normalizedOptions.actor,
      },
    );
  }

  /**
   * Stores electronic-signature consent or final signature state.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @param {string} signatureType Signature type.
   * @param {{
   *   status?: string,
   *   consented?: boolean,
   *   signedBy?: string | null,
   *   consentedAt?: string | null,
   *   signedAt?: string | null,
   *   envelopeId?: string | null,
   *   metadata?: object
   * }} signature Signature details.
   * @param {{expectedVersion?: number, actor?: object}} [options]
   * Sign-off options.
   * @returns {object} Updated journey view.
   */
  setSignOff(
    trackingId,
    signatureType,
    signature,
    options = {},
  ) {
    const normalizedSignatureType = normalizeIdentifier(
      signatureType,
      'Journey signature type',
    );
    const normalizedSignature = assertOptions(
      signature,
      'Journey signature',
    );
    const normalizedOptions = assertOptions(
      options,
      'Journey sign-off options',
    );
    const draft = this.getDraftRecord(trackingId);
    const status =
      normalizedSignature.status ??
      (normalizedSignature.signedAt
        ? JOURNEY_SIGN_OFF_STATES.SIGNED
        : normalizedSignature.consented
          ? JOURNEY_SIGN_OFF_STATES.CONSENTED
          : JOURNEY_SIGN_OFF_STATES.NOT_STARTED);

    if (!Object.values(JOURNEY_SIGN_OFF_STATES).includes(status)) {
      throw new TypeError(
        `Unsupported journey signature status: ${status}.`,
      );
    }

    const timestamp = toIsoTimestamp(this.clock());
    const signatureState = {
      ...cloneValue(
        draft.signatures[normalizedSignatureType] ?? {},
      ),
      ...cloneValue(normalizedSignature),
      status,
      consented:
        normalizedSignature.consented ??
        [
          JOURNEY_SIGN_OFF_STATES.CONSENTED,
          JOURNEY_SIGN_OFF_STATES.SIGNED,
        ].includes(status),
      ...(status === JOURNEY_SIGN_OFF_STATES.CONSENTED &&
      normalizedSignature.consentedAt === undefined
        ? { consentedAt: timestamp }
        : {}),
      ...(status === JOURNEY_SIGN_OFF_STATES.SIGNED &&
      normalizedSignature.signedAt === undefined
        ? {
            consentedAt:
              normalizedSignature.consentedAt ?? timestamp,
            signedAt: timestamp,
          }
        : {}),
    };
    const updatedView = this.saveDraft(
      trackingId,
      {
        signatures: {
          ...draft.signatures,
          [normalizedSignatureType]: signatureState,
        },
      },
      {
        expectedVersion: normalizedOptions.expectedVersion,
        saveMode: JOURNEY_SAVE_MODES.MANUAL,
        actor: normalizedOptions.actor,
      },
    );

    this.appendAuditEvent(
      MATERIAL_ACTIONS.SIGN_OFF_UPDATED,
      updatedView.draft,
      normalizedOptions.actor,
      {
        signatureType: normalizedSignatureType,
        status,
      },
    );

    return updatedView;
  }

  /**
   * Records electronic-signature consent.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @param {string} signatureType Signature type.
   * @param {object} [consent] Consent details.
   * @param {object} [options] Sign-off options.
   * @returns {object} Updated journey view.
   */
  markESignConsent(
    trackingId,
    signatureType,
    consent = {},
    options = {},
  ) {
    return this.setSignOff(
      trackingId,
      signatureType,
      {
        ...assertOptions(consent, 'Electronic-signature consent'),
        status: JOURNEY_SIGN_OFF_STATES.CONSENTED,
        consented: true,
      },
      options,
    );
  }

  /**
   * Records a completed journey signature.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @param {string} signatureType Signature type.
   * @param {{signedBy: string, signedAt?: string, metadata?: object}}
   * signature Signature details.
   * @param {object} [options] Sign-off options.
   * @returns {object} Updated journey view.
   */
  markSigned(
    trackingId,
    signatureType,
    signature,
    options = {},
  ) {
    const normalizedSignature = assertOptions(
      signature,
      'Journey signature',
    );

    return this.setSignOff(
      trackingId,
      signatureType,
      {
        ...cloneValue(normalizedSignature),
        signedBy: normalizeIdentifier(
          normalizedSignature.signedBy,
          'Journey signer',
        ),
        status: JOURNEY_SIGN_OFF_STATES.SIGNED,
        consented: true,
      },
      options,
    );
  }

  /**
   * Runs final submission validation and returns a review model.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @param {{
   *   expectedVersion?: number,
   *   actor?: object,
   *   requiredForms?: unknown[],
   *   completedForms?: unknown[],
   *   documentPackageSummary?: object,
   *   requireSignature?: boolean,
   *   persist?: boolean
   * }} [options] Review options.
   * @returns {object} Final review result.
   */
  reviewJourney(trackingId, options = {}) {
    const normalizedOptions = assertOptions(
      options,
      'Journey review options',
    );
    const draft = this.getDraftRecord(trackingId);
    const application = createApplicationView(draft);
    const validation = this.validationService.validateApplication(
      application,
      {
        scope: VALIDATION_SCOPES.SUBMISSION,
        requiredForms: normalizedOptions.requiredForms,
        completedForms: normalizedOptions.completedForms,
        persist: false,
      },
    );
    const signatureRequired =
      normalizedOptions.requireSignature !== false;
    const signed = hasSignedSignature(draft.signatures);
    const packageComplete =
      normalizedOptions.documentPackageSummary?.packageComplete ??
      draft.completionState.packageComplete;
    const submissionReady =
      validation.valid &&
      !validation.manualReviewRequired &&
      (!signatureRequired || signed);
    const review = Object.freeze({
      trackingId: draft.trackingId,
      applicationId: draft.applicationId ?? null,
      valid: validation.valid,
      manualReviewRequired: validation.manualReviewRequired,
      signatureRequired,
      signed,
      packageComplete,
      submissionReady,
      validation: cloneValue(validation),
      documentPackageSummary: cloneValue(
        normalizedOptions.documentPackageSummary ?? null,
      ),
      reviewedAt: toIsoTimestamp(this.clock()),
    });

    if (normalizedOptions.persist !== false) {
      const updatedDraft = this.draftRepository.update(
        draft.trackingId,
        {
          lastValidationResult: validation,
          completionState: {
            ...draft.completionState,
            packageComplete,
            submissionReady,
          },
        },
        {
          expectedVersion: normalizedOptions.expectedVersion,
          saveMode: JOURNEY_SAVE_MODES.MANUAL,
        },
      );

      this.appendAuditEvent(
        MATERIAL_ACTIONS.REVIEW_COMPLETED,
        updatedDraft,
        normalizedOptions.actor,
        {
          valid: validation.valid,
          manualReviewRequired:
            validation.manualReviewRequired,
          submissionReady,
        },
      );

      return Object.freeze({
        ...review,
        draft: cloneValue(updatedDraft),
        progress: calculateProgress(
          updatedDraft,
          getJourneyDefinition(updatedDraft.journeyType),
        ),
      });
    }

    return review;
  }

  /**
   * Marks a reviewed journey complete.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @param {{
   *   expectedVersion?: number,
   *   actor?: object,
   *   allowManualReview?: boolean,
   *   requireSignature?: boolean,
   *   documentPackageSummary?: object,
   *   submittedAt?: string
   * }} [options] Completion options.
   * @returns {object} Completed journey view.
   */
  completeJourney(trackingId, options = {}) {
    const normalizedOptions = assertOptions(
      options,
      'Journey completion options',
    );
    const review = this.reviewJourney(trackingId, {
      ...normalizedOptions,
      persist: false,
    });

    if (!review.valid) {
      throw createJourneyServiceError(
        JOURNEY_SERVICE_ERROR_CODES.REVIEW_FAILED,
        'The journey cannot be completed while validation errors remain.',
        {
          trackingId: review.trackingId,
          validation: review.validation,
        },
      );
    }

    if (
      review.manualReviewRequired &&
      normalizedOptions.allowManualReview !== true
    ) {
      throw createJourneyServiceError(
        JOURNEY_SERVICE_ERROR_CODES.REVIEW_FAILED,
        'The journey requires manual review before completion.',
        {
          trackingId: review.trackingId,
          validation: review.validation,
        },
      );
    }

    if (
      review.signatureRequired &&
      !review.signed
    ) {
      throw createJourneyServiceError(
        JOURNEY_SERVICE_ERROR_CODES.SIGNATURE_REQUIRED,
        'A signed journey package is required before completion.',
        { trackingId: review.trackingId },
      );
    }

    const draft = this.getDraftRecord(trackingId);
    const submittedAt = toIsoTimestamp(
      normalizedOptions.submittedAt ?? this.clock(),
    );
    const completedSteps = normalizeStringArray(
      [
        ...draft.completedSteps,
        JOURNEY_STEP_IDS.REVIEW,
        JOURNEY_STEP_IDS.SIGNATURE,
        JOURNEY_STEP_IDS.COMPLETE,
      ],
      'Completed journey steps',
    );
    const completedDraft = this.draftRepository.update(
      draft.trackingId,
      {
        status: WORKFLOW_STAGES.APPLICATION_SUBMITTED,
        currentStepId: JOURNEY_STEP_IDS.COMPLETE,
        resumeUrl: buildJourneyRoute(
          draft.journeyType,
          draft.trackingId,
          JOURNEY_STEP_IDS.COMPLETE,
        ),
        completedSteps,
        lastValidationResult: review.validation,
        submittedAt,
        completionState: {
          ...draft.completionState,
          completed: true,
          percentComplete: 100,
          completedSteps,
          packageComplete: review.packageComplete,
          submissionReady: true,
        },
      },
      {
        expectedVersion: normalizedOptions.expectedVersion,
        saveMode: JOURNEY_SAVE_MODES.MANUAL,
      },
    );

    this.appendAuditEvent(
      MATERIAL_ACTIONS.COMPLETED,
      completedDraft,
      normalizedOptions.actor,
      {
        submittedAt,
        manualReviewRequired: review.manualReviewRequired,
      },
    );

    return this.buildJourneyView(completedDraft);
  }

  /**
   * Returns declarative step and navigation details.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @param {string} [stepId] Step identifier.
   * @returns {object} Step resolution result.
   */
  resolveStep(trackingId, stepId) {
    const draft = this.getDraftRecord(trackingId);
    const application = createApplicationView(draft);
    const targetStepId = stepId ?? draft.currentStepId;
    const step = getJourneyStep(draft.journeyType, targetStepId);
    const skipped = draft.skippedSteps.includes(step.id);

    if (skipped) {
      throw createJourneyServiceError(
        JOURNEY_SERVICE_ERROR_CODES.STEP_NOT_AVAILABLE,
        `Journey step is skipped: ${step.id}`,
        {
          trackingId: draft.trackingId,
          stepId: step.id,
        },
      );
    }

    const navigation = getJourneyNavigation(
      application,
      step.id,
      {
        journeyType: draft.journeyType,
        skipPrefilled: false,
        completedSteps: [],
        forceIncludedSteps: [step.id],
      },
    );

    return Object.freeze({
      step,
      prefill: cloneValue(step.prefill(application, {})),
      route: buildJourneyRoute(
        draft.journeyType,
        draft.trackingId,
        step.id,
      ),
      previousStep: navigation.previousStep,
      nextStep: navigation.nextStep,
      completed: draft.completedSteps.includes(step.id),
      skipped: false,
    });
  }

  /**
   * Computes skipped step identifiers for an application.
   *
   * @param {object} application Application or normalized payload.
   * @param {object} [options] Skip options.
   * @returns {string[]} Skipped step identifiers.
   */
  computeSkippedSteps(application, options = {}) {
    const normalizedOptions = assertOptions(
      options,
      'Journey skip options',
    );
    const journeyType =
      normalizedOptions.journeyType ??
      inferJourneyType(application);

    return computeSkippedSteps(application, {
      ...normalizedOptions,
      journeyType,
    });
  }

  /**
   * Builds per-step prefill values.
   *
   * @param {object} application Application or normalized payload.
   * @param {string} [journeyType] Journey type.
   * @returns {Record<string, object>} Prefill values.
   */
  buildPrefill(application, journeyType) {
    return buildJourneyPrefill(application, {
      journeyType:
        journeyType ??
        getJourneyDefinitionForApplication(application).type,
    });
  }

  /**
   * Returns progress for a draft.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @returns {object} Journey progress.
   */
  getProgress(trackingId) {
    const draft = this.getDraftRecord(trackingId);

    return calculateProgress(
      draft,
      getJourneyDefinition(draft.journeyType),
    );
  }

  /**
   * Returns resume-safe metadata for a tracking identifier.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @returns {object} Resume context.
   */
  getResumeContextByTrackingId(trackingId) {
    const view = this.loadDraft(trackingId);

    return cloneValue(view.resumeContext);
  }

  /**
   * Alias for getResumeContextByTrackingId.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @returns {object} Resume context.
   */
  getResumeContext(trackingId) {
    return this.getResumeContextByTrackingId(trackingId);
  }

  /**
   * Lists resumable drafts in this service's partner scope.
   *
   * @param {string | number | object} [partnerCodeOrQuery] Partner code or
   * draft query.
   * @param {object} [query] Draft query.
   * @returns {object[]} Resume contexts.
   */
  listDraftsByPartnerCode(
    partnerCodeOrQuery = this.partnerCode,
    query = {},
  ) {
    const partnerCode = isObject(partnerCodeOrQuery)
      ? this.partnerCode
      : partnerCodeOrQuery;
    const normalizedQuery = isObject(partnerCodeOrQuery)
      ? partnerCodeOrQuery
      : assertOptions(query, 'Journey resume query');

    this.assertPartnerScope(partnerCode);

    const drafts = this.draftRepository.list({
      ...normalizedQuery,
      resumable: normalizedQuery.resumable ?? true,
    });

    if (!Array.isArray(drafts)) {
      throw createJourneyServiceError(
        JOURNEY_SERVICE_ERROR_CODES.INVALID_REPOSITORY,
        'The journey draft repository returned an invalid collection.',
        null,
      );
    }

    return drafts.map((draft) =>
      this.buildResumeContext(draft),
    );
  }

  /**
   * Alias for listDraftsByPartnerCode.
   *
   * @param {object} [query] Draft query.
   * @returns {object[]} Resume contexts.
   */
  listResumeContexts(query = {}) {
    return this.listDraftsByPartnerCode(this.partnerCode, query);
  }

  /**
   * Resolves a draft record, optionally falling back to an application.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @returns {object} Draft record.
   */
  getDraftRecord(trackingId) {
    let draft = this.draftRepository.find(trackingId);

    if (
      !draft &&
      this.applicationRepository &&
      typeof this.applicationRepository.find === 'function'
    ) {
      const application =
        this.applicationRepository.find(trackingId);

      if (application) {
        const initiated = this.initiateJourney({
          trackingId: application.trackingId,
          applicationId: application.applicationId,
          partnerCode: application.partnerCode,
          journeyType: application.journeyType,
          application,
        });

        draft = initiated.draft;
      }
    }

    if (!draft) {
      throw createJourneyServiceError(
        JOURNEY_SERVICE_ERROR_CODES.NOT_FOUND,
        `Journey draft not found: ${trackingId}`,
        { trackingId: String(trackingId) },
      );
    }

    this.assertPartnerScope(draft.partnerCode);
    return cloneValue(draft);
  }

  buildJourneyView(draft) {
    const definition = getJourneyDefinition(draft.journeyType);
    const application = createApplicationView(draft);
    const activeSteps = getPresentableSteps(
      application,
      draft.journeyType,
      {
        skipPrefilled: false,
      },
    ).filter((step) => !draft.skippedSteps.includes(step.id));
    const progress = calculateProgress(draft, definition);
    const currentStep =
      definition.steps.find(
        (step) => step.id === draft.currentStepId,
      ) ?? definition.steps[0];

    return Object.freeze({
      trackingId: draft.trackingId,
      applicationId: draft.applicationId ?? null,
      journeyType: draft.journeyType,
      journeyUrl: draft.resumeUrl,
      resumeUrl: draft.resumeUrl,
      status: draft.status,
      version: draft.version,
      currentStep: cloneValue(currentStep),
      currentStepId: currentStep.id,
      definition,
      steps: Object.freeze([...activeSteps]),
      skippedSteps: Object.freeze([...draft.skippedSteps]),
      completedSteps: Object.freeze([...draft.completedSteps]),
      prefill: buildJourneyPrefill(application, {
        journeyType: draft.journeyType,
      }),
      progress,
      draft: cloneValue(draft),
      resumeContext: this.buildResumeContext(draft),
    });
  }

  buildResumeContext(draft) {
    return Object.freeze({
      trackingId: draft.trackingId,
      applicationId: draft.applicationId ?? null,
      partnerCode: draft.partnerCode,
      journeyType: draft.journeyType,
      status: draft.status,
      currentStepId: draft.currentStepId,
      resumeUrl: draft.resumeUrl,
      completedSteps: cloneValue(draft.completedSteps),
      skippedSteps: cloneValue(draft.skippedSteps),
      completionState: cloneValue(draft.completionState),
      version: draft.version,
      lastSavedAt: draft.lastSavedAt,
      expiresAt: draft.expiresAt ?? null,
    });
  }

  assertPartnerScope(partnerCode) {
    if (
      normalizeIdentifierForLookup(
        partnerCode,
        'Journey partner code',
      ) !==
      normalizeIdentifierForLookup(
        this.partnerCode,
        'Repository partner code',
      )
    ) {
      throw createJourneyServiceError(
        JOURNEY_SERVICE_ERROR_CODES.PARTNER_SCOPE_MISMATCH,
        'The journey does not belong to the current partner scope.',
        {
          servicePartnerCode: this.partnerCode,
          requestedPartnerCode: String(partnerCode),
        },
      );
    }
  }

  appendAuditEvent(action, draft, actor, metadata = {}) {
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
          trackingId: draft.trackingId,
          applicationId: draft.applicationId ?? undefined,
          sourceRecordId:
            draft.applicationId ?? draft.trackingId,
          action,
          actorId: resolveActorId(actor),
          actorType: resolveActorType(actor),
          source: AUDIT_SOURCES.GUIDED_JOURNEY,
          summary: action
            .toLowerCase()
            .replace(/_/g, ' '),
          metadata: {
            journeyType: draft.journeyType,
            partnerCode: draft.partnerCode,
            version: draft.version,
            ...cloneValue(metadata),
          },
          timestamp: toIsoTimestamp(this.clock()),
        },
        {
          actor,
          source: AUDIT_SOURCES.GUIDED_JOURNEY,
        },
      );
    } catch (error) {
      throw createJourneyServiceError(
        JOURNEY_SERVICE_ERROR_CODES.AUDIT_FAILED,
        'Unable to persist the journey audit event.',
        {
          action,
          trackingId: draft.trackingId,
        },
        error,
      );
    }
  }
}

/**
 * Creates a journey orchestration service.
 *
 * @param {ConstructorParameters<typeof JourneyService>[0]} [options]
 * Journey service options.
 * @returns {JourneyService} Journey service.
 */
export function createJourneyService(options = {}) {
  return new JourneyService(options);
}

/**
 * Initiates a journey using a newly created service.
 *
 * @param {object} request Journey initiation request.
 * @param {ConstructorParameters<typeof JourneyService>[0]} [options]
 * Journey service options.
 * @returns {object} Journey initiation result.
 */
export function initiateJourney(request, options = {}) {
  return createJourneyService(options).initiateJourney(request);
}

export const JourneyOrchestrator = JourneyService;
export const JourneyResumeBridge = JourneyService;
export const createJourneyOrchestrator = createJourneyService;
export const createJourneyResumeBridge = createJourneyService;
export { buildJourneyRoute };

export default JourneyService;