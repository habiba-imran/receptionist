import { admin } from "../_shared/supa.ts";
import { background } from "../_shared/supa.ts";
import { invalidateDashboardCache } from "../_shared/dashboard-cache.ts";
import { buildBookingRow, patientAcct } from "../_shared/booking.ts";
import type { ExtractedPatientData, ExtractionMode, FieldConfidence } from "./types.ts";
import type { ValidationIssue } from "./validation.ts";

const DEFAULT_DOCTOR = Deno.env.get("DEFAULT_DOCTOR") ?? "Dr. Adeel Rahman";

const REALTIME_FIELDS = new Set([
  "language",
  "first_name",
  "full_legal_name",
  "dob",
  "gender",
  "reason",
  "appointment_text",
  "patient_status",
  "patient_status_unverified",
  "contact_number",
  "callback_number",
  "email",
  "mailing_address",
  "whatsapp_suitable",
  "intake_method",
  "insurance_status",
  "payer_name",
  "member_id",
  "group_number",
  "plan_type",
  "payer_id",
  "customer_service_number",
  "patient_is_subscriber",
  "subscriber_name",
  "subscriber_dob",
  "subscriber_relationship",
  "subscriber_employer",
  "has_secondary",
  "secondary_payer",
  "secondary_member_id",
  "primary_plan",
  "plan_change_this_year",
  "plan_change_details",
  "referring_provider",
  "provider_name",
  "npi",
  "tax_id",
  "cpt_codes",
  "prior_auth",
  "prior_auth_number",
  "seen_other_provider",
  "triage_flag",
  "transfer_initiated",
  "notes",
]);
const FINAL_ONLY_FIELDS = new Set([
  "dob",
  "gender",
  "mailing_address",
  "email",
  "payer_id",
  "customer_service_number",
  "patient_is_subscriber",
  "subscriber_name",
  "subscriber_dob",
  "subscriber_relationship",
  "subscriber_employer",
  "has_secondary",
  "secondary_payer",
  "secondary_member_id",
  "primary_plan",
  "plan_change_this_year",
  "plan_change_details",
  "referring_provider",
  "provider_name",
  "npi",
  "tax_id",
  "cpt_codes",
  "prior_auth",
  "prior_auth_number",
  "seen_other_provider",
]);

const REALTIME_HIGH_CONFIDENCE_FIELDS = new Set([
  "full_legal_name",
  "dob",
  "contact_number",
  "callback_number",
  "email",
  "member_id",
  "group_number",
  "payer_id",
  "customer_service_number",
  "subscriber_dob",
  "secondary_member_id",
  "npi",
  "tax_id",
  "cpt_codes",
  "prior_auth",
  "prior_auth_number",
]);
const PROTECTED_FIELDS = new Set([
  "id",
  "created_at",
  "updated_at",
  "call_id",
  "call_started_at",
  "representative",
  "practice",
  "assigned_doctor",
  "patient_acct",
  "source",
  "form_status",
  "confirmation_status",
  "confirmation_channel",
  "transcript",
  "call_summary",
  "recording_url",
  "raw_payload",
]);

const CRM_EXTRACTION_FIELDS = [
  "language",
  "first_name",
  "full_legal_name",
  "dob",
  "gender",
  "contact_number",
  "callback_number",
  "email",
  "mailing_address",
  "reason",
  "appointment_text",
  "patient_status",
  "patient_status_unverified",
  "whatsapp_suitable",
  "intake_method",
  "insurance_status",
  "payer_name",
  "member_id",
  "group_number",
  "plan_type",
  "payer_id",
  "customer_service_number",
  "patient_is_subscriber",
  "subscriber_name",
  "subscriber_dob",
  "subscriber_relationship",
  "subscriber_employer",
  "has_secondary",
  "secondary_payer",
  "secondary_member_id",
  "primary_plan",
  "plan_change_this_year",
  "plan_change_details",
  "referring_provider",
  "provider_name",
  "npi",
  "tax_id",
  "cpt_codes",
  "prior_auth",
  "prior_auth_number",
  "seen_other_provider",
  "triage_flag",
  "transfer_initiated",
  "notes",
] as const;

type UpsertArgs = {
  callId: string;
  event: "transcript_updated" | "call_ended";
  mode: ExtractionMode;
  transcript: string;
  transcriptLength: number;
  extractedAt: string;
  extraction: ExtractedPatientData;
  callContext?: Record<string, unknown>;
  validationErrors?: ValidationIssue[];
};

