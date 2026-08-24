import { useMemo } from 'react';
import PropTypes from 'prop-types';
import { Link, useLocation, useParams } from 'react-router-dom';
import MaskedValue, {
  MASKED_VALUE_KINDS,
} from '../../components/shared/MaskedValue.jsx';
import StatusBadge from '../../components/shared/StatusBadge.jsx';
import { ROLES } from '../../constants/roles.js';
import {
  getOperationsOnboardingRoute,
  getPartnerOnboardingRoute,
  ROUTES,
} from '../../constants/routes.js';
import { createOnboardingRecordRepository } from '../../repositories/onboardingRecordRepository.js';
import { useAuthStore } from '../../stores/authStore.js';
import { formatDisplayDateTime } from '../../utils/dates.js';

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
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

function getDashboardPath(role) {
  if (role === ROLES.ADMIN) {
    return ROUTES.ADMIN_DASHBOARD;
  }

  if (role === ROLES.PARTNER || role === ROLES.AGENCY) {
    return ROUTES.PARTNER_DASHBOARD;
  }

  return ROUTES.OPERATIONS_DASHBOARD;
}

function getApplicationDetailPath(role, applicationId) {
  if (!applicationId) {
    return null;
  }

  if (role === ROLES.PARTNER || role === ROLES.AGENCY) {
    return getPartnerOnboardingRoute(applicationId);
  }

  return getOperationsOnboardingRoute(applicationId);
}

function getLocationResult(locationState) {
  if (!isObject(locationState)) {
    return null;
  }

  return (
    locationState.submissionResult ??
    locationState.result ??
    locationState.submission ??
    null
  );
}

function getLocationApplication(locationState) {
  if (!isObject(locationState)) {
    return null;
  }

  return locationState.application ?? null;
}

function findApplication(repository, identifiers) {
  for (const identifier of identifiers) {
    if (
      identifier === null ||
      identifier === undefined ||
      String(identifier).trim() === ''
    ) {
      continue;
    }

    try {
      const application = repository.find(identifier);

      if (application) {
        return application;
      }
    } catch {
      return null;
    }
  }

  return null;
}

function getAgentCode(application, result) {
  const eligibility =
    result?.eligibility ??
    application?.processingSnapshot?.eligibility ??
    {};
  const agentCodeOutcome =
    eligibility.derivedValues?.agentCode ??
    eligibility.derived?.agentCode ??
    {};

  return (
    agentCodeOutcome.code ??
    application?.agentCode ??
    application?.contract?.agentCode ??
    null
  );
}

function getValidationCodes(application, result) {
  return [
    ...new Set(
      [
        ...(Array.isArray(result?.validationCodes)
          ? result.validationCodes
          : []),
        ...(Array.isArray(
          application?.processingSnapshot?.validationCodes,
        )
          ? application.processingSnapshot.validationCodes
          : []),
        ...(Array.isArray(application?.validationCodes)
          ? application.validationCodes
          : []),
        ...(Array.isArray(application?.exceptions)
          ? application.exceptions.map((exception) => exception.code)
          : []),
      ].filter(Boolean),
    ),
  ];
}

function collectExceptions(application, result) {
  const validation =
    result?.validation ??
    application?.processingSnapshot?.validation ??
    {};
  const eligibility =
    result?.eligibility ??
    application?.processingSnapshot?.eligibility ??
    {};
  const candidates = [
    ...(Array.isArray(application?.exceptions)
      ? application.exceptions
      : []),
    ...(Array.isArray(validation.issues) ? validation.issues : []),
    ...(Array.isArray(eligibility.issues) ? eligibility.issues : []),
  ];
  const exceptions = [];
  const seen = new Set();

  candidates.forEach((exception, index) => {
    if (!isObject(exception)) {
      return;
    }

    const severity = String(exception.severity ?? '').toLowerCase();

    if (severity === 'info') {
      return;
    }

    const code =
      exception.code ??
      exception.id ??
      `submission-exception-${index}`;
    const key = `${code}:${exception.field ?? ''}:${
      exception.message ?? ''
    }`;

    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    exceptions.push({
      code,
      field: exception.field ?? null,
      message:
        exception.message ??
        'This outcome requires additional review.',
      severity: exception.severity ?? 'warning',
      status: exception.status ?? null,
    });
  });

  return exceptions;
}

