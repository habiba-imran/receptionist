import { admin } from "../_shared/supa.ts";
import type { ExtractedVobData, ExtractionMode, FieldConfidence } from "./types.ts";
import type { VobValidationIssue } from "./validation.ts";

const VOB_FIELDS = new Set([
  "verification_id",
  "practice_name",
  "patient_full_name",
  "patient_dob",
  "member_id",
  "payer_name",
  "provider_name",
  "provider_npi",
  "tax_id",
  "cpt_codes",
  "service_type",
  "date_of_service",
  "policy_active",
  "plan_type",
  "effective_date",
  "network_status",
  "individual_deductible_total",
  "individual_deductible_met",
  "individual_deductible_remaining",
  "family_deductible_total",
  "family_deductible_met",
  "family_deductible_remaining",
  "individual_oop_total",
  "individual_oop_met",
  "individual_oop_remaining",
  "family_oop_total",
  "family_oop_met",
  "family_oop_remaining",
  "copay",
  "coinsurance",
  "deductible_applies",
  "cpt_coverage",
  "cpt_limitations",
  "visit_limit",
  "visits_used",
  "visits_remaining",
  "prior_auth_required",
  "auth_method",
  "referral_required",
  "claims_mailing_address",
  "electronic_payer_id",
  "representative_name",
  "call_reference_number",
  "status",
  "notes",
]);

const FINAL_STATUSES = new Set([
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

const REQUIRED_QUEUE_FIELDS = [
  "patient_full_name",
  "patient_dob",
  "payer_name",
  "member_id",
] as const;

type UpsertArgs = {
  callId: string;
  event: "transcript_updated" | "call_ended";
  mode: ExtractionMode;
  transcript: string;
  transcriptLength: number;
  extractedAt: string;
  extraction: ExtractedVobData;
  validationErrors?: VobValidationIssue[];
};

export async function upsertVobQueue(args: UpsertArgs): Promise<{ updated: boolean; fields: string[] }> {
  const db = admin();
  const { data: existing, error: fetchError } = await db.from("vob_queue")
    .select("*")
    .eq("call_id", args.callId)
    .maybeSingle();
  if (fetchError) throw fetchError;

  const patch = buildPatch(existing ?? {}, args.extraction, args.mode);
  const readiness = buildQueueReadiness(existing ?? {}, patch, args.extractedAt);
  Object.assign(patch, readiness.patch);

  const updatedFields = Object.keys(patch);
  const raw_payload = buildRawPayload(existing?.raw_payload, args, updatedFields, readiness);

  const row: Record<string, unknown> = {
    ...patch,
    call_id: args.callId,
    last_extracted_at: args.extractedAt,
    raw_payload,
  };

  if (args.mode === "final") {
    row.transcript = args.transcript;
  }

  if (!existing) {
    if (readiness.queueReady) {
      row.priority_position = await nextPriorityPosition(db);
    }
    row.status = typeof row.status === "string" ? row.status : "collecting";
  } else if (readiness.justBecameReady && !hasValue(existing.priority_position)) {
    row.priority_position = await nextPriorityPosition(db);
  }

  const { error } = await db.from("vob_queue").upsert(row, { onConflict: "call_id" });
  if (error) throw error;
  return { updated: updatedFields.length > 0, fields: updatedFields };
}

function buildPatch(
  existing: Record<string, unknown>,
  extraction: ExtractedVobData,
  mode: ExtractionMode,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};

  for (const [field, rawValue] of Object.entries(extraction)) {
    if (field === "field_confidence") continue;
    if (!VOB_FIELDS.has(field)) continue;
    if (rawValue === null || rawValue === undefined || rawValue === "") continue;

    const value = DATE_FIELDS.has(field) ? normalizeDate(rawValue) : rawValue;
    if (value === null || value === "") continue;

    const current = existing[field];
    if (current === null || current === undefined || current === "") {
      if (shouldWriteNew(field, extraction.field_confidence[field], mode)) {
        patch[field] = value;
      }
      continue;
    }

    if (String(current) === String(value)) continue;
    if (shouldReplace(field, extraction.field_confidence[field], mode)) {
      patch[field] = value;
    }
  }

  const reviewReasons = buildReviewReasons(existing, extraction);
  if (reviewReasons.length > 0) {
    patch.needs_review = true;
    patch.review_reasons = reviewReasons;
  }

  return patch;
}

function buildQueueReadiness(
  existing: Record<string, unknown>,
  patch: Record<string, unknown>,
  extractedAt: string,
): { queueReady: boolean; justBecameReady: boolean; patch: Record<string, unknown> } {
  const merged = { ...existing, ...patch };
  const missing = missingRequiredQueueFields(merged);
  const queueReady = missing.length === 0;
  const wasReady = existing.queue_ready === true;
  const readinessPatch: Record<string, unknown> = {
    queue_ready: queueReady,
    missing_required_fields: missing,
  };

  if (queueReady && !wasReady) {
    readinessPatch.ready_at = extractedAt;
  }

  if (!queueReady && wasReady) {
    readinessPatch.ready_at = null;
  }

  if (!queueReady && !FINAL_STATUSES.has(String(merged.status ?? ""))) {
    readinessPatch.status = missing.length > 0 ? "missing_information" : "collecting";
  }

  if (queueReady && String(merged.status ?? "") === "missing_information") {
    readinessPatch.status = "collecting";
  }

  return {
    queueReady,
    justBecameReady: queueReady && !wasReady,
    patch: readinessPatch,
  };
}

function missingRequiredQueueFields(row: Record<string, unknown>): string[] {
  const missing = REQUIRED_QUEUE_FIELDS.filter((field) => !hasValue(row[field]));
  if (!hasValue(row.provider_name) && !hasValue(row.practice_name)) {
    missing.push("provider_name_or_practice_name");
  }
  return missing;
}

function hasValue(value: unknown): boolean {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

function shouldReplace(field: string, level: FieldConfidence | undefined, mode: ExtractionMode): boolean {
  if (field === "status") return shouldReplaceStatus(level, mode);
  if (mode === "final") return level === "medium" || level === "high";
  if (field === "member_id" || field === "patient_dob" || field === "provider_npi" || field === "tax_id") {
    return level === "high";
  }
  return level === "medium" || level === "high";
}

function shouldWriteNew(field: string, level: FieldConfidence | undefined, mode: ExtractionMode): boolean {
  if (field === "status") return shouldReplaceStatus(level, mode);
  if (mode === "final") return level === "medium" || level === "high";
  if (field === "member_id" || field === "patient_dob" || field === "provider_npi" || field === "tax_id") {
    return level === "high";
  }
  return level === "medium" || level === "high";
}

function shouldReplaceStatus(level: FieldConfidence | undefined, mode: ExtractionMode): boolean {
  if (mode === "final") return level === "medium" || level === "high";
  return level === "medium" || level === "high";
}

function normalizeDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    return validDateParts(year, month, day) ? trimmed : null;
  }

  const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const [, month, day, year] = slashMatch;
    return validDateParts(year, month, day) ? `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}` : null;
  }

  const compactMatch = trimmed.match(/^(\d{2})(\d{2})(\d{4})$/);
  if (compactMatch) {
    const [, month, day, year] = compactMatch;
    return validDateParts(year, month, day) ? `${year}-${month}-${day}` : null;
  }

  return null;
}

