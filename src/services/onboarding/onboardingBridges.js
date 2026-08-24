import { PartnerScopeGuard } from '../../auth/partnerScopeGuard.js';
import { OnboardingRecordRepository } from '../../repositories/onboardingRecordRepository.js';
import { ProviderCheckRepository } from '../../repositories/providerCheckRepository.js';
import { ValidationRepository } from '../../repositories/validationRepository.js';
import { searchRecords } from '../../utils/search.js';
import { EligibilityService } from './eligibilityService.js';
import { JourneyService } from './journeyService.js';
import { ValidationService } from './validationService.js';

export const ONBOARDING_BRIDGE_ERROR_CODES = Object.freeze({
  INVALID_OPTIONS: 'ONBOARDING_BRIDGE_INVALID_OPTIONS',
  INVALID_DEPENDENCY: 'ONBOARDING_BRIDGE_INVALID_DEPENDENCY',
  INVALID_QUERY: 'ONBOARDING_BRIDGE_INVALID_QUERY',
  APPLICATION_NOT_FOUND: 'ONBOARDING_BRIDGE_APPLICATION_NOT_FOUND',
  JOURNEY_NOT_FOUND: 'ONBOARDING_BRIDGE_JOURNEY_NOT_FOUND',
  RULE_OUTCOME_NOT_FOUND: 'ONBOARDING_BRIDGE_RULE_OUTCOME_NOT_FOUND',
  PARTNER_SCOPE_VIOLATION: 'ONBOARDING_BRIDGE_PARTNER_SCOPE_VIOLATION',
  OPERATION_FAILED: 'ONBOARDING_BRIDGE_OPERATION_FAILED',
});

const APPLICATION_SEARCH_FIELDS = Object.freeze([
  'id',
  'applicationId',
  'trackingId',
  'partnerCode',
  'company',
  'carrierCode',
  'gaCode',
  'agency.name',
  'applicant.firstName',
  'applicant.lastName',
  'applicant.legalName',
  'status',
  'workflowStage',
]);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertOptions(options, description = 'Onboarding bridge options') {
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

function createBridgeError(code, message, details, cause) {
  const error = new Error(message, {
    ...(cause === undefined ? {} : { cause }),
  });

  error.name = 'OnboardingBridgeError';
  error.code = code;
  error.details = details ?? null;
  error.recoverable = true;

  return error;
}

function assertDependency(dependency, methods, description) {
  if (
    !isObject(dependency) ||
    methods.some((method) => typeof dependency[method] !== 'function')
  ) {
    throw createBridgeError(
      ONBOARDING_BRIDGE_ERROR_CODES.INVALID_DEPENDENCY,
      `${description} must provide ${methods.join(', ')}.`,
      { requiredMethods: methods },
    );
  }

  return dependency;
}

function assertOptionalDependency(dependency, methods, description) {
  if (dependency === undefined || dependency === null) {
    return null;
  }

  return assertDependency(dependency, methods, description);
}

function normalizePagination(query) {
  const limit = query.limit;
  const offset = query.offset ?? 0;

  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
    throw new RangeError('Query limit must be a positive integer.');
  }

  if (!Number.isInteger(offset) || offset < 0) {
    throw new RangeError('Query offset must be a nonnegative integer.');
  }

  return {
    limit: limit ?? Number.POSITIVE_INFINITY,
    offset,
  };
}

function removeBridgeQueryFields(query) {
  const repositoryQuery = { ...query };

  [
    'limit',
    'offset',
    'principal',
    'search',
    'searchFields',
  ].forEach((field) => {
    delete repositoryQuery[field];
  });

  return repositoryQuery;
}

function resolvePrincipal(query, options, defaultPrincipal) {
  return query.principal ?? options.principal ?? defaultPrincipal;
}

function resolvePartnerContext(options, defaultPartnerContext) {
  return options.partnerContext ?? defaultPartnerContext;
}

