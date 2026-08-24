import { z } from 'zod';
import { create } from 'zustand';
import { STORAGE_KEYS } from '../constants/storageKeys.js';
import {
  EXTERNAL_ROLES,
  ROLE_PARTNER_SCOPE_MATRIX,
  ROLE_PERMISSION_MATRIX,
  ROLES,
} from '../constants/roles.js';
import { userSchema } from '../contracts/schemas.js';
import { BrowserStorageAdapter } from '../persistence/browserStorageAdapter.js';
import { getSeeds } from '../persistence/seedLoader.js';
import { toIsoTimestamp } from '../utils/dates.js';
import { createDeterministicId } from '../utils/ids.js';

const DEFAULT_SESSION_DURATION_MS = 8 * 60 * 60 * 1000;

export const AUTH_STORE_STORAGE_KEY = STORAGE_KEYS.AUTH;

export const AUTH_SESSION_STATUSES = Object.freeze({
  ANONYMOUS: 'anonymous',
  AUTHENTICATED: 'authenticated',
  EXPIRED: 'expired',
});

export const AUTH_STORE_ERROR_CODES = Object.freeze({
  INVALID_CREDENTIALS: 'AUTH_INVALID_CREDENTIALS',
  USER_INACTIVE: 'AUTH_USER_INACTIVE',
  SESSION_REQUIRED: 'AUTH_SESSION_REQUIRED',
  SESSION_EXPIRED: 'AUTH_SESSION_EXPIRED',
  PARTNER_CONTEXT_FORBIDDEN: 'AUTH_PARTNER_CONTEXT_FORBIDDEN',
  PERSISTENCE_FAILED: 'AUTH_PERSISTENCE_FAILED',
});

const authSessionSchema = z
  .object({
    sessionId: z.string().trim().min(1),
    userId: z.string().trim().min(1),
    issuedAt: z.string().datetime({ offset: true }),
    expiresAt: z.string().datetime({ offset: true }),
  })
  .passthrough();

export const partnerContextSchema = z
  .object({
    partnerCode: z.string().trim().min(1).nullable(),
    organization: z.string().trim().min(1),
    scopeType: z.string().trim().min(1),
  })
  .passthrough();

export const authStorePersistenceSchema = z
  .object({
    session: authSessionSchema.nullable().default(null),
    partnerContext: partnerContextSchema.nullable().default(null),
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

function assertOptions(options, description = 'Authentication store options') {
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

function cloneValue(value) {
  if (value === undefined) {
    return undefined;
  }

  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value));
}

function createAuthStoreError(code, message, details, cause) {
  const error = new Error(message, {
    ...(cause === undefined ? {} : { cause }),
  });

  error.name = 'AuthStoreError';
  error.code = code;
  error.details = details ?? null;

  return error;
}

function validateUsers(users) {
  if (!Array.isArray(users)) {
    throw new TypeError('Seeded authentication users must be an array.');
  }

  const identifiers = new Set();
  const emails = new Set();

  return users.map((user) => {
    const result = userSchema.safeParse(user);

    if (!result.success) {
      throw new TypeError('A seeded authentication user is invalid.', {
        cause: result.error,
      });
    }

    const normalizedId = normalizeIdentifierForLookup(
      result.data.id,
      'User identifier',
    );
    const normalizedEmail = result.data.email.toLowerCase();

    if (identifiers.has(normalizedId) || emails.has(normalizedEmail)) {
      throw new TypeError(
        `Duplicate seeded authentication user: ${result.data.id}`,
      );
    }

    identifiers.add(normalizedId);
    emails.add(normalizedEmail);

    return result.data;
  });
}

function normalizeSessionDuration(value) {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(
      'Authentication session duration must be a positive integer.',
    );
  }

  return value;
}

function getClockTime(clock) {
  return Date.parse(toIsoTimestamp(clock()));
}

function isSessionExpired(session, referenceTime) {
  return session === null || Date.parse(session.expiresAt) <= referenceTime;
}

