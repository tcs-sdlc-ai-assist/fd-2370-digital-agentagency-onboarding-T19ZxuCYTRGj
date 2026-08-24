# Deployment

## Overview

Digital Onboarding is a browser-only React simulation built with Vite and deployed as a static single-page application (SPA).

The application:

- Produces static assets in `dist/`.
- Uses React Router browser history.
- Stores simulation state in browser `localStorage`.
- Uses bundled synthetic fixtures.
- Does not require an application server, database, or external provider connection.
- Does not perform production onboarding transactions.

## Runtime requirements

The project requires:

- Node.js `>=20.19.0`
- npm compatible with the selected Node.js release

Confirm the local environment before installing dependencies:

```sh
node --version
npm --version
```

Use the same Node.js major version locally, in CI, and in Vercel. Node.js 20.19 or a later supported release satisfies the project requirement.

## Environment variables

Vite environment values are embedded into the client bundle at build time. They are not server-side secrets and are visible to browser users.

The supported variables are:

| Variable | Required | Production value | Description |
| --- | --- | --- | --- |
| `VITE_APP_ENV` | Yes | `production` | Runtime environment label. Supported values are `development`, `test`, `staging`, and `production`. |
| `VITE_ENABLE_DIAGNOSTICS` | Yes | `false` | Enables administrator-only diagnostic and browser-state reset tooling. |

Recommended values by deployment environment:

### Local development

```dotenv
VITE_APP_ENV=development
VITE_ENABLE_DIAGNOSTICS=false
```

### Automated tests

```dotenv
VITE_APP_ENV=test
VITE_ENABLE_DIAGNOSTICS=false
```

### Vercel Preview

```dotenv
VITE_APP_ENV=staging
VITE_ENABLE_DIAGNOSTICS=false
```

Diagnostics may be enabled temporarily on an isolated preview deployment:

```dotenv
VITE_APP_ENV=staging
VITE_ENABLE_DIAGNOSTICS=true
```

Do not promote a diagnostics-enabled build to production.

### Vercel Production

```dotenv
VITE_APP_ENV=production
VITE_ENABLE_DIAGNOSTICS=false
```

Invalid environment values cause the application build or startup to fail through the runtime configuration schema in `src/config/appConfig.js`.

Do not place credentials, API keys, personal information, banking data, or production identifiers in any `VITE_*` variable.

## Local production build

Install dependencies and run the verification pipeline:

```sh
npm install
npm run lint
npm run test
npm run build
```

When a lockfile is committed, CI should use:

```sh
npm ci
```

The production build is written to:

```text
dist/
```

Test the generated application locally:

```sh
npm run preview -- --host 127.0.0.1
```

Vite Preview uses port `4173` by default.

## End-to-end tests

The Playwright configuration starts a production build and Vite Preview server at:

```text
http://127.0.0.1:4173
```

Install the configured browser dependencies before running the suite:

```sh
npx playwright install --with-deps
npm run e2e
```

The suite runs against Chromium, Firefox, and WebKit. In CI it uses one worker and retries failed tests twice.

Playwright artifacts are written to ignored directories including:

- `playwright-report/`
- `test-results/`
- `blob-report/`

Do not upload traces, screenshots, or videos to public artifact storage without reviewing them for synthetic test data.

## Vercel configuration

The repository includes `vercel.json`:

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

This rewrite is required for React Router browser-history routes. It allows direct requests and refreshes for routes such as:

- `/partner/dashboard`
- `/partner/onboarding/APP-DEMO-1001`
- `/operations/workbench`
- `/operations/reports/audit`
- `/admin/configuration`
- `/journeys/TRK-DEMO-1001`

Without the rewrite, direct navigation to a client route can return a Vercel 404 instead of loading the SPA.

Static files emitted by Vite continue to be served from `dist/assets/`.

## Creating the Vercel project

1. Import the Git repository into Vercel.
2. Select Vite as the framework preset.
3. Configure a Node.js version satisfying `>=20.19.0`.
4. Use the following project settings:
   - Install command: `npm install`, or `npm ci` when a lockfile is committed
   - Build command: `npm run build`
   - Output directory: `dist`
5. Add the Preview environment variables:
   - `VITE_APP_ENV=staging`
   - `VITE_ENABLE_DIAGNOSTICS=false`
6. Add the Production environment variables:
   - `VITE_APP_ENV=production`
   - `VITE_ENABLE_DIAGNOSTICS=false`
7. Deploy a preview build.
8. Run smoke tests and the automated verification pipeline.
9. Promote the verified deployment or merge through the production branch.

The repository does not require Vercel Functions or server-side environment variables.

## Build and test pipeline

A deployment pipeline should run these stages in order:

