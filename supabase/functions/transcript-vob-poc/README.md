# transcript-vob-poc

Separate Retell transcript extractor for Vera outbound Verification of Benefits calls.

This function:

1. Receives `transcript_updated` and `call_ended` webhook events forwarded by `retell-webhook`.
2. Sends the running VOB transcript to Groq.
3. Extracts structured benefits information.
4. Upserts progress/results into `public.vob_queue` by `call_id`.
5. Marks the row as actionable only when the minimum VOB queue fields are present.

It does not write to `bookings` and does not send messages.

## Queue Readiness

A row can exist before it is ready for staff/dashboard action. The dashboard should treat a VOB item as actionable only when:

```text
queue_ready = true
```

Minimum required fields:

```text
patient_full_name
patient_dob
payer_name
member_id
provider_name OR practice_name
```

If any required field is missing, the row remains a draft/live-tracking row with:

```text
queue_ready = false
missing_required_fields = [...]
```

`priority_position` is assigned only when the row first becomes ready, so dashboard reordering should use ready rows ordered by `priority_position`.

## Environment

Required:

```text
GROQ_API_KEY=...
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
RETELL_SHARED_SECRET=...
```

Optional:

```text
VOB_GROQ_MODEL=llama-3.1-8b-instant
GROQ_MODEL=llama-3.1-8b-instant
```

`VOB_GROQ_MODEL` takes priority over `GROQ_MODEL`.

## Deploy

```text
supabase db push
supabase functions deploy transcript-vob-poc --no-verify-jwt
supabase functions deploy retell-webhook --no-verify-jwt
```

## Routing

`retell-webhook` routes Vera traffic to this function when:

- `agent_id` is in `VERA_RETELL_AGENT_IDS`, or
- `agent_name` matches `VERA_RETELL_AGENT_NAMES`, or
- `agent_name` contains `vera`, `vob`, or `benefit`.

Everything else defaults to the Layla booking CRM extractor.
