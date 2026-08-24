import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { canPerformAction } from '../../auth/permissionPolicy.js';
import DataTable from '../../components/shared/DataTable.jsx';
import JsonViewer from '../../components/shared/JsonViewer.jsx';
import StatusBadge from '../../components/shared/StatusBadge.jsx';
import appConfig, {
  PERSISTENCE_SCHEMA_VERSION,
} from '../../config/appConfig.js';
import { PERMISSIONS } from '../../constants/roles.js';
import { ROUTES } from '../../constants/routes.js';
import {
  STORAGE_KEYS,
  STORAGE_NAMESPACE,
  STORAGE_NAMESPACE_ROOT,
} from '../../constants/storageKeys.js';
import { storageEnvelopeSchema } from '../../contracts/schemas.js';
import { BrowserStorageAdapter } from '../../persistence/browserStorageAdapter.js';
import {
  FIXTURE_SCHEMAS,
  getSeeds,
  RAW_FIXTURES,
  resetSeeds,
} from '../../persistence/seedLoader.js';
import { useAuthStore } from '../../stores/authStore.js';
import { formatDisplayDateTime } from '../../utils/dates.js';

const RESET_CONFIRMATION_TEXT = 'RESET DEMO DATA';
const CLEAR_CONFIRMATION_TEXT = 'CLEAR ALL DEMO DATA';

const RESETTABLE_STORAGE_PREFIXES = Object.freeze([
  STORAGE_KEYS.APP_STATE,
  STORAGE_KEYS.INTAKE,
  STORAGE_KEYS.ONBOARDING,
  STORAGE_KEYS.OPERATIONS,
  STORAGE_KEYS.REFERENCE_DATA,
]);

const FIXTURE_LABELS = Object.freeze({
  historicalAssets: 'Historical assets',
  intakeSamples: 'Intake samples',
  onboardingRecords: 'Onboarding records',
  operationsData: 'Operations data',
  providerResponses: 'Provider responses',
  referenceConfig: 'Reference configuration',
  users: 'Demo users',
});

function createPrincipal(authState) {
  const currentUser = authState.currentUser ?? authState.user;
  const role = authState.role ?? currentUser?.role ?? null;

  return {
    ...authState,
    user: currentUser,
    currentUser,
    role,
    partnerContext: authState.partnerContext,
    isAuthenticated: authState.isAuthenticated,
    status: authState.isAuthenticated
      ? 'authenticated'
      : 'anonymous',
  };
}

function formatDate(value) {
  if (value === null || value === undefined || value === '') {
    return 'Not available';
  }

  try {
    return formatDisplayDateTime(value);
  } catch {
    return 'Not available';
  }
}

