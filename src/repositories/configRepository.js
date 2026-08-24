import { z } from 'zod';
import { STORAGE_KEYS } from '../constants/storageKeys.js';
import { referenceConfigurationSchema } from '../contracts/schemas.js';
import { BrowserStorageAdapter } from '../persistence/browserStorageAdapter.js';
import { getSeeds } from '../persistence/seedLoader.js';
import { toIsoTimestamp } from '../utils/dates.js';

const identifierSchema = z.string().trim().min(1);
const nullableDateTimeSchema = z
  .string()
  .datetime({ offset: true })
  .nullable();

export const CONFIG_REPOSITORY_STORAGE_KEY =
  `${STORAGE_KEYS.REFERENCE_DATA}:configuration`;

export const DEFAULT_NOTIFICATION_PREFERENCE_SCOPE = 'global';

export const configRepositoryStateSchema = z
  .object({
    overrides: z.record(z.unknown()).default({}),
    generalAgencyOverrides: z
      .record(z.record(z.unknown()))
      .default({}),
    notificationPreferences: z
      .record(z.record(z.unknown()))
      .default({}),
    updatedAt: nullableDateTimeSchema.default(null),
  })
  .passthrough();

export const CONFIG_REPOSITORY_ERROR_CODES = Object.freeze({
  INVALID_CONFIGURATION: 'CONFIGURATION_INVALID',
  INVALID_OVERRIDE: 'CONFIGURATION_OVERRIDE_INVALID',
  GENERAL_AGENCY_NOT_FOUND: 'CONFIGURATION_GA_NOT_FOUND',
  GENERAL_AGENCY_IDENTIFIER_CHANGE:
    'CONFIGURATION_GA_IDENTIFIER_CHANGE',
  INVALID_NOTIFICATION_PREFERENCES:
    'CONFIGURATION_NOTIFICATION_PREFERENCES_INVALID',
  PERSISTENCE_FAILED: 'CONFIGURATION_PERSISTENCE_FAILED',
});

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isStorageLike(value) {
  return (
    isObject(value) &&
    typeof value.getItem === 'function' &&
    typeof value.setItem === 'function' &&
    typeof value.removeItem === 'function'
  );
}

function isRepositoryStorageAdapter(value) {
  return (
    isObject(value) &&
    typeof value.get === 'function' &&
    typeof value.set === 'function' &&
    typeof value.remove === 'function'
  );
}

