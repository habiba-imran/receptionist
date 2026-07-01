import { toDigits, toE164 } from "./validate.ts";

const GREEN_URL = Deno.env.get("GREEN_API_URL") ?? "https://api.green-api.com";
const GREEN_ID = Deno.env.get("GREEN_ID_INSTANCE") ?? "";
const GREEN_TOKEN = Deno.env.get("GREEN_API_TOKEN") ?? "";

const SMS_PROVIDER = (Deno.env.get("SMS_PROVIDER") ?? "twilio").toLowerCase();
const TW_SID = Deno.env.get("TWILIO_SID") ?? "";
const TW_AUTH = Deno.env.get("TWILIO_AUTH") ?? "";
const TW_FROM = Deno.env.get("TWILIO_FROM") ?? "";
const TB_DEVICE = Deno.env.get("TEXTBEE_DEVICE_ID") ?? "";
const TB_KEY = Deno.env.get("TEXTBEE_API_KEY") ?? "";

export type SendResult = {
  channel: "whatsapp" | "sms";
  provider: string;
  status: "sent" | "failed";
  providerMessageId?: string;
  error?: string;
  to: string;
};

async function hasWhatsapp(e164: string): Promise<boolean> {
  if (!GREEN_ID || !GREEN_TOKEN) return false;
  try {
    const url = `${GREEN_URL}/waInstance${GREEN_ID}/checkWhatsapp/${GREEN_TOKEN}`;
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phoneNumber: Number(toDigits(e164)) }),
    });
    const j = await r.json().catch(() => ({}));
    return !!j.existsWhatsapp;
  } catch (e) {
    console.error("checkWhatsapp failed", e);
    return false;
  }
}

async function sendWhatsapp(e164: string, message: string): Promise<SendResult> {
  const url = `${GREEN_URL}/waInstance${GREEN_ID}/sendMessage/${GREEN_TOKEN}`;
  const chatId = `${toDigits(e164)}@c.us`;
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatId, message }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.idMessage) {
      return { channel: "whatsapp", provider: "green_api", status: "sent", providerMessageId: j.idMessage, to: e164 };
    }
    return { channel: "whatsapp", provider: "green_api", status: "failed", error: JSON.stringify(j), to: e164 };
  } catch (e) {
    return { channel: "whatsapp", provider: "green_api", status: "failed", error: String(e), to: e164 };
  }
}

async function sendSmsTwilio(e164: string, message: string): Promise<SendResult> {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${TW_SID}/Messages.json`;
  const body = new URLSearchParams({ To: e164, From: TW_FROM, Body: message });
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": "Basic " + btoa(`${TW_SID}:${TW_AUTH}`),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.sid) return { channel: "sms", provider: "twilio", status: "sent", providerMessageId: j.sid, to: e164 };
    return { channel: "sms", provider: "twilio", status: "failed", error: JSON.stringify(j), to: e164 };
  } catch (e) {
    return { channel: "sms", provider: "twilio", status: "failed", error: String(e), to: e164 };
  }
}

async function sendSmsTextbee(e164: string, message: string): Promise<SendResult> {
  const url = `https://api.textbee.dev/api/v1/gateway/devices/${TB_DEVICE}/send-sms`;
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "x-api-key": TB_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ recipients: [e164], message }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok) return { channel: "sms", provider: "textbee", status: "sent", providerMessageId: j?.data?.smsBatchId, to: e164 };
    return { channel: "sms", provider: "textbee", status: "failed", error: JSON.stringify(j), to: e164 };
  } catch (e) {
    return { channel: "sms", provider: "textbee", status: "failed", error: String(e), to: e164 };
  }
}

function sendSms(e164: string, message: string): Promise<SendResult> {
  return SMS_PROVIDER === "textbee" ? sendSmsTextbee(e164, message) : sendSmsTwilio(e164, message);
}

export async function sendSmart(rawPhone: string, message: string): Promise<SendResult> {
  const e164 = toE164(rawPhone);
  if (!e164) return { channel: "sms", provider: SMS_PROVIDER, status: "failed", error: "no_number", to: "" };
  if (await hasWhatsapp(e164)) {
    const wa = await sendWhatsapp(e164, message);
    if (wa.status === "sent") return wa;
  }
  return sendSms(e164, message);
}
