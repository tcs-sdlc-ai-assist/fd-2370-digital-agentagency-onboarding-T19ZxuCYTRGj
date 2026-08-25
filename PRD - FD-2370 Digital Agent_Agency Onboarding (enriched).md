# FD-2370 Digital Agent/Agency Onboarding

**Type**: web_app
**Audience**: Banner Life and William Penn contracting agents, corporate agents and principals, general agents and agencies, financial-institution partners, external onboarding vendors, LGA Licensing and Distribution teams, licensing managers, operational workbench users, and authorized partner-dashboard/API users.

## Business Context
LGA seeks to replace labor-intensive, repetitive agent and agency onboarding and maintenance processes for Banner Life and William Penn with a scalable, self-service digital process requiring minimal manual intervention. The source scope spans multi-channel intake, normalized API processing, guided contracting journeys, validation, document generation and e-signature, licensing, commission and hierarchy setup, background checks, appointments, notifications, licensing workbench operations, partner status reporting, and synchronization with systems of record. For this delivery pipeline, the product scope is converted into a static frontend-only demonstration web application that simulates the target enterprise workflows using mock data and browser-based state rather than live backend services or third-party integrations. [Auto-filled] [Pipeline-aligned]

## Functional Requirements

### FR-001 — Multi-channel onboarding intake and normalization [Pipeline-aligned]
Accept requests through SFTP, email, mail, and fax, including Quility JSON, Ethos XML, DTCC text/flat files, and SureLC TIF files, and translate supported submissions into uniform JSON payloads. In the pipeline-aligned implementation, these intake channels are represented as selectable source types and uploaded/mock-imported sample records in the UI; no real SFTP, email, mailroom, fax, OCR, or ingestion service is implemented. [Pipeline-aligned] [Auto-filled]
**Priority**: must_have | **Complexity**: high | **Source**: original_prd
**Acceptance Criteria**:
  - A supported Quility JSON, Ethos XML, DTCC text/flat-file, or SureLC TIF submission can be represented through a mock supported channel in the UI.
  - Each supported submission is shown as translated into the uniform JSON payload used by the generic onboarding flow.
  - Where OCR/ICR ingestion is represented, extracted data appears in the simulated normalized request.
  - The intake record retains source channel and format in the displayed data.
  - Users can select a mock source channel/format and see a simulated normalized output record. [Auto-filled] [Pipeline-aligned]

### FR-002 — File-intake completeness processing [Pipeline-aligned]
Reject file requests with missing or invalid mandatory data and require corrected resubmission. Automatically complete and submit requests when all required data, forms, and signatures are present. In this pipeline version, completeness checks and rejection reasons are simulated with frontend validation and predefined mock scenarios. [Pipeline-aligned] [Auto-filled]
**Priority**: must_have | **Complexity**: high | **Source**: original_prd
**Acceptance Criteria**:
  - Missing or invalid mandatory data causes rejection with validation reasons.
  - Corrected resubmission is required before a rejected file request can proceed.
  - A complete file request is automatically submitted without a guided journey.
  - An incomplete request that can be completed online follows the guided journey flow.

### FR-003 — Mock submission interface and simulated onboarding API contract viewer [Pipeline-aligned]
Expose the secured generic onboarding API concept through a mock submission interface and simulated API contract viewer in the frontend. Support multiple agency types, request types, companies, optional form data, and bulk onboarding. Authorization is represented by mock login state and role-based UI gating only; no real API or server security exists. [Pipeline-aligned] [Auto-filled]
**Priority**: must_have | **Complexity**: high | **Source**: original_prd
**Acceptance Criteria**:
  - Only authorized mock users can access the submission interface.
  - The interface accepts supported agency types, request types, companies, optional forms, and bulk submissions in simulated form.
  - Omission of any minimum field fails frontend validation.
  - Accepted requests retain the tracking ID in displayed records.
  - The app demonstrates these behaviors through frontend forms and mock responses only. [Auto-filled] [Pipeline-aligned]

### FR-004 — Onboarding request validation [Pipeline-aligned]
Validate source authorization, GA codes, company, request and agency types, channel, forms, commission configuration, hierarchy, appointment settings, payload formats, duplicate/in-progress applications, and re-onboarding or dual-contracting eligibility. In this pipeline version, validation is frontend-only using mock configuration data and deterministic rules. [Pipeline-aligned] [Auto-filled]
**Priority**: must_have | **Complexity**: high | **Source**: original_prd
**Acceptance Criteria**:
  - Source authorization and permitted GA codes are checked in mock rules.
  - All listed configuration and payload dimensions are validated.
  - Duplicate or in-progress applications do not create unintended duplicate onboarding in demo state.
  - Re-onboarding and dual contracting proceed only when eligible under configured mock rules.
  - Failures are recorded with actionable reasons.

