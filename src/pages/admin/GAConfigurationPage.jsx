import { useCallback, useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { canPerformAction } from '../../auth/permissionPolicy.js';
import JsonViewer from '../../components/shared/JsonViewer.jsx';
import StatusBadge from '../../components/shared/StatusBadge.jsx';
import { PERMISSIONS } from '../../constants/roles.js';
import { createConfigRepository } from '../../repositories/configRepository.js';
import { useAuthStore } from '../../stores/authStore.js';

const APPOINTMENT_MODELS = Object.freeze([
  { label: 'Just in time', value: 'JUST_IN_TIME' },
  { label: 'Pre-appointment', value: 'PRE_APPOINTMENT' },
  { label: 'Hybrid', value: 'HYBRID' },
]);

const AML_REVIEW_LEVELS = Object.freeze([
  { label: 'Low risk and above', value: 'LOW' },
  { label: 'Medium risk and above', value: 'MEDIUM' },
  { label: 'High risk only', value: 'HIGH' },
]);

const REVIEW_MODES = Object.freeze([
  { label: 'Automatic when eligible', value: 'AUTO' },
  { label: 'Agency review', value: 'AGENCY' },
  { label: 'Manager review', value: 'MANAGER' },
  { label: 'Agency and manager review', value: 'AGENCY_MANAGER' },
]);

const optionalTextSchema = z.string().trim().optional().or(z.literal(''));
const requiredTextSchema = (message) => z.string().trim().min(1, message);
const commaSeparatedSchema = z.string().trim().optional().or(z.literal(''));
const optionalNumberSchema = (minimum, maximum, message) =>
  z.preprocess(
    (value) =>
      value === '' || value === null || value === undefined
        ? undefined
        : Number(value),
    z
      .number({
        invalid_type_error: message,
      })
      .finite(message)
      .min(minimum, message)
      .max(maximum, message)
      .optional(),
  );

export const gaConfigurationFormSchema = z
  .object({
    agencyTypes: commaSeparatedSchema,
    forms: z
      .object({
        requiredForms: commaSeparatedSchema,
        optionalForms: commaSeparatedSchema,
        requireElectronicSignature: z.boolean().default(true),
        retainGeneralAgencySignature: z.boolean().default(false),
      })
      .passthrough(),
    schedules: z
      .object({
        enabledSchedules: commaSeparatedSchema,
        defaultSchedule: optionalTextSchema,
      })
      .passthrough(),
    levels: z
      .object({
        enabledLevels: commaSeparatedSchema,
        defaultLevel: optionalTextSchema,
        maximumLevel: optionalTextSchema,
      })
      .passthrough(),
    hierarchy: z
      .object({
        defaultUplineCode: optionalTextSchema,
        requireResolvedHierarchy: z.boolean().default(true),
        allowPartnerOverrides: z.boolean().default(false),
        allowBulkChanges: z.boolean().default(false),
      })
      .passthrough(),
    advances: z
      .object({
        enabled: z.boolean().default(false),
        maximumPercent: optionalNumberSchema(
          0,
          100,
          'Maximum advance percentage must be between 0 and 100.',
        ),
        requireApproval: z.boolean().default(true),
        prohibitAbncaAdvance: z.boolean().default(true),
      })
      .passthrough(),
    aml: z
      .object({
        enabled: z.boolean().default(true),
        providerCode: requiredTextSchema('AML provider code is required.'),
        manualReviewThreshold: z.enum(['LOW', 'MEDIUM', 'HIGH']),
        blockConfirmedMatches: z.boolean().default(true),
      })
      .passthrough(),
    appointments: z
      .object({
        enabled: z.boolean().default(true),
        model: z.enum(['JUST_IN_TIME', 'PRE_APPOINTMENT', 'HYBRID']),
        providerCode: requiredTextSchema(
          'Appointment provider code is required.',
        ),
        autoSubmitEligible: z.boolean().default(true),
        reuseActiveAppointments: z.boolean().default(true),
      })
      .passthrough(),
    notifications: z
      .object({
        emailEnabled: z.boolean().default(true),
        inAppEnabled: z.boolean().default(true),
        smsEnabled: z.boolean().default(false),
        remindersEnabled: z.boolean().default(true),
        reminderIntervalHours: optionalNumberSchema(
          1,
          720,
          'Reminder interval must be between 1 and 720 hours.',
        ),
        agencyCopyEnabled: z.boolean().default(true),
      })
      .passthrough(),
    vectorOne: z
      .object({
        enabled: z.boolean().default(false),
        requireClearance: z.boolean().default(false),
        reviewWindowDays: optionalNumberSchema(
          1,
          3650,
          'Vector One review window must be between 1 and 3,650 days.',
        ),
        manualReviewOnMatch: z.boolean().default(true),
      })
      .passthrough(),
    review: z
      .object({
        mode: z.enum(['AUTO', 'AGENCY', 'MANAGER', 'AGENCY_MANAGER']),
        requireAgencyReview: z.boolean().default(false),
        requireManagerReview: z.boolean().default(false),
        autoApproveEligible: z.boolean().default(false),
        blockCarrierSubmission: z.boolean().default(true),
      })
      .passthrough(),
  })
  .superRefine((values, context) => {
    if (
      values.advances.enabled &&
      values.advances.maximumPercent === undefined
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Enter a maximum advance percentage when advances are enabled.',
        path: ['advances', 'maximumPercent'],
      });
    }

    if (
      values.notifications.remindersEnabled &&
      values.notifications.reminderIntervalHours === undefined
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Enter a reminder interval when reminders are enabled.',
        path: ['notifications', 'reminderIntervalHours'],
      });
    }

    if (
      values.vectorOne.enabled &&
      values.vectorOne.reviewWindowDays === undefined
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Enter a review window when Vector One checks are enabled.',
        path: ['vectorOne', 'reviewWindowDays'],
      });
    }
  });

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
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

