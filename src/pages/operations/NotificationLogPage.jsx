import { useCallback, useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { canPerformAction } from '../../auth/permissionPolicy.js';
import DataTable from '../../components/shared/DataTable.jsx';
import JsonViewer from '../../components/shared/JsonViewer.jsx';
import MaskedValue, {
  MASKED_VALUE_KINDS,
} from '../../components/shared/MaskedValue.jsx';
import StatusBadge from '../../components/shared/StatusBadge.jsx';
import { PERMISSIONS } from '../../constants/roles.js';
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_STATUSES,
  NOTIFICATION_TYPES,
} from '../../repositories/notificationRepository.js';
import { createNotificationVisibilityService } from '../../services/operations/notificationVisibilityService.js';
import { useAuthStore } from '../../stores/authStore.js';
import { formatDisplayDateTime } from '../../utils/dates.js';

const DEFAULT_FILTERS = Object.freeze({
  channel: '',
  partnerCode: '',
  search: '',
  status: '',
  trackingId: '',
  type: '',
});

const CHANNEL_LABELS = Object.freeze({
  [NOTIFICATION_CHANNELS.EMAIL]: 'Email',
  [NOTIFICATION_CHANNELS.IN_APP]: 'In-app',
  [NOTIFICATION_CHANNELS.SMS]: 'SMS',
  [NOTIFICATION_CHANNELS.PUSH]: 'Push',
});