function assertOptions(options, description = 'Configuration options') {
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

function normalizeIdentifierForLookup(
  value,
  description = 'Identifier',
) {
  return normalizeIdentifier(value, description)
    .normalize('NFKC')
    .toLowerCase();
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

function deepMerge(baseValue, overlayValue) {
  if (!isObject(baseValue) || !isObject(overlayValue)) {
    return cloneValue(overlayValue);
  }

  const mergedValue = {
    ...cloneValue(baseValue),
  };

  Object.entries(overlayValue).forEach(([key, value]) => {
    if (value === undefined) {
      return;
    }

    if (isObject(value) && isObject(mergedValue[key])) {
      mergedValue[key] = deepMerge(mergedValue[key], value);
      return;
    }

    mergedValue[key] = cloneValue(value);
  });

  return mergedValue;
}

function formatValidationIssues(error) {
  return error.issues
    .map((issue) => {
      const path =
        issue.path.length > 0 ? issue.path.join('.') : 'configuration';

      return `${path}: ${issue.message}`;
    })
    .join('; ');
}

function createRepositoryError(code, message, details, cause) {
  const error = new Error(message, {
    ...(cause === undefined ? {} : { cause }),
  });

  error.name = 'ConfigRepositoryError';
  error.code = code;
  error.details = details ?? null;

  return error;
}

function parseConfiguration(configuration) {
  const result = referenceConfigurationSchema.safeParse(configuration);

  if (!result.success) {
    throw createRepositoryError(
      CONFIG_REPOSITORY_ERROR_CODES.INVALID_CONFIGURATION,
      `Invalid reference configuration: ${formatValidationIssues(
        result.error,
      )}`,
      { issues: result.error.issues },
      result.error,
    );
  }

  return result.data;
}

function validateSeedConfiguration(seedConfiguration) {
  if (!isObject(seedConfiguration)) {
    throw new TypeError(
      'Reference configuration seed data must be an object.',
    );
  }

  return parseConfiguration(seedConfiguration);
}

function createEmptyState() {
  return {
    overrides: {},
    generalAgencyOverrides: {},
    notificationPreferences: {},
    updatedAt: null,
  };
}

function findGeneralAgencyInCollection(generalAgencies, identifier) {
  const normalizedIdentifier = normalizeIdentifierForLookup(
    identifier,
    'General agency identifier',
  );

  return generalAgencies.find(
    (generalAgency) =>
      normalizeIdentifierForLookup(
        generalAgency.code,
        'General agency code',
      ) === normalizedIdentifier ||
      normalizeIdentifierForLookup(
        generalAgency.id,
        'General agency identifier',
      ) === normalizedIdentifier,
  );
}

function findGeneralAgencyOverrideEntry(overrides, generalAgency) {
  const normalizedCode = normalizeIdentifierForLookup(
    generalAgency.code,
    'General agency code',
  );

  return Object.entries(overrides).find(
    ([code]) =>
      normalizeIdentifierForLookup(code, 'General agency code') ===
      normalizedCode,
  );
}

function applyGeneralAgencyOverrides(configuration, overrides) {
  return {
    ...configuration,
    generalAgencies: configuration.generalAgencies.map((generalAgency) => {
      const overrideEntry = findGeneralAgencyOverrideEntry(
        overrides,
        generalAgency,
      );

      if (!overrideEntry) {
        return generalAgency;
      }

      return deepMerge(generalAgency, overrideEntry[1]);
    }),
  };
}

function buildConfiguration(seedConfiguration, state) {
  const overriddenConfiguration = deepMerge(
    seedConfiguration,
    state.overrides,
  );
  const configurationWithGaOverrides = applyGeneralAgencyOverrides(
    overriddenConfiguration,
    state.generalAgencyOverrides,
  );

  return parseConfiguration(configurationWithGaOverrides);
}

function assertGeneralAgencyCanonicalFields(
  generalAgency,
  override,
) {
  if (
    override.id !== undefined &&
    override.id !== generalAgency.id
  ) {
    throw createRepositoryError(
      CONFIG_REPOSITORY_ERROR_CODES
        .GENERAL_AGENCY_IDENTIFIER_CHANGE,
      'The general agency identifier cannot be changed.',
      {
        field: 'id',
        currentValue: generalAgency.id,
        requestedValue: override.id,
      },
    );
  }

  if (
    override.code !== undefined &&
    normalizeIdentifierForLookup(
      override.code,
      'General agency code',
    ) !==
      normalizeIdentifierForLookup(
        generalAgency.code,
        'General agency code',
      )
  ) {
    throw createRepositoryError(
      CONFIG_REPOSITORY_ERROR_CODES
        .GENERAL_AGENCY_IDENTIFIER_CHANGE,
      'The general agency code cannot be changed.',
      {
        field: 'code',
        currentValue: generalAgency.code,
        requestedValue: override.code,
      },
    );
  }
}

function normalizePreferenceScope(scope) {
  if (scope === undefined || scope === null) {
    return DEFAULT_NOTIFICATION_PREFERENCE_SCOPE;
  }

  if (typeof scope === 'string' || typeof scope === 'number') {
    return normalizeIdentifier(scope, 'Notification preference scope');
  }

  if (!isObject(scope)) {
    throw new TypeError(
      'Notification preference scope must be an identifier or object.',
    );
  }

  const scopeType =
    scope.scopeType ??
    (scope.userId !== undefined
      ? 'user'
      : scope.partnerCode !== undefined
        ? 'partner'
        : scope.gaCode !== undefined
          ? 'general-agency'
          : scope.organizationId !== undefined
            ? 'organization'
            : undefined);
  const scopeIdentifier =
    scope.scopeId ??
    scope.userId ??
    scope.partnerCode ??
    scope.gaCode ??
    scope.organizationId;

  if (scopeType === undefined || scopeIdentifier === undefined) {
    throw new TypeError(
      'Notification preference scope objects require a type and identifier.',
    );
  }

  return `${normalizeIdentifier(
    scopeType,
    'Notification preference scope type',
  )}:${normalizeIdentifier(
    scopeIdentifier,
    'Notification preference scope identifier',
  )}`;
}

function findPreferenceEntry(preferences, scopeKey) {
  const normalizedScopeKey = normalizeIdentifierForLookup(
    scopeKey,
    'Notification preference scope',
  );

  return Object.entries(preferences).find(
    ([storedScopeKey]) =>
      normalizeIdentifierForLookup(
        storedScopeKey,
        'Notification preference scope',
      ) === normalizedScopeKey,
  );
}

function assertNotificationPreferences(preferences) {
  if (!isObject(preferences)) {
    throw createRepositoryError(
      CONFIG_REPOSITORY_ERROR_CODES
        .INVALID_NOTIFICATION_PREFERENCES,
      'Notification preferences must be an object.',
      null,
    );
  }

  const validateValue = (value, path, ancestors) => {
    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value))
    ) {
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        validateValue(item, [...path, index], ancestors);
      });
      return;
    }

    if (!isObject(value)) {
      throw createRepositoryError(
        CONFIG_REPOSITORY_ERROR_CODES
          .INVALID_NOTIFICATION_PREFERENCES,
        'Notification preferences contain an unsupported value.',
        { path },
      );
    }

    if (ancestors.has(value)) {
      throw createRepositoryError(
        CONFIG_REPOSITORY_ERROR_CODES
          .INVALID_NOTIFICATION_PREFERENCES,
        'Notification preferences cannot contain circular references.',
        { path },
      );
    }

    ancestors.add(value);

    Object.entries(value).forEach(([key, nestedValue]) => {
      validateValue(nestedValue, [...path, key], ancestors);
    });

    ancestors.delete(value);
  };

  validateValue(preferences, [], new WeakSet());
  return preferences;
}

