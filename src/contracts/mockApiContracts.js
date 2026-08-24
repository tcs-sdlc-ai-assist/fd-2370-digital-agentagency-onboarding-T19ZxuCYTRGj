import { z } from 'zod';
import {
  applicationConfigurationSchema,
  assignmentRecordSchema,
  auditEventsSchema,
  changeRequestSchema,
  changeRequestsSchema,
  notificationSchema,
  notificationsSchema,
  onboardingDraftSchema,
  onboardingRecordSchema,
  onboardingRecordsSchema,
  providerCheckSchema,
  providerRequestSchema,
  providerResponseSchema,
  referenceConfigurationSchema,
  syncAttemptSchema,
  syncAttemptsSchema,
  userSchema,
  usersSchema,
  validationResultSchema,
  workItemSchema,
  workItemsSchema,
} from './schemas.js';

export const HTTP_METHODS = Object.freeze({
  GET: 'GET',
  POST: 'POST',
  PUT: 'PUT',
  PATCH: 'PATCH',
  DELETE: 'DELETE',
});

export const MOCK_API_PATHS = Object.freeze({
  INTAKE: '/api/intake',
  ONBOARDING: '/api/onboarding',
  ONBOARDING_DETAIL: '/api/onboarding/:applicationId',
  ONBOARDING_DRAFTS: '/api/onboarding/drafts',
  ONBOARDING_DRAFT_DETAIL: '/api/onboarding/drafts/:draftId',
  ONBOARDING_SUBMIT: '/api/onboarding/:applicationId/submit',
  ONBOARDING_VALIDATE: '/api/onboarding/:applicationId/validate',
  PROVIDER_CHECKS: '/api/provider-checks',
  PROVIDER_CHECK_DETAIL: '/api/provider-checks/:checkId',
  WORK_ITEMS: '/api/operations/work-items',
  WORK_ITEM_DETAIL: '/api/operations/work-items/:workItemId',
  WORK_ITEM_ASSIGNMENT: '/api/operations/work-items/:workItemId/assignment',
  LIFECYCLE_EVENTS: '/api/onboarding/:applicationId/lifecycle-events',
  NOTIFICATIONS: '/api/notifications',
  NOTIFICATION_DETAIL: '/api/notifications/:notificationId',
  SYNC_ATTEMPTS: '/api/operations/sync-attempts',
  SYNC_ATTEMPT_DETAIL: '/api/operations/sync-attempts/:syncAttemptId',
  CONTRACT_CHANGES: '/api/operations/contract-changes',
  CONTRACT_CHANGE_DETAIL:
    '/api/operations/contract-changes/:changeRequestId',
  REFERENCE_CONFIGURATION: '/api/admin/reference-configuration',
  USERS: '/api/admin/users',
  USER_DETAIL: '/api/admin/users/:userId',
  APPLICATION_CONFIGURATION: '/api/admin/application-configuration',
});

export const mockApiErrorSchema = z
  .object({
    code: z.string().trim().min(1),
    message: z.string().trim().min(1),
    status: z.number().int().min(400).max(599),
    details: z.unknown().optional(),
  })
  .passthrough();

export const mockApiResponseSchema = z
  .object({
    status: z.number().int().min(100).max(599),
    headers: z.record(z.string()),
    body: z.unknown(),
  })
  .passthrough();

const emptyObjectSchema = z.object({}).passthrough();
const identifierParameterSchema = z.string().trim().min(1);
const optionalIdentifierQuerySchema = z.string().trim().min(1).optional();
const optionalBooleanQuerySchema = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true')
  .optional();
const optionalPositiveIntegerQuerySchema = z.coerce
  .number()
  .int()
  .positive()
  .optional();
const optionalNonnegativeIntegerQuerySchema = z.coerce
  .number()
  .int()
  .nonnegative()
  .optional();

const paginationQuerySchema = z
  .object({
    limit: optionalPositiveIntegerQuerySchema,
    offset: optionalNonnegativeIntegerQuerySchema,
  })
  .passthrough();

const applicationParamsSchema = z.object({
  applicationId: identifierParameterSchema,
});

const draftParamsSchema = z.object({
  draftId: identifierParameterSchema,
});

const checkParamsSchema = z.object({
  checkId: identifierParameterSchema,
});

const workItemParamsSchema = z.object({
  workItemId: identifierParameterSchema,
});

