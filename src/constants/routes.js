export const ROUTES = Object.freeze({
  ROOT: '/',
  HOME: '/',

  LOGIN: '/login',
  LOGOUT: '/logout',

  INTAKE: '/intake',
  INTAKE_NEW: '/intake/new',
  INTAKE_DETAIL: '/intake/:intakeId',

  JOURNEYS: '/journeys',
  JOURNEY_NEW: '/journeys/new',
  JOURNEY_DETAIL: '/journeys/:journeyId',
  AGENT_CONTRACTING_JOURNEY: '/journeys/agent-contracting',
  REGISTERED_REP_JOURNEY: '/journeys/registered-representative',
  CORPORATE_JOURNEY: '/journeys/corporate',
  GA_AGENCY_JOURNEY: '/journeys/ga-agency',
  FINANCIAL_INSTITUTION_JOURNEY: '/journeys/financial-institution',

  PARTNER: '/partner',
  PARTNER_DASHBOARD: '/partner/dashboard',
  PARTNER_ONBOARDING: '/partner/onboarding',
  PARTNER_ONBOARDING_DETAIL: '/partner/onboarding/:applicationId',
  PARTNER_REPORTS: '/partner/reports',
  PARTNER_NOTIFICATIONS: '/partner/notifications',

  OPERATIONS: '/operations',
  OPERATIONS_DASHBOARD: '/operations/dashboard',
  OPERATIONS_WORKBENCH: '/operations/workbench',
  OPERATIONS_WORK_ITEM: '/operations/workbench/:workItemId',
  OPERATIONS_ONBOARDING: '/operations/onboarding',
  OPERATIONS_ONBOARDING_DETAIL: '/operations/onboarding/:applicationId',
  OPERATIONS_EXCEPTIONS: '/operations/exceptions',
  OPERATIONS_CONTRACT_CHANGES: '/operations/contract-changes',
  OPERATIONS_REPORTS: '/operations/reports',
  OPERATIONS_AUDIT: '/operations/reports/audit',
  OPERATIONS_NOTIFICATIONS: '/operations/notifications',

  ADMIN: '/admin',
  ADMIN_DASHBOARD: '/admin/dashboard',
  ADMIN_REFERENCE_DATA: '/admin/reference-data',
  ADMIN_USERS: '/admin/users',
  ADMIN_USER_DETAIL: '/admin/users/:userId',
  ADMIN_CONFIGURATION: '/admin/configuration',

  DIAGNOSTICS: '/diagnostics',

  UNAUTHORIZED: '/unauthorized',
  FORBIDDEN: '/forbidden',
  NOT_FOUND: '/not-found',
  ERROR: '/error',
  CATCH_ALL: '*',
});

export const ROUTE_PATHS = ROUTES;

/**
 * Replaces named parameters in a route pattern with URL-safe path segments.
 *
 * @param {string} routePattern Route pattern containing `:parameter` segments.
 * @param {Record<string, string | number>} parameters Parameter values.
 * @returns {string} The resolved route.
 * @throws {TypeError} When the route pattern or a parameter value is invalid.
 * @throws {Error} When a required parameter is missing.
 */
export function buildRoute(routePattern, parameters = {}) {
  if (typeof routePattern !== 'string' || routePattern.length === 0) {
    throw new TypeError('A valid route pattern is required.');
  }

  return routePattern.replace(/:([A-Za-z0-9_]+)/g, (_, parameterName) => {
    const parameterValue = parameters[parameterName];

    if (
      parameterValue === undefined ||
      parameterValue === null ||
      String(parameterValue).trim() === ''
    ) {
      throw new Error(`Missing route parameter: ${parameterName}`);
    }

    return encodeURIComponent(String(parameterValue));
  });
}

/**
 * Builds an intake detail route.
 *
 * @param {string | number} intakeId Intake record identifier.
 * @returns {string} Intake detail route.
 */
export function getIntakeRoute(intakeId) {
  return buildRoute(ROUTES.INTAKE_DETAIL, { intakeId });
}

/**
 * Builds a journey detail route.
 *
 * @param {string | number} journeyId Journey identifier.
 * @returns {string} Journey detail route.
 */
export function getJourneyRoute(journeyId) {
  return buildRoute(ROUTES.JOURNEY_DETAIL, { journeyId });
}

/**
 * Builds a partner onboarding detail route.
 *
 * @param {string | number} applicationId Application identifier.
 * @returns {string} Partner onboarding detail route.
 */
export function getPartnerOnboardingRoute(applicationId) {
  return buildRoute(ROUTES.PARTNER_ONBOARDING_DETAIL, { applicationId });
}

/**
 * Builds an operations onboarding detail route.
 *
 * @param {string | number} applicationId Application identifier.
 * @returns {string} Operations onboarding detail route.
 */
export function getOperationsOnboardingRoute(applicationId) {
  return buildRoute(ROUTES.OPERATIONS_ONBOARDING_DETAIL, { applicationId });
}

/**
 * Builds an operations work item route.
 *
 * @param {string | number} workItemId Work item identifier.
 * @returns {string} Operations work item route.
 */
export function getOperationsWorkItemRoute(workItemId) {
  return buildRoute(ROUTES.OPERATIONS_WORK_ITEM, { workItemId });
}

/**
 * Builds an administrator user detail route.
 *
 * @param {string | number} userId User identifier.
 * @returns {string} Administrator user detail route.
 */
export function getAdminUserRoute(userId) {
  return buildRoute(ROUTES.ADMIN_USER_DETAIL, { userId });
}

export const ROUTE_BUILDERS = Object.freeze({
  intake: getIntakeRoute,
  journey: getJourneyRoute,
  partnerOnboarding: getPartnerOnboardingRoute,
  operationsOnboarding: getOperationsOnboardingRoute,
  operationsWorkItem: getOperationsWorkItemRoute,
  adminUser: getAdminUserRoute,
});

export default ROUTES;