### FR-005 — Journey creation, prefilling, and automatic submission [Pipeline-aligned]
Generate a journey URL when more information is required, prefill supplied data, skip completed pages, and permit automatic submission when all required information and signatures are available. For the static frontend app, journey URLs are simulated client-side routes and saved draft states are stored in localStorage. [Pipeline-aligned] [Auto-filled]
**Priority**: must_have | **Complexity**: high | **Source**: original_prd
**Acceptance Criteria**:
  - An accepted incomplete request produces a client-side journey URL.
  - Supplied data is prefilled.
  - Satisfied pages are skipped.
  - Complete requests can be automatically submitted in the simulation.
  - Users need not re-enter accepted complete data.

### FR-006 — Guided GA, agency, and agent journeys [Pipeline-aligned]
Provide separate GA/agency and contracting-agent journeys with splash and thank-you pages, progress indicators, summaries, editing, mock e-signature consent/sign-off, Save & Exit, help, and Partner Dashboard resume. Resume behavior uses browser persistence only. [Pipeline-aligned] [Auto-filled]
**Priority**: must_have | **Complexity**: high | **Source**: original_prd
**Acceptance Criteria**:
  - Each user receives the applicable journey.
  - Every journey contains the specified guidance and completion features.
  - Save & Exit preserves data locally.
  - Authorized users can resume through the Partner Dashboard.
  - Pre-submission edits appear in the final application.

### FR-007 — NIPR licensing validation and carrier rules [Pipeline-aligned]
Use fixture-based mock NIPR results to retrieve or validate NPN and licensing data and enforce Banner Life and William Penn rules. [Pipeline-aligned] [Auto-filled]
**Priority**: must_have | **Complexity**: high | **Source**: original_prd
**Acceptance Criteria**:
  - NPN and licensing data can be retrieved or validated through mock NIPR responses.
  - Banner applicants are licensed in at least one state other than New York and Puerto Rico.
  - William Penn applicants are licensed in New York.
  - Non-traditional agencies cannot be selected for William Penn.
  - A failed carrier rule blocks eligible submission in the UI.

### FR-008 — Dynamic contract types and corporate principals [Pipeline-aligned]
Support individual, corporate, financial-institution employee, and registered-representative contracts, including applicable biographical and adoption forms. Support multiple corporate principals and require at least one appropriately licensed principal. In the static frontend app, form variations and generated outputs are shown as dynamic UI sections and mock preview artifacts rather than real generated documents. [Pipeline-aligned] [Auto-filled]
**Priority**: must_have | **Complexity**: high | **Source**: original_prd
**Acceptance Criteria**:
  - Applicable workflows and forms are presented by contract type.
  - Registered representatives use BK-23; financial-institution employees use BK-14.
  - Multiple corporate principals can be captured.
  - At least one corporate principal must satisfy licensing requirements.
  - Applicable biographical and adoption forms are included in the simulated package.

### FR-009 — Contracting data capture and validation [Pipeline-aligned]
Capture and validate applicable background disclosures, affiliations, AML, Reg 187, E&O, licensing, bank, commission, assignment, and hierarchy information. All validation and rule feedback occurs in the frontend using mock datasets and client-side state. [Pipeline-aligned] [Auto-filled]
**Priority**: must_have | **Complexity**: high | **Source**: original_prd
**Acceptance Criteria**:
  - Applicable data categories are captured according to configuration.
  - Required fields and rules are validated.
  - E&O is mandatory for advance commission or Utah/Rhode Island residency; otherwise optional.
  - Monthly check payment is not offered.
  - Errors identify required corrections.

### FR-010 — GA onboarding configuration [Pipeline-aligned]
Configure each GA for agency type, forms, commission schedules, deal codes, levels, hierarchy, advance commissions, AML, appointment behavior, notifications, Vector One handling, and optional agency contract review. In the static frontend app, configuration is managed through mock admin screens backed by JSON fixtures and localStorage. [Pipeline-aligned] [Auto-filled]
**Priority**: must_have | **Complexity**: high | **Source**: original_prd
**Acceptance Criteria**:
  - Authorized mock admin users can maintain every listed setting by GA.
  - Configuration controls relevant journeys and processing.
  - Agency contract review can be enabled or disabled by GA.
  - Changes affect subsequent applicable processing in demo state.

### FR-011 — Configured agent contracting selections
Allow configured GA selection of agent level, commission schedule, upline, advance-commission eligibility, and assignment eligibility, subject to validation.
**Priority**: must_have | **Complexity**: medium | **Source**: original_prd
**Acceptance Criteria**:
  - Only GA-enabled choices are presented.
  - Every selection is validated.
  - ABNCA prohibits advance commission and assignment.
  - Invalid combinations are blocked with actionable messages.

### FR-012 — Hierarchy and assignee validation
Validate uplines and assignees and derive and display the full hierarchy through the topline.
**Priority**: must_have | **Complexity**: high | **Source**: original_prd
**Acceptance Criteria**:
  - An upline is contracted, under the same GA, and at a higher level.
  - An assignee is contracted under the same GA and satisfies licensing/assignment rules.
  - The complete hierarchy is displayed before submission.
  - Invalid hierarchy or assignment cannot be submitted.

