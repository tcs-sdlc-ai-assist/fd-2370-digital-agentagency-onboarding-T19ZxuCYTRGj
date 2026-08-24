import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, vi } from 'vitest';

export const DEFAULT_TEST_TIME = '2026-08-24T12:00:00.000Z';

let objectUrlSequence = 0;

function normalizeTestDate(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new RangeError('Test time must be a valid date.');
  }

  return date;
}

/**
 * Enables fake timers and sets the deterministic system time.
 *
 * @param {Date | string | number} [value] Test system time.
 * @returns {Date} The configured system time.
 */
export function setTestTime(value = DEFAULT_TEST_TIME) {
  const date = normalizeTestDate(value);

  vi.useFakeTimers();
  vi.setSystemTime(date);

  return new Date(date.getTime());
}

/**
 * Advances fake timers by a number of milliseconds.
 *
 * @param {number} milliseconds Milliseconds to advance.
 * @returns {void}
 */
export function advanceTestTime(milliseconds) {
  if (
    typeof milliseconds !== 'number' ||
    !Number.isFinite(milliseconds) ||
    milliseconds < 0
  ) {
    throw new RangeError(
      'Test time advancement must be a nonnegative number.',
    );
  }

  vi.advanceTimersByTime(milliseconds);
}

/**
 * Restores real timers.
 *
 * @returns {void}
 */
export function resetTestTime() {
  vi.useRealTimers();
}

/**
 * Clears browser storage used by tests.
 *
 * @returns {void}
 */
export function clearTestStorage() {
  globalThis.localStorage.clear();
  globalThis.sessionStorage.clear();
}

export const freezeTime = setTestTime;
export const useDeterministicTime = setTestTime;
export const restoreRealTime = resetTestTime;

export class MockResizeObserver {
  constructor(callback) {
    if (typeof callback !== 'function') {
      throw new TypeError('ResizeObserver callback must be a function.');
    }

    this.callback = callback;
    this.elements = new Set();
    this.observe = vi.fn((element) => {
      this.elements.add(element);
    });
    this.unobserve = vi.fn((element) => {
      this.elements.delete(element);
    });
    this.disconnect = vi.fn(() => {
      this.elements.clear();
    });
  }

  trigger(entries = []) {
    if (!Array.isArray(entries)) {
      throw new TypeError('ResizeObserver entries must be an array.');
    }

    this.callback(entries, this);
  }
}

export class MockIntersectionObserver {
  constructor(callback, options = {}) {
    if (typeof callback !== 'function') {
      throw new TypeError(
        'IntersectionObserver callback must be a function.',
      );
    }

    this.callback = callback;
    this.root = options.root ?? null;
    this.rootMargin = options.rootMargin ?? '0px';
    this.thresholds = Array.isArray(options.threshold)
      ? [...options.threshold]
      : [options.threshold ?? 0];
    this.elements = new Set();
    this.observe = vi.fn((element) => {
      this.elements.add(element);
    });
    this.unobserve = vi.fn((element) => {
      this.elements.delete(element);
    });
    this.disconnect = vi.fn(() => {
      this.elements.clear();
    });
    this.takeRecords = vi.fn(() => []);
  }

  trigger(entries = []) {
    if (!Array.isArray(entries)) {
      throw new TypeError(
        'IntersectionObserver entries must be an array.',
      );
    }

    this.callback(entries, this);
  }
}

function createMatchMedia(query) {
  const listeners = new Set();

  return {
    matches: false,
    media: String(query),
    onchange: null,
    addListener: vi.fn((listener) => {
      listeners.add(listener);
    }),
    removeListener: vi.fn((listener) => {
      listeners.delete(listener);
    }),
    addEventListener: vi.fn((type, listener) => {
      if (type === 'change') {
        listeners.add(listener);
      }
    }),
    removeEventListener: vi.fn((type, listener) => {
      if (type === 'change') {
        listeners.delete(listener);
      }
    }),
    dispatchEvent: vi.fn((event) => {
      listeners.forEach((listener) => {
        listener(event);
      });

      return true;
    }),
  };
}

export const matchMediaMock = vi.fn(createMatchMedia);
export const createObjectUrlMock = vi.fn(
  () => `blob:vitest-mock-${objectUrlSequence++}`,
);
export const revokeObjectUrlMock = vi.fn();
export const scrollToMock = vi.fn();
export const scrollIntoViewMock = vi.fn();

Object.defineProperty(globalThis, 'ResizeObserver', {
  configurable: true,
  value: MockResizeObserver,
  writable: true,
});

Object.defineProperty(globalThis, 'IntersectionObserver', {
  configurable: true,
  value: MockIntersectionObserver,
  writable: true,
});

Object.defineProperty(globalThis.window, 'matchMedia', {
  configurable: true,
  value: matchMediaMock,
  writable: true,
});

Object.defineProperty(globalThis.window, 'scrollTo', {
  configurable: true,
  value: scrollToMock,
  writable: true,
});

Object.defineProperty(globalThis.HTMLElement.prototype, 'scrollIntoView', {
  configurable: true,
  value: scrollIntoViewMock,
  writable: true,
});

Object.defineProperty(globalThis.URL, 'createObjectURL', {
  configurable: true,
  value: createObjectUrlMock,
  writable: true,
});

Object.defineProperty(globalThis.URL, 'revokeObjectURL', {
  configurable: true,
  value: revokeObjectUrlMock,
  writable: true,
});

Object.defineProperty(globalThis.navigator, 'clipboard', {
  configurable: true,
  value: {
    readText: vi.fn(() => Promise.resolve('')),
    writeText: vi.fn(() => Promise.resolve()),
  },
});

beforeEach(() => {
  objectUrlSequence = 0;
  clearTestStorage();
  vi.clearAllMocks();
});

afterEach(() => {
  clearTestStorage();
  resetTestTime();
  vi.clearAllMocks();
});