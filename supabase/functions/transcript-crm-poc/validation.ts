import type { ExtractedPatientData } from "./types.ts";

export type ValidationIssue = {
  field: string;
  value: unknown;
  reason: string;
};

const SELECTOR_VALUES: Record<string, Set<string>> = {
  language: new Set(["en", "es"]),
  patient_status: new Set(["new", "existing", "unknown"]),
  insurance_status: new Set(["covered", "partial", "pending", "unknown", "self_pay", "pending_form"]),
  intake_method: new Set(["form", "voice"]),
  primary_plan: new Set(["primary_current", "primary_other", "unknown"]),
  referring_provider: new Set(["yes", "no", "unknown"]),
  seen_other_provider: new Set(["yes", "no", "unknown"]),
  triage_flag: new Set(["none", "chest_pain_low", "chest_pain_high", "urgent_emergency"]),
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

const DATE_FIELDS = new Set(["dob", "subscriber_dob"]);
const NAME_ALLOWED_FIELDS = new Set(["first_name", "full_legal_name", "subscriber_name", "provider_name"]);
const DATE_ALLOWED_FIELDS = new Set(["dob", "subscriber_dob", "appointment_text", "notes"]);

export function validatePatientExtraction(extraction: ExtractedPatientData): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const record = extraction as unknown as Record<string, unknown>;

  for (const [field, allowed] of Object.entries(SELECTOR_VALUES)) {
    const value = record[field];
    if (value === null || value === undefined || value === "") continue;
    if (typeof value !== "string" || !allowed.has(value)) {
      reject(record, issues, field, value, "invalid_selector_value");
    }
  }

  for (const field of BOOLEAN_FIELDS) {
    const value = record[field];
    if (value === null || value === undefined || value === "") continue;
    if (typeof value !== "boolean") {
      reject(record, issues, field, value, "invalid_boolean");
    }
  }

  for (const field of DATE_FIELDS) {
    const value = record[field];
    if (value === null || value === undefined || value === "") continue;
    if (typeof value !== "string" || !isValidIsoDate(value, 1900, currentYear())) {
      reject(record, issues, field, value, "invalid_date");
    }
  }

  validatePattern(record, issues, "email", /^[^\s@]+@[^\s@]+\.[^\s@]+$/, "invalid_email");
  validateNameField(record, issues, "first_name", false);
  validateNameField(record, issues, "full_legal_name", true);
  validateNameField(record, issues, "subscriber_name", true);
  validatePhone(record, issues, "contact_number");
  validatePhone(record, issues, "callback_number");
  validatePattern(record, issues, "npi", /^\d{10}$/, "invalid_npi");
  validatePattern(record, issues, "tax_id", /^[A-Za-z0-9-]{7,15}$/, "invalid_tax_id");
  validatePattern(record, issues, "payer_id", /^[A-Za-z0-9-]{2,20}$/, "invalid_payer_id");

  validateIdentifier(record, issues, "member_id");
  validateIdentifier(record, issues, "group_number");
  validateIdentifier(record, issues, "secondary_member_id");
  validateIdentifier(record, issues, "prior_auth_number");
  validateFullLegalName(record, issues);
  validateSemanticBoundaries(record, issues);

  return issues;
}

function validateFullLegalName(record: Record<string, unknown>, issues: ValidationIssue[]) {
  const value = record.full_legal_name;
  if (value === null || value === undefined || value === "" || typeof value !== "string") return;

  const tokens = value.trim().split(/\s+/).filter(Boolean);
  if (tokens.length >= 2) return;

  issues.push({ field: "full_legal_name", value, reason: "incomplete_name" });
}

function validateSemanticBoundaries(record: Record<string, unknown>, issues: ValidationIssue[]) {
  const patientNameTokens = patientNameValues(record);

  for (const [field, value] of Object.entries(record)) {
    if (field === "field_confidence") continue;
    if (value === null || value === undefined || value === "" || typeof value !== "string") continue;

    const normalized = normalizeComparable(value);
    if (!normalized) continue;

    if (!NAME_ALLOWED_FIELDS.has(field) && patientNameTokens.has(normalized)) {
      reject(record, issues, field, value, "patient_name_in_wrong_field");
      continue;
    }

    if (!DATE_ALLOWED_FIELDS.has(field) && looksLikeDateValue(value)) {
      reject(record, issues, field, value, "date_in_wrong_field");
      continue;
    }

    if (field === "payer_name" && (looksLikeSchedulingText(value) || looksLikeMedicalReason(value) || looksLikePhoneOrEmail(value))) {
      reject(record, issues, field, value, "payer_name_wrong_semantics");
      continue;
    }

    if ((field === "member_id" || field === "group_number" || field === "secondary_member_id") && looksLikeNaturalName(value)) {
      reject(record, issues, field, value, "identifier_looks_like_name");
      continue;
    }

    if (field === "appointment_text" && looksLikeMedicalReason(value) && !looksLikeSchedulingText(value)) {
      reject(record, issues, field, value, "appointment_text_wrong_semantics");
      continue;
    }
  }
}

