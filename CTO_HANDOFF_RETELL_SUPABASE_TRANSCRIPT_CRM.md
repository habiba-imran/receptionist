# CTO Handoff: Retell + Supabase Transcript CRM

Last updated: 2026-07-09

## Purpose

This repo contains a Supabase Edge Functions backend for a Retell AI clinic receptionist system.

The recent work added real-time transcript extraction so Retell can send `transcript_updated` webhooks during a live call, Groq can extract structured patient data, and Supabase can update the existing CRM table while the call is still in progress.

The business goal is to reduce reliance on Retell custom functions for data capture, because custom functions add latency during the call.

## High-Level Architecture

Retell should point to the existing production webhook:

```text
https://xyvsrxgxcjauyqzhomru.supabase.co/functions/v1/retell-webhook?s=RETELL_SHARED_SECRET
```

Flow:

1. Retell sends events to `supabase/functions/retell-webhook/index.ts`.
2. `retell-webhook` handles existing production events:
   - `call_ended`
   - `call_analyzed`
   - existing post-call messaging
3. `retell-webhook` now also forwards:
   - `transcript_updated`
   - `call_ended`
4. Forwarded transcript events are routed by Retell agent:
   - Layla / booking calls go to `transcript-crm-poc`
   - Vera / VOB calls go to `transcript-vob-poc`
5. Layla transcript events go to:

```text
supabase/functions/transcript-crm-poc/
```

6. Vera transcript events go to:

```text
supabase/functions/transcript-vob-poc/
```

7. The relevant function sends the running transcript to Groq.
8. Groq returns strict JSON fields.
9. Layla updates `public.bookings` by `call_id`; Vera updates `public.vob_queue` by `call_id`.
10. Vera rows become actionable queue items only when `queue_ready = true`.
11. Existing CRM UI should update from the relevant Supabase table subscription behavior.

Reliability model:

- Groq realtime extraction is the primary source for live updates.
- Layla realtime extraction is incremental after the first saved extraction: Groq receives only the new transcript segment plus the current saved JSON built from actual `bookings` columns.
- Layla `call_ended` still runs a full-transcript final extraction.
- Retell post-call extraction is used as a backup/comparison pass after the call.
- Invalid fields are blocked before saving.
- Validation errors and post-call mismatches are stored as JSON metadata, not as the main product contract.

## Important Files Changed

### `supabase/functions/retell-webhook/index.ts`

Production Retell webhook.

Changes made:

- Added handling for `transcript_updated`.
- Added background forwarding to the new transcript CRM function.
- Added forwarding on `call_ended` before post-call messaging.
- Kept existing `call_analyzed` post-call processing.
- Updated `handleAnalyzed()` so `raw_payload` is merged instead of overwritten. This preserves `raw_payload.transcript_crm` metadata from real-time extraction.

Important function:

```ts
forwardTranscriptEvent(payload)
```

Default forward URL:

```text
${SUPABASE_URL}/functions/v1/transcript-crm-poc?s=RETELL_SHARED_SECRET
```

Can be overridden with:

```text
TRANSCRIPT_CRM_FUNCTION_URL
```

Vera/VOB forward URL:

```text
${SUPABASE_URL}/functions/v1/transcript-vob-poc?s=RETELL_SHARED_SECRET
```

Can be overridden with:

```text
TRANSCRIPT_VOB_FUNCTION_URL
```

Routing environment variables:

```text
LAYLA_RETELL_AGENT_IDS
LAYLA_RETELL_AGENT_NAMES
VERA_RETELL_AGENT_IDS
VERA_RETELL_AGENT_NAMES
```

Each value is a comma-separated list. If not configured, agent names containing `vera`, `vob`, or `benefit` route to VOB, and everything else routes to the Layla booking CRM extractor.

### `supabase/functions/transcript-crm-poc/index.ts`

New transcript extraction Edge Function.

Responsibilities:

- Accepts only:
  - `transcript_updated`
  - `call_ended`