function inferPartnerCode(user) {
  if (user.id === 'usr_partner_demo') {
    return 'DEMO_PARTNER';
  }

  if (user.id === 'usr_agency_demo') {
    return 'DEMO_AGENCY';
  }

  if (!EXTERNAL_ROLES.includes(user.role)) {
    return null;
  }

  const code = user.organization
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();

  return code || null;
}

function createDefaultPartnerContext(user, partnerCode) {
  return partnerContextSchema.parse({
    partnerCode:
      partnerCode === undefined
        ? inferPartnerCode(user)
        : partnerCode === null
          ? null
          : normalizeIdentifier(partnerCode, 'Partner code'),
    organization: user.organization,
    scopeType: ROLE_PARTNER_SCOPE_MATRIX[user.role],
  });
}

function normalizePartnerContext(context, user, currentContext) {
  if (context === null) {
    return null;
  }

  if (typeof context === 'string' || typeof context === 'number') {
    return createDefaultPartnerContext(
      user,
      normalizeIdentifier(context, 'Partner code'),
    );
  }

  if (!isObject(context)) {
    throw new TypeError(
      'Partner context must be a partner code, object, or null.',
    );
  }

  return partnerContextSchema.parse({
    ...cloneValue(currentContext ?? createDefaultPartnerContext(user)),
    ...cloneValue(context),
    partnerCode:
      context.partnerCode === undefined
        ? (currentContext?.partnerCode ?? inferPartnerCode(user))
        : context.partnerCode === null
          ? null
          : normalizeIdentifier(context.partnerCode, 'Partner code'),
    organization: context.organization ?? user.organization,
    scopeType:
      context.scopeType ?? ROLE_PARTNER_SCOPE_MATRIX[user.role],
  });
}

function resolveSeededUser(users, credentials) {
  let selector;

  if (
    typeof credentials === 'string' ||
    typeof credentials === 'number'
  ) {
    selector = String(credentials).trim();
  } else if (isObject(credentials)) {
    selector =
      credentials.userId ??
      credentials.id ??
      credentials.email ??
      credentials.role;
  }

  if (
    selector === null ||
    selector === undefined ||
    String(selector).trim() === ''
  ) {
    throw createAuthStoreError(
      AUTH_STORE_ERROR_CODES.INVALID_CREDENTIALS,
      'A seeded user identifier, email address, or role is required.',
      null,
    );
  }

  const normalizedSelector = normalizeIdentifierForLookup(
    selector,
    'Login selector',
  );

  const user = users.find(
    (candidate) =>
      normalizeIdentifierForLookup(
        candidate.id,
        'User identifier',
      ) === normalizedSelector ||
      candidate.email.toLowerCase() === normalizedSelector ||
      candidate.role.toLowerCase() === normalizedSelector,
  );

  if (!user) {
    throw createAuthStoreError(
      AUTH_STORE_ERROR_CODES.INVALID_CREDENTIALS,
      'The supplied credentials do not match a seeded user.',
      { selector: String(selector) },
    );
  }

  if (user.status !== 'active') {
    throw createAuthStoreError(
      AUTH_STORE_ERROR_CODES.USER_INACTIVE,
      'The seeded user is not active.',
      {
        userId: user.id,
        status: user.status,
      },
    );
  }

  return user;
}

