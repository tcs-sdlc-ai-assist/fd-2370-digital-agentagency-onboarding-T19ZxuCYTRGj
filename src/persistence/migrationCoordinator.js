import { PERSISTENCE_SCHEMA_VERSION } from '../config/appConfig.js';
import { STORAGE_NAMESPACE_ROOT } from '../constants/storageKeys.js';
import { storageEnvelopeSchema } from '../contracts/schemas.js';
import { BrowserStorageAdapter } from './browserStorageAdapter.js';

export const MIGRATION_NOTICE_CODES = Object.freeze({
  MIGRATED: 'PERSISTENCE_MIGRATED',
  RESET: 'PERSISTENCE_RESET',
  SUPERSEDED: 'PERSISTENCE_SUPERSEDED',
  MIGRATION_FAILED: 'PERSISTENCE_MIGRATION_FAILED',
  STORAGE_UNAVAILABLE: 'PERSISTENCE_STORAGE_UNAVAILABLE',
});

export const MIGRATION_ACTIONS = Object.freeze({
  MIGRATED: 'migrated',
  RESET: 'reset',
  REMOVED: 'removed',
  RETAINED: 'retained',
});

const NOTICE_SEVERITIES = Object.freeze({
  INFO: 'info',
  WARNING: 'warning',
});

function isStorageLike(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof value.getItem === 'function' &&
    typeof value.setItem === 'function' &&
    typeof value.removeItem === 'function' &&
    typeof value.key === 'function' &&
    Number.isInteger(value.length) &&
    value.length >= 0
  );
}

function assertOptions(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError(
      'Persistence migration coordinator options must be an object.',
    );
  }

  return options;
}

