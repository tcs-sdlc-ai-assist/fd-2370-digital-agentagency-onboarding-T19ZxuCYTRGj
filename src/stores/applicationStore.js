import { create } from 'zustand';
import { createJourneyDraftRepository } from '../repositories/journeyDraftRepository.js';
import { createOnboardingRecordRepository } from '../repositories/onboardingRecordRepository.js';
import { toIsoTimestamp } from '../utils/dates.js';

export const DEFAULT_APPLICATION_STORE_PARTNER_CODE = 'DEMO_PARTNER';

export const APPLICATION_STORE_ERROR_CODES = Object.freeze({
  HYDRATION_FAILED: 'APPLICATION_STORE_HYDRATION_FAILED',
  APPLICATION_NOT_FOUND: 'APPLICATION_STORE_APPLICATION_NOT_FOUND',
  DRAFT_NOT_FOUND: 'APPLICATION_STORE_DRAFT_NOT_FOUND',
  REPOSITORY_UNAVAILABLE: 'APPLICATION_STORE_REPOSITORY_UNAVAILABLE',
  OPERATION_FAILED: 'APPLICATION_STORE_OPERATION_FAILED',
});

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertOptions(options, description = 'Application store options') {
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

function createApplicationStoreError(code, message, details, cause) {
  const error = new Error(message, {
    ...(cause === undefined ? {} : { cause }),
  });

  error.name = 'ApplicationStoreError';
  error.code = code;
  error.details = details ?? null;

  return error;
}

function assertRepository(repository, description) {
  if (
    !isObject(repository) ||
    typeof repository.list !== 'function' ||
    typeof repository.find !== 'function'
  ) {
    throw new TypeError(
      `${description} must provide list and find methods.`,
    );
  }

  return repository;
}

function assertRepositoryMethod(repository, method, description) {
  if (typeof repository[method] !== 'function') {
    throw createApplicationStoreError(
      APPLICATION_STORE_ERROR_CODES.REPOSITORY_UNAVAILABLE,
      `${description} does not support the "${method}" operation.`,
      {
        repository: description,
        method,
      },
    );
  }
}

function normalizeRecords(records, description) {
  if (!Array.isArray(records)) {
    throw new TypeError(`${description} must return an array.`);
  }

  return records.map((record) => cloneValue(record));
}

function createIndex(records, keySelector) {
  const index = Object.create(null);

  records.forEach((record) => {
    const key = keySelector(record);

    if (
      key === null ||
      key === undefined ||
      String(key).trim() === ''
    ) {
      return;
    }

    index[String(key)] = record;
  });

  return Object.freeze(index);
}

function buildIndexes(applications, drafts) {
  return Object.freeze({
    applicationsById: createIndex(
      applications,
      (application) => application.id,
    ),
    applicationsByApplicationId: createIndex(
      applications,
      (application) => application.applicationId,
    ),
    applicationsByTrackingId: createIndex(
      applications,
      (application) => application.trackingId,
    ),
    draftsByTrackingId: createIndex(
      drafts,
      (draft) => draft.trackingId,
    ),
    draftsByApplicationId: createIndex(
      drafts,
      (draft) => draft.applicationId,
    ),
  });
}

function findApplicationInCollection(applications, identifier) {
  const normalizedIdentifier = normalizeIdentifierForLookup(
    identifier,
    'Application identifier',
  );

  return applications.find((application) =>
    ['id', 'applicationId', 'trackingId'].some((field) => {
      const value = application[field];

      return (
        value !== null &&
        value !== undefined &&
        normalizeIdentifierForLookup(value, 'Application identifier') ===
          normalizedIdentifier
      );
    }),
  );
}

function findDraftInCollection(drafts, identifier) {
  const normalizedIdentifier = normalizeIdentifierForLookup(
    identifier,
    'Draft identifier',
  );

  return drafts.find((draft) =>
    ['trackingId', 'applicationId', 'id'].some((field) => {
      const value = draft[field];

      return (
        value !== null &&
        value !== undefined &&
        normalizeIdentifierForLookup(value, 'Draft identifier') ===
          normalizedIdentifier
      );
    }),
  );
}

function findRelatedDraft(drafts, application) {
  if (!application) {
    return undefined;
  }

  return drafts.find(
    (draft) =>
      (draft.trackingId &&
        draft.trackingId === application.trackingId) ||
      (draft.applicationId &&
        draft.applicationId === application.applicationId),
  );
}

function upsertApplication(applications, application) {
  const existingIndex = applications.findIndex(
    (candidate) =>
      candidate.applicationId === application.applicationId,
  );

  if (existingIndex < 0) {
    return [...applications, cloneValue(application)];
  }

  return applications.map((candidate, index) =>
    index === existingIndex ? cloneValue(application) : candidate,
  );
}

function upsertDraft(drafts, draft) {
  const existingIndex = drafts.findIndex(
    (candidate) => candidate.trackingId === draft.trackingId,
  );

  if (existingIndex < 0) {
    return [...drafts, cloneValue(draft)];
  }

  return drafts.map((candidate, index) =>
    index === existingIndex ? cloneValue(draft) : candidate,
  );
}

function createDataSnapshot(
  applications,
  drafts,
  selectedIdentifier,
  hydratedAt,
) {
  const normalizedApplications = applications.map((application) =>
    cloneValue(application),
  );
  const normalizedDrafts = drafts.map((draft) => cloneValue(draft));
  const selectedApplication =
    selectedIdentifier === null ||
    selectedIdentifier === undefined
      ? undefined
      : findApplicationInCollection(
          normalizedApplications,
          selectedIdentifier,
        );
  const selectedDraft =
    selectedApplication === undefined
      ? selectedIdentifier === null ||
        selectedIdentifier === undefined
        ? undefined
        : findDraftInCollection(normalizedDrafts, selectedIdentifier)
      : findRelatedDraft(normalizedDrafts, selectedApplication);
  const activeIdentifier =
    selectedApplication?.applicationId ??
    selectedDraft?.applicationId ??
    selectedDraft?.trackingId ??
    null;
  const indexes = buildIndexes(
    normalizedApplications,
    normalizedDrafts,
  );

  return {
    applications: normalizedApplications,
    records: normalizedApplications,
    drafts: normalizedDrafts,
    applicationById: indexes.applicationsById,
    applicationsById: indexes.applicationsById,
    applicationsByApplicationId:
      indexes.applicationsByApplicationId,
    applicationsByTrackingId: indexes.applicationsByTrackingId,
    draftsByTrackingId: indexes.draftsByTrackingId,
    draftsByApplicationId: indexes.draftsByApplicationId,
    selectedApplicationId: activeIdentifier,
    selectedTrackingId:
      selectedApplication?.trackingId ??
      selectedDraft?.trackingId ??
      null,
    currentApplication: selectedApplication
      ? cloneValue(selectedApplication)
      : null,
    activeApplication: selectedApplication
      ? cloneValue(selectedApplication)
      : null,
    currentDraft: selectedDraft ? cloneValue(selectedDraft) : null,
    hydratedAt,
  };
}

function normalizeHydrationOptions(options) {
  const normalizedOptions = assertOptions(
    options,
    'Application hydration options',
  );
  const hasFacadeOptions = [
    'applicationQuery',
    'recordQuery',
    'draftQuery',
    'includeDrafts',
    'selectedIdentifier',
  ].some((key) => Object.hasOwn(normalizedOptions, key));

  if (!hasFacadeOptions) {
    return {
      applicationQuery: normalizedOptions,
      draftQuery: normalizedOptions,
      includeDrafts: true,
      selectedIdentifier: undefined,
    };
  }

  return {
    applicationQuery:
      normalizedOptions.applicationQuery ??
      normalizedOptions.recordQuery ??
      {},
    draftQuery: normalizedOptions.draftQuery ?? {},
    includeDrafts: normalizedOptions.includeDrafts !== false,
    selectedIdentifier: normalizedOptions.selectedIdentifier,
  };
}

function resolveRepositories(options, partnerCode, clock) {
  const applicationRepository = assertRepository(
    options.applicationRepository ??
      options.recordRepository ??
      options.onboardingRepository ??
      createOnboardingRecordRepository({
        ...(options.storage === undefined
          ? {}
          : { storage: options.storage }),
        ...(options.namespace === undefined
          ? {}
          : { namespace: options.namespace }),
        ...(options.schemaVersion === undefined
          ? {}
          : { schemaVersion: options.schemaVersion }),
        clock,
        ...(options.onStorageError === undefined
          ? {}
          : { onStorageError: options.onStorageError }),
      }),
    'The application repository',
  );
  const draftRepository = assertRepository(
    options.draftRepository ??
      createJourneyDraftRepository({
        partnerCode,
        ...(options.storage === undefined
          ? {}
          : { storage: options.storage }),
        ...(options.namespace === undefined
          ? {}
          : { namespace: options.namespace }),
        ...(options.schemaVersion === undefined
          ? {}
          : { schemaVersion: options.schemaVersion }),
        clock,
        ...(options.onStorageError === undefined
          ? {}
          : { onStorageError: options.onStorageError }),
      }),
    'The journey draft repository',
  );

  return {
    applicationRepository,
    draftRepository,
  };
}

/**
 * Creates the canonical Zustand application store.
 *
 * @param {{
 *   partnerCode?: string,
 *   applicationRepository?: object,
 *   recordRepository?: object,
 *   onboardingRepository?: object,
 *   draftRepository?: object,
 *   storage?: Storage,
 *   namespace?: string,
 *   schemaVersion?: number,
 *   clock?: () => Date | string | number,
 *   onStorageError?: (error: object) => void
 * }} [options] Store options.
 * @returns {import('zustand').UseBoundStore<import('zustand').StoreApi<object>>}
 * Canonical application store.
 */
export function createApplicationStore(options = {}) {
  const normalizedOptions = assertOptions(options);
  const partnerCode = normalizeIdentifier(
    normalizedOptions.partnerCode ??
      DEFAULT_APPLICATION_STORE_PARTNER_CODE,
    'Partner code',
  );
  const clock = normalizedOptions.clock ?? (() => new Date());

  if (typeof clock !== 'function') {
    throw new TypeError('The application store clock must be a function.');
  }

  const { applicationRepository, draftRepository } =
    resolveRepositories(normalizedOptions, partnerCode, clock);
  const initialData = createDataSnapshot([], [], null, null);

  return create((set, get) => {
    const setOperationError = (error, operation, code) => {
      const applicationError =
        error?.name === 'ApplicationStoreError'
          ? error
          : createApplicationStoreError(
              code ?? APPLICATION_STORE_ERROR_CODES.OPERATION_FAILED,
              `Unable to ${operation} application state.`,
              { operation },
              error,
            );

      set({
        error: applicationError,
        isLoading: false,
        isHydrating: false,
      });

      return applicationError;
    };

    const applyCollections = (
      applications,
      drafts,
      selectedIdentifier,
      hydratedAt = get().hydratedAt,
    ) => {
      const snapshot = createDataSnapshot(
        applications,
        drafts,
        selectedIdentifier,
        hydratedAt,
      );

      set(snapshot);
      return snapshot;
    };

    const applyApplication = (application) => {
      const state = get();

      return applyCollections(
        upsertApplication(state.applications, application),
        state.drafts,
        application.applicationId,
      );
    };

    const applyDraft = (draft) => {
      const state = get();
      const selectedIdentifier =
        draft.applicationId ??
        draft.trackingId ??
        state.selectedApplicationId;

      return applyCollections(
        state.applications,
        upsertDraft(state.drafts, draft),
        selectedIdentifier,
      );
    };

    return {
      ...initialData,
      partnerCode,
      isHydrated: false,
      isHydrating: false,
      isLoading: false,
      error: null,

      hydrate: (hydrationOptions = {}) => {
        const normalizedHydrationOptions =
          normalizeHydrationOptions(hydrationOptions);

        set({
          isHydrating: true,
          isLoading: true,
          error: null,
        });

        try {
          const applications = normalizeRecords(
            applicationRepository.list(
              normalizedHydrationOptions.applicationQuery,
            ),
            'The application repository',
          );
          const drafts = normalizedHydrationOptions.includeDrafts
            ? normalizeRecords(
                draftRepository.list(
                  normalizedHydrationOptions.draftQuery,
                ),
                'The journey draft repository',
              )
            : [];
          const selectedIdentifier =
            normalizedHydrationOptions.selectedIdentifier ??
            get().selectedApplicationId;
          const snapshot = createDataSnapshot(
            applications,
            drafts,
            selectedIdentifier,
            toIsoTimestamp(clock()),
          );

          set({
            ...snapshot,
            isHydrated: true,
            isHydrating: false,
            isLoading: false,
            error: null,
          });

          return cloneValue(snapshot);
        } catch (error) {
          setOperationError(
            error,
            'hydrate',
            APPLICATION_STORE_ERROR_CODES.HYDRATION_FAILED,
          );
          return false;
        }
      },

      refresh: (hydrationOptions = {}) =>
        get().hydrate(hydrationOptions),

      clearError: () => {
        set({ error: null });
      },

      selectApplication: (identifier) => {
        if (identifier === null || identifier === undefined) {
          const snapshot = createDataSnapshot(
            get().applications,
            get().drafts,
            null,
            get().hydratedAt,
          );

          set({
            ...snapshot,
            error: null,
          });
          return null;
        }

        const state = get();
        const application = findApplicationInCollection(
          state.applications,
          identifier,
        );
        const draft = findDraftInCollection(state.drafts, identifier);

        if (!application && !draft) {
          const error = createApplicationStoreError(
            APPLICATION_STORE_ERROR_CODES.APPLICATION_NOT_FOUND,
            `Application state not found: ${identifier}`,
            { identifier: String(identifier) },
          );

          set({ error });
          return undefined;
        }

        const snapshot = createDataSnapshot(
          state.applications,
          state.drafts,
          identifier,
          state.hydratedAt,
        );

        set({
          ...snapshot,
          error: null,
        });

        return cloneValue(
          snapshot.currentApplication ?? snapshot.currentDraft,
        );
      },

      setActiveApplication: (identifier) =>
        get().selectApplication(identifier),

      clearSelection: () => get().selectApplication(null),

      loadApplication: (identifier) => {
        set({ isLoading: true, error: null });

        try {
          const application = applicationRepository.find(identifier);

          if (!application) {
            throw createApplicationStoreError(
              APPLICATION_STORE_ERROR_CODES.APPLICATION_NOT_FOUND,
              `Application not found: ${identifier}`,
              { identifier: String(identifier) },
            );
          }

          applyApplication(application);
          set({ isLoading: false, error: null });

          return cloneValue(application);
        } catch (error) {
          throw setOperationError(error, 'load');
        }
      },

      getApplication: (identifier) =>
        get().loadApplication(identifier),

      createApplication: (application) => {
        assertRepositoryMethod(
          applicationRepository,
          'create',
          'The application repository',
        );
        set({ isLoading: true, error: null });

        try {
          const createdApplication =
            applicationRepository.create(application);

          applyApplication(createdApplication);
          set({ isLoading: false, error: null });

          return cloneValue(createdApplication);
        } catch (error) {
          throw setOperationError(error, 'create');
        }
      },

      saveApplication: (application) => {
        assertRepositoryMethod(
          applicationRepository,
          'save',
          'The application repository',
        );
        set({ isLoading: true, error: null });

        try {
          const savedApplication =
            applicationRepository.save(application);

          applyApplication(savedApplication);
          set({ isLoading: false, error: null });

          return cloneValue(savedApplication);
        } catch (error) {
          throw setOperationError(error, 'save');
        }
      },

      updateApplication: (identifier, update, updateOptions = {}) => {
        assertRepositoryMethod(
          applicationRepository,
          'update',
          'The application repository',
        );
        set({ isLoading: true, error: null });

        try {
          const updatedApplication = applicationRepository.update(
            identifier,
            update,
            updateOptions,
          );

          applyApplication(updatedApplication);
          set({ isLoading: false, error: null });

          return cloneValue(updatedApplication);
        } catch (error) {
          throw setOperationError(error, 'update');
        }
      },

      submitApplication: (identifier, submissionOptions = {}) => {
        assertRepositoryMethod(
          applicationRepository,
          'submit',
          'The application repository',
        );
        set({ isLoading: true, error: null });

        try {
          const submittedApplication = applicationRepository.submit(
            identifier,
            submissionOptions,
          );

          applyApplication(submittedApplication);
          set({ isLoading: false, error: null });

          return cloneValue(submittedApplication);
        } catch (error) {
          throw setOperationError(error, 'submit');
        }
      },

      removeApplication: (identifier) => {
        assertRepositoryMethod(
          applicationRepository,
          'remove',
          'The application repository',
        );
        set({ isLoading: true, error: null });

        try {
          const state = get();
          const application = findApplicationInCollection(
            state.applications,
            identifier,
          );
          const removed = applicationRepository.remove(identifier);

          if (removed && application) {
            const applications = state.applications.filter(
              (candidate) =>
                candidate.applicationId !== application.applicationId,
            );
            const selectedIdentifier =
              state.selectedApplicationId === application.applicationId
                ? null
                : state.selectedApplicationId;

            applyCollections(
              applications,
              state.drafts,
              selectedIdentifier,
            );
          }

          set({ isLoading: false, error: null });
          return removed;
        } catch (error) {
          throw setOperationError(error, 'remove');
        }
      },

      loadDraft: (identifier) => {
        set({ isLoading: true, error: null });

        try {
          const draft = draftRepository.find(identifier);

          if (!draft) {
            throw createApplicationStoreError(
              APPLICATION_STORE_ERROR_CODES.DRAFT_NOT_FOUND,
              `Journey draft not found: ${identifier}`,
              { identifier: String(identifier) },
            );
          }

          applyDraft(draft);
          set({ isLoading: false, error: null });

          return cloneValue(draft);
        } catch (error) {
          throw setOperationError(error, 'load draft');
        }
      },

      getDraft: (identifier) => get().loadDraft(identifier),

      createDraft: (draft) => {
        assertRepositoryMethod(
          draftRepository,
          'create',
          'The journey draft repository',
        );
        set({ isLoading: true, error: null });

        try {
          const createdDraft = draftRepository.create(draft);

          applyDraft(createdDraft);
          set({ isLoading: false, error: null });

          return cloneValue(createdDraft);
        } catch (error) {
          throw setOperationError(error, 'create draft');
        }
      },

      saveDraft: (draftOrTrackingId, patchOrOptions = {}, options = {}) => {
        set({ isLoading: true, error: null });

        try {
          let savedDraft;

          if (
            typeof draftOrTrackingId === 'string' ||
            typeof draftOrTrackingId === 'number'
          ) {
            assertRepositoryMethod(
              draftRepository,
              'saveDraft',
              'The journey draft repository',
            );
            savedDraft = draftRepository.saveDraft(
              draftOrTrackingId,
              patchOrOptions,
              options,
            );
          } else {
            assertRepositoryMethod(
              draftRepository,
              'save',
              'The journey draft repository',
            );
            savedDraft = draftRepository.save(
              draftOrTrackingId,
              patchOrOptions,
            );
          }

          applyDraft(savedDraft);
          set({ isLoading: false, error: null });

          return cloneValue(savedDraft);
        } catch (error) {
          throw setOperationError(error, 'save draft');
        }
      },

      updateDraft: (trackingId, update, updateOptions = {}) => {
        assertRepositoryMethod(
          draftRepository,
          'update',
          'The journey draft repository',
        );
        set({ isLoading: true, error: null });

        try {
          const updatedDraft = draftRepository.update(
            trackingId,
            update,
            updateOptions,
          );

          applyDraft(updatedDraft);
          set({ isLoading: false, error: null });

          return cloneValue(updatedDraft);
        } catch (error) {
          throw setOperationError(error, 'update draft');
        }
      },

      removeDraft: (trackingId) => {
        assertRepositoryMethod(
          draftRepository,
          'remove',
          'The journey draft repository',
        );
        set({ isLoading: true, error: null });

        try {
          const state = get();
          const draft = findDraftInCollection(
            state.drafts,
            trackingId,
          );
          const removed = draftRepository.remove(trackingId);

          if (removed && draft) {
            const drafts = state.drafts.filter(
              (candidate) =>
                candidate.trackingId !== draft.trackingId,
            );

            applyCollections(
              state.applications,
              drafts,
              state.selectedApplicationId,
            );
          }

          set({ isLoading: false, error: null });
          return removed;
        } catch (error) {
          throw setOperationError(error, 'remove draft');
        }
      },

      reset: () => {
        assertRepositoryMethod(
          applicationRepository,
          'reset',
          'The application repository',
        );
        assertRepositoryMethod(
          draftRepository,
          'reset',
          'The journey draft repository',
        );
        set({ isLoading: true, error: null });

        try {
          applicationRepository.reset();
          draftRepository.reset();

          const snapshot = createDataSnapshot([], [], null, null);

          set({
            ...snapshot,
            isHydrated: false,
            isHydrating: false,
            isLoading: false,
            error: null,
          });

          return true;
        } catch (error) {
          throw setOperationError(error, 'reset');
        }
      },
    };
  });
}

export const createCanonicalApplicationStore = createApplicationStore;
export const useApplicationStore = createApplicationStore();

export const selectApplications = (state) => state.applications;
export const selectApplicationRecords = (state) => state.records;
export const selectJourneyDrafts = (state) => state.drafts;
export const selectCurrentApplication = (state) =>
  state.currentApplication;
export const selectActiveApplication = (state) =>
  state.activeApplication;
export const selectCurrentDraft = (state) => state.currentDraft;
export const selectSelectedApplicationId = (state) =>
  state.selectedApplicationId;
export const selectSelectedTrackingId = (state) =>
  state.selectedTrackingId;
export const selectApplicationStoreHydrated = (state) =>
  state.isHydrated;
export const selectApplicationStoreLoading = (state) =>
  state.isLoading || state.isHydrating;
export const selectApplicationStoreError = (state) => state.error;
export const selectApplicationById = (identifier) => (state) => {
  if (
    identifier === null ||
    identifier === undefined ||
    String(identifier).trim() === ''
  ) {
    return undefined;
  }

  return findApplicationInCollection(state.applications, identifier);
};
export const selectDraftByTrackingId = (trackingId) => (state) => {
  if (
    trackingId === null ||
    trackingId === undefined ||
    String(trackingId).trim() === ''
  ) {
    return undefined;
  }

  return findDraftInCollection(state.drafts, trackingId);
};

export default useApplicationStore;