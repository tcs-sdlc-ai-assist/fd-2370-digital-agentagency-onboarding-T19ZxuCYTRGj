import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { PartnerScopeGuard } from '../../auth/partnerScopeGuard.js';
import DataTable from '../../components/shared/DataTable.jsx';
import StatusBadge from '../../components/shared/StatusBadge.jsx';
import { EXTERNAL_ROLES } from '../../constants/roles.js';
import {
  getJourneyRoute,
  getOperationsOnboardingRoute,
  getPartnerOnboardingRoute,
  ROUTES,
} from '../../constants/routes.js';
import { createJourneyDraftRepository } from '../../repositories/journeyDraftRepository.js';
import { createOnboardingRecordRepository } from '../../repositories/onboardingRecordRepository.js';
import { useAuthStore } from '../../stores/authStore.js';
import { formatDisplayDateTime } from '../../utils/dates.js';

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
    status: authState.isAuthenticated ? 'authenticated' : 'anonymous',
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

function getApplicantName(record) {
  const applicant =
    record.applicant ?? record.agent ?? record.organization ?? {};
  const personName = [applicant.firstName, applicant.lastName]
    .filter(Boolean)
    .join(' ')
    .trim();

  return (
    applicant.legalName ??
    applicant.name ??
    (personName || record.agency?.name || 'Applicant')
  );
}

function isResumableStatus(status) {
  const normalized = String(status ?? '').toLowerCase();
  return [
    'draft',
    'in_progress',
    'in-progress',
    'started',
    'application_started',
  ].some((value) => normalized.includes(value));
}

function getRecordHref(record, role) {
  const trackingId = record.trackingId ?? record.applicationId;

  if (!trackingId) {
    return ROUTES.JOURNEY_NEW;
  }

  if (isResumableStatus(record.status ?? record.workflowStage)) {
    return getJourneyRoute(trackingId);
  }

  if (EXTERNAL_ROLES.includes(role)) {
    return getPartnerOnboardingRoute(record.applicationId ?? trackingId);
  }

  return getOperationsOnboardingRoute(record.applicationId ?? trackingId);
}

function getActionLabel(record) {
  return isResumableStatus(record.status ?? record.workflowStage)
    ? 'Resume'
    : 'View';
}

/**
 * Lists available onboarding journeys and locally saved drafts.
 */
export function JourneysPage() {
  const authState = useAuthStore();
  const principal = useMemo(() => createPrincipal(authState), [authState]);
  const partnerCode =
    authState.partnerContext?.partnerCode ??
    authState.partnerContext?.partnerId ??
    null;
  const journeys = useMemo(() => {
    const scopeGuard = new PartnerScopeGuard({
      principal,
      partnerContext: authState.partnerContext,
    });
    const records = scopeGuard.filterRecords(
      createOnboardingRecordRepository().list(),
      principal,
      authState.partnerContext,
    );
    const recordByTrackingId = new Map();

    records.forEach((record) => {
      const key = record.trackingId ?? record.applicationId;
      if (key) {
        recordByTrackingId.set(String(key), record);
      }
    });

    if (partnerCode) {
      try {
        const drafts = createJourneyDraftRepository({
          partnerCode,
        }).list({ resumable: true });

        drafts.forEach((draft) => {
          const key = String(draft.trackingId);
          const existing = recordByTrackingId.get(key);
          recordByTrackingId.set(key, {
            ...existing,
            ...draft,
            trackingId: draft.trackingId,
            applicationId:
              draft.applicationId ?? existing?.applicationId ?? draft.trackingId,
            journeyType: draft.journeyType ?? existing?.journeyType,
            status: draft.status ?? existing?.status ?? 'draft',
            workflowStage:
              draft.currentStepId ?? existing?.workflowStage ?? 'APPLICATION_STARTED',
            progress: {
              percentComplete:
                draft.completionPercent ??
                existing?.progress?.percentComplete ??
                0,
              currentStep:
                draft.currentStepId ?? existing?.progress?.currentStep,
            },
            applicant: existing?.applicant ?? {
              firstName: draft.applicantName,
            },
            updatedAt: draft.lastSavedAt ?? existing?.updatedAt,
            source: 'local_draft',
          });
        });
      } catch {
        // Draft storage is partner-namespaced; missing local drafts is expected.
      }
    }

    return [...recordByTrackingId.values()].sort((left, right) => {
      const leftTime = Date.parse(left.updatedAt ?? left.createdAt ?? '') || 0;
      const rightTime = Date.parse(right.updatedAt ?? right.createdAt ?? '') || 0;
      return rightTime - leftTime;
    });
  }, [authState.partnerContext, partnerCode, principal]);

  const columns = useMemo(
    () => [
      {
        id: 'applicant',
        header: 'Applicant',
        accessor: (row) => getApplicantName(row),
      },
      {
        id: 'journeyType',
        header: 'Journey',
        accessor: (row) => formatToken(row.journeyType),
      },
      {
        id: 'status',
        header: 'Status',
        accessor: (row) => row.status ?? row.workflowStage,
        render: (value) => (
          <StatusBadge
            label={formatToken(value)}
            tone={isResumableStatus(value) ? 'warning' : 'info'}
          />
        ),
      },
      {
        id: 'progress',
        header: 'Progress',
        accessor: (row) => row.progress?.percentComplete ?? 0,
        render: (value) => `${value}%`,
      },
      {
        id: 'trackingId',
        header: 'Tracking ID',
        accessorKey: 'trackingId',
      },
      {
        id: 'updatedAt',
        header: 'Updated',
        accessor: (row) => formatDate(row.updatedAt ?? row.createdAt),
      },
    ],
    [],
  );

  return (
    <div className="space-y-6">
      <section
        aria-labelledby="journeys-title"
        className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"
      >
        <div>
          <h1
            className="text-2xl font-semibold text-lga-navy dark:text-white"
            id="journeys-title"
          >
            Onboarding journeys
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-text-muted dark:text-slate-300">
            Review available journey records and resume locally saved
            progress. Start a new guided journey when no draft exists.
          </p>
        </div>
        <Link
          className="inline-flex min-h-11 items-center justify-center rounded-lg bg-lga-navy px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-800 focus:outline-none focus:ring-2 focus:ring-lga-sky focus:ring-offset-2 dark:bg-primary-600 dark:hover:bg-primary-500"
          to={ROUTES.JOURNEY_NEW}
        >
          Start a guided journey
        </Link>
      </section>

      <DataTable
        aria-label="Onboarding journeys"
        columns={columns}
        data={journeys}
        emptyMessage="No journey records are available in the current scope."
        getRowId={(row) => row.trackingId ?? row.applicationId}
        rowActions={[
          {
            label: (row) => getActionLabel(row),
            onClick: undefined,
            render: ({ row }) => (
              <Link
                className="inline-flex min-h-9 items-center justify-center rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-lga-navy hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-lga-sky focus:ring-offset-2 dark:border-slate-600 dark:text-white dark:hover:bg-slate-800"
                to={getRecordHref(row, principal.role)}
              >
                {getActionLabel(row)}
              </Link>
            ),
          },
        ]}
      />
    </div>
  );
}

export default JourneysPage;