- Extracts `call_id`.
- Extracts transcript from Retell payload shapes including:
  - `transcript_with_tool_calls`
  - `call.transcript`
  - `transcript`
  - `transcript_object`
  - nested `data.*` variants
- Calls Groq through `extractPatientData()`.
- On later realtime events for an existing call, calls `extractPatientDataIncremental()` with the new transcript segment and the current saved JSON built from the `bookings` row, not from raw Groq metadata.
- Writes optional debug snapshot.
- Calls `upsertTranscriptCrm()` to update `public.bookings`.
- Returns extracted JSON in the HTTP response.

### `supabase/functions/transcript-crm-poc/extraction.ts`

Groq extraction logic and prompt.

Required secret:

```text
GROQ_API_KEY
```

Optional model override:

```text
GROQ_MODEL
```

Default model currently:

```text
llama-3.3-70b-versatile
```

Important note: the first realtime extraction and final extraction can still be large, but later Layla realtime updates now use incremental extraction instead of resending the full transcript every turn.

Recommended lower-cost test model:

```text
llama-3.1-8b-instant
```

Current prompt behavior:

- Returns strict JSON only.
- Uses `null` for missing or unclear fields.
- Uses latest clearly confirmed value when caller corrects earlier information.
- Keeps `reason` and `appointment_text` separate.
- Blocks visit reasons like `regular checkup` from being treated as appointment timing.
- Normalizes boolean fields.

Validation behavior:

- Output is validated against the Layla Retell post-call extraction field spec in `EXTRAS/postCallDataExtractionFileds.txt`.
- Invalid selector values, booleans, dates, email, phone numbers, NPI, Tax ID, payer ID, member ID, group number, secondary member ID, and prior authorization number are nulled before save.
- Cross-field swaps are also blocked before save, for example patient name in payer/member/date/timing fields, date values in non-date fields, medical reason text in payer/timing fields, and phone/email values in payer fields.
- Validation issues are stored in:

```text
bookings.raw_payload.transcript_crm.validation_errors
```

The compact Groq extraction used for later comparison is stored in:

```text
bookings.raw_payload.transcript_crm.extraction
```

Code guard added:

- If `appointment_text` does not look like scheduling text, it is set to `null`.
- This prevents bad CRM entries like:

```text
Preferred timing = regular checkup
```
- Phone fragments such as last-four-digit confirmations are rejected before save.
- Incremental extraction uses actual CRM columns as source of truth. `raw_payload.transcript_crm.extraction` remains metadata/debug context, not the source of truth for later merges.

### `supabase/functions/transcript-crm-poc/upsert.ts`

Supabase write logic.

Table written:

```text
public.bookings
```

Conflict key:

```text
call_id
```

Realtime fields written during `transcript_updated`:

```text
language
first_name
full_legal_name
reason
appointment_text
patient_status
patient_status_unverified
contact_number
callback_number
whatsapp_suitable
intake_method
insurance_status
payer_name
member_id
group_number
plan_type
triage_flag
transfer_initiated
notes
```

Additional final-only fields written on `call_ended`:

```text
dob
gender
mailing_address
email
payer_id
customer_service_number
patient_is_subscriber
subscriber_name
subscriber_dob
subscriber_relationship
subscriber_employer
has_secondary
secondary_payer
secondary_member_id
primary_plan
plan_change_this_year
plan_change_details
referring_provider
provider_name
npi
tax_id
cpt_codes
prior_auth
prior_auth_number
seen_other_provider
```

Protected fields intentionally not overwritten by transcript CRM:

```text
id
created_at
updated_at
call_id
call_started_at
representative
practice
assigned_doctor
patient_acct
source
form_status
confirmation_status
confirmation_channel
transcript
call_summary
recording_url
raw_payload
```

Replacement behavior:

- Empty existing fields can be filled.
- Different existing values can be replaced only if confidence is high enough.
- On final extraction, low-confidence values do not overwrite.
- During realtime extraction:
  - `contact_number`, `member_id`, and `dob` require high confidence to replace.
  - most other fields require medium or high confidence.

