import { z } from 'zod';
import {
  SOURCE_CHANNELS,
  SOURCE_FORMATS,
} from '../constants/domain.js';
import { ALL_ROLES } from '../constants/roles.js';
import historicalAssetsFixture from '../fixtures/historical-assets.json';
import intakeSamplesFixture from '../fixtures/intake-samples.json';
import onboardingRecordsFixture from '../fixtures/onboarding-records.json';
import operationsDataFixture from '../fixtures/operations-data.json';
import providerResponsesFixture from '../fixtures/provider-responses.json';
import referenceConfigFixture from '../fixtures/reference-config.json';
import usersFixture from '../fixtures/users.json';

const identifierSchema = z.string().trim().min(1);
const dateTimeSchema = z.string().datetime({ offset: true });
const nullableIdentifierSchema = identifierSchema.nullable();
const nullableDateTimeSchema = dateTimeSchema.nullable();
const metadataSchema = z.record(z.unknown());
const sourceChannelSchema = z.enum(Object.values(SOURCE_CHANNELS));
const sourceFormatSchema = z.enum(Object.values(SOURCE_FORMATS));
const roleSchema = z.enum(ALL_ROLES);

const fixtureMetadataSchema = z
  .object({
    schemaVersion: z.number().int().positive(),
    fixtureVersion: identifierSchema,
    description: z.string().trim().min(1),
  })
  .passthrough();

const intakeSampleSchema = z
  .object({
    id: identifierSchema,
    name: z.string().trim().min(1),
    description: z.string().trim().min(1),
    sourceChannel: sourceChannelSchema,
    sourceFormat: sourceFormatSchema,
    fileName: z.string().nullable(),
    mimeType: z.string().nullable(),
    bulk: z.boolean(),
    simulateScenario: identifierSchema,
    partnerCode: identifierSchema,
    rawContent: z.string(),
    expected: metadataSchema,
  })
  .passthrough();

const intakeSamplesSchema = fixtureMetadataSchema.extend({
  defaults: metadataSchema,
  supportedSourceChannels: z.array(sourceChannelSchema).min(1),
  supportedSourceFormats: z.array(sourceFormatSchema).min(1),
  samples: z.array(intakeSampleSchema).min(1),
});

const onboardingRecordSchema = z
  .object({
    id: identifierSchema,
    applicationId: identifierSchema,
    trackingId: identifierSchema,
    scenario: identifierSchema.optional(),
    journeyType: identifierSchema,
    requestType: identifierSchema,
    status: identifierSchema,
    workflowStage: identifierSchema,
    priority: identifierSchema,
    sourceChannel: sourceChannelSchema,
    sourceFormat: sourceFormatSchema,
    partnerCode: identifierSchema,
    company: identifierSchema,
    carrierCode: identifierSchema,
    gaCode: identifierSchema,
    agency: metadataSchema,
    contract: metadataSchema,
    applicant: metadataSchema,
    licensing: metadataSchema,
    background: metadataSchema,
    appointment: metadataSchema,
    documents: metadataSchema,
    progress: metadataSchema,
    assignment: metadataSchema,
    exceptions: z.array(metadataSchema),
    duplicateOfApplicationId: nullableIdentifierSchema,
    submittedAt: nullableDateTimeSchema,
    completedAt: nullableDateTimeSchema,
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
  })
  .passthrough();

const onboardingRecordsSchema = fixtureMetadataSchema.extend({
  records: z.array(onboardingRecordSchema).min(1),
});

const workItemSchema = z
  .object({
    workItemId: identifierSchema,
    trackingId: nullableIdentifierSchema,
    sourceRecordId: identifierSchema,
    cardType: identifierSchema,
    state: identifierSchema,
    priority: identifierSchema,
    assignedTo: nullableIdentifierSchema,
    assignedGroup: identifierSchema,
    partnerCode: identifierSchema,
    title: z.string().trim().min(1),
    summary: z.string().trim().min(1),
    metadata: metadataSchema,
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    completedAt: nullableDateTimeSchema,
    history: z.array(metadataSchema),
  })
  .passthrough();

const assignmentSchema = z
  .object({
    assignmentId: identifierSchema,
    workItemId: identifierSchema,
    trackingId: nullableIdentifierSchema,
    assignedTo: nullableIdentifierSchema,
    assignedGroup: identifierSchema,
    assignedBy: identifierSchema,
    assignmentReason: identifierSchema,
    status: identifierSchema,
    assignedAt: dateTimeSchema,
    releasedAt: nullableDateTimeSchema,
  })
  .passthrough();

