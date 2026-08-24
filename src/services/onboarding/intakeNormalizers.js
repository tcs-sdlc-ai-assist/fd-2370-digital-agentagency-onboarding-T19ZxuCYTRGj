import {
  SOURCE_CHANNELS,
  SOURCE_FORMATS,
} from '../../constants/domain.js';

export const INTAKE_NORMALIZER_ERROR_CODES = Object.freeze({
  INVALID_REQUEST: 'INTAKE_NORMALIZER_INVALID_REQUEST',
  UNSUPPORTED_FORMAT: 'INTAKE_NORMALIZER_UNSUPPORTED_FORMAT',
  EMPTY_CONTENT: 'INTAKE_NORMALIZER_EMPTY_CONTENT',
  PARSE_ERROR: 'IMPORT_PARSE_ERROR',
  INVALID_JSON: 'INTAKE_NORMALIZER_INVALID_JSON',
  INVALID_XML: 'INTAKE_NORMALIZER_INVALID_XML',
  UNSAFE_XML: 'INTAKE_NORMALIZER_UNSAFE_XML',
  INVALID_FLAT_FILE: 'INTAKE_NORMALIZER_INVALID_FLAT_FILE',
  INVALID_METADATA: 'INTAKE_NORMALIZER_INVALID_METADATA',
  INVALID_MANUAL_INTAKE: 'INTAKE_NORMALIZER_INVALID_MANUAL_INTAKE',
});

export const DEFAULT_DTCC_DELIMITER = '|';

const XML_UNSAFE_PATTERN =
  /<!DOCTYPE|<!ENTITY|<\?xml-stylesheet|\bSYSTEM\b|\bPUBLIC\b/i;
const XML_TOKEN_PATTERN =
  /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<\/?([A-Za-z_][A-Za-z0-9_.:-]*)(?:\s[^<>]*?)?\/?>/g;
const XML_ENTITY_PATTERN = /&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi;

const CANONICAL_FIELD_ALIASES = Object.freeze({
  submissionId: Object.freeze([
    'submissionId',
    'submission_id',
    'SUBMISSION_ID',
  ]),
  requestType: Object.freeze([
    'requestType',
    'request_type',
    'REQUEST_TYPE',
  ]),
  company: Object.freeze([
    'company',
    'carrier',
    'companyCode',
    'carrierCode',
    'COMPANY',
  ]),
  gaCode: Object.freeze([
    'gaCode',
    'ga_code',
    'generalAgencyCode',
    'GA_CODE',
  ]),
  agencyType: Object.freeze([
    'agencyType',
    'agency_type',
    'AGENCY_TYPE',
  ]),
  contractType: Object.freeze([
    'contractType',
    'contract_type',
    'CONTRACT_TYPE',
  ]),
  firstName: Object.freeze([
    'firstName',
    'first_name',
    'FIRST_NAME',
  ]),
  middleName: Object.freeze([
    'middleName',
    'middle_name',
    'MIDDLE_NAME',
  ]),
  lastName: Object.freeze([
    'lastName',
    'last_name',
    'LAST_NAME',
  ]),
  email: Object.freeze(['email', 'emailAddress', 'EMAIL']),
  phone: Object.freeze([
    'phone',
    'phoneNumber',
    'telephone',
    'PHONE',
  ]),
  npn: Object.freeze([
    'npn',
    'nationalProducerNumber',
    'NPN',
  ]),
  crd: Object.freeze(['crd', 'crdNumber', 'CRD']),
  residenceState: Object.freeze([
    'residenceState',
    'residentState',
    'residence_state',
    'RESIDENCE_STATE',
  ]),
  licenseNumber: Object.freeze([
    'licenseNumber',
    'license_number',
    'LICENSE_NUMBER',
  ]),
  level: Object.freeze([
    'level',
    'contractLevel',
    'CONTRACT_LEVEL',
    'LEVEL',
  ]),
  commissionSchedule: Object.freeze([
    'commissionSchedule',
    'commission_schedule',
    'COMMISSION_SCHEDULE',
  ]),
  advanceCommission: Object.freeze([
    'advanceCommission',
    'advance_commission',
    'ADVANCE_COMMISSION',
  ]),
});

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertOptions(options, description = 'Intake normalizer options') {
  if (!isObject(options)) {
    throw new TypeError(`${description} must be an object.`);
  }

  return options;
}

function normalizeOptionalString(value) {
  if (value === null || value === undefined) {
    return undefined;
  }

  const normalizedValue = String(value).trim();

  return normalizedValue === '' ? undefined : normalizedValue;
}

function normalizeRequiredString(value, description) {
  const normalizedValue = normalizeOptionalString(value);

  if (normalizedValue === undefined) {
    throw new TypeError(`${description} must be a non-empty value.`);
  }

  return normalizedValue;
}

function normalizeCode(value) {
  return normalizeOptionalString(value)?.toUpperCase();
}

function normalizeStateCode(value) {
  const stateCode = normalizeCode(value);

  return stateCode && /^[A-Z]{2}$/.test(stateCode)
    ? stateCode
    : stateCode;
}

function normalizeBoolean(value) {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return value !== 0;
  }

  if (typeof value !== 'string') {
    return value;
  }

  const normalizedValue = value.trim().toLowerCase();

  if (['true', 'yes', 'y', '1'].includes(normalizedValue)) {
    return true;
  }

  if (['false', 'no', 'n', '0'].includes(normalizedValue)) {
    return false;
  }

  return value;
}

