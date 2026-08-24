import { getSeeds } from '../../persistence/seedLoader.js';
import { toIsoTimestamp } from '../../utils/dates.js';
import {
  createDeterministicId,
  generateCorrelationId,
} from '../../utils/ids.js';

export const PROVIDER_SIMULATION_ERROR_CODES = Object.freeze({
  INVALID_OPTIONS: 'PROVIDER_SIMULATION_INVALID_OPTIONS',
  INVALID_REQUEST: 'PROVIDER_SIMULATION_INVALID_REQUEST',
  INVALID_PROVIDER: 'PROVIDER_SIMULATION_INVALID_PROVIDER',
  PROVIDER_NOT_FOUND: 'PROVIDER_SIMULATION_PROVIDER_NOT_FOUND',
  SCENARIO_NOT_FOUND: 'PROVIDER_SIMULATION_SCENARIO_NOT_FOUND',
  INVALID_SCENARIO: 'PROVIDER_SIMULATION_INVALID_SCENARIO',
  REPOSITORY_UNAVAILABLE:
    'PROVIDER_SIMULATION_REPOSITORY_UNAVAILABLE',
  PERSISTENCE_FAILED: 'PROVIDER_SIMULATION_PERSISTENCE_FAILED',
  SIMULATION_FAILED: 'PROVIDER_SIMULATION_FAILED',
});

export const SIMULATED_PROVIDER_CODES = Object.freeze({
  NIPR: 'NIPR',
  GIACT: 'GIACT',
  AML: 'AML_DEMO',
  AML_DEMO: 'AML_DEMO',
  LIMRA: 'LIMRA',
  REGED: 'REGED',
  BIG: 'BIG',
  BACKGROUND: 'BIG',
  SIRCON: 'SIRCON_VERTAFORE',
  VERTAFORE: 'SIRCON_VERTAFORE',
  SIRCON_VERTAFORE: 'SIRCON_VERTAFORE',
  DTCC: 'DTCC',
  ETHOS: 'ETHOS',
  HORIZON: 'HORIZON',
  DOCUSIGN: 'DOCUSIGN',
  VERINT: 'VERINT',
});

export const PROVIDER_CHECK_STATUSES = Object.freeze({
  QUEUED: 'queued',
  PENDING: 'pending',
  COMPLETED: 'completed',
  FAILED: 'failed',
});

const PROVIDER_CODE_ALIASES = Object.freeze({
  AML: SIMULATED_PROVIDER_CODES.AML_DEMO,
  AMLDEMO: SIMULATED_PROVIDER_CODES.AML_DEMO,
  BACKGROUND: SIMULATED_PROVIDER_CODES.BIG,
  BACKGROUNDDEMO: SIMULATED_PROVIDER_CODES.BIG,
  BIG: SIMULATED_PROVIDER_CODES.BIG,
  DOCUSIGN: SIMULATED_PROVIDER_CODES.DOCUSIGN,
  DTCC: SIMULATED_PROVIDER_CODES.DTCC,
  ETHOS: SIMULATED_PROVIDER_CODES.ETHOS,
  GIACT: SIMULATED_PROVIDER_CODES.GIACT,
  HORIZON: SIMULATED_PROVIDER_CODES.HORIZON,
  LIMRA: SIMULATED_PROVIDER_CODES.LIMRA,
  NIPR: SIMULATED_PROVIDER_CODES.NIPR,
  REGED: SIMULATED_PROVIDER_CODES.REGED,
  SIRCON: SIMULATED_PROVIDER_CODES.SIRCON_VERTAFORE,
  SIRCONVERTAFORE: SIMULATED_PROVIDER_CODES.SIRCON_VERTAFORE,
  VERTAFORE: SIMULATED_PROVIDER_CODES.SIRCON_VERTAFORE,
  VERINT: SIMULATED_PROVIDER_CODES.VERINT,
});

const PENDING_OUTCOMES = new Set([
  'ACCEPTED',
  'IN_PROGRESS',
  'PENDING',
  'QUEUED',
  'SENT',
]);

const FAILED_OUTCOMES = new Set([
  'ERROR',
  'FAILED',
  'UNAVAILABLE',
]);

