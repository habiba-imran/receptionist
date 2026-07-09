import type { ExtractedPatientData, ExtractionMode } from "./types.ts";

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_GROQ_MODEL = "llama-3.3-70b-versatile";

const JSON_SCHEMA_EXAMPLE: ExtractedPatientData = {
  language: null,
  first_name: null,
  full_legal_name: null,
  dob: null,
  gender: null,
  contact_number: null,
  callback_number: null,
  email: null,
  mailing_address: null,
  reason: null,
  appointment_text: null,
  patient_status: null,
  patient_status_unverified: null,
  whatsapp_suitable: null,
  intake_method: null,
  insurance_status: null,
  payer_name: null,
  member_id: null,
  group_number: null,
  plan_type: null,
  payer_id: null,
  customer_service_number: null,
  patient_is_subscriber: null,
  subscriber_name: null,
  subscriber_dob: null,
  subscriber_relationship: null,
  subscriber_employer: null,
  has_secondary: null,
  secondary_payer: null,
  secondary_member_id: null,
  primary_plan: null,
  plan_change_this_year: null,
  plan_change_details: null,
  referring_provider: null,
  provider_name: null,
  npi: null,
  tax_id: null,
  cpt_codes: null,
  prior_auth: null,
  prior_auth_number: null,
  seen_other_provider: null,
  triage_flag: null,
  transfer_initiated: null,
  notes: null,
  field_confidence: {},
};

const BOOLEAN_FIELDS = new Set([
  "patient_status_unverified",
  "whatsapp_suitable",
  "patient_is_subscriber",
  "has_secondary",
  "plan_change_this_year",
  "prior_auth",
  "transfer_initiated",
]);

export async function extractPatientData(
  transcript: string,
  mode: ExtractionMode,
): Promise<ExtractedPatientData> {
  const apiKey = Deno.env.get("GROQ_API_KEY") ?? "";
  if (!apiKey) {
    throw new Error("GROQ_API_KEY is required");
  }

  const model = Deno.env.get("GROQ_MODEL") ?? DEFAULT_GROQ_MODEL;
  const response = await fetch(GROQ_API_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: buildSystemPrompt(mode),
        },
        {
          role: "user",
          content: [
            `Extraction mode: ${mode}`,
            "",
            "Transcript:",
            transcript,
          ].join("\n"),
        },
      ],
    }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Groq extraction failed: ${response.status} ${JSON.stringify(body)}`);
  }

  const content = body?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("Groq response did not include message content");
  }

  return normalizeExtraction(JSON.parse(content), transcript);
}

export async function extractPatientDataIncremental(
  newTranscript: string,
  existingExtraction: Record<string, unknown>,
  pendingExtraction: Record<string, unknown> = {},
): Promise<ExtractedPatientData> {
  const apiKey = Deno.env.get("GROQ_API_KEY") ?? "";
  if (!apiKey) {
    throw new Error("GROQ_API_KEY is required");
  }

  const model = Deno.env.get("GROQ_MODEL") ?? DEFAULT_GROQ_MODEL;
  const response = await fetch(GROQ_API_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: buildIncrementalSystemPrompt(),
        },
        {
          role: "user",
          content: [
            "Current saved JSON:",
            JSON.stringify(existingExtraction, null, 2),
            "",
            "Previously mentioned but not yet confirmed:",
            JSON.stringify(pendingExtraction, null, 2),
            "",
            "New transcript text since the last extraction:",
            newTranscript,
          ].join("\n"),
        },
      ],
    }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Groq incremental extraction failed: ${response.status} ${JSON.stringify(body)}`);
  }

  const content = body?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("Groq response did not include message content");
  }

  return normalizeExtraction(JSON.parse(content), newTranscript);
}

