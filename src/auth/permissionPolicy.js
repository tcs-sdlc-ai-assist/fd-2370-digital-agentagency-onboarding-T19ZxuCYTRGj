import {
  PARTNER_SCOPE_TYPES,
  PERMISSIONS,
  ROLE_PARTNER_SCOPE_MATRIX,
  ROLE_PERMISSION_MATRIX,
  ROLES,
} from '../constants/roles.js';
import { ROUTES } from '../constants/routes.js';

const PUBLIC_ROUTE_PATTERNS = Object.freeze([
  ROUTES.LOGIN,
  ROUTES.UNAUTHORIZED,
  ROUTES.FORBIDDEN,
  ROUTES.NOT_FOUND,
  ROUTES.ERROR,
]);

const EXTERNAL_PORTAL_ROLES = Object.freeze([
  ROLES.PARTNER,
  ROLES.AGENCY,
]);

const INTERNAL_PORTAL_ROLES = Object.freeze([
  ROLES.LICENSING,
  ROLES.MANAGER,
  ROLES.DISTRIBUTION,
  ROLES.OPERATIONS,
  ROLES.ADMIN,
]);

const ADMIN_ROLES = Object.freeze([ROLES.ADMIN]);

export const ACTION_PERMISSIONS = Object.freeze({
  VIEW_DASHBOARD: PERMISSIONS.VIEW_DASHBOARD,
  VIEW_ONBOARDING: PERMISSIONS.VIEW_ONBOARDING,
  CREATE_ONBOARDING: PERMISSIONS.CREATE_ONBOARDING,
  UPDATE_ONBOARDING: PERMISSIONS.UPDATE_ONBOARDING,
  SUBMIT_ONBOARDING: PERMISSIONS.SUBMIT_ONBOARDING,
  REVIEW_ONBOARDING: PERMISSIONS.REVIEW_ONBOARDING,
  APPROVE_ONBOARDING: PERMISSIONS.APPROVE_ONBOARDING,
  ASSIGN_ONBOARDING: PERMISSIONS.ASSIGN_ONBOARDING,
  VIEW_WORKBENCH: PERMISSIONS.VIEW_WORKBENCH,
  MANAGE_WORK_ITEMS: PERMISSIONS.MANAGE_WORK_ITEMS,
  REVIEW_LICENSING: PERMISSIONS.REVIEW_LICENSING,
  MANAGE_APPOINTMENTS: PERMISSIONS.MANAGE_APPOINTMENTS,
  REVIEW_DISTRIBUTION: PERMISSIONS.REVIEW_DISTRIBUTION,
  MANAGE_HIERARCHIES: PERMISSIONS.MANAGE_HIERARCHIES,
  RESOLVE_EXCEPTIONS: PERMISSIONS.RESOLVE_EXCEPTIONS,
  VIEW_OPERATIONS: PERMISSIONS.VIEW_OPERATIONS,
  MANAGE_CONTRACT_CHANGES: PERMISSIONS.MANAGE_CONTRACT_CHANGES,
  VIEW_REPORTS: PERMISSIONS.VIEW_REPORTS,
  VIEW_NOTIFICATIONS: PERMISSIONS.VIEW_NOTIFICATIONS,
  MANAGE_REFERENCE_DATA: PERMISSIONS.MANAGE_REFERENCE_DATA,
  MANAGE_USERS: PERMISSIONS.MANAGE_USERS,
  MANAGE_CONFIGURATION: PERMISSIONS.MANAGE_CONFIGURATION,
  VIEW_DIAGNOSTICS: PERMISSIONS.VIEW_DIAGNOSTICS,
});

