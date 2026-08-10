# Database schema — `ev_news_alerts`

Supabase project: **IT support system** (`ybunskailwpawhcdzhns`), schema `public`.

## Table definition

```sql
create table public.ev_news_alerts (
  id bigint generated always as identity primary key,
  title text not null,
  url text not null,
  category text not null check (category in ('scooter', 'bike', 'car')),
  summary text,
  jira_ticket_key text,
  created_at timestamptz not null default now(),
  execution_id text
);

alter table public.ev_news_alerts
  add constraint ev_news_alerts_url_unique unique (url);

alter table public.ev_news_alerts enable row level security;

create policy "Service role full access"
  on public.ev_news_alerts
  for all
  to service_role
  using (true)
  with check (true);
```

## Column reference

| Column | Type | Notes |
|---|---|---|
| `id` | `bigint identity` | Primary key |
| `title` | `text` | News headline, copied verbatim from the RSS feed by the AI Agent |
| `url` | `text` | Real article URL — **unique**, this is the dedup key |
| `category` | `text` | One of `scooter` / `bike` / `car`, enforced by `CHECK`; normalized by the `Normalize Category` node before insert |
| `summary` | `text` | AI-generated summary (≤30 words) |
| `jira_ticket_key` | `text` | Backfilled after the Jira ticket is created for this run; `null` until then |
| `created_at` | `timestamptz` | Defaults to `now()` |
| `execution_id` | `text` | The n8n execution ID that inserted this row — lets `Update Rows With Jira Key` target exactly this run's rows |

## Why the unique constraint on `url`

This is the entire deduplication mechanism. `Insert News Row` has `onError: continueRegularOutput` set, so when an article's URL has already been stored by a previous run, the insert fails on the constraint and that one row is silently skipped — the rest of the workflow (report, Jira ticket, email) is unaffected. See `01-architecture.md` for why a workflow-level lookup was tried first and rejected (it deadlocked on an empty table).

## Row Level Security

RLS is enabled with a single policy granting full access to `service_role` only. This is why the n8n Supabase credential must use the **service_role key**, not the anon/publishable key — see `03-credentials.md`.
