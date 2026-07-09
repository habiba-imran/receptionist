# Re-Analysis Against Your Updated Codebase — What Changed, What's Fixed, What's New

This is a fresh pass against `Agent-CRM-demo-updated.zip`, not a copy-paste of the last one. I diffed it line-by-line against the exact code I audited before to see precisely what your team changed, verified whether each of my earlier findings is still valid, and re-derived every patch against the new base. **Read this alongside `airtight-plan-consolidated.md` — that document's architecture (3-layer defense) still holds; this one tells you what moved.**

---

## 0. Headline: your team shipped real, independent fixes — and one new, more serious finding turned up

Five files changed since the version I last reviewed: `retell-webhook/index.ts`, and `transcript-crm-poc/{index,extraction,upsert,validation}.ts`. All five changes are substantive, not cosmetic, and several directly address bugs I'd flagged — via different, equally legitimate mechanisms than the ones I'd patched. Good, convergent engineering.

While re-auditing against the new base, I found a function I'd missed the first time (`crm-api/index.ts` — it existed in the original zip too, I just hadn't opened it) with the same fail-open authentication bug as `_shared/supa.ts`, except this one sits on an endpoint that returns bulk patient PHI on a bare GET request, combined with a wildcard CORS header. That combination means an unconfigured secret made patient data fetchable from any website's JavaScript. This is now fixed, flagged prominently below, and should be verified first.

---

## 1. What your team fixed independently — verified, not just trusted

| Bug (from original QA doc / my first review) | Their fix | Verdict |
|---|---|---|
| `applyCallContextFallbacks` skipped the ground-truth `from_number` fallback whenever Groq had extracted *anything*, even a wrong fragment | Added `hasFullPhoneNumber()` — the fallback now only skips when the existing value already looks like a complete 10–15 digit number | **Valid, equivalent fix.** One gap: only corrects `contact_number`, not `callback_number` — I extended it to cover both (see §2). |
| Groq realtime extraction burning through Groq's daily token quota (explicitly flagged as unimplemented in your own CTO handoff doc) | Rebuilt extraction as **incremental**: each call now sends only the new transcript segment plus prior state (`extractPatientDataIncremental`), instead of the full transcript every time | **Valid, and better than my throttling proposal** — reduces cost at the source rather than skipping updates. Introduced one new subtle risk, addressed in §3. |
| Malformed/fragment phone numbers reaching the CRM | New `validatePhone()` in `validation.ts` rejects anything that isn't 10–15 digits, before it reaches `toE164` | **Valid**, closes the practical risk for this pipeline specifically (see §2 for why `toE164` itself still needs hardening). |
| Values leaking into the wrong field (name in `payer_name`, a date in `member_id`, etc.) — not something I'd flagged, but a real risk class | New `validateSemanticBoundaries()` — genuinely well-built, checks name/date/phone-shaped values against a field-appropriateness map | **Good addition**, no changes needed. |
| DOB/email never syncing to CRM (explicit QA finding) | New `buildExistingPostCallPatch()` — backfills `dob`/`email` from Retell's own post-call analysis if the realtime pipeline missed them | **Valid, but incomplete** — the QA finding named three fields (DOB, email, **address**); the fix covered two. Extended to include `mailing_address` and `gender` too (see §2). |

---

## 2. What's still open — patched in this pass (`agent-crm-reliability-patches-v2.zip`)

### 🚨 New, highest-priority finding: `crm-api/index.ts` — unauthenticated PHI endpoint with wildcard CORS

```ts
// before
if (CRM_SECRET && req.headers.get("x-crm-secret") !== CRM_SECRET) {
  return json({ error: "unauthorized" }, 401);
}
```
If `CRM_SECRET` isn't set, `CRM_SECRET && ...` short-circuits to `false` — **no auth check runs at all.** This endpoint's `GET` handler returns up to 200 bookings and 400 messages: full names, DOB, insurance details, phone numbers. Combined with `Access-Control-Allow-Origin: "*"`, any website could fetch this from a visitor's browser. This is the same fail-open pattern as `_shared/supa.ts`'s `checkSecret`, but more severe because this specific endpoint's entire job is to return bulk PHI on a read with no other gate.

**Fixed:** fails closed when `CRM_SECRET` is unset (denies rather than allows), and CORS origin is now driven by a new `CRM_ALLOWED_ORIGIN` secret instead of a hardcoded wildcard, with a loud startup warning if you leave it unset. **Set both `CRM_SECRET` and `CRM_ALLOWED_ORIGIN` before your next deploy** — this is the single highest-priority item in this whole update.

