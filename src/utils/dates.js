const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DEFAULT_LOCALE = 'en-US';
const DEFAULT_TIME_ZONE = 'UTC';
const DEFAULT_DISPLAY_FALLBACK = '—';

function isMissingDateValue(value) {
  return value === null || value === undefined || value === '';
}

function parseIsoDateOnly(value) {
  const match = ISO_DATE_PATTERN.exec(value);

  if (!match) {
    return undefined;
  }

  const [, yearValue, monthValue, dayValue] = match;
  const year = Number(yearValue);
  const month = Number(monthValue);
  const day = Number(dayValue);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new RangeError(`Invalid date value: ${value}`);
  }

  return date;
}

function normalizeDateInput(value, fieldName = 'date') {
  let date;

  if (value instanceof Date) {
    date = new Date(value.getTime());
  } else if (typeof value === 'string') {
    const normalizedValue = value.trim();

    if (normalizedValue === '') {
      throw new TypeError(`A valid ${fieldName} is required.`);
    }

    date = parseIsoDateOnly(normalizedValue) ?? new Date(normalizedValue);
  } else if (typeof value === 'number' && Number.isFinite(value)) {
    date = new Date(value);
  } else {
    throw new TypeError(
      `${fieldName} must be a Date, ISO date string, or timestamp.`,
    );
  }

  if (Number.isNaN(date.getTime())) {
    throw new RangeError(`Invalid ${fieldName}.`);
  }

  return date;
}

function normalizeDayCount(days, fieldName = 'days') {
  if (!Number.isInteger(days) || days < 0) {
    throw new RangeError(`${fieldName} must be a nonnegative integer.`);
  }

  return days;
}

function normalizeFormatterOptions(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('Date formatter options must be an object.');
  }

  return options;
}

function getCalendarDayNumber(date) {
  return Math.floor(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
    ) / MILLISECONDS_PER_DAY,
  );
}

/**
 * Parses a supported date value and returns a defensive Date instance.
 *
 * Date-only strings are interpreted as UTC to avoid timezone-related shifts.
 *
 * @param {Date | string | number} value Date value to parse.
 * @returns {Date} Parsed date.
 */
export function parseDate(value) {
  return normalizeDateInput(value);
}

/**
 * Converts a supported date value to an ISO-8601 timestamp.
 *
 * @param {Date | string | number} [value] Date value, defaulting to now.
 * @returns {string} ISO timestamp.
 */
export function toIsoTimestamp(value = Date.now()) {
  return normalizeDateInput(value).toISOString();
}

/**
 * Returns the current time as an ISO-8601 timestamp.
 *
 * @param {() => Date | string | number} [clock] Optional clock provider.
 * @returns {string} Current ISO timestamp.
 */
export function getCurrentIsoTimestamp(clock = () => new Date()) {
  if (typeof clock !== 'function') {
    throw new TypeError('The clock must be a function.');
  }

  return toIsoTimestamp(clock());
}

/**
 * Converts a supported date value to an ISO calendar date.
 *
 * @param {Date | string | number} [value] Date value, defaulting to now.
 * @returns {string} ISO date in YYYY-MM-DD format.
 */
export function toIsoDate(value = Date.now()) {
  return toIsoTimestamp(value).slice(0, 10);
}

/**
 * Adds calendar days to a date without mutating the supplied value.
 *
 * @param {Date | string | number} value Starting date.
 * @param {number} days Number of days to add.
 * @returns {Date} Calculated date.
 */
export function addDays(value, days) {
  const date = normalizeDateInput(value);
  const normalizedDays = normalizeDayCount(days);

  date.setUTCDate(date.getUTCDate() + normalizedDays);
  return date;
}

/**
 * Calculates the signed number of UTC calendar days between two dates.
 *
 * @param {Date | string | number} startDate Starting date.
 * @param {Date | string | number} endDate Ending date.
 * @returns {number} Signed calendar-day difference.
 */
