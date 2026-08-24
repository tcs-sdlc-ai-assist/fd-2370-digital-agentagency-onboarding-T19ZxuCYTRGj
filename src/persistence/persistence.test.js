import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { STORAGE_KEYS } from '../constants/storageKeys.js';
import { getSeeds } from './seedLoader.js';
import {
  BrowserStorageAdapter,
  STORAGE_ERROR_CODES,
} from './browserStorageAdapter.js';
import {
  MIGRATION_NOTICE_CODES,
  PersistenceMigrationCoordinator,
} from './migrationCoordinator.js';
import { createOnboardingRecordRepository } from '../repositories/onboardingRecordRepository.js';
import {
  createUiStore,
  DEFAULT_DISPLAY_PREFERENCES,
} from '../stores/uiStore.js';

const TEST_TIME = '2026-08-24T12:00:00.000Z';

class MemoryStorage {
  constructor() {
    this.values = new Map();
    this.quotaExceeded = false;
  }

  get length() {
    return this.values.size;
  }

  getItem(key) {
    return this.values.has(String(key))
      ? this.values.get(String(key))
      : null;
  }

  setItem(key, value) {
    if (this.quotaExceeded) {
      const error = new Error('Storage quota exceeded.');

      error.name = 'QuotaExceededError';
      throw error;
    }

    this.values.set(String(key), String(value));
  }

  removeItem(key) {
    this.values.delete(String(key));
  }

  key(index) {
    return [...this.values.keys()][index] ?? null;
  }

  clear() {
    this.values.clear();
  }
}

beforeEach(() => {
  globalThis.localStorage.clear();
});