function resolveStorageAdapter(options) {
  if (options.storageAdapter !== undefined) {
    if (!isRepositoryStorageAdapter(options.storageAdapter)) {
      throw new TypeError(
        'The configuration storage adapter must provide get, set, and remove methods.',
      );
    }

    return options.storageAdapter;
  }

  if (options.storage !== undefined && !isStorageLike(options.storage)) {
    throw new TypeError(
      'The supplied configuration storage implementation is invalid.',
    );
  }

  return new BrowserStorageAdapter({
    ...(options.storage === undefined ? {} : { storage: options.storage }),
    ...(options.namespace === undefined
      ? {}
      : { namespace: options.namespace }),
    ...(options.schemaVersion === undefined
      ? {}
      : { schemaVersion: options.schemaVersion }),
    ...(options.clock === undefined ? {} : { clock: options.clock }),
    ...(options.onStorageError === undefined
      ? {}
      : { onError: options.onStorageError }),
  });
}

/**
 * Merges seeded reference configuration with persisted administrative
 * overrides and scoped notification preferences.
 */
export class ConfigRepository {
  /**
   * @param {{
   *   seedConfiguration?: object,
   *   storageAdapter?: object,
   *   storage?: Storage,
   *   storageKey?: string,
   *   namespace?: string,
   *   schemaVersion?: number,
   *   clock?: () => Date | string | number,
   *   onStorageError?: (error: object) => void
   * }} [options] Repository options.
   */
  constructor(options = {}) {
    const normalizedOptions = assertOptions(options);

    if (
      normalizedOptions.clock !== undefined &&
      typeof normalizedOptions.clock !== 'function'
    ) {
      throw new TypeError(
        'The configuration repository clock must be a function.',
      );
    }

    this.seedConfiguration = validateSeedConfiguration(
      normalizedOptions.seedConfiguration ?? getSeeds().referenceConfig,
    );
    this.clock = normalizedOptions.clock ?? (() => new Date());
    this.storageAdapter = resolveStorageAdapter(normalizedOptions);
    this.storageKey = normalizeIdentifier(
      normalizedOptions.storageKey ??
        CONFIG_REPOSITORY_STORAGE_KEY,
      'Configuration repository storage key',
    );
  }