```sh
npm ci
npm run lint
npm run test
npm run build
npx playwright install --with-deps
npm run e2e
```

If the CI environment cannot install all Playwright browsers, browser installation and end-to-end testing may run in a dedicated job. The production deployment must remain blocked until that job succeeds.

Recommended pipeline stages:

1. **Install**
   - Use a clean dependency installation.
   - Enforce Node.js `>=20.19.0`.
   - Cache npm downloads rather than committing `node_modules/`.

2. **Static verification**
   - Run `npm run lint`.

3. **Unit and component tests**
   - Run `npm run test`.

4. **Production build**
   - Run `npm run build`.
   - Retain `dist/` only as an ephemeral build artifact.

5. **End-to-end tests**
   - Install Playwright browser dependencies.
   - Run `npm run e2e`.
   - Keep failure artifacts private and subject to retention limits.

6. **Preview deployment**
   - Deploy the exact commit that passed verification.

7. **Smoke testing**
   - Confirm authentication, routing, storage, and primary workflows.

8. **Production promotion**
   - Promote the verified preview artifact when possible.
   - Avoid rebuilding with unverified dependency or environment changes.

Vercel does not automatically run the full test pipeline merely because the build command is `npm run build`. Configure repository branch protections and CI checks separately.

## Preview verification

Verify the following on the Vercel Preview URL:

### General

- The login page loads at `/login`.
- Browser refreshes work on nested routes.
- Static assets load without 404 responses.
- The simulation environment banner shows the expected environment.
- No browser console initialization errors are present.

### Partner flow

1. Sign in as `usr_partner_demo`.
2. Confirm redirect to `/partner/dashboard`.
3. Open `/intake`.
4. Process a valid synthetic intake scenario.
5. Verify the normalized JSON preview.
6. Start or resume a guided journey.
7. Save and reload the journey.
8. Confirm partner searches do not expose records outside the active partner scope.

### Operations flow

1. Sign in as `usr_operations_demo`.
2. Open `/operations/workbench`.
3. Transition a synthetic work item.
4. Confirm the transition remains after a page refresh.
5. Open `/operations/reports/audit`.
6. Verify scoped audit history.
7. Open `/operations/sync-status`.
8. Reconcile a synthetic Horizon event.

### Administration flow

1. Sign in as `usr_admin_demo`.
2. Open `/admin/configuration`.
3. Save a general agency override.
4. Refresh the page and confirm the override remains.
5. Reset the override.
6. Confirm diagnostics are unavailable unless explicitly enabled for that preview.

## Preview promotion

Vercel Preview deployments use a different browser origin from the production domain. Browser `localStorage` is isolated by origin, so simulation state created on a preview URL does not move to the production domain during promotion.

Before promotion:

1. Confirm the preview deployment uses the intended commit.
2. Confirm all required CI checks passed.
3. Confirm Preview environment values are appropriate for production.
4. Confirm `VITE_ENABLE_DIAGNOSTICS=false` in Production.
5. Run the preview smoke tests.
6. Verify direct navigation and refresh on nested routes.
7. Review dependency and storage-schema changes.

Promote the verified deployment through the Vercel dashboard or the organization’s approved Vercel CLI workflow.

Environment variables are compiled into the Vite bundle. Changing a Vercel environment variable requires a new deployment. Promoting an existing build does not rewrite values already embedded in its JavaScript assets.

## Browser storage and persistence

The application stores state under the namespace:

```text
fd-2370-digital-onboarding:v1
```

Persisted values use envelopes containing:

- `schemaVersion`
- `savedAt`
- `data`

Examples of persisted aggregates include:

- Authentication session
- Onboarding record overlays
- Partner-scoped journey drafts
- Operational work-item overlays
- Synchronization attempts
- Notification logs
- Reference configuration overrides
- Per-user UI preferences

Storage is local to the browser and origin. It is not synchronized between:

- Different browsers
- Different devices
- Preview and production domains
- Different Vercel preview URLs
- Incognito and standard browser sessions

Clearing site data removes saved simulation state.

## Storage migration

`src/App.jsx` runs `runPersistenceMigrations()` before store hydration.

The current persistence schema version is:

```text
1
```

The namespace version is derived from `PERSISTENCE_SCHEMA_VERSION` in `src/config/appConfig.js`.

When changing persisted data:

1. Increase `PERSISTENCE_SCHEMA_VERSION`.
2. Define migrations for every supported prior version.
3. Add payload schemas for migrated aggregates.
4. Test migration from each supported version.
5. Test malformed and partially written envelopes.
6. Test rollback behavior before production deployment.
7. Document whether old data is migrated or intentionally reset.

