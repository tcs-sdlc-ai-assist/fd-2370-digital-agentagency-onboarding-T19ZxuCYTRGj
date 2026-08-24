import { useId, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import {
  downloadJson,
  downloadPlaceholderDocument,
} from '../../utils/downloads.js';
import { formatDisplayDateTime } from '../../utils/dates.js';
import StatusBadge from '../shared/StatusBadge.jsx';

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeToken(value) {
  if (
    value === null ||
    value === undefined ||
    String(value).trim() === ''
  ) {
    return '';
  }

  return String(value)
    .trim()
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function normalizeForm(form, index) {
  if (typeof form === 'string' || typeof form === 'number') {
    const code = String(form).trim();

    return {
      code,
      description: '',
      metadata: {},
      name: code,
      required: true,
      signatureRequired: false,
      signerType: null,
      status: 'REQUIRED',
      sourceIndex: index,
    };
  }

  if (!isObject(form)) {
    return {
      code: `FORM-${index + 1}`,
      description: '',
      metadata: {},
      name: `Document ${index + 1}`,
      required: true,
      signatureRequired: false,
      signerType: null,
      status: 'REQUIRED',
      sourceIndex: index,
    };
  }

  const code = String(
    form.code ?? form.documentCode ?? form.id ?? `FORM-${index + 1}`,
  ).trim();

  return {
    ...form,
    code,
    description: form.description ?? '',
    metadata: isObject(form.metadata) ? form.metadata : {},
    name: form.name ?? form.title ?? code,
    required: form.required !== false,
    signatureRequired: form.signatureRequired === true,
    signerType: form.signerType ?? null,
    status: form.status ?? 'REQUIRED',
    sourceIndex: index,
  };
}

function getArtifactForForm(artifacts, form) {
  const formCode = normalizeToken(form.code);

  return artifacts.find(
    (artifact) =>
      normalizeToken(
        artifact.documentCode ??
          artifact.code ??
          artifact.referenceId ??
          artifact.artifactId,
      ) === formCode,
  );
}

function isGeneralAgencySigner(signerType) {
  return [
    'ga',
    'ga_signature',
    'general_agency',
    'general_agency_signature',
  ].includes(normalizeToken(signerType));
}

function isAgentSigner(signerType) {
  const token = normalizeToken(signerType);

  return (
    token === '' ||
    [
      'agent',
      'agent_signature',
      'applicant',
      'applicant_signature',
      'producer',
      'producer_signature',
    ].includes(token)
  );
}

function getRetainedSignature(signatures, predicate) {
  return Object.entries(signatures).find(([type, signature]) =>
    predicate(signature?.signerType ?? signature?.signatureType ?? type),
  )?.[1];
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

function createPackageDownloadValue(documentPackage, forms, artifacts) {
  return {
    trackingId: documentPackage.trackingId ?? null,
    applicationId: documentPackage.applicationId ?? null,
    packageVersion: documentPackage.packageVersion ?? 1,
    status: documentPackage.status ?? 'DRAFT',
    packageComplete: documentPackage.packageComplete === true,
    retainedGaSignature:
      documentPackage.retainedGaSignature === true,
    agentSignatureState:
      documentPackage.agentSignatureState ?? 'NOT_STARTED',
    requiredForms: forms.map((form) => ({
      code: form.code,
      name: form.name,
      required: form.required,
      status: form.status,
      signatureRequired: form.signatureRequired,
      signerType: form.signerType,
    })),
    generatedArtifacts: artifacts.map((artifact) => ({
      artifactId: artifact.artifactId ?? null,
      referenceId: artifact.referenceId ?? null,
      documentCode: artifact.documentCode ?? null,
      name: artifact.name ?? null,
      fileName: artifact.fileName ?? null,
      mimeType: artifact.mimeType ?? null,
      status: artifact.status ?? null,
      generatedAt: artifact.generatedAt ?? null,
      signedAt: artifact.signedAt ?? null,
    })),
    signOff: {
      status: documentPackage.signOff?.status ?? 'NOT_STARTED',
      consented: documentPackage.signOff?.consented === true,
      consentedAt: documentPackage.signOff?.consentedAt ?? null,
      signedAt: documentPackage.signOff?.signedAt ?? null,
      envelopeId: documentPackage.signOff?.envelopeId ?? null,
    },
    generatedAt: documentPackage.generatedAt ?? null,
    updatedAt: documentPackage.updatedAt ?? null,
    completedAt: documentPackage.completedAt ?? null,
  };
}

function PackageMetadata({ documentPackage, forms, artifacts }) {
  const metadata = [
    {
      label: 'Package version',
      value: documentPackage.packageVersion ?? 1,
    },
    {
      label: 'Required forms',
      value: forms.filter((form) => form.required).length,
    },
    {
      label: 'Generated artifacts',
      value: artifacts.length,
    },
    {
      label: 'Generated',
      value: formatDate(documentPackage.generatedAt),
    },
    {
      label: 'Last updated',
      value: formatDate(documentPackage.updatedAt),
    },
    {
      label: 'Completed',
      value: formatDate(documentPackage.completedAt),
    },
  ];

  return (
    <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {metadata.map((item) => (
        <div
          className="rounded-lg bg-surface-muted px-3 py-3 dark:bg-slate-800"
          key={item.label}
        >
          <dt className="text-xs font-medium uppercase tracking-wide text-text-muted dark:text-slate-400">
            {item.label}
          </dt>
          <dd className="mt-1 break-words text-sm font-semibold text-text dark:text-slate-100">
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

PackageMetadata.propTypes = {
  artifacts: PropTypes.arrayOf(PropTypes.object).isRequired,
  documentPackage: PropTypes.object.isRequired,
  forms: PropTypes.arrayOf(PropTypes.object).isRequired,
};

function SignatureSummary({ documentPackage, retainedSignatures }) {
  const gaSignature = getRetainedSignature(
    retainedSignatures,
    isGeneralAgencySigner,
  );
  const gaRetained =
    documentPackage.retainedGaSignature === true ||
    gaSignature?.retained === true;
  const gaStatus = gaSignature?.status ?? (gaRetained ? 'SIGNED' : 'NOT_STARTED');
  const signOff = documentPackage.signOff ?? {};
  const agentStatus =
    documentPackage.agentSignatureState ??
    signOff.status ??
    'NOT_STARTED';

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <article className="rounded-xl border border-border p-4 dark:border-slate-700">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold text-lga-navy dark:text-white">
              General agency signature
            </h3>
            <p className="mt-1 text-sm text-text-muted dark:text-slate-400">
              Reused only when a valid retained signature is available.
            </p>
          </div>
          <StatusBadge
            status={gaRetained ? gaStatus : 'Not retained'}
          />
        </div>
        <dl className="mt-4 space-y-2 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-text-muted dark:text-slate-400">
              Retained
            </dt>
            <dd className="font-medium text-text dark:text-slate-100">
              {gaRetained ? 'Yes' : 'No'}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-text-muted dark:text-slate-400">
              Captured
            </dt>
            <dd className="text-right font-medium text-text dark:text-slate-100">
              {formatDate(gaSignature?.capturedAt)}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-text-muted dark:text-slate-400">
              Expires
            </dt>
            <dd className="text-right font-medium text-text dark:text-slate-100">
              {formatDate(gaSignature?.expiresAt)}
            </dd>
          </div>
        </dl>
      </article>

      <article className="rounded-xl border border-border p-4 dark:border-slate-700">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold text-lga-navy dark:text-white">
              Agent sign-off
            </h3>
            <p className="mt-1 text-sm text-text-muted dark:text-slate-400">
              Electronic consent and signature status for this package.
            </p>
          </div>
          <StatusBadge status={agentStatus} />
        </div>
        <dl className="mt-4 space-y-2 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-text-muted dark:text-slate-400">
              E-sign consent
            </dt>
            <dd className="font-medium text-text dark:text-slate-100">
              {signOff.consented === true ? 'Recorded' : 'Not recorded'}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-text-muted dark:text-slate-400">
              Consented
            </dt>
            <dd className="text-right font-medium text-text dark:text-slate-100">
              {formatDate(signOff.consentedAt)}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-text-muted dark:text-slate-400">
              Signed
            </dt>
            <dd className="text-right font-medium text-text dark:text-slate-100">
              {formatDate(signOff.signedAt)}
            </dd>
          </div>
        </dl>
      </article>
    </div>
  );
}

SignatureSummary.propTypes = {
  documentPackage: PropTypes.object.isRequired,
  retainedSignatures: PropTypes.object.isRequired,
};

function FormPreviewCard({
  artifact,
  busy,
  form,
  index,
  onDownload,
  total,
}) {
  const signerLabel = isGeneralAgencySigner(form.signerType)
    ? 'General agency signature'
    : isAgentSigner(form.signerType)
      ? 'Agent sign-off'
      : form.signerType
        ? `${String(form.signerType).replace(/[_-]+/g, ' ')} signature`
        : 'Signature';

  return (
    <li className="overflow-hidden rounded-xl border border-border bg-white dark:border-slate-700 dark:bg-slate-900">
      <div className="flex flex-col gap-3 border-b border-border px-4 py-3 sm:flex-row sm:items-start sm:justify-between dark:border-slate-700">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-text-muted dark:text-slate-400">
            Placeholder page {index + 1} of {total}
          </p>
          <h3 className="mt-1 break-words font-semibold text-lga-navy dark:text-white">
            {form.name}
          </h3>
          <p className="mt-1 font-mono text-xs text-text-muted dark:text-slate-400">
            {form.code}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {form.required && (
            <StatusBadge
              label="Required"
              showDot={false}
              status="action_required"
            />
          )}
          <StatusBadge
            showDot={false}
            status={artifact?.status ?? form.status}
          />
        </div>
      </div>

      <div className="p-4">
        <div className="flex min-h-40 flex-col justify-between rounded-lg border border-dashed border-border-strong bg-surface-muted p-4 dark:border-slate-600 dark:bg-slate-800">
          <div>
            <p className="text-sm font-semibold text-text dark:text-white">
              Synthetic document preview
            </p>
            <p className="mt-2 text-sm leading-6 text-text-muted dark:text-slate-300">
              {form.description ||
                'This placeholder represents a form in the generated onboarding package.'}
            </p>
          </div>

          {form.signatureRequired && (
            <div className="mt-6 border-t border-slate-400 pt-2 dark:border-slate-500">
              <p className="text-xs font-medium uppercase tracking-wide text-text-muted dark:text-slate-400">
                {signerLabel} location
              </p>
              <p className="mt-1 text-xs text-text-muted dark:text-slate-400">
                Signature and date are applied during simulated electronic
                sign-off.
              </p>
            </div>
          )}
        </div>

        <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-text-muted dark:text-slate-400">
              Artifact reference
            </dt>
            <dd className="mt-1 break-all font-mono text-xs text-text dark:text-slate-200">
              {artifact?.referenceId ?? artifact?.artifactId ?? 'Pending'}
            </dd>
          </div>
          <div>
            <dt className="text-text-muted dark:text-slate-400">
              Generated
            </dt>
            <dd className="mt-1 text-text dark:text-slate-200">
              {formatDate(artifact?.generatedAt)}
            </dd>
          </div>
        </dl>

        <button
          aria-label={`Download ${form.code} placeholder`}
          className="mt-4 inline-flex min-h-10 items-center justify-center rounded-lg border border-border bg-white px-4 py-2 text-sm font-semibold text-lga-navy transition-colors hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-lga-sky focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-white dark:hover:bg-slate-800 dark:focus:ring-offset-slate-900"
          disabled={busy}
          onClick={() => onDownload(form, artifact)}
          type="button"
        >
          {busy ? 'Preparing…' : `Download ${form.code}`}
        </button>
      </div>
    </li>
  );
}

FormPreviewCard.propTypes = {
  artifact: PropTypes.object,
  busy: PropTypes.bool.isRequired,
  form: PropTypes.object.isRequired,
  index: PropTypes.number.isRequired,
  onDownload: PropTypes.func.isRequired,
  total: PropTypes.number.isRequired,
};

/**
 * Displays selected forms, synthetic pages, signature locations, package
 * dates, and safe placeholder downloads.
 */
export function DocumentPackagePreview({
  'aria-label': ariaLabel = 'Document package preview',
  className = '',
  data,
  documentPackage,
  emptyMessage = 'No forms have been selected for this package.',
  error = null,
  loading = false,
  loadingMessage = 'Loading document package…',
  onDownload,
  packageData,
  showDownloads = true,
  title = 'Document package preview',
}) {
  const headingId = useId();
  const [activeDownload, setActiveDownload] = useState('');
  const [actionError, setActionError] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const resolvedPackage = documentPackage ?? packageData ?? data ?? {};
  const forms = useMemo(
    () =>
      (resolvedPackage.requiredForms ?? []).map((form, index) =>
        normalizeForm(form, index),
      ),
    [resolvedPackage.requiredForms],
  );
  const artifacts = useMemo(
    () =>
      Array.isArray(resolvedPackage.generatedArtifacts)
        ? resolvedPackage.generatedArtifacts
        : [],
    [resolvedPackage.generatedArtifacts],
  );
  const retainedSignatures = isObject(
    resolvedPackage.retainedSignatures,
  )
    ? resolvedPackage.retainedSignatures
    : {};
  const packageError =
    error instanceof Error ? error.message : error;
  const packageStatus =
    resolvedPackage.status ??
    (resolvedPackage.packageComplete ? 'COMPLETE' : 'DRAFT');

  const notifyDownload = async (artifact, context) => {
    if (typeof onDownload === 'function') {
      await onDownload(artifact, context);
    }
  };

  const downloadForm = async (form, artifact) => {
    setActiveDownload(form.code);
    setActionError('');
    setActionMessage('');

    try {
      const downloadArtifact = downloadPlaceholderDocument(
        artifact?.fileName ?? `${form.code}.txt`,
        {
          title: form.name,
          description:
            form.description ||
            'Synthetic onboarding document placeholder.',
          documentType: form.code,
          referenceId:
            artifact?.referenceId ??
            artifact?.artifactId ??
            `${resolvedPackage.trackingId ?? 'package'}:${form.code}`,
          generatedAt:
            artifact?.generatedAt ??
            resolvedPackage.generatedAt ??
            Date.now(),
          metadata: {
            trackingId: resolvedPackage.trackingId ?? null,
            applicationId: resolvedPackage.applicationId ?? null,
            packageVersion: resolvedPackage.packageVersion ?? 1,
            documentCode: form.code,
            signatureRequired: form.signatureRequired,
            signerType: form.signerType,
            synthetic: true,
          },
          redact: true,
        },
      );

      await notifyDownload(downloadArtifact, {
        type: 'form',
        form,
        artifact: artifact ?? null,
      });
      setActionMessage(`${form.code} placeholder download started.`);
    } catch {
      setActionError(
        `The ${form.code} placeholder could not be downloaded. Try again.`,
      );
    } finally {
      setActiveDownload('');
    }
  };

  const downloadManifest = async () => {
    setActiveDownload('package-manifest');
    setActionError('');
    setActionMessage('');

    try {
      const artifact = downloadJson(
        createPackageDownloadValue(
          resolvedPackage,
          forms,
          artifacts,
        ),
        `document-package-${
          resolvedPackage.trackingId ?? 'preview'
        }.json`,
        {
          redact: true,
          space: 2,
        },
      );

      await notifyDownload(artifact, {
        type: 'manifest',
        documentPackage: resolvedPackage,
      });
      setActionMessage('Document package manifest download started.');
    } catch {
      setActionError(
        'The document package manifest could not be downloaded. Try again.',
      );
    } finally {
      setActiveDownload('');
    }
  };

  return (
    <section
      aria-busy={loading || activeDownload !== ''}
      aria-label={ariaLabel}
      aria-labelledby={headingId}
      className={`w-full overflow-hidden rounded-xl border border-border bg-white shadow-card dark:border-slate-700 dark:bg-slate-900 ${className}`.trim()}
    >
      <div className="flex flex-col gap-4 border-b border-border px-5 py-5 sm:flex-row sm:items-start sm:justify-between sm:px-6 dark:border-slate-700">
        <div>
          <h2
            className="text-xl font-semibold text-lga-navy dark:text-white"
            id={headingId}
          >
            {title}
          </h2>
          <p className="mt-2 text-sm leading-6 text-text-muted dark:text-slate-300">
            Preview synthetic package pages and signature locations. Downloads
            contain placeholder data only.
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <StatusBadge status={packageStatus} />
          {resolvedPackage.packageComplete === true && (
            <StatusBadge status="complete" />
          )}
          {showDownloads && forms.length > 0 && (
            <button
              aria-label="Download document package manifest"
              className="inline-flex min-h-10 items-center justify-center rounded-lg border border-border px-3 py-2 text-sm font-semibold text-lga-navy transition-colors hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-lga-sky focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:text-white dark:hover:bg-slate-800 dark:focus:ring-offset-slate-900"
              disabled={loading || activeDownload !== ''}
              onClick={downloadManifest}
              type="button"
            >
              {activeDownload === 'package-manifest'
                ? 'Preparing…'
                : 'Download manifest'}
            </button>
          )}
        </div>
      </div>

      <div className="space-y-6 p-5 sm:p-6">
        {loading ? (
          <div
            className="rounded-lg bg-surface-muted px-4 py-10 text-center text-sm text-text-muted dark:bg-slate-800 dark:text-slate-300"
            role="status"
          >
            {loadingMessage}
          </div>
        ) : packageError ? (
          <div
            className="rounded-lg border border-danger bg-danger-light p-4 text-sm text-danger-dark dark:border-red-700 dark:bg-danger-dark dark:text-red-100"
            role="alert"
          >
            {packageError}
          </div>
        ) : (
          <>
            <PackageMetadata
              artifacts={artifacts}
              documentPackage={resolvedPackage}
              forms={forms}
            />

            <SignatureSummary
              documentPackage={resolvedPackage}
              retainedSignatures={retainedSignatures}
            />

            <div>
              <div className="mb-4">
                <h3 className="text-lg font-semibold text-lga-navy dark:text-white">
                  Selected forms
                </h3>
                <p className="mt-1 text-sm text-text-muted dark:text-slate-400">
                  Each card represents a safe placeholder page in the
                  generated package.
                </p>
              </div>

              {forms.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border-strong bg-surface-muted px-4 py-10 text-center text-sm text-text-muted dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  {emptyMessage}
                </div>
              ) : (
                <ol className="grid list-none gap-4 p-0 lg:grid-cols-2">
                  {forms.map((form, index) => {
                    const artifact = getArtifactForForm(
                      artifacts,
                      form,
                    );

                    return (
                      <FormPreviewCard
                        artifact={artifact}
                        busy={
                          activeDownload !== '' || !showDownloads
                        }
                        form={form}
                        index={index}
                        key={`${form.code}-${form.sourceIndex}`}
                        onDownload={downloadForm}
                        total={forms.length}
                      />
                    );
                  })}
                </ol>
              )}
            </div>
          </>
        )}

        <div aria-live="polite" className="sr-only" role="status">
          {actionMessage}
        </div>

        {actionError && (
          <div
            className="rounded-lg border border-danger bg-danger-light p-4 text-sm text-danger-dark dark:border-red-700 dark:bg-danger-dark dark:text-red-100"
            role="alert"
          >
            {actionError}
          </div>
        )}

        <p className="border-t border-border pt-4 text-xs leading-5 text-text-muted dark:border-slate-700 dark:text-slate-400">
          Simulation only. Placeholder downloads are not official forms,
          contracts, or signed documents and must not contain production data.
        </p>
      </div>
    </section>
  );
}

DocumentPackagePreview.propTypes = {
  'aria-label': PropTypes.string,
  className: PropTypes.string,
  data: PropTypes.object,
  documentPackage: PropTypes.object,
  emptyMessage: PropTypes.node,
  error: PropTypes.oneOfType([
    PropTypes.string,
    PropTypes.instanceOf(Error),
  ]),
  loading: PropTypes.bool,
  loadingMessage: PropTypes.node,
  onDownload: PropTypes.func,
  packageData: PropTypes.object,
  showDownloads: PropTypes.bool,
  title: PropTypes.node,
};

export default DocumentPackagePreview;