# Digital Onboarding

Digital Onboarding is a browser-only React simulation for multi-channel insurance producer, representative, corporate, and agency onboarding.

The application demonstrates intake normalization, guided onboarding journeys, validation and eligibility rules, operational work queues, partner-scoped status visibility, synchronization tracking, configuration management, audit history, notifications, and document-package workflows.

All bundled identities, organizations, records, documents, and provider responses are synthetic.

## Static demo boundaries

This repository produces a static single-page application. It does not include an application server, database, production authentication system, or live provider integration.

The simulation:

- Runs entirely in the browser.
- Uses bundled synthetic fixtures.
- Stores changes in browser `localStorage`.
- Generates deterministic mock identifiers and provider outcomes.
- Creates placeholder downloads rather than official documents.
- Publishes browser-domain events rather than sending messages to external systems.
- Does not perform production onboarding, contracting, appointment, payment, background-check, or synchronization transactions.

Do not enter or upload real personal, banking, tax, licensing, authentication, customer, producer, or production information.

Vite environment variables are embedded in the client bundle and are visible to browser users. Never place credentials, API keys, secrets, or production identifiers in a `VITE_*` variable.

## Features

### Intake and normalization

- Mock intake through SFTP, email, mail, fax, API, partner dashboard, and manual channels.
- Quility JSON, Ethos XML, DTCC flat-file, SureLC TIF metadata, OCR, manual-form, and change-request formats.
- Single-record and bulk intake processing.
- Structured completeness results, validation indicators, missing fields, correction actions, and normalized JSON previews.
- Rejected malformed XML and invalid source payload handling.
- Generic browser-only mock API submission interface.

### Guided onboarding

- Individual producer, registered representative, corporate, agency, general agency, licensed principal, and financial institution journeys.
- Dynamic steps based on journey and contract type.
- Prefilled source information and conditional step skipping.
- Partner-scoped save, exit, and resume behavior.
- Section validation, progress tracking, review, consent, and simulated signature capture.
- Synthetic document-package generation and placeholder downloads.
- Final readiness and submission checks.

### Validation and eligibility

- Runtime Zod contracts for domain and persistence data.
- Carrier, agency, hierarchy, commission, E&O, licensing, NPN, principal, form, source, and authorization rules.
- Duplicate in-progress application detection.
- Historical contract and termination evaluation.
- Background-check and appointment reuse decisions.
- Deterministic agent-code generation and collision handling.
- Simulated NIPR, GIACT, AML, LIMRA, RegEd, BIG, Sircon/Vertafore, DTCC, Ethos, Horizon, DocuSign, and Verint outcomes.

### Partner portal

- Partner-scoped onboarding activity summary.
- Resumable journey cards.
- Status search by tracking ID, application number, NPN, agent code, or recent activity.
- Lifecycle, synchronization, and notification indicators.
- Defensive record-level scope enforcement.

### Operations

- Appointment, background, exception, distribution, agency-review, synchronization-failure, DTCC, and explanation-letter work cards.
- Queue filters, assignment, comments, transitions, completion, and authorized reopening.
- Contract change workflows for schedules, assignees, hierarchies, and contract levels.
- Canonical lifecycle projection from records, audit events, provider checks, work items, and synchronization attempts.
- Agent DB, LifePro, ALI, and Horizon status history.
- Idempotent Horizon just-in-time event reconciliation.
- Level-40 direct LifePro activation simulation.
- Redacted operational audit history and notification previews.

### Administration

- General agency settings for forms, signatures, schedules, levels, hierarchy, advances, AML, appointments, notifications, Vector One, and review gates.
- Browser-persisted GA overrides with reset support.
- Administrator diagnostics for fixture validation and storage-envelope inspection.
- Sanitized diagnostic export and guarded demo-state reset controls.
- Diagnostics controlled by `VITE_ENABLE_DIAGNOSTICS`.

### Accessibility and privacy

- Semantic headings, landmarks, labels, fieldsets, tables, timelines, and status regions.
- Keyboard-accessible navigation and actions.
- Visible focus treatment and skip navigation.
- Responsive layouts and reduced-motion support.
- Dark-mode-ready styles.
- Masking for contact, financial, tax, licensing, contract, producer, and record identifiers.
- Deep redaction for previews, exports, logs, audit data, and diagnostics.

## Technology

- JavaScript ES modules
- React 19
- React Router 7
- Vite 7
- Tailwind CSS 4
- Zustand 5
- React Hook Form
- Zod
- Vitest and Testing Library
- Playwright

