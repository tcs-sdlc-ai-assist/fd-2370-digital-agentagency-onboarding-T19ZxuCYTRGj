import { useCallback, useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { Link } from 'react-router-dom';
import DataTable from '../../components/shared/DataTable.jsx';
import JsonViewer from '../../components/shared/JsonViewer.jsx';
import MaskedValue, {
  MASKED_VALUE_KINDS,
} from '../../components/shared/MaskedValue.jsx';
import StatusBadge from '../../components/shared/StatusBadge.jsx';
import { getPartnerOnboardingRoute } from '../../constants/routes.js';
import {
  createPartnerStatusService,
  PARTNER_STATUS_LOOKUP_TYPES,
} from '../../services/operations/partnerStatusService.js';
import { useAuthStore } from '../../stores/authStore.js';
import { formatDisplayDateTime } from '../../utils/dates.js';

const MOCK_STATUS_SEARCH_PATH = '/mock-api/partner/status/search';
const DEFAULT_RECENT_DAYS = 30;
const DEFAULT_PAGE_SIZE = 10;

const LOOKUP_OPTIONS = Object.freeze([
  {
    label: 'Tracking ID',
    value: PARTNER_STATUS_LOOKUP_TYPES.TRACKING_ID,
    placeholder: 'TRK-DEMO-1001',
  },
  {
    label: 'Application number',
    value: PARTNER_STATUS_LOOKUP_TYPES.APPLICATION_NUMBER,
    placeholder: 'APP-DEMO-1001',
  },
  {
    label: 'National producer number (NPN)',
    value: PARTNER_STATUS_LOOKUP_TYPES.NPN,
    placeholder: '8101001',
  },
  {
    label: 'Agent code',
    value: PARTNER_STATUS_LOOKUP_TYPES.AGENT_CODE,
    placeholder: 'MCON1006',
  },
  {
    label: 'Recent activity',
    value: PARTNER_STATUS_LOOKUP_TYPES.RECENT_DAYS,
    placeholder: '',
  },
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
    .replace(/[_-]+/g, ' ')
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

function getLifecycleStatus(record) {
  return (
    record.lifecycle?.currentStatus ??
    record.workflowStage ??
    record.status ??
    'New'
  );
}

function getStatusTone(status) {
  const normalizedStatus = String(status ?? '')
    .trim()
    .toLowerCase();

  if (
    normalizedStatus.includes('terminated') ||
    normalizedStatus.includes('declined') ||
    normalizedStatus.includes('failed')
  ) {
    return 'danger';
  }

  if (
    normalizedStatus.includes('contracted') ||
    normalizedStatus.includes('completed') ||
    normalizedStatus.includes('active')
  ) {
    return 'success';
  }

  if (
    normalizedStatus.includes('review') ||
    normalizedStatus.includes('background') ||
    normalizedStatus.includes('appointment') ||
    normalizedStatus.includes('action')
  ) {
    return 'warning';
  }

  return 'info';
}

function getSyncSummary(syncStatuses) {
  const statuses = Object.values(syncStatuses ?? {});

  if (statuses.length === 0) {
    return 'No sync history';
  }

  const failed = statuses.filter(
    (status) => status.status === 'failed',
  ).length;
  const successful = statuses.filter(
    (status) => status.status === 'success',
  ).length;
  const pending = statuses.filter((status) =>
    ['pending', 'queued'].includes(status.status),
  ).length;

  if (failed > 0) {
    return `${failed} failed`;
  }

  if (pending > 0) {
    return `${pending} pending`;
  }

  if (successful > 0) {
    return `${successful} successful`;
  }

  return 'No completed syncs';
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

/**
 * Provides a partner-scoped onboarding status search and mock API explorer.
 */
export function PartnerStatusExplorerPage() {
  const authState = useAuthStore();
  const principal = useMemo(
    () => createPrincipal(authState),
    [authState],
  );
  const partnerCode =
    authState.partnerContext?.partnerCode ??
    authState.partnerContext?.partnerId ??
    authState.activePartnerCode ??
    'DEMO_PARTNER';
  const statusService = useMemo(
    () =>
      createPartnerStatusService({
        principal,
        partnerContext: authState.partnerContext,
        auditService: false,
      }),
    [authState.partnerContext, principal],
  );
  const [lookupType, setLookupType] = useState(
    PARTNER_STATUS_LOOKUP_TYPES.RECENT_DAYS,
  );
  const [lookupValue, setLookupValue] = useState('');
  const [recentDays, setRecentDays] = useState(DEFAULT_RECENT_DAYS);
  const [includeHistory, setIncludeHistory] = useState(false);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [response, setResponse] = useState(null);
  const [submittedRequest, setSubmittedRequest] = useState(null);
  const [apiResponse, setApiResponse] = useState(null);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState('');
  const selectedLookup =
    LOOKUP_OPTIONS.find((option) => option.value === lookupType) ??
    LOOKUP_OPTIONS[0];
  const directLookup =
    lookupType !== PARTNER_STATUS_LOOKUP_TYPES.RECENT_DAYS;

  const createSearchRequest = useCallback(
    (page = 1) => ({
      partnerId: partnerCode,
      partnerCode,
      lookupType,
      ...(directLookup
        ? { lookupValue: lookupValue.trim() }
        : { recentDays }),
      includeHistory,
      page,
      pageSize,
    }),
    [
      directLookup,
      includeHistory,
      lookupType,
      lookupValue,
      pageSize,
      partnerCode,
      recentDays,
    ],
  );

  const executeSearch = useCallback(
    async (request) => {
      setLoading(true);
      setPageError('');
      setSubmittedRequest(request);

      try {
        const result = await Promise.resolve(
          statusService.search(request, principal),
        );
        const nextApiResponse = {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'x-mock-api': 'digital-onboarding',
            'x-partner-scope': partnerCode,
          },
          body: result,
        };

        setResponse(result);
        setApiResponse(nextApiResponse);
      } catch (error) {
        const message =
          error instanceof Error && error.message
            ? error.message
            : 'The partner status search could not be completed.';
        const status =
          error?.code === 'PARTNER_SCOPE_VIOLATION' ||
          error?.code === 'PARTNER_SCOPE_VIOLATION'
            ? 403
            : error?.code === 'UNAUTHENTICATED'
              ? 401
              : 400;

        setResponse(null);
        setPageError(message);
        setApiResponse({
          status,
          headers: {
            'content-type': 'application/json',
            'x-mock-api': 'digital-onboarding',
          },
          body: {
            error: {
              code:
                error?.code ?? 'PARTNER_STATUS_SEARCH_FAILED',
              message,
              details: error?.details ?? null,
              recoverable: error?.recoverable !== false,
              suggestedAction:
                status === 403
                  ? 'Return to your authorized partner scope.'
                  : 'Review the search values and try again.',
            },
          },
        });
      } finally {
        setLoading(false);
      }
    },
    [partnerCode, principal, statusService],
  );

  useEffect(() => {
    executeSearch({
      partnerId: partnerCode,
      partnerCode,
      lookupType: PARTNER_STATUS_LOOKUP_TYPES.RECENT_DAYS,
      recentDays: DEFAULT_RECENT_DAYS,
      includeHistory: false,
      page: 1,
      pageSize: DEFAULT_PAGE_SIZE,
    });
  }, [executeSearch, partnerCode]);

  const requestPreview = useMemo(
    () => ({
      method: 'POST',
      path: MOCK_STATUS_SEARCH_PATH,
      headers: {
        'content-type': 'application/json',
        'x-simulation-mode': 'true',
      },
      body: createSearchRequest(1),
    }),
    [createSearchRequest],
  );

  const records = response?.data ?? [];
  const summary = useMemo(() => {
    const statuses = records.map((record) =>
      String(getLifecycleStatus(record)).toLowerCase(),
    );

    return {
      total: response?.total ?? 0,
      displayed: records.length,
      inReview: statuses.filter(
        (status) =>
          status.includes('review') ||
          status.includes('background') ||
          status.includes('appointment'),
      ).length,
      completed: statuses.filter(
        (status) =>
          status.includes('contracted') ||
          status.includes('completed'),
      ).length,
    };
  }, [records, response?.total]);

  const columns = useMemo(
    () => [
      {
        id: 'applicant',
        header: 'Applicant',
        accessor: (record) =>
          record.agent?.fullName ?? 'Applicant not available',
        render: (value, record) => (
          <div className="min-w-44">
            <p className="font-semibold text-text dark:text-white">
              {value}
            </p>
            <p className="mt-1 text-xs text-text-muted dark:text-slate-400">
              {record.contract?.company ?? 'Company not available'}
            </p>
          </div>
        ),
      },
      {
        id: 'identifiers',
        header: 'Application',
        accessor: (record) => record.applicationId,
        render: (value, record) => (
          <div className="space-y-1">
            <p className="break-all font-mono text-xs text-text dark:text-slate-200">
              {value ?? 'Not available'}
            </p>
            {record.trackingId && (
              <MaskedValue
                kind={MASKED_VALUE_KINDS.RECORD_ID}
                label="Tracking identifier"
                value={record.trackingId}
              />
            )}
          </div>
        ),
      },
      {
        id: 'producerIdentifiers',
        header: 'Producer identifiers',
        accessor: (record) => record.agent?.npn,
        render: (value, record) => (
          <div className="space-y-1">
            {value ? (
              <MaskedValue
                kind={MASKED_VALUE_KINDS.IDENTIFIER}
                label="National producer number"
                value={value}
              />
            ) : (
              <span className="text-text-muted dark:text-slate-400">
                NPN unavailable
              </span>
            )}
            {record.agent?.agentCode && (
              <div>
                <MaskedValue
                  kind={MASKED_VALUE_KINDS.IDENTIFIER}
                  label="Agent code"
                  value={record.agent.agentCode}
                />
              </div>
            )}
          </div>
        ),
      },
      {
        id: 'lifecycle',
        header: 'Lifecycle',
        accessor: (record) => getLifecycleStatus(record),
        render: (value) => (
          <StatusBadge
            showDot={false}
            status={value}
            tone={getStatusTone(value)}
          />
        ),
      },
      {
        id: 'sync',
        header: 'System sync',
        accessor: (record) => getSyncSummary(record.syncStatuses),
        render: (value) => (
          <span className="text-sm text-text-muted dark:text-slate-300">
            {value}
          </span>
        ),
      },
      {
        id: 'updatedAt',
        header: 'Last updated',
        accessor: (record) =>
          record.lifecycle?.updatedAt ?? record.updatedAt,
        render: (value) => formatDate(value),
      },
      {
        id: 'details',
        header: 'Details',
        sortable: false,
        accessor: (record) => record.applicationId,
        render: (value) =>
          value ? (
            <Link
              className="inline-flex min-h-10 items-center justify-center rounded-lg border border-border bg-white px-3 py-2 text-sm font-semibold text-lga-navy transition-colors hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-lga-sky focus:ring-offset-2 dark:border-slate-600 dark:bg-slate-900 dark:text-white dark:hover:bg-slate-800"
              to={getPartnerOnboardingRoute(value)}
            >
              View status
            </Link>
          ) : (
            '—'
          ),
      },
    ],
    [],
  );

  const handleSubmit = (event) => {
    event.preventDefault();

    if (directLookup && lookupValue.trim() === '') {
      setPageError(
        `Enter a ${selectedLookup.label.toLowerCase()} before searching.`,
      );
      return;
    }

    executeSearch(createSearchRequest(1));
  };

  const changePage = (page) => {
    executeSearch(createSearchRequest(page));
  };

  const resetSearch = () => {
    setLookupType(PARTNER_STATUS_LOOKUP_TYPES.RECENT_DAYS);
    setLookupValue('');
    setRecentDays(DEFAULT_RECENT_DAYS);
    setIncludeHistory(false);
    setPageSize(DEFAULT_PAGE_SIZE);
    setPageError('');

    executeSearch({
      partnerId: partnerCode,
      partnerCode,
      lookupType: PARTNER_STATUS_LOOKUP_TYPES.RECENT_DAYS,
      recentDays: DEFAULT_RECENT_DAYS,
      includeHistory: false,
      page: 1,
      pageSize: DEFAULT_PAGE_SIZE,
    });
  };

  return (
    <div className="mx-auto w-full max-w-7xl space-y-7">
      <header>
        <div className="flex flex-wrap gap-2">
          <StatusBadge
            label="Partner status API"
            showDot={false}
            tone="info"
          />
          <StatusBadge label="Simulation" showDot={false} simulation />
          <StatusBadge
            label="Partner scoped"
            showDot={false}
            tone="accent"
          />
        </div>
        <h1 className="mt-3 text-2xl font-semibold text-lga-navy sm:text-3xl dark:text-white">
          Partner status explorer
        </h1>
        <p className="mt-2 max-w-4xl text-sm leading-6 text-text-muted sm:text-base dark:text-slate-300">
          Search authorized onboarding records by tracking ID, application
          number, NPN, agent code, or a recent activity window. Inspect the
          redacted mock API request and response payloads below.
        </p>
        <p className="mt-2 text-xs text-text-muted dark:text-slate-400">
          Active partner:{' '}
          <span className="font-semibold text-text dark:text-slate-200">
            {partnerCode}
          </span>
        </p>
      </header>

      <aside
        className="rounded-xl border border-accent-300 bg-accent-100 p-4 text-sm leading-6 text-accent-950 dark:border-accent-700 dark:bg-accent-950 dark:text-accent-100"
        role="note"
      >
        Results are restricted to the current partner scope. Use synthetic
        identifiers only. This explorer processes requests locally and does
        not call a partner or production API.
      </aside>

      {pageError && (
        <div
          className="rounded-xl border border-danger bg-danger-light p-4 text-sm text-danger-dark dark:border-red-700 dark:bg-danger-dark dark:text-red-100"
          role="alert"
        >
          <p className="font-semibold">Status search could not continue</p>
          <p className="mt-1">{pageError}</p>
        </div>
      )}

      <form
        className="overflow-hidden rounded-xl border border-border bg-white shadow-card dark:border-slate-700 dark:bg-slate-900"
        noValidate
        onSubmit={handleSubmit}
      >
        <div className="border-b border-border px-5 py-4 sm:px-6 dark:border-slate-700">
          <h2 className="text-lg font-semibold text-lga-navy dark:text-white">
            Status search
          </h2>
          <p className="mt-1 text-sm text-text-muted dark:text-slate-300">
            Choose one lookup strategy and submit a scoped mock API request.
          </p>
        </div>

        <fieldset
          className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4 sm:p-6"
          disabled={loading}
        >
          <legend className="sr-only">
            Partner status search options
          </legend>

          <div>
            <label
              className="block text-sm font-medium text-text dark:text-slate-100"
              htmlFor="partner-status-lookup-type"
            >
              Lookup type
            </label>
            <select
              className="mt-1 min-h-11 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text shadow-sm focus:border-lga-sky focus:outline-none focus:ring-2 focus:ring-lga-sky disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
              id="partner-status-lookup-type"
              onChange={(event) => {
                setLookupType(event.target.value);
                setLookupValue('');
                setPageError('');
              }}
              value={lookupType}
            >
              {LOOKUP_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {directLookup ? (
            <div className="sm:col-span-1 lg:col-span-2">
              <label
                className="block text-sm font-medium text-text dark:text-slate-100"
                htmlFor="partner-status-lookup-value"
              >
                {selectedLookup.label}
              </label>
              <input
                className="mt-1 min-h-11 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text shadow-sm placeholder:text-slate-400 focus:border-lga-sky focus:outline-none focus:ring-2 focus:ring-lga-sky disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                id="partner-status-lookup-value"
                onChange={(event) => {
                  setLookupValue(event.target.value);
                  setPageError('');
                }}
                placeholder={selectedLookup.placeholder}
                value={lookupValue}
              />
            </div>
          ) : (
            <div>
              <label
                className="block text-sm font-medium text-text dark:text-slate-100"
                htmlFor="partner-status-recent-days"
              >
                Recent days
              </label>
              <input
                className="mt-1 min-h-11 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text shadow-sm focus:border-lga-sky focus:outline-none focus:ring-2 focus:ring-lga-sky disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                id="partner-status-recent-days"
                max="365"
                min="1"
                onChange={(event) => {
                  const value = Number(event.target.value);

                  setRecentDays(value);
                  setPageError('');
                }}
                type="number"
                value={recentDays}
              />
            </div>
          )}

          <div>
            <label
              className="block text-sm font-medium text-text dark:text-slate-100"
              htmlFor="partner-status-page-size"
            >
              Results per page
            </label>
            <select
              className="mt-1 min-h-11 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text shadow-sm focus:border-lga-sky focus:outline-none focus:ring-2 focus:ring-lga-sky disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
              id="partner-status-page-size"
              onChange={(event) =>
                setPageSize(Number(event.target.value))
              }
              value={pageSize}
            >
              {[10, 25, 50, 100].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>

          <label className="flex min-h-11 items-start gap-3 rounded-lg border border-border bg-surface-muted px-4 py-3 text-sm text-text sm:col-span-2 lg:col-span-4 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
            <input
              checked={includeHistory}
              className="mt-0.5 size-5 shrink-0 rounded border-border text-lga-navy focus:ring-2 focus:ring-lga-sky"
              onChange={(event) =>
                setIncludeHistory(event.target.checked)
              }
              type="checkbox"
            />
            <span>
              <span className="font-medium">
                Include lifecycle history
              </span>
              <span className="mt-1 block text-xs leading-5 text-text-muted dark:text-slate-400">
                Add authorized milestone history to each returned status
                record.
              </span>
            </span>
          </label>
        </fieldset>

        <div className="flex flex-col gap-3 border-t border-border bg-surface-muted px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 dark:border-slate-700 dark:bg-slate-800">
          <p className="break-all font-mono text-xs text-text-muted dark:text-slate-300">
            POST {MOCK_STATUS_SEARCH_PATH}
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-border bg-white px-5 py-2 text-sm font-semibold text-lga-navy transition-colors hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-lga-sky focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-white dark:hover:bg-slate-800"
              disabled={loading}
              onClick={resetSearch}
              type="button"
            >
              Reset
            </button>
            <button
              className="inline-flex min-h-11 items-center justify-center rounded-lg bg-lga-navy px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-800 focus:outline-none focus:ring-2 focus:ring-lga-sky focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-primary-600 dark:hover:bg-primary-500"
              disabled={loading}
              type="submit"
            >
              {loading ? 'Searching…' : 'Search partner status'}
            </button>
          </div>
        </div>

        <div aria-live="polite" className="sr-only" role="status">
          {loading
            ? 'Searching authorized partner status records.'
            : response
              ? `${response.total} authorized status records found.`
              : ''}
        </div>
      </form>

      <section aria-labelledby="partner-status-summary-title">
        <h2
          className="text-xl font-semibold text-lga-navy dark:text-white"
          id="partner-status-summary-title"
        >
          Scoped result summary
        </h2>
        <p className="mt-1 text-sm text-text-muted dark:text-slate-300">
          Counts reflect the current authorized search response.
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryCard
            description="Total records matching the scoped lookup."
            label="Matching records"
            tone="info"
            value={summary.total}
          />
          <SummaryCard
            description="Records returned on the current response page."
            label="Displayed"
            tone="info"
            value={summary.displayed}
          />
          <SummaryCard
            description="Displayed records in review or provider processing."
            label="In review"
            tone="warning"
            value={summary.inReview}
          />
          <SummaryCard
            description="Displayed records with completed outcomes."
            label="Completed"
            tone="success"
            value={summary.completed}
          />
        </div>
      </section>

      <section aria-labelledby="partner-status-results-title">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2
              className="text-xl font-semibold text-lga-navy dark:text-white"
              id="partner-status-results-title"
            >
              Status records
            </h2>
            <p className="mt-1 text-sm text-text-muted dark:text-slate-300">
              Sensitive producer and record identifiers are masked in this
              list view.
            </p>
          </div>
          {response && (
            <StatusBadge
              label={`Page ${response.page} of ${
                response.totalPages || 1
              }`}
              showDot={false}
              tone="neutral"
            />
          )}
        </div>

        <DataTable
          aria-label="Partner status search results"
          columns={columns}
          data={records}
          emptyMessage="No authorized onboarding records matched this lookup."
          loading={loading}
          loadingMessage="Searching partner status records…"
          pagination={false}
        />

        {response && response.totalPages > 1 && (
          <div className="mt-4 flex items-center justify-end gap-2">
            <button
              className="inline-flex min-h-10 items-center justify-center rounded-lg border border-border bg-white px-4 py-2 text-sm font-semibold text-lga-navy transition-colors hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-lga-sky focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-white dark:hover:bg-slate-800"
              disabled={loading || response.page <= 1}
              onClick={() => changePage(response.page - 1)}
              type="button"
            >
              Previous
            </button>
            <button
              className="inline-flex min-h-10 items-center justify-center rounded-lg border border-border bg-white px-4 py-2 text-sm font-semibold text-lga-navy transition-colors hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-lga-sky focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-white dark:hover:bg-slate-800"
              disabled={
                loading || response.page >= response.totalPages
              }
              onClick={() => changePage(response.page + 1)}
              type="button"
            >
              Next
            </button>
          </div>
        )}
      </section>

      <section
        aria-labelledby="partner-status-api-payload-title"
        className="space-y-4"
      >
        <div>
          <h2
            className="text-xl font-semibold text-lga-navy dark:text-white"
            id="partner-status-api-payload-title"
          >
            Mock API payload
          </h2>
          <p className="mt-1 text-sm leading-6 text-text-muted dark:text-slate-300">
            Inspect the redacted request and response generated by this
            browser-only partner status contract.
          </p>
        </div>

        <div className="grid gap-5 xl:grid-cols-2">
          <JsonViewer
            data={
              submittedRequest
                ? {
                    ...requestPreview,
                    body: submittedRequest,
                  }
                : requestPreview
            }
            fileName="partner-status-search-request.json"
            initiallyExpanded
            redact
            title={
              submittedRequest
                ? 'Submitted status request'
                : 'Status request preview'
            }
          />
          <JsonViewer
            data={
              apiResponse ?? {
                status: null,
                headers: {
                  'content-type': 'application/json',
                },
                body: {
                  message:
                    'Submit a status search to view the simulated response.',
                },
              }
            }
            fileName="partner-status-search-response.json"
            initiallyExpanded
            redact
            title="Status API response"
          />
        </div>
      </section>
    </div>
  );
}

export default PartnerStatusExplorerPage;