function buildSystemPrompt(mode: ExtractionMode): string {
  const modeRule = mode === "realtime"
    ? "This is a running transcript during an active call. Extract partial facts conservatively. Do not overcommit uncertain values."
    : "This is the final transcript after the call ended. Extract the best final values from the whole conversation.";

  return [
    "You extract structured patient intake data for a clinic receptionist CRM.",
    modeRule,
    "Return strict JSON only. Do not include markdown, explanations, or extra keys.",
    "Use null when a value is missing, unclear, contradicted, or not explicitly confirmed.",
    "If the caller corrects earlier information, the latest clearly confirmed value wins, even if an older value was confirmed earlier.",
    "For corrected names, phones, DOBs, member IDs, group numbers, emails, and authorization numbers, store only the corrected full value. Do not patch a single digit or letter unless the complete corrected value is clear.",
    "Map each value to the exact field meaning. Accuracy is more important than filling every field.",
    "reason is only the medical or visit reason, such as chest pain, follow-up, regular checkup, medication refill, or consultation.",
    "appointment_text is only the requested scheduling preference, such as today 4 PM, tomorrow morning, next Monday, earliest available, or any explicit day/date/time.",
    "Never put symptoms, diagnosis, visit type, or checkup reason in appointment_text.",
    "Never put day, date, or time preferences in reason unless the caller says it as part of the medical reason.",
    "If no day/date/time/scheduling preference has been stated, appointment_text must be null.",
    "If the caller says both a reason and a time, split them into reason and appointment_text.",
    "Preserve the caller's wording for reason, appointment_text, and notes after applying the field rules above.",
    "Do not infer demographics, insurance details, appointment times, phone numbers, or consent.",
    "Boolean fields must be true, false, or null only. Never use yes/no strings for boolean fields.",
    "Date fields dob and subscriber_dob must be YYYY-MM-DD only when clearly available; otherwise null.",
    "Phone, member ID, group number, payer ID, NPI, Tax ID, and authorization numbers must be exact. If any digit/letter is unclear, use null.",
    "Do not move values between fields. For example, never place a phone number in member_id, a visit reason in appointment_text, or payer name in plan_type.",
    "Never place a patient name in DOB, member_id, group_number, payer_name, appointment_text, or reason.",
    "Never place dates in name, payer, member ID, group number, plan, provider, or notes fields unless the field explicitly asks for a date.",
    "If a value appears to belong to a different field, leave the target field null instead of guessing.",
    "Allowed selector values:",
    "language: en, es, null",
    "patient_status: new, existing, unknown, null",
    "insurance_status: covered, partial, pending, unknown, self_pay, pending_form, null",
    "intake_method: voice, form, null",
    "primary_plan: primary_current, primary_other, unknown, null",
    "referring_provider: yes, no, unknown, null",
    "seen_other_provider: yes, no, unknown, null",
    "triage_flag: none, chest_pain_low, chest_pain_high, urgent_emergency, null",
    "field_confidence must include every non-null field with value low, medium, or high.",
    "Use high only when directly stated and confirmed, medium when directly stated but not confirmed, and low when uncertain. Low-confidence fields may be ignored by the database.",
    "Return exactly this JSON shape:",
    JSON.stringify(JSON_SCHEMA_EXAMPLE, null, 2),
  ].join("\n");
}

function buildIncrementalSystemPrompt(): string {
  return [
    "You update structured patient intake JSON for a clinic receptionist CRM.",
    "You are given the current saved JSON and only the new transcript text since the last extraction.",
    "Return strict JSON only. Do not include markdown, explanations, or extra keys.",
    "Preserve existing saved values unless the new transcript clearly adds, confirms, or corrects a field.",
    "If the new transcript corrects an existing value, replace it only when the corrected full value is clear. The latest clearly confirmed correction wins over older saved JSON.",
    "For corrected names, phones, DOBs, member IDs, group numbers, emails, and authorization numbers, store only the corrected full value. Do not patch a single digit or letter unless the complete corrected value is clear.",
    "If the new transcript only mentions a partial confirmation, such as the last four digits of a phone number, do not store it as a full value.",
    "If uncertain, keep the existing value. If a previously saved value is contradicted but the replacement is unclear, keep the existing value and put the concern in notes.",
    "Use null only for fields that are still missing and have no existing saved value.",
    "reason is only the medical or visit reason.",
    "appointment_text is only the requested scheduling preference, day, date, or time.",
    "Never put symptoms or visit type in appointment_text.",
    "Never put phone fragments, last four digits, or confirmation digits in contact_number or callback_number.",
    "Never place a patient name in DOB, member_id, group_number, payer_name, appointment_text, or reason.",
    "Never place dates in name, payer, member ID, group number, plan, provider, or notes fields unless the field explicitly asks for a date.",
    "If the latest text is ambiguous or appears to belong to another field, preserve the existing value and leave unrelated fields unchanged.",
    "Date fields dob and subscriber_dob must be YYYY-MM-DD only when clearly available.",
    "Boolean fields must be true, false, or null only.",
    "Allowed selector values:",
    "language: en, es, null",
    "patient_status: new, existing, unknown, null",
    "insurance_status: covered, partial, pending, unknown, self_pay, pending_form, null",
    "intake_method: voice, form, null",
    "primary_plan: primary_current, primary_other, unknown, null",
    "referring_provider: yes, no, unknown, null",
    "seen_other_provider: yes, no, unknown, null",
    "triage_flag: none, chest_pain_low, chest_pain_high, urgent_emergency, null",
    "field_confidence must include every non-null field with value low, medium, or high.",
    "Use high only when directly stated and confirmed, medium when directly stated but not confirmed, and low when uncertain.",
    "Return exactly this JSON shape:",
    JSON.stringify(JSON_SCHEMA_EXAMPLE, null, 2),
  ].join("\n");
}

function normalizeExtraction(raw: Record<string, unknown>, transcript = ""): ExtractedPatientData {
  const normalized = { ...JSON_SCHEMA_EXAMPLE };

  for (const key of Object.keys(JSON_SCHEMA_EXAMPLE) as Array<keyof ExtractedPatientData>) {
    if (key === "field_confidence") continue;
    const value = raw[key];
    normalized[key] = normalizeValue(value, BOOLEAN_FIELDS.has(key)) as never;
  }

  normalized.field_confidence = normalizeFieldConfidence(raw.field_confidence);
  enforceSpokenName(normalized, transcript);
  enforceFieldBoundaries(normalized);
  return normalized;
}

