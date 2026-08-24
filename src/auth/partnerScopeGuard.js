import { canAccessRecord as policyCanAccessRecord } from './permissionPolicy.js';

export const PARTNER_SCOPE_GUARD_ERROR_CODES = Object.freeze({
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  SCOPE_REQUIRED: 'PARTNER_SCOPE_REQUIRED',
  SCOPE_VIOLATION: 'PARTNER_SCOPE_VIOLATION',
  INVALID_COLLECTION: 'PARTNER_SCOPE_INVALID_COLLECTION',
  INVALID_PAYLOAD: 'PARTNER_SCOPE_INVALID_PAYLOAD',
  INVALID_FIELD_FILTER: 'PARTNER_SCOPE_INVALID_FIELD_FILTER',
});

const PARTNER_IDENTIFIER_FIELDS = Object.freeze([
  'partnerCode',
  'partnerId',
  'organizationCode',
  'organizationId',
  'organization',
  'gaCode',
]);

const RECORD_IDENTIFIER_FIELDS = Object.freeze([
  'applicationId',
  'trackingId',
  'workItemId',
  'sourceRecordId',
  'changeRequestId',
  'notificationId',
  'syncAttemptId',
  'assignmentId',
  'intakeId',
  'draftId',
  'checkId',
]);

const DEFAULT_COLLECTION_FIELDS = Object.freeze([
  'data',
  'records',
  'items',
  'applications',
  'onboardingRecords',
  'workItems',
  'assignments',
  'events',
  'lifecycleEvents',
  'notifications',
  'notificationLogs',
  'syncAttempts',
  'contractChanges',
  'changeRequests',
  'drafts',
  'results',
]);

const DEFAULT_SINGULAR_RECORD_FIELDS = Object.freeze([
  'record',
  'item',
  'application',
  'onboardingRecord',
  'workItem',
  'assignment',
  'event',
  'lifecycleEvent',
  'notification',
  'syncAttempt',
  'contractChange',
  'changeRequest',
  'draft',
  'result',
]);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertOptions(options, description = 'Partner scope options') {
  if (!isObject(options)) {
    throw new TypeError(`${description} must be an object.`);
  }

  return options;
}

function normalizeIdentifier(value, description = 'Identifier') {
  if (
    value === null ||
    value === undefined ||
    String(value).trim() === ''
  ) {
    throw new TypeError(`${description} must be a non-empty value.`);
  }

  return String(value).trim();
}

function normalizeIdentifierForLookup(value, description = 'Identifier') {
  return normalizeIdentifier(value, description)
    .normalize('NFKC')
    .toLowerCase();
}

function normalizeFieldNames(fields, description) {
  if (!Array.isArray(fields)) {
    throw new TypeError(`${description} must be an array.`);
  }

  return Object.freeze(
    [
      ...new Set(
        fields.map((field) =>
          normalizeIdentifier(field, `${description} entry`),
        ),
      ),
    ],
  );
}

function cloneValue(value, visited = new WeakMap()) {
  if (value === null || typeof value !== 'object') {
    return value;
  }

  if (value instanceof Date) {
    return new Date(value.getTime());
  }

  if (visited.has(value)) {
    return visited.get(value);
  }

  if (Array.isArray(value)) {
    const clone = [];

    visited.set(value, clone);
    value.forEach((item) => {
      clone.push(cloneValue(item, visited));
    });

    return clone;
  }

  const clone = {};

  visited.set(value, clone);

  Object.entries(value).forEach(([key, nestedValue]) => {
    clone[key] = cloneValue(nestedValue, visited);
  });

  return clone;
}

function createScopeGuardError(code, message, details, cause) {
  const error = new Error(message, {
    ...(cause === undefined ? {} : { cause }),
  });

  error.name = 'PartnerScopeGuardError';
  error.code = code;
  error.details = details ?? null;
  error.recoverable = true;

  return error;
}

