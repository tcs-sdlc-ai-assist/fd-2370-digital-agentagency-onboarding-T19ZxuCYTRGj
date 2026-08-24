import { z } from 'zod';
import {
  AUDIT_ACTOR_TYPES,
  AUDIT_SOURCES,
  INTEGRATION_SYSTEMS,
  LIFECYCLE_STATUSES,
  ONBOARDING_STATUSES,
  PRIORITIES,
  PROVIDER_CODES,
  SOURCE_CHANNELS,
  SOURCE_FORMATS,
  WORKFLOW_STAGES,
  WORK_ITEM_STATES,
  WORK_ITEM_TYPES,
} from '../constants/domain.js';
import {
  ALL_ROLES,
  PARTNER_SCOPE_TYPES,
  PERMISSIONS,
} from '../constants/roles.js';

const enumValues = (values) => z.enum(Object.values(values));

export const identifierSchema = z.string().trim().min(1);
export const nullableIdentifierSchema = identifierSchema.nullable();
export const emailSchema = z.string().trim().email();
export const phoneSchema = z.string().trim().min(7).max(32);
export const stateCodeSchema = z.string().trim().regex(/^[A-Z]{2}$/);
export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected an ISO date.');
export const dateTimeSchema = z.string().datetime({ offset: true });
export const nullableDateSchema = dateSchema.nullable();
export const nullableDateTimeSchema = dateTimeSchema.nullable();
export const validationCodeSchema = identifierSchema;
export const validationCodesSchema = z.array(validationCodeSchema);
export const metadataSchema = z.record(z.unknown());

export const sourceChannelSchema = enumValues(SOURCE_CHANNELS);
export const sourceFormatSchema = enumValues(SOURCE_FORMATS);
export const lifecycleStatusSchema = enumValues(LIFECYCLE_STATUSES);
export const workflowStageSchema = enumValues(WORKFLOW_STAGES);
export const onboardingStatusSchema = enumValues(ONBOARDING_STATUSES);
export const prioritySchema = enumValues(PRIORITIES);
export const workItemTypeSchema = enumValues(WORK_ITEM_TYPES);
export const workItemStateSchema = enumValues(WORK_ITEM_STATES);
export const auditSourceSchema = enumValues(AUDIT_SOURCES);
export const auditActorTypeSchema = enumValues(AUDIT_ACTOR_TYPES);
export const integrationSystemSchema = enumValues(INTEGRATION_SYSTEMS);
export const providerCodeSchema = enumValues(PROVIDER_CODES);
export const roleSchema = z.enum(ALL_ROLES);
export const permissionSchema = enumValues(PERMISSIONS);
export const partnerScopeTypeSchema = enumValues(PARTNER_SCOPE_TYPES);

export const addressSchema = z
  .object({
    line1: z.string().trim().min(1),
    line2: z.string().trim().min(1).nullable().optional(),
    city: z.string().trim().min(1),
    state: stateCodeSchema,
    postalCode: z.string().trim().min(3).max(16),
    country: z.string().trim().length(2).default('US'),
  })
  .passthrough();

export const individualIdentitySchema = z
  .object({
    type: z.literal('individual'),
    firstName: z.string().trim().min(1),
    middleName: z.string().trim().min(1).nullable().optional(),
    lastName: z.string().trim().min(1),
    email: emailSchema.optional(),
    phone: phoneSchema.optional(),
    npn: identifierSchema.optional(),
    crd: identifierSchema.optional(),
    residenceState: stateCodeSchema.optional(),
    dateOfBirth: dateSchema.optional(),
    taxIdLast4: z.string().regex(/^\d{4}$/).optional(),
    address: addressSchema.optional(),
  })
  .passthrough();

export const organizationIdentitySchema = z
  .object({
    type: z.literal('organization'),
    legalName: z.string().trim().min(1),
    email: emailSchema.optional(),
    phone: phoneSchema.optional(),
    contactFirstName: z.string().trim().min(1).optional(),
    contactLastName: z.string().trim().min(1).optional(),
    stateOfFormation: stateCodeSchema.optional(),
    taxIdLast4: z.string().regex(/^\d{4}$/).optional(),
    npn: identifierSchema.nullable().optional(),
    address: addressSchema.optional(),
  })
  .passthrough();

export const identitySchema = z.union([
  individualIdentitySchema,
  organizationIdentitySchema,
]);

