import { beforeEach, describe, expect, it } from 'vitest';
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_STATUSES,
  NOTIFICATION_TYPES,
} from '../../repositories/notificationRepository.js';
import {
  PARTNER_SCOPE_TYPES,
  ROLES,
} from '../../constants/roles.js';
import {
  createNotificationVisibilityService,
  NOTIFICATION_VISIBILITY_ERROR_CODES,
} from './notificationVisibilityService.js';

const TEST_TIME = '2026-08-24T12:00:00.000Z';
const PARTNER_CODE = 'DEMO_PARTNER';

function createPrincipal(
  role = ROLES.PARTNER,
  userId = 'usr_partner_demo',
  partnerContext = {},
) {
  return {
    isAuthenticated: true,
    status: 'authenticated',
    role,
    user: {
      id: userId,
      role,
      partnerCode: partnerContext.partnerCode,
    },
    partnerContext: {
      ...partnerContext,
    },
  };
}

function createPartnerPrincipal() {
  return createPrincipal(ROLES.PARTNER, 'usr_partner_demo', {
    partnerCode: PARTNER_CODE,
    scopeType: PARTNER_SCOPE_TYPES.OWN_ORGANIZATION,
  });
}

function createAdminPrincipal() {
  return createPrincipal(ROLES.ADMIN, 'usr_admin_demo', {
    scopeType: PARTNER_SCOPE_TYPES.GLOBAL,
  });
}

function createService(principal = createPartnerPrincipal(), options = {}) {
  return createNotificationVisibilityService({
    principal,
    partnerContext: principal.partnerContext,
    storage: globalThis.localStorage,
    clock: () => new Date(TEST_TIME),
    auditService: false,
    ...options,
  });
}

function createPreviewRequest(overrides = {}) {
  return {
    trackingId: 'TRK-NOTIFICATION-TEST-1001',
    partnerCode: PARTNER_CODE,
    recipientMasked: 'j***@example.test',
    previewPayload: {
      subject: 'Synthetic onboarding notification',
      message: 'This is a synthetic notification preview.',
    },
    ...overrides,
  };
}

beforeEach(() => {
  globalThis.localStorage.clear();
});

