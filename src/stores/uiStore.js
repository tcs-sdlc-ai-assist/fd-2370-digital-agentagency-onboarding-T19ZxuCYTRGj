import { z } from 'zod';
import { create } from 'zustand';
import { STORAGE_KEYS } from '../constants/storageKeys.js';
import { BrowserStorageAdapter } from '../persistence/browserStorageAdapter.js';
import { toIsoTimestamp } from '../utils/dates.js';

export const DEFAULT_UI_STORE_USER_ID = 'anonymous';
export const DEFAULT_FILTER_SCOPE = 'global';
export const DEFAULT_RECENT_SEARCH_LIMIT = 10;
export const UI_STORE_STORAGE_KEY = STORAGE_KEYS.USER_PREFERENCES;

export const DISPLAY_THEMES = Object.freeze({
  SYSTEM: 'system',
  LIGHT: 'light',
  DARK: 'dark',
});

export const DISPLAY_DENSITIES = Object.freeze({
  COMFORTABLE: 'comfortable',
  COMPACT: 'compact',
  SPACIOUS: 'spacious',
});

export const DEFAULT_DISPLAY_PREFERENCES = Object.freeze({
  theme: DISPLAY_THEMES.SYSTEM,
  density: DISPLAY_DENSITIES.COMFORTABLE,
  pageSize: 25,
  reducedMotion: false,
  sidebarCollapsed: false,
});

export const UI_STORE_ERROR_CODES = Object.freeze({
  INVALID_PREFERENCES: 'UI_PREFERENCES_INVALID',
  PERSISTENCE_FAILED: 'UI_PREFERENCES_PERSISTENCE_FAILED',
  HYDRATION_FAILED: 'UI_PREFERENCES_HYDRATION_FAILED',
});

const identifierSchema = z.string().trim().min(1);
const dateTimeSchema = z.string().datetime({ offset: true });

export const displayPreferencesSchema = z
  .object({
    theme: z
      .enum(Object.values(DISPLAY_THEMES))
      .default(DEFAULT_DISPLAY_PREFERENCES.theme),
    density: z
      .enum(Object.values(DISPLAY_DENSITIES))
      .default(DEFAULT_DISPLAY_PREFERENCES.density),
    pageSize: z
      .number()
      .int()
      .min(1)
      .max(200)
      .default(DEFAULT_DISPLAY_PREFERENCES.pageSize),
    reducedMotion: z
      .boolean()
      .default(DEFAULT_DISPLAY_PREFERENCES.reducedMotion),
    sidebarCollapsed: z
      .boolean()
      .default(DEFAULT_DISPLAY_PREFERENCES.sidebarCollapsed),
  })
  .passthrough();

export const uiStorePersistenceSchema = z
  .object({
    filters: z.record(z.record(z.unknown())).default({}),
    recentSearches: z.array(identifierSchema).default([]),
    dismissedNotices: z.record(dateTimeSchema).default({}),
    displayPreferences: displayPreferencesSchema.default(
      DEFAULT_DISPLAY_PREFERENCES,
    ),
    updatedAt: dateTimeSchema.nullable().default(null),
  })
  .passthrough();

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

function isStorageAdapter(value) {
  return (
    isObject(value) &&
    typeof value.get === 'function' &&
    typeof value.set === 'function' &&
    typeof value.remove === 'function'
  );
}

