import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  canAccessRoute,
  canPerformAction,
} from '../auth/permissionPolicy.js';
import StatusBadge from '../components/shared/StatusBadge.jsx';
import {
  PERMISSIONS,
  ROLE_LABELS,
} from '../constants/roles.js';
import { ROUTES } from '../constants/routes.js';
import { useAuthStore } from '../stores/authStore.js';

const CAPABILITY_SECTIONS = Object.freeze([
  Object.freeze({
    id: 'onboarding',
    title: 'Onboarding',
    description:
      'Create, continue, validate, and review synthetic onboarding applications.',
    items: Object.freeze([
      Object.freeze({
        title: 'Start a guided journey',
        description:
          'Begin an individual, corporate, agency, or registered representative onboarding journey.',
        path: ROUTES.JOURNEY_NEW,
        permission: PERMISSIONS.CREATE_ONBOARDING,
      }),
      Object.freeze({
        title: 'Import an intake sample',
        description:
          'Exercise structured, manual, OCR, email, API, and flat-file intake scenarios.',
        path: ROUTES.INTAKE,
        permission: PERMISSIONS.CREATE_ONBOARDING,
      }),
      Object.freeze({
        title: 'View onboarding journeys',
        description:
          'Review available journey records and resume locally saved progress.',
        path: ROUTES.JOURNEYS,
        permission: PERMISSIONS.VIEW_ONBOARDING,
      }),
    ]),
  }),
  Object.freeze({
    id: 'partner',
    title: 'Partner portal',
    description:
      'Monitor partner-scoped applications, reports, and notification previews.',
    items: Object.freeze([
      Object.freeze({
        title: 'Partner dashboard',
        description:
          'View partner-scoped onboarding activity and resumable drafts.',
        path: ROUTES.PARTNER_DASHBOARD,
        permission: PERMISSIONS.VIEW_DASHBOARD,
      }),
      Object.freeze({
        title: 'Partner onboarding',
        description:
          'Search and review applications for the active partner organization.',
        path: ROUTES.PARTNER_ONBOARDING,
        permission: PERMISSIONS.VIEW_ONBOARDING,
      }),
      Object.freeze({
        title: 'Partner reports',
        description:
          'Explore synthetic partner reporting and status information.',
        path: ROUTES.PARTNER_REPORTS,
        permission: PERMISSIONS.VIEW_REPORTS,
      }),
      Object.freeze({
        title: 'Partner notifications',
        description:
          'Review safe notification previews and simulated delivery states.',
        path: ROUTES.PARTNER_NOTIFICATIONS,
        permission: PERMISSIONS.VIEW_NOTIFICATIONS,
      }),
    ]),
  }),
  Object.freeze({
    id: 'operations',
    title: 'Operations',
    description:
      'Process assigned work, resolve exceptions, and inspect operational status.',
    items: Object.freeze([
      Object.freeze({
        title: 'Operations dashboard',
        description:
          'Review operational workload and onboarding activity summaries.',
        path: ROUTES.OPERATIONS_DASHBOARD,
        permission: PERMISSIONS.VIEW_DASHBOARD,
      }),
      Object.freeze({
        title: 'Operations workbench',
        description:
          'Process appointment, background, exception, synchronization, and review work items.',
        path: ROUTES.OPERATIONS_WORKBENCH,
        permission: PERMISSIONS.VIEW_WORKBENCH,
      }),
      Object.freeze({
        title: 'Onboarding review',
        description:
          'Search onboarding records and inspect their processing context.',
        path: ROUTES.OPERATIONS_ONBOARDING,
        permission: PERMISSIONS.VIEW_ONBOARDING,
      }),
      Object.freeze({
        title: 'Exceptions',
        description:
          'Review and resolve synthetic onboarding validation exceptions.',
        path: ROUTES.OPERATIONS_EXCEPTIONS,
        permission: PERMISSIONS.RESOLVE_EXCEPTIONS,
      }),
      Object.freeze({
        title: 'Contract changes',
        description:
          'Review supported commission, hierarchy, level, and assignment changes.',
        path: ROUTES.OPERATIONS_CONTRACT_CHANGES,
        permission: PERMISSIONS.MANAGE_CONTRACT_CHANGES,
      }),
      Object.freeze({
        title: 'Operations reports',
        description:
          'Explore synthetic operational reports and lifecycle outcomes.',
        path: ROUTES.OPERATIONS_REPORTS,
        permission: PERMISSIONS.VIEW_REPORTS,
      }),
      Object.freeze({
        title: 'Operations notifications',
        description:
          'Inspect role-visible notification logs and delivery previews.',
        path: ROUTES.OPERATIONS_NOTIFICATIONS,
        permission: PERMISSIONS.VIEW_NOTIFICATIONS,
      }),
    ]),
  }),
  Object.freeze({
    id: 'administration',
    title: 'Administration',
    description:
      'Manage demo reference data, users, configuration, and diagnostics.',
    items: Object.freeze([
      Object.freeze({
        title: 'Admin dashboard',
        description:
          'Open the administration overview and configuration shortcuts.',
        path: ROUTES.ADMIN_DASHBOARD,
        permission: PERMISSIONS.VIEW_DASHBOARD,
      }),
      Object.freeze({
        title: 'Reference data',
        description:
          'Manage synthetic carriers, agencies, contracts, schedules, and providers.',
        path: ROUTES.ADMIN_REFERENCE_DATA,
        permission: PERMISSIONS.MANAGE_REFERENCE_DATA,
      }),
      Object.freeze({
        title: 'Demo users',
        description:
          'Review and manage pre-provisioned simulation identities.',
        path: ROUTES.ADMIN_USERS,
        permission: PERMISSIONS.MANAGE_USERS,
      }),
      Object.freeze({
        title: 'Application configuration',
        description:
          'Manage effective simulation settings and notification defaults.',
        path: ROUTES.ADMIN_CONFIGURATION,
        permission: PERMISSIONS.MANAGE_CONFIGURATION,
      }),
      Object.freeze({
        title: 'Diagnostics',
        description:
          'Inspect sanitized application diagnostics when the feature is enabled.',
        path: ROUTES.DIAGNOSTICS,
        permission: PERMISSIONS.VIEW_DIAGNOSTICS,
      }),
    ]),
  }),
]);

