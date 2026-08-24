import { useCallback, useEffect, useState } from 'react';
import { RouterProvider } from 'react-router-dom';
import ErrorBoundary from './components/layout/ErrorBoundary.jsx';
import { runPersistenceMigrations } from './persistence/migrationCoordinator.js';
import { router } from './router.jsx';
import { useApplicationStore } from './stores/applicationStore.js';
import { useAuthStore } from './stores/authStore.js';
import { useUiStore } from './stores/uiStore.js';

let bootstrapPromise = null;

async function bootstrapApplication() {
  const migrationResult = runPersistenceMigrations();

  await Promise.resolve();

  const authHydrated = useAuthStore.getState().hydrate();
  const applicationHydrated =
    useApplicationStore.getState().hydrate();
  const uiHydrated = useUiStore.getState().hydrate();

  if (
    applicationHydrated === false &&
    useApplicationStore.getState().error
  ) {
    throw useApplicationStore.getState().error;
  }

  if (uiHydrated === false && useUiStore.getState().error) {
    throw useUiStore.getState().error;
  }

  return {
    migrationResult,
    authHydrated,
    applicationHydrated,
    uiHydrated,
  };
}

function getBootstrapPromise() {
  if (!bootstrapPromise) {
    bootstrapPromise = bootstrapApplication().catch((error) => {
      bootstrapPromise = null;
      throw error;
    });
  }

  return bootstrapPromise;
}

function ApplicationBootstrap() {
  const [bootstrapState, setBootstrapState] = useState({
    loading: true,
    error: null,
  });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;

    setBootstrapState({
      loading: true,
      error: null,
    });

    getBootstrapPromise()
      .then(() => {
        if (active) {
          setBootstrapState({
            loading: false,
            error: null,
          });
        }
      })
      .catch((error) => {
        if (active) {
          setBootstrapState({
            loading: false,
            error:
              error instanceof Error
                ? error
                : new Error(
                    'The application could not be initialized.',
                  ),
          });
        }
      });

    return () => {
      active = false;
    };
  }, [attempt]);

  const retryBootstrap = useCallback(() => {
    bootstrapPromise = null;
    setAttempt((currentAttempt) => currentAttempt + 1);
  }, []);

  if (bootstrapState.loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-surface-muted px-4 py-12 text-text dark:bg-slate-950 dark:text-slate-100">
        <section
          aria-busy="true"
          aria-labelledby="application-loading-title"
          className="w-full max-w-xl rounded-2xl border border-border bg-white p-6 text-center shadow-card sm:p-8 dark:border-slate-700 dark:bg-slate-900"
        >
          <div
            aria-hidden="true"
            className="mx-auto flex size-12 items-center justify-center rounded-xl bg-lga-navy text-xl font-bold text-lga-gold"
          >
            F
          </div>
          <h1
            className="mt-5 text-xl font-semibold text-lga-navy dark:text-white"
            id="application-loading-title"
          >
            Preparing Digital Onboarding
          </h1>
          <p
            className="mt-2 text-sm leading-6 text-text-muted dark:text-slate-300"
            role="status"
          >
            Checking saved simulation data and restoring application state.
          </p>
        </section>
      </main>
    );
  }

  if (bootstrapState.error) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-surface-muted px-4 py-12 text-text dark:bg-slate-950 dark:text-slate-100">
        <section
          aria-labelledby="application-bootstrap-error-title"
          className="w-full max-w-2xl rounded-2xl border border-danger bg-white p-6 shadow-elevated sm:p-8 dark:border-red-800 dark:bg-slate-900"
          role="alert"
        >
          <div
            aria-hidden="true"
            className="flex size-12 items-center justify-center rounded-full bg-danger-light text-xl font-bold text-danger dark:bg-danger-dark dark:text-red-100"
          >
            !
          </div>
          <h1
            className="mt-5 text-2xl font-semibold text-lga-navy dark:text-white"
            id="application-bootstrap-error-title"
          >
            The application could not be prepared
          </h1>
          <p className="mt-3 text-sm leading-6 text-text-muted dark:text-slate-300">
            Saved simulation data could not be checked or restored. Try
            initializing the application again.
          </p>
          <button
            className="mt-6 inline-flex min-h-11 items-center justify-center rounded-lg bg-lga-navy px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-800 focus:outline-none focus:ring-2 focus:ring-lga-sky focus:ring-offset-2 dark:bg-primary-600 dark:hover:bg-primary-500 dark:focus:ring-offset-slate-900"
            onClick={retryBootstrap}
            type="button"
          >
            Try again
          </button>
          <p className="mt-6 border-t border-border pt-4 text-xs leading-5 text-text-muted dark:border-slate-700 dark:text-slate-400">
            Do not include personal, banking, licensing, or production
            information when reporting initialization problems.
          </p>
        </section>
      </main>
    );
  }

  return <RouterProvider router={router} />;
}

/**
 * Composes global recovery, persistence migration, store hydration, and the
 * application browser router.
 */
export function App() {
  return (
    <ErrorBoundary>
      <ApplicationBootstrap />
    </ErrorBoundary>
  );
}

export default App;