function findWithRepository(repository, identifier) {
  if (typeof repository.find === 'function') {
    return repository.find(identifier);
  }

  if (typeof repository.findById === 'function') {
    return repository.findById(identifier);
  }

  return undefined;
}

function listRelated(repository, method, identifier, query = {}) {
  if (!repository) {
    return [];
  }

  if (typeof repository[method] === 'function') {
    const result = repository[method](identifier, query);

    return Array.isArray(result) ? result : [];
  }

  if (typeof repository.list === 'function') {
    const result = repository.list({
      ...query,
      [method === 'findByApplicationId'
        ? 'applicationId'
        : 'trackingId']: identifier,
    });

    return Array.isArray(result) ? result : [];
  }

  return [];
}

function createRepositoryOptions(options) {
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
    ...(options.clock === undefined ? {} : { clock: options.clock }),
    ...(options.onStorageError === undefined
      ? {}
      : { onStorageError: options.onStorageError }),
  };
}

/**
 * Aligns onboarding application repositories with list, detail, and
 * operations-context query contracts.
 */
export class OnboardingApplicationQueryBridge {
  /**
   * @param {{
   *   repository?: object,
   *   applicationRepository?: object,
   *   workItemRepository?: object,
   *   auditRepository?: object,
   *   syncAttemptRepository?: object,
   *   partnerScopeGuard?: object,
   *   principal?: string | object,
   *   partnerContext?: object,
   *   storage?: Storage,
   *   namespace?: string,
   *   schemaVersion?: number,
   *   clock?: () => Date | string | number,
   *   onStorageError?: (error: object) => void
   * }} [options] Bridge options.
   */
  constructor(options = {}) {
    const normalizedOptions = assertOptions(options);

    this.repository = assertDependency(
      normalizedOptions.repository ??
        normalizedOptions.applicationRepository ??
        new OnboardingRecordRepository(
          createRepositoryOptions(normalizedOptions),
        ),
      ['list'],
      'The onboarding application repository',
    );
    this.workItemRepository = assertOptionalDependency(
      normalizedOptions.workItemRepository,
      [],
      'The work item repository',
    );
    this.auditRepository = assertOptionalDependency(
      normalizedOptions.auditRepository,
      [],
      'The audit repository',
    );
    this.syncAttemptRepository = assertOptionalDependency(
      normalizedOptions.syncAttemptRepository,
      [],
      'The synchronization attempt repository',
    );
    this.scopeGuard = assertDependency(
      normalizedOptions.partnerScopeGuard ??
        new PartnerScopeGuard({
          principal: normalizedOptions.principal,
          partnerContext: normalizedOptions.partnerContext,
        }),
      ['canAccessRecord', 'filterRecords'],
      'The partner scope guard',
    );
    this.principal = normalizedOptions.principal ?? null;
    this.partnerContext = normalizedOptions.partnerContext ?? null;
  }

  /**
   * Lists applications with search, scope, and pagination applied in a safe
   * order.
   *
   * @param {object} [query] Application query.
   * @param {object} [options] Query options.
   * @returns {object[]} Matching applications.
   */
  listApplications(query = {}, options = {}) {
    const normalizedQuery = assertOptions(
      query,
      'Application query',
    );
    const normalizedOptions = assertOptions(
      options,
      'Application query options',
    );
    const pagination = normalizePagination(normalizedQuery);
    const repositoryQuery = removeBridgeQueryFields(normalizedQuery);
    const records = this.repository.list(repositoryQuery);

    if (!Array.isArray(records)) {
      throw createBridgeError(
        ONBOARDING_BRIDGE_ERROR_CODES.INVALID_DEPENDENCY,
        'The onboarding repository returned an invalid collection.',
        null,
      );
    }

    const principal = resolvePrincipal(
      normalizedQuery,
      normalizedOptions,
      this.principal,
    );
    const partnerContext = resolvePartnerContext(
      normalizedOptions,
      this.partnerContext,
    );
    let filteredRecords =
      principal === null || principal === undefined
        ? records.map((record) => cloneValue(record))
        : this.scopeGuard.filterRecords(
            records,
            principal,
            partnerContext,
          );

    if (
      normalizedQuery.search !== undefined &&
      String(normalizedQuery.search).trim() !== ''
    ) {
      filteredRecords = searchRecords(
        filteredRecords,
        normalizedQuery.search,
        {
          fields:
            normalizedQuery.searchFields ??
            APPLICATION_SEARCH_FIELDS,
        },
      );
    }

    return filteredRecords
      .slice(
        pagination.offset,
        pagination.offset + pagination.limit,
      )
      .map((record) => cloneValue(record));
  }

