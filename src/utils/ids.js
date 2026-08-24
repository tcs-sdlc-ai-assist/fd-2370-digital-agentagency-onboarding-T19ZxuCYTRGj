const IDENTIFIER_PREFIXES = Object.freeze({
  TRACKING: 'TRK',
  APPLICATION: 'APP',
  CORRELATION: 'corr',
  WORK_ITEM: 'WI',
  AUDIT_EVENT: 'AUD',
  LIFECYCLE_EVENT: 'LCE',
});

const DEFAULT_HASH_LENGTH = 12;
const MIN_HASH_LENGTH = 4;
const MAX_HASH_LENGTH = 32;

function stableSerialize(value, ancestors = new Set()) {
  if (value === null) {
    return 'null';
  }

  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'number':
      if (!Number.isFinite(value)) {
        throw new TypeError('Identifier seed numbers must be finite.');
      }

      return `number:${value}`;
    case 'bigint':
      return `bigint:${value.toString()}`;
    case 'boolean':
      return `boolean:${value}`;
    case 'undefined':
      return 'undefined';
    case 'object': {
      if (value instanceof Date) {
        if (Number.isNaN(value.getTime())) {
          throw new TypeError('Identifier seed dates must be valid.');
        }

        return `date:${value.toISOString()}`;
      }

      if (ancestors.has(value)) {
        throw new TypeError('Identifier seeds cannot contain circular values.');
      }

      ancestors.add(value);

      let serializedValue;

      if (Array.isArray(value)) {
        serializedValue = `[${value
          .map((item) => stableSerialize(item, ancestors))
          .join(',')}]`;
      } else {
        serializedValue = `{${Object.keys(value)
          .sort()
          .map(
            (key) =>
              `${JSON.stringify(key)}:${stableSerialize(
                value[key],
                ancestors,
              )}`,
          )
          .join(',')}}`;
      }

      ancestors.delete(value);
      return serializedValue;
    }
    default:
      throw new TypeError(
        'Identifier seeds must contain serializable primitive or object values.',
      );
  }
}

function validateSeed(seed) {
  if (
    seed === null ||
    seed === undefined ||
    (typeof seed === 'string' && seed.trim() === '')
  ) {
    throw new TypeError('A non-empty identifier seed is required.');
  }
}

function normalizePrefix(prefix) {
  if (typeof prefix !== 'string' || !/^[A-Za-z][A-Za-z0-9]*$/.test(prefix)) {
    throw new TypeError(
      'Identifier prefixes must begin with a letter and be alphanumeric.',
    );
  }

  return prefix;
}

function normalizeHashLength(length) {
  if (
    !Number.isInteger(length) ||
    length < MIN_HASH_LENGTH ||
    length > MAX_HASH_LENGTH
  ) {
    throw new RangeError(
      `Identifier hash length must be between ${MIN_HASH_LENGTH} and ${MAX_HASH_LENGTH}.`,
    );
  }

  return length;
}

function hashString(value, initialValue) {
  let hash = initialValue;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
    hash ^= hash >>> 13;
  }

  return hash >>> 0;
}

function createHash(value, length) {
  const parts = [];
  let round = 0;

  while (parts.join('').length < length) {
    const forwardHash = hashString(
      `${round}:${value}`,
      (2166136261 + round) >>> 0,
    );
    const reverseHash = hashString(
      `${value.split('').reverse().join('')}:${round}`,
      (2246822519 + round) >>> 0,
    );

    parts.push(forwardHash.toString(36).padStart(7, '0'));
    parts.push(reverseHash.toString(36).padStart(7, '0'));
    round += 1;
  }

  return parts.join('').slice(0, length);
}

function normalizeNamePart(value) {
  if (typeof value !== 'string') {
    return '';
  }

  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]/g, '')
    .toUpperCase();
}

function getAgentCodeInput(
  applicantOrFirstName,
  lastName,
  discriminator,
) {
  if (
    applicantOrFirstName &&
    typeof applicantOrFirstName === 'object' &&
    !Array.isArray(applicantOrFirstName)
  ) {
    const applicant = applicantOrFirstName;

    return {
      firstName:
        applicant.firstName ||
        applicant.contactFirstName ||
        applicant.legalName ||
        applicant.name,
      lastName:
        applicant.lastName ||
        applicant.contactLastName ||
        applicant.legalName ||
        applicant.name,
      discriminator:
        applicant.discriminator ||
        applicant.applicationId ||
        applicant.trackingId ||
        applicant.npn ||
        applicant.id,
    };
  }

  return {
    firstName: applicantOrFirstName,
    lastName,
    discriminator,
  };
}

/**
 * Creates a stable identifier from a namespace prefix and deterministic seed.
 *
 * @param {string} prefix Alphanumeric identifier namespace.
 * @param {unknown} seed Serializable value used to derive the identifier.
 * @param {{length?: number, lowercase?: boolean}} options Formatting options.
 * @returns {string} Deterministic identifier.
 */
