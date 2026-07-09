// Maps raw DB rows (snake_case + PostgREST embeds) to camelCase response DTOs.

import type {
  AppointmentRowDto,
  DbAppointmentDetailRow,
  DbAppointmentRow,
  DbEscalationRow,
  EscalationRowDto,
  VobDetailDto,
} from "./types.ts";
import { maskPhone, patientName } from "./util.ts";

export function mapRow(
  row: DbAppointmentRow | DbAppointmentDetailRow,
  transcriptIds: Set<string>,
): AppointmentRowDto {
  const name = patientName(row.patient);
  return {
    id: row.id,
    locationId: row.location_id,
    locationName: row.location?.name ?? null,
    patientId: row.patient_id,
    bookingId: row.booking_id,
    callId: row.call_id,
    vobId: row.vob_id,
    status: row.status,
    source: row.source,
    serviceInterest: row.service_interest,
    language: row.language,
    triage: row.triage,
    insuranceCaptured: row.insurance_captured,
    bookedByAgent: row.booked_by_agent,
    bookedAt: row.booked_at,
    afterHours: row.after_hours,
    startsAt: row.starts_at,
    appointmentTextRaw: row.appointment_text_raw,
    timeParseStatus: row.time_parse_status,
    timeParseConfidence: row.time_parse_confidence,
    needsReview: row.needs_review,
    reviewReasons: row.review_reasons,
    isSeeded: row.is_seeded,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    patient: {
      firstName: name.firstName,
      lastName: name.lastName,
      fullName: name.fullName,
      phoneMasked: maskPhone(row.patient.phone_e164),
      phoneE164: null,
    },
    vobStatus: row.vob !== null ? row.vob.status : null,
    confirmationAttempts: row.confirmation_attempts.map((a) => ({
      id: a.id,
      at: a.at,
      outcome: a.outcome,
      channel: a.channel,
    })),
    timeline: row.timeline.map((e) => ({ id: e.id, at: e.at, label: e.label, actor: e.actor })),
    staffNotes: row.staff_notes.map((n) => ({ id: n.id, at: n.at, author: n.author, body: n.body })),
    bookingRef: row.booking !== null
      ? { callId: row.booking.call_id, transcriptAvailable: transcriptIds.has(row.booking.id) }
      : null,
  };
}

export function mapVobDetail(row: DbAppointmentDetailRow): VobDetailDto | null {
  if (row.vob === null) return null;
  return {
    status: row.vob.status,
    payerName: row.vob.payer_name,
    copay: row.vob.copay,
    individualDeductibleTotal: row.vob.individual_deductible_total,
    individualDeductibleMet: row.vob.individual_deductible_met,
    individualDeductibleRemaining: row.vob.individual_deductible_remaining,
    individualOopTotal: row.vob.individual_oop_total,
    individualOopMet: row.vob.individual_oop_met,
    individualOopRemaining: row.vob.individual_oop_remaining,
    priorAuthRequired: row.vob.prior_auth_required,
    lastActivityAt: row.vob.updated_at,
  };
}

export function mapEscalationRow(row: DbEscalationRow): EscalationRowDto {
  return {
    id: row.id,
    locationId: row.location_id,
    bookingId: row.booking_id,
    callId: row.call_id,
    patientId: row.patient_id,
    trigger: row.trigger,
    routedTo: row.routed_to,
    status: row.status,
    acknowledgedAt: row.acknowledged_at,
    acknowledgedBy: row.acknowledged_by,
    resolutionNote: row.resolution_note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    patient: row.patient
      ? { firstName: row.patient.first_name, lastName: row.patient.last_name }
      : null,
    locationName: row.location?.name ?? null,
  };
}