function assertOptions(options, description = 'UI store options') {
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

function normalizeRecentSearchLimit(value) {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(
      'The recent search limit must be a positive integer.',
    );
  }

  return value;
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

function createDefaultPreferences() {
  return {
    filters: {},
    recentSearches: [],
    dismissedNotices: {},
    displayPreferences: {
      ...DEFAULT_DISPLAY_PREFERENCES,
    },
    updatedAt: null,
  };
}

function createUiStoreError(code, message, details, cause) {
  const error = new Error(message, {
    ...(cause === undefined ? {} : { cause }),
  });

  error.name = 'UiStoreError';
  error.code = code;
  error.details = details ?? null;

  return error;
}

function formatValidationIssues(error) {
  return error.issues
    .map((issue) => {
      const path =
        issue.path.length > 0 ? issue.path.join('.') : 'preferences';

      return `${path}: ${issue.message}`;
    })
    .join('; ');
}

function parsePreferences(preferences) {
  const result = uiStorePersistenceSchema.safeParse(preferences);

  if (!result.success) {
    throw createUiStoreError(
      UI_STORE_ERROR_CODES.INVALID_PREFERENCES,
      `Invalid UI preferences: ${formatValidationIssues(result.error)}`,
      { issues: result.error.issues },
      result.error,
    );
  }

  return result.data;
}

function resolveStorageAdapter(options, clock) {
  if (options.storageAdapter !== undefined) {
    if (!isStorageAdapter(options.storageAdapter)) {
      throw new TypeError(
        'The UI preferences storage adapter must provide get, set, and remove methods.',
      );
    }

    return options.storageAdapter;
  }

  if (options.storage !== undefined && !isStorageLike(options.storage)) {
    throw new TypeError(
      'The supplied UI preferences storage implementation is invalid.',
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
    clock,
    ...(options.onStorageError === undefined
      ? {}
      : { onError: options.onStorageError }),
  });
}

/**
 * Builds the per-user storage key used for UI preferences.
 *
 * @param {string | number} userId User identifier.
 * @param {string} [baseStorageKey] Base preference storage key.
 * @returns {string} Per-user UI preference storage key.
 */
export function getUiStoreStorageKey(
  userId,
  baseStorageKey = UI_STORE_STORAGE_KEY,
) {
  const normalizedUserId = normalizeIdentifierForLookup(
    userId,
    'User identifier',
  );
  const normalizedBaseStorageKey = normalizeIdentifier(
    baseStorageKey,
    'UI preference base storage key',
  );

  return `${normalizedBaseStorageKey}:${encodeURIComponent(
    normalizedUserId,
  )}`;
}

function readInitialPreferences(storageAdapter, storageKey) {
  try {
    return parsePreferences(
      storageAdapter.get(
        storageKey,
        uiStorePersistenceSchema,
        createDefaultPreferences(),
      ),
    );
  } catch {
    return createDefaultPreferences();
  }
}

function createStateSnapshot(preferences) {
  const parsedPreferences = parsePreferences(preferences);
  const dismissedNoticeIds = Object.keys(
    parsedPreferences.dismissedNotices,
  );

  return {
    filters: cloneValue(parsedPreferences.filters),
    recentSearches: [...parsedPreferences.recentSearches],
    dismissedNotices: cloneValue(parsedPreferences.dismissedNotices),
    dismissedNoticeIds,
    displayPreferences: cloneValue(
      parsedPreferences.displayPreferences,
    ),
    preferences: cloneValue(parsedPreferences.displayPreferences),
    updatedAt: parsedPreferences.updatedAt,
  };
}

/**
 * Creates a per-user persisted Zustand UI preferences store.
 *
 * @param {{
 *   userId?: string,
 *   storageAdapter?: object,
 *   storage?: Storage,
 *   storageKey?: string,
 *   baseStorageKey?: string,
 *   namespace?: string,
 *   schemaVersion?: number,
 *   recentSearchLimit?: number,
 *   clock?: () => Date | string | number,
 *   onStorageError?: (error: object) => void
 * }} [options] UI store options.
 * @returns {import('zustand').UseBoundStore<import('zustand').StoreApi<object>>}
 * Zustand UI preferences store.
 */
export function createUiStore(options = {}) {
  const normalizedOptions = assertOptions(options);
  const userId = normalizeIdentifier(
    normalizedOptions.userId ?? DEFAULT_UI_STORE_USER_ID,
    'User identifier',
  );
  const clock = normalizedOptions.clock ?? (() => new Date());

  if (typeof clock !== 'function') {
    throw new TypeError('The UI preferences clock must be a function.');
  }

  const recentSearchLimit = normalizeRecentSearchLimit(
    normalizedOptions.recentSearchLimit ?? DEFAULT_RECENT_SEARCH_LIMIT,
  );
  const storageAdapter = resolveStorageAdapter(normalizedOptions, clock);
  const storageKey =
    normalizedOptions.storageKey === undefined
      ? getUiStoreStorageKey(
          userId,
          normalizedOptions.baseStorageKey ?? UI_STORE_STORAGE_KEY,
        )
      : normalizeIdentifier(
          normalizedOptions.storageKey,
          'UI preference storage key',
        );
  const initialPreferences = readInitialPreferences(
    storageAdapter,
    storageKey,
  );

  return create((set, get) => {
    const getPersistableState = () => ({
      filters: cloneValue(get().filters),
      recentSearches: [...get().recentSearches],
      dismissedNotices: cloneValue(get().dismissedNotices),
      displayPreferences: cloneValue(get().displayPreferences),
      updatedAt: get().updatedAt,
    });

    const createPersistenceError = (operation) => {
      const storageError =
        typeof storageAdapter.getLastError === 'function'
          ? storageAdapter.getLastError()
          : undefined;

      return createUiStoreError(
        UI_STORE_ERROR_CODES.PERSISTENCE_FAILED,
        `Unable to ${operation} persisted UI preferences.`,
        {
          operation,
          userId,
          storageError: storageError ?? null,
        },
        storageError,
      );
    };

    const persist = (preferences) => {
      const timestamp = toIsoTimestamp(clock());
      const parsedPreferences = parsePreferences({
        ...cloneValue(preferences),
        updatedAt: timestamp,
      });

      if (
        !storageAdapter.set(
          storageKey,
          parsedPreferences,
          uiStorePersistenceSchema,
        )
      ) {
        throw createPersistenceError('write');
      }

      const snapshot = createStateSnapshot(parsedPreferences);

      set({
        ...snapshot,
        isHydrated: true,
        error: null,
      });

      return snapshot;
    };

    const updatePreferences = (updater) => {
      try {
        const currentPreferences = getPersistableState();
        const nextPreferences = updater(
          cloneValue(currentPreferences),
        );

        if (!isObject(nextPreferences)) {
          throw new TypeError(
            'The UI preferences updater must return an object.',
          );
        }

        return persist(nextPreferences);
      } catch (error) {
        set({ error });
        throw error;
      }
    };

    return {
      ...createStateSnapshot(initialPreferences),
      userId,
      storageKey,
      recentSearchLimit,
      isHydrated: true,
      error: null,

      hydrate: () => {
        try {
          const preferences = parsePreferences(
            storageAdapter.get(
              storageKey,
              uiStorePersistenceSchema,
              createDefaultPreferences(),
            ),
          );
          const snapshot = createStateSnapshot(preferences);

          set({
            ...snapshot,
            isHydrated: true,
            error: null,
          });

          return cloneValue(preferences);
        } catch (error) {
          const hydrationError = createUiStoreError(
            UI_STORE_ERROR_CODES.HYDRATION_FAILED,
            'Unable to hydrate persisted UI preferences.',
            { userId },
            error,
          );

          set({
            ...createStateSnapshot(createDefaultPreferences()),
            isHydrated: true,
            error: hydrationError,
          });

          return false;
        }
      },

      setFilters: (scopeOrFilters, maybeFilters) => {
        const scope =
          maybeFilters === undefined
            ? DEFAULT_FILTER_SCOPE
            : normalizeIdentifier(scopeOrFilters, 'Filter scope');
        const filters =
          maybeFilters === undefined ? scopeOrFilters : maybeFilters;

        if (!isObject(filters)) {
          throw new TypeError('UI filters must be an object.');
        }

        updatePreferences((preferences) => ({
          ...preferences,
          filters: {
            ...preferences.filters,
            [scope]: cloneValue(filters),
          },
        }));

        return cloneValue(get().filters[scope]);
      },

      updateFilters: (scopeOrFilters, maybeFilters) => {
        const scope =
          maybeFilters === undefined
            ? DEFAULT_FILTER_SCOPE
            : normalizeIdentifier(scopeOrFilters, 'Filter scope');
        const filters =
          maybeFilters === undefined ? scopeOrFilters : maybeFilters;

        if (!isObject(filters)) {
          throw new TypeError('UI filter updates must be an object.');
        }

        updatePreferences((preferences) => ({
          ...preferences,
          filters: {
            ...preferences.filters,
            [scope]: {
              ...(preferences.filters[scope] ?? {}),
              ...cloneValue(filters),
            },
          },
        }));

        return cloneValue(get().filters[scope]);
      },

      setFilter: (scope, filterName, value) => {
        const normalizedScope = normalizeIdentifier(
          scope,
          'Filter scope',
        );
        const normalizedFilterName = normalizeIdentifier(
          filterName,
          'Filter name',
        );

        updatePreferences((preferences) => {
          const scopedFilters = {
            ...(preferences.filters[normalizedScope] ?? {}),
          };

          if (value === undefined) {
            delete scopedFilters[normalizedFilterName];
          } else {
            scopedFilters[normalizedFilterName] = cloneValue(value);
          }

          return {
            ...preferences,
            filters: {
              ...preferences.filters,
              [normalizedScope]: scopedFilters,
            },
          };
        });

        return cloneValue(
          get().filters[normalizedScope]?.[normalizedFilterName],
        );
      },

      getFilters: (scope = DEFAULT_FILTER_SCOPE) => {
        const normalizedScope = normalizeIdentifier(
          scope,
          'Filter scope',
        );

        return cloneValue(get().filters[normalizedScope] ?? {});
      },

      clearFilters: (scope = DEFAULT_FILTER_SCOPE) => {
        const normalizedScope = normalizeIdentifier(
          scope,
          'Filter scope',
        );

        updatePreferences((preferences) => {
          const filters = {
            ...preferences.filters,
          };

          delete filters[normalizedScope];

          return {
            ...preferences,
            filters,
          };
        });

        return true;
      },

      resetFilters: (scope = DEFAULT_FILTER_SCOPE) =>
        get().clearFilters(scope),

      clearAllFilters: () => {
        updatePreferences((preferences) => ({
          ...preferences,
          filters: {},
        }));

        return true;
      },

      addRecentSearch: (search) => {
        const normalizedSearch = normalizeIdentifier(
          search,
          'Recent search',
        );
        const normalizedLookup = normalizeIdentifierForLookup(
          normalizedSearch,
          'Recent search',
        );

        updatePreferences((preferences) => ({
          ...preferences,
          recentSearches: [
            normalizedSearch,
            ...preferences.recentSearches.filter(
              (candidate) =>
                normalizeIdentifierForLookup(
                  candidate,
                  'Recent search',
                ) !== normalizedLookup,
            ),
          ].slice(0, recentSearchLimit),
        }));

        return [...get().recentSearches];
      },

      removeRecentSearch: (search) => {
        const normalizedSearch = normalizeIdentifierForLookup(
          search,
          'Recent search',
        );
        const exists = get().recentSearches.some(
          (candidate) =>
            normalizeIdentifierForLookup(
              candidate,
              'Recent search',
            ) === normalizedSearch,
        );

        if (!exists) {
          return false;
        }

        updatePreferences((preferences) => ({
          ...preferences,
          recentSearches: preferences.recentSearches.filter(
            (candidate) =>
              normalizeIdentifierForLookup(
                candidate,
                'Recent search',
              ) !== normalizedSearch,
          ),
        }));

        return true;
      },

      clearRecentSearches: () => {
        updatePreferences((preferences) => ({
          ...preferences,
          recentSearches: [],
        }));

        return true;
      },

      dismissNotice: (noticeId, dismissedAt = clock()) => {
        const normalizedNoticeId = normalizeIdentifier(
          noticeId,
          'Notice identifier',
        );
        const timestamp = toIsoTimestamp(dismissedAt);

        updatePreferences((preferences) => ({
          ...preferences,
          dismissedNotices: {
            ...preferences.dismissedNotices,
            [normalizedNoticeId]: timestamp,
          },
        }));

        return timestamp;
      },

      restoreNotice: (noticeId) => {
        const normalizedNoticeId = normalizeIdentifier(
          noticeId,
          'Notice identifier',
        );

        if (!Object.hasOwn(get().dismissedNotices, normalizedNoticeId)) {
          return false;
        }

        updatePreferences((preferences) => {
          const dismissedNotices = {
            ...preferences.dismissedNotices,
          };

          delete dismissedNotices[normalizedNoticeId];

          return {
            ...preferences,
            dismissedNotices,
          };
        });

        return true;
      },

      clearDismissedNotices: () => {
        updatePreferences((preferences) => ({
          ...preferences,
          dismissedNotices: {},
        }));

        return true;
      },

      isNoticeDismissed: (noticeId) => {
        const normalizedNoticeId = normalizeIdentifier(
          noticeId,
          'Notice identifier',
        );

        return Object.hasOwn(
          get().dismissedNotices,
          normalizedNoticeId,
        );
      },

      setDisplayPreferences: (displayPreferences) => {
        if (!isObject(displayPreferences)) {
          throw new TypeError('Display preferences must be an object.');
        }

        updatePreferences((preferences) => ({
          ...preferences,
          displayPreferences: {
            ...preferences.displayPreferences,
            ...cloneValue(displayPreferences),
          },
        }));

        return cloneValue(get().displayPreferences);
      },

      updateDisplayPreferences: (displayPreferences) =>
        get().setDisplayPreferences(displayPreferences),

      setDisplayPreference: (preferenceName, value) => {
        const normalizedPreferenceName = normalizeIdentifier(
          preferenceName,
          'Display preference name',
        );

        return get().setDisplayPreferences({
          [normalizedPreferenceName]: cloneValue(value),
        });
      },

      setTheme: (theme) =>
        get().setDisplayPreference('theme', theme),

      setDensity: (density) =>
        get().setDisplayPreference('density', density),

      setPageSize: (pageSize) =>
        get().setDisplayPreference('pageSize', pageSize),

      toggleSidebar: () =>
        get().setDisplayPreference(
          'sidebarCollapsed',
          !get().displayPreferences.sidebarCollapsed,
        ),

      resetDisplayPreferences: () => {
        updatePreferences((preferences) => ({
          ...preferences,
          displayPreferences: {
            ...DEFAULT_DISPLAY_PREFERENCES,
          },
        }));

        return cloneValue(get().displayPreferences);
      },

      clearError: () => {
        set({ error: null });
      },

      reset: () => {
        try {
          if (!storageAdapter.remove(storageKey)) {
            throw createPersistenceError('reset');
          }

          const preferences = createDefaultPreferences();

          set({
            ...createStateSnapshot(preferences),
            isHydrated: true,
            error: null,
          });

          return cloneValue(preferences);
        } catch (error) {
          set({ error });
          throw error;
        }
      },
    };
  });
}

export const createUIStore = createUiStore;
export const createUserInterfaceStore = createUiStore;
export const useUiStore = createUiStore();
export const useUIStore = useUiStore;

export const selectUiFilters = (state) => state.filters;
export const selectFilters = (scope = DEFAULT_FILTER_SCOPE) => (state) =>
  state.filters[scope] ?? {};
export const selectRecentSearches = (state) => state.recentSearches;
export const selectDismissedNotices = (state) =>
  state.dismissedNotices;
export const selectDismissedNoticeIds = (state) =>
  state.dismissedNoticeIds;
export const selectDisplayPreferences = (state) =>
  state.displayPreferences;
export const selectTheme = (state) =>
  state.displayPreferences.theme;
export const selectDensity = (state) =>
  state.displayPreferences.density;
export const selectPageSize = (state) =>
  state.displayPreferences.pageSize;
export const selectSidebarCollapsed = (state) =>
  state.displayPreferences.sidebarCollapsed;
export const selectUiStoreHydrated = (state) => state.isHydrated;
export const selectUiStoreError = (state) => state.error;
export const selectIsNoticeDismissed = (noticeId) => (state) => {
  if (
    noticeId === null ||
    noticeId === undefined ||
    String(noticeId).trim() === ''
  ) {
    return false;
  }

  return Object.hasOwn(
    state.dismissedNotices,
    String(noticeId).trim(),
  );
};

export default useUiStore;