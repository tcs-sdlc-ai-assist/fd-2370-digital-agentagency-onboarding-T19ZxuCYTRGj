import { useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { FormProvider, useForm } from 'react-hook-form';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import JourneySectionForm from '../../components/journey/JourneySectionForm.jsx';
import JourneyStepper from '../../components/journey/JourneyStepper.jsx';
import JsonViewer from '../../components/shared/JsonViewer.jsx';
import StatusBadge from '../../components/shared/StatusBadge.jsx';
import { getJourneyRoute, ROUTES } from '../../constants/routes.js';
import { createOnboardingRecordRepository } from '../../repositories/onboardingRecordRepository.js';
import {
  createJourneyService,
  JOURNEY_SAVE_MODES,
} from '../../services/onboarding/journeyService.js';
import { useAuthStore } from '../../stores/authStore.js';

const SIGNATURE_STEP_ID = 'signature';
const COMPLETE_STEP_ID = 'complete';
const REVIEW_STEP_ID = 'review';

const STEP_HELP = Object.freeze({
  start: Object.freeze([
    'Review the journey steps before continuing.',
    'Information supplied by an intake source may already be completed.',
  ]),
  'source-review': Object.freeze([
    'Confirm the imported source information before continuing.',
    'Read-only source fields identify how this journey was created.',
  ]),
  applicant: Object.freeze([
    'Use a synthetic identity and contact information.',
    'The national producer number must contain 5 to 10 digits.',
  ]),
  organization: Object.freeze([
    'Use a fictitious legal entity and tax identifier.',
    'Confirm the state of formation before continuing.',
  ]),
  agency: Object.freeze([
    'Confirm the agency type and general agency relationship.',
    'Agency and general agency codes affect contracting eligibility.',
  ]),
  principals: Object.freeze([
    'Corporate journeys require at least one licensed, eligible principal.',
    'Ownership percentages must be between 0 and 100.',
  ]),
  licensing: Object.freeze([
    'Enter synthetic licensing information only.',
    'Separate multiple lines of authority with commas.',
  ]),
  registration: Object.freeze([
    'Registered representative journeys require a synthetic CRD number.',
    'Confirm the broker-dealer and registration status.',
  ]),
  contract: Object.freeze([
    'Carrier, contract level, and commission selections are validated together.',
    'William Penn and ABNCA selections have additional restrictions.',
  ]),
  commission: Object.freeze([
    'ABNCA does not permit advance commission.',
    'Payment and schedule selections may trigger additional requirements.',
  ]),
  banking: Object.freeze([
    'Use synthetic banking information only.',
    'Routing numbers must contain exactly 9 digits.',
  ]),
  'errors-and-omissions': Object.freeze([
    'Use a synthetic policy number and carrier.',
    'Confirm that the coverage expiration date is current.',
  ]),
  hierarchy: Object.freeze([
    'Confirm the general agency, agency, and upline relationship.',
    'Unresolved hierarchies may require manual review.',
  ]),
  documents: Object.freeze([
    'Review the required document counts and package notes.',
    'Generated artifacts in this simulation are placeholders only.',
  ]),
  attestations: Object.freeze([
    'Review each statement before confirming it.',
    'Accuracy and electronic-delivery confirmations are required.',
  ]),
  review: Object.freeze([
    'Review the saved application data before signing.',
    'Return to an earlier step if any information needs correction.',
  ]),
  signature: Object.freeze([
    'Electronic-signature consent is required before completion.',
    'Signing records a simulated signature only.',
  ]),
  complete: Object.freeze([
    'Final validation runs before the journey is marked complete.',
    'Applications requiring review cannot be finalized automatically.',
  ]),
});

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

function mergeValues(baseValue, overlayValue) {
  if (!isObject(baseValue) || !isObject(overlayValue)) {
    return overlayValue === undefined
      ? cloneValue(baseValue)
      : cloneValue(overlayValue);
  }

  const mergedValue = cloneValue(baseValue);

  Object.entries(overlayValue).forEach(([key, value]) => {
    if (value === undefined) {
      return;
    }

    mergedValue[key] =
      isObject(value) && isObject(mergedValue[key])
        ? mergeValues(mergedValue[key], value)
        : cloneValue(value);
  });

  return mergedValue;
}

function getRouteTrackingId(params, locationState) {
  return (
    params.trackingId ??
    params.journeyId ??
    locationState?.trackingId ??
    locationState?.journey?.trackingId ??
    locationState?.journey?.draft?.trackingId ??
    null
  );
}

function getRouteStepId(params, locationState) {
  return (
    params.stepId ??
    locationState?.stepId ??
    locationState?.currentStepId ??
    null
  );
}

function getPartnerCode(
  authState,
  locationState,
  applicationRepository,
  trackingId,
) {
  const stateDraft =
    locationState?.journey?.draft ?? locationState?.draft;
  const application = trackingId
    ? applicationRepository.find(trackingId)
    : null;

  return (
    stateDraft?.partnerCode ??
    locationState?.partnerCode ??
    application?.partnerCode ??
    authState.partnerContext?.partnerCode ??
    authState.partnerContext?.partnerId ??
    'DEMO_PARTNER'
  );
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

function getStepSection(step) {
  return step?.section ?? step?.id ?? 'review';
}

function getSubmitLabel(stepId) {
  if (stepId === SIGNATURE_STEP_ID) {
    return 'Sign and continue';
  }

  if (stepId === COMPLETE_STEP_ID) {
    return 'Finalize journey';
  }

  if (stepId === REVIEW_STEP_ID) {
    return 'Continue to signature';
  }

  return 'Save and continue';
}

function getErrorDetails(error) {
  const validation =
    error?.details?.validation ??
    error?.details?.issues ??
    error?.details?.errors;
  const issues = Array.isArray(validation)
    ? validation
    : validation?.issues ?? validation?.errors ?? [];

  return [
    ...new Set(
      issues
        .map((issue) =>
          typeof issue === 'string' ? issue : issue?.message,
        )
        .filter(Boolean),
    ),
  ];
}

function JourneyFormHost({ children, ...formProps }) {
  const hostForm = useForm({
    defaultValues: {
      principals: [],
    },
  });

  return (
    <FormProvider {...hostForm}>
      <JourneySectionForm {...formProps}>{children}</JourneySectionForm>
    </FormProvider>
  );
}

JourneyFormHost.propTypes = {
  children: PropTypes.node,
};

function StepHelp({ step }) {
  const helpItems = STEP_HELP[step.id] ?? [
    'Review all information before continuing.',
    'Use synthetic data only throughout this simulation.',
  ];

  return (
    <aside
      aria-labelledby="journey-step-help-title"
      className="rounded-xl border border-border bg-white p-5 shadow-card dark:border-slate-700 dark:bg-slate-900"
    >
      <h2
        className="text-base font-semibold text-lga-navy dark:text-white"
        id="journey-step-help-title"
      >
        Help for this step
      </h2>
      <ul className="mt-3 space-y-3">
        {helpItems.map((item) => (
          <li
            className="flex gap-3 text-sm leading-6 text-text-muted dark:text-slate-300"
            key={item}
          >
            <span
              aria-hidden="true"
              className="mt-1 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary-100 text-xs font-bold text-lga-navy dark:bg-primary-900 dark:text-primary-100"
            >
              i
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ul>

      <div className="mt-5 rounded-lg border border-accent-300 bg-accent-100 p-3 text-xs leading-5 text-accent-950 dark:border-accent-700 dark:bg-accent-950 dark:text-accent-100">
        Do not enter personal, production, banking, licensing, or contact
        information.
      </div>
    </aside>
  );
}

StepHelp.propTypes = {
  step: PropTypes.shape({
    id: PropTypes.string.isRequired,
  }).isRequired,
};

function ReviewContent({ draft }) {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-info bg-info-light p-4 text-sm leading-6 text-info-dark dark:border-primary-700 dark:bg-primary-950 dark:text-primary-100">
        Review the saved journey information below. Sensitive values are
        redacted in this preview.
      </div>
      <JsonViewer
        data={draft.formState}
        fileName={`journey-review-${draft.trackingId}.json`}
        initiallyExpanded
        redact
        showDownloadButton={false}
        title="Journey information"
      />
    </div>
  );
}

ReviewContent.propTypes = {
  draft: PropTypes.shape({
    formState: PropTypes.object.isRequired,
    trackingId: PropTypes.string.isRequired,
  }).isRequired,
};

function CompletionContent({ view }) {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-success bg-success-light p-4 text-sm leading-6 text-success-dark dark:border-green-800 dark:bg-green-950 dark:text-green-100">
        All presented steps have been completed. Finalize the journey to run
        submission validation and record the simulated result.
      </div>
      <dl className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg bg-surface-muted p-3 dark:bg-slate-800">
          <dt className="text-xs font-medium uppercase tracking-wide text-text-muted dark:text-slate-400">
            Completed steps
          </dt>
          <dd className="mt-1 text-lg font-semibold text-lga-navy dark:text-white">
            {view.completedSteps.length}
          </dd>
        </div>
        <div className="rounded-lg bg-surface-muted p-3 dark:bg-slate-800">
          <dt className="text-xs font-medium uppercase tracking-wide text-text-muted dark:text-slate-400">
            Progress
          </dt>
          <dd className="mt-1 text-lg font-semibold text-lga-navy dark:text-white">
            {view.progress.percentComplete}%
          </dd>
        </div>
      </dl>
    </div>
  );
}

CompletionContent.propTypes = {
  view: PropTypes.shape({
    completedSteps: PropTypes.arrayOf(PropTypes.string).isRequired,
    progress: PropTypes.shape({
      percentComplete: PropTypes.number.isRequired,
    }).isRequired,
  }).isRequired,
};

/**
 * Displays and orchestrates the active route-driven guided journey step.
 */
export function JourneyStepPage() {
  const params = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const authState = useAuthStore();
  const locationState = isObject(location.state) ? location.state : {};
  const trackingId = getRouteTrackingId(params, locationState);
  const requestedStepId = getRouteStepId(params, locationState);
  const principal = useMemo(
    () => createPrincipal(authState),
    [authState],
  );
  const applicationRepository = useMemo(
    () => createOnboardingRecordRepository(),
    [],
  );
  const partnerCode = getPartnerCode(
    authState,
    locationState,
    applicationRepository,
    trackingId,
  );
  const journeyService = useMemo(
    () =>
      createJourneyService({
        partnerCode,
        applicationRepository,
        auditService: false,
      }),
    [applicationRepository, partnerCode],
  );
  const [view, setView] = useState(null);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState('');
  const [errorDetails, setErrorDetails] = useState([]);
  const [navigationBusy, setNavigationBusy] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const latestValuesRef = useRef(null);

  useEffect(() => {
    let active = true;

    const loadJourney = async () => {
      setLoading(true);
      setPageError('');
      setErrorDetails([]);
      setSaveMessage('');

      if (!trackingId) {
        if (active) {
          setPageError(
            'A tracking identifier is required to load this journey.',
          );
          setLoading(false);
        }
        return;
      }

      try {
        let loadedView = await Promise.resolve(
          journeyService.loadDraft(trackingId, {
            partnerCode,
          }),
        );

        if (
          requestedStepId &&
          requestedStepId !== loadedView.currentStepId &&
          loadedView.steps.some((step) => step.id === requestedStepId)
        ) {
          loadedView = await Promise.resolve(
            journeyService.goToStep(trackingId, requestedStepId, {
              expectedVersion: loadedView.version,
              actor: principal,
            }),
          );
        }

        if (active) {
          latestValuesRef.current = cloneValue(
            loadedView.draft.formState,
          );
          setView(loadedView);
        }
      } catch (error) {
        if (active) {
          setPageError(
            error instanceof Error && error.message
              ? error.message
              : 'The guided journey could not be loaded.',
          );
          setErrorDetails(getErrorDetails(error));
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    loadJourney();

    return () => {
      active = false;
    };
  }, [
    journeyService,
    partnerCode,
    principal,
    requestedStepId,
    trackingId,
  ]);

  const updateView = (nextView) => {
    latestValuesRef.current = cloneValue(nextView.draft.formState);
    setView(nextView);
    setPageError('');
    setErrorDetails([]);
  };

  const runAction = async (action) => {
    setNavigationBusy(true);
    setPageError('');
    setErrorDetails([]);
    setSaveMessage('');

    try {
      return await action();
    } catch (error) {
      setPageError(
        error instanceof Error && error.message
          ? error.message
          : 'The journey action could not be completed.',
      );
      setErrorDetails(getErrorDetails(error));
      throw error;
    } finally {
      setNavigationBusy(false);
    }
  };

  const handleStepSubmit = async (values) => {
    if (!view) {
      return;
    }

    try {
      await runAction(async () => {
        const mergedFormState = mergeValues(
          view.draft.formState,
          values,
        );
        let nextView = await Promise.resolve(
          journeyService.saveDraft(
            trackingId,
            {
              formState: mergedFormState,
            },
            {
              actor: principal,
              expectedVersion: view.version,
              saveMode: JOURNEY_SAVE_MODES.MANUAL,
            },
          ),
        );

        if (view.currentStepId === COMPLETE_STEP_ID) {
          nextView = await Promise.resolve(
            journeyService.completeJourney(trackingId, {
              actor: principal,
              expectedVersion: nextView.version,
              requireSignature: true,
            }),
          );
        } else {
          if (view.currentStepId === SIGNATURE_STEP_ID) {
            const signedBy = values.signOff?.signedBy;

            nextView = await Promise.resolve(
              journeyService.markSigned(
                trackingId,
                'agent_signature',
                {
                  signedBy,
                  metadata: {
                    synthetic: true,
                  },
                },
                {
                  actor: principal,
                  expectedVersion: nextView.version,
                },
              ),
            );
          }

          nextView = await Promise.resolve(
            journeyService.completeStep(
              trackingId,
              view.currentStepId,
              {
                actor: principal,
                expectedVersion: nextView.version,
                validate: true,
              },
            ),
          );
        }

        updateView(nextView);
        setSaveMessage(
          view.currentStepId === COMPLETE_STEP_ID
            ? 'Journey finalized successfully.'
            : 'Step saved successfully.',
        );

        navigate(getJourneyRoute(trackingId), {
          replace: true,
          state: {
            trackingId,
          },
        });
      });
    } catch {
      return;
    }
  };

  const handleSaveAndExit = async () => {
    if (!view) {
      return;
    }

    try {
      await runAction(async () => {
        await Promise.resolve(
          journeyService.saveDraft(
            trackingId,
            {
              formState: mergeValues(
                view.draft.formState,
                latestValuesRef.current ?? {},
              ),
            },
            {
              actor: principal,
              expectedVersion: view.version,
              saveMode: JOURNEY_SAVE_MODES.SAVE_AND_EXIT,
            },
          ),
        );

        navigate(ROUTES.JOURNEYS, {
          replace: true,
          state: {
            message: 'Journey progress saved.',
            trackingId,
          },
        });
      });
    } catch {
      return;
    }
  };

  const handleStepNavigation = async (step) => {
    if (
      !view ||
      navigationBusy ||
      step.id === view.currentStepId ||
      step.id === COMPLETE_STEP_ID
    ) {
      return;
    }

    try {
      await runAction(async () => {
        const savedView = await Promise.resolve(
          journeyService.saveDraft(
            trackingId,
            {
              formState: mergeValues(
                view.draft.formState,
                latestValuesRef.current ?? {},
              ),
            },
            {
              actor: principal,
              expectedVersion: view.version,
              saveMode: JOURNEY_SAVE_MODES.AUTO,
            },
          ),
        );
        const nextView = await Promise.resolve(
          journeyService.goToStep(trackingId, step.id, {
            actor: principal,
            expectedVersion: savedView.version,
          }),
        );

        updateView(nextView);
        navigate(getJourneyRoute(trackingId), {
          replace: true,
          state: {
            trackingId,
            stepId: step.id,
          },
        });
      });
    } catch {
      return;
    }
  };

  const handlePreviousStep = async () => {
    if (!view) {
      return;
    }

    const currentIndex = view.steps.findIndex(
      (step) => step.id === view.currentStepId,
    );
    const previousStep = view.steps[currentIndex - 1];

    if (previousStep) {
      await handleStepNavigation(previousStep);
    }
  };

  if (loading) {
    return (
      <section
        aria-busy="true"
        className="mx-auto max-w-5xl rounded-xl border border-border bg-white px-5 py-12 text-center shadow-card dark:border-slate-700 dark:bg-slate-900"
      >
        <p
          className="text-sm text-text-muted dark:text-slate-300"
          role="status"
        >
          Loading guided journey…
        </p>
      </section>
    );
  }

  if (!view) {
    return (
      <section
        aria-labelledby="journey-load-error-title"
        className="mx-auto max-w-3xl rounded-xl border border-danger bg-danger-light p-6 text-danger-dark shadow-card dark:border-red-700 dark:bg-danger-dark dark:text-red-100"
        role="alert"
      >
        <h1 className="text-xl font-semibold" id="journey-load-error-title">
          The journey could not be opened
        </h1>
        <p className="mt-2 text-sm leading-6">
          {pageError || 'The requested journey is not available.'}
        </p>
        <button
          className="mt-5 inline-flex min-h-11 items-center justify-center rounded-lg bg-lga-navy px-5 py-2 text-sm font-semibold text-white focus:outline-none focus:ring-2 focus:ring-lga-sky focus:ring-offset-2"
          onClick={() => navigate(ROUTES.JOURNEYS)}
          type="button"
        >
          Return to journeys
        </button>
      </section>
    );
  }

  const currentStep = view.currentStep;
  const definitionSteps = view.definition.steps;
  const currentIndex = view.steps.findIndex(
    (step) => step.id === view.currentStepId,
  );
  const previousStep = view.steps[currentIndex - 1] ?? null;
  const completed = view.draft.completionState?.completed === true;
  const section = getStepSection(currentStep);

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6">
      <header className="rounded-xl border border-border bg-white p-5 shadow-card sm:p-6 dark:border-slate-700 dark:bg-slate-900">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex flex-wrap gap-2">
              <StatusBadge
                label={view.definition.label}
                showDot={false}
                tone="info"
              />
              <StatusBadge
                label={`${view.progress.percentComplete}% complete`}
                showDot={false}
                tone={completed ? 'success' : 'neutral'}
              />
              <StatusBadge label="Simulation" showDot={false} simulation />
            </div>
            <h1 className="mt-4 text-2xl font-semibold text-lga-navy sm:text-3xl dark:text-white">
              {currentStep.title}
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-text-muted dark:text-slate-300">
              {currentStep.description}
            </p>
            <p className="mt-2 break-all font-mono text-xs text-text-muted dark:text-slate-400">
              {view.trackingId}
            </p>
          </div>

          {!completed && (
            <button
              className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg border border-border bg-white px-4 py-2 text-sm font-semibold text-lga-navy transition-colors hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-lga-sky focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-white dark:hover:bg-slate-800 dark:focus:ring-offset-slate-900"
              disabled={navigationBusy}
              onClick={handleSaveAndExit}
              type="button"
            >
              {navigationBusy ? 'Saving…' : 'Save and exit'}
            </button>
          )}
        </div>
      </header>

      {pageError && (
        <div
          className="rounded-xl border border-danger bg-danger-light p-4 text-sm text-danger-dark dark:border-red-700 dark:bg-danger-dark dark:text-red-100"
          role="alert"
        >
          <p className="font-semibold">The journey could not continue</p>
          <p className="mt-1">{pageError}</p>
          {errorDetails.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {errorDetails.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div aria-live="polite" className="sr-only" role="status">
        {saveMessage}
      </div>

      <div className="grid gap-6 lg:grid-cols-[17rem_minmax(0,1fr)]">
        <aside className="h-fit rounded-xl border border-border bg-white p-5 shadow-card lg:sticky lg:top-24 dark:border-slate-700 dark:bg-slate-900">
          <JourneyStepper
            compact
            completedSteps={view.completedSteps}
            currentStepId={view.currentStepId}
            onStepClick={handleStepNavigation}
            skippedSteps={view.skippedSteps}
            steps={definitionSteps}
            title="Journey progress"
          />
        </aside>

        <div className="min-w-0 space-y-6">
          {completed ? (
            <section
              aria-labelledby="journey-completed-title"
              className="rounded-xl border border-success bg-success-light p-6 shadow-card dark:border-green-800 dark:bg-green-950"
            >
              <StatusBadge status="complete" />
              <h2
                className="mt-4 text-2xl font-semibold text-success-dark dark:text-green-100"
                id="journey-completed-title"
              >
                Journey complete
              </h2>
              <p className="mt-2 text-sm leading-6 text-success-dark dark:text-green-200">
                The guided journey has been finalized and saved in this
                simulation.
              </p>
              <button
                className="mt-5 inline-flex min-h-11 items-center justify-center rounded-lg bg-lga-navy px-5 py-2 text-sm font-semibold text-white focus:outline-none focus:ring-2 focus:ring-lga-sky focus:ring-offset-2"
                onClick={() => navigate(ROUTES.JOURNEYS)}
                type="button"
              >
                Return to journeys
              </button>
            </section>
          ) : (
            <JourneyFormHost
              defaultValues={view.draft.formState}
              description={currentStep.description}
              disabled={navigationBusy}
              key={`${view.trackingId}-${view.currentStepId}-${view.version}`}
              onSubmit={handleStepSubmit}
              onValuesChange={(values) => {
                latestValuesRef.current = values;
              }}
              section={section}
              showCancel={Boolean(previousStep)}
              submitLabel={getSubmitLabel(currentStep.id)}
              title={currentStep.title}
              onCancel={handlePreviousStep}
            >
              {currentStep.id === REVIEW_STEP_ID && (
                <ReviewContent draft={view.draft} />
              )}
              {currentStep.id === COMPLETE_STEP_ID && (
                <CompletionContent view={view} />
              )}
            </JourneyFormHost>
          )}

          <StepHelp step={currentStep} />
        </div>
      </div>
    </div>
  );
}

export default JourneyStepPage;