export async function getTranscriptCrmState(callId: string): Promise<{
  extraction: Record<string, unknown>;
  pendingExtraction: Record<string, unknown>;
  transcriptLength: number;
}> {
  const db = admin();
  const { data, error } = await db.from("bookings")
    .select("*")
    .eq("call_id", callId)
    .maybeSingle();
  if (error) throw error;

  const raw = data?.raw_payload && typeof data.raw_payload === "object" && !Array.isArray(data.raw_payload)
    ? data.raw_payload as Record<string, unknown>
    : {};
  const transcriptCrm = raw.transcript_crm && typeof raw.transcript_crm === "object" && !Array.isArray(raw.transcript_crm)
    ? raw.transcript_crm as Record<string, unknown>
    : {};
  const extraction = buildExtractionFromBookingRow(data ?? {});
  const pendingExtraction = buildPendingExtraction(transcriptCrm.extraction, extraction);
  const transcriptLength = typeof transcriptCrm.transcript_length === "number" ? transcriptCrm.transcript_length : 0;

  return { extraction, pendingExtraction, transcriptLength };
}

function buildExtractionFromBookingRow(row: Record<string, unknown>): Record<string, unknown> {
  const extraction: Record<string, unknown> = {};
  for (const field of CRM_EXTRACTION_FIELDS) {
    const value = row[field];
    if (value === null || value === undefined || value === "") continue;
    extraction[field] = value;
  }
  return extraction;
}

function buildPendingExtraction(
  rawExtraction: unknown,
  savedExtraction: Record<string, unknown>,
): Record<string, unknown> {
  if (!rawExtraction || typeof rawExtraction !== "object" || Array.isArray(rawExtraction)) return {};

  const pending: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(rawExtraction as Record<string, unknown>)) {
    if (field === "field_confidence") continue;
    if (value === null || value === undefined || value === "") continue;
    if (savedExtraction[field] !== null && savedExtraction[field] !== undefined && savedExtraction[field] !== "") continue;
    pending[field] = value;
  }

  return pending;
}

export async function upsertTranscriptCrm(args: UpsertArgs): Promise<{ updated: boolean; fields: string[] }> {
  const db = admin();
  const { data: existing, error: fetchError } = await db.from("bookings")
    .select("*")
    .eq("call_id", args.callId)
    .maybeSingle();
  if (fetchError) throw fetchError;

  const allowedFields = args.mode === "final"
    ? new Set([...REALTIME_FIELDS, ...FINAL_ONLY_FIELDS])
    : REALTIME_FIELDS;

  const input = filterExtraction(args.extraction, allowedFields);
  if (Object.keys(input).length === 0) {
    await updateMetadataOnly(db, existing, args);
    return { updated: false, fields: [] };
  }

  const normalized = safeBuildBookingRow(input);
  const extractedFields = new Set(Object.keys(input));
  const patch = mergePatch(existing ?? {}, normalized, args.extraction.field_confidence, args.mode, extractedFields);
  const validationReviewReasons = buildValidationReviewReasons(args.validationErrors ?? []);
  if (validationReviewReasons.length > 0) {
    patch.needs_review = true;
    patch.review_reasons = mergeReviewReasons(patch.review_reasons, validationReviewReasons);
  }
  const metadata = buildRawPayload(existing?.raw_payload, args, Object.keys(patch));

  const row = {
    ...patch,
    call_id: args.callId,
    raw_payload: metadata,
  };
  applyCallAuditFields(row, args);

  if (!existing) {
    Object.assign(row, {
      assigned_doctor: DEFAULT_DOCTOR,
      patient_acct: patientAcct(args.callId),
      source: "transcript_crm",
    });
  }

  const { error } = await db.from("bookings").upsert(row, { onConflict: "call_id" });
  if (error) throw error;
  background(invalidateDashboardCache());
  return { updated: Object.keys(patch).length > 0, fields: Object.keys(patch) };
}

function safeBuildBookingRow(input: Record<string, unknown>) {
  try {
    return buildBookingRow(input, { source: "transcript_crm" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("DEFAULT_COUNTRY_CODE")) throw error;

    const retryInput = { ...input };
    delete retryInput.contact_number;
    delete retryInput.callback_number;
    const row = buildBookingRow(retryInput, { source: "transcript_crm" });
    if (input.contact_number) row.contact_number = input.contact_number;
    if (input.callback_number) row.callback_number = input.callback_number;
    return row;
  }
}

function filterExtraction(
  extraction: ExtractedPatientData,
  allowedFields: Set<string>,
): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(extraction)) {
    if (key === "field_confidence") continue;
    if (!allowedFields.has(key)) continue;
    if (value === null || value === undefined || value === "") continue;
    input[key] = value;
  }
  if (!input.first_name && typeof input.full_legal_name === "string") {
    input.first_name = input.full_legal_name.trim().split(/\s+/)[0] ?? "";
    if (!extraction.field_confidence.first_name && extraction.field_confidence.full_legal_name) {
      extraction.field_confidence.first_name = extraction.field_confidence.full_legal_name;
    }
  }
  return input;
}