  /**
   * Returns the effective reference configuration.
   *
   * @returns {object} Effective reference configuration.
   */
  getReferenceConfiguration() {
    try {
      return cloneValue(
        buildConfiguration(this.seedConfiguration, this.readState()),
      );
    } catch {
      this.storageAdapter.remove(this.storageKey);
      return cloneValue(this.seedConfiguration);
    }
  }

  /**
   * Alias for getReferenceConfiguration.
   *
   * @returns {object} Effective reference configuration.
   */
  getConfiguration() {
    return this.getReferenceConfiguration();
  }

  /**
   * Alias for getReferenceConfiguration.
   *
   * @returns {object} Effective reference configuration.
   */
  get() {
    return this.getReferenceConfiguration();
  }

  /**
   * Returns the pristine seeded configuration.
   *
   * @returns {object} Seed reference configuration.
   */
  getSeedConfiguration() {
    return cloneValue(this.seedConfiguration);
  }

  /**
   * Returns persisted administrative overrides.
   *
   * @returns {object} Administrative overrides.
   */
  getAdministrativeOverrides() {
    return cloneValue(this.readState().overrides);
  }

  /**
   * Merges administrative overrides into the effective configuration.
   *
   * @param {object} overrides Configuration overrides.
   * @returns {object} Effective reference configuration.
   */
  updateReferenceConfiguration(overrides) {
    if (!isObject(overrides)) {
      throw createRepositoryError(
        CONFIG_REPOSITORY_ERROR_CODES.INVALID_OVERRIDE,
        'Reference configuration overrides must be an object.',
        null,
      );
    }

    const state = this.readState();
    const nextState = {
      ...state,
      overrides: deepMerge(state.overrides, overrides),
      updatedAt: toIsoTimestamp(this.clock()),
    };

    buildConfiguration(this.seedConfiguration, nextState);
    this.persistState(nextState);

    return cloneValue(
      buildConfiguration(this.seedConfiguration, nextState),
    );
  }

  /**
   * Alias for updateReferenceConfiguration.
   *
   * @param {object} overrides Configuration overrides.
   * @returns {object} Effective reference configuration.
   */
  updateConfiguration(overrides) {
    return this.updateReferenceConfiguration(overrides);
  }

  /**
   * Alias for updateReferenceConfiguration.
   *
   * @param {object} overrides Configuration overrides.
   * @returns {object} Effective reference configuration.
   */
  update(overrides) {
    return this.updateReferenceConfiguration(overrides);
  }

  /**
   * Replaces all administrative overrides.
   *
   * @param {object} overrides Configuration overrides.
   * @returns {object} Effective reference configuration.
   */
  replaceAdministrativeOverrides(overrides) {
    if (!isObject(overrides)) {
      throw createRepositoryError(
        CONFIG_REPOSITORY_ERROR_CODES.INVALID_OVERRIDE,
        'Reference configuration overrides must be an object.',
        null,
      );
    }

    const state = this.readState();
    const nextState = {
      ...state,
      overrides: cloneValue(overrides),
      updatedAt: toIsoTimestamp(this.clock()),
    };

    buildConfiguration(this.seedConfiguration, nextState);
    this.persistState(nextState);

    return cloneValue(
      buildConfiguration(this.seedConfiguration, nextState),
    );
  }

  /**
   * Saves a complete effective reference configuration as an override.
   *
   * @param {object} configuration Complete reference configuration.
   * @returns {object} Persisted reference configuration.
   */
  saveReferenceConfiguration(configuration) {
    const parsedConfiguration = parseConfiguration(configuration);
    const state = this.readState();
    const nextState = {
      ...state,
      overrides: cloneValue(parsedConfiguration),
      updatedAt: toIsoTimestamp(this.clock()),
    };

    buildConfiguration(this.seedConfiguration, nextState);
    this.persistState(nextState);

    return cloneValue(
      buildConfiguration(this.seedConfiguration, nextState),
    );
  }

  /**
   * Alias for saveReferenceConfiguration.
   *
   * @param {object} configuration Complete reference configuration.
   * @returns {object} Persisted reference configuration.
   */
  save(configuration) {
    return this.saveReferenceConfiguration(configuration);
  }