const BUILT_IN_PROVIDER_DEFINITIONS = Object.freeze([
  Object.freeze({
    code: SIMULATED_PROVIDER_CODES.LIMRA,
    name: 'LIMRA Demo Training Verification',
    service: 'trainingVerification',
    defaultScenario: 'training_complete',
    scenarios: Object.freeze([
      Object.freeze({
        id: 'limra_training_complete',
        scenario: 'training_complete',
        description:
          'Required LIMRA training is complete and currently valid.',
        outcome: 'VERIFIED',
        httpStatus: 200,
        latencyMs: 240,
        requestMatch: Object.freeze({
          trainingKey: 'LIMRA-DEMO-COMPLETE',
        }),
        response: Object.freeze({
          status: 'COMPLETE',
          trainingComplete: true,
          eligible: true,
          manualReviewRequired: false,
          validationCodes: Object.freeze([]),
        }),
      }),
      Object.freeze({
        id: 'limra_training_incomplete',
        scenario: 'training_incomplete',
        description:
          'Required LIMRA training has not been completed.',
        outcome: 'INELIGIBLE',
        httpStatus: 200,
        latencyMs: 240,
        requestMatch: Object.freeze({
          trainingKey: 'LIMRA-DEMO-INCOMPLETE',
        }),
        response: Object.freeze({
          status: 'INCOMPLETE',
          trainingComplete: false,
          eligible: false,
          manualReviewRequired: false,
          validationCodes: Object.freeze([
            'REQUIRED_TRAINING_INCOMPLETE',
          ]),
        }),
      }),
    ]),
  }),
  Object.freeze({
    code: SIMULATED_PROVIDER_CODES.REGED,
    name: 'RegEd Demo Compliance Verification',
    service: 'complianceVerification',
    defaultScenario: 'compliance_clear',
    scenarios: Object.freeze([
      Object.freeze({
        id: 'reged_compliance_clear',
        scenario: 'compliance_clear',
        description:
          'The producer satisfies the configured compliance requirements.',
        outcome: 'VERIFIED',
        httpStatus: 200,
        latencyMs: 260,
        requestMatch: Object.freeze({
          complianceKey: 'REGED-DEMO-CLEAR',
        }),
        response: Object.freeze({
          status: 'COMPLETE',
          complianceStatus: 'CLEAR',
          eligible: true,
          manualReviewRequired: false,
          validationCodes: Object.freeze([]),
        }),
      }),
      Object.freeze({
        id: 'reged_compliance_review',
        scenario: 'compliance_review',
        description:
          'The producer requires manual compliance review.',
        outcome: 'MANUAL_REVIEW',
        httpStatus: 200,
        latencyMs: 280,
        requestMatch: Object.freeze({
          complianceKey: 'REGED-DEMO-REVIEW',
        }),
        response: Object.freeze({
          status: 'COMPLETE',
          complianceStatus: 'REVIEW',
          eligible: false,
          manualReviewRequired: true,
          validationCodes: Object.freeze([
            'COMPLIANCE_REVIEW_REQUIRED',
          ]),
        }),
      }),
    ]),
  }),
  Object.freeze({
    code: SIMULATED_PROVIDER_CODES.VERINT,
    name: 'Verint Demo Identity Verification',
    service: 'identityVerification',
    defaultScenario: 'identity_verified',
    scenarios: Object.freeze([
      Object.freeze({
        id: 'verint_identity_verified',
        scenario: 'identity_verified',
        description:
          'The supplied identity attributes are successfully verified.',
        outcome: 'VERIFIED',
        httpStatus: 200,
        latencyMs: 310,
        requestMatch: Object.freeze({
          identityKey: 'VERINT-DEMO-VERIFIED',
        }),
        response: Object.freeze({
          status: 'COMPLETE',
          identityMatch: true,
          riskLevel: 'LOW',
          eligible: true,
          manualReviewRequired: false,
          validationCodes: Object.freeze([]),
        }),
      }),
      Object.freeze({
        id: 'verint_identity_review',
        scenario: 'identity_review',
        description:
          'Identity verification requires manual adjudication.',
        outcome: 'MANUAL_REVIEW',
        httpStatus: 200,
        latencyMs: 330,
        requestMatch: Object.freeze({
          identityKey: 'VERINT-DEMO-REVIEW',
        }),
        response: Object.freeze({
          status: 'COMPLETE',
          identityMatch: false,
          riskLevel: 'MEDIUM',
          eligible: false,
          manualReviewRequired: true,
          validationCodes: Object.freeze([
            'IDENTITY_REVIEW_REQUIRED',
          ]),
        }),
      }),
    ]),
  }),
]);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertOptions(options, description = 'Provider simulation options') {
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
  return normalizeIdentifier(value, 'Provider code')
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function normalizeProviderCode(providerCode) {
  const token = normalizeToken(providerCode);

  return PROVIDER_CODE_ALIASES[token] ?? String(providerCode).trim();
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

function createProviderSimulationError(
  code,
  message,
  details,
  cause,
) {
  const error = new Error(message, {
    ...(cause === undefined ? {} : { cause }),
  });

  error.name = 'ProviderSimulationError';
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

function normalizeComparableValue(value) {
  return typeof value === 'string'
    ? value.trim().normalize('NFKC').toLowerCase()
    : value;
}

function valuesMatch(expected, actual) {
  if (isObject(expected)) {
    if (!isObject(actual)) {
      return false;
    }

    return Object.entries(expected).every(([key, expectedValue]) =>
      valuesMatch(expectedValue, actual[key]),
    );
  }

  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) {
      return false;
    }

    return expected.every((expectedItem) =>
      actual.some((actualItem) =>
        valuesMatch(expectedItem, actualItem),
      ),
    );
  }

  return (
    normalizeComparableValue(expected) ===
    normalizeComparableValue(actual)
  );
}

function requestMatchesScenario(request, requestMatch) {
  if (!isObject(requestMatch)) {
    return false;
  }

  const entries = Object.entries(requestMatch);

  return (
    entries.length > 0 &&
    entries.every(([field, expectedValue]) => {
      const directValue = getValueAtPath(request, field);

      if (valuesMatch(expectedValue, directValue)) {
        return true;
      }

      const nestedValue = findValueByKey(request, field);

      return valuesMatch(expectedValue, nestedValue);
    })
  );
}

function findValueByKey(value, requestedKey, visited = new WeakSet()) {
  if (value === null || typeof value !== 'object') {
    return undefined;
  }

  if (visited.has(value)) {
    return undefined;
  }

  visited.add(value);

  if (Object.hasOwn(value, requestedKey)) {
    return value[requestedKey];
  }

  for (const nestedValue of Object.values(value)) {
    const match = findValueByKey(
      nestedValue,
      requestedKey,
      visited,
    );

    if (match !== undefined) {
      return match;
    }
  }

  return undefined;
}

function normalizeProviderDefinition(provider) {
  if (!isObject(provider)) {
    throw createProviderSimulationError(
      PROVIDER_SIMULATION_ERROR_CODES.INVALID_PROVIDER,
      'A provider definition must be an object.',
      null,
    );
  }

  const code = normalizeProviderCode(
    normalizeIdentifier(provider.code, 'Provider code'),
  );
  const name = normalizeIdentifier(
    provider.name,
    'Provider name',
  );
  const service = normalizeIdentifier(
    provider.service,
    'Provider service',
  );

  if (!Array.isArray(provider.scenarios) || provider.scenarios.length === 0) {
    throw createProviderSimulationError(
      PROVIDER_SIMULATION_ERROR_CODES.INVALID_PROVIDER,
      `Provider ${code} must contain at least one scenario.`,
      { providerCode: code },
    );
  }

  const scenarioIdentifiers = new Set();
  const scenarios = provider.scenarios.map((scenario, index) => {
    if (!isObject(scenario)) {
      throw createProviderSimulationError(
        PROVIDER_SIMULATION_ERROR_CODES.INVALID_SCENARIO,
        `Provider scenario ${index + 1} for ${code} must be an object.`,
        { providerCode: code, scenarioIndex: index },
      );
    }

    const scenarioName = normalizeIdentifier(
      scenario.scenario,
      'Provider scenario',
    );

    if (scenarioIdentifiers.has(scenarioName)) {
      throw createProviderSimulationError(
        PROVIDER_SIMULATION_ERROR_CODES.INVALID_SCENARIO,
        `Duplicate provider scenario: ${scenarioName}.`,
        {
          providerCode: code,
          scenario: scenarioName,
        },
      );
    }

    if (
      !Number.isInteger(scenario.httpStatus) ||
      scenario.httpStatus < 100 ||
      scenario.httpStatus > 599
    ) {
      throw createProviderSimulationError(
        PROVIDER_SIMULATION_ERROR_CODES.INVALID_SCENARIO,
        `Provider scenario ${scenarioName} has an invalid HTTP status.`,
        {
          providerCode: code,
          scenario: scenarioName,
          httpStatus: scenario.httpStatus,
        },
      );
    }

    if (!isObject(scenario.requestMatch)) {
      throw createProviderSimulationError(
        PROVIDER_SIMULATION_ERROR_CODES.INVALID_SCENARIO,
        `Provider scenario ${scenarioName} has an invalid request match.`,
        {
          providerCode: code,
          scenario: scenarioName,
        },
      );
    }

    if (!isObject(scenario.response)) {
      throw createProviderSimulationError(
        PROVIDER_SIMULATION_ERROR_CODES.INVALID_SCENARIO,
        `Provider scenario ${scenarioName} has an invalid response.`,
        {
          providerCode: code,
          scenario: scenarioName,
        },
      );
    }

    scenarioIdentifiers.add(scenarioName);

    return {
      ...cloneValue(scenario),
      id:
        normalizeOptionalIdentifier(scenario.id) ??
        `${code.toLowerCase()}_${scenarioName}`,
      scenario: scenarioName,
      outcome: normalizeIdentifier(
        scenario.outcome,
        'Provider scenario outcome',
      ),
      latencyMs:
        scenario.latencyMs === undefined
          ? undefined
          : normalizeLatency(scenario.latencyMs),
    };
  });
  const defaultScenario = normalizeIdentifier(
    provider.defaultScenario,
    'Default provider scenario',
  );

  if (!scenarioIdentifiers.has(defaultScenario)) {
    throw createProviderSimulationError(
      PROVIDER_SIMULATION_ERROR_CODES.INVALID_PROVIDER,
      `The default scenario for ${code} does not exist.`,
      {
        providerCode: code,
        defaultScenario,
      },
    );
  }

  return deepFreeze({
    ...cloneValue(provider),
    code,
    name,
    service,
    defaultScenario,
    scenarios,
  });
}

function normalizeLatency(value) {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(
      'Provider simulation latency must be a nonnegative integer.',
    );
  }

  return value;
}

