import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import JsonViewer from '../../components/shared/JsonViewer.jsx';
import StatusBadge from '../../components/shared/StatusBadge.jsx';
import {
  SOURCE_CHANNELS,
  SOURCE_FORMATS,
} from '../../constants/domain.js';
import { getJourneyRoute } from '../../constants/routes.js';
import { getSeeds } from '../../persistence/seedLoader.js';
import {
  createIntakeService,
  INTAKE_COMPLETENESS_STATUSES,
  INTAKE_NEXT_ACTIONS,
} from '../../services/onboarding/intakeService.js';
import { useAuthStore } from '../../stores/authStore.js';

const CUSTOM_SAMPLE_ID = 'custom';
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

const PROGRESS_STAGES = Object.freeze({
  idle: Object.freeze({
    label: 'Ready to process intake.',
    value: 0,
  }),
  reading: Object.freeze({
    label: 'Reading the selected source.',
    value: 20,
  }),
  normalizing: Object.freeze({
    label: 'Normalizing source records.',
    value: 55,
  }),
  validating: Object.freeze({
    label: 'Evaluating completeness and business rules.',
    value: 80,
  }),
  complete: Object.freeze({
    label: 'Intake processing complete.',
    value: 100,
  }),
});

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

function getAcceptedFileTypes(sourceFormat) {
  switch (sourceFormat) {
    case SOURCE_FORMATS.QUILITY_JSON:
      return '.json,application/json';

    case SOURCE_FORMATS.ETHOS_XML:
      return '.xml,application/xml,text/xml';

    case SOURCE_FORMATS.DTCC_FLAT_FILE:
      return '.dat,.txt,text/plain';

    case SOURCE_FORMATS.SURELC_TIF:
      return '.json,.tif,.tiff,application/json,image/tiff';

    case SOURCE_FORMATS.MANUAL_FORM:
    case SOURCE_FORMATS.CHANGE_REQUEST:
    default:
      return '.json,.txt,.eml,application/json,text/plain,message/rfc822';
  }
}

function createRequestFromState({
  bulk,
  fileName,
  mimeType,
  rawContent,
  selectedSample,
  simulateScenario,
  sourceChannel,
  sourceFormat,
}) {
  return {
    sourceChannel,
    sourceFormat,
    rawContent,
    partnerCode: selectedSample?.partnerCode,
    fileName: fileName || null,
    mimeType: mimeType || null,
    bulk,
    simulateScenario: simulateScenario || undefined,
    layout: selectedSample?.layout,
    envelope: selectedSample?.envelope,
    scenarioContext: selectedSample?.scenarioContext,
    enforcePartnerScope: false,
    requireAuthorization: false,
  };
}

function getRecordTone(record) {
  if (
    record.completenessStatus ===
    INTAKE_COMPLETENESS_STATUSES.REJECTED
  ) {
    return 'danger';
  }

  if (
    record.completenessStatus ===
      INTAKE_COMPLETENESS_STATUSES.MANUAL_EXCEPTION ||
    record.completenessStatus ===
      INTAKE_COMPLETENESS_STATUSES.INCOMPLETE_ONLINE_COMPLETABLE
  ) {
    return 'warning';
  }

  return 'success';
}

function getActionDescription(nextAction) {
  switch (nextAction) {
    case INTAKE_NEXT_ACTIONS.AUTO_SUBMIT_ELIGIBLE:
      return 'The normalized record is complete and eligible for the next onboarding step.';

    case INTAKE_NEXT_ACTIONS.JOURNEY_REQUIRED:
      return 'Additional information is required through a guided journey.';

    case INTAKE_NEXT_ACTIONS.MANUAL_EXCEPTION:
      return 'The record was accepted, but a business rule requires manual review.';

    case INTAKE_NEXT_ACTIONS.SUBMITTED:
      return 'The record was accepted and submitted to the simulated onboarding flow.';

    case INTAKE_NEXT_ACTIONS.REJECT:
      return 'The record could not be accepted. Correct the source data and try again.';

    case INTAKE_NEXT_ACTIONS.PER_RECORD_ROUTING:
      return 'Each record in the batch was evaluated and routed independently.';

    default:
      return 'Review the processing result before continuing.';
  }
}

