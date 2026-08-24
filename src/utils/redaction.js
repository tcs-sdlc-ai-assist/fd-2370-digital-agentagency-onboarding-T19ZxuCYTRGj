export const REDACTED_VALUE = '[REDACTED]';
export const CIRCULAR_REFERENCE_VALUE = '[Circular]';

const FULL_REDACTION_FIELDS = new Set([
  'accesskey',
  'accesstoken',
  'authorization',
  'bankingdetails',
  'birthdate',
  'city',
  'clientsecret',
  'contactfirstname',
  'contactlastname',
  'credential',
  'credentials',
  'dateofbirth',
  'dob',
  'firstname',
  'fullname',
  'lastname',
  'legalname',
  'middlename',
  'nameonaccount',
  'oauthcode',
  'password',
  'passwordhash',
  'postalcode',
  'privatekey',
  'rawcontent',
  'refreshtoken',
  'resettoken',
  'secret',
  'secretkey',
  'securityanswer',
  'sessiontoken',
  'signature',
  'taxidentifier',
  'token',
]);

const EMAIL_FIELDS = new Set([
  'email',
  'emailaddress',
  'recipientemail',
  'username',
]);

const PHONE_FIELDS = new Set([
  'cellphone',
  'contactphone',
  'faxnumber',
  'mobile',
  'mobilephone',
  'phone',
  'phonenumber',
  'telephone',
]);

const FINANCIAL_FIELDS = new Set([
  'account',
  'accountnumber',
  'bankaccount',
  'bankaccountnumber',
  'cardnumber',
  'creditcard',
  'creditcardnumber',
  'iban',
  'paymentaccount',
  'routingnumber',
]);

const IDENTIFIER_FIELDS = new Set([
  'agentcode',
  'contractnumber',
  'crd',
  'driverslicense',
  'driverslicensenumber',
  'ein',
  'nationalproducer number'.replace(/\s/g, ''),
  'npn',
  'passportnumber',
  'providernumber',
  'socialsecuritynumber',
  'ssn',
  'taxid',
]);

const LAST_FOUR_FIELDS = new Set([
  'accountnumberlast4',
  'cardlast4',
  'ssnlast4',
  'taxidlast4',
]);

const ADDRESS_CONTAINER_FIELDS = new Set([
  'address',
  'businessaddress',
  'homeaddress',
  'mailingaddress',
  'physicaladdress',
  'residenceaddress',
]);

const ADDRESS_VALUE_FIELDS = new Set([
  'addressline1',
  'addressline2',
  'line1',
  'line2',
  'street',
  'streetaddress',
]);

function normalizeFieldName(fieldName) {
  return String(fieldName).replace(/[^A-Za-z0-9]/g, '').toLowerCase();
}

function preserveEmptyValue(value) {
  return value === null || value === undefined || value === '';
}

function getLastCharacters(value, count = 4) {
  return String(value).replace(/\s/g, '').slice(-count);
}

/**
 * Masks an email address while preserving its first character and domain.
 *
 * @param {unknown} value Email address to mask.
 * @returns {unknown} Masked email address, or the original empty value.
 */
export function maskEmail(value) {
  if (preserveEmptyValue(value)) {
    return value;
  }

  const email = String(value).trim();
  const separatorIndex = email.lastIndexOf('@');

  if (
    separatorIndex < 1 ||
    separatorIndex === email.length - 1
  ) {
    return REDACTED_VALUE;
  }

  return `${email[0]}***${email.slice(separatorIndex)}`;
}

/**
 * Masks a phone number while preserving its final four digits.
 *
 * @param {unknown} value Phone number to mask.
 * @returns {unknown} Masked phone number, or the original empty value.
 */
export function maskPhone(value) {
  if (preserveEmptyValue(value)) {
    return value;
  }

  const digits = String(value).replace(/\D/g, '');

  if (digits.length < 4) {
    return REDACTED_VALUE;
  }

  return `***-***-${digits.slice(-4)}`;
}

/**
 * Masks an identifier while preserving its final four characters.
 *
 * @param {unknown} value Identifier to mask.
 * @returns {unknown} Masked identifier, or the original empty value.
 */
export function maskIdentifier(value) {
  if (preserveEmptyValue(value)) {
    return value;
  }

  const identifier = String(value).trim();

  if (identifier.length <= 4) {
    return '*'.repeat(identifier.length);
  }

  return `***${getLastCharacters(identifier)}`;
}