## Requirements

- Node.js `>=20.19.0`
- npm compatible with the selected Node.js release

Check the installed versions:

```sh
node --version
npm --version
```

## Setup

Install dependencies:

```sh
npm install
```

Create a local environment file from the example:

```sh
cp .env.example .env
```

Supported values:

```dotenv
VITE_APP_ENV=development
VITE_ENABLE_DIAGNOSTICS=false
```

`VITE_APP_ENV` accepts:

- `development`
- `test`
- `staging`
- `production`

Invalid environment values cause application initialization or build failure.

Start the development server:

```sh
npm run dev
```

Open the URL printed by Vite.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Vite development server. |
| `npm run build` | Create the production build in `dist/`. |
| `npm run preview` | Serve the production build locally. |
| `npm run lint` | Run ESLint across the repository. |
| `npm run test` | Run Vitest unit and integration tests. |
| `npm run e2e` | Run Playwright end-to-end tests. |

Run the standard verification pipeline:

```sh
npm run lint
npm run test
npm run build
```

Preview the production build:

```sh
npm run preview -- --host 127.0.0.1
```

Vite Preview uses port `4173` by default.

## Demo users

Authentication is simulated. On the login page, select a pre-provisioned identity from the **Demo identity** list and choose **Continue**. No password is required.

| User ID | Role | Organization | Default area |
| --- | --- | --- | --- |
| `usr_partner_demo` | Partner | Demo Partner Network | Partner dashboard |
| `usr_agency_demo` | Agency | Demo Insurance Agency | Partner dashboard |
| `usr_licensing_demo` | Licensing | Demo Licensing Services | Operations dashboard |
| `usr_manager_demo` | Manager | Demo Regional Management | Operations dashboard |
| `usr_distribution_demo` | Distribution | Demo Distribution Group | Operations dashboard |
| `usr_operations_demo` | Operations | Demo Operations Center | Operations dashboard |
| `usr_admin_demo` | Administrator | Digital Onboarding Administration | Admin dashboard |

Permissions and record visibility vary by role. Partner and agency users are limited to their organization. Licensing users see assigned work. Manager, distribution, operations, and administrator users receive broader scopes according to the role policy.

## Route map

### Public routes

| Route | Purpose |
| --- | --- |
| `/login` | Select a synthetic demo identity. |
| `/forbidden` | Safe authorization failure page. |
| `/unauthorized` | Safe authorization guidance. |
| `/not-found` | Not-found fallback. |
| `/error` | Safe application error fallback. |

### Intake and journeys

| Route | Purpose |
| --- | --- |
| `/intake` | Process bundled or custom synthetic intake. |
| `/intake/new` | Start a new intake submission. |
| `/intake/:intakeId` | Intake detail route. |
| `/mock-api/onboarding` | Generic browser-only onboarding API concept. |
| `/journeys` | Journey capability and resume area. |
| `/journeys/new` | Start a guided journey. |
| `/journeys/agent-contracting` | Individual producer journey entry. |
| `/journeys/registered-representative` | Registered representative journey entry. |
| `/journeys/corporate` | Corporate journey entry. |
| `/journeys/ga-agency` | General agency journey entry. |
| `/journeys/:journeyId` | Resume or display the current journey step. |
| `/journeys/:journeyId/review` | Final journey review. |
| `/journeys/:journeyId/complete` | Journey confirmation. |
| `/journeys/:journeyId/thank-you` | Submission confirmation. |
| `/journeys/:journeyType/:trackingId/:stepId` | Exact journey step route. |

### Partner routes

| Route | Purpose |
| --- | --- |
| `/partner/dashboard` | Partner-scoped activity and resumable drafts. |
| `/partner/onboarding` | Partner status explorer. |
| `/partner/onboarding/:applicationId` | Partner-scoped lifecycle details. |
| `/partner/onboarding/:trackingId/resume` | Validate scope and resume a saved journey. |
| `/partner/reports` | Partner status and reporting view. |
| `/partner/notifications` | Partner-visible notification previews. |

### Operations routes