  /**
   * Alias for listApplications.
   *
   * @param {object} [query] Application query.
   * @param {object} [options] Query options.
   * @returns {object[]} Matching applications.
   */
  list(query = {}, options = {}) {
    return this.listApplications(query, options);
  }

  /**
   * Alias for listApplications.
   *
   * @param {object} [query] Application query.
   * @param {object} [options] Query options.
   * @returns {object[]} Matching applications.
   */
  query(query = {}, options = {}) {
    return this.listApplications(query, options);
  }

  /**
   * Finds an application by any canonical repository identifier.
   *
   * @param {string | number} identifier Application identifier.
   * @param {object} [options] Access options.
   * @returns {object | undefined} Matching application.
   */
  findApplication(identifier, options = {}) {
    const normalizedIdentifier = normalizeIdentifier(
      identifier,
      'Application identifier',
    );
    const normalizedOptions = assertOptions(
      options,
      'Application access options',
    );
    const application = findWithRepository(
      this.repository,
      normalizedIdentifier,
    );

    if (!application) {
      return undefined;
    }

    const principal =
      normalizedOptions.principal ?? this.principal;

    if (
      principal !== null &&
      principal !== undefined &&
      !this.scopeGuard.canAccessRecord(
        application,
        principal,
        resolvePartnerContext(
          normalizedOptions,
          this.partnerContext,
        ),
      )
    ) {
      return undefined;
    }

    return cloneValue(application);
  }

  /**
   * Alias for findApplication.
   *
   * @param {string | number} identifier Application identifier.
   * @param {object} [options] Access options.
   * @returns {object | undefined} Matching application.
   */
  find(identifier, options = {}) {
    return this.findApplication(identifier, options);
  }

  /**
   * Returns an application or throws when it is unavailable or out of scope.
   *
   * @param {string | number} identifier Application identifier.
   * @param {object} [options] Access options.
   * @returns {object} Matching application.
   */
  getApplication(identifier, options = {}) {
    const application = this.findApplication(identifier, options);

    if (!application) {
      throw createBridgeError(
        ONBOARDING_BRIDGE_ERROR_CODES.APPLICATION_NOT_FOUND,
        `Onboarding application not found: ${identifier}`,
        { identifier: String(identifier) },
      );
    }

    return application;
  }

  /**
   * Alias for getApplication.
   *
   * @param {string | number} identifier Application identifier.
   * @param {object} [options] Access options.
   * @returns {object} Matching application.
   */
  get(identifier, options = {}) {
    return this.getApplication(identifier, options);
  }

  /**
   * Returns an operations-ready application context.
   *
   * @param {string | number} identifier Application identifier.
   * @param {object} [options] Context options.
   * @returns {object} Application and correlated operational records.
   */
  getApplicationContext(identifier, options = {}) {
    const normalizedOptions = assertOptions(
      options,
      'Application context options',
    );
    const application = this.getApplication(
      identifier,
      normalizedOptions,
    );
    const trackingId = application.trackingId;
    const applicationId = application.applicationId;
    const workItems = trackingId
      ? listRelated(
          this.workItemRepository,
          'findByTrackingId',
          trackingId,
        )
      : [];
    const lifecycleEvents = applicationId
      ? listRelated(
          this.auditRepository,
          'findByApplicationId',
          applicationId,
          { sortOrder: 'asc' },
        )
      : [];
    const syncAttempts = trackingId
      ? listRelated(
          this.syncAttemptRepository,
          'findByTrackingId',
          trackingId,
        )
      : [];

    return Object.freeze({
      application: cloneValue(application),
      workItems: Object.freeze(cloneValue(workItems)),
      lifecycleEvents: Object.freeze(cloneValue(lifecycleEvents)),
      syncAttempts: Object.freeze(cloneValue(syncAttempts)),
    });
  }

