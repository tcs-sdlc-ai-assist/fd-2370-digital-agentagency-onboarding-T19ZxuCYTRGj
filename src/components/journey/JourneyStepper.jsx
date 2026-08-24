import PropTypes from 'prop-types';

export const JOURNEY_STEP_STATUSES = Object.freeze({
  COMPLETE: 'complete',
  CURRENT: 'current',
  SKIPPED: 'skipped',
  UPCOMING: 'upcoming',
});

const STATUS_LABELS = Object.freeze({
  [JOURNEY_STEP_STATUSES.COMPLETE]: 'Completed',
  [JOURNEY_STEP_STATUSES.CURRENT]: 'Current step',
  [JOURNEY_STEP_STATUSES.SKIPPED]: 'Skipped',
  [JOURNEY_STEP_STATUSES.UPCOMING]: 'Not started',
});

const INDICATOR_CLASSES = Object.freeze({
  [JOURNEY_STEP_STATUSES.COMPLETE]:
    'border-success bg-success text-white dark:border-green-400 dark:bg-green-700',
  [JOURNEY_STEP_STATUSES.CURRENT]:
    'border-lga-sky bg-lga-navy text-white ring-4 ring-primary-100 dark:border-primary-300 dark:bg-primary-700 dark:ring-primary-950',
  [JOURNEY_STEP_STATUSES.SKIPPED]:
    'border-slate-400 bg-slate-100 text-slate-600 dark:border-slate-500 dark:bg-slate-800 dark:text-slate-300',
  [JOURNEY_STEP_STATUSES.UPCOMING]:
    'border-border-strong bg-white text-text-muted dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300',
});

const TITLE_CLASSES = Object.freeze({
  [JOURNEY_STEP_STATUSES.COMPLETE]:
    'text-success-dark dark:text-green-200',
  [JOURNEY_STEP_STATUSES.CURRENT]:
    'text-lga-navy dark:text-primary-100',
  [JOURNEY_STEP_STATUSES.SKIPPED]:
    'text-text-muted dark:text-slate-400',
  [JOURNEY_STEP_STATUSES.UPCOMING]:
    'text-text dark:text-slate-200',
});

function normalizeIdentifier(value) {
  if (
    value === null ||
    value === undefined ||
    String(value).trim() === ''
  ) {
    return undefined;
  }

  return String(value).trim();
}

function normalizeStatus(value) {
  const status = normalizeIdentifier(value)
    ?.normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_');

  if (['active', 'current', 'in_progress'].includes(status)) {
    return JOURNEY_STEP_STATUSES.CURRENT;
  }

  if (['complete', 'completed', 'done'].includes(status)) {
    return JOURNEY_STEP_STATUSES.COMPLETE;
  }

  if (['skip', 'skipped', 'not_applicable'].includes(status)) {
    return JOURNEY_STEP_STATUSES.SKIPPED;
  }

  return JOURNEY_STEP_STATUSES.UPCOMING;
}

function normalizeIdentifierSet(values) {
  if (!Array.isArray(values)) {
    return new Set();
  }

  return new Set(values.map(normalizeIdentifier).filter(Boolean));
}

function getStepId(step, index) {
  return normalizeIdentifier(step.id ?? step.stepId ?? step.key) ??
    `journey-step-${index + 1}`;
}

function getStepTitle(step, index) {
  return step.title ?? step.label ?? step.name ?? `Step ${index + 1}`;
}

function resolveStepStatus(
  step,
  stepId,
  currentStepId,
  completedStepIds,
  skippedStepIds,
) {
  if (
    step.current === true ||
    step.active === true ||
    stepId === currentStepId
  ) {
    return JOURNEY_STEP_STATUSES.CURRENT;
  }

  if (step.skipped === true || skippedStepIds.has(stepId)) {
    return JOURNEY_STEP_STATUSES.SKIPPED;
  }

  if (step.completed === true || completedStepIds.has(stepId)) {
    return JOURNEY_STEP_STATUSES.COMPLETE;
  }

  return normalizeStatus(step.status);
}

function StepIndicator({ index, status }) {
  if (status === JOURNEY_STEP_STATUSES.COMPLETE) {
    return (
      <span aria-hidden="true" className="text-base font-bold">
        ✓
      </span>
    );
  }

  if (status === JOURNEY_STEP_STATUSES.SKIPPED) {
    return (
      <span aria-hidden="true" className="text-sm font-bold">
        —
      </span>
    );
  }

  return (
    <span aria-hidden="true" className="text-sm font-bold">
      {index + 1}
    </span>
  );
}

StepIndicator.propTypes = {
  index: PropTypes.number.isRequired,
  status: PropTypes.oneOf(Object.values(JOURNEY_STEP_STATUSES))
    .isRequired,
};

function StepContent({
  compact,
  description,
  index,
  status,
  title,
  totalSteps,
}) {
  return (
    <span className="min-w-0 flex-1">
      <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span
          className={`font-semibold ${TITLE_CLASSES[status]} ${
            compact ? 'text-sm' : 'text-base'
          }`.trim()}
        >
          {title}
        </span>
        <span className="text-xs text-text-muted dark:text-slate-400">
          Step {index + 1} of {totalSteps}
        </span>
      </span>

      {!compact &&
        description !== null &&
        description !== undefined &&
        description !== '' && (
          <span className="mt-1 block text-sm leading-5 text-text-muted dark:text-slate-400">
            {description}
          </span>
        )}

      <span className="sr-only">{STATUS_LABELS[status]}</span>
    </span>
  );
}