  /**
   * Removes all general administrative overrides.
   *
   * @returns {object} Effective reference configuration.
   */
  clearAdministrativeOverrides() {
    const state = this.readState();
    const nextState = {
      ...state,
      overrides: {},
      updatedAt: toIsoTimestamp(this.clock()),
    };

    this.persistState(nextState);
    return cloneValue(
      buildConfiguration(this.seedConfiguration, nextState),
    );
  }

  /**
   * Lists effective general agency settings.
   *
   * @param {{status?: string, type?: string}} [query] GA filters.
   * @returns {object[]} Matching general agencies.
   */
  listGeneralAgencies(query = {}) {
    const normalizedQuery = assertOptions(
      query,
      'General agency query',
    );

    return this.getReferenceConfiguration()
      .generalAgencies.filter((generalAgency) => {
        if (
          normalizedQuery.status !== undefined &&
          generalAgency.status !== normalizedQuery.status
        ) {
          return false;
        }

        if (
          normalizedQuery.type !== undefined &&
          generalAgency.type !== normalizedQuery.type
        ) {
          return false;
        }

        return true;
      })
      .map((generalAgency) => cloneValue(generalAgency));
  }

  /**
   * Alias for listGeneralAgencies.
   *
   * @param {object} [query] GA filters.
   * @returns {object[]} Matching general agencies.
   */
  getGeneralAgencies(query = {}) {
    return this.listGeneralAgencies(query);
  }

  /**
   * Finds effective GA settings by code or identifier.
   *
   * @param {string | number} identifier GA code or identifier.
   * @returns {object | undefined} Matching general agency.
   */
  findGeneralAgency(identifier) {
    const generalAgency = findGeneralAgencyInCollection(
      this.getReferenceConfiguration().generalAgencies,
      identifier,
    );

    return generalAgency ? cloneValue(generalAgency) : undefined;
  }

  /**
   * Alias for findGeneralAgency.
   *
   * @param {string | number} identifier GA code or identifier.
   * @returns {object | undefined} Matching general agency.
   */
  findGeneralAgencyByCode(identifier) {
    return this.findGeneralAgency(identifier);
  }

  /**
   * Returns effective GA settings or throws when absent.
   *
   * @param {string | number} identifier GA code or identifier.
   * @returns {object} Matching general agency.
   */
  getGeneralAgencySettings(identifier) {
    const generalAgency = this.findGeneralAgency(identifier);

    if (!generalAgency) {
      throw createRepositoryError(
        CONFIG_REPOSITORY_ERROR_CODES.GENERAL_AGENCY_NOT_FOUND,
        `General agency configuration not found: ${identifier}`,
        { identifier: String(identifier) },
      );
    }

    return generalAgency;
  }

  /**
   * Alias for getGeneralAgencySettings.
   *
   * @param {string | number} identifier GA code or identifier.
   * @returns {object} Matching general agency.
   */
  getGeneralAgency(identifier) {
    return this.getGeneralAgencySettings(identifier);
  }

  /**
   * Merges a persisted administrative override into a GA configuration.
   *
   * @param {string | number} identifier GA code or identifier.
   * @param {object} override GA override.
   * @returns {object} Updated effective GA settings.
   */
  setGeneralAgencyOverride(identifier, override) {
    if (!isObject(override)) {
      throw createRepositoryError(
        CONFIG_REPOSITORY_ERROR_CODES.INVALID_OVERRIDE,
        'General agency overrides must be an object.',
        { identifier: String(identifier) },
      );
    }

    const state = this.readState();
    const baseConfiguration = buildConfiguration(
      this.seedConfiguration,
      {
        ...state,
        generalAgencyOverrides: {},
      },
    );
    const generalAgency = findGeneralAgencyInCollection(
      baseConfiguration.generalAgencies,
      identifier,
    );

    if (!generalAgency) {
      throw createRepositoryError(
        CONFIG_REPOSITORY_ERROR_CODES.GENERAL_AGENCY_NOT_FOUND,
        `General agency configuration not found: ${identifier}`,
        { identifier: String(identifier) },
      );
    }

    assertGeneralAgencyCanonicalFields(generalAgency, override);

    const existingEntry = findGeneralAgencyOverrideEntry(
      state.generalAgencyOverrides,
      generalAgency,
    );
    const existingOverride = existingEntry?.[1] ?? {};
    const nextState = {
      ...state,
      generalAgencyOverrides: {
        ...state.generalAgencyOverrides,
        [generalAgency.code]: deepMerge(existingOverride, override),
      },
      updatedAt: toIsoTimestamp(this.clock()),
    };

    if (
      existingEntry &&
      existingEntry[0] !== generalAgency.code
    ) {
      delete nextState.generalAgencyOverrides[existingEntry[0]];
    }

    const effectiveConfiguration = buildConfiguration(
      this.seedConfiguration,
      nextState,
    );

    this.persistState(nextState);

    return cloneValue(
      findGeneralAgencyInCollection(
        effectiveConfiguration.generalAgencies,
        generalAgency.code,
      ),
    );
  }

