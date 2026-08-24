# Changelog

All notable changes to Digital Onboarding are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-08-24

Initial release of the browser-only Digital Onboarding simulation.

### Added

#### Onboarding and guided journeys

- Multi-channel mock intake for SFTP, email, mail, fax, API, partner dashboard, and manual sources.
- Normalization support for Quility JSON, Ethos XML, DTCC flat files, SureLC TIF metadata, OCR-derived content, manual forms, and change requests.
- Structured intake results with completeness status, validation feedback, normalized JSON previews, correction actions, and per-record routing.
- Guided journeys for:
  - Individual producers
  - Registered representatives
  - Corporate applicants
  - Agencies and general agencies
  - Licensed principals
  - Financial institution employees
- Dynamic journey steps, source prefill, conditional skipping, progress tracking, save-and-exit, and partner-scoped resume support.
- Final review, electronic-consent simulation, signature capture, document package generation, placeholder document downloads, and submission readiness checks.
- Deterministic application, tracking, work-item, audit, correlation, and agent-code generation.
- Submission processing with validation, eligibility, manual-review routing, immutable submission snapshots, audit events, and browser-domain handoff events.

#### Validation and eligibility

- Runtime Zod contracts for onboarding records, drafts, provider checks, work items, audit events, notifications, synchronization attempts, contract changes, users, configuration, and persistence envelopes.
- Business rules covering:
  - Required routing and applicant identity fields
  - Source-channel and source-format authorization
  - Partner-scope consistency
  - Required forms and document completion
  - Carrier and agency restrictions
  - Corporate licensed-principal requirements
  - Commission schedules and advance restrictions
  - Errors and omissions requirements
  - Hierarchy resolution
  - Licensing and NPN validation
  - Duplicate applications and termination history
- Eligibility evaluation for active contracts, dual contracting, reusable background checks, reusable appointments, assignees, hierarchy resolution, and generated agent-code collisions.
- Deterministic provider simulations for NIPR, GIACT, AML, LIMRA, RegEd, BIG, Sircon/Vertafore, DTCC, Ethos, Horizon, DocuSign, and Verint.

#### Partner and operations cluster

- Partner dashboard with scoped activity summaries, recent lifecycle status, synchronization indicators, and resumable drafts.
- Partner status explorer with tracking ID, application number, NPN, agent-code, and recent-activity lookups.
- Defensive record-level partner and assignment scope enforcement across services, routes, collections, and API-style payloads.
- Operational workbench for appointment, background, exception, distribution, agency review, synchronization failure, DTCC manual change, and explanation-letter work.
- Work-item filtering, assignment, transition history, action-needed comments, completion, and authorized reopening.
- Contract change workflows for commission schedule, assignee, hierarchy, and contract-level changes, including automatic evaluation and manual routing.
- Canonical lifecycle projection combining onboarding records, audit events, provider checks, work items, and synchronization attempts.
- Synchronization status for Agent DB, LifePro, ALI, and Horizon.
- Idempotent Horizon just-in-time appointment reconciliation and duplicate prevention.
- Level-40 direct LifePro activation simulation.
- Role-visible notification previews, reminders, welcome messages, agency copies, delivery status, and agency-review submission gates.
- Filterable, redacted operational audit history.

#### Administration and configuration

- General agency configuration for agency types, forms, signatures, schedules, levels, hierarchy, advances, AML, appointments, notifications, Vector One, and review behavior.
- Browser-persisted configuration overrides with per-GA reset support.
- Optional administrator diagnostics for fixture validation, storage schema inspection, sanitized report export, and guarded demo-state reset.
- Diagnostics feature gating through `VITE_ENABLE_DIAGNOSTICS`.

#### Authentication and authorization

- Mock authentication using pre-provisioned synthetic identities.
- Role and permission policies for partner, agency, licensing, manager, distribution, operations, and administrator users.
- Protected routes with authentication, session-expiration, role, permission, route-policy, partner-context, and record-scope checks.
- Safe unauthorized and not-found pages that do not reveal protected record existence.
- Partner, assigned-work, assigned-organization, all-partner, and global scope models.