### FR-013 — Agent-code generation [Pipeline-aligned]
Generate unique agent codes under GA and level rules and route non-automated cases to the workbench. In the pipeline-aligned implementation, code generation is simulated in the frontend using deterministic mock rules and fixture-backed uniqueness checks within the demo dataset. [Pipeline-aligned] [Auto-filled]
**Priority**: must_have | **Complexity**: high | **Source**: original_prd
**Acceptance Criteria**:
  - Automated generation follows GA and level rules.
  - Level 25, 30, and 40 codes are unique and end in 0000.
  - William Penn traditional hierarchy does not offer level 30.
  - Non-automated cases create workbench items.
  - The assigned code is associated with the correct application.

### FR-014 — Dynamic contract document package and e-signature [Pipeline-aligned]
Generate dynamic contract packages with applicable forms, retained GA signatures, agent e-signatures, and current dates. In this pipeline version, contract packages are represented as mock document previews and downloadable placeholder files; no real PDF generation or legal signature capture occurs. [Pipeline-aligned] [Auto-filled]
**Priority**: must_have | **Complexity**: high | **Source**: original_prd
**Acceptance Criteria**:
  - The package contains applicable forms.
  - Retained GA signatures are placed where applicable in the mock preview.
  - Agent signatures are applied to required locations in simulated sign-off state.
  - Current dates are applied as required.
  - Only complete packages can be submitted.

### FR-015 — Bank validation and tax/bank forms [Pipeline-aligned]
Validate commission-payment bank data through simulated GIACT gVerify and gAuthenticate responses, display the bank and branch, and generate BK-12 and W-9 where applicable. No real financial verification is performed. [Pipeline-aligned] [Auto-filled]
**Priority**: must_have | **Complexity**: high | **Source**: original_prd
**Acceptance Criteria**:
  - Bank data is sent through applicable simulated GIACT checks.
  - Bank and branch are displayed.
  - Failed or unverifiable validation is handled as an exception state.
  - BK-12 and W-9 are generated as mock artifacts when applicable.

### FR-016 — AML certification and verification [Pipeline-aligned]
Capture AML certification and perform configured verification through LIMRA, RegEd, or another configured vendor. In the pipeline-aligned implementation, provider responses are mocked and selectable/configurable in demo data. [Pipeline-aligned] [Auto-filled]
**Priority**: must_have | **Complexity**: high | **Source**: original_prd
**Acceptance Criteria**:
  - AML certification is captured when required.
  - The configured provider is invoked in simulated flow.
  - LIMRA and RegEd can be configured.
  - Results are attached to the application and drive processing.

### FR-017 — Background-check determination and reuse [Pipeline-aligned]
Determine background-check need from background answers, states, advance commission, agent type, pre-contracting status, and prior checks within a configurable period initially set to 180 days. In this pipeline version, the configurable period and decision logic are executed client-side against mock historical records. [Pipeline-aligned] [Auto-filled]
**Priority**: must_have | **Complexity**: high | **Source**: original_prd
**Acceptance Criteria**:
  - Every applicable listed input is evaluated.
  - The reuse period defaults to 180 days and is configurable.
  - Registered representatives skip background checks.
  - Eligible recent checks are reused.
  - Pre-contracting requests without signed PDFs skip background checks.
  - The determination and reason are recorded.

### FR-018 — BIG background-check processing [Pipeline-aligned]
Integrate with BIG for requests/results, close successful checks automatically, and route unsuccessful or explanation-letter cases to licensing work items. In the pipeline-aligned implementation, BIG requests/results are simulated through mock status transitions and seeded scenarios. [Pipeline-aligned] [Auto-filled]
**Priority**: must_have | **Complexity**: high | **Source**: original_prd
**Acceptance Criteria**:
  - Requests and results correlate to applications.
  - Results update the background-check record.
  - Successful results close automatically.
  - Unsuccessful results create or update licensing work.
  - Explanation-letter cases are routed appropriately.

### FR-019 — Appointment models and Sircon/Vertafore integration [Pipeline-aligned]
Support configurable just-in-time and pre-appointment models and use simulated Sircon/Vertafore results to create and activate state lines and agents after successful appointments. [Pipeline-aligned] [Auto-filled]
**Priority**: must_have | **Complexity**: high | **Source**: original_prd
**Acceptance Criteria**:
  - Appointment model is configurable.
  - Most GAs may use just-in-time while exceptions use pre-appointment.
  - Required requests are sent to simulated Sircon/Vertafore processing.
  - Successful results create or activate state lines and agents in demo state.
  - Results update application status.

### FR-020 — Dual-contracting asset reuse
Reuse eligible background checks, appointments, and state-line status for dual contracts.
**Priority**: must_have | **Complexity**: high | **Source**: original_prd
**Acceptance Criteria**:
  - Existing assets are checked before creating requests.
  - Eligible assets are linked to the new contract.
  - Duplicate third-party requests are prevented in simulated flow.
  - Ineligible assets are not reused.