function formatToken(value) {
  const normalizedValue = String(value ?? '').trim();

  if (normalizedValue === '') {
    return 'Not available';
  }

  return normalizedValue
    .replace(/[_:-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function getFixtureRecordCount(fixture) {
  if (Array.isArray(fixture)) {
    return fixture.length;
  }

  if (!fixture || typeof fixture !== 'object') {
    return 0;
  }

  const collections = [
    'samples',
    'records',
    'workItems',
    'assignments',
    'lifecycleEvents',
    'notificationLogs',
    'syncAttempts',
    'contractChanges',
    'providers',
    'contracts',
    'terminations',
    'backgroundChecks',
    'appointments',
    'licenses',
    'uplines',
    'assignees',
    'generatedCodes',
    'carriers',
    'generalAgencies',
    'agencyTypes',
    'levels',
    'schedules',
    'roles',
  ];

  return collections.reduce((count, field) => {
    const value = fixture[field];

    return count + (Array.isArray(value) ? value.length : 0);
  }, 0);
}

function formatFixtureIssues(error) {
  if (!Array.isArray(error?.issues)) {
    return [];
  }

  return error.issues.slice(0, 10).map((issue) => ({
    path: issue.path.length > 0 ? issue.path.join('.') : 'fixture',
    message: issue.message,
  }));
}

function validateFixtureDiagnostics() {
  return Object.entries(FIXTURE_SCHEMAS).map(([fixtureName, schema]) => {
    const fixture = RAW_FIXTURES[fixtureName];
    const result = schema.safeParse(fixture);

    return {
      fixtureName,
      label: FIXTURE_LABELS[fixtureName] ?? formatToken(fixtureName),
      valid: result.success,
      fixtureVersion:
        fixture?.fixtureVersion ??
        (fixtureName === 'users' ? 'Built-in' : 'Not specified'),
      schemaVersion:
        fixture?.schemaVersion ??
        (fixtureName === 'users'
          ? PERSISTENCE_SCHEMA_VERSION
          : null),
      recordCount: getFixtureRecordCount(fixture),
      issues: result.success ? [] : formatFixtureIssues(result.error),
    };
  });
}

function getStorageCategory(key) {
  const match = Object.entries(STORAGE_KEYS).find(
    ([, aggregateKey]) =>
      key === aggregateKey || key.startsWith(`${aggregateKey}:`),
  );

  return match ? formatToken(match[0]) : 'Other';
}

function getRelativeStorageKey(key) {
  if (key.startsWith(`${STORAGE_NAMESPACE}:`)) {
    return key.slice(STORAGE_NAMESPACE.length + 1);
  }

  if (key.startsWith(`${STORAGE_NAMESPACE_ROOT}:`)) {
    return key.slice(STORAGE_NAMESPACE_ROOT.length + 1);
  }

  return 'Unscoped entry';
}

function collectStorageDiagnostics() {
  let storage;

  try {
    storage = globalThis.localStorage;
  } catch (error) {
    return {
      available: false,
      error:
        error instanceof Error
          ? error.message
          : 'Browser storage is unavailable.',
      entries: [],
      counts: {
        current: 0,
        legacy: 0,
        invalid: 0,
        total: 0,
      },
    };
  }

  if (
    !storage ||
    typeof storage.getItem !== 'function' ||
    typeof storage.key !== 'function'
  ) {
    return {
      available: false,
      error: 'Browser storage is unavailable.',
      entries: [],
      counts: {
        current: 0,
        legacy: 0,
        invalid: 0,
        total: 0,
      },
    };
  }

  const entries = [];

  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);

      if (
        typeof key !== 'string' ||
        (key !== STORAGE_NAMESPACE_ROOT &&
          !key.startsWith(`${STORAGE_NAMESPACE_ROOT}:`))
      ) {
        continue;
      }

      const serializedValue = storage.getItem(key);
      let schemaVersion = null;
      let savedAt = null;
      let status = 'invalid';

      try {
        const parsedValue = JSON.parse(serializedValue);
        const result = storageEnvelopeSchema.safeParse(parsedValue);

        if (result.success) {
          schemaVersion = result.data.schemaVersion;
          savedAt = result.data.savedAt;
          status =
            result.data.schemaVersion === PERSISTENCE_SCHEMA_VERSION
              ? 'current'
              : 'legacy';
        }
      } catch {
        status = 'invalid';
      }

      entries.push({
        key,
        relativeKey: getRelativeStorageKey(key),
        category: getStorageCategory(key),
        schemaVersion,
        savedAt,
        status,
      });
    }
  } catch (error) {
    return {
      available: false,
      error:
        error instanceof Error
          ? error.message
          : 'Browser storage could not be inspected.',
      entries: [],
      counts: {
        current: 0,
        legacy: 0,
        invalid: 0,
        total: 0,
      },
    };
  }

  const counts = {
    current: entries.filter((entry) => entry.status === 'current').length,
    legacy: entries.filter((entry) => entry.status === 'legacy').length,
    invalid: entries.filter((entry) => entry.status === 'invalid').length,
    total: entries.length,
  };

  return {
    available: true,
    error: null,
    entries,
    counts,
  };
}

function removeStorageByPrefixes(prefixes) {
  const storage = globalThis.localStorage;
  const matchingKeys = [];

  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);

    if (
      typeof key === 'string' &&
      prefixes.some(
        (prefix) => key === prefix || key.startsWith(`${prefix}:`),
      )
    ) {
      matchingKeys.push(key);
    }
  }

  matchingKeys.forEach((key) => {
    storage.removeItem(key);
  });

  return matchingKeys.length;
}