export const principalSchema = z
  .object({
    firstName: z.string().trim().min(1),
    lastName: z.string().trim().min(1),
    email: emailSchema.optional(),
    phone: phoneSchema.optional(),
    ownershipPercent: z.number().min(0).max(100).optional(),
    npn: identifierSchema.nullable().optional(),
    isLicensedEligible: z.boolean().optional(),
  })
  .passthrough();

export const agencySchema = z
  .object({
    name: z.string().trim().min(1),
    type: identifierSchema,
    code: identifierSchema.optional(),
  })
  .passthrough();

export const contractSchema = z
  .object({
    type: identifierSchema,
    level: z.union([identifierSchema, z.number().int().nonnegative()]),
    commissionSchedule: identifierSchema,
    advanceCommission: z.boolean(),
    status: identifierSchema,
    contractNumber: identifierSchema.optional(),
    effectiveDate: nullableDateSchema.optional(),
    terminationDate: nullableDateSchema.optional(),
    terminationReason: identifierSchema.nullable().optional(),
  })
  .passthrough();

export const licensingSchema = z
  .object({
    residentState: stateCodeSchema.nullable().optional(),
    licenseNumber: identifierSchema.nullable().optional(),
    linesOfAuthority: z.array(identifierSchema),
  })
  .passthrough();

export const backgroundSchema = z
  .object({
    required: z.boolean(),
    status: identifierSchema,
    providerCode: identifierSchema.nullable().optional(),
    referenceId: identifierSchema.optional(),
    reason: identifierSchema.optional(),
    initiatedAt: dateTimeSchema.optional(),
    completedAt: nullableDateTimeSchema.optional(),
  })
  .passthrough();

export const appointmentSchema = z
  .object({
    required: z.boolean(),
    status: identifierSchema,
    providerCode: identifierSchema.nullable().optional(),
    referenceId: identifierSchema.optional(),
    states: z.array(stateCodeSchema),
    submittedAt: dateTimeSchema.optional(),
    completedAt: nullableDateTimeSchema.optional(),
  })
  .passthrough();

export const documentSummarySchema = z
  .object({
    status: identifierSchema,
    required: z.number().int().nonnegative(),
    received: z.number().int().nonnegative(),
    accepted: z.number().int().nonnegative(),
  })
  .refine(
    ({ accepted, received }) => accepted <= received,
    'Accepted documents cannot exceed received documents.',
  )
  .passthrough();

export const progressSchema = z
  .object({
    percentComplete: z.number().min(0).max(100),
    currentStep: identifierSchema,
    missingFields: z.array(identifierSchema),
  })
  .passthrough();

export const assignmentSchema = z
  .object({
    team: identifierSchema.nullable(),
    assigneeUserId: identifierSchema.nullable(),
  })
  .passthrough();

export const exceptionSchema = z
  .object({
    code: validationCodeSchema,
    category: identifierSchema,
    severity: identifierSchema,
    status: identifierSchema,
    message: z.string().trim().min(1),
    createdAt: dateTimeSchema,
    resolvedAt: nullableDateTimeSchema,
  })
  .passthrough();

export const onboardingRecordSchema = z
  .object({
    id: identifierSchema,
    applicationId: identifierSchema,
    trackingId: identifierSchema,
    scenario: identifierSchema.optional(),
    journeyType: identifierSchema,
    requestType: identifierSchema,
    status: onboardingStatusSchema,
    workflowStage: workflowStageSchema,
    priority: prioritySchema,
    sourceChannel: sourceChannelSchema,
    sourceFormat: sourceFormatSchema,
    partnerCode: identifierSchema,
    company: identifierSchema,
    carrierCode: identifierSchema,
    gaCode: identifierSchema,
    agency: agencySchema,
    contract: contractSchema,
    applicant: identitySchema,
    principals: z.array(principalSchema).optional(),
    licensing: licensingSchema,
    background: backgroundSchema,
    appointment: appointmentSchema,
    documents: documentSummarySchema,
    progress: progressSchema,
    assignment: assignmentSchema,
    exceptions: z.array(exceptionSchema),
    duplicateOfApplicationId: nullableIdentifierSchema,
    submittedAt: nullableDateTimeSchema,
    completedAt: nullableDateTimeSchema,
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
  })
  .passthrough();

export const onboardingRecordsSchema = z.array(onboardingRecordSchema);

