import { useEffect } from 'react';
import {
  createBrowserRouter,
  Navigate,
} from 'react-router-dom';
import ProtectedRoute from './components/auth/ProtectedRoute.jsx';
import AppShell from './components/layout/AppShell.jsx';
import {
  ALL_ROLES,
  EXTERNAL_ROLES,
  INTERNAL_ROLES,
  PERMISSIONS,
  ROLES,
} from './constants/roles.js';
import { ROUTES } from './constants/routes.js';
import HomePage from './pages/HomePage.jsx';
import NotFoundPage from './pages/NotFoundPage.jsx';
import DiagnosticsPage from './pages/admin/DiagnosticsPage.jsx';
import GAConfigurationPage from './pages/admin/GAConfigurationPage.jsx';
import LoginPage from './pages/auth/LoginPage.jsx';
import UnauthorizedPage from './pages/auth/UnauthorizedPage.jsx';
import ApiSubmissionPage from './pages/onboarding/ApiSubmissionPage.jsx';
import IntakePage from './pages/onboarding/IntakePage.jsx';
import JourneyReviewPage from './pages/onboarding/JourneyReviewPage.jsx';
import JourneySplashPage from './pages/onboarding/JourneySplashPage.jsx';
import JourneyStepPage from './pages/onboarding/JourneyStepPage.jsx';
import JourneyThankYouPage from './pages/onboarding/JourneyThankYouPage.jsx';
import AuditHistoryPage from './pages/operations/AuditHistoryPage.jsx';
import ContractChangesPage from './pages/operations/ContractChangesPage.jsx';
import LifecycleDetailPage from './pages/operations/LifecycleDetailPage.jsx';
import NotificationLogPage from './pages/operations/NotificationLogPage.jsx';
import OperationsWorkbenchPage from './pages/operations/OperationsWorkbenchPage.jsx';
import SyncStatusPage from './pages/operations/SyncStatusPage.jsx';
import PartnerDashboardPage from './pages/partner/PartnerDashboardPage.jsx';
import PartnerResumeRedirectPage from './pages/partner/PartnerResumeRedirectPage.jsx';
import PartnerStatusExplorerPage from './pages/partner/PartnerStatusExplorerPage.jsx';
import { useAuthStore } from './stores/authStore.js';

const ADMIN_ROLES = Object.freeze([ROLES.ADMIN]);

const ROUTE_AREAS = Object.freeze({
  ADMIN: 'administration',
  AUTHENTICATION: 'authentication',
  JOURNEY: 'journey',
  ONBOARDING: 'onboarding',
  OPERATIONS: 'operations',
  PARTNER: 'partner',
  PUBLIC: 'public',
});

function routeHandle({
  area,
  permission = null,
  roles = [],
  story = null,
  title,
}) {
  return Object.freeze({
    area,
    permission,
    roles: Object.freeze([...roles]),
    story,
    title,
  });
}

function ProtectedPage({
  children,
  permission,
  roles = ALL_ROLES,
  requirePartnerScope = false,
}) {
  return (
    <ProtectedRoute
      allowedRoles={roles}
      permission={permission}
      requirePartnerScope={requirePartnerScope}
    >
      {children}
    </ProtectedRoute>
  );
}

function LogoutRoute() {
  const logout = useAuthStore((state) => state.logout);

  useEffect(() => {
    if (typeof logout === 'function') {
      logout();
    }
  }, [logout]);

  return (
    <Navigate
      replace
      state={{ reason: 'signed_out' }}
      to={ROUTES.LOGIN}
    />
  );
}

