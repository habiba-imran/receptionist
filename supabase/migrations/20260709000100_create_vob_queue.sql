create table if not exists public.vob_queue (
  id uuid primary key default gen_random_uuid(),
  call_id text not null unique,
  verification_id text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  queued_at timestamp with time zone not null default now(),
  last_extracted_at timestamp with time zone,
  priority_position integer,
  priority_score integer not null default 0,
  queue_ready boolean not null default false,
  ready_at timestamp with time zone,
  missing_required_fields text[] not null default '{}'::text[],
  status text not null default 'collecting',
  assigned_to text,
  practice_name text,
  patient_full_name text,
  patient_dob date,
  member_id text,
  payer_name text,
  provider_name text,
  provider_npi text,
  tax_id text,
  cpt_codes text,
  service_type text,
  date_of_service date,
  policy_active text,
  plan_type text,
  effective_date text,
  network_status text,
  individual_deductible_total text,
  individual_deductible_met text,
  individual_deductible_remaining text,
  family_deductible_total text,
  family_deductible_met text,
  family_deductible_remaining text,
  individual_oop_total text,
  individual_oop_met text,
  individual_oop_remaining text,
  family_oop_total text,
  family_oop_met text,
  family_oop_remaining text,
  copay text,
  coinsurance text,
  deductible_applies text,
  cpt_coverage text,
  cpt_limitations text,
  visit_limit text,
  visits_used text,
  visits_remaining text,
  prior_auth_required text,
  auth_method text,
  referral_required text,
  claims_mailing_address text,
  electronic_payer_id text,
  representative_name text,
  call_reference_number text,
  notes text,
  needs_review boolean not null default false,
  review_reasons text[] not null default '{}'::text[],
  transcript text,
  call_summary text,
  recording_url text,
  raw_payload jsonb
);

create index if not exists vob_queue_priority_position_idx
  on public.vob_queue (priority_position nulls last, created_at asc);

create index if not exists vob_queue_status_idx
  on public.vob_queue (status);

create index if not exists vob_queue_verification_id_idx
  on public.vob_queue (verification_id);

create index if not exists vob_queue_payer_name_idx
  on public.vob_queue (payer_name);

drop trigger if exists vob_queue_set_updated_at on public.vob_queue;

create trigger vob_queue_set_updated_at
before update on public.vob_queue
for each row
execute function public.set_updated_at();