export const onboardingDraftSchema = z
  .object({
    id: identifierSchema.optional(),
    applicationId: identifierSchema.optional(),
    trackingId: identifierSchema.optional(),
    journeyType: identifierSchema.optional(),
    requestType: identifierSchema.optional(),
    status: z.literal(ONBOARDING_STATUSES.DRAFT).default(
      ONBOARDING_STATUSES.DRAFT,
    ),
    workflowStage: z
      .union([
        z.literal(WORKFLOW_STAGES.NEW),
        z.literal(WORKFLOW_STAGES.APPLICATION_STARTED),
      ])
      .default(WORKFLOW_STAGES.APPLICATION_STARTED),
    priority: prioritySchema.default(PRIORITIES.NORMAL),
    sourceChannel: sourceChannelSchema.optional(),
    sourceFormat: sourceFormatSchema.optional(),
    partnerCode: identifierSchema.optional(),
    company: identifierSchema.optional(),
    carrierCode: identifierSchema.optional(),
    gaCode: identifierSchema.optional(),
    agency: agencySchema.partial().optional(),
    contract: contractSchema.partial().optional(),
    applicant: z
      .union([
        individualIdentitySchema.partial(),
        organizationIdentitySchema.partial(),
      ])
      .optional(),
    principals: z.array(principalSchema.partial()).optional(),
    licensing: licensingSchema.partial().optional(),
    background: backgroundSchema.partial().optional(),
    appointment: appointmentSchema.partial().optional(),
    documents: documentSummarySchema.optional(),
    progress: progressSchema.optional(),
    assignment: assignmentSchema.optional(),
    exceptions: z.array(exceptionSchema).default([]),
    createdAt: dateTimeSchema.optional(),
    updatedAt: dateTimeSchema.optional(),
  })
  .passthrough();

export const validationIssueSchema = z
  .object({
    code: validationCodeSchema,
    path: z.array(z.union([z.string(), z.number().int()])).default([]),
    message: z.string().trim().min(1),
    severity: z.enum(['info', 'warning', 'error', 'blocking']).default('error'),
    field: identifierSchema.optional(),
    metadata: metadataSchema.optional(),
  })
  .passthrough();

export const validationResultSchema = z
  .object({
    valid: z.boolean(),
    issues: z.array(validationIssueSchema).default([]),
    validationCodes: validationCodesSchema.default([]),
    manualReviewRequired: z.boolean().default(false),
    checkedAt: dateTimeSchema.optional(),
  })
  .superRefine(({ issues, valid }, context) => {
    if (valid && issues.some((issue) => issue.severity === 'blocking')) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A valid result cannot contain blocking issues.',
        path: ['issues'],
      });
    }
  })
  .passthrough();

export const providerRequestSchema = z
  .object({
    providerCode: identifierSchema,
    scenario: identifierSchema.optional(),
    correlationId: identifierSchema.optional(),
    payload: metadataSchema.default({}),
    requestedAt: dateTimeSchema.optional(),
  })
  .passthrough();

export const providerResponseSchema = z
  .object({
    outcome: identifierSchema,
    httpStatus: z.number().int().min(100).max(599),
    response: metadataSchema,
    latencyMs: z.number().int().nonnegative().optional(),
    validationCodes: validationCodesSchema.optional(),
    receivedAt: dateTimeSchema.optional(),
  })
  .passthrough();

export const providerCheckSchema = z
  .object({
    checkId: identifierSchema,
    providerCode: identifierSchema,
    service: identifierSchema,
    scenario: identifierSchema.optional(),
    status: identifierSchema,
    outcome: identifierSchema.optional(),
    httpStatus: z.number().int().min(100).max(599).optional(),
    request: metadataSchema.default({}),
    response: metadataSchema.nullable().optional(),
    correlationId: identifierSchema.optional(),
    manualReviewRequired: z.boolean().default(false),
    validationCodes: validationCodesSchema.default([]),
    requestedAt: dateTimeSchema,
    completedAt: nullableDateTimeSchema,
  })
  .passthrough();

export const providerScenarioSchema = z
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

export const providerDefinitionSchema = z
  .object({
    code: identifierSchema,
    name: z.string().trim().min(1),
    service: identifierSchema,
    defaultScenario: identifierSchema,
    scenarios: z.array(providerScenarioSchema).min(1),
  })
  .passthrough();

export const workItemHistorySchema = z
  .object({
    previousState: workItemStateSchema.nullable(),
    currentState: workItemStateSchema,
    actorType: auditActorTypeSchema,
    actorId: identifierSchema,
    comment: z.string().trim().min(1),
    timestamp: dateTimeSchema,
  })
  .passthrough();