/**
 * Masks a financial value while preserving its final four characters.
 *
 * @param {unknown} value Financial value to mask.
 * @returns {unknown} Masked financial value, or the original empty value.
 */
export function maskFinancialValue(value) {
  if (preserveEmptyValue(value)) {
    return value;
  }

  const normalizedValue = String(value).trim();

  if (normalizedValue.length <= 4) {
    return '*'.repeat(normalizedValue.length);
  }

  return `*****${getLastCharacters(normalizedValue)}`;
}

function getFieldRedactionType(fieldName) {
  const normalizedFieldName = normalizeFieldName(fieldName);

  if (
    FULL_REDACTION_FIELDS.has(normalizedFieldName) ||
    ADDRESS_VALUE_FIELDS.has(normalizedFieldName)
  ) {
    return 'full';
  }

  if (
    EMAIL_FIELDS.has(normalizedFieldName) ||
    normalizedFieldName.endsWith('emailaddress')
  ) {
    return 'email';
  }

  if (
    PHONE_FIELDS.has(normalizedFieldName) ||
    normalizedFieldName.endsWith('phonenumber')
  ) {
    return 'phone';
  }

  if (
    LAST_FOUR_FIELDS.has(normalizedFieldName) ||
    normalizedFieldName.endsWith('last4')
  ) {
    return 'lastFour';
  }

  if (
    FINANCIAL_FIELDS.has(normalizedFieldName) ||
    normalizedFieldName.endsWith('accountnumber') ||
    normalizedFieldName.endsWith('routingnumber') ||
    normalizedFieldName.endsWith('cardnumber')
  ) {
    return 'financial';
  }

  if (
    IDENTIFIER_FIELDS.has(normalizedFieldName) ||
    normalizedFieldName.endsWith('taxid') ||
    normalizedFieldName.endsWith('ssn')
  ) {
    return 'identifier';
  }

  if (ADDRESS_CONTAINER_FIELDS.has(normalizedFieldName)) {
    return 'address';
  }

  return undefined;
}

function fullyRedact(value) {
  return preserveEmptyValue(value) ? value : REDACTED_VALUE;
}

function redactFieldValue(fieldName, value, ancestors) {
  const redactionType = getFieldRedactionType(fieldName);

  switch (redactionType) {
    case 'full':
      return fullyRedact(value);
    case 'email':
      return maskEmail(value);
    case 'phone':
      return maskPhone(value);
    case 'financial':
      return maskFinancialValue(value);
    case 'identifier':
      return maskIdentifier(value);
    case 'lastFour':
      return preserveEmptyValue(value)
        ? value
        : '*'.repeat(String(value).length);
    case 'address':
      return value && typeof value === 'object'
        ? redactDeep(value, ancestors)
        : fullyRedact(value);
    default:
      return redactDeep(value, ancestors);
  }
}

function redactDeep(value, ancestors) {
  if (value === null || typeof value !== 'object') {
    return value;
  }

  if (value instanceof Date) {
    return new Date(value.getTime());
  }

  if (ancestors.has(value)) {
    return CIRCULAR_REFERENCE_VALUE;
  }

  ancestors.add(value);

  let redactedValue;

  if (Array.isArray(value)) {
    redactedValue = value.map((item) => redactDeep(item, ancestors));
  } else {
    redactedValue = Object.fromEntries(
      Object.entries(value).map(([fieldName, fieldValue]) => [
        fieldName,
        redactFieldValue(fieldName, fieldValue, ancestors),
      ]),
    );
  }

  ancestors.delete(value);
  return redactedValue;
}

/**
 * Creates a deep, non-mutating copy with known PII and financial fields masked.
 *
 * @param {unknown} value Value to redact.
 * @returns {unknown} Redacted copy of the supplied value.
 */
export function redactSensitiveData(value) {
  return redactDeep(value, new WeakSet());
}

export const redactPII = redactSensitiveData;
export const redactForAudit = redactSensitiveData;
export const redactForDiagnostics = redactSensitiveData;
export const redactForExport = redactSensitiveData;
export const redact = redactSensitiveData;

export default Object.freeze({
  maskEmail,
  maskFinancialValue,
  maskIdentifier,
  maskPhone,
  redact,
  redactForAudit,
  redactForDiagnostics,
  redactForExport,
  redactPII,
  redactSensitiveData,
});