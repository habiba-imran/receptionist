import { admin, background, checkSecret } from "../_shared/supa.ts";
import { sendSmart } from "../_shared/messaging.ts";
import { buildBookingRow, confirmationMessage, formLinkMessage, patientAcct } from "../_shared/booking.ts";

const DEFAULT_DOCTOR = Deno.env.get("DEFAULT_DOCTOR") ?? "Dr. Adeel Rahman";
const FORM_BASE_URL = Deno.env.get("FORM_BASE_URL") ?? "https://YOUR-SITE.netlify.app/intake-form.html";

Deno.serve(async (req) => {
  if (!checkSecret(req)) return json({ error: "unauthorized" }, 401);

  let payload: any = {};
  try { payload = await req.json(); } catch (_) { /* ignore */ }

  const event: string = payload.event ?? "";
  const call = payload.call ?? {};
  const callId: string = call.call_id ?? "";
  if (!callId) return json({ received: true }, 200);

  if (event === "call_ended") {
    background(runPostCallMessaging(callId, call.from_number ?? ""));
  } else if (event === "call_analyzed") {
    background(handleAnalyzed(call, callId));
  }
  return json({ received: true }, 200);
});

async function runPostCallMessaging(callId: string, fallbackNumber: string) {
  const db = admin();
  const { data: b } = await db.from("bookings")
    .select("id, intake_method, form_status, confirmation_status, contact_number, first_name, reason, appointment_text, patient_status, insurance_status, payer_name, member_id, assigned_doctor, language, whatsapp_suitable")
    .eq("call_id", callId).maybeSingle();
  if (!b) return;
  const to = b.contact_number ?? fallbackNumber ?? "";
  if (!to) return;
  const preferWhatsapp = b.whatsapp_suitable === true;
  if (!preferWhatsapp) return;

  if (b.intake_method === "form") {
    if (!b.form_status || b.form_status === "not_sent") {
      const url = `${FORM_BASE_URL}?cid=${encodeURIComponent(callId)}&lang=${b.language ?? "en"}`;
      const msg = formLinkMessage(url, b.language, b);
      const res = await sendSmart(to, msg, { preferWhatsapp });
      await logMsg(db, callId, b.id, "form_link", res, msg);
      if (res.status === "sent") await db.from("bookings").update({ form_status: "sent" }).eq("call_id", callId);
    }
  } else {
    if (!b.confirmation_status || b.confirmation_status === "pending") {
      const msg = confirmationMessage(b);
      const res = await sendSmart(to, msg, { preferWhatsapp });
      await logMsg(db, callId, b.id, "confirmation", res, msg);
      await db.from("bookings").update({
        confirmation_status: res.status === "sent" ? "sent" : "failed",
        confirmation_channel: res.status === "sent" ? res.channel : null,
      }).eq("call_id", callId);
    }
  }
}

async function handleAnalyzed(call: any, callId: string) {
  const db = admin();
  const analysis = call.call_analysis ?? {};
  const custom = analysis.custom_analysis_data ?? {};

  const auditPatch = {
    transcript: call.transcript ?? null,
    call_summary: analysis.call_summary ?? null,
    recording_url: call.recording_url ?? null,
    raw_payload: { custom_analysis_data: custom },
  };

  const { data: existing } = await db.from("bookings").select("id").eq("call_id", callId).maybeSingle();

  if (existing) {
    await db.from("bookings").update(auditPatch).eq("call_id", callId);
  } else {
    const row: any = buildBookingRow({ ...custom, intake_method: custom.intake_method ?? "voice" }, { source: "webhook_recovery" });
    row.call_id = callId;
    row.assigned_doctor = DEFAULT_DOCTOR;
    row.patient_acct = patientAcct(callId);
    row.needs_review = true;
    row.review_reasons = Array.from(new Set([...(row.review_reasons ?? []), "recovered_from_analysis"]));
    if (!row.contact_number && call.from_number) row.contact_number = call.from_number;
    Object.assign(row, auditPatch);
    await db.from("bookings").upsert(row, { onConflict: "call_id" });
  }

  await runPostCallMessaging(callId, call.from_number ?? "");
}

async function logMsg(db: any, callId: string, bookingId: string | null, purpose: string, res: any, body: string) {
  await db.from("message_log").insert({
    call_id: callId, booking_id: bookingId, purpose,
    channel: res.channel, provider: res.provider, to_number: res.to,
    body, status: res.status, provider_message_id: res.providerMessageId ?? null, error: res.error ?? null,
  });
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
