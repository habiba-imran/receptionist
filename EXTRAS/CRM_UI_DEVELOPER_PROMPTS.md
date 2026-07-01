# CRM UI Developer Prompts

Use these prompts in order. They are written for the developer building `crm-ui` so they can work against the current backend and schema without guessing.

## Current State Summary

Project facts that the developer should assume are already true:

- The CRM frontend lives in `C:\Agent-CRM-demo\crm-ui`.
- `crm-ui` is already a Next.js App Router app on Next `16.2.9` and React `19.2.4`.
- `crm-ui/src/app/page.tsx` is still the default starter page.
- `crm-ui/src/app/globals.css` already contains a dark CRM/dashboard design system and many ready-made class names for:
  - sidebar
  - top bar
  - booking list
  - detail panel
  - cards
  - alerts
  - tabs
  - transcript and recording UI
- The backend CRM endpoint already exists at `supabase/functions/crm-api/index.ts`.
- The backend CRM endpoint currently supports:
  - `GET` -> returns `{ bookings, messages }`
  - `POST` with `action: "resend_confirmation"` and `call_id`
  - `POST` with `action: "resend_form"` and `call_id`
- If `CRM_SECRET` is set in Supabase, requests must include header `x-crm-secret`.
- The frontend should **not** expose that secret in the browser.
- There is already a `bookings` table and a `message_log` table in Supabase.
- The Retell flow writes into `bookings`, and post-call messaging writes into `message_log`.
- There is no need for direct Supabase client usage inside `crm-ui` right now.
- For now, treat the CRM as an internal operations dashboard, not a public app.

## Important Backend Contract

The CRM backend currently returns the latest records from these two tables:

### `bookings`

Important fields currently available:

- `id`
- `call_id`
- `created_at`
- `updated_at`
- `call_started_at`
- `representative`
- `practice`
- `patient_acct`
- `assigned_doctor`
- `language`
- `contact_number`
- `whatsapp_suitable`
- `first_name`
- `full_legal_name`
- `dob`
- `gender`
- `mailing_address`
- `callback_number`
- `email`
- `reason`
- `appointment_text`
- `appointment_at`
- `patient_status`
- `patient_status_unverified`
- `insurance_status`
- `payer_name`
- `member_id`
- `group_number`
- `plan_type`
- `payer_id`
- `customer_service_number`
- `provider_name`
- `npi`
- `tax_id`
- `cpt_codes`
- `date_of_service`
- `patient_is_subscriber`
- `subscriber_name`
- `subscriber_dob`
- `subscriber_relationship`
- `subscriber_employer`
- `has_secondary`
- `secondary_payer`
- `secondary_member_id`
- `primary_plan`
- `plan_change_this_year`
- `plan_change_details`
- `referring_provider`
- `prior_auth`
- `prior_auth_number`
- `seen_other_provider`
- `notes`
- `intake_method`
- `form_status`
- `source`
- `needs_review`
- `review_reasons`
- `triage_flag`
- `transfer_initiated`
- `confirmation_status`
- `confirmation_channel`
- `transcript`
- `call_summary`
- `recording_url`
- `raw_payload`

### `message_log`

Important fields currently available:

- `id`
- `created_at`
- `call_id`
- `booking_id`
- `purpose`
- `channel`
- `provider`
- `to_number`
- `body`
- `status`
- `provider_message_id`
- `error`

## Required Architectural Rules

The developer should follow these rules:

1. Do not call the Supabase edge function directly from a browser client with `x-crm-secret`.
2. Add a Next.js server route in `crm-ui` that proxies requests to the Supabase `crm-api`.
3. Use server-side environment variables for:
   - `CRM_API_URL`
   - `CRM_SECRET`
4. Keep the first usable version simple:
   - read dashboard
   - booking detail view
   - resend actions