function resolveStorageAdapter(options) {
  if (options.storageAdapter !== undefined) {
    if (!isStorageAdapter(options.storageAdapter)) {
      throw new TypeError(
        'The authentication storage adapter must provide get, set, and remove methods.',
      );
    }

    return options.storageAdapter;
  }

  if (options.storage !== undefined && !isStorageLike(options.storage)) {
    throw new TypeError(
      'The supplied authentication storage implementation is invalid.',
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

function createAnonymousSnapshot(status = AUTH_SESSION_STATUSES.ANONYMOUS) {
  return {
    user: null,
    currentUser: null,
    session: null,
    partnerContext: null,
    activePartnerCode: null,
    role: null,
    permissions: [],
    partnerScope: null,
    isAuthenticated: false,
    isSessionExpired: status === AUTH_SESSION_STATUSES.EXPIRED,
    status,
  };
}

function createAuthenticatedSnapshot(user, session, partnerContext) {
  return {
    user: cloneValue(user),
    currentUser: cloneValue(user),
    session: cloneValue(session),
    partnerContext: cloneValue(partnerContext),
    activePartnerCode: partnerContext?.partnerCode ?? null,
    role: user.role,
    permissions: [...(ROLE_PERMISSION_MATRIX[user.role] ?? [])],
    partnerScope: ROLE_PARTNER_SCOPE_MATRIX[user.role] ?? null,
    isAuthenticated: true,
    isSessionExpired: false,
    status: AUTH_SESSION_STATUSES.AUTHENTICATED,
  };
}

function createExpiredSnapshot(user, session, partnerContext) {
  return {
    user: user ? cloneValue(user) : null,
    currentUser: user ? cloneValue(user) : null,
    session: session ? cloneValue(session) : null,
    partnerContext: partnerContext ? cloneValue(partnerContext) : null,
    activePartnerCode: partnerContext?.partnerCode ?? null,
    role: user?.role ?? null,
    permissions: [],
    partnerScope: user
      ? (ROLE_PARTNER_SCOPE_MATRIX[user.role] ?? null)
      : null,
    isAuthenticated: false,
    isSessionExpired: true,
    status: AUTH_SESSION_STATUSES.EXPIRED,
  };
}

function findUserById(users, userId) {
  const normalizedUserId = normalizeIdentifierForLookup(
    userId,
    'User identifier',
  );

  return users.find(
    (user) =>
      normalizeIdentifierForLookup(
        user.id,
        'User identifier',
      ) === normalizedUserId,
  );
}

function getPersistedSession(storageAdapter, storageKey) {
  return storageAdapter.get(
    storageKey,
    authStorePersistenceSchema,
    {
      session: null,
      partnerContext: null,
    },
  );
}

function createInitialSnapshot(storageAdapter, storageKey, users, clock) {
  try {
    const persistedState = getPersistedSession(
      storageAdapter,
      storageKey,
    );

    if (!persistedState?.session) {
      return createAnonymousSnapshot();
    }

    const user = findUserById(users, persistedState.session.userId);

    if (
      !user ||
      user.status !== 'active' ||
      isSessionExpired(persistedState.session, getClockTime(clock))
    ) {
      return createExpiredSnapshot(
        user,
        persistedState.session,
        persistedState.partnerContext,
      );
    }

    const partnerContext =
      persistedState.partnerContext ??
      createDefaultPartnerContext(user);

    return createAuthenticatedSnapshot(
      user,
      persistedState.session,
      partnerContext,
    );
  } catch {
    return createAnonymousSnapshot();
  }
}

/**
 * Creates a Zustand mock authentication store backed by seeded users.
 *
 * @param {{
 *   users?: object[],
 *   storageAdapter?: object,
 *   storage?: Storage,
 *   storageKey?: string,
 *   namespace?: string,
 *   schemaVersion?: number,
 *   sessionDurationMs?: number,
 *   clock?: () => Date | string | number,
 *   onStorageError?: (error: object) => void
 * }} [options] Store options.
 * @returns {import('zustand').UseBoundStore<import('zustand').StoreApi<object>>}
 * Zustand authentication store.
 */
export function createAuthStore(options = {}) {
  const normalizedOptions = assertOptions(options);
  const users = validateUsers(
    normalizedOptions.users ?? getSeeds().users,
  );
  const clock = normalizedOptions.clock ?? (() => new Date());
  const sessionDurationMs = normalizeSessionDuration(
    normalizedOptions.sessionDurationMs ?? DEFAULT_SESSION_DURATION_MS,
  );
  const storageAdapter = resolveStorageAdapter({
    ...normalizedOptions,
    clock,
  });
  const storageKey = normalizeIdentifier(
    normalizedOptions.storageKey ?? AUTH_STORE_STORAGE_KEY,
    'Authentication storage key',
  );
  const initialSnapshot = createInitialSnapshot(
    storageAdapter,
    storageKey,
    users,
    clock,
  );

  return create((set, get) => ({
    ...initialSnapshot,
    availableUsers: users.map((user) => cloneValue(user)),
    error: null,

    login: (credentials, loginOptions = {}) => {
      const normalizedLoginOptions = assertOptions(
        loginOptions,
        'Login options',
      );

      try {
        const user = resolveSeededUser(users, credentials);
        const credentialOptions = isObject(credentials) ? credentials : {};
        const issuedAtTime = getClockTime(clock);
        const issuedAt = new Date(issuedAtTime).toISOString();
        const duration = normalizeSessionDuration(
          normalizedLoginOptions.sessionDurationMs ??
            credentialOptions.sessionDurationMs ??
            sessionDurationMs,
        );
        const expiresAt = new Date(issuedAtTime + duration).toISOString();
        const session = authSessionSchema.parse({
          sessionId: createDeterministicId(
            'SES',
            {
              userId: user.id,
              issuedAt,
              expiresAt,
            },
            { length: 16 },
          ),
          userId: user.id,
          issuedAt,
          expiresAt,
        });
        const requestedContext =
          normalizedLoginOptions.partnerContext ??
          credentialOptions.partnerContext;
        const requestedPartnerCode =
          normalizedLoginOptions.partnerCode ??
          credentialOptions.partnerCode;
        const partnerContext =
          requestedContext === undefined
            ? createDefaultPartnerContext(user, requestedPartnerCode)
            : normalizePartnerContext(requestedContext, user, null);
        const persistedState = {
          session,
          partnerContext,
        };

        if (
          !storageAdapter.set(
            storageKey,
            persistedState,
            authStorePersistenceSchema,
          )
        ) {
          throw createAuthStoreError(
            AUTH_STORE_ERROR_CODES.PERSISTENCE_FAILED,
            'Unable to persist the mock authentication session.',
            {
              storageError:
                typeof storageAdapter.getLastError === 'function'
                  ? storageAdapter.getLastError()
                  : null,
            },
          );
        }

        set({
          ...createAuthenticatedSnapshot(
            user,
            session,
            partnerContext,
          ),
          error: null,
        });

        return cloneValue(user);
      } catch (error) {
        set({ error });

        throw error;
      }
    },

    loginAsSeededUser: (selector, loginOptions = {}) =>
      get().login(selector, loginOptions),

    logout: () => {
      let removed = false;

      try {
        removed = storageAdapter.remove(storageKey);
      } finally {
        set({
          ...createAnonymousSnapshot(),
          error: null,
        });
      }

      return removed;
    },

    setPartnerContext: (context) => {
      const state = get();

      if (!state.session || !state.user) {
        const error = createAuthStoreError(
          AUTH_STORE_ERROR_CODES.SESSION_REQUIRED,
          'An authenticated session is required to select a partner context.',
          null,
        );

        set({ error });
        throw error;
      }

      if (isSessionExpired(state.session, getClockTime(clock))) {
        const error = createAuthStoreError(
          AUTH_STORE_ERROR_CODES.SESSION_EXPIRED,
          'The mock authentication session has expired.',
          { userId: state.user.id },
        );

        set({
          ...createExpiredSnapshot(
            state.user,
            state.session,
            state.partnerContext,
          ),
          error,
        });
        throw error;
      }

      const partnerContext = normalizePartnerContext(
        context,
        state.user,
        state.partnerContext,
      );
      const originalPartnerCode = inferPartnerCode(state.user);

      if (
        EXTERNAL_ROLES.includes(state.user.role) &&
        partnerContext?.partnerCode !== originalPartnerCode
      ) {
        const error = createAuthStoreError(
          AUTH_STORE_ERROR_CODES.PARTNER_CONTEXT_FORBIDDEN,
          'The seeded user cannot switch to a different partner context.',
          {
            userId: state.user.id,
            allowedPartnerCode: originalPartnerCode,
            requestedPartnerCode: partnerContext?.partnerCode ?? null,
          },
        );

        set({ error });
        throw error;
      }

      if (
        !storageAdapter.set(
          storageKey,
          {
            session: state.session,
            partnerContext,
          },
          authStorePersistenceSchema,
        )
      ) {
        const error = createAuthStoreError(
          AUTH_STORE_ERROR_CODES.PERSISTENCE_FAILED,
          'Unable to persist the partner context.',
          {
            storageError:
              typeof storageAdapter.getLastError === 'function'
                ? storageAdapter.getLastError()
                : null,
          },
        );

        set({ error });
        throw error;
      }

      set({
        partnerContext: cloneValue(partnerContext),
        activePartnerCode: partnerContext?.partnerCode ?? null,
        error: null,
      });

      return cloneValue(partnerContext);
    },

    selectPartner: (partnerCode) =>
      get().setPartnerContext(partnerCode),

    checkSession: (referenceTime = clock()) => {
      const state = get();

      if (!state.session || !state.user) {
        return false;
      }

      const normalizedReferenceTime = Date.parse(
        toIsoTimestamp(referenceTime),
      );

      if (!isSessionExpired(state.session, normalizedReferenceTime)) {
        return true;
      }

      set({
        ...createExpiredSnapshot(
          state.user,
          state.session,
          state.partnerContext,
        ),
        error: createAuthStoreError(
          AUTH_STORE_ERROR_CODES.SESSION_EXPIRED,
          'The mock authentication session has expired.',
          { userId: state.user.id },
        ),
      });

      return false;
    },

    simulateExpiry: () => {
      const state = get();

      if (!state.session || !state.user) {
        return false;
      }

      const expiredSession = {
        ...state.session,
        expiresAt: new Date(getClockTime(clock) - 1).toISOString(),
      };

      storageAdapter.set(
        storageKey,
        {
          session: expiredSession,
          partnerContext: state.partnerContext,
        },
        authStorePersistenceSchema,
      );

      set({
        ...createExpiredSnapshot(
          state.user,
          expiredSession,
          state.partnerContext,
        ),
        error: createAuthStoreError(
          AUTH_STORE_ERROR_CODES.SESSION_EXPIRED,
          'The mock authentication session has expired.',
          { userId: state.user.id, simulated: true },
        ),
      });

      return true;
    },

    expireSession: () => get().simulateExpiry(),

    hydrate: () => {
      try {
        const snapshot = createInitialSnapshot(
          storageAdapter,
          storageKey,
          users,
          clock,
        );

        set({
          ...snapshot,
          error:
            snapshot.status === AUTH_SESSION_STATUSES.EXPIRED
              ? createAuthStoreError(
                  AUTH_STORE_ERROR_CODES.SESSION_EXPIRED,
                  'The persisted mock authentication session has expired.',
                  null,
                )
              : null,
        });

        return snapshot.isAuthenticated;
      } catch (error) {
        set({
          ...createAnonymousSnapshot(),
          error,
        });

        return false;
      }
    },

    clearError: () => {
      set({ error: null });
    },
  }));
}

export const createMockSessionStore = createAuthStore;
export const useAuthStore = createAuthStore();

export const selectCurrentUser = (state) => state.currentUser;
export const selectIsAuthenticated = (state) => state.isAuthenticated;
export const selectPartnerContext = (state) => state.partnerContext;
export const selectActivePartnerCode = (state) => state.activePartnerCode;
export const selectPermissions = (state) => state.permissions;
export const selectCan = (permission) => (state) =>
  state.permissions.includes(permission);
export const selectIsPartnerUser = (state) =>
  state.role === ROLES.PARTNER || state.role === ROLES.AGENCY;

export default useAuthStore;