export function differenceInCalendarDays(startDate, endDate) {
  const start = normalizeDateInput(startDate, 'start date');
  const end = normalizeDateInput(endDate, 'end date');

  return getCalendarDayNumber(end) - getCalendarDayNumber(start);
}

/**
 * Determines whether a date is inside an optional bounded window.
 *
 * @param {Date | string | number} value Date to evaluate.
 * @param {Date | string | number | null} windowStart Window start.
 * @param {Date | string | number | null} windowEnd Window end.
 * @param {{inclusiveStart?: boolean, inclusiveEnd?: boolean}} [options]
 * Boundary options.
 * @returns {boolean} Whether the date is within the window.
 */
export function isDateWithinWindow(
  value,
  windowStart,
  windowEnd,
  options = {},
) {
  if (
    isMissingDateValue(windowStart) &&
    isMissingDateValue(windowEnd)
  ) {
    throw new TypeError('A window start or end date is required.');
  }

  const normalizedOptions = normalizeFormatterOptions(options);
  const dateTime = normalizeDateInput(value).getTime();
  const startTime = isMissingDateValue(windowStart)
    ? Number.NEGATIVE_INFINITY
    : normalizeDateInput(windowStart, 'window start').getTime();
  const endTime = isMissingDateValue(windowEnd)
    ? Number.POSITIVE_INFINITY
    : normalizeDateInput(windowEnd, 'window end').getTime();

  if (startTime > endTime) {
    throw new RangeError(
      'The window start date cannot be after the window end date.',
    );
  }

  const afterStart =
    normalizedOptions.inclusiveStart === false
      ? dateTime > startTime
      : dateTime >= startTime;
  const beforeEnd =
    normalizedOptions.inclusiveEnd === false
      ? dateTime < endTime
      : dateTime <= endTime;

  return afterStart && beforeEnd;
}

/**
 * Determines whether a date occurred within a past-day window.
 *
 * Future dates are not considered within the window.
 *
 * @param {Date | string | number} value Date to evaluate.
 * @param {number} days Window size in days.
 * @param {Date | string | number} [referenceDate] Window reference time.
 * @returns {boolean} Whether the date is within the period.
 */
export function isWithinDays(
  value,
  days,
  referenceDate = Date.now(),
) {
  const normalizedDays = normalizeDayCount(days);
  const dateTime = normalizeDateInput(value).getTime();
  const referenceTime = normalizeDateInput(
    referenceDate,
    'reference date',
  ).getTime();
  const elapsedTime = referenceTime - dateTime;

  return (
    elapsedTime >= 0 &&
    elapsedTime <= normalizedDays * MILLISECONDS_PER_DAY
  );
}

/**
 * Calculates the end of a reuse period.
 *
 * @param {Date | string | number} completedAt Completion timestamp.
 * @param {number} reuseWindowDays Reuse window length.
 * @returns {string} Inclusive reuse expiration timestamp.
 */
export function calculateReuseExpirationDate(
  completedAt,
  reuseWindowDays,
) {
  return addDays(completedAt, reuseWindowDays).toISOString();
}

/**
 * Determines whether a completed event remains inside its reuse period.
 *
 * @param {Date | string | number} completedAt Completion timestamp.
 * @param {number} reuseWindowDays Reuse window length.
 * @param {Date | string | number} [asOf] Evaluation timestamp.
 * @returns {boolean} Whether reuse is currently allowed.
 */
export function isWithinReusePeriod(
  completedAt,
  reuseWindowDays,
  asOf = Date.now(),
) {
  const completed = normalizeDateInput(completedAt, 'completion date');
  const reusableThrough = addDays(completed, reuseWindowDays);

  return isDateWithinWindow(asOf, completed, reusableThrough);
}

/**
 * Calculates normalized reuse-period details.
 *
 * @param {Date | string | number} completedAt Completion timestamp.
 * @param {number} reuseWindowDays Reuse window length.
 * @param {Date | string | number} [asOf] Evaluation timestamp.
 * @returns {{
 *   completedAt: string,
 *   reusableThrough: string,
 *   expiresAt: string,
 *   reuseWindowDays: number,
 *   eligibleForReuse: boolean,
 *   daysRemaining: number
 * }} Reuse-period details.
 */
