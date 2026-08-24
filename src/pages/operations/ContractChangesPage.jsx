import { useCallback, useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import { canPerformAction } from '../../auth/permissionPolicy.js';
import { PartnerScopeGuard } from '../../auth/partnerScopeGuard.js';
import DataTable from '../../components/shared/DataTable.jsx';
import JsonViewer from '../../components/shared/JsonViewer.jsx';
import MaskedValue, {
  MASKED_VALUE_KINDS,
} from '../../components/shared/MaskedValue.jsx';
import StatusBadge from '../../components/shared/StatusBadge.jsx';
import { PERMISSIONS } from '../../constants/roles.js';
import { getOperationsWorkItemRoute } from '../../constants/routes.js';
import {
  CONTRACT_CHANGE_STATUSES,
  CONTRACT_CHANGE_TYPES,
} from '../../repositories/contractChangeRepository.js';
import { createOnboardingRecordRepository } from '../../repositories/onboardingRecordRepository.js';
import { createContractChangeService } from '../../services/operations/contractChangeService.js';
import { useAuthStore } from '../../stores/authStore.js';
import { formatDisplayDateTime } from '../../utils/dates.js';

const CHANGE_TYPE_OPTIONS = Object.freeze([
  {
    label: 'Commission schedule',
    value: CONTRACT_CHANGE_TYPES.COMMISSION_SCHEDULE,
    description:
      'Request a different commission schedule for the selected contract.',
  },
  {
    label: 'Assignee',
    value: CONTRACT_CHANGE_TYPES.ASSIGNEE,
    description:
      'Assign the onboarding application to another synthetic user or queue.',
  },
  {
    label: 'Hierarchy',
    value: CONTRACT_CHANGE_TYPES.HIERARCHY,
    description:
      'Request a general agency or distribution hierarchy change.',
  },
  {
    label: 'Contract level',
    value: CONTRACT_CHANGE_TYPES.LEVEL,
    description:
      'Request a different producer, agency, or general agency level.',
  },
]);

const STATUS_OPTIONS = Object.freeze([
  { label: 'All statuses', value: '' },
  ...Object.values(CONTRACT_CHANGE_STATUSES).map((status) => ({
    label: formatToken(status),
    value: status,
  })),
]);

const FILTER_TYPE_OPTIONS = Object.freeze([
  { label: 'All change types', value: '' },
  ...CHANGE_TYPE_OPTIONS.map(({ label, value }) => ({
    label,
    value,
  })),
]);

const changeRequestSchema = z
  .object({
    applicationIdentifier: z
      .string()
      .trim()
      .min(1, 'Select an onboarding application.'),
    changeType: z.enum(Object.values(CONTRACT_CHANGE_TYPES), {
      required_error: 'Select a change type.',
    }),
    currentValue: z.string().trim().optional().or(z.literal('')),
    requestedValue: z
      .string()
      .trim()
      .min(1, 'Enter the requested value.'),
    assignedGroup: z.string().trim().optional().or(z.literal('')),
    reason: z
      .string()
      .trim()
      .min(5, 'Enter a reason containing at least 5 characters.')
      .max(500, 'The reason cannot exceed 500 characters.'),
    affectedCount: z.preprocess(
      (value) =>
        value === '' || value === null || value === undefined
          ? 1
          : Number(value),
      z
        .number({
          invalid_type_error: 'Affected count must be a number.',
        })
        .int('Affected count must be a whole number.')
        .min(1, 'Affected count must be at least 1.')
        .max(1000, 'Affected count cannot exceed 1,000.'),
    ),
  })
  .superRefine((values, context) => {
    if (
      values.currentValue !== '' &&
      values.currentValue
        .normalize('NFKC')
        .toLowerCase() ===
        values.requestedValue
          .normalize('NFKC')
          .toLowerCase()
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'The requested value must differ from the current value.',
        path: ['requestedValue'],
      });
    }

    if (
      values.changeType === CONTRACT_CHANGE_TYPES.ASSIGNEE &&
      !values.assignedGroup
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Enter the queue or group for the new assignment.',
        path: ['assignedGroup'],
      });
    }
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

function getApplicantName(application) {
  const applicant =
    application.applicant ??
    application.agent ??
    application.organization ??
    {};
  const name = [applicant.firstName, applicant.lastName]
    .filter(Boolean)
    .join(' ')
    .trim();

  return applicant.legalName ?? applicant.name ?? name || 'Applicant';
}

function getCurrentChangeValue(application, changeType) {
  if (!application) {
    return '';
  }

  switch (changeType) {
    case CONTRACT_CHANGE_TYPES.COMMISSION_SCHEDULE:
      return application.contract?.commissionSchedule ?? '';

    case CONTRACT_CHANGE_TYPES.LEVEL:
      return String(application.contract?.level ?? '');

    case CONTRACT_CHANGE_TYPES.HIERARCHY:
      return (
        application.hierarchy?.gaCode ??
        application.gaCode ??
        application.hierarchy?.agencyCode ??
        ''
      );

    case CONTRACT_CHANGE_TYPES.ASSIGNEE:
      return (
        application.assignment?.assigneeUserId ??
        application.assignment?.team ??
        ''
      );

    default:
      return '';
  }
}

