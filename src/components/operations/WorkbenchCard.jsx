import { useId, useState } from 'react';
import PropTypes from 'prop-types';
import { canPerformAction } from '../../auth/permissionPolicy.js';
import {
  PERMISSIONS,
  ROLES,
} from '../../constants/roles.js';
import {
  WORK_ITEM_STATES,
  WORK_ITEM_TYPES,
} from '../../constants/domain.js';
import { formatDisplayDateTime } from '../../utils/dates.js';
import MaskedValue, {
  MASKED_VALUE_KINDS,
} from '../shared/MaskedValue.jsx';
import StatusBadge from '../shared/StatusBadge.jsx';

export const WORKBENCH_CARD_TYPE_LABELS = Object.freeze({
  [WORK_ITEM_TYPES.APPOINTMENT]: 'Appointment',
  [WORK_ITEM_TYPES.BACKGROUND_CHECK]: 'Background check',
  [WORK_ITEM_TYPES.EXCEPTION]: 'Exception',
  [WORK_ITEM_TYPES.DISTRIBUTION_APPROVAL]:
    'Distribution approval',
  [WORK_ITEM_TYPES.AGENCY_REVIEW]: 'Agency review',
  [WORK_ITEM_TYPES.SYNC_FAILURE]: 'Synchronization failure',
  [WORK_ITEM_TYPES.DTCC_MANUAL_CHANGE]: 'DTCC manual change',
  [WORK_ITEM_TYPES.EXPLANATION_LETTER]: 'Explanation letter',
});

export const WORKBENCH_TRANSITION_LABELS = Object.freeze({
  [WORK_ITEM_STATES.PENDING]: 'Return to pending',
  [WORK_ITEM_STATES.ACTION_NEEDED]: 'Mark action needed',
  [WORK_ITEM_STATES.COMPLETED]: 'Complete',
});

const CARD_TYPE_PERMISSIONS = Object.freeze({
  [WORK_ITEM_TYPES.APPOINTMENT]: PERMISSIONS.MANAGE_APPOINTMENTS,
  [WORK_ITEM_TYPES.BACKGROUND_CHECK]: PERMISSIONS.MANAGE_WORK_ITEMS,
  [WORK_ITEM_TYPES.EXCEPTION]: PERMISSIONS.RESOLVE_EXCEPTIONS,
  [WORK_ITEM_TYPES.DISTRIBUTION_APPROVAL]:
    PERMISSIONS.REVIEW_DISTRIBUTION,
  [WORK_ITEM_TYPES.AGENCY_REVIEW]: PERMISSIONS.MANAGE_WORK_ITEMS,
  [WORK_ITEM_TYPES.SYNC_FAILURE]: PERMISSIONS.RESOLVE_EXCEPTIONS,
  [WORK_ITEM_TYPES.DTCC_MANUAL_CHANGE]:
    PERMISSIONS.MANAGE_CONTRACT_CHANGES,
  [WORK_ITEM_TYPES.EXPLANATION_LETTER]:
    PERMISSIONS.REVIEW_LICENSING,
});

const DEFAULT_TRANSITIONS = Object.freeze({
  [WORK_ITEM_STATES.PENDING]: Object.freeze([
    WORK_ITEM_STATES.ACTION_NEEDED,
    WORK_ITEM_STATES.COMPLETED,
  ]),
  [WORK_ITEM_STATES.ACTION_NEEDED]: Object.freeze([
    WORK_ITEM_STATES.PENDING,
    WORK_ITEM_STATES.COMPLETED,
  ]),
  [WORK_ITEM_STATES.COMPLETED]: Object.freeze([]),
});

