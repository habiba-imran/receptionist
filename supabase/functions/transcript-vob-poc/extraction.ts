import type { ExtractedVobData, ExtractionMode } from "./types.ts";

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_GROQ_MODEL = "llama-3.1-8b-instant";

const JSON_SCHEMA_EXAMPLE: ExtractedVobData = {
  verification_id: null,
  practice_name: null,
  patient_full_name: null,
  patient_dob: null,
  member_id: null,
  payer_name: null,
  provider_name: null,
  provider_npi: null,
  tax_id: null,
  cpt_codes: null,
  service_type: null,
  date_of_service: null,
  policy_active: null,
  plan_type: null,
  effective_date: null,
  network_status: null,
  individual_deductible_total: null,
  individual_deductible_met: null,
  individual_deductible_remaining: null,
  family_deductible_total: null,
  family_deductible_met: null,
  family_deductible_remaining: null,
  individual_oop_total: null,
  individual_oop_met: null,
  individual_oop_remaining: null,
  family_oop_total: null,
  family_oop_met: null,
  family_oop_remaining: null,
  copay: null,
  coinsurance: null,
  deductible_applies: null,
  cpt_coverage: null,
  cpt_limitations: null,
  visit_limit: null,
  visits_used: null,
  visits_remaining: null,
  prior_auth_required: null,
  auth_method: null,
  referral_required: null,
  claims_mailing_address: null,
  electronic_payer_id: null,
  representative_name: null,
  call_reference_number: null,
  status: null,
  notes: null,
  field_confidence: {},
};

export async function extractVobData(
  transcript: string,
  mode: ExtractionMode,
  callContext: Record<string, unknown>,
): Promise<ExtractedVobData> {
  const apiKey = Deno.env.get("GROQ_API_KEY") ?? "";
  if (!apiKey) {
    throw new Error("GROQ_API_KEY is required");
  }

  const model = Deno.env.get("VOB_GROQ_MODEL") ?? Deno.env.get("GROQ_MODEL") ?? DEFAULT_GROQ_MODEL;
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
            "Known call context from Retell payload. Use only real values, ignore placeholders:",
            JSON.stringify(callContext, null, 2),
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
    throw new Error(`Groq VOB extraction failed: ${response.status} ${JSON.stringify(body)}`);
  }

  const content = body?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("Groq VOB response did not include message content");
  }

  return normalizeExtraction(JSON.parse(content));
}

function buildSystemPrompt(mode: ExtractionMode): string {
  const modeRule = mode === "realtime"
    ? "This is a running transcript during an active outbound insurance verification call. Extract partial facts conservatively."
    : "This is the final transcript after an outbound insurance verification call. Extract the best final values from the whole conversation.";

  return [
    "You extract Verification of Benefits data from payer/insurance representative calls.",
    modeRule,
    "Return strict JSON only. Do not include markdown, explanations, or extra keys.",
    "Use null when a value is missing, unclear, contradicted, or still a placeholder.",
    "If the representative corrects earlier information, use the latest clearly confirmed value.",
    "Do not infer coverage, payment, dates, amounts, network status, authorization, referral, or plan type.",
    "Use YYYY-MM-DD for patient_dob and date_of_service only when the date is clearly available; otherwise use null.",
    "Do not move values between fields. Keep deductible, out-of-pocket, copay, coinsurance, authorization, referral, representative name, and call reference number separate.",
    "Field meanings:",
    "policy_active: active/inactive/unknown wording only.",
    "plan_type: PPO, HMO, EPO, POS, Medicare, Medicaid, Medicare Advantage, or payer-stated plan type only.",
    "network_status: in-network, out-of-network, both, unknown, or payer-stated equivalent only.",
    "deductible fields: deductible dollar amounts only; never copay, coinsurance, or out-of-pocket maximum.",
    "oop fields: out-of-pocket maximum dollar amounts only; never deductible, copay, or coinsurance.",
    "copay: fixed visit/service payment only, such as $25 copay.",
    "coinsurance: percentage share only, such as 20%.",
    "deductible_applies: whether deductible applies to this service only.",
    "cpt_coverage: covered/not covered/unknown wording for the requested CPT codes only.",
    "cpt_limitations: limitations, exclusions, frequency limits, medical necessity notes, or payer caveats only.",
    "prior_auth_required: yes/no/unknown or payer wording about prior authorization only.",
    "auth_method: portal, fax, phone, online, or payer-stated authorization submission method only.",
    "referral_required: yes/no/unknown or payer wording about PCP referral only.",
    "representative_name: payer representative's name only.",
    "call_reference_number: call reference or confirmation number only.",
    "Preserve payer wording for amounts, limitations, status details, and notes.",
    "Allowed status values: collecting, in_progress, verified, partial_coverage, needs_authorization, needs_referral, not_covered, inactive_policy, unable_to_verify, retry_needed, failed_call, missing_information, null.",
    "Use status collecting when benefits are not complete yet. Use in_progress only if the call reached eligibility/benefits or a live representative. Use final statuses only when clearly supported.",
    "If multiple final statuses apply, priority is inactive_policy, not_covered, needs_authorization, needs_referral, partial_coverage, verified.",
    "field_confidence must include every non-null field with value low, medium, or high.",
    "Use high only when directly stated and confirmed, medium when directly stated but not confirmed, and low when uncertain. Low-confidence fields may be ignored by the database.",
    "Return exactly this JSON shape:",
    JSON.stringify(JSON_SCHEMA_EXAMPLE, null, 2),
  ].join("\n");
}

function normalizeExtraction(raw: Record<string, unknown>): ExtractedVobData {
  const normalized = { ...JSON_SCHEMA_EXAMPLE };

  for (const key of Object.keys(JSON_SCHEMA_EXAMPLE) as Array<keyof ExtractedVobData>) {
    if (key === "field_confidence") continue;
    normalized[key] = normalizeValue(raw[key]) as never;
  }

  normalized.status = normalizeStatus(normalized.status);
  normalized.field_confidence = normalizeFieldConfidence(raw.field_confidence);
  return normalized;
}

function normalizeValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  const lowered = trimmed.toLowerCase();
  if (
    ["null", "undefined", "none", "n/a", "na", "unknown", "not provided", "placeholder"].includes(lowered) ||
    (trimmed.startsWith("{{") && trimmed.endsWith("}}"))
  ) {
    return null;
  }

  return trimmed;
}

function normalizeStatus(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.toLowerCase().trim().replace(/[\s-]+/g, "_");
  const allowed = new Set([
    "collecting",
    "in_progress",
    "verified",
    "partial_coverage",
    "needs_authorization",
    "needs_referral",
    "not_covered",
    "inactive_policy",
    "unable_to_verify",
    "retry_needed",
    "failed_call",
    "missing_information",
  ]);
  return allowed.has(normalized) ? normalized : null;
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
