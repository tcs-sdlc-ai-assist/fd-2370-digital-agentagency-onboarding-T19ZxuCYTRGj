import { PERSISTENCE_SCHEMA_VERSION } from '../config/appConfig.js';

export const STORAGE_NAMESPACE_ROOT = 'fd-2370-digital-onboarding';

export const STORAGE_NAMESPACE = `${STORAGE_NAMESPACE_ROOT}:v${PERSISTENCE_SCHEMA_VERSION}`;

export const STORAGE_AGGREGATES = Object.freeze({
  APP_STATE: 'app-state',
  AUTH: 'auth',
  INTAKE: 'intake',
  ONBOARDING: 'onboarding',
  OPERATIONS: 'operations',
  REFERENCE_DATA: 'reference-data',
  USER_PREFERENCES: 'user-preferences',
});

export const STORAGE_KEYS = Object.freeze(
  Object.fromEntries(
    Object.entries(STORAGE_AGGREGATES).map(([aggregateName, key]) => [
      aggregateName,
      `${STORAGE_NAMESPACE}:${key}`,
    ]),
  ),
);

export const PERSISTENCE_KEYS = STORAGE_KEYS;

export default STORAGE_KEYS;