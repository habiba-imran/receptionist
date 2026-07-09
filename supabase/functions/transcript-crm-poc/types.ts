export type RetellWebhookPayload = {
  event?: string;
  call_id?: string;
  call?: {
    call_id?: string;
    from_number?: string;
    transcript?: unknown;
    transcript_with_tool_calls?: unknown;
    transcript_object?: unknown;
    call_analysis?: {
      call_summary?: string | null;
    };
  };
  data?: {
    call_id?: string;
    transcript?: unknown;
    transcript_with_tool_calls?: unknown;
    transcript_object?: unknown;
    call?: {
      call_id?: string;
      from_number?: string;
      transcript?: unknown;
      transcript_with_tool_calls?: unknown;
      transcript_object?: unknown;
    };
  };
  transcript?: unknown;
  transcript_with_tool_calls?: unknown;
  transcript_object?: unknown;
};

export type ExtractionMode = "realtime" | "final";

export type FieldConfidence = "low" | "medium" | "high";

export type ExtractedPatientData = {
  language: string | null;
  first_name: string | null;
  full_legal_name: string | null;
  dob: string | null;
  gender: string | null;
  contact_number: string | null;
  callback_number: string | null;
  email: string | null;
  mailing_address: string | null;
  reason: string | null;
  appointment_text: string | null;
  patient_status: string | null;
  patient_status_unverified: boolean | null;
  whatsapp_suitable: boolean | null;
  intake_method: string | null;
  insurance_status: string | null;
  payer_name: string | null;
  member_id: string | null;
  group_number: string | null;
  plan_type: string | null;
  payer_id: string | null;
  customer_service_number: string | null;
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
  provider_name: string | null;
  npi: string | null;
  tax_id: string | null;
  cpt_codes: string | null;
  prior_auth: boolean | null;
  prior_auth_number: string | null;
  seen_other_provider: string | null;
  triage_flag: string | null;
  transfer_initiated: boolean | null;
  notes: string | null;
  field_confidence: Record<string, FieldConfidence>;
};

export type ExtractionSnapshot = {
  call_id: string;
  event: "transcript_updated" | "call_ended";
  mode: ExtractionMode;
  extracted_at: string;
  transcript_length: number;
  extraction: ExtractedPatientData;
};
