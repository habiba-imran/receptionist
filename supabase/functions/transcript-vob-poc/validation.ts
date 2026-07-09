import type { ExtractedVobData } from "./types.ts";

export type VobValidationIssue = {
  field: string;
  value: unknown;
  reason: string;
};

const STATUS_VALUES = new Set([
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

const DATE_FIELDS = new Set(["patient_dob", "date_of_service"]);

export function validateVobExtraction(extraction: ExtractedVobData): VobValidationIssue[] {
  const issues: VobValidationIssue[] = [];
  const record = extraction as unknown as Record<string, unknown>;

  const status = record.status;
  if (status !== null && status !== undefined && status !== "" && (typeof status !== "string" || !STATUS_VALUES.has(status))) {
    reject(record, issues, "status", status, "invalid_status");
  }

  for (const field of DATE_FIELDS) {
    const value = record[field];
    if (value === null || value === undefined || value === "") continue;
    if (typeof value !== "string" || !isValidIsoDate(value, 1900, 2100)) {
      reject(record, issues, field, value, "invalid_date");
    }
  }

  validateIdentifier(record, issues, "member_id", 2, 40);
  validateIdentifier(record, issues, "verification_id", 2, 80);
  validatePattern(record, issues, "provider_npi", /^\d{10}$/, "invalid_npi");
  validatePattern(record, issues, "tax_id", /^[A-Za-z0-9-]{7,15}$/, "invalid_tax_id");
  validatePattern(record, issues, "electronic_payer_id", /^[A-Za-z0-9-]{2,20}$/, "invalid_electronic_payer_id");
  validatePattern(record, issues, "call_reference_number", /^[A-Za-z0-9-]{2,80}$/, "invalid_call_reference_number");

  return issues;
}

function validateIdentifier(
  record: Record<string, unknown>,
  issues: VobValidationIssue[],
  field: string,
  min: number,
  max: number,
) {
  const value = record[field];
  if (value === null || value === undefined || value === "") return;
  const pattern = new RegExp(`^[A-Za-z0-9-]{${min},${max}}$`);
  if (typeof value !== "string" || !pattern.test(value.trim())) {
    reject(record, issues, field, value, "invalid_identifier");
  }
}

function validatePattern(
  record: Record<string, unknown>,
  issues: VobValidationIssue[],
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

function reject(record: Record<string, unknown>, issues: VobValidationIssue[], field: string, value: unknown, reason: string) {
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