function patientNameValues(record: Record<string, unknown>): Set<string> {
  const values = new Set<string>();
  for (const field of ["first_name", "full_legal_name"]) {
    const value = record[field];
    if (typeof value !== "string") continue;
    const normalized = normalizeComparable(value);
    if (normalized) values.add(normalized);
    for (const token of value.split(/\s+/)) {
      const tokenNormalized = normalizeComparable(token);
      if (tokenNormalized && tokenNormalized.length >= 3) values.add(tokenNormalized);
    }
  }
  return values;
}

function normalizeComparable(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function looksLikeDateValue(value: string): boolean {
  const text = value.trim().toLowerCase();
  return [
    /^\d{4}-\d{2}-\d{2}$/,
    /^\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}$/,
    /\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/,
  ].some((pattern) => pattern.test(text));
}

function looksLikePhoneOrEmail(value: string): boolean {
  return /@/.test(value) || value.replace(/[^\d]/g, "").length >= 7;
}

function looksLikeNaturalName(value: string): boolean {
  const trimmed = value.trim();
  if (!/^[A-Za-z][A-Za-z\s'.-]+$/.test(trimmed)) return false;
  const words = trimmed.split(/\s+/).filter(Boolean);
  return words.length >= 2;
}

function looksLikeSchedulingText(value: string): boolean {
  const text = value.toLowerCase();
  return [
    /\b(today|tomorrow|tonight|morning|afternoon|evening|noon|midday|as soon as possible|asap|earliest|available|availability)\b/,
    /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)\b/,
    /\b\d{1,2}\s*(:\s*\d{2})?\s*(am|pm|a\.m\.|p\.m\.)\b/,
    /\b(next|this)\s+(week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/,
    /\b(appointment|schedule|book|booking|slot|time|date)\b/,
  ].some((pattern) => pattern.test(text));
}

function looksLikeMedicalReason(value: string): boolean {
  const text = value.toLowerCase();
  return [
    /\b(pain|ache|hurt|discomfort|symptom|checkup|check-up|follow-up|follow up|heart|chest|cardio|cardiology)\b/,
    /\b(palpitations|consultation|refill|medication|prescription|regular|routine|emergency)\b/,
  ].some((pattern) => pattern.test(text));
}

function validatePhone(record: Record<string, unknown>, issues: ValidationIssue[], field: string) {
  const value = record[field];
  if (value === null || value === undefined || value === "") return;
  if (typeof value !== "string") {
    reject(record, issues, field, value, "invalid_phone");
    return;
  }

  const digits = value.replace(/[^\d]/g, "");
  if (/last\s+four|last\s+4/i.test(value) || digits.length === 4) {
    reject(record, issues, field, value, "phone_fragment_not_full_number");
    return;
  }
  if (digits.length < 10 || digits.length > 15) {
    reject(record, issues, field, value, "invalid_phone");
  }
}

function validateNameField(record: Record<string, unknown>, issues: ValidationIssue[], field: string, requireTwoWords: boolean) {
  const value = record[field];
  if (value === null || value === undefined || value === "") return;
  if (typeof value !== "string") {
    reject(record, issues, field, value, "invalid_name");
    return;
  }

  const trimmed = value.trim();
  const digits = trimmed.replace(/[^\d]/g, "");
  if (
    /@/.test(trimmed) ||
    digits.length >= 4 ||
    looksLikeDateValue(trimmed) ||
    !/[A-Za-z]/.test(trimmed) ||
    !/^[A-Za-z][A-Za-z\s'.-]*$/.test(trimmed)
  ) {
    reject(record, issues, field, value, "invalid_name");
    return;
  }

  if (requireTwoWords && trimmed.split(/\s+/).filter(Boolean).length < 2) {
    reject(record, issues, field, value, "full_name_missing_last_name");
  }
}

function validatePattern(
  record: Record<string, unknown>,
  issues: ValidationIssue[],
  field: string,
  pattern: RegExp,
  reason: string,
) {
  const value = record[field];
  if (value === null || value === undefined || value === "") return;
  if (typeof value !== "string" || !pattern.test(value.trim())) {
    reject(record, issues, field, value, reason);
  }
}

function validateIdentifier(record: Record<string, unknown>, issues: ValidationIssue[], field: string) {
  const value = record[field];
  if (value === null || value === undefined || value === "") return;
  if (typeof value !== "string" || !/^[A-Za-z0-9-]{2,40}$/.test(value.trim())) {
    reject(record, issues, field, value, "invalid_identifier");
  }
}

function reject(record: Record<string, unknown>, issues: ValidationIssue[], field: string, value: unknown, reason: string) {
  issues.push({ field, value, reason });
  record[field] = null;
  const confidence = record.field_confidence;
  if (confidence && typeof confidence === "object" && !Array.isArray(confidence)) {
    delete (confidence as Record<string, unknown>)[field];
  }
}

function isValidIsoDate(value: string, minYear: number, maxYear: number): boolean {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const [, year, month, day] = match;
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (y < minYear || y > maxYear || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function currentYear(): number {
  return new Date().getUTCFullYear();
}
