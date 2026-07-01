import { cleanMemberId, str, toBool, toE164, validateDob } from "./validate.ts";

export function buildBookingRow(input: Record<string, unknown>, opts: { source: string }) {
  const reasons: string[] = [];

  const dob = validateDob(str(input.dob));
  if (!dob.ok) reasons.push("dob_invalid");
  const subDob = validateDob(str(input.subscriber_dob));
  if (!subDob.ok) reasons.push("subscriber_dob_invalid");

  const first_name = str(input.first_name);
  const reason = str(input.reason);
  const appointment_text = str(input.appointment_text);
  if (!first_name) reasons.push("missing_first_name");
  if (!reason) reasons.push("missing_reason");
  if (!appointment_text) reasons.push("missing_appointment");

  const contact = toE164(str(input.contact_number) ?? str(input.callback_number));

  const row: Record<string, unknown> = {
    language: str(input.language),
    contact_number: contact || null,
    whatsapp_suitable: toBool(input.whatsapp_suitable),

    first_name,
    full_legal_name: str(input.full_legal_name),
    dob: dob.value,
    gender: str(input.gender),
    mailing_address: str(input.mailing_address),
    callback_number: toE164(str(input.callback_number)) || null,
    email: str(input.email),

    reason,
    appointment_text,
    patient_status: str(input.patient_status),
    patient_status_unverified: toBool(input.patient_status_unverified) ?? false,

    insurance_status: str(input.insurance_status) ?? "pending",
    payer_name: str(input.payer_name),
    member_id: cleanMemberId(str(input.member_id)),
    group_number: str(input.group_number),
    plan_type: str(input.plan_type),
    payer_id: str(input.payer_id),
    customer_service_number: str(input.customer_service_number),
    provider_name: str(input.provider_name),
    npi: str(input.npi),
    tax_id: str(input.tax_id),
    cpt_codes: str(input.cpt_codes),

    patient_is_subscriber: toBool(input.patient_is_subscriber),
    subscriber_name: str(input.subscriber_name),
    subscriber_dob: subDob.value,
    subscriber_relationship: str(input.subscriber_relationship),
    subscriber_employer: str(input.subscriber_employer),

    has_secondary: toBool(input.has_secondary),
    secondary_payer: str(input.secondary_payer),
    secondary_member_id: cleanMemberId(str(input.secondary_member_id)),
    primary_plan: str(input.primary_plan),
    plan_change_this_year: toBool(input.plan_change_this_year),
    plan_change_details: str(input.plan_change_details),

    referring_provider: str(input.referring_provider),
    prior_auth: toBool(input.prior_auth),
    prior_auth_number: str(input.prior_auth_number),
    seen_other_provider: str(input.seen_other_provider),
    notes: str(input.notes),

    intake_method: str(input.intake_method) ?? "voice",
    source: opts.source,
    triage_flag: str(input.triage_flag) ?? "none",
    transfer_initiated: toBool(input.transfer_initiated) ?? false,

    needs_review: reasons.length > 0,
    review_reasons: reasons,
  };

  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0)) clean[k] = v;
  }
  clean.needs_review = row.needs_review;
  clean.review_reasons = row.review_reasons;
  return clean;
}

export function patientAcct(callId: string): string {
  const tail = (callId || "").replace(/[^a-zA-Z0-9]/g, "").slice(-6).toUpperCase() || "000000";
  return "AWL-" + tail;
}

export function confirmationMessage(p: {
  first_name?: string | null;
  reason?: string | null;
  appointment_text?: string | null;
  patient_status?: string | null;
  insurance_status?: string | null;
  payer_name?: string | null;
  member_id?: string | null;
  intake_method?: string | null;
  assigned_doctor?: string | null;
  language?: string | null;
}): string {
  const name = p.first_name || "there";
  const when = p.appointment_text || "the time we discussed";
  const reason = p.reason || "your cardiology visit";
  const patientStatus = normalizePatientStatus(p.patient_status);
  const insuranceLine = insuranceSummary(p);
  const doc = p.assigned_doctor || "your cardiologist";
  if ((p.language || "en").toLowerCase().startsWith("es")) {
    return `Awaaz Labs Cardiology: Hola ${name}. Resumen de su llamada: motivo ${reason}, horario ${when}, paciente ${patientStatus}. ${insuranceLine} Sera atendido por ${doc}. Nuestro equipo dara seguimiento pronto. Responda STOP para no recibir mensajes.`;
  }
  return `Awaaz Labs Cardiology: Hi ${name}. Call summary: reason ${reason}, timing ${when}, patient status ${patientStatus}. ${insuranceLine} You will be seen by ${doc}. Our team will follow up shortly. Reply STOP to opt out.`;
}

export function formLinkMessage(
  url: string,
  language?: string | null,
  details?: {
    first_name?: string | null;
    reason?: string | null;
    appointment_text?: string | null;
    patient_status?: string | null;
  }
): string {
  const name = details?.first_name || "there";
  const reason = details?.reason || "your cardiology visit";
  const when = details?.appointment_text || "the time discussed";
  const patientStatus = normalizePatientStatus(details?.patient_status);
  if ((language || "en").toLowerCase().startsWith("es")) {
    return `Awaaz Labs Cardiology: Hola ${name}. Ya tenemos su motivo ${reason}, horario ${when} y estado de paciente ${patientStatus}. Complete los detalles de seguro y admision aqui: ${url}`;
  }
  return `Awaaz Labs Cardiology: Hi ${name}. We already have your reason ${reason}, timing ${when}, and patient status ${patientStatus}. Please complete your insurance and intake details here: ${url}`;
}

function normalizePatientStatus(value?: string | null): string {
  if (!value) return "unknown";
  const v = value.replace(/_/g, " ").trim().toLowerCase();
  if (v === "new") return "new";
  if (v === "existing") return "existing";
  return v;
}

function insuranceSummary(p: {
  intake_method?: string | null;
  insurance_status?: string | null;
  payer_name?: string | null;
  member_id?: string | null;
}): string {
  if (p.intake_method === "form") {
    return "Insurance details will be completed in the secure form.";
  }

  const status = p.insurance_status ? p.insurance_status.replace(/_/g, " ") : "pending";
  const payer = p.payer_name ? ` insurer ${p.payer_name}` : "";
  const member = p.member_id ? `, member ID ${p.member_id}` : "";
  return `Insurance status ${status}${payer}${member}.`;
}
