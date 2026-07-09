alter table public.vob_queue
  add column if not exists queue_ready boolean not null default false,
  add column if not exists ready_at timestamp with time zone,
  add column if not exists missing_required_fields text[] not null default '{}'::text[];

create index if not exists vob_queue_ready_priority_idx
  on public.vob_queue (queue_ready, priority_position nulls last, created_at asc);
