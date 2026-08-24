import { Link } from 'react-router-dom';
import { ROLES } from '../constants/roles.js';
import { ROUTES } from '../constants/routes.js';
import { useAuthStore } from '../stores/authStore.js';

function getHomePath(role) {
  if (role === ROLES.ADMIN) {
    return ROUTES.ADMIN_DASHBOARD;
  }

  if (role === ROLES.PARTNER || role === ROLES.AGENCY) {
    return ROUTES.PARTNER_DASHBOARD;
  }

  if (
    [
      ROLES.LICENSING,
      ROLES.MANAGER,
      ROLES.DISTRIBUTION,
      ROLES.OPERATIONS,
    ].includes(role)
  ) {
    return ROUTES.OPERATIONS_DASHBOARD;
  }

  return ROUTES.ROOT;
}

/**
 * Displays a safe fallback when a route is unavailable without revealing
 * whether a protected resource exists.
 */
export function NotFoundPage() {
  const {
    currentUser,
    isAuthenticated,
    role: storedRole,
    user,
  } = useAuthStore();
  const currentUserValue = currentUser ?? user;
  const role = storedRole ?? currentUserValue?.role ?? null;
  const destination = isAuthenticated
    ? getHomePath(role)
    : ROUTES.LOGIN;

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface-muted px-4 py-12 text-text sm:px-6 dark:bg-slate-950 dark:text-slate-100">
      <section
        aria-labelledby="not-found-title"
        className="w-full max-w-2xl overflow-hidden rounded-2xl border border-border bg-white shadow-elevated dark:border-slate-700 dark:bg-slate-900"
      >
        <div className="border-b border-border bg-lga-navy px-6 py-6 text-white sm:px-8 dark:border-slate-700">
          <div className="flex items-center gap-4">
            <span
              aria-hidden="true"
              className="flex size-12 shrink-0 items-center justify-center rounded-full bg-white/15 text-lg font-bold"
            >
              404
            </span>
            <div>
              <p className="text-sm font-medium text-primary-100">
                Page unavailable
              </p>
              <h1
                className="mt-1 text-2xl font-semibold"
                id="not-found-title"
              >
                We could not find that page
              </h1>
            </div>
          </div>
        </div>

        <div className="p-6 sm:p-8">
          <p className="text-sm leading-6 text-text-muted dark:text-slate-300">
            The requested page may be unavailable, may have moved, or may not
            be accessible from your current session. No application data has
            been changed.
          </p>

          <div className="mt-6">
            <Link
              className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-lga-navy px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-800 focus:outline-none focus:ring-2 focus:ring-lga-sky focus:ring-offset-2 sm:w-auto dark:bg-primary-600 dark:hover:bg-primary-500 dark:focus:ring-offset-slate-900"
              to={destination}
            >
              {isAuthenticated ? 'Return to dashboard' : 'Go to sign in'}
            </Link>
          </div>

          <p className="mt-6 border-t border-border pt-4 text-xs leading-5 text-text-muted dark:border-slate-700 dark:text-slate-400">
            If you need assistance, contact an administrator without including
            personal, banking, licensing, or production information.
          </p>
        </div>
      </section>
    </main>
  );
}

export default NotFoundPage;