function getDisplayName(user) {
  const name = [user?.firstName, user?.lastName]
    .filter(Boolean)
    .join(' ')
    .trim();

  return name || user?.email || 'Demo user';
}

function CapabilityCard({ item }) {
  return (
    <li className="h-full">
      <Link
        className="group flex h-full min-h-44 flex-col rounded-xl border border-border bg-white p-5 shadow-card transition-all hover:-translate-y-0.5 hover:border-lga-sky hover:shadow-elevated focus:outline-none focus:ring-2 focus:ring-lga-sky focus:ring-offset-2 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-primary-400 dark:focus:ring-offset-slate-950"
        to={item.path}
      >
        <div className="flex items-start justify-between gap-4">
          <h3 className="text-base font-semibold text-lga-navy group-hover:text-lga-blue dark:text-white dark:group-hover:text-primary-200">
            {item.title}
          </h3>
          <span
            aria-hidden="true"
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-50 text-lga-blue transition-colors group-hover:bg-primary-100 dark:bg-primary-950 dark:text-primary-200"
          >
            <svg
              className="size-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              viewBox="0 0 24 24"
            >
              <path
                d="M5 12h14m-6-6 6 6-6 6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        </div>
        <p className="mt-3 flex-1 text-sm leading-6 text-text-muted dark:text-slate-300">
          {item.description}
        </p>
        <span className="mt-4 text-sm font-semibold text-lga-blue dark:text-primary-300">
          Open capability
        </span>
      </Link>
    </li>
  );
}

function CapabilitySection({ section }) {
  return (
    <section aria-labelledby={`${section.id}-capabilities-title`}>
      <div className="mb-4">
        <h2
          className="text-xl font-semibold text-lga-navy dark:text-white"
          id={`${section.id}-capabilities-title`}
        >
          {section.title}
        </h2>
        <p className="mt-1 text-sm leading-6 text-text-muted dark:text-slate-300">
          {section.description}
        </p>
      </div>
      <ul className="grid list-none gap-4 p-0 sm:grid-cols-2 xl:grid-cols-3">
        {section.items.map((item) => (
          <CapabilityCard item={item} key={item.path} />
        ))}
      </ul>
    </section>
  );
}

/**
 * Displays a role-aware overview of available demo capabilities.
 */
