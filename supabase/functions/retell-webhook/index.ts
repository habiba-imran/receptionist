import { admin, background, checkSecret } from "../_shared/supa.ts";
import { invalidateDashboardCache } from "../_shared/dashboard-cache.ts";
import { sendSmart } from "../_shared/messaging.ts";
import { buildBookingRow, confirmationMessage, formLinkMessage, patientAcct } from "../_shared/booking.ts";
import { sendAlert } from "../_shared/alert.ts";

const DEFAULT_DOCTOR = Deno.env.get("DEFAULT_DOCTOR") ?? "Dr. Adeel Rahman";
const FORM_BASE_URL = Deno.env.get("FORM_BASE_URL") ?? "https://YOUR-SITE.netlify.app/intake-form.html";
const POST_CALL_COMPARE_FIELDS = [
  "full_legal_name",
  "dob",
  "contact_number",
  "payer_name",
  "member_id",
  "group_number",
  "appointment_text",
  "reason",
  "insurance_status",
  "prior_auth",
  "prior_auth_number",
];

Deno.serve(async (req) => {
  if (!checkSecret(req)) return json({ error: "unauthorized" }, 401);

  let payload: any = {};
  try { payload = await req.json(); } catch (_) { /* ignore */ }

  const event: string = payload.event ?? "";
  const call = payload.call ?? {};
  const callId: string = call.call_id ?? "";
  if (!callId) return json({ received: true }, 200);

  if (event === "transcript_updated") {
    background(forwardTranscriptEvent(payload).catch((error) => handleTranscriptForwardFailure(error, payload, "transcript_updated")));
  } else if (event === "call_ended") {
    background((async () => {
      const route = getTranscriptRoute(payload);
      await forwardTranscriptEvent(payload).catch((error) => handleTranscriptForwardFailure(error, payload, "call_ended", route));
      if (route === "crm") {
        await runPostCallMessaging(callId, call.from_number ?? "");
      }
    })());
  } else if (event === "call_analyzed") {
    if (getTranscriptRoute(payload) === "crm") {
      background(handleAnalyzed(call, callId));
    }
  }
  return json({ received: true }, 200);
});

async function runPostCallMessaging(callId: string, fallbackNumber: string) {
  const db = admin();
  const { data: b } = await db.from("bookings")
    .select("id, intake_method, form_status, confirmation_status, contact_number, first_name, reason, appointment_text, patient_status, insurance_status, payer_name, member_id, assigned_doctor, language, whatsapp_suitable, needs_review, review_reasons")
    .eq("call_id", callId).maybeSingle();
  if (!b) return;
  const to = b.contact_number ?? fallbackNumber ?? "";
  if (!to) return;
  const preferWhatsapp = b.whatsapp_suitable === true;
  if (!preferWhatsapp) return;

  const blockers = getPostCallMessageBlockers(b);
  if (blockers.length > 0) {
    await markIncompleteMessaging(db, callId, b, blockers);
    return;
  }

  if (b.intake_method === "form") {
    if (!b.form_status || b.form_status === "not_sent" || b.form_status === "skipped_incomplete") {
      const url = `${FORM_BASE_URL}?cid=${encodeURIComponent(callId)}&lang=${b.language ?? "en"}`;
      const msg = formLinkMessage(url, b.language, b);
      const res = await sendSmart(to, msg, { preferWhatsapp });
      await logMsg(db, callId, b.id, "form_link", res, msg);
      if (res.status === "sent") await db.from("bookings").update({ form_status: "sent" }).eq("call_id", callId);
      background(invalidateDashboardCache());
    }
  } else {
    if (!b.confirmation_status || b.confirmation_status === "pending" || b.confirmation_status === "skipped_incomplete") {
      const msg = confirmationMessage(b);
      const res = await sendSmart(to, msg, { preferWhatsapp });
      await logMsg(db, callId, b.id, "confirmation", res, msg);
      await db.from("bookings").update({
        confirmation_status: res.status === "sent" ? "sent" : "failed",
        confirmation_channel: res.status === "sent" ? res.channel : null,
      }).eq("call_id", callId);
      background(invalidateDashboardCache());
    }
  }
}

