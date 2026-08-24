import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ROLE_LABELS, ROLES } from '../../constants/roles.js';
import { ROUTES } from '../../constants/routes.js';
import { useAuthStore } from '../../stores/authStore.js';

const DENIAL_MESSAGES = Object.freeze({
  invalid_role: Object.freeze({
    title: 'Your role cannot access this page',
    description:
      'Your account does not have a recognized role for this area. Return to your dashboard or contact an administrator for assistance.',
  }),
  role_forbidden: Object.freeze({
    title: 'Your role cannot access this page',
    description:
      'This area is limited to other application roles. Your account and saved information have not been changed.',
  }),
  permission_forbidden: Object.freeze({
    title: 'Additional permission is required',
    description:
      'Your current role does not include the permission required to perform this action.',
  }),
  route_forbidden: Object.freeze({
    title: 'You cannot open this area',
    description:
      'Your current role does not have access to the requested application area.',
  }),
  partner_scope_required: Object.freeze({
    title: 'A partner context is required',
    description:
      'Select or return to an authorized partner context before accessing this information.',
  }),
  partner_scope_forbidden: Object.freeze({
    title: 'This partner is outside your access scope',
    description:
      'Your account is not authorized to view information for the requested partner organization.',
  }),
  record_scope_forbidden: Object.freeze({
    title: 'This record is outside your access scope',
    description:
      'The requested record is not assigned to your account or authorized partner organization.',
  }),
});

const DEFAULT_DENIAL_MESSAGE = Object.freeze({
  title: 'You do not have access to this page',
  description:
    'Your current role or partner scope does not permit access to the requested information.',
});

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
 * Displays accessible authorization guidance when a role, permission, or
 * partner scope prevents access to a protected resource.
 */
export function UnauthorizedPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const {
    currentUser,
    isAuthenticated,
    partnerContext,
    role: storedRole,
    user,
  } = useAuthStore();
  const currentUserValue = currentUser ?? user;
  const role = storedRole ?? currentUserValue?.role ?? null;
  const reason =
    typeof location.state?.reason === 'string'
      ? location.state.reason
      : '';
  const denialMessage =
    DENIAL_MESSAGES[reason] ?? DEFAULT_DENIAL_MESSAGE;
  const roleLabel = role ? (ROLE_LABELS[role] ?? 'Unknown role') : null;
  const homePath = getHomePath(role);

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface-muted px-4 py-12 text-text sm:px-6 dark:bg-slate-950 dark:text-slate-100">
      <section
        aria-labelledby="access-denied-title"
        className="w-full max-w-2xl overflow-hidden rounded-2xl border border-border bg-white shadow-elevated dark:border-slate-700 dark:bg-slate-900"
      >
        <div className="border-b border-border bg-lga-navy px-6 py-6 text-white sm:px-8 dark:border-slate-700">
          <div className="flex items-center gap-4">
            <span
              aria-hidden="true"
              className="flex size-12 shrink-0 items-center justify-center rounded-full bg-white/15 text-white"
            >
              <svg
                className="size-7"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                viewBox="0 0 24 24"
              >
                <path
                  d="M12 3 4.5 6v5.2c0 4.7 3.2 8.9 7.5 9.8 4.3-.9 7.5-5.1 7.5-9.8V6L12 3Z"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="m9 9 6 6m0-6-6 6"
                  strokeLinecap="round"
                />
              </svg>
            </span>
            <div>
              <p className="text-sm font-medium text-primary-100">
                Authorization required
              </p>
              <h1
                className="mt-1 text-2xl font-semibold"
                id="access-denied-title"
              >
                Access denied
              </h1>
            </div>
          </div>
        </div>

        <div className="space-y-6 p-6 sm:p-8">
          <div role="alert">
            <h2 className="text-xl font-semibold text-lga-navy dark:text-white">
              {denialMessage.title}
            </h2>
            <p className="mt-3 text-sm leading-6 text-text-muted dark:text-slate-300">
              {denialMessage.description}
            </p>
          </div>

          {(roleLabel || partnerContext?.partnerCode) && (
            <dl className="grid gap-3 rounded-xl bg-surface-muted p-4 text-sm sm:grid-cols-2 dark:bg-slate-800">
              {roleLabel && (
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-text-muted dark:text-slate-400">
                    Current role
                  </dt>
                  <dd className="mt-1 font-semibold text-text dark:text-white">
                    {roleLabel}
                  </dd>
                </div>
              )}
              {partnerContext?.partnerCode && (
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-text-muted dark:text-slate-400">
                    Active partner
                  </dt>
                  <dd className="mt-1 break-words font-semibold text-text dark:text-white">
                    {partnerContext.partnerCode}
                  </dd>
                </div>
              )}
            </dl>
          )}

          <div className="flex flex-col gap-3 sm:flex-row">
            {isAuthenticated ? (
              <Link
                className="inline-flex min-h-11 items-center justify-center rounded-lg bg-lga-navy px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-800 focus:outline-none focus:ring-2 focus:ring-lga-sky focus:ring-offset-2 dark:bg-primary-600 dark:hover:bg-primary-500 dark:focus:ring-offset-slate-900"
                to={homePath}
              >
                Return to dashboard
              </Link>
            ) : (
              <Link
                className="inline-flex min-h-11 items-center justify-center rounded-lg bg-lga-navy px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-800 focus:outline-none focus:ring-2 focus:ring-lga-sky focus:ring-offset-2 dark:bg-primary-600 dark:hover:bg-primary-500 dark:focus:ring-offset-slate-900"
                to={ROUTES.LOGIN}
              >
                Sign in
              </Link>
            )}

            <button
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-border bg-white px-5 py-2 text-sm font-semibold text-lga-navy transition-colors hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-lga-sky focus:ring-offset-2 dark:border-slate-600 dark:bg-slate-900 dark:text-white dark:hover:bg-slate-800 dark:focus:ring-offset-slate-900"
              onClick={() => navigate(-1)}
              type="button"
            >
              Go back
            </button>
          </div>

          <p className="border-t border-border pt-4 text-xs leading-5 text-text-muted dark:border-slate-700 dark:text-slate-400">
            If you believe you should have access, contact an administrator
            and provide your role and the requested application area. Do not
            include personal, banking, or production information.
          </p>
        </div>
      </section>
    </main>
  );
}

export default UnauthorizedPage;