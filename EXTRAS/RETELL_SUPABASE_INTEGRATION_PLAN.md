# Retell -> Supabase Integration Plan

## Verdict

Status: partially done.

As of July 1, 2026, the Supabase side is already coded, and the live webhook URL you added in Retell is reachable and accepting the secret. I verified the deployed endpoint responds with `200 OK` and `{"received":true}` for:

`https://xyvsrxgxcjauyqzhomru.supabase.co/functions/v1/retell-webhook?s=2317d6cebd319335123a6b8cda6941bdc27eface62b6a82d`

That means the webhook is live and the shared secret in the URL is valid against the deployed function.

What is not yet proven is the full end-to-end flow:

- Retell is actually sending `call_analyzed` and/or `call_ended` payloads in the format this function expects.
- The deployed Supabase database already has the `bookings` and `message_log` tables.
- Retell post-call extraction field names exactly match the field names expected by the Supabase code.
- The later messaging flow, form flow, and CRM flow are fully configured in production.

## What Already Exists In The Repo

- `supabase/functions/retell-webhook/index.ts`
  Receives Retell webhook events.
  Handles `call_ended` and `call_analyzed`.
  On analyzed calls, it saves transcript/summary/recording/custom analysis data and can recover a booking row if one does not already exist.

- `supabase/functions/save-booking/index.ts`
  Saves a booking row into Supabase when the agent tool `save_booking` is called.

- `supabase/functions/submit-form/index.ts`
  Accepts the HTML intake form submission later and updates the same booking by `call_id`.

- `supabase/functions/crm-api/index.ts`
  Simple backend API for a later CRM view and resend actions.

- `schema.sql`
  Defines `public.bookings` and `public.message_log`.

- `prompt.txt`
  Already reflects the future desired flow:
  collect name, reason, appointment timing, contact number, WhatsApp/text suitability, then offer either form after call or full voice intake.

## Important Gaps

- The database setup is not production-proof in this repo yet.
  `schema.sql` itself says it is for context only and not meant to be run directly.
  There is no `supabase/migrations` folder in the repo.

- `supabase/config.toml` is not wired to any schema files.
  `schema_paths` is empty.

- `supabase/config.toml` references `./seed.sql`, but that file is not present.

- The current root file `postCallDataExtractionFileds.txt` only contains a subset of fields.
  It does not cover everything in the schema and does not include fields like `whatsapp_suitable`, `language`, `notes`, `transfer_initiated`, `customer_service_number`, `plan_change_this_year`, and others.

- The current messaging code does not yet honor a user-stated preference between WhatsApp and SMS.
  It auto-checks WhatsApp availability first, then falls back to SMS.
  This is okay for later refinement, but it does not fully match the future call flow you described.

- I did not run a live POST test against production because that could create real test rows in your Supabase project.

## Best Reading Of The Current Architecture

- If you use only post-call extraction for now, the main path is:
  Retell call -> Retell sends `call_analyzed` webhook -> `retell-webhook` reads `call.call_analysis.custom_analysis_data` -> Supabase stores the extracted fields in `bookings`.

- If you later enable the `save_booking` tool in the Retell agent, then the path becomes stronger:
  Retell tool call saves the booking during the call -> `call_ended` or `call_analyzed` enriches it after the call -> form link or confirmation message is sent after the call.

- For your current priority, you do not need the new CRM first.
  The first goal is simply to make sure `call_analyzed` creates or updates a row correctly in `bookings`.

## Recommended Next Steps

### Phase 1: Finish The Supabase Foundation First

1. Create a real SQL migration for `bookings` and `message_log`.
2. Add any needed indexes, constraints, and if needed later, RLS/policies.
3. Remove dependence on the context-only `schema.sql` as the source of truth.
4. Fix the local Supabase setup so it does not reference missing seed files.

## Phase 2: Lock The Retell -> Supabase Contract

5. Finalize the exact post-call extraction field names in Retell.
6. Make those field names match the names expected by `buildBookingRow()` in `supabase/functions/_shared/booking.ts`.
7. Expand `postCallDataExtractionFileds.txt` to the minimum production-safe set.

Recommended minimum fields for now:

- `first_name`
- `reason`
- `appointment_text`
- `contact_number`
- `intake_method`
- `patient_status`
- `insurance_status`
- `payer_name`
- `member_id`
- `group_number`
- `plan_type`
- `patient_is_subscriber`
- `subscriber_name`
- `subscriber_dob`
- `subscriber_relationship`
- `has_secondary`
- `secondary_payer`
- `secondary_member_id`
- `primary_plan`
- `referring_provider`
- `prior_auth`
- `prior_auth_number`
- `seen_other_provider`
- `triage_flag`
- `language`
- `whatsapp_suitable`

## Phase 3: Run One Safe End-To-End Test

8. Make one controlled Retell test call.
9. Confirm Supabase receives a `call_analyzed` event.
10. Confirm one row appears in `bookings` with the correct `call_id`.
11. Confirm transcript, summary, and `raw_payload.custom_analysis_data` are present.
12. Confirm phone number normalization is correct.
13. Confirm blank or unknown values stay blank instead of being invented.

## Phase 4: Only After That, Move To Prompt And Messaging

14. Update the Retell prompt to the final intake flow you described.
15. Add explicit capture of whether the patient wants WhatsApp or SMS.
16. Update messaging logic so delivery respects patient preference, not only WhatsApp availability.
17. Decide whether form link sending should happen only for `intake_method = form`.

## Phase 5: Then Build The Intake Form And CRM

18. Build the HTML intake form that posts to `submit-form`.
19. Use `call_id` in the form link so the form updates the existing booking row.
20. Build the CRM UI on top of `crm-api`.
21. Add resend form / resend confirmation actions in the CRM.

## Suggested Immediate Action

The next thing to do is not the CRM and not the prompt.

The next thing to do is:

1. Create proper Supabase migrations from the current schema.
2. Align the Retell post-call extraction fields with the Supabase field names.
3. Run one real test call and verify that a row lands in `bookings`.

## Definition Of Done For This First Milestone

This first milestone is complete when:

- A Retell test call ends.
- Supabase receives the webhook successfully.
- A row is created or updated in `public.bookings`.
- The extracted fields are visible in Supabase.
- The row can be matched by `call_id`.
- No manual database insertion is needed.

## Short Conclusion

You are not starting from zero.

The live webhook is up, the Supabase edge functions are already written, and the overall architecture is in place. The integration should be treated as "code-ready but not fully verified." The safest next move is to finish the database/migration layer and do one real end-to-end Retell test before changing prompt logic, CRM, or the final messaging behavior.