async function handleTranscriptForwardFailure(error: unknown, payload: any, event: string, route?: "crm" | "vob") {
  console.error(`transcript forward ${event} failed`, error);
  await sendAlert("Retell transcript forward failed", {
    event,
    route: route ?? getTranscriptRoute(payload),
    call_id: payload.call?.call_id ?? payload.data?.call?.call_id ?? payload.call_id ?? "",
    agent_id: payload.call?.agent_id ?? payload.data?.call?.agent_id ?? "",
    agent_name: payload.call?.agent_name ?? payload.data?.call?.agent_name ?? "",
    error: error instanceof Error ? error.message : String(error),
  });
}

async function handleAnalyzed(call: any, callId: string) {
  const db = admin();
  const analysis = call.call_analysis ?? {};
  const custom = analysis.custom_analysis_data ?? {};

  const auditPatch: Record<string, unknown> = {
    transcript: call.transcript ?? null,
    call_summary: analysis.call_summary ?? null,
    recording_url: call.recording_url ?? null,
    raw_payload: { custom_analysis_data: custom },
  };

  const { data: existing } = await db.from("bookings").select("*").eq("call_id", callId).maybeSingle();

  if (existing) {
    const existingRaw = existing.raw_payload && typeof existing.raw_payload === "object" ? existing.raw_payload as Record<string, unknown> : {};
    const transcriptCrm = existingRaw.transcript_crm && typeof existingRaw.transcript_crm === "object"
      ? existingRaw.transcript_crm as Record<string, unknown>
      : {};
    auditPatch.raw_payload = {
      ...existingRaw,
      custom_analysis_data: custom,
      transcript_crm: {
        ...transcriptCrm,
        post_call_mismatches: comparePostCallExtraction(transcriptCrm.extraction, custom),
      },
    };
    Object.assign(auditPatch, buildExistingPostCallPatch(existing, custom));
    await db.from("bookings").update(auditPatch).eq("call_id", callId);
  } else {
    const row: any = buildBookingRow({ ...custom, intake_method: custom.intake_method ?? "voice" }, { source: "webhook_recovery" });
    const captureScore = getCrmCaptureScore(row);
    if (captureScore < 2) return;

    row.call_id = callId;
    row.assigned_doctor = DEFAULT_DOCTOR;
    row.patient_acct = patientAcct(callId);
    row.needs_review = row.needs_review === true || captureScore < 4;
    row.review_reasons = Array.from(new Set([
      ...(row.review_reasons ?? []),
      "recovered_from_analysis",
      ...(captureScore < 4 ? ["partial_intake_capture"] : []),
    ]));
    if (!row.contact_number && call.from_number) row.contact_number = call.from_number;
    Object.assign(row, auditPatch);
    await db.from("bookings").upsert(row, { onConflict: "call_id" });
  }

  await runPostCallMessaging(callId, call.from_number ?? "");
  background(invalidateDashboardCache());
}

function buildExistingPostCallPatch(existing: Record<string, unknown>, custom: Record<string, unknown>): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  let row: Record<string, unknown> = {};
  try {
    const input = { ...custom, intake_method: custom.intake_method ?? "voice" };
    delete input.contact_number;
    delete input.callback_number;
    row = buildBookingRow(input, { source: "webhook_analysis_merge" });
  } catch (_) {
    row = {};
  }

  for (const field of ["dob", "email", "mailing_address", "gender"]) {
    const value = row[field];
    if (value === null || value === undefined || value === "") continue;
    const current = existing[field];
    if (current === null || current === undefined || current === "") {
      patch[field] = value;
    }
  }

  return patch;
}

async function forwardTranscriptEvent(payload: any) {
  const route = getTranscriptRoute(payload);
  const baseUrl = route === "vob"
    ? Deno.env.get("TRANSCRIPT_VOB_FUNCTION_URL") ?? `${Deno.env.get("SUPABASE_URL")}/functions/v1/transcript-vob-poc`
    : Deno.env.get("TRANSCRIPT_CRM_FUNCTION_URL") ?? `${Deno.env.get("SUPABASE_URL")}/functions/v1/transcript-crm-poc`;
  const secret = Deno.env.get("RETELL_SHARED_SECRET") ?? "";
  const url = secret ? `${baseUrl}?s=${encodeURIComponent(secret)}` : baseUrl;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`transcript ${route} forward failed: ${response.status} ${text.slice(0, 500)}`);
  }
}