  /**
   * Alias for getApplicationContext.
   *
   * @param {string | number} identifier Application identifier.
   * @param {object} [options] Context options.
   * @returns {object} Application context.
   */
  getOperationsContext(identifier, options = {}) {
    return this.getApplicationContext(identifier, options);
  }
}

/**
 * Aligns journey orchestration with tracking-based resume contracts.
 */
export class JourneyResumeBridge {
  /**
   * @param {{
   *   journeyService?: object,
   *   service?: object,
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
   * }} [options] Bridge options.
   */
  constructor(options = {}) {
    const normalizedOptions = assertOptions(options);

    this.service = assertDependency(
      normalizedOptions.journeyService ??
        normalizedOptions.service ??
        new JourneyService({
          ...createRepositoryOptions(normalizedOptions),
          ...(normalizedOptions.partnerCode === undefined
            ? {}
            : { partnerCode: normalizedOptions.partnerCode }),
          ...(normalizedOptions.draftRepository === undefined
            ? {}
            : {
                draftRepository:
                  normalizedOptions.draftRepository,
              }),
          ...(normalizedOptions.applicationRepository === undefined
            ? {}
            : {
                applicationRepository:
                  normalizedOptions.applicationRepository,
              }),
          ...(normalizedOptions.validationService === undefined
            ? {}
            : {
                validationService:
                  normalizedOptions.validationService,
              }),
          auditService:
            normalizedOptions.auditService ?? false,
        }),
      ['loadDraft'],
      'The journey service',
    );
  }

  /**
   * Loads a complete journey resume view.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @param {object} [options] Resume options.
   * @returns {object} Journey resume view.
   */
  resume(trackingId, options = {}) {
    const normalizedTrackingId = normalizeIdentifier(
      trackingId,
      'Tracking identifier',
    );

    try {
      return cloneValue(
        this.service.loadDraft(
          normalizedTrackingId,
          assertOptions(options, 'Journey resume options'),
        ),
      );
    } catch (error) {
      if (
        error?.name === 'JourneyServiceError' ||
        error?.name === 'JourneyDraftRepositoryError'
      ) {
        throw error;
      }

      throw createBridgeError(
        ONBOARDING_BRIDGE_ERROR_CODES.JOURNEY_NOT_FOUND,
        `Journey resume state not found: ${normalizedTrackingId}`,
        { trackingId: normalizedTrackingId },
        error,
      );
    }
  }

  /**
   * Alias for resume.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @param {object} [options] Resume options.
   * @returns {object} Journey resume view.
   */
  loadDraft(trackingId, options = {}) {
    return this.resume(trackingId, options);
  }

  /**
   * Alias for resume.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @param {object} [options] Resume options.
   * @returns {object} Journey resume view.
   */
  resumeJourney(trackingId, options = {}) {
    return this.resume(trackingId, options);
  }

  /**
   * Returns tracking-based resume metadata.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @returns {object} Resume context.
   */
  getResumeContext(trackingId) {
    const normalizedTrackingId = normalizeIdentifier(
      trackingId,
      'Tracking identifier',
    );

    if (
      typeof this.service.getResumeContextByTrackingId === 'function'
    ) {
      return cloneValue(
        this.service.getResumeContextByTrackingId(
          normalizedTrackingId,
        ),
      );
    }

    const view = this.resume(normalizedTrackingId);

    return cloneValue(view.resumeContext ?? view);
  }