function normalizeProviders(providers) {
  if (!Array.isArray(providers)) {
    throw new TypeError(
      'Provider simulation definitions must be an array.',
    );
  }

  const definitionsByCode = new Map();

  providers
    .map((provider) => normalizeProviderDefinition(provider))
    .forEach((provider) => {
      if (definitionsByCode.has(provider.code)) {
        throw createProviderSimulationError(
          PROVIDER_SIMULATION_ERROR_CODES.INVALID_PROVIDER,
          `Duplicate provider definition: ${provider.code}.`,
          { providerCode: provider.code },
        );
      }

      definitionsByCode.set(provider.code, provider);
    });

  BUILT_IN_PROVIDER_DEFINITIONS.forEach((provider) => {
    const normalizedProvider = normalizeProviderDefinition(provider);

    if (!definitionsByCode.has(normalizedProvider.code)) {
      definitionsByCode.set(
        normalizedProvider.code,
        normalizedProvider,
      );
    }
  });

  return definitionsByCode;
}

function normalizeRunOptions(options) {
  if (options === undefined) {
    return {};
  }

  if (typeof options === 'string') {
    return {
      scenario: options,
    };
  }

  return assertOptions(options, 'Provider simulation run options');
}

function resolveRequestedScenario(provider, request, options) {
  const configuredScenario =
    options.scenario ??
    options.providerScenario ??
    options.providerScenarios?.[provider.code];
  const requestScenario =
    request.providerScenario ?? request.simulationScenario;
  const genericRequestScenario = request.scenario;
  const scenarioName =
    normalizeOptionalIdentifier(configuredScenario) ??
    normalizeOptionalIdentifier(requestScenario);
  let scenario;

  if (scenarioName) {
    scenario = provider.scenarios.find(
      (candidate) => candidate.scenario === scenarioName,
    );

    if (!scenario) {
      throw createProviderSimulationError(
        PROVIDER_SIMULATION_ERROR_CODES.SCENARIO_NOT_FOUND,
        `Provider scenario not found: ${scenarioName}.`,
        {
          providerCode: provider.code,
          scenario: scenarioName,
          supportedScenarios: provider.scenarios.map(
            (candidate) => candidate.scenario,
          ),
        },
      );
    }

    return scenario;
  }

  if (genericRequestScenario) {
    scenario = provider.scenarios.find(
      (candidate) =>
        candidate.scenario === genericRequestScenario,
    );

    if (scenario) {
      return scenario;
    }

    if (options.strictScenario === true) {
      throw createProviderSimulationError(
        PROVIDER_SIMULATION_ERROR_CODES.SCENARIO_NOT_FOUND,
        `Provider scenario not found: ${genericRequestScenario}.`,
        {
          providerCode: provider.code,
          scenario: genericRequestScenario,
        },
      );
    }
  }

  scenario = provider.scenarios.find((candidate) =>
    requestMatchesScenario(request, candidate.requestMatch),
  );

  return (
    scenario ??
    provider.scenarios.find(
      (candidate) =>
        candidate.scenario === provider.defaultScenario,
    )
  );
}