function normalizeListValue(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) =>
        isObject(item) ? item.code ?? item.id ?? item.name : item,
      )
      .filter(
        (item) =>
          item !== null &&
          item !== undefined &&
          String(item).trim() !== '',
      )
      .join(', ');
  }

  if (value === null || value === undefined) {
    return '';
  }

  return String(value);
}

function parseListValue(value) {
  return [
    ...new Set(
      String(value ?? '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

function getErrorAtPath(errors, path) {
  return String(path)
    .split('.')
    .reduce((value, segment) => value?.[segment], errors);
}

function createPrincipal(authState) {
  const currentUser = authState.currentUser ?? authState.user;
  const role = authState.role ?? currentUser?.role ?? null;

  return {
    ...authState,
    user: currentUser,
    currentUser,
    role,
    partnerContext: authState.partnerContext,
    isAuthenticated: authState.isAuthenticated,
    status: authState.isAuthenticated
      ? 'authenticated'
      : 'anonymous',
  };
}

function createFormValues(generalAgency) {
  const forms = isObject(generalAgency?.forms)
    ? generalAgency.forms
    : {};
  const schedules = isObject(generalAgency?.schedules)
    ? generalAgency.schedules
    : {};
  const levels = isObject(generalAgency?.levels)
    ? generalAgency.levels
    : {};
  const hierarchy = isObject(generalAgency?.hierarchy)
    ? generalAgency.hierarchy
    : {};
  const advances = isObject(generalAgency?.advances)
    ? generalAgency.advances
    : {};
  const aml = isObject(generalAgency?.aml)
    ? generalAgency.aml
    : {};
  const appointments = isObject(generalAgency?.appointments)
    ? generalAgency.appointments
    : {};
  const notifications = isObject(generalAgency?.notifications)
    ? generalAgency.notifications
    : {};
  const vectorOne = isObject(generalAgency?.vectorOne)
    ? generalAgency.vectorOne
    : {};
  const review = isObject(generalAgency?.review)
    ? generalAgency.review
    : {};

  return {
    agencyTypes: normalizeListValue(
      generalAgency?.agencyTypes ??
        generalAgency?.allowedAgencyTypes ??
        [],
    ),
    forms: {
      requiredForms: normalizeListValue(
        forms.requiredForms ?? generalAgency?.requiredForms ?? [],
      ),
      optionalForms: normalizeListValue(forms.optionalForms ?? []),
      requireElectronicSignature:
        forms.requireElectronicSignature !== false,
      retainGeneralAgencySignature:
        forms.retainGeneralAgencySignature === true,
    },
    schedules: {
      enabledSchedules: normalizeListValue(
        schedules.enabledSchedules ??
          generalAgency?.scheduleCodes ??
          [],
      ),
      defaultSchedule: schedules.defaultSchedule ?? '',
    },
    levels: {
      enabledLevels: normalizeListValue(
        levels.enabledLevels ?? generalAgency?.levelCodes ?? [],
      ),
      defaultLevel: levels.defaultLevel ?? '',
      maximumLevel: levels.maximumLevel ?? '',
    },
    hierarchy: {
      defaultUplineCode: hierarchy.defaultUplineCode ?? '',
      requireResolvedHierarchy:
        hierarchy.requireResolvedHierarchy !== false,
      allowPartnerOverrides:
        hierarchy.allowPartnerOverrides === true,
      allowBulkChanges: hierarchy.allowBulkChanges === true,
    },
    advances: {
      enabled: advances.enabled === true,
      maximumPercent: advances.maximumPercent ?? '',
      requireApproval: advances.requireApproval !== false,
      prohibitAbncaAdvance:
        advances.prohibitAbncaAdvance !== false,
    },
    aml: {
      enabled: aml.enabled !== false,
      providerCode: aml.providerCode ?? 'AML_DEMO',
      manualReviewThreshold:
        aml.manualReviewThreshold ?? 'MEDIUM',
      blockConfirmedMatches:
        aml.blockConfirmedMatches !== false,
    },
    appointments: {
      enabled: appointments.enabled !== false,
      model: appointments.model ?? 'JUST_IN_TIME',
      providerCode:
        appointments.providerCode ?? 'SIRCON_VERTAFORE',
      autoSubmitEligible:
        appointments.autoSubmitEligible !== false,
      reuseActiveAppointments:
        appointments.reuseActiveAppointments !== false,
    },
    notifications: {
      emailEnabled: notifications.emailEnabled !== false,
      inAppEnabled: notifications.inAppEnabled !== false,
      smsEnabled: notifications.smsEnabled === true,
      remindersEnabled:
        notifications.remindersEnabled !== false,
      reminderIntervalHours:
        notifications.reminderIntervalHours ?? 24,
      agencyCopyEnabled:
        notifications.agencyCopyEnabled !== false,
    },
    vectorOne: {
      enabled: vectorOne.enabled === true,
      requireClearance: vectorOne.requireClearance === true,
      reviewWindowDays: vectorOne.reviewWindowDays ?? 365,
      manualReviewOnMatch:
        vectorOne.manualReviewOnMatch !== false,
    },
    review: {
      mode: review.mode ?? 'AGENCY',
      requireAgencyReview:
        review.requireAgencyReview === true,
      requireManagerReview:
        review.requireManagerReview === true,
      autoApproveEligible:
        review.autoApproveEligible === true,
      blockCarrierSubmission:
        review.blockCarrierSubmission !== false,
    },
  };
}

function createConfigurationOverride(values) {
  return {
    agencyTypes: parseListValue(values.agencyTypes),
    forms: {
      ...values.forms,
      requiredForms: parseListValue(values.forms.requiredForms),
      optionalForms: parseListValue(values.forms.optionalForms),
    },
    schedules: {
      ...values.schedules,
      enabledSchedules: parseListValue(
        values.schedules.enabledSchedules,
      ),
    },
    levels: {
      ...values.levels,
      enabledLevels: parseListValue(values.levels.enabledLevels),
    },
    hierarchy: cloneValue(values.hierarchy),
    advances: cloneValue(values.advances),
    aml: cloneValue(values.aml),
    appointments: cloneValue(values.appointments),
    notifications: cloneValue(values.notifications),
    vectorOne: cloneValue(values.vectorOne),
    review: cloneValue(values.review),
  };
}

function FieldError({ error, id }) {
  if (!error?.message) {
    return null;
  }

  return (
    <p
      className="mt-1 text-sm text-danger dark:text-red-200"
      id={id}
      role="alert"
    >
      {error.message}
    </p>
  );
}

FieldError.propTypes = {
  error: PropTypes.shape({
    message: PropTypes.string,
  }),
  id: PropTypes.string.isRequired,
};

function ConfigurationSection({ children, description, title }) {
  return (
    <fieldset className="rounded-xl border border-border p-4 sm:p-5 dark:border-slate-700">
      <legend className="px-1 text-lg font-semibold text-lga-navy dark:text-white">
        {title}
      </legend>
      <p className="mb-4 mt-1 text-sm leading-6 text-text-muted dark:text-slate-300">
        {description}
      </p>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

ConfigurationSection.propTypes = {
  children: PropTypes.node.isRequired,
  description: PropTypes.node.isRequired,
  title: PropTypes.node.isRequired,
};

function TextField({
  error,
  helpText,
  id,
  label,
  register,
  required = false,
  type = 'text',
}) {
  const errorId = `${id}-error`;
  const helpId = `${id}-help`;
  const describedBy = [
    helpText ? helpId : null,
    error?.message ? errorId : null,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div>
      <label
        className="block text-sm font-medium text-text dark:text-slate-100"
        htmlFor={id}
      >
        {label}
        {required && (
          <span aria-hidden="true" className="ml-1 text-danger">
            *
          </span>
        )}
      </label>
      <input
        {...register}
        aria-describedby={describedBy || undefined}
        aria-invalid={Boolean(error)}
        className="mt-1 min-h-11 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text shadow-sm placeholder:text-slate-400 focus:border-lga-sky focus:outline-none focus:ring-2 focus:ring-lga-sky disabled:cursor-not-allowed disabled:bg-surface-muted disabled:opacity-70 dark:border-slate-600 dark:bg-slate-900 dark:text-white dark:disabled:bg-slate-800"
        id={id}
        type={type}
      />
      {helpText && (
        <p
          className="mt-1 text-xs leading-5 text-text-muted dark:text-slate-400"
          id={helpId}
        >
          {helpText}
        </p>
      )}
      <FieldError error={error} id={errorId} />
    </div>
  );
}

TextField.propTypes = {
  error: PropTypes.shape({
    message: PropTypes.string,
  }),
  helpText: PropTypes.node,
  id: PropTypes.string.isRequired,
  label: PropTypes.node.isRequired,
  register: PropTypes.object.isRequired,
  required: PropTypes.bool,
  type: PropTypes.string,
};

function SelectField({
  error,
  id,
  label,
  options,
  register,
  required = false,
}) {
  const errorId = `${id}-error`;

  return (
    <div>
      <label
        className="block text-sm font-medium text-text dark:text-slate-100"
        htmlFor={id}
      >
        {label}
        {required && (
          <span aria-hidden="true" className="ml-1 text-danger">
            *
          </span>
        )}
      </label>
      <select
        {...register}
        aria-describedby={error?.message ? errorId : undefined}
        aria-invalid={Boolean(error)}
        className="mt-1 min-h-11 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text shadow-sm focus:border-lga-sky focus:outline-none focus:ring-2 focus:ring-lga-sky disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
        id={id}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <FieldError error={error} id={errorId} />
    </div>
  );
}

SelectField.propTypes = {
  error: PropTypes.shape({
    message: PropTypes.string,
  }),
  id: PropTypes.string.isRequired,
  label: PropTypes.node.isRequired,
  options: PropTypes.arrayOf(
    PropTypes.shape({
      label: PropTypes.string.isRequired,
      value: PropTypes.string.isRequired,
    }),
  ).isRequired,
  register: PropTypes.object.isRequired,
  required: PropTypes.bool,
};

function CheckboxField({ helpText, id, label, register }) {
  return (
    <label
      className="flex min-h-11 items-start gap-3 rounded-lg border border-border bg-surface-muted px-4 py-3 text-sm text-text sm:col-span-2 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
      htmlFor={id}
    >
      <input
        {...register}
        className="mt-0.5 size-5 shrink-0 rounded border-border text-lga-navy focus:ring-2 focus:ring-lga-sky disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900"
        id={id}
        type="checkbox"
      />
      <span>
        <span className="font-medium">{label}</span>
        {helpText && (
          <span className="mt-1 block text-xs leading-5 text-text-muted dark:text-slate-400">
            {helpText}
          </span>
        )}
      </span>
    </label>
  );
}

CheckboxField.propTypes = {
  helpText: PropTypes.node,
  id: PropTypes.string.isRequired,
  label: PropTypes.node.isRequired,
  register: PropTypes.object.isRequired,
};

/**
 * Provides administrative controls for general agency onboarding settings.
 */
export function GAConfigurationPage({
  configRepository: suppliedRepository,
}) {
  const authState = useAuthStore();
  const principal = useMemo(
    () => createPrincipal(authState),
    [authState],
  );
  const authorized =
    authState.isAuthenticated &&
    canPerformAction(
      principal,
      PERMISSIONS.MANAGE_CONFIGURATION,
    );
  const repository = useMemo(
    () => suppliedRepository ?? createConfigRepository(),
    [suppliedRepository],
  );
  const [generalAgencies, setGeneralAgencies] = useState([]);
  const [selectedCode, setSelectedCode] = useState('');
  const [savedConfiguration, setSavedConfiguration] =
    useState(null);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const {
    formState: { errors, isDirty, isSubmitting },
    handleSubmit,
    register,
    reset,
  } = useForm({
    defaultValues: createFormValues(null),
    resolver: zodResolver(gaConfigurationFormSchema),
    mode: 'onBlur',
  });
  const selectedAgency = useMemo(
    () =>
      generalAgencies.find(
        (generalAgency) => generalAgency.code === selectedCode,
      ) ?? null,
    [generalAgencies, selectedCode],
  );

  const loadConfiguration = useCallback(() => {
    if (!authorized) {
      setGeneralAgencies([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setPageError('');
    setActionMessage('');

    try {
      const agencies = repository.listGeneralAgencies();

      if (!Array.isArray(agencies)) {
        throw new TypeError(
          'The configuration repository returned an invalid general agency collection.',
        );
      }

      setGeneralAgencies(agencies);
      setSelectedCode((currentCode) => {
        if (
          currentCode &&
          agencies.some((agency) => agency.code === currentCode)
        ) {
          return currentCode;
        }

        return agencies[0]?.code ?? '';
      });
    } catch (error) {
      setGeneralAgencies([]);
      setSelectedCode('');
      setPageError(
        error instanceof Error && error.message
          ? error.message
          : 'General agency configuration could not be loaded.',
      );
    } finally {
      setLoading(false);
    }
  }, [authorized, repository]);

  useEffect(() => {
    loadConfiguration();
  }, [loadConfiguration]);

  useEffect(() => {
    reset(createFormValues(selectedAgency));
    setSavedConfiguration(null);
    setActionMessage('');
  }, [reset, selectedAgency]);

  const saveConfiguration = async (values) => {
    if (!selectedAgency) {
      setPageError('Select a general agency before saving.');
      return;
    }

    setPageError('');
    setActionMessage('');

    try {
      const override = createConfigurationOverride(values);
      const updatedAgency = await Promise.resolve(
        repository.setGeneralAgencyOverride(
          selectedAgency.code,
          override,
        ),
      );

      setGeneralAgencies((currentAgencies) =>
        currentAgencies.map((agency) =>
          agency.code === updatedAgency.code
            ? cloneValue(updatedAgency)
            : agency,
        ),
      );
      setSavedConfiguration(cloneValue(updatedAgency));
      reset(createFormValues(updatedAgency));
      setActionMessage(
        `Configuration for ${updatedAgency.name} was saved.`,
      );
    } catch (error) {
      setPageError(
        error instanceof Error && error.message
          ? error.message
          : 'The general agency configuration could not be saved.',
      );
    }
  };

  const removeOverride = async () => {
    if (!selectedAgency) {
      return;
    }

    setPageError('');
    setActionMessage('');

    try {
      await Promise.resolve(
        repository.removeGeneralAgencyOverride(selectedAgency.code),
      );
      const refreshedAgency = repository.getGeneralAgencySettings(
        selectedAgency.code,
      );

      setGeneralAgencies((currentAgencies) =>
        currentAgencies.map((agency) =>
          agency.code === refreshedAgency.code
            ? cloneValue(refreshedAgency)
            : agency,
        ),
      );
      setSavedConfiguration(null);
      reset(createFormValues(refreshedAgency));
      setActionMessage(
        `Overrides for ${refreshedAgency.name} were removed.`,
      );
    } catch (error) {
      setPageError(
        error instanceof Error && error.message
          ? error.message
          : 'The general agency overrides could not be removed.',
      );
    }
  };

  if (!authorized) {
    return (
      <section
        aria-labelledby="ga-configuration-denied-title"
        className="mx-auto max-w-3xl rounded-xl border border-danger bg-danger-light p-6 text-danger-dark shadow-card dark:border-red-700 dark:bg-danger-dark dark:text-red-100"
        role="alert"
      >
        <h1
          className="text-xl font-semibold"
          id="ga-configuration-denied-title"
        >
          General agency configuration access is unavailable
        </h1>
        <p className="mt-2 text-sm leading-6">
          An authenticated administrator with configuration management
          permission is required to use this page.
        </p>
      </section>
    );
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-7">
      <header className="overflow-hidden rounded-2xl bg-lga-navy text-white shadow-elevated">
        <div className="grid gap-6 px-6 py-7 sm:px-8 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <div className="flex flex-wrap gap-2">
              <StatusBadge
                label="GA configuration"
                showDot={false}
                tone="accent"
              />
              <StatusBadge
                label="Administrator"
                showDot={false}
                tone="info"
              />
              <StatusBadge label="Simulation" showDot={false} simulation />
            </div>
            <h1 className="mt-4 text-2xl font-semibold sm:text-3xl">
              General agency onboarding configuration
            </h1>
            <p className="mt-3 max-w-4xl text-sm leading-6 text-primary-100 sm:text-base">
              Configure agency types, forms, schedules, levels, hierarchy,
              advances, AML, appointments, notifications, Vector One, and
              review behavior for a general agency.
            </p>
          </div>

          <button
            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-white/50 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-lga-navy disabled:cursor-not-allowed disabled:opacity-50"
            disabled={loading || isSubmitting}
            onClick={loadConfiguration}
            type="button"
          >
            {loading ? 'Refreshing…' : 'Refresh configuration'}
          </button>
        </div>
      </header>

      <aside
        className="rounded-xl border border-accent-300 bg-accent-100 p-4 text-sm leading-6 text-accent-950 dark:border-accent-700 dark:bg-accent-950 dark:text-accent-100"
        role="note"
      >
        Configuration changes affect simulated onboarding behavior and are
        stored locally in this browser. Use synthetic codes, forms, schedules,
        providers, and hierarchy values only.
      </aside>

      {pageError && (
        <div
          className="rounded-xl border border-danger bg-danger-light p-4 text-sm text-danger-dark dark:border-red-700 dark:bg-danger-dark dark:text-red-100"
          role="alert"
        >
          <p className="font-semibold">
            The configuration action could not continue
          </p>
          <p className="mt-1">{pageError}</p>
        </div>
      )}

      <div aria-live="polite" className="sr-only" role="status">
        {actionMessage}
      </div>

      <section
        aria-labelledby="ga-selection-title"
        className="rounded-xl border border-border bg-white p-5 shadow-card sm:p-6 dark:border-slate-700 dark:bg-slate-900"
      >
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div>
            <label
              className="block text-sm font-medium text-text dark:text-slate-100"
              htmlFor="ga-configuration-selection"
              id="ga-selection-title"
            >
              General agency
            </label>
            <select
              className="mt-1 min-h-11 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text shadow-sm focus:border-lga-sky focus:outline-none focus:ring-2 focus:ring-lga-sky disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
              disabled={loading || isSubmitting}
              id="ga-configuration-selection"
              onChange={(event) => {
                setSelectedCode(event.target.value);
                setPageError('');
              }}
              value={selectedCode}
            >
              {generalAgencies.length === 0 && (
                <option value="">No general agencies available</option>
              )}
              {generalAgencies.map((generalAgency) => (
                <option
                  key={generalAgency.code}
                  value={generalAgency.code}
                >
                  {generalAgency.name} — {generalAgency.code}
                </option>
              ))}
            </select>
          </div>

          {selectedAgency && (
            <div className="flex flex-wrap gap-2">
              <StatusBadge
                showDot={false}
                status={selectedAgency.status}
              />
              {selectedAgency.type && (
                <StatusBadge
                  label={selectedAgency.type}
                  showDot={false}
                  tone="info"
                />
              )}
            </div>
          )}
        </div>
      </section>

      {loading ? (
        <section
          aria-busy="true"
          className="rounded-xl border border-border bg-white px-5 py-12 text-center text-sm text-text-muted shadow-card dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
          role="status"
        >
          Loading general agency configuration…
        </section>
      ) : selectedAgency ? (
        <form
          className="space-y-6"
          noValidate
          onSubmit={handleSubmit(saveConfiguration)}
        >
          <section
            aria-labelledby="ga-configuration-form-title"
            className="overflow-hidden rounded-xl border border-border bg-white shadow-card dark:border-slate-700 dark:bg-slate-900"
          >
            <div className="border-b border-border px-5 py-4 sm:px-6 dark:border-slate-700">
              <h2
                className="text-xl font-semibold text-lga-navy dark:text-white"
                id="ga-configuration-form-title"
              >
                {selectedAgency.name}
              </h2>
              <p className="mt-1 text-sm text-text-muted dark:text-slate-300">
                Code: {selectedAgency.code}. Fields marked with an asterisk
                are required.
              </p>
            </div>

            <fieldset
              className="space-y-6 p-5 sm:p-6"
              disabled={isSubmitting}
            >
              <legend className="sr-only">
                General agency configuration settings
              </legend>

              <ConfigurationSection
                description="Control which agency arrangements can use this general agency."
                title="Agency types"
              >
                <div className="sm:col-span-2">
                  <TextField
                    error={getErrorAtPath(errors, 'agencyTypes')}
                    helpText="Enter comma-separated agency type codes, for example BGA, IMO, DIRECT."
                    id="ga-agency-types"
                    label="Allowed agency types"
                    register={register('agencyTypes')}
                  />
                </div>
              </ConfigurationSection>

              <ConfigurationSection
                description="Select package forms and electronic-signature behavior."
                title="Forms and signatures"
              >
                <TextField
                  error={getErrorAtPath(
                    errors,
                    'forms.requiredForms',
                  )}
                  helpText="Comma-separated form codes."
                  id="ga-required-forms"
                  label="Required forms"
                  register={register('forms.requiredForms')}
                />
                <TextField
                  error={getErrorAtPath(
                    errors,
                    'forms.optionalForms',
                  )}
                  helpText="Comma-separated form codes."
                  id="ga-optional-forms"
                  label="Optional forms"
                  register={register('forms.optionalForms')}
                />
                <CheckboxField
                  helpText="Require the applicant to electronically sign the generated package."
                  id="ga-require-esign"
                  label="Require electronic signature"
                  register={register(
                    'forms.requireElectronicSignature',
                  )}
                />
                <CheckboxField
                  helpText="Reuse a valid retained general agency signature when available."
                  id="ga-retain-signature"
                  label="Retain general agency signature"
                  register={register(
                    'forms.retainGeneralAgencySignature',
                  )}
                />
              </ConfigurationSection>

              <ConfigurationSection
                description="Configure available commission schedules and contracting levels."
                title="Schedules and levels"
              >
                <TextField
                  error={getErrorAtPath(
                    errors,
                    'schedules.enabledSchedules',
                  )}
                  helpText="Comma-separated schedule codes."
                  id="ga-enabled-schedules"
                  label="Enabled schedules"
                  register={register(
                    'schedules.enabledSchedules',
                  )}
                />
                <TextField
                  error={getErrorAtPath(
                    errors,
                    'schedules.defaultSchedule',
                  )}
                  id="ga-default-schedule"
                  label="Default schedule"
                  register={register('schedules.defaultSchedule')}
                />
                <TextField
                  error={getErrorAtPath(
                    errors,
                    'levels.enabledLevels',
                  )}
                  helpText="Comma-separated level codes."
                  id="ga-enabled-levels"
                  label="Enabled contract levels"
                  register={register('levels.enabledLevels')}
                />
                <TextField
                  error={getErrorAtPath(
                    errors,
                    'levels.defaultLevel',
                  )}
                  id="ga-default-level"
                  label="Default contract level"
                  register={register('levels.defaultLevel')}
                />
                <TextField
                  error={getErrorAtPath(
                    errors,
                    'levels.maximumLevel',
                  )}
                  id="ga-maximum-level"
                  label="Maximum contract level"
                  register={register('levels.maximumLevel')}
                />
              </ConfigurationSection>

              <ConfigurationSection
                description="Set default uplines and control hierarchy changes."
                title="Hierarchy"
              >
                <TextField
                  error={getErrorAtPath(
                    errors,
                    'hierarchy.defaultUplineCode',
                  )}
                  id="ga-default-upline"
                  label="Default upline code"
                  register={register(
                    'hierarchy.defaultUplineCode',
                  )}
                />
                <CheckboxField
                  helpText="Block eligible processing until a hierarchy can be resolved."
                  id="ga-require-hierarchy"
                  label="Require a resolved hierarchy"
                  register={register(
                    'hierarchy.requireResolvedHierarchy',
                  )}
                />
                <CheckboxField
                  helpText="Allow authorized partner users to request hierarchy overrides."
                  id="ga-allow-hierarchy-overrides"
                  label="Allow partner hierarchy overrides"
                  register={register(
                    'hierarchy.allowPartnerOverrides',
                  )}
                />
                <CheckboxField
                  helpText="Bulk changes may still be routed for manual review."
                  id="ga-allow-bulk-hierarchy"
                  label="Allow bulk hierarchy changes"
                  register={register(
                    'hierarchy.allowBulkChanges',
                  )}
                />
              </ConfigurationSection>

              <ConfigurationSection
                description="Configure advance commission availability and approval rules."
                title="Advance commissions"
              >
                <CheckboxField
                  id="ga-advances-enabled"
                  label="Enable advance commissions"
                  register={register('advances.enabled')}
                />
                <TextField
                  error={getErrorAtPath(
                    errors,
                    'advances.maximumPercent',
                  )}
                  helpText="Enter a value from 0 to 100."
                  id="ga-advance-maximum"
                  label="Maximum advance percentage"
                  register={register('advances.maximumPercent')}
                  type="number"
                />
                <CheckboxField
                  id="ga-advance-approval"
                  label="Require advance approval"
                  register={register('advances.requireApproval')}
                />
                <CheckboxField
                  helpText="ABNCA schedules cannot receive advance commission."
                  id="ga-abnca-advance"
                  label="Prohibit ABNCA advances"
                  register={register(
                    'advances.prohibitAbncaAdvance',
                  )}
                />
              </ConfigurationSection>

              <ConfigurationSection
                description="Configure anti-money laundering screening and match handling."
                title="AML screening"
              >
                <CheckboxField
                  id="ga-aml-enabled"
                  label="Enable AML screening"
                  register={register('aml.enabled')}
                />
                <TextField
                  error={getErrorAtPath(errors, 'aml.providerCode')}
                  id="ga-aml-provider"
                  label="AML provider code"
                  register={register('aml.providerCode')}
                  required
                />
                <SelectField
                  error={getErrorAtPath(
                    errors,
                    'aml.manualReviewThreshold',
                  )}
                  id="ga-aml-threshold"
                  label="Manual review threshold"
                  options={AML_REVIEW_LEVELS}
                  register={register(
                    'aml.manualReviewThreshold',
                  )}
                  required
                />
                <CheckboxField
                  id="ga-aml-block-matches"
                  label="Block confirmed AML matches"
                  register={register(
                    'aml.blockConfirmedMatches',
                  )}
                />
              </ConfigurationSection>

              <ConfigurationSection
                description="Configure appointment provider routing, reuse, and automatic submission."
                title="Appointments"
              >
                <CheckboxField
                  id="ga-appointments-enabled"
                  label="Enable carrier appointments"
                  register={register('appointments.enabled')}
                />
                <SelectField
                  error={getErrorAtPath(
                    errors,
                    'appointments.model',
                  )}
                  id="ga-appointment-model"
                  label="Appointment model"
                  options={APPOINTMENT_MODELS}
                  register={register('appointments.model')}
                  required
                />
                <TextField
                  error={getErrorAtPath(
                    errors,
                    'appointments.providerCode',
                  )}
                  id="ga-appointment-provider"
                  label="Appointment provider code"
                  register={register(
                    'appointments.providerCode',
                  )}
                  required
                />
                <CheckboxField
                  id="ga-appointment-auto-submit"
                  label="Automatically submit eligible appointments"
                  register={register(
                    'appointments.autoSubmitEligible',
                  )}
                />
                <CheckboxField
                  id="ga-appointment-reuse"
                  label="Reuse active appointments"
                  register={register(
                    'appointments.reuseActiveAppointments',
                  )}
                />
              </ConfigurationSection>

              <ConfigurationSection
                description="Configure simulated delivery channels, reminders, and agency copies."
                title="Notifications"
              >
                <CheckboxField
                  id="ga-notification-email"
                  label="Enable email notifications"
                  register={register(
                    'notifications.emailEnabled',
                  )}
                />
                <CheckboxField
                  id="ga-notification-in-app"
                  label="Enable in-app notifications"
                  register={register(
                    'notifications.inAppEnabled',
                  )}
                />
                <CheckboxField
                  id="ga-notification-sms"
                  label="Enable SMS notifications"
                  register={register(
                    'notifications.smsEnabled',
                  )}
                />
                <CheckboxField
                  id="ga-notification-reminders"
                  label="Enable onboarding reminders"
                  register={register(
                    'notifications.remindersEnabled',
                  )}
                />
                <TextField
                  error={getErrorAtPath(
                    errors,
                    'notifications.reminderIntervalHours',
                  )}
                  helpText="Hours between reminder previews."
                  id="ga-reminder-interval"
                  label="Reminder interval in hours"
                  register={register(
                    'notifications.reminderIntervalHours',
                  )}
                  type="number"
                />
                <CheckboxField
                  id="ga-notification-agency-copy"
                  label="Send agency notification copies"
                  register={register(
                    'notifications.agencyCopyEnabled',
                  )}
                />
              </ConfigurationSection>

              <ConfigurationSection
                description="Configure synthetic Vector One clearance and review behavior."
                title="Vector One"
              >
                <CheckboxField
                  id="ga-vector-one-enabled"
                  label="Enable Vector One checks"
                  register={register('vectorOne.enabled')}
                />
                <CheckboxField
                  id="ga-vector-one-clearance"
                  label="Require Vector One clearance"
                  register={register(
                    'vectorOne.requireClearance',
                  )}
                />
                <TextField
                  error={getErrorAtPath(
                    errors,
                    'vectorOne.reviewWindowDays',
                  )}
                  helpText="Number of historical days included in the review."
                  id="ga-vector-one-window"
                  label="Review window in days"
                  register={register(
                    'vectorOne.reviewWindowDays',
                  )}
                  type="number"
                />
                <CheckboxField
                  id="ga-vector-one-review"
                  label="Route Vector One matches for manual review"
                  register={register(
                    'vectorOne.manualReviewOnMatch',
                  )}
                />
              </ConfigurationSection>

              <ConfigurationSection
                description="Control agency, manager, and automatic approval gates."
                title="Review settings"
              >
                <SelectField
                  error={getErrorAtPath(errors, 'review.mode')}
                  id="ga-review-mode"
                  label="Default review mode"
                  options={REVIEW_MODES}
                  register={register('review.mode')}
                  required
                />
                <CheckboxField
                  id="ga-agency-review"
                  label="Require agency review"
                  register={register(
                    'review.requireAgencyReview',
                  )}
                />
                <CheckboxField
                  id="ga-manager-review"
                  label="Require manager review"
                  register={register(
                    'review.requireManagerReview',
                  )}
                />
                <CheckboxField
                  id="ga-auto-approve"
                  label="Automatically approve eligible applications"
                  register={register(
                    'review.autoApproveEligible',
                  )}
                />
                <CheckboxField
                  helpText="Prevent carrier submission while a required review remains open."
                  id="ga-block-submission"
                  label="Block carrier submission during review"
                  register={register(
                    'review.blockCarrierSubmission',
                  )}
                />
              </ConfigurationSection>
            </fieldset>

            <div className="flex flex-col gap-3 border-t border-border bg-surface-muted px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 dark:border-slate-700 dark:bg-slate-800">
              <p className="text-xs text-text-muted dark:text-slate-400">
                {isDirty
                  ? 'You have unsaved configuration changes.'
                  : 'All displayed changes are saved.'}
              </p>
              <div className="flex flex-col gap-3 sm:flex-row">
                <button
                  className="inline-flex min-h-11 items-center justify-center rounded-lg border border-border bg-white px-5 py-2 text-sm font-semibold text-lga-navy transition-colors hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-lga-sky focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-white dark:hover:bg-slate-700"
                  disabled={isSubmitting}
                  onClick={removeOverride}
                  type="button"
                >
                  Reset GA overrides
                </button>
                <button
                  className="inline-flex min-h-11 items-center justify-center rounded-lg bg-lga-navy px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-800 focus:outline-none focus:ring-2 focus:ring-lga-sky focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-primary-600 dark:hover:bg-primary-500"
                  disabled={isSubmitting || !isDirty}
                  type="submit"
                >
                  {isSubmitting
                    ? 'Saving configuration…'
                    : 'Save GA configuration'}
                </button>
              </div>
            </div>
          </section>
        </form>
      ) : (
        <section
          className="rounded-xl border border-dashed border-border-strong bg-white px-5 py-12 text-center shadow-card dark:border-slate-600 dark:bg-slate-900"
          role="status"
        >
          <h2 className="font-semibold text-lga-navy dark:text-white">
            No general agency configuration is available
          </h2>
          <p className="mt-2 text-sm text-text-muted dark:text-slate-300">
            Add or restore general agency reference data before configuring
            onboarding behavior.
          </p>
        </section>
      )}

      {savedConfiguration && (
        <section aria-labelledby="saved-ga-configuration-title">
          <h2
            className="mb-4 text-xl font-semibold text-lga-navy dark:text-white"
            id="saved-ga-configuration-title"
          >
            Saved configuration preview
          </h2>
          <JsonViewer
            data={savedConfiguration}
            fileName={`ga-configuration-${savedConfiguration.code}.json`}
            redact
            title="Effective GA configuration"
          />
        </section>
      )}
    </div>
  );
}

GAConfigurationPage.propTypes = {
  configRepository: PropTypes.shape({
    getGeneralAgencySettings: PropTypes.func.isRequired,
    listGeneralAgencies: PropTypes.func.isRequired,
    removeGeneralAgencyOverride: PropTypes.func.isRequired,
    setGeneralAgencyOverride: PropTypes.func.isRequired,
  }),
};

export default GAConfigurationPage;