  /**
   * Alias for getResumeContext.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @returns {object} Resume context.
   */
  getResumeContextByTrackingId(trackingId) {
    return this.getResumeContext(trackingId);
  }

  /**
   * Lists resumable journey contexts.
   *
   * @param {object} [query] Resume query.
   * @returns {object[]} Resume contexts.
   */
  listResumeContexts(query = {}) {
    const normalizedQuery = assertOptions(
      query,
      'Journey resume query',
    );

    if (typeof this.service.listResumeContexts === 'function') {
      return cloneValue(
        this.service.listResumeContexts(normalizedQuery),
      );
    }

    if (
      typeof this.service.listDraftsByPartnerCode === 'function'
    ) {
      return cloneValue(
        this.service.listDraftsByPartnerCode(normalizedQuery),
      );
    }

    throw createBridgeError(
      ONBOARDING_BRIDGE_ERROR_CODES.INVALID_DEPENDENCY,
      'The journey service cannot list resume contexts.',
      null,
    );
  }

  /**
   * Alias for listResumeContexts.
   *
   * @param {object} [query] Resume query.
   * @returns {object[]} Resume contexts.
   */
  list(query = {}) {
    return this.listResumeContexts(query);
  }
}

function buildRuleOutcome(validation, providerChecks) {
  const checks = Array.isArray(providerChecks)
    ? providerChecks
    : [];
  const validationCodes = [
    ...new Set([
      ...(validation?.validationCodes ?? []),
      ...checks.flatMap((check) => check.validationCodes ?? []),
    ]),
  ];
  const manualReviewRequired =
    validation?.manualReviewRequired === true ||
    checks.some((check) => check.manualReviewRequired === true);

  return Object.freeze({
    trackingId:
      validation?.trackingId ?? checks[0]?.trackingId ?? null,
    applicationId:
      validation?.applicationId ?? checks[0]?.applicationId ?? null,
    valid: validation?.valid ?? null,
    eligible:
      validation?.eligibility?.eligible ??
      validation?.eligibility?.valid ??
      null,
    outcome:
      validation?.eligibility?.outcome ??
      validation?.status ??
      null,
    manualReviewRequired,
    validationCodes: Object.freeze(validationCodes),
    issues: Object.freeze(cloneValue(validation?.issues ?? [])),
    derivedValues: Object.freeze(
      cloneValue(validation?.derivedValues ?? {}),
    ),
    eligibility: cloneValue(validation?.eligibility ?? null),
    providerChecks: Object.freeze(cloneValue(checks)),
    checkedAt:
      validation?.validatedAt ??
      validation?.updatedAt ??
      checks[0]?.completedAt ??
      checks[0]?.requestedAt ??
      null,
  });
}

/**
 * Aligns validation, eligibility, and provider-check persistence with a
 * unified rule-outcome contract.
 */
export class RuleOutcomeBridge {
  /**
   * @param {{
   *   validationRepository?: object,
   *   providerCheckRepository?: object,
   *   validationService?: object,
   *   eligibilityService?: object,
   *   storage?: Storage,
   *   namespace?: string,
   *   schemaVersion?: number,
   *   clock?: () => Date | string | number,
   *   onStorageError?: (error: object) => void
   * }} [options] Bridge options.
   */
  constructor(options = {}) {
    const normalizedOptions = assertOptions(options);
    const repositoryOptions = createRepositoryOptions(normalizedOptions);

    this.validationRepository = assertDependency(
      normalizedOptions.validationRepository ??
        new ValidationRepository(repositoryOptions),
      ['find', 'saveValidationResult'],
      'The validation repository',
    );
    this.providerCheckRepository = assertDependency(
      normalizedOptions.providerCheckRepository ??
        new ProviderCheckRepository(repositoryOptions),
      ['list'],
      'The provider check repository',
    );
    this.validationService = assertDependency(
      normalizedOptions.validationService ??
        new ValidationService({
          repository: this.validationRepository,
          ...(normalizedOptions.clock === undefined
            ? {}
            : { clock: normalizedOptions.clock }),
        }),
      ['validateApplication'],
      'The validation service',
    );
    this.eligibilityService = assertDependency(
      normalizedOptions.eligibilityService ??
        new EligibilityService({
          validationRepository: this.validationRepository,
          clock: normalizedOptions.clock,
          auditService: false,
        }),
      ['runEligibilityChecks'],
      'The eligibility service',
    );
  }

