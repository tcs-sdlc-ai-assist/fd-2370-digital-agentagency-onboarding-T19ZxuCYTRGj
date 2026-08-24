import { useId, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { downloadJson } from '../../utils/downloads.js';
import { redactForExport } from '../../utils/redaction.js';

function convertToJsonSafeValue(value, ancestors = new WeakSet()) {
  if (value === null) {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }

  switch (typeof value) {
    case 'string':
    case 'boolean':
      return value;

    case 'number':
      return Number.isFinite(value) ? value : null;

    case 'bigint':
      return value.toString();

    case 'undefined':
    case 'function':
    case 'symbol':
      return undefined;

    case 'object': {
      if (ancestors.has(value)) {
        return '[Circular]';
      }

      ancestors.add(value);

      let convertedValue;

      if (Array.isArray(value)) {
        convertedValue = value.map(
          (item) => convertToJsonSafeValue(item, ancestors) ?? null,
        );
      } else {
        convertedValue = Object.fromEntries(
          Object.entries(value).flatMap(([key, nestedValue]) => {
            const convertedNestedValue = convertToJsonSafeValue(
              nestedValue,
              ancestors,
            );

            return convertedNestedValue === undefined
              ? []
              : [[key, convertedNestedValue]];
          }),
        );
      }

      ancestors.delete(value);
      return convertedValue;
    }

    default:
      return undefined;
  }
}

function prepareJson(value, redact, space) {
  try {
    const safeValue = convertToJsonSafeValue(value) ?? null;
    const displayValue = redact
      ? redactForExport(safeValue)
      : safeValue;
    const content = JSON.stringify(displayValue, null, space);

    return {
      content: `${content ?? 'null'}\n`,
      error: null,
      value: displayValue,
    };
  } catch {
    return {
      content: '',
      error: 'The JSON payload could not be displayed.',
      value: null,
    };
  }
}

/**
 * Displays a safe, collapsible JSON payload with copy and download actions.
 */
export function JsonViewer({
  'aria-label': ariaLabel = 'JSON payload viewer',
  className = '',
  data,
  value,
  title = 'Raw JSON',
  defaultExpanded,
  initiallyExpanded = false,
  expanded,
  onExpandedChange,
  fileName = 'payload.json',
  onCopy,
  onDownload,
  redact = false,
  showActions = true,
  showCopyButton = true,
  showDownloadButton = true,
  space = 2,
}) {
  const contentId = useId();
  const [internalExpanded, setInternalExpanded] = useState(
    defaultExpanded ?? initiallyExpanded,
  );
  const [copying, setCopying] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [actionMessage, setActionMessage] = useState('');
  const [actionError, setActionError] = useState('');
  const payload = data === undefined ? value : data;
  const preparedJson = useMemo(
    () => prepareJson(payload, redact, space),
    [payload, redact, space],
  );
  const isExpanded = expanded ?? internalExpanded;
  const actionsAvailable =
    showActions &&
    (showCopyButton || showDownloadButton) &&
    preparedJson.error === null;

  const toggleExpanded = () => {
    const nextExpanded = !isExpanded;

    setActionError('');

    if (expanded === undefined) {
      setInternalExpanded(nextExpanded);
    }

    if (typeof onExpandedChange === 'function') {
      try {
        onExpandedChange(nextExpanded);
      } catch {
        setActionError(
          'The payload display state could not be updated.',
        );
      }
    }
  };

  const copyJson = async () => {
    setCopying(true);
    setActionMessage('');
    setActionError('');

    try {
      if (
        !globalThis.navigator?.clipboard ||
        typeof globalThis.navigator.clipboard.writeText !== 'function'
      ) {
        throw new Error('Clipboard access is unavailable.');
      }

      await globalThis.navigator.clipboard.writeText(
        preparedJson.content,
      );

      if (typeof onCopy === 'function') {
        await onCopy(preparedJson.content, preparedJson.value);
      }

      setActionMessage('JSON copied to the clipboard.');
    } catch {
      setActionError(
        'The JSON payload could not be copied. Try again.',
      );
    } finally {
      setCopying(false);
    }
  };

  const downloadPayload = async () => {
    setDownloading(true);
    setActionMessage('');
    setActionError('');

    try {
      const artifact = downloadJson(
        preparedJson.value,
        fileName,
        {
          redact: false,
          space,
        },
      );

      if (typeof onDownload === 'function') {
        await onDownload(artifact, preparedJson.value);
      }

      setActionMessage('JSON download started.');
    } catch {
      setActionError(
        'The JSON payload could not be downloaded. Try again.',
      );
    } finally {
      setDownloading(false);
    }
  };

  return (
    <section
      aria-label={ariaLabel}
      className={`overflow-hidden rounded-xl border border-border bg-white shadow-card dark:border-slate-700 dark:bg-slate-900 ${className}`.trim()}
    >
      <div className="flex flex-col gap-3 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between dark:border-slate-700">
        <button
          aria-controls={contentId}
          aria-expanded={isExpanded}
          className="flex min-h-11 min-w-0 items-center gap-2 rounded-lg text-left font-semibold text-lga-navy transition-colors hover:text-lga-blue focus:outline-none focus:ring-2 focus:ring-lga-sky focus:ring-offset-2 dark:text-white dark:hover:text-primary-200 dark:focus:ring-offset-slate-900"
          onClick={toggleExpanded}
          type="button"
        >
          <svg
            aria-hidden="true"
            className={`size-4 shrink-0 transition-transform ${
              isExpanded ? 'rotate-90' : ''
            }`}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            viewBox="0 0 24 24"
          >
            <path
              d="m9 6 6 6-6 6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="truncate">{title}</span>
        </button>

        {actionsAvailable && (
          <div className="flex flex-wrap items-center gap-2">
            {showCopyButton && (
              <button
                aria-label="Copy JSON"
                className="inline-flex min-h-10 items-center justify-center rounded-lg border border-border px-3 py-2 text-sm font-medium text-lga-navy transition-colors hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-lga-sky focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:text-white dark:hover:bg-slate-800 dark:focus:ring-offset-slate-900"
                disabled={copying || downloading}
                onClick={copyJson}
                type="button"
              >
                {copying ? 'Copying…' : 'Copy JSON'}
              </button>
            )}

            {showDownloadButton && (
              <button
                aria-label="Download JSON"
                className="inline-flex min-h-10 items-center justify-center rounded-lg border border-border px-3 py-2 text-sm font-medium text-lga-navy transition-colors hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-lga-sky focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:text-white dark:hover:bg-slate-800 dark:focus:ring-offset-slate-900"
                disabled={copying || downloading}
                onClick={downloadPayload}
                type="button"
              >
                {downloading ? 'Downloading…' : 'Download JSON'}
              </button>
            )}
          </div>
        )}
      </div>

      {isExpanded && (
        <div id={contentId}>
          {preparedJson.error ? (
            <p
              className="px-4 py-6 text-sm text-danger dark:text-red-200"
              role="alert"
            >
              {preparedJson.error}
            </p>
          ) : (
            <pre
              className="max-h-96 overflow-auto whitespace-pre p-4 font-mono text-xs leading-5 text-text dark:text-slate-100"
              tabIndex="0"
            >
              <code>{preparedJson.content}</code>
            </pre>
          )}
        </div>
      )}

      <div
        aria-live="polite"
        className="sr-only"
        role="status"
      >
        {actionMessage}
      </div>

      {actionError && (
        <p
          className="border-t border-border px-4 py-3 text-sm text-danger dark:border-slate-700 dark:text-red-200"
          role="alert"
        >
          {actionError}
        </p>
      )}
    </section>
  );
}

JsonViewer.propTypes = {
  'aria-label': PropTypes.string,
  className: PropTypes.string,
  data: PropTypes.any,
  defaultExpanded: PropTypes.bool,
  expanded: PropTypes.bool,
  fileName: PropTypes.string,
  initiallyExpanded: PropTypes.bool,
  onCopy: PropTypes.func,
  onDownload: PropTypes.func,
  onExpandedChange: PropTypes.func,
  redact: PropTypes.bool,
  showActions: PropTypes.bool,
  showCopyButton: PropTypes.bool,
  showDownloadButton: PropTypes.bool,
  space: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  title: PropTypes.node,
  value: PropTypes.any,
};

export default JsonViewer;