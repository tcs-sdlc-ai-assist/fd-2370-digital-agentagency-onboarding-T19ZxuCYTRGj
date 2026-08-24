import { ConfigRepository } from '../../repositories/configRepository.js';

export const GA_CONFIG_RESOLVER_ERROR_CODES = Object.freeze({
  INVALID_OPTIONS: 'GA_CONFIG_RESOLVER_INVALID_OPTIONS',
  REPOSITORY_UNAVAILABLE: 'GA_CONFIG_RESOLVER_REPOSITORY_UNAVAILABLE',
  GENERAL_AGENCY_NOT_FOUND: 'GA_CONFIG_RESOLVER_GA_NOT_FOUND',
  CARRIER_NOT_FOUND: 'GA_CONFIG_RESOLVER_CARRIER_NOT_FOUND',
  PROVIDER_NOT_FOUND: 'GA_CONFIG_RESOLVER_PROVIDER_NOT_FOUND',
  SCHEDULE_NOT_FOUND: 'GA_CONFIG_RESOLVER_SCHEDULE_NOT_FOUND',
  RESOLUTION_FAILED: 'GA_CONFIG_RESOLVER_RESOLUTION_FAILED',
});

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertOptions(options, description = 'GA configuration options') {
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

function normalizeOptionalIdentifier(value, description) {
  if (value === null || value === undefined || String(value).trim() === '') {
    return undefined;
  }

  return normalizeIdentifier(value, description);
}

function normalizeIdentifierList(value, description) {
  if (value === undefined || value === null) {
    return undefined;
  }

  const values = Array.isArray(value) ? value : [value];

  return [
    ...new Set(
      values.map((item) => normalizeIdentifier(item, description)),
    ),
  ];
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
  if (overlayValue === undefined) {
    return cloneValue(baseValue);
  }

  if (!isObject(baseValue) || !isObject(overlayValue)) {
    return cloneValue(overlayValue);
  }

  const mergedValue = cloneValue(baseValue);

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

function mergeValues(...values) {
  return values.reduce((mergedValue, value) => {
    if (value === undefined) {
      return mergedValue;
    }

    return deepMerge(mergedValue ?? {}, value);
  }, undefined);
}

function createResolverError(code, message, details, cause) {
  const error = new Error(message, {
    ...(cause === undefined ? {} : { cause }),
  });

  error.name = 'GAConfigResolverError';
  error.code = code;
  error.details = details ?? null;

  return error;
}

function assertRepository(repository) {
  if (
    !isObject(repository) ||
    typeof repository.getReferenceConfiguration !== 'function'
  ) {
    throw createResolverError(
      GA_CONFIG_RESOLVER_ERROR_CODES.REPOSITORY_UNAVAILABLE,
      'The configuration repository must provide getReferenceConfiguration.',
      null,
    );
  }

  return repository;
}

function findByIdentifier(collection, identifier) {
  if (!Array.isArray(collection)) {
    return undefined;
  }

  const normalizedIdentifier = normalizeIdentifierForLookup(identifier);

  return collection.find((item) => {
    if (!isObject(item)) {
      return false;
    }

    return [item.id, item.code, item.name].some((candidate) => {
      if (
        candidate === null ||
        candidate === undefined ||
        String(candidate).trim() === ''
      ) {
        return false;
      }

      return (
        normalizeIdentifierForLookup(candidate) === normalizedIdentifier
      );
    });
  });
}

function findConfigurationEntry(configuration, identifier) {
  if (configuration === undefined || configuration === null) {
    return undefined;
  }

  if (Array.isArray(configuration)) {
    return findByIdentifier(configuration, identifier);
  }

  if (!isObject(configuration)) {
    return undefined;
  }

  const normalizedIdentifier = normalizeIdentifierForLookup(identifier);
  const entry = Object.entries(configuration).find(([key, value]) => {
    if (normalizeIdentifierForLookup(key) === normalizedIdentifier) {
      return true;
    }

    if (!isObject(value)) {
      return false;
    }

    return [value.id, value.code, value.name].some((candidate) => {
      if (
        candidate === null ||
        candidate === undefined ||
        String(candidate).trim() === ''
      ) {
        return false;
      }

      return (
        normalizeIdentifierForLookup(candidate) === normalizedIdentifier
      );
    });
  });

  return entry?.[1];
}

function getNestedConfiguration(source, fieldNames, identifier) {
  if (!isObject(source)) {
    return undefined;
  }

  for (const fieldName of fieldNames) {
    if (!Object.hasOwn(source, fieldName)) {
      continue;
    }

    const configuration = source[fieldName];

    if (identifier === undefined) {
      if (isObject(configuration)) {
        return configuration;
      }

      continue;
    }

    const entry = findConfigurationEntry(configuration, identifier);

    if (entry !== undefined) {
      return entry;
    }
  }

  return undefined;
}

function collectConfiguredIdentifiers(source, fieldNames) {
  if (!isObject(source)) {
    return [];
  }

  const identifiers = [];

  fieldNames.forEach((fieldName) => {
    const value = source[fieldName];

    if (Array.isArray(value)) {
      value.forEach((candidate) => {
        if (isObject(candidate)) {
          const identifier = candidate.code ?? candidate.id;

          if (identifier !== undefined) {
            identifiers.push(String(identifier));
          }

          return;
        }

        if (
          candidate !== null &&
          candidate !== undefined &&
          String(candidate).trim() !== ''
        ) {
          identifiers.push(String(candidate).trim());
        }
      });

      return;
    }

    if (typeof value === 'string' || typeof value === 'number') {
      identifiers.push(String(value).trim());
    }
  });

  return [...new Set(identifiers.filter(Boolean))];
}

function filterCollectionByIdentifiers(collection, identifiers) {
  if (!Array.isArray(collection)) {
    return [];
  }

  if (!identifiers || identifiers.length === 0) {
    return collection;
  }

  const normalizedIdentifiers = new Set(
    identifiers.map((identifier) =>
      normalizeIdentifierForLookup(identifier),
    ),
  );

  return collection.filter((item) =>
    [item?.id, item?.code, item?.name].some((candidate) => {
      if (
        candidate === null ||
        candidate === undefined ||
        String(candidate).trim() === ''
      ) {
        return false;
      }

      return normalizedIdentifiers.has(
        normalizeIdentifierForLookup(candidate),
      );
    }),
  );
}

function resolveRequestedIdentifiers(options, singularFields, pluralFields) {
  for (const field of pluralFields) {
    if (options[field] !== undefined) {
      return normalizeIdentifierList(
        options[field],
        `${field} identifier`,
      );
    }
  }

  for (const field of singularFields) {
    if (options[field] !== undefined) {
      return normalizeIdentifierList(
        options[field],
        `${field} identifier`,
      );
    }
  }

  return undefined;
}

function applyCollectionOverrides(
  collection,
  globalOverrides,
  gaOverrides,
  explicitOverrides,
) {
  return collection.map((item) => {
    const identifier = item.code ?? item.id;
    const globalOverride =
      identifier === undefined
        ? undefined
        : findConfigurationEntry(globalOverrides, identifier);
    const gaOverride =
      identifier === undefined
        ? undefined
        : findConfigurationEntry(gaOverrides, identifier);
    const explicitOverride =
      identifier === undefined
        ? undefined
        : findConfigurationEntry(explicitOverrides, identifier);

    return mergeValues(
      item,
      globalOverride,
      gaOverride,
      explicitOverride,
    );
  });
}

function resolveArguments(gaIdentifierOrOptions, options) {
  if (isObject(gaIdentifierOrOptions)) {
    const normalizedOptions = assertOptions(
      gaIdentifierOrOptions,
      'GA configuration resolution options',
    );
    const gaIdentifier =
      normalizedOptions.gaCode ??
      normalizedOptions.generalAgencyCode ??
      normalizedOptions.generalAgencyId ??
      normalizedOptions.gaId;

    return {
      gaIdentifier: normalizeIdentifier(
        gaIdentifier,
        'General agency identifier',
      ),
      options: normalizedOptions,
    };
  }

  return {
    gaIdentifier: normalizeIdentifier(
      gaIdentifierOrOptions,
      'General agency identifier',
    ),
    options: assertOptions(
      options,
      'GA configuration resolution options',
    ),
  };
}

function createRepository(options) {
  if (options.repository !== undefined) {
    return assertRepository(options.repository);
  }

  if (options.configRepository !== undefined) {
    return assertRepository(options.configRepository);
  }

  return new ConfigRepository({
    ...(options.seedConfiguration === undefined
      ? {}
      : { seedConfiguration: options.seedConfiguration }),
    ...(options.storageAdapter === undefined
      ? {}
      : { storageAdapter: options.storageAdapter }),
    ...(options.storage === undefined
      ? {}
      : { storage: options.storage }),
    ...(options.storageKey === undefined
      ? {}
      : { storageKey: options.storageKey }),
    ...(options.namespace === undefined
      ? {}
      : { namespace: options.namespace }),
    ...(options.schemaVersion === undefined
      ? {}
      : { schemaVersion: options.schemaVersion }),
    ...(options.clock === undefined ? {} : { clock: options.clock }),
    ...(options.onStorageError === undefined
      ? {}
      : { onStorageError: options.onStorageError }),
  });
}

/**
 * Resolves effective GA-scoped reference and workflow configuration.
 */
export class GAConfigResolver {
  /**
   * @param {{
   *   repository?: object,
   *   configRepository?: object,
   *   seedConfiguration?: object,
   *   storageAdapter?: object,
   *   storage?: Storage,
   *   storageKey?: string,
   *   namespace?: string,
   *   schemaVersion?: number,
   *   clock?: () => Date | string | number,
   *   onStorageError?: (error: object) => void
   * }} [options] Resolver options.
   */
  constructor(options = {}) {
    const normalizedOptions = assertOptions(
      options,
      'GA configuration resolver options',
    );

    this.repository = createRepository(normalizedOptions);
  }

  /**
   * Returns the effective reference configuration.
   *
   * @returns {object} Reference configuration.
   */
  getReferenceConfiguration() {
    return cloneValue(this.repository.getReferenceConfiguration());
  }

  /**
   * Resolves a general agency by code or identifier.
   *
   * @param {string | number} gaIdentifier General agency identifier.
   * @returns {object} Effective general agency configuration.
   */
  resolveGeneralAgency(gaIdentifier) {
    const identifier = normalizeIdentifier(
      gaIdentifier,
      'General agency identifier',
    );
    let generalAgency;

    if (typeof this.repository.findGeneralAgency === 'function') {
      generalAgency = this.repository.findGeneralAgency(identifier);
    } else if (
      typeof this.repository.getGeneralAgencySettings === 'function'
    ) {
      try {
        generalAgency =
          this.repository.getGeneralAgencySettings(identifier);
      } catch {
        generalAgency = undefined;
      }
    } else {
      generalAgency = findByIdentifier(
        this.getReferenceConfiguration().generalAgencies,
        identifier,
      );
    }

    if (!generalAgency) {
      throw createResolverError(
        GA_CONFIG_RESOLVER_ERROR_CODES.GENERAL_AGENCY_NOT_FOUND,
        `General agency configuration not found: ${identifier}`,
        { gaIdentifier: identifier },
      );
    }

    return cloneValue(generalAgency);
  }

  /**
   * Alias for resolveGeneralAgency.
   *
   * @param {string | number} gaIdentifier General agency identifier.
   * @returns {object} Effective general agency configuration.
   */
  getGeneralAgencyConfiguration(gaIdentifier) {
    return this.resolveGeneralAgency(gaIdentifier);
  }

  /**
   * Resolves an effective carrier configuration.
   *
   * @param {string | number} gaIdentifier General agency identifier.
   * @param {string | number} carrierIdentifier Carrier identifier.
   * @param {object} [options] Carrier resolution options.
   * @returns {object} Effective carrier configuration.
   */
  resolveCarrier(gaIdentifier, carrierIdentifier, options = {}) {
    const normalizedOptions = assertOptions(
      options,
      'Carrier resolution options',
    );
    const generalAgency = this.resolveGeneralAgency(gaIdentifier);
    const referenceConfiguration = this.getReferenceConfiguration();
    const identifier = normalizeIdentifier(
      carrierIdentifier,
      'Carrier identifier',
    );
    const carrier = findByIdentifier(
      referenceConfiguration.carriers,
      identifier,
    );

    if (!carrier) {
      throw createResolverError(
        GA_CONFIG_RESOLVER_ERROR_CODES.CARRIER_NOT_FOUND,
        `Carrier configuration not found: ${identifier}`,
        {
          gaCode: generalAgency.code,
          carrierIdentifier: identifier,
        },
      );
    }

    return cloneValue(
      mergeValues(
        carrier,
        getNestedConfiguration(
          referenceConfiguration,
          ['carrierConfigurations', 'carrierOverrides'],
          identifier,
        ),
        getNestedConfiguration(
          generalAgency,
          [
            'carrierConfigurations',
            'carrierOverrides',
            'carriers',
          ],
          identifier,
        ),
        normalizedOptions.override ??
          normalizedOptions.carrierOverride,
      ),
    );
  }

  /**
   * Resolves effective provider configurations.
   *
   * @param {string | number} gaIdentifier General agency identifier.
   * @param {{
   *   providerCode?: string,
   *   providerCodes?: string[],
   *   service?: string,
   *   overrides?: object
   * }} [options] Provider resolution options.
   * @returns {object[]} Effective provider configurations.
   */
  resolveProviders(gaIdentifier, options = {}) {
    const normalizedOptions = assertOptions(
      options,
      'Provider resolution options',
    );
    const generalAgency = this.resolveGeneralAgency(gaIdentifier);
    const referenceConfiguration = this.getReferenceConfiguration();
    const requestedIdentifiers =
      resolveRequestedIdentifiers(
        normalizedOptions,
        ['providerCode', 'providerId'],
        ['providerCodes', 'providerIds'],
      ) ??
      collectConfiguredIdentifiers(generalAgency, [
        'providerCodes',
        'enabledProviders',
      ]);
    const providers = filterCollectionByIdentifiers(
      referenceConfiguration.providers,
      requestedIdentifiers,
    );
    const effectiveProviders = applyCollectionOverrides(
      providers,
      referenceConfiguration.providerOverrides ??
        referenceConfiguration.providerConfigurations,
      generalAgency.providerOverrides ??
        generalAgency.providerConfigurations,
      normalizedOptions.overrides ??
        normalizedOptions.providerOverrides,
    ).filter(
      (provider) =>
        normalizedOptions.service === undefined ||
        provider.service === normalizedOptions.service ||
        provider.services?.includes(normalizedOptions.service),
    );

    if (
      requestedIdentifiers &&
      effectiveProviders.length !== requestedIdentifiers.length
    ) {
      const resolvedIdentifiers = new Set(
        effectiveProviders.flatMap((provider) =>
          [provider.code, provider.id]
            .filter(Boolean)
            .map((identifier) =>
              normalizeIdentifierForLookup(identifier),
            ),
        ),
      );
      const missingProvider = requestedIdentifiers.find(
        (identifier) =>
          !resolvedIdentifiers.has(
            normalizeIdentifierForLookup(identifier),
          ),
      );

      if (missingProvider) {
        throw createResolverError(
          GA_CONFIG_RESOLVER_ERROR_CODES.PROVIDER_NOT_FOUND,
          `Provider configuration not found: ${missingProvider}`,
          {
            gaCode: generalAgency.code,
            providerIdentifier: missingProvider,
          },
        );
      }
    }

    return cloneValue(effectiveProviders);
  }

  /**
   * Resolves notification defaults and scoped preferences.
   *
   * @param {string | number} gaIdentifier General agency identifier.
   * @param {{overrides?: object}} [options] Notification options.
   * @returns {object} Effective notification configuration.
   */
  resolveNotifications(gaIdentifier, options = {}) {
    const normalizedOptions = assertOptions(
      options,
      'Notification resolution options',
    );
    const generalAgency = this.resolveGeneralAgency(gaIdentifier);
    const referenceConfiguration = this.getReferenceConfiguration();
    let scopedPreferences;

    if (
      typeof this.repository.getGeneralAgencyNotificationPreferences ===
      'function'
    ) {
      scopedPreferences =
        this.repository.getGeneralAgencyNotificationPreferences(
          generalAgency.code,
        );
    } else if (
      typeof this.repository.getNotificationPreferences === 'function'
    ) {
      scopedPreferences = this.repository.getNotificationPreferences({
        gaCode: generalAgency.code,
      });
    }

    return cloneValue(
      mergeValues(
        referenceConfiguration.notificationDefaults,
        generalAgency.notificationDefaults,
        generalAgency.notificationPreferences,
        scopedPreferences,
        normalizedOptions.overrides ??
          normalizedOptions.notificationOverrides,
      ),
    );
  }

  /**
   * Resolves appointment settings for a GA and optional carrier.
   *
   * @param {string | number} gaIdentifier General agency identifier.
   * @param {{
   *   carrierCode?: string,
   *   state?: string,
   *   overrides?: object
   * }} [options] Appointment resolution options.
   * @returns {object} Effective appointment configuration.
   */
  resolveAppointment(gaIdentifier, options = {}) {
    const normalizedOptions = assertOptions(
      options,
      'Appointment resolution options',
    );
    const generalAgency = this.resolveGeneralAgency(gaIdentifier);
    const referenceConfiguration = this.getReferenceConfiguration();
    const carrierIdentifier = normalizeOptionalIdentifier(
      normalizedOptions.carrierCode ??
        normalizedOptions.carrierId ??
        generalAgency.carrierCode,
      'Carrier identifier',
    );
    const carrier =
      carrierIdentifier === undefined
        ? undefined
        : this.resolveCarrier(
            generalAgency.code,
            carrierIdentifier,
            normalizedOptions.carrierOptions ?? {},
          );
    const stateIdentifier = normalizeOptionalIdentifier(
      normalizedOptions.state,
      'Appointment state',
    );

    return cloneValue(
      mergeValues(
        referenceConfiguration.appointmentDefaults,
        referenceConfiguration.appointmentConfiguration,
        carrier?.appointmentDefaults,
        carrier?.appointmentConfiguration,
        carrier?.appointment,
        generalAgency.appointmentDefaults,
        generalAgency.appointmentConfiguration,
        generalAgency.appointment,
        stateIdentifier === undefined
          ? undefined
          : getNestedConfiguration(
              referenceConfiguration,
              ['appointmentByState', 'appointmentStateOverrides'],
              stateIdentifier,
            ),
        stateIdentifier === undefined
          ? undefined
          : getNestedConfiguration(
              generalAgency,
              ['appointmentByState', 'appointmentStateOverrides'],
              stateIdentifier,
            ),
        normalizedOptions.overrides ??
          normalizedOptions.appointmentOverrides,
      ),
    );
  }

  /**
   * Resolves effective commission schedules.
   *
   * @param {string | number} gaIdentifier General agency identifier.
   * @param {{
   *   scheduleCode?: string,
   *   scheduleCodes?: string[],
   *   levelCode?: string,
   *   overrides?: object
   * }} [options] Schedule resolution options.
   * @returns {object[]} Effective schedules.
   */
  resolveSchedules(gaIdentifier, options = {}) {
    const normalizedOptions = assertOptions(
      options,
      'Schedule resolution options',
    );
    const generalAgency = this.resolveGeneralAgency(gaIdentifier);
    const referenceConfiguration = this.getReferenceConfiguration();
    const requestedIdentifiers =
      resolveRequestedIdentifiers(
        normalizedOptions,
        ['scheduleCode', 'scheduleId'],
        ['scheduleCodes', 'scheduleIds'],
      ) ??
      collectConfiguredIdentifiers(generalAgency, [
        'scheduleCodes',
        'enabledSchedules',
      ]);
    const schedules = filterCollectionByIdentifiers(
      referenceConfiguration.schedules,
      requestedIdentifiers,
    );
    const effectiveSchedules = applyCollectionOverrides(
      schedules,
      referenceConfiguration.scheduleOverrides ??
        referenceConfiguration.scheduleConfigurations,
      generalAgency.scheduleOverrides ??
        generalAgency.scheduleConfigurations,
      normalizedOptions.overrides ??
        normalizedOptions.scheduleOverrides,
    ).filter(
      (schedule) =>
        normalizedOptions.levelCode === undefined ||
        schedule.levelCode === normalizedOptions.levelCode ||
        schedule.levelId === normalizedOptions.levelCode,
    );

    if (
      requestedIdentifiers &&
      effectiveSchedules.length !== requestedIdentifiers.length
    ) {
      const resolvedIdentifiers = new Set(
        effectiveSchedules.flatMap((schedule) =>
          [schedule.code, schedule.id]
            .filter(Boolean)
            .map((identifier) =>
              normalizeIdentifierForLookup(identifier),
            ),
        ),
      );
      const missingSchedule = requestedIdentifiers.find(
        (identifier) =>
          !resolvedIdentifiers.has(
            normalizeIdentifierForLookup(identifier),
          ),
      );

      if (missingSchedule) {
        throw createResolverError(
          GA_CONFIG_RESOLVER_ERROR_CODES.SCHEDULE_NOT_FOUND,
          `Schedule configuration not found: ${missingSchedule}`,
          {
            gaCode: generalAgency.code,
            scheduleIdentifier: missingSchedule,
          },
        );
      }
    }

    return cloneValue(effectiveSchedules);
  }

  /**
   * Resolves journey settings for a journey type.
   *
   * @param {string | number} gaIdentifier General agency identifier.
   * @param {{
   *   journeyType?: string,
   *   carrierCode?: string,
   *   overrides?: object
   * }} [options] Journey resolution options.
   * @returns {object} Effective journey configuration.
   */
  resolveJourney(gaIdentifier, options = {}) {
    const normalizedOptions = assertOptions(
      options,
      'Journey resolution options',
    );
    const generalAgency = this.resolveGeneralAgency(gaIdentifier);
    const referenceConfiguration = this.getReferenceConfiguration();
    const journeyType = normalizeOptionalIdentifier(
      normalizedOptions.journeyType ??
        generalAgency.defaultJourneyType,
      'Journey type',
    );
    const carrierIdentifier = normalizeOptionalIdentifier(
      normalizedOptions.carrierCode ??
        normalizedOptions.carrierId ??
        generalAgency.carrierCode,
      'Carrier identifier',
    );
    const carrier =
      carrierIdentifier === undefined
        ? undefined
        : this.resolveCarrier(
            generalAgency.code,
            carrierIdentifier,
            normalizedOptions.carrierOptions ?? {},
          );

    return cloneValue(
      mergeValues(
        referenceConfiguration.journeyDefaults,
        referenceConfiguration.journeyConfiguration,
        journeyType === undefined
          ? undefined
          : getNestedConfiguration(
              referenceConfiguration,
              ['journeys', 'journeyConfigurations'],
              journeyType,
            ),
        carrier?.journeyDefaults,
        carrier?.journeyConfiguration,
        journeyType === undefined
          ? undefined
          : getNestedConfiguration(
              carrier,
              ['journeys', 'journeyConfigurations'],
              journeyType,
            ),
        generalAgency.journeyDefaults,
        generalAgency.journeyConfiguration,
        journeyType === undefined
          ? undefined
          : getNestedConfiguration(
              generalAgency,
              ['journeys', 'journeyConfigurations'],
              journeyType,
            ),
        normalizedOptions.overrides ??
          normalizedOptions.journeyOverrides,
        journeyType === undefined ? undefined : { journeyType },
      ),
    );
  }

  /**
   * Resolves all effective configuration for a GA.
   *
   * @param {string | number | object} gaIdentifierOrOptions GA identifier or
   * resolution options containing gaCode.
   * @param {{
   *   carrierCode?: string,
   *   providerCode?: string,
   *   providerCodes?: string[],
   *   scheduleCode?: string,
   *   scheduleCodes?: string[],
   *   journeyType?: string,
   *   state?: string,
   *   overrides?: object
   * }} [options] Resolution options.
   * @returns {object} Effective GA configuration bundle.
   */
  resolve(gaIdentifierOrOptions, options = {}) {
    const resolvedArguments = resolveArguments(
      gaIdentifierOrOptions,
      options,
    );
    const normalizedOptions = resolvedArguments.options;

    try {
      const generalAgency = this.resolveGeneralAgency(
        resolvedArguments.gaIdentifier,
      );
      const carrierIdentifier = normalizeOptionalIdentifier(
        normalizedOptions.carrierCode ??
          normalizedOptions.carrierId ??
          generalAgency.carrierCode,
        'Carrier identifier',
      );
      const carrier =
        carrierIdentifier === undefined
          ? null
          : this.resolveCarrier(
              generalAgency.code,
              carrierIdentifier,
              normalizedOptions.carrierOptions ?? {},
            );
      const providers = this.resolveProviders(generalAgency.code, {
        providerCode: normalizedOptions.providerCode,
        providerCodes: normalizedOptions.providerCodes,
        providerId: normalizedOptions.providerId,
        providerIds: normalizedOptions.providerIds,
        service: normalizedOptions.providerService,
        overrides:
          normalizedOptions.providerOverrides ??
          normalizedOptions.overrides?.providers,
      });
      const notifications = this.resolveNotifications(
        generalAgency.code,
        {
          overrides:
            normalizedOptions.notificationOverrides ??
            normalizedOptions.overrides?.notifications,
        },
      );
      const appointment = this.resolveAppointment(
        generalAgency.code,
        {
          carrierCode: carrier?.code ?? carrierIdentifier,
          state: normalizedOptions.state,
          overrides:
            normalizedOptions.appointmentOverrides ??
            normalizedOptions.overrides?.appointment,
        },
      );
      const schedules = this.resolveSchedules(generalAgency.code, {
        scheduleCode: normalizedOptions.scheduleCode,
        scheduleCodes: normalizedOptions.scheduleCodes,
        scheduleId: normalizedOptions.scheduleId,
        scheduleIds: normalizedOptions.scheduleIds,
        levelCode: normalizedOptions.levelCode,
        overrides:
          normalizedOptions.scheduleOverrides ??
          normalizedOptions.overrides?.schedules,
      });
      const journey = this.resolveJourney(generalAgency.code, {
        journeyType: normalizedOptions.journeyType,
        carrierCode: carrier?.code ?? carrierIdentifier,
        overrides:
          normalizedOptions.journeyOverrides ??
          normalizedOptions.overrides?.journey,
      });
      const referenceConfiguration = this.getReferenceConfiguration();
      const result = {
        gaCode: generalAgency.code,
        generalAgency: cloneValue(generalAgency),
        ga: cloneValue(generalAgency),
        carrier: cloneValue(carrier),
        providers: cloneValue(providers),
        notification: cloneValue(notifications),
        notifications: cloneValue(notifications),
        notificationPreferences: cloneValue(notifications),
        appointment: cloneValue(appointment),
        appointmentConfiguration: cloneValue(appointment),
        schedules: cloneValue(schedules),
        journey: cloneValue(journey),
        journeyConfiguration: cloneValue(journey),
        referenceConfiguration,
      };

      return cloneValue(
        mergeValues(result, normalizedOptions.overrides?.root),
      );
    } catch (error) {
      if (
        error?.name === 'GAConfigResolverError' ||
        error?.name === 'ConfigRepositoryError' ||
        error instanceof TypeError ||
        error instanceof RangeError
      ) {
        throw error;
      }

      throw createResolverError(
        GA_CONFIG_RESOLVER_ERROR_CODES.RESOLUTION_FAILED,
        'Unable to resolve the effective general agency configuration.',
        { gaIdentifier: resolvedArguments.gaIdentifier },
        error,
      );
    }
  }

  /**
   * Alias for resolve.
   *
   * @param {string | number | object} gaIdentifierOrOptions GA identifier or
   * resolution options.
   * @param {object} [options] Resolution options.
   * @returns {object} Effective GA configuration bundle.
   */
  resolveConfiguration(gaIdentifierOrOptions, options = {}) {
    return this.resolve(gaIdentifierOrOptions, options);
  }

  /**
   * Alias for resolve.
   *
   * @param {string | number | object} gaIdentifierOrOptions GA identifier or
   * resolution options.
   * @param {object} [options] Resolution options.
   * @returns {object} Effective GA configuration bundle.
   */
  getEffectiveConfiguration(gaIdentifierOrOptions, options = {}) {
    return this.resolve(gaIdentifierOrOptions, options);
  }
}

/**
 * Creates a GA configuration resolver.
 *
 * @param {ConstructorParameters<typeof GAConfigResolver>[0]} [options]
 * Resolver options.
 * @returns {GAConfigResolver} Resolver instance.
 */
export function createGAConfigResolver(options = {}) {
  return new GAConfigResolver(options);
}

/**
 * Resolves GA configuration using a newly created resolver.
 *
 * @param {string | number | object} gaIdentifierOrOptions GA identifier or
 * resolution options.
 * @param {object} [options] Resolution options.
 * @returns {object} Effective GA configuration bundle.
 */
export function resolveGAConfiguration(
  gaIdentifierOrOptions,
  options = {},
) {
  return createGAConfigResolver().resolve(
    gaIdentifierOrOptions,
    options,
  );
}

export const GeneralAgencyConfigResolver = GAConfigResolver;
export const createGeneralAgencyConfigResolver =
  createGAConfigResolver;
export const resolveGaConfig = resolveGAConfiguration;
export const resolveGAConfig = resolveGAConfiguration;

export default GAConfigResolver;