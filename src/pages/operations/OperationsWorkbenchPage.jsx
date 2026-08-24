import { useCallback, useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { canPerformAction } from '../../auth/permissionPolicy.js';
import WorkbenchCard, {
  WORKBENCH_CARD_TYPE_LABELS,
} from '../../components/operations/WorkbenchCard.jsx';
import StatusBadge from '../../components/shared/StatusBadge.jsx';
import Timeline from '../../components/shared/Timeline.jsx';
import {
  WORK_ITEM_STATES,
  WORK_ITEM_TYPES,
} from '../../constants/domain.js';
import { PERMISSIONS } from '../../constants/roles.js';
import { createOperationsWorkbenchService } from '../../services/operations/operationsWorkbenchService.js';
import { useAuthStore } from '../../stores/authStore.js';
import { formatDisplayDateTime } from '../../utils/dates.js';

const DEFAULT_FILTERS = Object.freeze({
  assignedGroup: '',
  assignedTo: '',
  cardType: '',
  includeCompleted: false,
  priority: '',
  search: '',
  state: '',
});

const PRIORITY_OPTIONS = Object.freeze([
  { label: 'All priorities', value: '' },
  { label: 'High', value: 'high' },
  { label: 'Medium', value: 'medium' },
  { label: 'Normal', value: 'normal' },
  { label: 'Low', value: 'low' },
]);

const STATE_OPTIONS = Object.freeze([
  { label: 'All active states', value: '' },
  { label: 'Pending', value: WORK_ITEM_STATES.PENDING },
  {
    label: 'Action needed',
    value: WORK_ITEM_STATES.ACTION_NEEDED,
  },
  { label: 'Completed', value: WORK_ITEM_STATES.COMPLETED },
]);

const CARD_TYPE_OPTIONS = Object.freeze([
  { label: 'All card types', value: '' },
  ...Object.values(WORK_ITEM_TYPES).map((cardType) => ({
    label:
      WORKBENCH_CARD_TYPE_LABELS[cardType] ??
      formatToken(cardType),
    value: cardType,
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

function createSearchRequest(filters) {
  return {
    page: 1,
    pageSize: 100,
    sortBy: 'updatedAt',
    sortDirection: 'desc',
    includeCompleted:
      filters.includeCompleted ||
      filters.state === WORK_ITEM_STATES.COMPLETED,
    ...(filters.search.trim() === ''
      ? {}
      : { search: filters.search.trim() }),
    ...(filters.state === '' ? {} : { state: filters.state }),
    ...(filters.cardType === ''
      ? {}
      : { cardType: filters.cardType }),
    ...(filters.priority === ''
      ? {}
      : { priority: filters.priority }),
    ...(filters.assignedTo.trim() === ''
      ? {}
      : { assignedTo: filters.assignedTo.trim() }),
    ...(filters.assignedGroup.trim() === ''
      ? {}
      : { assignedGroup: filters.assignedGroup.trim() }),
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

function WorkItemDetails({
  assigning,
  assignment,
  canAssign,
  onAssignmentChange,
  onAssign,
  onClose,
  workItem,
}) {
  return (
    <section
      aria-labelledby="work-item-details-title"
      className="rounded-xl border border-border bg-white p-5 shadow-card sm:p-6 dark:border-slate-700 dark:bg-slate-900"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-lga-blue dark:text-primary-300">
            Selected work item
          </p>
          <h2
            className="mt-1 text-xl font-semibold text-lga-navy dark:text-white"
            id="work-item-details-title"
          >
            {workItem.title}
          </h2>
          <p className="mt-2 break-all font-mono text-xs text-text-muted dark:text-slate-400">
            {workItem.workItemId}
          </p>
        </div>
        <button
          className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-lg border border-border bg-white px-4 py-2 text-sm font-semibold text-lga-navy transition-colors hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-lga-sky focus:ring-offset-2 dark:border-slate-600 dark:bg-slate-900 dark:text-white dark:hover:bg-slate-800"
          onClick={onClose}
          type="button"
        >
          Close details
        </button>
      </div>

      <dl className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          {
            label: 'Card type',
            value:
              WORKBENCH_CARD_TYPE_LABELS[workItem.cardType] ??
              formatToken(workItem.cardType),
          },
          {
            label: 'State',
            value: formatToken(workItem.state),
          },
          {
            label: 'Assigned group',
            value: workItem.assignedGroup,
          },
          {
            label: 'Assigned user',
            value: workItem.assignedTo ?? 'Unassigned',
          },
          {
            label: 'Partner',
            value: workItem.partnerCode,
          },
          {
            label: 'Tracking ID',
            value: workItem.trackingId ?? 'Not available',
          },
          {
            label: 'Created',
            value: formatDate(workItem.createdAt),
          },
          {
            label: 'Last updated',
            value: formatDate(workItem.updatedAt),
          },
        ].map((item) => (
          <div
            className="rounded-lg bg-surface-muted px-3 py-3 dark:bg-slate-800"
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

      {canAssign && (
        <form
          className="mt-6 rounded-xl border border-border p-4 dark:border-slate-700"
          noValidate
          onSubmit={onAssign}
        >
          <h3 className="font-semibold text-lga-navy dark:text-white">
            Assignment
          </h3>
          <p className="mt-1 text-sm text-text-muted dark:text-slate-400">
            Assign the item to a queue and optionally a specific synthetic
            user.
          </p>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label
                className="block text-sm font-medium text-text dark:text-slate-100"
                htmlFor="work-item-assigned-group"
              >
                Assigned group
              </label>
              <input
                className="mt-1 min-h-11 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text shadow-sm focus:border-lga-sky focus:outline-none focus:ring-2 focus:ring-lga-sky disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                disabled={assigning}
                id="work-item-assigned-group"
                onChange={(event) =>
                  onAssignmentChange(
                    'assignedGroup',
                    event.target.value,
                  )
                }
                required
                value={assignment.assignedGroup}
              />
            </div>
            <div>
              <label
                className="block text-sm font-medium text-text dark:text-slate-100"
                htmlFor="work-item-assigned-to"
              >
                Assigned user
              </label>
              <input
                className="mt-1 min-h-11 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text shadow-sm focus:border-lga-sky focus:outline-none focus:ring-2 focus:ring-lga-sky disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                disabled={assigning}
                id="work-item-assigned-to"
                onChange={(event) =>
                  onAssignmentChange('assignedTo', event.target.value)
                }
                placeholder="Leave blank for queue assignment"
                value={assignment.assignedTo}
              />
            </div>
            <div className="sm:col-span-2">
              <label
                className="block text-sm font-medium text-text dark:text-slate-100"
                htmlFor="work-item-assignment-reason"
              >
                Assignment reason
              </label>
              <input
                className="mt-1 min-h-11 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text shadow-sm focus:border-lga-sky focus:outline-none focus:ring-2 focus:ring-lga-sky disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                disabled={assigning}
                id="work-item-assignment-reason"
                onChange={(event) =>
                  onAssignmentChange(
                    'assignmentReason',
                    event.target.value,
                  )
                }
                placeholder="Describe why the item is being assigned"
                required
                value={assignment.assignmentReason}
              />
            </div>
          </div>

          <div className="mt-4 flex justify-end">
            <button
              className="inline-flex min-h-11 items-center justify-center rounded-lg bg-lga-navy px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-800 focus:outline-none focus:ring-2 focus:ring-lga-sky focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-primary-600 dark:hover:bg-primary-500"
              disabled={assigning}
              type="submit"
            >
              {assigning ? 'Assigning…' : 'Save assignment'}
            </button>
          </div>
        </form>
      )}

      <div className="mt-6">
        <Timeline
          compact
          emptyMessage="No work-item history has been recorded."
          getActor="actorId"
          getDescription="comment"
          getItemId={(event, index) =>
            `${event.timestamp ?? 'history'}-${index}`
          }
          getStatus="currentState"
          getTimestamp="timestamp"
          getTitle={(event) =>
            event.previousState
              ? `${formatToken(event.previousState)} to ${formatToken(
                  event.currentState,
                )}`
              : formatToken(event.currentState)
          }
          items={workItem.history ?? []}
          order="asc"
          title="Work-item history"
        />
      </div>
    </section>
  );
}

WorkItemDetails.propTypes = {
  assigning: PropTypes.bool.isRequired,
  assignment: PropTypes.shape({
    assignedGroup: PropTypes.string.isRequired,
    assignedTo: PropTypes.string.isRequired,
    assignmentReason: PropTypes.string.isRequired,
  }).isRequired,
  canAssign: PropTypes.bool.isRequired,
  onAssign: PropTypes.func.isRequired,
  onAssignmentChange: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
  workItem: PropTypes.object.isRequired,
};

function DtccManualRouteForm({
  busy,
  onCancel,
  onChange,
  onSubmit,
  values,
}) {
  return (
    <section
      aria-labelledby="dtcc-manual-route-title"
      className="rounded-xl border border-border bg-white p-5 shadow-card sm:p-6 dark:border-slate-700 dark:bg-slate-900"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2
            className="text-xl font-semibold text-lga-navy dark:text-white"
            id="dtcc-manual-route-title"
          >
            Route a non-onboarding DTCC change
          </h2>
          <p className="mt-1 text-sm leading-6 text-text-muted dark:text-slate-300">
            Create a manual operational work item for a synthetic DTCC
            transaction that is not part of an onboarding journey.
          </p>
        </div>
        <button
          className="inline-flex min-h-10 items-center justify-center rounded-lg border border-border px-4 py-2 text-sm font-semibold text-lga-navy hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-lga-sky dark:border-slate-600 dark:text-white dark:hover:bg-slate-800"
          disabled={busy}
          onClick={onCancel}
          type="button"
        >
          Cancel
        </button>
      </div>

      <form className="mt-5" noValidate onSubmit={onSubmit}>
        <fieldset
          className="grid gap-4 sm:grid-cols-2"
          disabled={busy}
        >
          <legend className="sr-only">DTCC manual route details</legend>

          <div>
            <label
              className="block text-sm font-medium text-text dark:text-slate-100"
              htmlFor="dtcc-source-record"
            >
              Source record ID
            </label>
            <input
              className="mt-1 min-h-11 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text shadow-sm focus:border-lga-sky focus:outline-none focus:ring-2 focus:ring-lga-sky dark:border-slate-600 dark:bg-slate-900 dark:text-white"
              id="dtcc-source-record"
              onChange={(event) =>
                onChange('sourceRecordId', event.target.value)
              }
              placeholder="DTCC-DEMO-CHANGE-9001"
              required
              value={values.sourceRecordId}
            />
          </div>

          <div>
            <label
              className="block text-sm font-medium text-text dark:text-slate-100"
              htmlFor="dtcc-transaction-type"
            >
              Transaction type
            </label>
            <select
              className="mt-1 min-h-11 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text shadow-sm focus:border-lga-sky focus:outline-none focus:ring-2 focus:ring-lga-sky dark:border-slate-600 dark:bg-slate-900 dark:text-white"
              id="dtcc-transaction-type"
              onChange={(event) =>
                onChange('transactionType', event.target.value)
              }
              value={values.transactionType}
            >
              <option value="name_change">Name correction</option>
              <option value="address_change">Address change</option>
              <option value="registration_change">
                Registration change
              </option>
              <option value="broker_dealer_change">
                Broker-dealer change
              </option>
            </select>
          </div>

          <div>
            <label
              className="block text-sm font-medium text-text dark:text-slate-100"
              htmlFor="dtcc-partner-code"
            >
              Partner code
            </label>
            <input
              className="mt-1 min-h-11 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text shadow-sm focus:border-lga-sky focus:outline-none focus:ring-2 focus:ring-lga-sky dark:border-slate-600 dark:bg-slate-900 dark:text-white"
              id="dtcc-partner-code"
              onChange={(event) =>
                onChange('partnerCode', event.target.value)
              }
              placeholder="DTCC_DEMO"
              required
              value={values.partnerCode}
            />
          </div>

          <div>
            <label
              className="block text-sm font-medium text-text dark:text-slate-100"
              htmlFor="dtcc-assigned-group"
            >
              Assigned group
            </label>
            <input
              className="mt-1 min-h-11 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text shadow-sm focus:border-lga-sky focus:outline-none focus:ring-2 focus:ring-lga-sky dark:border-slate-600 dark:bg-slate-900 dark:text-white"
              id="dtcc-assigned-group"
              onChange={(event) =>
                onChange('assignedGroup', event.target.value)
              }
              required
              value={values.assignedGroup}
            />
          </div>

          <div className="sm:col-span-2">
            <label
              className="block text-sm font-medium text-text dark:text-slate-100"
              htmlFor="dtcc-summary"
            >
              Transaction summary
            </label>
            <textarea
              className="mt-1 min-h-28 w-full resize-y rounded-lg border border-border bg-white px-3 py-2 text-sm text-text shadow-sm focus:border-lga-sky focus:outline-none focus:ring-2 focus:ring-lga-sky dark:border-slate-600 dark:bg-slate-900 dark:text-white"
              id="dtcc-summary"
              onChange={(event) =>
                onChange('rawSummary', event.target.value)
              }
              placeholder="Describe the synthetic DTCC change."
              required
              value={values.rawSummary}
            />
          </div>
        </fieldset>

        <div className="mt-5 flex justify-end border-t border-border pt-4 dark:border-slate-700">
          <button
            className="inline-flex min-h-11 items-center justify-center rounded-lg bg-lga-navy px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-800 focus:outline-none focus:ring-2 focus:ring-lga-sky focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-primary-600 dark:hover:bg-primary-500"
            disabled={busy}
            type="submit"
          >
            {busy ? 'Routing change…' : 'Create manual work item'}
          </button>
        </div>
      </form>
    </section>
  );
}

DtccManualRouteForm.propTypes = {
  busy: PropTypes.bool.isRequired,
  onCancel: PropTypes.func.isRequired,
  onChange: PropTypes.func.isRequired,
  onSubmit: PropTypes.func.isRequired,
  values: PropTypes.shape({
    assignedGroup: PropTypes.string.isRequired,
    partnerCode: PropTypes.string.isRequired,
    rawSummary: PropTypes.string.isRequired,
    sourceRecordId: PropTypes.string.isRequired,
    transactionType: PropTypes.string.isRequired,
  }).isRequired,
};

/**
 * Displays the role-limited operational queue with filters, card actions,
 * assignments, work-item history, and manual DTCC routing.
 */
export function OperationsWorkbenchPage() {
  const authState = useAuthStore();
  const principal = useMemo(
    () => createPrincipal(authState),
    [authState],
  );
  const authorized =
    authState.isAuthenticated &&
    canPerformAction(principal, PERMISSIONS.VIEW_WORKBENCH);
  const canRouteDtcc = canPerformAction(
    principal,
    PERMISSIONS.MANAGE_CONTRACT_CHANGES,
  );
  const workbenchService = useMemo(
    () =>
      createOperationsWorkbenchService({
        principal,
        partnerContext: authState.partnerContext,
        strictAudit: false,
      }),
    [authState.partnerContext, principal],
  );
  const [filters, setFilters] = useState({ ...DEFAULT_FILTERS });
  const [appliedFilters, setAppliedFilters] = useState({
    ...DEFAULT_FILTERS,
  });
  const [workItems, setWorkItems] = useState([]);
  const [counts, setCounts] = useState({
    [WORK_ITEM_STATES.PENDING]: 0,
    [WORK_ITEM_STATES.ACTION_NEEDED]: 0,
    [WORK_ITEM_STATES.COMPLETED]: 0,
  });
  const [selectedWorkItem, setSelectedWorkItem] = useState(null);
  const [assignment, setAssignment] = useState({
    assignedGroup: '',
    assignedTo: '',
    assignmentReason: '',
  });
  const [showDtccForm, setShowDtccForm] = useState(false);
  const [dtccValues, setDtccValues] = useState({
    sourceRecordId: '',
    transactionType: 'name_change',
    partnerCode: 'DTCC_DEMO',
    assignedGroup: 'operations',
    rawSummary: '',
  });
  const [loading, setLoading] = useState(true);
  const [assigning, setAssigning] = useState(false);
  const [routingDtcc, setRoutingDtcc] = useState(false);
  const [pageError, setPageError] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const [lastRefreshedAt, setLastRefreshedAt] = useState(null);

  const loadQueue = useCallback(async () => {
    if (!authorized) {
      setWorkItems([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setPageError('');

    try {
      const response = await Promise.resolve(
        workbenchService.search(
          createSearchRequest(appliedFilters),
          principal,
        ),
      );
      const nextItems = response.items ?? response.data ?? [];

      setWorkItems(nextItems);
      setCounts(response.counts ?? {});
      setSelectedWorkItem((currentItem) => {
        if (!currentItem) {
          return null;
        }

        return (
          nextItems.find(
            (item) => item.workItemId === currentItem.workItemId,
          ) ?? null
        );
      });
      setLastRefreshedAt(new Date().toISOString());
    } catch (error) {
      setWorkItems([]);
      setPageError(
        error instanceof Error && error.message
          ? error.message
          : 'The operations workbench could not be loaded.',
      );
    } finally {
      setLoading(false);
    }
  }, [appliedFilters, authorized, principal, workbenchService]);

  useEffect(() => {
    loadQueue();
  }, [loadQueue]);

  const selectWorkItem = (workItem) => {
    setSelectedWorkItem(workItem);
    setAssignment({
      assignedGroup: workItem.assignedGroup ?? '',
      assignedTo: workItem.assignedTo ?? '',
      assignmentReason: '',
    });
    setPageError('');
    setActionMessage('');
  };

  const handleSearch = (event) => {
    event.preventDefault();
    setAppliedFilters({ ...filters });
    setSelectedWorkItem(null);
    setActionMessage('');
  };

  const resetFilters = () => {
    setFilters({ ...DEFAULT_FILTERS });
    setAppliedFilters({ ...DEFAULT_FILTERS });
    setSelectedWorkItem(null);
    setPageError('');
    setActionMessage('');
  };

  const transitionWorkItem = async (workItem, request) => {
    setPageError('');
    setActionMessage('');

    try {
      const result = await Promise.resolve(
        workbenchService.transition(
          workItem.workItemId,
          {
            ...request,
            principal,
            expectedUpdatedAt: workItem.updatedAt,
          },
          principal,
        ),
      );

      setSelectedWorkItem(result.workItem);
      setActionMessage(
        `${workItem.title} is now ${formatToken(
          result.currentState,
        ).toLowerCase()}.`,
      );
      await loadQueue();
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : 'The work item could not be updated.';

      setPageError(message);
      throw error;
    }
  };

  const assignWorkItem = async (event) => {
    event.preventDefault();

    if (!selectedWorkItem) {
      return;
    }

    if (
      assignment.assignedGroup.trim() === '' ||
      assignment.assignmentReason.trim() === ''
    ) {
      setPageError(
        'Assigned group and assignment reason are required.',
      );
      return;
    }

    setAssigning(true);
    setPageError('');
    setActionMessage('');

    try {
      const result = await Promise.resolve(
        workbenchService.assign(
          selectedWorkItem.workItemId,
          {
            assignedTo: assignment.assignedTo.trim() || null,
            assignedGroup: assignment.assignedGroup.trim(),
            assignmentReason: assignment.assignmentReason.trim(),
            expectedUpdatedAt: selectedWorkItem.updatedAt,
            principal,
          },
          principal,
        ),
      );

      setSelectedWorkItem(result.workItem);
      setAssignment({
        assignedGroup: result.workItem.assignedGroup ?? '',
        assignedTo: result.workItem.assignedTo ?? '',
        assignmentReason: '',
      });
      setActionMessage('The work-item assignment was updated.');
      await loadQueue();
    } catch (error) {
      setPageError(
        error instanceof Error && error.message
          ? error.message
          : 'The work item could not be assigned.',
      );
    } finally {
      setAssigning(false);
    }
  };

  const routeDtccChange = async (event) => {
    event.preventDefault();

    if (
      dtccValues.sourceRecordId.trim() === '' ||
      dtccValues.partnerCode.trim() === '' ||
      dtccValues.assignedGroup.trim() === '' ||
      dtccValues.rawSummary.trim() === ''
    ) {
      setPageError(
        'Complete all DTCC manual route fields before continuing.',
      );
      return;
    }

    setRoutingDtcc(true);
    setPageError('');
    setActionMessage('');

    try {
      const workItem = await Promise.resolve(
        workbenchService.createFromDtccManualRoute(
          {
            sourceRecordId: dtccValues.sourceRecordId.trim(),
            transactionType: dtccValues.transactionType,
            partnerCode: dtccValues.partnerCode.trim(),
            assignedGroup: dtccValues.assignedGroup.trim(),
            rawSummary: dtccValues.rawSummary.trim(),
            principal,
            metadata: {
              synthetic: true,
              source: 'operations_workbench',
            },
          },
          principal,
        ),
      );

      setShowDtccForm(false);
      setDtccValues({
        sourceRecordId: '',
        transactionType: 'name_change',
        partnerCode: 'DTCC_DEMO',
        assignedGroup: 'operations',
        rawSummary: '',
      });
      setActionMessage(
        `Manual DTCC work item ${workItem.workItemId} was created.`,
      );
      await loadQueue();
    } catch (error) {
      setPageError(
        error instanceof Error && error.message
          ? error.message
          : 'The DTCC change could not be routed.',
      );
    } finally {
      setRoutingDtcc(false);
    }
  };

  if (!authorized) {
    return (
      <section
        aria-labelledby="operations-workbench-denied-title"
        className="mx-auto max-w-3xl rounded-xl border border-danger bg-danger-light p-6 text-danger-dark shadow-card dark:border-red-700 dark:bg-danger-dark dark:text-red-100"
        role="alert"
      >
        <h1
          className="text-xl font-semibold"
          id="operations-workbench-denied-title"
        >
          Operations workbench access is unavailable
        </h1>
        <p className="mt-2 text-sm leading-6">
          An authenticated internal role with workbench access is required to
          view this operational queue.
        </p>
      </section>
    );
  }

  const canAssignSelected =
    selectedWorkItem !== null &&
    canPerformAction(
      principal,
      PERMISSIONS.ASSIGN_ONBOARDING,
      selectedWorkItem,
    );

  return (
    <div className="mx-auto w-full max-w-7xl space-y-7">
      <header className="overflow-hidden rounded-2xl bg-lga-navy text-white shadow-elevated">
        <div className="grid gap-6 px-6 py-7 sm:px-8 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <div className="flex flex-wrap gap-2">
              <StatusBadge
                label="Operations workbench"
                showDot={false}
                tone="accent"
              />
              <StatusBadge
                label="Role limited"
                showDot={false}
                tone="info"
              />
              <StatusBadge
                label="Simulation"
                showDot={false}
                simulation
              />
            </div>
            <h1 className="mt-4 text-2xl font-semibold sm:text-3xl">
              Operational work queue
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-primary-100 sm:text-base">
              Process background, appointment, exception, distribution,
              synchronization, explanation-letter, agency-review, and manual
              DTCC work items within your authorized assignment scope.
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row lg:flex-col">
            <button
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-white/50 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-lga-navy disabled:cursor-not-allowed disabled:opacity-50"
              disabled={loading}
              onClick={loadQueue}
              type="button"
            >
              {loading ? 'Refreshing…' : 'Refresh queue'}
            </button>
            {canRouteDtcc && (
              <button
                className="inline-flex min-h-11 items-center justify-center rounded-lg bg-lga-gold px-5 py-2 text-sm font-semibold text-lga-navy transition-colors hover:bg-accent-300 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-lga-navy"
                onClick={() => {
                  setShowDtccForm(true);
                  setSelectedWorkItem(null);
                  setPageError('');
                }}
                type="button"
              >
                Route DTCC change
              </button>
            )}
          </div>
        </div>
      </header>

      <aside
        className="rounded-xl border border-accent-300 bg-accent-100 p-4 text-sm leading-6 text-accent-950 dark:border-accent-700 dark:bg-accent-950 dark:text-accent-100"
        role="note"
      >
        Work items and transitions are simulated and persisted in browser
        storage. Use synthetic comments, identifiers, assignments, and
        transaction details only.
      </aside>

      {pageError && (
        <div
          className="rounded-xl border border-danger bg-danger-light p-4 text-sm text-danger-dark dark:border-red-700 dark:bg-danger-dark dark:text-red-100"
          role="alert"
        >
          <p className="font-semibold">
            The workbench action could not continue
          </p>
          <p className="mt-1">{pageError}</p>
        </div>
      )}

      <div aria-live="polite" className="sr-only" role="status">
        {actionMessage}
      </div>

      {showDtccForm && (
        <DtccManualRouteForm
          busy={routingDtcc}
          onCancel={() => {
            setShowDtccForm(false);
            setPageError('');
          }}
          onChange={(field, value) =>
            setDtccValues((currentValues) => ({
              ...currentValues,
              [field]: value,
            }))
          }
          onSubmit={routeDtccChange}
          values={dtccValues}
        />
      )}

      <section aria-labelledby="workbench-summary-title">
        <div>
          <h2
            className="text-xl font-semibold text-lga-navy dark:text-white"
            id="workbench-summary-title"
          >
            Queue summary
          </h2>
          <p className="mt-1 text-sm text-text-muted dark:text-slate-300">
            Counts reflect the current role, assignment, and partner scope.
          </p>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryCard
            description="Items returned by the current filter set."
            label="Matching items"
            tone="info"
            value={workItems.length}
          />
          <SummaryCard
            description="Work waiting to be processed."
            label="Pending"
            tone="info"
            value={counts[WORK_ITEM_STATES.PENDING] ?? 0}
          />
          <SummaryCard
            description="Work requiring operational attention."
            label="Action needed"
            tone="warning"
            value={counts[WORK_ITEM_STATES.ACTION_NEEDED] ?? 0}
          />
          <SummaryCard
            description="Completed work in the current scoped queue."
            label="Completed"
            tone="success"
            value={counts[WORK_ITEM_STATES.COMPLETED] ?? 0}
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
        onSubmit={handleSearch}
      >
        <div className="border-b border-border px-5 py-4 sm:px-6 dark:border-slate-700">
          <h2 className="text-lg font-semibold text-lga-navy dark:text-white">
            Queue filters
          </h2>
          <p className="mt-1 text-sm text-text-muted dark:text-slate-300">
            Filter by text, state, card taxonomy, priority, queue, or
            assignee.
          </p>
        </div>

        <fieldset
          className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3 sm:p-6"
          disabled={loading}
        >
          <legend className="sr-only">
            Operations workbench filters
          </legend>

          <div className="sm:col-span-2 lg:col-span-3">
            <label
              className="block text-sm font-medium text-text dark:text-slate-100"
              htmlFor="workbench-search"
            >
              Search work items
            </label>
            <input
              className="mt-1 min-h-11 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text shadow-sm placeholder:text-slate-400 focus:border-lga-sky focus:outline-none focus:ring-2 focus:ring-lga-sky disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
              id="workbench-search"
              onChange={(event) =>
                setFilters((currentFilters) => ({
                  ...currentFilters,
                  search: event.target.value,
                }))
              }
              placeholder="Search title, tracking ID, applicant, partner, or validation code"
              value={filters.search}
            />
          </div>

          <FilterSelect
            disabled={loading}
            id="workbench-state"
            label="State"
            onChange={(event) =>
              setFilters((currentFilters) => ({
                ...currentFilters,
                state: event.target.value,
              }))
            }
            options={STATE_OPTIONS}
            value={filters.state}
          />

          <FilterSelect
            disabled={loading}
            id="workbench-card-type"
            label="Card type"
            onChange={(event) =>
              setFilters((currentFilters) => ({
                ...currentFilters,
                cardType: event.target.value,
              }))
            }
            options={CARD_TYPE_OPTIONS}
            value={filters.cardType}
          />

          <FilterSelect
            disabled={loading}
            id="workbench-priority"
            label="Priority"
            onChange={(event) =>
              setFilters((currentFilters) => ({
                ...currentFilters,
                priority: event.target.value,
              }))
            }
            options={PRIORITY_OPTIONS}
            value={filters.priority}
          />

          <div>
            <label
              className="block text-sm font-medium text-text dark:text-slate-100"
              htmlFor="workbench-assigned-group"
            >
              Assigned group
            </label>
            <input
              className="mt-1 min-h-11 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text shadow-sm focus:border-lga-sky focus:outline-none focus:ring-2 focus:ring-lga-sky disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
              id="workbench-assigned-group"
              onChange={(event) =>
                setFilters((currentFilters) => ({
                  ...currentFilters,
                  assignedGroup: event.target.value,
                }))
              }
              placeholder="operations"
              value={filters.assignedGroup}
            />
          </div>

          <div>
            <label
              className="block text-sm font-medium text-text dark:text-slate-100"
              htmlFor="workbench-assigned-to"
            >
              Assigned user
            </label>
            <input
              className="mt-1 min-h-11 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text shadow-sm focus:border-lga-sky focus:outline-none focus:ring-2 focus:ring-lga-sky disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
              id="workbench-assigned-to"
              onChange={(event) =>
                setFilters((currentFilters) => ({
                  ...currentFilters,
                  assignedTo: event.target.value,
                }))
              }
              placeholder="usr_operations_demo"
              value={filters.assignedTo}
            />
          </div>

          <label className="flex min-h-11 items-start gap-3 rounded-lg border border-border bg-surface-muted px-4 py-3 text-sm text-text dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
            <input
              checked={filters.includeCompleted}
              className="mt-0.5 size-5 shrink-0 rounded border-border text-lga-navy focus:ring-2 focus:ring-lga-sky"
              onChange={(event) =>
                setFilters((currentFilters) => ({
                  ...currentFilters,
                  includeCompleted: event.target.checked,
                }))
              }
              type="checkbox"
            />
            <span>
              <span className="font-medium">
                Include completed work
              </span>
              <span className="mt-1 block text-xs text-text-muted dark:text-slate-400">
                Include terminal cards in the queue results.
              </span>
            </span>
          </label>
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

      {selectedWorkItem && (
        <WorkItemDetails
          assigning={assigning}
          assignment={assignment}
          canAssign={canAssignSelected}
          onAssign={assignWorkItem}
          onAssignmentChange={(field, value) =>
            setAssignment((currentAssignment) => ({
              ...currentAssignment,
              [field]: value,
            }))
          }
          onClose={() => setSelectedWorkItem(null)}
          workItem={selectedWorkItem}
        />
      )}

      <section aria-labelledby="workbench-results-title">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2
              className="text-xl font-semibold text-lga-navy dark:text-white"
              id="workbench-results-title"
            >
              Operational cards
            </h2>
            <p className="mt-1 text-sm leading-6 text-text-muted dark:text-slate-300">
              Available transitions are determined by card type, assignment
              scope, current state, and role permissions.
            </p>
          </div>
          <StatusBadge
            label={`${workItems.length} item${
              workItems.length === 1 ? '' : 's'
            }`}
            showDot={false}
            tone={workItems.length > 0 ? 'info' : 'neutral'}
          />
        </div>

        {loading ? (
          <div
            className="rounded-xl border border-border bg-white px-5 py-12 text-center text-sm text-text-muted shadow-card dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
            role="status"
          >
            Loading operational work items…
          </div>
        ) : workItems.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border-strong bg-white px-5 py-12 text-center shadow-card dark:border-slate-600 dark:bg-slate-900">
            <h3 className="font-semibold text-lga-navy dark:text-white">
              No work items matched
            </h3>
            <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-text-muted dark:text-slate-300">
              Adjust the queue filters or refresh the workbench. Items outside
              your role and assignment scope are not displayed.
            </p>
          </div>
        ) : (
          <div className="grid gap-5 xl:grid-cols-2">
            {workItems.map((workItem) => (
              <WorkbenchCard
                allowReopen
                key={workItem.workItemId}
                onOpen={selectWorkItem}
                onTransition={transitionWorkItem}
                principal={principal}
                workItem={workItem}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export default OperationsWorkbenchPage;