| Route | Purpose |
| --- | --- |
| `/operations/dashboard` | Role-aware operations overview. |
| `/operations/workbench` | Operational work queue. |
| `/operations/workbench/:workItemId` | Work-item route. |
| `/operations/onboarding` | Onboarding search for internal users. |
| `/operations/onboarding/:applicationId` | Canonical lifecycle detail. |
| `/operations/exceptions` | Exception-focused workbench. |
| `/operations/contract-changes` | Contract change management. |
| `/operations/reports` | Synchronization reporting. |
| `/operations/reports/audit` | Redacted operational audit history. |
| `/operations/sync-status` | Agent DB, LifePro, ALI, and Horizon status. |
| `/operations/notifications` | Internal notification previews and delivery logs. |

### Administration routes

| Route | Purpose |
| --- | --- |
| `/admin/dashboard` | Administration overview. |
| `/admin/reference-data` | Synthetic reference configuration. |
| `/admin/users` | Demo user capability area. |
| `/admin/users/:userId` | Demo user detail route. |
| `/admin/configuration` | General agency configuration. |
| `/admin/configuration/general-agencies` | General agency configuration alias. |
| `/diagnostics` | Administrator diagnostics and reset tooling. |

All protected routes require an authenticated demo session. Route policies, role permissions, partner context, and record scope are evaluated before protected content is displayed.

## Architecture

The application uses a layered browser architecture:

1. **Pages and components**
   - Render role-aware workflows and accessible controls.
   - Use Tailwind utility classes for presentation.
   - Display masked and redacted values where appropriate.

2. **Stores**
   - Zustand stores manage authentication, hydrated application state, and per-user UI preferences.
   - Store hydration occurs after persistence migration in `src/App.jsx`.

3. **Services**
   - Coordinate intake, journey, validation, eligibility, submission, operations, partner status, lifecycle, notifications, synchronization, and configuration behavior.
   - Apply authorization and record-scope checks at service boundaries.

4. **Repositories**
   - Combine immutable fixture seeds with browser-persisted overlays.
   - Validate writes before committing versioned storage envelopes.
   - Preserve canonical identifiers and use optimistic conflict checks where applicable.

5. **Runtime contracts**
   - Zod schemas validate fixtures, records, requests, responses, and persistence envelopes.

6. **Persistence**
   - `BrowserStorageAdapter` wraps `localStorage` with namespacing, envelope validation, schema-version checks, malformed-data recovery, and quota error handling.
   - `PersistenceMigrationCoordinator` processes prior versioned namespaces before store hydration.

7. **Fixtures**
   - Bundled JSON files provide synthetic onboarding, operations, provider, historical, reference, and user data.
   - Fixture data is validated, indexed, and deeply frozen by the seed loader.

8. **Browser-domain handoff**
   - Submission and change workflows publish `CustomEvent`-style browser events.
   - No network transport or external event broker is used.

## Persistence

The current storage namespace is:

```text
fd-2370-digital-onboarding:v1
```

Persisted values use envelopes containing:

- `schemaVersion`
- `savedAt`
- `data`

Stored aggregates include:

- Mock authentication session
- Onboarding record overlays
- Partner-scoped journey drafts
- Document packages
- Validation and provider outcomes
- Work-item overlays and assignments
- Audit events
- Synchronization attempts
- Notifications
- Contract changes
- General agency configuration overrides
- Per-user UI preferences

Browser state is local to the current origin and browser profile. It is not shared between devices, browsers, incognito sessions, preview deployments, or production domains.

Clearing site data removes saved simulation state.

## Resetting demo state

### Administrator diagnostics

Diagnostics are disabled by default. To enable them on a local or isolated preview build:

```dotenv
VITE_APP_ENV=development
VITE_ENABLE_DIAGNOSTICS=true
```

Restart or rebuild the application after changing a Vite environment value. Sign in as `usr_admin_demo` and open:

```text
/diagnostics
```

Two guarded reset options are available:

- **Reset application demo data**
  - Type `RESET DEMO DATA`.
  - Removes onboarding, intake, operations, reference configuration, and application-state entries.
  - Preserves authentication and UI preferences.

- **Clear all browser demo data**
  - Type `CLEAR ALL DEMO DATA`.
  - Removes the entire Digital Onboarding storage namespace.
  - Signs out the current user.
  - Removes authentication, application state, and UI preferences.

Do not enable diagnostics in production.

### Browser controls

You can also clear the application’s site data using browser developer tools or browser privacy settings. This removes all locally saved journeys and simulation changes for that origin.

## Folder structure

