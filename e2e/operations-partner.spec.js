import { expect, test } from '@playwright/test';

const USERS = Object.freeze({
  ADMIN: 'usr_admin_demo',
  OPERATIONS: 'usr_operations_demo',
  PARTNER: 'usr_partner_demo',
});

const STORAGE_KEYS = Object.freeze({
  CONFIGURATION:
    'fd-2370-digital-onboarding:v1:reference-data:configuration',
  JOURNEY_DRAFTS:
    'fd-2370-digital-onboarding:v1:onboarding:journey-drafts:demo_partner',
  SYNC_ATTEMPTS:
    'fd-2370-digital-onboarding:v1:operations:sync-attempts',
  WORK_ITEMS:
    'fd-2370-digital-onboarding:v1:operations:work-items',
});

const RESUME_TRACKING_ID = 'TRK-E2E-PARTNER-RESUME-2001';
const RESUME_APPLICATION_ID = 'APP-E2E-PARTNER-RESUME-2001';
const HORIZON_EVENT_ID = 'HZ-E2E-OPERATIONS-2001';

async function signIn(page, userId, expectedPath) {
  await page.goto('/login');

  await expect(
    page.getByRole('heading', {
      name: 'Sign in to the simulation',
    }),
  ).toBeVisible();

  await page.getByLabel('Demo identity').selectOption(userId);
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page).toHaveURL(new RegExp(`${expectedPath}$`));
}

async function readEnvelopeData(page, storageKey) {
  return page.evaluate((key) => {
    const serializedEnvelope = localStorage.getItem(key);

    if (!serializedEnvelope) {
      return null;
    }

    return JSON.parse(serializedEnvelope).data ?? null;
  }, storageKey);
}

async function injectPartnerReviewDraft(page) {
  await page.evaluate(
    ({ applicationId, storageKey, trackingId, userId }) => {
      const savedAt = new Date().toISOString();
      const skippedSteps = [
        'source-review',
        'agency',
        'applicant',
        'licensing',
        'contract',
        'commission',
        'banking',
        'errors-and-omissions',
        'hierarchy',
        'documents',
        'attestations',
      ];
      const formState = {
        trackingId,
        applicationId,
        partnerCode: 'DEMO_PARTNER',
        journeyType: 'agent_contracting',
        requestType: 'new_onboarding',
        sourceChannel: 'PARTNER_DASHBOARD',
        sourceFormat: 'MANUAL_FORM',
        sourceMetadata: {
          sourceChannel: 'PARTNER_DASHBOARD',
          sourceFormat: 'MANUAL_FORM',
          partnerCode: 'DEMO_PARTNER',
          fileName: 'partner_resume_complete_2001.json',
        },
        company: 'Banner',
        carrierCode: 'BANNER',
        gaCode: 'NATIONAL_DEMO',
        agencyType: 'BGA',
        contractType: 'PRODUCER',
        agency: {
          name: 'Demo Partner Network',
          type: 'BGA',
          code: 'AGY-E2E-PARTNER',
        },
        agent: {
          type: 'individual',
          firstName: 'Jordan',
          middleName: 'R',
          lastName: 'Resume',
          email: 'jordan.resume@example.test',
          phone: '2025550201',
          npn: '8202001',
          residenceState: 'PA',
        },
        applicant: {
          type: 'individual',
          firstName: 'Jordan',
          middleName: 'R',
          lastName: 'Resume',
          email: 'jordan.resume@example.test',
          phone: '2025550201',
          npn: '8202001',
          residenceState: 'PA',
        },
        licensing: {
          residentState: 'PA',
          licenseNumber: 'PA-DEMO-8202001',
          linesOfAuthority: ['LIFE'],
        },
        contract: {
          type: 'PRODUCER',
          level: 'PRODUCER',
          commissionSchedule: 'STANDARD',
          advanceCommission: false,
        },
        commission: {
          schedule: 'STANDARD',
          paymentMethod: 'EFT',
          advanceCommission: false,
        },
        banking: {
          paymentMethod: 'EFT',
          routingNumber: '021000021',
          accountNumber: '0000222201',
          accountType: 'checking',
          accountHolderName: 'Jordan Resume',
        },
        hierarchy: {
          agencyCode: 'AGY-E2E-PARTNER',
          uplineAgentCode: 'NATGA0000',
          level: 'PRODUCER',
          status: 'active',
        },
        documents: {
          required: false,
          received: 0,
          accepted: 0,
        },
        attestations: {
          backgroundQuestionsClear: true,
          informationAccurate: true,
          electronicDeliveryConsent: true,
        },
      };
      const draft = {
        trackingId,
        applicationId,
        partnerCode: 'DEMO_PARTNER',
        journeyType: 'agent_contracting',
        status: 'APPLICATION_STARTED',
        currentStepId: 'review',
        resumeUrl: `/journeys/agent_contracting/${trackingId}/review`,
        formState,
        dirtySections: [],
        completedSteps: ['start'],
        skippedSteps,
        completionState: {
          completed: false,
          percentComplete: 0,
          completedSteps: ['start'],
          skippedSteps,
          packageComplete: false,
          submissionReady: false,
        },
        signatures: {},
        lastValidationResult: null,
        saveMode: 'SAVE_AND_EXIT',
        version: 1,
        createdAt: savedAt,
        updatedAt: savedAt,
        lastSavedAt: savedAt,
        expiresAt: null,
        submittedAt: null,
        metadata: {
          createdBy: userId,
          source: 'operations_partner_e2e',
          synthetic: true,
        },
      };

      localStorage.setItem(
        storageKey,
        JSON.stringify({
          schemaVersion: 1,
          savedAt,
          data: {
            drafts: {
              [trackingId]: draft,
            },
          },
        }),
      );
    },
    {
      applicationId: RESUME_APPLICATION_ID,
      storageKey: STORAGE_KEYS.JOURNEY_DRAFTS,
      trackingId: RESUME_TRACKING_ID,
      userId: USERS.PARTNER,
    },
  );
}