export const workItemSchema = z
  .object({
    workItemId: identifierSchema,
    trackingId: nullableIdentifierSchema,
    sourceRecordId: identifierSchema,
    cardType: workItemTypeSchema,
    state: workItemStateSchema,
    priority: prioritySchema,
    assignedTo: nullableIdentifierSchema,
    assignedGroup: identifierSchema,
    partnerCode: identifierSchema,
    title: z.string().trim().min(1),
    summary: z.string().trim().min(1),
    metadata: metadataSchema,
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    completedAt: nullableDateTimeSchema,
    history: z.array(workItemHistorySchema),
  })
  .passthrough();

export const workItemsSchema = z.array(workItemSchema);

export const auditEventSchema = z
  .object({
    auditEventId: identifierSchema.optional(),
    lifecycleEventId: identifierSchema.optional(),
    trackingId: nullableIdentifierSchema,
    applicationId: identifierSchema.optional(),
    status: z.string().trim().min(1).optional(),
    workflowStage: workflowStageSchema.optional(),
    actorType: auditActorTypeSchema,
    actorId: identifierSchema,
    source: auditSourceSchema,
    action: identifierSchema.optional(),
    summary: z.string().trim().min(1),
    metadata: metadataSchema.optional(),
    timestamp: dateTimeSchema,
  })
  .refine(
    ({ auditEventId, lifecycleEventId }) =>
      Boolean(auditEventId || lifecycleEventId),
    {
      message: 'An audit or lifecycle event identifier is required.',
      path: ['auditEventId'],
    },
  )
  .passthrough();

export const auditEventsSchema = z.array(auditEventSchema);
export const lifecycleEventSchema = auditEventSchema;
export const lifecycleEventsSchema = auditEventsSchema;

export const syncAttemptStatusSchema = z.enum([
  'queued',
  'pending',
  'success',
  'failed',
  'skipped',
  'cancelled',
]);

export const syncAttemptSchema = z
  .object({
    syncAttemptId: identifierSchema,
    trackingId: nullableIdentifierSchema,
    system: integrationSystemSchema,
    operation: identifierSchema,
    status: syncAttemptStatusSchema,
    correlationId: identifierSchema,
    message: z.string().trim().min(1),
    payloadSummary: metadataSchema,
    attemptedAt: dateTimeSchema,
    resolvedAt: nullableDateTimeSchema,
  })
  .passthrough();

export const syncAttemptsSchema = z.array(syncAttemptSchema);

export const notificationChannelSchema = z.enum([
  'email',
  'in_app',
  'sms',
  'push',
]);

export const notificationStatusSchema = z.enum([
  'previewed',
  'queued',
  'sent',
  'delivered',
  'failed',
  'suppressed',
  'read',
]);

export const notificationSchema = z
  .object({
    notificationId: identifierSchema,
    trackingId: nullableIdentifierSchema,
    partnerCode: identifierSchema,
    channel: notificationChannelSchema,
    type: identifierSchema,
    recipientMasked: z.string().trim().min(1),
    templateCode: identifierSchema,
    previewPayload: metadataSchema,
    status: notificationStatusSchema,
    createdAt: dateTimeSchema,
    sentAt: nullableDateTimeSchema.optional(),
    failureReason: z.string().trim().min(1).nullable().optional(),
  })
  .passthrough();

export const notificationsSchema = z.array(notificationSchema);
export const notificationLogSchema = notificationSchema;
export const notificationLogsSchema = notificationsSchema;

export const assignmentRecordSchema = z
  .object({
    assignmentId: identifierSchema,
    workItemId: identifierSchema,
    trackingId: nullableIdentifierSchema,
    assignedTo: nullableIdentifierSchema,
    assignedGroup: identifierSchema,
    assignedBy: identifierSchema,
    assignmentReason: identifierSchema,
    status: z.enum(['active', 'released']),
    assignedAt: dateTimeSchema,
    releasedAt: nullableDateTimeSchema,
  })
  .passthrough();

export const changeRequestSchema = z
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

export const changeRequestsSchema = z.array(changeRequestSchema);
export const contractChangeSchema = changeRequestSchema;
export const contractChangesSchema = changeRequestsSchema;

export const referenceItemSchema = z
  .object({
    id: identifierSchema,
    code: identifierSchema,
    name: z.string().trim().min(1),
    description: z.string().trim().min(1).optional(),
    status: identifierSchema,
  })
  .passthrough();

export const statusOptionSchema = z
  .object({
    code: identifierSchema,
    name: z.string().trim().min(1),
  })
  .passthrough();

export const notificationChannelDefaultsSchema = z
  .object({
    enabled: z.boolean(),
  })
  .catchall(z.boolean());