5. Expect null and incomplete data everywhere because Retell extraction may leave fields blank.
6. Reuse the styling direction already present in `crm-ui/src/app/globals.css` instead of replacing it with a generic template.
7. Do not introduce frontend auth yet unless explicitly requested.
8. Do not invent new backend payload shapes unless the existing `crm-api` makes it necessary.

## Prompt 1: Audit And Prepare The CRM App

```text
You are working inside C:\Agent-CRM-demo\crm-ui.

First, inspect these files before editing:
- src/app/page.tsx
- src/app/layout.tsx
- src/app/globals.css
- package.json
- ../supabase/functions/crm-api/index.ts
- ../supabase/migrations/20260701000100_init_retell_booking.sql

Goal:
Prepare the CRM app for implementation without changing backend behavior.

Tasks:
1. Analyze the current frontend scaffold and the existing CSS utility/class system in globals.css.
2. Create a small type-safe frontend structure for the CRM:
   - a shared TypeScript type file for Booking, MessageLog, and CRM response
   - a small fetch helper for calling the local Next.js proxy route
3. Do not build the dashboard UI yet unless needed for the structure.
4. Keep the code aligned with Next.js App Router and React 19 patterns.

Constraints:
- Do not call Supabase directly from client components.
- Do not replace globals.css with a different design system.
- Do not add authentication yet.
- Keep changes focused and minimal.

Deliverables:
- shared types
- fetch helper
- any tiny utility functions needed for formatting status/date labels

At the end, summarize the files created and why.
```

## Prompt 2: Build The Secure Next.js Proxy Route

```text
You are continuing work in C:\Agent-CRM-demo\crm-ui.

Use the existing backend contract from:
- ../supabase/functions/crm-api/index.ts

Goal:
Create a secure Next.js server route that proxies CRM requests to the Supabase edge function so the browser never sees the CRM secret.

Build:
- src/app/api/crm/route.ts

Requirements:
1. Support GET and POST.
2. Read these environment variables server-side:
   - CRM_API_URL
   - CRM_SECRET
3. Forward GET requests to the Supabase CRM API.
4. Forward POST requests with JSON body to the Supabase CRM API.
5. If CRM_SECRET is set, forward it as x-crm-secret.
6. Preserve useful status codes and JSON error messages.
7. Add defensive error handling for missing env vars, upstream timeouts, and malformed JSON.

Important:
- This route is a server proxy only.
- Do not expose secret values to the client.
- Do not change the Supabase backend.

Deliverables:
- working route.ts
- brief note showing the expected .env.local variables

At the end, summarize how the proxy works and how the frontend should call it.
```

## Prompt 3: Build The First Usable CRM Dashboard

```text
You are continuing work in C:\Agent-CRM-demo\crm-ui.

Goal:
Replace the default starter page with a first usable CRM dashboard for Awaaz Labs Cardiology using the existing styles in src/app/globals.css.

Data source:
- Use the local Next.js proxy route at /api/crm

The dashboard should include:
1. A left-side bookings list using the existing list/booking card styling patterns already present in globals.css.
2. A right-side detail panel for the selected booking.
3. A simple top bar with a title and a lightweight search input.
4. A clear empty state when no booking is selected.

In the bookings list, show:
- first_name or full_legal_name fallback
- reason
- appointment_text
- created_at or call_started_at
- triage/urgency cue
- needs_review cue
- intake_method

In the detail panel, show:
- patient/contact section
- appointment section
- insurance section
- subscriber/secondary insurance section if relevant
- operational status section:
  - intake_method
  - form_status
  - confirmation_status
  - confirmation_channel
  - needs_review
  - review_reasons
  - triage_flag
  - transfer_initiated
- AI/call section:
  - call_summary
  - transcript
  - recording_url if present

Constraints:
- Reuse the existing design direction in globals.css.
- Keep the page responsive enough for laptop and tablet widths.
- Assume many values are null and show graceful fallbacks.
- Keep the initial data loading simple and robust.
- Do not add auth.

Deliverables:
- updated src/app/page.tsx
- any small presentational components you need under src/components if helpful

At the end, explain the data flow and list any assumptions.
```

