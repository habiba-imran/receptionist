import { admin, background } from "../_shared/supa.ts";
import { buildBookingRow, confirmationMessage } from "../_shared/booking.ts";
import { sendSmart } from "../_shared/messaging.ts";
import { parseDateOnly, str } from "../_shared/validate.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method === "GET") {
    const url = new URL(req.url);
    const callId = str(url.searchParams.get("cid"));
    if (!callId) return json({ error: "missing_cid" }, 400);

    const db = admin();
    const { data: existing } = await db.from("bookings")
      .select("call_id, language, first_name, appointment_text, reason, patient_status, callback_number, full_legal_name, dob, gender, email, contact_number, mailing_address, insurance_status, payer_name, member_id, group_number, plan_type, payer_id, customer_service_number, patient_is_subscriber, subscriber_name, subscriber_dob, subscriber_relationship, subscriber_employer, has_secondary, secondary_payer, secondary_member_id, primary_plan, plan_change_this_year, plan_change_details, referring_provider, provider_name, npi, tax_id, cpt_codes, prior_auth, prior_auth_number, seen_other_provider, notes")
      .eq("call_id", callId)
      .maybeSingle();

    if (!existing) return json({ error: "not_found" }, 404);
    return json({ ok: true, booking: existing }, 200);
  }
  if (req.method !== "POST") return json({ error: "method" }, 405);

  let body: any = {};
  try { body = await req.json(); } catch (_) { return json({ error: "bad_json" }, 400); }

  const callId = str(body.cid);
  if (!callId) return json({ error: "missing_cid" }, 400);

  const db = admin();
  const { data: existing } = await db.from("bookings").select("*").eq("call_id", callId).maybeSingle();

  const row = buildBookingRow({ ...(existing ?? {}), ...body, intake_method: "form" }, { source: "form" });
  row.call_id = callId;
  row.form_status = "submitted";

  const apptAt = str(body.appointment_at);
  if (apptAt) {
    const d = new Date(apptAt);
    if (!isNaN(d.getTime()) && d.getTime() >= Date.now() - 60_000) row.appointment_at = d.toISOString();
  }
  const dos = parseDateOnly(str(body.date_of_service));
  if (dos) row.date_of_service = dos;

  if (!row.insurance_status || row.insurance_status === "pending_form") {
    row.insurance_status = row.payer_name ? "covered" : "pending";
  }

  const { error } = await db.from("bookings").upsert(row, { onConflict: "call_id" });
  if (error) { console.error("submit-form error", error); return json({ error: "save_failed" }, 500); }

  background((async () => {
    const { data: b } = await db.from("bookings")
      .select("id, first_name, reason, appointment_text, patient_status, insurance_status, payer_name, member_id, intake_method, assigned_doctor, language, contact_number, confirmation_status, whatsapp_suitable")
      .eq("call_id", callId).single();
    if (!b || b.confirmation_status === "sent") return;
    const to = b.contact_number ?? "";
    if (!to) return;
    if (b.whatsapp_suitable !== true) return;
    const msg = confirmationMessage(b);
    const res = await sendSmart(to, msg, { preferWhatsapp: b.whatsapp_suitable === true });
    await db.from("message_log").insert({
      call_id: callId, booking_id: b.id, purpose: "confirmation",
      channel: res.channel, provider: res.provider, to_number: res.to,
      body: msg, status: res.status, provider_message_id: res.providerMessageId ?? null, error: res.error ?? null,
    });
    await db.from("bookings").update({
      confirmation_status: res.status === "sent" ? "sent" : "failed",
      confirmation_channel: res.status === "sent" ? res.channel : null,
    }).eq("call_id", callId);
  })());

  return json({ ok: true }, 200);
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors } });
}