function buildProviderRequest(request) {
  const applicant =
    request.applicant ??
    request.agent ??
    request.applicationPayload?.applicant ??
    request.applicationPayload?.agent ??
    request.formState?.applicant ??
    request.formState?.agent ??
    {};
  const banking =
    request.banking ??
    request.applicationPayload?.banking ??
    request.formState?.banking ??
    {};
  const contract =
    request.contract ??
    request.applicationPayload?.contract ??
    request.formState?.contract ??
    {};
  const sourceMetadata =
    request.sourceMetadata ??
    request.applicationPayload?.sourceMetadata ??
    request.formState?.sourceMetadata ??
    {};

  return {
    ...cloneValue(request),
    npn:
      request.npn ??
      applicant.npn ??
      request.licensing?.npn,
    crd: request.crd ?? applicant.crd,
    residentState:
      request.residentState ??
      request.residenceState ??
      applicant.residentState ??
      applicant.residenceState ??
      request.licensing?.residentState,
    routingNumberMasked:
      request.routingNumberMasked ??
      banking.routingNumberMasked ??
      banking.routingNumber,
    accountNumberMasked:
      request.accountNumberMasked ??
      banking.accountNumberMasked ??
      banking.accountNumber,
    contractType:
      request.contractType ?? contract.type,
    submissionId:
      request.submissionId ??
      sourceMetadata.submissionId,
    trackingId:
      request.trackingId ??
      request.applicationPayload?.trackingId,
    applicationId:
      request.applicationId ??
      request.applicationPayload?.applicationId,
  };
}