## Prompt 4: Add CRM Actions For Resend Workflows

```text
You are continuing work in C:\Agent-CRM-demo\crm-ui.

Goal:
Add booking actions in the CRM that call the existing POST actions already supported by the backend.

Supported backend actions:
- resend_confirmation
- resend_form

Requirements:
1. Add action buttons in the booking detail panel.
2. Call the local /api/crm route with POST JSON body:
   - { action: "resend_confirmation", call_id }
   - { action: "resend_form", call_id }
3. Show loading, success, and failure states in the UI.
4. After a successful resend, refresh the dashboard data so statuses and message logs stay current.
5. Disable or guard actions when:
   - call_id is missing
   - contact_number is missing
   - resend form is not relevant for the booking

UX rules:
- Keep the feedback concise and operational.
- Do not use browser alert dialogs.
- Make failures understandable from the backend response when possible.

At the end, summarize the interaction flow and the failure handling.
```

## Prompt 5: Improve Search, Filters, And Status Mapping

```text
You are continuing work in C:\Agent-CRM-demo\crm-ui.

Goal:
Make the CRM more usable for operators without changing the backend contract.

Add:
1. Search across the loaded bookings list using:
   - first_name
   - full_legal_name
   - contact_number
   - reason
   - payer_name
   - call_id
2. Quick filters for:
   - all
   - needs review
   - form pending
   - confirmation pending
   - urgent
3. Consistent status badge mapping for:
   - triage_flag
   - insurance_status
   - intake_method
   - confirmation_status
   - form_status
4. Helpful formatting helpers for dates, booleans, and missing values.

Constraints:
- Keep everything client-side on the already loaded data for now.
- Do not add a backend search API yet.
- Reuse the visual class vocabulary already present in globals.css.

At the end, summarize which filters/search fields were added and how status colors are determined.
```

## Prompt 6: Add Message Log Visibility

```text
You are continuing work in C:\Agent-CRM-demo\crm-ui.

Goal:
Show recent message activity tied to the selected booking so operators can see what was sent after the call.

Data source:
- The GET /api/crm response already returns both bookings and messages.

Requirements:
1. For the selected booking, derive matching message_log entries using booking_id or call_id.
2. Show a message history panel with:
   - created_at
   - purpose
   - channel
   - provider
   - status
   - to_number
   - short body preview
   - error if present
3. Sort the matched messages newest first.
4. Make it visually secondary to the main booking details, but easy to inspect.

Constraints:
- Do not add backend joins yet.
- Keep the matching logic defensive because some rows may only match by call_id.

At the end, summarize the matching logic and any assumptions.
```

## Prompt 7: Production Hardening Pass

```text
You are doing a hardening pass on the CRM in C:\Agent-CRM-demo\crm-ui.

Goal:
Improve reliability and maintainability without changing the user-facing product scope.

Review and improve:
1. Loading and error states
2. Null-handling across all booking fields
3. Proxy route error behavior
4. Client/server component boundaries
5. Re-render behavior and state shape
6. Readability of the dashboard code
7. Accessibility of buttons, labels, and detail sections

Also do:
1. Add a concise README section for required env vars and local startup.
2. Add lightweight comments only where the code structure is non-obvious.
3. Avoid overengineering and keep the feature set aligned with the existing backend.

At the end, list:
- risks addressed
- remaining limitations
- any backend improvements that would help later but are not required now
```

## Recommended Handoff Notes To Give The Developer

Use these notes with the prompts:

- The backend already exists; do not redesign the contract unless blocked.
- The first milestone is a usable internal dashboard, not a complete admin platform.
- Prefer a server proxy route over direct edge-function calls from the browser.
- Many booking fields will be blank during early testing; the UI must be resilient to partial data.
- The current CSS already hints at the intended UX; build with it rather than replacing it.
- Retell integration is still being tested, so the CRM should handle sparse or inconsistent records gracefully.
