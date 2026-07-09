// Shared types and constants for the dashboard-api edge function.

// ---------- identity ----------

export type Role = "OWNER" | "ADMIN" | "STAFF" | "VIEWER";
export type Mode = "PHI_BAA" | "NON_PHI";

export interface Identity {
  actor: string;
  role: Role;
  mode: Mode;
}

// ---------- enums (mirror DB check constraints in 20260709000100_appointments_domain.sql) ----------

export const APPOINTMENT_STATUSES = [
  "booked",
  "confirmed",
  "rescheduled",
  "completed",
  "cancelled",
  "no_show",
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export const APPOINTMENT_SOURCES = ["voice", "whatsapp", "web_chat", "form"] as const;
export type AppointmentSource = (typeof APPOINTMENT_SOURCES)[number];

export const TRIAGE_LEVELS = ["none", "low", "high", "urgent"] as const;
export type TriageLevel = (typeof TRIAGE_LEVELS)[number];

export const LANGUAGES = ["en", "es", "other"] as const;
export type Language = (typeof LANGUAGES)[number];

// vob_queue.status has no DB check constraint; these are the values the
// transcript-vob-poc pipeline writes (see transcript-vob-poc/extraction.ts).
export const VOB_STATUSES = [
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
] as const;
export type VobStatus = (typeof VOB_STATUSES)[number];

// ---------- result envelope (converted to HTTP responses in index.ts) ----------

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; code: string; message: string };

export function ok<T>(data: T): Result<T> {
  return { ok: true, data };
}

export function fail<T = never>(status: number, code: string, message: string): Result<T> {
  return { ok: false, status, code, message };
}

// ---------- list query params ----------

export interface ListParams {
  status: AppointmentStatus | null;
  source: AppointmentSource | null;
  triage: TriageLevel | null;
  language: Language | null;
  vob: VobStatus | "none" | null;
  search: string | null;
  dateFrom: string | null; // yyyy-mm-dd
  dateTo: string | null; // yyyy-mm-dd
  locationId: string | null;
  includeSeeded: boolean;
  limit: number;
}

// ---------- raw DB row shapes (snake_case, as returned by PostgREST embeds) ----------

export interface DbPatientEmbed {
  first_name: string | null;
  last_name: string | null;
  full_legal_name: string;
  phone_e164: string | null;
}

export interface DbAttemptRow {
  id: string;
  at: string;
  outcome: string;
  channel: string;
}

export interface DbEventRow {
  id: string;
  at: string;
  label: string;
  actor: string;
}

export interface DbNoteRow {
  id: string;
  at: string;
  author: string;
  body: string;
}

export interface DbBookingEmbed {
  id: string;
  call_id: string | null;
}

export interface DbVobDetailEmbed {
  status: string | null;
  payer_name: string | null;
  copay: string | null;
  individual_deductible_total: string | null;
  individual_deductible_met: string | null;
  individual_deductible_remaining: string | null;
  individual_oop_total: string | null;
  individual_oop_met: string | null;
  individual_oop_remaining: string | null;
  prior_auth_required: string | null;
  updated_at: string;
}

export interface DbAppointmentRow {
  id: string;
  location_id: string;
  patient_id: string;
  booking_id: string | null;
  call_id: string | null;
  vob_id: string | null;
  status: AppointmentStatus;
  source: AppointmentSource;
  service_interest: string;
  language: Language;
  triage: TriageLevel;
  insurance_captured: boolean;
  booked_by_agent: string;
  booked_at: string;
  after_hours: boolean;
  starts_at: string | null;
  appointment_text_raw: string | null;
  time_parse_status: string;
  time_parse_confidence: string | null;
  needs_review: boolean;
  review_reasons: string[];
  is_seeded: boolean;
  created_at: string;
  updated_at: string;
  patient: DbPatientEmbed;
  vob: { status: string | null } | null;
  confirmation_attempts: DbAttemptRow[];
  timeline: DbEventRow[];
  staff_notes: DbNoteRow[];
  booking: DbBookingEmbed | null;
}

export interface DbAppointmentDetailRow extends Omit<DbAppointmentRow, "vob"> {
  vob: DbVobDetailEmbed | null;
}

// ---------- response DTOs (camelCase, documented in CONTRACT.md) ----------

