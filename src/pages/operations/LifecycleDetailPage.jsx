import { useCallback, useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { useParams } from 'react-router-dom';
import { canPerformAction } from '../../auth/permissionPolicy.js';
import { PartnerScopeGuard } from '../../auth/partnerScopeGuard.js';
import DocumentPackagePreview from '../../components/journey/DocumentPackagePreview.jsx';
import MaskedValue, {
  MASKED_VALUE_KINDS,
} from '../../components/shared/MaskedValue.jsx';
import StatusBadge from '../../components/shared/StatusBadge.jsx';
import Timeline from '../../components/shared/Timeline.jsx';
import {
  INTEGRATION_SYSTEMS,
  LIFECYCLE_STATUSES,
} from '../../constants/domain.js';
import { PERMISSIONS } from '../../constants/roles.js';
import { createAuditRepository } from '../../repositories/auditRepository.js';
import { createDocumentPackageRepository } from '../../repositories/documentPackageRepository.js';
import { createOnboardingRecordRepository } from '../../repositories/onboardingRecordRepository.js';
import { createProviderCheckRepository } from '../../repositories/providerCheckRepository.js';
import { createSyncAttemptRepository } from '../../repositories/syncAttemptRepository.js';
import { createWorkItemRepository } from '../../repositories/workItemRepository.js';
import {
  createLifecycleProjectionService,
  LIFECYCLE_STATUS_ORDER,
} from '../../services/operations/lifecycleProjectionService.js';
import { useAuthStore } from '../../stores/authStore.js';
import { formatDisplayDateTime } from '../../utils/dates.js';

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cloneValue(value) {
  if (value === undefined) {
    return undefined;
  }

  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value));
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

function getRouteIdentifier(params) {
  return (
    params.trackingId ??
    params.applicationId ??
    params.journeyId ??
    null
  );
}

function getApplicant(record) {
  return (
    record?.applicant ??
    record?.agent ??
    record?.organization ??
    {}
  );
}

function getApplicantName(record) {
  const applicant = getApplicant(record);
  const personName = [applicant.firstName, applicant.lastName]
    .filter(Boolean)
    .join(' ')
    .trim();

  return (
    applicant.legalName ??
    applicant.name ??
    (personName || 'Not available')
  );
}

function getProviderChecks(record, checks) {
  if (checks.length > 0) {
    return checks;
  }

  const fallbackChecks = [];

  if (isObject(record.background)) {
    fallbackChecks.push({
      checkId:
        record.background.referenceId ??
        `${record.trackingId}:background`,
      providerCode:
        record.background.providerCode ?? 'Background',
      service: 'backgroundCheck',
      status: record.background.status ?? 'not_started',
      outcome: record.background.disposition,
      manualReviewRequired:
        record.background.manualReviewRequired === true,
      validationCodes: record.background.validationCodes ?? [],
      requestedAt:
        record.background.initiatedAt ?? record.createdAt,
      completedAt: record.background.completedAt ?? null,
      description:
        record.background.reason ??
        'Background screening status for this application.',
    });
  }

  if (isObject(record.appointment)) {
    fallbackChecks.push({
      checkId:
        record.appointment.referenceId ??
        `${record.trackingId}:appointment`,
      providerCode:
        record.appointment.providerCode ?? 'Appointment',
      service: 'appointmentVerification',
      status: record.appointment.status ?? 'not_started',
      outcome: record.appointment.outcome,
      manualReviewRequired:
        record.appointment.manualReviewRequired === true,
      validationCodes: record.appointment.validationCodes ?? [],
      requestedAt:
        record.appointment.submittedAt ?? record.createdAt,
      completedAt: record.appointment.completedAt ?? null,
      description:
        record.appointment.reason ??
        'Carrier appointment status for this application.',
    });
  }

  return fallbackChecks;
}