const lifecycleEventSchema = z
  .object({
    lifecycleEventId: identifierSchema,
    trackingId: nullableIdentifierSchema,
    applicationId: identifierSchema,
    status: identifierSchema,
    workflowStage: identifierSchema,
    actorType: identifierSchema,
    actorId: identifierSchema,
    source: identifierSchema,
    summary: z.string().trim().min(1),
    timestamp: dateTimeSchema,
  })
  .passthrough();

const notificationSchema = z
  .object({
    notificationId: identifierSchema,
    trackingId: nullableIdentifierSchema,
    partnerCode: identifierSchema,
    channel: identifierSchema,
    type: identifierSchema,
    recipientMasked: z.string().trim().min(1),
    templateCode: identifierSchema,
    previewPayload: metadataSchema,
    status: identifierSchema,
    createdAt: dateTimeSchema,
  })
  .passthrough();

const syncAttemptSchema = z
  .object({
    syncAttemptId: identifierSchema,
    trackingId: nullableIdentifierSchema,
    system: identifierSchema,
    operation: identifierSchema,
    status: identifierSchema,
    correlationId: identifierSchema,
    message: z.string().trim().min(1),
    payloadSummary: metadataSchema,
    attemptedAt: dateTimeSchema,
    resolvedAt: nullableDateTimeSchema,
  })
  .passthrough();

const contractChangeSchema = z
  .object({
    changeRequestId: identifierSchema,
    trackingId: nullableIdentifierSchema,
    partnerCode: identifierSchema,
    changeType: identifierSchema,
    status: identifierSchema,
    manualReviewRequired: z.boolean(),
    createdWorkItemId: nullableIdentifierSchema,
    requestedBy: identifierSchema,
    payload: metadataSchema,
    outcome: metadataSchema,
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
  })
  .passthrough();

const operationsDataSchema = fixtureMetadataSchema.extend({
  defaults: metadataSchema,
  workItems: z.array(workItemSchema),
  assignments: z.array(assignmentSchema),
  lifecycleEvents: z.array(lifecycleEventSchema),
  notificationLogs: z.array(notificationSchema),
  syncAttempts: z.array(syncAttemptSchema),
  contractChanges: z.array(contractChangeSchema),
});

const providerScenarioSchema = z
  .object({
    id: identifierSchema,
    scenario: identifierSchema,
    description: z.string().trim().min(1),
    outcome: identifierSchema,
    httpStatus: z.number().int().min(100).max(599),
    latencyMs: z.number().int().nonnegative().optional(),
    requestMatch: metadataSchema,
    response: metadataSchema,
  })
  .passthrough();

const providerDefinitionSchema = z
  .object({
    code: identifierSchema,
    name: z.string().trim().min(1),
    service: identifierSchema,
    defaultScenario: identifierSchema,
    scenarios: z.array(providerScenarioSchema).min(1),
  })
  .passthrough()
  .superRefine((provider, context) => {
    const hasDefaultScenario = provider.scenarios.some(
      (scenario) => scenario.scenario === provider.defaultScenario,
    );

    if (!hasDefaultScenario) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'The default provider scenario must exist.',
        path: ['defaultScenario'],
      });
    }
  });

const providerResponsesSchema = fixtureMetadataSchema.extend({
  defaults: metadataSchema,
  providers: z.array(providerDefinitionSchema).min(1),
});

function createHistoricalRecordSchema(identifierField) {
  return z
    .object({
      [identifierField]: identifierSchema,
    })
    .passthrough();
}

const historicalAssetsSchema = fixtureMetadataSchema.extend({
  defaults: metadataSchema,
  contracts: z.array(
    createHistoricalRecordSchema('historicalContractId'),
  ),
  terminations: z.array(createHistoricalRecordSchema('terminationId')),
  backgroundChecks: z.array(
    createHistoricalRecordSchema('backgroundCheckId'),
  ),
  appointments: z.array(createHistoricalRecordSchema('appointmentId')),
  licenses: z.array(createHistoricalRecordSchema('licenseHistoryId')),
  uplines: z.array(createHistoricalRecordSchema('uplineHistoryId')),
  assignees: z.array(
    createHistoricalRecordSchema('assigneeHistoryId'),
  ),
  generatedCodes: z.array(
    createHistoricalRecordSchema('generatedCodeId'),
  ),
});