function collectValidationCodes(response) {
  if (!Array.isArray(response?.validationCodes)) {
    return [];
  }

  return [
    ...new Set(
      response.validationCodes
        .map((code) => normalizeOptionalIdentifier(code))
        .filter(Boolean),
    ),
  ];
}

function determineCheckStatus(scenario) {
  const outcome = scenario.outcome.toUpperCase();
  const responseStatus = normalizeOptionalIdentifier(
    scenario.response.status,
  )?.toUpperCase();

  if (
    scenario.httpStatus === 202 ||
    PENDING_OUTCOMES.has(outcome) ||
    PENDING_OUTCOMES.has(responseStatus)
  ) {
    return PROVIDER_CHECK_STATUSES.PENDING;
  }

  if (
    scenario.httpStatus >= 500 ||
    FAILED_OUTCOMES.has(outcome) ||
    FAILED_OUTCOMES.has(responseStatus)
  ) {
    return PROVIDER_CHECK_STATUSES.FAILED;
  }

  return PROVIDER_CHECK_STATUSES.COMPLETED;
}

function resolveManualReviewRequired(scenario) {
  return (
    scenario.response.manualReviewRequired === true ||
    scenario.outcome.toUpperCase() === 'MANUAL_REVIEW'
  );
}

function assertRepository(repository) {
  if (repository === undefined || repository === null) {
    return null;
  }

  if (
    !isObject(repository) ||
    typeof repository.create !== 'function'
  ) {
    throw createProviderSimulationError(
      PROVIDER_SIMULATION_ERROR_CODES.REPOSITORY_UNAVAILABLE,
      'The provider check repository must provide create.',
      null,
    );
  }

  return repository;
}

function normalizeFailure(error, providerCode) {
  return Object.freeze({
    ok: false,
    providerCode,
    error: Object.freeze({
      name: error?.name ?? 'Error',
      code:
        error?.code ??
        PROVIDER_SIMULATION_ERROR_CODES.SIMULATION_FAILED,
      message:
        error?.message ??
        'The provider simulation failed.',
      details: cloneValue(error?.details ?? null),
      recoverable: error?.recoverable !== false,
    }),
  });
}

/**
 * Runs deterministic, fixture-backed provider simulations.
 */
export class ProviderSimulationService {
  /**
   * @param {{
   *   providers?: object[],
   *   repository?: object,
   *   clock?: () => Date | string | number,
   *   defaultLatencyMs?: number,
   *   persist?: boolean
   * }} [options] Provider simulation options.
   */
  constructor(options = {}) {
    const normalizedOptions = assertOptions(options);

    if (
      normalizedOptions.clock !== undefined &&
      typeof normalizedOptions.clock !== 'function'
    ) {
      throw new TypeError(
        'The provider simulation clock must be a function.',
      );
    }

    if (
      normalizedOptions.persist !== undefined &&
      typeof normalizedOptions.persist !== 'boolean'
    ) {
      throw new TypeError(
        'The provider simulation persist option must be a boolean.',
      );
    }

    this.clock = normalizedOptions.clock ?? (() => new Date());
    this.defaultLatencyMs = normalizeLatency(
      normalizedOptions.defaultLatencyMs ??
        getSeeds().fixtures.providerResponses.defaults.latencyMs ??
        0,
    );
    this.providers = normalizeProviders(
      normalizedOptions.providers ?? getSeeds().providerDefinitions,
    );
    this.repository = assertRepository(normalizedOptions.repository);
    this.persist = normalizedOptions.persist ?? Boolean(this.repository);
  }

  /**
   * Lists configured provider definitions.
   *
   * @returns {object[]} Provider definitions.
   */
  listProviders() {
    return [...this.providers.values()].map((provider) =>
      cloneValue(provider),
    );
  }

