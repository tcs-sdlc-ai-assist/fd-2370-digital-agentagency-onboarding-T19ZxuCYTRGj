import { useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import {
  Link,
  Navigate,
  useLocation,
  useParams,
} from 'react-router-dom';
import StatusBadge from '../../components/shared/StatusBadge.jsx';
import { ROUTES } from '../../constants/routes.js';
import { createPartnerDashboardService } from '../../services/operations/partnerDashboardService.js';
import { useAuthStore } from '../../stores/authStore.js';

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

function getTrackingId(params, locationState) {
  return (
    params.trackingId ??
    locationState?.trackingId ??
    locationState?.resumeContext?.trackingId ??
    null
  );
}

function getResumeUrl(result) {
  return (
    result?.resumeUrl ??
    result?.journeyUrl ??
    result?.resumeContext?.resumeUrl ??
    result?.draft?.resumeUrl ??
    null
  );
}

function isSafeJourneyRoute(route) {
  if (typeof route !== 'string') {
    return false;
  }

  const normalizedRoute = route.trim();

  return (
    normalizedRoute.startsWith('/journeys/') &&
    !normalizedRoute.startsWith('//') &&
    !normalizedRoute.includes('\\') &&
    !/[\r\n]/.test(normalizedRoute)
  );
}

function isScopeError(error) {
  const code = String(error?.code ?? '');

  return (
    code.includes('SCOPE') ||
    code === 'PARTNER_DASHBOARD_PARTNER_SCOPE_VIOLATION'
  );
}

function createRedirectState(location, reason, trackingId) {
  return {
    from: location,
    reason,
    trackingId,
  };
}

/**
 * Validates partner ownership of a saved draft and redirects to its exact
 * resumable journey route.
 */
export function PartnerResumeRedirectPage({
  partnerDashboardService,
}) {
  const params = useParams();
  const location = useLocation();
  const authState = useAuthStore();
  const principal = useMemo(
    () => createPrincipal(authState),
    [authState],
  );
  const partnerCode =
    authState.partnerContext?.partnerCode ??
    authState.partnerContext?.partnerId ??
    authState.activePartnerCode ??
    'DEMO_PARTNER';
  const service = useMemo(
    () =>
      partnerDashboardService ??
      createPartnerDashboardService({
        partnerCode,
        principal,
        partnerContext: authState.partnerContext,
        auditService: false,
      }),
    [
      authState.partnerContext,
      partnerCode,
      partnerDashboardService,
      principal,
    ],
  );
  const trackingId = getTrackingId(params, location.state);
  const [destination, setDestination] = useState(null);
  const [denial, setDenial] = useState(null);
  const [pageError, setPageError] = useState('');

  useEffect(() => {
    let active = true;

    const resolveResumeRoute = async () => {
      setDestination(null);
      setDenial(null);
      setPageError('');

      if (!authState.isAuthenticated) {
        setDenial({
          path: ROUTES.LOGIN,
          reason: 'authentication_required',
        });
        return;
      }

      if (
        trackingId === null ||
        trackingId === undefined ||
        String(trackingId).trim() === ''
      ) {
        setPageError(
          'A tracking identifier is required to resume this journey.',
        );
        return;
      }

      try {
        const result = await Promise.resolve(
          service.resumeJourney(trackingId, principal, {
            partnerCode,
            partnerContext: authState.partnerContext,
          }),
        );
        const resumeUrl = getResumeUrl(result);

        if (!isSafeJourneyRoute(resumeUrl)) {
          throw new Error(
            'The saved journey does not contain a valid resume route.',
          );
        }

        if (active) {
          setDestination({
            path: resumeUrl.trim(),
            state: {
              journey: result,
              trackingId: String(trackingId),
              currentStepId:
                result.currentStepId ??
                result.resumeContext?.currentStepId ??
                result.draft?.currentStepId ??
                null,
              resumedFromPartnerDashboard: true,
            },
          });
        }
      } catch (error) {
        if (!active) {
          return;
        }

        if (
          error?.code === 'UNAUTHENTICATED' ||
          error?.code === 'AUTH_SESSION_EXPIRED'
        ) {
          setDenial({
            path: ROUTES.LOGIN,
            reason:
              error.code === 'AUTH_SESSION_EXPIRED'
                ? 'session_expired'
                : 'authentication_required',
          });
          return;
        }

        if (isScopeError(error)) {
          setDenial({
            path: ROUTES.FORBIDDEN,
            reason: 'record_scope_forbidden',
          });
          return;
        }

        if (
          error?.code === 'PARTNER_DASHBOARD_DRAFT_NOT_FOUND' ||
          error?.code === 'JOURNEY_SERVICE_NOT_FOUND' ||
          error?.code === 'JOURNEY_DRAFT_NOT_FOUND'
        ) {
          setPageError(
            'The saved journey could not be found. It may have been completed or removed.',
          );
          return;
        }

        if (error?.code === 'PARTNER_DASHBOARD_STALE_DRAFT') {
          setPageError(
            'This saved journey is no longer available to resume.',
          );
          return;
        }

        setPageError(
          error instanceof Error && error.message
            ? error.message
            : 'The saved journey could not be resumed. Try again.',
        );
      }
    };

    resolveResumeRoute();

    return () => {
      active = false;
    };
  }, [
    authState.isAuthenticated,
    authState.partnerContext,
    partnerCode,
    principal,
    service,
    trackingId,
  ]);

  if (destination) {
    return (
      <Navigate
        replace
        state={destination.state}
        to={destination.path}
      />
    );
  }

  if (denial) {
    return (
      <Navigate
        replace
        state={createRedirectState(
          location,
          denial.reason,
          trackingId,
        )}
        to={denial.path}
      />
    );
  }

  if (pageError) {
    return (
      <section
        aria-labelledby="partner-resume-error-title"
        className="mx-auto w-full max-w-3xl rounded-xl border border-danger bg-danger-light p-6 text-danger-dark shadow-card dark:border-red-700 dark:bg-danger-dark dark:text-red-100"
        role="alert"
      >
        <StatusBadge
          label="Resume unavailable"
          showDot={false}
          tone="danger"
        />
        <h1
          className="mt-4 text-xl font-semibold"
          id="partner-resume-error-title"
        >
          The saved journey could not be resumed
        </h1>
        <p className="mt-2 text-sm leading-6">{pageError}</p>
        <div className="mt-5 flex flex-col gap-3 sm:flex-row">
          <Link
            className="inline-flex min-h-11 items-center justify-center rounded-lg bg-lga-navy px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-800 focus:outline-none focus:ring-2 focus:ring-lga-sky focus:ring-offset-2"
            to={ROUTES.PARTNER_DASHBOARD}
          >
            Return to partner dashboard
          </Link>
          <Link
            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-danger px-5 py-2 text-sm font-semibold transition-colors hover:bg-white/50 focus:outline-none focus:ring-2 focus:ring-danger focus:ring-offset-2 dark:hover:bg-red-950"
            to={ROUTES.JOURNEYS}
          >
            View available journeys
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section
      aria-busy="true"
      aria-labelledby="partner-resume-title"
      className="mx-auto w-full max-w-3xl rounded-xl border border-border bg-white px-5 py-12 text-center shadow-card dark:border-slate-700 dark:bg-slate-900"
    >
      <StatusBadge
        label="Validating partner access"
        showDot
        tone="info"
      />
      <h1
        className="mt-4 text-xl font-semibold text-lga-navy dark:text-white"
        id="partner-resume-title"
      >
        Resuming your onboarding journey
      </h1>
      <p
        className="mt-2 text-sm leading-6 text-text-muted dark:text-slate-300"
        role="status"
      >
        Confirming the saved journey belongs to your authorized partner scope.
      </p>
    </section>
  );
}

PartnerResumeRedirectPage.propTypes = {
  partnerDashboardService: PropTypes.shape({
    resumeJourney: PropTypes.func.isRequired,
  }),
};

export default PartnerResumeRedirectPage;