function normalizeNumber(value) {
  if (
    value === null ||
    value === undefined ||
    (typeof value === 'string' && value.trim() === '')
  ) {
    return undefined;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : value;
  }

  const numberValue = Number(value);

  return Number.isFinite(numberValue) ? numberValue : value;
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

function removeUndefinedValues(value) {
  if (Array.isArray(value)) {
    return value.map(removeUndefinedValues);
  }

  if (!isObject(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).flatMap(([key, nestedValue]) =>
      nestedValue === undefined
        ? []
        : [[key, removeUndefinedValues(nestedValue)]],
    ),
  );
}

function createNormalizerError(code, message, details, cause) {
  const error = new Error(message, {
    ...(cause === undefined ? {} : { cause }),
  });

  error.name = 'IntakeNormalizerError';
  error.code = code;
  error.details = details ?? null;
  error.recoverable = true;

  return error;
}

function stripByteOrderMark(value) {
  return value.replace(/^\uFEFF/, '');
}

function normalizeRawContent(rawContent, description = 'Intake content') {
  if (typeof rawContent !== 'string') {
    throw createNormalizerError(
      INTAKE_NORMALIZER_ERROR_CODES.EMPTY_CONTENT,
      `${description} must be a string.`,
      null,
    );
  }

  const normalizedContent = stripByteOrderMark(rawContent)
    .replace(/\r\n?/g, '\n')
    .trim();

  if (normalizedContent === '') {
    throw createNormalizerError(
      INTAKE_NORMALIZER_ERROR_CODES.EMPTY_CONTENT,
      `${description} cannot be empty.`,
      null,
    );
  }

  return normalizedContent;
}

function getFirstDefinedValue(source, aliases) {
  if (!isObject(source)) {
    return undefined;
  }

  for (const alias of aliases) {
    if (
      Object.hasOwn(source, alias) &&
      source[alias] !== null &&
      source[alias] !== undefined &&
      (typeof source[alias] !== 'string' ||
        source[alias].trim() !== '')
    ) {
      return source[alias];
    }
  }

  return undefined;
}

function readCanonicalField(source, field) {
  return getFirstDefinedValue(
    source,
    CANONICAL_FIELD_ALIASES[field] ?? [field],
  );
}

function normalizeStringArray(value) {
  if (value === null || value === undefined) {
    return [];
  }

  const values = Array.isArray(value)
    ? value
    : String(value).split(/[;,]/);

  return [
    ...new Set(
      values
        .map((item) => {
          if (isObject(item)) {
            return normalizeOptionalString(
              item.code ?? item.name ?? item.value,
            );
          }

          return normalizeOptionalString(item);
        })
        .filter(Boolean),
    ),
  ];
}

function normalizeCompany(value) {
  const company = normalizeOptionalString(value);

  if (!company) {
    return undefined;
  }

  const token = company
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

  if (token === 'banner' || token === 'bannerlife') {
    return 'Banner';
  }

  if (
    token === 'williampenn' ||
    token === 'williampennlife' ||
    token === 'williampennlifeinsurancecompanyofnewyork'
  ) {
    return 'WilliamPenn';
  }

  return company;
}

function inferJourneyType(contractType, recordType) {
  const normalizedContractType = normalizeOptionalString(
    contractType,
  )
    ?.toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  const normalizedRecordType = normalizeOptionalString(recordType)
    ?.toLowerCase()
    .replace(/[^a-z0-9]/g, '');

  if (
    normalizedRecordType === 'rep' ||
    normalizedContractType === 'registeredrepresentative'
  ) {
    return 'registered_rep';
  }

  if (
    [
      'corporate',
      'agency',
      'entity',
      'organization',
    ].includes(normalizedContractType)
  ) {
    return 'corporate';
  }

  if (
    normalizedContractType === 'financialinstitutionemployee'
  ) {
    return 'financial_institution';
  }

  return 'agent_contracting';
}

function normalizeAgency(source, fallbackSource) {
  const agencySource = isObject(source) ? source : {};
  const fallback = isObject(fallbackSource) ? fallbackSource : {};
  const name = normalizeOptionalString(
    agencySource.name ??
      agencySource.legalName ??
      fallback.agencyName ??
      fallback.AGENCY_NAME,
  );
  const type = normalizeOptionalString(
    agencySource.type ??
      readCanonicalField(fallback, 'agencyType'),
  );
  const code = normalizeOptionalString(
    agencySource.code ??
      agencySource.agencyCode ??
      fallback.agencyCode ??
      fallback.AGENCY_CODE,
  );

  if (!name && !type && !code && Object.keys(agencySource).length === 0) {
    return undefined;
  }

  return removeUndefinedValues({
    ...cloneValue(agencySource),
    name,
    type,
    code,
  });
}

function normalizeContract(source, fallbackSource) {
  const contractSource = isObject(source) ? source : {};
  const fallback = isObject(fallbackSource) ? fallbackSource : {};
  const type = normalizeOptionalString(
    contractSource.type ??
      readCanonicalField(fallback, 'contractType'),
  );
  const level = normalizeNumber(
    contractSource.level ?? readCanonicalField(fallback, 'level'),
  );
  const commissionSchedule = normalizeOptionalString(
    contractSource.commissionSchedule ??
      readCanonicalField(fallback, 'commissionSchedule'),
  );
  const advanceCommission = normalizeBoolean(
    contractSource.advanceCommission ??
      readCanonicalField(fallback, 'advanceCommission'),
  );

  if (
    !type &&
    level === undefined &&
    !commissionSchedule &&
    advanceCommission === undefined &&
    Object.keys(contractSource).length === 0
  ) {
    return undefined;
  }

  return removeUndefinedValues({
    ...cloneValue(contractSource),
    type,
    level,
    commissionSchedule,
    advanceCommission,
  });
}

function normalizeAgent(source, fallbackSource) {
  const agentSource = isObject(source) ? source : {};
  const fallback = isObject(fallbackSource) ? fallbackSource : {};
  const firstName = normalizeOptionalString(
    agentSource.firstName ??
      readCanonicalField(fallback, 'firstName'),
  );
  const middleName = normalizeOptionalString(
    agentSource.middleName ??
      readCanonicalField(fallback, 'middleName'),
  );
  const lastName = normalizeOptionalString(
    agentSource.lastName ??
      readCanonicalField(fallback, 'lastName'),
  );
  const email = normalizeOptionalString(
    agentSource.email ?? readCanonicalField(fallback, 'email'),
  )?.toLowerCase();
  const phone = normalizeOptionalString(
    agentSource.phone ?? readCanonicalField(fallback, 'phone'),
  );
  const npn = normalizeOptionalString(
    agentSource.npn ?? readCanonicalField(fallback, 'npn'),
  );
  const crd = normalizeOptionalString(
    agentSource.crd ?? readCanonicalField(fallback, 'crd'),
  );
  const residenceState = normalizeStateCode(
    agentSource.residenceState ??
      agentSource.residentState ??
      readCanonicalField(fallback, 'residenceState'),
  );

  if (
    !firstName &&
    !lastName &&
    !email &&
    !npn &&
    !crd &&
    Object.keys(agentSource).length === 0
  ) {
    return undefined;
  }

  return removeUndefinedValues({
    ...cloneValue(agentSource),
    type: agentSource.type ?? 'individual',
    firstName,
    middleName,
    lastName,
    email,
    phone,
    npn,
    crd,
    residenceState,
  });
}

function normalizeOrganization(source) {
  if (!isObject(source)) {
    return undefined;
  }

  const legalName = normalizeOptionalString(
    source.legalName ?? source.name,
  );

  return removeUndefinedValues({
    ...cloneValue(source),
    type: source.type ?? 'organization',
    legalName,
    email: normalizeOptionalString(source.email)?.toLowerCase(),
    phone: normalizeOptionalString(source.phone),
    stateOfFormation: normalizeStateCode(source.stateOfFormation),
  });
}

function normalizeLicensing(source, fallbackSource) {
  const licensingSource = isObject(source) ? source : {};
  const fallback = isObject(fallbackSource) ? fallbackSource : {};
  const residentState = normalizeStateCode(
    licensingSource.residentState ??
      licensingSource.residenceState ??
      readCanonicalField(fallback, 'residenceState'),
  );
  const licenseNumber = normalizeOptionalString(
    licensingSource.licenseNumber ??
      readCanonicalField(fallback, 'licenseNumber'),
  );
  const linesOfAuthority = normalizeStringArray(
    licensingSource.linesOfAuthority ??
      fallback.linesOfAuthority ??
      fallback.LINES_OF_AUTHORITY ??
      fallback.LINE_OF_AUTHORITY,
  );

  if (
    !residentState &&
    !licenseNumber &&
    linesOfAuthority.length === 0 &&
    Object.keys(licensingSource).length === 0
  ) {
    return undefined;
  }

  return removeUndefinedValues({
    ...cloneValue(licensingSource),
    residentState,
    licenseNumber,
    linesOfAuthority,
  });
}

function normalizeAttestations(source) {
  if (!isObject(source)) {
    return undefined;
  }

  return removeUndefinedValues(
    Object.fromEntries(
      Object.entries(source).map(([key, value]) => [
        key,
        normalizeBoolean(value),
      ]),
    ),
  );
}

function normalizeGenericObject(source) {
  return isObject(source)
    ? removeUndefinedValues(cloneValue(source))
    : undefined;
}

function buildSourceMetadata(context) {
  const options = assertOptions(context, 'Intake normalization context');

  return removeUndefinedValues({
    sourceChannel: options.sourceChannel,
    sourceFormat: options.sourceFormat,
    partnerCode: options.partnerCode,
    fileName: options.fileName ?? undefined,
    mimeType: options.mimeType ?? undefined,
    bulk: options.bulk ?? false,
    simulateScenario: options.simulateScenario,
    recordIndex: options.recordIndex,
    importedAt: options.importedAt,
  });
}

function buildCanonicalPayload(record, context = {}) {
  if (!isObject(record)) {
    throw createNormalizerError(
      INTAKE_NORMALIZER_ERROR_CODES.INVALID_REQUEST,
      'The parsed intake record must be an object.',
      null,
    );
  }

  const normalizedContext = assertOptions(
    context,
    'Intake normalization context',
  );
  const company = normalizeCompany(
    readCanonicalField(record, 'company'),
  );
  const gaCode = normalizeOptionalString(
    readCanonicalField(record, 'gaCode'),
  );
  const agency = normalizeAgency(record.agency, record);
  const contract = normalizeContract(record.contract, record);
  const organization = normalizeOrganization(record.organization);
  const agent = normalizeAgent(
    record.agent ?? record.applicant,
    record,
  );
  const applicant = organization ?? agent;
  const licensing = normalizeLicensing(record.licensing, record);
  const agencyType =
    normalizeOptionalString(readCanonicalField(record, 'agencyType')) ??
    agency?.type;
  const contractType =
    normalizeOptionalString(
      readCanonicalField(record, 'contractType'),
    ) ?? contract?.type;
  const sourceMetadata = buildSourceMetadata(normalizedContext);
  const partnerCode =
    normalizeOptionalString(normalizedContext.partnerCode) ??
    normalizeOptionalString(record.partnerCode);
  const submissionId = normalizeOptionalString(
    readCanonicalField(record, 'submissionId'),
  );
  const requestType =
    normalizeOptionalString(readCanonicalField(record, 'requestType')) ??
    'new_onboarding';
  const recordType = normalizeOptionalString(
    record.recordType ?? record.RECORD_TYPE,
  );

  return removeUndefinedValues({
    submissionId,
    requestType,
    company,
    carrierCode:
      normalizeCode(record.carrierCode) ??
      (company === 'WilliamPenn'
        ? 'WILLIAM_PENN'
        : company === 'Banner'
          ? 'BANNER'
          : undefined),
    gaCode,
    partnerCode,
    agencyType,
    contractType,
    journeyType:
      normalizeOptionalString(record.journeyType) ??
      inferJourneyType(contractType, recordType),
    agency,
    contract,
    agent,
    applicant,
    organization,
    principals: Array.isArray(record.principals)
      ? cloneValue(record.principals)
      : undefined,
    licensing,
    banking: normalizeGenericObject(record.banking),
    errorsAndOmissions: normalizeGenericObject(
      record.errorsAndOmissions ?? record.eAndO,
    ),
    attestations: normalizeAttestations(record.attestations),
    hierarchy: normalizeGenericObject(record.hierarchy),
    documents: normalizeGenericObject(record.documents),
    sourceMetadata,
  });
}

function parseJsonContent(rawContent, description) {
  const content = normalizeRawContent(rawContent, description);

  try {
    return JSON.parse(content);
  } catch (error) {
    throw createNormalizerError(
      INTAKE_NORMALIZER_ERROR_CODES.INVALID_JSON,
      `${description} is not valid JSON.`,
      null,
      error,
    );
  }
}

function extractRecordCollection(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (!isObject(value)) {
    throw createNormalizerError(
      INTAKE_NORMALIZER_ERROR_CODES.INVALID_JSON,
      'Parsed intake content must contain an object or array.',
      null,
    );
  }

  for (const field of ['records', 'submissions', 'items', 'data']) {
    if (Array.isArray(value[field])) {
      return value[field];
    }
  }

  return [value];
}

function decodeXmlEntities(value) {
  return value.replace(XML_ENTITY_PATTERN, (entity, token) => {
    const normalizedToken = token.toLowerCase();

    if (normalizedToken === 'amp') {
      return '&';
    }

    if (normalizedToken === 'lt') {
      return '<';
    }

    if (normalizedToken === 'gt') {
      return '>';
    }

    if (normalizedToken === 'quot') {
      return '"';
    }

    if (normalizedToken === 'apos') {
      return "'";
    }

    const codePoint = normalizedToken.startsWith('#x')
      ? Number.parseInt(normalizedToken.slice(2), 16)
      : Number.parseInt(normalizedToken.slice(1), 10);

    return Number.isSafeInteger(codePoint) &&
      codePoint >= 0 &&
      codePoint <= 0x10ffff
      ? String.fromCodePoint(codePoint)
      : entity;
  });
}

function validateXmlDocument(xml) {
  if (XML_UNSAFE_PATTERN.test(xml)) {
    throw createNormalizerError(
      INTAKE_NORMALIZER_ERROR_CODES.UNSAFE_XML,
      'XML declarations containing external entities or stylesheets are not supported.',
      null,
    );
  }

  const stack = [];
  let rootCount = 0;
  let match;

  XML_TOKEN_PATTERN.lastIndex = 0;

  while ((match = XML_TOKEN_PATTERN.exec(xml)) !== null) {
    const token = match[0];

    if (
      token.startsWith('<!--') ||
      token.startsWith('<?') ||
      token.startsWith('<![CDATA[')
    ) {
      continue;
    }

    const name = match[1];

    if (token.startsWith('</')) {
      const openName = stack.pop();

      if (openName !== name) {
        throw createNormalizerError(
          INTAKE_NORMALIZER_ERROR_CODES.INVALID_XML,
          `XML closing tag does not match the open element: ${name}.`,
          { expected: openName ?? null, actual: name },
        );
      }

      continue;
    }

    if (stack.length === 0) {
      rootCount += 1;
    }

    if (!token.endsWith('/>')) {
      stack.push(name);
    }
  }

  if (rootCount !== 1 || stack.length > 0) {
    throw createNormalizerError(
      INTAKE_NORMALIZER_ERROR_CODES.INVALID_XML,
      'XML content must contain one well-formed root element.',
      { unclosedElements: [...stack] },
    );
  }
}

function escapeRegularExpression(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function readXmlElement(xml, elementName) {
  const escapedName = escapeRegularExpression(elementName);
  const pattern = new RegExp(
    `<${escapedName}(?:\\s[^<>]*?)?>([\\s\\S]*?)<\\/${escapedName}>`,
    'i',
  );
  const match = pattern.exec(xml);

  if (!match) {
    return undefined;
  }

  return decodeXmlEntities(
    match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim(),
  );
}

function readXmlElements(xml, elementName) {
  const escapedName = escapeRegularExpression(elementName);
  const pattern = new RegExp(
    `<${escapedName}(?:\\s[^<>]*?)?>([\\s\\S]*?)<\\/${escapedName}>`,
    'gi',
  );
  const values = [];
  let match;

  while ((match = pattern.exec(xml)) !== null) {
    values.push(decodeXmlEntities(match[1].trim()));
  }

  return values;
}

function readXmlOpeningTag(xml, elementName) {
  const escapedName = escapeRegularExpression(elementName);
  const pattern = new RegExp(
    `<${escapedName}(\\s[^<>]*?)?>`,
    'i',
  );

  return pattern.exec(xml)?.[0];
}

function readXmlAttribute(openingTag, attributeName) {
  if (!openingTag) {
    return undefined;
  }

  const escapedName = escapeRegularExpression(attributeName);
  const pattern = new RegExp(
    `\\b${escapedName}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`,
    'i',
  );
  const match = pattern.exec(openingTag);

  return match
    ? decodeXmlEntities(match[1] ?? match[2] ?? '')
    : undefined;
}

function readXmlSection(xml, elementName) {
  const escapedName = escapeRegularExpression(elementName);
  const pattern = new RegExp(
    `<${escapedName}(?:\\s[^<>]*?)?>([\\s\\S]*?)<\\/${escapedName}>`,
    'i',
  );

  return pattern.exec(xml)?.[1];
}

function parseEthosXmlRecord(xml) {
  validateXmlDocument(xml);

  const agencySection = readXmlSection(xml, 'Agency') ?? '';
  const contractSection = readXmlSection(xml, 'Contract') ?? '';
  const agentSection = readXmlSection(xml, 'Agent') ?? '';
  const licenseSection = readXmlSection(agentSection, 'License') ?? '';
  const attestationsSection =
    readXmlSection(xml, 'Attestations') ?? '';
  const generalAgencyTag = readXmlOpeningTag(xml, 'GeneralAgency');
  const agencyTag = readXmlOpeningTag(xml, 'Agency');
  const contractTag = readXmlOpeningTag(xml, 'Contract');
  const licenseTag = readXmlOpeningTag(agentSection, 'License');

  return {
    submissionId: readXmlElement(xml, 'SubmissionId'),
    requestType: readXmlElement(xml, 'RequestType'),
    company: readXmlElement(xml, 'Company'),
    gaCode:
      readXmlAttribute(generalAgencyTag, 'code') ??
      readXmlElement(xml, 'GaCode'),
    agencyType: readXmlAttribute(agencyTag, 'type'),
    contractType: readXmlAttribute(contractTag, 'type'),
    agency: {
      name: readXmlElement(agencySection, 'Name'),
      type: readXmlAttribute(agencyTag, 'type'),
      code: readXmlAttribute(agencyTag, 'code'),
    },
    contract: {
      type: readXmlAttribute(contractTag, 'type'),
      level: normalizeNumber(readXmlElement(contractSection, 'Level')),
      commissionSchedule: readXmlElement(
        contractSection,
        'CommissionSchedule',
      ),
      advanceCommission: normalizeBoolean(
        readXmlElement(contractSection, 'AdvanceCommission'),
      ),
    },
    agent: {
      firstName: readXmlElement(agentSection, 'FirstName'),
      middleName: readXmlElement(agentSection, 'MiddleName'),
      lastName: readXmlElement(agentSection, 'LastName'),
      email: readXmlElement(agentSection, 'Email'),
      phone: readXmlElement(agentSection, 'Phone'),
      npn: readXmlElement(agentSection, 'NPN'),
      crd: readXmlElement(agentSection, 'CRD'),
      residenceState: readXmlElement(
        agentSection,
        'ResidenceState',
      ),
    },
    licensing: {
      residentState:
        readXmlAttribute(licenseTag, 'residentState') ??
        readXmlElement(licenseSection, 'ResidentState'),
      licenseNumber:
        readXmlAttribute(licenseTag, 'number') ??
        readXmlElement(licenseSection, 'LicenseNumber'),
      linesOfAuthority: readXmlElements(
        licenseSection,
        'LineOfAuthority',
      ),
    },
    attestations: {
      backgroundQuestionsClear: normalizeBoolean(
        readXmlElement(
          attestationsSection,
          'BackgroundQuestionsClear',
        ),
      ),
      electronicDeliveryConsent: normalizeBoolean(
        readXmlElement(
          attestationsSection,
          'ElectronicDeliveryConsent',
        ),
      ),
    },
  };
}

function parseDelimitedLine(line, delimiter) {
  const values = [];
  let value = '';
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];

    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }

      continue;
    }

    if (character === delimiter && !quoted) {
      values.push(value.trim());
      value = '';
      continue;
    }

    value += character;
  }

  if (quoted) {
    throw createNormalizerError(
      INTAKE_NORMALIZER_ERROR_CODES.INVALID_FLAT_FILE,
      'A DTCC record contains an unterminated quoted value.',
      { line },
    );
  }

  values.push(value.trim());
  return values;
}

