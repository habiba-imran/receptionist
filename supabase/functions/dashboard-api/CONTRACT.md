# dashboard-api — API Contract

Backend for the AwaazLabs client dashboard **Appointments** and **Escalations** tabs. Deployed as a
Supabase Edge Function; called **only** by the Next.js server proxy (which
authenticates the browser user via Clerk and forwards identity headers).

Base URL: `https://<project-ref>.supabase.co/functions/v1/dashboard-api`

> Deployment note: deploy with JWT verification disabled
> (`supabase functions deploy dashboard-api --no-verify-jwt`) — callers
> authenticate with `x-dashboard-secret`, not a Supabase JWT.

---

## 1. Authentication and identity headers

Every request (GET and POST) must carry:

| Header | Required | Values | Behavior |
| --- | --- | --- | --- |
| `x-dashboard-secret` | yes | value of env `DASHBOARD_API_SECRET` | Wrong/missing → `401 unauthorized`. If the env var is **unset on the server**, every request → `500 server_misconfigured` (fail closed). |
| `x-actor` | recommended | display name or email of the signed-in user | Used verbatim as the actor on audit/timeline rows. Missing/empty → `"unknown"`. Truncated to 200 chars. |
| `x-role` | recommended | `OWNER` \| `ADMIN` \| `STAFF` \| `VIEWER` (case-insensitive) | Any other/missing value → `VIEWER` (fail closed). Rank order: OWNER > ADMIN > STAFF > VIEWER. |
| `x-mode` | recommended | `PHI_BAA` \| `NON_PHI` (case-sensitive) | Anything other than exactly `PHI_BAA` → `NON_PHI` (fail closed). |
| `content-type` | POST only | `application/json` | |

CORS: `Access-Control-Allow-Origin: *`, allowed headers
`content-type, x-dashboard-secret, x-actor, x-role, x-mode`, methods
`GET, POST, OPTIONS`. `OPTIONS` returns `200 "ok"`.

---

## 2. Response envelope

Every non-OPTIONS response is JSON, exactly one of:

```json
{ "data": { ... } }
```

```json
{ "error": { "code": "bad_request", "message": "human-readable message" } }
```

Error codes and HTTP statuses used:

