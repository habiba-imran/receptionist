// sync-domain.ts — automatic normalization of a bookings row into the
// patients / appointments / escalations domain tables.
//
// Called after every booking upsert (from transcript-crm-poc, save-booking,
// submit-form, retell-webhook). Replaces the batch backfill-appointments.js
// script with a per-call realtime pipeline. Idempotent: matches on natural
// keys and upserts — re-running never duplicates.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { background } from "./supa.ts";
import { invalidateDashboardCache } from "./dashboard-cache.ts";
import { str, toE164, cleanMemberId } from "./validate.ts";
import { patientAcct } from "./booking.ts";
import { parseAppointmentText } from "./appointment-time.ts";

const TRIAGE_MAP: Record<string, string> = {
  none: "none",
  chest_pain_low: "low",
  chest_pain_high: "high",
  urgent_emergency: "urgent",
};

const VALID_ESCALATION_TRIGGERS = new Set([
  "triage_high",
  "triage_urgent_emergency",
  "caller_requested_human",
  "clinical_question",
  "agent_initiated",
]);

const SANE_TIME_FLOOR_MS = Date.parse("2026-01-01T00:00:00Z");

const E164_RE = /^\+[1-9][0-9]{6,14}$/;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Sync a single booking (by call_id) into the domain tables.
 * Silently skips if the booking doesn't exist or has no usable patient name.
 * All errors are caught and logged — never throws to the caller.
 */
export async function syncBookingToDomain(db: SupabaseClient, callId: string): Promise<void> {
  try {
    await sync(db, callId);
    background(invalidateDashboardCache());
  } catch (e) {
    console.error("sync-domain: error syncing", callId, e instanceof Error ? e.message : String(e));
  }
}

async function sync(db: SupabaseClient, callId: string): Promise<void> {
  // 1. Read the booking row
  const { data: booking, error } = await db.from("bookings").select("*").eq("call_id", callId).maybeSingle();
  if (error || !booking) return;

  // 2. Load the first location (single-location setup)
  const { data: locations } = await db
    .from("locations")
    .select("*")
    .order("created_at", { ascending: true })
    .limit(1);
  const location = locations?.[0];
  if (!location) return;

  const tz = safeTimezone(location.timezone ?? "America/Chicago");

  // 3. Upsert patient
  const patientId = await upsertPatient(db, booking, location.id);
  if (!patientId) return;

  // 4. Upsert appointment (only if appointment data exists)
  const hasAppt = str(booking.appointment_text) !== null || booking.appointment_at !== null;
  if (hasAppt) {
    await upsertAppointment(db, booking, patientId, location, tz);
  }

  // 5. Upsert escalation
  await upsertEscalation(db, booking, patientId, location);
}

// ---------------------------------------------------------------------------
// Patient
// ---------------------------------------------------------------------------