  /**
   * Returns a provider definition by code or alias.
   *
   * @param {string} providerCode Provider code.
   * @returns {object} Provider definition.
   */
  getProvider(providerCode) {
    const normalizedCode = normalizeProviderCode(providerCode);
    const provider = this.providers.get(normalizedCode);

    if (!provider) {
      throw createProviderSimulationError(
        PROVIDER_SIMULATION_ERROR_CODES.PROVIDER_NOT_FOUND,
        `Provider simulation is not configured: ${normalizedCode}.`,
        {
          providerCode: normalizedCode,
          supportedProviders: [...this.providers.keys()],
        },
      );
    }

    return cloneValue(provider);
  }

  /**
   * Determines whether a provider is configured.
   *
   * @param {string} providerCode Provider code.
   * @returns {boolean} Whether the provider exists.
   */
  hasProvider(providerCode) {
    try {
      return this.providers.has(normalizeProviderCode(providerCode));
    } catch {
      return false;
    }
  }

  /**
   * Lists scenarios configured for a provider.
   *
   * @param {string} providerCode Provider code.
   * @returns {object[]} Provider scenarios.
   */
  listScenarios(providerCode) {
    return this.getProvider(providerCode).scenarios;
  }

  /**
   * Runs a provider simulation.
   *
   * @param {string} providerCode Provider code or alias.
   * @param {object} request Provider request or onboarding application.
   * @param {{
   *   scenario?: string,
   *   providerScenario?: string,
   *   providerScenarios?: Record<string, string>,
   *   correlationId?: string,
   *   checkId?: string,
   *   requestedAt?: Date | string | number,
   *   completedAt?: Date | string | number,
   *   latencyMs?: number,
   *   persist?: boolean,
   *   strictScenario?: boolean,
   *   metadata?: Record<string, unknown>
   * }} [options] Simulation options.
   * @returns {object} Simulated provider check.
   */
  runProviderCheck(providerCode, request, options = {}) {
    if (!isObject(request)) {
      throw createProviderSimulationError(
        PROVIDER_SIMULATION_ERROR_CODES.INVALID_REQUEST,
        'A provider simulation request must be an object.',
        {
          providerCode: normalizeOptionalIdentifier(providerCode) ?? null,
        },
      );
    }

    const normalizedOptions = normalizeRunOptions(options);
    const normalizedCode = normalizeProviderCode(providerCode);
    const provider = this.providers.get(normalizedCode);

    if (!provider) {
      throw createProviderSimulationError(
        PROVIDER_SIMULATION_ERROR_CODES.PROVIDER_NOT_FOUND,
        `Provider simulation is not configured: ${normalizedCode}.`,
        {
          providerCode: normalizedCode,
          supportedProviders: [...this.providers.keys()],
        },
      );
    }

    try {
      const providerRequest = buildProviderRequest(request);
      const scenario = resolveRequestedScenario(
        provider,
        providerRequest,
        normalizedOptions,
      );

      if (!scenario) {
        throw createProviderSimulationError(
          PROVIDER_SIMULATION_ERROR_CODES.SCENARIO_NOT_FOUND,
          `No provider scenario could be resolved for ${provider.code}.`,
          { providerCode: provider.code },
        );
      }

      const requestedAt = toIsoTimestamp(
        normalizedOptions.requestedAt ?? this.clock(),
      );
      const correlationId = normalizeIdentifier(
        normalizedOptions.correlationId ??
          request.correlationId ??
          generateCorrelationId({
            providerCode: provider.code,
            service: provider.service,
            scenario: scenario.scenario,
            trackingId: providerRequest.trackingId ?? null,
            applicationId: providerRequest.applicationId ?? null,
            request: providerRequest,
          }),
        'Provider correlation identifier',
      );
      const checkId = normalizeIdentifier(
        normalizedOptions.checkId ??
          createDeterministicId(
            'CHK',
            {
              providerCode: provider.code,
              service: provider.service,
              scenario: scenario.scenario,
              correlationId,
            },
            { length: 16 },
          ),
        'Provider check identifier',
      );
      const status = determineCheckStatus(scenario);
      const terminal =
        status === PROVIDER_CHECK_STATUSES.COMPLETED ||
        status === PROVIDER_CHECK_STATUSES.FAILED;
      const completedAt = terminal
        ? toIsoTimestamp(
            normalizedOptions.completedAt ?? this.clock(),
          )
        : null;
      const response = cloneValue(scenario.response);
      const validationCodes = collectValidationCodes(response);
      const latencyMs = normalizeLatency(
        normalizedOptions.latencyMs ??
          scenario.latencyMs ??
          this.defaultLatencyMs,
      );
      const check = {
        checkId,
        providerCode: provider.code,
        providerName: provider.name,
        service: provider.service,
        scenario: scenario.scenario,
        scenarioId: scenario.id,
        status,
        outcome: scenario.outcome,
        httpStatus: scenario.httpStatus,
        request: cloneValue(providerRequest),
        response,
        result: cloneValue(response),
        correlationId,
        latencyMs,
        manualReviewRequired:
          resolveManualReviewRequired(scenario),
        validationCodes,
        requestedAt,
        completedAt,
        trackingId:
          normalizeOptionalIdentifier(providerRequest.trackingId) ??
          null,
        applicationId:
          normalizeOptionalIdentifier(providerRequest.applicationId) ??
          null,
        description: scenario.description ?? '',
        metadata: cloneValue(normalizedOptions.metadata ?? {}),
      };
      const shouldPersist =
        normalizedOptions.persist ?? this.persist;

      return shouldPersist
        ? this.persistCheck(check)
        : cloneValue(check);
    } catch (error) {
      if (
        error?.name === 'ProviderSimulationError' ||
        error instanceof TypeError ||
        error instanceof RangeError
      ) {
        throw error;
      }

      throw createProviderSimulationError(
        PROVIDER_SIMULATION_ERROR_CODES.SIMULATION_FAILED,
        `The ${provider.code} provider simulation failed.`,
        { providerCode: provider.code },
        error,
      );
    }
  }