function getLatestSyncAttempts(attempts) {
  const sortedAttempts = [...attempts].sort(
    (left, right) =>
      Date.parse(right.attemptedAt) - Date.parse(left.attemptedAt),
  );
  const latestBySystem = new Map();

  sortedAttempts.forEach((attempt) => {
    if (!latestBySystem.has(attempt.system)) {
      latestBySystem.set(attempt.system, attempt);
    }
  });

  return Object.values(INTEGRATION_SYSTEMS).map((system) => ({
    system,
    attempt: latestBySystem.get(system) ?? null,
  }));
}

function getLifecycleRank(status) {
  return LIFECYCLE_STATUS_ORDER.indexOf(status);
}

function SummaryItem({ children, label, value }) {
  return (
    <div className="rounded-lg bg-surface-muted px-4 py-3 dark:bg-slate-800">
      <dt className="text-xs font-medium uppercase tracking-wide text-text-muted dark:text-slate-400">
        {label}
      </dt>
      <dd className="mt-1 break-words text-sm font-semibold text-text dark:text-white">
        {children ?? value ?? 'Not available'}
      </dd>
    </div>
  );
}

SummaryItem.propTypes = {
  children: PropTypes.node,
  label: PropTypes.string.isRequired,
  value: PropTypes.node,
};