export function createDeterministicId(prefix, seed, options = {}) {
  const normalizedPrefix = normalizePrefix(prefix);
  validateSeed(seed);

  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('Identifier options must be an object.');
  }

  const length = normalizeHashLength(
    options.length ?? DEFAULT_HASH_LENGTH,
  );
  const serializedSeed = stableSerialize(seed);
  const hash = createHash(
    `${normalizedPrefix.toUpperCase()}:${serializedSeed}`,
    length,
  );
  const formattedHash = options.lowercase
    ? hash.toLowerCase()
    : hash.toUpperCase();
  const formattedPrefix = options.lowercase
    ? normalizedPrefix.toLowerCase()
    : normalizedPrefix.toUpperCase();

  return `${formattedPrefix}-${formattedHash}`;
}

/**
 * Generates a deterministic tracking identifier.
 *
 * @param {unknown} seed Serializable tracking seed.
 * @returns {string} Tracking identifier.
 */
export function generateTrackingId(seed) {
  return createDeterministicId(IDENTIFIER_PREFIXES.TRACKING, seed);
}

/**
 * Generates a deterministic application identifier.
 *
 * @param {unknown} seed Serializable application seed.
 * @returns {string} Application identifier.
 */
export function generateApplicationId(seed) {
  return createDeterministicId(IDENTIFIER_PREFIXES.APPLICATION, seed);
}

/**
 * Generates a deterministic correlation identifier.
 *
 * @param {unknown} seed Serializable correlation seed.
 * @returns {string} Correlation identifier.
 */
export function generateCorrelationId(seed) {
  return createDeterministicId(IDENTIFIER_PREFIXES.CORRELATION, seed, {
    lowercase: true,
  });
}

/**
 * Generates a deterministic work-item identifier.
 *
 * @param {unknown} seed Serializable work-item seed.
 * @returns {string} Work-item identifier.
 */
export function generateWorkItemId(seed) {
  return createDeterministicId(IDENTIFIER_PREFIXES.WORK_ITEM, seed);
}

/**
 * Generates a deterministic audit-event identifier.
 *
 * @param {unknown} seed Serializable audit-event seed.
 * @returns {string} Audit-event identifier.
 */
export function generateAuditEventId(seed) {
  return createDeterministicId(IDENTIFIER_PREFIXES.AUDIT_EVENT, seed);
}

/**
 * Generates a deterministic lifecycle-event identifier.
 *
 * @param {unknown} seed Serializable lifecycle-event seed.
 * @returns {string} Lifecycle-event identifier.
 */
export function generateLifecycleEventId(seed) {
  return createDeterministicId(IDENTIFIER_PREFIXES.LIFECYCLE_EVENT, seed);
}

/**
 * Generates a deterministic, human-readable agent code.
 *
 * The code uses the applicant's first initial, the first three characters of
 * the surname, and four characters from the supplied discriminator.
 *
 * @param {object | string} applicantOrFirstName Applicant data or first name.
 * @param {string} [lastName] Applicant last name when using positional input.
 * @param {string | number} [discriminator] Stable application discriminator.
 * @returns {string} Eight-character agent code.
 */
export function generateAgentCode(
  applicantOrFirstName,
  lastName,
  discriminator,
) {
  const input = getAgentCodeInput(
    applicantOrFirstName,
    lastName,
    discriminator,
  );
  const normalizedFirstName = normalizeNamePart(input.firstName);
  const normalizedLastName = normalizeNamePart(input.lastName);

  if (!normalizedFirstName || !normalizedLastName) {
    throw new TypeError(
      'An applicant first name and last name are required to generate an agent code.',
    );
  }

  validateSeed(input.discriminator);

  const namePart = `${normalizedFirstName[0]}${normalizedLastName
    .slice(0, 3)
    .padEnd(3, 'X')}`;
  const normalizedDiscriminator = normalizeNamePart(
    String(input.discriminator),
  );
  const discriminatorPart =
    normalizedDiscriminator.length >= 4
      ? normalizedDiscriminator.slice(-4)
      : createHash(stableSerialize(input.discriminator), 4).toUpperCase();

  return `${namePart}${discriminatorPart}`;
}

export const createTrackingId = generateTrackingId;
export const createApplicationId = generateApplicationId;
export const createAgentCode = generateAgentCode;
export const createCorrelationId = generateCorrelationId;
export const createWorkItemId = generateWorkItemId;
export const createAuditEventId = generateAuditEventId;
export const createAuditId = generateAuditEventId;
export const createLifecycleEventId = generateLifecycleEventId;

export const ID_PREFIXES = IDENTIFIER_PREFIXES;

export default Object.freeze({
  createDeterministicId,
  generateTrackingId,
  generateApplicationId,
  generateAgentCode,
  generateCorrelationId,
  generateWorkItemId,
  generateAuditEventId,
  generateLifecycleEventId,
});