  /**
   * Returns a unified rule outcome by tracking identifier.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @param {{required?: boolean}} [options] Lookup options.
   * @returns {object | undefined} Unified rule outcome.
   */
  findRuleOutcome(trackingId, options = {}) {
    const normalizedTrackingId = normalizeIdentifier(
      trackingId,
      'Tracking identifier',
    );
    const normalizedOptions = assertOptions(
      options,
      'Rule outcome lookup options',
    );
    const validation = this.validationRepository.find(
      normalizedTrackingId,
    );
    const providerChecks = this.providerCheckRepository.list({
      trackingId: normalizedTrackingId,
    });

    if (!validation && providerChecks.length === 0) {
      if (normalizedOptions.required === true) {
        throw createBridgeError(
          ONBOARDING_BRIDGE_ERROR_CODES.RULE_OUTCOME_NOT_FOUND,
          `Rule outcome not found: ${normalizedTrackingId}`,
          { trackingId: normalizedTrackingId },
        );
      }

      return undefined;
    }

    return buildRuleOutcome(validation, providerChecks);
  }

  /**
   * Returns a required unified rule outcome.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @returns {object} Unified rule outcome.
   */
  getRuleOutcome(trackingId) {
    return this.findRuleOutcome(trackingId, { required: true });
  }

  /**
   * Alias for getRuleOutcome.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @returns {object} Unified rule outcome.
   */
  get(trackingId) {
    return this.getRuleOutcome(trackingId);
  }

  /**
   * Finds a rule outcome by application identifier.
   *
   * @param {string | number} applicationId Application identifier.
   * @returns {object | undefined} Unified rule outcome.
   */
  findByApplicationId(applicationId) {
    const normalizedApplicationId = normalizeIdentifier(
      applicationId,
      'Application identifier',
    );
    const validation =
      typeof this.validationRepository.findByApplicationId ===
      'function'
        ? this.validationRepository.findByApplicationId(
            normalizedApplicationId,
          )
        : undefined;
    const providerChecks = this.providerCheckRepository.list({
      applicationId: normalizedApplicationId,
    });

    if (!validation && providerChecks.length === 0) {
      return undefined;
    }

    return buildRuleOutcome(validation, providerChecks);
  }

  /**
   * Executes and optionally persists application validation.
   *
   * @param {object} application Application to validate.
   * @param {object | string | string[]} [options] Validation options.
   * @returns {object} Validation result.
   */
  validateApplication(application, options = {}) {
    if (!isObject(application)) {
      throw new TypeError(
        'An onboarding application must be an object.',
      );
    }

    return cloneValue(
      this.validationService.validateApplication(
        application,
        options,
      ),
    );
  }

  /**
   * Executes eligibility checks.
   *
   * @param {object} application Application to evaluate.
   * @param {object} [options] Eligibility options.
   * @returns {object} Eligibility result.
   */
  evaluateEligibility(application, options = {}) {
    if (!isObject(application)) {
      throw new TypeError(
        'An onboarding application must be an object.',
      );
    }

    return cloneValue(
      this.eligibilityService.runEligibilityChecks(
        application,
        assertOptions(options, 'Eligibility options'),
      ),
    );
  }