export const ROUTE_ACCESS_POLICIES = Object.freeze({
  [ROUTES.ROOT]: Object.freeze({
    permission: PERMISSIONS.VIEW_DASHBOARD,
  }),
  [ROUTES.LOGOUT]: Object.freeze({
    authenticated: true,
  }),
  [ROUTES.INTAKE]: Object.freeze({
    permission: PERMISSIONS.CREATE_ONBOARDING,
  }),
  [ROUTES.INTAKE_NEW]: Object.freeze({
    permission: PERMISSIONS.CREATE_ONBOARDING,
  }),
  [ROUTES.INTAKE_DETAIL]: Object.freeze({
    permission: PERMISSIONS.VIEW_ONBOARDING,
  }),
  [ROUTES.JOURNEYS]: Object.freeze({
    permission: PERMISSIONS.VIEW_ONBOARDING,
  }),
  [ROUTES.JOURNEY_NEW]: Object.freeze({
    permission: PERMISSIONS.CREATE_ONBOARDING,
  }),
  [ROUTES.JOURNEY_DETAIL]: Object.freeze({
    permission: PERMISSIONS.VIEW_ONBOARDING,
  }),
  [ROUTES.AGENT_CONTRACTING_JOURNEY]: Object.freeze({
    permission: PERMISSIONS.CREATE_ONBOARDING,
  }),
  [ROUTES.REGISTERED_REP_JOURNEY]: Object.freeze({
    permission: PERMISSIONS.CREATE_ONBOARDING,
  }),
  [ROUTES.CORPORATE_JOURNEY]: Object.freeze({
    permission: PERMISSIONS.CREATE_ONBOARDING,
  }),
  [ROUTES.GA_AGENCY_JOURNEY]: Object.freeze({
    permission: PERMISSIONS.CREATE_ONBOARDING,
  }),
  [ROUTES.FINANCIAL_INSTITUTION_JOURNEY]: Object.freeze({
    permission: PERMISSIONS.CREATE_ONBOARDING,
  }),
  [ROUTES.PARTNER]: Object.freeze({
    permission: PERMISSIONS.VIEW_DASHBOARD,
    roles: EXTERNAL_PORTAL_ROLES,
  }),
  [ROUTES.PARTNER_DASHBOARD]: Object.freeze({
    permission: PERMISSIONS.VIEW_DASHBOARD,
    roles: EXTERNAL_PORTAL_ROLES,
  }),
  [ROUTES.PARTNER_ONBOARDING]: Object.freeze({
    permission: PERMISSIONS.VIEW_ONBOARDING,
    roles: EXTERNAL_PORTAL_ROLES,
  }),
  [ROUTES.PARTNER_ONBOARDING_DETAIL]: Object.freeze({
    permission: PERMISSIONS.VIEW_ONBOARDING,
    roles: EXTERNAL_PORTAL_ROLES,
  }),
  [ROUTES.PARTNER_REPORTS]: Object.freeze({
    permission: PERMISSIONS.VIEW_REPORTS,
    roles: EXTERNAL_PORTAL_ROLES,
  }),
  [ROUTES.PARTNER_NOTIFICATIONS]: Object.freeze({
    permission: PERMISSIONS.VIEW_NOTIFICATIONS,
    roles: EXTERNAL_PORTAL_ROLES,
  }),
  [ROUTES.OPERATIONS]: Object.freeze({
    permission: PERMISSIONS.VIEW_OPERATIONS,
    roles: INTERNAL_PORTAL_ROLES,
  }),
  [ROUTES.OPERATIONS_DASHBOARD]: Object.freeze({
    permission: PERMISSIONS.VIEW_DASHBOARD,
    roles: INTERNAL_PORTAL_ROLES,
  }),
  [ROUTES.OPERATIONS_WORKBENCH]: Object.freeze({
    permission: PERMISSIONS.VIEW_WORKBENCH,
    roles: INTERNAL_PORTAL_ROLES,
  }),
  [ROUTES.OPERATIONS_WORK_ITEM]: Object.freeze({
    permission: PERMISSIONS.VIEW_WORKBENCH,
    roles: INTERNAL_PORTAL_ROLES,
  }),
  [ROUTES.OPERATIONS_ONBOARDING]: Object.freeze({
    permission: PERMISSIONS.VIEW_ONBOARDING,
    roles: INTERNAL_PORTAL_ROLES,
  }),
  [ROUTES.OPERATIONS_ONBOARDING_DETAIL]: Object.freeze({
    permission: PERMISSIONS.VIEW_ONBOARDING,
    roles: INTERNAL_PORTAL_ROLES,
  }),
  [ROUTES.OPERATIONS_EXCEPTIONS]: Object.freeze({
    permission: PERMISSIONS.RESOLVE_EXCEPTIONS,
    roles: INTERNAL_PORTAL_ROLES,
  }),
  [ROUTES.OPERATIONS_CONTRACT_CHANGES]: Object.freeze({
    permission: PERMISSIONS.MANAGE_CONTRACT_CHANGES,
    roles: INTERNAL_PORTAL_ROLES,
  }),
  [ROUTES.OPERATIONS_REPORTS]: Object.freeze({
    permission: PERMISSIONS.VIEW_REPORTS,
    roles: INTERNAL_PORTAL_ROLES,
  }),
  [ROUTES.OPERATIONS_AUDIT]: Object.freeze({
    permission: PERMISSIONS.VIEW_ONBOARDING,
    roles: INTERNAL_PORTAL_ROLES,
  }),
  [ROUTES.OPERATIONS_NOTIFICATIONS]: Object.freeze({
    permission: PERMISSIONS.VIEW_NOTIFICATIONS,
    roles: INTERNAL_PORTAL_ROLES,
  }),
  [ROUTES.ADMIN]: Object.freeze({
    permission: PERMISSIONS.MANAGE_CONFIGURATION,
    roles: ADMIN_ROLES,
  }),
  [ROUTES.ADMIN_DASHBOARD]: Object.freeze({
    permission: PERMISSIONS.VIEW_DASHBOARD,
    roles: ADMIN_ROLES,
  }),
  [ROUTES.ADMIN_REFERENCE_DATA]: Object.freeze({
    permission: PERMISSIONS.MANAGE_REFERENCE_DATA,
    roles: ADMIN_ROLES,
  }),
  [ROUTES.ADMIN_USERS]: Object.freeze({
    permission: PERMISSIONS.MANAGE_USERS,
    roles: ADMIN_ROLES,
  }),
  [ROUTES.ADMIN_USER_DETAIL]: Object.freeze({
    permission: PERMISSIONS.MANAGE_USERS,
    roles: ADMIN_ROLES,
  }),
  [ROUTES.ADMIN_CONFIGURATION]: Object.freeze({
    permission: PERMISSIONS.MANAGE_CONFIGURATION,
    roles: ADMIN_ROLES,
  }),
  [ROUTES.DIAGNOSTICS]: Object.freeze({
    permission: PERMISSIONS.VIEW_DIAGNOSTICS,
    roles: ADMIN_ROLES,
  }),
});