const notificationParamsSchema = z.object({
  notificationId: identifierParameterSchema,
});

const syncAttemptParamsSchema = z.object({
  syncAttemptId: identifierParameterSchema,
});

const changeRequestParamsSchema = z.object({
  changeRequestId: identifierParameterSchema,
});

const userParamsSchema = z.object({
  userId: identifierParameterSchema,
});

const intakeRequestSchema = z
  .object({
    sourceChannel: z.string().trim().min(1),
    sourceFormat: z.string().trim().min(1),
    partnerCode: z.string().trim().min(1),
    rawContent: z.string(),
    fileName: z.string().nullable().optional(),
    mimeType: z.string().nullable().optional(),
    bulk: z.boolean().default(false),
    simulateScenario: z.string().trim().min(1).optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .passthrough();

const intakeResponseSchema = z
  .object({
    intakeId: identifierParameterSchema,
    status: z.string().trim().min(1),
    completenessStatus: z.string().trim().min(1),
    nextAction: z.string().trim().min(1),
    trackingId: identifierParameterSchema.nullable().optional(),
    applicationId: identifierParameterSchema.nullable().optional(),
    validationCodes: z.array(identifierParameterSchema).default([]),
  })
  .passthrough();

const onboardingQuerySchema = paginationQuerySchema
  .extend({
    partnerCode: optionalIdentifierQuerySchema,
    status: optionalIdentifierQuerySchema,
    workflowStage: optionalIdentifierQuerySchema,
    assignedTo: optionalIdentifierQuerySchema,
    includeCompleted: optionalBooleanQuerySchema,
  })
  .passthrough();

const workItemQuerySchema = paginationQuerySchema
  .extend({
    assignedTo: optionalIdentifierQuerySchema,
    assignedGroup: optionalIdentifierQuerySchema,
    cardType: optionalIdentifierQuerySchema,
    state: optionalIdentifierQuerySchema,
    priority: optionalIdentifierQuerySchema,
    partnerCode: optionalIdentifierQuerySchema,
  })
  .passthrough();

const notificationQuerySchema = paginationQuerySchema
  .extend({
    trackingId: optionalIdentifierQuerySchema,
    partnerCode: optionalIdentifierQuerySchema,
    channel: optionalIdentifierQuerySchema,
    status: optionalIdentifierQuerySchema,
  })
  .passthrough();

const syncAttemptQuerySchema = paginationQuerySchema
  .extend({
    trackingId: optionalIdentifierQuerySchema,
    system: optionalIdentifierQuerySchema,
    status: optionalIdentifierQuerySchema,
  })
  .passthrough();

const contractChangeQuerySchema = paginationQuerySchema
  .extend({
    trackingId: optionalIdentifierQuerySchema,
    partnerCode: optionalIdentifierQuerySchema,
    changeType: optionalIdentifierQuerySchema,
    status: optionalIdentifierQuerySchema,
  })
  .passthrough();

const userQuerySchema = paginationQuerySchema
  .extend({
    role: optionalIdentifierQuerySchema,
    status: optionalIdentifierQuerySchema,
    organization: optionalIdentifierQuerySchema,
  })
  .passthrough();

const submitRequestSchema = z
  .object({
    submittedBy: identifierParameterSchema,
    expectedUpdatedAt: z.string().datetime({ offset: true }).optional(),
  })
  .passthrough();

const validationRequestSchema = z
  .object({
    includeProviders: z.boolean().default(false),
    providerScenarios: z.record(identifierParameterSchema).optional(),
  })
  .passthrough();

const workItemUpdateSchema = workItemSchema
  .pick({
    state: true,
    priority: true,
    assignedTo: true,
    assignedGroup: true,
  })
  .partial()
  .extend({
    comment: z.string().trim().min(1),
    actorId: identifierParameterSchema,
  })
  .passthrough();

const assignmentRequestSchema = z
  .object({
    assignedTo: identifierParameterSchema.nullable(),
    assignedGroup: identifierParameterSchema,
    assignedBy: identifierParameterSchema,
    assignmentReason: identifierParameterSchema,
  })
  .passthrough();

const notificationUpdateSchema = z
  .object({
    status: z.enum([
      'previewed',
      'queued',
      'sent',
      'delivered',
      'failed',
      'suppressed',
      'read',
    ]),
    failureReason: z.string().trim().min(1).nullable().optional(),
    sentAt: z.string().datetime({ offset: true }).nullable().optional(),
  })
  .passthrough();

const referenceConfigurationUpdateSchema =
  referenceConfigurationSchema.deepPartial();

const applicationConfigurationUpdateSchema =
  applicationConfigurationSchema.partial();

const userUpdateSchema = userSchema
  .pick({
    firstName: true,
    lastName: true,
    role: true,
    organization: true,
    status: true,
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one user field must be supplied.',
  });

/**
 * Creates a successful mock API response.
 *
 * @param {unknown} body Response body.
 * @param {number} status HTTP response status.
 * @param {Record<string, string>} headers Additional response headers.
 * @returns {{status: number, headers: Record<string, string>, body: unknown}}
 * Mock response.
 */
export function createMockApiResponse(
  body,
  status = 200,
  headers = {},
) {
  if (!Number.isInteger(status) || status < 100 || status > 599) {
    throw new RangeError('A valid HTTP response status is required.');
  }

  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) {
    throw new TypeError('Response headers must be an object.');
  }

  return {
    status,
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    body,
  };
}

/**
 * Creates a normalized mock API error response.
 *
 * @param {number} status HTTP error status.
 * @param {string} code Stable error code.
 * @param {string} message Human-readable error message.
 * @param {unknown} details Optional error details.
 * @returns {{status: number, headers: Record<string, string>, body: unknown}}
 * Mock error response.
 */
export function createMockApiErrorResponse(
  status,
  code,
  message,
  details,
) {
  const body = mockApiErrorSchema.parse({
    status,
    code,
    message,
    ...(details === undefined ? {} : { details }),
  });

  return createMockApiResponse(body, status);
}

function createResponseBuilder(responseSchema, defaultStatus) {
  return (body, options = {}) => {
    const status = options.status ?? defaultStatus;
    const headers = options.headers ?? {};
    const parsedBody = responseSchema.parse(body);

    return createMockApiResponse(parsedBody, status, headers);
  };
}

function createErrorResponseBuilder() {
  return (code, message, options = {}) =>
    createMockApiErrorResponse(
      options.status ?? 400,
      code,
      message,
      options.details,
    );
}

function createContract({
  id,
  story,
  method,
  path,
  paramsSchema = emptyObjectSchema,
  querySchema = emptyObjectSchema,
  bodySchema = emptyObjectSchema,
  responseSchema = z.unknown(),
  successStatus = 200,
}) {
  const requestSchema = z.object({
    params: paramsSchema.default({}),
    query: querySchema.default({}),
    body: bodySchema,
  });

  return Object.freeze({
    id,
    story,
    method,
    path,
    pathTemplate: path,
    requestSchema,
    paramsSchema,
    querySchema,
    bodySchema,
    responseSchema,
    buildResponse: createResponseBuilder(responseSchema, successStatus),
    buildErrorResponse: createErrorResponseBuilder(),
  });
}

export const MOCK_API_CONTRACTS = Object.freeze([
  createContract({
    id: 'submitIntake',
    story: 'SCRUM-1332',
    method: HTTP_METHODS.POST,
    path: MOCK_API_PATHS.INTAKE,
    bodySchema: intakeRequestSchema,
    responseSchema: intakeResponseSchema,
    successStatus: 201,
  }),
  createContract({
    id: 'listOnboarding',
    story: 'SCRUM-1333',
    method: HTTP_METHODS.GET,
    path: MOCK_API_PATHS.ONBOARDING,
    querySchema: onboardingQuerySchema,
    responseSchema: onboardingRecordsSchema,
  }),
  createContract({
    id: 'getOnboarding',
    story: 'SCRUM-1333',
    method: HTTP_METHODS.GET,
    path: MOCK_API_PATHS.ONBOARDING_DETAIL,
    paramsSchema: applicationParamsSchema,
    responseSchema: onboardingRecordSchema,
  }),
  createContract({
    id: 'createOnboardingDraft',
    story: 'SCRUM-1334',
    method: HTTP_METHODS.POST,
    path: MOCK_API_PATHS.ONBOARDING_DRAFTS,
    bodySchema: onboardingDraftSchema,
    responseSchema: onboardingDraftSchema,
    successStatus: 201,
  }),
  createContract({
    id: 'getOnboardingDraft',
    story: 'SCRUM-1334',
    method: HTTP_METHODS.GET,
    path: MOCK_API_PATHS.ONBOARDING_DRAFT_DETAIL,
    paramsSchema: draftParamsSchema,
    responseSchema: onboardingDraftSchema,
  }),
  createContract({
    id: 'updateOnboardingDraft',
    story: 'SCRUM-1334',
    method: HTTP_METHODS.PATCH,
    path: MOCK_API_PATHS.ONBOARDING_DRAFT_DETAIL,
    paramsSchema: draftParamsSchema,
    bodySchema: onboardingDraftSchema.partial(),
    responseSchema: onboardingDraftSchema,
  }),
  createContract({
    id: 'submitOnboarding',
    story: 'SCRUM-1335',
    method: HTTP_METHODS.POST,
    path: MOCK_API_PATHS.ONBOARDING_SUBMIT,
    paramsSchema: applicationParamsSchema,
    bodySchema: submitRequestSchema,
    responseSchema: onboardingRecordSchema,
  }),
  createContract({
    id: 'validateOnboarding',
    story: 'SCRUM-1336',
    method: HTTP_METHODS.POST,
    path: MOCK_API_PATHS.ONBOARDING_VALIDATE,
    paramsSchema: applicationParamsSchema,
    bodySchema: validationRequestSchema,
    responseSchema: validationResultSchema,
  }),
  createContract({
    id: 'createProviderCheck',
    story: 'SCRUM-1337',
    method: HTTP_METHODS.POST,
    path: MOCK_API_PATHS.PROVIDER_CHECKS,
    bodySchema: providerRequestSchema,
    responseSchema: providerCheckSchema,
    successStatus: 201,
  }),
  createContract({
    id: 'getProviderCheck',
    story: 'SCRUM-1337',
    method: HTTP_METHODS.GET,
    path: MOCK_API_PATHS.PROVIDER_CHECK_DETAIL,
    paramsSchema: checkParamsSchema,
    responseSchema: providerCheckSchema,
  }),
  createContract({
    id: 'completeProviderCheck',
    story: 'SCRUM-1337',
    method: HTTP_METHODS.PATCH,
    path: MOCK_API_PATHS.PROVIDER_CHECK_DETAIL,
    paramsSchema: checkParamsSchema,
    bodySchema: providerResponseSchema,
    responseSchema: providerCheckSchema,
  }),
  createContract({
    id: 'listWorkItems',
    story: 'SCRUM-1338',
    method: HTTP_METHODS.GET,
    path: MOCK_API_PATHS.WORK_ITEMS,
    querySchema: workItemQuerySchema,
    responseSchema: workItemsSchema,
  }),
  createContract({
    id: 'getWorkItem',
    story: 'SCRUM-1338',
    method: HTTP_METHODS.GET,
    path: MOCK_API_PATHS.WORK_ITEM_DETAIL,
    paramsSchema: workItemParamsSchema,
    responseSchema: workItemSchema,
  }),
  createContract({
    id: 'updateWorkItem',
    story: 'SCRUM-1339',
    method: HTTP_METHODS.PATCH,
    path: MOCK_API_PATHS.WORK_ITEM_DETAIL,
    paramsSchema: workItemParamsSchema,
    bodySchema: workItemUpdateSchema,
    responseSchema: workItemSchema,
  }),
  createContract({
    id: 'assignWorkItem',
    story: 'SCRUM-1339',
    method: HTTP_METHODS.POST,
    path: MOCK_API_PATHS.WORK_ITEM_ASSIGNMENT,
    paramsSchema: workItemParamsSchema,
    bodySchema: assignmentRequestSchema,
    responseSchema: assignmentRecordSchema,
    successStatus: 201,
  }),
  createContract({
    id: 'listLifecycleEvents',
    story: 'SCRUM-1340',
    method: HTTP_METHODS.GET,
    path: MOCK_API_PATHS.LIFECYCLE_EVENTS,
    paramsSchema: applicationParamsSchema,
    responseSchema: auditEventsSchema,
  }),
  createContract({
    id: 'listNotifications',
    story: 'SCRUM-1341',
    method: HTTP_METHODS.GET,
    path: MOCK_API_PATHS.NOTIFICATIONS,
    querySchema: notificationQuerySchema,
    responseSchema: notificationsSchema,
  }),
  createContract({
    id: 'createNotification',
    story: 'SCRUM-1341',
    method: HTTP_METHODS.POST,
    path: MOCK_API_PATHS.NOTIFICATIONS,
    bodySchema: notificationSchema,
    responseSchema: notificationSchema,
    successStatus: 201,
  }),
  createContract({
    id: 'updateNotification',
    story: 'SCRUM-1341',
    method: HTTP_METHODS.PATCH,
    path: MOCK_API_PATHS.NOTIFICATION_DETAIL,
    paramsSchema: notificationParamsSchema,
    bodySchema: notificationUpdateSchema,
    responseSchema: notificationSchema,
  }),
  createContract({
    id: 'listSyncAttempts',
    story: 'SCRUM-1342',
    method: HTTP_METHODS.GET,
    path: MOCK_API_PATHS.SYNC_ATTEMPTS,
    querySchema: syncAttemptQuerySchema,
    responseSchema: syncAttemptsSchema,
  }),
  createContract({
    id: 'createSyncAttempt',
    story: 'SCRUM-1342',
    method: HTTP_METHODS.POST,
    path: MOCK_API_PATHS.SYNC_ATTEMPTS,
    bodySchema: syncAttemptSchema,
    responseSchema: syncAttemptSchema,
    successStatus: 201,
  }),
  createContract({
    id: 'getSyncAttempt',
    story: 'SCRUM-1342',
    method: HTTP_METHODS.GET,
    path: MOCK_API_PATHS.SYNC_ATTEMPT_DETAIL,
    paramsSchema: syncAttemptParamsSchema,
    responseSchema: syncAttemptSchema,
  }),
  createContract({
    id: 'listContractChanges',
    story: 'SCRUM-1343',
    method: HTTP_METHODS.GET,
    path: MOCK_API_PATHS.CONTRACT_CHANGES,
    querySchema: contractChangeQuerySchema,
    responseSchema: changeRequestsSchema,
  }),
  createContract({
    id: 'createContractChange',
    story: 'SCRUM-1343',
    method: HTTP_METHODS.POST,
    path: MOCK_API_PATHS.CONTRACT_CHANGES,
    bodySchema: changeRequestSchema,
    responseSchema: changeRequestSchema,
    successStatus: 201,
  }),
  createContract({
    id: 'getContractChange',
    story: 'SCRUM-1343',
    method: HTTP_METHODS.GET,
    path: MOCK_API_PATHS.CONTRACT_CHANGE_DETAIL,
    paramsSchema: changeRequestParamsSchema,
    responseSchema: changeRequestSchema,
  }),
  createContract({
    id: 'getReferenceConfiguration',
    story: 'SCRUM-1344',
    method: HTTP_METHODS.GET,
    path: MOCK_API_PATHS.REFERENCE_CONFIGURATION,
    responseSchema: referenceConfigurationSchema,
  }),
  createContract({
    id: 'updateReferenceConfiguration',
    story: 'SCRUM-1344',
    method: HTTP_METHODS.PUT,
    path: MOCK_API_PATHS.REFERENCE_CONFIGURATION,
    bodySchema: referenceConfigurationUpdateSchema,
    responseSchema: referenceConfigurationSchema,
  }),
  createContract({
    id: 'listUsers',
    story: 'SCRUM-1345',
    method: HTTP_METHODS.GET,
    path: MOCK_API_PATHS.USERS,
    querySchema: userQuerySchema,
    responseSchema: usersSchema,
  }),
  createContract({
    id: 'createUser',
    story: 'SCRUM-1345',
    method: HTTP_METHODS.POST,
    path: MOCK_API_PATHS.USERS,
    bodySchema: userSchema,
    responseSchema: userSchema,
    successStatus: 201,
  }),
  createContract({
    id: 'getUser',
    story: 'SCRUM-1345',
    method: HTTP_METHODS.GET,
    path: MOCK_API_PATHS.USER_DETAIL,
    paramsSchema: userParamsSchema,
    responseSchema: userSchema,
  }),
  createContract({
    id: 'updateUser',
    story: 'SCRUM-1345',
    method: HTTP_METHODS.PATCH,
    path: MOCK_API_PATHS.USER_DETAIL,
    paramsSchema: userParamsSchema,
    bodySchema: userUpdateSchema,
    responseSchema: userSchema,
  }),
  createContract({
    id: 'getApplicationConfiguration',
    story: 'SCRUM-1346',
    method: HTTP_METHODS.GET,
    path: MOCK_API_PATHS.APPLICATION_CONFIGURATION,
    responseSchema: applicationConfigurationSchema,
  }),
  createContract({
    id: 'updateApplicationConfiguration',
    story: 'SCRUM-1346',
    method: HTTP_METHODS.PATCH,
    path: MOCK_API_PATHS.APPLICATION_CONFIGURATION,
    bodySchema: applicationConfigurationUpdateSchema,
    responseSchema: applicationConfigurationSchema,
  }),
]);

export const MOCK_API_CONTRACT_REGISTRY = Object.freeze(
  Object.fromEntries(
    MOCK_API_CONTRACTS.map((contract) => [contract.id, contract]),
  ),
);

export const MOCK_API_ENDPOINTS = MOCK_API_CONTRACTS;

/**
 * Returns a mock API contract by its stable identifier.
 *
 * @param {string} contractId Contract identifier.
 * @returns {object | undefined} Matching contract, when present.
 */
export function getMockApiContract(contractId) {
  if (typeof contractId !== 'string' || contractId.trim() === '') {
    return undefined;
  }

  return MOCK_API_CONTRACT_REGISTRY[contractId];
}

/**
 * Resolves named parameters in a mock API path template.
 *
 * @param {string} pathTemplate Path containing `:parameter` segments.
 * @param {Record<string, string | number>} parameters Path parameter values.
 * @returns {string} Resolved API path.
 */
export function buildMockApiPath(pathTemplate, parameters = {}) {
  if (typeof pathTemplate !== 'string' || pathTemplate.trim() === '') {
    throw new TypeError('A valid mock API path template is required.');
  }

  if (
    !parameters ||
    typeof parameters !== 'object' ||
    Array.isArray(parameters)
  ) {
    throw new TypeError('Mock API path parameters must be an object.');
  }

  return pathTemplate.replace(
    /:([A-Za-z0-9_]+)/g,
    (_, parameterName) => {
      const value = parameters[parameterName];

      if (
        value === undefined ||
        value === null ||
        String(value).trim() === ''
      ) {
        throw new Error(`Missing mock API path parameter: ${parameterName}`);
      }

      return encodeURIComponent(String(value));
    },
  );
}

function pathTemplateMatches(pathTemplate, requestPath) {
  const templateSegments = pathTemplate.split('/');
  const requestSegments = requestPath.split('/');

  if (templateSegments.length !== requestSegments.length) {
    return false;
  }

  return templateSegments.every((segment, index) => {
    if (segment.startsWith(':')) {
      return requestSegments[index].length > 0;
    }

    return segment === requestSegments[index];
  });
}

/**
 * Finds the contract matching an HTTP method and request path.
 *
 * @param {string} method HTTP method.
 * @param {string} requestPath Concrete request path.
 * @returns {object | undefined} Matching contract, when present.
 */
export function findMockApiContract(method, requestPath) {
  if (
    typeof method !== 'string' ||
    typeof requestPath !== 'string' ||
    requestPath.trim() === ''
  ) {
    return undefined;
  }

  const normalizedMethod = method.trim().toUpperCase();
  const normalizedPath = requestPath.split('?')[0].replace(/\/+$/, '') || '/';

  return MOCK_API_CONTRACTS.find((contract) => {
    const contractPath = contract.path.replace(/\/+$/, '') || '/';

    return (
      contract.method === normalizedMethod &&
      pathTemplateMatches(contractPath, normalizedPath)
    );
  });
}

/**
 * Extracts named path parameters using a contract path template.
 *
 * @param {string} pathTemplate Contract path template.
 * @param {string} requestPath Concrete request path.
 * @returns {Record<string, string>} Decoded path parameters.
 */
export function extractMockApiPathParameters(pathTemplate, requestPath) {
  if (
    typeof pathTemplate !== 'string' ||
    typeof requestPath !== 'string'
  ) {
    throw new TypeError('Valid template and request paths are required.');
  }

  const templateSegments = pathTemplate.split('/');
  const requestSegments = requestPath.split('?')[0].split('/');

  if (!pathTemplateMatches(pathTemplate, requestPath.split('?')[0])) {
    throw new Error('The request path does not match the path template.');
  }

  return Object.fromEntries(
    templateSegments.flatMap((segment, index) =>
      segment.startsWith(':')
        ? [[segment.slice(1), decodeURIComponent(requestSegments[index])]]
        : [],
    ),
  );
}

export default MOCK_API_CONTRACT_REGISTRY;