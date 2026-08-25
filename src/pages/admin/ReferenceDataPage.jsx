import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import DataTable from '../../components/shared/DataTable.jsx';
import StatusBadge from '../../components/shared/StatusBadge.jsx';
import { ROUTES } from '../../constants/routes.js';
import { getSeeds } from '../../persistence/seedLoader.js';

const CATALOGS = Object.freeze([
  {
    id: 'carriers',
    label: 'Carriers',
    description: 'Banner Life and William Penn carrier records used by journeys.',
  },
  {
    id: 'generalAgencies',
    label: 'General agencies',
    description: 'Fixture-backed GA codes available for contracting.',
  },
  {
    id: 'agencyTypes',
    label: 'Agency types',
    description: 'Traditional, IMO, BGA, and direct agency classifications.',
  },
  {
    id: 'contracts',
    label: 'Contract types',
    description: 'Producer, agency, solicitor, and referral contract catalogs.',
  },
  {
    id: 'levels',
    label: 'Levels',
    description: 'Hierarchy ranks used for code generation and validation.',
  },
  {
    id: 'schedules',
    label: 'Commission schedules',
    description: 'Schedules presented in GA-configured contracting selections.',
  },
  {
    id: 'providers',
    label: 'Providers',
    description: 'Mock NIPR, GIACT, BIG, Sircon, LIMRA, and related vendors.',
  },
]);

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

function getCatalogRows(referenceConfig, catalogId) {
  const value = referenceConfig?.[catalogId];
  return Array.isArray(value) ? value : [];
}

function createColumns(rows) {
  const sample = rows[0] ?? {};
  const preferred = [
    'code',
    'name',
    'type',
    'description',
    'rank',
    'services',
    'status',
  ];
  const keys = preferred.filter((key) =>
    Object.prototype.hasOwnProperty.call(sample, key),
  );

  if (keys.length === 0) {
    return [
      {
        id: 'value',
        header: 'Value',
        accessor: (row) => JSON.stringify(row),
      },
    ];
  }

  return keys.map((key) => ({
    id: key,
    header: formatToken(key),
    accessor: (row) =>
      Array.isArray(row[key]) ? row[key].join(', ') : row[key],
    render:
      key === 'status'
        ? (value) => (
            <StatusBadge
              label={formatToken(value)}
              tone={value === 'active' ? 'success' : 'neutral'}
            />
          )
        : undefined,
  }));
}

/**
 * Displays fixture-backed reference catalogs used by onboarding simulation.
 */
export function ReferenceDataPage() {
  const [activeCatalog, setActiveCatalog] = useState(CATALOGS[0].id);
  const referenceConfig = useMemo(
    () => getSeeds().referenceConfig ?? {},
    [],
  );
  const rows = useMemo(
    () => getCatalogRows(referenceConfig, activeCatalog),
    [activeCatalog, referenceConfig],
  );
  const columns = useMemo(() => createColumns(rows), [rows]);
  const activeDefinition =
    CATALOGS.find((catalog) => catalog.id === activeCatalog) ?? CATALOGS[0];

  return (
    <div className="space-y-6">
      <section aria-labelledby="reference-data-title">
        <h1
          className="text-2xl font-semibold text-lga-navy dark:text-white"
          id="reference-data-title"
        >
          Reference data
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-text-muted dark:text-slate-300">
          Browse the synthetic carriers, agencies, contracts, schedules, and
          providers that drive validation and journey configuration. GA-specific
          overrides are maintained on the configuration screen.
        </p>
        <Link
          className="mt-4 inline-flex min-h-11 items-center text-sm font-semibold text-lga-blue hover:underline focus:outline-none focus:ring-2 focus:ring-lga-sky focus:ring-offset-2"
          to={ROUTES.ADMIN_CONFIGURATION}
        >
          Open GA configuration
        </Link>
      </section>

      <div
        aria-label="Reference catalogs"
        className="flex flex-wrap gap-2"
        role="tablist"
      >
        {CATALOGS.map((catalog) => {
          const selected = catalog.id === activeCatalog;

          return (
            <button
              aria-selected={selected}
              className={`inline-flex min-h-11 items-center rounded-lg px-4 py-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-lga-sky focus:ring-offset-2 ${
                selected
                  ? 'bg-lga-navy text-white'
                  : 'border border-border bg-white text-lga-navy hover:bg-surface-muted dark:border-slate-600 dark:bg-slate-900 dark:text-white'
              }`}
              key={catalog.id}
              onClick={() => setActiveCatalog(catalog.id)}
              role="tab"
              type="button"
            >
              {catalog.label}
            </button>
          );
        })}
      </div>

      <section
        aria-labelledby="reference-catalog-title"
        className="rounded-xl border border-border bg-white p-5 shadow-card dark:border-slate-700 dark:bg-slate-900"
      >
        <h2
          className="text-base font-semibold text-lga-navy dark:text-white"
          id="reference-catalog-title"
        >
          {activeDefinition.label}
        </h2>
        <p className="mt-1 text-sm text-text-muted dark:text-slate-300">
          {activeDefinition.description}
        </p>
        <div className="mt-4">
          <DataTable
            aria-label={activeDefinition.label}
            columns={columns}
            data={rows}
            emptyMessage="No fixture records are available for this catalog."
            getRowId={(row, index) => row.id ?? row.code ?? String(index)}
          />
        </div>
      </section>
    </div>
  );
}

export default ReferenceDataPage;
