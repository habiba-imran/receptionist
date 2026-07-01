export interface Booking {
  id: string;
  call_id: string;
  created_at: string;
  call_started_at: string;
  representative: string;
  practice: string;
  assigned_doctor: string;
  language: string;
  contact_number: string;
  whatsapp_suitable: boolean;
  first_name: string;
  full_legal_name: string;
  dob: string;
  reason: string;
  appointment_text: string;
  appointment_at: string;
  patient_status: string;
  patient_status_unverified: boolean;
  insurance_status: string;
  payer_name: string | null;
  member_id: string | null;
  group_number: string | null;
  plan_type: string | null;
  payer_id: string | null;
  provider_name: string;
  npi: string;
  tax_id: string;
  cpt_codes: string[];
  date_of_service: string;
  patient_is_subscriber: boolean;
  subscriber_name: string | null;
  subscriber_dob: string | null;
  subscriber_relationship: string | null;
  has_secondary: boolean;
  secondary_payer: string | null;
  secondary_member_id: string | null;
  primary_plan: boolean;
  referring_provider: string | null;
  prior_auth: boolean;
  prior_auth_number: string | null;
  seen_other_provider: boolean;
  notes: string | null;
  intake_method: string;
  form_status: string;
  source: string;
  needs_review: boolean;
  review_reasons: string[];
  triage_flag: string | null;
  transfer_initiated: boolean;
  confirmation_status: string;
  transcript: string;
  call_summary: string;
  recording_url: string | null;
}

export const mockBookings: Booking[] = [
  {
    id: "bkg_001",
    call_id: "call_a1b2c3d4",
    created_at: "2026-06-30T14:30:00Z",
    call_started_at: "2026-06-30T14:25:00Z",
    representative: "Retell Cardiology Agent",
    practice: "HeartCare Associates",
    assigned_doctor: "Dr. Adeel Rahman",
    language: "en",
    contact_number: "+15551234567",
    whatsapp_suitable: false,
    first_name: "John",
    full_legal_name: "Johnathan Doe",
    dob: "1965-04-12",
    reason: "Experiencing occasional chest pain and shortness of breath during exercise.",
    appointment_text: "Monday, July 6th at 10:00 AM",
    appointment_at: "2026-07-06T10:00:00Z",
    patient_status: "new",
    patient_status_unverified: true,
    insurance_status: "pending_verification",
    payer_name: "Blue Cross Blue Shield",
    member_id: "BCBS987654321",
    group_number: "GRP12345",
    plan_type: "PPO",
    payer_id: "00123",
    provider_name: "Dr. Adeel Rahman",
    npi: "1234567890",
    tax_id: "99-9999999",
    cpt_codes: ["99203", "93000"],
    date_of_service: "2026-07-06",
    patient_is_subscriber: true,
    subscriber_name: "Johnathan Doe",
    subscriber_dob: "1965-04-12",
    subscriber_relationship: "self",
    has_secondary: false,
    secondary_payer: null,
    secondary_member_id: null,
    primary_plan: true,
    referring_provider: "Dr. Sarah Smith",
    prior_auth: false,
    prior_auth_number: null,
    seen_other_provider: false,
    notes: "Patient seemed anxious about the symptoms. Needs an EKG upon arrival.",
    intake_method: "voice",
    form_status: "not_sent",
    source: "inbound_call",
    needs_review: true,
    review_reasons: ["triage_flag", "insurance_unverified"],
    triage_flag: "urgent - chest pain",
    transfer_initiated: false,
    confirmation_status: "pending",
    transcript: "Agent: Hello, HeartCare Associates, how can I help you today?\nCaller: Hi, I need to see a doctor. I've been having some chest pain when I jog.\nAgent: I understand, that sounds concerning. Are you currently experiencing severe pain or shortness of breath right now? If so, please hang up and dial 911.\nCaller: No, not right now. Just when I exercise.\nAgent: Okay, let's get you scheduled. Can I have your full legal name and date of birth?",
    call_summary: "Patient called reporting exertional chest pain. Denied acute distress. Scheduled for early evaluation. Gathered BCBS insurance info.",
    recording_url: "https://example.com/recording/call_a1b2c3d4.mp3"
  },
  {
    id: "bkg_002",
    call_id: "call_e5f6g7h8",
    created_at: "2026-07-01T09:15:00Z",
    call_started_at: "2026-07-01T09:10:00Z",
    representative: "Retell Cardiology Agent",
    practice: "HeartCare Associates",
    assigned_doctor: "Dr. Adeel Rahman",
    language: "en",
    contact_number: "+15559876543",
    whatsapp_suitable: true,
    first_name: "Maria",
    full_legal_name: "Maria Garcia",
    dob: "1980-11-25",
    reason: "Routine follow-up for hypertension.",
    appointment_text: "Thursday, July 9th at 2:30 PM",
    appointment_at: "2026-07-09T14:30:00Z",
    patient_status: "existing",
    patient_status_unverified: false,
    insurance_status: "verified",
    payer_name: "Aetna",
    member_id: "W123456789",
    group_number: "AET999",
    plan_type: "HMO",
    payer_id: "22334",
    provider_name: "Dr. Adeel Rahman",
    npi: "1234567890",
    tax_id: "99-9999999",
    cpt_codes: ["99213"],
    date_of_service: "2026-07-09",
    patient_is_subscriber: false,
    subscriber_name: "Carlos Garcia",
    subscriber_dob: "1978-02-14",
    subscriber_relationship: "spouse",
    has_secondary: false,
    secondary_payer: null,
    secondary_member_id: null,
    primary_plan: true,
    referring_provider: null,
    prior_auth: false,
    prior_auth_number: null,
    seen_other_provider: false,
    notes: "Patient requested afternoon appointment.",
    intake_method: "form",
    form_status: "sent",
    source: "inbound_call",
    needs_review: false,
    review_reasons: [],
    triage_flag: null,
    transfer_initiated: false,
    confirmation_status: "sent",
    transcript: "Agent: Thank you for calling HeartCare. How may I assist you?\nCaller: I need to schedule my 6-month follow-up for my blood pressure.\nAgent: Sure, I can help with that. Is this Maria?\nCaller: Yes.\nAgent: Great, Maria. I have you down for Dr. Rahman. Does next Thursday afternoon work?",
    call_summary: "Routine 6-month hypertension follow-up scheduled. Insurance remains Aetna. SMS intake form link sent.",
    recording_url: "https://example.com/recording/call_e5f6g7h8.mp3"
  }
];
