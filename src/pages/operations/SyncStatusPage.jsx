import { useCallback, useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { canPerformAction } from '../../auth/permissionPolicy.js';
import DataTable from '../../components/shared/DataTable.jsx';
import MaskedValue, {
  MASKED_VALUE_KINDS,
} from '../../components/shared/MaskedValue.jsx';
import StatusBadge from '../../components/shared/StatusBadge.jsx';
import Timeline from '../../components/shared/Timeline.jsx';
import { INTEGRATION_SYSTEMS } from '../../constants/domain.js';
import { PERMISSIONS } from '../../constants/roles.js';
import { SYNC_ATTEMPT_STATUSES } from '../../repositories/syncAttemptRepository.js';
import { createSyncStatusService } from '../../services/operations/syncStatusService.js';
import { useAuthStore } from '../../stores/authStore.js';
import { formatDisplayDateTime } from '../../utils/dates.js';

const DEFAULT_PAGE_SIZE = 25;

const DEFAULT_FILTERS = Object.freeze({
  correlationId: '',
  operation: '',
  status: '',
  system: '',
  trackingId: '',
});

const SYSTEM_LABELS = Object.freeze({
  [INTEGRATION_SYSTEMS.AGENT_DB]: 'Agent DB',
  [INTEGRATION_SYSTEMS.LIFE_PRO]: 'LifePro',
  [INTEGRATION_SYSTEMS.ALI]: 'ALI',
  [INTEGRATION_SYSTEMS.HORIZON]: 'Horizon',
});

const STATUS_OPTIONS = Object.freeze([
  { label: 'All statuses', value: '' },
  ...Object.values(SYNC_ATTEMPT_STATUSES).map((status) => ({
    label: formatToken(status),
    value: status,
  })),
]);

const SYSTEM_OPTIONS = Object.freeze([
  { label: 'All systems', value: '' },
  ...Object.values(INTEGRATION_SYSTEMS).map((system) => ({
    label: SYSTEM_LABELS[system] ?? formatToken(system),
    value: system,
  })),
]);

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

function createSearchRequest(filters, page, pageSize) {
  return {
    page,
    pageSize,
    sortDirection: 'desc',
    ...(filters.trackingId.trim() === ''
      ? {}
      : { trackingId: filters.trackingId.trim() }),
    ...(filters.system === '' ? {} : { system: filters.system }),
    ...(filters.status === '' ? {} : { status: filters.status }),
    ...(filters.operation.trim() === ''
      ? {}
      : { operation: filters.operation.trim() }),
    ...(filters.correlationId.trim() === ''
      ? {}
      : { correlationId: filters.correlationId.trim() }),
  };
}

function getStatusTone(status) {
  switch (status) {
    case SYNC_ATTEMPT_STATUSES.SUCCESS:
      return 'success';

    case SYNC_ATTEMPT_STATUSES.FAILED:
    case SYNC_ATTEMPT_STATUSES.CANCELLED:
      return 'danger';

    case SYNC_ATTEMPT_STATUSES.QUEUED:
    case SYNC_ATTEMPT_STATUSES.PENDING:
      return 'warning';

    case SYNC_ATTEMPT_STATUSES.SKIPPED:
    default:
      return 'neutral';
  }
}

function getSystemName(system) {
  return SYSTEM_LABELS[system] ?? formatToken(system);
}

function getAttemptTimestamp(attempt) {
  return attempt.resolvedAt ?? attempt.attemptedAt;
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
  value: PropTypes.number.isRequired,
};

function FilterSelect({
  disabled,
  id,
  label,
  onChange,
  options,
  value,
}) {
  return (
    <div>
      <label
        className="block text-sm font-medium text-text dark:text-slate-100"
        htmlFor={id}
      >
        {label}
      </label>
      <select
        className="mt-1 min-h-11 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text shadow-sm focus:border-lga-sky focus:outline-none focus:ring-2 focus:ring-lga-sky disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
        disabled={disabled}
        id={id}
        onChange={onChange}
        value={value}
      >
        {options.map((option) => (
          <option key={option.value || 'all'} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

FilterSelect.propTypes = {
  disabled: PropTypes.bool.isRequired,
  id: PropTypes.string.isRequired,
  label: PropTypes.string.isRequired,
  onChange: PropTypes.func.isRequired,
  options: PropTypes.arrayOf(
    PropTypes.shape({
      label: PropTypes.string.isRequired,
      value: PropTypes.string.isRequired,
    }),
  ).isRequired,
  value: PropTypes.string.isRequired,
};

function SystemStatusCard({ badge, system }) {
  const status = badge?.status ?? 'unknown';

  return (
    <article className="rounded-xl border border-border bg-white p-4 shadow-card dark:border-slate-700 dark:bg-slate-900">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-text-muted dark:text-slate-400">
            System of record
          </p>
          <h3 className="mt-1 font-semibold text-lga-navy dark:text-white">
            {getSystemName(system)}
          </h3>
        </div>
        <StatusBadge
          showDot={false}
          size="sm"
          status={status}
          tone={getStatusTone(status)}
        />
      </div>

      <p className="mt-3 min-h-10 text-sm leading-5 text-text-muted dark:text-slate-300">
        {badge?.message ?? 'No synchronization attempt has been recorded.'}
      </p>

      <dl className="mt-4 space-y-3 text-sm">
        <div>
          <dt className="text-xs text-text-muted dark:text-slate-400">
            Operation
          </dt>
          <dd className="mt-1 font-medium text-text dark:text-slate-200">
            {formatToken(badge?.operation)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted dark:text-slate-400">
            Last attempted
          </dt>
          <dd className="mt-1 font-medium text-text dark:text-slate-200">
            {formatDate(badge?.attemptedAt)}
          </dd>
        </div>
      </dl>
    </article>
  );
}

SystemStatusCard.propTypes = {
  badge: PropTypes.shape({
    attemptedAt: PropTypes.string,
    message: PropTypes.string,
    operation: PropTypes.string,
    status: PropTypes.string,
  }),
  system: PropTypes.string.isRequired,
};

function FailureList({ attempts, onSelect }) {
  if (attempts.length === 0) {
    return (
      <div className="mt-5 rounded-lg border border-dashed border-border-strong px-4 py-8 text-center text-sm text-text-muted dark:border-slate-600 dark:text-slate-300">
        No failed synchronization attempts matched the current filters.
      </div>
    );
  }

  return (
    <ul className="mt-5 grid list-none gap-4 p-0 lg:grid-cols-2">
      {attempts.map((attempt) => (
        <li
          className="rounded-xl border border-danger bg-danger-light p-4 dark:border-red-800 dark:bg-red-950"
          key={attempt.syncAttemptId}
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-danger-dark dark:text-red-200">
                {getSystemName(attempt.system)}
              </p>
              <h3 className="mt-1 font-semibold text-danger-dark dark:text-red-100">
                {formatToken(attempt.operation)}
              </h3>
            </div>
            <StatusBadge
              showDot={false}
              size="sm"
              status={attempt.status}
              tone="danger"
            />
          </div>

          <p className="mt-3 text-sm leading-6 text-danger-dark dark:text-red-100">
            {attempt.message}
          </p>

          <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-2">
            <div>
              <dt className="text-danger-dark/80 dark:text-red-200">
                Attempted
              </dt>
              <dd className="mt-1 font-medium text-danger-dark dark:text-red-100">
                {formatDate(attempt.attemptedAt)}
              </dd>
            </div>
            <div>
              <dt className="text-danger-dark/80 dark:text-red-200">
                Correlation
              </dt>
              <dd className="mt-1">
                <MaskedValue
                  kind={MASKED_VALUE_KINDS.RECORD_ID}
                  label="Correlation identifier"
                  value={attempt.correlationId}
                />
              </dd>
            </div>
          </dl>

          {attempt.trackingId && (
            <button
              className="mt-4 inline-flex min-h-10 items-center justify-center rounded-lg border border-danger px-4 py-2 text-sm font-semibold text-danger-dark transition-colors hover:bg-white/50 focus:outline-none focus:ring-2 focus:ring-danger focus:ring-offset-2 dark:text-red-100 dark:hover:bg-red-900"
              onClick={() => onSelect(attempt)}
              type="button"
            >
              View attempt history
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

FailureList.propTypes = {
  attempts: PropTypes.arrayOf(PropTypes.object).isRequired,
  onSelect: PropTypes.func.isRequired,
};

function HorizonReconciliationForm({
  busy,
  onChange,
  onSubmit,
  values,
}) {
  return (
    <section
      aria-labelledby="horizon-reconciliation-title"
      className="rounded-xl border border-border bg-white p-5 shadow-card sm:p-6 dark:border-slate-700 dark:bg-slate-900"
    >
      <div>
        <div className="flex flex-wrap gap-2">
          <StatusBadge
            label="Horizon JIT"
            showDot={false}
            tone="info"
          />
          <StatusBadge
            label="Duplicate prevention"
            showDot={false}
            tone="accent"
          />
        </div>
        <h2
          className="mt-3 text-xl font-semibold text-lga-navy dark:text-white"
          id="horizon-reconciliation-title"
        >
          Reconcile a Horizon appointment event
        </h2>
        <p className="mt-1 text-sm leading-6 text-text-muted dark:text-slate-300">
          Match a synthetic Horizon just-in-time appointment event to an
          existing digital onboarding record. Reusing an event ID prevents a
          duplicate reconciliation.
        </p>
      </div>

      <form className="mt-5" noValidate onSubmit={onSubmit}>
        <fieldset
          className="grid gap-4 sm:grid-cols-2"
          disabled={busy}
        >
          <legend className="sr-only">
            Horizon event reconciliation details
          </legend>

          <div>
            <label
              className="block text-sm font-medium text-text dark:text-slate-100"
              htmlFor="horizon-event-id"
            >
              Event ID
            </label>
            <input
              className="mt-1 min-h-11 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text shadow-sm focus:border-lga-sky focus:outline-none focus:ring-2 focus:ring-lga-sky disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
              id="horizon-event-id"
              onChange={(event) =>
                onChange('eventId', event.target.value)
              }
              placeholder="HZ-DEMO-UI-1001"
              required
              value={values.eventId}
            />
          </div>

          <div>
            <label
              className="block text-sm font-medium text-text dark:text-slate-100"
              htmlFor="horizon-event-type"
            >
              Event type
            </label>
            <select
              className="mt-1 min-h-11 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text shadow-sm focus:border-lga-sky focus:outline-none focus:ring-2 focus:ring-lga-sky disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
              id="horizon-event-type"
              onChange={(event) =>
                onChange('eventType', event.target.value)
              }
              value={values.eventType}
            >
              <option value="jit_appointment_requested">
                JIT appointment requested
              </option>
              <option value="appointment_status_changed">
                Appointment status changed
              </option>
            </select>
          </div>

          <div>
            <label
              className="block text-sm font-medium text-text dark:text-slate-100"
              htmlFor="horizon-agent-code"
            >
              Agent code
            </label>
            <input
              className="mt-1 min-h-11 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text shadow-sm focus:border-lga-sky focus:outline-none focus:ring-2 focus:ring-lga-sky disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
              id="horizon-agent-code"
              onChange={(event) =>
                onChange('agentCode', event.target.value)
              }
              placeholder="MCON1006"
              value={values.agentCode}
            />
          </div>

          <div>
            <label
              className="block text-sm font-medium text-text dark:text-slate-100"
              htmlFor="horizon-npn"
            >
              National producer number
            </label>
            <input
              className="mt-1 min-h-11 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text shadow-sm focus:border-lga-sky focus:outline-none focus:ring-2 focus:ring-lga-sky disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
              id="horizon-npn"
              inputMode="numeric"
              onChange={(event) => onChange('npn', event.target.value)}
              placeholder="8101006"
              value={values.npn}
            />
          </div>

          <div className="sm:col-span-2">
            <label
              className="block text-sm font-medium text-text dark:text-slate-100"
              htmlFor="horizon-requested-states"
            >
              Requested states
            </label>
            <input
              className="mt-1 min-h-11 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text shadow-sm focus:border-lga-sky focus:outline-none focus:ring-2 focus:ring-lga-sky disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
              id="horizon-requested-states"
              onChange={(event) =>
                onChange('requestedStates', event.target.value)
              }
              placeholder="OH, IN"
              value={values.requestedStates}
            />
            <p className="mt-1 text-xs text-text-muted dark:text-slate-400">
              Separate multiple two-letter state codes with commas.
            </p>
          </div>
        </fieldset>

        <div className="mt-5 flex justify-end border-t border-border pt-4 dark:border-slate-700">
          <button
            className="inline-flex min-h-11 items-center justify-center rounded-lg bg-lga-navy px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-800 focus:outline-none focus:ring-2 focus:ring-lga-sky focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-primary-600 dark:hover:bg-primary-500"
            disabled={busy}
            type="submit"
          >
            {busy ? 'Reconciling event…' : 'Reconcile Horizon event'}
          </button>
        </div>
      </form>
    </section>
  );
}

HorizonReconciliationForm.propTypes = {
  busy: PropTypes.bool.isRequired,
  onChange: PropTypes.func.isRequired,
  onSubmit: PropTypes.func.isRequired,
  values: PropTypes.shape({
    agentCode: PropTypes.string.isRequired,
    eventId: PropTypes.string.isRequired,
    eventType: PropTypes.string.isRequired,
    npn: PropTypes.string.isRequired,
    requestedStates: PropTypes.string.isRequired,
  }).isRequired,
};

/**
 * Displays system-of-record synchronization history, latest status badges,
 * failures, and user-triggered Horizon event reconciliation.
 */
export function SyncStatusPage({ syncStatusService }) {
  const authState = useAuthStore();
  const principal = useMemo(
    () => createPrincipal(authState),
    [authState],
  );
  const authorized =
    authState.isAuthenticated &&
    (canPerformAction(principal, PERMISSIONS.VIEW_OPERATIONS) ||
      canPerformAction(principal, PERMISSIONS.VIEW_WORKBENCH) ||
      canPerformAction(principal, PERMISSIONS.VIEW_ONBOARDING));
  const canReconcile =
    authState.isAuthenticated &&
    (canPerformAction(principal, PERMISSIONS.RESOLVE_EXCEPTIONS) ||
      canPerformAction(principal, PERMISSIONS.MANAGE_WORK_ITEMS) ||
      canPerformAction(
        principal,
        PERMISSIONS.MANAGE_CONTRACT_CHANGES,
      ));
  const service = useMemo(
    () =>
      syncStatusService ??
      createSyncStatusService({
        principal,
        partnerContext: authState.partnerContext,
        strictAudit: false,
      }),
    [
      authState.partnerContext,
      principal,
      syncStatusService,
    ],
  );
  const [filters, setFilters] = useState({ ...DEFAULT_FILTERS });
  const [appliedFilters, setAppliedFilters] = useState({
    ...DEFAULT_FILTERS,
  });
  const [page, setPage] = useState(1);
  const [pageSize] = useState(DEFAULT_PAGE_SIZE);
  const [response, setResponse] = useState({
    records: [],
    badges: {},
    page: 1,
    pageSize: DEFAULT_PAGE_SIZE,
    total: 0,
    totalPages: 0,
  });
  const [selectedTrackingId, setSelectedTrackingId] = useState('');
  const [selectedAttempts, setSelectedAttempts] = useState([]);
  const [selectedBadges, setSelectedBadges] = useState({});
  const [horizonValues, setHorizonValues] = useState({
    eventId: 'HZ-DEMO-UI-1001',
    eventType: 'jit_appointment_requested',
    agentCode: 'MCON1006',
    npn: '8101006',
    requestedStates: 'OH, IN',
  });
  const [reconciliationResult, setReconciliationResult] =
    useState(null);
  const [loading, setLoading] = useState(true);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [pageError, setPageError] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const [lastRefreshedAt, setLastRefreshedAt] = useState(null);

  const loadAttempts = useCallback(async () => {
    if (!authorized) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setPageError('');

    try {
      const result = await Promise.resolve(
        service.search(
          createSearchRequest(
            appliedFilters,
            page,
            pageSize,
          ),
          principal,
        ),
      );

      setResponse({
        records: result.records ?? result.data ?? [],
        badges: result.badges ?? {},
        page: result.page ?? page,
        pageSize: result.pageSize ?? pageSize,
        total: result.total ?? 0,
        totalPages: result.totalPages ?? 0,
      });
      setLastRefreshedAt(new Date().toISOString());
    } catch (error) {
      setResponse({
        records: [],
        badges: {},
        page: 1,
        pageSize,
        total: 0,
        totalPages: 0,
      });
      setPageError(
        error instanceof Error && error.message
          ? error.message
          : 'Synchronization status could not be loaded.',
      );
    } finally {
      setLoading(false);
    }
  }, [
    appliedFilters,
    authorized,
    page,
    pageSize,
    principal,
    service,
  ]);

  useEffect(() => {
    loadAttempts();
  }, [loadAttempts]);

  const selectTrackingHistory = async (attempt) => {
    if (!attempt.trackingId) {
      return;
    }

    setSelectedTrackingId(attempt.trackingId);
    setDetailsLoading(true);
    setPageError('');
    setActionMessage('');

    try {
      const historyResponse = await Promise.resolve(
        service.search(
          {
            trackingId: attempt.trackingId,
            page: 1,
            pageSize: 100,
            sortDirection: 'desc',
          },
          principal,
        ),
      );
      const badges = await Promise.resolve(
        service.getStatusBadges(attempt.trackingId, principal, {
          partnerContext: authState.partnerContext,
        }),
      );

      setSelectedAttempts(
        historyResponse.records ?? historyResponse.data ?? [],
      );
      setSelectedBadges(badges ?? {});
    } catch (error) {
      setSelectedAttempts([]);
      setSelectedBadges({});
      setPageError(
        error instanceof Error && error.message
          ? error.message
          : 'The synchronization attempt history could not be loaded.',
      );
    } finally {
      setDetailsLoading(false);
    }
  };

  const submitFilters = (event) => {
    event.preventDefault();
    setPage(1);
    setAppliedFilters({ ...filters });
    setSelectedTrackingId('');
    setSelectedAttempts([]);
    setSelectedBadges({});
    setPageError('');
    setActionMessage('');
  };

  const resetFilters = () => {
    setFilters({ ...DEFAULT_FILTERS });
    setAppliedFilters({ ...DEFAULT_FILTERS });
    setPage(1);
    setSelectedTrackingId('');
    setSelectedAttempts([]);
    setSelectedBadges({});
    setPageError('');
    setActionMessage('');
  };

  const reconcileHorizonEvent = async (event) => {
    event.preventDefault();
    setPageError('');
    setActionMessage('');
    setReconciliationResult(null);

    if (horizonValues.eventId.trim() === '') {
      setPageError('A Horizon event identifier is required.');
      return;
    }

    if (
      horizonValues.agentCode.trim() === '' &&
      horizonValues.npn.trim() === ''
    ) {
      setPageError(
        'Enter an agent code or national producer number to reconcile the event.',
      );
      return;
    }

    const requestedStates = [
      ...new Set(
        horizonValues.requestedStates
          .split(',')
          .map((state) => state.trim().toUpperCase())
          .filter(Boolean),
      ),
    ];

    if (
      requestedStates.some((state) => !/^[A-Z]{2}$/.test(state))
    ) {
      setPageError(
        'Requested states must use two-letter codes separated by commas.',
      );
      return;
    }

    setReconciling(true);

    try {
      const result = await Promise.resolve(
        service.reconcileHorizonEvent(
          {
            eventId: horizonValues.eventId.trim(),
            eventType: horizonValues.eventType,
            agentCode:
              horizonValues.agentCode.trim() || undefined,
            npn: horizonValues.npn.trim() || undefined,
            requestedStates,
            principal,
            partnerContext: authState.partnerContext,
          },
          principal,
        ),
      );

      setReconciliationResult(result);
      setActionMessage(
        result.duplicatePrevented
          ? 'The Horizon event was reconciled and duplicate processing was prevented.'
          : 'The Horizon event reconciliation completed.',
      );

      await loadAttempts();

      if (result.trackingId) {
        await selectTrackingHistory({
          trackingId: result.trackingId,
        });
      }
    } catch (error) {
      setPageError(
        error instanceof Error && error.message
          ? error.message
          : 'The Horizon event could not be reconciled.',
      );
    } finally {
      setReconciling(false);
    }
  };

  const records = response.records;
  const failedAttempts = records.filter(
    (attempt) => attempt.status === SYNC_ATTEMPT_STATUSES.FAILED,
  );
  const summary = useMemo(
    () => ({
      total: response.total,
      successful: records.filter(
        (attempt) =>
          attempt.status === SYNC_ATTEMPT_STATUSES.SUCCESS,
      ).length,
      pending: records.filter((attempt) =>
        [
          SYNC_ATTEMPT_STATUSES.PENDING,
          SYNC_ATTEMPT_STATUSES.QUEUED,
        ].includes(attempt.status),
      ).length,
      failed: failedAttempts.length,
    }),
    [failedAttempts.length, records, response.total],
  );
  const columns = useMemo(
    () => [
      {
        id: 'system',
        header: 'System',
        accessor: (attempt) => attempt.system,
        render: (value) => (
          <StatusBadge
            label={getSystemName(value)}
            showDot={false}
            size="sm"
            sourceSystem={value}
          />
        ),
      },
      {
        id: 'operation',
        header: 'Operation',
        accessor: (attempt) => attempt.operation,
        render: (value, attempt) => (
          <div className="min-w-48">
            <p className="font-semibold text-text dark:text-white">
              {formatToken(value)}
            </p>
            <p className="mt-1 line-clamp-2 text-xs text-text-muted dark:text-slate-400">
              {attempt.message}
            </p>
          </div>
        ),
      },
      {
        id: 'status',
        header: 'Status',
        accessor: (attempt) => attempt.status,
        render: (value) => (
          <StatusBadge
            showDot={false}
            status={value}
            tone={getStatusTone(value)}
          />
        ),
      },
      {
        id: 'trackingId',
        header: 'Tracking ID',
        accessor: (attempt) => attempt.trackingId,
        render: (value) =>
          value ? (
            <MaskedValue
              kind={MASKED_VALUE_KINDS.RECORD_ID}
              value={value}
            />
          ) : (
            <span className="text-text-muted dark:text-slate-400">
              Not linked
            </span>
          ),
      },
      {
        id: 'correlationId',
        header: 'Correlation',
        accessor: (attempt) => attempt.correlationId,
        render: (value) => (
          <MaskedValue
            kind={MASKED_VALUE_KINDS.RECORD_ID}
            label="Correlation identifier"
            value={value}
          />
        ),
      },
      {
        id: 'attemptedAt',
        header: 'Attempted',
        accessor: (attempt) => attempt.attemptedAt,
        render: (value) => (
          <time className="whitespace-nowrap" dateTime={value}>
            {formatDate(value)}
          </time>
        ),
      },
      {
        id: 'history',
        header: 'History',
        sortable: false,
        accessor: (attempt) => attempt.trackingId,
        render: (value, attempt) =>
          value ? (
            <button
              className="inline-flex min-h-10 items-center justify-center rounded-lg border border-border bg-white px-3 py-2 text-sm font-semibold text-lga-navy transition-colors hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-lga-sky focus:ring-offset-2 dark:border-slate-600 dark:bg-slate-900 dark:text-white dark:hover:bg-slate-800"
              onClick={() => selectTrackingHistory(attempt)}
              type="button"
            >
              View history
            </button>
          ) : (
            '—'
          ),
      },
    ],
    [],
  );

  if (!authorized) {
    return (
      <section
        aria-labelledby="sync-status-denied-title"
        className="mx-auto max-w-3xl rounded-xl border border-danger bg-danger-light p-6 text-danger-dark shadow-card dark:border-red-700 dark:bg-danger-dark dark:text-red-100"
        role="alert"
      >
        <h1 className="text-xl font-semibold" id="sync-status-denied-title">
          Synchronization status access is unavailable
        </h1>
        <p className="mt-2 text-sm leading-6">
          An authenticated internal role with operations, workbench, or
          onboarding visibility is required to review synchronization
          history.
        </p>
      </section>
    );
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-7">
      <header className="overflow-hidden rounded-2xl bg-lga-navy text-white shadow-elevated">
        <div className="grid gap-6 px-6 py-7 sm:px-8 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <div className="flex flex-wrap gap-2">
              <StatusBadge
                label="Synchronization status"
                showDot={false}
                tone="accent"
              />
              <StatusBadge
                label="Systems of record"
                showDot={false}
                tone="info"
              />
              <StatusBadge label="Simulation" showDot={false} simulation />
            </div>
            <h1 className="mt-4 text-2xl font-semibold sm:text-3xl">
              Agent DB, LifePro, ALI, and Horizon
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-primary-100 sm:text-base">
              Search synchronization attempts, inspect correlated history,
              review failures, and reconcile synthetic Horizon just-in-time
              appointment events.
            </p>
          </div>

          <button
            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-white/50 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-lga-navy disabled:cursor-not-allowed disabled:opacity-50"
            disabled={loading}
            onClick={loadAttempts}
            type="button"
          >
            {loading ? 'Refreshing…' : 'Refresh status'}
          </button>
        </div>
      </header>

      <aside
        className="rounded-xl border border-accent-300 bg-accent-100 p-4 text-sm leading-6 text-accent-950 dark:border-accent-700 dark:bg-accent-950 dark:text-accent-100"
        role="note"
      >
        All synchronization attempts and Horizon events are simulated and
        stored locally in this browser. Use synthetic tracking IDs, producer
        identifiers, agent codes, and comments only.
      </aside>

      {pageError && (
        <div
          className="rounded-xl border border-danger bg-danger-light p-4 text-sm text-danger-dark dark:border-red-700 dark:bg-danger-dark dark:text-red-100"
          role="alert"
        >
          <p className="font-semibold">
            The synchronization action could not continue
          </p>
          <p className="mt-1">{pageError}</p>
        </div>
      )}

      <div aria-live="polite" className="sr-only" role="status">
        {actionMessage}
      </div>

      <section aria-labelledby="sync-status-summary-title">
        <div>
          <h2
            className="text-xl font-semibold text-lga-navy dark:text-white"
            id="sync-status-summary-title"
          >
            Attempt summary
          </h2>
          <p className="mt-1 text-sm text-text-muted dark:text-slate-300">
            Status counts reflect the current result page and authorized
            record scope.
          </p>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryCard
            description="Synchronization attempts matching the current filters."
            label="Matching attempts"
            tone="info"
            value={summary.total}
          />
          <SummaryCard
            description="Successful attempts on the current page."
            label="Successful"
            tone="success"
            value={summary.successful}
          />
          <SummaryCard
            description="Queued or pending attempts on the current page."
            label="Pending"
            tone="warning"
            value={summary.pending}
          />
          <SummaryCard
            description="Failed attempts requiring operational attention."
            label="Failed"
            tone="danger"
            value={summary.failed}
          />
        </div>

        {lastRefreshedAt && (
          <p className="mt-3 text-right text-xs text-text-muted dark:text-slate-400">
            Last refreshed {formatDate(lastRefreshedAt)}
          </p>
        )}
      </section>

      <form
        className="overflow-hidden rounded-xl border border-border bg-white shadow-card dark:border-slate-700 dark:bg-slate-900"
        noValidate
        onSubmit={submitFilters}
      >
        <div className="border-b border-border px-5 py-4 sm:px-6 dark:border-slate-700">
          <h2 className="text-lg font-semibold text-lga-navy dark:text-white">
            Synchronization filters
          </h2>
          <p className="mt-1 text-sm text-text-muted dark:text-slate-300">
            Filter by tracking ID, system, status, operation, or correlation
            identifier.
          </p>
        </div>

        <fieldset
          className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3 sm:p-6"
          disabled={loading}
        >
          <legend className="sr-only">
            Synchronization attempt filters
          </legend>

          <div>
            <label
              className="block text-sm font-medium text-text dark:text-slate-100"
              htmlFor="sync-tracking-id"
            >
              Tracking ID
            </label>
            <input
              className="mt-1 min-h-11 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text shadow-sm placeholder:text-slate-400 focus:border-lga-sky focus:outline-none focus:ring-2 focus:ring-lga-sky disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
              id="sync-tracking-id"
              onChange={(event) =>
                setFilters((currentFilters) => ({
                  ...currentFilters,
                  trackingId: event.target.value,
                }))
              }
              placeholder="TRK-DEMO-1006"
              value={filters.trackingId}
            />
          </div>

          <FilterSelect
            disabled={loading}
            id="sync-system"
            label="System"
            onChange={(event) =>
              setFilters((currentFilters) => ({
                ...currentFilters,
                system: event.target.value,
              }))
            }
            options={SYSTEM_OPTIONS}
            value={filters.system}
          />

          <FilterSelect
            disabled={loading}
            id="sync-status"
            label="Status"
            onChange={(event) =>
              setFilters((currentFilters) => ({
                ...currentFilters,
                status: event.target.value,
              }))
            }
            options={STATUS_OPTIONS}
            value={filters.status}
          />

          <div>
            <label
              className="block text-sm font-medium text-text dark:text-slate-100"
              htmlFor="sync-operation"
            >
              Operation
            </label>
            <input
              className="mt-1 min-h-11 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text shadow-sm placeholder:text-slate-400 focus:border-lga-sky focus:outline-none focus:ring-2 focus:ring-lga-sky disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
              id="sync-operation"
              onChange={(event) =>
                setFilters((currentFilters) => ({
                  ...currentFilters,
                  operation: event.target.value,
                }))
              }
              placeholder="activate_agent"
              value={filters.operation}
            />
          </div>

          <div className="sm:col-span-2">
            <label
              className="block text-sm font-medium text-text dark:text-slate-100"
              htmlFor="sync-correlation-id"
            >
              Correlation identifier
            </label>
            <input
              className="mt-1 min-h-11 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text shadow-sm placeholder:text-slate-400 focus:border-lga-sky focus:outline-none focus:ring-2 focus:ring-lga-sky disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
              id="sync-correlation-id"
              onChange={(event) =>
                setFilters((currentFilters) => ({
                  ...currentFilters,
                  correlationId: event.target.value,
                }))
              }
              placeholder="corr-demo-1012"
              value={filters.correlationId}
            />
          </div>
        </fieldset>

        <div className="flex flex-col gap-3 border-t border-border bg-surface-muted px-5 py-4 sm:flex-row sm:justify-end sm:px-6 dark:border-slate-700 dark:bg-slate-800">
          <button
            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-border bg-white px-5 py-2 text-sm font-semibold text-lga-navy transition-colors hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-lga-sky focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-white dark:hover:bg-slate-700"
            disabled={loading}
            onClick={resetFilters}
            type="button"
          >
            Reset filters
          </button>
          <button
            className="inline-flex min-h-11 items-center justify-center rounded-lg bg-lga-navy px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-800 focus:outline-none focus:ring-2 focus:ring-lga-sky focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-primary-600 dark:hover:bg-primary-500"
            disabled={loading}
            type="submit"
          >
            {loading ? 'Searching…' : 'Apply filters'}
          </button>
        </div>
      </form>

      {canReconcile && (
        <HorizonReconciliationForm
          busy={reconciling}
          onChange={(field, value) => {
            setHorizonValues((currentValues) => ({
              ...currentValues,
              [field]: value,
            }));
            setPageError('');
            setReconciliationResult(null);
          }}
          onSubmit={reconcileHorizonEvent}
          values={horizonValues}
        />
      )}

      {reconciliationResult && (
        <section
          aria-labelledby="horizon-result-title"
          className={`rounded-xl border p-5 shadow-card sm:p-6 ${
            reconciliationResult.matchedDigitalRecord
              ? 'border-success bg-success-light dark:border-green-800 dark:bg-green-950'
              : 'border-warning bg-warning-light dark:border-amber-700 dark:bg-amber-950'
          }`}
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2
                className="text-xl font-semibold text-lga-navy dark:text-white"
                id="horizon-result-title"
              >
                Horizon reconciliation result
              </h2>
              <p className="mt-2 text-sm leading-6 text-text-muted dark:text-slate-200">
                {reconciliationResult.matchedDigitalRecord
                  ? 'The Horizon event matched a digital onboarding record.'
                  : 'No eligible digital onboarding record was matched.'}
              </p>
            </div>
            <StatusBadge
              label={formatToken(reconciliationResult.action)}
              showDot={false}
              tone={
                reconciliationResult.matchedDigitalRecord
                  ? 'success'
                  : 'warning'
              }
            />
          </div>

          <dl className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg bg-white/60 p-3 dark:bg-slate-900/50">
              <dt className="text-xs font-medium uppercase tracking-wide text-text-muted dark:text-slate-400">
                Event
              </dt>
              <dd className="mt-1 break-all font-mono text-xs font-semibold text-text dark:text-white">
                {reconciliationResult.eventId}
              </dd>
            </div>
            <div className="rounded-lg bg-white/60 p-3 dark:bg-slate-900/50">
              <dt className="text-xs font-medium uppercase tracking-wide text-text-muted dark:text-slate-400">
                Tracking
              </dt>
              <dd className="mt-1">
                {reconciliationResult.trackingId ? (
                  <MaskedValue
                    kind={MASKED_VALUE_KINDS.RECORD_ID}
                    value={reconciliationResult.trackingId}
                  />
                ) : (
                  'Not matched'
                )}
              </dd>
            </div>
            <div className="rounded-lg bg-white/60 p-3 dark:bg-slate-900/50">
              <dt className="text-xs font-medium uppercase tracking-wide text-text-muted dark:text-slate-400">
                Duplicate prevented
              </dt>
              <dd className="mt-1 font-semibold text-text dark:text-white">
                {reconciliationResult.duplicatePrevented ? 'Yes' : 'No'}
              </dd>
            </div>
            <div className="rounded-lg bg-white/60 p-3 dark:bg-slate-900/50">
              <dt className="text-xs font-medium uppercase tracking-wide text-text-muted dark:text-slate-400">
                Idempotent replay
              </dt>
              <dd className="mt-1 font-semibold text-text dark:text-white">
                {reconciliationResult.idempotent ? 'Yes' : 'No'}
              </dd>
            </div>
          </dl>
        </section>
      )}

      {selectedTrackingId && (
        <section
          aria-labelledby="selected-sync-history-title"
          className="space-y-5"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2
                className="text-xl font-semibold text-lga-navy dark:text-white"
                id="selected-sync-history-title"
              >
                Selected tracking history
              </h2>
              <div className="mt-2">
                <MaskedValue
                  kind={MASKED_VALUE_KINDS.RECORD_ID}
                  label="Selected tracking identifier"
                  showLabel
                  value={selectedTrackingId}
                />
              </div>
            </div>
            <button
              className="inline-flex min-h-10 items-center justify-center rounded-lg border border-border bg-white px-4 py-2 text-sm font-semibold text-lga-navy transition-colors hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-lga-sky focus:ring-offset-2 dark:border-slate-600 dark:bg-slate-900 dark:text-white dark:hover:bg-slate-800"
              onClick={() => {
                setSelectedTrackingId('');
                setSelectedAttempts([]);
                setSelectedBadges({});
              }}
              type="button"
            >
              Close history
            </button>
          </div>

          {detailsLoading ? (
            <div
              className="rounded-xl border border-border bg-white px-5 py-10 text-center text-sm text-text-muted shadow-card dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
              role="status"
            >
              Loading synchronization history…
            </div>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {Object.values(INTEGRATION_SYSTEMS).map((system) => (
                  <SystemStatusCard
                    badge={selectedBadges[system]}
                    key={system}
                    system={system}
                  />
                ))}
              </div>

              <Timeline
                aria-label="Selected synchronization attempt history"
                emptyMessage="No synchronization history was found for this tracking identifier."
                getDescription={(attempt) => attempt.message}
                getItemId={(attempt) => attempt.syncAttemptId}
                getSource={(attempt) => attempt.system}
                getStatus={(attempt) => attempt.status}
                getTimestamp={(attempt) => getAttemptTimestamp(attempt)}
                getTitle={(attempt) =>
                  `${getSystemName(attempt.system)} — ${formatToken(
                    attempt.operation,
                  )}`
                }
                items={selectedAttempts}
                order="asc"
                title="Attempt timeline"
              />
            </>
          )}
        </section>
      )}

      <section aria-labelledby="sync-failures-title">
        <div>
          <h2
            className="text-xl font-semibold text-lga-navy dark:text-white"
            id="sync-failures-title"
          >
            Failed attempts
          </h2>
          <p className="mt-1 text-sm leading-6 text-text-muted dark:text-slate-300">
            Failed synchronization attempts can create operational
            synchronization-failure work items for follow-up.
          </p>
        </div>

        <FailureList
          attempts={failedAttempts}
          onSelect={selectTrackingHistory}
        />
      </section>

      <section aria-labelledby="sync-attempts-title">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2
              className="text-xl font-semibold text-lga-navy dark:text-white"
              id="sync-attempts-title"
            >
              Synchronization attempts
            </h2>
            <p className="mt-1 text-sm leading-6 text-text-muted dark:text-slate-300">
              Select a linked attempt to inspect the complete system history
              for its tracking identifier.
            </p>
          </div>
          <StatusBadge
            label={`${response.total} attempt${
              response.total === 1 ? '' : 's'
            }`}
            showDot={false}
            tone={response.total > 0 ? 'info' : 'neutral'}
          />
        </div>

        <DataTable
          aria-label="Synchronization attempt history"
          columns={columns}
          data={records}
          emptyMessage="No synchronization attempts matched the current filters."
          loading={loading}
          loadingMessage="Loading synchronization attempts…"
          pagination={false}
        />

        {response.totalPages > 1 && (
          <div className="mt-4 flex items-center justify-end gap-2">
            <button
              className="inline-flex min-h-10 items-center justify-center rounded-lg border border-border bg-white px-4 py-2 text-sm font-semibold text-lga-navy transition-colors hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-lga-sky focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-white dark:hover:bg-slate-800"
              disabled={loading || response.page <= 1}
              onClick={() => setPage(response.page - 1)}
              type="button"
            >
              Previous
            </button>
            <span className="min-w-24 text-center text-sm text-text-muted dark:text-slate-300">
              Page {response.page} of {response.totalPages}
            </span>
            <button
              className="inline-flex min-h-10 items-center justify-center rounded-lg border border-border bg-white px-4 py-2 text-sm font-semibold text-lga-navy transition-colors hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-lga-sky focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-white dark:hover:bg-slate-800"
              disabled={
                loading || response.page >= response.totalPages
              }
              onClick={() => setPage(response.page + 1)}
              type="button"
            >
              Next
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

SyncStatusPage.propTypes = {
  syncStatusService: PropTypes.shape({
    getStatusBadges: PropTypes.func.isRequired,
    reconcileHorizonEvent: PropTypes.func.isRequired,
    search: PropTypes.func.isRequired,
  }),
};

export default SyncStatusPage;