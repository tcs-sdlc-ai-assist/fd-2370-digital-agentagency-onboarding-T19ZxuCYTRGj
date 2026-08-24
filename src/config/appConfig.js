import { z } from 'zod';

const environmentSchema = z.enum([
  'development',
  'test',
  'staging',
  'production',
]);

const booleanEnvironmentValueSchema = z.preprocess((value) => {
  if (typeof value === 'string') {
    const normalizedValue = value.trim().toLowerCase();

    if (normalizedValue === 'true') {
      return true;
    }

    if (normalizedValue === 'false') {
      return false;
    }
  }

  return value;
}, z.boolean());

const appConfigSchema = z.object({
  appEnv: environmentSchema,
  enableDiagnostics: booleanEnvironmentValueSchema,
});

const configResult = appConfigSchema.safeParse({
  appEnv: import.meta.env.VITE_APP_ENV || 'development',
  enableDiagnostics: import.meta.env.VITE_ENABLE_DIAGNOSTICS || false,
});

if (!configResult.success) {
  const invalidFields = configResult.error.issues
    .map((issue) => issue.path.join('.') || 'configuration')
    .join(', ');

  throw new Error(`Invalid application configuration: ${invalidFields}`);
}

export const PERSISTENCE_SCHEMA_VERSION = 1;

export const appConfig = Object.freeze({
  ...configResult.data,
  persistenceSchemaVersion: PERSISTENCE_SCHEMA_VERSION,
});

export default appConfig;