| HTTP | code | when |
| --- | --- | --- |
| 400 | `bad_request` | invalid parameter / body field |
| 400 | `bad_json` | POST body is not valid JSON |
| 400 | `unknown_resource` | GET `resource` not one of `appointments`, `stats`, `appointment`, `escalations`, `escalation`, `escalation_stats` |
| 400 | `unknown_action` | POST `action` not recognized |
| 401 | `unauthorized` | bad/missing `x-dashboard-secret` |
| 403 | `forbidden` | role/mode not sufficient for the operation |
| 404 | `not_found` | appointment id does not exist |
| 405 | `method_not_allowed` | method other than GET/POST/OPTIONS |
| 409 | `illegal_transition` | DB rejected the status change (message is the DB trigger's explanation, safe to show) |
| 500 | `server_misconfigured` | `DASHBOARD_API_SECRET` env var not set |
| 500 | `logging_failed` | the primary write succeeded but the timeline/audit write failed — refetch, do not retry the write |
| 500 | `internal_error` | anything else (details only in server logs) |

---

## 3. GET `?resource=appointments` — list

### Query parameters (all optional)

| Param | Type / allowed values | Notes |
| --- | --- | --- |
| `status` | `booked` `confirmed` `rescheduled` `completed` `cancelled` `no_show` | exact match |
| `source` | `voice` `whatsapp` `web_chat` `form` | exact match |
| `triage` | `none` `low` `high` `urgent` | exact match |
| `language` | `en` `es` `other` | exact match |
| `vob` | `none` or a vob_queue status: `collecting` `in_progress` `verified` `partial_coverage` `needs_authorization` `needs_referral` `not_covered` `inactive_policy` `unable_to_verify` `retry_needed` `failed_call` `missing_information` | `none` = appointment has no linked VOB (`vob_id` null); a status value = linked VOB has that status |
| `search` | free text, max 200 chars | case-insensitive substring match on patient name (full legal / first / last); if the input contains ≥3 digits, also substring match on the digits of `phone_e164`. Input that yields no searchable term (e.g. only punctuation) matches **nothing**. |
| `date_from` | `yyyy-mm-dd` | inclusive lower bound on `starts_at`, interpreted at local midnight in the location's timezone |
| `date_to` | `yyyy-mm-dd` | inclusive upper bound on `starts_at` (whole day included), same timezone rule. Must be ≥ `date_from`. Note: date filters exclude rows whose `starts_at` is null. |
| `location_id` | UUID | exact match |
| `limit` | integer 1–1000, default 500 | max rows returned; `total` is always the full filtered count |

Rows are sorted `starts_at` ascending, nulls last. Empty-string params are
treated as absent. Invalid values → `400 bad_request`.

### Response — mode `PHI_BAA`

```json
{
  "data": {
    "rows": [ { /* AppointmentRow, see below */ } ],
    "total": 137
  }
}
```

`total` is the count of ALL rows matching the filters; `rows.length` may be
smaller when `limit` truncates.

### Response — mode `NON_PHI`

No rows are ever returned; only the aggregate count:

```json
{ "data": { "kind": "aggregate", "total": 137 } }
```

(Front end: detect PHI vs aggregate by the presence of `rows` / `kind`.)

### AppointmentRow shape

All timestamps are ISO-8601 UTC strings (e.g. `"2026-07-09T14:30:00+00:00"`).

```json
{
  "id": "9f8e7d6c-5b4a-3210-fedc-ba9876543210",
  "locationId": "11111111-2222-3333-4444-555555555555",
  "patientId": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  "bookingId": "bbbbbbbb-cccc-dddd-eeee-ffffffffffff",
  "callId": "call_abc123",
  "vobId": "cccccccc-dddd-eeee-ffff-000000000000",
  "status": "confirmed",
  "source": "voice",
  "serviceInterest": "Cardiology consult",
  "language": "en",
  "triage": "none",
  "insuranceCaptured": true,
  "bookedByAgent": "receptionist",
  "bookedAt": "2026-07-08T19:04:11+00:00",
  "afterHours": false,
  "startsAt": "2026-07-12T15:00:00+00:00",
  "appointmentTextRaw": "next Friday at ten in the morning",
  "timeParseStatus": "parsed",
  "timeParseConfidence": "high",
  "needsReview": false,
  "reviewReasons": [],
  "isSeeded": false,
  "createdAt": "2026-07-08T19:04:12+00:00",
  "updatedAt": "2026-07-09T02:10:00+00:00",
  "patient": {
    "firstName": "Maria",
    "lastName": "Gonzalez",
    "phoneMasked": "(***) ***-4821",
    "phoneE164": null
  },
  "vobStatus": "verified",
  "confirmationAttempts": [
    { "id": "…uuid…", "at": "2026-07-09T01:00:00+00:00", "outcome": "confirmed", "channel": "whatsapp" }
  ],
  "timeline": [
    { "id": "…uuid…", "at": "2026-07-08T19:04:12+00:00", "label": "Appointment booked", "actor": "receptionist (AI)" }
  ],
  "staffNotes": [
    { "id": "…uuid…", "at": "2026-07-09T02:10:00+00:00", "author": "habiba@awaazlabs.com", "body": "Patient prefers morning slots." }
  ],
  "bookingRef": { "callId": "call_abc123", "transcriptAvailable": true }
}
```

Field notes:

- `patient.firstName` / `patient.lastName`: from `patients.first_name` /
  `last_name`; if both are null they are derived by splitting
  `full_legal_name` on whitespace (first token / remainder). Either can be
  null.
- `patient.phoneMasked`: `"(***) ***-NNNN"` from the last 4 digits of the
  stored phone; `null` when the patient has no phone on file.
- `patient.phoneE164`: **always `null`** in list and detail responses. Use the
  audited `reveal_phone` action to get the real number.
- `vobStatus`: `vob_queue.status` of the linked VOB, or `null` when no
  `vob_id`.
- `confirmationAttempts[].outcome`: `reached` `voicemail` `no_answer`
  `confirmed` `reschedule_requested`. `channel` defaults to `whatsapp`.
- `confirmationAttempts` / `timeline` / `staffNotes`: sorted by `at` ascending;
  empty array when none.
- `bookingRef`: `null` when the appointment has no linked booking. Never
  includes transcript text or recording URL (heavy/PHI fields);
  `transcriptAvailable` says whether a transcript exists.
- `status`: `booked` `confirmed` `rescheduled` `completed` `cancelled`
  `no_show`.
- `timeParseStatus`: `pending` `parsed` `ambiguous` `unparseable` `manual`;
  `timeParseConfidence`: `low` `medium` `high` or null. `startsAt` is null
  unless the status is `parsed` or `manual`.
- `isSeeded`: seeded demo rows; intentionally included everywhere (list and
  stats).

---

## 4. GET `?resource=stats`

No parameters. Works in both modes (aggregate numbers only, no PHI).

```json
{
  "data": {
    "bookedToday": 4,
    "upcomingNext7Days": 12,
    "confirmationRate": 0.7143,
    "noShowRate30d": 0.0833
  }
}
```

| Field | Definition |
| --- | --- |
| `bookedToday` | count of appointments whose `booked_at` falls on today's calendar date **in the clinic location's timezone** (first location's `timezone`, default `America/Chicago`) |
| `upcomingNext7Days` | `starts_at` within `[now, now+7d)` and status not `cancelled`/`no_show` |
| `confirmationRate` | among appointments that have ≥1 `confirmation_attempts` row: fraction whose status is `confirmed`, `completed`, or `rescheduled`. `null` if no appointment has any attempt. |
| `noShowRate30d` | `no_show ÷ (completed + no_show)` over appointments with `starts_at` in the last 30 days (`[now-30d, now]`). `null` if that denominator is 0. |

Rates are floats in `[0, 1]` or `null` — the front end formats percentages and
renders `null` as an em dash / "n/a". Seeded rows are included by design.

---

## 5. GET `?resource=appointment&id=<uuid>` — single appointment detail

- Requires mode `PHI_BAA` → otherwise `403 forbidden`.
- `id` must be a UUID → otherwise `400 bad_request`; unknown id → `404`.

Response: `data` is one **AppointmentRow** (exact shape above, including
`vobStatus`) plus a `vob` object with benefits detail (or `null` when the
appointment has no linked VOB):

```json
{
  "data": {
    "…all AppointmentRow fields…": "…",
    "vob": {
      "status": "verified",
      "payerName": "Aetna",
      "copay": "$40 specialist",
      "individualDeductibleTotal": "$1,500",
      "individualDeductibleMet": "$400",
      "individualDeductibleRemaining": "$1,100",
      "individualOopTotal": "$6,000",
      "individualOopMet": "$900",
      "individualOopRemaining": "$5,100",
      "priorAuthRequired": "no",
      "lastActivityAt": "2026-07-08T22:15:43+00:00"
    }
  }
}
```

All `vob` benefit fields are **free-text strings as spoken by the payer rep**
(that is how `vob_queue` stores them) and any of them can be `null`.
`lastActivityAt` is `vob_queue.updated_at`.

---

## 5.5 GET Escalation Resources

These resources power the Escalations tab. They use the same authentication headers and response envelope as appointments.

### GET `?resource=escalations` - list

Query parameters, all optional:

| Param | Allowed values | Notes |
| --- | --- | --- |
| `status` | `open` `acknowledged` `resolved` | exact match |
| `trigger` | `triage_high` `triage_urgent_emergency` `caller_requested_human` `clinical_question` `agent_initiated` | exact match |
| `location_id` | UUID | exact match |
| `limit` | integer 1-1000, default 500 | max rows returned; `total` is the full filtered count |

Rows are sorted newest first by `created_at`. Invalid values return `400 bad_request`.

PHI mode response:

```json
{
  "data": {
    "rows": [
      {
        "id": "uuid",
        "locationId": "uuid",
        "bookingId": "uuid-or-null",
        "callId": "call_abc123",
        "patientId": "uuid-or-null",
        "trigger": "caller_requested_human",
        "routedTo": "+13125550123",
        "status": "open",
        "acknowledgedAt": null,
        "acknowledgedBy": null,
        "resolutionNote": null,
        "createdAt": "2026-07-09T14:00:00+00:00",
        "updatedAt": "2026-07-09T14:00:00+00:00",
        "patient": { "firstName": "Maria", "lastName": "Gonzalez" },
        "locationName": "North Clinic"
      }
    ],
    "total": 1
  }
}
```

NON_PHI mode response returns aggregate only:

```json
{ "data": { "kind": "aggregate", "total": 1 } }
```

### GET `?resource=escalation&id=<uuid>` - single escalation detail

Requires mode `PHI_BAA`; otherwise returns `403 forbidden`. Invalid UUID returns `400 bad_request`; unknown id returns `404 not_found`.

Response `data` is one EscalationRow with the same shape used in the list response.

### GET `?resource=escalation_stats`

Aggregate-only stats; no PHI fields are returned.

```json
{
  "data": {
    "total": 12,
    "thisWeek": 4,
    "ackRate": 0.75,
    "medianTimeToAckSeconds": 180,
    "triggerCounts": {
      "triage_high": 2,
      "triage_urgent_emergency": 1,
      "caller_requested_human": 5,
      "clinical_question": 3,
      "agent_initiated": 1
    }
  }
}
```

| Field | Definition |
| --- | --- |
| `total` | total escalation rows considered by the endpoint |
| `thisWeek` | escalation rows created in the last 7 days |
| `ackRate` | acknowledged-or-better fraction, or `null` when there are no escalations |
| `medianTimeToAckSeconds` | median seconds from created to acknowledged, or `null` when none are acknowledged |
| `triggerCounts` | count by escalation trigger enum |
## 6. POST actions

POST to the function root with JSON body `{ "action": "...", ... }`. Appointment actions and escalation actions share the same endpoint.

### 6.1 `reveal_phone`

Audited PHI access — the only way to obtain a full phone number.

- Requires: mode `PHI_BAA` **and** role `STAFF`/`ADMIN`/`OWNER` → else `403`.
- Body: `{ "action": "reveal_phone", "appointmentId": "<uuid>" }`
- Writes an `audit_events` row (`action='phone_reveal'`,
  `entity='appointment'`, `entity_id=<appointmentId>`,
  `metadata={"patient_id": "<uuid>"}`) **before** returning the number; if the
  audit write fails the number is NOT returned (500).

```json
{ "data": { "appointmentId": "9f8e…", "phoneE164": "+13125550142" } }
```

`phoneE164` is `null` when the patient has no phone on file (still audited).

### 6.2 `status_change`

- Requires: role `STAFF`/`ADMIN`/`OWNER` → else `403`. (Works in either mode.)
- Body: `{ "action": "status_change", "appointmentId": "<uuid>", "status": "confirmed" }`
  — `status` must be one of the six appointment statuses.
- Legality is enforced by the DB trigger (terminal states are immutable; only
  defined transitions allowed: booked→{confirmed,rescheduled,cancelled,no_show,completed},
  confirmed→{rescheduled,cancelled,no_show,completed},
  rescheduled→{confirmed,cancelled,no_show,completed}). An illegal change
  returns `409 illegal_transition` whose `message` is the trigger's
  explanation, e.g. `appointment <id> is completed (terminal); cannot change to booked`
  — safe to display.
- Setting the same status it already has is a no-op success.
- Side effects on success: `appointment_events` row
  (`label = "Status changed to <status>"`, `actor = x-actor`) and
  `audit_events` row (`action='status_change'`, `metadata={"status": "..."}`).
  If those writes fail after the update succeeded → `500 logging_failed`
  (the status DID change; refetch).

```json
{ "data": { "id": "9f8e…", "status": "confirmed" } }
```

### 6.3 `add_note`

- Requires: role `STAFF`/`ADMIN`/`OWNER` → else `403`.
- Body: `{ "action": "add_note", "appointmentId": "<uuid>", "body": "text" }`
  — `body` trimmed, 1–4000 chars (DB also enforces 4000).
- Notes are append-only (DB-enforced); there is no edit/delete.
- Side effects: `staff_notes` row (`author = x-actor`), `appointment_events`
  row (`label = "Note added"`), `audit_events` row (`action='note_add'`,
  `metadata={"note_id": "..."}`). Logging failure after the note saved →
  `500 logging_failed` (the note DID save; refetch).

```json
{
  "data": {
    "note": { "id": "…uuid…", "at": "2026-07-09T14:00:00+00:00", "author": "habiba@awaazlabs.com", "body": "text" }
  }
}
```

### 6.4 `record_search`

PHI access logging: call this whenever a user runs a patient search in the UI.
Allowed for any role/mode.

- Body: `{ "action": "record_search", "query": "gonz" }` — trimmed, 1–200 chars.
- Writes `audit_events` (`action='patient_search'`, `entity='patient'`,
  `entity_id=null`, `metadata={"query": "..."}`).

```json
{ "data": { "recorded": true } }
```

### 6.5 `acknowledge_escalation`

- Requires: role `STAFF`/`ADMIN`/`OWNER` -> else `403`.
- Body: `{ "action": "acknowledge_escalation", "escalationId": "<uuid>" }`.
- If the escalation is `open`, updates it to `acknowledged`, stores `acknowledged_at` and `acknowledged_by`, and writes an audit event.
- If already acknowledged or resolved, returns current state as a no-op success.

```json
{ "data": { "id": "uuid", "status": "acknowledged", "acknowledgedAt": "2026-07-09T14:00:00.000Z", "acknowledgedBy": "user@example.com" } }
```

### 6.6 `escalation_note`

- Requires: role `STAFF`/`ADMIN`/`OWNER` -> else `403`.
- Body: `{ "action": "escalation_note", "escalationId": "<uuid>", "body": "text" }`; body is trimmed, 1-4000 chars.
- Saves `resolution_note`. If the escalation is still `open`, also acknowledges it.
- Writes an audit event.

```json
{ "data": { "id": "uuid", "resolutionNote": "Called clinic lead.", "status": "acknowledged", "acknowledgedAt": "2026-07-09T14:00:00.000Z" } }
```

### 6.7 `resolve_escalation`

- Requires: role `STAFF`/`ADMIN`/`OWNER` -> else `403`.
- Body: `{ "action": "resolve_escalation", "escalationId": "<uuid>" }`.
- Updates status to `resolved`. If the escalation is still `open`, also acknowledges it first.
- Writes an audit event.

```json
{ "data": { "id": "uuid", "status": "resolved" } }
```

---

## 7. Environment variables

| Var | Purpose |
| --- | --- |
| `DASHBOARD_API_SECRET` | shared secret checked against `x-dashboard-secret`; **must be set** or every request returns 500 |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | provided automatically by the Supabase platform (used by `_shared/supa.ts`) |

## 8. Example requests

```bash
# List confirmed voice appointments this week (PHI mode)
curl "$BASE/dashboard-api?resource=appointments&status=confirmed&source=voice&date_from=2026-07-06&date_to=2026-07-12" \
  -H "x-dashboard-secret: $SECRET" -H "x-actor: mehlab@awaazlabs.com" \
  -H "x-role: OWNER" -H "x-mode: PHI_BAA"

# Stat tiles
curl "$BASE/dashboard-api?resource=stats" \
  -H "x-dashboard-secret: $SECRET" -H "x-actor: mehlab@awaazlabs.com" \
  -H "x-role: OWNER" -H "x-mode: PHI_BAA"

# Reveal a phone number (audited)
curl -X POST "$BASE/dashboard-api" \
  -H "x-dashboard-secret: $SECRET" -H "x-actor: mehlab@awaazlabs.com" \
  -H "x-role: OWNER" -H "x-mode: PHI_BAA" -H "content-type: application/json" \
  -d '{"action":"reveal_phone","appointmentId":"9f8e7d6c-5b4a-3210-fedc-ba9876543210"}'
```