### FR-021 — DTCC AI and AA automation [Pipeline-aligned]
Automate supported DTCC AI and AA transactions for Edward Jones, Merrill Lynch, Morgan Stanley, and configured partners with output and rejection codes. In the static frontend app, DTCC transaction processing is represented through mock import screens, rule evaluation, and canned result codes. [Pipeline-aligned] [Auto-filled]
**Priority**: must_have | **Complexity**: high | **Source**: original_prd
**Acceptance Criteria**:
  - Supported partner transactions are processed.
  - Valid transactions return applicable output codes.
  - Invalid or unsupported transactions return rejection codes.
  - Results correlate to partner and source records.

### FR-022 — Edward Jones AI processing rules
For Edward Jones AI, create coordinated codes under SPB0000, CGB0000, and CRE0000; use P-JT; default ABNCA; and skip background checks for BK-23 registered representatives.
**Priority**: must_have | **Complexity**: high | **Source**: original_prd
**Acceptance Criteria**:
  - Coordinated codes are created under all three specified codes.
  - Records use P-JT.
  - ABNCA is the default schedule.
  - BK-23 registered representatives skip checks.
  - ABNCA prevents advances and assignment.

### FR-023 — Manual routing of non-onboarding DTCC changes
Route address, name, termination, and other non-onboarding DTCC changes to licensing workbench cards.
**Priority**: must_have | **Complexity**: medium | **Source**: original_prd
**Acceptance Criteria**:
  - These transactions are identified as non-onboarding.
  - A workbench card contains source details.
  - The transaction is not treated as new onboarding.
  - The card supports work-item states.

### FR-024 — Ethos-specific processing [Pipeline-aligned]
Support Ethos pre-contracting and subsequent appointments, record and appointment reuse, configured termination processing, DocuSign PDFs, requested-state appointments, and a daily XML feed. In the pipeline-aligned implementation, Ethos XML ingestion, DocuSign documents, and daily feed output are all mocked in the UI as imported/exported sample artifacts. [Pipeline-aligned] [Auto-filled]
**Priority**: must_have | **Complexity**: high | **Source**: original_prd
**Acceptance Criteria**:
  - Ethos XML initiates supported simulated processes.
  - Eligible pre-contracting records and appointments are reused.
  - A subsequent request contains at most one state.
  - DocuSign PDFs are associated with the application as mock artifacts.
  - Requested-state appointments and terminations follow configuration.
  - The daily XML feed is produced as a mock output artifact.

### FR-025 — Role-based licensing workbench [Pipeline-aligned]
Provide agent search/details, pending/action-needed/completed states, and cards for background checks, appointments, explanation letters, distribution approval, and exceptions. In this pipeline version, role-based access is represented by mock user roles after mock login; search and work items operate on fixture data only. [Pipeline-aligned] [Auto-filled]
**Priority**: must_have | **Complexity**: high | **Source**: original_prd
**Acceptance Criteria**:
  - Authorized users can search and view applicable details.
  - All specified work-item states are supported.
  - Every specified card type is supported.
  - Access is role-limited in the frontend.
  - State changes appear in history.

### FR-026 — Verint assignment and lifecycle status tracker [Pipeline-aligned]
Use Verint for assignment and track New, Application Started, Application Submitted, Application Under Review, Background Check, Appointment, and Contracted/Terminated. In the pipeline-aligned implementation, Verint assignment is represented as internal mock assignment state and lifecycle tracking within the frontend. [Pipeline-aligned] [Auto-filled]
**Priority**: must_have | **Complexity**: high | **Source**: original_prd
**Acceptance Criteria**:
  - Applicable work is assigned through simulated Verint state.
  - Every specified status is supported.
  - Workflow events update status.
  - Contracted and terminated outcomes are distinguishable.
  - Authorized users can view current status.

### FR-027 — Configurable notifications and agency review [Pipeline-aligned]
Provide configurable email/SMS notifications, reminders, agency-copy preferences, welcome emails, and optional agency review. In this pipeline version, notifications are simulated in-app and/or shown in mock preview logs; no real email or SMS is sent. [Pipeline-aligned] [Auto-filled]
**Priority**: must_have | **Complexity**: high | **Source**: original_prd
**Acceptance Criteria**:
  - Email, SMS, and reminders are configurable in the simulation.
  - Agency-copy preferences control copies.
  - Welcome communication is email, not a physical letter.
  - Configured agency review blocks carrier submission until completed.
  - Unconfigured review is skipped.

### FR-028 — Partner-segregated status view and API explorer [Pipeline-aligned]
Provide the secured partner onboarding status-feed API concept as a mock partner status view and API explorer screen using frontend filters and role/partner-based UI gating only. Support lookup by agent code, NPN, application number, tracking ID, or a recent-days window initially set to 30 days. [Pipeline-aligned] [Auto-filled]
**Priority**: must_have | **Complexity**: high | **Source**: original_prd
**Acceptance Criteria**:
  - Only authorized partners can access the mock status interface.
  - Cross-partner data retrieval is blocked in frontend filtering and UI gating.
  - All four direct lookup keys are supported.
  - Recent-window lookup is supported.
  - The initial configurable default is 30 days.