const protectedRoutes = [
  {
    index: true,
    element: (
      <ProtectedPage permission={PERMISSIONS.VIEW_DASHBOARD}>
        <HomePage />
      </ProtectedPage>
    ),
    handle: routeHandle({
      area: ROUTE_AREAS.ONBOARDING,
      permission: PERMISSIONS.VIEW_DASHBOARD,
      roles: ALL_ROLES,
      title: 'Digital Onboarding',
    }),
  },
  {
    path: 'logout',
    element: <LogoutRoute />,
    handle: routeHandle({
      area: ROUTE_AREAS.AUTHENTICATION,
      roles: ALL_ROLES,
      title: 'Sign out',
    }),
  },
  {
    path: 'intake',
    element: (
      <ProtectedPage permission={PERMISSIONS.CREATE_ONBOARDING}>
        <IntakePage />
      </ProtectedPage>
    ),
    handle: routeHandle({
      area: ROUTE_AREAS.ONBOARDING,
      permission: PERMISSIONS.CREATE_ONBOARDING,
      roles: ALL_ROLES,
      story: 'SCRUM-1332',
      title: 'Intake and mock submission',
    }),
  },
  {
    path: 'intake/new',
    element: (
      <ProtectedPage permission={PERMISSIONS.CREATE_ONBOARDING}>
        <IntakePage />
      </ProtectedPage>
    ),
    handle: routeHandle({
      area: ROUTE_AREAS.ONBOARDING,
      permission: PERMISSIONS.CREATE_ONBOARDING,
      roles: ALL_ROLES,
      story: 'SCRUM-1332',
      title: 'New intake submission',
    }),
  },
  {
    path: 'intake/:intakeId',
    element: (
      <ProtectedPage permission={PERMISSIONS.VIEW_ONBOARDING}>
        <IntakePage />
      </ProtectedPage>
    ),
    handle: routeHandle({
      area: ROUTE_AREAS.ONBOARDING,
      permission: PERMISSIONS.VIEW_ONBOARDING,
      roles: ALL_ROLES,
      story: 'SCRUM-1332',
      title: 'Intake details',
    }),
  },
  {
    path: 'mock-api/onboarding',
    element: (
      <ProtectedPage permission={PERMISSIONS.CREATE_ONBOARDING}>
        <ApiSubmissionPage />
      </ProtectedPage>
    ),
    handle: routeHandle({
      area: ROUTE_AREAS.ONBOARDING,
      permission: PERMISSIONS.CREATE_ONBOARDING,
      roles: ALL_ROLES,
      story: 'SCRUM-1332',
      title: 'Generic onboarding API submission',
    }),
  },
  {
    path: 'journeys',
    element: (
      <ProtectedPage permission={PERMISSIONS.VIEW_ONBOARDING}>
        <HomePage />
      </ProtectedPage>
    ),
    handle: routeHandle({
      area: ROUTE_AREAS.JOURNEY,
      permission: PERMISSIONS.VIEW_ONBOARDING,
      roles: ALL_ROLES,
      title: 'Onboarding journeys',
    }),
  },
  {
    path: 'journeys/new',
    element: (
      <ProtectedPage permission={PERMISSIONS.CREATE_ONBOARDING}>
        <JourneySplashPage />
      </ProtectedPage>
    ),
    handle: routeHandle({
      area: ROUTE_AREAS.JOURNEY,
      permission: PERMISSIONS.CREATE_ONBOARDING,
      roles: ALL_ROLES,
      title: 'Start a guided journey',
    }),
  },
  {
    path: 'journeys/agent-contracting',
    element: (
      <ProtectedPage permission={PERMISSIONS.CREATE_ONBOARDING}>
        <JourneySplashPage journeyType="agent_contracting" />
      </ProtectedPage>
    ),
    handle: routeHandle({
      area: ROUTE_AREAS.JOURNEY,
      permission: PERMISSIONS.CREATE_ONBOARDING,
      roles: ALL_ROLES,
      title: 'Individual producer onboarding',
    }),
  },
  {
    path: 'journeys/registered-representative',
    element: (
      <ProtectedPage permission={PERMISSIONS.CREATE_ONBOARDING}>
        <JourneySplashPage journeyType="registered_rep" />
      </ProtectedPage>
    ),
    handle: routeHandle({
      area: ROUTE_AREAS.JOURNEY,
      permission: PERMISSIONS.CREATE_ONBOARDING,
      roles: ALL_ROLES,
      title: 'Registered representative onboarding',
    }),
  },
  {
    path: 'journeys/corporate',
    element: (
      <ProtectedPage permission={PERMISSIONS.CREATE_ONBOARDING}>
        <JourneySplashPage journeyType="corporate" />
      </ProtectedPage>
    ),
    handle: routeHandle({
      area: ROUTE_AREAS.JOURNEY,
      permission: PERMISSIONS.CREATE_ONBOARDING,
      roles: ALL_ROLES,
      title: 'Corporate onboarding',
    }),
  },
  {
    path: 'journeys/ga-agency',
    element: (
      <ProtectedPage permission={PERMISSIONS.CREATE_ONBOARDING}>
        <JourneySplashPage journeyType="ga_agency" />
      </ProtectedPage>
    ),
    handle: routeHandle({
      area: ROUTE_AREAS.JOURNEY,
      permission: PERMISSIONS.CREATE_ONBOARDING,
      roles: ALL_ROLES,
      title: 'General agency onboarding',
    }),
  },
  {
    path: 'journeys/:journeyId/review',
    element: (
      <ProtectedPage permission={PERMISSIONS.VIEW_ONBOARDING}>
        <JourneyReviewPage />
      </ProtectedPage>
    ),
    handle: routeHandle({
      area: ROUTE_AREAS.JOURNEY,
      permission: PERMISSIONS.VIEW_ONBOARDING,
      roles: ALL_ROLES,
      story: 'SCRUM-1335',
      title: 'Review onboarding journey',
    }),
  },
  {
    path: 'journeys/:journeyId/complete',
    element: (
      <ProtectedPage permission={PERMISSIONS.VIEW_ONBOARDING}>
        <JourneyThankYouPage />
      </ProtectedPage>
    ),
    handle: routeHandle({
      area: ROUTE_AREAS.JOURNEY,
      permission: PERMISSIONS.VIEW_ONBOARDING,
      roles: ALL_ROLES,
      story: 'SCRUM-1335',
      title: 'Journey confirmation',
    }),
  },
  {
    path: 'journeys/:journeyId/thank-you',
    element: (
      <ProtectedPage permission={PERMISSIONS.VIEW_ONBOARDING}>
        <JourneyThankYouPage />
      </ProtectedPage>
    ),
    handle: routeHandle({
      area: ROUTE_AREAS.JOURNEY,
      permission: PERMISSIONS.VIEW_ONBOARDING,
      roles: ALL_ROLES,
      story: 'SCRUM-1335',
      title: 'Journey confirmation',
    }),
  },
  {
    path: 'journeys/:journeyId',
    element: (
      <ProtectedPage permission={PERMISSIONS.VIEW_ONBOARDING}>
        <JourneyStepPage />
      </ProtectedPage>
    ),
    handle: routeHandle({
      area: ROUTE_AREAS.JOURNEY,
      permission: PERMISSIONS.VIEW_ONBOARDING,
      roles: ALL_ROLES,
      title: 'Guided journey',
    }),
  },
  {
    path: 'journeys/:journeyType/:trackingId/:stepId',
    element: (
      <ProtectedPage permission={PERMISSIONS.VIEW_ONBOARDING}>
        <JourneyStepPage />
      </ProtectedPage>
    ),
    handle: routeHandle({
      area: ROUTE_AREAS.JOURNEY,
      permission: PERMISSIONS.VIEW_ONBOARDING,
      roles: ALL_ROLES,
      title: 'Guided journey step',
    }),
  },
  {
    path: 'partner',
    element: <Navigate replace to={ROUTES.PARTNER_DASHBOARD} />,
    handle: routeHandle({
      area: ROUTE_AREAS.PARTNER,
      permission: PERMISSIONS.VIEW_DASHBOARD,
      roles: EXTERNAL_ROLES,
      title: 'Partner portal',
    }),
  },
  {
    path: 'partner/dashboard',
    element: (
      <ProtectedPage
        permission={PERMISSIONS.VIEW_DASHBOARD}
        requirePartnerScope
        roles={EXTERNAL_ROLES}
      >
        <PartnerDashboardPage />
      </ProtectedPage>
    ),
    handle: routeHandle({
      area: ROUTE_AREAS.PARTNER,
      permission: PERMISSIONS.VIEW_DASHBOARD,
      roles: EXTERNAL_ROLES,
      title: 'Partner dashboard',
    }),
  },
  {
    path: 'partner/onboarding',
    element: (
      <ProtectedPage
        permission={PERMISSIONS.VIEW_ONBOARDING}
        requirePartnerScope
        roles={EXTERNAL_ROLES}
      >
        <PartnerStatusExplorerPage />
      </ProtectedPage>
    ),
    handle: routeHandle({
      area: ROUTE_AREAS.PARTNER,
      permission: PERMISSIONS.VIEW_ONBOARDING,
      roles: EXTERNAL_ROLES,
      title: 'Partner onboarding status',
    }),
  },
  {
    path: 'partner/onboarding/:trackingId/resume',
    element: (
      <ProtectedPage
        permission={PERMISSIONS.UPDATE_ONBOARDING}
        requirePartnerScope
        roles={EXTERNAL_ROLES}
      >
        <PartnerResumeRedirectPage />
      </ProtectedPage>
    ),
    handle: routeHandle({
      area: ROUTE_AREAS.PARTNER,
      permission: PERMISSIONS.UPDATE_ONBOARDING,
      roles: EXTERNAL_ROLES,
      title: 'Resume partner onboarding',
    }),
  },
  {
    path: 'partner/onboarding/:applicationId',
    element: (
      <ProtectedPage
        permission={PERMISSIONS.VIEW_ONBOARDING}
        requirePartnerScope
        roles={EXTERNAL_ROLES}
      >
        <LifecycleDetailPage />
      </ProtectedPage>
    ),
    handle: routeHandle({
      area: ROUTE_AREAS.PARTNER,
      permission: PERMISSIONS.VIEW_ONBOARDING,
      roles: EXTERNAL_ROLES,
      story: 'SCRUM-1340',
      title: 'Partner onboarding details',
    }),
  },
  {
    path: 'partner/reports',
    element: (
      <ProtectedPage
        permission={PERMISSIONS.VIEW_REPORTS}
        requirePartnerScope
        roles={EXTERNAL_ROLES}
      >
        <PartnerStatusExplorerPage />
      </ProtectedPage>
    ),
    handle: routeHandle({
      area: ROUTE_AREAS.PARTNER,
      permission: PERMISSIONS.VIEW_REPORTS,
      roles: EXTERNAL_ROLES,
      title: 'Partner reports',
    }),
  },
  {
    path: 'partner/notifications',
    element: (
      <ProtectedPage
        permission={PERMISSIONS.VIEW_NOTIFICATIONS}
        requirePartnerScope
        roles={EXTERNAL_ROLES}
      >
        <NotificationLogPage />
      </ProtectedPage>
    ),
    handle: routeHandle({
      area: ROUTE_AREAS.PARTNER,
      permission: PERMISSIONS.VIEW_NOTIFICATIONS,
      roles: EXTERNAL_ROLES,
      title: 'Partner notifications',
    }),
  },
  {
    path: 'operations',
    element: <Navigate replace to={ROUTES.OPERATIONS_DASHBOARD} />,
    handle: routeHandle({
      area: ROUTE_AREAS.OPERATIONS,
      permission: PERMISSIONS.VIEW_OPERATIONS,
      roles: INTERNAL_ROLES,
      title: 'Operations',
    }),
  },
  {
    path: 'operations/dashboard',
    element: (
      <ProtectedPage
        permission={PERMISSIONS.VIEW_DASHBOARD}
        roles={INTERNAL_ROLES}
      >
        <HomePage />
      </ProtectedPage>
    ),
    handle: routeHandle({
      area: ROUTE_AREAS.OPERATIONS,
      permission: PERMISSIONS.VIEW_DASHBOARD,
      roles: INTERNAL_ROLES,
      title: 'Operations dashboard',
    }),
  },
  {
    path: 'operations/workbench',
    element: (
      <ProtectedPage
        permission={PERMISSIONS.VIEW_WORKBENCH}
        roles={INTERNAL_ROLES}
      >
        <OperationsWorkbenchPage />
      </ProtectedPage>
    ),
    handle: routeHandle({
      area: ROUTE_AREAS.OPERATIONS,
      permission: PERMISSIONS.VIEW_WORKBENCH,
      roles: INTERNAL_ROLES,
      story: 'SCRUM-1338',
      title: 'Operations workbench',
    }),
  },
  {
    path: 'operations/workbench/:workItemId',
    element: (
      <ProtectedPage
        permission={PERMISSIONS.VIEW_WORKBENCH}
        roles={INTERNAL_ROLES}
      >
        <OperationsWorkbenchPage />
      </ProtectedPage>
    ),
    handle: routeHandle({
      area: ROUTE_AREAS.OPERATIONS,
      permission: PERMISSIONS.VIEW_WORKBENCH,
      roles: INTERNAL_ROLES,
      story: 'SCRUM-1338',
      title: 'Operational work item',
    }),
  },
  {
    path: 'operations/onboarding',
    element: (
      <ProtectedPage
        permission={PERMISSIONS.VIEW_ONBOARDING}
        roles={INTERNAL_ROLES}
      >
        <PartnerStatusExplorerPage />
      </ProtectedPage>
    ),
    handle: routeHandle({
      area: ROUTE_AREAS.OPERATIONS,
      permission: PERMISSIONS.VIEW_ONBOARDING,
      roles: INTERNAL_ROLES,
      title: 'Operations onboarding',
    }),
  },
  {
    path: 'operations/onboarding/:applicationId',
    element: (
      <ProtectedPage
        permission={PERMISSIONS.VIEW_ONBOARDING}
        roles={INTERNAL_ROLES}
      >
        <LifecycleDetailPage />
      </ProtectedPage>
    ),
    handle: routeHandle({
      area: ROUTE_AREAS.OPERATIONS,
      permission: PERMISSIONS.VIEW_ONBOARDING,
      roles: INTERNAL_ROLES,
      story: 'SCRUM-1340',
      title: 'Onboarding lifecycle details',
    }),
  },
  {
    path: 'operations/exceptions',
    element: (
      <ProtectedPage
        permission={PERMISSIONS.RESOLVE_EXCEPTIONS}
        roles={INTERNAL_ROLES}
      >
        <OperationsWorkbenchPage />
      </ProtectedPage>
    ),
    handle: routeHandle({
      area: ROUTE_AREAS.OPERATIONS,
      permission: PERMISSIONS.RESOLVE_EXCEPTIONS,
      roles: INTERNAL_ROLES,
      title: 'Operations exceptions',
    }),
  },
  {
    path: 'operations/contract-changes',
    element: (
      <ProtectedPage
        permission={PERMISSIONS.MANAGE_CONTRACT_CHANGES}
        roles={INTERNAL_ROLES}
      >
        <ContractChangesPage />
      </ProtectedPage>
    ),
    handle: routeHandle({
      area: ROUTE_AREAS.OPERATIONS,
      permission: PERMISSIONS.MANAGE_CONTRACT_CHANGES,
      roles: INTERNAL_ROLES,
      story: 'SCRUM-1343',
      title: 'Contract changes',
    }),
  },
  {
    path: 'operations/reports',
    element: (
      <ProtectedPage
        permission={PERMISSIONS.VIEW_REPORTS}
        roles={INTERNAL_ROLES}
      >
        <SyncStatusPage />
      </ProtectedPage>
    ),
    handle: routeHandle({
      area: ROUTE_AREAS.OPERATIONS,
      permission: PERMISSIONS.VIEW_REPORTS,
      roles: INTERNAL_ROLES,
      story: 'SCRUM-1342',
      title: 'Operations reports',
    }),
  },
  {
    path: 'operations/reports/audit',
    element: (
      <ProtectedPage
        permission={PERMISSIONS.VIEW_ONBOARDING}
        roles={INTERNAL_ROLES}
      >
        <AuditHistoryPage />
      </ProtectedPage>
    ),
    handle: routeHandle({
      area: ROUTE_AREAS.OPERATIONS,
      permission: PERMISSIONS.VIEW_ONBOARDING,
      roles: INTERNAL_ROLES,
      story: 'SCRUM-1340',
      title: 'Operational audit history',
    }),
  },
  {
    path: 'operations/sync-status',
    element: (
      <ProtectedPage
        permission={PERMISSIONS.VIEW_ONBOARDING}
        roles={INTERNAL_ROLES}
      >
        <SyncStatusPage />
      </ProtectedPage>
    ),
    handle: routeHandle({
      area: ROUTE_AREAS.OPERATIONS,
      permission: PERMISSIONS.VIEW_ONBOARDING,
      roles: INTERNAL_ROLES,
      story: 'SCRUM-1342',
      title: 'Synchronization status',
    }),
  },
  {
    path: 'operations/notifications',
    element: (
      <ProtectedPage
        permission={PERMISSIONS.VIEW_NOTIFICATIONS}
        roles={INTERNAL_ROLES}
      >
        <NotificationLogPage />
      </ProtectedPage>
    ),
    handle: routeHandle({
      area: ROUTE_AREAS.OPERATIONS,
      permission: PERMISSIONS.VIEW_NOTIFICATIONS,
      roles: INTERNAL_ROLES,
      title: 'Operations notifications',
    }),
  },
  {
    path: 'admin',
    element: <Navigate replace to={ROUTES.ADMIN_DASHBOARD} />,
    handle: routeHandle({
      area: ROUTE_AREAS.ADMIN,
      permission: PERMISSIONS.MANAGE_CONFIGURATION,
      roles: ADMIN_ROLES,
      title: 'Administration',
    }),
  },
  {
    path: 'admin/dashboard',
    element: (
      <ProtectedPage
        permission={PERMISSIONS.VIEW_DASHBOARD}
        roles={ADMIN_ROLES}
      >
        <HomePage />
      </ProtectedPage>
    ),
    handle: routeHandle({
      area: ROUTE_AREAS.ADMIN,
      permission: PERMISSIONS.VIEW_DASHBOARD,
      roles: ADMIN_ROLES,
      title: 'Administration dashboard',
    }),
  },
  {
    path: 'admin/reference-data',
    element: (
      <ProtectedPage
        permission={PERMISSIONS.MANAGE_REFERENCE_DATA}
        roles={ADMIN_ROLES}
      >
        <GAConfigurationPage />
      </ProtectedPage>
    ),
    handle: routeHandle({
      area: ROUTE_AREAS.ADMIN,
      permission: PERMISSIONS.MANAGE_REFERENCE_DATA,
      roles: ADMIN_ROLES,
      story: 'SCRUM-1344',
      title: 'Reference data',
    }),
  },
  {
    path: 'admin/users',
    element: (
      <ProtectedPage
        permission={PERMISSIONS.MANAGE_USERS}
        roles={ADMIN_ROLES}
      >
        <HomePage />
      </ProtectedPage>
    ),
    handle: routeHandle({
      area: ROUTE_AREAS.ADMIN,
      permission: PERMISSIONS.MANAGE_USERS,
      roles: ADMIN_ROLES,
      story: 'SCRUM-1345',
      title: 'Demo users',
    }),
  },
  {
    path: 'admin/users/:userId',
    element: (
      <ProtectedPage
        permission={PERMISSIONS.MANAGE_USERS}
        roles={ADMIN_ROLES}
      >
        <HomePage />
      </ProtectedPage>
    ),
    handle: routeHandle({
      area: ROUTE_AREAS.ADMIN,
      permission: PERMISSIONS.MANAGE_USERS,
      roles: ADMIN_ROLES,
      story: 'SCRUM-1345',
      title: 'Demo user details',
    }),
  },
  {
    path: 'admin/configuration',
    element: (
      <ProtectedPage
        permission={PERMISSIONS.MANAGE_CONFIGURATION}
        roles={ADMIN_ROLES}
      >
        <GAConfigurationPage />
      </ProtectedPage>
    ),
    handle: routeHandle({
      area: ROUTE_AREAS.ADMIN,
      permission: PERMISSIONS.MANAGE_CONFIGURATION,
      roles: ADMIN_ROLES,
      story: 'SCRUM-1346',
      title: 'Application configuration',
    }),
  },
  {
    path: 'admin/configuration/general-agencies',
    element: (
      <ProtectedPage
        permission={PERMISSIONS.MANAGE_CONFIGURATION}
        roles={ADMIN_ROLES}
      >
        <GAConfigurationPage />
      </ProtectedPage>
    ),
    handle: routeHandle({
      area: ROUTE_AREAS.ADMIN,
      permission: PERMISSIONS.MANAGE_CONFIGURATION,
      roles: ADMIN_ROLES,
      story: 'SCRUM-1346',
      title: 'General agency configuration',
    }),
  },
  {
    path: 'diagnostics',
    element: (
      <ProtectedPage
        permission={PERMISSIONS.VIEW_DIAGNOSTICS}
        roles={ADMIN_ROLES}
      >
        <DiagnosticsPage />
      </ProtectedPage>
    ),
    handle: routeHandle({
      area: ROUTE_AREAS.ADMIN,
      permission: PERMISSIONS.VIEW_DIAGNOSTICS,
      roles: ADMIN_ROLES,
      title: 'Diagnostics',
    }),
  },
];