  /**
   * Alias for setGeneralAgencyOverride.
   *
   * @param {string | number} identifier GA code or identifier.
   * @param {object} override GA override.
   * @returns {object} Updated effective GA settings.
   */
  updateGeneralAgencySettings(identifier, override) {
    return this.setGeneralAgencyOverride(identifier, override);
  }

  /**
   * Returns the persisted override for a GA.
   *
   * @param {string | number} identifier GA code or identifier.
   * @returns {object | undefined} Persisted GA override.
   */
  getGeneralAgencyOverride(identifier) {
    const generalAgency = this.findGeneralAgency(identifier);

    if (!generalAgency) {
      return undefined;
    }

    const entry = findGeneralAgencyOverrideEntry(
      this.readState().generalAgencyOverrides,
      generalAgency,
    );

    return entry ? cloneValue(entry[1]) : undefined;
  }

  /**
   * Removes a GA-specific administrative override.
   *
   * @param {string | number} identifier GA code or identifier.
   * @returns {boolean} Whether an override was removed.
   */
  removeGeneralAgencyOverride(identifier) {
    const state = this.readState();
    const generalAgency = findGeneralAgencyInCollection(
      buildConfiguration(this.seedConfiguration, state).generalAgencies,
      identifier,
    );

    if (!generalAgency) {
      return false;
    }

    const entry = findGeneralAgencyOverrideEntry(
      state.generalAgencyOverrides,
      generalAgency,
    );

    if (!entry) {
      return false;
    }

    const nextState = cloneValue(state);

    delete nextState.generalAgencyOverrides[entry[0]];
    nextState.updatedAt = toIsoTimestamp(this.clock());

    buildConfiguration(this.seedConfiguration, nextState);
    this.persistState(nextState);

    return true;
  }

  /**
   * Returns effective default notification settings.
   *
   * @returns {object} Notification defaults.
   */
  getNotificationDefaults() {
    return cloneValue(
      this.getReferenceConfiguration().notificationDefaults,
    );
  }

  /**
   * Returns effective notification preferences for a scope.
   *
   * Defaults are merged with global preferences and then scoped preferences.
   *
   * @param {string | number | object} [scope] Preference scope.
   * @returns {object} Effective notification preferences.
   */
  getNotificationPreferences(
    scope = DEFAULT_NOTIFICATION_PREFERENCE_SCOPE,
  ) {
    const scopeKey = normalizePreferenceScope(scope);
    const state = this.readState();
    const defaults = this.getNotificationDefaults();
    const globalEntry = findPreferenceEntry(
      state.notificationPreferences,
      DEFAULT_NOTIFICATION_PREFERENCE_SCOPE,
    );
    const scopedEntry = findPreferenceEntry(
      state.notificationPreferences,
      scopeKey,
    );
    let preferences = defaults;

    if (globalEntry) {
      preferences = deepMerge(preferences, globalEntry[1]);
    }

    if (
      scopedEntry &&
      normalizeIdentifierForLookup(
        scopeKey,
        'Notification preference scope',
      ) !==
        normalizeIdentifierForLookup(
          DEFAULT_NOTIFICATION_PREFERENCE_SCOPE,
          'Notification preference scope',
        )
    ) {
      preferences = deepMerge(preferences, scopedEntry[1]);
    }

    return cloneValue(preferences);
  }