function assertNonEmptyString(value, description) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${description} must be a non-empty string.`);
  }

  return value.trim();
}

function normalizeVersion(version, description) {
  if (!Number.isInteger(version) || version < 1) {
    throw new RangeError(`${description} must be a positive integer.`);
  }

  return version;
}

function assertSchema(schema) {
  if (
    schema !== undefined &&
    (!schema ||
      typeof schema.parse !== 'function' ||
      typeof schema.safeParse !== 'function')
  ) {
    throw new TypeError('Migration payload schemas must be valid Zod schemas.');
  }
}

function normalizeMigrations(migrations) {
  if (migrations === undefined) {
    return new Map();
  }

  const entries =
    migrations instanceof Map
      ? [...migrations.entries()]
      : Object.entries(assertOptions(migrations));
  const normalizedMigrations = new Map();

  entries.forEach(([sourceVersionValue, migrationDefinition]) => {
    const sourceVersion = Number(
      String(sourceVersionValue).split('->')[0],
    );

    normalizeVersion(sourceVersion, 'Migration source version');

    const migrate =
      typeof migrationDefinition === 'function'
        ? migrationDefinition
        : migrationDefinition?.migrate;

    if (typeof migrate !== 'function') {
      throw new TypeError(
        `Migration version ${sourceVersion} must provide a migrate function.`,
      );
    }

    normalizedMigrations.set(sourceVersion, migrate);
  });

  return normalizedMigrations;
}

function normalizeSchemas(schemas) {
  if (schemas === undefined) {
    return new Map();
  }

  const entries =
    schemas instanceof Map
      ? [...schemas.entries()]
      : Object.entries(assertOptions(schemas));
  const normalizedSchemas = new Map();

  entries.forEach(([key, schema]) => {
    const normalizedKey = assertNonEmptyString(
      key,
      'Migration schema key',
    );

    assertSchema(schema);
    normalizedSchemas.set(normalizedKey, schema);
  });

  return normalizedSchemas;
}

function createNotice({
  code,
  severity,
  action,
  message,
  key = null,
  relativeKey = null,
  sourceVersion = null,
  targetVersion,
  cause,
}) {
  return Object.freeze({
    code,
    severity,
    action,
    message,
    key,
    relativeKey,
    sourceVersion,
    targetVersion,
    recoverable: true,
    ...(cause === undefined ? {} : { cause }),
  });
}

function getStorageFromEnvironment() {
  try {
    const storage = globalThis.localStorage;

    return isStorageLike(storage) ? storage : undefined;
  } catch {
    return undefined;
  }
}

function escapeRegularExpression(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseVersionedKey(key, namespaceRoot) {
  const pattern = new RegExp(
    `^${escapeRegularExpression(namespaceRoot)}:v(\\d+):(.+)$`,
  );
  const match = pattern.exec(key);

  if (!match) {
    return undefined;
  }

  const version = Number(match[1]);

  if (!Number.isSafeInteger(version) || version < 1) {
    return undefined;
  }

  return {
    key,
    version,
    relativeKey: match[2],
  };
}

function resolvePayloadSchema(schemas, relativeKey, fullKey) {
  return schemas.get(fullKey) ?? schemas.get(relativeKey);
}

/**
 * Coordinates migration and invalidation of versioned browser storage data.
 */
export class PersistenceMigrationCoordinator {
  /**
   * @param {{
   *   storage?: Storage,
   *   namespaceRoot?: string,
   *   targetVersion?: number,
   *   schemaVersion?: number,
   *   migrations?: Map<number, Function> | Record<string, Function | {migrate: Function}>,
   *   schemas?: Map<string, import('zod').ZodTypeAny> | Record<string, import('zod').ZodTypeAny>,
   *   clock?: () => Date | string | number,
   *   onNotice?: (notice: object) => void
   * }} [options] Migration options.
   */
  constructor(options = {}) {
    const normalizedOptions = assertOptions(options);

    if (
      normalizedOptions.storage !== undefined &&
      !isStorageLike(normalizedOptions.storage)
    ) {
      throw new TypeError(
        'The supplied migration storage implementation is invalid.',
      );
    }

    if (
      normalizedOptions.clock !== undefined &&
      typeof normalizedOptions.clock !== 'function'
    ) {
      throw new TypeError('The migration clock must be a function.');
    }

    if (
      normalizedOptions.onNotice !== undefined &&
      typeof normalizedOptions.onNotice !== 'function'
    ) {
      throw new TypeError('The migration notice handler must be a function.');
    }

    this.storage = normalizedOptions.storage;
    this.namespaceRoot = assertNonEmptyString(
      normalizedOptions.namespaceRoot ?? STORAGE_NAMESPACE_ROOT,
      'The persistence namespace root',
    );
    this.targetVersion = normalizeVersion(
      normalizedOptions.targetVersion ??
        normalizedOptions.schemaVersion ??
        PERSISTENCE_SCHEMA_VERSION,
      'The target persistence version',
    );
    this.migrations = normalizeMigrations(normalizedOptions.migrations);
    this.schemas = normalizeSchemas(normalizedOptions.schemas);
    this.clock = normalizedOptions.clock ?? (() => new Date());
    this.onNotice = normalizedOptions.onNotice;
    this.notices = [];
  }

  /**
   * Migrates supported prior envelopes and removes envelopes that cannot be
   * safely migrated.
   *
   * @returns {{
   *   migrated: number,
   *   reset: number,
   *   retained: number,
   *   notices: object[]
   * }} Migration summary.
   */
  run() {
    this.notices = [];

    const storage = this.getStorage();

    if (!storage) {
      this.reportNotice({
        code: MIGRATION_NOTICE_CODES.STORAGE_UNAVAILABLE,
        severity: NOTICE_SEVERITIES.WARNING,
        action: MIGRATION_ACTIONS.RETAINED,
        message:
          'Browser storage is unavailable. Existing persisted data was not changed.',
      });

      return this.createSummary(0, 0, 1);
    }

    const priorEntries = this.collectPriorEntries(storage);
    const entriesByRelativeKey = new Map();

    priorEntries.forEach((entry) => {
      const entries = entriesByRelativeKey.get(entry.relativeKey) ?? [];

      entries.push(entry);
      entriesByRelativeKey.set(entry.relativeKey, entries);
    });

    let migrated = 0;
    let reset = 0;
    let retained = 0;

    entriesByRelativeKey.forEach((entries, relativeKey) => {
      entries.sort((left, right) => right.version - left.version);

      const [candidate, ...supersededEntries] = entries;

      supersededEntries.forEach((entry) => {
        if (this.removeEntry(storage, entry.key)) {
          reset += 1;
          this.reportNotice({
            code: MIGRATION_NOTICE_CODES.SUPERSEDED,
            severity: NOTICE_SEVERITIES.INFO,
            action: MIGRATION_ACTIONS.REMOVED,
            message:
              'A superseded persistence envelope was removed during migration.',
            key: entry.key,
            relativeKey,
            sourceVersion: entry.version,
          });
        } else {
          retained += 1;
        }
      });

      const result = this.processEntry(storage, candidate);

      migrated += result.migrated;
      reset += result.reset;
      retained += result.retained;
    });

    return this.createSummary(migrated, reset, retained);
  }

  /**
   * Alias for run.
   *
   * @returns {ReturnType<PersistenceMigrationCoordinator['run']>}
   * Migration summary.
   */
  migrate() {
    return this.run();
  }

  /**
   * Alias for run.
   *
   * @returns {ReturnType<PersistenceMigrationCoordinator['run']>}
   * Migration summary.
   */
  coordinate() {
    return this.run();
  }

  /**
   * Returns notices emitted by the most recent migration run.
   *
   * @returns {object[]} Migration notices.
   */
  getNotices() {
    return [...this.notices];
  }

  /**
   * Returns recoverable notices indicating persisted data was reset.
   *
   * @returns {object[]} Reset notices.
   */
  getResetNotices() {
    return this.notices.filter(
      (notice) =>
        notice.action === MIGRATION_ACTIONS.RESET ||
        notice.action === MIGRATION_ACTIONS.REMOVED,
    );
  }

  getStorage() {
    return this.storage ?? getStorageFromEnvironment();
  }

  collectPriorEntries(storage) {
    const entries = [];

    try {
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);

        if (typeof key !== 'string') {
          continue;
        }

        const parsedKey = parseVersionedKey(key, this.namespaceRoot);

        if (
          parsedKey &&
          parsedKey.version < this.targetVersion
        ) {
          entries.push(parsedKey);
        }
      }
    } catch (error) {
      this.reportNotice({
        code: MIGRATION_NOTICE_CODES.STORAGE_UNAVAILABLE,
        severity: NOTICE_SEVERITIES.WARNING,
        action: MIGRATION_ACTIONS.RETAINED,
        message:
          'Persisted data could not be inspected and was left unchanged.',
        cause: error,
      });
    }

    return entries;
  }

  processEntry(storage, entry) {
    const targetNamespace = `${this.namespaceRoot}:v${this.targetVersion}`;
    const targetKey = `${targetNamespace}:${entry.relativeKey}`;

    try {
      if (storage.getItem(targetKey) !== null) {
        if (this.removeEntry(storage, entry.key)) {
          this.reportNotice({
            code: MIGRATION_NOTICE_CODES.SUPERSEDED,
            severity: NOTICE_SEVERITIES.INFO,
            action: MIGRATION_ACTIONS.REMOVED,
            message:
              'An obsolete persistence envelope was removed because current data already exists.',
            key: entry.key,
            relativeKey: entry.relativeKey,
            sourceVersion: entry.version,
          });

          return { migrated: 0, reset: 1, retained: 0 };
        }

        return { migrated: 0, reset: 0, retained: 1 };
      }
    } catch (error) {
      this.reportMigrationFailure(entry, error);
      return { migrated: 0, reset: 0, retained: 1 };
    }

    const envelope = this.readEnvelope(storage, entry);

    if (!envelope) {
      return this.invalidateEntry(storage, entry);
    }

    let migratedData = envelope.data;

    try {
      for (
        let version = entry.version;
        version < this.targetVersion;
        version += 1
      ) {
        const migration = this.migrations.get(version);

        if (!migration) {
          return this.invalidateEntry(storage, entry);
        }

        migratedData = migration(migratedData, Object.freeze({
          relativeKey: entry.relativeKey,
          sourceKey: entry.key,
          sourceVersion: version,
          targetVersion: version + 1,
          finalTargetVersion: this.targetVersion,
        }));
      }
    } catch (error) {
      return this.invalidateEntry(storage, entry, error);
    }

    const schema = resolvePayloadSchema(
      this.schemas,
      entry.relativeKey,
      targetKey,
    );
    const adapter = new BrowserStorageAdapter({
      storage,
      namespace: targetNamespace,
      schemaVersion: this.targetVersion,
      clock: this.clock,
    });

    if (!adapter.set(entry.relativeKey, migratedData, schema)) {
      this.reportMigrationFailure(
        entry,
        adapter.getLastError(),
      );
      return { migrated: 0, reset: 0, retained: 1 };
    }

    if (!this.removeEntry(storage, entry.key)) {
      return { migrated: 1, reset: 0, retained: 1 };
    }

    this.reportNotice({
      code: MIGRATION_NOTICE_CODES.MIGRATED,
      severity: NOTICE_SEVERITIES.INFO,
      action: MIGRATION_ACTIONS.MIGRATED,
      message: 'Persisted data was migrated to the current schema version.',
      key: entry.key,
      relativeKey: entry.relativeKey,
      sourceVersion: entry.version,
    });

    return { migrated: 1, reset: 0, retained: 0 };
  }

  readEnvelope(storage, entry) {
    try {
      const serializedEnvelope = storage.getItem(entry.key);

      if (serializedEnvelope === null) {
        return undefined;
      }

      const result = storageEnvelopeSchema.safeParse(
        JSON.parse(serializedEnvelope),
      );

      if (
        !result.success ||
        result.data.schemaVersion !== entry.version
      ) {
        return undefined;
      }

      return result.data;
    } catch {
      return undefined;
    }
  }

  invalidateEntry(storage, entry, cause) {
    if (!this.removeEntry(storage, entry.key)) {
      this.reportMigrationFailure(entry, cause);
      return { migrated: 0, reset: 0, retained: 1 };
    }

    this.reportNotice({
      code: MIGRATION_NOTICE_CODES.RESET,
      severity: NOTICE_SEVERITIES.WARNING,
      action: MIGRATION_ACTIONS.RESET,
      message:
        'Previously saved data was reset because it could not be safely migrated.',
      key: entry.key,
      relativeKey: entry.relativeKey,
      sourceVersion: entry.version,
      cause,
    });

    return { migrated: 0, reset: 1, retained: 0 };
  }

  removeEntry(storage, key) {
    try {
      storage.removeItem(key);
      return true;
    } catch {
      return false;
    }
  }

  reportMigrationFailure(entry, cause) {
    this.reportNotice({
      code: MIGRATION_NOTICE_CODES.MIGRATION_FAILED,
      severity: NOTICE_SEVERITIES.WARNING,
      action: MIGRATION_ACTIONS.RETAINED,
      message:
        'Persisted data could not be migrated and was left unchanged.',
      key: entry.key,
      relativeKey: entry.relativeKey,
      sourceVersion: entry.version,
      cause,
    });
  }

  reportNotice(noticeDetails) {
    const notice = createNotice({
      ...noticeDetails,
      targetVersion: this.targetVersion,
    });

    this.notices.push(notice);

    if (this.onNotice) {
      try {
        this.onNotice(notice);
      } catch {
        return notice;
      }
    }

    return notice;
  }

  createSummary(migrated, reset, retained) {
    return Object.freeze({
      migrated,
      reset,
      retained,
      notices: Object.freeze([...this.notices]),
    });
  }
}

/**
 * Creates a persistence migration coordinator.
 *
 * @param {ConstructorParameters<typeof PersistenceMigrationCoordinator>[0]}
 * [options] Migration options.
 * @returns {PersistenceMigrationCoordinator} Migration coordinator.
 */
export function createMigrationCoordinator(options = {}) {
  return new PersistenceMigrationCoordinator(options);
}

/**
 * Runs persistence migrations with a newly created coordinator.
 *
 * @param {ConstructorParameters<typeof PersistenceMigrationCoordinator>[0]}
 * [options] Migration options.
 * @returns {ReturnType<PersistenceMigrationCoordinator['run']>}
 * Migration summary.
 */
export function runPersistenceMigrations(options = {}) {
  return createMigrationCoordinator(options).run();
}

export const createPersistenceMigrationCoordinator =
  createMigrationCoordinator;
export const migratePersistence = runPersistenceMigrations;

export default PersistenceMigrationCoordinator;