function normalizeHeaderName(header) {
  return normalizeRequiredString(header, 'DTCC header')
    .replace(/^\uFEFF/, '')
    .trim();
}

function createRecordFromColumns(headers, columns, lineNumber) {
  if (columns.length !== headers.length) {
    throw createNormalizerError(
      INTAKE_NORMALIZER_ERROR_CODES.INVALID_FLAT_FILE,
      `DTCC record ${lineNumber} contains ${columns.length} columns; ${headers.length} were expected.`,
      {
        lineNumber,
        actualColumns: columns.length,
        expectedColumns: headers.length,
      },
    );
  }

  return Object.fromEntries(
    headers.map((header, index) => [header, columns[index]]),
  );
}

function mapExtractedFields(fields) {
  const source = isObject(fields) ? fields : {};

  return Object.fromEntries(
    Object.entries(source).map(([field, entry]) => [
      field,
      isObject(entry) && Object.hasOwn(entry, 'value')
        ? entry.value
        : entry,
    ]),
  );
}

function getNestedValue(source, path) {
  return path.split('.').reduce(
    (value, segment) =>
      value === null || value === undefined
        ? undefined
        : value[segment],
    source,
  );
}

function setNestedValue(target, path, value) {
  const segments = path.split('.');
  let current = target;

  segments.forEach((segment, index) => {
    if (index === segments.length - 1) {
      current[segment] = value;
      return;
    }

    if (!isObject(current[segment])) {
      current[segment] = {};
    }

    current = current[segment];
  });
}