function getNextStatus({
  application,
  exceptionRouted,
  manualReviewRequired,
  submitted,
}) {
  if (exceptionRouted || manualReviewRequired) {
    return {
      label: 'Manual review',
      description:
        'The application is available to the operations team for review. Follow its status from your dashboard.',
      tone: 'warning',
    };
  }

  if (submitted) {
    return {
      label: 'Application submitted',
      description:
        'The application will proceed through simulated review, licensing, background, and appointment processing as applicable.',
      tone: 'success',
    };
  }

  return {
    label: formatToken(
      application?.workflowStage ??
        application?.status ??
        'Processing',
    ),
    description:
      'The application has been saved. Follow its status from your dashboard.',
    tone: 'info',
  };
}

function OutcomeItem({ children, label, value }) {
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

OutcomeItem.propTypes = {
  children: PropTypes.node,
  label: PropTypes.string.isRequired,
  value: PropTypes.node,
};

/**
 * Confirms journey submission or exception routing and presents identifiers,
 * generated-code outcomes, next status, exceptions, and dashboard actions.
 */
export function JourneyThankYouPage({
  application: suppliedApplication,
  applicationId: suppliedApplicationId,
  dashboardPath,
  result: suppliedResult,
  submissionResult,
  trackingId: suppliedTrackingId,
}) {
  const location = useLocation();
  const params = useParams();
  const authState = useAuthStore();
  const currentUser = authState.currentUser ?? authState.user;
  const role = authState.role ?? currentUser?.role ?? null;
  const repository = useMemo(
    () => createOnboardingRecordRepository(),
    [],
  );
  const locationResult = getLocationResult(location.state);
  const result =
    submissionResult ?? suppliedResult ?? locationResult ?? null;
  const locationApplication = getLocationApplication(location.state);
  const resultApplication = isObject(result?.application)
    ? result.application
    : null;
  const routeTrackingId =
    suppliedTrackingId ??
    params.trackingId ??
    params.journeyId ??
    result?.trackingId ??
    resultApplication?.trackingId ??
    null;
  const routeApplicationId =
    suppliedApplicationId ??
    params.applicationId ??
    result?.applicationId ??
    resultApplication?.applicationId ??
    null;
  const persistedApplication = findApplication(repository, [
    routeApplicationId,
    routeTrackingId,
  ]);
  const application =
    suppliedApplication ??
    resultApplication ??
    locationApplication ??
    persistedApplication;
  const trackingId =
    routeTrackingId ?? application?.trackingId ?? null;
  const applicationId =
    routeApplicationId ?? application?.applicationId ?? null;
  const submitted =
    result?.submitted === true ||
    application?.status === 'submitted' ||
    application?.workflowStage === 'APPLICATION_SUBMITTED';
  const exceptionRouted =
    result?.submitted === false ||
    result?.outcome === 'EXCEPTION_ROUTED' ||
    application?.workflowStage === 'MANUAL_EXCEPTION';
  const manualReviewRequired =
    result?.manualReviewRequired === true ||
    application?.manualReviewRequired === true ||
    exceptionRouted;
  const exceptions = collectExceptions(application, result);
  const validationCodes = getValidationCodes(application, result);
  const agentCode = getAgentCode(application, result);
  const contractNumber =
    application?.contract?.contractNumber ??
    result?.contractNumber ??
    null;
  const submittedAt =
    result?.submittedAt ??
    application?.submittedAt ??
    result?.event?.occurredAt ??
    null;
  const nextStatus = getNextStatus({
    application,
    exceptionRouted,
    manualReviewRequired,
    submitted,
  });
  const resolvedDashboardPath =
    dashboardPath ?? getDashboardPath(role);
  const detailPath = getApplicationDetailPath(role, applicationId);
  const confirmationAvailable = Boolean(
    result || application || trackingId || applicationId,
  );

  if (!confirmationAvailable) {
    return (
      <section
        aria-labelledby="journey-confirmation-unavailable-title"
        className="mx-auto max-w-3xl rounded-xl border border-warning bg-warning-light p-6 text-warning-dark shadow-card dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
        role="alert"
      >
        <h1
          className="text-xl font-semibold"
          id="journey-confirmation-unavailable-title"
        >
          Submission confirmation is unavailable
        </h1>
        <p className="mt-2 text-sm leading-6">
          The completed journey details could not be found. Return to your
          dashboard to review saved and submitted applications.
        </p>
        <Link
          className="mt-5 inline-flex min-h-11 items-center justify-center rounded-lg bg-lga-navy px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-800 focus:outline-none focus:ring-2 focus:ring-lga-sky focus:ring-offset-2 dark:bg-primary-600 dark:hover:bg-primary-500"
          to={resolvedDashboardPath}
        >
          Return to dashboard
        </Link>
      </section>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <section
        aria-labelledby="journey-thank-you-title"
        className="overflow-hidden rounded-2xl border border-border bg-white shadow-elevated dark:border-slate-700 dark:bg-slate-900"
      >
        <div className="bg-lga-navy px-6 py-7 text-white sm:px-8">
          <div
            aria-hidden="true"
            className="flex size-14 items-center justify-center rounded-full bg-success text-2xl font-bold text-white"
          >
            ✓
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <StatusBadge
              label={
                exceptionRouted
                  ? 'Routed for review'
                  : submitted
                    ? 'Submitted'
                    : 'Journey complete'
              }
              showDot={false}
              tone={exceptionRouted ? 'warning' : 'success'}
            />
            <StatusBadge
              label="Simulation"
              showDot={false}
              simulation
            />
          </div>
          <h1
            className="mt-4 text-2xl font-semibold sm:text-3xl"
            id="journey-thank-you-title"
          >
            {exceptionRouted
              ? 'Thank you — your application was routed for review'
              : 'Thank you — your onboarding application is complete'}
          </h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-primary-100 sm:text-base">
            {exceptionRouted
              ? 'Your information was saved successfully. One or more outcomes require simulated operational review before processing can continue.'
              : 'Your information and simulated signature were recorded successfully. You can use the identifiers below to follow the application.'}
          </p>
        </div>

        <div className="space-y-6 p-5 sm:p-8">
          <section aria-labelledby="confirmation-details-title">
            <h2
              className="text-xl font-semibold text-lga-navy dark:text-white"
              id="confirmation-details-title"
            >
              Confirmation details
            </h2>
            <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <OutcomeItem label="Tracking ID">
                {trackingId ? (
                  <span className="break-all font-mono text-xs">
                    {trackingId}
                  </span>
                ) : (
                  'Not available'
                )}
              </OutcomeItem>
              <OutcomeItem label="Application number">
                {applicationId ? (
                  <span className="break-all font-mono text-xs">
                    {applicationId}
                  </span>
                ) : (
                  'Not available'
                )}
              </OutcomeItem>
              <OutcomeItem
                label="Submitted"
                value={formatDate(submittedAt)}
              />
              <OutcomeItem
                label="Company"
                value={application?.company ?? application?.carrierCode}
              />
              <OutcomeItem
                label="Application status"
                value={formatToken(
                  application?.status ??
                    result?.status ??
                    nextStatus.label,
                )}
              />
              <OutcomeItem
                label="Workflow stage"
                value={formatToken(
                  application?.workflowStage ??
                    result?.workflowStage ??
                    nextStatus.label,
                )}
              />
            </dl>
          </section>

          <section
            aria-labelledby="code-outcomes-title"
            className="rounded-xl border border-border p-5 dark:border-slate-700"
          >
            <h2
              className="text-lg font-semibold text-lga-navy dark:text-white"
              id="code-outcomes-title"
            >
              Contracting code outcomes
            </h2>
            <p className="mt-1 text-sm leading-6 text-text-muted dark:text-slate-300">
              Codes may remain pending until simulated review and activation
              are complete.
            </p>
            <dl className="mt-4 grid gap-3 sm:grid-cols-2">
              <OutcomeItem label="Agent or agency code">
                {agentCode ? (
                  <MaskedValue
                    kind={MASKED_VALUE_KINDS.IDENTIFIER}
                    label="Agent or agency code"
                    value={agentCode}
                  />
                ) : (
                  'Pending assignment'
                )}
              </OutcomeItem>
              <OutcomeItem label="Contract number">
                {contractNumber ? (
                  <MaskedValue
                    kind={MASKED_VALUE_KINDS.IDENTIFIER}
                    label="Contract number"
                    value={contractNumber}
                  />
                ) : (
                  'Pending activation'
                )}
              </OutcomeItem>
            </dl>
          </section>

          <section
            aria-labelledby="next-status-title"
            className={`rounded-xl border p-5 ${
              nextStatus.tone === 'warning'
                ? 'border-warning bg-warning-light text-warning-dark dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100'
                : 'border-success bg-success-light text-success-dark dark:border-green-800 dark:bg-green-950 dark:text-green-100'
            }`}
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold" id="next-status-title">
                  What happens next
                </h2>
                <p className="mt-2 text-sm leading-6">
                  {nextStatus.description}
                </p>
              </div>
              <StatusBadge
                label={nextStatus.label}
                showDot={false}
                tone={nextStatus.tone}
              />
            </div>
          </section>

          {(exceptions.length > 0 || validationCodes.length > 0) && (
            <section aria-labelledby="submission-exceptions-title">
              <h2
                className="text-lg font-semibold text-lga-navy dark:text-white"
                id="submission-exceptions-title"
              >
                Review outcomes
              </h2>
              <p className="mt-1 text-sm leading-6 text-text-muted dark:text-slate-300">
                These indicators explain any additional review or processing
                requirements.
              </p>

              {exceptions.length > 0 ? (
                <ul className="mt-4 space-y-3">
                  {exceptions.map((exception, index) => (
                    <li
                      className="rounded-lg border border-warning bg-warning-light p-4 text-warning-dark dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
                      key={`${exception.code}-${exception.field ?? index}`}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge
                          label={formatToken(exception.code)}
                          severity={String(exception.severity)}
                          showDot={false}
                          size="sm"
                        />
                        {exception.status && (
                          <StatusBadge
                            showDot={false}
                            size="sm"
                            status={exception.status}
                          />
                        )}
                      </div>
                      <p className="mt-2 text-sm leading-6">
                        {exception.message}
                      </p>
                      {exception.field && (
                        <p className="mt-2 font-mono text-xs opacity-80">
                          {exception.field}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="mt-4 flex flex-wrap gap-2">
                  {validationCodes.map((code) => (
                    <StatusBadge
                      key={code}
                      label={formatToken(code)}
                      severity="warning"
                      showDot={false}
                      size="sm"
                    />
                  ))}
                </div>
              )}
            </section>
          )}

          <div className="flex flex-col-reverse gap-3 border-t border-border pt-5 sm:flex-row sm:justify-end dark:border-slate-700">
            <Link
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-border bg-white px-5 py-2 text-sm font-semibold text-lga-navy transition-colors hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-lga-sky focus:ring-offset-2 dark:border-slate-600 dark:bg-slate-900 dark:text-white dark:hover:bg-slate-800 dark:focus:ring-offset-slate-900"
              to={resolvedDashboardPath}
            >
              Return to dashboard
            </Link>
            {detailPath && (
              <Link
                className="inline-flex min-h-11 items-center justify-center rounded-lg bg-lga-navy px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-800 focus:outline-none focus:ring-2 focus:ring-lga-sky focus:ring-offset-2 dark:bg-primary-600 dark:hover:bg-primary-500 dark:focus:ring-offset-slate-900"
                to={detailPath}
              >
                View application status
              </Link>
            )}
          </div>
        </div>
      </section>

      <aside
        className="rounded-xl border border-accent-300 bg-accent-100 p-4 text-sm leading-6 text-accent-950 dark:border-accent-700 dark:bg-accent-950 dark:text-accent-100"
        role="note"
      >
        This confirmation is part of a simulation. No official contract,
        appointment, background check, payment, or external provider
        transaction was created.
      </aside>
    </div>
  );
}

JourneyThankYouPage.propTypes = {
  application: PropTypes.object,
  applicationId: PropTypes.oneOfType([
    PropTypes.string,
    PropTypes.number,
  ]),
  dashboardPath: PropTypes.string,
  result: PropTypes.object,
  submissionResult: PropTypes.object,
  trackingId: PropTypes.oneOfType([
    PropTypes.string,
    PropTypes.number,
  ]),
};

export default JourneyThankYouPage;