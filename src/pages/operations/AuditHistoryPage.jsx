import { useCallback, useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { canPerformAction } from '../../auth/permissionPolicy.js';
import DataTable from '../../components/shared/DataTable.jsx';
import JsonViewer from '../../components/shared/JsonViewer.jsx';
import MaskedValue, {
  MASKED_VALUE_KINDS,
} from '../../components/shared/MaskedValue.jsx';
import StatusBadge from '../../components/shared/StatusBadge.jsx';
import { AUDIT_ACTOR_TYPES, AUDIT_SOURCES } from '../../constants/domain.js';
import {
  INTERNAL_ROLES,
  PERMISSIONS,
} from '../../constants/roles.js';
import { createAuditService } from '../../services/shared/auditService.js';
import { useAuthStore } from '../../stores/authStore.js';
import { formatDisplayDateTime } from '../../utils/dates.js';

const DEFAULT_FILTERS = Object.freeze({
  action: '',
  actorId: '',
  actorType: '',
  correlationId: '',
  dateFrom: '',
  dateTo: '',
  recordId: '',
  source: '',
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

function normalizeSearchValue(value) {
  return String(value ?? '')
    .trim()
    .normalize('NFKC')
    .toLowerCase();
}

function toIsoDateTime(value, description) {
  if (value === '') {
    return undefined;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new RangeError(`${description} must be a valid date and time.`);
  }

  return date.toISOString();
}

function getCorrelationId(event) {
  return event.correlationId ?? event.metadata?.correlationId ?? null;
}

function getRecordIdentifier(event) {
  return (
    event.applicationId ??
    event.trackingId ??
    event.workItemId ??
    event.changeRequestId ??
    event.notificationId ??
    event.syncAttemptId ??
    event.sourceRecordId ??
    event.metadata?.recordId ??
    event.metadata?.entityId ??
    null
  );
}

function eventMatchesTextFilters(event, filters) {
  const action = normalizeSearchValue(filters.action);
  const actorId = normalizeSearchValue(filters.actorId);
  const correlationId = normalizeSearchValue(filters.correlationId);

  if (
    action !== '' &&
    !normalizeSearchValue(event.action).includes(action)
  ) {
    return false;
  }

  if (
    actorId !== '' &&
    !normalizeSearchValue(event.actorId).includes(actorId)
  ) {
    return false;
  }

  if (
    correlationId !== '' &&
    !normalizeSearchValue(getCorrelationId(event)).includes(
      correlationId,
    )
  ) {
    return false;
  }

  return true;
}

function SummaryCard({ description, label, tone, value }) {
  const toneClasses = {
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
  tone: PropTypes.oneOf(['info', 'success', 'warning']).isRequired,
  value: PropTypes.number.isRequired,
};

function FilterField({
  children,
  id,
  label,
}) {
  return (
    <div>
      <label
        className="block text-sm font-medium text-text dark:text-slate-100"
        htmlFor={id}
      >
        {label}
      </label>
      {children}
    </div>
  );
}

FilterField.propTypes = {
  children: PropTypes.node.isRequired,
  id: PropTypes.string.isRequired,
  label: PropTypes.string.isRequired,
};

/**
 * Displays authorized, redacted audit history with timestamp, actor, source,
 * action, record, and correlation filters.
 */
export function AuditHistoryPage({
  auditService: suppliedAuditService,
}) {
  const authState = useAuthStore();
  const principal = useMemo(
    () => createPrincipal(authState),
    [authState],
  );
  const role = principal.role;
  const authorized =
    authState.isAuthenticated &&
    INTERNAL_ROLES.includes(role) &&
    canPerformAction(principal, PERMISSIONS.VIEW_ONBOARDING);
  const auditService = useMemo(
    () => suppliedAuditService ?? createAuditService(),
    [suppliedAuditService],
  );
  const [filters, setFilters] = useState({ ...DEFAULT_FILTERS });
  const [appliedFilters, setAppliedFilters] = useState({
    ...DEFAULT_FILTERS,
  });
  const [events, setEvents] = useState([]);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState('');
  const [lastRefreshedAt, setLastRefreshedAt] = useState(null);

  const loadAuditHistory = useCallback(async () => {
    if (!authorized) {
      setEvents([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setPageError('');

    try {
      const since = toIsoDateTime(
        appliedFilters.dateFrom,
        'The start date',
      );
      const until = toIsoDateTime(
        appliedFilters.dateTo,
        'The end date',
      );

      if (
        since !== undefined &&
        until !== undefined &&
        Date.parse(since) > Date.parse(until)
      ) {
        throw new RangeError(
          'The start date cannot be after the end date.',
        );
      }

      const result = await Promise.resolve(
        auditService.query({
          ...(appliedFilters.recordId.trim() === ''
            ? {}
            : { recordId: appliedFilters.recordId.trim() }),
          ...(appliedFilters.actorType === ''
            ? {}
            : { actorType: appliedFilters.actorType }),
          ...(appliedFilters.source === ''
            ? {}
            : { source: appliedFilters.source }),
          ...(since === undefined ? {} : { since }),
          ...(until === undefined ? {} : { until }),
          sortOrder: 'desc',
        }),
      );

      if (!Array.isArray(result)) {
        throw new TypeError(
          'The audit service returned an invalid event collection.',
        );
      }

      const filteredEvents = result.filter((event) =>
        eventMatchesTextFilters(event, appliedFilters),
      );

      setEvents(filteredEvents);
      setSelectedEvent((currentEvent) => {
        if (!currentEvent) {
          return null;
        }

        return (
          filteredEvents.find(
            (event) =>
              (event.auditEventId ?? event.lifecycleEventId) ===
              (currentEvent.auditEventId ??
                currentEvent.lifecycleEventId),
          ) ?? null
        );
      });
      setLastRefreshedAt(new Date().toISOString());
    } catch (error) {
      setEvents([]);
      setSelectedEvent(null);
      setPageError(
        error instanceof Error && error.message
          ? error.message
          : 'The audit history could not be loaded.',
      );
    } finally {
      setLoading(false);
    }
  }, [appliedFilters, auditService, authorized]);

  useEffect(() => {
    loadAuditHistory();
  }, [loadAuditHistory]);

  const summary = useMemo(() => {
    const actors = new Set(
      events.map((event) => event.actorId).filter(Boolean),
    );
    const sources = new Set(
      events.map((event) => event.source).filter(Boolean),
    );
    const correlated = events.filter((event) =>
      Boolean(getCorrelationId(event)),
    ).length;

    return {
      total: events.length,
      actors: actors.size,
      sources: sources.size,
      correlated,
    };
  }, [events]);

  const columns = useMemo(
    () => [
      {
        id: 'timestamp',
        header: 'Timestamp',
        accessor: (event) => event.timestamp,
        render: (value) => (
          <time
            className="whitespace-nowrap text-sm"
            dateTime={value}
          >
            {formatDate(value)}
          </time>
        ),
      },
      {
        id: 'action',
        header: 'Action',
        accessor: (event) =>
          event.action ?? event.status ?? event.workflowStage,
        render: (value) => (
          <div className="min-w-44">
            <p className="font-semibold text-text dark:text-white">
              {formatToken(value)}
            </p>
          </div>
        ),
      },
      {
        id: 'actor',
        header: 'Actor',
        accessor: (event) => event.actorId,
        render: (value, event) => (
          <div className="space-y-1">
            <StatusBadge
              label={formatToken(event.actorType)}
              showDot={false}
              size="sm"
              tone="neutral"
            />
            {value && (
              <div>
                <MaskedValue
                  kind={MASKED_VALUE_KINDS.IDENTIFIER}
                  label="Audit actor"
                  value={value}
                />
              </div>
            )}
          </div>
        ),
      },
      {
        id: 'source',
        header: 'Source',
        accessor: (event) => event.source,
        render: (value) => (
          <StatusBadge
            showDot={false}
            size="sm"
            sourceSystem={value}
          />
        ),
      },
      {
        id: 'record',
        header: 'Record',
        accessor: (event) => getRecordIdentifier(event),
        render: (value) =>
          value ? (
            <MaskedValue
              kind={MASKED_VALUE_KINDS.RECORD_ID}
              value={value}
            />
          ) : (
            <span className="text-text-muted dark:text-slate-400">
              Not available
            </span>
          ),
      },
      {
        id: 'correlation',
        header: 'Correlation',
        accessor: (event) => getCorrelationId(event),
        render: (value) =>
          value ? (
            <MaskedValue
              kind={MASKED_VALUE_KINDS.RECORD_ID}
              label="Correlation identifier"
              value={value}
            />
          ) : (
            <span className="text-text-muted dark:text-slate-400">
              Not available
            </span>
          ),
      },
    ],
    [],
  );

  const updateFilter = (field, value) => {
    setFilters((currentFilters) => ({
      ...currentFilters,
      [field]: value,
    }));
    setPageError('');
  };

  const applyFilters = (event) => {
    event.preventDefault();
    setSelectedEvent(null);
    setAppliedFilters({ ...filters });
  };

  const resetFilters = () => {
    setFilters({ ...DEFAULT_FILTERS });
    setAppliedFilters({ ...DEFAULT_FILTERS });
    setSelectedEvent(null);
    setPageError('');
  };

  if (!authorized) {
    return (
      <section
        aria-labelledby="audit-history-denied-title"
        className="mx-auto max-w-3xl rounded-xl border border-danger bg-danger-light p-6 text-danger-dark shadow-card dark:border-red-700 dark:bg-danger-dark dark:text-red-100"
        role="alert"
      >
        <h1
          className="text-xl font-semibold"
          id="audit-history-denied-title"
        >
          Audit history access is unavailable
        </h1>
        <p className="mt-2 text-sm leading-6">
          An authenticated internal role with onboarding visibility is
          required to review audit history.
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
                label="Audit history"
                showDot={false}
                tone="accent"
              />
              <StatusBadge
                label="Internal access"
                showDot={false}
                tone="info"
              />
              <StatusBadge label="Simulation" showDot={false} simulation />
            </div>
            <h1 className="mt-4 text-2xl font-semibold sm:text-3xl">
              Operational audit history
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-primary-100 sm:text-base">
              Review redacted onboarding, work-item, synchronization,
              notification, and contract-change events by timestamp, actor,
              source, action, record, or correlation identifier.
            </p>
          </div>

          <button
            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-white/50 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-lga-navy disabled:cursor-not-allowed disabled:opacity-50"
            disabled={loading}
            onClick={loadAuditHistory}
            type="button"
          >
            {loading ? 'Refreshing…' : 'Refresh history'}
          </button>
        </div>
      </header>

      <aside
        className="rounded-xl border border-accent-300 bg-accent-100 p-4 text-sm leading-6 text-accent-950 dark:border-accent-700 dark:bg-accent-950 dark:text-accent-100"
        role="note"
      >
        Audit values are redacted before display. Use synthetic identifiers
        and filter values only. Audit history is stored locally in this
        browser and does not represent production activity.
      </aside>

      {pageError && (
        <div
          className="rounded-xl border border-danger bg-danger-light p-4 text-sm text-danger-dark dark:border-red-700 dark:bg-danger-dark dark:text-red-100"
          role="alert"
        >
          <p className="font-semibold">Audit history is unavailable</p>
          <p className="mt-1">{pageError}</p>
        </div>
      )}

      <section aria-labelledby="audit-summary-title">
        <div>
          <h2
            className="text-xl font-semibold text-lga-navy dark:text-white"
            id="audit-summary-title"
          >
            Result summary
          </h2>
          <p className="mt-1 text-sm text-text-muted dark:text-slate-300">
            Counts reflect the currently applied audit filters.
          </p>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryCard
            description="Audit events matching the current filters."
            label="Events"
            tone="info"
            value={summary.total}
          />
          <SummaryCard
            description="Distinct actors represented in the results."
            label="Actors"
            tone="info"
            value={summary.actors}
          />
          <SummaryCard
            description="Distinct source modules represented."
            label="Sources"
            tone="success"
            value={summary.sources}
          />
          <SummaryCard
            description="Events containing a correlation identifier."
            label="Correlated"
            tone="warning"
            value={summary.correlated}
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
        onSubmit={applyFilters}
      >
        <div className="border-b border-border px-5 py-4 sm:px-6 dark:border-slate-700">
          <h2 className="text-lg font-semibold text-lga-navy dark:text-white">
            Audit filters
          </h2>
          <p className="mt-1 text-sm text-text-muted dark:text-slate-300">
            Direct record filters use canonical and metadata identifiers.
            Text filters support partial action, actor, and correlation
            matches.
          </p>
        </div>

        <fieldset
          className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3 sm:p-6"
          disabled={loading}
        >
          <legend className="sr-only">Audit history filters</legend>

          <FilterField id="audit-date-from" label="From">
            <input
              className="mt-1 min-h-11 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text shadow-sm focus:border-lga-sky focus:outline-none focus:ring-2 focus:ring-lga-sky disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
              id="audit-date-from"
              onChange={(event) =>
                updateFilter('dateFrom', event.target.value)
              }
              type="datetime-local"
              value={filters.dateFrom}
            />
          </FilterField>

          <FilterField id="audit-date-to" label="To">
            <input
              className="mt-1 min-h-11 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text shadow-sm focus:border-lga-sky focus:outline-none focus:ring-2 focus:ring-lga-sky disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
              id="audit-date-to"
              onChange={(event) =>
                updateFilter('dateTo', event.target.value)
              }
              type="datetime-local"
              value={filters.dateTo}
            />
          </FilterField>

          <FilterField id="audit-actor-type" label="Actor type">
            <select
              className="mt-1 min-h-11 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text shadow-sm focus:border-lga-sky focus:outline-none focus:ring-2 focus:ring-lga-sky disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
              id="audit-actor-type"
              onChange={(event) =>
                updateFilter('actorType', event.target.value)
              }
              value={filters.actorType}
            >
              <option value="">All actor types</option>
              {Object.values(AUDIT_ACTOR_TYPES).map((actorType) => (
                <option key={actorType} value={actorType}>
                  {formatToken(actorType)}
                </option>
              ))}
            </select>
          </FilterField>

          <FilterField id="audit-actor-id" label="Actor identifier">
            <input
              className="mt-1 min-h-11 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text shadow-sm placeholder:text-slate-400 focus:border-lga-sky focus:outline-none focus:ring-2 focus:ring-lga-sky disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
              id="audit-actor-id"
              onChange={(event) =>
                updateFilter('actorId', event.target.value)
              }
              placeholder="usr_operations_demo"
              value={filters.actorId}
            />
          </FilterField>

          <FilterField id="audit-source" label="Source">
            <select
              className="mt-1 min-h-11 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text shadow-sm focus:border-lga-sky focus:outline-none focus:ring-2 focus:ring-lga-sky disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
              id="audit-source"
              onChange={(event) =>
                updateFilter('source', event.target.value)
              }
              value={filters.source}
            >
              <option value="">All sources</option>
              {Object.values(AUDIT_SOURCES).map((source) => (
                <option key={source} value={source}>
                  {formatToken(source)}
                </option>
              ))}
            </select>
          </FilterField>

          <FilterField id="audit-action" label="Action">
            <input
              className="mt-1 min-h-11 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text shadow-sm placeholder:text-slate-400 focus:border-lga-sky focus:outline-none focus:ring-2 focus:ring-lga-sky disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
              id="audit-action"
              onChange={(event) =>
                updateFilter('action', event.target.value)
              }
              placeholder="APPLICATION_SUBMITTED"
              value={filters.action}
            />
          </FilterField>

          <FilterField id="audit-record-id" label="Record identifier">
            <input
              className="mt-1 min-h-11 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text shadow-sm placeholder:text-slate-400 focus:border-lga-sky focus:outline-none focus:ring-2 focus:ring-lga-sky disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
              id="audit-record-id"
              onChange={(event) =>
                updateFilter('recordId', event.target.value)
              }
              placeholder="TRK-DEMO-1003"
              value={filters.recordId}
            />
          </FilterField>

          <FilterField
            id="audit-correlation-id"
            label="Correlation identifier"
          >
            <input
              className="mt-1 min-h-11 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text shadow-sm placeholder:text-slate-400 focus:border-lga-sky focus:outline-none focus:ring-2 focus:ring-lga-sky disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
              id="audit-correlation-id"
              onChange={(event) =>
                updateFilter('correlationId', event.target.value)
              }
              placeholder="corr-demo"
              value={filters.correlationId}
            />
          </FilterField>
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
            {loading ? 'Filtering…' : 'Apply filters'}
          </button>
        </div>
      </form>

      {selectedEvent && (
        <section
          aria-labelledby="selected-audit-event-title"
          className="space-y-4"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2
                className="text-xl font-semibold text-lga-navy dark:text-white"
                id="selected-audit-event-title"
              >
                Selected event
              </h2>
              <p className="mt-1 text-sm text-text-muted dark:text-slate-300">
                Review the redacted event payload and audit metadata.
              </p>
            </div>
            <button
              className="inline-flex min-h-10 items-center justify-center rounded-lg border border-border bg-white px-4 py-2 text-sm font-semibold text-lga-navy transition-colors hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-lga-sky focus:ring-offset-2 dark:border-slate-600 dark:bg-slate-900 dark:text-white dark:hover:bg-slate-800"
              onClick={() => setSelectedEvent(null)}
              type="button"
            >
              Close event
            </button>
          </div>

          <JsonViewer
            data={selectedEvent}
            fileName={`audit-event-${
              selectedEvent.auditEventId ??
              selectedEvent.lifecycleEventId ??
              'details'
            }.json`}
            initiallyExpanded
            redact
            title="Redacted audit event"
          />
        </section>
      )}

      <section aria-labelledby="audit-results-title">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2
              className="text-xl font-semibold text-lga-navy dark:text-white"
              id="audit-results-title"
            >
              Audit events
            </h2>
            <p className="mt-1 text-sm leading-6 text-text-muted dark:text-slate-300">
              Select a row to inspect its complete redacted payload.
            </p>
          </div>
          <StatusBadge
            label={`${events.length} event${
              events.length === 1 ? '' : 's'
            }`}
            showDot={false}
            tone={events.length > 0 ? 'info' : 'neutral'}
          />
        </div>

        <DataTable
          aria-label="Operational audit history"
          columns={columns}
          data={events}
          defaultPageSize={25}
          defaultSortBy="timestamp"
          defaultSortDirection="desc"
          emptyMessage="No audit events matched the current filters."
          getRowId={(event, index) =>
            event.auditEventId ??
            event.lifecycleEventId ??
            `audit-event-${index}`
          }
          loading={loading}
          loadingMessage="Loading redacted audit history…"
          onRowClick={(event) => setSelectedEvent(event)}
          pageSizeOptions={[10, 25, 50, 100]}
        />
      </section>
    </div>
  );
}

AuditHistoryPage.propTypes = {
  auditService: PropTypes.shape({
    query: PropTypes.func.isRequired,
  }),
};

export default AuditHistoryPage;