function enforceSpokenName(extraction: ExtractedPatientData, transcript: string): void {
  const spoken = extractSpokenFullName(transcript);
  if (!spoken) return;
  const current = extraction.full_legal_name;
  if (!current || namesDifferOnlyByNoisySpelling(current, spoken)) {
    extraction.full_legal_name = spoken;
    extraction.first_name = spoken.split(/\s+/)[0] ?? null;
    extraction.field_confidence.full_legal_name = extraction.field_confidence.full_legal_name ?? "medium";
    extraction.field_confidence.first_name = extraction.field_confidence.first_name ?? extraction.field_confidence.full_legal_name;
  }
}

function extractSpokenFullName(transcript: string): string | null {
  const lines = transcript.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let i = 0; i < lines.length; i += 1) {
    if (!/full legal name|patient'?s name|patient name|get.*name/i.test(lines[i])) continue;
    for (let j = i + 1; j < Math.min(lines.length, i + 5); j += 1) {
      if (/spell|could you spell|letter by letter/i.test(lines[j])) break;
      const match = lines[j].match(/^(user|patient|caller|customer)\s*:\s*(.+)$/i);
      const cleaned = (match?.[2] ?? lines[j]).replace(/[^\p{L}\s'-]/gu, " ").replace(/\s+/g, " ").trim();
      if (looksLikeHumanFullName(cleaned)) return titleCaseName(cleaned);
    }
  }
  return null;
}

function looksLikeHumanFullName(value: string): boolean {
  const parts = value.split(/\s+/).filter(Boolean);
  return parts.length >= 2 && parts.length <= 5 && parts.every((part) => /^\p{L}[\p{L}'-]{1,}$/u.test(part));
}

function namesDifferOnlyByNoisySpelling(current: string, spoken: string): boolean {
  const c = current.toLowerCase().replace(/[^a-z]/g, "");
  const s = spoken.toLowerCase().replace(/[^a-z]/g, "");
  if (!c || !s || current.includes(".") || /\b[a-z]\b/i.test(current)) return true;
  if (c === s) return false;
  return levenshtein(c, s) <= 2;
}

function titleCaseName(value: string): string {
  return value.split(/\s+/).map((part) => part ? `${part[0].toUpperCase()}${part.slice(1).toLowerCase()}` : part).join(" ");
}

function levenshtein(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const curr = [i];
    for (let j = 1; j <= b.length; j += 1) {
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev.splice(0, prev.length, ...curr);
  }
  return prev[b.length];
}

function enforceFieldBoundaries(extraction: ExtractedPatientData): void {
  if (typeof extraction.appointment_text === "string" && !looksLikeSchedulingText(extraction.appointment_text)) {
    extraction.appointment_text = null;
    delete extraction.field_confidence.appointment_text;
  }

  if (typeof extraction.reason === "string" && looksLikeSchedulingText(extraction.reason) && !looksLikeVisitReason(extraction.reason)) {
    extraction.reason = null;
    delete extraction.field_confidence.reason;
  }
}

function looksLikeSchedulingText(value: string): boolean {
  const text = value.toLowerCase();
  return [
    /\b(today|tomorrow|tonight|morning|afternoon|evening|noon|midday|as soon as possible|asap|earliest|available|availability)\b/,
    /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)\b/,
    /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b/,
    /\b\d{1,2}\s*(:\s*\d{2})?\s*(am|pm|a\.m\.|p\.m\.)\b/,
    /\b\d{1,2}\s*(st|nd|rd|th)\b/,
    /\b(next|this)\s+(week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/,
    /\b(appointment|schedule|book|booking|slot|time|date)\b/,
  ].some((pattern) => pattern.test(text));
}

function looksLikeVisitReason(value: string): boolean {
  const text = value.toLowerCase();
  return [
    /\b(pain|ache|hurt|discomfort|symptom|checkup|check-up|follow-up|follow up|heart|chest|cardio|cardiology)\b/,
    /\b(consultation|refill|medication|prescription|test|scan|report|regular|routine|emergency)\b/,
  ].some((pattern) => pattern.test(text));
}

function normalizeValue(value: unknown, booleanField: boolean): string | boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return String(value);
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  const lowered = trimmed.toLowerCase();
  if (["null", "undefined", "none", "n/a", "na", "unknown", "not provided"].includes(lowered)) {
    return null;
  }
  if (booleanField && ["yes", "true", "y", "1"].includes(lowered)) return true;
  if (booleanField && ["no", "false", "n", "0"].includes(lowered)) return false;

  return trimmed;
}

function normalizeFieldConfidence(value: unknown): Record<string, "low" | "medium" | "high"> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const confidence: Record<string, "low" | "medium" | "high"> = {};
  for (const [key, rawLevel] of Object.entries(value)) {
    if (rawLevel !== "low" && rawLevel !== "medium" && rawLevel !== "high") continue;
    confidence[key] = rawLevel;
  }
  return confidence;
}