const ROUTE_POLICY_ENTRIES = Object.freeze(
  Object.entries(ROUTE_ACCESS_POLICIES),
);

const RECORD_PARTNER_FIELDS = Object.freeze([
  'partnerCode',
  'partnerId',
  'organizationCode',
  'organizationId',
  'organization',
  'gaCode',
]);

const ASSIGNED_ORGANIZATION_CONTEXT_FIELDS = Object.freeze([
  'assignedOrganizations',
  'assignedOrganizationIds',
  'assignedPartnerCodes',
  'partnerCodes',
  'organizationIds',
  'gaCodes',
]);

const ASSIGNED_WORK_CONTEXT_FIELDS = Object.freeze([
  'assignedWorkItemIds',
  'assignedRecordIds',
  'workItemIds',
  'recordIds',
  'applicationIds',
  'trackingIds',
]);

const RECORD_IDENTIFIER_FIELDS = Object.freeze([
  'id',
  'applicationId',
  'trackingId',
  'workItemId',
  'sourceRecordId',
  'changeRequestId',
]);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeIdentifier(value) {
  if (
    value === null ||
    value === undefined ||
    String(value).trim() === ''
  ) {
    return undefined;
  }

  return String(value).trim().normalize('NFKC').toLowerCase();
}

function normalizePath(route) {
  const routeValue = isObject(route)
    ? route.pathname ?? route.path
    : route;

  if (typeof routeValue !== 'string' || routeValue.trim() === '') {
    return undefined;
  }

  const path = routeValue.trim().split(/[?#]/, 1)[0];

  if (path === ROUTES.CATCH_ALL) {
    return path;
  }

  const normalizedPath = path.startsWith('/') ? path : `/${path}`;

  return normalizedPath.replace(/\/+$/, '') || ROUTES.ROOT;
}

function pathMatchesPattern(pattern, path) {
  const normalizedPattern = normalizePath(pattern);
  const normalizedPath = normalizePath(path);

  if (!normalizedPattern || !normalizedPath) {
    return false;
  }

  if (normalizedPattern === ROUTES.CATCH_ALL) {
    return true;
  }

  const patternSegments = normalizedPattern.split('/');
  const pathSegments = normalizedPath.split('/');

  if (patternSegments.length !== pathSegments.length) {
    return false;
  }

  return patternSegments.every((segment, index) => {
    if (segment.startsWith(':')) {
      return pathSegments[index].length > 0;
    }

    return segment === pathSegments[index];
  });
}

function normalizePrincipal(principal, partnerContext) {
  if (typeof principal === 'string') {
    return {
      role: principal,
      user: null,
      permissions: undefined,
      partnerContext: partnerContext ?? null,
      authenticated: true,
    };
  }

  if (!isObject(principal)) {
    return {
      role: null,
      user: null,
      permissions: undefined,
      partnerContext: partnerContext ?? null,
      authenticated: false,
    };
  }

  const user = isObject(principal.user)
    ? principal.user
    : isObject(principal.currentUser)
      ? principal.currentUser
      : principal;
  const role = principal.role ?? user.role ?? null;
  const sessionStateSpecified =
    Object.hasOwn(principal, 'isAuthenticated') ||
    Object.hasOwn(principal, 'status');
  const authenticated = sessionStateSpecified
    ? principal.isAuthenticated === true ||
      principal.status === 'authenticated'
    : typeof role === 'string' && role.trim() !== '';

  return {
    role,
    user,
    permissions: Array.isArray(principal.permissions)
      ? principal.permissions
      : undefined,
    partnerContext:
      partnerContext ??
      principal.partnerContext ??
      user.partnerContext ??
      null,
    authenticated,
  };
}

function getEffectivePermissions(normalizedPrincipal) {
  if (!normalizedPrincipal.role) {
    return [];
  }

  const rolePermissions =
    ROLE_PERMISSION_MATRIX[normalizedPrincipal.role] ?? [];

  if (normalizedPrincipal.permissions === undefined) {
    return rolePermissions;
  }

  return normalizedPrincipal.permissions.filter((permission) =>
    rolePermissions.includes(permission),
  );
}

function resolvePermission(action) {
  if (typeof action === 'string') {
    const normalizedAction = action.trim();

    if (normalizedAction === '') {
      return undefined;
    }

    if (Object.values(PERMISSIONS).includes(normalizedAction)) {
      return normalizedAction;
    }

    return ACTION_PERMISSIONS[
      normalizedAction
        .replace(/[:\s-]+/g, '_')
        .replace(/([a-z])([A-Z])/g, '$1_$2')
        .toUpperCase()
    ];
  }

  if (isObject(action)) {
    return resolvePermission(
      action.permission ?? action.action ?? action.name,
    );
  }

  return undefined;
}

function resolveRouteArguments(firstArgument, secondArgument, thirdArgument) {
  const firstPath = normalizePath(firstArgument);

  if (
    firstPath &&
    (firstPath.startsWith('/') || firstPath === ROUTES.CATCH_ALL)
  ) {
    return {
      route: firstArgument,
      principal: secondArgument,
      partnerContext: thirdArgument,
    };
  }

  return {
    route: secondArgument,
    principal: firstArgument,
    partnerContext: thirdArgument,
  };
}

function resolveActionArguments(firstArgument, secondArgument, thirdArgument) {
  if (
    typeof firstArgument === 'string' &&
    (firstArgument.includes(':') ||
      Object.hasOwn(ACTION_PERMISSIONS, firstArgument.toUpperCase()))
  ) {
    return {
      action: firstArgument,
      principal: secondArgument,
      record: thirdArgument,
    };
  }

  return {
    action: secondArgument,
    principal: firstArgument,
    record: thirdArgument,
  };
}

function collectNormalizedValues(source, fields) {
  if (!isObject(source)) {
    return [];
  }

  const values = new Set();

  fields.forEach((field) => {
    const value = source[field];
    const candidates = Array.isArray(value) ? value : [value];

    candidates.forEach((candidate) => {
      if (isObject(candidate)) {
        [
          candidate.id,
          candidate.code,
          candidate.partnerCode,
          candidate.organizationId,
          candidate.applicationId,
          candidate.trackingId,
          candidate.workItemId,
        ].forEach((nestedValue) => {
          const normalizedValue = normalizeIdentifier(nestedValue);

          if (normalizedValue) {
            values.add(normalizedValue);
          }
        });

        return;
      }

      const normalizedValue = normalizeIdentifier(candidate);

      if (normalizedValue) {
        values.add(normalizedValue);
      }
    });
  });

  return [...values];
}

function collectRecordPartnerIdentifiers(record) {
  const values = collectNormalizedValues(record, RECORD_PARTNER_FIELDS);

  if (isObject(record?.metadata)) {
    values.push(
      ...collectNormalizedValues(record.metadata, RECORD_PARTNER_FIELDS),
    );
  }

  return [...new Set(values)];
}

function collectRecordIdentifiers(record) {
  const values = collectNormalizedValues(record, RECORD_IDENTIFIER_FIELDS);

  if (isObject(record?.metadata)) {
    values.push(
      ...collectNormalizedValues(record.metadata, RECORD_IDENTIFIER_FIELDS),
    );
  }

  return [...new Set(values)];
}

function isAssignedToPrincipal(normalizedPrincipal, record) {
  const userId = normalizeIdentifier(normalizedPrincipal.user?.id);
  const role = normalizeIdentifier(normalizedPrincipal.role);
  const assignedTo = normalizeIdentifier(
    record.assignedTo ??
      record.assigneeUserId ??
      record.assignment?.assigneeUserId,
  );
  const assignedGroup = normalizeIdentifier(
    record.assignedGroup ??
      record.team ??
      record.assignment?.team ??
      record.assignment?.assignedGroup,
  );

  return Boolean(
    (userId && assignedTo === userId) ||
      (role && assignedGroup === role),
  );
}

/**
 * Returns the access policy matching a concrete route.
 *
 * @param {string | {pathname?: string, path?: string}} route Route value.
 * @returns {object | undefined} Matching route policy.
 */
export function getRouteAccessPolicy(route) {
  const path = normalizePath(route);

  if (!path) {
    return undefined;
  }

  const match = ROUTE_POLICY_ENTRIES.find(([pattern]) =>
    pathMatchesPattern(pattern, path),
  );

  return match?.[1];
}

/**
 * Determines whether a role or authenticated principal has a permission.
 *
 * The preferred signature is `canPerformAction(principal, action, record)`.
 * The reversed `canPerformAction(action, principal, record)` form is also
 * supported.
 *
 * @param {string | object | null} firstArgument Principal or action.
 * @param {string | object | null} secondArgument Action or principal.
 * @param {object} [thirdArgument] Optional record requiring scope access.
 * @returns {boolean} Whether the action is permitted.
 */
export function canPerformAction(
  firstArgument,
  secondArgument,
  thirdArgument,
) {
  const { action, principal, record } = resolveActionArguments(
    firstArgument,
    secondArgument,
    thirdArgument,
  );
  const permission = resolvePermission(action);

  if (!permission) {
    return false;
  }

  const normalizedPrincipal = normalizePrincipal(principal);

  if (!normalizedPrincipal.authenticated) {
    return false;
  }

  const permitted = getEffectivePermissions(normalizedPrincipal).includes(
    permission,
  );

  if (!permitted) {
    return false;
  }

  return record === undefined
    ? true
    : canAccessRecord(normalizedPrincipal, record);
}

/**
 * Determines whether a principal can access an application route.
 *
 * The preferred signature is `canAccessRoute(principal, route)`. The reversed
 * `canAccessRoute(route, principal)` form is also supported.
 *
 * @param {string | object | null} firstArgument Principal or route.
 * @param {string | object | null} secondArgument Route or principal.
 * @param {object} [thirdArgument] Optional partner context.
 * @returns {boolean} Whether the route is accessible.
 */
export function canAccessRoute(
  firstArgument,
  secondArgument,
  thirdArgument,
) {
  const { route, principal, partnerContext } = resolveRouteArguments(
    firstArgument,
    secondArgument,
    thirdArgument,
  );
  const path = normalizePath(route);

  if (!path) {
    return false;
  }

  if (
    PUBLIC_ROUTE_PATTERNS.some((pattern) =>
      pathMatchesPattern(pattern, path),
    )
  ) {
    return true;
  }

  const policy = getRouteAccessPolicy(path);

  if (!policy) {
    return false;
  }

  const normalizedPrincipal = normalizePrincipal(
    principal,
    partnerContext,
  );

  if (!normalizedPrincipal.authenticated) {
    return false;
  }

  if (
    policy.roles &&
    !policy.roles.includes(normalizedPrincipal.role)
  ) {
    return false;
  }

  if (!policy.permission) {
    return policy.authenticated === true;
  }

  return getEffectivePermissions(normalizedPrincipal).includes(
    policy.permission,
  );
}

/**
 * Determines whether a record is visible within a principal's partner and
 * assignment scope.
 *
 * @param {string | object | null} principal Role or authenticated principal.
 * @param {object} record Record to evaluate.
 * @param {object} [partnerContext] Optional partner context override.
 * @returns {boolean} Whether the record is in scope.
 */
export function canAccessRecord(principal, record, partnerContext) {
  if (!isObject(record)) {
    return false;
  }

  const normalizedPrincipal = normalizePrincipal(
    principal,
    partnerContext,
  );

  if (!normalizedPrincipal.authenticated || !normalizedPrincipal.role) {
    return false;
  }

  const context = isObject(normalizedPrincipal.partnerContext)
    ? normalizedPrincipal.partnerContext
    : {};
  const scopeType =
    context.scopeType ??
    ROLE_PARTNER_SCOPE_MATRIX[normalizedPrincipal.role];

  switch (scopeType) {
    case PARTNER_SCOPE_TYPES.GLOBAL:
    case PARTNER_SCOPE_TYPES.ALL_PARTNERS:
      return true;

    case PARTNER_SCOPE_TYPES.OWN_ORGANIZATION: {
      const allowedIdentifiers = collectNormalizedValues(
        {
          partnerCode:
            context.partnerCode ??
            normalizedPrincipal.user?.partnerCode,
          organization:
            context.organization ??
            normalizedPrincipal.user?.organization,
          organizationId:
            context.organizationId ??
            normalizedPrincipal.user?.organizationId,
          gaCode: context.gaCode,
        },
        RECORD_PARTNER_FIELDS,
      );
      const recordIdentifiers = collectRecordPartnerIdentifiers(record);

      return (
        allowedIdentifiers.length > 0 &&
        recordIdentifiers.some((identifier) =>
          allowedIdentifiers.includes(identifier),
        )
      );
    }

    case PARTNER_SCOPE_TYPES.ASSIGNED_ORGANIZATIONS: {
      const allowedIdentifiers = collectNormalizedValues(
        context,
        ASSIGNED_ORGANIZATION_CONTEXT_FIELDS,
      );
      const activePartnerCode = normalizeIdentifier(context.partnerCode);

      if (activePartnerCode) {
        allowedIdentifiers.push(activePartnerCode);
      }

      const recordIdentifiers = collectRecordPartnerIdentifiers(record);

      return recordIdentifiers.some((identifier) =>
        allowedIdentifiers.includes(identifier),
      );
    }

    case PARTNER_SCOPE_TYPES.ASSIGNED_WORK: {
      if (isAssignedToPrincipal(normalizedPrincipal, record)) {
        return true;
      }

      const assignedIdentifiers = collectNormalizedValues(
        context,
        ASSIGNED_WORK_CONTEXT_FIELDS,
      );
      const recordIdentifiers = collectRecordIdentifiers(record);

      return recordIdentifiers.some((identifier) =>
        assignedIdentifiers.includes(identifier),
      );
    }

    default:
      return false;
  }
}

/**
 * Filters records using the principal's current record scope.
 *
 * @param {string | object | null} principal Role or authenticated principal.
 * @param {object[]} records Records to filter.
 * @param {object} [partnerContext] Optional partner context override.
 * @returns {object[]} Records visible to the principal.
 */
export function filterRecordsByScope(
  principal,
  records,
  partnerContext,
) {
  if (!Array.isArray(records)) {
    throw new TypeError('Scoped records must be an array.');
  }

  return records.filter((record) =>
    canAccessRecord(principal, record, partnerContext),
  );
}

export const isRecordInScope = canAccessRecord;
export const canViewRecord = canAccessRecord;
export const hasPermission = canPerformAction;
export const filterScopedRecords = filterRecordsByScope;

export default Object.freeze({
  canAccessRecord,
  canAccessRoute,
  canPerformAction,
  filterRecordsByScope,
  getRouteAccessPolicy,
  isRecordInScope,
});