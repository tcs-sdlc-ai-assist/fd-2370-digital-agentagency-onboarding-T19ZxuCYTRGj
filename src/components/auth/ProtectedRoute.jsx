import { useEffect, useMemo } from 'react';
import PropTypes from 'prop-types';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { PartnerScopeGuard } from '../../auth/partnerScopeGuard.js';
import {
  canAccessRoute,
  canPerformAction,
  getRouteAccessPolicy,
} from '../../auth/permissionPolicy.js';
import { ALL_ROLES } from '../../constants/roles.js';
import { ROUTES } from '../../constants/routes.js';
import { useAuthStore } from '../../stores/authStore.js';

function normalizeList(value) {
  if (value === undefined || value === null) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function hasPartnerContext(partnerContext) {
  if (
    !partnerContext ||
    typeof partnerContext !== 'object' ||
    Array.isArray(partnerContext)
  ) {
    return false;
  }

  return [
    partnerContext.partnerCode,
    partnerContext.partnerId,
    partnerContext.organization,
    partnerContext.organizationCode,
    partnerContext.organizationId,
    partnerContext.assignedOrganizations,
    partnerContext.assignedOrganizationIds,
    partnerContext.assignedPartnerCodes,
    partnerContext.assignedWorkItemIds,
    partnerContext.assignedRecordIds,
  ].some((value) => {
    if (Array.isArray(value)) {
      return value.length > 0;
    }

    return (
      value !== null &&
      value !== undefined &&
      String(value).trim() !== ''
    );
  });
}

function hasExpiredSession(session, sessionExpired) {
  if (sessionExpired) {
    return true;
  }

  if (!session?.expiresAt) {
    return false;
  }

  const expiresAt = Date.parse(session.expiresAt);

  return Number.isNaN(expiresAt) || expiresAt <= Date.now();
}

function renderAccessFailure(element, redirectPath, location, reason) {
  if (element !== null && element !== undefined) {
    return element;
  }

  return (
    <Navigate
      replace
      state={{
        from: location,
        reason,
      }}
      to={redirectPath}
    />
  );
}

/**
 * Protects nested routes using the active authentication session, route
 * policy, role metadata, permissions, and optional partner record scope.
 */
export function ProtectedRoute({
  children,
  allowedRoles,
  roles,
  requiredPermissions,
  permissions,
  permission,
  partnerCode,
  partnerIdentifier,
  record,
  requirePartnerScope = false,
  enforceRoutePolicy = true,
  unauthenticatedElement = null,
  unauthorizedElement = null,
  loginPath = ROUTES.LOGIN,
  unauthorizedPath = ROUTES.FORBIDDEN,
}) {
  const location = useLocation();
  const authState = useAuthStore();
  const scopeGuard = useMemo(() => new PartnerScopeGuard(), []);
  const {
    checkSession,
    currentUser,
    isAuthenticated,
    isSessionExpired,
    partnerContext,
    role: storedRole,
    session,
    user,
  } = authState;
  const currentUserValue = currentUser ?? user;
  const role = storedRole ?? currentUserValue?.role ?? null;
  const sessionExpired = hasExpiredSession(
    session,
    isSessionExpired,
  );

  useEffect(() => {
    if (session && typeof checkSession === 'function') {
      checkSession();
    }
  }, [checkSession, location.pathname, session]);

  if (!isAuthenticated || sessionExpired) {
    return renderAccessFailure(
      unauthenticatedElement,
      loginPath,
      location,
      sessionExpired ? 'session_expired' : 'authentication_required',
    );
  }

  if (!role || !ALL_ROLES.includes(role)) {
    return renderAccessFailure(
      unauthorizedElement,
      unauthorizedPath,
      location,
      'invalid_role',
    );
  }

  const principal = {
    ...authState,
    user: currentUserValue,
    currentUser: currentUserValue,
    role,
    partnerContext,
    isAuthenticated: true,
    status: 'authenticated',
  };
  const acceptedRoles = normalizeList(allowedRoles ?? roles);

  if (acceptedRoles.length > 0 && !acceptedRoles.includes(role)) {
    return renderAccessFailure(
      unauthorizedElement,
      unauthorizedPath,
      location,
      'role_forbidden',
    );
  }

  const requiredPermissionValues = [
    ...new Set([
      ...normalizeList(requiredPermissions ?? permissions),
      ...normalizeList(permission),
    ]),
  ];
  const hasRequiredPermissions = requiredPermissionValues.every(
    (requiredPermission) =>
      canPerformAction(principal, requiredPermission),
  );

  if (!hasRequiredPermissions) {
    return renderAccessFailure(
      unauthorizedElement,
      unauthorizedPath,
      location,
      'permission_forbidden',
    );
  }

  const routePolicy = enforceRoutePolicy
    ? getRouteAccessPolicy(location.pathname)
    : undefined;

  if (
    routePolicy &&
    !canAccessRoute(principal, location.pathname, partnerContext)
  ) {
    return renderAccessFailure(
      unauthorizedElement,
      unauthorizedPath,
      location,
      'route_forbidden',
    );
  }

  const requestedPartner =
    partnerIdentifier ?? partnerCode ?? null;
  const partnerContextRequired =
    requirePartnerScope &&
    record === null &&
    requestedPartner === null;

  if (
    partnerContextRequired &&
    !hasPartnerContext(partnerContext)
  ) {
    return renderAccessFailure(
      unauthorizedElement,
      unauthorizedPath,
      location,
      'partner_scope_required',
    );
  }

  if (
    requestedPartner !== null &&
    requestedPartner !== undefined &&
    !scopeGuard.canAccessPartner(
      requestedPartner,
      principal,
      partnerContext,
    )
  ) {
    return renderAccessFailure(
      unauthorizedElement,
      unauthorizedPath,
      location,
      'partner_scope_forbidden',
    );
  }

  if (
    record !== null &&
    record !== undefined &&
    !scopeGuard.canAccessRecord(record, principal, partnerContext)
  ) {
    return renderAccessFailure(
      unauthorizedElement,
      unauthorizedPath,
      location,
      'record_scope_forbidden',
    );
  }

  return children === null || children === undefined ? (
    <Outlet />
  ) : (
    children
  );
}

ProtectedRoute.propTypes = {
  allowedRoles: PropTypes.arrayOf(PropTypes.string),
  children: PropTypes.node,
  enforceRoutePolicy: PropTypes.bool,
  loginPath: PropTypes.string,
  partnerCode: PropTypes.oneOfType([
    PropTypes.string,
    PropTypes.number,
  ]),
  partnerIdentifier: PropTypes.oneOfType([
    PropTypes.string,
    PropTypes.number,
  ]),
  permission: PropTypes.oneOfType([
    PropTypes.string,
    PropTypes.arrayOf(PropTypes.string),
  ]),
  permissions: PropTypes.oneOfType([
    PropTypes.string,
    PropTypes.arrayOf(PropTypes.string),
  ]),
  record: PropTypes.object,
  requirePartnerScope: PropTypes.bool,
  requiredPermissions: PropTypes.oneOfType([
    PropTypes.string,
    PropTypes.arrayOf(PropTypes.string),
  ]),
  roles: PropTypes.arrayOf(PropTypes.string),
  unauthenticatedElement: PropTypes.node,
  unauthorizedElement: PropTypes.node,
  unauthorizedPath: PropTypes.string,
};

export default ProtectedRoute;