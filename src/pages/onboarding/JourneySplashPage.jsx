import { useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { useLocation, useNavigate } from 'react-router-dom';
import { canPerformAction } from '../../auth/permissionPolicy.js';
import StatusBadge from '../../components/shared/StatusBadge.jsx';
import { PERMISSIONS } from '../../constants/roles.js';
import { getJourneyRoute } from '../../constants/routes.js';
import {
  getActiveJourneySteps,
  getJourneyDefinition,
  inferJourneyType,
  JOURNEY_STEP_IDS,
  JOURNEY_TYPES,
} from '../../services/onboarding/journeyDefinitions.js';
import {
  createJourneyService,
  DEFAULT_JOURNEY_PARTNER_CODE,
} from '../../services/onboarding/journeyService.js';
import { useAuthStore } from '../../stores/authStore.js';

const PATH_JOURNEY_TYPES = Object.freeze({
  'agent-contracting': JOURNEY_TYPES.AGENT_CONTRACTING,
  'registered-representative': JOURNEY_TYPES.REGISTERED_REP,
  corporate: JOURNEY_TYPES.CORPORATE,
  'ga-agency': JOURNEY_TYPES.GA_AGENCY,
  'financial-institution': JOURNEY_TYPES.FINANCIAL_INSTITUTION,
});

const DEFAULT_HELP_ITEMS = Object.freeze([
  'You can save your progress and return to the journey later.',
  'Information already supplied by an intake source is prefilled for review.',
  'Validation feedback identifies information that must be corrected before submission.',
  'Use synthetic identities, licensing, banking, and contact information only.',
]);

const SUMMARY_FIELDS = Object.freeze([
  {
    label: 'Company',
    paths: ['company', 'carrierCode'],
  },
  {
    label: 'General agency',
    paths: ['gaCode', 'hierarchy.gaCode'],
  },
  {
    label: 'Agency',
    paths: ['agency.name', 'organization.legalName'],
  },
  {
    label: 'Contract type',
    paths: ['contract.type', 'contractType'],
  },
  {
    label: 'Residence state',
    paths: [
      'agent.residenceState',
      'applicant.residenceState',
      'licensing.residentState',
    ],
  },
  {
    label: 'Source',
    paths: [
      'sourceMetadata.sourceChannel',
      'sourceChannel',
      'sourceMetadata.sourceFormat',
      'sourceFormat',
    ],
  },
]);

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

function getValueAtPath(value, path) {
  return path.split('.').reduce((currentValue, segment) => {
    if (currentValue === null || currentValue === undefined) {
      return undefined;
    }

    return currentValue[segment];
  }, value);
}

function hasMeaningfulValue(value) {
  if (value === null || value === undefined) {
    return false;
  }

  if (typeof value === 'string') {
    return value.trim() !== '';
  }

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  if (isObject(value)) {
    return Object.keys(value).length > 0;
  }

  return true;
}

function getFirstValue(value, paths) {
  for (const path of paths) {
    const candidate = getValueAtPath(value, path);

    if (hasMeaningfulValue(candidate)) {
      return candidate;
    }
  }

  return undefined;
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

function getJourneyTypeFromPath(pathname) {
  const segment = String(pathname ?? '')
    .split('/')
    .filter(Boolean)
    .at(-1);

  return PATH_JOURNEY_TYPES[segment];
}

function resolveJourneyType(journeyType, application, pathname) {
  if (journeyType) {
    return journeyType;
  }

  const pathJourneyType = getJourneyTypeFromPath(pathname);

  if (pathJourneyType) {
    return pathJourneyType;
  }

  if (isObject(application) && Object.keys(application).length > 0) {
    try {
      return inferJourneyType(application);
    } catch {
      return JOURNEY_TYPES.AGENT_CONTRACTING;
    }
  }

  return JOURNEY_TYPES.AGENT_CONTRACTING;
}

function resolveJourneyDefinition(journeyType) {
  try {
    return getJourneyDefinition(journeyType);
  } catch {
    return getJourneyDefinition(JOURNEY_TYPES.AGENT_CONTRACTING);
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

function getPartnerCode(application, authState) {
  return (
    application.partnerCode ??
    application.sourceMetadata?.partnerCode ??
    authState.partnerContext?.partnerCode ??
    authState.partnerContext?.partnerId ??
    DEFAULT_JOURNEY_PARTNER_CODE
  );
}

function countProvidedFields(value, ancestors = new WeakSet()) {
  if (value === null || value === undefined || value === '') {
    return 0;
  }

  if (Array.isArray(value)) {
    if (ancestors.has(value)) {
      return 0;
    }

    ancestors.add(value);
    const count = value.reduce(
      (total, item) => total + countProvidedFields(item, ancestors),
      0,
    );

    ancestors.delete(value);
    return count;
  }

  if (isObject(value)) {
    if (ancestors.has(value)) {
      return 0;
    }

    ancestors.add(value);
    const count = Object.values(value).reduce(
      (total, nestedValue) =>
        total + countProvidedFields(nestedValue, ancestors),
      0,
    );

    ancestors.delete(value);
    return count;
  }

  return 1;
}

function buildPrefillSummary(application) {
  return SUMMARY_FIELDS.flatMap((field) => {
    const value = getFirstValue(application, field.paths);

    if (!hasMeaningfulValue(value) || typeof value === 'object') {
      return [];
    }

    return [
      {
        label: field.label,
        value: formatToken(value),
      },
    ];
  });
}

function getPrefilledStepIds(steps, application) {
  return new Set(
    steps
      .filter(
        (step) =>
          step.requiredFields.length > 0 &&
          step.requiredFields.every((field) =>
            hasMeaningfulValue(getValueAtPath(application, field)),
          ),
      )
      .map((step) => step.id),
  );
}

function getExpectedSteps(definition, application) {
  try {
    return getActiveJourneySteps(application, {
      journeyType: definition.type,
      skipPrefilled: false,
    }).filter(
      (step) =>
        step.id !== JOURNEY_STEP_IDS.START &&
        step.id !== JOURNEY_STEP_IDS.COMPLETE,
    );
  } catch {
    return definition.steps.filter(
      (step) =>
        step.id !== JOURNEY_STEP_IDS.START &&
        step.id !== JOURNEY_STEP_IDS.COMPLETE,
    );
  }
}

function resolveTrackingId(resumeContext, explicitTrackingId) {
  return (
    explicitTrackingId ??
    resumeContext?.trackingId ??
    resumeContext?.applicationId ??
    null
  );
}

function navigateToJourney(navigate, result, fallbackTrackingId) {
  const trackingId =
    result?.trackingId ??
    result?.draft?.trackingId ??
    result?.resumeContext?.trackingId ??
    fallbackTrackingId;

  if (!trackingId) {
    return;
  }

  navigate(getJourneyRoute(trackingId), {
    state: {
      journey: cloneValue(result ?? null),
      trackingId,
    },
  });
}

function SummaryItem({ label, value }) {
  return (
    <div className="rounded-lg bg-surface-muted px-4 py-3 dark:bg-slate-800">
      <dt className="text-xs font-medium uppercase tracking-wide text-text-muted dark:text-slate-400">
        {label}
      </dt>
      <dd className="mt-1 break-words text-sm font-semibold text-text dark:text-white">
        {value}
      </dd>
    </div>
  );
}

SummaryItem.propTypes = {
  label: PropTypes.string.isRequired,
  value: PropTypes.node.isRequired,
};

function ExpectedSteps({ prefilledStepIds, steps }) {
  return (
    <ol className="mt-5 grid list-none gap-3 p-0 sm:grid-cols-2">
      {steps.map((step, index) => {
        const prefilled = prefilledStepIds.has(step.id);

        return (
          <li
            className="flex gap-3 rounded-xl border border-border bg-white p-4 dark:border-slate-700 dark:bg-slate-900"
            key={step.id}
          >
            <span
              aria-hidden="true"
              className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-50 text-sm font-bold text-lga-navy dark:bg-primary-950 dark:text-primary-100"
            >
              {index + 1}
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-semibold text-lga-navy dark:text-white">
                  {step.title}
                </h3>
                {prefilled && (
                  <StatusBadge
                    label="Prefilled"
                    showDot={false}
                    size="sm"
                    tone="info"
                  />
                )}
              </div>
              {step.description && (
                <p className="mt-1 text-sm leading-5 text-text-muted dark:text-slate-400">
                  {step.description}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

ExpectedSteps.propTypes = {
  prefilledStepIds: PropTypes.instanceOf(Set).isRequired,
  steps: PropTypes.arrayOf(
    PropTypes.shape({
      description: PropTypes.string,
      id: PropTypes.string.isRequired,
      title: PropTypes.string.isRequired,
    }),
  ).isRequired,
};

/**
 * Displays journey-specific guidance, prefilled-data context, expected steps,
 * and authorized begin or resume actions.
 */
export function JourneySplashPage({
  application,
  beginLabel = 'Begin journey',
  className = '',
  description,
  helpItems = DEFAULT_HELP_ITEMS,
  journeyType,
  onBegin,
  onResume,
  prefillData,
  resumeContext,
  resumeLabel = 'Resume journey',
  resumeTrackingId,
  title,
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const authState = useAuthStore();
  const [loadingAction, setLoadingAction] = useState('');
  const [actionError, setActionError] = useState('');
  const locationState = isObject(location.state) ? location.state : {};
  const resolvedApplication = useMemo(
    () => ({
      ...cloneValue(locationState.prefillData ?? {}),
      ...cloneValue(locationState.application ?? {}),
      ...cloneValue(prefillData ?? {}),
      ...cloneValue(application ?? {}),
    }),
    [
      application,
      locationState.application,
      locationState.prefillData,
      prefillData,
    ],
  );
  const resolvedJourneyType = resolveJourneyType(
    journeyType ?? locationState.journeyType,
    resolvedApplication,
    location.pathname,
  );
  const definition = useMemo(
    () => resolveJourneyDefinition(resolvedJourneyType),
    [resolvedJourneyType],
  );
  const resolvedResumeContext =
    resumeContext ?? locationState.resumeContext ?? null;
  const trackingId = resolveTrackingId(
    resolvedResumeContext,
    resumeTrackingId ?? locationState.trackingId,
  );
  const principal = useMemo(
    () => createPrincipal(authState),
    [authState],
  );
  const authorized =
    authState.isAuthenticated &&
    canPerformAction(principal, PERMISSIONS.CREATE_ONBOARDING);
  const partnerCode = getPartnerCode(
    resolvedApplication,
    authState,
  );
  const journeyService = useMemo(
    () =>
      createJourneyService({
        partnerCode,
        auditService: false,
      }),
    [partnerCode],
  );
  const expectedSteps = useMemo(
    () => getExpectedSteps(definition, resolvedApplication),
    [definition, resolvedApplication],
  );
  const prefilledStepIds = useMemo(
    () => getPrefilledStepIds(expectedSteps, resolvedApplication),
    [expectedSteps, resolvedApplication],
  );
  const prefillSummary = useMemo(
    () => buildPrefillSummary(resolvedApplication),
    [resolvedApplication],
  );
  const providedFieldCount = useMemo(
    () => countProvidedFields(resolvedApplication),
    [resolvedApplication],
  );
  const resolvedTitle = title ?? definition.label;
  const resolvedDescription =
    description ?? definition.description;
  const busy = loadingAction !== '';

  const handleBegin = async () => {
    setLoadingAction('begin');
    setActionError('');

    try {
      const request = {
        partnerCode,
        journeyType: definition.type,
        prefillPayload: resolvedApplication,
        requestedBy: principal,
        actor: principal,
        skipPrefilled: true,
      };
      const result =
        typeof onBegin === 'function'
          ? await onBegin(request)
          : await Promise.resolve(
              journeyService.initiateJourney(request),
            );

      navigateToJourney(navigate, result, result?.trackingId);
    } catch (error) {
      setActionError(
        error instanceof Error && error.message
          ? error.message
          : 'The journey could not be started. Try again.',
      );
    } finally {
      setLoadingAction('');
    }
  };

  const handleResume = async () => {
    if (!trackingId) {
      return;
    }

    setLoadingAction('resume');
    setActionError('');

    try {
      const result =
        typeof onResume === 'function'
          ? await onResume(trackingId, resolvedResumeContext)
          : await Promise.resolve(
              journeyService.loadDraft(trackingId, {
                partnerCode,
              }),
            );

      navigateToJourney(navigate, result, trackingId);
    } catch (error) {
      setActionError(
        error instanceof Error && error.message
          ? error.message
          : 'The saved journey could not be resumed. Try again.',
      );
    } finally {
      setLoadingAction('');
    }
  };

  return (
    <div
      className={`mx-auto w-full max-w-6xl space-y-6 ${className}`.trim()}
      data-journey-type={definition.type}
    >
      <section
        aria-labelledby="journey-splash-title"
        className="overflow-hidden rounded-2xl bg-lga-navy text-white shadow-elevated"
      >
        <div className="grid gap-6 px-6 py-7 sm:px-8 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <div className="flex flex-wrap gap-2">
              <StatusBadge
                label="Guided journey"
                showDot={false}
                tone="accent"
              />
              <StatusBadge
                label="Simulation"
                showDot={false}
                simulation
              />
            </div>
            <h1
              className="mt-4 text-2xl font-semibold sm:text-3xl"
              id="journey-splash-title"
            >
              {resolvedTitle}
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-primary-100 sm:text-base">
              {resolvedDescription}
            </p>
          </div>

          <dl className="grid min-w-56 grid-cols-2 gap-3 rounded-xl bg-white/10 p-4">
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-primary-100">
                Expected steps
              </dt>
              <dd className="mt-1 text-2xl font-semibold">
                {expectedSteps.length}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-primary-100">
                Prefilled steps
              </dt>
              <dd className="mt-1 text-2xl font-semibold">
                {prefilledStepIds.size}
              </dd>
            </div>
          </dl>
        </div>
      </section>

      <aside
        className="rounded-xl border border-accent-300 bg-accent-100 p-4 text-sm leading-6 text-accent-950 dark:border-accent-700 dark:bg-accent-950 dark:text-accent-100"
        role="note"
      >
        <p className="font-semibold">Before you continue</p>
        <p className="mt-1">
          Review all prefilled information carefully and use synthetic data
          only. No production transactions or external provider calls are
          performed.
        </p>
      </aside>

      {actionError && (
        <div
          className="rounded-xl border border-danger bg-danger-light p-4 text-sm text-danger-dark dark:border-red-700 dark:bg-danger-dark dark:text-red-100"
          role="alert"
        >
          <p className="font-semibold">The journey could not continue</p>
          <p className="mt-1">{actionError}</p>
        </div>
      )}

      {!authorized && (
        <div
          className="rounded-xl border border-warning bg-warning-light p-4 text-sm text-warning-dark dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
          role="alert"
        >
          An authenticated role with onboarding creation permission is
          required to begin or resume this journey.
        </div>
      )}

      <section
        aria-labelledby="prefilled-summary-title"
        className="rounded-xl border border-border bg-white p-5 shadow-card sm:p-6 dark:border-slate-700 dark:bg-slate-900"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2
              className="text-xl font-semibold text-lga-navy dark:text-white"
              id="prefilled-summary-title"
            >
              Information already available
            </h2>
            <p className="mt-1 text-sm leading-6 text-text-muted dark:text-slate-300">
              Prefilled values will remain editable and must be confirmed
              during the journey.
            </p>
          </div>
          <StatusBadge
            label={
              providedFieldCount > 0
                ? `${providedFieldCount} fields provided`
                : 'Manual start'
            }
            showDot={false}
            tone={providedFieldCount > 0 ? 'info' : 'neutral'}
          />
        </div>

        {prefillSummary.length > 0 ? (
          <dl className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {prefillSummary.map((item) => (
              <SummaryItem
                key={item.label}
                label={item.label}
                value={item.value}
              />
            ))}
          </dl>
        ) : (
          <div className="mt-5 rounded-lg border border-dashed border-border-strong bg-surface-muted px-4 py-8 text-center text-sm text-text-muted dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300">
            No source information has been supplied. You will enter the
            required details during the journey.
          </div>
        )}
      </section>

      <section
        aria-labelledby="expected-steps-title"
        className="rounded-xl border border-border bg-surface-muted p-5 shadow-card sm:p-6 dark:border-slate-700 dark:bg-slate-950"
      >
        <h2
          className="text-xl font-semibold text-lga-navy dark:text-white"
          id="expected-steps-title"
        >
          What to expect
        </h2>
        <p className="mt-1 text-sm leading-6 text-text-muted dark:text-slate-300">
          Your journey adapts to the contract type and information already
          provided. Some steps may be skipped after validation.
        </p>

        <ExpectedSteps
          prefilledStepIds={prefilledStepIds}
          steps={expectedSteps}
        />
      </section>

      <section
        aria-labelledby="journey-help-title"
        className="rounded-xl border border-border bg-white p-5 shadow-card sm:p-6 dark:border-slate-700 dark:bg-slate-900"
      >
        <h2
          className="text-xl font-semibold text-lga-navy dark:text-white"
          id="journey-help-title"
        >
          Help and guidance
        </h2>
        <ul className="mt-4 grid list-none gap-3 p-0 sm:grid-cols-2">
          {helpItems.map((item, index) => (
            <li
              className="flex gap-3 rounded-lg bg-surface-muted p-4 text-sm leading-6 text-text-muted dark:bg-slate-800 dark:text-slate-300"
              key={`${String(item)}-${index}`}
            >
              <span
                aria-hidden="true"
                className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary-100 text-xs font-bold text-lga-navy dark:bg-primary-900 dark:text-primary-100"
              >
                ✓
              </span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </section>

      <section
        aria-label="Journey actions"
        className="rounded-xl border border-border bg-white p-5 shadow-card sm:p-6 dark:border-slate-700 dark:bg-slate-900"
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-semibold text-lga-navy dark:text-white">
              {trackingId ? 'Continue your onboarding' : 'Ready to begin?'}
            </h2>
            <p className="mt-1 text-sm leading-6 text-text-muted dark:text-slate-300">
              {trackingId
                ? 'A saved journey is available. Resume it or begin a new journey with the information shown above.'
                : 'Begin when you are ready to review and complete the required information.'}
            </p>
          </div>

          <div className="flex shrink-0 flex-col gap-3 sm:flex-row">
            {trackingId && (
              <button
                className="inline-flex min-h-11 items-center justify-center rounded-lg border border-border bg-white px-5 py-2 text-sm font-semibold text-lga-navy transition-colors hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-lga-sky focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-white dark:hover:bg-slate-800 dark:focus:ring-offset-slate-900"
                disabled={busy || !authorized}
                onClick={handleResume}
                type="button"
              >
                {loadingAction === 'resume'
                  ? 'Resuming…'
                  : resumeLabel}
              </button>
            )}

            <button
              className="inline-flex min-h-11 items-center justify-center rounded-lg bg-lga-navy px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-800 focus:outline-none focus:ring-2 focus:ring-lga-sky focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-primary-600 dark:hover:bg-primary-500 dark:focus:ring-offset-slate-900"
              disabled={busy || !authorized}
              onClick={handleBegin}
              type="button"
            >
              {loadingAction === 'begin'
                ? 'Starting journey…'
                : beginLabel}
            </button>
          </div>
        </div>

        <div aria-live="polite" className="sr-only" role="status">
          {loadingAction === 'begin'
            ? 'Starting the guided journey.'
            : loadingAction === 'resume'
              ? 'Loading the saved guided journey.'
              : ''}
        </div>
      </section>
    </div>
  );
}

JourneySplashPage.propTypes = {
  application: PropTypes.object,
  beginLabel: PropTypes.node,
  className: PropTypes.string,
  description: PropTypes.node,
  helpItems: PropTypes.arrayOf(PropTypes.node),
  journeyType: PropTypes.string,
  onBegin: PropTypes.func,
  onResume: PropTypes.func,
  prefillData: PropTypes.object,
  resumeContext: PropTypes.shape({
    applicationId: PropTypes.string,
    currentStepId: PropTypes.string,
    resumeUrl: PropTypes.string,
    trackingId: PropTypes.string,
  }),
  resumeLabel: PropTypes.node,
  resumeTrackingId: PropTypes.string,
  title: PropTypes.node,
};

export default JourneySplashPage;