The migration coordinator only processes older versioned namespaces. If a migration path is missing or an envelope cannot be validated, the old entry is removed and the application returns to seeded or default state.

Repositories also validate persisted envelopes during reads. Invalid envelopes or unsupported versions may be removed and replaced by defaults.

Do not change persisted structures in place without either:

- Maintaining backward compatibility within the current schema version, or
- Increasing the schema version and providing a tested migration.

## Migration release procedure

For a release containing a storage-schema change:

1. Create representative version-old browser storage fixtures.
2. Add migration tests for every persisted aggregate affected by the change.
3. Verify authentication, onboarding drafts, operations overlays, and UI preferences independently.
4. Build and deploy to a preview environment.
5. Seed the preview origin with old-version storage.
6. Reload the application.
7. Confirm migration completes before store hydration.
8. Confirm resumable journeys and authorized scopes remain valid.
9. Confirm invalid data fails safely without exposing sensitive values.
10. Promote only after migration and rollback tests succeed.

Because storage is browser-local, there is no centralized server-side backup or repair process. Migration logic must be defensive and recoverable.

## Rollback

Use Vercel’s deployment history to restore the last known-good production deployment.

Before rolling back, determine whether the failed release changed `PERSISTENCE_SCHEMA_VERSION` or wrote a new persisted shape.

### Rollback without storage changes

If the release did not change persisted data:

1. Restore the previous Vercel deployment.
2. Verify `/login` and nested SPA routes.
3. Run partner, operations, and administration smoke tests.
4. Confirm environment variables remain correct.

### Rollback after storage changes

An older bundle may not understand storage written by a newer bundle.

Use one of these strategies:

- Deploy a forward fix that understands both persisted formats.
- Ship a compatibility migration before restoring the older UI.
- Increase the schema version and intentionally reset incompatible simulation state.
- Instruct affected simulation users to clear site data only when preservation is not required.

Never decrease `PERSISTENCE_SCHEMA_VERSION` as a rollback mechanism. A lower version can leave newer namespaces untouched while the older application reads stale data.

If a reset is required, clearly communicate that the following browser-local data may be lost:

- Authentication session
- Saved journeys
- Operational transitions
- Synchronization reconciliation history
- Notification previews
- Configuration overrides
- UI preferences

After rollback, repeat the production smoke tests and verify that direct route refreshes still resolve through `index.html`.

## CI/CD recommendations

- Protect the production branch.
- Require lint, unit tests, build, and end-to-end tests before merge.
- Deploy pull requests to Vercel Preview only.
- Restrict production promotion to approved maintainers.
- Use a single deployment per commit to avoid testing a different artifact from the promoted artifact.
- Pin dependency versions through the package manifest and committed lockfile.
- Do not commit `.env` files.
- Do not expose tokens or credentials through `VITE_*` variables.
- Keep Playwright artifacts private and apply retention limits.
- Cancel superseded preview jobs for the same branch when supported.
- Serialize production promotions to prevent overlapping releases.
- Record the commit SHA, Vercel deployment URL, environment values, and storage schema version for each release.
- Treat warnings from migration, build, or test steps as release-review items.
- Do not enable diagnostics in production.
- Do not use production identities or data in smoke tests.

## Deployment checklist

### Before deployment

- [ ] Node.js version satisfies `>=20.19.0`.
- [ ] Dependencies install successfully.
- [ ] `npm run lint` passes.
- [ ] `npm run test` passes.
- [ ] `npm run build` passes.
- [ ] `npm run e2e` passes.
- [ ] Storage migrations are covered by tests.
- [ ] Preview environment variables are correct.
- [ ] Production environment variables are correct.
- [ ] Diagnostics are disabled for production.
- [ ] `vercel.json` retains the SPA rewrite.
- [ ] No production data or secrets are included in fixtures or environment values.

### Preview validation

- [ ] Login and role redirects work.
- [ ] Nested routes survive direct navigation and refresh.
- [ ] Partner scoping prevents cross-partner visibility.
- [ ] Journey save and resume work after refresh.
- [ ] Workbench transitions persist.
- [ ] Audit history is scoped and redacted.
- [ ] Horizon reconciliation is idempotent.
- [ ] GA configuration saves and resets.
- [ ] Browser console contains no unexpected errors.

### After production promotion

- [ ] Production URL serves the promoted commit.
- [ ] Environment banner shows `Production`.
- [ ] Diagnostics remain disabled.
- [ ] Static assets return successful responses.
- [ ] `/login` loads successfully.
- [ ] A protected nested route redirects unauthenticated users to `/login`.
- [ ] Authentication, partner, operations, and administration smoke tests pass.
- [ ] Existing browser storage hydrates or migrates as expected.
- [ ] The previous known-good Vercel deployment remains available for rollback.