  /**
   * Returns only persisted notification preferences for a scope.
   *
   * @param {string | number | object} [scope] Preference scope.
   * @returns {object | undefined} Stored preference override.
   */
  getStoredNotificationPreferences(
    scope = DEFAULT_NOTIFICATION_PREFERENCE_SCOPE,
  ) {
    const scopeKey = normalizePreferenceScope(scope);
    const entry = findPreferenceEntry(
      this.readState().notificationPreferences,
      scopeKey,
    );

    return entry ? cloneValue(entry[1]) : undefined;
  }

  /**
   * Lists persisted notification preference overrides.
   *
   * @returns {Array<{scope: string, preferences: object}>} Preferences.
   */
  listNotificationPreferences() {
    return Object.entries(
      this.readState().notificationPreferences,
    ).map(([scope, preferences]) => ({
      scope,
      preferences: cloneValue(preferences),
    }));
  }

  /**
   * Merges notification preference overrides for a scope.
   *
   * @param {string | number | object} scope Preference scope.
   * @param {object} preferences Preference override.
   * @returns {object} Effective notification preferences.
   */
  setNotificationPreferences(scope, preferences) {
    const scopeKey = normalizePreferenceScope(scope);

    assertNotificationPreferences(preferences);

    const state = this.readState();
    const existingEntry = findPreferenceEntry(
      state.notificationPreferences,
      scopeKey,
    );
    const existingPreferences = existingEntry?.[1] ?? {};
    const nextState = {
      ...state,
      notificationPreferences: {
        ...state.notificationPreferences,
        [scopeKey]: deepMerge(existingPreferences, preferences),
      },
      updatedAt: toIsoTimestamp(this.clock()),
    };

    if (existingEntry && existingEntry[0] !== scopeKey) {
      delete nextState.notificationPreferences[existingEntry[0]];
    }

    this.persistState(nextState);
    return this.getNotificationPreferences(scopeKey);
  }

  /**
   * Alias for setNotificationPreferences.
   *
   * @param {string | number | object} scope Preference scope.
   * @param {object} preferences Preference override.
   * @returns {object} Effective notification preferences.
   */
  updateNotificationPreferences(scope, preferences) {
    return this.setNotificationPreferences(scope, preferences);
  }

  /**
   * Replaces stored notification preferences for a scope.
   *
   * @param {string | number | object} scope Preference scope.
   * @param {object} preferences Preference override.
   * @returns {object} Effective notification preferences.
   */
  replaceNotificationPreferences(scope, preferences) {
    const scopeKey = normalizePreferenceScope(scope);

    assertNotificationPreferences(preferences);

    const state = this.readState();
    const existingEntry = findPreferenceEntry(
      state.notificationPreferences,
      scopeKey,
    );
    const nextState = {
      ...state,
      notificationPreferences: {
        ...state.notificationPreferences,
        [scopeKey]: cloneValue(preferences),
      },
      updatedAt: toIsoTimestamp(this.clock()),
    };

    if (existingEntry && existingEntry[0] !== scopeKey) {
      delete nextState.notificationPreferences[existingEntry[0]];
    }

    this.persistState(nextState);
    return this.getNotificationPreferences(scopeKey);
  }

  /**
   * Removes stored notification preferences for a scope.
   *
   * @param {string | number | object} scope Preference scope.
   * @returns {boolean} Whether preferences were removed.
   */
  removeNotificationPreferences(scope) {
    const scopeKey = normalizePreferenceScope(scope);
    const state = this.readState();
    const entry = findPreferenceEntry(
      state.notificationPreferences,
      scopeKey,
    );

    if (!entry) {
      return false;
    }

    const nextState = cloneValue(state);

    delete nextState.notificationPreferences[entry[0]];
    nextState.updatedAt = toIsoTimestamp(this.clock());

    this.persistState(nextState);
    return true;
  }

  /**
   * Returns notification preferences for a user.
   *
   * @param {string | number} userId User identifier.
   * @returns {object} Effective notification preferences.
   */
  getUserNotificationPreferences(userId) {
    return this.getNotificationPreferences({
      userId: normalizeIdentifier(userId, 'User identifier'),
    });
  }