async function upsertPatient(
  db: SupabaseClient,
  booking: Record<string, unknown>,
  locationId: string,
): Promise<string | null> {
  const name = str(booking.full_legal_name) ?? str(booking.first_name);
  if (!name) return null;

  const phoneE164 = toE164(str(booking.contact_number));
  const bookingId = str(booking.id);
  let patient: Record<string, unknown> | null = null;

  // Prefer the patient already linked to this booking's appointment. This keeps
  // corrections on the same patient record instead of creating/using a stale
  // dedupe match after name or phone changes.
  if (bookingId) {
    const { data: linkedAppointment } = await db
      .from("appointments")
      .select("patient_id")
      .eq("booking_id", bookingId)
      .maybeSingle();

    const patientId = str(linkedAppointment?.patient_id);
    if (patientId) {
      const { data: linkedPatient } = await db
        .from("patients")
        .select("*")
        .eq("id", patientId)
        .maybeSingle();
      patient = linkedPatient;
    }
  }

  // Find existing patient by dedup key
  if (!patient) {
    const { data: existing } = await db
      .from("patients")
      .select("*")
      .eq("phone_e164", phoneE164 || "")
      .ilike("full_legal_name", name)
      .limit(1)
      .maybeSingle();
    patient = existing;
  }

  // Also try with null phone (patient might have been created without phone)
  if (!patient && !phoneE164) {
    const { data: byName } = await db
      .from("patients")
      .select("*")
      .ilike("full_legal_name", name)
      .is("phone_e164", null)
      .limit(1)
      .maybeSingle();
    patient = byName;
  }

  const tokens = name.trim().split(/\s+/);
  const pick = (field: string): string | null => str(booking[field]);
  const pickBool = (field: string): boolean | null =>
    booking[field] === true || booking[field] === false ? booking[field] : null;

  let email = pick("email");
  if (email && !EMAIL_RE.test(email)) email = null;

  let dob = pick("dob");
  if (dob && !(dob > "1900-01-01" && dob <= new Date().toISOString().slice(0, 10))) dob = null;

  if (patient) {
    // Latest valid booking values win. The booking row is already protected by
    // transcript extraction confidence and validation, so dashboard domain data
    // should follow corrected caller info instead of preserving stale values.
    const patch: Record<string, unknown> = {};
    const fields: Array<[string, unknown]> = [
      ["full_legal_name", name],
      ["first_name", tokens[0]],
      ["last_name", tokens.length > 1 ? tokens.slice(1).join(" ") : null],
      ["dob", dob],
      ["gender", pick("gender")],
      ["phone_e164", phoneE164 && E164_RE.test(phoneE164) ? phoneE164 : null],
      ["whatsapp_suitable", pickBool("whatsapp_suitable")],
      ["email", email],
      ["mailing_address", pick("mailing_address")],
      ["payer_name", pick("payer_name")],
      ["member_id", cleanMemberId(pick("member_id"))],
      ["group_number", pick("group_number")],
    ];
    for (const [field, value] of fields) {
      if (value === null || value === undefined || value === "") continue;
      if (field === "location_id" || field === "is_seeded") continue;
      const current = patient[field];
      if (String(current ?? "") !== String(value)) {
        patch[field] = value;
      }
    }
    // Always update language and insurance_status (they may have improved)
    const lang = normalizeLanguage(pick("language"));
    if (lang !== patient.language) patch.language = lang;
    const insStatus = normalizeInsuranceStatus(pick("insurance_status"));
    if (insStatus !== patient.insurance_status) patch.insurance_status = insStatus;

    if (Object.keys(patch).length > 0) {
      const { error } = await db.from("patients").update(patch).eq("id", patient.id);
      if (error) console.error("sync-domain: patient update failed", error.message);
    }
    return str(patient.id);
  }

  // Insert new patient — DB CHECK (is_valid_patient_name) will reject garbage names
  const patientRow: Record<string, unknown> = {
    location_id: locationId,
    full_legal_name: name,
    first_name: tokens[0],
    last_name: tokens.length > 1 ? tokens.slice(1).join(" ") : null,
    dob,
    gender: pick("gender"),
    phone_e164: phoneE164 && E164_RE.test(phoneE164) ? phoneE164 : null,
    whatsapp_suitable: pickBool("whatsapp_suitable"),
    email,
    mailing_address: pick("mailing_address"),
    language: normalizeLanguage(pick("language")),
    payer_name: pick("payer_name"),
    member_id: cleanMemberId(pick("member_id")),
    group_number: pick("group_number"),
    insurance_status: normalizeInsuranceStatus(pick("insurance_status")),
    is_seeded: false,
  };

  const { data: inserted, error: insertError } = await db
    .from("patients")
    .insert(patientRow)
    .select("id")
    .single();

  if (insertError) {
    // Name failed the is_valid_patient_name gate — skip silently
    if (insertError.code === "23514" || /patients_name_valid|check constraint/i.test(insertError.message)) {
      return null;
    }
    console.error("sync-domain: patient insert failed", insertError.message);
    return null;
  }

  return inserted?.id ?? null;
}

// ---------------------------------------------------------------------------
// Appointment
// ---------------------------------------------------------------------------