function getTranscriptRoute(payload: any): "crm" | "vob" {
  const call = payload.call ?? payload.data?.call ?? {};
  const agentId = String(call.agent_id ?? "").trim();
  const agentName = String(call.agent_name ?? "").trim().toLowerCase();

  const veraIds = parseCsvEnv("VERA_RETELL_AGENT_IDS");
  const laylaIds = parseCsvEnv("LAYLA_RETELL_AGENT_IDS");
  if (agentId && veraIds.has(agentId)) return "vob";
  if (agentId && laylaIds.has(agentId)) return "crm";

  const veraNames = parseCsvEnv("VERA_RETELL_AGENT_NAMES");
  const laylaNames = parseCsvEnv("LAYLA_RETELL_AGENT_NAMES");
  if (agentName && hasNameMatch(agentName, veraNames)) return "vob";
  if (agentName && hasNameMatch(agentName, laylaNames)) return "crm";

  if (agentName.includes("vera") || agentName.includes("vob") || agentName.includes("benefit")) return "vob";
  return "crm";
}

function parseCsvEnv(name: string): Set<string> {
  return new Set(
    (Deno.env.get(name) ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => name.endsWith("_NAMES") ? value.toLowerCase() : value),
  );
}

function hasNameMatch(agentName: string, configuredNames: Set<string>): boolean {
  for (const configuredName of configuredNames) {
    if (agentName === configuredName || agentName.includes(configuredName)) return true;
  }
  return false;
}

function getCrmCaptureScore(row: {
  first_name?: string | null;
  full_legal_name?: string | null;
  reason?: string | null;
  appointment_text?: string | null;
  patient_status?: string | null;
}): number {
  let score = 0;
  if (row.first_name || row.full_legal_name) score += 1;
  if (row.reason) score += 1;
  if (row.appointment_text) score += 1;
  if (row.patient_status) score += 1;
  return score;
}

function comparePostCallExtraction(groqExtraction: unknown, postCallExtraction: Record<string, unknown>) {
  if (!groqExtraction || typeof groqExtraction !== "object" || Array.isArray(groqExtraction)) return [];
  const groq = groqExtraction as Record<string, unknown>;
  const mismatches = [];

  for (const field of POST_CALL_COMPARE_FIELDS) {
    const groqValue = normalizeCompareValue(groq[field]);
    const postCallValue = normalizeCompareValue(postCallExtraction[field]);
    if (!groqValue || !postCallValue || groqValue === postCallValue) continue;
    mismatches.push({
      field,
      groq_value: groq[field],
      post_call_value: postCallExtraction[field],
    });
  }

  return mismatches;
}

function normalizeCompareValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  return String(value).trim().toLowerCase().replace(/\s+/g, " ");
}

async function logMsg(db: any, callId: string, bookingId: string | null, purpose: string, res: any, body: string) {
  await db.from("message_log").insert({
    call_id: callId, booking_id: bookingId, purpose,
    channel: res.channel, provider: res.provider, to_number: res.to,
    body, status: res.status, provider_message_id: res.providerMessageId ?? null, error: res.error ?? null,
  });
}

function getPostCallMessageBlockers(b: {
  intake_method?: string | null;
  first_name?: string | null;
  reason?: string | null;
  appointment_text?: string | null;
}): string[] {
  const blockers: string[] = [];
  if (!b.intake_method || !["voice", "form"].includes(b.intake_method)) blockers.push("intake_method");
  if (!b.first_name) blockers.push("first_name");
  if (!b.reason) blockers.push("reason");
  if (!b.appointment_text) blockers.push("appointment_text");
  return blockers;
}

async function markIncompleteMessaging(
  db: any,
  callId: string,
  b: {
    intake_method?: string | null;
    review_reasons?: string[] | null;
  },
  blockers: string[]
) {
  const reviewReasons = Array.from(new Set([
    ...((b.review_reasons ?? []).filter(Boolean)),
    ...blockers.map((field) => `messaging_missing_${field}`),
  ]));

  const patch: Record<string, unknown> = {
    needs_review: true,
    review_reasons: reviewReasons,
  };

  if (b.intake_method === "form") {
    patch.form_status = "skipped_incomplete";
  } else {
    patch.confirmation_status = "skipped_incomplete";
    patch.confirmation_channel = null;
  }

  await db.from("bookings").update(patch).eq("call_id", callId);
  background(invalidateDashboardCache());
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
