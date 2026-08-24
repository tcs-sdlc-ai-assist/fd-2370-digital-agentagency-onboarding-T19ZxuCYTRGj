import { expect, test } from '@playwright/test';

const PARTNER_USER_ID = 'usr_partner_demo';
const TRACKING_ID = 'TRK-E2E-ONBOARDING-1001';
const APPLICATION_ID = 'APP-E2E-ONBOARDING-1001';
const JOURNEY_STORAGE_KEY =
  'fd-2370-digital-onboarding:v1:onboarding:journey-drafts:demo_partner';

async function signInAsPartner(page) {
  await page.goto('/login');

  await expect(
    page.getByRole('heading', {
      name: 'Sign in to the simulation',
    }),
  ).toBeVisible();

  await page.getByLabel('Demo identity').selectOption(PARTNER_USER_ID);
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page).toHaveURL(/\/partner\/dashboard$/);
  await expect(
    page.getByRole('heading', { name: 'Onboarding activity' }),
  ).toBeVisible();
}

async function injectReviewReadyJourney(page) {
  await page.evaluate(
    ({ applicationId, storageKey, trackingId }) => {
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
          fileName: 'quility_banner_complete_001.json',
        },
        company: 'Banner',
        carrierCode: 'BANNER',
        gaCode: 'NATIONAL_DEMO',
        agencyType: 'BGA',
        contractType: 'PRODUCER',
        agency: {
          name: 'Demo Partner Network',
          type: 'BGA',
          code: 'AGY-E2E-DEMO',
        },
        agent: {
          type: 'individual',
          firstName: 'Jamie',
          middleName: 'Q',
          lastName: 'Sample',
          email: 'jamie.sample@example.test',
          phone: '2025550101',
          npn: '1001001',
          residenceState: 'PA',
        },
        applicant: {
          type: 'individual',
          firstName: 'Jamie',
          middleName: 'Q',
          lastName: 'Sample',
          email: 'jamie.sample@example.test',
          phone: '2025550101',
          npn: '1001001',
          residenceState: 'PA',
        },
        licensing: {
          residentState: 'PA',
          licenseNumber: 'PA-DEMO-1001',
          linesOfAuthority: ['LIFE', 'ACCIDENT_HEALTH'],
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
          accountNumber: '0000123456',
          accountType: 'checking',
          accountHolderName: 'Jamie Sample',
        },
        hierarchy: {
          agencyCode: 'AGY-E2E-DEMO',
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
        resumeUrl:
          `/journeys/agent_contracting/${trackingId}/review`,
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
        saveMode: 'MANUAL',
        version: 1,
        createdAt: savedAt,
        updatedAt: savedAt,
        lastSavedAt: savedAt,
        expiresAt: null,
        submittedAt: null,
        metadata: {
          createdBy: PARTNER_USER_ID,
          source: 'e2e_mock_intake',
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
      applicationId: APPLICATION_ID,
      storageKey: JOURNEY_STORAGE_KEY,
      trackingId: TRACKING_ID,
    },
  );
}

async function readPersistedDraft(page) {
  return page.evaluate(
    ({ storageKey, trackingId }) => {
      const serializedEnvelope = localStorage.getItem(storageKey);

      if (!serializedEnvelope) {
        return null;
      }

      const envelope = JSON.parse(serializedEnvelope);

      return envelope.data?.drafts?.[trackingId] ?? null;
    },
    {
      storageKey: JOURNEY_STORAGE_KEY,
      trackingId: TRACKING_ID,
    },
  );
}

test.describe('Onboarding flow', () => {
  test('processes mock intake, saves and resumes a journey, signs, and submits it', async ({
    page,
  }) => {
    await signInAsPartner(page);

    await page.goto('/intake');

    await expect(
      page.getByRole('heading', {
        name: 'Intake and mock submission',
      }),
    ).toBeVisible();

    await page
      .getByLabel('Mock intake scenario')
      .selectOption('intake_quility_complete_valid');

    await page
      .getByRole('button', { name: 'Process mock submission' })
      .click();

    await expect(
      page.getByRole('heading', {
        name: 'Intake processing results',
      }),
    ).toBeVisible();

    await expect(
      page.getByText('Normalized JSON preview', { exact: true }),
    ).toBeVisible();

    await expect(page.locator('pre')).toContainText(
      '"sourceFormat": "QUILITY_JSON"',
    );
    await expect(page.locator('pre')).toContainText(
      '"journeyType": "agent_contracting"',
    );

    await injectReviewReadyJourney(page);

    await page.goto('/journeys/agent_contracting/' + TRACKING_ID + '/review');

    await expect(
      page.getByRole('heading', { name: 'Review', exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByText('Journey information', { exact: true }),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Save and exit' }).click();

    await expect(page).toHaveURL(/\/journeys$/);

    const savedDraft = await readPersistedDraft(page);

    expect(savedDraft).toEqual(
      expect.objectContaining({
        trackingId: TRACKING_ID,
        currentStepId: 'review',
        saveMode: 'SAVE_AND_EXIT',
        version: 2,
      }),
    );

    await page.goto('/partner/dashboard');

    await expect(
      page.getByRole('heading', { name: 'Resume onboarding' }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Jamie Sample' }),
    ).toBeVisible();

    await page
      .getByRole('link', { name: 'Resume journey', exact: true })
      .click();

    await expect(page).toHaveURL(
      new RegExp(`/journeys/${TRACKING_ID}$`),
    );
    await expect(
      page.getByRole('heading', { name: 'Review', exact: true }).first(),
    ).toBeVisible();

    await page
      .getByRole('button', { name: 'Continue to signature' })
      .click();

    await expect(
      page.getByRole('heading', {
        name: 'Signature',
        exact: true,
      }).first(),
    ).toBeVisible();

    await page.getByLabel('Signer name').fill('Jamie Sample');
    await page
      .getByRole('checkbox', {
        name: 'I consent to electronically sign this package',
      })
      .check();
    await page
      .getByRole('button', { name: 'Sign and continue' })
      .click();

    await expect(
      page.getByRole('heading', {
        name: 'Complete',
        exact: true,
      }).first(),
    ).toBeVisible();

    await page
      .getByRole('button', { name: 'Finalize journey' })
      .click();

    await expect(
      page.getByRole('heading', { name: 'Journey complete' }),
    ).toBeVisible();

    const submittedDraft = await readPersistedDraft(page);

    expect(submittedDraft).toEqual(
      expect.objectContaining({
        trackingId: TRACKING_ID,
        applicationId: APPLICATION_ID,
        status: 'APPLICATION_SUBMITTED',
        currentStepId: 'complete',
        submittedAt: expect.any(String),
        completionState: expect.objectContaining({
          completed: true,
          percentComplete: 100,
          submissionReady: true,
        }),
        signatures: expect.objectContaining({
          agent_signature: expect.objectContaining({
            status: 'SIGNED',
            consented: true,
            signedBy: 'Jamie Sample',
            signedAt: expect.any(String),
          }),
        }),
      }),
    );
  });

  test('rejects malformed XML intake with actionable parse feedback', async ({
    page,
  }) => {
    await signInAsPartner(page);

    await page.goto('/intake');

    await page
      .getByLabel('Mock intake scenario')
      .selectOption('intake_ethos_malformed_xml');

    await page
      .getByRole('button', { name: 'Process mock submission' })
      .click();

    await expect(
      page.getByRole('heading', {
        name: 'Intake processing results',
      }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', {
        name: 'Rejected intake record',
      }),
    ).toBeVisible();
    await expect(
      page.getByText('Import Parse Error', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Correct source data' }),
    ).toBeVisible();
    await expect(
      page.getByText('Normalized JSON preview', { exact: true }),
    ).toHaveCount(0);
  });
});