export const routeDefinitions = [
  {
    path: ROUTES.LOGIN,
    element: <LoginPage />,
    handle: routeHandle({
      area: ROUTE_AREAS.AUTHENTICATION,
      title: 'Sign in',
    }),
  },
  {
    path: ROUTES.UNAUTHORIZED,
    element: <UnauthorizedPage />,
    handle: routeHandle({
      area: ROUTE_AREAS.PUBLIC,
      title: 'Unauthorized',
    }),
  },
  {
    path: ROUTES.FORBIDDEN,
    element: <UnauthorizedPage />,
    handle: routeHandle({
      area: ROUTE_AREAS.PUBLIC,
      title: 'Access denied',
    }),
  },
  {
    path: ROUTES.NOT_FOUND,
    element: <NotFoundPage />,
    handle: routeHandle({
      area: ROUTE_AREAS.PUBLIC,
      title: 'Page not found',
    }),
  },
  {
    path: ROUTES.ERROR,
    element: <NotFoundPage />,
    handle: routeHandle({
      area: ROUTE_AREAS.PUBLIC,
      title: 'Application error',
    }),
  },
  {
    path: ROUTES.ROOT,
    element: (
      <ProtectedRoute>
        <AppShell />
      </ProtectedRoute>
    ),
    children: protectedRoutes,
  },
  {
    path: ROUTES.CATCH_ALL,
    element: <NotFoundPage />,
    handle: routeHandle({
      area: ROUTE_AREAS.PUBLIC,
      title: 'Page not found',
    }),
  },
];

export function createAppRouter() {
  return createBrowserRouter(routeDefinitions);
}

export const router = createAppRouter();

export default router;