  /**
   * Persists a canonical validation result.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @param {object} validationResult Validation result.
   * @param {object} [options] Validation metadata.
   * @returns {object} Unified rule outcome.
   */
  saveValidationOutcome(
    trackingId,
    validationResult,
    options = {},
  ) {
    const normalizedTrackingId = normalizeIdentifier(
      trackingId,
      'Tracking identifier',
    );

    this.validationRepository.saveValidationResult(
      normalizedTrackingId,
      validationResult,
      assertOptions(options, 'Validation outcome options'),
    );

    return this.getRuleOutcome(normalizedTrackingId);
  }

  /**
   * Alias for saveValidationOutcome.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @param {object} validationResult Validation result.
   * @param {object} [options] Validation metadata.
   * @returns {object} Unified rule outcome.
   */
  saveRuleOutcome(trackingId, validationResult, options = {}) {
    return this.saveValidationOutcome(
      trackingId,
      validationResult,
      options,
    );
  }

  /**
   * Stores eligibility on an existing validation outcome.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @param {object} eligibility Eligibility result.
   * @param {object} [options] Persistence options.
   * @returns {object} Unified rule outcome.
   */
  setEligibilityOutcome(trackingId, eligibility, options = {}) {
    const normalizedTrackingId = normalizeIdentifier(
      trackingId,
      'Tracking identifier',
    );

    if (!isObject(eligibility)) {
      throw new TypeError('Eligibility outcome must be an object.');
    }

    if (
      typeof this.validationRepository.setEligibilityOutcome !==
      'function'
    ) {
      throw createBridgeError(
        ONBOARDING_BRIDGE_ERROR_CODES.INVALID_DEPENDENCY,
        'The validation repository cannot store eligibility outcomes.',
        null,
      );
    }

    this.validationRepository.setEligibilityOutcome(
      normalizedTrackingId,
      eligibility,
      assertOptions(options, 'Eligibility persistence options'),
    );

    return this.getRuleOutcome(normalizedTrackingId);
  }

  /**
   * Lists provider checks correlated to a tracking identifier.
   *
   * @param {string | number} trackingId Tracking identifier.
   * @param {object} [query] Provider-check filters.
   * @returns {object[]} Matching provider checks.
   */
  listProviderChecks(trackingId, query = {}) {
    return cloneValue(
      this.providerCheckRepository.list({
        ...assertOptions(query, 'Provider check query'),
        trackingId: normalizeIdentifier(
          trackingId,
          'Tracking identifier',
        ),
      }),
    );
  }
}

/**
 * Creates an onboarding application query bridge.
 *
 * @param {ConstructorParameters<typeof OnboardingApplicationQueryBridge>[0]}
 * [options] Bridge options.
 * @returns {OnboardingApplicationQueryBridge} Query bridge.
 */
export function createOnboardingApplicationQueryBridge(options = {}) {
  return new OnboardingApplicationQueryBridge(options);
}

/**
 * Creates a journey resume bridge.
 *
 * @param {ConstructorParameters<typeof JourneyResumeBridge>[0]} [options]
 * Bridge options.
 * @returns {JourneyResumeBridge} Resume bridge.
 */
export function createJourneyResumeBridge(options = {}) {
  return new JourneyResumeBridge(options);
}

/**
 * Creates a rule outcome bridge.
 *
 * @param {ConstructorParameters<typeof RuleOutcomeBridge>[0]} [options]
 * Bridge options.
 * @returns {RuleOutcomeBridge} Rule outcome bridge.
 */
export function createRuleOutcomeBridge(options = {}) {
  return new RuleOutcomeBridge(options);
}

export const ApplicationQueryBridge =
  OnboardingApplicationQueryBridge;
export const OnboardingQueryBridge =
  OnboardingApplicationQueryBridge;
export const ValidationOutcomeBridge = RuleOutcomeBridge;
export const EligibilityOutcomeBridge = RuleOutcomeBridge;

export default Object.freeze({
  OnboardingApplicationQueryBridge,
  JourneyResumeBridge,
  RuleOutcomeBridge,
  createOnboardingApplicationQueryBridge,
  createJourneyResumeBridge,
  createRuleOutcomeBridge,
});