### FR-029 — Partner status-feed data [Pipeline-aligned]
Return applicable identity, contact, contract, commission, hierarchy, GA, application, state-line, background, appointment, advance-commission, and assignment data. In the static frontend app, response payloads are displayed from mock records and filtered by partner context. [Pipeline-aligned] [Auto-filled]
**Priority**: must_have | **Complexity**: high | **Source**: original_prd
**Acceptance Criteria**:
  - Every applicable listed domain is returned.
  - Only applicable authorized fields are included.
  - Responses correlate to the lookup criterion.
  - Status matches the platform tracker.

### FR-030 — Systems-of-record synchronization [Pipeline-aligned]
Load activated agents into Agent DB as source of truth, synchronize agent and commission data with LifePro, and synchronize with ALI and Horizon to prevent duplicates. In this pipeline version, all systems-of-record synchronization is represented as mock sync history, status badges, and simulated success/failure states; no real synchronization occurs. [Pipeline-aligned] [Auto-filled]
**Priority**: must_have | **Complexity**: high | **Source**: original_prd
**Acceptance Criteria**:
  - Activated agents are shown as loaded into Agent DB in mock sync history.
  - Required data is shown as synchronized with LifePro in simulation.
  - ALI and Horizon can identify digitally onboarded agents in mock duplicate-prevention state.
  - Duplicate onboarding is prevented in demo logic.
  - Synchronization outcomes and failures are recorded.

### FR-031 — Horizon just-in-time redirection [Pipeline-aligned]
Redirect Horizon just-in-time events for digitally onboarded agents to digital background-check and appointment processing. In the static frontend app, Horizon events are mock events from fixture data that drive simulated routing in the UI. [Pipeline-aligned] [Auto-filled]
**Priority**: must_have | **Complexity**: high | **Source**: original_prd
**Acceptance Criteria**:
  - Horizon events are checked against digital records.
  - Matches route to the digital process.
  - Correlation data is retained.
  - Duplicate parallel onboarding is prevented.

### FR-032 — Partner Dashboard initiation and resume [Pipeline-aligned]
Allow authorized agencies to initiate onboarding through the generic API concept and resume saved applications in the Partner Dashboard. In the pipeline-aligned implementation, initiation is done through frontend forms and resume uses localStorage/browser state only. [Pipeline-aligned] [Auto-filled]
**Priority**: must_have | **Complexity**: high | **Source**: original_prd
**Acceptance Criteria**:
  - Authorized users can initiate onboarding.
  - Dashboard initiation uses the same generic submission flow.
  - Users can resume their agency's saved applications from local browser state.
  - Unauthorized access is denied by mock route protection and UI gating.

### FR-033 — Agency onboarding for levels 25, 30, and 40
Support levels 25, 30, and 40, including distribution approval and level 40 special processing.
**Priority**: must_have | **Complexity**: high | **Source**: original_prd
**Acceptance Criteria**:
  - Applicable journeys support all three levels.
  - William Penn traditional onboarding excludes level 30.
  - Distribution approval is captured or routed.
  - Level 40 has no hierarchy.
  - Level 40 routes directly to LifePro, not ALI BAU, in domain simulation.
  - Relevant codes are unique and end in 0000.

### FR-034 — Supported contracting-change API and journey [Pipeline-aligned]
Provide an Edit API and journey for supported hierarchy, commission schedule, level, and assignee changes. Route complex or mass hierarchy changes to manual workbench processing. In this pipeline version, the Edit API is represented as a mock change-request UI and simulated response state. [Pipeline-aligned] [Auto-filled]
**Priority**: must_have | **Complexity**: high | **Source**: original_prd
**Acceptance Criteria**:
  - The Edit API concept accepts each supported change type through mock UI.
  - The journey captures required change data.
  - Relevant onboarding rules are reused.
  - Complex or mass hierarchy changes create workbench items.
  - Change outcomes are recorded.

### FR-035 — Onboarding and change audit history [Pipeline-aligned]
Maintain detailed histories with timestamps and user details. In the static frontend app, audit history is stored in local demo state and browser persistence rather than a backend audit store. [Pipeline-aligned] [Auto-filled]
**Priority**: must_have | **Complexity**: high | **Source**: original_prd
**Acceptance Criteria**:
  - Material onboarding actions and state changes are timestamped.
  - Supported maintenance actions are timestamped.
  - User or system actor is recorded.
  - Authorized users can review history.
  - Automated and user actions are distinguishable.

### FR-036 — Termination-for-cause onboarding restriction [Pipeline-aligned]
Prevent agents terminated for cause with reason CC or SU from onboarding under another agency. In this pipeline version, prior termination checks are performed against fixture-based historical records only. [Pipeline-aligned] [Auto-filled]
**Priority**: must_have | **Complexity**: medium | **Source**: original_prd
**Acceptance Criteria**:
  - Prior terminations are checked.
  - CC or SU blocks onboarding under another agency.
  - The reason is recorded and available to authorized operations users.
  - No activated contract is created for an ineligible request.

## Non-Functional Requirements

### NFR-001 — security
Protected APIs, Partner Dashboard, and workbench access must be limited to authorized clients/users, with partner data segregated.
**Target**: 100% of attempted cross-partner status-data access and unauthorized protected-interface access is denied in authorization testing.

