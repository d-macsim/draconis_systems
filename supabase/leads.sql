-- Supabase schema for lead backup persistence
create table if not exists public.leads (
  id bigserial primary key,
  lead_id uuid not null unique,
  submitted_at timestamptz not null default now(),
  ip text,
  mode text not null,
  name text not null,
  email text not null,
  phone text,
  company text,
  budget text,
  timeline text,
  message text not null,
  build_selection jsonb,
  email_sent boolean not null default false
);

create index if not exists leads_submitted_at_idx on public.leads (submitted_at desc);
create index if not exists leads_email_idx on public.leads (email);
