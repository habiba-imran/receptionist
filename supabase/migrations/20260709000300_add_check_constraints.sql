alter table public.bookings
  add constraint bookings_language_check
  check (language is null or lower(language) in ('en', 'es')) not valid,
  add constraint bookings_patient_status_check
  check (patient_status is null or patient_status in ('new', 'existing', 'unknown')) not valid,
  add constraint bookings_insurance_status_check
  check (insurance_status is null or insurance_status in ('covered', 'partial', 'pending', 'unknown', 'self_pay', 'pending_form')) not valid,
  add constraint bookings_intake_method_check
  check (intake_method is null or intake_method in ('voice', 'form')) not valid,
  add constraint bookings_primary_plan_check
  check (primary_plan is null or primary_plan in ('primary_current', 'primary_other', 'unknown')) not valid,
  add constraint bookings_referring_provider_check
  check (referring_provider is null or referring_provider in ('yes', 'no', 'unknown')) not valid,
  add constraint bookings_seen_other_provider_check
  check (seen_other_provider is null or seen_other_provider in ('yes', 'no', 'unknown')) not valid,
  add constraint bookings_triage_flag_check
  check (triage_flag is null or triage_flag in ('none', 'chest_pain_low', 'chest_pain_high', 'urgent_emergency')) not valid,
  add constraint bookings_form_status_check
  check (form_status is null or form_status in ('not_sent', 'sent', 'submitted', 'failed', 'skipped_incomplete')) not valid,
  add constraint bookings_confirmation_status_check
  check (confirmation_status is null or confirmation_status in ('pending', 'sent', 'failed', 'skipped_incomplete')) not valid;

alter table public.vob_queue
  add constraint vob_queue_status_check
  check (status in ('collecting', 'in_progress', 'verified', 'partial_coverage', 'needs_authorization', 'needs_referral', 'not_covered', 'inactive_policy', 'unable_to_verify', 'retry_needed', 'failed_call', 'missing_information')) not valid,
  add constraint vob_queue_priority_score_check
  check (priority_score >= 0) not valid,
  add constraint vob_queue_priority_position_check
  check (priority_position is null or priority_position > 0) not valid,
  add constraint vob_queue_queue_ready_check
  check (queue_ready = (coalesce(array_length(missing_required_fields, 1), 0) = 0)) not valid;