export function HomePage() {
  const authState = useAuthStore();
  const {
    currentUser,
    isAuthenticated,
    partnerContext,
    role: storedRole,
    user,
  } = authState;
  const currentUserValue = currentUser ?? user;
  const role = storedRole ?? currentUserValue?.role ?? null;
  const principal = useMemo(
    () => ({
      ...authState,
      user: currentUserValue,
      currentUser: currentUserValue,
      role,
      partnerContext,
      isAuthenticated,
      status: isAuthenticated ? 'authenticated' : 'anonymous',
    }),
    [
      authState,
      currentUserValue,
      isAuthenticated,
      partnerContext,
      role,
    ],
  );
  const availableSections = useMemo(
    () =>
      CAPABILITY_SECTIONS.map((section) => ({
        ...section,
        items: section.items.filter(
          (item) =>
            canPerformAction(principal, item.permission) &&
            canAccessRoute(principal, item.path, partnerContext),
        ),
      })).filter((section) => section.items.length > 0),
    [partnerContext, principal],
  );
  const capabilityCount = availableSections.reduce(
    (count, section) => count + section.items.length,
    0,
  );
  const displayName = getDisplayName(currentUserValue);
  const roleLabel = ROLE_LABELS[role] ?? 'Demo user';

  if (!isAuthenticated) {
    return (
      <section
        aria-labelledby="home-title"
        className="mx-auto max-w-3xl rounded-2xl border border-border bg-white p-6 text-center shadow-card sm:p-8 dark:border-slate-700 dark:bg-slate-900"
      >
        <h1
          className="text-2xl font-semibold text-lga-navy dark:text-white"
          id="home-title"
        >
          Digital Onboarding simulation
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-text-muted dark:text-slate-300">
          Sign in with a pre-provisioned demo identity to access role-aware
          onboarding, partner, operations, and administration capabilities.
        </p>
        <Link
          className="mt-6 inline-flex min-h-11 items-center justify-center rounded-lg bg-lga-navy px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-800 focus:outline-none focus:ring-2 focus:ring-lga-sky focus:ring-offset-2 dark:bg-primary-600 dark:hover:bg-primary-500 dark:focus:ring-offset-slate-900"
          to={ROUTES.LOGIN}
        >
          Sign in to the simulation
        </Link>
      </section>
    );
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-8">
      <section
        aria-labelledby="home-title"
        className="overflow-hidden rounded-2xl bg-lga-navy text-white shadow-elevated"
      >
        <div className="grid gap-6 px-6 py-7 sm:px-8 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <div className="flex flex-wrap gap-2">
              <StatusBadge
                label={roleLabel}
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
              id="home-title"
            >
              Welcome, {displayName}
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-primary-100 sm:text-base">
              Explore the synthetic digital onboarding capabilities available
              to your current role. No production transactions or external
              provider calls are performed.
            </p>
          </div>

          <dl className="grid min-w-56 grid-cols-2 gap-3 rounded-xl bg-white/10 p-4">
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-primary-100">
                Capabilities
              </dt>
              <dd className="mt-1 text-2xl font-semibold">
                {capabilityCount}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-primary-100">
                Areas
              </dt>
              <dd className="mt-1 text-2xl font-semibold">
                {availableSections.length}
              </dd>
            </div>
          </dl>
        </div>
      </section>

      <section
        aria-labelledby="session-context-title"
        className="rounded-xl border border-border bg-white p-5 shadow-card dark:border-slate-700 dark:bg-slate-900"
      >
        <h2
          className="text-base font-semibold text-lga-navy dark:text-white"
          id="session-context-title"
        >
          Current demo context
        </h2>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-text-muted dark:text-slate-400">
              Role
            </dt>
            <dd className="mt-1 font-semibold text-text dark:text-white">
              {roleLabel}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-text-muted dark:text-slate-400">
              Organization
            </dt>
            <dd className="mt-1 break-words font-semibold text-text dark:text-white">
              {currentUserValue?.organization ?? 'Not available'}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-text-muted dark:text-slate-400">
              Partner scope
            </dt>
            <dd className="mt-1 break-words font-semibold text-text dark:text-white">
              {partnerContext?.partnerCode ??
                partnerContext?.organization ??
                'Role-defined scope'}
            </dd>
          </div>
        </dl>
      </section>

      {availableSections.length > 0 ? (
        <div className="space-y-10">
          {availableSections.map((section) => (
            <CapabilitySection key={section.id} section={section} />
          ))}
        </div>
      ) : (
        <section
          className="rounded-xl border border-dashed border-border-strong bg-white px-5 py-10 text-center shadow-card dark:border-slate-600 dark:bg-slate-900"
          role="status"
        >
          <h2 className="font-semibold text-lga-navy dark:text-white">
            No capabilities are available
          </h2>
          <p className="mt-2 text-sm text-text-muted dark:text-slate-300">
            The current role does not have access to any configured demo
            areas. Contact an administrator to review the role configuration.
          </p>
        </section>
      )}

      <aside
        className="rounded-xl border border-accent-300 bg-accent-100 p-5 text-sm leading-6 text-accent-950 dark:border-accent-700 dark:bg-accent-950 dark:text-accent-100"
        role="note"
      >
        <p className="font-semibold">Synthetic data only</p>
        <p className="mt-1">
          Use fictitious identities, banking details, documents, and contact
          information throughout this application. Downloads and provider
          results are simulated artifacts.
        </p>
      </aside>
    </div>
  );
}

export default HomePage;