function createSafeDiagnostics({
  fixtureResults,
  generatedAt,
  principal,
  storageStatus,
}) {
  const seeds = getSeeds();

  return {
    generatedAt,
    application: {
      environment: appConfig.appEnv,
      diagnosticsEnabled: appConfig.enableDiagnostics,
      persistenceSchemaVersion:
        appConfig.persistenceSchemaVersion,
      buildTarget: 'browser',
      simulation: true,
    },
    authorization: {
      authenticated: principal.isAuthenticated === true,
      role: principal.role ?? null,
      partnerScopeType:
        principal.partnerContext?.scopeType ?? null,
    },
    fixtures: {
      valid:
        fixtureResults.length > 0 &&
        fixtureResults.every((fixture) => fixture.valid),
      fixtureCount: fixtureResults.length,
      invalidFixtureCount: fixtureResults.filter(
        (fixture) => !fixture.valid,
      ).length,
      onboardingRecordCount: seeds.onboardingRecords.length,
      workItemCount: seeds.workItems.length,
      lifecycleEventCount: seeds.lifecycleEvents.length,
      providerDefinitionCount: seeds.providerDefinitions.length,
      userCount: seeds.users.length,
    },
    storage: {
      available: storageStatus.available,
      namespace: STORAGE_NAMESPACE,
      expectedSchemaVersion: PERSISTENCE_SCHEMA_VERSION,
      entryCount: storageStatus.counts.total,
      currentEntryCount: storageStatus.counts.current,
      legacyEntryCount: storageStatus.counts.legacy,
      invalidEntryCount: storageStatus.counts.invalid,
      error: storageStatus.error,
    },
    safeguards: {
      containsProductionData: false,
      externalProviderCallsEnabled: false,
      valuesRedactedForDisplay: true,
    },
  };
}

function SummaryCard({ description, label, tone, value }) {
  const toneClasses = {
    danger:
      'border-danger bg-danger-light dark:border-red-800 dark:bg-red-950',
    info:
      'border-info bg-info-light dark:border-primary-700 dark:bg-primary-950',
    success:
      'border-success bg-success-light dark:border-green-800 dark:bg-green-950',
    warning:
      'border-warning bg-warning-light dark:border-amber-700 dark:bg-amber-950',
  };

  return (
    <article
      className={`rounded-xl border p-5 shadow-card ${
        toneClasses[tone] ?? toneClasses.info
      }`}
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-text-muted dark:text-slate-300">
        {label}
      </p>
      <p className="mt-2 text-3xl font-semibold text-lga-navy dark:text-white">
        {value}
      </p>
      <p className="mt-2 text-sm leading-5 text-text-muted dark:text-slate-300">
        {description}
      </p>
    </article>
  );
}

SummaryCard.propTypes = {
  description: PropTypes.node.isRequired,
  label: PropTypes.string.isRequired,
  tone: PropTypes.oneOf(['danger', 'info', 'success', 'warning'])
    .isRequired,
  value: PropTypes.oneOfType([
    PropTypes.string,
    PropTypes.number,
  ]).isRequired,
};

function ResetControl({
  busy,
  confirmation,
  confirmationText,
  danger = false,
  description,
  label,
  onChange,
  onSubmit,
  title,
}) {
  const confirmed = confirmation === confirmationText;

  return (
    <form
      className={`rounded-xl border p-5 ${
        danger
          ? 'border-danger bg-danger-light dark:border-red-800 dark:bg-red-950'
          : 'border-warning bg-warning-light dark:border-amber-700 dark:bg-amber-950'
      }`}
      onSubmit={onSubmit}
    >
      <h3 className="font-semibold text-lga-navy dark:text-white">
        {title}
      </h3>
      <p className="mt-2 text-sm leading-6 text-text-muted dark:text-slate-300">
        {description}
      </p>

      <label
        className="mt-4 block text-sm font-medium text-text dark:text-slate-100"
        htmlFor={label}
      >
        Type{' '}
        <span className="font-mono font-semibold">
          {confirmationText}
        </span>{' '}
        to confirm
      </label>
      <input
        autoComplete="off"
        className="mt-2 min-h-11 w-full rounded-lg border border-border bg-white px-3 py-2 font-mono text-sm text-text shadow-sm focus:border-lga-sky focus:outline-none focus:ring-2 focus:ring-lga-sky disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
        disabled={busy}
        id={label}
        onChange={(event) => onChange(event.target.value)}
        value={confirmation}
      />

      <button
        className={`mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-lg px-5 py-2 text-sm font-semibold text-white transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
          danger
            ? 'bg-danger hover:bg-danger-dark focus:ring-danger'
            : 'bg-warning-dark hover:bg-amber-800 focus:ring-warning'
        }`}
        disabled={busy || !confirmed}
        type="submit"
      >
        {busy ? 'Processing…' : title}
      </button>
    </form>
  );
}