const referenceItemSchema = z
  .object({
    id: identifierSchema,
    code: identifierSchema,
    name: z.string().trim().min(1),
    status: identifierSchema,
  })
  .passthrough();

const statusOptionSchema = z
  .object({
    code: identifierSchema,
    name: z.string().trim().min(1),
  })
  .passthrough();

const referenceConfigSchema = z
  .object({
    carriers: z.array(referenceItemSchema),
    generalAgencies: z.array(referenceItemSchema),
    agencyTypes: z.array(referenceItemSchema),
    contracts: z.array(referenceItemSchema),
    levels: z.array(referenceItemSchema),
    schedules: z.array(referenceItemSchema),
    providers: z.array(referenceItemSchema),
    roles: z.array(referenceItemSchema),
    statuses: z
      .object({
        users: z.array(statusOptionSchema),
        onboarding: z.array(statusOptionSchema),
        contracts: z.array(statusOptionSchema),
        documents: z.array(statusOptionSchema),
      })
      .passthrough(),
    notificationDefaults: metadataSchema,
  })
  .passthrough();

const userSchema = z
  .object({
    id: identifierSchema,
    email: z.string().trim().email(),
    firstName: z.string().trim().min(1),
    lastName: z.string().trim().min(1),
    role: roleSchema,
    organization: z.string().trim().min(1),
    status: identifierSchema,
  })
  .passthrough();

const usersSchema = z.array(userSchema).min(1);

export const FIXTURE_SCHEMAS = Object.freeze({
  historicalAssets: historicalAssetsSchema,
  intakeSamples: intakeSamplesSchema,
  onboardingRecords: onboardingRecordsSchema,
  operationsData: operationsDataSchema,
  providerResponses: providerResponsesSchema,
  referenceConfig: referenceConfigSchema,
  users: usersSchema,
});

export const RAW_FIXTURES = Object.freeze({
  historicalAssets: historicalAssetsFixture,
  intakeSamples: intakeSamplesFixture,
  onboardingRecords: onboardingRecordsFixture,
  operationsData: operationsDataFixture,
  providerResponses: providerResponsesFixture,
  referenceConfig: referenceConfigFixture,
  users: usersFixture,
});

function assertFixtureBundle(fixtures) {
  if (!fixtures || typeof fixtures !== 'object' || Array.isArray(fixtures)) {
    throw new TypeError('The fixture bundle must be an object.');
  }

  return fixtures;
}

function formatValidationIssues(error) {
  return error.issues
    .map((issue) => {
      const path =
        issue.path.length > 0 ? issue.path.join('.') : 'fixture';

      return `${path}: ${issue.message}`;
    })
    .join('; ');
}