Metadata written into:

```text
bookings.raw_payload.transcript_crm
```

Metadata includes:

```text
last_event
mode
last_extracted_at
transcript_length
finalized
updated_fields
field_confidence
validation_errors
extraction
```

### `supabase/functions/transcript-crm-poc/types.ts`

Types for Retell payloads, extraction mode, extracted patient data, and snapshots.

### `supabase/functions/transcript-vob-poc/`

New Vera outbound Verification of Benefits transcript extraction function.

Responsibilities:

- Accepts forwarded `transcript_updated` and `call_ended` Retell events.
- Extracts VOB data from the running transcript using Groq.
- Upserts into `public.vob_queue` by `call_id`.
- Does not write to `bookings`.
- Does not write to `message_log`.
- Does not send WhatsApp/SMS or post-call patient messages.

Validation behavior:

- Invalid VOB status, dates, member ID, verification ID, provider NPI, Tax ID, electronic payer ID, and call reference number are nulled before save.
- Validation issues are stored in:

```text
vob_queue.raw_payload.transcript_vob.validation_errors
```

The compact VOB extraction is stored in:

```text
vob_queue.raw_payload.transcript_vob.extraction
```

Important files:

```text
supabase/functions/transcript-vob-poc/index.ts
supabase/functions/transcript-vob-poc/extraction.ts
supabase/functions/transcript-vob-poc/upsert.ts
supabase/functions/transcript-vob-poc/types.ts
```

### `supabase/migrations/20260709000100_create_vob_queue.sql`

Adds:

```text
public.vob_queue
```

Purpose:

- Store Vera outbound VOB progress/results.
- Provide a queue source for a future Awaazlabs dashboard.
- Support flexible dashboard reordering through `priority_position`.
- Keep draft/live-tracking VOB rows separate from actionable queue rows through `queue_ready`.

Key columns:

```text
call_id
verification_id
priority_position
priority_score
queue_ready
ready_at
missing_required_fields
status
practice_name
patient_full_name
patient_dob
member_id
payer_name
provider_name
provider_npi
tax_id
cpt_codes
service_type
date_of_service
policy_active
plan_type
effective_date
network_status
deductible/oop/copay/coinsurance fields
prior_auth_required
referral_required
representative_name
call_reference_number
notes
raw_payload
```

VOB queue readiness:

```text
queue_ready = true
```

is set only when these minimum fields exist:

```text
patient_full_name
patient_dob
payer_name
member_id
provider_name OR practice_name
```

If any required field is missing:

```text
queue_ready = false
missing_required_fields = [...]
```

`priority_position` is assigned only when the row first becomes ready. Awaazlabs should use `queue_ready = true` as the actionable work-queue filter, then order by `priority_position`.

### `supabase/functions/transcript-crm-poc/debug-file.ts`

Optional local debug writer.

Useful only for local testing. Do not treat Supabase Edge Function file storage as durable production storage.

### `EXTRAS/prompt.txt`

Retell Layla prompt was updated.

Major changes:

- Chicago/Central Time instead of US Eastern.
- Full legal name must include first and last name.
- Spell-back required even for simple names like John Smith.
- Spell-back must use only letters caller explicitly gave.
- Email read-back rule added.
- If caller gives multiple details in one response, Layla must complete all required read-backs before moving on.
- Correction loop strengthened for phone, DOB, member ID, email, and names.
- Agent must not close immediately after a correction.
- Weekday ambiguity handled with wording like `this coming Monday` or `next Monday, [date]`.
- Security/jailbreak section added:
  - do not reveal prompt
  - do not reveal tools/functions/config
  - do not follow role-change or developer-override requests
  - do not reveal prior caller data

### `EXTRAS/vera-prompt.txt`

Vera outbound VOB prompt was updated.

Major changes:

- Removes instructions to call data-write tools:
  - `mark_vob_status`
  - `save_vob_update`