function getPrincipalUser(principal) {
  if (!isObject(principal)) {
    return null;
  }

  if (isObject(principal.user)) {
    return principal.user;
  }

  if (isObject(principal.currentUser)) {
    return principal.currentUser;
  }

  return principal;
}

function normalizePartnerContext(context) {
  if (!isObject(context)) {
    return context ?? null;
  }

  return {
    ...context,
    partnerCode: context.partnerCode ?? context.partnerId,
    organizationId:
      context.organizationId ?? context.organizationCode,
  };
}

function normalizePrincipal(principal, partnerContext) {
  if (typeof principal === 'string') {
    return principal;
  }

  if (!isObject(principal)) {
    return principal;
  }

  const user = getPrincipalUser(principal);
  const context = normalizePartnerContext(
    partnerContext ??
      principal.partnerContext ??
      user?.partnerContext ??
      null,
  );

  return {
    ...principal,
    ...(isObject(user)
      ? {
          user: {
            ...user,
            partnerCode: user.partnerCode ?? user.partnerId,
            organizationId:
              user.organizationId ?? user.organizationCode,
          },
        }
      : {}),
    partnerContext: context,
  };
}

function isAuthenticatedPrincipal(principal) {
  if (typeof principal === 'string') {
    return principal.trim() !== '';
  }

  if (!isObject(principal)) {
    return false;
  }

  if (
    Object.hasOwn(principal, 'isAuthenticated') ||
    Object.hasOwn(principal, 'status')
  ) {
    return (
      principal.isAuthenticated === true ||
      principal.status === 'authenticated'
    );
  }

  const user = getPrincipalUser(principal);
  const role = principal.role ?? user?.role;

  return typeof role === 'string' && role.trim() !== '';
}

function hasMeaningfulField(record, fields) {
  return fields.some((field) => {
    const value = record[field];

    return (
      value !== null &&
      value !== undefined &&
      String(value).trim() !== ''
    );
  });
}

function isScopedRecordCandidate(value) {
  if (!isObject(value)) {
    return false;
  }

  if (hasMeaningfulField(value, PARTNER_IDENTIFIER_FIELDS)) {
    return true;
  }

  if (hasMeaningfulField(value, RECORD_IDENTIFIER_FIELDS)) {
    return true;
  }

  return (
    isObject(value.assignment) &&
    (value.assignment.assigneeUserId !== undefined ||
      value.assignment.team !== undefined ||
      value.assignment.assignedGroup !== undefined)
  );
}