function validDateParts(year: string, month: string, day: string): boolean {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function buildReviewReasons(existing: Record<string, unknown>, extraction: ExtractedVobData): string[] {
  const reasons = Array.isArray(existing.review_reasons) ? [...existing.review_reasons] : [];
  const status = extraction.status;
  if (status && FINAL_STATUSES.has(status) && status !== "verified") {
    reasons.push(`vob_status_${status}`);
  }
  return Array.from(new Set(reasons.filter((reason): reason is string => typeof reason === "string" && reason.length > 0)));
}

async function nextPriorityPosition(db: any): Promise<number> {
  const { data, error } = await db.from("vob_queue")
    .select("priority_position")
    .not("priority_position", "is", null)
    .order("priority_position", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  const current = typeof data?.priority_position === "number" ? data.priority_position : 0;
  return current + 1;
}

function buildRawPayload(
  existingRaw: unknown,
  args: UpsertArgs,
  updatedFields: string[],
  readiness: { queueReady: boolean; patch: Record<string, unknown> },
) {
  const base = existingRaw && typeof existingRaw === "object" && !Array.isArray(existingRaw)
    ? existingRaw as Record<string, unknown>
    : {};

  return {
    ...base,
    transcript_vob: {
      last_event: args.event,
      mode: args.mode,
      last_extracted_at: args.extractedAt,
      transcript_length: args.transcriptLength,
      finalized: args.mode === "final",
      updated_fields: updatedFields,
      field_confidence: args.extraction.field_confidence,
      validation_errors: args.validationErrors ?? [],
      queue_ready: readiness.queueReady,
      missing_required_fields: readiness.patch.missing_required_fields ?? [],
      extraction: compactExtraction(args.extraction),
    },
  };
}

function compactExtraction(extraction: ExtractedVobData): Record<string, unknown> {
  const compact: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(extraction)) {
    if (field === "field_confidence") continue;
    if (value === null || value === undefined || value === "") continue;
    compact[field] = value;
  }
  return compact;
}