function getRequestedValueLabel(changeType) {
  switch (changeType) {
    case CONTRACT_CHANGE_TYPES.COMMISSION_SCHEDULE:
      return 'Requested commission schedule';

    case CONTRACT_CHANGE_TYPES.LEVEL:
      return 'Requested contract level';

    case CONTRACT_CHANGE_TYPES.HIERARCHY:
      return 'Requested general agency code';

    case CONTRACT_CHANGE_TYPES.ASSIGNEE:
      return 'Requested assignee';

    default:
      return 'Requested value';
  }
}

function getRequestedValuePlaceholder(changeType) {
  switch (changeType) {
    case CONTRACT_CHANGE_TYPES.COMMISSION_SCHEDULE:
      return 'STANDARD, SENIOR, AGENCY, or ABNCA';

    case CONTRACT_CHANGE_TYPES.LEVEL:
      return 'PRODUCER, AGENCY, or GENERAL_AGENCY';

    case CONTRACT_CHANGE_TYPES.HIERARCHY:
      return 'NATIONAL_DEMO';

    case CONTRACT_CHANGE_TYPES.ASSIGNEE:
      return 'usr_operations_demo';

    default:
      return 'Enter the requested value';
  }
}

function getStatusTone(status) {
  switch (status) {
    case CONTRACT_CHANGE_STATUSES.COMPLETED:
    case CONTRACT_CHANGE_STATUSES.APPROVED:
      return 'success';

    case CONTRACT_CHANGE_STATUSES.REJECTED:
      return 'danger';

    case CONTRACT_CHANGE_STATUSES.MANUAL_ROUTED:
    case CONTRACT_CHANGE_STATUSES.UNDER_REVIEW:
      return 'warning';

    case CONTRACT_CHANGE_STATUSES.SUBMITTED:
    default:
      return 'info';
  }
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

function FieldError({ error, id }) {
  if (!error?.message) {
    return null;
  }

  return (
    <p
      className="mt-1 text-sm text-danger dark:text-red-200"
      id={id}
      role="alert"
    >
      {error.message}
    </p>
  );
}

FieldError.propTypes = {
  error: PropTypes.shape({
    message: PropTypes.string,
  }),
  id: PropTypes.string.isRequired,
};

function OutcomeDetails({ changeResult, onClose }) {
  const changeRequest = changeResult.changeRequest ?? changeResult;
  const validationCodes = [
    ...new Set([
      ...(changeRequest.outcome?.validationCodes ?? []),
      ...(changeResult.validation?.validationCodes ?? []),
      ...(changeResult.eligibility?.validationCodes ?? []),
    ]),
  ];

  return (
    <section
      aria-labelledby="contract-change-outcome-title"
      className="rounded-xl border border-border bg-white p-5 shadow-card sm:p-6 dark:border-slate-700 dark:bg-slate-900"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-lga-blue dark:text-primary-300">
            Latest change journey outcome
          </p>
          <h2
            className="mt-1 text-xl font-semibold text-lga-navy dark:text-white"
            id="contract-change-outcome-title"
          >
            {formatToken(changeRequest.changeType)}
          </h2>
          <p className="mt-2 break-all font-mono text-xs text-text-muted dark:text-slate-400">
            {changeRequest.changeRequestId}
          </p>
        </div>

        <button
          className="inline-flex min-h-10 items-center justify-center rounded-lg border border-border bg-white px-4 py-2 text-sm font-semibold text-lga-navy transition-colors hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-lga-sky focus:ring-offset-2 dark:border-slate-600 dark:bg-slate-900 dark:text-white dark:hover:bg-slate-800"
          onClick={onClose}
          type="button"
        >
          Close outcome
        </button>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <StatusBadge
          showDot={false}
          status={changeRequest.status}
          tone={getStatusTone(changeRequest.status)}
        />
        <StatusBadge
          label={
            changeRequest.manualReviewRequired
              ? 'Manual review required'
              : 'Automatically evaluated'
          }
          showDot={false}
          tone={
            changeRequest.manualReviewRequired
              ? 'warning'
              : 'success'
          }
        />
        {changeResult.autoAccepted && (
          <StatusBadge
            label="Auto accepted"
            showDot={false}
            tone="success"
          />
        )}
      </div>

      <dl className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          {
            label: 'Tracking ID',
            value: changeRequest.trackingId ?? 'Not linked',
          },
          {
            label: 'Partner',
            value: changeRequest.partnerCode,
          },
          {
            label: 'Requested by',
            value: changeRequest.requestedBy,
          },
          {
            label: 'Updated',
            value: formatDate(changeRequest.updatedAt),
          },
        ].map((item) => (
          <div
            className="rounded-lg bg-surface-muted px-4 py-3 dark:bg-slate-800"
            key={item.label}
          >
            <dt className="text-xs font-medium uppercase tracking-wide text-text-muted dark:text-slate-400">
              {item.label}
            </dt>
            <dd className="mt-1 break-words text-sm font-semibold text-text dark:text-white">
              {item.value}
            </dd>
          </div>
        ))}
      </dl>

      {changeResult.workItem && (
        <div className="mt-5 rounded-xl border border-warning bg-warning-light p-4 text-warning-dark dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="font-semibold">
                Routed to the operations workbench
              </p>
              <p className="mt-1 text-sm leading-6">
                {changeResult.workItem.title}
              </p>
              <p className="mt-2 font-mono text-xs">
                {changeResult.workItem.workItemId}
              </p>
            </div>
            <Link
              className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-lg bg-lga-navy px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-800 focus:outline-none focus:ring-2 focus:ring-lga-sky focus:ring-offset-2"
              to={getOperationsWorkItemRoute(
                changeResult.workItem.workItemId,
              )}
            >
              Open work item
            </Link>
          </div>
        </div>
      )}

      {validationCodes.length > 0 && (
        <div className="mt-5">
          <h3 className="text-sm font-semibold text-text dark:text-white">
            Validation indicators
          </h3>
          <div className="mt-2 flex flex-wrap gap-2">
            {validationCodes.map((code) => (
              <StatusBadge
                key={code}
                label={formatToken(code)}
                severity={
                  changeRequest.status ===
                  CONTRACT_CHANGE_STATUSES.REJECTED
                    ? 'danger'
                    : 'warning'
                }
                showDot={false}
                size="sm"
              />
            ))}
          </div>
        </div>
      )}

      <div className="mt-6">
        <JsonViewer
          data={changeResult}
          fileName={`contract-change-${changeRequest.changeRequestId}.json`}
          redact
          title="Redacted change outcome"
        />
      </div>
    </section>
  );
}

