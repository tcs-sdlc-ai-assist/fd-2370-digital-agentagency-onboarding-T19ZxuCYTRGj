import { useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import {
  Link,
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import { canAccessRoute } from '../../auth/permissionPolicy.js';
import appConfig from '../../config/appConfig.js';
import { ROLE_LABELS, ROLES } from '../../constants/roles.js';
import { ROUTES } from '../../constants/routes.js';
import { useAuthStore } from '../../stores/authStore.js';

const EXTERNAL_NAVIGATION = Object.freeze([
  {
    label: 'Dashboard',
    path: ROUTES.PARTNER_DASHBOARD,
  },
  {
    label: 'Onboarding',
    path: ROUTES.PARTNER_ONBOARDING,
  },
  {
    label: 'Reports',
    path: ROUTES.PARTNER_REPORTS,
  },
  {
    label: 'Notifications',
    path: ROUTES.PARTNER_NOTIFICATIONS,
  },
]);

const OPERATIONS_NAVIGATION = Object.freeze([
  {
    label: 'Dashboard',
    path: ROUTES.OPERATIONS_DASHBOARD,
  },
  {
    label: 'Workbench',
    path: ROUTES.OPERATIONS_WORKBENCH,
  },
  {
    label: 'Onboarding',
    path: ROUTES.OPERATIONS_ONBOARDING,
  },
  {
    label: 'Exceptions',
    path: ROUTES.OPERATIONS_EXCEPTIONS,
  },
  {
    label: 'Contract changes',
    path: ROUTES.OPERATIONS_CONTRACT_CHANGES,
  },
  {
    label: 'Reports',
    path: ROUTES.OPERATIONS_REPORTS,
  },
  {
    label: 'Notifications',
    path: ROUTES.OPERATIONS_NOTIFICATIONS,
  },
]);

const ADMIN_NAVIGATION = Object.freeze([
  {
    label: 'Dashboard',
    path: ROUTES.ADMIN_DASHBOARD,
  },
  {
    label: 'Reference data',
    path: ROUTES.ADMIN_REFERENCE_DATA,
  },
  {
    label: 'Users',
    path: ROUTES.ADMIN_USERS,
  },
  {
    label: 'Configuration',
    path: ROUTES.ADMIN_CONFIGURATION,
  },
  {
    label: 'Diagnostics',
    path: ROUTES.DIAGNOSTICS,
    diagnosticsOnly: true,
  },
]);

function getNavigation(role) {
  if (role === ROLES.ADMIN) {
    return ADMIN_NAVIGATION;
  }

  if (role === ROLES.PARTNER || role === ROLES.AGENCY) {
    return EXTERNAL_NAVIGATION;
  }

  return OPERATIONS_NAVIGATION;
}

function getHomePath(role) {
  if (role === ROLES.ADMIN) {
    return ROUTES.ADMIN_DASHBOARD;
  }

  if (role === ROLES.PARTNER || role === ROLES.AGENCY) {
    return ROUTES.PARTNER_DASHBOARD;
  }

  return ROUTES.OPERATIONS_DASHBOARD;
}

function getInitials(user) {
  const initials = [user?.firstName, user?.lastName]
    .filter(Boolean)
    .map((value) => String(value).trim().charAt(0).toUpperCase())
    .join('');

  return initials || 'U';
}

function getDisplayName(user) {
  const displayName = [user?.firstName, user?.lastName]
    .filter(Boolean)
    .join(' ')
    .trim();

  return displayName || user?.email || 'Current user';
}

function NavigationLinks({ items, onNavigate }) {
  return (
    <ul className="space-y-1">
      {items.map((item) => (
        <li key={item.path}>
          <NavLink
            className={({ isActive }) =>
              `flex min-h-11 items-center rounded-lg px-3 py-2 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-lga-sky focus:ring-offset-2 ${
                isActive
                  ? 'bg-primary-50 text-lga-navy dark:bg-primary-950 dark:text-primary-100'
                  : 'text-text-muted hover:bg-surface-muted hover:text-lga-navy dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white'
              }`
            }
            onClick={onNavigate}
            to={item.path}
          >
            {item.label}
          </NavLink>
        </li>
      ))}
    </ul>
  );
}

NavigationLinks.propTypes = {
  items: PropTypes.arrayOf(
    PropTypes.shape({
      label: PropTypes.string.isRequired,
      path: PropTypes.string.isRequired,
    }),
  ).isRequired,
  onNavigate: PropTypes.func.isRequired,
};

/**
 * Provides the responsive protected application layout.
 */
export function AppShell({ children }) {
  const [mobileNavigationOpen, setMobileNavigationOpen] =
    useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef(null);
  const location = useLocation();
  const navigate = useNavigate();
  const authState = useAuthStore();
  const {
    currentUser,
    logout,
    partnerContext,
    role: storedRole,
    user,
  } = authState;
  const currentUserValue = currentUser ?? user;
  const role = storedRole ?? currentUserValue?.role ?? null;
  const principal = useMemo(
    () => ({
      ...authState,
      user: currentUserValue,
      currentUser: currentUserValue,
      role,
      partnerContext,
      isAuthenticated: true,
      status: 'authenticated',
    }),
    [authState, currentUserValue, partnerContext, role],
  );
  const navigationItems = useMemo(
    () =>
      getNavigation(role).filter(
        (item) =>
          (!item.diagnosticsOnly || appConfig.enableDiagnostics) &&
          canAccessRoute(principal, item.path, partnerContext),
      ),
    [partnerContext, principal, role],
  );
  const homePath = getHomePath(role);
  const displayName = getDisplayName(currentUserValue);
  const roleLabel = ROLE_LABELS[role] ?? 'User';
  const environmentLabel =
    appConfig.appEnv.charAt(0).toUpperCase() +
    appConfig.appEnv.slice(1);

  useEffect(() => {
    if (!userMenuOpen) {
      return undefined;
    }

    const handlePointerDown = (event) => {
      if (
        userMenuRef.current &&
        !userMenuRef.current.contains(event.target)
      ) {
        setUserMenuOpen(false);
      }
    };
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setUserMenuOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [userMenuOpen]);

  const handleLogout = () => {
    setUserMenuOpen(false);
    setMobileNavigationOpen(false);

    if (typeof logout === 'function') {
      logout();
    }

    navigate(ROUTES.LOGIN, { replace: true });
  };

  const closeMobileNavigation = () => {
    setMobileNavigationOpen(false);
  };

  return (
    <div className="min-h-screen bg-surface-muted text-text dark:bg-slate-950 dark:text-slate-100">
      <a
        className="sr-only z-50 rounded bg-white px-4 py-2 text-lga-navy shadow-focus focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
        href="#main-content"
      >
        Skip to main content
      </a>

      <div
        aria-label="Simulation environment notice"
        className="border-b border-accent-600 bg-accent-100 px-4 py-2 text-center text-sm font-medium text-accent-950 dark:border-accent-700 dark:bg-accent-950 dark:text-accent-100"
        role="status"
      >
        Simulation environment ({environmentLabel}) — use synthetic data
        only. No production transactions are performed.
      </div>

      <header className="sticky top-0 z-30 border-b border-border bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <div className="flex h-16 items-center gap-3 px-4 sm:px-6">
          <button
            aria-controls="mobile-navigation"
            aria-expanded={mobileNavigationOpen}
            aria-label={
              mobileNavigationOpen
                ? 'Close navigation menu'
                : 'Open navigation menu'
            }
            className="inline-flex size-11 items-center justify-center rounded-lg text-lga-navy transition-colors hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-lga-sky md:hidden dark:text-white dark:hover:bg-slate-800"
            onClick={() =>
              setMobileNavigationOpen((isOpen) => !isOpen)
            }
            type="button"
          >
            <svg
              aria-hidden="true"
              className="size-6"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              viewBox="0 0 24 24"
            >
              {mobileNavigationOpen ? (
                <path
                  d="M6 6l12 12M18 6L6 18"
                  strokeLinecap="round"
                />
              ) : (
                <path
                  d="M4 7h16M4 12h16M4 17h16"
                  strokeLinecap="round"
                />
              )}
            </svg>
          </button>

          <Link
            className="flex min-w-0 items-center gap-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-lga-sky focus:ring-offset-2"
            to={homePath}
          >
            <span
              aria-hidden="true"
              className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-lga-navy text-lg font-bold text-lga-gold"
            >
              F
            </span>
            <span className="hidden truncate text-lg font-semibold text-lga-navy sm:block dark:text-white">
              Digital Onboarding
            </span>
          </Link>

          <div className="ml-auto flex items-center gap-3">
            {partnerContext?.partnerCode && (
              <div className="hidden text-right lg:block">
                <p className="text-xs font-medium uppercase tracking-wide text-text-muted dark:text-slate-400">
                  Active partner
                </p>
                <p className="max-w-48 truncate text-sm font-semibold text-lga-navy dark:text-white">
                  {partnerContext.partnerCode}
                </p>
              </div>
            )}

            <div className="relative" ref={userMenuRef}>
              <button
                aria-expanded={userMenuOpen}
                aria-haspopup="menu"
                className="flex min-h-11 items-center gap-2 rounded-lg px-2 py-1 text-left transition-colors hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-lga-sky dark:hover:bg-slate-800"
                onClick={() =>
                  setUserMenuOpen((isOpen) => !isOpen)
                }
                type="button"
              >
                <span
                  aria-hidden="true"
                  className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary-100 text-sm font-bold text-lga-navy dark:bg-primary-900 dark:text-primary-100"
                >
                  {getInitials(currentUserValue)}
                </span>
                <span className="hidden min-w-0 sm:block">
                  <span className="block max-w-40 truncate text-sm font-semibold text-text dark:text-white">
                    {displayName}
                  </span>
                  <span className="block text-xs text-text-muted dark:text-slate-400">
                    {roleLabel}
                  </span>
                </span>
                <svg
                  aria-hidden="true"
                  className="size-4 text-text-muted"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                >
                  <path
                    d="M6 9l6 6 6-6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>

              {userMenuOpen && (
                <div
                  aria-label="User menu"
                  className="absolute right-0 mt-2 w-72 rounded-xl border border-border bg-white p-2 shadow-elevated dark:border-slate-700 dark:bg-slate-900"
                  role="menu"
                >
                  <div className="border-b border-border px-3 py-3 dark:border-slate-700">
                    <p className="truncate text-sm font-semibold text-text dark:text-white">
                      {displayName}
                    </p>
                    <p className="truncate text-sm text-text-muted dark:text-slate-400">
                      {currentUserValue?.email ?? roleLabel}
                    </p>
                    {currentUserValue?.organization && (
                      <p className="mt-2 truncate text-xs text-text-muted dark:text-slate-400">
                        {currentUserValue.organization}
                      </p>
                    )}
                  </div>
                  <button
                    className="mt-2 flex min-h-11 w-full items-center rounded-lg px-3 py-2 text-left text-sm font-medium text-danger transition-colors hover:bg-danger-light focus:outline-none focus:ring-2 focus:ring-danger dark:hover:bg-danger-dark"
                    onClick={handleLogout}
                    role="menuitem"
                    type="button"
                  >
                    Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-screen-2xl">
        <aside className="hidden w-64 shrink-0 border-r border-border bg-white px-4 py-6 md:block dark:border-slate-700 dark:bg-slate-900">
          <nav aria-label="Primary navigation">
            <NavigationLinks
              items={navigationItems}
              onNavigate={() => {}}
            />
          </nav>
        </aside>

        {mobileNavigationOpen && (
          <div className="fixed inset-0 z-40 md:hidden">
            <button
              aria-label="Close navigation"
              className="absolute inset-0 bg-slate-950/50"
              onClick={closeMobileNavigation}
              type="button"
            />
            <aside
              aria-label="Mobile navigation"
              className="relative h-full w-72 max-w-[85vw] overflow-y-auto bg-white p-4 shadow-elevated dark:bg-slate-900"
              id="mobile-navigation"
            >
              <div className="mb-5 flex items-center justify-between">
                <span className="text-base font-semibold text-lga-navy dark:text-white">
                  Navigation
                </span>
                <button
                  aria-label="Close navigation menu"
                  className="inline-flex size-11 items-center justify-center rounded-lg text-lga-navy hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-lga-sky dark:text-white dark:hover:bg-slate-800"
                  onClick={closeMobileNavigation}
                  type="button"
                >
                  <svg
                    aria-hidden="true"
                    className="size-6"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                  >
                    <path
                      d="M6 6l12 12M18 6L6 18"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              </div>
              <nav aria-label="Primary navigation">
                <NavigationLinks
                  items={navigationItems}
                  onNavigate={closeMobileNavigation}
                />
              </nav>
            </aside>
          </div>
        )}

        <main
          className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8"
          id="main-content"
          tabIndex="-1"
        >
          {children === null || children === undefined ? (
            <Outlet />
          ) : (
            children
          )}
        </main>
      </div>

      <footer className="border-t border-border bg-white px-4 py-4 text-center text-xs text-text-muted dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
        Digital Onboarding simulation. Synthetic data only.
        <span className="sr-only">
          Current path: {location.pathname}
        </span>
      </footer>
    </div>
  );
}

AppShell.propTypes = {
  children: PropTypes.node,
};

export default AppShell;