export const quietHoursSchema = z
  .object({
    enabled: z.boolean(),
    start: z.string().regex(/^\d{2}:\d{2}$/),
    end: z.string().regex(/^\d{2}:\d{2}$/),
    timeZone: identifierSchema,
  })
  .passthrough();

export const notificationDefaultsSchema = z
  .object({
    email: notificationChannelDefaultsSchema,
    inApp: notificationChannelDefaultsSchema,
    sms: notificationChannelDefaultsSchema,
    digestFrequency: identifierSchema,
    quietHours: quietHoursSchema,
  })
  .passthrough();

export const referenceConfigurationSchema = z
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
    notificationDefaults: notificationDefaultsSchema,
  })
  .passthrough();

export const applicationConfigurationSchema = z
  .object({
    appEnv: z.enum(['development', 'test', 'staging', 'production']),
    enableDiagnostics: z.boolean(),
    persistenceSchemaVersion: z.number().int().positive(),
  })
  .passthrough();

export const userSchema = z
  .object({
    id: identifierSchema,
    email: emailSchema,
    firstName: z.string().trim().min(1),
    lastName: z.string().trim().min(1),
    role: roleSchema,
    organization: z.string().trim().min(1),
    status: z.enum(['invited', 'active', 'inactive', 'suspended']),
  })
  .passthrough();

export const usersSchema = z.array(userSchema);

export const storageEnvelopeSchema = z
  .object({
    schemaVersion: z.number().int().positive(),
    savedAt: dateTimeSchema,
    data: z.unknown(),
  })
  .passthrough();

/**
 * Creates a versioned storage envelope schema for a specific payload.
 *
 * @param {z.ZodTypeAny} dataSchema Schema used to validate envelope data.
 * @returns {z.ZodObject} Storage envelope schema.
 */
export function createStorageEnvelopeSchema(dataSchema) {
  if (
    !dataSchema ||
    typeof dataSchema.parse !== 'function' ||
    typeof dataSchema.safeParse !== 'function'
  ) {
    throw new TypeError('A valid Zod data schema is required.');
  }

  return z
    .object({
      schemaVersion: z.number().int().positive(),
      savedAt: dateTimeSchema,
      data: dataSchema,
    })
    .passthrough();
}

/**
 * Parses a value with a canonical runtime contract.
 *
 * @param {z.ZodTypeAny} schema Schema used to validate the value.
 * @param {unknown} value Value to validate.
 * @param {string} contractName Human-readable contract name.
 * @returns {unknown} Parsed contract value.
 * @throws {TypeError} When the supplied schema is invalid.
 * @throws {Error} When the value does not satisfy the contract.
 */
export function parseContract(schema, value, contractName = 'runtime contract') {
  if (
    !schema ||
    typeof schema.parse !== 'function' ||
    typeof schema.safeParse !== 'function'
  ) {
    throw new TypeError('A valid Zod schema is required.');
  }

  const result = schema.safeParse(value);

  if (!result.success) {
    const issueSummary = result.error.issues
      .map((issue) => {
        const path = issue.path.length > 0 ? issue.path.join('.') : 'value';
        return `${path}: ${issue.message}`;
      })
      .join('; ');

    throw new Error(`Invalid ${contractName}: ${issueSummary}`, {
      cause: result.error,
    });
  }

  return result.data;
}

export const SCHEMAS = Object.freeze({
  address: addressSchema,
  applicationConfiguration: applicationConfigurationSchema,
  assignment: assignmentSchema,
  assignmentRecord: assignmentRecordSchema,
  auditEvent: auditEventSchema,
  background: backgroundSchema,
  changeRequest: changeRequestSchema,
  contract: contractSchema,
  identity: identitySchema,
  individualIdentity: individualIdentitySchema,
  licensing: licensingSchema,
  notification: notificationSchema,
  onboardingDraft: onboardingDraftSchema,
  onboardingRecord: onboardingRecordSchema,
  organizationIdentity: organizationIdentitySchema,
  principal: principalSchema,
  providerCheck: providerCheckSchema,
  providerDefinition: providerDefinitionSchema,
  providerRequest: providerRequestSchema,
  providerResponse: providerResponseSchema,
  referenceConfiguration: referenceConfigurationSchema,
  storageEnvelope: storageEnvelopeSchema,
  syncAttempt: syncAttemptSchema,
  user: userSchema,
  validationIssue: validationIssueSchema,
  validationResult: validationResultSchema,
  workItem: workItemSchema,
});

export default SCHEMAS;