function splitFieldPath(fieldPath) {
  return fieldPath
    .split('.')
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function setValueAtPath(target, path, value) {
  let current = target;

  path.forEach((segment, index) => {
    if (index === path.length - 1) {
      current[segment] = cloneValue(value);
      return;
    }

    if (!isObject(current[segment])) {
      current[segment] = {};
    }

    current = current[segment];
  });
}

function pickFields(payload, allowedFields) {
  if (!isObject(payload)) {
    return cloneValue(payload);
  }

  const filteredPayload = {};

  allowedFields.forEach((fieldPath) => {
    const path = splitFieldPath(fieldPath);

    if (path.length === 0) {
      return;
    }

    let value = payload;

    for (const segment of path) {
      if (!isObject(value) || !Object.hasOwn(value, segment)) {
        return;
      }

      value = value[segment];
    }

    setValueAtPath(filteredPayload, path, value);
  });

  return filteredPayload;
}

function omitFields(payload, excludedFields) {
  const excludedPaths = excludedFields.map(splitFieldPath);

  const visit = (value, path, visited) => {
    if (value === null || typeof value !== 'object') {
      return value;
    }

    if (visited.has(value)) {
      return visited.get(value);
    }

    if (Array.isArray(value)) {
      const clone = [];

      visited.set(value, clone);
      value.forEach((item, index) => {
        clone.push(visit(item, [...path, String(index)], visited));
      });

      return clone;
    }

    const clone = {};

    visited.set(value, clone);

    Object.entries(value).forEach(([key, nestedValue]) => {
      const nextPath = [...path, key];
      const excluded = excludedPaths.some(
        (excludedPath) =>
          excludedPath.length === nextPath.length &&
          excludedPath.every(
            (segment, index) => segment === nextPath[index],
          ),
      );

      if (!excluded) {
        clone[key] = visit(nestedValue, nextPath, visited);
      }
    });

    return clone;
  };

  return visit(payload, [], new WeakMap());
}

/**
 * Enforces record-level partner and assignment scope for collections and
 * response payloads.
 */
export class PartnerScopeGuard {
  /**
   * @param {{
   *   principal?: string | object,
   *   partnerContext?: object,
   *   collectionFields?: string[],
   *   singularRecordFields?: string[]
   * }} [options] Scope guard options.
   */
  constructor(options = {}) {
    const normalizedOptions = assertOptions(options);

    this.principal = normalizedOptions.principal ?? null;
    this.partnerContext =
      normalizedOptions.partnerContext ?? null;
    this.collectionFields = normalizeFieldNames(
      normalizedOptions.collectionFields ?? DEFAULT_COLLECTION_FIELDS,
      'Partner scope collection fields',
    );
    this.singularRecordFields = normalizeFieldNames(
      normalizedOptions.singularRecordFields ??
        DEFAULT_SINGULAR_RECORD_FIELDS,
      'Partner scope singular record fields',
    );
  }

  /**
   * Returns whether a record is accessible to a principal.
   *
   * @param {object} record Record to evaluate.
   * @param {string | object} [principal] Authenticated principal.
   * @param {object} [partnerContext] Partner context override.
   * @returns {boolean} Whether the record is in scope.
   */
  canAccessRecord(
    record,
    principal = this.principal,
    partnerContext = this.partnerContext,
  ) {
    if (!isObject(record)) {
      return false;
    }

    const normalizedPrincipal = normalizePrincipal(
      principal,
      partnerContext,
    );

    if (!isAuthenticatedPrincipal(normalizedPrincipal)) {
      return false;
    }

    try {
      return policyCanAccessRecord(normalizedPrincipal, record);
    } catch {
      return false;
    }
  }

  /**
   * Alias for canAccessRecord.
   *
   * @param {object} record Record to evaluate.
   * @param {string | object} [principal] Authenticated principal.
   * @param {object} [partnerContext] Partner context override.
   * @returns {boolean} Whether the record is in scope.
   */
  isRecordInScope(
    record,
    principal = this.principal,
    partnerContext = this.partnerContext,
  ) {
    return this.canAccessRecord(record, principal, partnerContext);
  }

  /**
   * Throws when a record is outside the principal's scope.
   *
   * @param {object} record Record to evaluate.
   * @param {string | object} [principal] Authenticated principal.
   * @param {object} [partnerContext] Partner context override.
   * @returns {object} A defensive copy of the authorized record.
   */
  assertRecordAccess(
    record,
    principal = this.principal,
    partnerContext = this.partnerContext,
  ) {
    const normalizedPrincipal = normalizePrincipal(
      principal,
      partnerContext,
    );

    if (!isAuthenticatedPrincipal(normalizedPrincipal)) {
      throw createScopeGuardError(
        PARTNER_SCOPE_GUARD_ERROR_CODES.UNAUTHENTICATED,
        'An authenticated principal is required.',
        null,
      );
    }

    if (!this.canAccessRecord(record, normalizedPrincipal)) {
      throw createScopeGuardError(
        PARTNER_SCOPE_GUARD_ERROR_CODES.SCOPE_VIOLATION,
        'The requested record is outside the current partner scope.',
        {
          recordIdentifiers: Object.fromEntries(
            [...PARTNER_IDENTIFIER_FIELDS, ...RECORD_IDENTIFIER_FIELDS]
              .filter((field) => record?.[field] !== undefined)
              .map((field) => [field, String(record[field])]),
          ),
        },
      );
    }

    return cloneValue(record);
  }

  /**
   * Alias for assertRecordAccess.
   *
   * @param {object} record Record to evaluate.
   * @param {string | object} [principal] Authenticated principal.
   * @param {object} [partnerContext] Partner context override.
   * @returns {object} Authorized record.
   */
  requireRecordAccess(
    record,
    principal = this.principal,
    partnerContext = this.partnerContext,
  ) {
    return this.assertRecordAccess(
      record,
      principal,
      partnerContext,
    );
  }

  /**
   * Filters records to the principal's current partner and assignment scope.
   *
   * @param {object[]} records Records to filter.
   * @param {string | object} [principal] Authenticated principal.
   * @param {object} [partnerContext] Partner context override.
   * @returns {object[]} Defensive copies of accessible records.
   */
  filterRecords(
    records,
    principal = this.principal,
    partnerContext = this.partnerContext,
  ) {
    if (!Array.isArray(records)) {
      throw createScopeGuardError(
        PARTNER_SCOPE_GUARD_ERROR_CODES.INVALID_COLLECTION,
        'Partner-scoped records must be an array.',
        null,
      );
    }

    const normalizedPrincipal = normalizePrincipal(
      principal,
      partnerContext,
    );

    if (!isAuthenticatedPrincipal(normalizedPrincipal)) {
      return [];
    }

    return records
      .filter(
        (record) =>
          isObject(record) &&
          this.canAccessRecord(record, normalizedPrincipal),
      )
      .map((record) => cloneValue(record));
  }

  /**
   * Alias for filterRecords.
   *
   * @param {object[]} records Records to filter.
   * @param {string | object} [principal] Authenticated principal.
   * @param {object} [partnerContext] Partner context override.
   * @returns {object[]} Accessible records.
   */
  filterCollection(
    records,
    principal = this.principal,
    partnerContext = this.partnerContext,
  ) {
    return this.filterRecords(records, principal, partnerContext);
  }

  /**
   * Determines whether a requested partner identifier is accessible.
   *
   * @param {string | number} partnerIdentifier Requested partner identifier.
   * @param {string | object} [principal] Authenticated principal.
   * @param {object} [partnerContext] Partner context override.
   * @returns {boolean} Whether the partner scope is accessible.
   */
  canAccessPartner(
    partnerIdentifier,
    principal = this.principal,
    partnerContext = this.partnerContext,
  ) {
    let identifier;

    try {
      identifier = normalizeIdentifier(
        partnerIdentifier,
        'Partner identifier',
      );
    } catch {
      return false;
    }

    return this.canAccessRecord(
      {
        partnerCode: identifier,
        partnerId: identifier,
        organizationId: identifier,
      },
      principal,
      partnerContext,
    );
  }

  /**
   * Throws when a requested partner identifier is outside session scope.
   *
   * @param {string | number} partnerIdentifier Requested partner identifier.
   * @param {string | object} [principal] Authenticated principal.
   * @param {object} [partnerContext] Partner context override.
   * @returns {string} Normalized authorized partner identifier.
   */
  assertPartnerAccess(
    partnerIdentifier,
    principal = this.principal,
    partnerContext = this.partnerContext,
  ) {
    const identifier = normalizeIdentifier(
      partnerIdentifier,
      'Partner identifier',
    );
    const normalizedPrincipal = normalizePrincipal(
      principal,
      partnerContext,
    );

    if (!isAuthenticatedPrincipal(normalizedPrincipal)) {
      throw createScopeGuardError(
        PARTNER_SCOPE_GUARD_ERROR_CODES.UNAUTHENTICATED,
        'An authenticated principal is required.',
        null,
      );
    }

    if (
      !this.canAccessPartner(
        identifier,
        normalizedPrincipal,
        partnerContext,
      )
    ) {
      throw createScopeGuardError(
        PARTNER_SCOPE_GUARD_ERROR_CODES.SCOPE_VIOLATION,
        'The requested partner is outside the current partner scope.',
        {
          requestedPartnerIdentifier: identifier,
        },
      );
    }

    return identifier;
  }

  /**
   * Recursively filters scoped records from an API-style payload.
   *
   * Inaccessible root records return null. Inaccessible nested records are
   * removed from arrays and omitted from objects.
   *
   * @param {unknown} payload Payload to filter.
   * @param {string | object} [principal] Authenticated principal.
   * @param {{
   *   partnerContext?: object,
   *   collectionFields?: string[],
   *   singularRecordFields?: string[],
   *   recordFields?: string[],
   *   allowedFields?: string[],
   *   excludedFields?: string[]
   * }} [options] Payload filtering options.
   * @returns {unknown} Scoped payload.
   */
  filterPayload(
    payload,
    principal = this.principal,
    options = {},
  ) {
    const normalizedOptions = assertOptions(
      options,
      'Partner scope payload options',
    );
    const normalizedPrincipal = normalizePrincipal(
      principal,
      normalizedOptions.partnerContext ?? this.partnerContext,
    );

    if (!isAuthenticatedPrincipal(normalizedPrincipal)) {
      return Array.isArray(payload) ? [] : null;
    }

    const collectionFields = new Set(
      normalizeFieldNames(
        normalizedOptions.collectionFields ??
          this.collectionFields,
        'Partner scope collection fields',
      ),
    );
    const singularRecordFields = new Set(
      normalizeFieldNames(
        normalizedOptions.singularRecordFields ??
          this.singularRecordFields,
        'Partner scope singular record fields',
      ),
    );
    const recordFields =
      normalizedOptions.recordFields === undefined
        ? undefined
        : normalizeFieldNames(
            normalizedOptions.recordFields,
            'Partner scope record fields',
          );
    const visited = new WeakMap();

    const visit = (value, isRoot = false, forceRecord = false) => {
      if (value === null || typeof value !== 'object') {
        return value;
      }

      if (visited.has(value)) {
        return visited.get(value);
      }

      if (Array.isArray(value)) {
        const filteredArray = [];

        visited.set(value, filteredArray);

        value.forEach((item) => {
          if (isObject(item) && isScopedRecordCandidate(item)) {
            if (!this.canAccessRecord(item, normalizedPrincipal)) {
              return;
            }

            const scopedItem = visit(item, false, true);

            if (scopedItem !== undefined) {
              filteredArray.push(scopedItem);
            }

            return;
          }

          const filteredItem = visit(item);

          if (filteredItem !== undefined) {
            filteredArray.push(filteredItem);
          }
        });

        return filteredArray;
      }

      const recordCandidate =
        forceRecord || isScopedRecordCandidate(value);

      if (
        recordCandidate &&
        !this.canAccessRecord(value, normalizedPrincipal)
      ) {
        return isRoot ? null : undefined;
      }

      const filteredObject = {};

      visited.set(value, filteredObject);

      Object.entries(value).forEach(([key, nestedValue]) => {
        if (collectionFields.has(key) && Array.isArray(nestedValue)) {
          filteredObject[key] = visit(nestedValue);

          if (
            (key === 'data' ||
              key === 'records' ||
              key === 'items' ||
              key === 'results') &&
            typeof value.total === 'number'
          ) {
            filteredObject.total = filteredObject[key].length;
          }

          return;
        }

        const filteredValue = visit(
          nestedValue,
          false,
          singularRecordFields.has(key),
        );

        if (filteredValue !== undefined) {
          filteredObject[key] = filteredValue;
        }
      });

      if (recordCandidate && recordFields !== undefined) {
        return pickFields(filteredObject, recordFields);
      }

      return filteredObject;
    };

    let filteredPayload = visit(payload, true);

    if (
      filteredPayload !== null &&
      normalizedOptions.allowedFields !== undefined
    ) {
      const allowedFields = normalizeFieldNames(
        normalizedOptions.allowedFields,
        'Allowed payload fields',
      );

      filteredPayload = Array.isArray(filteredPayload)
        ? filteredPayload.map((item) =>
            isObject(item) ? pickFields(item, allowedFields) : item,
          )
        : pickFields(filteredPayload, allowedFields);
    }

    if (
      filteredPayload !== null &&
      normalizedOptions.excludedFields !== undefined
    ) {
      const excludedFields = normalizeFieldNames(
        normalizedOptions.excludedFields,
        'Excluded payload fields',
      );

      filteredPayload = omitFields(filteredPayload, excludedFields);
    }

    return filteredPayload;
  }

  /**
   * Applies explicit allow-list and deny-list field projection.
   *
   * @param {unknown} payload Payload to project.
   * @param {{allowedFields?: string[], excludedFields?: string[]}} options
   * Field projection options.
   * @returns {unknown} Projected payload.
   */
  filterPayloadFields(payload, options) {
    const normalizedOptions = assertOptions(
      options,
      'Payload field filter options',
    );

    if (
      normalizedOptions.allowedFields === undefined &&
      normalizedOptions.excludedFields === undefined
    ) {
      throw createScopeGuardError(
        PARTNER_SCOPE_GUARD_ERROR_CODES.INVALID_FIELD_FILTER,
        'An allowedFields or excludedFields filter is required.',
        null,
      );
    }

    let filteredPayload = cloneValue(payload);

    if (normalizedOptions.allowedFields !== undefined) {
      const allowedFields = normalizeFieldNames(
        normalizedOptions.allowedFields,
        'Allowed payload fields',
      );

      filteredPayload = Array.isArray(filteredPayload)
        ? filteredPayload.map((item) =>
            isObject(item) ? pickFields(item, allowedFields) : item,
          )
        : pickFields(filteredPayload, allowedFields);
    }

    if (normalizedOptions.excludedFields !== undefined) {
      const excludedFields = normalizeFieldNames(
        normalizedOptions.excludedFields,
        'Excluded payload fields',
      );

      filteredPayload = omitFields(filteredPayload, excludedFields);
    }

    return filteredPayload;
  }
}

/**
 * Creates a partner scope guard.
 *
 * @param {ConstructorParameters<typeof PartnerScopeGuard>[0]} [options]
 * Scope guard options.
 * @returns {PartnerScopeGuard} Partner scope guard.
 */
export function createPartnerScopeGuard(options = {}) {
  return new PartnerScopeGuard(options);
}

/**
 * Filters records using a newly created partner scope guard.
 *
 * @param {object[]} records Records to filter.
 * @param {string | object} principal Authenticated principal.
 * @param {object} [partnerContext] Partner context override.
 * @returns {object[]} Accessible records.
 */
export function filterPartnerScopedRecords(
  records,
  principal,
  partnerContext,
) {
  return createPartnerScopeGuard().filterRecords(
    records,
    principal,
    partnerContext,
  );
}

/**
 * Determines whether a record is accessible to a principal.
 *
 * @param {object} record Record to evaluate.
 * @param {string | object} principal Authenticated principal.
 * @param {object} [partnerContext] Partner context override.
 * @returns {boolean} Whether the record is accessible.
 */
export function isPartnerRecordInScope(
  record,
  principal,
  partnerContext,
) {
  return createPartnerScopeGuard().canAccessRecord(
    record,
    principal,
    partnerContext,
  );
}

export const PartnerScopeService = PartnerScopeGuard;
export const filterRecordsByPartnerScope = filterPartnerScopedRecords;
export const canAccessPartnerRecord = isPartnerRecordInScope;

export default PartnerScopeGuard;