async function upsertAppointment(
  db: SupabaseClient,
  booking: Record<string, unknown>,
  patientId: string,
  location: Record<string, unknown>,
  tz: string,
): Promise<void> {
  const bookingId = booking.id as string;
  const bookedAt = booking.call_started_at ?? booking.created_at;

  // Find existing appointment by booking_id
  const { data: existing } = await db
    .from("appointments")
    .select("*")
    .eq("booking_id", bookingId)
    .maybeSingle();

  // Source determination
  const bookingSource = str(booking.source);
  let source = "voice";
  if (bookingSource === "form") source = "form";
  else if (bookingSource === "voice") source = "voice";

  // Triage mapping
  const triageFlag = str(booking.triage_flag) ?? "none";
  let triage = TRIAGE_MAP[triageFlag];
  if (triage === undefined) triage = "none";

  // Service interest
  const reviewReasons: string[] = [];
  let serviceInterest = str(booking.reason);
  if (!serviceInterest) {
    serviceInterest = "Not captured";
    reviewReasons.push("missing_reason");
  }

  // Appointment time parsing
  let startsAt: string | null = null;
  let parseStatus: string;
  let parseConfidence: string | null;

  if (booking.appointment_at) {
    startsAt = new Date(booking.appointment_at as string).toISOString();
    parseStatus = "parsed";
    parseConfidence = "high";
  } else {
    const parsed = parseAppointmentText(
      str(booking.appointment_text),
      new Date(bookedAt as string).toISOString(),
      tz,
    );
    startsAt = parsed.startsAt;
    parseStatus = parsed.status;
    parseConfidence = parsed.confidence;
  }

  // Guard: parsed time before 2026-01-01 is wrong data, not a real appointment
  if (parseStatus === "parsed" && startsAt && Date.parse(startsAt) <= SANE_TIME_FLOOR_MS) {
    startsAt = null;
    parseStatus = "ambiguous";
    parseConfidence = "low";
  }

  if (parseStatus !== "parsed") reviewReasons.push("unparsed_appointment_time");

  const insuranceCaptured = !!(str(booking.payer_name) || str(booking.member_id));
  const afterHours = !isBusinessHours(new Date(bookedAt as string), tz, location.business_hours);

  const apptRow: Record<string, unknown> = {
    location_id: location.id,
    patient_id: patientId,
    booking_id: bookingId,
    call_id: booking.call_id,
    source,
    service_interest: serviceInterest,
    language: normalizeLanguage(str(booking.language)),
    triage,
    insurance_captured: insuranceCaptured,
    booked_by_agent: "receptionist",
    booked_at: new Date(bookedAt as string).toISOString(),
    after_hours: afterHours,
    starts_at: startsAt,
    appointment_text_raw: str(booking.appointment_text),
    time_parse_status: parseStatus,
    time_parse_confidence: parseConfidence,
    needs_review: reviewReasons.length > 0,
    review_reasons: reviewReasons,
    is_seeded: false,
  };

  if (existing) {
    // Update non-status fields only (never touch status — human may have progressed it)
    const { error } = await db.from("appointments").update(apptRow).eq("id", existing.id);
    if (error) console.error("sync-domain: appointment update failed", error.message);
  } else {
    const { data: inserted, error } = await db
      .from("appointments")
      .insert({ ...apptRow, status: "booked" })
      .select("id")
      .single();
    if (error) {
      console.error("sync-domain: appointment insert failed", error.message);
      return;
    }

    // Create timeline event
    await db.from("appointment_events").insert({
      appointment_id: inserted.id,
      label: "Booked by AI receptionist (Layla)",
      actor: "agent:receptionist",
    });

    // Create confirmation attempt if a WhatsApp confirmation was sent
    if (booking.confirmation_status === "sent") {
      await db.from("confirmation_attempts").insert({
        appointment_id: inserted.id,
        at: booking.created_at,
        outcome: "reached",
        channel: str(booking.confirmation_channel) ?? "whatsapp",
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Escalation
// ---------------------------------------------------------------------------

async function upsertEscalation(
  db: SupabaseClient,
  booking: Record<string, unknown>,
  patientId: string,
  location: Record<string, unknown>,
): Promise<void> {
  const trigger = determineEscalationTrigger(booking);
  if (!trigger) return;

  const routedTo =
    str(booking.transfer_destination) ??
    str(location.escalation_forwarding_number) ??
    null;

  const bookingId = booking.id as string;

  // Find existing escalation by booking_id
  const { data: existing } = await db
    .from("escalations")
    .select("*")
    .eq("booking_id", bookingId)
    .maybeSingle();

  if (existing) {
    // Update trigger + routed_to only (never touch status/acknowledged/resolution)
    const patch: Record<string, unknown> = { trigger, routed_to: routedTo };
    const { error } = await db.from("escalations").update(patch).eq("id", existing.id);
    if (error) console.error("sync-domain: escalation update failed", error.message);
    return;
  }

  // Insert new escalation
  const escRow: Record<string, unknown> = {
    location_id: location.id,
    booking_id: bookingId,
    call_id: booking.call_id,
    patient_id: patientId,
    trigger,
    routed_to: routedTo,
    status: "open",
  };

  const { error } = await db.from("escalations").insert(escRow);
  if (error) console.error("sync-domain: escalation insert failed", error.message);
}

function determineEscalationTrigger(booking: Record<string, unknown>): string | null {
  // 1. Prefer Groq-inferred escalation_trigger
  const groqTrigger = str(booking.escalation_trigger);
  if (groqTrigger && VALID_ESCALATION_TRIGGERS.has(groqTrigger)) {
    return groqTrigger;
  }

  // 2. Fall back to triage_flag
  const triageFlag = str(booking.triage_flag) ?? "none";
  if (triageFlag === "chest_pain_high") return "triage_high";
  if (triageFlag === "urgent_emergency") return "triage_urgent_emergency";

  // 3. Fall back to transfer_initiated
  if (booking.transfer_initiated === true) return "caller_requested_human";

  return null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeLanguage(value: string | null): string {
  const v = (value ?? "en").toLowerCase();
  if (v.startsWith("en")) return "en";
  if (v.startsWith("es") || v.startsWith("spa")) return "es";
  return "other";
}

function normalizeInsuranceStatus(value: string | null): string {
  const v = str(value);
  const valid = new Set(["covered", "partial", "pending", "pending_form", "unknown", "self_pay"]);
  if (v && valid.has(v)) return v;
  return "pending";
}

function safeTimezone(tz: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return "America/Chicago";
  }
}

interface LocalParts {
  weekday: number;
  hour: number;
  minute: number;
}

function getLocalParts(instant: Date, timeZone: string): LocalParts {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const map: Record<string, string> = {};
  for (const part of dtf.formatToParts(instant)) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  const weekdayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return {
    weekday: weekdayNames.indexOf(map.weekday),
    hour: parseInt(map.hour, 10) % 24,
    minute: parseInt(map.minute, 10),
  };
}

/**
 * Checks if the instant falls within the location's configured business hours.
 * Falls back to Mon-Fri 08:00-17:00 when business_hours is missing/malformed.
 */
function isBusinessHours(
  instant: Date,
  timeZone: string,
  businessHours: unknown,
): boolean {
  const p = getLocalParts(instant, timeZone);
  const dayKeys = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  const dayKey = dayKeys[p.weekday];

  if (businessHours && typeof businessHours === "object" && !Array.isArray(businessHours)) {
    const bh = businessHours as Record<string, unknown>;
    const slot = bh[dayKey];
    if (slot && Array.isArray(slot) && slot.length >= 2) {
      const open = parseTimeString(slot[0] as string);
      const close = parseTimeString(slot[1] as string);
      if (open !== null && close !== null) {
        const minutes = p.hour * 60 + p.minute;
        return minutes >= open && minutes < close;
      }
    }
    if (slot === null) return false; // explicitly closed
  }

  // Fallback: Mon-Fri 08:00-17:00
  if (p.weekday === 0 || p.weekday === 6) return false;
  const minutes = p.hour * 60 + p.minute;
  return minutes >= 8 * 60 && minutes < 17 * 60;
}

function parseTimeString(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
}
