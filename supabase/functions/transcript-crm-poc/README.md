# transcript-crm-poc

Isolated proof of concept for real-time Retell transcript extraction.

This function powers real-time transcript-to-CRM extraction. It:

1. Receives `transcript_updated` and `call_ended` webhook events.
2. Sends the first realtime transcript to Groq, then sends only new transcript segments plus saved JSON built from actual `bookings` columns on later realtime updates.
3. Sends the full transcript again on `call_ended` for final extraction.
4. Upserts structured fields into `public.bookings` by `call_id`.
5. Returns and logs the extracted JSON.
6. Optionally writes a local debug JSON file for local testing.

It deliberately does not write to `message_log` and does not change form or confirmation messaging status fields.

## Environment

Required:

```text
GROQ_API_KEY=...
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
```

Optional:

```text
GROQ_MODEL=llama-3.3-70b-versatile
RETELL_SHARED_SECRET=...
TRANSCRIPT_CRM_POC_WRITE_DEBUG_FILE=true
TRANSCRIPT_CRM_POC_DEBUG_DIR=./debug-output
```

`RETELL_SHARED_SECRET` uses the same query-string secret check as the existing Retell functions:

```text
/functions/v1/transcript-crm-poc?s=YOUR_SECRET
```

## Supported Events

- `transcript_updated`: real-time extraction. First pass uses transcript-so-far; later passes use incremental new text plus saved JSON from the current `bookings` row.
- `call_ended`: final extraction pass from the complete transcript

## Data Safety

Validation rejects obvious cross-field swaps before database write, including:

```text
patient names in non-name fields
dates in non-date fields
medical reason text in payer/timing fields
phone fragments such as last-four-digit confirmations
phone/email values in payer fields
```

`raw_payload.transcript_crm.extraction` is metadata for debugging/comparison. It is not used as the source of truth for later incremental merges.

All other events are acknowledged and ignored.

## Production Routing

Retell should continue pointing to the existing production webhook:

```text
/functions/v1/retell-webhook?s=YOUR_SECRET
```

The production webhook forwards `transcript_updated` and `call_ended` payloads here in the background.

Make sure both functions are deployed after changes:

```text
supabase functions deploy transcript-crm-poc --no-verify-jwt
supabase functions deploy retell-webhook --no-verify-jwt
```

## Debug File Behavior

File writes are for local development only. Deployed Supabase Edge Functions should not be treated as durable file storage.

When enabled, snapshots are written as:

```text
debug-output/<call_id>-transcript_updated.json
debug-output/<call_id>-call_ended.json
```

The function always returns the extracted JSON in the HTTP response and logs the snapshot.