function expandDottedFields(fields) {
  const expanded = {};

  Object.entries(fields).forEach(([key, value]) => {
    if (key.includes('.')) {
      setNestedValue(expanded, key, value);
    } else {
      expanded[key] = value;
    }
  });

  return expanded;
}

function mapExtractionToRecord(extraction, metadata = {}) {
  const fields = expandDottedFields(mapExtractedFields(extraction));
  const agentSource = fields.agent ?? fields;
  const licensingSource = fields.licensing ?? {};
  const contractSource = fields.contract ?? {};
  const bankingSource = fields.banking ?? {};
  const attestationsSource = fields.attestations ?? {};

  return removeUndefinedValues({
    submissionId:
      fields.submissionId ??
      metadata.submissionId ??
      metadata.documentId,
    requestType: fields.requestType,
    company: fields.company,
    gaCode: fields.gaCode,
    agencyType: fields.agencyType,
    contractType: fields.contractType,
    agency: fields.agency,
    organization: fields.organization,
    principals: fields.principals,
    contract: {
      ...contractSource,
      type: contractSource.type ?? fields.contractType,
      level: contractSource.level ?? fields.level,
      commissionSchedule:
        contractSource.commissionSchedule ??
        fields.commissionSchedule,
      advanceCommission:
        contractSource.advanceCommission ??
        fields.advanceCommission,
    },
    agent: {
      ...agentSource,
      firstName: agentSource.firstName ?? fields.firstName,
      middleName: agentSource.middleName ?? fields.middleName,
      lastName: agentSource.lastName ?? fields.lastName,
      email: agentSource.email ?? fields.email,
      phone: agentSource.phone ?? fields.phone,
      npn: agentSource.npn ?? fields.npn,
      crd: agentSource.crd ?? fields.crd,
      residenceState:
        agentSource.residenceState ?? fields.residenceState,
    },
    licensing: {
      ...licensingSource,
      residentState:
        licensingSource.residentState ??
        fields.residentState ??
        fields.residenceState,
      licenseNumber:
        licensingSource.licenseNumber ?? fields.licenseNumber,
      linesOfAuthority:
        licensingSource.linesOfAuthority ??
        fields.linesOfAuthority,
    },
    banking:
      Object.keys(bankingSource).length > 0
        ? bankingSource
        : undefined,
    errorsAndOmissions: fields.errorsAndOmissions,
    attestations:
      Object.keys(attestationsSource).length > 0
        ? attestationsSource
        : {
            backgroundQuestionsClear:
              fields.backgroundQuestionsClear,
            electronicDeliveryConsent:
              fields.electronicDeliveryConsent,
          },
  });
}

