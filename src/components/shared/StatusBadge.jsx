import PropTypes from 'prop-types';

export const STATUS_BADGE_KINDS = Object.freeze({
  STATUS: 'status',
  SEVERITY: 'severity',
  SOURCE_SYSTEM: 'source-system',
  SIMULATION: 'simulation',
});

export const STATUS_BADGE_TONES = Object.freeze({
  NEUTRAL: 'neutral',
  INFO: 'info',
  SUCCESS: 'success',
  WARNING: 'warning',
  DANGER: 'danger',
  ACCENT: 'accent',
});

const TONE_CLASSES = Object.freeze({
  [STATUS_BADGE_TONES.NEUTRAL]:
    'border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200',
  [STATUS_BADGE_TONES.INFO]:
    'border-primary-200 bg-info-light text-info-dark dark:border-primary-700 dark:bg-primary-950 dark:text-primary-100',
  [STATUS_BADGE_TONES.SUCCESS]:
    'border-green-200 bg-success-light text-success-dark dark:border-green-800 dark:bg-green-950 dark:text-green-100',
  [STATUS_BADGE_TONES.WARNING]:
    'border-amber-300 bg-warning-light text-warning-dark dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100',
  [STATUS_BADGE_TONES.DANGER]:
    'border-red-200 bg-danger-light text-danger-dark dark:border-red-800 dark:bg-red-950 dark:text-red-100',
  [STATUS_BADGE_TONES.ACCENT]:
    'border-accent-300 bg-accent-100 text-accent-950 dark:border-accent-700 dark:bg-accent-950 dark:text-accent-100',
});

const DOT_CLASSES = Object.freeze({
  [STATUS_BADGE_TONES.NEUTRAL]: 'bg-slate-500 dark:bg-slate-300',
  [STATUS_BADGE_TONES.INFO]: 'bg-info dark:bg-primary-300',
  [STATUS_BADGE_TONES.SUCCESS]: 'bg-success dark:bg-green-300',
  [STATUS_BADGE_TONES.WARNING]: 'bg-warning dark:bg-amber-300',
  [STATUS_BADGE_TONES.DANGER]: 'bg-danger dark:bg-red-300',
  [STATUS_BADGE_TONES.ACCENT]: 'bg-accent-600 dark:bg-accent-300',
});

const SIZE_CLASSES = Object.freeze({
  sm: 'min-h-6 px-2 py-0.5 text-xs',
  md: 'min-h-7 px-2.5 py-1 text-xs',
  lg: 'min-h-8 px-3 py-1 text-sm',
});

const SOURCE_SYSTEM_LABELS = Object.freeze({
  agent_db: 'Agent DB',
  ali: 'ALI',
  big: 'BIG',
  docusign: 'DocuSign',
  dtcc: 'DTCC',
  ethos: 'Ethos',
  giact: 'GIACT',
  horizon: 'Horizon',
  lifepro: 'LifePro',
  limra: 'LIMRA',
  nipr: 'NIPR',
  reged: 'RegEd',
  sircon: 'Sircon',
  sircon_vertafore: 'Sircon / Vertafore',
  verta_fore: 'Vertafore',
  vertafore: 'Vertafore',
  verint: 'Verint',
});

const SUCCESS_VALUES = new Set([
  'accepted',
  'active',
  'approved',
  'complete',
  'completed',
  'contracted',
  'delivered',
  'eligible',
  'read',
  'resolved',
  'sent',
  'signed',
  'success',
  'verified',
]);

const WARNING_VALUES = new Set([
  'action_needed',
  'action_required',
  'manual_review',
  'manual_routed',
  'pending',
  'queued',
  'review',
  'submitted',
  'under_review',
  'warning',
]);

const DANGER_VALUES = new Set([
  'blocked',
  'blocking',
  'cancelled',
  'declined',
  'error',
  'expired',
  'failed',
  'high',
  'inactive',
  'ineligible',
  'rejected',
  'suspended',
  'terminated',
]);

const INFO_VALUES = new Set([
  'application_started',
  'draft',
  'in_progress',
  'in_review',
  'info',
  'new',
  'previewed',
  'processing',
]);

