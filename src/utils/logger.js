import appConfig from '../config/appConfig.js';
import { redactForDiagnostics } from './redaction.js';

export const LOG_LEVELS = Object.freeze({
  DEBUG: 'debug',
  INFO: 'info',
  WARN: 'warn',
  ERROR: 'error',
});

export const UNAVAILABLE_LOG_VALUE = '[UNAVAILABLE]';

const LOG_LEVEL_VALUES = Object.freeze(Object.values(LOG_LEVELS));

function normalizeError(error) {
  return {
    name: error.name || 'Error',
    message: error.message || 'An unexpected error occurred.',
    ...(error.cause === undefined ? {} : { cause: error.cause }),
  };
}

/**
 * Creates a sanitized, non-mutating value suitable for client diagnostics.
 *
 * @param {unknown} value Diagnostic value to sanitize.
 * @returns {unknown} Sanitized diagnostic value.
 */
export function sanitizeLogData(value) {
  try {
    const normalizedValue =
      value instanceof Error ? normalizeError(value) : value;

    return redactForDiagnostics(normalizedValue);
  } catch {
    return UNAVAILABLE_LOG_VALUE;
  }
}

/**
 * Determines whether a log level is enabled for the current environment.
 *
 * Debug logging is available during development or when diagnostics are
 * explicitly enabled. Informational logging is suppressed in production
 * unless diagnostics are enabled. Warnings and errors are always available.
 *
 * @param {string} level Log level.
 * @returns {boolean} Whether the level is enabled.
 */
export function isLogLevelEnabled(level) {
  if (!LOG_LEVEL_VALUES.includes(level)) {
    return false;
  }

  if (level === LOG_LEVELS.WARN || level === LOG_LEVELS.ERROR) {
    return true;
  }

  if (appConfig.enableDiagnostics) {
    return true;
  }

  if (level === LOG_LEVELS.DEBUG) {
    return appConfig.appEnv === 'development';
  }

  return appConfig.appEnv !== 'production';
}

function writeLog(level, namespace, values) {
  if (!isLogLevelEnabled(level)) {
    return;
  }

  const sanitizedValues = values.map((value) => sanitizeLogData(value));
  const outputValues = namespace
    ? [`[${namespace}]`, ...sanitizedValues]
    : sanitizedValues;
  const consoleMethod =
    typeof console[level] === 'function' ? console[level] : console.log;

  consoleMethod(...outputValues);
}

function createLoggerMethods(namespace) {
  return Object.freeze({
    debug: (...values) =>
      writeLog(LOG_LEVELS.DEBUG, namespace, values),
    info: (...values) => writeLog(LOG_LEVELS.INFO, namespace, values),
    log: (...values) => writeLog(LOG_LEVELS.INFO, namespace, values),
    warn: (...values) => writeLog(LOG_LEVELS.WARN, namespace, values),
    error: (...values) =>
      writeLog(LOG_LEVELS.ERROR, namespace, values),
  });
}

/**
 * Creates a sanitized logger with an optional diagnostic namespace.
 *
 * @param {string} namespace Stable logger namespace.
 * @returns {{
 *   debug: (...values: unknown[]) => void,
 *   info: (...values: unknown[]) => void,
 *   log: (...values: unknown[]) => void,
 *   warn: (...values: unknown[]) => void,
 *   error: (...values: unknown[]) => void
 * }} Sanitized logger.
 */
export function createLogger(namespace) {
  if (typeof namespace !== 'string' || namespace.trim() === '') {
    throw new TypeError('A non-empty logger namespace is required.');
  }

  return createLoggerMethods(namespace.trim());
}

export const logger = createLoggerMethods();

export default logger;