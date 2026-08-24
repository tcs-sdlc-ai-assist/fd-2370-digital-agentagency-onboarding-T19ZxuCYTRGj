import PropTypes from 'prop-types';
import {
  maskEmail,
  maskFinancialValue,
  maskIdentifier,
  maskPhone,
  REDACTED_VALUE,
} from '../../utils/redaction.js';

export const MASKED_VALUE_KINDS = Object.freeze({
  BANK_ACCOUNT: 'bank-account',
  TAX_ID: 'tax-id',
  LICENSE: 'license',
  EMAIL: 'email',
  PHONE: 'phone',
  CONTACT: 'contact',
  RECORD_ID: 'record-id',
  IDENTIFIER: 'identifier',
  GENERIC: 'generic',
});

const KIND_ALIASES = Object.freeze({
  account: MASKED_VALUE_KINDS.BANK_ACCOUNT,
  accountnumber: MASKED_VALUE_KINDS.BANK_ACCOUNT,
  bank: MASKED_VALUE_KINDS.BANK_ACCOUNT,
  bankaccount: MASKED_VALUE_KINDS.BANK_ACCOUNT,
  bankaccountnumber: MASKED_VALUE_KINDS.BANK_ACCOUNT,
  contact: MASKED_VALUE_KINDS.CONTACT,
  email: MASKED_VALUE_KINDS.EMAIL,
  emailaddress: MASKED_VALUE_KINDS.EMAIL,
  generic: MASKED_VALUE_KINDS.GENERIC,
  id: MASKED_VALUE_KINDS.IDENTIFIER,
  identifier: MASKED_VALUE_KINDS.IDENTIFIER,
  license: MASKED_VALUE_KINDS.LICENSE,
  licensenumber: MASKED_VALUE_KINDS.LICENSE,
  phone: MASKED_VALUE_KINDS.PHONE,
  phonenumber: MASKED_VALUE_KINDS.PHONE,
  record: MASKED_VALUE_KINDS.RECORD_ID,
  recordid: MASKED_VALUE_KINDS.RECORD_ID,
  tax: MASKED_VALUE_KINDS.TAX_ID,
  taxid: MASKED_VALUE_KINDS.TAX_ID,
  taxidentifier: MASKED_VALUE_KINDS.TAX_ID,
});

const KIND_LABELS = Object.freeze({
  [MASKED_VALUE_KINDS.BANK_ACCOUNT]: 'Bank account',
  [MASKED_VALUE_KINDS.TAX_ID]: 'Tax identifier',
  [MASKED_VALUE_KINDS.LICENSE]: 'License number',
  [MASKED_VALUE_KINDS.EMAIL]: 'Email address',
  [MASKED_VALUE_KINDS.PHONE]: 'Phone number',
  [MASKED_VALUE_KINDS.CONTACT]: 'Contact information',
  [MASKED_VALUE_KINDS.RECORD_ID]: 'Record identifier',
  [MASKED_VALUE_KINDS.IDENTIFIER]: 'Identifier',
  [MASKED_VALUE_KINDS.GENERIC]: 'Sensitive value',
});

function normalizeKind(value) {
  if (value === null || value === undefined) {
    return MASKED_VALUE_KINDS.IDENTIFIER;
  }

  const normalizedValue = String(value)
    .trim()
    .normalize('NFKC')
    .toLowerCase();
  const token = normalizedValue.replace(/[^a-z0-9]/g, '');

  if (Object.values(MASKED_VALUE_KINDS).includes(normalizedValue)) {
    return normalizedValue;
  }

  return KIND_ALIASES[token] ?? MASKED_VALUE_KINDS.IDENTIFIER;
}

function isMissingValue(value) {
  return (
    value === null ||
    value === undefined ||
    String(value).trim() === ''
  );
}

function maskContactValue(value) {
  const normalizedValue = String(value).trim();

  if (normalizedValue.includes('@')) {
    return maskEmail(normalizedValue);
  }

  if (normalizedValue.replace(/\D/g, '').length >= 7) {
    return maskPhone(normalizedValue);
  }

  return REDACTED_VALUE;
}

/**
 * Masks a sensitive value according to its presentation kind.
 *
 * Unsupported object values are fully redacted rather than serialized.
 *
 * @param {unknown} value Sensitive value.
 * @param {string} [kind] Sensitive value kind.
 * @returns {unknown} Masked value, or the original empty value.
 */
export function maskSensitiveValue(
  value,
  kind = MASKED_VALUE_KINDS.IDENTIFIER,
) {
  if (isMissingValue(value)) {
    return value;
  }

  if (
    typeof value !== 'string' &&
    typeof value !== 'number' &&
    typeof value !== 'bigint'
  ) {
    return REDACTED_VALUE;
  }

  switch (normalizeKind(kind)) {
    case MASKED_VALUE_KINDS.BANK_ACCOUNT:
      return maskFinancialValue(value);

    case MASKED_VALUE_KINDS.EMAIL:
      return maskEmail(value);

    case MASKED_VALUE_KINDS.PHONE:
      return maskPhone(value);

    case MASKED_VALUE_KINDS.CONTACT:
      return maskContactValue(value);

    case MASKED_VALUE_KINDS.GENERIC:
      return REDACTED_VALUE;

    case MASKED_VALUE_KINDS.TAX_ID:
    case MASKED_VALUE_KINDS.LICENSE:
    case MASKED_VALUE_KINDS.RECORD_ID:
    case MASKED_VALUE_KINDS.IDENTIFIER:
    default:
      return maskIdentifier(value);
  }
}

/**
 * Presents bank, tax, license, contact, and record identifiers without
 * exposing their complete values.
 */
export function MaskedValue({
  'aria-label': ariaLabel,
  className = '',
  fallback = '—',
  kind = MASKED_VALUE_KINDS.IDENTIFIER,
  label,
  showLabel = false,
  type,
  value,
  valueClassName = '',
}) {
  const resolvedKind = normalizeKind(type ?? kind);
  const missing = isMissingValue(value);
  const maskedValue = missing
    ? fallback
    : maskSensitiveValue(value, resolvedKind);
  const resolvedLabel = label ?? KIND_LABELS[resolvedKind];
  const accessibleLabel =
    ariaLabel ??
    (missing
      ? `${resolvedLabel}: not available`
      : `${resolvedLabel}: masked value`);

  return (
    <span
      aria-label={accessibleLabel}
      className={`inline-flex max-w-full items-baseline gap-2 ${className}`.trim()}
      data-mask-kind={resolvedKind}
    >
      {showLabel && (
        <span
          aria-hidden="true"
          className="shrink-0 text-sm text-text-muted dark:text-slate-400"
        >
          {resolvedLabel}
        </span>
      )}
      <span
        aria-hidden="true"
        className={`truncate font-mono text-sm font-medium tracking-wide text-text dark:text-slate-100 ${valueClassName}`.trim()}
      >
        {maskedValue}
      </span>
    </span>
  );
}

MaskedValue.propTypes = {
  'aria-label': PropTypes.string,
  className: PropTypes.string,
  fallback: PropTypes.node,
  kind: PropTypes.oneOf(Object.values(MASKED_VALUE_KINDS)),
  label: PropTypes.node,
  showLabel: PropTypes.bool,
  type: PropTypes.string,
  value: PropTypes.oneOfType([
    PropTypes.string,
    PropTypes.number,
  ]),
  valueClassName: PropTypes.string,
};

export const maskValue = maskSensitiveValue;

export default MaskedValue;