### NFR-002 — scalability
Support scalable self-service and bulk onboarding while reserving manual processing for defined exceptions.
**Target**: Bulk onboarding is supported, complete valid requests proceed without manual intervention, and only configured exceptions/designated manual cases route to workbench.

### NFR-003 — auditability
Histories must identify timestamps and user/system actors.
**Target**: 100% of material onboarding and supported change state transitions include timestamp and actor.

### NFR-004 — data_consistency
Synchronization among Agent DB, LifePro, ALI, and Horizon must support Agent DB as source of truth and prevent duplicate onboarding.
**Target**: Every activated-agent synchronization attempt records success/failure, and duplicate-prevention checks use available synchronized digital status.

### NFR-005 — authentication
Users must log in to access protected areas of the application; login is a mocked frontend-only experience with no external identity provider. [Clarified] [Auto-filled]
**Target**: 100% of protected routes redirect unauthenticated users to the mock login page; role-specific UI is shown only after mock authentication. [Clarified] [Auto-filled]

### NFR-006 — performance
The static frontend should provide responsive interactions for typical demo datasets and common user flows. [Auto-filled]
**Target**: On a standard desktop browser, primary route transitions and filter actions complete within 1 second for datasets up to 1,000 mock records; initial page load target under 3 seconds in local/static hosting conditions. [Auto-filled]

### NFR-007 — availability
The product is intended for static hosting and local/demo use rather than guaranteed enterprise uptime. [Pipeline-aligned] [Auto-filled]
**Target**: Application is deployable to Vercel static hosting; availability SLAs are not defined for this pipeline version. [Pipeline-aligned] [Auto-filled]

### NFR-008 — privacy
Personal and financial data shown in the app must use fake values, be masked where appropriate, and never be logged in full to the browser console. [Auto-filled]
**Target**: 100% of mock PII uses obviously fake values; sensitive fields are masked in summary/history views; console/debug logs exclude unmasked pii_fields. [Auto-filled]

### NFR-009 — accessibility
The application must support accessible responsive web usage. [Clarified] [Auto-filled]
**Target**: Responsive layouts support desktop and tablet/mobile breakpoints; interactive elements are keyboard accessible; forms use labels and error messaging; color contrast aims to meet WCAG 2.1 AA baseline where practical in the frontend. [Clarified] [Auto-filled]

### NFR-010 — retention
Browser-persisted demo data should be retained only for local user convenience and be resettable. [Auto-filled]
**Target**: Users can clear saved drafts/demo state from the UI; localStorage-backed data persists across sessions until the user clears it or the browser storage is reset. [Auto-filled]

### NFR-011 — monitoring
Operational monitoring is limited in a static frontend application. [Pipeline-aligned] [Auto-filled]
**Target**: Client-side error states are surfaced via UI messages; optional frontend console diagnostics must not expose PII; no server-side monitoring is implemented. [Pipeline-aligned] [Auto-filled]

### NFR-012 — compliance
No formal regulatory certification is committed in this pipeline version; privacy-conscious handling and accessibility baseline apply. [Clarified] [Auto-filled]
**Target**: No claims of SOC 2, HIPAA, PCI, or other certification are made unless later defined by the business. [Clarified] [Auto-filled]

## Tech Stack
- **Frontend**: Vite + React JS (JavaScript/JSX only) [Pipeline-aligned]
- **Backend**: No backend; mocked frontend-only behaviors using JSON fixtures, localStorage, and optional in-memory state [Pipeline-aligned]
- **Database**: No live database; JSON fixtures plus localStorage [Pipeline-aligned]
- **Infrastructure**: Vercel static hosting only [Pipeline-aligned]
- *Specified by user*: True

## In Scope
- Static frontend simulation of onboarding, validation, dashboard, workbench, and partner workflows using mock data and browser-based state.
- Multi-channel intake represented through selectable source types, mock file imports, and normalized JSON views.
- Guided GA, agency, corporate, principal, individual-agent, financial-institution employee, and registered-representative journeys.
- Carrier-, GA-, agency-, contract-, licensing-, commission-, hierarchy-, bank-, AML-, background-, appointment-, and eligibility-rule validation in frontend simulation.
- Mock contract package previews, retained GA signatures, mock agent sign-off, and placeholder document artifacts.
- Mock partner status feed, partner dashboard, licensing workbench, notifications, reminders, and agency review.
- Agency onboarding at levels 25, 30, and 40 including level 40 direct LifePro handling in simulated domain logic.
- Supported hierarchy, commission schedule, level, and assignee changes through a mock Edit API journey.
- Audit history for onboarding and supported maintenance changes stored in local demo state.
- Mock login experience for partner and internal users with role-based UI states only.
- Browser-based persistence for saved applications, dashboard filters, mock history, and demo state using JSON fixtures plus localStorage.