describe('NotificationVisibilityService', () => {
  it('returns only notifications within the authenticated partner scope', () => {
    const principal = createPartnerPrincipal();
    const service = createService(principal);
    const response = service.search(
      {
        page: 1,
        pageSize: 100,
      },
      principal,
    );

    expect(response.total).toBeGreaterThan(0);
    expect(response.notifications).toHaveLength(response.total);
    expect(
      response.notifications.every(
        (notification) =>
          notification.partnerCode === PARTNER_CODE,
      ),
    ).toBe(true);
    expect(response.notifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          notificationId: 'NTF-DEMO-1001',
          partnerCode: PARTNER_CODE,
          type: NOTIFICATION_TYPES.REMINDER,
        }),
        expect.objectContaining({
          notificationId: 'NTF-DEMO-1010',
          partnerCode: PARTNER_CODE,
          channel: NOTIFICATION_CHANNELS.SMS,
        }),
      ]),
    );
    expect(response.notifications).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          partnerCode: 'QUILITY',
        }),
      ]),
    );
  });

  it('filters role-visible logs by preferred email and SMS channels', () => {
    const principal = createPartnerPrincipal();
    const service = createService(principal);
    const trackingId = 'TRK-NOTIFICATION-CHANNELS-1001';

    const emailPreview = service.createPreview(
      createPreviewRequest({
        trackingId,
        channel: NOTIFICATION_CHANNELS.EMAIL,
        type: NOTIFICATION_TYPES.STATUS_UPDATE,
        templateCode: 'SYNTHETIC_EMAIL_STATUS',
      }),
      principal,
    );
    const smsPreview = service.createPreview(
      createPreviewRequest({
        trackingId,
        channel: NOTIFICATION_CHANNELS.SMS,
        type: NOTIFICATION_TYPES.STATUS_UPDATE,
        recipientMasked: '(***) ***-1001',
        templateCode: 'SYNTHETIC_SMS_STATUS',
      }),
      principal,
    );

    const emailResponse = service.search(
      {
        trackingId,
        channels: [NOTIFICATION_CHANNELS.EMAIL],
        page: 1,
        pageSize: 25,
      },
      principal,
    );
    const smsResponse = service.search(
      {
        trackingId,
        channels: [NOTIFICATION_CHANNELS.SMS],
        page: 1,
        pageSize: 25,
      },
      principal,
    );

    expect(emailPreview).toEqual(
      expect.objectContaining({
        trackingId,
        channel: NOTIFICATION_CHANNELS.EMAIL,
        status: NOTIFICATION_STATUSES.PREVIEWED,
      }),
    );
    expect(smsPreview).toEqual(
      expect.objectContaining({
        trackingId,
        channel: NOTIFICATION_CHANNELS.SMS,
        status: NOTIFICATION_STATUSES.PREVIEWED,
      }),
    );
    expect(emailResponse.notifications).toEqual([
      expect.objectContaining({
        notificationId: emailPreview.notificationId,
        channel: NOTIFICATION_CHANNELS.EMAIL,
      }),
    ]);
    expect(smsResponse.notifications).toEqual([
      expect.objectContaining({
        notificationId: smsPreview.notificationId,
        channel: NOTIFICATION_CHANNELS.SMS,
      }),
    ]);
  });

  it('creates reminder previews and evaluates the configured reminder interval', () => {
    let currentTime = Date.parse(TEST_TIME);
    const clock = () => new Date(currentTime);
    const principal = createPartnerPrincipal();
    const service = createService(principal, { clock });
    const trackingId = 'TRK-NOTIFICATION-REMINDER-1001';

    const reminder = service.createReminderPreview(
      createPreviewRequest({
        trackingId,
        previewPayload: {
          subject: 'Resume your synthetic onboarding journey',
          currentStep: 'Licensing',
        },
      }),
      principal,
    );
    const initialFlags = service.getVisibilityFlags(
      trackingId,
      principal,
      {
        reminderIntervalHours: 24,
      },
    );

    expect(reminder).toEqual(
      expect.objectContaining({
        trackingId,
        channel: NOTIFICATION_CHANNELS.EMAIL,
        type: NOTIFICATION_TYPES.REMINDER,
        templateCode: 'ONBOARDING_DRAFT_REMINDER',
        status: NOTIFICATION_STATUSES.PREVIEWED,
      }),
    );
    expect(initialFlags).toEqual(
      expect.objectContaining({
        trackingId,
        hasReminder: true,
        reminderDue: false,
        latestReminderAt: TEST_TIME,
        notificationCount: 1,
      }),
    );

    currentTime += 25 * 60 * 60 * 1000;

    const laterFlags = service.getVisibilityFlags(
      trackingId,
      principal,
      {
        reminderIntervalHours: 24,
      },
    );

    expect(laterFlags.reminderDue).toBe(true);
  });

  it('creates welcome email and agency-copy previews and exposes their visibility flags', () => {
    const principal = createPartnerPrincipal();
    const service = createService(principal);
    const trackingId = 'TRK-NOTIFICATION-WELCOME-1001';

    const welcome = service.createWelcomeEmailPreview(
      createPreviewRequest({
        trackingId,
        templateCode: 'SYNTHETIC_PRODUCER_WELCOME',
        previewPayload: {
          subject: 'Welcome to the synthetic onboarding program',
        },
      }),
      principal,
    );
    const agencyCopy = service.createAgencyCopyPreview(
      createPreviewRequest({
        trackingId,
        recipientMasked: 'a***@example.test',
        previewPayload: {
          subject: 'Synthetic agency notification copy',
        },
      }),
      principal,
    );
    const flags = service.getVisibilityFlags(
      trackingId,
      principal,
    );
    const response = service.search(
      {
        trackingId,
        types: [
          NOTIFICATION_TYPES.WELCOME,
          NOTIFICATION_TYPES.AGENCY_COPY,
        ],
        page: 1,
        pageSize: 25,
      },
      principal,
    );

    expect(welcome).toEqual(
      expect.objectContaining({
        channel: NOTIFICATION_CHANNELS.EMAIL,
        type: NOTIFICATION_TYPES.WELCOME,
        templateCode: 'SYNTHETIC_PRODUCER_WELCOME',
      }),
    );
    expect(agencyCopy).toEqual(
      expect.objectContaining({
        channel: NOTIFICATION_CHANNELS.EMAIL,
        type: NOTIFICATION_TYPES.AGENCY_COPY,
        templateCode: 'AGENCY_NOTIFICATION_COPY',
      }),
    );
    expect(flags).toEqual(
      expect.objectContaining({
        hasWelcomeNotification: true,
        hasWelcomeEmail: true,
        hasAgencyCopy: true,
        notificationCount: 2,
      }),
    );
    expect(response.notifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          notificationId: welcome.notificationId,
          type: NOTIFICATION_TYPES.WELCOME,
        }),
        expect.objectContaining({
          notificationId: agencyCopy.notificationId,
          type: NOTIFICATION_TYPES.AGENCY_COPY,
        }),
      ]),
    );
  });

  it('blocks carrier submission until the agency review is completed', () => {
    let currentTime = Date.parse(TEST_TIME);
    const clock = () => new Date(currentTime);
    const principal = createPartnerPrincipal();
    const service = createService(principal, { clock });
    const trackingId = 'TRK-NOTIFICATION-AGENCY-REVIEW-1001';

    const reviewRequest = service.requestAgencyReview(
      createPreviewRequest({
        trackingId,
        recipientMasked: 'a***@example.test',
        previewPayload: {
          subject: 'Synthetic agency review requested',
        },
      }),
      principal,
    );
    const pendingFlags = service.getVisibilityFlags(
      trackingId,
      principal,
    );

    expect(reviewRequest).toEqual(
      expect.objectContaining({
        type: NOTIFICATION_TYPES.AGENCY_REVIEW_REQUEST,
        templateCode: 'AGENCY_REVIEW_REQUEST',
        status: NOTIFICATION_STATUSES.QUEUED,
        previewPayload: expect.objectContaining({
          submissionBlocked: true,
        }),
      }),
    );
    expect(pendingFlags).toEqual(
      expect.objectContaining({
        carrierSubmissionBlocked: true,
        agencyReviewPending: true,
        hasAgencyReviewRequest: true,
        hasAgencyReviewCompletion: false,
      }),
    );
    expect(
      service.shouldBlockCarrierSubmission(
        trackingId,
        principal,
      ),
    ).toBe(true);

    currentTime += 1_000;

    const completion = service.completeAgencyReview(
      createPreviewRequest({
        trackingId,
        channel: NOTIFICATION_CHANNELS.IN_APP,
        recipientMasked: `partner:${PARTNER_CODE}`,
        previewPayload: {
          title: 'Synthetic agency review completed',
        },
      }),
      principal,
    );
    const completedFlags = service.getVisibilityFlags(
      trackingId,
      principal,
    );

    expect(completion).toEqual(
      expect.objectContaining({
        channel: NOTIFICATION_CHANNELS.IN_APP,
        type: NOTIFICATION_TYPES.AGENCY_REVIEW_COMPLETED,
        templateCode: 'AGENCY_REVIEW_COMPLETED',
        previewPayload: expect.objectContaining({
          submissionBlocked: false,
        }),
      }),
    );
    expect(completedFlags).toEqual(
      expect.objectContaining({
        carrierSubmissionBlocked: false,
        agencyReviewPending: false,
        hasAgencyReviewRequest: true,
        hasAgencyReviewCompletion: true,
      }),
    );
    expect(
      service.shouldBlockCarrierSubmission(
        trackingId,
        principal,
      ),
    ).toBe(false);
  });

  it('allows an administrator to view notification logs across partners', () => {
    const principal = createAdminPrincipal();
    const service = createService(principal);
    const response = service.search(
      {
        page: 1,
        pageSize: 100,
      },
      principal,
    );
    const partnerCodes = new Set(
      response.notifications.map(
        (notification) => notification.partnerCode,
      ),
    );

    expect(partnerCodes.size).toBeGreaterThan(1);
    expect(partnerCodes).toEqual(
      expect.objectContaining(
        new Set([PARTNER_CODE, 'QUILITY', 'ETHOS']),
      ),
    );
  });

  it('rejects unauthenticated notification searches', () => {
    const principal = {
      isAuthenticated: false,
      status: 'anonymous',
      role: null,
      user: null,
      partnerContext: null,
    };
    const service = createService(createAdminPrincipal(), {
      requireAuthorization: true,
    });

    expect(() =>
      service.search(
        {
          page: 1,
          pageSize: 25,
        },
        principal,
      ),
    ).toThrow(
      expect.objectContaining({
        code: NOTIFICATION_VISIBILITY_ERROR_CODES.UNAUTHENTICATED,
      }),
    );
  });

  it('rejects direct access to a notification outside the partner scope', () => {
    const principal = createPartnerPrincipal();
    const service = createService(principal);

    expect(() =>
      service.get('NTF-DEMO-1002', principal),
    ).toThrow(
      expect.objectContaining({
        code:
          NOTIFICATION_VISIBILITY_ERROR_CODES.PARTNER_SCOPE_VIOLATION,
      }),
    );
  });

  it('rejects invalid reminder interval preferences', () => {
    const principal = createPartnerPrincipal();
    const service = createService(principal);

    expect(() =>
      service.getVisibilityFlags(
        'TRK-DEMO-1001',
        principal,
        {
          reminderIntervalHours: -1,
        },
      ),
    ).toThrow(
      'The reminder interval must be a nonnegative number of hours.',
    );
  });
});