export interface PatientSummaryDto {
  firstName: string | null;
  lastName: string | null;
  phoneMasked: string | null;
  phoneE164: null; // always null in list/detail; reveal_phone is the audited path
}

export interface ConfirmationAttemptDto {
  id: string;
  at: string;
  outcome: string;
  channel: string;
}

export interface TimelineEventDto {
  id: string;
  at: string;
  label: string;
  actor: string;
}

export interface StaffNoteDto {
  id: string;
  at: string;
  author: string;
  body: string;
}

export interface BookingRefDto {
  callId: string | null;
  transcriptAvailable: boolean;
}

export interface AppointmentRowDto {
  id: string;
  locationId: string;
  patientId: string;
  bookingId: string | null;
  callId: string | null;
  vobId: string | null;
  status: AppointmentStatus;
  source: AppointmentSource;
  serviceInterest: string;
  language: Language;
  triage: TriageLevel;
  insuranceCaptured: boolean;
  bookedByAgent: string;
  bookedAt: string;
  afterHours: boolean;
  startsAt: string | null;
  appointmentTextRaw: string | null;
  timeParseStatus: string;
  timeParseConfidence: string | null;
  needsReview: boolean;
  reviewReasons: string[];
  isSeeded: boolean;
  createdAt: string;
  updatedAt: string;
  patient: PatientSummaryDto;
  vobStatus: string | null;
  confirmationAttempts: ConfirmationAttemptDto[];
  timeline: TimelineEventDto[];
  staffNotes: StaffNoteDto[];
  bookingRef: BookingRefDto | null;
}

export interface VobDetailDto {
  status: string | null;
  payerName: string | null;
  copay: string | null;
  individualDeductibleTotal: string | null;
  individualDeductibleMet: string | null;
  individualDeductibleRemaining: string | null;
  individualOopTotal: string | null;
  individualOopMet: string | null;
  individualOopRemaining: string | null;
  priorAuthRequired: string | null;
  lastActivityAt: string;
}

export interface AppointmentDetailDto extends AppointmentRowDto {
  vob: VobDetailDto | null;
}

export type ListResponse =
  | { rows: AppointmentRowDto[]; total: number }
  | { kind: "aggregate"; total: number };

export interface StatsDto {
  bookedToday: number;
  upcomingNext7Days: number;
  confirmationRate: number | null;
  noShowRate30d: number | null;
}

// ---------- escalations ----------

export const ESCALATION_TRIGGERS = [
  "triage_high",
  "triage_urgent_emergency",
  "caller_requested_human",
  "clinical_question",
  "agent_initiated",
] as const;
export type EscalationTrigger = (typeof ESCALATION_TRIGGERS)[number];

export const ESCALATION_STATUSES = ["open", "acknowledged", "resolved"] as const;
export type EscalationStatus = (typeof ESCALATION_STATUSES)[number];

export interface EscalationListParams {
  status: EscalationStatus | null;
  trigger: EscalationTrigger | null;
  locationId: string | null;
  limit: number;
}

export interface DbEscalationPatientEmbed {
  first_name: string | null;
  last_name: string | null;
}

export interface DbEscalationRow {
  id: string;
  location_id: string;
  booking_id: string | null;
  call_id: string | null;
  patient_id: string | null;
  trigger: string;
  routed_to: string | null;
  status: string;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
  resolution_note: string | null;
  created_at: string;
  updated_at: string;
  patient: DbEscalationPatientEmbed | null;
  location: { name: string } | null;
}

export interface EscalationRowDto {
  id: string;
  locationId: string;
  bookingId: string | null;
  callId: string | null;
  patientId: string | null;
  trigger: string;
  routedTo: string | null;
  status: string;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  resolutionNote: string | null;
  createdAt: string;
  updatedAt: string;
  patient: { firstName: string | null; lastName: string | null } | null;
  locationName: string | null;
}

export type EscalationListResponse =
  | { rows: EscalationRowDto[]; total: number }
  | { kind: "aggregate"; total: number };

export interface EscalationStatsDto {
  total: number;
  thisWeek: number;
  ackRate: number | null;
  medianTimeToAckSeconds: number | null;
  triggerCounts: Record<string, number>;
}



