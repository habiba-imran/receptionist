export interface Booking {
  id: string;
  call_id: string;
  created_at: string;
  updated_at: string;
  call_started_at: string | null;
  representative: string;
  practice: string;
  patient_acct: string | null;
  assigned_doctor: string;
  language: string | null;
  contact_number: string | null;
  whatsapp_suitable: boolean | null;
  first_name: string | null;
  full_legal_name: string | null;
  dob: string | null;
  gender: string | null;
  mailing_address: string | null;
  callback_number: string | null;
  email: string | null;
  reason: string | null;
  appointment_text: string | null;
  appointment_at: string | null;
  patient_status: string | null;
  patient_status_unverified: boolean | null;
  insurance_status: string | null;
  payer_name: string | null;
  member_id: string | null;
  group_number: string | null;
  plan_type: string | null;
  payer_id: string | null;
  customer_service_number: string | null;
  provider_name: string | null;
  npi: string | null;
  tax_id: string | null;
  cpt_codes: string | null; // stored as text in DB
  date_of_service: string | null;
  patient_is_subscriber: boolean | null;
  subscriber_name: string | null;
  subscriber_dob: string | null;
  subscriber_relationship: string | null;
  subscriber_employer: string | null;
  has_secondary: boolean | null;
  secondary_payer: string | null;
  secondary_member_id: string | null;
  primary_plan: string | null;
  plan_change_this_year: boolean | null;
  plan_change_details: string | null;
  referring_provider: string | null;
  prior_auth: boolean | null;
  prior_auth_number: string | null;
  seen_other_provider: string | null;
  notes: string | null;
  intake_method: string | null;
  form_status: string | null;
  source: string | null;
  needs_review: boolean;
  review_reasons: string[];
  triage_flag: string | null;
  transfer_initiated: boolean | null;
  confirmation_status: string | null;
  confirmation_channel: string | null;
  transcript: string | null;
  call_summary: string | null;
  recording_url: string | null;
  raw_payload: any | null;
}

export interface MessageLog {
  id: string;
  created_at: string;
  call_id: string | null;
  booking_id: string | null;
  purpose: string | null;
  channel: string | null;
  provider: string | null;
  to_number: string | null;
  body: string | null;
  status: string | null;
  provider_message_id: string | null;
  error: string | null;
}

export interface CRMResponse {
  bookings: Booking[];
  messages: MessageLog[];
}

export interface CRMActionResponse {
  ok?: boolean;
  error?: string;
  result?: any;
}