function parseManualText(rawContent) {
  const content = normalizeRawContent(rawContent, 'Manual intake content');
  const record = {};

  const patterns = {
    company: /\b(Banner|William\s*Penn)\b/i,
    gaCode: /\b(?:GA|general agency)(?:\s+code)?\s*[:#]?\s*([A-Z0-9_-]+)/i,
    npn: /\bNPN\s*[:#]?\s*([A-Z0-9_-]+)/i,
    residenceState:
      /\b(?:residence|resident)\s+state\s*[:#]?\s*([A-Z]{2})\b/i,
    email:
      /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
    phone:
      /\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/,
  };

  const companyMatch = patterns.company.exec(content);
  const gaCodeMatch = patterns.gaCode.exec(content);
  const npnMatch = patterns.npn.exec(content);
  const stateMatch = patterns.residenceState.exec(content);
  const emailMatch = patterns.email.exec(content);
  const phoneMatch = patterns.phone.exec(content);
  const personMatch =
    /(?:for|producer|agent)\s+([A-Z][A-Za-z'-]+)\s+([A-Z][A-Za-z'-]+)/.exec(
      content,
    );

  record.company = companyMatch
    ? normalizeCompany(companyMatch[1])
    : undefined;
  record.gaCode = gaCodeMatch?.[1];
  record.contractType = /\bcorporate\b/i.test(content)
    ? 'corporate'
    : /\bregistered representative\b/i.test(content)
      ? 'registered_representative'
      : /\bindividual\b/i.test(content)
        ? 'individual'
        : undefined;
  record.agencyType = /\bnon[-\s]?traditional\b/i.test(content)
    ? 'non_traditional'
    : /\btraditional\b/i.test(content)
      ? 'traditional'
      : undefined;
  record.agent = {
    firstName: personMatch?.[1],
    lastName: personMatch?.[2],
    email: emailMatch?.[0],
    phone: phoneMatch?.[0],
    npn: npnMatch?.[1],
    residenceState: stateMatch?.[1],
  };

  return removeUndefinedValues(record);
}

function normalizeContext(context, sourceFormat) {
  const normalizedContext = assertOptions(
    context,
    'Intake normalization context',
  );
  const sourceChannel =
    normalizedContext.sourceChannel ?? SOURCE_CHANNELS.MANUAL;

  if (!Object.values(SOURCE_CHANNELS).includes(sourceChannel)) {
    throw createNormalizerError(
      INTAKE_NORMALIZER_ERROR_CODES.INVALID_REQUEST,
      `Unsupported source channel: ${sourceChannel}.`,
      { sourceChannel },
    );
  }

  return {
    ...normalizedContext,
    sourceChannel,
    sourceFormat,
  };
}

/**
 * Parses Quility-style JSON into source records.
 *
 * @param {string | object | object[]} input JSON content or parsed data.
 * @returns {object[]} Parsed source records.
 */
export function parseJsonIntake(input) {
  const parsedValue =
    typeof input === 'string'
      ? parseJsonContent(input, 'JSON intake content')
      : cloneValue(input);

  return extractRecordCollection(parsedValue).map((record, index) => {
    if (!isObject(record)) {
      throw createNormalizerError(
        INTAKE_NORMALIZER_ERROR_CODES.INVALID_JSON,
        `JSON intake record ${index + 1} must be an object.`,
        { recordIndex: index },
      );
    }

    return record;
  });
}

/**
 * Normalizes a Quility JSON record.
 *
 * @param {object | string} input Parsed record or JSON content.
 * @param {object} [context] Source context.
 * @returns {object} Canonical onboarding payload.
 */
export function normalizeQuilityJson(input, context = {}) {
  const records =
    typeof input === 'string' ? parseJsonIntake(input) : [input];

  if (records.length !== 1) {
    throw createNormalizerError(
      INTAKE_NORMALIZER_ERROR_CODES.INVALID_JSON,
      'A single-record normalizer cannot normalize multiple JSON records.',
      { recordCount: records.length },
    );
  }

  return buildCanonicalPayload(
    records[0],
    normalizeContext(context, SOURCE_FORMATS.QUILITY_JSON),
  );
}

/**
 * Parses an Ethos XML document into a source record.
 *
 * @param {string} rawContent XML content.
 * @returns {object[]} Parsed source records.
 */
export function parseEthosXml(rawContent) {
  const xml = normalizeRawContent(rawContent, 'Ethos XML content');

  try {
    return [parseEthosXmlRecord(xml)];
  } catch (error) {
    if (error?.name === 'IntakeNormalizerError') {
      throw error;
    }

    throw createNormalizerError(
      INTAKE_NORMALIZER_ERROR_CODES.INVALID_XML,
      'Ethos XML content could not be parsed.',
      null,
      error,
    );
  }
}

/**
 * Normalizes an Ethos XML document or parsed record.
 *
 * @param {object | string} input XML content or parsed record.
 * @param {object} [context] Source context.
 * @returns {object} Canonical onboarding payload.
 */
export function normalizeEthosXml(input, context = {}) {
  const record =
    typeof input === 'string' ? parseEthosXml(input)[0] : input;

  return buildCanonicalPayload(
    record,
    normalizeContext(context, SOURCE_FORMATS.ETHOS_XML),
  );
}

/**
 * Parses pipe-delimited DTCC text.
 *
 * @param {string} rawContent Flat-file content.
 * @param {{delimiter?: string, hasHeader?: boolean, headers?: string[]}}
 * [options] Flat-file options.
 * @returns {object[]} Parsed source records.
 */
export function parseDtccFlatFile(rawContent, options = {}) {
  const normalizedOptions = assertOptions(
    options,
    'DTCC parser options',
  );
  const content = normalizeRawContent(
    rawContent,
    'DTCC flat-file content',
  );
  const delimiter =
    normalizedOptions.delimiter ?? DEFAULT_DTCC_DELIMITER;

  if (typeof delimiter !== 'string' || delimiter.length !== 1) {
    throw new TypeError('The DTCC delimiter must be one character.');
  }

  const lines = content
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const hasHeader = normalizedOptions.hasHeader !== false;
  let headers;
  let firstRecordIndex;

  if (hasHeader) {
    headers = parseDelimitedLine(lines[0], delimiter).map(
      normalizeHeaderName,
    );
    firstRecordIndex = 1;
  } else {
    if (
      !Array.isArray(normalizedOptions.headers) ||
      normalizedOptions.headers.length === 0
    ) {
      throw createNormalizerError(
        INTAKE_NORMALIZER_ERROR_CODES.INVALID_FLAT_FILE,
        'DTCC headers are required when the file has no header row.',
        null,
      );
    }

    headers = normalizedOptions.headers.map(normalizeHeaderName);
    firstRecordIndex = 0;
  }

  if (lines.length <= firstRecordIndex) {
    throw createNormalizerError(
      INTAKE_NORMALIZER_ERROR_CODES.INVALID_FLAT_FILE,
      'DTCC flat-file content does not contain any records.',
      null,
    );
  }

  const duplicateHeaders = headers.filter(
    (header, index) => headers.indexOf(header) !== index,
  );

  if (duplicateHeaders.length > 0) {
    throw createNormalizerError(
      INTAKE_NORMALIZER_ERROR_CODES.INVALID_FLAT_FILE,
      'DTCC flat-file headers must be unique.',
      { duplicateHeaders: [...new Set(duplicateHeaders)] },
    );
  }

  return lines.slice(firstRecordIndex).map((line, index) =>
    createRecordFromColumns(
      headers,
      parseDelimitedLine(line, delimiter),
      firstRecordIndex + index + 1,
    ),
  );
}

/**
 * Normalizes a parsed DTCC record.
 *
 * @param {object | string} input Parsed record or flat-file content.
 * @param {object} [context] Source context.
 * @returns {object | object[]} Canonical payload or payload collection.
 */
export function normalizeDtccFlatFile(input, context = {}) {
  const normalizedContext = normalizeContext(
    context,
    SOURCE_FORMATS.DTCC_FLAT_FILE,
  );
  const records =
    typeof input === 'string'
      ? parseDtccFlatFile(input, normalizedContext.layout ?? {})
      : [input];
  const normalizedRecords = records.map((record, index) =>
    buildCanonicalPayload(record, {
      ...normalizedContext,
      recordIndex: normalizedContext.recordIndex ?? index,
    }),
  );

  return normalizedRecords.length === 1
    ? normalizedRecords[0]
    : normalizedRecords;
}

/**
 * Parses TIF metadata represented as JSON.
 *
 * @param {string | object} input TIF metadata.
 * @returns {object[]} Parsed metadata records.
 */
export function parseSureLcTifMetadata(input) {
  const metadata =
    typeof input === 'string'
      ? parseJsonContent(input, 'SureLC TIF metadata')
      : cloneValue(input);

  if (!isObject(metadata)) {
    throw createNormalizerError(
      INTAKE_NORMALIZER_ERROR_CODES.INVALID_METADATA,
      'SureLC TIF metadata must be an object.',
      null,
    );
  }

  return [metadata];
}

/**
 * Normalizes OCR extraction fields into a canonical payload.
 *
 * @param {object} extraction OCR extraction object or field map.
 * @param {object} [context] Source context.
 * @returns {object} Canonical onboarding payload.
 */
export function normalizeOcrExtraction(extraction, context = {}) {
  if (!isObject(extraction)) {
    throw createNormalizerError(
      INTAKE_NORMALIZER_ERROR_CODES.INVALID_METADATA,
      'OCR extraction data must be an object.',
      null,
    );
  }

  const fields = extraction.fields ?? extraction.extractedFields ?? extraction;
  const metadata = isObject(context.metadata) ? context.metadata : {};
  const record = mapExtractionToRecord(fields, metadata);
  const payload = buildCanonicalPayload(
    record,
    normalizeContext(
      context,
      context.sourceFormat ?? SOURCE_FORMATS.MANUAL_FORM,
    ),
  );
  const confidenceValues = Object.entries(fields)
    .filter(([, value]) => isObject(value))
    .map(([field, value]) => ({
      field,
      confidence:
        typeof value.confidence === 'number'
          ? value.confidence
          : undefined,
    }))
    .filter(({ confidence }) => confidence !== undefined);

  return removeUndefinedValues({
    ...payload,
    extractionMetadata: {
      engine: extraction.engine,
      overallConfidence:
        extraction.overallConfidence ?? extraction.ocrConfidence,
      fieldConfidence: confidenceValues,
      unreadableFields: normalizeStringArray(
        extraction.unreadableFields,
      ),
      ambiguousFields: Array.isArray(extraction.ambiguousFields)
        ? cloneValue(extraction.ambiguousFields)
        : [],
      signatureDetected: normalizeBoolean(
        extraction.signatureDetected ??
          getNestedValue(fields, 'signaturePresent'),
      ),
    },
  });
}

/**
 * Normalizes SureLC TIF metadata and OCR fields.
 *
 * @param {object | string} input TIF metadata.
 * @param {object} [context] Source context.
 * @returns {object} Canonical onboarding payload.
 */
export function normalizeSureLcTifMetadata(input, context = {}) {
  const metadata = parseSureLcTifMetadata(input)[0];
  const ocr = metadata.ocr ?? metadata.extraction;

  if (!isObject(ocr)) {
    throw createNormalizerError(
      INTAKE_NORMALIZER_ERROR_CODES.INVALID_METADATA,
      'SureLC TIF metadata must contain OCR extraction data.',
      { documentId: metadata.documentId ?? null },
    );
  }

  return normalizeOcrExtraction(ocr, {
    ...context,
    sourceFormat: SOURCE_FORMATS.SURELC_TIF,
    metadata,
  });
}

/**
 * Parses manual intake content.
 *
 * JSON content is parsed directly; unstructured text is conservatively
 * extracted into known canonical fields.
 *
 * @param {string | object} input Manual intake data.
 * @returns {object[]} Parsed source records.
 */
export function parseManualIntake(input) {
  if (isObject(input)) {
    return [cloneValue(input)];
  }

  const content = normalizeRawContent(input, 'Manual intake content');

  if (content.startsWith('{') || content.startsWith('[')) {
    try {
      return parseJsonIntake(content);
    } catch (error) {
      throw createNormalizerError(
        INTAKE_NORMALIZER_ERROR_CODES.INVALID_MANUAL_INTAKE,
        'Manual JSON intake content could not be parsed.',
        null,
        error,
      );
    }
  }

  return [parseManualText(content)];
}

/**
 * Normalizes manual or OCR-derived intake.
 *
 * @param {object | string} input Manual intake data.
 * @param {object} [context] Source context.
 * @returns {object} Canonical onboarding payload.
 */
export function normalizeManualIntake(input, context = {}) {
  const records = parseManualIntake(input);

  if (records.length !== 1) {
    throw createNormalizerError(
      INTAKE_NORMALIZER_ERROR_CODES.INVALID_MANUAL_INTAKE,
      'A single manual intake operation cannot contain multiple records.',
      { recordCount: records.length },
    );
  }

  const record = records[0];

  if (
    isObject(record.extractedFields) ||
    isObject(record.ocr?.fields) ||
    isObject(record.ocr?.extractedFields)
  ) {
    const extraction = record.ocr ?? {
      extractedFields: record.extractedFields,
      ocrConfidence: record.ocrConfidence,
      ambiguousFields: record.ambiguousFields,
    };

    return normalizeOcrExtraction(extraction, {
      ...context,
      sourceFormat: SOURCE_FORMATS.MANUAL_FORM,
      metadata: record,
    });
  }

  return buildCanonicalPayload(
    record,
    normalizeContext(context, SOURCE_FORMATS.MANUAL_FORM),
  );
}

function createNormalizer({
  id,
  sourceFormat,
  parse,
  normalize,
}) {
  return Object.freeze({
    id,
    sourceFormat,
    parse,
    normalize,
  });
}

export const QUILITY_JSON_NORMALIZER = createNormalizer({
  id: 'quility-json',
  sourceFormat: SOURCE_FORMATS.QUILITY_JSON,
  parse: parseJsonIntake,
  normalize: normalizeQuilityJson,
});

export const ETHOS_XML_NORMALIZER = createNormalizer({
  id: 'ethos-xml',
  sourceFormat: SOURCE_FORMATS.ETHOS_XML,
  parse: parseEthosXml,
  normalize: normalizeEthosXml,
});

export const DTCC_FLAT_FILE_NORMALIZER = createNormalizer({
  id: 'dtcc-flat-file',
  sourceFormat: SOURCE_FORMATS.DTCC_FLAT_FILE,
  parse: parseDtccFlatFile,
  normalize: (record, context = {}) =>
    buildCanonicalPayload(
      record,
      normalizeContext(context, SOURCE_FORMATS.DTCC_FLAT_FILE),
    ),
});

export const SURELC_TIF_NORMALIZER = createNormalizer({
  id: 'surelc-tif',
  sourceFormat: SOURCE_FORMATS.SURELC_TIF,
  parse: parseSureLcTifMetadata,
  normalize: normalizeSureLcTifMetadata,
});

export const MANUAL_FORM_NORMALIZER = createNormalizer({
  id: 'manual-form',
  sourceFormat: SOURCE_FORMATS.MANUAL_FORM,
  parse: parseManualIntake,
  normalize: normalizeManualIntake,
});

export const CHANGE_REQUEST_NORMALIZER = createNormalizer({
  id: 'change-request',
  sourceFormat: SOURCE_FORMATS.CHANGE_REQUEST,
  parse: parseManualIntake,
  normalize: (record, context = {}) =>
    buildCanonicalPayload(
      record,
      normalizeContext(context, SOURCE_FORMATS.CHANGE_REQUEST),
    ),
});

export const INTAKE_NORMALIZERS = Object.freeze({
  [SOURCE_FORMATS.QUILITY_JSON]: QUILITY_JSON_NORMALIZER,
  [SOURCE_FORMATS.ETHOS_XML]: ETHOS_XML_NORMALIZER,
  [SOURCE_FORMATS.DTCC_FLAT_FILE]: DTCC_FLAT_FILE_NORMALIZER,
  [SOURCE_FORMATS.SURELC_TIF]: SURELC_TIF_NORMALIZER,
  [SOURCE_FORMATS.MANUAL_FORM]: MANUAL_FORM_NORMALIZER,
  [SOURCE_FORMATS.CHANGE_REQUEST]: CHANGE_REQUEST_NORMALIZER,
});

export const NORMALIZER_REGISTRY = INTAKE_NORMALIZERS;

/**
 * Returns the normalizer registered for a source format.
 *
 * @param {string} sourceFormat Source format.
 * @returns {object} Registered normalizer.
 */
export function getIntakeNormalizer(sourceFormat) {
  const normalizedSourceFormat = normalizeRequiredString(
    sourceFormat,
    'Source format',
  );
  const normalizer = INTAKE_NORMALIZERS[normalizedSourceFormat];

  if (!normalizer) {
    throw createNormalizerError(
      INTAKE_NORMALIZER_ERROR_CODES.UNSUPPORTED_FORMAT,
      `Unsupported intake source format: ${normalizedSourceFormat}.`,
      {
        sourceFormat: normalizedSourceFormat,
        supportedFormats: Object.keys(INTAKE_NORMALIZERS),
      },
    );
  }

  return normalizer;
}

/**
 * Parses and normalizes an intake request.
 *
 * @param {{
 *   sourceChannel: string,
 *   sourceFormat: string,
 *   rawContent: string | object,
 *   partnerCode?: string,
 *   fileName?: string | null,
 *   mimeType?: string | null,
 *   bulk?: boolean,
 *   simulateScenario?: string,
 *   layout?: object
 * }} request Intake request.
 * @returns {object[]} Canonical onboarding payloads.
 */
export function normalizeIntakeSubmission(request) {
  const normalizedRequest = assertOptions(request, 'Intake request');
  const sourceFormat = normalizeRequiredString(
    normalizedRequest.sourceFormat,
    'Source format',
  );
  const normalizer = getIntakeNormalizer(sourceFormat);
  let records;

  try {
    records =
      sourceFormat === SOURCE_FORMATS.DTCC_FLAT_FILE
        ? normalizer.parse(
            normalizedRequest.rawContent,
            normalizedRequest.layout ?? {},
          )
        : normalizer.parse(normalizedRequest.rawContent);
  } catch (error) {
    if (error?.name === 'IntakeNormalizerError') {
      throw error;
    }

    throw createNormalizerError(
      INTAKE_NORMALIZER_ERROR_CODES.PARSE_ERROR,
      'The intake submission could not be parsed.',
      { sourceFormat },
      error,
    );
  }

  if (!Array.isArray(records)) {
    throw createNormalizerError(
      INTAKE_NORMALIZER_ERROR_CODES.PARSE_ERROR,
      'The intake parser returned an invalid record collection.',
      { sourceFormat },
    );
  }

  return records.map((record, recordIndex) =>
    normalizer.normalize(record, {
      sourceChannel: normalizedRequest.sourceChannel,
      sourceFormat,
      partnerCode: normalizedRequest.partnerCode,
      fileName: normalizedRequest.fileName,
      mimeType: normalizedRequest.mimeType,
      bulk: normalizedRequest.bulk ?? records.length > 1,
      simulateScenario: normalizedRequest.simulateScenario,
      importedAt: normalizedRequest.importedAt,
      recordIndex,
      layout: normalizedRequest.layout,
    }),
  );
}

/**
 * Normalizes a single intake payload.
 *
 * @param {object} request Intake request.
 * @returns {object} Canonical onboarding payload.
 */
export function normalizeIntakePayload(request) {
  const records = normalizeIntakeSubmission(request);

  if (records.length !== 1) {
    throw createNormalizerError(
      INTAKE_NORMALIZER_ERROR_CODES.INVALID_REQUEST,
      'The intake request contains multiple records.',
      { recordCount: records.length },
    );
  }

  return records[0];
}

export class IntakeNormalizerRegistry {
  /**
   * @param {Record<string, object>} [normalizers] Normalizer map.
   */
  constructor(normalizers = INTAKE_NORMALIZERS) {
    if (!isObject(normalizers)) {
      throw new TypeError('Intake normalizers must be an object.');
    }

    Object.entries(normalizers).forEach(([sourceFormat, normalizer]) => {
      if (
        !isObject(normalizer) ||
        typeof normalizer.parse !== 'function' ||
        typeof normalizer.normalize !== 'function'
      ) {
        throw new TypeError(
          `The ${sourceFormat} intake normalizer is invalid.`,
        );
      }
    });

    this.normalizers = Object.freeze({ ...normalizers });
  }

  /**
   * Returns a normalizer by source format.
   *
   * @param {string} sourceFormat Source format.
   * @returns {object} Registered normalizer.
   */
  get(sourceFormat) {
    const normalizedSourceFormat = normalizeRequiredString(
      sourceFormat,
      'Source format',
    );
    const normalizer = this.normalizers[normalizedSourceFormat];

    if (!normalizer) {
      throw createNormalizerError(
        INTAKE_NORMALIZER_ERROR_CODES.UNSUPPORTED_FORMAT,
        `Unsupported intake source format: ${normalizedSourceFormat}.`,
        {
          sourceFormat: normalizedSourceFormat,
          supportedFormats: this.listFormats(),
        },
      );
    }

    return normalizer;
  }

  /**
   * Determines whether a source format is registered.
   *
   * @param {string} sourceFormat Source format.
   * @returns {boolean} Whether a normalizer exists.
   */
  has(sourceFormat) {
    const normalizedSourceFormat = normalizeOptionalString(sourceFormat);

    return Boolean(
      normalizedSourceFormat &&
        Object.hasOwn(this.normalizers, normalizedSourceFormat),
    );
  }

  /**
   * Lists registered source formats.
   *
   * @returns {string[]} Source formats.
   */
  listFormats() {
    return Object.keys(this.normalizers);
  }

  /**
   * Parses and normalizes an intake request.
   *
   * @param {object} request Intake request.
   * @returns {object[]} Canonical payloads.
   */
  normalize(request) {
    const normalizedRequest = assertOptions(request, 'Intake request');
    const normalizer = this.get(normalizedRequest.sourceFormat);
    const sourceFormat = normalizedRequest.sourceFormat;
    const records =
      sourceFormat === SOURCE_FORMATS.DTCC_FLAT_FILE
        ? normalizer.parse(
            normalizedRequest.rawContent,
            normalizedRequest.layout ?? {},
          )
        : normalizer.parse(normalizedRequest.rawContent);

    return records.map((record, recordIndex) =>
      normalizer.normalize(record, {
        ...normalizedRequest,
        recordIndex,
        bulk: normalizedRequest.bulk ?? records.length > 1,
      }),
    );
  }
}

export function createIntakeNormalizerRegistry(
  normalizers = INTAKE_NORMALIZERS,
) {
  return new IntakeNormalizerRegistry(normalizers);
}

export const intakeNormalizerRegistry =
  createIntakeNormalizerRegistry();
export const normalizeIntake = normalizeIntakeSubmission;
export const normalizeJsonIntake = normalizeQuilityJson;
export const normalizeXmlIntake = normalizeEthosXml;
export const normalizeDtccIntake = normalizeDtccFlatFile;
export const normalizeTifMetadata = normalizeSureLcTifMetadata;
export const normalizeManualForm = normalizeManualIntake;

export default INTAKE_NORMALIZERS;