import PropTypes from 'prop-types';
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
} from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { ProtectedRoute } from './ProtectedRoute.jsx';
import {
  INTERNAL_ROLES,
  ROLE_PARTNER_SCOPE_MATRIX,
  ROLE_PERMISSION_MATRIX,
  ROLES,
} from '../../constants/roles.js';
import { useAuthStore } from '../../stores/authStore.js';

function RedirectDestination({ label }) {
  const location = useLocation();

  return (
    <div>
      <h1>{label}</h1>
      <p data-testid="redirect-reason">
        {location.state?.reason ?? 'no_reason'}
      </p>
    </div>
  );
}

RedirectDestination.propTypes = {
  label: PropTypes.string.isRequired,
};

function createUser(role, overrides = {}) {
  return {
    id: `usr_${role}_test`,
    email: `${role}.test@example.test`,
    firstName: 'Synthetic',
    lastName: 'User',
    organization: 'Synthetic Test Organization',
    partnerCode:
      role === ROLES.PARTNER ? 'DEMO_PARTNER' : undefined,
    role,
    status: 'active',
    ...overrides,
  };
}

function authenticateAs(role, options = {}) {
  const user = createUser(role, options.user);
  const partnerContext =
    options.partnerContext ??
    (role === ROLES.PARTNER || role === ROLES.AGENCY
      ? {
          partnerCode: 'DEMO_PARTNER',
          organization: user.organization,
          scopeType: ROLE_PARTNER_SCOPE_MATRIX[role],
        }
      : {
          partnerCode: null,
          organization: user.organization,
          scopeType: ROLE_PARTNER_SCOPE_MATRIX[role],
        });
  const expiresAt =
    options.expiresAt ??
    new Date(Date.now() + 60 * 60 * 1000).toISOString();

  useAuthStore.setState({
    user,
    currentUser: user,
    session: {
      sessionId: `SES-${role}-TEST`,
      userId: user.id,
      issuedAt: new Date(Date.now() - 1000).toISOString(),
      expiresAt,
    },
    partnerContext,
    activePartnerCode: partnerContext.partnerCode,
    role,
    permissions: [...(ROLE_PERMISSION_MATRIX[role] ?? [])],
    partnerScope: ROLE_PARTNER_SCOPE_MATRIX[role],
    isAuthenticated: true,
    isSessionExpired: options.isSessionExpired ?? false,
    status: 'authenticated',
    error: null,
  });
}

function renderProtectedRoute({
  allowedRoles,
  initialPath,
  partnerIdentifier,
  permission,
  requirePartnerScope = false,
}) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route
          element={
            <ProtectedRoute
              allowedRoles={allowedRoles}
              partnerIdentifier={partnerIdentifier}
              permission={permission}
              requirePartnerScope={requirePartnerScope}
            >
              <h1>Protected content</h1>
            </ProtectedRoute>
          }
          path={initialPath}
        />
        <Route
          element={<RedirectDestination label="Sign in" />}
          path="/login"
        />
        <Route
          element={<RedirectDestination label="Access denied" />}
          path="/forbidden"
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ProtectedRoute', () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
    useAuthStore.getState().logout();
    useAuthStore.setState({
      error: null,
      isSessionExpired: false,
    });
  });

  it('redirects unauthenticated users to sign in', async () => {
    renderProtectedRoute({
      initialPath: '/secure',
    });

    expect(
      await screen.findByRole('heading', { name: 'Sign in' }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('redirect-reason')).toHaveTextContent(
      'authentication_required',
    );
    expect(
      screen.queryByRole('heading', { name: 'Protected content' }),
    ).not.toBeInTheDocument();
  });

  it('redirects expired sessions to sign in with an expiration reason', async () => {
    authenticateAs(ROLES.OPERATIONS, {
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });

    renderProtectedRoute({
      allowedRoles: INTERNAL_ROLES,
      initialPath: '/operations/workbench',
    });

    expect(
      await screen.findByRole('heading', { name: 'Sign in' }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('redirect-reason')).toHaveTextContent(
      'session_expired',
    );
  });

  it('denies authenticated users whose role is not allowed', async () => {
    authenticateAs(ROLES.PARTNER);

    renderProtectedRoute({
      allowedRoles: [ROLES.ADMIN],
      initialPath: '/secure',
    });

    expect(
      await screen.findByRole('heading', {
        name: 'Access denied',
      }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('redirect-reason')).toHaveTextContent(
      'role_forbidden',
    );
  });

  it('renders an allowed route for an authenticated permitted role', () => {
    authenticateAs(ROLES.LICENSING);

    renderProtectedRoute({
      allowedRoles: INTERNAL_ROLES,
      initialPath: '/operations/workbench',
    });

    expect(
      screen.getByRole('heading', { name: 'Protected content' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Access denied' }),
    ).not.toBeInTheDocument();
  });

  it('allows a direct partner deep link within the active partner scope', () => {
    authenticateAs(ROLES.PARTNER, {
      partnerContext: {
        partnerCode: 'DEMO_PARTNER',
        organization: 'Demo Partner Network',
        scopeType: ROLE_PARTNER_SCOPE_MATRIX[ROLES.PARTNER],
      },
    });

    renderProtectedRoute({
      allowedRoles: [ROLES.PARTNER, ROLES.AGENCY],
      initialPath: '/partner/onboarding/APP-DEMO-1001',
      partnerIdentifier: 'DEMO_PARTNER',
      requirePartnerScope: true,
    });

    expect(
      screen.getByRole('heading', { name: 'Protected content' }),
    ).toBeInTheDocument();
  });

  it('denies a direct partner deep link outside the active partner scope', async () => {
    authenticateAs(ROLES.PARTNER, {
      partnerContext: {
        partnerCode: 'DEMO_PARTNER',
        organization: 'Demo Partner Network',
        scopeType: ROLE_PARTNER_SCOPE_MATRIX[ROLES.PARTNER],
      },
    });

    renderProtectedRoute({
      allowedRoles: [ROLES.PARTNER, ROLES.AGENCY],
      initialPath: '/partner/onboarding/APP-OTHER-1001',
      partnerIdentifier: 'OTHER_PARTNER',
      requirePartnerScope: true,
    });

    expect(
      await screen.findByRole('heading', {
        name: 'Access denied',
      }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('redirect-reason')).toHaveTextContent(
      'partner_scope_forbidden',
    );
    expect(
      screen.queryByRole('heading', { name: 'Protected content' }),
    ).not.toBeInTheDocument();
  });
});