function mergePatch(
  existing: Record<string, unknown>,
  normalized: Record<string, unknown>,
  confidence: Record<string, FieldConfidence>,
  mode: ExtractionMode,
  extractedFields: Set<string>,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};

  for (const [field, value] of Object.entries(normalized)) {
    if (PROTECTED_FIELDS.has(field)) continue;
    if (field === "needs_review" || field === "review_reasons") continue;
    if (!extractedFields.has(field)) continue;
    if (value === null || value === undefined || value === "") continue;

    const current = existing[field];
    if (current === null || current === undefined || current === "") {
      if (shouldWriteNew(field, confidence[field], mode)) {
        patch[field] = value;
      }
      continue;
    }

    if (String(current) === String(value)) continue;
    if (shouldReplace(field, confidence[field], mode)) {
      patch[field] = value;
    }
  }

  const reviewReasons = mergeReviewReasons(existing.review_reasons, normalized.review_reasons);
  if (reviewReasons.length > 0) {
    patch.needs_review = Boolean(existing.needs_review) || Boolean(normalized.needs_review);
    patch.review_reasons = reviewReasons;
  }

  return patch;
}

function shouldReplace(field: string, level: FieldConfidence | undefined, mode: ExtractionMode): boolean {
  if (mode === "final") return level === "medium" || level === "high";
  if (REALTIME_HIGH_CONFIDENCE_FIELDS.has(field)) return level === "high";
  return level === "medium" || level === "high";
}

function shouldWriteNew(field: string, level: FieldConfidence | undefined, mode: ExtractionMode): boolean {
  if (mode === "final") return level === "medium" || level === "high";
  if (REALTIME_HIGH_CONFIDENCE_FIELDS.has(field)) return level === "high";
  return level === "medium" || level === "high";
}

function mergeReviewReasons(existingReasons: unknown, newReasons: unknown): string[] {
  const reasons = [
    ...(Array.isArray(existingReasons) ? existingReasons : []),
    ...(Array.isArray(newReasons) ? newReasons : []),
  ].filter((reason): reason is string => typeof reason === "string" && reason.length > 0);

  return Array.from(new Set(reasons));
}

function buildValidationReviewReasons(validationErrors: ValidationIssue[]): string[] {
  return Array.from(new Set(
    validationErrors.map((issue) => `validation_${issue.field}_${issue.reason}`),
  ));
}

async function updateMetadataOnly(db: any, existing: Record<string, unknown> | null, args: UpsertArgs) {
  if (!existing) return;
  const raw_payload = buildRawPayload(existing.raw_payload, args, []);
  const patch: Record<string, unknown> = { raw_payload };
  applyCallAuditFields(patch, args);
  await db.from("bookings").update(patch).eq("call_id", args.callId);
  background(invalidateDashboardCache(["calls"]));
}

function applyCallAuditFields(row: Record<string, unknown>, args: UpsertArgs): void {
  if (args.transcript) row.transcript = args.transcript;
  const recordingUrl = stringValue(args.callContext?.recording_url);
  if (recordingUrl) row.recording_url = recordingUrl;
  const startedAt = timestampValue(args.callContext?.start_timestamp);
  if (startedAt) row.call_started_at = startedAt;
}

function buildRawPayload(existingRaw: unknown, args: UpsertArgs, updatedFields: string[]) {
  const base = existingRaw && typeof existingRaw === "object" && !Array.isArray(existingRaw)
    ? existingRaw as Record<string, unknown>
    : {};
  const existingCall = base.call && typeof base.call === "object" && !Array.isArray(base.call)
    ? base.call as Record<string, unknown>
    : {};
  const callContext = {
    ...existingCall,
    ...(args.callContext ?? {}),
  };
  const callStatus = stringValue(callContext.call_status);
  if (args.event === "call_ended" && (!callStatus || isActiveCallStatus(callStatus))) {
    callContext.call_status = "ended";
  }

  return {
    ...base,
    call: callContext,
    transcript_crm: {
      last_event: args.event,
      mode: args.mode,
      last_extracted_at: args.extractedAt,
      transcript_length: args.transcriptLength,
      finalized: args.mode === "final",
      updated_fields: updatedFields,
      field_confidence: args.extraction.field_confidence,
      validation_errors: args.validationErrors ?? [],
      extraction: compactExtraction(args.extraction),
    },
  };
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function timestampValue(value: unknown): string | null {
  if (typeof value !== "number") return null;
  const ms = value > 10_000_000_000 ? value : value * 1000;
  return new Date(ms).toISOString();
}

function isActiveCallStatus(status: string): boolean {
  return ["registered", "ongoing", "in_progress", "active"].includes(status.toLowerCase());
}

function compactExtraction(extraction: ExtractedPatientData): Record<string, unknown> {
  const compact: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(extraction)) {
    if (field === "field_confidence") continue;
    if (value === null || value === undefined || value === "") continue;
    compact[field] = value;
  }
  return compact;
}