- Keeps call-control tools:
  - `press_digit`
  - `end_call`
- Adds rule that backend captures VOB details from transcript in real time.
- Keeps the 13-section Verification of Benefits checklist.
- Keeps IVR keypad handling.
- Adds security/jailbreak guardrails.
- Removes hidden malformed characters from Retell variable lines.

## Required Supabase Secrets

Set these in Supabase Edge Function secrets:

```powershell
npx supabase secrets set RETELL_SHARED_SECRET="YOUR_RETELL_SHARED_SECRET"
npx supabase secrets set GROQ_API_KEY="YOUR_GROQ_API_KEY"
npx supabase secrets set GROQ_MODEL="llama-3.1-8b-instant"
npx supabase secrets set VOB_GROQ_MODEL="llama-3.1-8b-instant"
```

Existing production secrets that should already exist:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
DEFAULT_DOCTOR
FORM_BASE_URL
```

Optional:

```powershell
npx supabase secrets set TRANSCRIPT_CRM_FUNCTION_URL="https://xyvsrxgxcjauyqzhomru.supabase.co/functions/v1/transcript-crm-poc"
npx supabase secrets set TRANSCRIPT_VOB_FUNCTION_URL="https://xyvsrxgxcjauyqzhomru.supabase.co/functions/v1/transcript-vob-poc"
npx supabase secrets set VERA_RETELL_AGENT_IDS="agent_c8ad10f68136aafcbc25821e51"
npx supabase secrets set LAYLA_RETELL_AGENT_IDS="agent_14a46db224dc5cd367499daed9"
```

If `TRANSCRIPT_CRM_FUNCTION_URL` is not set, `retell-webhook` builds it from `SUPABASE_URL`.

Optional local debug secrets:

```powershell
npx supabase secrets set TRANSCRIPT_CRM_POC_WRITE_DEBUG_FILE="true"
npx supabase secrets set TRANSCRIPT_CRM_POC_DEBUG_DIR="./debug-output"
```

Do not rely on debug files in deployed Supabase Edge Functions.

## Deploy Commands

From repo root:

```powershell
npx supabase functions deploy transcript-crm-poc --no-verify-jwt
npx supabase functions deploy transcript-vob-poc --no-verify-jwt
npx supabase functions deploy retell-webhook --no-verify-jwt
```

If the VOB queue migration has not been applied:

```powershell
npx supabase db push
```

No Vercel deploy is required for these backend changes unless the frontend CRM code is changed separately.

## Retell Configuration

Webhook URL should remain the production webhook:

```text
https://xyvsrxgxcjauyqzhomru.supabase.co/functions/v1/retell-webhook?s=RETELL_SHARED_SECRET
```

In Retell, enable:

```text
transcript_updated
call_ended
call_analyzed
```

Retell only supports one webhook URL per agent, so the production webhook forwards transcript events internally to `transcript-crm-poc`.

Layla agent prompt should be updated from:

```text
EXTRAS/prompt.txt
```

Vera agent prompt should be updated from:

```text
EXTRAS/vera-prompt.txt
```

For Vera, Retell custom functions should eventually be reduced to:

```text
press_digit
end_call
```

Remove or disable Vera data-write functions once transcript extraction is deployed and verified:

```text
mark_vob_status
save_vob_update
```

Known Retell agent IDs:

```text
Vera: agent_c8ad10f68136aafcbc25821e51
Layla: agent_14a46db224dc5cd367499daed9
```

Retell timezone should be:

```text
Chicago / Central Time
```

## Data Flow Details

### During a live call

1. Caller and Layla talk.
2. Retell fires `transcript_updated` after turns.
3. `retell-webhook` receives the event and returns quickly.
4. In the background, `retell-webhook` forwards the payload to `transcript-crm-poc`.
5. On the first extraction for a call, `transcript-crm-poc` sends transcript-so-far to Groq.
6. On later realtime events, `transcript-crm-poc` sends only the new transcript segment plus the current saved JSON.
7. Groq returns merged JSON.
8. Selected realtime fields are upserted into `bookings`.
9. CRM should show updates if it listens to `bookings`.

### When call ends

1. Retell fires `call_ended`.
2. `retell-webhook` forwards final transcript to `transcript-crm-poc`.
3. `transcript-crm-poc` performs full-transcript final extraction and can write broader fields.
4. `retell-webhook` runs existing post-call messaging logic.
5. Retell later fires `call_analyzed`.
6. `handleAnalyzed()` stores post-call transcript, summary, recording, and custom analysis data.
7. `handleAnalyzed()` fills empty existing DOB/email fields from Retell post-call extraction when available.
8. `handleAnalyzed()` compares critical Retell post-call fields with the stored Groq extraction and records mismatches.

Mismatch metadata is stored in:

```text
bookings.raw_payload.transcript_crm.post_call_mismatches
```

Critical comparison fields:

```text
full_legal_name
dob
contact_number
payer_name
member_id
group_number
appointment_text
reason
insurance_status
prior_auth
prior_auth_number
```

Mismatches are metadata only. They should not blindly overwrite values. Awaazlabs can decide how to display or action them.

### Vera outbound VOB live call

1. Vera calls payer/insurance company.
2. Retell fires `transcript_updated`.
3. `retell-webhook` routes Vera transcript events to `transcript-vob-poc`.
4. `transcript-vob-poc` sends transcript-so-far to Groq.
5. Groq extracts VOB fields.
6. Selected values are upserted into `vob_queue`.
7. The row remains a draft while required queue fields are missing.
8. Once `patient_full_name`, `patient_dob`, `payer_name`, `member_id`, and either `provider_name` or `practice_name` are present, `queue_ready` becomes `true`.
9. Future Awaazlabs dashboard should show actionable queue rows with `queue_ready = true` and use `priority_position` for reorder/swap behavior.

## Existing Production Flows Still Present

### `save-booking`

Existing Retell custom function path.

- Writes structured call arguments into `bookings`.
- Still exists.
- May write the same `call_id` as transcript CRM.

### `handleAnalyzed()`

Existing post-call path in `retell-webhook`.

- Reads `call.call_analysis.custom_analysis_data`.
- Updates the same `bookings` row.
- Now merges `raw_payload` instead of overwriting transcript CRM metadata.

## Conflict Risks

Multiple systems can write the same `bookings` row:

1. `save-booking` custom function
2. `transcript-crm-poc` realtime extraction
3. `handleAnalyzed()` post-call extraction

Current safeguards:

- All use `call_id`.
- Transcript CRM does not overwrite protected operational fields.
- Transcript CRM only replaces existing values when confidence rules allow it.
- `handleAnalyzed()` now preserves `raw_payload.transcript_crm`.

Still possible:

- A wrong high-confidence Groq extraction can replace a field.
- Retell custom function data and transcript CRM can disagree.
- Post-call `custom_analysis_data` may be different from realtime Groq extraction.

Vera/VOB writes are separate:

- `transcript-vob-poc` writes to `vob_queue`.
- It must not write to `bookings`.
- Vera transcripts must not be sent to `transcript-crm-poc`.

Recommended future improvement:

- Add explicit source priority rules, for example:
  - caller-confirmed custom function values > final transcript extraction > realtime transcript extraction
- Add per-field `confirmed_at` or `source` metadata if the CRM needs auditability.

## Groq Rate Limit Risk

Observed issue:

```text
Groq 429 rate_limit_exceeded
tokens per day limit reached
```

Important:

- Groq rate limits are often organization-level.
- Creating a new API key in the same Groq org does not reset the daily token limit.
- Changing local `.env` does not update deployed Supabase secrets.

If changing key/model for deployed functions:

```powershell
npx supabase secrets set GROQ_API_KEY="NEW_KEY"
npx supabase secrets set GROQ_MODEL="llama-3.1-8b-instant"
npx supabase functions deploy transcript-crm-poc --no-verify-jwt
```

Current token reduction:

- Layla realtime extraction now uses incremental extraction after the first saved extraction.
- It sends Groq the latest new transcript segment plus the current saved JSON.
- Full transcript extraction still runs on `call_ended`.

Recommended future production improvement:

- Add time/size throttling on top of incremental extraction.
- Example: call Groq only every 8-10 seconds or after transcript grows by 500-800 characters.
- Return HTTP 200 on Groq 429 and log a skipped/rate-limited status so Retell webhook logs do not look like functional failures.

Recommended Awaazlabs product contract:

Expose extraction quality as JSON metadata:

```text
confidence
validation_errors
mismatches
source
last_updated_at
```

Do not rely on the demo CRM's `needs_review` field as the final product contract.

Time/size throttling is not currently implemented in the checked-in code.

## Known Current Limitations

- `transcript-crm-poc` still has `poc` in the folder name even though it now writes to CRM.
- VOB queue migrations have been added but must be applied with `supabase db push`.
- No new tables were added.
- No automated tests were added.
- No realtime throttling/backoff exists yet.
- VOB realtime extraction also has no throttling/backoff yet.
- Existing wrong values already written to `bookings` will not be automatically cleared unless a later extraction overwrites them or they are manually corrected.
- Prompt changes must be pasted into Retell manually; editing `EXTRAS/prompt.txt` does not update Retell automatically.

## Verification Checklist

After deployment and Retell prompt update:

1. Start a test call.
2. Confirm Supabase Edge Function logs show:

```text
transcript-crm-poc received {"event":"transcript_updated"...}
transcript-crm-poc extraction ...
```

3. Confirm `bookings` row appears/updates by `call_id`.
4. Confirm CRM UI shows the same row updates.
5. Test these call cases:
   - simple full name: John Smith
   - complex full name: Aiysha Nguyenne
   - first name only, then agent asks for last/full legal name
   - misspelled name corrected mid-spelling
   - email confirmation
   - member ID correction before closing
   - Monday ambiguity while current day is Thursday
   - palpitations ASR confusion
   - chest pain severity flow
   - jailbreak prompt reveal attempts

## Rollback

To stop realtime CRM extraction without touching Retell:

1. Deploy a version of `retell-webhook` without forwarding `transcript_updated` and `call_ended` to `transcript-crm-poc`.
2. Or set `TRANSCRIPT_CRM_FUNCTION_URL` to a harmless internal endpoint that returns 200.
3. Or disable `transcript_updated` in Retell.

Do not delete existing `retell-webhook` unless replacing the webhook URL in Retell.

## Files To Review Before Taking Ownership

```text
supabase/functions/retell-webhook/index.ts
supabase/functions/transcript-crm-poc/index.ts
supabase/functions/transcript-crm-poc/extraction.ts
supabase/functions/transcript-crm-poc/upsert.ts
supabase/functions/transcript-crm-poc/types.ts
supabase/functions/transcript-vob-poc/index.ts
supabase/functions/transcript-vob-poc/extraction.ts
supabase/functions/transcript-vob-poc/upsert.ts
supabase/functions/transcript-vob-poc/types.ts
supabase/functions/_shared/booking.ts
supabase/functions/_shared/supa.ts
EXTRAS/prompt.txt
EXTRAS/vera-prompt.txt
```

## Current Git Notes

At the time this handoff was written, the working tree also showed unrelated package/temp changes:

```text
package.json
package-lock.json
supabase/.temp/storage-version
```

Review those separately before committing. The core Retell/Supabase transcript CRM changes are in:

```text
EXTRAS/prompt.txt
supabase/functions/retell-webhook/index.ts
supabase/functions/transcript-crm-poc/
supabase/functions/transcript-vob-poc/
supabase/migrations/20260709000100_create_vob_queue.sql
CTO_HANDOFF_RETELL_SUPABASE_TRANSCRIPT_CRM.md
```