  /**
   * Alias for runProviderCheck.
   *
   * @param {string} providerCode Provider code.
   * @param {object} request Provider request.
   * @param {object | string} [options] Simulation options or scenario.
   * @returns {object} Simulated provider check.
   */
  simulate(providerCode, request, options = {}) {
    return this.runProviderCheck(providerCode, request, options);
  }

  /**
   * Runs a simulation and returns a structured failure instead of throwing.
   *
   * @param {string} providerCode Provider code.
   * @param {object} request Provider request.
   * @param {object | string} [options] Simulation options or scenario.
   * @returns {{ok: true, check: object} | {ok: false, error: object}}
   * Isolated simulation result.
   */
  runSafely(providerCode, request, options = {}) {
    const normalizedCode =
      normalizeOptionalIdentifier(providerCode) ?? 'UNKNOWN';

    try {
      return Object.freeze({
        ok: true,
        check: this.runProviderCheck(
          providerCode,
          request,
          options,
        ),
      });
    } catch (error) {
      return normalizeFailure(error, normalizedCode);
    }
  }

  /**
   * Runs multiple provider checks independently.
   *
   * @param {Array<string | {providerCode: string, request?: object, options?: object}>}
   * providers Provider requests.
   * @param {object} request Shared provider request.
   * @param {{failFast?: boolean, providerOptions?: Record<string, object>}}
   * [options] Batch options.
   * @returns {object} Provider checks and failures keyed by provider code.
   */
  runChecks(providers, request, options = {}) {
    if (!Array.isArray(providers)) {
      throw new TypeError(
        'Provider simulation checks must be an array.',
      );
    }

    if (!isObject(request)) {
      throw new TypeError(
        'A shared provider simulation request must be an object.',
      );
    }

    const normalizedOptions = assertOptions(
      options,
      'Provider simulation batch options',
    );
    const checks = {};
    const errors = {};

    providers.forEach((entry) => {
      const definition =
        typeof entry === 'string'
          ? { providerCode: entry }
          : assertOptions(entry, 'Provider simulation batch entry');
      const providerCode = normalizeProviderCode(
        definition.providerCode,
      );

      try {
        checks[providerCode] = this.runProviderCheck(
          providerCode,
          definition.request ?? request,
          {
            ...(normalizedOptions.providerOptions?.[providerCode] ?? {}),
            ...(definition.options ?? {}),
          },
        );
      } catch (error) {
        if (normalizedOptions.failFast === true) {
          throw error;
        }

        errors[providerCode] = normalizeFailure(
          error,
          providerCode,
        ).error;
      }
    });

    return Object.freeze({
      checks: deepFreeze(cloneValue(checks)),
      errors: deepFreeze(cloneValue(errors)),
      successful: Object.keys(checks).length,
      failed: Object.keys(errors).length,
      manualReviewRequired: Object.values(checks).some(
        (check) => check.manualReviewRequired,
      ),
      validationCodes: Object.freeze([
        ...new Set(
          Object.values(checks).flatMap(
            (check) => check.validationCodes,
          ),
        ),
      ]),
    });
  }

  runNiprCheck(request, options = {}) {
    return this.runProviderCheck(
      SIMULATED_PROVIDER_CODES.NIPR,
      request,
      options,
    );
  }

  runGiactCheck(request, options = {}) {
    return this.runProviderCheck(
      SIMULATED_PROVIDER_CODES.GIACT,
      request,
      options,
    );
  }

  runAmlCheck(request, options = {}) {
    return this.runProviderCheck(
      SIMULATED_PROVIDER_CODES.AML_DEMO,
      request,
      options,
    );
  }

