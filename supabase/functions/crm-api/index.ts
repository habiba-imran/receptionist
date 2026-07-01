import { admin } from "../_shared/supa.ts";
import { sendSmart } from "../_shared/messaging.ts";
import { confirmationMessage, formLinkMessage } from "../_shared/booking.ts";

const CRM_SECRET = Deno.env.get("CRM_SECRET") ?? "";
const FORM_BASE_URL = Deno.env.get("FORM_BASE_URL") ?? "https://YOUR-SITE.netlify.app/intake-form.html";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-crm-secret",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  if (CRM_SECRET && req.headers.get("x-crm-secret") !== CRM_SECRET) {
    return json({ error: "unauthorized" }, 401);
  }
  const db = admin();

  if (req.method === "GET") {
    const { data: bookings } = await db.from("bookings").select("*").order("created_at", { ascending: false }).limit(200);
    const { data: messages } = await db.from("message_log").select("*").order("created_at", { ascending: false }).limit(400);
    return json({ bookings: bookings ?? [], messages: messages ?? [] }, 200);
  }

  if (req.method === "POST") {
    let body: any = {};
    try { body = await req.json(); } catch (_) { /* ignore */ }
    const action = body.action;
    const callId = body.call_id;
    if (!callId) return json({ error: "missing_call_id" }, 400);

    const { data: b } = await db.from("bookings").select("*").eq("call_id", callId).single();
    if (!b) return json({ error: "not_found" }, 404);
    const to = b.contact_number ?? "";
    if (!to) return json({ error: "no_number" }, 400);

    let msg = "", purpose = "";
    if (action === "resend_confirmation") { msg = confirmationMessage(b); purpose = "confirmation"; }
    else if (action === "resend_form") {
      const url = `${FORM_BASE_URL}?cid=${encodeURIComponent(callId)}&lang=${b.language ?? "en"}`;
      msg = formLinkMessage(url, b.language); purpose = "form_link";
    } else return json({ error: "bad_action" }, 400);

    const res = await sendSmart(to, msg);
    await db.from("message_log").insert({
      call_id: callId, booking_id: b.id, purpose,
      channel: res.channel, provider: res.provider, to_number: res.to,
      body: msg, status: res.status, provider_message_id: res.providerMessageId ?? null, error: res.error ?? null,
    });
    if (purpose === "confirmation") {
      await db.from("bookings").update({
        confirmation_status: res.status === "sent" ? "sent" : "failed",
        confirmation_channel: res.status === "sent" ? res.channel : null,
      }).eq("call_id", callId);
    } else if (res.status === "sent") {
      await db.from("bookings").update({ form_status: "sent" }).eq("call_id", callId);
    }
    return json({ ok: res.status === "sent", result: res }, 200);
  }

  return json({ error: "method" }, 405);
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors } });
}
