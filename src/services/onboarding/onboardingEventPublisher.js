import { toIsoTimestamp } from '../../utils/dates.js';
import {
  createDeterministicId,
  generateCorrelationId,
} from '../../utils/ids.js';

export const ONBOARDING_EVENT_NAMES = Object.freeze({
  APPLICATION_SUBMITTED: 'onboarding:application-submitted',
  APPLICATION_EXCEPTION_ROUTED:
    'onboarding:application-exception-routed',
  CHANGE_REQUEST_SUBMITTED: 'onboarding:change-request-submitted',
});

export const ONBOARDING_EVENT_TYPES = ONBOARDING_EVENT_NAMES;

export const ONBOARDING_EVENT_PUBLISHER_ERROR_CODES = Object.freeze({
  INVALID_OPTIONS: 'ONBOARDING_EVENT_PUBLISHER_INVALID_OPTIONS',
  INVALID_TARGET: 'ONBOARDING_EVENT_PUBLISHER_INVALID_TARGET',
  INVALID_PAYLOAD: 'ONBOARDING_EVENT_PUBLISHER_INVALID_PAYLOAD',
  PUBLISH_FAILED: 'ONBOARDING_EVENT_PUBLISHER_PUBLISH_FAILED',
});

export const ONBOARDING_EVENT_SCHEMA_VERSION = 1;

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertOptions(
  options,
  description = 'Onboarding event publisher options',
) {
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

function normalizeOptionalIdentifier(value, description = 'Identifier') {
  if (value === null || value === undefined) {
    return null;
  }

  return normalizeIdentifier(value, description);
}

function normalizeIdentifierArray(values, description) {
  if (values === undefined) {
    return [];
  }

  if (!Array.isArray(values)) {
    throw new TypeError(`${description} must be an array.`);
  }

  return [
    ...new Set(
      values.map((value) =>
        normalizeIdentifier(value, `${description} entry`),
      ),
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

function deepFreeze(value, visited = new WeakSet()) {
  if (
    value === null ||
    typeof value !== 'object' ||
    visited.has(value)
  ) {
    return value;
  }

  visited.add(value);

  Object.values(value).forEach((nestedValue) => {
    deepFreeze(nestedValue, visited);
  });

  return Object.freeze(value);
}

function createPublisherError(code, message, details, cause) {
  const error = new Error(message, {
    ...(cause === undefined ? {} : { cause }),
  });

  error.name = 'OnboardingEventPublisherError';
  error.code = code;
  error.details = details ?? null;
  error.recoverable = true;

  return error;
}

function createDefaultEventTarget() {
  if (
    typeof globalThis.window !== 'undefined' &&
    typeof globalThis.window.dispatchEvent === 'function'
  ) {
    return globalThis.window;
  }

  if (
    typeof globalThis.document !== 'undefined' &&
    typeof globalThis.document.dispatchEvent === 'function'
  ) {
    return globalThis.document;
  }

  if (typeof EventTarget === 'function') {
    return new EventTarget();
  }

  return null;
}

function assertEventTarget(target) {
  if (
    !target ||
    typeof target.dispatchEvent !== 'function' ||
    typeof target.addEventListener !== 'function' ||
    typeof target.removeEventListener !== 'function'
  ) {
    throw createPublisherError(
      ONBOARDING_EVENT_PUBLISHER_ERROR_CODES.INVALID_TARGET,
      'The onboarding event target must provide browser EventTarget methods.',
      null,
    );
  }

  return target;
}

function getCustomEventConstructor(target) {
  const targetWindow =
    target?.window === target
      ? target
      : target?.ownerDocument?.defaultView;

  if (typeof targetWindow?.CustomEvent === 'function') {
    return targetWindow.CustomEvent;
  }

  if (typeof globalThis.CustomEvent === 'function') {
    return globalThis.CustomEvent;
  }

  return null;
}

function getEventConstructor(target) {
  const targetWindow =
    target?.window === target
      ? target
      : target?.ownerDocument?.defaultView;

  if (typeof targetWindow?.Event === 'function') {
    return targetWindow.Event;
  }

  if (typeof globalThis.Event === 'function') {
    return globalThis.Event;
  }

  return null;
}

function createDomainEvent(target, eventName, detail) {
  const CustomEventConstructor = getCustomEventConstructor(target);

  if (CustomEventConstructor) {
    return new CustomEventConstructor(eventName, {
      detail,
      bubbles: false,
      cancelable: false,
      composed: false,
    });
  }

  const EventConstructor = getEventConstructor(target);

  if (!EventConstructor) {
    throw createPublisherError(
      ONBOARDING_EVENT_PUBLISHER_ERROR_CODES.INVALID_TARGET,
      'The environment cannot create browser domain events.',
      { eventName },
    );
  }

  const event = new EventConstructor(eventName, {
    bubbles: false,
    cancelable: false,
  });

  Object.defineProperty(event, 'detail', {
    configurable: false,
    enumerable: true,
    value: detail,
    writable: false,
  });

  return event;
}

function normalizeApplicationSubmittedPayload(payload) {
  if (!isObject(payload)) {
    throw createPublisherError(
      ONBOARDING_EVENT_PUBLISHER_ERROR_CODES.INVALID_PAYLOAD,
      'An application submitted event payload must be an object.',
      null,
    );
  }

  return {
    ...cloneValue(payload),
    applicationId: normalizeIdentifier(
      payload.applicationId,
      'Application identifier',
    ),
    trackingId: normalizeIdentifier(
      payload.trackingId,
      'Tracking identifier',
    ),
    submittedBy: normalizeOptionalIdentifier(
      payload.submittedBy,
      'Submitting actor identifier',
    ),
    validationCodes: normalizeIdentifierArray(
      payload.validationCodes,
      'Application validation codes',
    ),
  };
}

function normalizeApplicationExceptionPayload(payload) {
  if (!isObject(payload)) {
    throw createPublisherError(
      ONBOARDING_EVENT_PUBLISHER_ERROR_CODES.INVALID_PAYLOAD,
      'An application exception event payload must be an object.',
      null,
    );
  }

  const validationCodes = normalizeIdentifierArray(
    payload.validationCodes ?? payload.exceptionCodes,
    'Application exception codes',
  );

  if (
    validationCodes.length === 0 &&
    payload.exceptionCode === undefined &&
    payload.reason === undefined
  ) {
    throw createPublisherError(
      ONBOARDING_EVENT_PUBLISHER_ERROR_CODES.INVALID_PAYLOAD,
      'An exception code, validation code, or routing reason is required.',
      {
        applicationId: payload.applicationId ?? null,
        trackingId: payload.trackingId ?? null,
      },
    );
  }

  return {
    ...cloneValue(payload),
    applicationId: normalizeIdentifier(
      payload.applicationId,
      'Application identifier',
    ),
    trackingId: normalizeIdentifier(
      payload.trackingId,
      'Tracking identifier',
    ),
    exceptionCode:
      payload.exceptionCode === undefined
        ? null
        : normalizeIdentifier(
            payload.exceptionCode,
            'Application exception code',
          ),
    validationCodes,
    workItemId: normalizeOptionalIdentifier(
      payload.workItemId,
      'Exception work item identifier',
    ),
    routedTo: normalizeOptionalIdentifier(
      payload.routedTo ?? payload.assignedGroup,
      'Exception routing destination',
    ),
  };
}

function normalizeChangeRequestSubmittedPayload(payload) {
  if (!isObject(payload)) {
    throw createPublisherError(
      ONBOARDING_EVENT_PUBLISHER_ERROR_CODES.INVALID_PAYLOAD,
      'A change request submitted event payload must be an object.',
      null,
    );
  }

  return {
    ...cloneValue(payload),
    changeRequestId: normalizeIdentifier(
      payload.changeRequestId,
      'Change request identifier',
    ),
    trackingId: normalizeOptionalIdentifier(
      payload.trackingId,
      'Tracking identifier',
    ),
    partnerCode: normalizeIdentifier(
      payload.partnerCode,
      'Partner code',
    ),
    changeType: normalizeIdentifier(
      payload.changeType,
      'Change request type',
    ),
    requestedBy: normalizeIdentifier(
      payload.requestedBy,
      'Requesting actor identifier',
    ),
    validationCodes: normalizeIdentifierArray(
      payload.validationCodes ?? payload.outcome?.validationCodes,
      'Change request validation codes',
    ),
  };
}

/**
 * Publishes browser-domain handoff events for onboarding state changes.
 */
export class OnboardingEventPublisher {
  /**
   * @param {{
   *   target?: EventTarget,
   *   clock?: () => Date | string | number,
   *   source?: string
   * }} [options] Publisher options.
   */
  constructor(options = {}) {
    const normalizedOptions = assertOptions(options);

    if (
      normalizedOptions.clock !== undefined &&
      typeof normalizedOptions.clock !== 'function'
    ) {
      throw new TypeError('The onboarding event clock must be a function.');
    }

    this.target = assertEventTarget(
      normalizedOptions.target ?? createDefaultEventTarget(),
    );
    this.clock = normalizedOptions.clock ?? (() => new Date());
    this.source = normalizeIdentifier(
      normalizedOptions.source ?? 'digital-onboarding',
      'Onboarding event source',
    );
  }

  /**
   * Publishes an application-submitted handoff event.
   *
   * @param {object} payload Submitted application details.
   * @param {object} [options] Publication options.
   * @returns {object} Published event envelope.
   */
  publishApplicationSubmitted(payload, options = {}) {
    return this.publish(
      ONBOARDING_EVENT_NAMES.APPLICATION_SUBMITTED,
      normalizeApplicationSubmittedPayload(payload),
      options,
    );
  }

  /**
   * Publishes an exception-routing handoff event.
   *
   * @param {object} payload Routed application exception details.
   * @param {object} [options] Publication options.
   * @returns {object} Published event envelope.
   */
  publishApplicationExceptionRouted(payload, options = {}) {
    return this.publish(
      ONBOARDING_EVENT_NAMES.APPLICATION_EXCEPTION_ROUTED,
      normalizeApplicationExceptionPayload(payload),
      options,
    );
  }

  /**
   * Publishes a change-request-submitted handoff event.
   *
   * @param {object} payload Submitted change request details.
   * @param {object} [options] Publication options.
   * @returns {object} Published event envelope.
   */
  publishChangeRequestSubmitted(payload, options = {}) {
    return this.publish(
      ONBOARDING_EVENT_NAMES.CHANGE_REQUEST_SUBMITTED,
      normalizeChangeRequestSubmittedPayload(payload),
      options,
    );
  }

  /**
   * Publishes a normalized browser domain event.
   *
   * @param {string} eventName Browser event name.
   * @param {object} payload Event payload.
   * @param {{
   *   eventId?: string,
   *   correlationId?: string,
   *   occurredAt?: Date | string | number,
   *   source?: string,
   *   metadata?: Record<string, unknown>
   * }} [options] Publication options.
   * @returns {object} Published event envelope.
   */
  publish(eventName, payload, options = {}) {
    const normalizedEventName = normalizeIdentifier(
      eventName,
      'Onboarding event name',
    );
    const normalizedOptions = assertOptions(
      options,
      'Onboarding event publication options',
    );

    if (!isObject(payload)) {
      throw createPublisherError(
        ONBOARDING_EVENT_PUBLISHER_ERROR_CODES.INVALID_PAYLOAD,
        'An onboarding event payload must be an object.',
        { eventName: normalizedEventName },
      );
    }

    if (
      normalizedOptions.metadata !== undefined &&
      !isObject(normalizedOptions.metadata)
    ) {
      throw new TypeError('Onboarding event metadata must be an object.');
    }

    try {
      const occurredAt = toIsoTimestamp(
        normalizedOptions.occurredAt ?? this.clock(),
      );
      const source = normalizeIdentifier(
        normalizedOptions.source ?? this.source,
        'Onboarding event source',
      );
      const correlationId = normalizeIdentifier(
        normalizedOptions.correlationId ??
          payload.correlationId ??
          generateCorrelationId({
            eventName: normalizedEventName,
            occurredAt,
            payload,
            source,
          }),
        'Onboarding event correlation identifier',
      );
      const eventId = normalizeIdentifier(
        normalizedOptions.eventId ??
          createDeterministicId(
            'EVT',
            {
              eventName: normalizedEventName,
              occurredAt,
              correlationId,
              payload,
              source,
            },
            { length: 16 },
          ),
        'Onboarding event identifier',
      );
      const normalizedPayload = cloneValue(payload);
      const envelope = deepFreeze({
        schemaVersion: ONBOARDING_EVENT_SCHEMA_VERSION,
        eventId,
        eventName: normalizedEventName,
        type: normalizedEventName,
        source,
        correlationId,
        occurredAt,
        ...normalizedPayload,
        payload: normalizedPayload,
        metadata: cloneValue(normalizedOptions.metadata ?? {}),
      });
      const event = createDomainEvent(
        this.target,
        normalizedEventName,
        envelope,
      );

      this.target.dispatchEvent(event);

      return cloneValue(envelope);
    } catch (error) {
      if (
        error?.name === 'OnboardingEventPublisherError' ||
        error instanceof TypeError ||
        error instanceof RangeError
      ) {
        throw error;
      }

      throw createPublisherError(
        ONBOARDING_EVENT_PUBLISHER_ERROR_CODES.PUBLISH_FAILED,
        `Unable to publish onboarding event: ${normalizedEventName}.`,
        { eventName: normalizedEventName },
        error,
      );
    }
  }

  /**
   * Subscribes to an onboarding domain event.
   *
   * @param {string} eventName Browser event name.
   * @param {(event: CustomEvent) => void} listener Event listener.
   * @param {boolean | AddEventListenerOptions} [options] Listener options.
   * @returns {() => void} Unsubscribe function.
   */
  subscribe(eventName, listener, options) {
    const normalizedEventName = normalizeIdentifier(
      eventName,
      'Onboarding event name',
    );

    if (typeof listener !== 'function') {
      throw new TypeError(
        'The onboarding event listener must be a function.',
      );
    }

    this.target.addEventListener(
      normalizedEventName,
      listener,
      options,
    );

    return () => {
      this.target.removeEventListener(
        normalizedEventName,
        listener,
        options,
      );
    };
  }
}

/**
 * Creates an onboarding event publisher.
 *
 * @param {ConstructorParameters<typeof OnboardingEventPublisher>[0]}
 * [options] Publisher options.
 * @returns {OnboardingEventPublisher} Event publisher.
 */
export function createOnboardingEventPublisher(options = {}) {
  return new OnboardingEventPublisher(options);
}

export const onboardingEventPublisher =
  createOnboardingEventPublisher();

/**
 * Publishes an application-submitted event with the shared publisher.
 *
 * @param {object} payload Submitted application details.
 * @param {object} [options] Publication options.
 * @returns {object} Published event envelope.
 */
export function publishApplicationSubmitted(payload, options = {}) {
  return onboardingEventPublisher.publishApplicationSubmitted(
    payload,
    options,
  );
}

/**
 * Publishes an application-exception-routed event.
 *
 * @param {object} payload Routed exception details.
 * @param {object} [options] Publication options.
 * @returns {object} Published event envelope.
 */
export function publishApplicationExceptionRouted(
  payload,
  options = {},
) {
  return onboardingEventPublisher.publishApplicationExceptionRouted(
    payload,
    options,
  );
}

/**
 * Publishes a change-request-submitted event.
 *
 * @param {object} payload Submitted change request details.
 * @param {object} [options] Publication options.
 * @returns {object} Published event envelope.
 */
export function publishChangeRequestSubmitted(payload, options = {}) {
  return onboardingEventPublisher.publishChangeRequestSubmitted(
    payload,
    options,
  );
}

export const OnboardingDomainEventPublisher =
  OnboardingEventPublisher;
export const createOnboardingDomainEventPublisher =
  createOnboardingEventPublisher;

export default OnboardingEventPublisher;