## Out of Scope
- The document's final OLD Process section, which is explicitly not for reference.
- Physical welcome-letter generation; the intended welcome communication is email.
- Monthly check payment through digital onboarding.
- Automated handling of complex or mass hierarchy changes; these remain workbench/manual processes.
- Replacing all manual ALI onboarding during the transition.
- Existing ALI BAU setup for level 40 agencies; level 40 uses direct LifePro setup.
- Automated processing of non-onboarding DTCC address, name, and termination changes outside the workbench/manual flow.
- Unfinalized TBD items, including detailed offboarding scope and workflows.
- Any real backend implementation, real API hosting, real third-party integration, real database, real file transfer, real email/SMS delivery, real e-signature execution, real PDF generation, or real synchronization with systems of record. [Pipeline-aligned]
- SSO, OIDC, SAML, Google/Microsoft sign-in, or any external identity provider integration. [Pipeline-aligned]
- Actual server-enforced security controls such as TLS termination, HSTS, CSP headers, or backend rate limiting; UI hints may represent these concepts only. [Pipeline-aligned]

## Assumptions
- Manual onboarding continues in ALI during transition.
- Vendors generally submit complete data, signatures, and files; direct agencies may start with minimum data and finish online.
- Most agencies use just-in-time appointments; configured exceptions may use pre-appointment.
- Ethos generally follows Quility except for XML input, DocuSign PDFs, requested/subsequent appointments, and daily XML feed.
- Background-check reuse defaults initially to 180 days; status-feed lookback defaults initially to 30 days; both are configurable.
- DTCC data is generally treated as clean after CANDO/CAN'T DO segregation.
- Traditional, non-traditional, and financial-institution processes have distinct rules.
- Existing ALI logic may be reused as services.
- Welcome communication is email.
- Login is required to access protected areas of the app; for this pipeline version, login/signup are mocked UI states only with no real identity provider. [Clarified] [Auto-filled] [Pipeline-aligned]
- Users for the mock login experience are assumed to be pre-provisioned demo users for partner and internal roles. Mock login UI hints should explain that access is simulated for demonstration purposes. [Auto-filled] [Pipeline-aligned]
- Data layer: JSON fixtures plus localStorage for saved applications, filters, configuration edits, and audit/history demo state; no live database. [Clarified] [Auto-filled] [Pipeline-aligned]
- Expected v1 scale for product design: internal/admin users in the tens to low hundreds, external partner users in the low hundreds to a few thousand, and onboarding records demonstrated in the UI in the hundreds to low thousands. [Clarified] [Auto-filled]
- Compliance/accessibility expectation for v1: responsive accessible web baseline plus privacy-conscious handling of personal and financial information; no specific formal certification is committed unless later required by the business. [Clarified] [Auto-filled]
- If future enterprise delivery is pursued, detailed API schemas, auth mechanisms, retention, monitoring, and operational controls will be determined during HLD/LLD phase based on requirements. [Auto-filled]

## Constraints
- Implementation is limited to a static frontend web app built with Vite + React JS (JavaScript/JSX only) and Tailwind CSS. [Pipeline-aligned] [Auto-filled]
- All backend, integration, authorization, document generation, and synchronization behaviors must be simulated using mocked responses and browser-based demo state only. [Pipeline-aligned] [Auto-filled]
- File upload/import capabilities, where shown, are mock UI only with simulated progress and no real transfer or server storage. [Pipeline-aligned] [Auto-filled]
- Partner status data must be segregated.
- William Penn excludes non-traditional agencies and traditional level 30.
- Level 40 agencies have no hierarchy and are set up directly in LifePro in domain simulation.
- ABNCA prohibits commission assignment and advance commission.
- Monthly check payment is unavailable digitally.
- Deployment target is Vercel static hosting only. [Pipeline-aligned] [Auto-filled]
- No backend services, server rendering, worker queues, cron jobs, or scheduled jobs are implemented. [Pipeline-aligned] [Auto-filled]

## Additional Context
Reference date: 2026-08-24 [Auto-filled]

Delivery mode for this PRD: This PRD defines a pipeline-aligned static frontend web app that demonstrates onboarding, dashboard, status tracking, workbench, and integration-driven workflows through mocked UI states and simulated responses only. Live APIs, backend workflows, real databases, real authentication providers, document generation services, and systems-of-record synchronization are out of implementation scope for this pipeline version. [Auto-filled] [Pipeline-aligned]

Source Traceability and Counts from original PRD:
- Functional requirements: 36
- Non-functional requirements: 12
- Total requirements: 48
- From original source material: 40
- From user clarification: 0
- From default assumptions: 8

Open Specification Gaps:
The consolidated analysis did not finalize detailed email/fax/mail ingestion and OCR/ICR implementation, final DTCC and LIMRA behavior, offboarding workflows, complex/mass hierarchy processing, workbench UX, detailed role matrices, API schemas/versioning/errors/rate limits, authentication mechanisms, retention/privacy rules, performance and availability targets, migration/ALI retirement, monitoring, or disaster recovery. These remain specification gaps and are not converted into requirements in this PRD.

For the pipeline-aligned version, unresolved enterprise-production details are intentionally represented as mocked frontend behavior. Where the user provided no preference, implementation specifics beyond this static frontend scope are to be determined during HLD/LLD phase based on requirements. [Auto-filled]