ResetControl.propTypes = {
  busy: PropTypes.bool.isRequired,
  confirmation: PropTypes.string.isRequired,
  confirmationText: PropTypes.string.isRequired,
  danger: PropTypes.bool,
  description: PropTypes.node.isRequired,
  label: PropTypes.string.isRequired,
  onChange: PropTypes.func.isRequired,
  onSubmit: PropTypes.func.isRequired,
  title: PropTypes.string.isRequired,
};

/**
 * Displays sanitized application diagnostics, fixture validation, storage
 * schema status, and guarded demo-state reset controls.
 */
export function DiagnosticsPage() {
  const navigate = useNavigate();
  const authState = useAuthStore();
  const principal = useMemo(
    () => createPrincipal(authState),
    [authState],
  );
  const authorized =
    authState.isAuthenticated &&
    canPerformAction(principal, PERMISSIONS.VIEW_DIAGNOSTICS);
  const storageAdapter = useMemo(
    () => new BrowserStorageAdapter(),
    [],
  );
  const [fixtureResults, setFixtureResults] = useState([]);
  const [storageStatus, setStorageStatus] = useState({
    available: false,
    error: null,
    entries: [],
    counts: {
      current: 0,
      legacy: 0,
      invalid: 0,
      total: 0,
    },
  });
  const [safeDiagnostics, setSafeDiagnostics] = useState(null);
  const [generatedAt, setGeneratedAt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeAction, setActiveAction] = useState('');
  const [pageError, setPageError] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const [resetConfirmation, setResetConfirmation] = useState('');
  const [clearConfirmation, setClearConfirmation] = useState('');

  const refreshDiagnostics = useCallback(async () => {
    if (!authorized || !appConfig.enableDiagnostics) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setPageError('');
    setActionMessage('');

    try {
      await Promise.resolve();

      const nextFixtureResults = validateFixtureDiagnostics();
      const nextStorageStatus = collectStorageDiagnostics();
      const nextGeneratedAt = new Date().toISOString();

      setFixtureResults(nextFixtureResults);
      setStorageStatus(nextStorageStatus);
      setGeneratedAt(nextGeneratedAt);
      setSafeDiagnostics(
        createSafeDiagnostics({
          fixtureResults: nextFixtureResults,
          generatedAt: nextGeneratedAt,
          principal,
          storageStatus: nextStorageStatus,
        }),
      );
    } catch (error) {
      setPageError(
        error instanceof Error && error.message
          ? error.message
          : 'Diagnostics could not be generated.',
      );
    } finally {
      setLoading(false);
    }
  }, [authorized, principal]);

  useEffect(() => {
    refreshDiagnostics();
  }, [refreshDiagnostics]);

  const resetDemoData = async (event) => {
    event.preventDefault();

    if (resetConfirmation !== RESET_CONFIRMATION_TEXT) {
      setPageError('Enter the reset confirmation text exactly.');
      return;
    }

    setActiveAction('reset');
    setPageError('');
    setActionMessage('');

    try {
      await Promise.resolve();

      const removedCount = removeStorageByPrefixes(
        RESETTABLE_STORAGE_PREFIXES,
      );

      resetSeeds();
      setResetConfirmation('');
      setActionMessage(
        `${removedCount} persisted demo state entr${
          removedCount === 1 ? 'y was' : 'ies were'
        } removed. Authentication and UI preferences were preserved.`,
      );
      await refreshDiagnostics();
    } catch (error) {
      setPageError(
        error instanceof Error && error.message
          ? error.message
          : 'Demo application state could not be reset.',
      );
    } finally {
      setActiveAction('');
    }
  };

  const clearAllDemoData = async (event) => {
    event.preventDefault();

    if (clearConfirmation !== CLEAR_CONFIRMATION_TEXT) {
      setPageError('Enter the clear confirmation text exactly.');
      return;
    }

    setActiveAction('clear');
    setPageError('');
    setActionMessage('');

    try {
      await Promise.resolve();

      const removedCount = storageAdapter.clearNamespace(
        STORAGE_NAMESPACE_ROOT,
      );

      resetSeeds();

      if (typeof authState.logout === 'function') {
        authState.logout();
      }

      navigate(ROUTES.LOGIN, {
        replace: true,
        state: {
          message: `${removedCount} persisted demo entries were cleared.`,
          reason: 'demo_state_cleared',
        },
      });
    } catch (error) {
      setPageError(
        error instanceof Error && error.message
          ? error.message
          : 'All demo browser state could not be cleared.',
      );
      setActiveAction('');
    }
  };

  const fixtureColumns = useMemo(
    () => [
      {
        id: 'label',
        header: 'Fixture',
        accessor: (fixture) => fixture.label,
        render: (value, fixture) => (
          <div>
            <p className="font-semibold text-text dark:text-white">
              {value}
            </p>
            <p className="mt-1 font-mono text-xs text-text-muted dark:text-slate-400">
              {fixture.fixtureName}
            </p>
          </div>
        ),
      },
      {
        id: 'fixtureVersion',
        header: 'Fixture version',
        accessor: (fixture) => fixture.fixtureVersion,
        render: (value) => (
          <span className="font-mono text-xs">{value}</span>
        ),
      },
      {
        id: 'schemaVersion',
        header: 'Schema version',
        accessor: (fixture) => fixture.schemaVersion,
      },
      {
        id: 'recordCount',
        header: 'Records',
        accessor: (fixture) => fixture.recordCount,
      },
      {
        id: 'valid',
        header: 'Validation',
        accessor: (fixture) => fixture.valid,
        render: (value, fixture) => (
          <div>
            <StatusBadge
              label={value ? 'Valid' : 'Invalid'}
              showDot={false}
              size="sm"
              tone={value ? 'success' : 'danger'}
            />
            {!value && fixture.issues.length > 0 && (
              <p className="mt-2 max-w-xs text-xs text-danger dark:text-red-200">
                {fixture.issues[0].path}: {fixture.issues[0].message}
              </p>
            )}
          </div>
        ),
      },
    ],
    [],
  );

  const storageColumns = useMemo(
    () => [
      {
        id: 'relativeKey',
        header: 'Storage entry',
        accessor: (entry) => entry.relativeKey,
        render: (value, entry) => (
          <div>
            <p className="break-all font-mono text-xs text-text dark:text-slate-200">
              {value}
            </p>
            <p className="mt-1 text-xs text-text-muted dark:text-slate-400">
              {entry.category}
            </p>
          </div>
        ),
      },
      {
        id: 'schemaVersion',
        header: 'Schema version',
        accessor: (entry) => entry.schemaVersion,
        render: (value) => value ?? 'Unavailable',
      },
      {
        id: 'savedAt',
        header: 'Saved',
        accessor: (entry) => entry.savedAt,
        render: (value) => formatDate(value),
      },
      {
        id: 'status',
        header: 'Status',
        accessor: (entry) => entry.status,
        render: (value) => (
          <StatusBadge
            label={formatToken(value)}
            showDot={false}
            size="sm"
            tone={
              value === 'current'
                ? 'success'
                : value === 'legacy'
                  ? 'warning'
                  : 'danger'
            }
          />
        ),
      },
    ],
    [],
  );

  if (!authorized) {
    return (
      <section
        aria-labelledby="diagnostics-denied-title"
        className="mx-auto max-w-3xl rounded-xl border border-danger bg-danger-light p-6 text-danger-dark shadow-card dark:border-red-700 dark:bg-danger-dark dark:text-red-100"
        role="alert"
      >
        <h1
          className="text-xl font-semibold"
          id="diagnostics-denied-title"
        >
          Diagnostics access is unavailable
        </h1>
        <p className="mt-2 text-sm leading-6">
          An authenticated administrator with diagnostics permission is
          required to use this page.
        </p>
      </section>
    );
  }

  if (!appConfig.enableDiagnostics) {
    return (
      <section
        aria-labelledby="diagnostics-disabled-title"
        className="mx-auto max-w-3xl rounded-xl border border-warning bg-warning-light p-6 text-warning-dark shadow-card dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
        role="alert"
      >
        <StatusBadge
          label="Feature disabled"
          showDot={false}
          tone="warning"
        />
        <h1
          className="mt-4 text-xl font-semibold"
          id="diagnostics-disabled-title"
        >
          Diagnostics are disabled
        </h1>
        <p className="mt-2 text-sm leading-6">
          Enable the diagnostics feature through the application environment
          configuration before using validation and reset tooling.
        </p>
        <p className="mt-3 font-mono text-xs">
          VITE_ENABLE_DIAGNOSTICS=false
        </p>
      </section>
    );
  }

  const fixtureValidCount = fixtureResults.filter(
    (fixture) => fixture.valid,
  ).length;
  const storageHealthy =
    storageStatus.available &&
    storageStatus.counts.legacy === 0 &&
    storageStatus.counts.invalid === 0;
  const busy = activeAction !== '';

  return (
    <div className="mx-auto w-full max-w-7xl space-y-7">
      <header className="overflow-hidden rounded-2xl bg-lga-navy text-white shadow-elevated">
        <div className="grid gap-6 px-6 py-7 sm:px-8 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <div className="flex flex-wrap gap-2">
              <StatusBadge
                label="Diagnostics"
                showDot={false}
                tone="accent"
              />
              <StatusBadge
                label={formatToken(appConfig.appEnv)}
                showDot={false}
                tone="info"
              />
              <StatusBadge
                label="Administrator only"
                showDot={false}
                tone="warning"
              />
            </div>
            <h1 className="mt-4 text-2xl font-semibold sm:text-3xl">
              Diagnostics and reset tooling
            </h1>
            <p className="mt-3 max-w-4xl text-sm leading-6 text-primary-100 sm:text-base">
              Validate immutable fixture contracts, inspect versioned browser
              storage, export sanitized diagnostics, and reset synthetic demo
              state.
            </p>
          </div>

          <button
            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-white/50 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-lga-navy disabled:cursor-not-allowed disabled:opacity-50"
            disabled={loading || busy}
            onClick={refreshDiagnostics}
            type="button"
          >
            {loading ? 'Running diagnostics…' : 'Refresh diagnostics'}
          </button>
        </div>
      </header>

      <aside
        className="rounded-xl border border-accent-300 bg-accent-100 p-4 text-sm leading-6 text-accent-950 dark:border-accent-700 dark:bg-accent-950 dark:text-accent-100"
        role="note"
      >
        Diagnostics are generated locally and redact known sensitive fields.
        Do not paste personal, banking, licensing, authentication, or
        production information into diagnostic reports.
      </aside>

      {pageError && (
        <div
          className="rounded-xl border border-danger bg-danger-light p-4 text-sm text-danger-dark dark:border-red-700 dark:bg-danger-dark dark:text-red-100"
          role="alert"
        >
          <p className="font-semibold">
            The diagnostics action could not continue
          </p>
          <p className="mt-1">{pageError}</p>
        </div>
      )}

      {actionMessage && (
        <div
          className="rounded-xl border border-success bg-success-light p-4 text-sm text-success-dark dark:border-green-800 dark:bg-green-950 dark:text-green-100"
          role="status"
        >
          {actionMessage}
        </div>
      )}

      <section aria-labelledby="diagnostics-summary-title">
        <div>
          <h2
            className="text-xl font-semibold text-lga-navy dark:text-white"
            id="diagnostics-summary-title"
          >
            Diagnostic summary
          </h2>
          <p className="mt-1 text-sm text-text-muted dark:text-slate-300">
            Current environment, fixture, and browser persistence status.
          </p>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryCard
            description="Runtime environment configured through Vite."
            label="Environment"
            tone="info"
            value={formatToken(appConfig.appEnv)}
          />
          <SummaryCard
            description="Fixtures satisfying their runtime contracts."
            label="Valid fixtures"
            tone={
              fixtureValidCount === fixtureResults.length
                ? 'success'
                : 'danger'
            }
            value={`${fixtureValidCount}/${fixtureResults.length}`}
          />
          <SummaryCard
            description="Entries using the current persistence schema."
            label="Current storage"
            tone={storageHealthy ? 'success' : 'warning'}
            value={`${storageStatus.counts.current}/${storageStatus.counts.total}`}
          />
          <SummaryCard
            description="Expected browser persistence schema version."
            label="Schema version"
            tone="info"
            value={PERSISTENCE_SCHEMA_VERSION}
          />
        </div>

        {generatedAt && (
          <p className="mt-3 text-right text-xs text-text-muted dark:text-slate-400">
            Generated {formatDate(generatedAt)}
          </p>
        )}
      </section>

      <section aria-labelledby="fixture-validation-title">
        <div className="mb-4">
          <h2
            className="text-xl font-semibold text-lga-navy dark:text-white"
            id="fixture-validation-title"
          >
            Fixture validation
          </h2>
          <p className="mt-1 text-sm leading-6 text-text-muted dark:text-slate-300">
            Pristine synthetic fixture bundles are checked against their
            runtime Zod contracts without displaying fixture payload values.
          </p>
        </div>

        <DataTable
          aria-label="Fixture validation results"
          columns={fixtureColumns}
          data={fixtureResults}
          emptyMessage="No fixture validation results are available."
          loading={loading}
          loadingMessage="Validating synthetic fixture contracts…"
          pagination={false}
        />
      </section>

      <section aria-labelledby="storage-status-title">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2
              className="text-xl font-semibold text-lga-navy dark:text-white"
              id="storage-status-title"
            >
              Browser storage schema status
            </h2>
            <p className="mt-1 text-sm leading-6 text-text-muted dark:text-slate-300">
              Only envelope metadata and relative storage keys are shown.
              Persisted payload data is never rendered in this table.
            </p>
          </div>
          <StatusBadge
            label={
              storageStatus.available
                ? storageHealthy
                  ? 'Storage healthy'
                  : 'Review required'
                : 'Storage unavailable'
            }
            showDot={false}
            tone={
              storageStatus.available
                ? storageHealthy
                  ? 'success'
                  : 'warning'
                : 'danger'
            }
          />
        </div>

        {!storageStatus.available && storageStatus.error && (
          <div
            className="mb-4 rounded-xl border border-danger bg-danger-light p-4 text-sm text-danger-dark dark:border-red-700 dark:bg-danger-dark dark:text-red-100"
            role="alert"
          >
            {storageStatus.error}
          </div>
        )}

        <DataTable
          aria-label="Browser storage schema entries"
          columns={storageColumns}
          data={storageStatus.entries}
          emptyMessage="No versioned demo storage entries were found."
          loading={loading}
          loadingMessage="Inspecting browser storage envelopes…"
          pagination={false}
        />
      </section>

      <section aria-labelledby="safe-diagnostics-title">
        <div className="mb-4">
          <h2
            className="text-xl font-semibold text-lga-navy dark:text-white"
            id="safe-diagnostics-title"
          >
            Safe diagnostic report
          </h2>
          <p className="mt-1 text-sm leading-6 text-text-muted dark:text-slate-300">
            Copy or download this redacted summary when reporting simulation
            issues. Review the report before sharing it.
          </p>
        </div>

        <JsonViewer
          data={
            safeDiagnostics ?? {
              status: loading
                ? 'Diagnostics are being generated.'
                : 'Diagnostics are unavailable.',
            }
          }
          fileName="digital-onboarding-diagnostics.json"
          initiallyExpanded
          redact
          title="Sanitized diagnostics"
        />
      </section>

      <section
        aria-labelledby="reset-tooling-title"
        className="overflow-hidden rounded-xl border border-border bg-white shadow-card dark:border-slate-700 dark:bg-slate-900"
      >
        <div className="border-b border-border px-5 py-4 sm:px-6 dark:border-slate-700">
          <h2
            className="text-xl font-semibold text-lga-navy dark:text-white"
            id="reset-tooling-title"
          >
            Reset demo state
          </h2>
          <p className="mt-1 text-sm leading-6 text-text-muted dark:text-slate-300">
            These actions permanently remove locally persisted simulation
            state. Fixture seeds are restored from the bundled source data.
          </p>
        </div>

        <div className="grid gap-5 p-5 lg:grid-cols-2 sm:p-6">
          <ResetControl
            busy={busy}
            confirmation={resetConfirmation}
            confirmationText={RESET_CONFIRMATION_TEXT}
            description="Removes onboarding, intake, operations, reference configuration, and application-state entries. The current authentication session and UI preferences are preserved."
            label="reset-demo-data-confirmation"
            onChange={(value) => {
              setResetConfirmation(value);
              setPageError('');
            }}
            onSubmit={resetDemoData}
            title="Reset application demo data"
          />

          <ResetControl
            busy={busy}
            confirmation={clearConfirmation}
            confirmationText={CLEAR_CONFIRMATION_TEXT}
            danger
            description="Removes every entry in the digital onboarding storage namespace, including authentication and UI preferences. You will be signed out."
            label="clear-all-demo-data-confirmation"
            onChange={(value) => {
              setClearConfirmation(value);
              setPageError('');
            }}
            onSubmit={clearAllDemoData}
            title="Clear all browser demo data"
          />
        </div>
      </section>

      <p className="text-center text-xs leading-5 text-text-muted dark:text-slate-400">
        Diagnostic and reset actions operate only on this browser simulation.
        No production systems or external providers are contacted.
      </p>
    </div>
  );
}

export default DiagnosticsPage;