```text
.
├── e2e/
│   ├── onboarding-flow.spec.js
│   └── operations-partner.spec.js
├── public/
│   └── favicon.svg
├── src/
│   ├── auth/
│   │   ├── partnerScopeGuard.js
│   │   └── permissionPolicy.js
│   ├── components/
│   │   ├── auth/
│   │   ├── journey/
│   │   ├── layout/
│   │   ├── operations/
│   │   └── shared/
│   ├── config/
│   │   └── appConfig.js
│   ├── constants/
│   │   ├── domain.js
│   │   ├── roles.js
│   │   ├── routes.js
│   │   └── storageKeys.js
│   ├── contracts/
│   │   ├── mockApiContracts.js
│   │   └── schemas.js
│   ├── fixtures/
│   │   ├── historical-assets.json
│   │   ├── intake-samples.json
│   │   ├── onboarding-records.json
│   │   ├── operations-data.json
│   │   ├── provider-responses.json
│   │   ├── reference-config.json
│   │   └── users.json
│   ├── pages/
│   │   ├── admin/
│   │   ├── auth/
│   │   ├── onboarding/
│   │   ├── operations/
│   │   └── partner/
│   ├── persistence/
│   │   ├── browserStorageAdapter.js
│   │   ├── migrationCoordinator.js
│   │   └── seedLoader.js
│   ├── repositories/
│   ├── services/
│   │   ├── onboarding/
│   │   ├── operations/
│   │   └── shared/
│   ├── stores/
│   ├── test/
│   ├── utils/
│   ├── App.jsx
│   ├── index.css
│   ├── main.jsx
│   └── router.jsx
├── .env.example
├── DEPLOYMENT.md
├── eslint.config.js
├── playwright.config.js
├── tailwind.config.js
├── vercel.json
├── vite.config.js
└── vitest.config.js
```

## Testing

### Unit and integration tests

Run all Vitest tests:

```sh
npm run test
```

The test suite uses jsdom, Testing Library, deterministic time controls, storage isolation, clipboard mocks, observer mocks, and browser download mocks.

Covered areas include:

- Protected routes and session expiration
- Persistence envelopes and migrations
- Intake normalization and routing
- Journey save, resume, consent, and signing
- Validation and eligibility rules
- Submission processing
- Operational work transitions and assignment
- Partner scope segregation
- Contract changes
- Notification visibility
- Synchronization and Horizon reconciliation

### End-to-end tests

Install Playwright browsers:

```sh
npx playwright install --with-deps
```

Run the suite:

```sh
npm run e2e
```

Playwright builds the application and starts Vite Preview at:

```text
http://127.0.0.1:4173
```

The configured projects are:

- Chromium
- Firefox
- WebKit

End-to-end coverage includes authentication, protected routes, intake, malformed XML rejection, journey persistence and completion, partner segregation, operations transitions, audit history, contract changes, synchronization, Horizon reconciliation, and GA configuration reset.

Generated reports and failure artifacts are written to ignored directories such as:

- `playwright-report/`
- `test-results/`
- `blob-report/`

Review artifacts before sharing them, even though the bundled data is synthetic.

## Deployment

The application builds to static assets in:

```text
dist/
```

Recommended production values:

```dotenv
VITE_APP_ENV=production
VITE_ENABLE_DIAGNOSTICS=false
```

Run before deployment:

```sh
npm ci
npm run lint
npm run test
npm run build
npm run e2e
```

The repository includes a Vercel SPA rewrite:

```json
{
  "rewrites": [
    {
      "source": "/(.*)",
      "destination": "/index.html"
    }
  ]
}
```

The rewrite is required for direct navigation and refresh on React Router paths.

No Vercel Functions, database, application server, or server-side secrets are required. See [DEPLOYMENT.md](DEPLOYMENT.md) for environment guidance, CI/CD stages, preview verification, storage migration procedures, promotion, rollback, and production smoke tests.

## Security and data handling

- Use only bundled or newly created synthetic data.
- Do not use production identities or records in manual testing.
- Do not put secrets in `.env` or any `VITE_*` variable.
- Do not publish browser storage exports without reviewing them.
- Do not publish Playwright screenshots, traces, or videos without review.
- Treat placeholder documents as demonstration artifacts only.
- Remember that client-side authorization is for simulation behavior and is not a substitute for server-side enforcement in a production system.

## Private license

Copyright © 2026. All rights reserved.

This repository is private and proprietary. No license is granted to use, copy, modify, merge, publish, distribute, sublicense, sell, host, deploy, reverse engineer, or create derivative works from this software except with prior written authorization from the repository owner.

Access to the repository does not grant any intellectual property rights. Unauthorized use, disclosure, reproduction, or distribution is prohibited.