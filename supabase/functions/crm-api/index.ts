import { admin } from "../_shared/supa.ts";
import { sendSmart } from "../_shared/messaging.ts";
import { confirmationMessage, formLinkMessage, formSubmittedMessage } from "../_shared/booking.ts";

const CRM_SECRET = Deno.env.get("CRM_SECRET") ?? "";
const CRM_ALLOWED_ORIGIN = Deno.env.get("CRM_ALLOWED_ORIGIN") ?? "";
const FORM_BASE_URL = Deno.env.get("FORM_BASE_URL") ?? "https://YOUR-SITE.netlify.app/intake-form.html";

if (!CRM_SECRET) {
  console.warn("crm-api: CRM_SECRET is not set; requests will be rejected until it is configured.");
}
if (!CRM_ALLOWED_ORIGIN) {
  console.warn("crm-api: CRM_ALLOWED_ORIGIN is not set; browser requests will not receive CORS headers.");
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin") ?? "";
  const corsHeaders = buildCorsHeaders(origin);

  if (req.method === "OPTIONS") {
    if (!isAllowedOrigin(origin)) {
      return json({ error: "forbidden_origin" }, 403, corsHeaders);
    }
    return new Response("ok", { headers: corsHeaders });
  }

  if (!CRM_SECRET || req.headers.get("x-crm-secret") !== CRM_SECRET) {
    return json({ error: "unauthorized" }, 401, corsHeaders);
  }
  const db = admin();

  if (req.method === "GET") {
    const { data: bookings } = await db.from("bookings").select("*").order("created_at", { ascending: false }).limit(200);
    const { data: messages } = await db.from("message_log").select("*").order("created_at", { ascending: false }).limit(400);
    return json({ bookings: bookings ?? [], messages: messages ?? [] }, 200, corsHeaders);
  }

  if (req.method === "POST") {
    let body: any = {};
    try { body = await req.json(); } catch (_) { /* ignore */ }
    const action = body.action;
    const callId = body.call_id;
    if (!callId) return json({ error: "missing_call_id" }, 400, corsHeaders);

    const { data: b } = await db.from("bookings").select("*").eq("call_id", callId).single();
    if (!b) return json({ error: "not_found" }, 404, corsHeaders);
    const to = b.contact_number ?? "";
    if (!to) return json({ error: "no_number" }, 400, corsHeaders);
    if (b.whatsapp_suitable !== true) return json({ error: "whatsapp_not_consented" }, 400, corsHeaders);

    let msg = "", purpose = "";
    if (action === "resend_confirmation") {
      msg = b.form_status === "submitted" ? formSubmittedMessage(b) : confirmationMessage(b);
      purpose = "confirmation";
    }
    else if (action === "resend_form") {
      const url = `${FORM_BASE_URL}?cid=${encodeURIComponent(callId)}&lang=${b.language ?? "en"}`;
      msg = formLinkMessage(url, b.language, b); purpose = "form_link";
    } else return json({ error: "bad_action" }, 400, corsHeaders);

    const res = await sendSmart(to, msg, { preferWhatsapp: b.whatsapp_suitable === true });
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
    return json({ ok: res.status === "sent", result: res }, 200, corsHeaders);
  }

  return json({ error: "method" }, 405, corsHeaders);
});

function isAllowedOrigin(origin: string): boolean {
  if (!origin) return true;
  return Boolean(CRM_ALLOWED_ORIGIN) && origin === CRM_ALLOWED_ORIGIN;
}

function buildCorsHeaders(origin: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "content-type, x-crm-secret",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };

  if (origin && isAllowedOrigin(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Vary"] = "Origin";
  }

  return headers;
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}