const REOPEN_ROLES = new Set([ROLES.MANAGER, ROLES.ADMIN]);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function formatToken(value) {
  const normalizedValue = String(value ?? '').trim();

  if (normalizedValue === '') {
    return 'Work item';
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

function getPrincipalRole(principal) {
  if (typeof principal === 'string') {
    return principal;
  }

  if (!isObject(principal)) {
    return null;
  }

  return (
    principal.role ??
    principal.user?.role ??
    principal.currentUser?.role ??
    null
  );
}

function normalizeTransitionList(transitions) {
  if (!Array.isArray(transitions)) {
    return undefined;
  }

  return [
    ...new Set(
      transitions.filter((transition) =>
        Object.values(WORK_ITEM_STATES).includes(transition),
      ),
    ),
  ];
}

/**
 * Returns the valid and authorized state transitions for a work item.
 *
 * @param {object} workItem Work item to evaluate.
 * @param {{
 *   allowedTransitions?: string[],
 *   allowReopen?: boolean,
 *   canTransition?: boolean,
 *   principal?: string | object
 * }} [options] Transition options.
 * @returns {string[]} Permitted target states.
 */
export function getPermittedWorkbenchTransitions(
  workItem,
  options = {},
) {
  if (!isObject(workItem)) {
    return [];
  }

  const state = workItem.state;
  let transitions = [...(DEFAULT_TRANSITIONS[state] ?? [])];
  const role = getPrincipalRole(options.principal);
  const allowReopen =
    options.allowReopen === true &&
    (options.principal === undefined ||
      options.principal === null ||
      REOPEN_ROLES.has(role));

  if (
    state === WORK_ITEM_STATES.COMPLETED &&
    allowReopen
  ) {
    transitions = [
      WORK_ITEM_STATES.PENDING,
      WORK_ITEM_STATES.ACTION_NEEDED,
    ];
  }

  const allowedTransitions = normalizeTransitionList(
    options.allowedTransitions,
  );

  if (allowedTransitions !== undefined) {
    transitions = transitions.filter((transition) =>
      allowedTransitions.includes(transition),
    );
  }

  if (options.canTransition === false) {
    return [];
  }

  if (
    options.principal !== undefined &&
    options.principal !== null
  ) {
    const permission =
      CARD_TYPE_PERMISSIONS[workItem.cardType] ??
      PERMISSIONS.MANAGE_WORK_ITEMS;

    if (!canPerformAction(options.principal, permission, workItem)) {
      return [];
    }
  }

  return transitions;
}

function MetadataItem({ label, value }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-text-muted dark:text-slate-400">
        {label}
      </dt>
      <dd className="mt-1 break-words text-sm font-medium text-text dark:text-slate-100">
        {value ?? 'Not available'}
      </dd>
    </div>
  );
}

MetadataItem.propTypes = {
  label: PropTypes.string.isRequired,
  value: PropTypes.node,
};

function TransitionButton({
  busy,
  onClick,
  targetState,
}) {
  const primary = targetState === WORK_ITEM_STATES.COMPLETED;

  return (
    <button
      className={`inline-flex min-h-10 items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-lga-sky focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:focus:ring-offset-slate-900 ${
        primary
          ? 'bg-lga-navy text-white hover:bg-primary-800 dark:bg-primary-600 dark:hover:bg-primary-500'
          : 'border border-border bg-white text-lga-navy hover:bg-surface-muted dark:border-slate-600 dark:bg-slate-900 dark:text-white dark:hover:bg-slate-800'
      }`}
      disabled={busy}
      onClick={onClick}
      type="button"
    >
      {busy
        ? 'Updating…'
        : WORKBENCH_TRANSITION_LABELS[targetState] ??
          formatToken(targetState)}
    </button>
  );
}

TransitionButton.propTypes = {
  busy: PropTypes.bool.isRequired,
  onClick: PropTypes.func.isRequired,
  targetState: PropTypes.string.isRequired,
};

/**
 * Displays an operational workbench card with scoped, permitted state
 * transitions for background, appointment, explanation, distribution,
 * exception, and DTCC manual work.
 */
export function WorkbenchCard({
  'aria-label': ariaLabel,
  actions = null,
  allowReopen = false,
  allowedTransitions,
  canTransition = true,
  className = '',
  data,
  item,
  onActionNeeded,
  onComplete,
  onOpen,
  onPending,
  onTransition,
  principal,
  showActions = true,
  showMetadata = true,
  transitionReasonCode,
  workItem,
}) {
  const headingId = useId();
  const noteId = useId();
  const [comment, setComment] = useState('');
  const [activeTransition, setActiveTransition] = useState('');
  const [actionError, setActionError] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const resolvedItem = workItem ?? item ?? data;
  const validItem = isObject(resolvedItem) ? resolvedItem : {};
  const cardType = validItem.cardType ?? 'work_item';
  const cardTypeLabel =
    WORKBENCH_CARD_TYPE_LABELS[cardType] ?? formatToken(cardType);
  const state = validItem.state ?? WORK_ITEM_STATES.PENDING;
  const metadata = isObject(validItem.metadata)
    ? validItem.metadata
    : {};
  const validationCodes = Array.isArray(metadata.validationCodes)
    ? metadata.validationCodes
    : [];
  const transitions = getPermittedWorkbenchTransitions(validItem, {
    allowedTransitions,
    allowReopen,
    canTransition,
    principal,
  });
  const actionNeededAvailable = transitions.includes(
    WORK_ITEM_STATES.ACTION_NEEDED,
  );
  const busy = activeTransition !== '';
  const resolvedAriaLabel =
    ariaLabel ??
    `${cardTypeLabel}: ${validItem.title ?? 'Operational work item'}`;

  const invokeTransition = async (targetState) => {
    if (
      targetState === WORK_ITEM_STATES.ACTION_NEEDED &&
      comment.trim() === ''
    ) {
      setActionError(
        'Add a comment before marking this item as action needed.',
      );
      return;
    }

    setActiveTransition(targetState);
    setActionError('');
    setActionMessage('');

    const request = {
      targetState,
      comment: comment.trim() || undefined,
      ...(transitionReasonCode === undefined
        ? {}
        : { reasonCode: transitionReasonCode }),
    };
    const specificHandler =
      targetState === WORK_ITEM_STATES.ACTION_NEEDED
        ? onActionNeeded
        : targetState === WORK_ITEM_STATES.COMPLETED
          ? onComplete
          : targetState === WORK_ITEM_STATES.PENDING
            ? onPending
            : undefined;
    const handler = specificHandler ?? onTransition;

    try {
      if (typeof handler !== 'function') {
        throw new Error('A work item transition handler is required.');
      }

      await handler(validItem, request);
      setActionMessage(
        `Work item state updated to ${formatToken(targetState)}.`,
      );
      setComment('');
    } catch (error) {
      setActionError(
        error instanceof Error && error.message
          ? error.message
          : 'The work item could not be updated. Try again.',
      );
    } finally {
      setActiveTransition('');
    }
  };

  return (
    <article
      aria-busy={busy}
      aria-label={resolvedAriaLabel}
      aria-labelledby={headingId}
      className={`overflow-hidden rounded-xl border border-border bg-white shadow-card dark:border-slate-700 dark:bg-slate-900 ${className}`.trim()}
      data-card-type={cardType}
      data-work-item-id={validItem.workItemId}
      data-work-item-state={state}
    >
      <div className="border-b border-border px-5 py-4 dark:border-slate-700">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-lga-blue dark:text-primary-300">
              {cardTypeLabel}
            </p>
            <h3
              className="mt-1 break-words text-lg font-semibold text-lga-navy dark:text-white"
              id={headingId}
            >
              {validItem.title ?? 'Operational work item'}
            </h3>
            {validItem.summary && (
              <p className="mt-2 text-sm leading-6 text-text-muted dark:text-slate-300">
                {validItem.summary}
              </p>
            )}
          </div>

          <div className="flex shrink-0 flex-wrap gap-2">
            <StatusBadge status={state} />
            {validItem.priority && (
              <StatusBadge
                severity={String(validItem.priority)}
                showDot={false}
              />
            )}
          </div>
        </div>
      </div>

      <div className="space-y-5 p-5">
        {showMetadata && (
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <MetadataItem
              label="Work item"
              value={
                validItem.workItemId ? (
                  <MaskedValue
                    kind={MASKED_VALUE_KINDS.RECORD_ID}
                    value={validItem.workItemId}
                  />
                ) : (
                  'Not available'
                )
              }
            />
            <MetadataItem
              label="Tracking ID"
              value={
                validItem.trackingId ? (
                  <MaskedValue
                    kind={MASKED_VALUE_KINDS.RECORD_ID}
                    value={validItem.trackingId}
                  />
                ) : (
                  'Not available'
                )
              }
            />
            <MetadataItem
              label="Assigned group"
              value={validItem.assignedGroup}
            />
            <MetadataItem
              label="Assigned to"
              value={validItem.assignedTo ?? 'Unassigned'}
            />
            <MetadataItem
              label="Updated"
              value={formatDate(validItem.updatedAt)}
            />
            <MetadataItem
              label="Completed"
              value={formatDate(validItem.completedAt)}
            />
          </dl>
        )}

        {validationCodes.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-text-muted dark:text-slate-400">
              Validation indicators
            </h4>
            <div className="mt-2 flex flex-wrap gap-2">
              {validationCodes.map((code) => (
                <StatusBadge
                  key={String(code)}
                  label={formatToken(code)}
                  severity="warning"
                  showDot={false}
                  size="sm"
                />
              ))}
            </div>
          </div>
        )}

        {showActions &&
          transitions.length > 0 &&
          actionNeededAvailable && (
            <div>
              <label
                className="block text-sm font-medium text-text dark:text-slate-100"
                htmlFor={noteId}
              >
                Transition comment
              </label>
              <textarea
                className="mt-1 min-h-24 w-full resize-y rounded-lg border border-border bg-white px-3 py-2 text-sm text-text shadow-sm placeholder:text-slate-400 focus:border-lga-sky focus:outline-none focus:ring-2 focus:ring-lga-sky disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                disabled={busy}
                id={noteId}
                onChange={(event) => {
                  setComment(event.target.value);
                  setActionError('');
                }}
                placeholder="Required when marking action needed"
                value={comment}
              />
            </div>
          )}

        {actionError && (
          <div
            className="rounded-lg border border-danger bg-danger-light p-3 text-sm text-danger-dark dark:border-red-700 dark:bg-danger-dark dark:text-red-100"
            role="alert"
          >
            {actionError}
          </div>
        )}

        <div aria-live="polite" className="sr-only" role="status">
          {actionMessage}
        </div>

        {(showActions ||
          typeof onOpen === 'function' ||
          actions !== null) && (
          <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end dark:border-slate-700">
            {typeof onOpen === 'function' && (
              <button
                className="inline-flex min-h-10 items-center justify-center rounded-lg border border-border bg-white px-4 py-2 text-sm font-semibold text-lga-navy transition-colors hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-lga-sky focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-white dark:hover:bg-slate-800 dark:focus:ring-offset-slate-900"
                disabled={busy}
                onClick={(event) => onOpen(validItem, event)}
                type="button"
              >
                Open work item
              </button>
            )}

            {actions}

            {showActions &&
              transitions.map((targetState) => (
                <TransitionButton
                  busy={busy}
                  key={targetState}
                  onClick={() => invokeTransition(targetState)}
                  targetState={targetState}
                />
              ))}
          </div>
        )}
      </div>
    </article>
  );
}

WorkbenchCard.propTypes = {
  'aria-label': PropTypes.string,
  actions: PropTypes.node,
  allowReopen: PropTypes.bool,
  allowedTransitions: PropTypes.arrayOf(PropTypes.string),
  canTransition: PropTypes.bool,
  className: PropTypes.string,
  data: PropTypes.object,
  item: PropTypes.object,
  onActionNeeded: PropTypes.func,
  onComplete: PropTypes.func,
  onOpen: PropTypes.func,
  onPending: PropTypes.func,
  onTransition: PropTypes.func,
  principal: PropTypes.oneOfType([
    PropTypes.string,
    PropTypes.object,
  ]),
  showActions: PropTypes.bool,
  showMetadata: PropTypes.bool,
  transitionReasonCode: PropTypes.string,
  workItem: PropTypes.object,
};

export default WorkbenchCard;