StepContent.propTypes = {
  compact: PropTypes.bool.isRequired,
  description: PropTypes.node,
  index: PropTypes.number.isRequired,
  status: PropTypes.oneOf(Object.values(JOURNEY_STEP_STATUSES))
    .isRequired,
  title: PropTypes.node.isRequired,
  totalSteps: PropTypes.number.isRequired,
};

/**
 * Displays accessible progress for active, completed, skipped, and current
 * guided-journey steps.
 */
export function JourneyStepper({
  'aria-label': ariaLabel = 'Journey progress',
  className = '',
  compact = false,
  completedSteps = [],
  currentStepId,
  onStepClick,
  skippedSteps = [],
  steps,
  title = null,
}) {
  const completedStepIds = normalizeIdentifierSet(completedSteps);
  const skippedStepIds = normalizeIdentifierSet(skippedSteps);
  const normalizedCurrentStepId = normalizeIdentifier(currentStepId);
  const resolvedSteps = steps.map((step, index) => {
    const stepId = getStepId(step, index);

    return {
      step,
      stepId,
      status: resolveStepStatus(
        step,
        stepId,
        normalizedCurrentStepId,
        completedStepIds,
        skippedStepIds,
      ),
    };
  });
  const applicableStepCount = resolvedSteps.filter(
    ({ status }) => status !== JOURNEY_STEP_STATUSES.SKIPPED,
  ).length;
  const completedStepCount = resolvedSteps.filter(
    ({ status }) => status === JOURNEY_STEP_STATUSES.COMPLETE,
  ).length;
  const progressPercent =
    applicableStepCount === 0
      ? 0
      : Math.min(
          100,
          Math.round(
            (completedStepCount / applicableStepCount) * 100,
          ),
        );

  return (
    <nav
      aria-label={ariaLabel}
      className={`w-full ${className}`.trim()}
    >
      {title && (
        <h2 className="mb-4 text-lg font-semibold text-lga-navy dark:text-white">
          {title}
        </h2>
      )}

      <p className="sr-only" role="status">
        {completedStepCount} of {applicableStepCount} applicable steps
        completed. {progressPercent}% complete.
      </p>

      <ol className="m-0 list-none p-0">
        {resolvedSteps.map(({ status, step, stepId }, index) => {
          const stepTitle = getStepTitle(step, index);
          const disabled = step.disabled === true;
          const interactive =
            typeof onStepClick === 'function' && !disabled;
          const isLast = index === resolvedSteps.length - 1;
          const content = (
            <>
              <span
                aria-hidden="true"
                className={`relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full border-2 ${INDICATOR_CLASSES[status]}`}
              >
                <StepIndicator index={index} status={status} />
              </span>

              <StepContent
                compact={compact}
                description={step.description}
                index={index}
                status={status}
                title={stepTitle}
                totalSteps={resolvedSteps.length}
              />
            </>
          );

          return (
            <li
              className={`relative flex gap-3 ${
                isLast ? '' : compact ? 'pb-4' : 'pb-6'
              }`.trim()}
              data-step-id={stepId}
              data-step-status={status}
              key={stepId}
            >
              {!isLast && (
                <span
                  aria-hidden="true"
                  className="absolute bottom-0 left-[0.9375rem] top-8 w-px bg-border dark:bg-slate-700"
                />
              )}

              {interactive ? (
                <button
                  aria-current={
                    status === JOURNEY_STEP_STATUSES.CURRENT
                      ? 'step'
                      : undefined
                  }
                  aria-label={`${String(stepTitle)}, step ${index + 1} of ${
                    resolvedSteps.length
                  }, ${STATUS_LABELS[status]}`}
                  className="relative z-10 flex min-h-11 w-full items-start gap-3 rounded-lg text-left transition-colors hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-lga-sky focus:ring-offset-2 dark:hover:bg-slate-800 dark:focus:ring-offset-slate-950"
                  onClick={(event) =>
                    onStepClick(step, index, event)
                  }
                  type="button"
                >
                  {content}
                </button>
              ) : (
                <div
                  aria-current={
                    status === JOURNEY_STEP_STATUSES.CURRENT
                      ? 'step'
                      : undefined
                  }
                  className="relative z-10 flex min-h-11 w-full items-start gap-3"
                >
                  {content}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

JourneyStepper.propTypes = {
  'aria-label': PropTypes.string,
  className: PropTypes.string,
  compact: PropTypes.bool,
  completedSteps: PropTypes.arrayOf(PropTypes.string),
  currentStepId: PropTypes.string,
  onStepClick: PropTypes.func,
  skippedSteps: PropTypes.arrayOf(PropTypes.string),
  steps: PropTypes.arrayOf(
    PropTypes.shape({
      active: PropTypes.bool,
      completed: PropTypes.bool,
      current: PropTypes.bool,
      description: PropTypes.node,
      disabled: PropTypes.bool,
      id: PropTypes.string,
      key: PropTypes.string,
      label: PropTypes.node,
      name: PropTypes.node,
      skipped: PropTypes.bool,
      status: PropTypes.string,
      stepId: PropTypes.string,
      title: PropTypes.node,
    }),
  ).isRequired,
  title: PropTypes.node,
};

export default JourneyStepper;