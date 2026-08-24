import { useMemo, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ROLE_LABELS, ROLES } from '../../constants/roles.js';
import { ROUTES } from '../../constants/routes.js';
import { useAuthStore } from '../../stores/authStore.js';

function getHomePath(role) {
  if (role === ROLES.ADMIN) {
    return ROUTES.ADMIN_DASHBOARD;
  }

  if (role === ROLES.PARTNER || role === ROLES.AGENCY) {
    return ROUTES.PARTNER_DASHBOARD;
  }

  return ROUTES.OPERATIONS_DASHBOARD;
}

function getRequestedPath(location) {
  const from = location.state?.from;
  let requestedPath;

  if (typeof from === 'string') {
    requestedPath = from;
  } else if (from && typeof from === 'object') {
    requestedPath = `${from.pathname ?? ''}${from.search ?? ''}${
      from.hash ?? ''
    }`;
  }

  if (
    typeof requestedPath !== 'string' ||
    !requestedPath.startsWith('/') ||
    requestedPath.startsWith('//') ||
    requestedPath.split(/[?#]/, 1)[0] === ROUTES.LOGIN
  ) {
    return null;
  }

  return requestedPath;
}

function getDisplayName(user) {
  const name = [user?.firstName, user?.lastName]
    .filter(Boolean)
    .join(' ')
    .trim();

  return name || user?.email || 'Demo user';
}

/**
 * Displays mock authentication controls for pre-provisioned demo identities.
 */
export function LoginPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const {
    availableUsers,
    clearError,
    error: authError,
    isAuthenticated,
    isSessionExpired,
    login,
    role,
  } = useAuthStore();
  const [selectedUserId, setSelectedUserId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submissionError, setSubmissionError] = useState('');
  const requestedPath = getRequestedPath(location);
  const selectedUser = useMemo(
    () =>
      availableUsers.find((user) => user.id === selectedUserId) ?? null,
    [availableUsers, selectedUserId],
  );
  const sessionExpired =
    isSessionExpired || location.state?.reason === 'session_expired';
  const displayedError =
    submissionError ||
    (authError instanceof Error ? authError.message : '');
  const authenticatedDestination =
    requestedPath ?? getHomePath(role);

  if (isAuthenticated) {
    return <Navigate replace to={authenticatedDestination} />;
  }

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSubmissionError('');

    if (!selectedUserId) {
      setSubmissionError('Select a demo identity to continue.');
      return;
    }

    setSubmitting(true);

    try {
      if (typeof clearError === 'function') {
        clearError();
      }

      const user = await Promise.resolve(login(selectedUserId));
      const destination =
        requestedPath ?? getHomePath(user?.role ?? selectedUser?.role);

      navigate(destination, { replace: true });
    } catch (error) {
      setSubmissionError(
        error instanceof Error && error.message
          ? error.message
          : 'The demo session could not be started. Try again.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface-muted px-4 py-10 text-text sm:px-6 dark:bg-slate-950 dark:text-slate-100">
      <div className="w-full max-w-xl">
        <section
          aria-labelledby="login-title"
          className="overflow-hidden rounded-2xl border border-border bg-white shadow-elevated dark:border-slate-700 dark:bg-slate-900"
        >
          <div className="border-b border-border bg-lga-navy px-6 py-6 text-white sm:px-8 dark:border-slate-700">
            <div className="flex items-center gap-4">
              <span
                aria-hidden="true"
                className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-white text-xl font-bold text-lga-navy"
              >
                F
              </span>
              <div>
                <p className="text-sm font-medium text-primary-100">
                  Digital Onboarding
                </p>
                <h1
                  className="mt-1 text-2xl font-semibold"
                  id="login-title"
                >
                  Sign in to the simulation
                </h1>
              </div>
            </div>
          </div>

          <div className="space-y-6 p-6 sm:p-8">
            <div
              className="rounded-xl border border-accent-300 bg-accent-100 p-4 text-sm leading-6 text-accent-950 dark:border-accent-700 dark:bg-accent-950 dark:text-accent-100"
              role="note"
            >
              <p className="font-semibold">Simulation environment</p>
              <p className="mt-1">
                Select a pre-provisioned demo identity. Use synthetic data
                only. No production authentication, transactions, or external
                provider calls are performed.
              </p>
            </div>

            {sessionExpired && (
              <div
                className="rounded-xl border border-warning bg-warning-light p-4 text-sm text-warning-dark dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
                role="alert"
              >
                <p className="font-semibold">Your demo session expired</p>
                <p className="mt-1 leading-6">
                  Select an identity to start a new session and continue.
                </p>
              </div>
            )}

            {displayedError && (
              <div
                className="rounded-xl border border-danger bg-danger-light p-4 text-sm text-danger-dark dark:border-red-700 dark:bg-danger-dark dark:text-red-100"
                role="alert"
              >
                {displayedError}
              </div>
            )}

            <form noValidate onSubmit={handleSubmit}>
              <label
                className="block text-sm font-semibold text-text dark:text-slate-100"
                htmlFor="demo-identity"
              >
                Demo identity
              </label>
              <p
                className="mt-1 text-sm leading-6 text-text-muted dark:text-slate-400"
                id="demo-identity-help"
              >
                Each identity has preconfigured role permissions and record
                scope.
              </p>

              <select
                aria-describedby="demo-identity-help"
                aria-invalid={Boolean(submissionError && !selectedUserId)}
                className="mt-3 min-h-12 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text shadow-sm focus:border-lga-sky focus:outline-none focus:ring-2 focus:ring-lga-sky disabled:cursor-not-allowed disabled:bg-surface-muted disabled:opacity-70 dark:border-slate-600 dark:bg-slate-900 dark:text-white dark:disabled:bg-slate-800"
                disabled={submitting || availableUsers.length === 0}
                id="demo-identity"
                onChange={(event) => {
                  setSelectedUserId(event.target.value);
                  setSubmissionError('');

                  if (typeof clearError === 'function') {
                    clearError();
                  }
                }}
                value={selectedUserId}
              >
                <option value="">Select a demo identity</option>
                {availableUsers.map((user) => (
                  <option key={user.id} value={user.id}>
                    {getDisplayName(user)} —{' '}
                    {ROLE_LABELS[user.role] ?? user.role}
                  </option>
                ))}
              </select>

              {selectedUser && (
                <dl className="mt-4 grid gap-3 rounded-xl bg-surface-muted p-4 text-sm sm:grid-cols-2 dark:bg-slate-800">
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-text-muted dark:text-slate-400">
                      Role
                    </dt>
                    <dd className="mt-1 font-semibold text-text dark:text-white">
                      {ROLE_LABELS[selectedUser.role] ??
                        selectedUser.role}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-text-muted dark:text-slate-400">
                      Organization
                    </dt>
                    <dd className="mt-1 break-words font-semibold text-text dark:text-white">
                      {selectedUser.organization}
                    </dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="text-xs font-medium uppercase tracking-wide text-text-muted dark:text-slate-400">
                      Demo email
                    </dt>
                    <dd className="mt-1 break-all text-text dark:text-slate-200">
                      {selectedUser.email}
                    </dd>
                  </div>
                </dl>
              )}

              {availableUsers.length === 0 && (
                <p
                  className="mt-4 rounded-lg border border-danger bg-danger-light p-3 text-sm text-danger-dark dark:border-red-700 dark:bg-danger-dark dark:text-red-100"
                  role="alert"
                >
                  No demo identities are available. Reload the application and
                  try again.
                </p>
              )}

              <button
                className="mt-6 inline-flex min-h-12 w-full items-center justify-center rounded-lg bg-lga-navy px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-primary-800 focus:outline-none focus:ring-2 focus:ring-lga-sky focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-primary-600 dark:hover:bg-primary-500 dark:focus:ring-offset-slate-900"
                disabled={submitting || availableUsers.length === 0}
                type="submit"
              >
                {submitting ? 'Starting demo session…' : 'Continue'}
              </button>

              <div aria-live="polite" className="sr-only" role="status">
                {submitting ? 'Starting the selected demo session.' : ''}
              </div>
            </form>
          </div>
        </section>

        <p className="mt-5 text-center text-xs leading-5 text-text-muted dark:text-slate-400">
          Authorized simulation users only. Do not enter personal, banking, or
          production information.
        </p>
      </div>
    </main>
  );
}

export default LoginPage;