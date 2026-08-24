import { useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { canPerformAction } from '../../auth/permissionPolicy.js';
import JsonViewer from '../../components/shared/JsonViewer.jsx';
import StatusBadge from '../../components/shared/StatusBadge.jsx';
import {
  SOURCE_CHANNELS,
  SOURCE_FORMATS,
} from '../../constants/domain.js';
import { PERMISSIONS } from '../../constants/roles.js';
import {
  HTTP_METHODS,
  MOCK_API_PATHS,
} from '../../contracts/mockApiContracts.js';
import { createIntakeService } from '../../services/onboarding/intakeService.js';
import { useAuthStore } from '../../stores/authStore.js';

const MAX_BULK_RECORDS = 100;

const AGENCY_OPTIONS = Object.freeze([
  {
    label: 'Brokerage general agency',
    value: 'BGA',
  },
  {
    label: 'Independent marketing organization',
    value: 'IMO',
  },
  {
    label: 'IMO and BGA',
    value: 'IMO_BGA',
  },
  {
    label: 'Direct agency',
    value: 'DIRECT',
  },
  {
    label: 'Financial institution',
    value: 'financial_institution',
  },
]);

const REQUEST_OPTIONS = Object.freeze([
  {
    label: 'New onboarding',
    value: 'new_onboarding',
  },
  {
    label: 'Contract adoption',
    value: 'contract_adoption',
  },
  {
    label: 'Hierarchy transfer',
    value: 'hierarchy_change',
  },
]);

const COMPANY_OPTIONS = Object.freeze([
  {
    label: 'Banner',
    value: 'Banner',
  },
  {
    label: 'William Penn',
    value: 'WilliamPenn',
  },
]);

const FORM_OPTIONS = Object.freeze([
  {
    label: 'Individual producer',
    value: 'PRODUCER',
  },
  {
    label: 'Corporate agency',
    value: 'AGENCY',
  },
  {
    label: 'Registered representative',
    value: 'registered_representative',
  },
  {
    label: 'Solicitor',
    value: 'SOLICITOR',
  },
]);

const STATE_OPTIONS = Object.freeze([
  'AL',
  'AK',
  'AZ',
  'AR',
  'CA',
  'CO',
  'CT',
  'DE',
  'FL',
  'GA',
  'HI',
  'ID',
  'IL',
  'IN',
  'IA',
  'KS',
  'KY',
  'LA',
  'ME',
  'MD',
  'MA',
  'MI',
  'MN',
  'MS',
  'MO',
  'MT',
  'NE',
  'NV',
  'NH',
  'NJ',
  'NM',
  'NY',
  'NC',
  'ND',
  'OH',
  'OK',
  'OR',
  'PA',
  'RI',
  'SC',
  'SD',
  'TN',
  'TX',
  'UT',
  'VT',
  'VA',
  'WA',
  'WV',
  'WI',
  'WY',
]);

function createRecord(index) {
  const suffix = String(index + 1).padStart(3, '0');

  return {
    id: `api-record-${index + 1}`,
    firstName: index === 0 ? 'Jordan' : '',
    lastName: index === 0 ? 'ApiDemo' : '',
    email:
      index === 0
        ? `jordan.apidemo${suffix}@example.test`
        : '',
    npn: index === 0 ? `8201${suffix}` : '',
    residenceState: index === 0 ? 'PA' : '',
  };
}

function normalizeToken(value) {
  return String(value ?? '')
    .trim()
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function getJourneyType(formType) {
  if (formType === 'AGENCY') {
    return 'corporate';
  }

  if (formType === 'registered_representative') {
    return 'registered_rep';
  }

  return 'agent_contracting';
}

function getContractLevel(formType) {
  if (formType === 'AGENCY') {
    return 'AGENCY';
  }

  return 'PRODUCER';
}

function createSubmissionRecord({
  agencyCode,
  agencyName,
  agencyType,
  company,
  formType,
  gaCode,
  record,
  recordIndex,
  requestType,
}) {
  const submissionId = `API-DEMO-${Date.now()}-${recordIndex + 1}`;
  const corporate = formType === 'AGENCY';
  const registeredRepresentative =
    formType === 'registered_representative';
  const commonValues = {
    submissionId,
    requestType,
    company,
    gaCode,
    partnerCode: 'API_DEMO',
    agencyType,
    contractType: formType,
    journeyType: getJourneyType(formType),
    agency: {
      name: agencyName,
      type: agencyType,
      code: agencyCode || undefined,
    },
    contract: {
      type: formType,
      level: getContractLevel(formType),
      commissionSchedule:
        formType === 'AGENCY' ? 'AGENCY' : 'STANDARD',
      advanceCommission: false,
    },
    licensing: {
      residentState: record.residenceState,
      licenseNumber: `${record.residenceState}-DEMO-${record.npn}`,
      linesOfAuthority: ['LIFE'],
    },
    attestations: {
      backgroundQuestionsClear: true,
      electronicDeliveryConsent: true,
    },
  };

  if (corporate) {
    return {
      ...commonValues,
      organization: {
        type: 'organization',
        legalName: agencyName,
        email: record.email,
        stateOfFormation: record.residenceState,
        taxIdLast4: '9001',
      },
      principals: [
        {
          firstName: record.firstName,
          lastName: record.lastName,
          email: record.email,
          ownershipPercent: 100,
          npn: record.npn,
          isLicensedEligible: true,
        },
      ],
    };
  }

  return {
    ...commonValues,
    agent: {
      type: 'individual',
      firstName: record.firstName,
      lastName: record.lastName,
      email: record.email,
      phone: `202555${String(1000 + recordIndex).slice(-4)}`,
      npn: record.npn,
      residenceState: record.residenceState,
      ...(registeredRepresentative
        ? { crd: `7${record.npn.slice(-5)}` }
        : {}),
    },
    ...(registeredRepresentative
      ? {
          registration: {
            brokerDealer: 'Synthetic Broker Dealer',
            status: 'ACTIVE',
          },
        }
      : {}),
  };
}

function validateRecords(records) {
  const errors = {};

  records.forEach((record, index) => {
    const recordErrors = {};

    if (record.firstName.trim() === '') {
      recordErrors.firstName = 'First name is required.';
    }

    if (record.lastName.trim() === '') {
      recordErrors.lastName = 'Last name is required.';
    }

    if (
      record.email.trim() !== '' &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(record.email.trim())
    ) {
      recordErrors.email = 'Enter a valid synthetic email address.';
    }

    if (!/^\d{5,10}$/.test(record.npn.trim())) {
      recordErrors.npn = 'NPN must contain 5 to 10 digits.';
    }

    if (!/^[A-Z]{2}$/.test(record.residenceState)) {
      recordErrors.residenceState = 'Select a residence state.';
    }

    if (Object.keys(recordErrors).length > 0) {
      errors[index] = recordErrors;
    }
  });

  return errors;
}

function getResponseStatus(result) {
  if (!result?.summary) {
    return 500;
  }

  if (result.summary.rejected === result.summary.received) {
    return 422;
  }

  if (result.summary.rejected > 0) {
    return 207;
  }

  return 201;
}

function SelectField({
  disabled,
  id,
  label,
  onChange,
  options,
  value,
}) {
  return (
    <div>
      <label
        className="block text-sm font-medium text-text dark:text-slate-100"
        htmlFor={id}
      >
        {label}
      </label>
      <select
        className="mt-1 min-h-11 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text shadow-sm focus:border-lga-sky focus:outline-none focus:ring-2 focus:ring-lga-sky disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
        disabled={disabled}
        id={id}
        onChange={onChange}
        value={value}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

SelectField.propTypes = {
  disabled: PropTypes.bool.isRequired,
  id: PropTypes.string.isRequired,
  label: PropTypes.string.isRequired,
  onChange: PropTypes.func.isRequired,
  options: PropTypes.arrayOf(
    PropTypes.shape({
      label: PropTypes.string.isRequired,
      value: PropTypes.string.isRequired,
    }),
  ).isRequired,
  value: PropTypes.string.isRequired,
};

function TextField({
  disabled,
  error,
  id,
  inputMode,
  label,
  onChange,
  placeholder,
  type = 'text',
  value,
}) {
  const errorId = `${id}-error`;

  return (
    <div>
      <label
        className="block text-sm font-medium text-text dark:text-slate-100"
        htmlFor={id}
      >
        {label}
      </label>
      <input
        aria-describedby={error ? errorId : undefined}
        aria-invalid={Boolean(error)}
        className="mt-1 min-h-11 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text shadow-sm placeholder:text-slate-400 focus:border-lga-sky focus:outline-none focus:ring-2 focus:ring-lga-sky disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
        disabled={disabled}
        id={id}
        inputMode={inputMode}
        onChange={onChange}
        placeholder={placeholder}
        type={type}
        value={value}
      />
      {error && (
        <p
          className="mt-1 text-sm text-danger dark:text-red-200"
          id={errorId}
          role="alert"
        >
          {error}
        </p>
      )}
    </div>
  );
}

TextField.propTypes = {
  disabled: PropTypes.bool.isRequired,
  error: PropTypes.string,
  id: PropTypes.string.isRequired,
  inputMode: PropTypes.string,
  label: PropTypes.string.isRequired,
  onChange: PropTypes.func.isRequired,
  placeholder: PropTypes.string,
  type: PropTypes.string,
  value: PropTypes.string.isRequired,
};

function SubmissionRecordEditor({
  disabled,
  errors,
  index,
  onChange,
  onRemove,
  record,
  removable,
}) {
  const updateField = (field) => (event) => {
    onChange(index, field, event.target.value);
  };

  return (
    <fieldset className="rounded-xl border border-border p-4 dark:border-slate-700">
      <div className="mb-4 flex items-center justify-between gap-3">
        <legend className="font-semibold text-lga-navy dark:text-white">
          API record {index + 1}
        </legend>
        {removable && (
          <button
            className="min-h-10 rounded-lg px-3 py-2 text-sm font-medium text-danger transition-colors hover:bg-danger-light focus:outline-none focus:ring-2 focus:ring-danger disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-danger-dark"
            disabled={disabled}
            onClick={() => onRemove(index)}
            type="button"
          >
            Remove
          </button>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <TextField
          disabled={disabled}
          error={errors.firstName}
          id={`api-record-${index}-first-name`}
          label="First name"
          onChange={updateField('firstName')}
          placeholder="Synthetic first name"
          value={record.firstName}
        />
        <TextField
          disabled={disabled}
          error={errors.lastName}
          id={`api-record-${index}-last-name`}
          label="Last name"
          onChange={updateField('lastName')}
          placeholder="Synthetic last name"
          value={record.lastName}
        />
        <TextField
          disabled={disabled}
          error={errors.email}
          id={`api-record-${index}-email`}
          label="Email address"
          onChange={updateField('email')}
          placeholder="name@example.test"
          type="email"
          value={record.email}
        />
        <TextField
          disabled={disabled}
          error={errors.npn}
          id={`api-record-${index}-npn`}
          inputMode="numeric"
          label="National producer number"
          onChange={updateField('npn')}
          placeholder="8201001"
          value={record.npn}
        />
        <div>
          <label
            className="block text-sm font-medium text-text dark:text-slate-100"
            htmlFor={`api-record-${index}-state`}
          >
            Residence state
          </label>
          <select
            aria-describedby={
              errors.residenceState
                ? `api-record-${index}-state-error`
                : undefined
            }
            aria-invalid={Boolean(errors.residenceState)}
            className="mt-1 min-h-11 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text shadow-sm focus:border-lga-sky focus:outline-none focus:ring-2 focus:ring-lga-sky disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
            disabled={disabled}
            id={`api-record-${index}-state`}
            onChange={updateField('residenceState')}
            value={record.residenceState}
          >
            <option value="">Select a state</option>
            {STATE_OPTIONS.map((state) => (
              <option key={state} value={state}>
                {state}
              </option>
            ))}
          </select>
          {errors.residenceState && (
            <p
              className="mt-1 text-sm text-danger dark:text-red-200"
              id={`api-record-${index}-state-error`}
              role="alert"
            >
              {errors.residenceState}
            </p>
          )}
        </div>
      </div>
    </fieldset>
  );
}

SubmissionRecordEditor.propTypes = {
  disabled: PropTypes.bool.isRequired,
  errors: PropTypes.object.isRequired,
  index: PropTypes.number.isRequired,
  onChange: PropTypes.func.isRequired,
  onRemove: PropTypes.func.isRequired,
  record: PropTypes.shape({
    email: PropTypes.string.isRequired,
    firstName: PropTypes.string.isRequired,
    id: PropTypes.string.isRequired,
    lastName: PropTypes.string.isRequired,
    npn: PropTypes.string.isRequired,
    residenceState: PropTypes.string.isRequired,
  }).isRequired,
  removable: PropTypes.bool.isRequired,
};

function ResponseSummary({ response }) {
  if (!response) {
    return null;
  }

  const result = response.body;
  const summary = result?.summary;

  return (
    <section
      aria-labelledby="api-response-summary-title"
      className="rounded-xl border border-border bg-white p-5 shadow-card dark:border-slate-700 dark:bg-slate-900"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2
            className="text-lg font-semibold text-lga-navy dark:text-white"
            id="api-response-summary-title"
          >
            Mock API response
          </h2>
          <p className="mt-1 text-sm text-text-muted dark:text-slate-300">
            The request was processed locally using the intake normalization
            and validation services.
          </p>
        </div>
        <StatusBadge
          label={`HTTP ${response.status}`}
          showDot={false}
          tone={
            response.status < 300
              ? 'success'
              : response.status < 500
                ? 'warning'
                : 'danger'
          }
        />
      </div>

      {summary && (
        <dl className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            {
              label: 'Received',
              value: summary.received,
            },
            {
              label: 'Normalized',
              value: summary.normalized,
            },
            {
              label: 'Rejected',
              value: summary.rejected,
            },
            {
              label: 'Journey required',
              value: summary.requiresJourney,
            },
          ].map((item) => (
            <div
              className="rounded-lg bg-surface-muted px-4 py-3 dark:bg-slate-800"
              key={item.label}
            >
              <dt className="text-xs font-medium uppercase tracking-wide text-text-muted dark:text-slate-400">
                {item.label}
              </dt>
              <dd className="mt-1 text-2xl font-semibold text-lga-navy dark:text-white">
                {item.value}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {Array.isArray(result?.records) && result.records.length > 0 && (
        <div className="mt-5 space-y-3">
          {result.records.map((record, index) => (
            <div
              className="flex flex-col gap-3 rounded-lg border border-border p-4 sm:flex-row sm:items-center sm:justify-between dark:border-slate-700"
              key={
                record.trackingId ??
                record.applicationId ??
                `response-record-${index}`
              }
            >
              <div className="min-w-0">
                <p className="font-semibold text-text dark:text-white">
                  {record.applicationId ?? `Record ${index + 1}`}
                </p>
                <p className="mt-1 break-all font-mono text-xs text-text-muted dark:text-slate-400">
                  {record.trackingId ?? 'No tracking identifier generated'}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <StatusBadge
                  showDot={false}
                  status={record.completenessStatus}
                />
                <StatusBadge showDot={false} status={record.nextAction} />
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

ResponseSummary.propTypes = {
  response: PropTypes.shape({
    body: PropTypes.object,
    status: PropTypes.number.isRequired,
  }),
};

/**
 * Provides an authorized generic mock API submission form with bulk records
 * and request/response contract viewers.
 */
export function ApiSubmissionPage() {
  const authState = useAuthStore();
  const currentUser = authState.currentUser ?? authState.user;
  const principal = useMemo(
    () => ({
      ...authState,
      user: currentUser,
      currentUser,
      role: authState.role ?? currentUser?.role,
      partnerContext: authState.partnerContext,
      isAuthenticated: authState.isAuthenticated,
      status: authState.isAuthenticated
        ? 'authenticated'
        : 'anonymous',
    }),
    [authState, currentUser],
  );
  const authorized =
    authState.isAuthenticated &&
    canPerformAction(principal, PERMISSIONS.CREATE_ONBOARDING);
  const intakeService = useMemo(() => createIntakeService(), []);
  const [agencyName, setAgencyName] = useState(
    'Synthetic API Brokerage',
  );
  const [agencyCode, setAgencyCode] = useState('API-DEMO');
  const [gaCode, setGaCode] = useState('NATIONAL_DEMO');
  const [agencyType, setAgencyType] = useState('BGA');
  const [requestType, setRequestType] = useState('new_onboarding');
  const [company, setCompany] = useState('Banner');
  const [formType, setFormType] = useState('PRODUCER');
  const [bulk, setBulk] = useState(false);
  const [records, setRecords] = useState([createRecord(0)]);
  const [fieldErrors, setFieldErrors] = useState({});
  const [submissionError, setSubmissionError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [response, setResponse] = useState(null);
  const [submittedRequest, setSubmittedRequest] = useState(null);

  const submissionRecords = useMemo(
    () =>
      records.map((record, recordIndex) =>
        createSubmissionRecord({
          agencyCode: agencyCode.trim(),
          agencyName: agencyName.trim(),
          agencyType,
          company,
          formType,
          gaCode: gaCode.trim(),
          record,
          recordIndex,
          requestType,
        }),
      ),
    [
      agencyCode,
      agencyName,
      agencyType,
      company,
      formType,
      gaCode,
      records,
      requestType,
    ],
  );

  const requestPreview = useMemo(() => {
    const rawValue = bulk
      ? submissionRecords
      : submissionRecords[0];

    return {
      method: HTTP_METHODS.POST,
      path: MOCK_API_PATHS.INTAKE,
      headers: {
        'content-type': 'application/json',
        'x-simulation-mode': 'true',
      },
      body: {
        sourceChannel: SOURCE_CHANNELS.API,
        sourceFormat: SOURCE_FORMATS.QUILITY_JSON,
        partnerCode:
          authState.partnerContext?.partnerCode ?? 'API_DEMO',
        fileName: bulk
          ? 'generic-onboarding-bulk.json'
          : 'generic-onboarding-request.json',
        mimeType: 'application/json',
        bulk,
        rawContent: JSON.stringify(rawValue),
        metadata: {
          concept: 'generic_onboarding_api',
          recordCount: submissionRecords.length,
          synthetic: true,
        },
      },
    };
  }, [
    authState.partnerContext?.partnerCode,
    bulk,
    submissionRecords,
  ]);

  const updateRecord = (index, field, value) => {
    setRecords((currentRecords) =>
      currentRecords.map((record, recordIndex) =>
        recordIndex === index
          ? {
              ...record,
              [field]: value,
            }
          : record,
      ),
    );
    setFieldErrors((currentErrors) => {
      const nextErrors = {
        ...currentErrors,
      };

      if (nextErrors[index]) {
        nextErrors[index] = {
          ...nextErrors[index],
        };
        delete nextErrors[index][field];

        if (Object.keys(nextErrors[index]).length === 0) {
          delete nextErrors[index];
        }
      }

      return nextErrors;
    });
    setSubmissionError('');
    setResponse(null);
  };

  const addRecord = () => {
    if (records.length >= MAX_BULK_RECORDS) {
      setSubmissionError(
        `A mock API submission can contain no more than ${MAX_BULK_RECORDS} records.`,
      );
      return;
    }

    setBulk(true);
    setRecords((currentRecords) => [
      ...currentRecords,
      createRecord(currentRecords.length),
    ]);
    setResponse(null);
    setSubmissionError('');
  };

  const removeRecord = (index) => {
    setRecords((currentRecords) =>
      currentRecords.filter((_, recordIndex) => recordIndex !== index),
    );
    setFieldErrors({});
    setResponse(null);
    setSubmissionError('');
  };

  const handleBulkChange = (event) => {
    const checked = event.target.checked;

    setBulk(checked);
    setResponse(null);
    setSubmissionError('');

    if (!checked) {
      setRecords((currentRecords) => [currentRecords[0] ?? createRecord(0)]);
      setFieldErrors({});
    }
  };

  const submitRequest = async (event) => {
    event.preventDefault();
    setSubmissionError('');
    setResponse(null);

    if (!authorized) {
      setSubmissionError(
        'Your current session cannot create onboarding submissions.',
      );
      return;
    }

    if (agencyName.trim() === '' || gaCode.trim() === '') {
      setSubmissionError(
        'Agency name and general agency code are required.',
      );
      return;
    }

    const validationErrors = validateRecords(records);

    if (Object.keys(validationErrors).length > 0) {
      setFieldErrors(validationErrors);
      setSubmissionError(
        'Review the highlighted API record fields before submitting.',
      );
      return;
    }

    setSubmitting(true);
    setSubmittedRequest(requestPreview);

    try {
      await new Promise((resolve) => {
        globalThis.setTimeout(resolve, 200);
      });

      const result = intakeService.importSubmission({
        sourceChannel: SOURCE_CHANNELS.API,
        sourceFormat: SOURCE_FORMATS.QUILITY_JSON,
        partnerCode:
          authState.partnerContext?.partnerCode ?? 'API_DEMO',
        fileName: requestPreview.body.fileName,
        mimeType: requestPreview.body.mimeType,
        bulk,
        rawContent: requestPreview.body.rawContent,
        requestedBy: principal,
        enforcePartnerScope: false,
        requireAuthorization: false,
      });

      setResponse({
        status: getResponseStatus(result),
        headers: {
          'content-type': 'application/json',
          'x-mock-api': 'digital-onboarding',
        },
        body: result,
      });
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : 'The mock API request could not be processed.';

      setSubmissionError(message);
      setResponse({
        status: 400,
        headers: {
          'content-type': 'application/json',
          'x-mock-api': 'digital-onboarding',
        },
        body: {
          error: {
            code:
              error?.code ?? 'MOCK_API_SUBMISSION_FAILED',
            message,
            recoverable: true,
          },
        },
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (!authorized) {
    return (
      <section
        aria-labelledby="api-submission-title"
        className="mx-auto max-w-3xl rounded-xl border border-danger bg-danger-light p-6 text-danger-dark shadow-card dark:border-red-700 dark:bg-danger-dark dark:text-red-100"
        role="alert"
      >
        <h1 className="text-xl font-semibold" id="api-submission-title">
          API submission access is unavailable
        </h1>
        <p className="mt-2 text-sm leading-6">
          An authenticated role with onboarding creation permission is
          required to use the generic mock API submission interface.
        </p>
      </section>
    );
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6">
      <header>
        <div className="flex flex-wrap gap-2">
          <StatusBadge label="Mock API" showDot={false} tone="info" />
          <StatusBadge label="Simulation" showDot={false} simulation />
          <StatusBadge
            label="Synthetic data only"
            showDot={false}
            tone="warning"
          />
        </div>
        <h1
          className="mt-3 text-2xl font-semibold text-lga-navy sm:text-3xl dark:text-white"
          id="api-submission-title"
        >
          Generic onboarding API submission
        </h1>
        <p className="mt-2 max-w-4xl text-sm leading-6 text-text-muted sm:text-base dark:text-slate-300">
          Configure an agency, request, company, and form type, then submit
          one or more synthetic records through the browser-only onboarding
          API concept.
        </p>
      </header>

      <aside
        className="rounded-xl border border-accent-300 bg-accent-100 p-4 text-sm leading-6 text-accent-950 dark:border-accent-700 dark:bg-accent-950 dark:text-accent-100"
        role="note"
      >
        This interface does not call a network service. Request and response
        contracts are generated and processed locally. Do not enter real
        producer, customer, licensing, banking, or contact information.
      </aside>

      {submissionError && (
        <div
          className="rounded-xl border border-danger bg-danger-light p-4 text-sm text-danger-dark dark:border-red-700 dark:bg-danger-dark dark:text-red-100"
          role="alert"
        >
          <p className="font-semibold">The request could not be submitted</p>
          <p className="mt-1">{submissionError}</p>
        </div>
      )}

      <form
        className="overflow-hidden rounded-xl border border-border bg-white shadow-card dark:border-slate-700 dark:bg-slate-900"
        noValidate
        onSubmit={submitRequest}
      >
        <div className="border-b border-border px-5 py-4 sm:px-6 dark:border-slate-700">
          <h2 className="text-lg font-semibold text-lga-navy dark:text-white">
            API request options
          </h2>
          <p className="mt-1 text-sm text-text-muted dark:text-slate-300">
            These values are applied to every record in the simulated request.
          </p>
        </div>

        <fieldset
          className="space-y-6 p-5 sm:p-6"
          disabled={submitting}
        >
          <legend className="sr-only">
            Generic onboarding API request options
          </legend>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <SelectField
              disabled={submitting}
              id="api-agency-type"
              label="Agency type"
              onChange={(event) => {
                setAgencyType(event.target.value);
                setResponse(null);
              }}
              options={AGENCY_OPTIONS}
              value={agencyType}
            />
            <SelectField
              disabled={submitting}
              id="api-request-type"
              label="Request type"
              onChange={(event) => {
                setRequestType(event.target.value);
                setResponse(null);
              }}
              options={REQUEST_OPTIONS}
              value={requestType}
            />
            <SelectField
              disabled={submitting}
              id="api-company"
              label="Company"
              onChange={(event) => {
                setCompany(event.target.value);
                setResponse(null);
              }}
              options={COMPANY_OPTIONS}
              value={company}
            />
            <SelectField
              disabled={submitting}
              id="api-form-type"
              label="Form type"
              onChange={(event) => {
                setFormType(event.target.value);
                setResponse(null);
              }}
              options={FORM_OPTIONS}
              value={formType}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <TextField
              disabled={submitting}
              id="api-agency-name"
              label="Agency name"
              onChange={(event) => {
                setAgencyName(event.target.value);
                setResponse(null);
                setSubmissionError('');
              }}
              placeholder="Synthetic API Brokerage"
              value={agencyName}
            />
            <TextField
              disabled={submitting}
              id="api-agency-code"
              label="Agency code"
              onChange={(event) => {
                setAgencyCode(event.target.value);
                setResponse(null);
              }}
              placeholder="API-DEMO"
              value={agencyCode}
            />
            <TextField
              disabled={submitting}
              id="api-ga-code"
              label="General agency code"
              onChange={(event) => {
                setGaCode(event.target.value);
                setResponse(null);
                setSubmissionError('');
              }}
              placeholder="NATIONAL_DEMO"
              value={gaCode}
            />
          </div>

          <label className="flex min-h-11 items-start gap-3 rounded-lg border border-border bg-surface-muted px-4 py-3 text-sm text-text dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
            <input
              checked={bulk}
              className="mt-0.5 size-5 rounded border-border text-lga-navy focus:ring-2 focus:ring-lga-sky"
              onChange={handleBulkChange}
              type="checkbox"
            />
            <span>
              <span className="font-medium">Bulk API request</span>
              <span className="mt-1 block text-xs leading-5 text-text-muted dark:text-slate-400">
                Submit up to {MAX_BULK_RECORDS} independently normalized
                records in one simulated request.
              </span>
            </span>
          </label>

          <div>
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="font-semibold text-lga-navy dark:text-white">
                  Submission records
                </h3>
                <p className="mt-1 text-sm text-text-muted dark:text-slate-400">
                  {records.length} synthetic record
                  {records.length === 1 ? '' : 's'} configured.
                </p>
              </div>
              {bulk && (
                <button
                  className="inline-flex min-h-11 items-center justify-center rounded-lg border border-border bg-white px-4 py-2 text-sm font-semibold text-lga-navy transition-colors hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-lga-sky focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-white dark:hover:bg-slate-800"
                  disabled={
                    submitting || records.length >= MAX_BULK_RECORDS
                  }
                  onClick={addRecord}
                  type="button"
                >
                  Add API record
                </button>
              )}
            </div>

            <div className="space-y-4">
              {records.map((record, index) => (
                <SubmissionRecordEditor
                  disabled={submitting}
                  errors={fieldErrors[index] ?? {}}
                  index={index}
                  key={record.id}
                  onChange={updateRecord}
                  onRemove={removeRecord}
                  record={record}
                  removable={bulk && records.length > 1}
                />
              ))}
            </div>
          </div>
        </fieldset>

        <div className="flex flex-col gap-3 border-t border-border bg-surface-muted px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 dark:border-slate-700 dark:bg-slate-800">
          <div className="text-sm text-text-muted dark:text-slate-300">
            <span className="font-mono font-semibold text-lga-navy dark:text-primary-200">
              {HTTP_METHODS.POST}
            </span>{' '}
            <span className="font-mono">{MOCK_API_PATHS.INTAKE}</span>
          </div>
          <button
            className="inline-flex min-h-11 items-center justify-center rounded-lg bg-lga-navy px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-800 focus:outline-none focus:ring-2 focus:ring-lga-sky focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-primary-600 dark:hover:bg-primary-500 dark:focus:ring-offset-slate-900"
            disabled={submitting}
            type="submit"
          >
            {submitting ? 'Submitting mock request…' : 'Submit mock API request'}
          </button>
        </div>

        <div aria-live="polite" className="sr-only" role="status">
          {submitting
            ? 'The mock onboarding API request is being processed.'
            : response
              ? `The mock API returned status ${response.status}.`
              : ''}
        </div>
      </form>

      <section
        aria-labelledby="api-contract-title"
        className="space-y-4"
      >
        <div>
          <h2
            className="text-xl font-semibold text-lga-navy dark:text-white"
            id="api-contract-title"
          >
            Request and response contract
          </h2>
          <p className="mt-1 text-sm text-text-muted dark:text-slate-300">
            Inspect, copy, or download the redacted JSON exchanged by this
            browser-only API concept.
          </p>
        </div>

        <div className="grid gap-5 xl:grid-cols-2">
          <JsonViewer
            data={submittedRequest ?? requestPreview}
            fileName="generic-onboarding-api-request.json"
            initiallyExpanded
            redact
            title={
              submittedRequest
                ? 'Submitted request'
                : 'Request preview'
            }
          />
          <JsonViewer
            data={
              response ?? {
                status: null,
                headers: {
                  'content-type': 'application/json',
                },
                body: {
                  message:
                    'Submit the request to view the simulated response.',
                },
              }
            }
            fileName="generic-onboarding-api-response.json"
            initiallyExpanded
            redact
            title="Response viewer"
          />
        </div>
      </section>

      <ResponseSummary response={response} />
    </div>
  );
}

export default ApiSubmissionPage;