test.describe('Operations and partner visibility', () => {
  test('protects operations routes from unauthenticated access', async ({
    page,
  }) => {
    await page.goto('/operations/workbench');

    await expect(page).toHaveURL(/\/login$/);
    await expect(
      page.getByRole('heading', {
        name: 'Sign in to the simulation',
      }),
    ).toBeVisible();
  });

  test('transitions operational work and displays scoped audit history', async ({
    page,
  }) => {
    await signIn(
      page,
      USERS.OPERATIONS,
      '/operations/dashboard',
    );

    await page.goto('/operations/workbench');

    await expect(
      page.getByRole('heading', {
        name: 'Operational work queue',
      }),
    ).toBeVisible();

    const workItem = page.locator(
      '[data-work-item-id="WI-DEMO-1002"]',
    );

    await expect(workItem).toBeVisible();
    await expect(workItem).toHaveAttribute(
      'data-work-item-state',
      'pending',
    );

    await workItem.getByRole('button', { name: 'Complete' }).click();

    await expect(workItem).toHaveCount(0);

    const workItemState = await readEnvelopeData(
      page,
      STORAGE_KEYS.WORK_ITEMS,
    );

    expect(workItemState?.overlays?.['WI-DEMO-1002']).toEqual(
      expect.objectContaining({
        workItemId: 'WI-DEMO-1002',
        state: 'completed',
        completedAt: expect.any(String),
        history: expect.arrayContaining([
          expect.objectContaining({
            previousState: 'pending',
            currentState: 'completed',
            actorId: USERS.OPERATIONS,
          }),
        ]),
      }),
    );

    await page.goto('/operations/reports/audit');

    await expect(
      page.getByRole('heading', {
        name: 'Operational audit history',
      }),
    ).toBeVisible();

    await page
      .getByLabel('Record identifier')
      .fill('TRK-DEMO-1003');
    await page.getByRole('button', { name: 'Apply filters' }).click();

    const auditTable = page.getByRole('table', {
      name: 'Operational audit history',
    });

    await expect(auditTable).toBeVisible();
    await expect(auditTable).toContainText('Licensing Review');
    await expect(
      page.getByText('No audit events matched the current filters.'),
    ).toHaveCount(0);
  });

  test('creates a contract change and reconciles a Horizon event', async ({
    page,
  }) => {
    await signIn(
      page,
      USERS.OPERATIONS,
      '/operations/dashboard',
    );

    await page.goto('/operations/contract-changes');

    await expect(
      page.getByRole('heading', {
        name: 'Contract change management',
      }),
    ).toBeVisible();

    await page
      .getByLabel('Onboarding application')
      .selectOption('APP-DEMO-1006');
    await page
      .getByLabel('Change type')
      .selectOption('commission_schedule');
    await page
      .getByLabel('Requested commission schedule')
      .fill('STANDARD');
    await page
      .getByLabel('Change reason')
      .fill(
        'Apply the synthetic standard commission schedule for this test.',
      );
    await page
      .getByRole('button', { name: 'Submit contract change' })
      .click();

    await expect(
      page.getByRole('heading', {
        name: 'Commission Schedule',
      }),
    ).toBeVisible();
    await expect(
      page.getByText('Auto accepted', { exact: true }),
    ).toBeVisible();

    await page.goto('/operations/sync-status');

    await expect(
      page.getByRole('heading', {
        name: 'Agent DB, LifePro, ALI, and Horizon',
      }),
    ).toBeVisible();

    await page.getByLabel('Event ID').fill(HORIZON_EVENT_ID);
    await page.getByLabel('Agent code').fill('MCON1006');
    await page
      .getByLabel('National producer number')
      .fill('8101006');
    await page.getByLabel('Requested states').fill('OH, IN');

    await page
      .getByRole('button', { name: 'Reconcile Horizon event' })
      .click();

    await expect(
      page.getByRole('heading', {
        name: 'Horizon reconciliation result',
      }),
    ).toBeVisible();
    await expect(
      page.getByText(
        'The Horizon event matched a digital onboarding record.',
      ),
    ).toBeVisible();
    await expect(
      page.getByText('Redirected To Digital Appointment Flow'),
    ).toBeVisible();

    const syncState = await readEnvelopeData(
      page,
      STORAGE_KEYS.SYNC_ATTEMPTS,
    );
    const reconciledAttempt = Object.values(
      syncState?.overlays ?? {},
    ).find(
      (attempt) =>
        attempt.payloadSummary?.eventId === HORIZON_EVENT_ID,
    );

    expect(reconciledAttempt).toEqual(
      expect.objectContaining({
        trackingId: 'TRK-DEMO-1006',
        system: 'horizon',
        operation: 'redirect_jit_appointment',
        status: 'success',
        payloadSummary: expect.objectContaining({
          eventId: HORIZON_EVENT_ID,
          matchedDigitalRecord: true,
          duplicatePrevented: true,
        }),
      }),
    );
  });

  test('segregates partner searches and resumes an authorized draft', async ({
    page,
  }) => {
    await signIn(page, USERS.PARTNER, '/partner/dashboard');

    await page.goto('/partner/onboarding');

    await expect(
      page.getByRole('heading', {
        name: 'Partner status explorer',
      }),
    ).toBeVisible();

    await page
      .getByLabel('Lookup type')
      .selectOption('tracking_id');
    await page.getByLabel('Tracking ID').fill('TRK-DEMO-1006');
    await page
      .getByRole('button', { name: 'Search partner status' })
      .click();

    await expect(
      page.getByText(
        'No authorized onboarding records matched this lookup.',
      ),
    ).toBeVisible();
    await expect(
      page.getByRole('table', {
        name: 'Partner status search results',
      }),
    ).not.toContainText('APP-DEMO-1006');

    await page.getByLabel('Tracking ID').fill('TRK-DEMO-1001');
    await page
      .getByRole('button', { name: 'Search partner status' })
      .click();

    const statusTable = page.getByRole('table', {
      name: 'Partner status search results',
    });

    await expect(statusTable).toContainText('APP-DEMO-1001');
    await expect(
      page.getByText(
        'No authorized onboarding records matched this lookup.',
      ),
    ).toHaveCount(0);

    await injectPartnerReviewDraft(page);
    await page.goto('/partner/dashboard');

    await expect(
      page.getByRole('heading', { name: 'Resume onboarding' }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Jordan Resume' }),
    ).toBeVisible();

    await page
      .getByRole('link', { name: 'Resume journey', exact: true })
      .click();

    await expect(page).toHaveURL(
      new RegExp(`/journeys/${RESUME_TRACKING_ID}$`),
    );
    await expect(
      page.getByRole('heading', { name: 'Review', exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByText('Journey information', { exact: true }),
    ).toBeVisible();
  });

  test('saves and resets general agency configuration overrides', async ({
    page,
  }) => {
    await signIn(page, USERS.ADMIN, '/admin/dashboard');

    await page.goto('/admin/configuration');

    await expect(
      page.getByRole('heading', {
        name: 'General agency onboarding configuration',
      }),
    ).toBeVisible();

    await expect(page.getByLabel('General agency')).toBeVisible();

    const advancesEnabled = page.getByLabel(
      'Enable advance commissions',
    );

    if (!(await advancesEnabled.isChecked())) {
      await advancesEnabled.check();
    }

    await page
      .getByLabel('Maximum advance percentage')
      .fill('20');

    await page
      .getByRole('button', { name: 'Save GA configuration' })
      .click();

    await expect(
      page.getByRole('heading', {
        name: 'Saved configuration preview',
      }),
    ).toBeVisible();

    const savedConfiguration = await readEnvelopeData(
      page,
      STORAGE_KEYS.CONFIGURATION,
    );

    expect(
      Object.keys(savedConfiguration?.generalAgencyOverrides ?? {}),
    ).not.toHaveLength(0);

    await page
      .getByRole('button', { name: 'Reset GA overrides' })
      .click();

    await expect(
      page.getByRole('button', { name: 'Save GA configuration' }),
    ).toBeDisabled();

    const resetConfiguration = await readEnvelopeData(
      page,
      STORAGE_KEYS.CONFIGURATION,
    );

    expect(
      Object.keys(resetConfiguration?.generalAgencyOverrides ?? {}),
    ).toHaveLength(0);
  });
});