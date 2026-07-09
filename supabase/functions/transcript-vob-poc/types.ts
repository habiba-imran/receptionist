export type RetellWebhookPayload = {
  event?: string;
  call_id?: string;
  call?: RetellCall;
  data?: {
    call_id?: string;
    transcript?: unknown;
    transcript_with_tool_calls?: unknown;
    transcript_object?: unknown;
    call?: RetellCall;
  };
  transcript?: unknown;
  transcript_with_tool_calls?: unknown;
  transcript_object?: unknown;
};

export type RetellCall = {
  call_id?: string;
  agent_id?: string;
  agent_name?: string;
  from_number?: string;
  transcript?: unknown;
  transcript_with_tool_calls?: unknown;
  transcript_object?: unknown;
  recording_url?: string | null;
  call_analysis?: {
    call_summary?: string | null;
  };
  [key: string]: unknown;
};

export type ExtractionMode = "realtime" | "final";

export type FieldConfidence = "low" | "medium" | "high";

export type ExtractedVobData = {
  verification_id: string | null;
  practice_name: string | null;
  patient_full_name: string | null;
  patient_dob: string | null;
  member_id: string | null;
  payer_name: string | null;
  provider_name: string | null;
  provider_npi: string | null;
  tax_id: string | null;
  cpt_codes: string | null;
  service_type: string | null;
  date_of_service: string | null;
  policy_active: string | null;
  plan_type: string | null;
  effective_date: string | null;
  network_status: string | null;
  individual_deductible_total: string | null;
  individual_deductible_met: string | null;
  individual_deductible_remaining: string | null;
  family_deductible_total: string | null;
  family_deductible_met: string | null;
  family_deductible_remaining: string | null;
  individual_oop_total: string | null;
  individual_oop_met: string | null;
  individual_oop_remaining: string | null;
  family_oop_total: string | null;
  family_oop_met: string | null;
  family_oop_remaining: string | null;
  copay: string | null;
  coinsurance: string | null;
  deductible_applies: string | null;
  cpt_coverage: string | null;
  cpt_limitations: string | null;
  visit_limit: string | null;
  visits_used: string | null;
  visits_remaining: string | null;
  prior_auth_required: string | null;
  auth_method: string | null;
  referral_required: string | null;
  claims_mailing_address: string | null;
  electronic_payer_id: string | null;
  representative_name: string | null;
  call_reference_number: string | null;
  status: string | null;
  notes: string | null;
  field_confidence: Record<string, FieldConfidence>;
};

export type VobExtractionSnapshot = {
  call_id: string;
  event: "transcript_updated" | "call_ended";
  mode: ExtractionMode;
  extracted_at: string;
  transcript_length: number;
  extraction: ExtractedVobData;
};
