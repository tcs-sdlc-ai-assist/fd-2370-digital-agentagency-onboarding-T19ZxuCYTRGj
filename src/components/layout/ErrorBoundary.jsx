import { Component } from 'react';
import PropTypes from 'prop-types';
import { createLogger } from '../../utils/logger.js';

const errorBoundaryLogger = createLogger('ErrorBoundary');

function createErrorReference() {
  return `UI-${Date.now().toString(36).toUpperCase()}`;
}

function resetKeysChanged(previousKeys, currentKeys) {
  if (previousKeys.length !== currentKeys.length) {
    return true;
  }

  return previousKeys.some(
    (key, index) => !Object.is(key, currentKeys[index]),
  );
}

/**
 * Catches recoverable client rendering errors and presents safe recovery
 * guidance without exposing error details.
 */
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);

    this.state = {
      error: null,
      errorReference: null,
    };
  }

  static getDerivedStateFromError(error) {
    return {
      error,
      errorReference: createErrorReference(),
    };
  }

  componentDidCatch(error, errorInfo) {
    const { onError } = this.props;
    const { errorReference } = this.state;
    const diagnostic = {
      error,
      errorReference,
      componentStack: errorInfo.componentStack,
    };

    errorBoundaryLogger.error(
      'A recoverable client rendering error was caught.',
      diagnostic,
    );

    if (typeof onError === 'function') {
      try {
        onError({
          errorReference,
          diagnostic,
        });
      } catch (callbackError) {
        errorBoundaryLogger.error(
          'The error boundary callback failed.',
          callbackError,
        );
      }
    }
  }

  componentDidUpdate(previousProps) {
    const { error } = this.state;
    const { resetKeys } = this.props;

    if (
      error &&
      resetKeysChanged(previousProps.resetKeys, resetKeys)
    ) {
      this.resetErrorBoundary('reset_keys_changed');
    }
  }

  resetErrorBoundary = (reason = 'user_retry') => {
    const { onReset } = this.props;
    const { errorReference } = this.state;

    this.setState({
      error: null,
      errorReference: null,
    });

    if (typeof onReset === 'function') {
      try {
        onReset({
          errorReference,
          reason,
        });
      } catch (callbackError) {
        errorBoundaryLogger.error(
          'The error boundary reset callback failed.',
          callbackError,
        );
      }
    }
  };

  reloadApplication = () => {
    const { errorReference } = this.state;

    errorBoundaryLogger.info('Reloading after a client error.', {
      errorReference,
    });

    window.location.reload();
  };

  renderDefaultFallback() {
    const { homePath } = this.props;
    const { errorReference } = this.state;

    return (
      <main
        className="flex min-h-screen items-center justify-center bg-surface-muted px-4 py-12 text-text dark:bg-slate-950 dark:text-slate-100"
        id="main-content"
      >
        <section
          aria-labelledby="client-error-title"
          className="w-full max-w-2xl rounded-2xl border border-border bg-white p-6 shadow-card sm:p-8 dark:border-slate-700 dark:bg-slate-900"
          role="alert"
        >
          <div
            aria-hidden="true"
            className="mb-5 flex size-12 items-center justify-center rounded-full bg-danger-light text-danger dark:bg-danger-dark dark:text-red-100"
          >
            <svg
              className="size-6"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              viewBox="0 0 24 24"
            >
              <path
                d="M12 9v4m0 4h.01M10.3 4.2 2.8 17.1A2 2 0 0 0 4.5 20h15a2 2 0 0 0 1.7-2.9L13.7 4.2a2 2 0 0 0-3.4 0Z"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>

          <h1
            className="text-2xl font-semibold text-lga-navy dark:text-white"
            id="client-error-title"
          >
            We could not display this page
          </h1>
          <p className="mt-3 text-sm leading-6 text-text-muted dark:text-slate-300">
            The application encountered a temporary problem. Your saved
            information should remain available. Try the page again, or
            return to the dashboard and resume your work.
          </p>

          {errorReference && (
            <p className="mt-4 text-xs text-text-muted dark:text-slate-400">
              Support reference:{' '}
              <span className="font-mono font-medium">
                {errorReference}
              </span>
            </p>
          )}

          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <button
              className="inline-flex min-h-11 items-center justify-center rounded-lg bg-lga-navy px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-800 focus:outline-none focus:ring-2 focus:ring-lga-sky focus:ring-offset-2 dark:bg-primary-600 dark:hover:bg-primary-500"
              onClick={() => this.resetErrorBoundary()}
              type="button"
            >
              Try again
            </button>
            <a
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-border px-5 py-2 text-sm font-semibold text-lga-navy transition-colors hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-lga-sky focus:ring-offset-2 dark:border-slate-600 dark:text-white dark:hover:bg-slate-800"
              href={homePath}
            >
              Return to dashboard
            </a>
            <button
              className="inline-flex min-h-11 items-center justify-center rounded-lg px-5 py-2 text-sm font-medium text-text-muted transition-colors hover:bg-surface-muted hover:text-lga-navy focus:outline-none focus:ring-2 focus:ring-lga-sky focus:ring-offset-2 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
              onClick={this.reloadApplication}
              type="button"
            >
              Reload application
            </button>
          </div>

          <p className="mt-6 border-t border-border pt-4 text-xs leading-5 text-text-muted dark:border-slate-700 dark:text-slate-400">
            If the problem continues, provide the support reference above
            when reporting the issue. Do not include personal, banking, or
            production information.
          </p>
        </section>
      </main>
    );
  }

  render() {
    const { children, fallback } = this.props;
    const { error, errorReference } = this.state;

    if (!error) {
      return children;
    }

    if (typeof fallback === 'function') {
      return fallback({
        errorReference,
        reloadApplication: this.reloadApplication,
        resetErrorBoundary: this.resetErrorBoundary,
      });
    }

    if (fallback !== null && fallback !== undefined) {
      return fallback;
    }

    return this.renderDefaultFallback();
  }
}

ErrorBoundary.propTypes = {
  children: PropTypes.node.isRequired,
  fallback: PropTypes.oneOfType([PropTypes.node, PropTypes.func]),
  homePath: PropTypes.string,
  onError: PropTypes.func,
  onReset: PropTypes.func,
  resetKeys: PropTypes.arrayOf(PropTypes.any),
};

ErrorBoundary.defaultProps = {
  fallback: null,
  homePath: '/',
  onError: undefined,
  onReset: undefined,
  resetKeys: [],
};

export default ErrorBoundary;