#### Persistence and fixtures

- Versioned browser persistence under `fd-2370-digital-onboarding:v1`.
- Validated storage envelopes containing schema version, save time, and aggregate data.
- Defensive handling of malformed, incompatible, unavailable, and quota-exceeded browser storage.
- Persistence migration coordinator with migration, reset, superseded-entry, and recoverable notice handling.
- Local persistence for authentication, onboarding overlays, journey drafts, document packages, provider results, work items, audit events, synchronization attempts, notifications, contract changes, configuration overrides, and UI preferences.
- Immutable synthetic fixtures for:
  - Intake samples
  - Onboarding records
  - Operational work items and history
  - Lifecycle and audit events
  - Notification logs
  - Synchronization attempts
  - Contract changes
  - Provider scenarios
  - Historical contracts, terminations, checks, appointments, licenses, uplines, assignees, and generated codes
  - Reference configuration
  - Demo users
- Runtime fixture validation, deterministic indexes, and pristine seed reset support.

#### User interface and accessibility

- Responsive React 19 interface built with Vite 7 and Tailwind CSS.
- Role-aware navigation, dashboards, forms, tables, cards, timelines, status badges, JSON viewers, document previews, and guided-journey progress.
- Dark-mode-ready visual styles and reduced-motion support.
- Semantic headings, landmarks, fieldsets, labels, captions, status regions, and alert regions.
- Keyboard-accessible navigation, sortable tables, row actions, pagination, menus, dialogs, and journey steps.
- Visible focus treatment, skip-to-content navigation, minimum touch targets, descriptive accessible names, and progress announcements.
- Loading, empty, error, retry, and success states for interactive workflows.
- Safe print behavior and responsive layouts across supported desktop and mobile viewport sizes.

#### Privacy and safety

- Synthetic-data notices throughout authentication, onboarding, partner, operations, administration, diagnostics, and download workflows.
- Masking utilities for email addresses, phone numbers, bank accounts, tax identifiers, license values, producer identifiers, record IDs, and contract numbers.
- Deep redaction for audit events, diagnostics, JSON previews, exports, logs, and placeholder documents.
- Sanitized client logging with environment-aware log levels.
- Safe file-name handling and browser-only JSON, XML, text, and placeholder document downloads.
- No production authentication, provider connections, onboarding transactions, database, or application server.
- No credentials, secrets, personal information, banking data, or production identifiers required in environment variables.

#### Setup, testing, and delivery

- Node.js `>=20.19.0` runtime requirement.
- Vite development, production build, and preview scripts.
- ESLint configuration for JavaScript, JSX, React, hooks, tests, configuration files, scripts, and Playwright.
- Prettier configuration for consistent ES module and JSX formatting.
- Vitest and Testing Library setup with jsdom, deterministic browser mocks, storage isolation, clipboard support, observer mocks, and time controls.
- Unit and integration coverage for:
  - Protected routes
  - Persistence and migration
  - Intake normalization and routing
  - Journey persistence and signing
  - Eligibility rules
  - Submission processing
  - Workbench transitions and assignment
  - Partner status scoping
  - Notification visibility
  - Contract changes
  - Synchronization and Horizon reconciliation
- Playwright end-to-end coverage across Chromium, Firefox, and WebKit for:
  - Authentication and protected routes
  - Intake success and malformed XML rejection
  - Journey save, resume, signature, and completion
  - Partner scope segregation
  - Operational work-item transitions
  - Audit history
  - Contract changes
  - Horizon reconciliation
  - General agency configuration save and reset
- Vercel static SPA delivery configuration with browser-history rewrites to `index.html`.
- Deployment guidance covering environment configuration, CI/CD stages, preview verification, persistence migration, promotion, rollback, and production smoke tests.
- Environment example values for development and diagnostics feature control.

[1.0.0]: https://github.com/fd-2370-digital-onboarding/releases/tag/v1.0.0