function parseFixture(name, schema, value) {
  const result = schema.safeParse(value);

  if (!result.success) {
    throw new Error(
      `Invalid ${name} fixture: ${formatValidationIssues(result.error)}`,
      { cause: result.error },
    );
  }

  return result.data;
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

function normalizeIndexKey(value, description) {
  if (
    value === null ||
    value === undefined ||
    String(value).trim() === ''
  ) {
    throw new Error(`${description} is required to build a fixture index.`);
  }

  return String(value);
}

function createUniqueIndex(records, keySelector, description) {
  const index = Object.create(null);

  records.forEach((record) => {
    const key = normalizeIndexKey(keySelector(record), description);

    if (Object.hasOwn(index, key)) {
      throw new Error(`Duplicate ${description}: ${key}`);
    }

    index[key] = record;
  });

  return Object.freeze(index);
}

function createOptionalUniqueIndex(records, keySelector, description) {
  const index = Object.create(null);

  records.forEach((record) => {
    const value = keySelector(record);

    if (
      value === null ||
      value === undefined ||
      String(value).trim() === ''
    ) {
      return;
    }

    const key = String(value);

    if (Object.hasOwn(index, key)) {
      throw new Error(`Duplicate ${description}: ${key}`);
    }

    index[key] = record;
  });

  return Object.freeze(index);
}

function createGroupedIndex(records, keySelector) {
  const mutableIndex = Object.create(null);

  records.forEach((record) => {
    const value = keySelector(record);

    if (
      value === null ||
      value === undefined ||
      String(value).trim() === ''
    ) {
      return;
    }

    const key = String(value);
    const group = mutableIndex[key] ?? [];

    group.push(record);
    mutableIndex[key] = group;
  });

  Object.keys(mutableIndex).forEach((key) => {
    mutableIndex[key] = Object.freeze([...mutableIndex[key]]);
  });

  return Object.freeze(mutableIndex);
}

function createProviderScenarioIndex(providers) {
  return createUniqueIndex(
    providers.flatMap((provider) =>
      provider.scenarios.map((scenario) =>
        Object.freeze({
          ...scenario,
          providerCode: provider.code,
          providerName: provider.name,
          service: provider.service,
        }),
      ),
    ),
    (scenario) => scenario.id,
    'provider scenario identifier',
  );
}

function buildFixtureIndexes(fixtures) {
  const onboardingRecords = fixtures.onboardingRecords.records;
  const operations = fixtures.operationsData;
  const historical = fixtures.historicalAssets;
  const providers = fixtures.providerResponses.providers;
  const referenceConfig = fixtures.referenceConfig;

  const indexes = {
    intakeSamples: {
      byId: createUniqueIndex(
        fixtures.intakeSamples.samples,
        (sample) => sample.id,
        'intake sample identifier',
      ),
      byScenario: createGroupedIndex(
        fixtures.intakeSamples.samples,
        (sample) => sample.simulateScenario,
      ),
      byPartnerCode: createGroupedIndex(
        fixtures.intakeSamples.samples,
        (sample) => sample.partnerCode,
      ),
    },
    onboardingRecords: {
      byId: createUniqueIndex(
        onboardingRecords,
        (record) => record.id,
        'onboarding record identifier',
      ),
      byApplicationId: createUniqueIndex(
        onboardingRecords,
        (record) => record.applicationId,
        'application identifier',
      ),
      byTrackingId: createUniqueIndex(
        onboardingRecords,
        (record) => record.trackingId,
        'tracking identifier',
      ),
      byPartnerCode: createGroupedIndex(
        onboardingRecords,
        (record) => record.partnerCode,
      ),
    },
    workItems: {
      byId: createUniqueIndex(
        operations.workItems,
        (workItem) => workItem.workItemId,
        'work item identifier',
      ),
      byTrackingId: createGroupedIndex(
        operations.workItems,
        (workItem) => workItem.trackingId,
      ),
      byAssignedTo: createGroupedIndex(
        operations.workItems,
        (workItem) => workItem.assignedTo,
      ),
    },
    assignments: {
      byId: createUniqueIndex(
        operations.assignments,
        (assignment) => assignment.assignmentId,
        'assignment identifier',
      ),
      byWorkItemId: createGroupedIndex(
        operations.assignments,
        (assignment) => assignment.workItemId,
      ),
      byTrackingId: createGroupedIndex(
        operations.assignments,
        (assignment) => assignment.trackingId,
      ),
    },
    lifecycleEvents: {
      byId: createUniqueIndex(
        operations.lifecycleEvents,
        (event) => event.lifecycleEventId,
        'lifecycle event identifier',
      ),
      byApplicationId: createGroupedIndex(
        operations.lifecycleEvents,
        (event) => event.applicationId,
      ),
      byTrackingId: createGroupedIndex(
        operations.lifecycleEvents,
        (event) => event.trackingId,
      ),
    },
    notifications: {
      byId: createUniqueIndex(
        operations.notificationLogs,
        (notification) => notification.notificationId,
        'notification identifier',
      ),
      byTrackingId: createGroupedIndex(
        operations.notificationLogs,
        (notification) => notification.trackingId,
      ),
    },
    syncAttempts: {
      byId: createUniqueIndex(
        operations.syncAttempts,
        (attempt) => attempt.syncAttemptId,
        'sync attempt identifier',
      ),
      byTrackingId: createGroupedIndex(
        operations.syncAttempts,
        (attempt) => attempt.trackingId,
      ),
      byCorrelationId: createGroupedIndex(
        operations.syncAttempts,
        (attempt) => attempt.correlationId,
      ),
    },
    contractChanges: {
      byId: createUniqueIndex(
        operations.contractChanges,
        (change) => change.changeRequestId,
        'contract change identifier',
      ),
      byTrackingId: createGroupedIndex(
        operations.contractChanges,
        (change) => change.trackingId,
      ),
    },
    providers: {
      byCode: createUniqueIndex(
        providers,
        (provider) => provider.code,
        'provider code',
      ),
      scenariosById: createProviderScenarioIndex(providers),
    },
    users: {
      byId: createUniqueIndex(
        fixtures.users,
        (user) => user.id,
        'user identifier',
      ),
      byEmail: createUniqueIndex(
        fixtures.users,
        (user) => user.email.toLowerCase(),
        'user email',
      ),
      byRole: createGroupedIndex(
        fixtures.users,
        (user) => user.role,
      ),
    },
    historicalAssets: {
      contractsById: createUniqueIndex(
        historical.contracts,
        (record) => record.historicalContractId,
        'historical contract identifier',
      ),
      contractsByTrackingId: createGroupedIndex(
        historical.contracts,
        (record) => record.trackingId,
      ),
      terminationsById: createUniqueIndex(
        historical.terminations,
        (record) => record.terminationId,
        'termination identifier',
      ),
      backgroundChecksById: createUniqueIndex(
        historical.backgroundChecks,
        (record) => record.backgroundCheckId,
        'background check identifier',
      ),
      appointmentsById: createUniqueIndex(
        historical.appointments,
        (record) => record.appointmentId,
        'appointment identifier',
      ),
      licensesById: createUniqueIndex(
        historical.licenses,
        (record) => record.licenseHistoryId,
        'license history identifier',
      ),
      uplinesById: createUniqueIndex(
        historical.uplines,
        (record) => record.uplineHistoryId,
        'upline history identifier',
      ),
      assigneesById: createUniqueIndex(
        historical.assignees,
        (record) => record.assigneeHistoryId,
        'assignee history identifier',
      ),
      generatedCodesById: createUniqueIndex(
        historical.generatedCodes,
        (record) => record.generatedCodeId,
        'generated code identifier',
      ),
      generatedCodesByTrackingId: createGroupedIndex(
        historical.generatedCodes,
        (record) => record.trackingId,
      ),
    },
    referenceConfig: {
      carriersByCode: createUniqueIndex(
        referenceConfig.carriers,
        (item) => item.code,
        'carrier code',
      ),
      generalAgenciesByCode: createUniqueIndex(
        referenceConfig.generalAgencies,
        (item) => item.code,
        'general agency code',
      ),
      agencyTypesByCode: createUniqueIndex(
        referenceConfig.agencyTypes,
        (item) => item.code,
        'agency type code',
      ),
      contractsByCode: createUniqueIndex(
        referenceConfig.contracts,
        (item) => item.code,
        'contract code',
      ),
      levelsByCode: createUniqueIndex(
        referenceConfig.levels,
        (item) => item.code,
        'level code',
      ),
      schedulesByCode: createUniqueIndex(
        referenceConfig.schedules,
        (item) => item.code,
        'schedule code',
      ),
      providersByCode: createUniqueIndex(
        referenceConfig.providers,
        (item) => item.code,
        'reference provider code',
      ),
      rolesByCode: createUniqueIndex(
        referenceConfig.roles,
        (item) => item.code,
        'role code',
      ),
    },
  };

  indexes.onboardingById = indexes.onboardingRecords.byId;
  indexes.onboardingByApplicationId =
    indexes.onboardingRecords.byApplicationId;
  indexes.onboardingByTrackingId =
    indexes.onboardingRecords.byTrackingId;
  indexes.workItemsById = indexes.workItems.byId;
  indexes.lifecycleEventsById = indexes.lifecycleEvents.byId;
  indexes.usersById = indexes.users.byId;
  indexes.providersByCode = indexes.providers.byCode;
  indexes.intakeSamplesById = indexes.intakeSamples.byId;

  return deepFreeze(indexes);
}

/**
 * Validates a complete fixture bundle.
 *
 * @param {Record<string, unknown>} [fixtures] Fixture bundle.
 * @returns {Record<string, unknown>} Parsed fixture bundle.
 */
export function validateFixtures(fixtures = RAW_FIXTURES) {
  const fixtureBundle = assertFixtureBundle(fixtures);

  return {
    historicalAssets: parseFixture(
      'historical assets',
      FIXTURE_SCHEMAS.historicalAssets,
      fixtureBundle.historicalAssets,
    ),
    intakeSamples: parseFixture(
      'intake samples',
      FIXTURE_SCHEMAS.intakeSamples,
      fixtureBundle.intakeSamples,
    ),
    onboardingRecords: parseFixture(
      'onboarding records',
      FIXTURE_SCHEMAS.onboardingRecords,
      fixtureBundle.onboardingRecords,
    ),
    operationsData: parseFixture(
      'operations data',
      FIXTURE_SCHEMAS.operationsData,
      fixtureBundle.operationsData,
    ),
    providerResponses: parseFixture(
      'provider responses',
      FIXTURE_SCHEMAS.providerResponses,
      fixtureBundle.providerResponses,
    ),
    referenceConfig: parseFixture(
      'reference configuration',
      FIXTURE_SCHEMAS.referenceConfig,
      fixtureBundle.referenceConfig,
    ),
    users: parseFixture(
      'users',
      FIXTURE_SCHEMAS.users,
      fixtureBundle.users,
    ),
  };
}

/**
 * Loads, validates, indexes, and freezes all fixture seeds.
 *
 * @param {Record<string, unknown>} [fixtures] Fixture bundle.
 * @returns {Readonly<Record<string, unknown>>} Immutable seed data.
 */
export function loadSeeds(fixtures = RAW_FIXTURES) {
  const validatedFixtures = validateFixtures(fixtures);
  const immutableFixtures = deepFreeze(validatedFixtures);
  const operations = immutableFixtures.operationsData;
  const historical = immutableFixtures.historicalAssets;
  const providers = immutableFixtures.providerResponses.providers;
  const indexes = buildFixtureIndexes(immutableFixtures);

  return deepFreeze({
    fixtures: immutableFixtures,
    intakeSamples: immutableFixtures.intakeSamples.samples,
    onboardingRecords: immutableFixtures.onboardingRecords.records,
    workItems: operations.workItems,
    assignments: operations.assignments,
    lifecycleEvents: operations.lifecycleEvents,
    notificationLogs: operations.notificationLogs,
    notifications: operations.notificationLogs,
    syncAttempts: operations.syncAttempts,
    contractChanges: operations.contractChanges,
    providerDefinitions: providers,
    providers,
    referenceConfig: immutableFixtures.referenceConfig,
    users: immutableFixtures.users,
    historicalAssets: historical,
    historicalContracts: historical.contracts,
    terminations: historical.terminations,
    backgroundChecks: historical.backgroundChecks,
    appointments: historical.appointments,
    licenses: historical.licenses,
    uplines: historical.uplines,
    historicalAssignees: historical.assignees,
    generatedCodes: historical.generatedCodes,
    indexes,
  });
}

let activeSeeds = loadSeeds();

/**
 * Returns the active immutable fixture seeds.
 *
 * @returns {Readonly<Record<string, unknown>>} Active seeds.
 */
export function getSeeds() {
  return activeSeeds;
}

/**
 * Rebuilds the active immutable fixture seeds from pristine fixtures.
 *
 * @param {Record<string, unknown>} [fixtures] Optional replacement fixtures.
 * @returns {Readonly<Record<string, unknown>>} Reset seeds.
 */
export function resetSeeds(fixtures = RAW_FIXTURES) {
  activeSeeds = loadSeeds(fixtures);
  return activeSeeds;
}

/**
 * Looks up a record in an immutable seed index.
 *
 * @param {Record<string, unknown>} index Seed index.
 * @param {string | number} identifier Record identifier.
 * @returns {unknown | undefined} Matching record.
 */
export function findSeedByIdentifier(index, identifier) {
  if (!index || typeof index !== 'object' || Array.isArray(index)) {
    throw new TypeError('A valid seed index is required.');
  }

  if (
    identifier === null ||
    identifier === undefined ||
    String(identifier).trim() === ''
  ) {
    return undefined;
  }

  return index[String(identifier)];
}

export const loadFixtureSeeds = loadSeeds;
export const loadAndValidateFixtures = loadSeeds;
export const getFixtureSeeds = getSeeds;
export const resetFixtureSeeds = resetSeeds;
export const INITIAL_SEEDS = activeSeeds;

const seedLoader = Object.freeze({
  findSeedByIdentifier,
  get seeds() {
    return getSeeds();
  },
  getSeeds,
  loadSeeds,
  resetSeeds,
  validateFixtures,
});

export default seedLoader;