  runLimraCheck(request, options = {}) {
    return this.runProviderCheck(
      SIMULATED_PROVIDER_CODES.LIMRA,
      request,
      options,
    );
  }

  runRegEdCheck(request, options = {}) {
    return this.runProviderCheck(
      SIMULATED_PROVIDER_CODES.REGED,
      request,
      options,
    );
  }

  runBigCheck(request, options = {}) {
    return this.runProviderCheck(
      SIMULATED_PROVIDER_CODES.BIG,
      request,
      options,
    );
  }

  runBackgroundFlow(request, options = {}) {
    return this.runBigCheck(request, options);
  }

  runSirconCheck(request, options = {}) {
    return this.runProviderCheck(
      SIMULATED_PROVIDER_CODES.SIRCON_VERTAFORE,
      request,
      options,
    );
  }

  runVertaforeCheck(request, options = {}) {
    return this.runSirconCheck(request, options);
  }

  runAppointmentFlow(request, options = {}) {
    return this.runSirconCheck(request, options);
  }

  runDtccCheck(request, options = {}) {
    return this.runProviderCheck(
      SIMULATED_PROVIDER_CODES.DTCC,
      request,
      options,
    );
  }

  runDtccRules(request, options = {}) {
    return this.runDtccCheck(request, options);
  }

  runEthosCheck(request, options = {}) {
    return this.runProviderCheck(
      SIMULATED_PROVIDER_CODES.ETHOS,
      request,
      options,
    );
  }

  runEthosRules(request, options = {}) {
    return this.runEthosCheck(request, options);
  }

  runHorizonCheck(request, options = {}) {
    return this.runProviderCheck(
      SIMULATED_PROVIDER_CODES.HORIZON,
      request,
      options,
    );
  }

  runHorizonJitRouting(request, options = {}) {
    return this.runHorizonCheck(request, options);
  }

  runDocuSignCheck(request, options = {}) {
    return this.runProviderCheck(
      SIMULATED_PROVIDER_CODES.DOCUSIGN,
      request,
      options,
    );
  }

  runElectronicSignatureFlow(request, options = {}) {
    return this.runDocuSignCheck(request, options);
  }

  runVerintCheck(request, options = {}) {
    return this.runProviderCheck(
      SIMULATED_PROVIDER_CODES.VERINT,
      request,
      options,
    );
  }

  persistCheck(check) {
    if (!this.repository) {
      throw createProviderSimulationError(
        PROVIDER_SIMULATION_ERROR_CODES.REPOSITORY_UNAVAILABLE,
        'A provider check repository is required to persist simulations.',
        {
          providerCode: check.providerCode,
          checkId: check.checkId,
        },
      );
    }

    try {
      const existing =
        typeof this.repository.find === 'function'
          ? this.repository.find(check.checkId)
          : undefined;

      if (existing && typeof this.repository.save === 'function') {
        return cloneValue(this.repository.save(check));
      }

      if (existing && typeof this.repository.update === 'function') {
        return cloneValue(
          this.repository.update(check.checkId, check),
        );
      }

      if (existing) {
        return cloneValue(existing);
      }

      return cloneValue(this.repository.create(check));
    } catch (error) {
      throw createProviderSimulationError(
        PROVIDER_SIMULATION_ERROR_CODES.PERSISTENCE_FAILED,
        'Unable to persist the simulated provider check.',
        {
          providerCode: check.providerCode,
          checkId: check.checkId,
        },
        error,
      );
    }
  }
}

/**
 * Creates a provider simulation service.
 *
 * @param {ConstructorParameters<typeof ProviderSimulationService>[0]}
 * [options] Provider simulation options.
 * @returns {ProviderSimulationService} Provider simulation service.
 */
export function createProviderSimulationService(options = {}) {
  return new ProviderSimulationService(options);
}

/**
 * Runs a provider simulation using a newly created service.
 *
 * @param {string} providerCode Provider code.
 * @param {object} request Provider request.
 * @param {object | string} [runOptions] Run options or scenario.
 * @param {ConstructorParameters<typeof ProviderSimulationService>[0]}
 * [serviceOptions] Service options.
 * @returns {object} Simulated provider check.
 */
export function simulateProviderCheck(
  providerCode,
  request,
  runOptions = {},
  serviceOptions = {},
) {
  return createProviderSimulationService(
    serviceOptions,
  ).runProviderCheck(providerCode, request, runOptions);
}

export const ProviderSimulationModule = ProviderSimulationService;
export const ProviderAdapterRegistry = ProviderSimulationService;
export const createProviderAdapterRegistry =
  createProviderSimulationService;
export const runProviderSimulation = simulateProviderCheck;

export default ProviderSimulationService;