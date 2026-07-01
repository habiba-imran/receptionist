import { toDigits, toE164 } from "./validate.ts";

const GREEN_URL = Deno.env.get("GREEN_API_URL") ?? "https://api.green-api.com";
const GREEN_ID = Deno.env.get("GREEN_ID_INSTANCE") ?? "";
const GREEN_TOKEN = Deno.env.get("GREEN_API_TOKEN") ?? "";

export type SendResult = {
  channel: "whatsapp";
  provider: string;
  status: "sent" | "failed";
  providerMessageId?: string;
  error?: string;
  to: string;
};

type SendSmartOptions = {
  preferWhatsapp?: boolean;
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
  if (!GREEN_ID || !GREEN_TOKEN) {
    return { channel: "whatsapp", provider: "green_api", status: "failed", error: "green_api_not_configured", to: e164 };
  }
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

export async function sendSmart(rawPhone: string, message: string, options: SendSmartOptions = {}): Promise<SendResult> {
  const e164 = toE164(rawPhone);
  if (!e164) return { channel: "whatsapp", provider: "green_api", status: "failed", error: "no_number", to: "" };
  if (!options.preferWhatsapp) {
    return { channel: "whatsapp", provider: "green_api", status: "failed", error: "whatsapp_not_consented", to: e164 };
  }
  if (!await hasWhatsapp(e164)) {
    return { channel: "whatsapp", provider: "green_api", status: "failed", error: "whatsapp_not_available", to: e164 };
  }
  return sendWhatsapp(e164, message);
}