function LifecycleProgress({ currentStatus, milestones }) {
  const currentRank = getLifecycleRank(currentStatus);
  const milestoneStatuses = new Set(
    milestones.map((milestone) => milestone.status),
  );

  return (
    <ol
      aria-label="Canonical lifecycle progress"
      className="mt-5 grid list-none gap-3 p-0 sm:grid-cols-2 xl:grid-cols-4"
    >
      {LIFECYCLE_STATUS_ORDER.map((status, index) => {
        const reached =
          milestoneStatuses.has(status) ||
          (currentRank >= 0 && index <= currentRank);
        const current = status === currentStatus;
        const terminated =
          currentStatus === LIFECYCLE_STATUSES.TERMINATED;
        const tone = current
          ? terminated
            ? 'danger'
            : 'info'
          : reached
            ? 'success'
            : 'neutral';

        return (
          <li
            aria-current={current ? 'step' : undefined}
            className={`rounded-xl border p-4 ${
              current
                ? 'border-lga-sky bg-primary-50 dark:border-primary-400 dark:bg-primary-950'
                : 'border-border bg-white dark:border-slate-700 dark:bg-slate-900'
            }`}
            key={status}
          >
            <div className="flex items-start gap-3">
              <span
                aria-hidden="true"
                className={`flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                  current
                    ? 'bg-lga-navy text-white dark:bg-primary-600'
                    : reached
                      ? 'bg-success text-white'
                      : 'bg-surface-subtle text-text-muted dark:bg-slate-700 dark:text-slate-300'
                }`}
              >
                {reached && !current ? '✓' : index + 1}
              </span>
              <div className="min-w-0">
                <p className="font-semibold text-text dark:text-white">
                  {status}
                </p>
                <div className="mt-2">
                  <StatusBadge
                    label={
                      current
                        ? 'Current'
                        : reached
                          ? 'Reached'
                          : 'Upcoming'
                    }
                    showDot={false}
                    size="sm"
                    tone={tone}
                  />
                </div>
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

LifecycleProgress.propTypes = {
  currentStatus: PropTypes.string.isRequired,
  milestones: PropTypes.arrayOf(PropTypes.object).isRequired,
};

function ProviderOutcomes({ checks }) {
  return (
    <section
      aria-labelledby="provider-outcomes-title"
      className="rounded-xl border border-border bg-white p-5 shadow-card sm:p-6 dark:border-slate-700 dark:bg-slate-900"
    >
      <div>
        <h2
          className="text-xl font-semibold text-lga-navy dark:text-white"
          id="provider-outcomes-title"
        >
          Provider outcomes
        </h2>
        <p className="mt-1 text-sm leading-6 text-text-muted dark:text-slate-300">
          Simulated licensing, background, appointment, and eligibility
          provider results.
        </p>
      </div>

      {checks.length === 0 ? (
        <div className="mt-5 rounded-lg border border-dashed border-border-strong px-4 py-8 text-center text-sm text-text-muted dark:border-slate-600 dark:text-slate-300">
          No provider outcomes have been recorded.
        </div>
      ) : (
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          {checks.map((check, index) => {
            const validationCodes = Array.isArray(
              check.validationCodes,
            )
              ? check.validationCodes
              : [];

            return (
              <article
                className="rounded-xl border border-border p-4 dark:border-slate-700"
                key={
                  check.checkId ??
                  `${check.providerCode ?? 'provider'}-${index}`
                }
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wide text-lga-blue dark:text-primary-300">
                      {check.providerCode ?? 'Provider'}
                    </p>
                    <h3 className="mt-1 font-semibold text-text dark:text-white">
                      {formatToken(check.service)}
                    </h3>
                  </div>
                  <StatusBadge
                    showDot={false}
                    status={
                      check.outcome ??
                      check.status ??
                      'not_started'
                    }
                  />
                </div>

                <p className="mt-3 text-sm leading-6 text-text-muted dark:text-slate-300">
                  {check.description ??
                    check.message ??
                    'The simulated provider result is available.'}
                </p>

                <dl className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div>
                    <dt className="text-xs text-text-muted dark:text-slate-400">
                      Requested
                    </dt>
                    <dd className="mt-1 text-sm font-medium text-text dark:text-slate-200">
                      {formatDate(check.requestedAt)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-text-muted dark:text-slate-400">
                      Completed
                    </dt>
                    <dd className="mt-1 text-sm font-medium text-text dark:text-slate-200">
                      {formatDate(check.completedAt)}
                    </dd>
                  </div>
                </dl>

                {check.manualReviewRequired === true && (
                  <div className="mt-4">
                    <StatusBadge
                      label="Manual review required"
                      showDot={false}
                      tone="warning"
                    />
                  </div>
                )}

                {validationCodes.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {validationCodes.map((code) => (
                      <StatusBadge
                        key={code}
                        label={formatToken(code)}
                        severity="warning"
                        showDot={false}
                        size="sm"
                      />
                    ))}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

ProviderOutcomes.propTypes = {
  checks: PropTypes.arrayOf(PropTypes.object).isRequired,
};

function WorkItemSummary({ workItems }) {
  return (
    <section
      aria-labelledby="related-work-items-title"
      className="rounded-xl border border-border bg-white p-5 shadow-card sm:p-6 dark:border-slate-700 dark:bg-slate-900"
    >
      <div>
        <h2
          className="text-xl font-semibold text-lga-navy dark:text-white"
          id="related-work-items-title"
        >
          Related work items
        </h2>
        <p className="mt-1 text-sm leading-6 text-text-muted dark:text-slate-300">
          Operational cards created for review, provider follow-up, and
          exception processing.
        </p>
      </div>

      {workItems.length === 0 ? (
        <div className="mt-5 rounded-lg border border-dashed border-border-strong px-4 py-8 text-center text-sm text-text-muted dark:border-slate-600 dark:text-slate-300">
          No related operational work items were found.
        </div>
      ) : (
        <ul className="mt-5 grid list-none gap-4 p-0 lg:grid-cols-2">
          {workItems.map((workItem) => (
            <li
              className="rounded-xl border border-border p-4 dark:border-slate-700"
              key={workItem.workItemId}
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-wide text-lga-blue dark:text-primary-300">
                    {formatToken(workItem.cardType)}
                  </p>
                  <h3 className="mt-1 font-semibold text-text dark:text-white">
                    {workItem.title}
                  </h3>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <StatusBadge
                    showDot={false}
                    status={workItem.state}
                  />
                  <StatusBadge
                    label={formatToken(workItem.priority)}
                    severity={workItem.priority}
                    showDot={false}
                    size="sm"
                  />
                </div>
              </div>

              <p className="mt-3 text-sm leading-6 text-text-muted dark:text-slate-300">
                {workItem.summary}
              </p>

              <dl className="mt-4 grid gap-3 sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-text-muted dark:text-slate-400">
                    Assigned group
                  </dt>
                  <dd className="mt-1 text-sm font-medium text-text dark:text-slate-200">
                    {workItem.assignedGroup ?? 'Unassigned'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-text-muted dark:text-slate-400">
                    Last updated
                  </dt>
                  <dd className="mt-1 text-sm font-medium text-text dark:text-slate-200">
                    {formatDate(workItem.updatedAt)}
                  </dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

WorkItemSummary.propTypes = {
  workItems: PropTypes.arrayOf(PropTypes.object).isRequired,
};

function SyncStatusSummary({ attempts }) {
  const latestAttempts = getLatestSyncAttempts(attempts);

  return (
    <section
      aria-labelledby="sync-status-title"
      className="rounded-xl border border-border bg-white p-5 shadow-card sm:p-6 dark:border-slate-700 dark:bg-slate-900"
    >
      <div>
        <h2
          className="text-xl font-semibold text-lga-navy dark:text-white"
          id="sync-status-title"
        >
          Systems-of-record synchronization
        </h2>
        <p className="mt-1 text-sm leading-6 text-text-muted dark:text-slate-300">
          Latest simulated Agent DB, LifePro, ALI, and Horizon outcomes.
        </p>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {latestAttempts.map(({ attempt, system }) => (
          <article
            className="rounded-xl border border-border p-4 dark:border-slate-700"
            key={system}
          >
            <div className="flex items-start justify-between gap-3">
              <h3 className="font-semibold text-text dark:text-white">
                {formatToken(system)}
              </h3>
              <StatusBadge
                showDot={false}
                size="sm"
                status={attempt?.status ?? 'unknown'}
              />
            </div>
            <p className="mt-3 text-sm leading-5 text-text-muted dark:text-slate-300">
              {attempt?.message ?? 'No synchronization attempt recorded.'}
            </p>
            <dl className="mt-4 space-y-2 text-xs">
              <div>
                <dt className="text-text-muted dark:text-slate-400">
                  Operation
                </dt>
                <dd className="mt-1 font-medium text-text dark:text-slate-200">
                  {formatToken(attempt?.operation)}
                </dd>
              </div>
              <div>
                <dt className="text-text-muted dark:text-slate-400">
                  Attempted
                </dt>
                <dd className="mt-1 font-medium text-text dark:text-slate-200">
                  {formatDate(attempt?.attemptedAt)}
                </dd>
              </div>
            </dl>
          </article>
        ))}
      </div>
    </section>
  );
}

SyncStatusSummary.propTypes = {
  attempts: PropTypes.arrayOf(PropTypes.object).isRequired,
};

function DocumentSummary({ documentPackage, record }) {
  if (documentPackage) {
    return (
      <DocumentPackagePreview
        documentPackage={documentPackage}
        title="Document package"
      />
    );
  }

  const documents = isObject(record.documents)
    ? record.documents
    : {};

  return (
    <section
      aria-labelledby="document-summary-title"
      className="rounded-xl border border-border bg-white p-5 shadow-card sm:p-6 dark:border-slate-700 dark:bg-slate-900"
    >
      <h2
        className="text-xl font-semibold text-lga-navy dark:text-white"
        id="document-summary-title"
      >
        Documents
      </h2>
      <p className="mt-1 text-sm leading-6 text-text-muted dark:text-slate-300">
        Document counts published with the canonical onboarding record.
      </p>

      <dl className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryItem
          label="Status"
          value={formatToken(documents.status)}
        />
        <SummaryItem label="Required" value={documents.required ?? 0} />
        <SummaryItem label="Received" value={documents.received ?? 0} />
        <SummaryItem label="Accepted" value={documents.accepted ?? 0} />
      </dl>

      <div className="mt-5 rounded-lg border border-dashed border-border-strong px-4 py-6 text-center text-sm text-text-muted dark:border-slate-600 dark:text-slate-300">
        A generated document package is not available for this record.
      </div>
    </section>
  );
}

DocumentSummary.propTypes = {
  documentPackage: PropTypes.object,
  record: PropTypes.object.isRequired,
};

/**
 * Displays canonical onboarding details and correlated lifecycle,
 * provider, work-item, synchronization, document, and event history.
 */
export function LifecycleDetailPage({
  application: suppliedApplication,
  data,
  documentPackage: suppliedDocumentPackage,
  enforceAuthorization = true,
  error: suppliedError = null,
  lifecycle: suppliedLifecycle,
  loading: suppliedLoading = false,
  providerChecks: suppliedProviderChecks,
  record: suppliedRecord,
  syncAttempts: suppliedSyncAttempts,
  workItems: suppliedWorkItems,
}) {
  const params = useParams();
  const authState = useAuthStore();
  const principal = useMemo(
    () => createPrincipal(authState),
    [authState],
  );
  const applicationRepository = useMemo(
    () => createOnboardingRecordRepository(),
    [],
  );
  const auditRepository = useMemo(
    () => createAuditRepository(),
    [],
  );
  const workItemRepository = useMemo(
    () => createWorkItemRepository(),
    [],
  );
  const providerCheckRepository = useMemo(
    () => createProviderCheckRepository(),
    [],
  );
  const syncAttemptRepository = useMemo(
    () => createSyncAttemptRepository(),
    [],
  );
  const documentPackageRepository = useMemo(
    () => createDocumentPackageRepository(),
    [],
  );
  const scopeGuard = useMemo(
    () =>
      new PartnerScopeGuard({
        principal,
        partnerContext: authState.partnerContext,
      }),
    [authState.partnerContext, principal],
  );
  const lifecycleService = useMemo(
    () =>
      createLifecycleProjectionService({
        onboardingRepository: applicationRepository,
        auditRepository,
        workItemRepository,
        providerCheckRepository,
        syncAttemptRepository,
      }),
    [
      applicationRepository,
      auditRepository,
      providerCheckRepository,
      syncAttemptRepository,
      workItemRepository,
    ],
  );
  const resolvedRecord =
    suppliedRecord ?? suppliedApplication ?? data ?? null;
  const routeIdentifier = getRouteIdentifier(params);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState('');

  const loadDetail = useCallback(() => {
    setLoading(true);
    setPageError('');

    try {
      const record =
        resolvedRecord ??
        (routeIdentifier
          ? applicationRepository.find(routeIdentifier)
          : null);

      if (!record) {
        throw new Error(
          'The requested onboarding lifecycle record was not found.',
        );
      }

      if (
        enforceAuthorization &&
        (!authState.isAuthenticated ||
          !canPerformAction(
            principal,
            PERMISSIONS.VIEW_ONBOARDING,
            record,
          ) ||
          !scopeGuard.canAccessRecord(
            record,
            principal,
            authState.partnerContext,
          ))
      ) {
        throw new Error(
          'The requested lifecycle record is outside your authorized scope.',
        );
      }

      const trackingId = record.trackingId;
      const lifecycle =
        suppliedLifecycle ??
        lifecycleService.getLifecycle(trackingId, {
          record,
          includeSources: true,
        });
      const workItems =
        suppliedWorkItems ??
        workItemRepository.findByTrackingId(trackingId);
      const providerChecks =
        suppliedProviderChecks ??
        providerCheckRepository.findByTrackingId(trackingId);
      const syncAttempts =
        suppliedSyncAttempts ??
        syncAttemptRepository.findByTrackingId(trackingId);
      const documentPackage =
        suppliedDocumentPackage ??
        documentPackageRepository.find(trackingId);

      setDetail({
        record: cloneValue(record),
        lifecycle: cloneValue(lifecycle),
        workItems: cloneValue(workItems),
        providerChecks: cloneValue(providerChecks),
        syncAttempts: cloneValue(syncAttempts),
        documentPackage: cloneValue(documentPackage ?? null),
      });
    } catch (error) {
      setDetail(null);
      setPageError(
        error instanceof Error && error.message
          ? error.message
          : 'The lifecycle details could not be loaded.',
      );
    } finally {
      setLoading(false);
    }
  }, [
    applicationRepository,
    authState.isAuthenticated,
    authState.partnerContext,
    documentPackageRepository,
    enforceAuthorization,
    lifecycleService,
    principal,
    providerCheckRepository,
    routeIdentifier,
    scopeGuard,
    suppliedDocumentPackage,
    suppliedLifecycle,
    suppliedProviderChecks,
    resolvedRecord,
    suppliedSyncAttempts,
    suppliedWorkItems,
    syncAttemptRepository,
    workItemRepository,
  ]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  if (suppliedLoading || loading) {
    return (
      <section
        aria-busy="true"
        className="mx-auto max-w-5xl rounded-xl border border-border bg-white px-5 py-12 text-center shadow-card dark:border-slate-700 dark:bg-slate-900"
      >
        <p
          className="text-sm text-text-muted dark:text-slate-300"
          role="status"
        >
          Loading lifecycle details…
        </p>
      </section>
    );
  }

  const externalError =
    suppliedError instanceof Error
      ? suppliedError.message
      : suppliedError;
  const displayedError = externalError || pageError;

  if (!detail || displayedError) {
    return (
      <section
        aria-labelledby="lifecycle-detail-error-title"
        className="mx-auto max-w-3xl rounded-xl border border-danger bg-danger-light p-6 text-danger-dark shadow-card dark:border-red-700 dark:bg-danger-dark dark:text-red-100"
        role="alert"
      >
        <h1
          className="text-xl font-semibold"
          id="lifecycle-detail-error-title"
        >
          Lifecycle details are unavailable
        </h1>
        <p className="mt-2 text-sm leading-6">
          {displayedError ||
            'The requested onboarding lifecycle record could not be found.'}
        </p>
        <button
          className="mt-5 inline-flex min-h-11 items-center justify-center rounded-lg border border-danger px-5 py-2 text-sm font-semibold transition-colors hover:bg-white/50 focus:outline-none focus:ring-2 focus:ring-danger focus:ring-offset-2 dark:hover:bg-red-950"
          onClick={loadDetail}
          type="button"
        >
          Try again
        </button>
      </section>
    );
  }

  const {
    documentPackage,
    lifecycle,
    providerChecks,
    record,
    syncAttempts,
    workItems,
  } = detail;
  const applicant = getApplicant(record);
  const currentStatus =
    lifecycle.currentStatus ??
    record.workflowStage ??
    record.status ??
    LIFECYCLE_STATUSES.NEW;
  const milestones = Array.isArray(lifecycle.milestones)
    ? lifecycle.milestones
    : [];
  const resolvedProviderChecks = getProviderChecks(
    record,
    providerChecks,
  );

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6">
      <header className="overflow-hidden rounded-2xl bg-lga-navy text-white shadow-elevated">
        <div className="grid gap-6 px-6 py-7 sm:px-8 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <div className="flex flex-wrap gap-2">
              <StatusBadge
                label="Lifecycle detail"
                showDot={false}
                tone="accent"
              />
              <StatusBadge
                showDot={false}
                status={record.status}
              />
              <StatusBadge
                label="Simulation"
                showDot={false}
                simulation
              />
            </div>
            <h1 className="mt-4 text-2xl font-semibold sm:text-3xl">
              {getApplicantName(record)}
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-primary-100">
              Canonical onboarding details, processing outcomes, operational
              work, system synchronization, documents, and lifecycle history.
            </p>
            <p className="mt-3 break-all font-mono text-xs text-primary-100">
              {record.trackingId}
            </p>
          </div>

          <div className="rounded-xl bg-white/10 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-primary-100">
              Current lifecycle
            </p>
            <p className="mt-2 text-xl font-semibold">
              {currentStatus}
            </p>
            <p className="mt-1 text-xs text-primary-100">
              Updated {formatDate(lifecycle.updatedAt ?? record.updatedAt)}
            </p>
          </div>
        </div>
      </header>

      <aside
        className="rounded-xl border border-accent-300 bg-accent-100 p-4 text-sm leading-6 text-accent-950 dark:border-accent-700 dark:bg-accent-950 dark:text-accent-100"
        role="note"
      >
        This page contains synthetic onboarding and provider information.
        Identifiers and contact values are masked where appropriate.
      </aside>

      <section
        aria-labelledby="canonical-record-title"
        className="rounded-xl border border-border bg-white p-5 shadow-card sm:p-6 dark:border-slate-700 dark:bg-slate-900"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2
              className="text-xl font-semibold text-lga-navy dark:text-white"
              id="canonical-record-title"
            >
              Canonical record details
            </h2>
            <p className="mt-1 text-sm leading-6 text-text-muted dark:text-slate-300">
              Identity, source, carrier, assignment, and application
              references.
            </p>
          </div>
          <StatusBadge
            showDot={false}
            status={record.workflowStage}
          />
        </div>

        <dl className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryItem label="Application ID">
            <MaskedValue
              kind={MASKED_VALUE_KINDS.RECORD_ID}
              value={record.applicationId}
            />
          </SummaryItem>
          <SummaryItem label="Tracking ID">
            <MaskedValue
              kind={MASKED_VALUE_KINDS.RECORD_ID}
              value={record.trackingId}
            />
          </SummaryItem>
          <SummaryItem label="Applicant" value={getApplicantName(record)} />
          <SummaryItem
            label="Applicant type"
            value={formatToken(applicant.type)}
          />
          <SummaryItem label="NPN">
            {applicant.npn ? (
              <MaskedValue
                kind={MASKED_VALUE_KINDS.IDENTIFIER}
                label="National producer number"
                value={applicant.npn}
              />
            ) : (
              'Not available'
            )}
          </SummaryItem>
          <SummaryItem label="Email">
            {applicant.email ? (
              <MaskedValue
                kind={MASKED_VALUE_KINDS.EMAIL}
                value={applicant.email}
              />
            ) : (
              'Not available'
            )}
          </SummaryItem>
          <SummaryItem label="Phone">
            {applicant.phone ? (
              <MaskedValue
                kind={MASKED_VALUE_KINDS.PHONE}
                value={applicant.phone}
              />
            ) : (
              'Not available'
            )}
          </SummaryItem>
          <SummaryItem
            label="Residence state"
            value={
              applicant.residenceState ??
              record.licensing?.residentState
            }
          />
          <SummaryItem label="Company" value={record.company} />
          <SummaryItem
            label="Contract type"
            value={formatToken(record.contract?.type)}
          />
          <SummaryItem
            label="Contract level"
            value={formatToken(record.contract?.level)}
          />
          <SummaryItem
            label="Commission schedule"
            value={formatToken(record.contract?.commissionSchedule)}
          />
          <SummaryItem
            label="Source channel"
            value={formatToken(record.sourceChannel)}
          />
          <SummaryItem
            label="Source format"
            value={formatToken(record.sourceFormat)}
          />
          <SummaryItem label="Partner" value={record.partnerCode} />
          <SummaryItem
            label="Priority"
            value={formatToken(record.priority)}
          />
        </dl>
      </section>

      <section
        aria-labelledby="lifecycle-progress-title"
        className="rounded-xl border border-border bg-surface-muted p-5 shadow-card sm:p-6 dark:border-slate-700 dark:bg-slate-950"
      >
        <div>
          <h2
            className="text-xl font-semibold text-lga-navy dark:text-white"
            id="lifecycle-progress-title"
          >
            Current lifecycle
          </h2>
          <p className="mt-1 text-sm leading-6 text-text-muted dark:text-slate-300">
            Canonical progression derived from onboarding, audit, provider,
            work-item, and synchronization evidence.
          </p>
        </div>

        <LifecycleProgress
          currentStatus={currentStatus}
          milestones={milestones}
        />
      </section>

      <section
        aria-labelledby="hierarchy-details-title"
        className="rounded-xl border border-border bg-white p-5 shadow-card sm:p-6 dark:border-slate-700 dark:bg-slate-900"
      >
        <h2
          className="text-xl font-semibold text-lga-navy dark:text-white"
          id="hierarchy-details-title"
        >
          Contracting hierarchy
        </h2>
        <p className="mt-1 text-sm leading-6 text-text-muted dark:text-slate-300">
          Agency, general agency, upline, and operational assignment context.
        </p>

        <dl className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <SummaryItem label="Agency" value={record.agency?.name} />
          <SummaryItem
            label="Agency type"
            value={formatToken(record.agency?.type)}
          />
          <SummaryItem
            label="Agency code"
            value={
              record.hierarchy?.agencyCode ??
              record.agency?.code
            }
          />
          <SummaryItem label="General agency code" value={record.gaCode} />
          <SummaryItem
            label="Upline agent code"
            value={record.hierarchy?.uplineAgentCode}
          />
          <SummaryItem
            label="Hierarchy status"
            value={formatToken(
              record.hierarchy?.status ?? 'Pending validation',
            )}
          />
          <SummaryItem
            label="Assigned team"
            value={
              record.assignment?.team ??
              record.assignment?.assignedGroup
            }
          />
          <SummaryItem label="Assigned user">
            {record.assignment?.assigneeUserId ? (
              <MaskedValue
                kind={MASKED_VALUE_KINDS.IDENTIFIER}
                label="Assigned user"
                value={record.assignment.assigneeUserId}
              />
            ) : (
              'Unassigned'
            )}
          </SummaryItem>
          <SummaryItem
            label="Last updated"
            value={formatDate(record.updatedAt)}
          />
        </dl>
      </section>

      <ProviderOutcomes checks={resolvedProviderChecks} />

      <WorkItemSummary workItems={workItems} />

      <SyncStatusSummary attempts={syncAttempts} />

      <DocumentSummary
        documentPackage={documentPackage}
        record={record}
      />

      <Timeline
        aria-label="Canonical lifecycle event timeline"
        emptyMessage="No lifecycle milestones have been recorded."
        getActor={(event) => event.actorId ?? event.actorType}
        getDescription={(event) => event.summary}
        getItemId={(event, index) =>
          `${event.status ?? 'milestone'}-${
            event.timestamp ?? index
          }`
        }
        getSource={(event) => event.source}
        getStatus={(event) => event.status}
        getTimestamp={(event) => event.timestamp}
        getTitle={(event) => event.status ?? 'Lifecycle event'}
        items={milestones}
        order="asc"
        title="Lifecycle event timeline"
      />
    </div>
  );
}

LifecycleDetailPage.propTypes = {
  application: PropTypes.object,
  data: PropTypes.object,
  documentPackage: PropTypes.object,
  enforceAuthorization: PropTypes.bool,
  error: PropTypes.oneOfType([
    PropTypes.string,
    PropTypes.instanceOf(Error),
  ]),
  lifecycle: PropTypes.object,
  loading: PropTypes.bool,
  providerChecks: PropTypes.arrayOf(PropTypes.object),
  record: PropTypes.object,
  syncAttempts: PropTypes.arrayOf(PropTypes.object),
  workItems: PropTypes.arrayOf(PropTypes.object),
};

export default LifecycleDetailPage;