function SummaryCard({ label, value }) {
  return (
    <div className="rounded-lg bg-surface-muted px-4 py-3 dark:bg-slate-800">
      <dt className="text-xs font-medium uppercase tracking-wide text-text-muted dark:text-slate-400">
        {label}
      </dt>
      <dd className="mt-1 text-2xl font-semibold text-lga-navy dark:text-white">
        {value}
      </dd>
    </div>
  );
}

SummaryCard.propTypes = {};

function ProcessingProgress({ stage }) {
  const progress = PROGRESS_STAGES[stage] ?? PROGRESS_STAGES.idle;

  return (
    <section
      aria-labelledby="intake-progress-title"
      className="rounded-xl border border-border bg-white p-5 shadow-card dark:border-slate-700 dark:bg-slate-900"
    >
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2
            className="font-semibold text-lga-navy dark:text-white"
            id="intake-progress-title"
          >
            Processing progress
          </h2>
          <p
            aria-live="polite"
            className="mt-1 text-sm text-text-muted dark:text-slate-300"
          >
            {progress.label}
          </p>
        </div>
        <span className="font-mono text-sm font-semibold text-lga-blue dark:text-primary-300">
          {progress.value}%
        </span>
      </div>
      <progress
        aria-label="Intake processing progress"
        className="mt-4 h-3 w-full overflow-hidden rounded-full accent-lga-sky"
        max="100"
        value={progress.value}
      >
        {progress.value}%
      </progress>
    </section>
  );
}

ProcessingProgress.propTypes = {};