### `toE164` — still needed as defense-in-depth
`validatePhone()` protects the `transcript-crm-poc` pipeline specifically. It does **not** protect `save-booking/index.ts` (Retell's own custom-function write path) or `submit-form/index.ts` (the web intake form) or the new `buildExistingPostCallPatch` — all three call `buildBookingRow` → `toE164` directly, with no equivalent validation pass. Hardened `toE164` itself with the same 8–15 digit floor as before, so the fix applies no matter which of the four write paths a bad value comes through.

### `full_legal_name` / `appointment_at` confidence gating — still open, now fixed
Unchanged from before: `full_legal_name` only required "medium" confidence to write in realtime mode (per your own extraction prompt's definition, that's "stated but not yet confirmed"). Raised to "high," matching `contact_number`/`member_id`/`dob`. `appointment_at` — see next.

### `appointment_at` — still never wired to the voice pipeline
Same root cause as before: the column exists, the CRM UI displays it, the web-form path writes it, the voice pipeline never did. Same fix: deterministic (non-LLM) resolver, now integrated with the incremental extraction flow.

### Post-call backfill — extended to match the actual QA finding
`buildExistingPostCallPatch` covered `dob` and `email`. The original complaint named `mailing_address` too. Added, plus `gender`.

### `checkSecret` fail-open — still present in three files, now fixed
`_shared/supa.ts`, the local duplicate in `transcript-crm-poc/index.ts`, and the local duplicate in `transcript-vob-poc/index.ts` all still failed open. Fixed in all three (and in `crm-api`, see above).

### Name-token completeness — still open, now fixed
Their new `validateSemanticBoundaries` checks that a name isn't in the *wrong* field. It doesn't check whether a `full_legal_name` is actually complete (first + last). Added `checkNameHasTwoTokens` — non-destructive, flags for review rather than deleting the captured first name.

### Alerting — still entirely absent, now added
No alert existed anywhere in either version for: forwarding failures, emergency triage detection, or critical-field validation failures. Added `_shared/alert.ts` (Slack-webhook compatible) and wired it into all three.

### DB-level `CHECK` constraints — still absent, now added
Same migration as before (`NOT VALID` pattern, safe against existing bad data), unchanged rationale.

---

## 3. A new risk, found by tracing the interaction between my fix and theirs

This is worth understanding even though it's now fixed, because it's the kind of gap that only shows up when two independently-reasonable changes meet.

**The two changes, independently correct:**
- Their incremental extraction only feeds the model already-**written** field values as context for each new call (`getTranscriptCrmState` → `buildExtractionFromBookingRow`, sourced from the actual `bookings` row).
- My confidence-gate tightening means `full_legal_name` (and a few other fields) can't be **written** until confidence reaches "high" — i.e., until confirmed.

**The interaction:** a name stated once, at "medium" confidence, never gets written (correctly — it's not confirmed yet). Because it was never written, it's absent from what the next incremental call sees as context. Because incremental calls only receive the *new* transcript segment (not the old one), if the caller's later confirmation is a bare "yes that's right" with no digits/letters repeated, the model has nothing left to attach that confirmation to — the value could become invisible for the rest of the live call, even though it was correctly captured earlier and genuinely gets confirmed later.

**Fix:** `getTranscriptCrmState` now also returns the last raw (ungated) extraction snapshot — the medium/low-confidence candidates that didn't pass the write gate — as a separately labeled `pendingExtraction` context block: *"previously mentioned but not yet confirmed."* The model can use it to resolve a bare confirmation without those values ever being treated as already-confirmed or written directly.

**Why this was a bounded risk even before the fix, not a data-loss risk:** `call_ended` always runs a full, non-incremental extraction over the *complete* transcript — never the delta-based path. So even in the worst case, the field would still be captured correctly once the call ends normally. The exposure was limited to the live dashboard view during the call, self-healing at call end (which is itself one more reason the Layer-1 `end_call` reliability work in `layla-remediation-plan.md` matters — the layers reinforce each other in both directions).

---

## 4. Test scenarios specific to this update

1. **CRM-API PHI exposure (do this first):** with `CRM_SECRET` deliberately unset in a staging environment, `curl` the `crm-api` GET endpoint from an unauthenticated client — verify it now returns 401, not a dump of bookings.
2. Repeat with `CRM_SECRET` set but request from a browser context on a different origin than `CRM_ALLOWED_ORIGIN` — verify the CORS header no longer allows it (compare before/after this fix).
3. **Incremental extraction + pending context:** state a full name in one turn, don't confirm it yet, let several unrelated turns pass (enough to exceed one incremental cycle), then say only "yes that's right" with no name repeated — verify `full_legal_name` still resolves correctly and reaches "high" confidence, using the new `pendingExtraction` path.
4. Same scenario, but end the call *without* ever confirming — verify the field stays unwritten (blank) during the call, and gets correctly captured (or correctly stays blank if genuinely never confirmed) by the `call_ended` full-transcript pass.
5. Give a phone number as an alternate (not "same number I'm calling from") that gets ASR-garbled to a short fragment — verify `validatePhone()` nulls it, and separately verify `toE164` also rejects it if this same value somehow reaches `save-booking` or `submit-form` instead.
6. Trigger a `full_legal_name` mismatch between the realtime Groq read and Retell's own post-call `custom_analysis_data` — verify it now surfaces in `needs_review` and fires an alert (previously silent).
7. Force a call where `mailing_address` was mentioned but not captured in realtime — verify the extended post-call backfill now recovers it.
8. Run the full regression suite from `layla-remediation-plan.md` §2–§9 again — none of those Retell-side (Layer 1) recommendations have changed, and they still apply regardless of this backend update.

---

## 5. Deliverables in this pass

- **`agent-crm-reliability-patches-v2.zip`** — 15 files (5 new, 10 edited), re-derived against your updated codebase. Includes its own `README.md` and `reliability-fixes-v2.diff`. **Supersedes the v1 zip — don't apply both.**
- This document.

Same caveat as before: I traced every fix to a specific line in your actual updated source, but haven't executed any of this against your live Supabase/Groq/Retell stack. Route it through your normal staging → verification checklist → real-call testing before it touches patients — and given the `crm-api` finding, prioritize that specific fix and verification ahead of the rest.
