import { useCallback, useMemo, useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import DataTable from '../../components/shared/DataTable.jsx';
import MaskedValue, {
  MASKED_VALUE_KINDS,
} from '../../components/shared/MaskedValue.jsx';
import StatusBadge from '../../components/shared/StatusBadge.jsx';
import {
  getJourneyRoute,
  getPartnerOnboardingRoute,
  ROUTES,
} from '../../constants/routes.js';
import { createPartnerDashboardService } from '../../services/operations/partnerDashboardService.js';
import {
  createPartnerStatusService,
  PARTNER_STATUS_LOOKUP_TYPES,
} from '../../services/operations/partnerStatusService.js';
import { useAuthStore } from '../../stores/authStore.js';
import { formatDisplayDateTime } from '../../utils/dates.js';

const RECENT_STATUS_DAYS = 365;

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

function getApplicationName(record) {
  return (
    record.agent?.fullName ??
    record.hierarchy?.agencyName ??
    'Applicant not available'
  );
}

function getLifecycleStatus(record) {
  return (
    record.lifecycle?.currentStatus ??
    record.workflowStage ??
    record.status ??
    'New'
  );
}

function getProgressTone(status) {
  const normalizedStatus = String(status ?? '').toLowerCase();

  if (
    normalizedStatus.includes('terminated') ||
    normalizedStatus.includes('declined')
  ) {
    return 'danger';
  }

  if (
    normalizedStatus.includes('contracted') ||
    normalizedStatus.includes('completed')
  ) {
    return 'success';
  }

  if (
    normalizedStatus.includes('review') ||
    normalizedStatus.includes('background') ||
    normalizedStatus.includes('appointment')
  ) {
    return 'warning';
  }

  return 'info';
}

function getSyncSummary(syncStatuses) {
  const statuses = Object.values(syncStatuses ?? {});

  if (statuses.length === 0) {
    return 'No synchronization history';
  }

  const failed = statuses.filter(
    (status) => status.status === 'failed',
  ).length;
  const successful = statuses.filter(
    (status) => status.status === 'success',
  ).length;

  if (failed > 0) {
    return `${failed} failed`;
  }

  if (successful > 0) {
    return `${successful} successful`;
  }

  return 'Pending or not started';
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

SummaryCard.propTypes = {};

function DraftCard({ draft }) {
  return (
    <li className="rounded-xl border border-border bg-white p-5 shadow-card dark:border-slate-700 dark:bg-slate-900">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap gap-2">
            <StatusBadge
              label={formatToken(draft.journeyType)}
              showDot={false}
              tone="info"
            />
            <StatusBadge
              label={`${draft.completionPercent}% complete`}
              showDot={false}
              tone={
                draft.completionPercent > 0 ? 'warning' : 'neutral'
              }
            />
          </div>
          <h3 className="mt-3 text-lg font-semibold text-lga-navy dark:text-white">
            {draft.applicantName}
          </h3>
          <p className="mt-1 text-sm text-text-muted dark:text-slate-300">
            Current step: {formatToken(draft.currentStepId)}
          </p>
          <p className="mt-2 text-xs text-text-muted dark:text-slate-400">
            Last saved {formatDate(draft.lastSavedAt)}
          </p>
        </div>

        <Link
          className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg bg-lga-navy px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-800 focus:outline-none focus:ring-2 focus:ring-lga-sky focus:ring-offset-2 dark:bg-primary-600 dark:hover:bg-primary-500 dark:focus:ring-offset-slate-900"
          to={getJourneyRoute(draft.trackingId)}
        >
          Resume journey
        </Link>
      </div>

      <div className="mt-4 h-2 overflow-hidden rounded-full bg-surface-subtle dark:bg-slate-700">
        <div
          aria-label={`${draft.completionPercent}% complete`}
          className={`h-full rounded-full bg-lga-sky ${
            draft.completionPercent >= 75
              ? 'w-3/4'
              : draft.completionPercent >= 50
                ? 'w-1/2'
                : draft.completionPercent >= 25
                  ? 'w-1/4'
                  : draft.completionPercent > 0
                    ? 'w-1/12'
                    : 'w-0'
          }`}
          role="progressbar"
          aria-valuemax="100"
          aria-valuemin="0"
          aria-valuenow={draft.completionPercent}
        />
      </div>
    </li>
  );
}

DraftCard.propTypes = {};

/**
 * Displays partner-scoped onboarding activity, lifecycle summaries, entry
 * points, and locally resumable guided journeys.
 */
export function PartnerDashboardPage() {
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
  const dashboardService = useMemo(
    () =>
      createPartnerDashboardService({
        partnerCode,
        principal,
        partnerContext: authState.partnerContext,
        auditService: false,
      }),
    [authState.partnerContext, partnerCode, principal],
  );
  const [applications, setApplications] = useState([]);
  const [drafts, setDrafts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState('');
  const [lastRefreshedAt, setLastRefreshedAt] = useState(null);

  const loadDashboard = useCallback(() => {
    setLoading(true);
    setPageError('');

    try {
      statusService.clearCache();

      const statusResponse = statusService.search(
        {
          partnerCode,
          lookupType: PARTNER_STATUS_LOOKUP_TYPES.RECENT_DAYS,
          recentDays: RECENT_STATUS_DAYS,
          includeHistory: false,
          page: 1,
          pageSize: 100,
        },
        principal,
      );
      const draftResponse = dashboardService.listResumableDrafts(
        {
          partnerCode,
          page: 1,
          pageSize: 100,
        },
        principal,
      );

      setApplications(statusResponse.data ?? []);
      setDrafts(draftResponse.drafts ?? []);
      setLastRefreshedAt(new Date().toISOString());
    } catch (error) {
      setApplications([]);
      setDrafts([]);
      setPageError(
        error instanceof Error && error.message
          ? error.message
          : 'The partner dashboard could not be loaded. Try again.',
      );
    } finally {
      setLoading(false);
    }
  }, [dashboardService, partnerCode, principal, statusService]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  const summary = useMemo(() => {
    const lifecycleStatuses = applications.map((application) =>
      String(getLifecycleStatus(application)).toLowerCase(),
    );

    return {
      total: applications.length,
      inProgress: lifecycleStatuses.filter(
        (status) =>
          !status.includes('contracted') &&
          !status.includes('terminated') &&
          !status.includes('completed'),
      ).length,
      actionRequired: applications.filter(
        (application) =>
          String(application.status).toLowerCase() ===
            'action_required' ||
          application.notificationFlags?.carrierSubmissionBlocked ===
            true,
      ).length,
      completed: lifecycleStatuses.filter(
        (status) =>
          status.includes('contracted') ||
          status.includes('completed'),
      ).length,
    };
  }, [applications]);

  const columns = useMemo(
    () => [
      {
        id: 'applicant',
        header: 'Applicant',
        accessor: (record) => getApplicationName(record),
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
        id: 'applicationId',
        header: 'Application',
        accessor: (record) => record.applicationId,
        render: (value, record) => (
          <div>
            <p className="font-mono text-xs text-text dark:text-slate-200">
              {value ?? 'Not available'}
            </p>
            {record.trackingId && (
              <div className="mt-1">
                <MaskedValue
                  kind={MASKED_VALUE_KINDS.RECORD_ID}
                  label="Tracking identifier"
                  value={record.trackingId}
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
            tone={getProgressTone(value)}
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

  return (
    <div className="mx-auto w-full max-w-7xl space-y-7">
      <header className="overflow-hidden rounded-2xl bg-lga-navy text-white shadow-elevated">
        <div className="grid gap-6 px-6 py-7 sm:px-8 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <div className="flex flex-wrap gap-2">
              <StatusBadge
                label="Partner dashboard"
                showDot={false}
                tone="accent"
              />
              <StatusBadge
                label="Simulation"
                showDot={false}
                simulation
              />
            </div>
            <h1 className="mt-4 text-2xl font-semibold sm:text-3xl">
              Onboarding activity
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-primary-100 sm:text-base">
              Start or resume synthetic onboarding and monitor lifecycle,
              synchronization, and notification status for your authorized
              partner scope.
            </p>
            <p className="mt-2 text-xs text-primary-100">
              Active partner: <span className="font-semibold">{partnerCode}</span>
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row lg:flex-col">
            <Link
              className="inline-flex min-h-11 items-center justify-center rounded-lg bg-lga-gold px-5 py-2 text-sm font-semibold text-lga-navy transition-colors hover:bg-accent-300 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-lga-navy"
              to={ROUTES.JOURNEY_NEW}
            >
              Start onboarding
            </Link>
            <Link
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-white/50 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-lga-navy"
              to={ROUTES.INTAKE}
            >
              Import mock submission
            </Link>
          </div>
        </div>
      </header>

      <aside
        className="rounded-xl border border-accent-300 bg-accent-100 p-4 text-sm leading-6 text-accent-950 dark:border-accent-700 dark:bg-accent-950 dark:text-accent-100"
        role="note"
      >
        This dashboard is restricted to the active partner scope. Use
        synthetic identities, licensing details, documents, and contact
        information only.
      </aside>

      {pageError && (
        <div
          className="rounded-xl border border-danger bg-danger-light p-4 text-sm text-danger-dark dark:border-red-700 dark:bg-danger-dark dark:text-red-100"
          role="alert"
        >
          <p className="font-semibold">Dashboard data is unavailable</p>
          <p className="mt-1">{pageError}</p>
          <button
            className="mt-4 inline-flex min-h-10 items-center justify-center rounded-lg border border-danger px-4 py-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-danger focus:ring-offset-2"
            onClick={loadDashboard}
            type="button"
          >
            Try again
          </button>
        </div>
      )}

      <section aria-labelledby="partner-summary-title">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2
              className="text-xl font-semibold text-lga-navy dark:text-white"
              id="partner-summary-title"
            >
              Partner overview
            </h2>
            <p className="mt-1 text-sm text-text-muted dark:text-slate-300">
              Activity from the most recent {RECENT_STATUS_DAYS} days.
            </p>
          </div>
          <button
            className="inline-flex min-h-10 items-center justify-center rounded-lg border border-border bg-white px-4 py-2 text-sm font-semibold text-lga-navy transition-colors hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-lga-sky focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-white dark:hover:bg-slate-800"
            disabled={loading}
            onClick={loadDashboard}
            type="button"
          >
            {loading ? 'Refreshing…' : 'Refresh dashboard'}
          </button>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryCard
            description="Applications visible in the current partner scope."
            label="Applications"
            tone="info"
            value={summary.total}
          />
          <SummaryCard
            description="Applications progressing through onboarding."
            label="In progress"
            tone="warning"
            value={summary.inProgress}
          />
          <SummaryCard
            description="Records requiring partner or agency attention."
            label="Action required"
            tone="danger"
            value={summary.actionRequired}
          />
          <SummaryCard
            description="Applications that reached a completed outcome."
            label="Completed"
            tone="success"
            value={summary.completed}
          />
        </div>

        {lastRefreshedAt && (
          <p className="mt-3 text-right text-xs text-text-muted dark:text-slate-400">
            Last refreshed {formatDate(lastRefreshedAt)}
          </p>
        )}
      </section>

      <section aria-labelledby="resumable-drafts-title">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2
              className="text-xl font-semibold text-lga-navy dark:text-white"
              id="resumable-drafts-title"
            >
              Resume onboarding
            </h2>
            <p className="mt-1 text-sm leading-6 text-text-muted dark:text-slate-300">
              Continue locally saved guided journeys for this partner.
            </p>
          </div>
          <StatusBadge
            label={`${drafts.length} saved`}
            showDot={false}
            tone={drafts.length > 0 ? 'warning' : 'neutral'}
          />
        </div>

        {loading ? (
          <div
            className="mt-4 rounded-xl border border-border bg-white px-5 py-10 text-center text-sm text-text-muted shadow-card dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
            role="status"
          >
            Loading saved journeys…
          </div>
        ) : drafts.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-border-strong bg-white px-5 py-10 text-center shadow-card dark:border-slate-600 dark:bg-slate-900">
            <h3 className="font-semibold text-lga-navy dark:text-white">
              No saved journeys
            </h3>
            <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-text-muted dark:text-slate-300">
              Start a guided journey or import a mock submission. Saved
              progress will appear here when additional information is
              required.
            </p>
            <Link
              className="mt-5 inline-flex min-h-11 items-center justify-center rounded-lg bg-lga-navy px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-800 focus:outline-none focus:ring-2 focus:ring-lga-sky focus:ring-offset-2 dark:bg-primary-600 dark:hover:bg-primary-500"
              to={ROUTES.JOURNEY_NEW}
            >
              Start a guided journey
            </Link>
          </div>
        ) : (
          <ul className="mt-4 grid list-none gap-4 p-0 lg:grid-cols-2">
            {drafts.map((draft) => (
              <DraftCard draft={draft} key={draft.trackingId} />
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="partner-applications-title">
        <div className="mb-4">
          <h2
            className="text-xl font-semibold text-lga-navy dark:text-white"
            id="partner-applications-title"
          >
            Recent lifecycle activity
          </h2>
          <p className="mt-1 text-sm leading-6 text-text-muted dark:text-slate-300">
            Review lifecycle and simulated system synchronization outcomes.
          </p>
        </div>

        <DataTable
          aria-label="Partner onboarding lifecycle activity"
          columns={columns}
          data={applications}
          defaultPageSize={10}
          emptyMessage="No onboarding activity was found for this partner."
          loading={loading}
          loadingMessage="Loading partner onboarding activity…"
          pageSizeOptions={[10, 25, 50]}
        />
      </section>
    </div>
  );
}

export default PartnerDashboardPage;