Authentication, Roles, and Access Model:
- Authentication requirement: Login is required to access protected areas of the application. [Auto-filled] [Clarified]
- Authentication approach: The pipeline-aligned product uses mocked login and signup screens with frontend-only session state. No real SSO, OIDC, SAML, MFA provider, or backend session management is implemented. [Auto-filled] [Pipeline-aligned]
- Role model: Partner user; Agency user; Licensing representative; Licensing manager; Distribution approver; Workbench/operations user; Admin/configuration user.
- These roles control visible navigation, accessible screens, and permitted actions in the UI only. [Auto-filled] [Pipeline-aligned]
- Access behavior: Unauthenticated users are redirected to the mock login page for protected routes. [Auto-filled]
- Partner users can see only their own agency/partner-scoped records in mock data views. [Auto-filled]
- Internal users can access workbench, history, and admin/configuration screens according to mock role permissions. [Auto-filled]
- If signup is shown, it is a mock UI convenience only and does not create a real account. [Auto-filled] [Pipeline-aligned]

Data Persistence and Mock Data Strategy:
- Persistence strategy: The application uses JSON fixtures plus localStorage for browser-based persistence. [Auto-filled] [Clarified] [Pipeline-aligned]
- Data storage details:
  - Seed/reference data such as GAs, contract types, partner names, statuses, and sample records should come from local JSON fixtures. [Auto-filled]
  - User-generated demo data such as saved drafts, journey progress, filters, recent searches, configuration changes, and mock audit history should persist in localStorage. [Auto-filled]
  - Temporary UI state may also use in-memory React state during a session. [Auto-filled]
  - No real database, server storage, or cloud storage is used. [Auto-filled] [Pipeline-aligned]
- File handling: Any file upload/import capability is mock-only. The UI may allow file selection and simulated progress, but files are not transmitted to a server. [Auto-filled] [Pipeline-aligned]

PII and Sensitive Data Handling:
- pii_fields:
  - full_name
  - email
  - phone
  - mailing_address
  - date_of_birth
  - npn
  - agent_code
  - application_number
  - tracking_id
  - tax_id_last4
  - bank_account_last4
  - routing_number_masked
  - corporate_principal_name
  - license_number
  - state_license_status
  - background_check_status
  - appointment_status
- Data-handling rules:
  - All mock data must use obviously fake values (for example, “Jane Demo”, “demo.user@example.test”, “****1234”). [Auto-filled]
  - Summary views should mask sensitive financial/account-style values and only display limited trailing digits where needed. [Auto-filled]
  - Browser console logging and debug output must not emit unmasked pii_fields. [Auto-filled]
  - Export/download examples, if included, must also use fake data only. [Auto-filled]
  - No real customer, partner, or employee data may be embedded in fixtures. [Auto-filled]

Scale and Usage Assumptions:
- Internal/admin users: tens to low hundreds. [Auto-filled] [Clarified]
- External partner users: low hundreds to a few thousand. [Auto-filled] [Clarified]
- Onboarding records demonstrated in the UI: hundreds to low thousands. [Auto-filled] [Clarified]
- Product implication: The v1 static frontend should optimize for clarity of workflows, responsiveness with demo-scale datasets, and realistic role-based scenarios rather than production-scale throughput. [Auto-filled]

Compliance, Privacy, and Accessibility:
- Compliance/privacy: No specific regulatory certification is mandated in this PRD version unless later added by the business. Privacy-conscious handling of personal and financial information is required in the static app. [Auto-filled] [Clarified]
- Accessibility: The application should provide an accessible responsive web baseline, including keyboard-accessible navigation, labeled form controls, visible focus states, and readable error messaging. [Auto-filled] [Clarified]
- Responsive design: The application must support desktop-first workflows while remaining usable on tablet and mobile widths for review, search, and status tasks. [Auto-filled]

Hosting and Operational Constraints:
- Deployment target: Vercel static hosting only. [Auto-filled] [Pipeline-aligned]
- No backend services, server rendering, worker queues, cron jobs, or scheduled jobs are implemented. [Auto-filled] [Pipeline-aligned]
- Daily feeds, sync jobs, or partner updates are represented as user-triggered mock actions or static sample outputs in the UI. [Auto-filled] [Pipeline-aligned]
- Server-side security headers and transport/security infrastructure are outside the app’s implementation scope and may be represented as informational UI hints only. [Auto-filled] [Pipeline-aligned]

Technology stack source note:
The source documents explicitly identify the following service and interface technologies. No concrete frontend framework, backend framework, or database technology was named in the original enterprise materials: SFTP, API, JSON, XML, OCR/ICR, NIPR, DocuSign, GIACT gVerify, GIACT gAuthenticate, Verint.

Delivery Alignment Note:
This enterprise scope requires live APIs, backend workflows, document generation, databases/systems of record, authentication/authorization, and numerous third-party integrations. For delivery through this SDLC automation pipeline, the requirements are interpreted as a static frontend simulation rather than a production enterprise platform. Any requirement implying backend processing, secured live APIs, real databases, real auth, real third-party integrations, document generation services, or systems-of-record synchronization is rewritten as mock UI behavior and mocked responses. [Clarified] [Auto-filled] [Pipeline-aligned]