import { useMemo } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import DataTable from '../../components/shared/DataTable.jsx';
import MaskedValue, {
  MASKED_VALUE_KINDS,
} from '../../components/shared/MaskedValue.jsx';
import StatusBadge from '../../components/shared/StatusBadge.jsx';
import {
  ROLE_LABELS,
  ROLE_PARTNER_SCOPE_MATRIX,
  ROLE_PERMISSION_MATRIX,
} from '../../constants/roles.js';
import {
  getAdminUserRoute,
  ROUTES,
} from '../../constants/routes.js';
import { getSeeds } from '../../persistence/seedLoader.js';

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

function getDisplayName(user) {
  const name = [user?.firstName, user?.lastName]
    .filter(Boolean)
    .join(' ')
    .trim();

  return name || user?.email || 'Demo user';
}

function getUsers() {
  const seededUsers = getSeeds().users;
  return Array.isArray(seededUsers) ? seededUsers : [];
}

function UserDetail({ user }) {
  const permissions = ROLE_PERMISSION_MATRIX[user.role] ?? [];
  const scope =
    ROLE_PARTNER_SCOPE_MATRIX[user.role] ?? 'Not configured';

  return (
    <div className="space-y-6">
      <div>
        <Link
          className="text-sm font-semibold text-lga-blue hover:underline focus:outline-none focus:ring-2 focus:ring-lga-sky focus:ring-offset-2"
          to={ROUTES.ADMIN_USERS}
        >
          Back to demo users
        </Link>
        <h1
          className="mt-3 text-2xl font-semibold text-lga-navy dark:text-white"
          id="admin-user-title"
        >
          {getDisplayName(user)}
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-text-muted dark:text-slate-300">
          Pre-provisioned simulation identity. Status changes are not
          persisted because these identities are fixture-backed demo users
          only.
        </p>
      </div>

      <section
        aria-labelledby="user-profile-title"
        className="rounded-xl border border-border bg-white p-5 shadow-card dark:border-slate-700 dark:bg-slate-900"
      >
        <h2
          className="text-base font-semibold text-lga-navy dark:text-white"
          id="user-profile-title"
        >
          Identity
        </h2>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-text-muted">
              User ID
            </dt>
            <dd className="mt-1 font-mono text-sm">{user.id}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-text-muted">
              Role
            </dt>
            <dd className="mt-1 font-semibold">
              {ROLE_LABELS[user.role] ?? user.role}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-text-muted">
              Status
            </dt>
            <dd className="mt-1">
              <StatusBadge
                label={formatToken(user.status)}
                tone={user.status === 'active' ? 'success' : 'warning'}
              />
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-text-muted">
              Organization
            </dt>
            <dd className="mt-1 font-semibold">{user.organization}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-text-muted">
              Demo email
            </dt>
            <dd className="mt-1">
              <MaskedValue
                kind={MASKED_VALUE_KINDS.EMAIL}
                value={user.email}
              />
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-text-muted">
              Record scope
            </dt>
            <dd className="mt-1 font-semibold">{formatToken(scope)}</dd>
          </div>
        </dl>
      </section>

      <section
        aria-labelledby="user-permissions-title"
        className="rounded-xl border border-border bg-white p-5 shadow-card dark:border-slate-700 dark:bg-slate-900"
      >
        <h2
          className="text-base font-semibold text-lga-navy dark:text-white"
          id="user-permissions-title"
        >
          Simulated permissions
        </h2>
        <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {permissions.map((permission) => (
            <li
              className="rounded-lg bg-surface-muted px-3 py-2 text-sm dark:bg-slate-800"
              key={permission}
            >
              {formatToken(permission)}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/**
 * Lists and displays pre-provisioned demo identities for administrators.
 */
export function UsersAdminPage() {
  const { userId } = useParams();
  const navigate = useNavigate();
  const users = useMemo(() => getUsers(), []);
  const selectedUser = useMemo(
    () => users.find((user) => user.id === userId) ?? null,
    [userId, users],
  );
  const columns = useMemo(
    () => [
      {
        id: 'name',
        header: 'Name',
        accessor: (row) => getDisplayName(row),
      },
      {
        id: 'role',
        header: 'Role',
        accessor: (row) => ROLE_LABELS[row.role] ?? row.role,
      },
      {
        id: 'organization',
        header: 'Organization',
        accessorKey: 'organization',
      },
      {
        id: 'status',
        header: 'Status',
        accessorKey: 'status',
        render: (value) => (
          <StatusBadge
            label={formatToken(value)}
            tone={value === 'active' ? 'success' : 'warning'}
          />
        ),
      },
    ],
    [],
  );

  if (userId && !selectedUser) {
    return (
      <section className="rounded-xl border border-danger bg-white p-6 shadow-card dark:bg-slate-900">
        <h1 className="text-2xl font-semibold text-lga-navy dark:text-white">
          Demo user not found
        </h1>
        <p className="mt-2 text-sm text-text-muted">
          The requested simulation identity is not in the fixture catalog.
        </p>
        <Link
          className="mt-4 inline-flex min-h-11 items-center text-sm font-semibold text-lga-blue hover:underline"
          to={ROUTES.ADMIN_USERS}
        >
          Return to demo users
        </Link>
      </section>
    );
  }

  if (selectedUser) {
    return <UserDetail user={selectedUser} />;
  }

  return (
    <div className="space-y-6">
      <section aria-labelledby="admin-users-title">
        <h1
          className="text-2xl font-semibold text-lga-navy dark:text-white"
          id="admin-users-title"
        >
          Demo users
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-text-muted dark:text-slate-300">
          Review pre-provisioned partner, agency, licensing, operations, and
          administrator identities. These users are used only for mock login
          and role-based UI gating.
        </p>
      </section>

      <DataTable
        aria-label="Demo users"
        columns={columns}
        data={users}
        emptyMessage="No demo identities are available."
        getRowId={(row) => row.id}
        onRowClick={(row) => navigate(getAdminUserRoute(row.id))}
        rowActions={[
          {
            label: 'View',
            onClick: (row) => navigate(getAdminUserRoute(row.id)),
          },
        ]}
      />
    </div>
  );
}

export default UsersAdminPage;
