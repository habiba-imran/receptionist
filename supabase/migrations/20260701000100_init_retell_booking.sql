create extension if not exists pgcrypto with schema extensions;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  call_id text not null unique,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  call_started_at timestamp with time zone,
  representative text not null default 'Layla (AI)',
  practice text not null default 'Awaaz Labs Cardiology',
  patient_acct text,
  assigned_doctor text not null default 'Dr. Adeel Rahman',
  language text,
  contact_number text,
  whatsapp_suitable boolean,
  first_name text,
  full_legal_name text,
  dob date,
  gender text,
  mailing_address text,
  callback_number text,
  email text,
  reason text,
  appointment_text text,
  appointment_at timestamp with time zone,
  patient_status text,
  patient_status_unverified boolean default false,
  insurance_status text default 'pending',
  payer_name text,
  member_id text,
  group_number text,
  plan_type text,
  payer_id text,
  customer_service_number text,
  provider_name text,
  npi text,
  tax_id text,
  cpt_codes text,
  date_of_service date,
  patient_is_subscriber boolean,
  subscriber_name text,
  subscriber_dob date,
  subscriber_relationship text,
  subscriber_employer text,
  has_secondary boolean,
  secondary_payer text,
  secondary_member_id text,
  primary_plan text,
  plan_change_this_year boolean,
  plan_change_details text,
  referring_provider text,
  prior_auth boolean,
  prior_auth_number text,
  seen_other_provider text,
  notes text,
  intake_method text default 'voice',
  form_status text default 'not_sent',
  source text default 'voice',
  needs_review boolean default false,
  review_reasons text[] not null default '{}'::text[],
  triage_flag text default 'none',
  transfer_initiated boolean default false,
  confirmation_status text default 'pending',
  confirmation_channel text,
  transcript text,
  call_summary text,
  recording_url text,
  raw_payload jsonb
);

create table if not exists public.message_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamp with time zone not null default now(),
  call_id text,
  booking_id uuid references public.bookings(id),
  purpose text,
  channel text,
  provider text,
  to_number text,
  body text,
  status text,
  provider_message_id text,
  error text
);

create index if not exists bookings_created_at_idx
  on public.bookings (created_at desc);

create index if not exists bookings_contact_number_idx
  on public.bookings (contact_number);

create index if not exists bookings_confirmation_status_idx
  on public.bookings (confirmation_status);

create index if not exists bookings_form_status_idx
  on public.bookings (form_status);

create index if not exists bookings_needs_review_idx
  on public.bookings (needs_review);

create index if not exists message_log_booking_id_idx
  on public.message_log (booking_id);

create index if not exists message_log_call_id_idx
  on public.message_log (call_id);

create index if not exists message_log_created_at_idx
  on public.message_log (created_at desc);

drop trigger if exists bookings_set_updated_at on public.bookings;

create trigger bookings_set_updated_at
before update on public.bookings
for each row
execute function public.set_updated_at();