export function calculateReusePeriod(
  completedAt,
  reuseWindowDays,
  asOf = Date.now(),
) {
  const normalizedDays = normalizeDayCount(
    reuseWindowDays,
    'reuse window days',
  );
  const completed = normalizeDateInput(completedAt, 'completion date');
  const reference = normalizeDateInput(asOf, 'reference date');
  const reusableThrough = addDays(completed, normalizedDays);
  const eligibleForReuse = isDateWithinWindow(
    reference,
    completed,
    reusableThrough,
  );
  const remainingMilliseconds =
    reusableThrough.getTime() - reference.getTime();

  return Object.freeze({
    completedAt: completed.toISOString(),
    reusableThrough: reusableThrough.toISOString(),
    expiresAt: reusableThrough.toISOString(),
    reuseWindowDays: normalizedDays,
    eligibleForReuse,
    daysRemaining: eligibleForReuse
      ? Math.max(
          0,
          Math.ceil(remainingMilliseconds / MILLISECONDS_PER_DAY),
        )
      : 0,
  });
}

/**
 * Formats a date for display.
 *
 * Missing values return the configured fallback. Dates are displayed in UTC
 * by default to keep date-only values stable across client timezones.
 *
 * @param {Date | string | number | null | undefined} value Date value.
 * @param {{
 *   locale?: string,
 *   timeZone?: string,
 *   fallback?: string,
 *   formatOptions?: Intl.DateTimeFormatOptions
 * }} [options] Display options.
 * @returns {string} Formatted date.
 */
export function formatDisplayDate(value, options = {}) {
  const normalizedOptions = normalizeFormatterOptions(options);
  const fallback =
    normalizedOptions.fallback ?? DEFAULT_DISPLAY_FALLBACK;

  if (isMissingDateValue(value)) {
    return fallback;
  }

  const date = normalizeDateInput(value);
  const locale = normalizedOptions.locale ?? DEFAULT_LOCALE;
  const timeZone = normalizedOptions.timeZone ?? DEFAULT_TIME_ZONE;
  const formatOptions = normalizedOptions.formatOptions ?? {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  };

  return new Intl.DateTimeFormat(locale, {
    ...formatOptions,
    timeZone,
  }).format(date);
}

/**
 * Formats a timestamp for display.
 *
 * @param {Date | string | number | null | undefined} value Date value.
 * @param {{
 *   locale?: string,
 *   timeZone?: string,
 *   fallback?: string,
 *   formatOptions?: Intl.DateTimeFormatOptions
 * }} [options] Display options.
 * @returns {string} Formatted date and time.
 */
export function formatDisplayDateTime(value, options = {}) {
  const normalizedOptions = normalizeFormatterOptions(options);

  return formatDisplayDate(value, {
    ...normalizedOptions,
    formatOptions: normalizedOptions.formatOptions ?? {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    },
  });
}

export const createIsoTimestamp = toIsoTimestamp;
export const nowIso = getCurrentIsoTimestamp;
export const isWithinDateWindow = isDateWithinWindow;
export const getReuseExpirationDate = calculateReuseExpirationDate;
export const calculateReuseWindow = calculateReusePeriod;
export const formatDate = formatDisplayDate;
export const formatDateTime = formatDisplayDateTime;

export const DATE_CONSTANTS = Object.freeze({
  MILLISECONDS_PER_DAY,
  DEFAULT_LOCALE,
  DEFAULT_TIME_ZONE,
  DEFAULT_DISPLAY_FALLBACK,
});

export default Object.freeze({
  addDays,
  calculateReuseExpirationDate,
  calculateReusePeriod,
  differenceInCalendarDays,
  formatDisplayDate,
  formatDisplayDateTime,
  getCurrentIsoTimestamp,
  isDateWithinWindow,
  isWithinDays,
  isWithinReusePeriod,
  parseDate,
  toIsoDate,
  toIsoTimestamp,
});