  /**
   * Updates notification preferences for a user.
   *
   * @param {string | number} userId User identifier.
   * @param {object} preferences Preference override.
   * @returns {object} Effective notification preferences.
   */
  setUserNotificationPreferences(userId, preferences) {
    return this.setNotificationPreferences(
      {
        userId: normalizeIdentifier(userId, 'User identifier'),
      },
      preferences,
    );
  }

  /**
   * Returns notification preferences for a partner.
   *
   * @param {string | number} partnerCode Partner code.
   * @returns {object} Effective notification preferences.
   */
  getPartnerNotificationPreferences(partnerCode) {
    return this.getNotificationPreferences({
      partnerCode: normalizeIdentifier(partnerCode, 'Partner code'),
    });
  }

  /**
   * Updates notification preferences for a partner.
   *
   * @param {string | number} partnerCode Partner code.
   * @param {object} preferences Preference override.
   * @returns {object} Effective notification preferences.
   */
  setPartnerNotificationPreferences(partnerCode, preferences) {
    return this.setNotificationPreferences(
      {
        partnerCode: normalizeIdentifier(partnerCode, 'Partner code'),
      },
      preferences,
    );
  }

  /**
   * Returns notification preferences for a general agency.
   *
   * @param {string | number} gaCode General agency code.
   * @returns {object} Effective notification preferences.
   */
  getGeneralAgencyNotificationPreferences(gaCode) {
    return this.getNotificationPreferences({
      gaCode: normalizeIdentifier(gaCode, 'General agency code'),
    });
  }

  /**
   * Updates notification preferences for a general agency.
   *
   * @param {string | number} gaCode General agency code.
   * @param {object} preferences Preference override.
   * @returns {object} Effective notification preferences.
   */
  setGeneralAgencyNotificationPreferences(gaCode, preferences) {
    this.getGeneralAgencySettings(gaCode);

    return this.setNotificationPreferences(
      {
        gaCode: normalizeIdentifier(gaCode, 'General agency code'),
      },
      preferences,
    );
  }

  /**
   * Removes persisted configuration and restores seed settings.
   *
   * @returns {object} Seeded reference configuration.
   */
  reset() {
    const removed = this.storageAdapter.remove(this.storageKey);

    if (!removed) {
      throw this.createPersistenceError('reset');
    }

    return cloneValue(this.seedConfiguration);
  }

  readState() {
    const state = this.storageAdapter.get(
      this.storageKey,
      configRepositoryStateSchema,
      createEmptyState(),
    );

    return cloneValue(state);
  }

  persistState(state) {
    const result = configRepositoryStateSchema.safeParse(state);

    if (!result.success) {
      throw createRepositoryError(
        CONFIG_REPOSITORY_ERROR_CODES.PERSISTENCE_FAILED,
        'The configuration repository state is invalid.',
        { issues: result.error.issues },
        result.error,
      );
    }

    buildConfiguration(this.seedConfiguration, result.data);

    if (
      !this.storageAdapter.set(
        this.storageKey,
        result.data,
        configRepositoryStateSchema,
      )
    ) {
      throw this.createPersistenceError('write');
    }
  }

  createPersistenceError(operation) {
    const storageError =
      typeof this.storageAdapter.getLastError === 'function'
        ? this.storageAdapter.getLastError()
        : undefined;

    return createRepositoryError(
      CONFIG_REPOSITORY_ERROR_CODES.PERSISTENCE_FAILED,
      `Unable to ${operation} persisted configuration.`,
      {
        operation,
        storageError: storageError ?? null,
      },
      storageError,
    );
  }
}

/**
 * Creates a GA configuration repository.
 *
 * @param {ConstructorParameters<typeof ConfigRepository>[0]} [options]
 * Repository options.
 * @returns {ConfigRepository} Repository instance.
 */
export function createConfigRepository(options = {}) {
  return new ConfigRepository(options);
}

export const ConfigurationRepository = ConfigRepository;
export const GeneralAgencyConfigRepository = ConfigRepository;
export const GeneralAgencyConfigurationRepository = ConfigRepository;
export const createConfigurationRepository = createConfigRepository;
export const createGeneralAgencyConfigRepository = createConfigRepository;
export const createGeneralAgencyConfigurationRepository =
  createConfigRepository;

export default ConfigRepository;