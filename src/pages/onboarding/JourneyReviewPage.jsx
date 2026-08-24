import { useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { useNavigate, useParams } from 'react-router-dom';
import { canPerformAction } from '../../auth/permissionPolicy.js';
import DocumentPackagePreview from '../../components/journey/DocumentPackagePreview.jsx';
import JsonViewer from '../../components/shared/JsonViewer.jsx';
import MaskedValue, {
  MASKED_VALUE_KINDS,
} from '../../components/shared/MaskedValue.jsx';
import StatusBadge from '../../components/shared/StatusBadge.jsx';
import { PERMISSIONS } from '../../constants/roles.js';
import { ROUTES } from '../../constants/routes.js';
import { createDocumentPackageRepository } from '../../repositories/documentPackageRepository.js';
import { createOnboardingRecordRepository } from '../../repositories/onboardingRecordRepository.js';
import { createDocumentPackageService } from '../../services/onboarding/documentPackageService.js';
import { createEligibilityService } from '../../services/onboarding/eligibilityService.js';
import { createSubmissionService } from '../../services/onboarding/submissionService.js';
import { createValidationService } from '../../services/onboarding/validationService.js';
import { useAuthStore } from '../../stores/authStore.js';

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

function getRouteIdentifier(params) {
  return (
    params.trackingId ??
    params.journeyId ??
    params.applicationId ??
    null
  );
}

function getApplicant(application) {
  return (
    application?.applicant ??
    application?.agent ??
    application?.organization ??
    {}
  );
}

function getApplicantName(application) {
  const applicant = getApplicant(application);

  return (
    applicant.legalName ??
    [applicant.firstName, applicant.lastName]
      .filter(Boolean)
      .join(' ')
      .trim() ??
    'Not available'
  );
}

function createEditValues(application) {
  return {
    agencyName: application?.agency?.name ?? '',
    agencyCode: application?.agency?.code ?? '',
    gaCode: application?.gaCode ?? '',
    contractType:
      application?.contract?.type ??
      application?.contractType ??
      '',
    contractLevel:
      application?.contract?.level ??
      application?.level ??
      '',
    commissionSchedule:
      application?.contract?.commissionSchedule ??
      application?.commission?.schedule ??
      '',
    hierarchyAgencyCode:
      application?.hierarchy?.agencyCode ??
      application?.agency?.code ??
      '',
    uplineAgentCode:
      application?.hierarchy?.uplineAgentCode ?? '',
  };
}

function createApplicationPatch(values) {
  return {
    gaCode: values.gaCode.trim(),
    agency: {
      name: values.agencyName.trim(),
      code: values.agencyCode.trim() || undefined,
    },
    contract: {
      type: values.contractType.trim(),
      level: values.contractLevel.trim(),
      commissionSchedule: values.commissionSchedule.trim(),
    },
    hierarchy: {
      agencyCode: values.hierarchyAgencyCode.trim(),
      uplineAgentCode: values.uplineAgentCode.trim() || undefined,
    },
  };
}

function getCompletedDocumentCodes(documentPackage) {
  if (!documentPackage) {
    return [];
  }

  return [
    ...new Set(
      (documentPackage.generatedArtifacts ?? [])
        .map((artifact) => artifact.documentCode)
        .filter(Boolean),
    ),
  ];
}

function getRequiredForms(documentPackage) {
  return documentPackage?.requiredForms ?? [];
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

function getOutcomeTone(outcome) {
  if (
    outcome?.valid === false ||
    outcome?.eligible === false ||
    outcome?.outcome === 'INELIGIBLE'
  ) {
    return 'danger';
  }

  if (
    outcome?.manualReviewRequired === true ||
    outcome?.outcome === 'MANUAL_REVIEW'
  ) {
    return 'warning';
  }

  return 'success';
}

function SummaryItem({ label, value, children }) {
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

SummaryItem.propTypes = {
  children: PropTypes.node,
  label: PropTypes.string.isRequired,
  value: PropTypes.node,
};

function ReviewInput({
  disabled,
  id,
  label,
  onChange,
  required = false,
  value,
}) {
  return (
    <div>
      <label
        className="block text-sm font-medium text-text dark:text-slate-100"
        htmlFor={id}
      >
        {label}
        {required && (
          <span aria-hidden="true" className="ml-1 text-danger">
            *
          </span>
        )}
      </label>
      <input
        className="mt-1 min-h-11 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text shadow-sm focus:border-lga-sky focus:outline-none focus:ring-2 focus:ring-lga-sky disabled:cursor-not-allowed disabled:bg-surface-muted disabled:opacity-70 dark:border-slate-600 dark:bg-slate-900 dark:text-white dark:disabled:bg-slate-800"
        disabled={disabled}
        id={id}
        onChange={onChange}
        required={required}
        value={value}
      />
    </div>
  );
}

ReviewInput.propTypes = {
  disabled: PropTypes.bool.isRequired,
  id: PropTypes.string.isRequired,
  label: PropTypes.string.isRequired,
  onChange: PropTypes.func.isRequired,
  required: PropTypes.bool,
  value: PropTypes.string.isRequired,
};

function EditableSummary({
  application,
  busy,
  editValues,
  editing,
  onCancel,
  onChange,
  onEdit,
  onSave,
}) {
  const applicant = getApplicant(application);

  if (editing) {
    return (
      <form
        className="space-y-5"
        noValidate
        onSubmit={onSave}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <ReviewInput
            disabled={busy}
            id="review-agency-name"
            label="Agency name"
            onChange={(event) =>
              onChange('agencyName', event.target.value)
            }
            required
            value={editValues.agencyName}
          />
          <ReviewInput
            disabled={busy}
            id="review-agency-code"
            label="Agency code"
            onChange={(event) =>
              onChange('agencyCode', event.target.value)
            }
            value={editValues.agencyCode}
          />
          <ReviewInput
            disabled={busy}
            id="review-ga-code"
            label="General agency code"
            onChange={(event) =>
              onChange('gaCode', event.target.value)
            }
            required
            value={editValues.gaCode}
          />
          <ReviewInput
            disabled={busy}
            id="review-contract-type"
            label="Contract type"
            onChange={(event) =>
              onChange('contractType', event.target.value)
            }
            required
            value={editValues.contractType}
          />
          <ReviewInput
            disabled={busy}
            id="review-contract-level"
            label="Contract level"
            onChange={(event) =>
              onChange('contractLevel', event.target.value)
            }
            required
            value={editValues.contractLevel}
          />
          <ReviewInput
            disabled={busy}
            id="review-commission-schedule"
            label="Commission schedule"
            onChange={(event) =>
              onChange('commissionSchedule', event.target.value)
            }
            required
            value={editValues.commissionSchedule}
          />
          <ReviewInput
            disabled={busy}
            id="review-hierarchy-agency-code"
            label="Hierarchy agency code"
            onChange={(event) =>
              onChange('hierarchyAgencyCode', event.target.value)
            }
            required
            value={editValues.hierarchyAgencyCode}
          />
          <ReviewInput
            disabled={busy}
            id="review-upline-agent-code"
            label="Upline agent code"
            onChange={(event) =>
              onChange('uplineAgentCode', event.target.value)
            }
            value={editValues.uplineAgentCode}
          />
        </div>

        <div className="flex flex-col-reverse gap-3 border-t border-border pt-4 sm:flex-row sm:justify-end dark:border-slate-700">
          <button
            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-border bg-white px-4 py-2 text-sm font-semibold text-lga-navy transition-colors hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-lga-sky focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-white dark:hover:bg-slate-800"
            disabled={busy}
            onClick={onCancel}
            type="button"
          >
            Cancel
          </button>
          <button
            className="inline-flex min-h-11 items-center justify-center rounded-lg bg-lga-navy px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-800 focus:outline-none focus:ring-2 focus:ring-lga-sky focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-primary-600 dark:hover:bg-primary-500"
            disabled={busy}
            type="submit"
          >
            {busy ? 'Saving…' : 'Save review changes'}
          </button>
        </div>
      </form>
    );
  }

  return (
    <>
      <div className="flex justify-end">
        <button
          className="inline-flex min-h-10 items-center justify-center rounded-lg border border-border bg-white px-4 py-2 text-sm font-semibold text-lga-navy transition-colors hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-lga-sky focus:ring-offset-2 dark:border-slate-600 dark:bg-slate-900 dark:text-white dark:hover:bg-slate-800"
          onClick={onEdit}
          type="button"
        >
          Edit summary
        </button>
      </div>

      <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <SummaryItem label="Applicant" value={getApplicantName(application)} />
        <SummaryItem label="Company" value={application.company} />
        <SummaryItem label="Agency" value={application.agency?.name} />
        <SummaryItem label="General agency" value={application.gaCode} />
        <SummaryItem
          label="Contract type"
          value={formatToken(
            application.contract?.type ?? application.contractType,
          )}
        />
        <SummaryItem
          label="Contract level"
          value={formatToken(
            application.contract?.level ?? application.level,
          )}
        />
        <SummaryItem
          label="Commission schedule"
          value={formatToken(
            application.contract?.commissionSchedule ??
              application.commission?.schedule,
          )}
        />
        <SummaryItem
          label="Residence state"
          value={
            applicant.residenceState ??
            application.licensing?.residentState
          }
        />
        <SummaryItem label="NPN">
          {applicant.npn ? (
            <MaskedValue
              kind={MASKED_VALUE_KINDS.IDENTIFIER}
              value={applicant.npn}
            />
          ) : (
            'Not available'
          )}
        </SummaryItem>
      </dl>

      <section
        aria-labelledby="review-hierarchy-title"
        className="mt-5 rounded-xl border border-border p-4 dark:border-slate-700"
      >
        <h3
          className="font-semibold text-lga-navy dark:text-white"
          id="review-hierarchy-title"
        >
          Contracting hierarchy
        </h3>
        <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <SummaryItem
            label="General agency code"
            value={application.gaCode}
          />
          <SummaryItem
            label="Agency code"
            value={
              application.hierarchy?.agencyCode ??
              application.agency?.code
            }
          />
          <SummaryItem
            label="Upline agent code"
            value={application.hierarchy?.uplineAgentCode}
          />
          <SummaryItem
            label="Hierarchy level"
            value={formatToken(
              application.hierarchy?.level ??
                application.contract?.level,
            )}
          />
          <SummaryItem
            label="Assigned team"
            value={application.assignment?.team}
          />
          <SummaryItem
            label="Hierarchy status"
            value={formatToken(
              application.hierarchy?.status ?? 'Pending validation',
            )}
          />
        </dl>
      </section>
    </>
  );
}

EditableSummary.propTypes = {
  application: PropTypes.object.isRequired,
  busy: PropTypes.bool.isRequired,
  editing: PropTypes.bool.isRequired,
  editValues: PropTypes.shape({
    agencyCode: PropTypes.string.isRequired,
    agencyName: PropTypes.string.isRequired,
    commissionSchedule: PropTypes.string.isRequired,
    contractLevel: PropTypes.string.isRequired,
    contractType: PropTypes.string.isRequired,
    gaCode: PropTypes.string.isRequired,
    hierarchyAgencyCode: PropTypes.string.isRequired,
    uplineAgentCode: PropTypes.string.isRequired,
  }).isRequired,
  onCancel: PropTypes.func.isRequired,
  onChange: PropTypes.func.isRequired,
  onEdit: PropTypes.func.isRequired,
  onSave: PropTypes.func.isRequired,
};

function OutcomePanel({ eligibility, validation }) {
  const validationIssues = validation?.issues ?? [];
  const eligibilityIssues = eligibility?.issues ?? [];
  const providerChecks = isObject(eligibility?.providerChecks)
    ? eligibility.providerChecks
    : {};

  return (
    <section
      aria-labelledby="review-outcomes-title"
      className="rounded-xl border border-border bg-white p-5 shadow-card sm:p-6 dark:border-slate-700 dark:bg-slate-900"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2
            className="text-xl font-semibold text-lga-navy dark:text-white"
            id="review-outcomes-title"
          >
            Validation and eligibility
          </h2>
          <p className="mt-1 text-sm leading-6 text-text-muted dark:text-slate-300">
            Review rule outcomes and simulated provider checks before
            signing.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusBadge
            label={validation?.valid ? 'Validation passed' : 'Validation failed'}
            showDot={false}
            tone={getOutcomeTone(validation)}
          />
          <StatusBadge
            label={
              eligibility?.eligible || eligibility?.valid
                ? 'Eligible'
                : formatToken(eligibility?.outcome ?? 'Not eligible')
            }
            showDot={false}
            tone={getOutcomeTone(eligibility)}
          />
        </div>
      </div>

      <dl className="mt-5 grid gap-3 sm:grid-cols-3">
        <SummaryItem
          label="Validation issues"
          value={validationIssues.length}
        />
        <SummaryItem
          label="Eligibility issues"
          value={eligibilityIssues.length}
        />
        <SummaryItem
          label="Manual review"
          value={
            validation?.manualReviewRequired ||
            eligibility?.manualReviewRequired
              ? 'Required'
              : 'Not required'
          }
        />
      </dl>

      {(validationIssues.length > 0 || eligibilityIssues.length > 0) && (
        <div className="mt-5 space-y-3">
          {[...validationIssues, ...eligibilityIssues].map(
            (issue, index) => (
              <div
                className="rounded-lg border border-border bg-surface-muted p-3 dark:border-slate-700 dark:bg-slate-800"
                key={`${issue.code ?? 'issue'}-${issue.field ?? index}`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge
                    label={formatToken(issue.code ?? issue.severity)}
                    severity={issue.severity ?? 'warning'}
                    showDot={false}
                    size="sm"
                  />
                  {issue.field && (
                    <span className="font-mono text-xs text-text-muted dark:text-slate-400">
                      {issue.field}
                    </span>
                  )}
                </div>
                <p className="mt-2 text-sm leading-6 text-text-muted dark:text-slate-300">
                  {issue.message}
                </p>
              </div>
            ),
          )}
        </div>
      )}

      <div className="mt-6">
        <h3 className="font-semibold text-lga-navy dark:text-white">
          Simulated provider outcomes
        </h3>
        {Object.keys(providerChecks).length === 0 ? (
          <div className="mt-3 rounded-lg border border-dashed border-border-strong px-4 py-6 text-center text-sm text-text-muted dark:border-slate-600 dark:text-slate-300">
            No provider checks were required or returned.
          </div>
        ) : (
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {Object.entries(providerChecks).map(
              ([providerCode, check]) => (
                <article
                  className="rounded-xl border border-border p-4 dark:border-slate-700"
                  key={providerCode}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h4 className="font-semibold text-text dark:text-white">
                        {providerCode}
                      </h4>
                      <p className="mt-1 text-xs text-text-muted dark:text-slate-400">
                        {check.service ?? 'Provider verification'}
                      </p>
                    </div>
                    <StatusBadge
                      showDot={false}
                      status={check.outcome ?? check.status}
                    />
                  </div>
                  <p className="mt-3 text-sm leading-6 text-text-muted dark:text-slate-300">
                    {check.description ??
                      'The simulated provider check completed.'}
                  </p>
                </article>
              ),
            )}
          </div>
        )}
      </div>

      <div className="mt-5">
        <JsonViewer
          data={{
            validation,
            eligibility,
          }}
          fileName="journey-review-outcomes.json"
          redact
          showDownloadButton={false}
          title="Detailed rule outcomes"
        />
      </div>
    </section>
  );
}

OutcomePanel.propTypes = {
  eligibility: PropTypes.object,
  validation: PropTypes.object,
};

function SignOffPanel({
  busy,
  consented,
  disabled,
  onConsentChange,
  onSign,
  signed,
  signedBy,
  onSignedByChange,
}) {
  return (
    <section
      aria-labelledby="review-sign-off-title"
      className="rounded-xl border border-border bg-white p-5 shadow-card sm:p-6 dark:border-slate-700 dark:bg-slate-900"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2
            className="text-xl font-semibold text-lga-navy dark:text-white"
            id="review-sign-off-title"
          >
            Consent and sign-off
          </h2>
          <p className="mt-1 text-sm leading-6 text-text-muted dark:text-slate-300">
            Confirm electronic-signature consent and record a simulated
            signature for this package.
          </p>
        </div>
        <StatusBadge
          showDot={false}
          status={signed ? 'signed' : consented ? 'consented' : 'not_started'}
        />
      </div>

      {signed ? (
        <div className="mt-5 rounded-lg border border-success bg-success-light p-4 text-sm text-success-dark dark:border-green-800 dark:bg-green-950 dark:text-green-100">
          Electronic consent and simulated sign-off have been recorded. The
          document package is ready for submission.
        </div>
      ) : (
        <form className="mt-5 space-y-4" onSubmit={onSign}>
          <div>
            <label
              className="block text-sm font-medium text-text dark:text-slate-100"
              htmlFor="review-signed-by"
            >
              Signer name
              <span aria-hidden="true" className="ml-1 text-danger">
                *
              </span>
            </label>
            <input
              autoComplete="name"
              className="mt-1 min-h-11 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text shadow-sm focus:border-lga-sky focus:outline-none focus:ring-2 focus:ring-lga-sky disabled:cursor-not-allowed disabled:bg-surface-muted disabled:opacity-70 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
              disabled={busy || disabled}
              id="review-signed-by"
              onChange={(event) => onSignedByChange(event.target.value)}
              required
              value={signedBy}
            />
          </div>

          <label className="flex min-h-11 items-start gap-3 rounded-lg border border-border bg-surface-muted px-4 py-3 text-sm text-text dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
            <input
              checked={consented}
              className="mt-0.5 size-5 shrink-0 rounded border-border text-lga-navy focus:ring-2 focus:ring-lga-sky disabled:cursor-not-allowed disabled:opacity-60"
              disabled={busy || disabled}
              onChange={(event) =>
                onConsentChange(event.target.checked)
              }
              type="checkbox"
            />
            <span>
              <span className="font-medium">
                I consent to use an electronic signature
              </span>
              <span className="mt-1 block text-xs leading-5 text-text-muted dark:text-slate-400">
                This records a simulated signature only and does not create
                an official contract.
              </span>
            </span>
          </label>

          <div className="flex justify-end border-t border-border pt-4 dark:border-slate-700">
            <button
              className="inline-flex min-h-11 items-center justify-center rounded-lg bg-lga-navy px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-800 focus:outline-none focus:ring-2 focus:ring-lga-sky focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-primary-600 dark:hover:bg-primary-500"
              disabled={
                busy ||
                disabled ||
                !consented ||
                signedBy.trim() === ''
              }
              type="submit"
            >
              {busy ? 'Recording sign-off…' : 'Consent and sign package'}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

SignOffPanel.propTypes = {
  busy: PropTypes.bool.isRequired,
  consented: PropTypes.bool.isRequired,
  disabled: PropTypes.bool.isRequired,
  onConsentChange: PropTypes.func.isRequired,
  onSign: PropTypes.func.isRequired,
  onSignedByChange: PropTypes.func.isRequired,
  signed: PropTypes.bool.isRequired,
  signedBy: PropTypes.string.isRequired,
};

/**
 * Displays the editable final journey review, rule outcomes, document package,
 * simulated sign-off controls, and submission readiness gates.
 */
export function JourneyReviewPage({
  application: suppliedApplication,
  documentPackage: suppliedDocumentPackage,
  eligibility: suppliedEligibility,
  onSave,
  onSignOff,
  onSubmit,
  validation: suppliedValidation,
}) {
  const params = useParams();
  const navigate = useNavigate();
  const authState = useAuthStore();
  const principal = useMemo(
    () => createPrincipal(authState),
    [authState],
  );
  const routeIdentifier = getRouteIdentifier(params);
  const applicationRepository = useMemo(
    () => createOnboardingRecordRepository(),
    [],
  );
  const documentPackageRepository = useMemo(
    () => createDocumentPackageRepository(),
    [],
  );
  const validationService = useMemo(
    () => createValidationService(),
    [],
  );
  const eligibilityService = useMemo(
    () =>
      createEligibilityService({
        applicationRepository,
        auditService: false,
      }),
    [applicationRepository],
  );
  const documentPackageService = useMemo(
    () =>
      createDocumentPackageService({
        repository: documentPackageRepository,
        applicationRepository,
        auditService: false,
      }),
    [applicationRepository, documentPackageRepository],
  );
  const submissionService = useMemo(
    () =>
      createSubmissionService({
        applicationRepository,
        validationService,
        eligibilityService,
        documentPackageService,
        auditService: false,
        requireAuthorization: false,
        strictAudit: false,
        strictHandoff: false,
        strictPublication: false,
      }),
    [
      applicationRepository,
      documentPackageService,
      eligibilityService,
      validationService,
    ],
  );
  const [application, setApplication] = useState(null);
  const [documentPackage, setDocumentPackage] = useState(null);
  const [validation, setValidation] = useState(null);
  const [eligibility, setEligibility] = useState(null);
  const [editValues, setEditValues] = useState(
    createEditValues(suppliedApplication),
  );
  const [editing, setEditing] = useState(false);
  const [consented, setConsented] = useState(false);
  const [signedBy, setSignedBy] = useState('');
  const [loading, setLoading] = useState(true);
  const [activeAction, setActiveAction] = useState('');
  const [pageError, setPageError] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const [submissionResult, setSubmissionResult] = useState(null);

  const evaluateApplication = (nextApplication, nextPackage) => {
    const completedForms = getCompletedDocumentCodes(nextPackage);
    let nextValidation = suppliedValidation;
    let nextEligibility = suppliedEligibility;

    if (!nextValidation) {
      nextValidation = validationService.validateForSubmission(
        nextApplication,
        {
          requiredForms: getRequiredForms(nextPackage),
          completedForms,
          principal,
          requireAuthorization: false,
          enforcePartnerScope: false,
          persist: false,
        },
      );
    }

    if (!nextEligibility) {
      nextEligibility = eligibilityService.runEligibilityChecks(
        nextApplication,
        {
          includeProviders: true,
          applicationRecords: applicationRepository.list({
            includeCompleted: true,
          }),
          persist: false,
        },
      );
    }

    setValidation(cloneValue(nextValidation));
    setEligibility(cloneValue(nextEligibility));

    return {
      validation: nextValidation,
      eligibility: nextEligibility,
    };
  };

  useEffect(() => {
    let active = true;

    const loadReview = async () => {
      setLoading(true);
      setPageError('');

      try {
        const loadedApplication =
          suppliedApplication ??
          (routeIdentifier
            ? applicationRepository.find(routeIdentifier)
            : null);

        if (!loadedApplication) {
          throw new Error(
            'The onboarding application required for review was not found.',
          );
        }

        let loadedPackage = suppliedDocumentPackage ?? null;

        if (!loadedPackage && loadedApplication.trackingId) {
          try {
            loadedPackage = documentPackageService.getPackage(
              loadedApplication.trackingId,
            );
          } catch {
            loadedPackage = null;
          }
        }

        if (!active) {
          return;
        }

        setApplication(cloneValue(loadedApplication));
        setDocumentPackage(cloneValue(loadedPackage));
        setEditValues(createEditValues(loadedApplication));
        setConsented(
          loadedPackage?.signOff?.consented === true,
        );
        setSignedBy(loadedPackage?.signOff?.signedBy ?? '');

        evaluateApplication(loadedApplication, loadedPackage);
      } catch (error) {
        if (active) {
          setPageError(
            error instanceof Error && error.message
              ? error.message
              : 'The journey review could not be loaded.',
          );
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    loadReview();

    return () => {
      active = false;
    };
  }, [
    applicationRepository,
    documentPackageService,
    routeIdentifier,
    suppliedApplication,
    suppliedDocumentPackage,
  ]);

  const updateEditValue = (field, value) => {
    setEditValues((currentValues) => ({
      ...currentValues,
      [field]: value,
    }));
    setPageError('');
    setActionMessage('');
  };

  const saveReviewChanges = async (event) => {
    event.preventDefault();

    if (!application) {
      return;
    }

    if (
      editValues.agencyName.trim() === '' ||
      editValues.gaCode.trim() === '' ||
      editValues.contractType.trim() === '' ||
      editValues.contractLevel.trim() === '' ||
      editValues.commissionSchedule.trim() === '' ||
      editValues.hierarchyAgencyCode.trim() === ''
    ) {
      setPageError(
        'Complete all required summary and hierarchy fields before saving.',
      );
      return;
    }

    setActiveAction('save');
    setPageError('');
    setActionMessage('');

    try {
      const patch = createApplicationPatch(editValues);
      const savedApplication =
        typeof onSave === 'function'
          ? await onSave(cloneValue(application), cloneValue(patch))
          : applicationRepository.update(
              application.applicationId ??
                application.trackingId,
              patch,
            );
      const resolvedApplication =
        isObject(savedApplication)
          ? savedApplication
          : {
              ...application,
              ...patch,
              agency: {
                ...application.agency,
                ...patch.agency,
              },
              contract: {
                ...application.contract,
                ...patch.contract,
              },
              hierarchy: {
                ...application.hierarchy,
                ...patch.hierarchy,
              },
            };

      setApplication(cloneValue(resolvedApplication));
      setEditValues(createEditValues(resolvedApplication));
      setEditing(false);
      setSubmissionResult(null);
      evaluateApplication(resolvedApplication, documentPackage);
      setActionMessage('Journey review changes were saved.');
    } catch (error) {
      setPageError(
        error instanceof Error && error.message
          ? error.message
          : 'The review changes could not be saved.',
      );
    } finally {
      setActiveAction('');
    }
  };

  const generatePackage = async () => {
    if (!application) {
      return;
    }

    setActiveAction('package');
    setPageError('');
    setActionMessage('');

    try {
      const generatedPackage =
        await Promise.resolve(
          documentPackageService.buildPackage(application, {
            actor: principal,
          }),
        );

      setDocumentPackage(cloneValue(generatedPackage));
      setConsented(
        generatedPackage.signOff?.consented === true,
      );
      setSignedBy(generatedPackage.signOff?.signedBy ?? '');
      setSubmissionResult(null);
      evaluateApplication(application, generatedPackage);
      setActionMessage('The synthetic document package was generated.');
    } catch (error) {
      setPageError(
        error instanceof Error && error.message
          ? error.message
          : 'The document package could not be generated.',
      );
    } finally {
      setActiveAction('');
    }
  };

  const recordSignOff = async (event) => {
    event.preventDefault();

    if (!application || !documentPackage) {
      setPageError(
        'Generate the document package before recording sign-off.',
      );
      return;
    }

    if (!consented || signedBy.trim() === '') {
      setPageError(
        'Signer name and electronic-signature consent are required.',
      );
      return;
    }

    setActiveAction('sign');
    setPageError('');
    setActionMessage('');

    try {
      let signedPackage;

      if (typeof onSignOff === 'function') {
        signedPackage = await onSignOff(
          cloneValue(documentPackage),
          {
            consented: true,
            signedBy: signedBy.trim(),
          },
        );
      } else {
        let nextPackage =
          documentPackage.signOff?.consented === true
            ? documentPackage
            : documentPackageService.markESignConsent(
                application.trackingId,
                {
                  consented: true,
                  signedBy: signedBy.trim(),
                  metadata: {
                    synthetic: true,
                  },
                },
                {
                  actor: principal,
                },
              );

        nextPackage = documentPackageService.markAgentSigned(
          application.trackingId,
          {
            signedBy: signedBy.trim(),
            metadata: {
              synthetic: true,
            },
          },
          {
            actor: principal,
          },
        );

        signedPackage = documentPackageService.completePackage(
          application.trackingId,
          {
            actor: principal,
            requireAgentSignature: true,
          },
        );
      }

      const resolvedPackage = isObject(signedPackage)
        ? signedPackage
        : documentPackage;

      setDocumentPackage(cloneValue(resolvedPackage));
      setConsented(true);
      setSubmissionResult(null);
      evaluateApplication(application, resolvedPackage);
      setActionMessage(
        'Electronic consent and simulated sign-off were recorded.',
      );
    } catch (error) {
      setPageError(
        error instanceof Error && error.message
          ? error.message
          : 'The simulated sign-off could not be recorded.',
      );
    } finally {
      setActiveAction('');
    }
  };

  const signed =
    documentPackage?.agentSignatureState === 'SIGNED' ||
    documentPackage?.signOff?.status === 'SIGNED';
  const alreadySubmitted =
    application?.status === 'submitted' ||
    application?.workflowStage === 'APPLICATION_SUBMITTED';
  const authorized =
    application !== null &&
    canPerformAction(
      principal,
      PERMISSIONS.SUBMIT_ONBOARDING,
      application,
    );
  const blockers = [
    ...(validation?.valid === true
      ? []
      : ['Resolve all validation errors.']),
    ...(eligibility?.eligible === true || eligibility?.valid === true
      ? []
      : ['Resolve eligibility errors.']),
    ...(validation?.manualReviewRequired ||
    eligibility?.manualReviewRequired
      ? ['Complete the required manual review.']
      : []),
    ...(!documentPackage
      ? ['Generate the document package.']
      : []),
    ...(documentPackage &&
    documentPackage.packageComplete !== true
      ? ['Complete the document package.']
      : []),
    ...(!signed ? ['Record electronic sign-off.'] : []),
    ...(!authorized && !alreadySubmitted
      ? ['Your current role cannot submit this application.']
      : []),
  ];
  const submissionReady =
    blockers.length === 0 && !alreadySubmitted;

  const submitJourney = async () => {
    if (!application || !submissionReady) {
      return;
    }

    setActiveAction('submit');
    setPageError('');
    setActionMessage('');

    try {
      const result =
        typeof onSubmit === 'function'
          ? await onSubmit(cloneValue(application), {
              documentPackage: cloneValue(documentPackage),
              eligibility: cloneValue(eligibility),
              validation: cloneValue(validation),
              principal,
            })
          : await Promise.resolve(
              submissionService.submitApplication(
                application.applicationId ??
                  application.trackingId,
                {
                  actor: principal,
                  principal,
                  submittedBy:
                    principal.user?.id ??
                    principal.currentUser?.id ??
                    'system',
                  requiredForms: getRequiredForms(documentPackage),
                  completedForms:
                    getCompletedDocumentCodes(documentPackage),
                  requireAuthorization: false,
                  requireDocumentPackage: true,
                  requireAgentSignature: true,
                  strictAudit: false,
                  strictHandoff: false,
                  strictPublication: false,
                },
              ),
            );

      setSubmissionResult(cloneValue(result));

      if (isObject(result?.application)) {
        setApplication(cloneValue(result.application));
      }

      setActionMessage(
        result?.submitted === false
          ? 'The application was routed for manual review.'
          : 'The onboarding application was submitted.',
      );
    } catch (error) {
      setPageError(
        error instanceof Error && error.message
          ? error.message
          : 'The onboarding application could not be submitted.',
      );
    } finally {
      setActiveAction('');
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
          Loading journey review…
        </p>
      </section>
    );
  }

  if (!application) {
    return (
      <section
        aria-labelledby="journey-review-error-title"
        className="mx-auto max-w-3xl rounded-xl border border-danger bg-danger-light p-6 text-danger-dark shadow-card dark:border-red-700 dark:bg-danger-dark dark:text-red-100"
        role="alert"
      >
        <h1
          className="text-xl font-semibold"
          id="journey-review-error-title"
        >
          The journey review could not be opened
        </h1>
        <p className="mt-2 text-sm leading-6">
          {pageError || 'The requested onboarding application is unavailable.'}
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

  const busy = activeAction !== '';

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6">
      <header className="rounded-xl border border-border bg-white p-5 shadow-card sm:p-6 dark:border-slate-700 dark:bg-slate-900">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex flex-wrap gap-2">
              <StatusBadge
                label="Final review"
                showDot={false}
                tone="info"
              />
              <StatusBadge
                label="Simulation"
                showDot={false}
                simulation
              />
              <StatusBadge
                showDot={false}
                status={application.status}
              />
            </div>
            <h1 className="mt-4 text-2xl font-semibold text-lga-navy sm:text-3xl dark:text-white">
              Review and sign your onboarding application
            </h1>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-text-muted dark:text-slate-300">
              Confirm the final application summary, hierarchy, rule outcomes,
              document package, and electronic consent before submission.
            </p>
            <p className="mt-2 break-all font-mono text-xs text-text-muted dark:text-slate-400">
              {application.trackingId}
            </p>
          </div>

          <button
            className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg border border-border bg-white px-4 py-2 text-sm font-semibold text-lga-navy transition-colors hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-lga-sky focus:ring-offset-2 dark:border-slate-600 dark:bg-slate-900 dark:text-white dark:hover:bg-slate-800"
            onClick={() => navigate(ROUTES.JOURNEYS)}
            type="button"
          >
            Save and exit
          </button>
        </div>
      </header>

      <aside
        className="rounded-xl border border-accent-300 bg-accent-100 p-4 text-sm leading-6 text-accent-950 dark:border-accent-700 dark:bg-accent-950 dark:text-accent-100"
        role="note"
      >
        Use synthetic information only. The signature, documents, provider
        results, and submission are simulated and do not create an official
        contract.
      </aside>

      {pageError && (
        <div
          className="rounded-xl border border-danger bg-danger-light p-4 text-sm text-danger-dark dark:border-red-700 dark:bg-danger-dark dark:text-red-100"
          role="alert"
        >
          <p className="font-semibold">The review could not continue</p>
          <p className="mt-1">{pageError}</p>
        </div>
      )}

      <div aria-live="polite" className="sr-only" role="status">
        {actionMessage}
      </div>

      <section
        aria-labelledby="final-summary-title"
        className="rounded-xl border border-border bg-white p-5 shadow-card sm:p-6 dark:border-slate-700 dark:bg-slate-900"
      >
        <div>
          <h2
            className="text-xl font-semibold text-lga-navy dark:text-white"
            id="final-summary-title"
          >
            Final application summary
          </h2>
          <p className="mt-1 text-sm leading-6 text-text-muted dark:text-slate-300">
            Review and correct contracting or hierarchy information before
            signing.
          </p>
        </div>

        <EditableSummary
          application={application}
          busy={busy}
          editing={editing}
          editValues={editValues}
          onCancel={() => {
            setEditing(false);
            setEditValues(createEditValues(application));
            setPageError('');
          }}
          onChange={updateEditValue}
          onEdit={() => setEditing(true)}
          onSave={saveReviewChanges}
        />
      </section>

      <OutcomePanel
        eligibility={eligibility}
        validation={validation}
      />

      {documentPackage ? (
        <DocumentPackagePreview
          documentPackage={documentPackage}
          title="Final document package"
        />
      ) : (
        <section
          aria-labelledby="document-package-required-title"
          className="rounded-xl border border-border bg-white p-5 shadow-card sm:p-6 dark:border-slate-700 dark:bg-slate-900"
        >
          <h2
            className="text-xl font-semibold text-lga-navy dark:text-white"
            id="document-package-required-title"
          >
            Document package
          </h2>
          <p className="mt-2 text-sm leading-6 text-text-muted dark:text-slate-300">
            Generate the synthetic contract package before recording
            electronic consent and sign-off.
          </p>
          <button
            className="mt-5 inline-flex min-h-11 items-center justify-center rounded-lg bg-lga-navy px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-800 focus:outline-none focus:ring-2 focus:ring-lga-sky focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-primary-600 dark:hover:bg-primary-500"
            disabled={busy}
            onClick={generatePackage}
            type="button"
          >
            {activeAction === 'package'
              ? 'Generating package…'
              : 'Generate document package'}
          </button>
        </section>
      )}

      <SignOffPanel
        busy={activeAction === 'sign'}
        consented={consented}
        disabled={!documentPackage || editing}
        onConsentChange={(value) => {
          setConsented(value);
          setPageError('');
        }}
        onSign={recordSignOff}
        onSignedByChange={(value) => {
          setSignedBy(value);
          setPageError('');
        }}
        signed={signed}
        signedBy={signedBy}
      />

      <section
        aria-labelledby="submission-readiness-title"
        className="rounded-xl border border-border bg-white p-5 shadow-card sm:p-6 dark:border-slate-700 dark:bg-slate-900"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2
              className="text-xl font-semibold text-lga-navy dark:text-white"
              id="submission-readiness-title"
            >
              Submission readiness
            </h2>
            <p className="mt-1 text-sm leading-6 text-text-muted dark:text-slate-300">
              All final gates must pass before the application can be
              submitted.
            </p>
          </div>
          <StatusBadge
            label={
              alreadySubmitted
                ? 'Submitted'
                : submissionReady
                  ? 'Ready to submit'
                  : 'Action required'
            }
            showDot={false}
            tone={
              alreadySubmitted || submissionReady
                ? 'success'
                : 'warning'
            }
          />
        </div>

        {alreadySubmitted ? (
          <div className="mt-5 rounded-lg border border-success bg-success-light p-4 text-sm text-success-dark dark:border-green-800 dark:bg-green-950 dark:text-green-100">
            This onboarding application has already been submitted.
          </div>
        ) : blockers.length > 0 ? (
          <ul className="mt-5 space-y-2">
            {blockers.map((blocker) => (
              <li
                className="flex gap-3 rounded-lg bg-warning-light p-3 text-sm text-warning-dark dark:bg-amber-950 dark:text-amber-100"
                key={blocker}
              >
                <span aria-hidden="true" className="font-bold">
                  !
                </span>
                <span>{blocker}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="mt-5 rounded-lg border border-success bg-success-light p-4 text-sm text-success-dark dark:border-green-800 dark:bg-green-950 dark:text-green-100">
            Validation, eligibility, document package, consent, and signature
            gates have passed.
          </div>
        )}

        <div className="mt-6 flex flex-col-reverse gap-3 border-t border-border pt-5 sm:flex-row sm:justify-end dark:border-slate-700">
          <button
            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-border bg-white px-5 py-2 text-sm font-semibold text-lga-navy transition-colors hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-lga-sky focus:ring-offset-2 dark:border-slate-600 dark:bg-slate-900 dark:text-white dark:hover:bg-slate-800"
            onClick={() => navigate(ROUTES.JOURNEYS)}
            type="button"
          >
            Return to journeys
          </button>
          {!alreadySubmitted && (
            <button
              className="inline-flex min-h-11 items-center justify-center rounded-lg bg-lga-navy px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-800 focus:outline-none focus:ring-2 focus:ring-lga-sky focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-primary-600 dark:hover:bg-primary-500"
              disabled={!submissionReady || busy || editing}
              onClick={submitJourney}
              type="button"
            >
              {activeAction === 'submit'
                ? 'Submitting application…'
                : 'Submit onboarding application'}
            </button>
          )}
        </div>
      </section>

      {submissionResult && (
        <section
          aria-labelledby="submission-result-title"
          className="rounded-xl border border-success bg-success-light p-5 shadow-card sm:p-6 dark:border-green-800 dark:bg-green-950"
        >
          <StatusBadge
            status={
              submissionResult.submitted === false
                ? 'manual_review'
                : 'submitted'
            }
          />
          <h2
            className="mt-4 text-xl font-semibold text-success-dark dark:text-green-100"
            id="submission-result-title"
          >
            {submissionResult.submitted === false
              ? 'Application routed for review'
              : 'Application submitted'}
          </h2>
          <p className="mt-2 text-sm leading-6 text-success-dark dark:text-green-200">
            {submissionResult.submitted === false
              ? 'The application was saved and routed to the simulated operations review flow.'
              : 'The submitted snapshot and simulated downstream handoff were created successfully.'}
          </p>
          <div className="mt-5">
            <JsonViewer
              data={submissionResult}
              fileName="journey-submission-result.json"
              redact
              showDownloadButton={false}
              title="Submission result"
            />
          </div>
        </section>
      )}
    </div>
  );
}

JourneyReviewPage.propTypes = {
  application: PropTypes.object,
  documentPackage: PropTypes.object,
  eligibility: PropTypes.object,
  onSave: PropTypes.func,
  onSignOff: PropTypes.func,
  onSubmit: PropTypes.func,
  validation: PropTypes.object,
};

export default JourneyReviewPage;