function IntakeRecordResult({
  index,
  onCorrect,
  onOpenJourney,
  record,
  total,
}) {
  const rejected =
    record.completenessStatus ===
    INTAKE_COMPLETENESS_STATUSES.REJECTED;
  const canOpenJourney = Boolean(record.trackingId) && !rejected;
  const messages = Array.isArray(record.messages)
    ? record.messages
    : [];
  const normalizedPayload = record.normalizedPayload ?? null;

  return (
    <article className="overflow-hidden rounded-xl border border-border bg-white shadow-card dark:border-slate-700 dark:bg-slate-900">
      <div className="border-b border-border px-5 py-4 dark:border-slate-700">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-text-muted dark:text-slate-400">
              Record {index + 1} of {total}
            </p>
            <h3 className="mt-1 text-lg font-semibold text-lga-navy dark:text-white">
              {record.applicationId ?? 'Rejected intake record'}
            </h3>
            {record.trackingId && (
              <p className="mt-1 break-all font-mono text-xs text-text-muted dark:text-slate-400">
                {record.trackingId}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <StatusBadge
              status={record.completenessStatus}
              tone={getRecordTone(record)}
            />
            <StatusBadge
              showDot={false}
              status={record.nextAction}
            />
          </div>
        </div>
      </div>

      <div className="space-y-5 p-5">
        <p className="text-sm leading-6 text-text-muted dark:text-slate-300">
          {getActionDescription(record.nextAction)}
        </p>

        {record.missingFields?.length > 0 && (
          <section aria-labelledby={`missing-fields-${index}`}>
            <h4
              className="text-sm font-semibold text-text dark:text-white"
              id={`missing-fields-${index}`}
            >
              Information requiring correction
            </h4>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-text-muted dark:text-slate-300">
              {record.missingFields.map((field) => (
                <li className="break-words" key={field}>
                  {field}
                </li>
              ))}
            </ul>
          </section>
        )}

        {record.validationCodes?.length > 0 && (
          <section aria-labelledby={`validation-codes-${index}`}>
            <h4
              className="text-sm font-semibold text-text dark:text-white"
              id={`validation-codes-${index}`}
            >
              Validation indicators
            </h4>
            <div className="mt-2 flex flex-wrap gap-2">
              {record.validationCodes.map((code) => (
                <StatusBadge
                  key={code}
                  label={formatToken(code)}
                  severity={
                    rejected || record.manualReviewRequired
                      ? 'warning'
                      : 'info'
                  }
                  showDot={false}
                  size="sm"
                />
              ))}
            </div>
          </section>
        )}

        {messages.length > 0 && (
          <section aria-labelledby={`processing-messages-${index}`}>
            <h4
              className="text-sm font-semibold text-text dark:text-white"
              id={`processing-messages-${index}`}
            >
              Processing feedback
            </h4>
            <ul className="mt-2 space-y-2">
              {messages.map((message, messageIndex) => (
                <li
                  className="rounded-lg border border-border bg-surface-muted px-3 py-2 text-sm text-text-muted dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                  key={`${message.code ?? 'message'}-${messageIndex}`}
                >
                  <span className="font-medium text-text dark:text-white">
                    {formatToken(message.code ?? message.severity)}
                  </span>
                  {message.message && (
                    <span className="ml-1">{message.message}</span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {normalizedPayload && (
          <JsonViewer
            data={normalizedPayload}
            fileName={`normalized-${
              record.trackingId ?? `record-${index + 1}`
            }.json`}
            initiallyExpanded={total === 1}
            redact
            title="Normalized JSON preview"
          />
        )}

        <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:justify-end dark:border-slate-700">
          {rejected && (
            <button
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-border bg-white px-4 py-2 text-sm font-semibold text-lga-navy transition-colors hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-lga-sky focus:ring-offset-2 dark:border-slate-600 dark:bg-slate-900 dark:text-white dark:hover:bg-slate-800 dark:focus:ring-offset-slate-900"
              onClick={onCorrect}
              type="button"
            >
              Correct source data
            </button>
          )}

          {canOpenJourney && (
            <button
              className="inline-flex min-h-11 items-center justify-center rounded-lg bg-lga-navy px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-800 focus:outline-none focus:ring-2 focus:ring-lga-sky focus:ring-offset-2 dark:bg-primary-600 dark:hover:bg-primary-500 dark:focus:ring-offset-slate-900"
              onClick={() => onOpenJourney(record)}
              type="button"
            >
              {record.nextAction === INTAKE_NEXT_ACTIONS.JOURNEY_REQUIRED
                ? 'Continue guided journey'
                : 'Open accepted record'}
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

IntakeRecordResult.propTypes = {};

/**
 * Provides fixture-backed multi-channel intake, normalization preview,
 * completeness feedback, correction, and accepted-record actions.
 */
export function IntakePage() {
  const navigate = useNavigate();
  const sourceInputRef = useRef(null);
  const authState = useAuthStore();
  const samples = useMemo(() => getSeeds().intakeSamples, []);
  const intakeService = useMemo(() => createIntakeService(), []);
  const initialSample = samples[0] ?? null;
  const [selectedSampleId, setSelectedSampleId] = useState(
    initialSample?.id ?? CUSTOM_SAMPLE_ID,
  );
  const [sourceChannel, setSourceChannel] = useState(
    initialSample?.sourceChannel ?? SOURCE_CHANNELS.MANUAL,
  );
  const [sourceFormat, setSourceFormat] = useState(
    initialSample?.sourceFormat ?? SOURCE_FORMATS.MANUAL_FORM,
  );
  const [fileName, setFileName] = useState(
    initialSample?.fileName ?? '',
  );
  const [mimeType, setMimeType] = useState(
    initialSample?.mimeType ?? '',
  );
  const [bulk, setBulk] = useState(initialSample?.bulk ?? false);
  const [simulateScenario, setSimulateScenario] = useState(
    initialSample?.simulateScenario ?? '',
  );
  const [rawContent, setRawContent] = useState(
    initialSample?.rawContent ?? '',
  );
  const [result, setResult] = useState(null);
  const [processingStage, setProcessingStage] = useState('idle');
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');
  const [fileMessage, setFileMessage] = useState('');
  const selectedSample = useMemo(
    () =>
      samples.find((sample) => sample.id === selectedSampleId) ?? null,
    [samples, selectedSampleId],
  );
  const currentUser = authState.currentUser ?? authState.user;
  const principal = {
    ...authState,
    user: currentUser,
    currentUser,
    role: authState.role ?? currentUser?.role,
    isAuthenticated: authState.isAuthenticated,
    status: authState.isAuthenticated
      ? 'authenticated'
      : 'anonymous',
  };

  const applySample = (sampleId) => {
    setSelectedSampleId(sampleId);
    setResult(null);
    setError('');
    setFileMessage('');

    if (sampleId === CUSTOM_SAMPLE_ID) {
      setSimulateScenario('');
      return;
    }

    const sample = samples.find(
      (candidate) => candidate.id === sampleId,
    );

    if (!sample) {
      return;
    }

    setSourceChannel(sample.sourceChannel);
    setSourceFormat(sample.sourceFormat);
    setFileName(sample.fileName ?? '');
    setMimeType(sample.mimeType ?? '');
    setBulk(sample.bulk);
    setSimulateScenario(sample.simulateScenario);
    setRawContent(sample.rawContent);
  };

  const markCustomSource = () => {
    setSelectedSampleId(CUSTOM_SAMPLE_ID);
    setSimulateScenario('');
    setResult(null);
    setError('');
  };

  const readFile = async (event) => {
    const file = event.target.files?.[0];

    setFileMessage('');
    setError('');
    setResult(null);

    if (!file) {
      return;
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      setError('Select a source file no larger than 5 MB.');
      event.target.value = '';
      return;
    }

    setProcessingStage('reading');

    try {
      const content = await file.text();

      if (content.trim() === '') {
        throw new Error('The selected source file is empty.');
      }

      setSelectedSampleId(CUSTOM_SAMPLE_ID);
      setSimulateScenario('');
      setRawContent(content);
      setFileName(file.name);
      setMimeType(file.type || 'text/plain');
      setFileMessage(`${file.name} is ready to process.`);
      setProcessingStage('idle');
    } catch (fileError) {
      setError(
        fileError instanceof Error && fileError.message
          ? fileError.message
          : 'The selected source file could not be read.',
      );
      setProcessingStage('idle');
    }
  };

  const processSubmission = async (event) => {
    event.preventDefault();
    setError('');
    setResult(null);

    if (rawContent.trim() === '') {
      setError('Enter source content or select a mock source file.');
      sourceInputRef.current?.focus();
      return;
    }

    setProcessing(true);
    setProcessingStage('normalizing');

    try {
      await new Promise((resolve) => {
        globalThis.setTimeout(resolve, 120);
      });

      setProcessingStage('validating');

      await new Promise((resolve) => {
        globalThis.setTimeout(resolve, 120);
      });

      const importResult = intakeService.importSubmission({
        ...createRequestFromState({
          bulk,
          fileName,
          mimeType,
          rawContent,
          selectedSample,
          simulateScenario,
          sourceChannel,
          sourceFormat,
        }),
        requestedBy: principal,
      });

      setResult(importResult);
      setProcessingStage('complete');
    } catch (processingError) {
      setError(
        processingError instanceof Error && processingError.message
          ? processingError.message
          : 'The intake submission could not be processed. Correct the source and try again.',
      );
      setProcessingStage('idle');
    } finally {
      setProcessing(false);
    }
  };

  const correctSource = () => {
    setResult(null);
    setError('');
    setProcessingStage('idle');

    globalThis.requestAnimationFrame(() => {
      sourceInputRef.current?.focus();
      sourceInputRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    });
  };

  const openJourney = (record) => {
    navigate(getJourneyRoute(record.trackingId));
  };

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6">
      <header>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge label="Simulation" showDot={false} simulation />
          <StatusBadge
            label="Synthetic data only"
            showDot={false}
            tone="warning"
          />
        </div>
        <h1 className="mt-3 text-2xl font-semibold text-lga-navy sm:text-3xl dark:text-white">
          Intake and mock submission
        </h1>
        <p className="mt-2 max-w-4xl text-sm leading-6 text-text-muted sm:text-base dark:text-slate-300">
          Select a fixture or provide synthetic source content to simulate
          multi-channel parsing, normalization, completeness evaluation, and
          onboarding routing.
        </p>
      </header>

      <aside
        className="rounded-xl border border-accent-300 bg-accent-100 p-4 text-sm leading-6 text-accent-950 dark:border-accent-700 dark:bg-accent-950 dark:text-accent-100"
        role="note"
      >
        Do not upload real customer, producer, banking, tax, licensing, or
        contact information. Files are processed locally in this browser.
      </aside>

      {error && (
        <div
          className="rounded-xl border border-danger bg-danger-light p-4 text-sm text-danger-dark dark:border-red-700 dark:bg-danger-dark dark:text-red-100"
          role="alert"
        >
          <p className="font-semibold">Intake processing could not continue</p>
          <p className="mt-1">{error}</p>
        </div>
      )}

      <form
        className="overflow-hidden rounded-xl border border-border bg-white shadow-card dark:border-slate-700 dark:bg-slate-900"
        noValidate
        onSubmit={processSubmission}
      >
        <div className="border-b border-border px-5 py-4 sm:px-6 dark:border-slate-700">
          <h2 className="text-lg font-semibold text-lga-navy dark:text-white">
            Source configuration
          </h2>
          <p className="mt-1 text-sm text-text-muted dark:text-slate-300">
            Fixture selections populate the source metadata and content. You
            can edit any value before processing.
          </p>
        </div>

        <fieldset
          className="space-y-6 p-5 sm:p-6"
          disabled={processing}
        >
          <legend className="sr-only">Intake source configuration</legend>

          <div>
            <label
              className="block text-sm font-medium text-text dark:text-slate-100"
              htmlFor="intake-sample"
            >
              Mock intake scenario
            </label>
            <select
              className="mt-1 min-h-11 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text shadow-sm focus:border-lga-sky focus:outline-none focus:ring-2 focus:ring-lga-sky dark:border-slate-600 dark:bg-slate-900 dark:text-white"
              id="intake-sample"
              onChange={(event) => applySample(event.target.value)}
              value={selectedSampleId}
            >
              <option value={CUSTOM_SAMPLE_ID}>
                Custom synthetic source
              </option>
              {samples.map((sample) => (
                <option key={sample.id} value={sample.id}>
                  {sample.name}
                </option>
              ))}
            </select>
            {selectedSample && (
              <p className="mt-2 text-sm leading-6 text-text-muted dark:text-slate-400">
                {selectedSample.description}
              </p>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label
                className="block text-sm font-medium text-text dark:text-slate-100"
                htmlFor="source-channel"
              >
                Source channel
              </label>
              <select
                className="mt-1 min-h-11 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text shadow-sm focus:border-lga-sky focus:outline-none focus:ring-2 focus:ring-lga-sky dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                id="source-channel"
                onChange={(event) => {
                  setSourceChannel(event.target.value);
                  markCustomSource();
                }}
                value={sourceChannel}
              >
                {Object.values(SOURCE_CHANNELS).map((channel) => (
                  <option key={channel} value={channel}>
                    {formatToken(channel)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                className="block text-sm font-medium text-text dark:text-slate-100"
                htmlFor="source-format"
              >
                Source format
              </label>
              <select
                className="mt-1 min-h-11 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text shadow-sm focus:border-lga-sky focus:outline-none focus:ring-2 focus:ring-lga-sky dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                id="source-format"
                onChange={(event) => {
                  setSourceFormat(event.target.value);
                  markCustomSource();
                }}
                value={sourceFormat}
              >
                {Object.values(SOURCE_FORMATS).map((format) => (
                  <option key={format} value={format}>
                    {formatToken(format)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label
                className="block text-sm font-medium text-text dark:text-slate-100"
                htmlFor="source-file"
              >
                Synthetic source file
              </label>
              <input
                accept={getAcceptedFileTypes(sourceFormat)}
                className="mt-1 block min-h-11 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text file:mr-3 file:rounded-md file:border-0 file:bg-primary-50 file:px-3 file:py-1 file:font-medium file:text-lga-navy focus:outline-none focus:ring-2 focus:ring-lga-sky dark:border-slate-600 dark:bg-slate-900 dark:text-white dark:file:bg-primary-950 dark:file:text-primary-100"
                id="source-file"
                onChange={readFile}
                type="file"
              />
              <p className="mt-1 text-xs text-text-muted dark:text-slate-400">
                Maximum file size: 5 MB.
              </p>
              {fileMessage && (
                <p
                  className="mt-1 text-sm text-success-dark dark:text-green-200"
                  role="status"
                >
                  {fileMessage}
                </p>
              )}
            </div>

            <div className="space-y-4">
              <div>
                <label
                  className="block text-sm font-medium text-text dark:text-slate-100"
                  htmlFor="source-file-name"
                >
                  File name
                </label>
                <input
                  className="mt-1 min-h-11 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text shadow-sm focus:border-lga-sky focus:outline-none focus:ring-2 focus:ring-lga-sky dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                  id="source-file-name"
                  onChange={(event) => {
                    setFileName(event.target.value);
                    markCustomSource();
                  }}
                  placeholder="synthetic-intake.json"
                  value={fileName}
                />
              </div>

              <label className="flex min-h-11 items-center gap-3 rounded-lg border border-border px-3 py-2 text-sm text-text dark:border-slate-600 dark:text-slate-100">
                <input
                  checked={bulk}
                  className="size-5 rounded border-border text-lga-navy focus:ring-lga-sky"
                  onChange={(event) => {
                    setBulk(event.target.checked);
                    markCustomSource();
                  }}
                  type="checkbox"
                />
                Process the source as a bulk batch
              </label>
            </div>
          </div>

          <div>
            <label
              className="block text-sm font-medium text-text dark:text-slate-100"
              htmlFor="source-content"
            >
              Source content
            </label>
            <p
              className="mt-1 text-xs leading-5 text-text-muted dark:text-slate-400"
              id="source-content-help"
            >
              Review or correct the synthetic payload before processing.
            </p>
            <textarea
              aria-describedby="source-content-help"
              className="mt-2 min-h-80 w-full resize-y rounded-lg border border-border bg-slate-950 px-4 py-3 font-mono text-xs leading-5 text-slate-100 shadow-sm focus:border-lga-sky focus:outline-none focus:ring-2 focus:ring-lga-sky"
              id="source-content"
              onChange={(event) => {
                setRawContent(event.target.value);
                markCustomSource();
              }}
              ref={sourceInputRef}
              spellCheck="false"
              value={rawContent}
            />
          </div>
        </fieldset>

        <div className="flex flex-col gap-3 border-t border-border bg-surface-muted px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 dark:border-slate-700 dark:bg-slate-800">
          <p className="text-xs text-text-muted dark:text-slate-400">
            Processing is local and does not call external providers.
          </p>
          <button
            className="inline-flex min-h-11 items-center justify-center rounded-lg bg-lga-navy px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-800 focus:outline-none focus:ring-2 focus:ring-lga-sky focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-primary-600 dark:hover:bg-primary-500 dark:focus:ring-offset-slate-900"
            disabled={processing}
            type="submit"
          >
            {processing
              ? 'Processing intake…'
              : 'Process mock submission'}
          </button>
        </div>
      </form>

      {(processing || processingStage !== 'idle') && (
        <ProcessingProgress stage={processingStage} />
      )}

      {result && (
        <section
          aria-labelledby="intake-results-title"
          className="space-y-5"
        >
          <div className="rounded-xl border border-border bg-white p-5 shadow-card sm:p-6 dark:border-slate-700 dark:bg-slate-900">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2
                  className="text-xl font-semibold text-lga-navy dark:text-white"
                  id="intake-results-title"
                >
                  Intake processing results
                </h2>
                <p className="mt-1 text-sm text-text-muted dark:text-slate-300">
                  {getActionDescription(result.nextAction)}
                </p>
              </div>
              <StatusBadge status={result.nextAction} />
            </div>

            <dl className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <SummaryCard
                label="Received"
                value={result.summary.received}
              />
              <SummaryCard
                label="Normalized"
                value={result.summary.normalized}
              />
              <SummaryCard
                label="Rejected"
                value={result.summary.rejected}
              />
              <SummaryCard
                label="Journey required"
                value={result.summary.requiresJourney}
              />
            </dl>

            <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-text-muted dark:text-slate-400">
                  Import batch
                </dt>
                <dd className="mt-1 break-all font-mono text-xs text-text dark:text-slate-200">
                  {result.importBatchId}
                </dd>
              </div>
              <div>
                <dt className="text-text-muted dark:text-slate-400">
                  Source channel
                </dt>
                <dd className="mt-1 font-medium text-text dark:text-white">
                  {formatToken(result.sourceChannel)}
                </dd>
              </div>
              <div>
                <dt className="text-text-muted dark:text-slate-400">
                  Source format
                </dt>
                <dd className="mt-1 font-medium text-text dark:text-white">
                  {formatToken(result.sourceFormat)}
                </dd>
              </div>
            </dl>
          </div>

          <div className="space-y-5">
            {result.records.map((record, index) => (
              <IntakeRecordResult
                index={index}
                key={
                  record.trackingId ??
                  record.applicationId ??
                  `intake-result-${index}`
                }
                onCorrect={correctSource}
                onOpenJourney={openJourney}
                record={record}
                total={result.records.length}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

export default IntakePage;