describe('Persistence integration', () => {
  it('writes validated payloads in namespaced versioned envelopes', () => {
    const storage = new MemoryStorage();
    const payloadSchema = z.object({
      enabled: z.boolean(),
      label: z.string(),
    });
    const adapter = new BrowserStorageAdapter({
      storage,
      namespace: 'persistence-test:v3',
      schemaVersion: 3,
      clock: () => new Date(TEST_TIME),
    });

    expect(
      adapter.set(
        'preferences',
        {
          enabled: true,
          label: 'Synthetic preferences',
        },
        payloadSchema,
      ),
    ).toBe(true);

    const persistedValue = JSON.parse(
      storage.getItem('persistence-test:v3:preferences'),
    );

    expect(persistedValue).toEqual({
      schemaVersion: 3,
      savedAt: TEST_TIME,
      data: {
        enabled: true,
        label: 'Synthetic preferences',
      },
    });
    expect(adapter.get('preferences', payloadSchema)).toEqual({
      enabled: true,
      label: 'Synthetic preferences',
    });

    const otherNamespaceAdapter = new BrowserStorageAdapter({
      storage,
      namespace: 'persistence-test:v3:other-user',
      schemaVersion: 3,
    });

    expect(
      otherNamespaceAdapter.get('preferences', payloadSchema, null),
    ).toBeNull();
  });

  it('removes malformed persisted state and returns the configured fallback', () => {
    const storage = new MemoryStorage();
    const namespace = 'malformed-state-test:v1';
    const key = `${namespace}:application`;
    const adapter = new BrowserStorageAdapter({
      storage,
      namespace,
      schemaVersion: 1,
    });

    storage.setItem(key, '{"schemaVersion":1,"data":');

    expect(
      adapter.get(
        'application',
        z.object({ status: z.string() }),
        {
          status: 'fallback',
        },
      ),
    ).toEqual({
      status: 'fallback',
    });
    expect(storage.getItem(key)).toBeNull();
    expect(adapter.getLastError()).toEqual(
      expect.objectContaining({
        code: STORAGE_ERROR_CODES.INVALID_ENVELOPE,
        operation: 'read',
        key,
      }),
    );
  });

  it('migrates a prior namespace envelope into the target schema version', () => {
    const storage = new MemoryStorage();
    const namespaceRoot = 'migration-integration-test';
    const oldKey = `${namespaceRoot}:v1:settings`;

    storage.setItem(
      oldKey,
      JSON.stringify({
        schemaVersion: 1,
        savedAt: '2026-08-23T12:00:00.000Z',
        data: {
          count: 2,
        },
      }),
    );

    const coordinator = new PersistenceMigrationCoordinator({
      storage,
      namespaceRoot,
      targetVersion: 2,
      clock: () => new Date(TEST_TIME),
      migrations: {
        1: (data) => ({
          ...data,
          migrated: true,
        }),
      },
      schemas: {
        settings: z.object({
          count: z.number().int(),
          migrated: z.literal(true),
        }),
      },
    });
    const result = coordinator.run();
    const migratedAdapter = new BrowserStorageAdapter({
      storage,
      namespace: `${namespaceRoot}:v2`,
      schemaVersion: 2,
    });

    expect(result).toEqual(
      expect.objectContaining({
        migrated: 1,
        reset: 0,
        retained: 0,
      }),
    );
    expect(result.notices).toEqual([
      expect.objectContaining({
        code: MIGRATION_NOTICE_CODES.MIGRATED,
        sourceVersion: 1,
        targetVersion: 2,
        relativeKey: 'settings',
      }),
    ]);
    expect(storage.getItem(oldKey)).toBeNull();
    expect(
      migratedAdapter.get(
        'settings',
        z.object({
          count: z.number().int(),
          migrated: z.boolean(),
        }),
      ),
    ).toEqual({
      count: 2,
      migrated: true,
    });
  });

  it('resets unsupported prior envelopes when no safe migration exists', () => {
    const storage = new MemoryStorage();
    const namespaceRoot = 'migration-reset-test';
    const oldKey = `${namespaceRoot}:v1:state`;

    storage.setItem(
      oldKey,
      JSON.stringify({
        schemaVersion: 1,
        savedAt: TEST_TIME,
        data: {
          obsolete: true,
        },
      }),
    );

    const result = new PersistenceMigrationCoordinator({
      storage,
      namespaceRoot,
      targetVersion: 2,
    }).run();

    expect(result).toEqual(
      expect.objectContaining({
        migrated: 0,
        reset: 1,
        retained: 0,
      }),
    );
    expect(result.notices).toEqual([
      expect.objectContaining({
        code: MIGRATION_NOTICE_CODES.RESET,
        relativeKey: 'state',
        sourceVersion: 1,
        targetVersion: 2,
      }),
    ]);
    expect(storage.getItem(oldKey)).toBeNull();
    expect(storage.getItem(`${namespaceRoot}:v2:state`)).toBeNull();
  });

  it('keeps the last valid repository state when an atomic update fails', () => {
    const storage = new MemoryStorage();
    const repository = createOnboardingRecordRepository({
      storage,
      clock: () => new Date(TEST_TIME),
    });
    const originalRecord = getSeeds().indexes.onboardingByApplicationId[
      'APP-DEMO-1001'
    ];

    expect(originalRecord.priority).toBe('normal');

    const updatedRecord = repository.update('APP-DEMO-1001', {
      priority: 'high',
    });
    const persistedBeforeFailure = storage.getItem(
      STORAGE_KEYS.ONBOARDING,
    );

    expect(updatedRecord.priority).toBe('high');
    expect(persistedBeforeFailure).not.toBeNull();

    expect(() =>
      repository.update('APP-DEMO-1001', {
        status: 'unsupported_status',
        priority: 'low',
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'ONBOARDING_RECORD_INVALID',
      }),
    );

    expect(storage.getItem(STORAGE_KEYS.ONBOARDING)).toBe(
      persistedBeforeFailure,
    );
    expect(repository.find('APP-DEMO-1001')).toEqual(
      expect.objectContaining({
        status: 'draft',
        priority: 'high',
        updatedAt: TEST_TIME,
      }),
    );
  });

  it('isolates UI preferences by user and resets only the selected user', () => {
    const storage = new MemoryStorage();
    const clock = () => new Date(TEST_TIME);
    const firstUserStore = createUiStore({
      userId: 'user-one',
      storage,
      clock,
    });
    const secondUserStore = createUiStore({
      userId: 'user-two',
      storage,
      clock,
    });

    firstUserStore.getState().setTheme('dark');
    firstUserStore
      .getState()
      .setFilters('workbench', { state: 'pending' });
    secondUserStore.getState().setDensity('compact');
    secondUserStore
      .getState()
      .setFilters('workbench', { state: 'completed' });

    const rehydratedFirstUser = createUiStore({
      userId: 'user-one',
      storage,
      clock,
    });
    const rehydratedSecondUser = createUiStore({
      userId: 'user-two',
      storage,
      clock,
    });

    expect(rehydratedFirstUser.getState().displayPreferences.theme).toBe(
      'dark',
    );
    expect(
      rehydratedFirstUser.getState().getFilters('workbench'),
    ).toEqual({
      state: 'pending',
    });
    expect(
      rehydratedSecondUser.getState().displayPreferences.density,
    ).toBe('compact');
    expect(
      rehydratedSecondUser.getState().getFilters('workbench'),
    ).toEqual({
      state: 'completed',
    });

    rehydratedFirstUser.getState().reset();

    expect(rehydratedFirstUser.getState().displayPreferences).toEqual(
      DEFAULT_DISPLAY_PREFERENCES,
    );
    expect(
      rehydratedFirstUser.getState().getFilters('workbench'),
    ).toEqual({});

    const preservedSecondUser = createUiStore({
      userId: 'user-two',
      storage,
      clock,
    });

    expect(
      preservedSecondUser.getState().displayPreferences.density,
    ).toBe('compact');
    expect(
      preservedSecondUser.getState().getFilters('workbench'),
    ).toEqual({
      state: 'completed',
    });
  });

  it('reports quota errors without replacing an existing envelope', () => {
    const storage = new MemoryStorage();
    const adapter = new BrowserStorageAdapter({
      storage,
      namespace: 'quota-test:v1',
      schemaVersion: 1,
      clock: () => new Date(TEST_TIME),
    });
    const schema = z.object({
      value: z.string(),
    });

    expect(adapter.set('state', { value: 'original' }, schema)).toBe(
      true,
    );

    const persistedValue = storage.getItem('quota-test:v1:state');

    storage.quotaExceeded = true;

    expect(adapter.set('state', { value: 'replacement' }, schema)).toBe(
      false,
    );
    expect(storage.getItem('quota-test:v1:state')).toBe(
      persistedValue,
    );
    expect(adapter.getLastError()).toEqual(
      expect.objectContaining({
        code: STORAGE_ERROR_CODES.QUOTA_EXCEEDED,
        operation: 'write',
        quotaExceeded: true,
      }),
    );
  });

  it('resets repository overlays and restores pristine seeded records', () => {
    const storage = new MemoryStorage();
    const repository = createOnboardingRecordRepository({
      storage,
      clock: () => new Date(TEST_TIME),
    });

    repository.update('APP-DEMO-1001', {
      priority: 'high',
    });

    expect(repository.find('APP-DEMO-1001').priority).toBe('high');
    expect(storage.getItem(STORAGE_KEYS.ONBOARDING)).not.toBeNull();

    const resetRecords = repository.reset();

    expect(storage.getItem(STORAGE_KEYS.ONBOARDING)).toBeNull();
    expect(repository.find('APP-DEMO-1001').priority).toBe('normal');
    expect(resetRecords).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          applicationId: 'APP-DEMO-1001',
          priority: 'normal',
        }),
      ]),
    );
  });
});