const TYPE_LABELS = Object.freeze({
  [NOTIFICATION_TYPES.WELCOME]: 'Welcome',
  [NOTIFICATION_TYPES.REMINDER]: 'Reminder',
  [NOTIFICATION_TYPES.AGENCY_COPY]: 'Agency copy',
  [NOTIFICATION_TYPES.AGENCY_REVIEW_REQUEST]: 'Agency review request',
  [NOTIFICATION_TYPES.AGENCY_REVIEW_COMPLETED]:
    'Agency review completed',
  [NOTIFICATION_TYPES.STATUS_UPDATE]: 'Status update',
  [NOTIFICATION_TYPES.EXCEPTION_NOTICE]: 'Exception notice',
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

function getChannelLabel(channel) {
  return CHANNEL_LABELS[channel] ?? formatToken(channel);
}

function getTypeLabel(type) {
  return TYPE_LABELS[type] ?? formatToken(type);
}

function getStatusTone(status) {
  switch (status) {
    case NOTIFICATION_STATUSES.DELIVERED:
    case NOTIFICATION_STATUSES.READ:
    case NOTIFICATION_STATUSES.SENT:
      return 'success';

    case NOTIFICATION_STATUSES.FAILED:
      return 'danger';

    case NOTIFICATION_STATUSES.QUEUED:
    case NOTIFICATION_STATUSES.SUPPRESSED:
      return 'warning';

    case NOTIFICATION_STATUSES.PREVIEWED:
      return 'info';

    default:
      return 'neutral';
  }
}

function getChannelTone(channel) {
  switch (channel) {
    case NOTIFICATION_CHANNELS.EMAIL:
      return 'info';

    case NOTIFICATION_CHANNELS.SMS:
      return 'accent';

    case NOTIFICATION_CHANNELS.IN_APP:
      return 'success';

    default:
      return 'neutral';
  }
}

function createSearchRequest(filters) {
  return {
    page: 1,
    pageSize: 100,
    sortOrder: 'desc',
    ...(filters.search.trim() === ''
      ? {}
      : { search: filters.search.trim() }),
    ...(filters.trackingId.trim() === ''
      ? {}
      : { trackingId: filters.trackingId.trim() }),
    ...(filters.partnerCode.trim() === ''
      ? {}
      : { partnerCode: filters.partnerCode.trim() }),
    ...(filters.channel === ''
      ? {}
      : { channel: filters.channel }),
    ...(filters.type === '' ? {} : { type: filters.type }),
    ...(filters.status === ''
      ? {}
      : { status: filters.status }),
  };
}

function getPreviewTitle(notification) {
  return (
    notification.previewPayload?.subject ??
    notification.previewPayload?.title ??
    getTypeLabel(notification.type)
  );
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

function DetailItem({ children, label, value }) {
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

DetailItem.propTypes = {
  children: PropTypes.node,
  label: PropTypes.string.isRequired,
  value: PropTypes.node,
};

function ReviewGateIndicator({ flags, trackingId }) {
  if (!trackingId) {
    return (
      <StatusBadge
        label="Not linked"
        showDot={false}
        size="sm"
        tone="neutral"
      />
    );
  }

  if (!flags) {
    return (
      <StatusBadge
        label="Gate unavailable"
        showDot={false}
        size="sm"
        tone="neutral"
      />
    );
  }

  return (
    <StatusBadge
      label={
        flags.carrierSubmissionBlocked
          ? 'Review blocking'
          : flags.hasAgencyReviewCompletion
            ? 'Review complete'
            : 'No review block'
      }
      showDot={false}
      size="sm"
      tone={
        flags.carrierSubmissionBlocked
          ? 'warning'
          : flags.hasAgencyReviewCompletion
            ? 'success'
            : 'neutral'
      }
    />
  );
}

ReviewGateIndicator.propTypes = {
  flags: PropTypes.shape({
    carrierSubmissionBlocked: PropTypes.bool,
    hasAgencyReviewCompletion: PropTypes.bool,
  }),
  trackingId: PropTypes.string,
};

function NotificationDetails({
  flags,
  notification,
  onClose,
}) {
  return (
    <section
      aria-labelledby="notification-details-title"
      className="rounded-xl border border-border bg-white p-5 shadow-card sm:p-6 dark:border-slate-700 dark:bg-slate-900"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-lga-blue dark:text-primary-300">
            Selected notification preview
          </p>
          <h2
            className="mt-1 break-words text-xl font-semibold text-lga-navy dark:text-white"
            id="notification-details-title"
          >
            {getPreviewTitle(notification)}
          </h2>
          <p className="mt-2 break-all font-mono text-xs text-text-muted dark:text-slate-400">
            {notification.notificationId}
          </p>
        </div>

        <button
          className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-lg border border-border bg-white px-4 py-2 text-sm font-semibold text-lga-navy transition-colors hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-lga-sky focus:ring-offset-2 dark:border-slate-600 dark:bg-slate-900 dark:text-white dark:hover:bg-slate-800"
          onClick={onClose}
          type="button"
        >
          Close preview
        </button>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <StatusBadge
          label={getChannelLabel(notification.channel)}
          showDot={false}
          tone={getChannelTone(notification.channel)}
        />
        <StatusBadge
          label={getTypeLabel(notification.type)}
          showDot={false}
          tone="info"
        />
        <StatusBadge
          showDot={false}
          status={notification.status}
          tone={getStatusTone(notification.status)}
        />
        <ReviewGateIndicator
          flags={flags}
          trackingId={notification.trackingId}
        />
      </div>

      <dl className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <DetailItem
          label="Recipient"
          value={notification.recipientMasked}
        />
        <DetailItem
          label="Template"
          value={notification.templateCode}
        />
        <DetailItem
          label="Partner"
          value={notification.partnerCode}
        />
        <DetailItem
          label="Created"
          value={formatDate(notification.createdAt)}
        />
        <DetailItem label="Tracking ID">
          {notification.trackingId ? (
            <MaskedValue
              kind={MASKED_VALUE_KINDS.RECORD_ID}
              value={notification.trackingId}
            />
          ) : (
            'Not linked'
          )}
        </DetailItem>
        <DetailItem
          label="Sent"
          value={formatDate(notification.sentAt)}
        />
        <DetailItem
          label="Delivery status"
          value={formatToken(notification.status)}
        />
        <DetailItem
          label="Review gate"
          value={
            flags?.carrierSubmissionBlocked
              ? 'Carrier submission blocked'
              : flags?.hasAgencyReviewCompletion
                ? 'Agency review complete'
                : 'No active review block'
          }
        />
      </dl>

      {notification.failureReason && (
        <div
          className="mt-5 rounded-lg border border-danger bg-danger-light p-4 text-sm text-danger-dark dark:border-red-800 dark:bg-red-950 dark:text-red-100"
          role="alert"
        >
          <p className="font-semibold">Delivery failure</p>
          <p className="mt-1">{notification.failureReason}</p>
        </div>
      )}

      {flags?.carrierSubmissionBlocked && (
        <div
          className="mt-5 rounded-lg border border-warning bg-warning-light p-4 text-sm text-warning-dark dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
          role="status"
        >
          <p className="font-semibold">Agency review is pending</p>
          <p className="mt-1 leading-6">
            A review request exists without a later completion event. Carrier
            submission remains blocked for this tracking record.
          </p>
        </div>
      )}

      {flags?.hasAgencyReviewCompletion &&
        !flags.carrierSubmissionBlocked && (
          <div
            className="mt-5 rounded-lg border border-success bg-success-light p-4 text-sm text-success-dark dark:border-green-800 dark:bg-green-950 dark:text-green-100"
            role="status"
          >
            <p className="font-semibold">Agency review is complete</p>
            <p className="mt-1 leading-6">
              The latest agency review completion clears the notification
              review gate.
            </p>
          </div>
        )}

      <div className="mt-6">
        <JsonViewer
          data={{
            notificationId: notification.notificationId,
            trackingId: notification.trackingId,
            partnerCode: notification.partnerCode,
            channel: notification.channel,
            type: notification.type,
            recipientMasked: notification.recipientMasked,
            templateCode: notification.templateCode,
            status: notification.status,
            previewPayload: notification.previewPayload,
            createdAt: notification.createdAt,
            sentAt: notification.sentAt ?? null,
            failureReason: notification.failureReason ?? null,
            reviewGate: flags ?? null,
          }}
          fileName={`notification-${notification.notificationId}.json`}
          initiallyExpanded
          redact
          title="Redacted notification payload"
        />
      </div>
    </section>
  );
}

NotificationDetails.propTypes = {
  flags: PropTypes.object,
  notification: PropTypes.object.isRequired,
  onClose: PropTypes.func.isRequired,
};

/**
 * Displays searchable role-visible notification previews, delivery logs, and
 * agency-review gating indicators.
 */
export function NotificationLogPage({
  notificationVisibilityService,
}) {
  const authState = useAuthStore();
  const principal = useMemo(
    () => createPrincipal(authState),
    [authState],
  );
  const authorized =
    authState.isAuthenticated &&
    canPerformAction(principal, PERMISSIONS.VIEW_NOTIFICATIONS);
  const service = useMemo(
    () =>
      notificationVisibilityService ??
      createNotificationVisibilityService({
        principal,
        partnerContext: authState.partnerContext,
        strictAudit: false,
      }),
    [
      authState.partnerContext,
      notificationVisibilityService,
      principal,
    ],
  );
  const [filters, setFilters] = useState({ ...DEFAULT_FILTERS });
  const [appliedFilters, setAppliedFilters] = useState({
    ...DEFAULT_FILTERS,
  });
  const [notifications, setNotifications] = useState([]);
  const [counts, setCounts] = useState({});
  const [reviewFlags, setReviewFlags] = useState({});
  const [selectedNotification, setSelectedNotification] =
    useState(null);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState('');
  const [gateWarning, setGateWarning] = useState('');
  const [lastRefreshedAt, setLastRefreshedAt] = useState(null);

  const loadNotifications = useCallback(async () => {
    if (!authorized) {
      setNotifications([]);
      setReviewFlags({});
      setLoading(false);
      return;
    }

    setLoading(true);
    setPageError('');
    setGateWarning('');

    try {
      const result = await Promise.resolve(
        service.search(
          createSearchRequest(appliedFilters),
          principal,
        ),
      );
      const records =
        result.notifications ?? result.records ?? result.data ?? [];

      if (!Array.isArray(records)) {
        throw new TypeError(
          'The notification service returned an invalid collection.',
        );
      }

      const nextReviewFlags = {};
      const trackingIds = [
        ...new Set(
          records
            .map((notification) => notification.trackingId)
            .filter(Boolean),
        ),
      ];
      const unavailableTrackingIds = [];

      for (const trackingId of trackingIds) {
        try {
          nextReviewFlags[trackingId] = await Promise.resolve(
            service.getVisibilityFlags(trackingId, principal, {
              partnerContext: authState.partnerContext,
            }),
          );
        } catch {
          unavailableTrackingIds.push(trackingId);
        }
      }

      setNotifications(records);
      setCounts(result.counts ?? {});
      setReviewFlags(nextReviewFlags);
      setSelectedNotification((currentNotification) => {
        if (!currentNotification) {
          return null;
        }

        return (
          records.find(
            (notification) =>
              notification.notificationId ===
              currentNotification.notificationId,
          ) ?? null
        );
      });
      setGateWarning(
        unavailableTrackingIds.length > 0
          ? `Review gating could not be resolved for ${unavailableTrackingIds.length} tracking record${
              unavailableTrackingIds.length === 1 ? '' : 's'
            }.`
          : '',
      );
      setLastRefreshedAt(new Date().toISOString());
    } catch (error) {
      setNotifications([]);
      setCounts({});
      setReviewFlags({});
      setSelectedNotification(null);
      setPageError(
        error instanceof Error && error.message
          ? error.message
          : 'The notification log could not be loaded.',
      );
    } finally {
      setLoading(false);
    }
  }, [
    appliedFilters,
    authState.partnerContext,
    authorized,
    principal,
    service,
  ]);

  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

  const summary = useMemo(() => {
    const blockedTrackingIds = new Set(
      Object.entries(reviewFlags)
        .filter(([, flags]) => flags.carrierSubmissionBlocked)
        .map(([trackingId]) => trackingId),
    );

    return {
      total: notifications.length,
      queued: notifications.filter(
        (notification) =>
          notification.status === NOTIFICATION_STATUSES.QUEUED,
      ).length,
      failed: notifications.filter(
        (notification) =>
          notification.status === NOTIFICATION_STATUSES.FAILED,
      ).length,
      reviewBlocked: blockedTrackingIds.size,
    };
  }, [notifications, reviewFlags]);

  const columns = useMemo(
    () => [
      {
        id: 'createdAt',
        header: 'Created',
        accessor: (notification) => notification.createdAt,
        render: (value) => (
          <time className="whitespace-nowrap" dateTime={value}>
            {formatDate(value)}
          </time>
        ),
      },
      {
        id: 'preview',
        header: 'Preview',
        accessor: (notification) => getPreviewTitle(notification),
        render: (value, notification) => (
          <div className="min-w-52">
            <p className="font-semibold text-text dark:text-white">
              {value}
            </p>
            <p className="mt-1 font-mono text-xs text-text-muted dark:text-slate-400">
              {notification.templateCode}
            </p>
          </div>
        ),
      },
      {
        id: 'channel',
        header: 'Channel',
        accessor: (notification) => notification.channel,
        render: (value) => (
          <StatusBadge
            label={getChannelLabel(value)}
            showDot={false}
            size="sm"
            tone={getChannelTone(value)}
          />
        ),
      },
      {
        id: 'type',
        header: 'Type',
        accessor: (notification) => notification.type,
        render: (value) => (
          <span className="text-sm text-text dark:text-slate-200">
            {getTypeLabel(value)}
          </span>
        ),
      },
      {
        id: 'recipient',
        header: 'Recipient',
        accessor: (notification) => notification.recipientMasked,
        render: (value) => (
          <span className="break-all font-mono text-xs text-text dark:text-slate-200">
            {value}
          </span>
        ),
      },
      {
        id: 'status',
        header: 'Status',
        accessor: (notification) => notification.status,
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
        id: 'reviewGate',
        header: 'Review gate',
        accessor: (notification) => notification.trackingId,
        sortable: false,
        render: (trackingId) => (
          <ReviewGateIndicator
            flags={trackingId ? reviewFlags[trackingId] : undefined}
            trackingId={trackingId}
          />
        ),
      },
    ],
    [reviewFlags],
  );

  const channelOptions = useMemo(
    () => [
      { label: 'All channels', value: '' },
      ...Object.values(NOTIFICATION_CHANNELS).map((channel) => ({
        label: getChannelLabel(channel),
        value: channel,
      })),
    ],
    [],
  );
  const typeOptions = useMemo(
    () => [
      { label: 'All notification types', value: '' },
      ...Object.values(NOTIFICATION_TYPES).map((type) => ({
        label: getTypeLabel(type),
        value: type,
      })),
    ],
    [],
  );
  const statusOptions = useMemo(
    () => [
      { label: 'All statuses', value: '' },
      ...Object.values(NOTIFICATION_STATUSES).map((status) => ({
        label: formatToken(status),
        value: status,
      })),
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
    setAppliedFilters({ ...filters });
    setSelectedNotification(null);
  };

  const resetFilters = () => {
    setFilters({ ...DEFAULT_FILTERS });
    setAppliedFilters({ ...DEFAULT_FILTERS });
    setSelectedNotification(null);
    setPageError('');
    setGateWarning('');
  };

  if (!authorized) {
    return (
      <section
        aria-labelledby="notification-log-denied-title"
        className="mx-auto max-w-3xl rounded-xl border border-danger bg-danger-light p-6 text-danger-dark shadow-card dark:border-red-700 dark:bg-danger-dark dark:text-red-100"
        role="alert"
      >
        <h1
          className="text-xl font-semibold"
          id="notification-log-denied-title"
        >
          Notification log access is unavailable
        </h1>
        <p className="mt-2 text-sm leading-6">
          An authenticated role with notification visibility is required to
          review message previews and delivery logs.
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
                label="Notification logs"
                showDot={false}
                tone="accent"
              />
              <StatusBadge
                label="Role visible"
                showDot={false}
                tone="info"
              />
              <StatusBadge label="Simulation" showDot={false} simulation />
            </div>
            <h1 className="mt-4 text-2xl font-semibold sm:text-3xl">
              Notification previews and delivery history
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-primary-100 sm:text-base">
              Search role-visible email, SMS, in-app, reminder, welcome,
              agency-copy, status, and review notification previews. Review
              gating indicators identify tracking records with an outstanding
              agency review.
            </p>
          </div>

          <button
            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-white/50 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-lga-navy disabled:cursor-not-allowed disabled:opacity-50"
            disabled={loading}
            onClick={loadNotifications}
            type="button"
          >
            {loading ? 'Refreshing…' : 'Refresh logs'}
          </button>
        </div>
      </header>

      <aside
        className="rounded-xl border border-accent-300 bg-accent-100 p-4 text-sm leading-6 text-accent-950 dark:border-accent-700 dark:bg-accent-950 dark:text-accent-100"
        role="note"
      >
        Messages are simulated previews and are not delivered to real
        recipients. Recipient values are already masked, and downloaded
        payloads are redacted. Use synthetic data only.
      </aside>

      {pageError && (
        <div
          className="rounded-xl border border-danger bg-danger-light p-4 text-sm text-danger-dark dark:border-red-700 dark:bg-danger-dark dark:text-red-100"
          role="alert"
        >
          <p className="font-semibold">Notification logs are unavailable</p>
          <p className="mt-1">{pageError}</p>
          <button
            className="mt-4 inline-flex min-h-10 items-center justify-center rounded-lg border border-danger px-4 py-2 text-sm font-semibold transition-colors hover:bg-white/50 focus:outline-none focus:ring-2 focus:ring-danger focus:ring-offset-2 dark:hover:bg-red-950"
            onClick={loadNotifications}
            type="button"
          >
            Try again
          </button>
        </div>
      )}

      {gateWarning && (
        <div
          className="rounded-xl border border-warning bg-warning-light p-4 text-sm text-warning-dark dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
          role="status"
        >
          {gateWarning}
        </div>
      )}

      <section aria-labelledby="notification-summary-title">
        <div>
          <h2
            className="text-xl font-semibold text-lga-navy dark:text-white"
            id="notification-summary-title"
          >
            Log summary
          </h2>
          <p className="mt-1 text-sm text-text-muted dark:text-slate-300">
            Counts reflect the current role, partner scope, and applied
            filters.
          </p>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryCard
            description="Notification previews matching the current filters."
            label="Visible logs"
            tone="info"
            value={summary.total}
          />
          <SummaryCard
            description="Messages waiting in the simulated delivery queue."
            label="Queued"
            tone="warning"
            value={summary.queued}
          />
          <SummaryCard
            description="Simulated message delivery failures."
            label="Failed"
            tone="danger"
            value={summary.failed}
          />
          <SummaryCard
            description="Tracking records blocked by pending agency review."
            label="Review blocked"
            tone={summary.reviewBlocked > 0 ? 'warning' : 'success'}
            value={summary.reviewBlocked}
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
            Notification filters
          </h2>
          <p className="mt-1 text-sm text-text-muted dark:text-slate-300">
            Search preview text and filter by tracking record, partner,
            channel, type, or delivery status.
          </p>
        </div>

        <fieldset
          className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3 sm:p-6"
          disabled={loading}
        >
          <legend className="sr-only">Notification log filters</legend>

          <div className="sm:col-span-2 lg:col-span-3">
            <label
              className="block text-sm font-medium text-text dark:text-slate-100"
              htmlFor="notification-search"
            >
              Search notification previews
            </label>
            <input
              className="mt-1 min-h-11 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text shadow-sm placeholder:text-slate-400 focus:border-lga-sky focus:outline-none focus:ring-2 focus:ring-lga-sky disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
              id="notification-search"
              onChange={(event) =>
                updateFilter('search', event.target.value)
              }
              placeholder="Search recipient, template, preview text, or notification ID"
              value={filters.search}
            />
          </div>

          <div>
            <label
              className="block text-sm font-medium text-text dark:text-slate-100"
              htmlFor="notification-tracking-id"
            >
              Tracking ID
            </label>
            <input
              className="mt-1 min-h-11 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text shadow-sm placeholder:text-slate-400 focus:border-lga-sky focus:outline-none focus:ring-2 focus:ring-lga-sky disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
              id="notification-tracking-id"
              onChange={(event) =>
                updateFilter('trackingId', event.target.value)
              }
              placeholder="TRK-DEMO-1006"
              value={filters.trackingId}
            />
          </div>

          <div>
            <label
              className="block text-sm font-medium text-text dark:text-slate-100"
              htmlFor="notification-partner-code"
            >
              Partner code
            </label>
            <input
              className="mt-1 min-h-11 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text shadow-sm placeholder:text-slate-400 focus:border-lga-sky focus:outline-none focus:ring-2 focus:ring-lga-sky disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
              id="notification-partner-code"
              onChange={(event) =>
                updateFilter('partnerCode', event.target.value)
              }
              placeholder="QUILITY"
              value={filters.partnerCode}
            />
          </div>

          <FilterSelect
            disabled={loading}
            id="notification-channel"
            label="Channel"
            onChange={(event) =>
              updateFilter('channel', event.target.value)
            }
            options={channelOptions}
            value={filters.channel}
          />

          <FilterSelect
            disabled={loading}
            id="notification-type"
            label="Notification type"
            onChange={(event) =>
              updateFilter('type', event.target.value)
            }
            options={typeOptions}
            value={filters.type}
          />

          <FilterSelect
            disabled={loading}
            id="notification-status"
            label="Delivery status"
            onChange={(event) =>
              updateFilter('status', event.target.value)
            }
            options={statusOptions}
            value={filters.status}
          />
        </fieldset>

        <div className="flex flex-col gap-3 border-t border-border bg-surface-muted px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 dark:border-slate-700 dark:bg-slate-800">
          <p className="text-xs text-text-muted dark:text-slate-400">
            {counts[NOTIFICATION_STATUSES.QUEUED] ?? 0} queued and{' '}
            {counts[NOTIFICATION_STATUSES.FAILED] ?? 0} failed in the scoped
            result set.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
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
        </div>
      </form>

      {selectedNotification && (
        <NotificationDetails
          flags={
            selectedNotification.trackingId
              ? reviewFlags[selectedNotification.trackingId]
              : undefined
          }
          notification={selectedNotification}
          onClose={() => setSelectedNotification(null)}
        />
      )}

      <section aria-labelledby="notification-results-title">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2
              className="text-xl font-semibold text-lga-navy dark:text-white"
              id="notification-results-title"
            >
              Role-visible notification logs
            </h2>
            <p className="mt-1 text-sm leading-6 text-text-muted dark:text-slate-300">
              Select a row to inspect its redacted preview payload and review
              gate state.
            </p>
          </div>
          <StatusBadge
            label={`${notifications.length} notification${
              notifications.length === 1 ? '' : 's'
            }`}
            showDot={false}
            tone={notifications.length > 0 ? 'info' : 'neutral'}
          />
        </div>

        <DataTable
          aria-label="Role-visible notification preview logs"
          columns={columns}
          data={notifications}
          defaultPageSize={25}
          defaultSortBy="createdAt"
          defaultSortDirection="desc"
          emptyMessage="No notification previews matched the current filters."
          getRowId={(notification) => notification.notificationId}
          loading={loading}
          loadingMessage="Loading role-visible notification previews…"
          onRowClick={(notification) =>
            setSelectedNotification(notification)
          }
          pageSizeOptions={[10, 25, 50, 100]}
        />
      </section>
    </div>
  );
}

NotificationLogPage.propTypes = {
  notificationVisibilityService: PropTypes.shape({
    getVisibilityFlags: PropTypes.func.isRequired,
    search: PropTypes.func.isRequired,
  }),
};

export default NotificationLogPage;