function normalizeToken(value) {
  if (
    value === null ||
    value === undefined ||
    String(value).trim() === ''
  ) {
    return '';
  }

  return String(value)
    .trim()
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function formatLabel(value) {
  const normalizedValue = String(value ?? '').trim();

  if (normalizedValue === '') {
    return 'Status unavailable';
  }

  return normalizedValue
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function getSourceSystemLabel(value) {
  const token = normalizeToken(value);

  return SOURCE_SYSTEM_LABELS[token] ?? formatLabel(value);
}

function resolveKind({
  kind,
  severity,
  simulation,
  sourceSystem,
}) {
  if (simulation !== false && simulation !== null) {
    return STATUS_BADGE_KINDS.SIMULATION;
  }

  if (sourceSystem !== null && sourceSystem !== undefined) {
    return STATUS_BADGE_KINDS.SOURCE_SYSTEM;
  }

  if (severity !== null && severity !== undefined) {
    return STATUS_BADGE_KINDS.SEVERITY;
  }

  return kind;
}

function resolveValue({
  kind,
  severity,
  simulation,
  sourceSystem,
  status,
  value,
}) {
  if (kind === STATUS_BADGE_KINDS.SIMULATION) {
    return typeof simulation === 'string' ? simulation : 'Simulation';
  }

  if (kind === STATUS_BADGE_KINDS.SOURCE_SYSTEM) {
    return sourceSystem ?? value ?? 'Source system';
  }

  if (kind === STATUS_BADGE_KINDS.SEVERITY) {
    return severity ?? value ?? 'Severity';
  }

  return status ?? value ?? 'Status unavailable';
}

function resolveTone(kind, value, tone) {
  if (tone) {
    return tone;
  }

  if (kind === STATUS_BADGE_KINDS.SIMULATION) {
    return STATUS_BADGE_TONES.ACCENT;
  }

  if (kind === STATUS_BADGE_KINDS.SOURCE_SYSTEM) {
    return STATUS_BADGE_TONES.INFO;
  }

  const token = normalizeToken(value);

  if (SUCCESS_VALUES.has(token)) {
    return STATUS_BADGE_TONES.SUCCESS;
  }

  if (WARNING_VALUES.has(token)) {
    return STATUS_BADGE_TONES.WARNING;
  }

  if (DANGER_VALUES.has(token)) {
    return STATUS_BADGE_TONES.DANGER;
  }

  if (INFO_VALUES.has(token)) {
    return STATUS_BADGE_TONES.INFO;
  }

  return STATUS_BADGE_TONES.NEUTRAL;
}

function resolveLabel(kind, value, label) {
  if (label !== null && label !== undefined) {
    return label;
  }

  if (kind === STATUS_BADGE_KINDS.SOURCE_SYSTEM) {
    return getSourceSystemLabel(value);
  }

  return formatLabel(value);
}

/**
 * Displays an accessible status, severity, source-system, or simulation
 * indicator.
 */
export function StatusBadge({
  'aria-label': ariaLabel,
  children,
  className = '',
  kind = STATUS_BADGE_KINDS.STATUS,
  label,
  role = 'status',
  severity = null,
  showDot = true,
  simulation = false,
  size = 'md',
  sourceSystem = null,
  status = null,
  title,
  tone = null,
  value = null,
}) {
  const resolvedKind = resolveKind({
    kind,
    severity,
    simulation,
    sourceSystem,
  });
  const resolvedValue = resolveValue({
    kind: resolvedKind,
    severity,
    simulation,
    sourceSystem,
    status,
    value,
  });
  const resolvedTone = resolveTone(
    resolvedKind,
    resolvedValue,
    tone,
  );
  const resolvedLabel = resolveLabel(
    resolvedKind,
    resolvedValue,
    label,
  );
  const content =
    children === null || children === undefined
      ? resolvedLabel
      : children;
  const accessibleLabel =
    ariaLabel ??
    (typeof content === 'string'
      ? content
      : `${formatLabel(resolvedKind)}: ${resolvedLabel}`);

  return (
    <span
      aria-label={accessibleLabel}
      className={`inline-flex max-w-full items-center gap-1.5 rounded-full border font-semibold leading-none ${SIZE_CLASSES[size]} ${TONE_CLASSES[resolvedTone]} ${className}`.trim()}
      data-badge-kind={resolvedKind}
      data-badge-tone={resolvedTone}
      role={role}
      title={title}
    >
      {showDot && (
        <span
          aria-hidden="true"
          className={`size-1.5 shrink-0 rounded-full ${DOT_CLASSES[resolvedTone]}`}
        />
      )}
      <span className="truncate">{content}</span>
    </span>
  );
}

StatusBadge.propTypes = {
  'aria-label': PropTypes.string,
  children: PropTypes.node,
  className: PropTypes.string,
  kind: PropTypes.oneOf(Object.values(STATUS_BADGE_KINDS)),
  label: PropTypes.node,
  role: PropTypes.string,
  severity: PropTypes.string,
  showDot: PropTypes.bool,
  simulation: PropTypes.oneOfType([
    PropTypes.bool,
    PropTypes.string,
  ]),
  size: PropTypes.oneOf(['sm', 'md', 'lg']),
  sourceSystem: PropTypes.string,
  status: PropTypes.string,
  title: PropTypes.string,
  tone: PropTypes.oneOf(Object.values(STATUS_BADGE_TONES)),
  value: PropTypes.oneOfType([
    PropTypes.string,
    PropTypes.number,
  ]),
};

export default StatusBadge;