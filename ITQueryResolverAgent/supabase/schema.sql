-- =========================================================
-- IT Support System — Supabase Schema
-- =========================================================
-- Run this in the Supabase SQL editor (or via `supabase db push`).

create extension if not exists "uuid-ossp";
create extension if not exists pgcrypto;

-- ---------------------------------------------------------
-- Enums
-- ---------------------------------------------------------
do $$ begin
  create type ticket_status as enum ('Open', 'In Progress', 'Resolved', 'Closed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type ticket_priority as enum ('Low', 'Medium', 'High', 'Critical');
exception when duplicate_object then null; end $$;

do $$ begin
  create type ticket_category as enum (
    'Hardware', 'Software', 'Network', 'Access/Account',
    'Security', 'Infrastructure', 'Email', 'Other'
  );
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------
-- Sequence-based human-readable ticket IDs, e.g. TCK-100234
-- ---------------------------------------------------------
create sequence if not exists ticket_id_seq start 100001;

create or replace function generate_ticket_code()
returns text language sql as $$
  select 'TCK-' || nextval('ticket_id_seq')::text;
$$;

-- ---------------------------------------------------------
-- tickets
-- ---------------------------------------------------------
create table if not exists public.tickets (
  id                 uuid primary key default gen_random_uuid(),
  ticket_code        text unique not null default generate_ticket_code(),

  -- requester
  name               text not null,
  email              text not null,
  department         text not null,

  -- request
  category           ticket_category not null,
  priority           ticket_priority not null default 'Medium',
  subject            text not null,
  description        text not null,
  attachment_url      text,               -- Supabase Storage public/signed URL

  -- lifecycle
  status             ticket_status not null default 'Open',

  -- AI enrichment (filled in by n8n after Gemini analysis)
  ai_summary         text,
  ai_severity        text,
  ai_recommended_team text,
  ai_classification  text,
  jira_required      boolean default false,
  jira_issue_key     text,
  report_url         text,               -- plain-text incident report in Storage

  -- audit
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists idx_tickets_email on public.tickets (email);
create index if not exists idx_tickets_status on public.tickets (status);
create index if not exists idx_tickets_created_at on public.tickets (created_at desc);

-- keep updated_at fresh
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_tickets_updated_at on public.tickets;
create trigger trg_tickets_updated_at
before update on public.tickets
for each row execute function set_updated_at();

-- ---------------------------------------------------------
-- workflow_logs — structured logging for the n8n automation
-- ---------------------------------------------------------
create table if not exists public.workflow_logs (
  id            bigint generated always as identity primary key,
  ticket_id     uuid references public.tickets(id) on delete cascade,
  step          text not null,          -- e.g. 'ai_analysis', 'jira_create', 'report_upload', 'email_send', 'telegram_send'
  status        text not null,          -- 'success' | 'error' | 'retry' | 'skipped'
  detail        jsonb,
  created_at    timestamptz not null default now()
);

create index if not exists idx_logs_ticket on public.workflow_logs (ticket_id);

-- ---------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------
-- No login is used by the frontend (per current design), so tickets are
-- created and read using the anon key. We scope reads to "your own email"
-- via a request header the frontend sets, and keep inserts open but validated.
-- If you later add Supabase Auth, swap these policies for auth.uid()-based ones.

alter table public.tickets enable row level security;
alter table public.workflow_logs enable row level security;

-- Anyone (anon) can create a ticket.
drop policy if exists "tickets_insert_anon" on public.tickets;
create policy "tickets_insert_anon"
  on public.tickets for insert
  to anon
  with check (true);

-- Anyone can read tickets filtered client-side by email (no login = no server-side
-- identity, so this is intentionally permissive at the row level; the frontend only
-- ever queries `where email = eq.<their email>`). For stricter isolation, add
-- Supabase Auth and switch to `auth.jwt() ->> 'email' = email`.
drop policy if exists "tickets_select_anon" on public.tickets;
create policy "tickets_select_anon"
  on public.tickets for select
  to anon
  using (true);

-- Only the service role (used by n8n) can update tickets (AI fields, jira key, status).
drop policy if exists "tickets_update_service" on public.tickets;
create policy "tickets_update_service"
  on public.tickets for update
  to service_role
  using (true) with check (true);

-- Logs are written only by the service role (n8n); not exposed to the frontend.
drop policy if exists "logs_service_all" on public.workflow_logs;
create policy "logs_service_all"
  on public.workflow_logs for all
  to service_role
  using (true) with check (true);

-- ---------------------------------------------------------
-- Storage bucket for ticket attachments + generated .txt incident reports
-- ---------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('ticket-attachments', 'ticket-attachments', true)
on conflict (id) do nothing;

drop policy if exists "attachments_insert_anon" on storage.objects;
create policy "attachments_insert_anon"
  on storage.objects for insert
  to anon
  with check (bucket_id = 'ticket-attachments');

drop policy if exists "attachments_read_public" on storage.objects;
create policy "attachments_read_public"
  on storage.objects for select
  to anon
  using (bucket_id = 'ticket-attachments');

drop policy if exists "attachments_service_all" on storage.objects;
create policy "attachments_service_all"
  on storage.objects for all
  to service_role
  using (bucket_id = 'ticket-attachments');

-- ---------------------------------------------------------
-- Database Webhook (configure in Supabase Dashboard -> Database -> Webhooks)
-- ---------------------------------------------------------
-- Table: tickets | Events: INSERT | Type: HTTP Request
-- URL: <your n8n webhook URL>/webhook/ticket-created
-- This is what triggers the n8n workflow — no code needed here, it's a
-- dashboard-configured webhook, but documented here for completeness.
