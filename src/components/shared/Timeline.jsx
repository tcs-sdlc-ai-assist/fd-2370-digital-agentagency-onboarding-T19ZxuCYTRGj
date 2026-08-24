import { useId, useMemo } from 'react';
import PropTypes from 'prop-types';
import { formatDisplayDateTime } from '../../utils/dates.js';
import StatusBadge, {
  STATUS_BADGE_KINDS,
} from './StatusBadge.jsx';

const TIMESTAMP_FIELDS = Object.freeze([
  'timestamp',
  'occurredAt',
  'createdAt',
  'attemptedAt',
  'requestedAt',
  'updatedAt',
  'completedAt',
  'resolvedAt',
]);

const IDENTIFIER_FIELDS = Object.freeze([
  'id',
  'auditEventId',
  'lifecycleEventId',
  'checkId',
  'workItemId',
  'syncAttemptId',
  'changeRequestId',
  'notificationId',
  'assignmentId',
  'applicationId',
  'trackingId',
]);

function getFirstMeaningfulValue(item, fields) {
  for (const field of fields) {
    const value = item?.[field];

    if (
      value !== null &&
      value !== undefined &&
      (typeof value !== 'string' || value.trim() !== '')
    ) {
      return value;
    }
  }

  return undefined;
}

function formatToken(value) {
  const normalizedValue = String(value ?? '').trim();

  if (normalizedValue === '') {
    return '';
  }

  return normalizedValue
    .replace(/[_:-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function getDefaultTimestamp(item) {
  return getFirstMeaningfulValue(item, TIMESTAMP_FIELDS);
}

function getDefaultTitle(item) {
  const explicitTitle = getFirstMeaningfulValue(item, [
    'title',
    'eventTitle',
    'label',
  ]);

  if (explicitTitle !== undefined) {
    return explicitTitle;
  }

  const action = getFirstMeaningfulValue(item, [
    'action',
    'eventType',
    'type',
    'operation',
    'workflowStage',
    'status',
    'outcome',
  ]);

  return action === undefined ? 'Timeline event' : formatToken(action);
}

function getDefaultDescription(item, title) {
  const description = getFirstMeaningfulValue(item, [
    'summary',
    'message',
    'description',
    'comment',
    'failureReason',
  ]);

  return description === title ? undefined : description;
}

function getDefaultStatus(item) {
  return getFirstMeaningfulValue(item, [
    'status',
    'outcome',
    'currentState',
    'workflowStage',
    'severity',
  ]);
}

function getDefaultSource(item) {
  return getFirstMeaningfulValue(item, [
    'providerCode',
    'system',
    'source',
    'sourceSystem',
    'channel',
  ]);
}

function getDefaultActor(item) {
  const actor = item?.actor;

  if (typeof actor === 'string' || typeof actor === 'number') {
    return String(actor);
  }

  if (actor && typeof actor === 'object' && !Array.isArray(actor)) {
    return (
      actor.displayName ??
      actor.name ??
      actor.email ??
      actor.id ??
      actor.userId
    );
  }

  const actorName = [item?.actorFirstName, item?.actorLastName]
    .filter(Boolean)
    .join(' ')
    .trim();

  return (
    actorName ||
    getFirstMeaningfulValue(item, [
      'actorName',
      'actorId',
      'assignedTo',
      'requestedBy',
    ])
  );
}

function getDefaultIdentifier(item, index) {
  return (
    getFirstMeaningfulValue(item, IDENTIFIER_FIELDS) ??
    `timeline-event-${index}`
  );
}

function resolveValue(accessor, item, index, fallback) {
  if (typeof accessor === 'function') {
    return accessor(item, index);
  }

  if (typeof accessor === 'string' && accessor.trim() !== '') {
    return accessor
      .split('.')
      .reduce(
        (value, segment) =>
          value === null || value === undefined
            ? undefined
            : value[segment],
        item,
      );
  }

  return fallback(item, index);
}

function getTimestampValue(timestamp) {
  if (
    timestamp === null ||
    timestamp === undefined ||
    timestamp === ''
  ) {
    return Number.POSITIVE_INFINITY;
  }

  const value =
    timestamp instanceof Date
      ? timestamp.getTime()
      : Date.parse(String(timestamp));

  return Number.isNaN(value) ? Number.POSITIVE_INFINITY : value;
}

function formatTimestamp(timestamp, dateFormatOptions) {
  if (
    timestamp === null ||
    timestamp === undefined ||
    timestamp === ''
  ) {
    return 'Time unavailable';
  }

  try {
    return formatDisplayDateTime(timestamp, dateFormatOptions);
  } catch {
    return 'Time unavailable';
  }
}

function normalizeTimestamp(timestamp) {
  if (
    timestamp === null ||
    timestamp === undefined ||
    timestamp === ''
  ) {
    return undefined;
  }

  const date =
    timestamp instanceof Date
      ? new Date(timestamp.getTime())
      : new Date(timestamp);

  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function TimelineEvent({
  actor,
  compact,
  description,
  event,
  index,
  isLast,
  onItemClick,
  renderItem,
  showConnector,
  source,
  status,
  timestamp,
  timestampLabel,
  title,
}) {
  const customContent =
    typeof renderItem === 'function'
      ? renderItem(event, index)
      : undefined;
  const interactive = typeof onItemClick === 'function';

  return (
    <li
      className={`relative flex gap-4 ${
        compact ? 'pb-4' : 'pb-7'
      } ${isLast ? 'last:pb-0' : ''}`.trim()}
    >
      <div
        aria-hidden="true"
        className="relative flex w-5 shrink-0 justify-center"
      >
        <span className="relative z-10 mt-1.5 size-3 rounded-full border-2 border-lga-sky bg-white ring-4 ring-primary-50 dark:border-primary-300 dark:bg-slate-900 dark:ring-primary-950" />
        {showConnector && !isLast && (
          <span className="absolute bottom-[-0.375rem] top-4 w-px bg-border dark:bg-slate-700" />
        )}
      </div>

      <article
        className={`min-w-0 flex-1 rounded-xl border border-border bg-white shadow-card dark:border-slate-700 dark:bg-slate-900 ${
          compact ? 'p-3' : 'p-4'
        }`}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h3 className="font-semibold text-lga-navy dark:text-white">
              {interactive ? (
                <button
                  className="rounded-md text-left transition-colors hover:text-lga-blue focus:outline-none focus:ring-2 focus:ring-lga-sky focus:ring-offset-2 dark:hover:text-primary-200 dark:focus:ring-offset-slate-900"
                  onClick={(clickEvent) =>
                    onItemClick(event, index, clickEvent)
                  }
                  type="button"
                >
                  {title}
                </button>
              ) : (
                title
              )}
            </h3>

            <time
              className="mt-1 block text-xs text-text-muted dark:text-slate-400"
              dateTime={normalizeTimestamp(timestamp)}
            >
              {timestampLabel}
            </time>
          </div>

          {(status !== undefined || source !== undefined) && (
            <div className="flex shrink-0 flex-wrap gap-2">
              {status !== undefined && (
                <StatusBadge size="sm" status={String(status)} />
              )}
              {source !== undefined && (
                <StatusBadge
                  kind={STATUS_BADGE_KINDS.SOURCE_SYSTEM}
                  showDot={false}
                  size="sm"
                  sourceSystem={String(source)}
                />
              )}
            </div>
          )}
        </div>

        {customContent !== undefined && customContent !== null ? (
          <div className="mt-3 text-sm text-text dark:text-slate-100">
            {customContent}
          </div>
        ) : (
          description !== undefined &&
          description !== null &&
          description !== '' && (
            <p className="mt-3 text-sm leading-6 text-text-muted dark:text-slate-300">
              {description}
            </p>
          )
        )}

        {actor !== undefined && actor !== null && actor !== '' && (
          <p className="mt-3 text-xs text-text-muted dark:text-slate-400">
            Actor:{' '}
            <span className="font-medium text-text dark:text-slate-200">
              {String(actor)}
            </span>
          </p>
        )}
      </article>
    </li>
  );
}

TimelineEvent.propTypes = {
  actor: PropTypes.oneOfType([
    PropTypes.string,
    PropTypes.number,
  ]),
  compact: PropTypes.bool.isRequired,
  description: PropTypes.node,
  event: PropTypes.object.isRequired,
  index: PropTypes.number.isRequired,
  isLast: PropTypes.bool.isRequired,
  onItemClick: PropTypes.func,
  renderItem: PropTypes.func,
  showConnector: PropTypes.bool.isRequired,
  source: PropTypes.oneOfType([
    PropTypes.string,
    PropTypes.number,
  ]),
  status: PropTypes.oneOfType([
    PropTypes.string,
    PropTypes.number,
  ]),
  timestamp: PropTypes.oneOfType([
    PropTypes.instanceOf(Date),
    PropTypes.string,
    PropTypes.number,
  ]),
  timestampLabel: PropTypes.string.isRequired,
  title: PropTypes.node.isRequired,
};

/**
 * Displays chronological lifecycle, audit, provider, work-item, and
 * synchronization events.
 */
export function Timeline({
  'aria-label': ariaLabel = 'Timeline',
  className = '',
  compact = false,
  data,
  dateFormatOptions = {},
  emptyMessage = 'No timeline events found.',
  emptyState = null,
  events,
  getActor,
  getDescription,
  getItemId,
  getSource,
  getStatus,
  getTimestamp,
  getTitle,
  items,
  loading = false,
  loadingMessage = 'Loading timeline…',
  onItemClick,
  order = 'asc',
  renderItem,
  showConnector = true,
  title = null,
}) {
  const headingId = useId();
  const sourceItems = items ?? events ?? data ?? [];
  const sortedItems = useMemo(() => {
    const direction = order === 'desc' ? -1 : 1;

    return sourceItems
      .map((event, index) => ({
        event,
        originalIndex: index,
        timestamp: resolveValue(
          getTimestamp,
          event,
          index,
          getDefaultTimestamp,
        ),
      }))
      .sort((left, right) => {
        const comparison =
          getTimestampValue(left.timestamp) -
          getTimestampValue(right.timestamp);

        if (comparison === 0) {
          return left.originalIndex - right.originalIndex;
        }

        return comparison * direction;
      });
  }, [getTimestamp, order, sourceItems]);

  return (
    <section
      aria-busy={loading}
      aria-labelledby={title ? headingId : undefined}
      className={`w-full ${className}`.trim()}
    >
      {title && (
        <h2
          className="mb-5 text-lg font-semibold text-lga-navy dark:text-white"
          id={headingId}
        >
          {title}
        </h2>
      )}

      {loading ? (
        <div
          className="rounded-xl border border-border bg-white px-4 py-10 text-center text-sm text-text-muted shadow-card dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
          role="status"
        >
          {loadingMessage}
        </div>
      ) : sortedItems.length === 0 ? (
        <div className="rounded-xl border border-border bg-white px-4 py-10 text-center text-sm text-text-muted shadow-card dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
          {emptyState ?? emptyMessage}
        </div>
      ) : (
        <ol aria-label={ariaLabel} className="m-0 list-none p-0">
          {sortedItems.map(
            ({ event, originalIndex, timestamp }, displayIndex) => {
              const eventTitle = resolveValue(
                getTitle,
                event,
                originalIndex,
                getDefaultTitle,
              );
              const description =
                typeof getDescription === 'function' ||
                typeof getDescription === 'string'
                  ? resolveValue(
                      getDescription,
                      event,
                      originalIndex,
                      () => undefined,
                    )
                  : getDefaultDescription(event, eventTitle);
              const status = resolveValue(
                getStatus,
                event,
                originalIndex,
                getDefaultStatus,
              );
              const source = resolveValue(
                getSource,
                event,
                originalIndex,
                getDefaultSource,
              );
              const actor = resolveValue(
                getActor,
                event,
                originalIndex,
                getDefaultActor,
              );
              const itemId = resolveValue(
                getItemId,
                event,
                originalIndex,
                getDefaultIdentifier,
              );

              return (
                <TimelineEvent
                  actor={actor}
                  compact={compact}
                  description={description}
                  event={event}
                  index={originalIndex}
                  isLast={displayIndex === sortedItems.length - 1}
                  key={String(itemId)}
                  onItemClick={onItemClick}
                  renderItem={renderItem}
                  showConnector={showConnector}
                  source={source}
                  status={status}
                  timestamp={timestamp}
                  timestampLabel={formatTimestamp(
                    timestamp,
                    dateFormatOptions,
                  )}
                  title={eventTitle ?? 'Timeline event'}
                />
              );
            },
          )}
        </ol>
      )}
    </section>
  );
}

const accessorPropType = PropTypes.oneOfType([
  PropTypes.string,
  PropTypes.func,
]);

Timeline.propTypes = {
  'aria-label': PropTypes.string,
  className: PropTypes.string,
  compact: PropTypes.bool,
  data: PropTypes.arrayOf(PropTypes.object),
  dateFormatOptions: PropTypes.shape({
    fallback: PropTypes.string,
    formatOptions: PropTypes.object,
    locale: PropTypes.string,
    timeZone: PropTypes.string,
  }),
  emptyMessage: PropTypes.node,
  emptyState: PropTypes.node,
  events: PropTypes.arrayOf(PropTypes.object),
  getActor: accessorPropType,
  getDescription: accessorPropType,
  getItemId: accessorPropType,
  getSource: accessorPropType,
  getStatus: accessorPropType,
  getTimestamp: accessorPropType,
  getTitle: accessorPropType,
  items: PropTypes.arrayOf(PropTypes.object),
  loading: PropTypes.bool,
  loadingMessage: PropTypes.node,
  onItemClick: PropTypes.func,
  order: PropTypes.oneOf(['asc', 'desc']),
  renderItem: PropTypes.func,
  showConnector: PropTypes.bool,
  title: PropTypes.node,
};

export default Timeline;