OutcomeDetails.propTypes = {
  changeResult: PropTypes.object.isRequired,
  onClose: PropTypes.func.isRequired,
};

/**
 * Provides a validated contract-change journey, outcome search, and manual
 * operations-routing references.
 */
export function ContractChangesPage({
  contractChangeService: suppliedService,
}) {
  const authState = useAuthStore();
  const principal = useMemo(
    () => createPrincipal(authState),
    [authState],
  );
  const authorized =
    authState.isAuthenticated &&
    canPerformAction(
      principal,
      PERMISSIONS.MANAGE_CONTRACT_CHANGES,
    );
  const applicationRepository = useMemo(
    () => createOnboardingRecordRepository(),
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
  const service = useMemo(
    () =>
      suppliedService ??
      createContractChangeService({
        principal,
        partnerContext: authState.partnerContext,
        strictAudit: false,
        strictPublication: false,
      }),
    [
      authState.partnerContext,
      principal,
      suppliedService,
    ],
  );
  const applications = useMemo(() => {
    if (!authorized) {
      return [];
    }

    const records = applicationRepository.list({
      includeCompleted: true,
    });

    return scopeGuard.filterRecords(
      records,
      principal,
      authState.partnerContext,
    );
  }, [
    applicationRepository,
    authState.partnerContext,
    authorized,
    principal,
    scopeGuard,
  ]);
  const {
    formState: { errors, isSubmitting },
    getValues,
    handleSubmit,
    register,
    reset,
    setValue,
    watch,
  } = useForm({
    defaultValues: {
      applicationIdentifier: '',
      changeType: CONTRACT_CHANGE_TYPES.COMMISSION_SCHEDULE,
      currentValue: '',
      requestedValue: '',
      assignedGroup: '',
      reason: '',
      affectedCount: 1,
    },
    resolver: zodResolver(changeRequestSchema),
    mode: 'onBlur',
  });
  const selectedChangeType = watch('changeType');
  const [filters, setFilters] = useState({
    search: '',
    status: '',
    changeType: '',
    manualReviewRequired: '',
  });
  const [appliedFilters, setAppliedFilters] = useState({
    search: '',
    status: '',
    changeType: '',
    manualReviewRequired: '',
  });
  const [changeRequests, setChangeRequests] = useState([]);
  const [counts, setCounts] = useState({});
  const [selectedChange, setSelectedChange] = useState(null);
  const [latestResult, setLatestResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const [lastRefreshedAt, setLastRefreshedAt] = useState(null);

  const loadChanges = useCallback(async () => {
    if (!authorized) {
      setChangeRequests([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setPageError('');

    try {
      const response = await Promise.resolve(
        service.search(
          {
            search: appliedFilters.search.trim(),
            ...(appliedFilters.status
              ? { status: appliedFilters.status }
              : {}),
            ...(appliedFilters.changeType
              ? { changeType: appliedFilters.changeType }
              : {}),
            ...(appliedFilters.manualReviewRequired === ''
              ? {}
              : {
                  manualReviewRequired:
                    appliedFilters.manualReviewRequired === 'true',
                }),
            page: 1,
            pageSize: 100,
          },
          principal,
        ),
      );
      const records =
        response.changeRequests ??
        response.records ??
        response.data ??
        [];

      if (!Array.isArray(records)) {
        throw new TypeError(
          'The contract change service returned an invalid collection.',
        );
      }

      setChangeRequests(records);
      setCounts(response.counts ?? {});
      setSelectedChange((currentChange) => {
        if (!currentChange) {
          return null;
        }

        return (
          records.find(
            (changeRequest) =>
              changeRequest.changeRequestId ===
              currentChange.changeRequestId,
          ) ?? null
        );
      });
      setLastRefreshedAt(new Date().toISOString());
    } catch (error) {
      setChangeRequests([]);
      setCounts({});
      setSelectedChange(null);
      setPageError(
        error instanceof Error && error.message
          ? error.message
          : 'Contract change outcomes could not be loaded.',
      );
    } finally {
      setLoading(false);
    }
  }, [appliedFilters, authorized, principal, service]);

  useEffect(() => {
    loadChanges();
  }, [loadChanges]);

  const updateCurrentValue = (applicationIdentifier, changeType) => {
    const application = applicationRepository.find(
      applicationIdentifier,
    );

    setValue(
      'currentValue',
      getCurrentChangeValue(application, changeType),
      {
        shouldDirty: true,
        shouldValidate: false,
      },
    );
    setValue('requestedValue', '', {
      shouldDirty: true,
      shouldValidate: false,
    });
  };

  const submitChangeRequest = async (values) => {
    setPageError('');
    setActionMessage('');
    setLatestResult(null);

    try {
      const application = applicationRepository.find(
        values.applicationIdentifier,
      );

      if (!application) {
        throw new Error(
          'The selected onboarding application could not be found.',
        );
      }

      if (
        !scopeGuard.canAccessRecord(
          application,
          principal,
          authState.partnerContext,
        )
      ) {
        throw new Error(
          'The selected application is outside your authorized scope.',
        );
      }

      const payload = {
        currentValue: values.currentValue || null,
        requestedValue: values.requestedValue,
        reason: values.reason,
        affectedCount: values.affectedCount,
        ...(values.changeType === CONTRACT_CHANGE_TYPES.HIERARCHY
          ? {
              gaCode: values.requestedValue,
              requestedGaCode: values.requestedValue,
            }
          : {}),
        ...(values.changeType === CONTRACT_CHANGE_TYPES.LEVEL
          ? { level: values.requestedValue }
          : {}),
        ...(values.changeType ===
        CONTRACT_CHANGE_TYPES.COMMISSION_SCHEDULE
          ? { commissionSchedule: values.requestedValue }
          : {}),
        ...(values.changeType === CONTRACT_CHANGE_TYPES.ASSIGNEE
          ? {
              assignedTo: values.requestedValue,
              assignedGroup: values.assignedGroup,
            }
          : {}),
      };
      const result = await Promise.resolve(
        service.create(
          {
            applicationId: application.applicationId,
            trackingId: application.trackingId,
            partnerCode: application.partnerCode,
            changeType: values.changeType,
            requestedBy:
              principal.user?.id ??
              principal.currentUser?.id ??
              'system',
            payload,
            affectedCount: values.affectedCount,
            principal,
            partnerContext: authState.partnerContext,
          },
          principal,
        ),
      );

      setLatestResult(result);
      setActionMessage(
        result.manuallyRouted
          ? 'The contract change was routed for manual review.'
          : result.autoAccepted
            ? 'The contract change was evaluated and completed.'
            : 'The contract change request was created.',
      );
      reset({
        applicationIdentifier: '',
        changeType: CONTRACT_CHANGE_TYPES.COMMISSION_SCHEDULE,
        currentValue: '',
        requestedValue: '',
        assignedGroup: '',
        reason: '',
        affectedCount: 1,
      });
      await loadChanges();
    } catch (error) {
      setPageError(
        error instanceof Error && error.message
          ? error.message
          : 'The contract change request could not be created.',
      );
    }
  };

  const applyFilters = (event) => {
    event.preventDefault();
    setAppliedFilters({ ...filters });
    setSelectedChange(null);
  };

  const resetFilters = () => {
    const defaultFilters = {
      search: '',
      status: '',
      changeType: '',
      manualReviewRequired: '',
    };

    setFilters(defaultFilters);
    setAppliedFilters(defaultFilters);
    setSelectedChange(null);
    setPageError('');
  };

  const summary = useMemo(
    () => ({
      total: changeRequests.length,
      underReview:
        (counts[CONTRACT_CHANGE_STATUSES.UNDER_REVIEW] ?? 0) +
        (counts[CONTRACT_CHANGE_STATUSES.MANUAL_ROUTED] ?? 0),
      completed:
        (counts[CONTRACT_CHANGE_STATUSES.COMPLETED] ?? 0) +
        (counts[CONTRACT_CHANGE_STATUSES.APPROVED] ?? 0),
      rejected:
        counts[CONTRACT_CHANGE_STATUSES.REJECTED] ?? 0,
    }),
    [changeRequests.length, counts],
  );

  const columns = useMemo(
    () => [
      {
        id: 'updatedAt',
        header: 'Updated',
        accessor: (changeRequest) => changeRequest.updatedAt,
        render: (value) => (
          <time className="whitespace-nowrap" dateTime={value}>
            {formatDate(value)}
          </time>
        ),
      },
      {
        id: 'changeType',
        header: 'Change type',
        accessor: (changeRequest) => changeRequest.changeType,
        render: (value, changeRequest) => (
          <div className="min-w-44">
            <p className="font-semibold text-text dark:text-white">
              {formatToken(value)}
            </p>
            <p className="mt-1 break-all font-mono text-xs text-text-muted dark:text-slate-400">
              {changeRequest.changeRequestId}
            </p>
          </div>
        ),
      },
      {
        id: 'trackingId',
        header: 'Tracking ID',
        accessor: (changeRequest) => changeRequest.trackingId,
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
        id: 'requestedValue',
        header: 'Requested value',
        accessor: (changeRequest) =>
          changeRequest.payload?.requestedValue,
        render: (value) => (
          <span className="break-words text-sm text-text dark:text-slate-200">
            {value ?? 'Not available'}
          </span>
        ),
      },
      {
        id: 'status',
        header: 'Status',
        accessor: (changeRequest) => changeRequest.status,
        render: (value) => (
          <StatusBadge
            showDot={false}
            size="sm"
            status={value}
            tone={getStatusTone(value)}
          />
        ),
      },
      {
        id: 'manualReview',
        header: 'Routing',
        accessor: (changeRequest) =>
          changeRequest.manualReviewRequired,
        render: (value, changeRequest) =>
          value ? (
            <div className="space-y-2">
              <StatusBadge
                label="Manual review"
                showDot={false}
                size="sm"
                tone="warning"
              />
              {changeRequest.createdWorkItemId && (
                <Link
                  className="block text-sm font-semibold text-lga-blue hover:underline focus:outline-none focus:ring-2 focus:ring-lga-sky dark:text-primary-300"
                  to={getOperationsWorkItemRoute(
                    changeRequest.createdWorkItemId,
                  )}
                >
                  Open work item
                </Link>
              )}
            </div>
          ) : (
            <StatusBadge
              label="Automatic"
              showDot={false}
              size="sm"
              tone="success"
            />
          ),
      },
    ],
    [],
  );

  if (!authorized) {
    return (
      <section
        aria-labelledby="contract-change-denied-title"
        className="mx-auto max-w-3xl rounded-xl border border-danger bg-danger-light p-6 text-danger-dark shadow-card dark:border-red-700 dark:bg-danger-dark dark:text-red-100"
        role="alert"
      >
        <h1
          className="text-xl font-semibold"
          id="contract-change-denied-title"
        >
          Contract change access is unavailable
        </h1>
        <p className="mt-2 text-sm leading-6">
          An authenticated internal role with contract-change management
          permission is required to use this page.
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
                label="Contract changes"
                showDot={false}
                tone="accent"
              />
              <StatusBadge
                label="Validated journey"
                showDot={false}
                tone="info"
              />
              <StatusBadge label="Simulation" showDot={false} simulation />
            </div>
            <h1 className="mt-4 text-2xl font-semibold sm:text-3xl">
              Contract change management
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-primary-100 sm:text-base">
              Submit hierarchy, commission schedule, contract level, and
              assignee changes. Complex or mass changes are routed to the
              operations workbench for manual review.
            </p>
          </div>

          <button
            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-white/50 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-lga-navy disabled:cursor-not-allowed disabled:opacity-50"
            disabled={loading}
            onClick={loadChanges}
            type="button"
          >
            {loading ? 'Refreshing…' : 'Refresh outcomes'}
          </button>
        </div>
      </header>

      <aside
        className="rounded-xl border border-accent-300 bg-accent-100 p-4 text-sm leading-6 text-accent-950 dark:border-accent-700 dark:bg-accent-950 dark:text-accent-100"
        role="note"
      >
        Contract changes are simulated and stored locally in this browser.
        Use synthetic application identifiers, assignees, comments, and
        hierarchy values only.
      </aside>

      {pageError && (
        <div
          className="rounded-xl border border-danger bg-danger-light p-4 text-sm text-danger-dark dark:border-red-700 dark:bg-danger-dark dark:text-red-100"
          role="alert"
        >
          <p className="font-semibold">
            The contract change action could not continue
          </p>
          <p className="mt-1">{pageError}</p>
        </div>
      )}

      <div aria-live="polite" className="sr-only" role="status">
        {actionMessage}
      </div>

      {latestResult && (
        <OutcomeDetails
          changeResult={latestResult}
          onClose={() => setLatestResult(null)}
        />
      )}

      <section aria-labelledby="contract-change-summary-title">
        <div>
          <h2
            className="text-xl font-semibold text-lga-navy dark:text-white"
            id="contract-change-summary-title"
          >
            Outcome summary
          </h2>
          <p className="mt-1 text-sm text-text-muted dark:text-slate-300">
            Counts reflect the current role, record scope, and applied
            outcome filters.
          </p>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryCard
            description="Change requests matching the current filters."
            label="Matching requests"
            tone="info"
            value={summary.total}
          />
          <SummaryCard
            description="Requests awaiting or routed for manual review."
            label="Under review"
            tone="warning"
            value={summary.underReview}
          />
          <SummaryCard
            description="Approved or completed change requests."
            label="Completed"
            tone="success"
            value={summary.completed}
          />
          <SummaryCard
            description="Requests rejected by validation or eligibility."
            label="Rejected"
            tone="danger"
            value={summary.rejected}
          />
        </div>

        {lastRefreshedAt && (
          <p className="mt-3 text-right text-xs text-text-muted dark:text-slate-400">
            Last refreshed {formatDate(lastRefreshedAt)}
          </p>
        )}
      </section>

      <section
        aria-labelledby="new-contract-change-title"
        className="overflow-hidden rounded-xl border border-border bg-white shadow-card dark:border-slate-700 dark:bg-slate-900"
      >
        <div className="border-b border-border px-5 py-4 sm:px-6 dark:border-slate-700">
          <h2
            className="text-xl font-semibold text-lga-navy dark:text-white"
            id="new-contract-change-title"
          >
            New contract change journey
          </h2>
          <p className="mt-1 text-sm leading-6 text-text-muted dark:text-slate-300">
            Select an authorized application and describe the requested
            contracting change.
          </p>
        </div>

        <form
          className="p-5 sm:p-6"
          noValidate
          onSubmit={handleSubmit(submitChangeRequest)}
        >
          <fieldset disabled={isSubmitting}>
            <legend className="sr-only">
              Contract change request details
            </legend>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label
                  className="block text-sm font-medium text-text dark:text-slate-100"
                  htmlFor="change-application"
                >
                  Onboarding application
                  <span aria-hidden="true" className="ml-1 text-danger">
                    *
                  </span>
                </label>
                <select
                  {...register('applicationIdentifier', {
                    onChange: (event) =>
                      updateCurrentValue(
                        event.target.value,
                        getValues('changeType'),
                      ),
                  })}
                  aria-describedby={
                    errors.applicationIdentifier
                      ? 'change-application-error'
                      : undefined
                  }
                  aria-invalid={Boolean(errors.applicationIdentifier)}
                  className="mt-1 min-h-11 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text shadow-sm focus:border-lga-sky focus:outline-none focus:ring-2 focus:ring-lga-sky disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                  id="change-application"
                >
                  <option value="">Select an application</option>
                  {applications.map((application) => (
                    <option
                      key={application.applicationId}
                      value={application.applicationId}
                    >
                      {getApplicantName(application)} —{' '}
                      {application.applicationId}
                    </option>
                  ))}
                </select>
                <FieldError
                  error={errors.applicationIdentifier}
                  id="change-application-error"
                />
                {applications.length === 0 && (
                  <p className="mt-2 text-sm text-warning-dark dark:text-amber-200">
                    No onboarding applications are available in your current
                    record scope.
                  </p>
                )}
              </div>

              <div>
                <label
                  className="block text-sm font-medium text-text dark:text-slate-100"
                  htmlFor="change-type"
                >
                  Change type
                  <span aria-hidden="true" className="ml-1 text-danger">
                    *
                  </span>
                </label>
                <select
                  {...register('changeType', {
                    onChange: (event) =>
                      updateCurrentValue(
                        getValues('applicationIdentifier'),
                        event.target.value,
                      ),
                  })}
                  aria-describedby={
                    errors.changeType ? 'change-type-error' : undefined
                  }
                  aria-invalid={Boolean(errors.changeType)}
                  className="mt-1 min-h-11 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text shadow-sm focus:border-lga-sky focus:outline-none focus:ring-2 focus:ring-lga-sky disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                  id="change-type"
                >
                  {CHANGE_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <FieldError
                  error={errors.changeType}
                  id="change-type-error"
                />
                <p className="mt-1 text-xs leading-5 text-text-muted dark:text-slate-400">
                  {
                    CHANGE_TYPE_OPTIONS.find(
                      (option) =>
                        option.value === selectedChangeType,
                    )?.description
                  }
                </p>
              </div>

              <div>
                <label
                  className="block text-sm font-medium text-text dark:text-slate-100"
                  htmlFor="change-current-value"
                >
                  Current value
                </label>
                <input
                  {...register('currentValue')}
                  className="mt-1 min-h-11 w-full rounded-lg border border-border bg-surface-muted px-3 py-2 text-sm text-text shadow-sm focus:border-lga-sky focus:outline-none focus:ring-2 focus:ring-lga-sky disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                  id="change-current-value"
                  placeholder="Loaded from the selected application"
                />
              </div>

              <div>
                <label
                  className="block text-sm font-medium text-text dark:text-slate-100"
                  htmlFor="change-requested-value"
                >
                  {getRequestedValueLabel(selectedChangeType)}
                  <span aria-hidden="true" className="ml-1 text-danger">
                    *
                  </span>
                </label>
                <input
                  {...register('requestedValue')}
                  aria-describedby={
                    errors.requestedValue
                      ? 'change-requested-value-error'
                      : undefined
                  }
                  aria-invalid={Boolean(errors.requestedValue)}
                  className="mt-1 min-h-11 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text shadow-sm placeholder:text-slate-400 focus:border-lga-sky focus:outline-none focus:ring-2 focus:ring-lga-sky disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                  id="change-requested-value"
                  placeholder={getRequestedValuePlaceholder(
                    selectedChangeType,
                  )}
                />
                <FieldError
                  error={errors.requestedValue}
                  id="change-requested-value-error"
                />
              </div>

              {selectedChangeType ===
                CONTRACT_CHANGE_TYPES.ASSIGNEE && (
                <div>
                  <label
                    className="block text-sm font-medium text-text dark:text-slate-100"
                    htmlFor="change-assigned-group"
                  >
                    Assigned group
                    <span aria-hidden="true" className="ml-1 text-danger">
                      *
                    </span>
                  </label>
                  <input
                    {...register('assignedGroup')}
                    aria-describedby={
                      errors.assignedGroup
                        ? 'change-assigned-group-error'
                        : undefined
                    }
                    aria-invalid={Boolean(errors.assignedGroup)}
                    className="mt-1 min-h-11 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text shadow-sm placeholder:text-slate-400 focus:border-lga-sky focus:outline-none focus:ring-2 focus:ring-lga-sky disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                    id="change-assigned-group"
                    placeholder="operations"
                  />
                  <FieldError
                    error={errors.assignedGroup}
                    id="change-assigned-group-error"
                  />
                </div>
              )}

              <div>
                <label
                  className="block text-sm font-medium text-text dark:text-slate-100"
                  htmlFor="change-affected-count"
                >
                  Affected records
                </label>
                <input
                  {...register('affectedCount')}
                  aria-describedby={
                    errors.affectedCount
                      ? 'change-affected-count-error'
                      : 'change-affected-count-help'
                  }
                  aria-invalid={Boolean(errors.affectedCount)}
                  className="mt-1 min-h-11 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text shadow-sm focus:border-lga-sky focus:outline-none focus:ring-2 focus:ring-lga-sky disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                  id="change-affected-count"
                  inputMode="numeric"
                  min="1"
                  type="number"
                />
                <p
                  className="mt-1 text-xs leading-5 text-text-muted dark:text-slate-400"
                  id="change-affected-count-help"
                >
                  Changes affecting multiple records require manual review.
                </p>
                <FieldError
                  error={errors.affectedCount}
                  id="change-affected-count-error"
                />
              </div>

              <div className="sm:col-span-2">
                <label
                  className="block text-sm font-medium text-text dark:text-slate-100"
                  htmlFor="change-reason"
                >
                  Change reason
                  <span aria-hidden="true" className="ml-1 text-danger">
                    *
                  </span>
                </label>
                <textarea
                  {...register('reason')}
                  aria-describedby={
                    errors.reason
                      ? 'change-reason-error'
                      : 'change-reason-help'
                  }
                  aria-invalid={Boolean(errors.reason)}
                  className="mt-1 min-h-28 w-full resize-y rounded-lg border border-border bg-white px-3 py-2 text-sm text-text shadow-sm placeholder:text-slate-400 focus:border-lga-sky focus:outline-none focus:ring-2 focus:ring-lga-sky disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                  id="change-reason"
                  maxLength="500"
                  placeholder="Describe the synthetic business reason for this change."
                />
                <p
                  className="mt-1 text-xs text-text-muted dark:text-slate-400"
                  id="change-reason-help"
                >
                  Do not include personal, banking, or production information.
                </p>
                <FieldError
                  error={errors.reason}
                  id="change-reason-error"
                />
              </div>
            </div>
          </fieldset>

          <div className="mt-6 flex justify-end border-t border-border pt-5 dark:border-slate-700">
            <button
              className="inline-flex min-h-11 items-center justify-center rounded-lg bg-lga-navy px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-800 focus:outline-none focus:ring-2 focus:ring-lga-sky focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-primary-600 dark:hover:bg-primary-500"
              disabled={isSubmitting || applications.length === 0}
              type="submit"
            >
              {isSubmitting
                ? 'Evaluating change…'
                : 'Submit contract change'}
            </button>
          </div>
        </form>
      </section>

      <form
        className="overflow-hidden rounded-xl border border-border bg-white shadow-card dark:border-slate-700 dark:bg-slate-900"
        noValidate
        onSubmit={applyFilters}
      >
        <div className="border-b border-border px-5 py-4 sm:px-6 dark:border-slate-700">
          <h2 className="text-lg font-semibold text-lga-navy dark:text-white">
            Outcome search
          </h2>
          <p className="mt-1 text-sm text-text-muted dark:text-slate-300">
            Search change requests and manual-routing outcomes within your
            current record scope.
          </p>
        </div>

        <fieldset
          className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4 sm:p-6"
          disabled={loading}
        >
          <legend className="sr-only">
            Contract change outcome filters
          </legend>

          <div className="sm:col-span-2 lg:col-span-4">
            <label
              className="block text-sm font-medium text-text dark:text-slate-100"
              htmlFor="change-search"
            >
              Search outcomes
            </label>
            <input
              className="mt-1 min-h-11 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text shadow-sm placeholder:text-slate-400 focus:border-lga-sky focus:outline-none focus:ring-2 focus:ring-lga-sky disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
              id="change-search"
              onChange={(event) =>
                setFilters((currentFilters) => ({
                  ...currentFilters,
                  search: event.target.value,
                }))
              }
              placeholder="Search ID, tracking ID, reason, value, or validation code"
              value={filters.search}
            />
          </div>

          <div>
            <label
              className="block text-sm font-medium text-text dark:text-slate-100"
              htmlFor="change-filter-type"
            >
              Change type
            </label>
            <select
              className="mt-1 min-h-11 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text shadow-sm focus:border-lga-sky focus:outline-none focus:ring-2 focus:ring-lga-sky disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
              id="change-filter-type"
              onChange={(event) =>
                setFilters((currentFilters) => ({
                  ...currentFilters,
                  changeType: event.target.value,
                }))
              }
              value={filters.changeType}
            >
              {FILTER_TYPE_OPTIONS.map((option) => (
                <option key={option.value || 'all'} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              className="block text-sm font-medium text-text dark:text-slate-100"
              htmlFor="change-filter-status"
            >
              Status
            </label>
            <select
              className="mt-1 min-h-11 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text shadow-sm focus:border-lga-sky focus:outline-none focus:ring-2 focus:ring-lga-sky disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
              id="change-filter-status"
              onChange={(event) =>
                setFilters((currentFilters) => ({
                  ...currentFilters,
                  status: event.target.value,
                }))
              }
              value={filters.status}
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value || 'all'} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              className="block text-sm font-medium text-text dark:text-slate-100"
              htmlFor="change-filter-routing"
            >
              Routing
            </label>
            <select
              className="mt-1 min-h-11 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text shadow-sm focus:border-lga-sky focus:outline-none focus:ring-2 focus:ring-lga-sky disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
              id="change-filter-routing"
              onChange={(event) =>
                setFilters((currentFilters) => ({
                  ...currentFilters,
                  manualReviewRequired: event.target.value,
                }))
              }
              value={filters.manualReviewRequired}
            >
              <option value="">All routing outcomes</option>
              <option value="true">Manual review required</option>
              <option value="false">Automatically evaluated</option>
            </select>
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
            {loading ? 'Filtering…' : 'Apply filters'}
          </button>
        </div>
      </form>

      {selectedChange && (
        <section
          aria-labelledby="selected-contract-change-title"
          className="space-y-4"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2
                className="text-xl font-semibold text-lga-navy dark:text-white"
                id="selected-contract-change-title"
              >
                Selected change request
              </h2>
              <p className="mt-1 text-sm text-text-muted dark:text-slate-300">
                Review the redacted request, outcome, and workbench reference.
              </p>
            </div>
            <button
              className="inline-flex min-h-10 items-center justify-center rounded-lg border border-border bg-white px-4 py-2 text-sm font-semibold text-lga-navy transition-colors hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-lga-sky focus:ring-offset-2 dark:border-slate-600 dark:bg-slate-900 dark:text-white dark:hover:bg-slate-800"
              onClick={() => setSelectedChange(null)}
              type="button"
            >
              Close details
            </button>
          </div>

          <JsonViewer
            data={selectedChange}
            fileName={`contract-change-${selectedChange.changeRequestId}.json`}
            initiallyExpanded
            redact
            title="Redacted contract change"
          />
        </section>
      )}

      <section aria-labelledby="contract-change-results-title">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2
              className="text-xl font-semibold text-lga-navy dark:text-white"
              id="contract-change-results-title"
            >
              Change request outcomes
            </h2>
            <p className="mt-1 text-sm leading-6 text-text-muted dark:text-slate-300">
              Select a row to inspect its redacted payload and routing
              outcome.
            </p>
          </div>
          <StatusBadge
            label={`${changeRequests.length} request${
              changeRequests.length === 1 ? '' : 's'
            }`}
            showDot={false}
            tone={changeRequests.length > 0 ? 'info' : 'neutral'}
          />
        </div>

        <DataTable
          aria-label="Contract change request outcomes"
          columns={columns}
          data={changeRequests}
          defaultPageSize={25}
          defaultSortBy="updatedAt"
          defaultSortDirection="desc"
          emptyMessage="No contract change requests matched the current filters."
          getRowId={(changeRequest) =>
            changeRequest.changeRequestId
          }
          loading={loading}
          loadingMessage="Loading contract change outcomes…"
          onRowClick={(changeRequest) =>
            setSelectedChange(changeRequest)
          }
          pageSizeOptions={[10, 25, 50, 100]}
        />
      </section>
    </div>
  );
}

ContractChangesPage.propTypes = {
  contractChangeService: PropTypes.shape({
    create: PropTypes.func.isRequired,
    search: PropTypes.func.isRequired,
  }),
};

export default ContractChangesPage;