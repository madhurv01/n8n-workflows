-- =====================================================================
-- 01_central_store.sql
-- Run this ONCE on the CENTRAL Supabase project (the monitoring store).
-- Creates: config tables, rules engine tables, history tables,
--          and two RPCs used by n8n (mon_bootstrap / mon_persist_run).
-- =====================================================================

create schema if not exists monitoring;

-- ---------------------------------------------------------------------
-- 1. PROJECT REGISTRY  (NO SECRETS STORED HERE - keys live in n8n env)
-- ---------------------------------------------------------------------
create table if not exists monitoring.mon_projects (
  id            bigserial primary key,
  code          text unique not null,          -- must match key in MON_KEYS env json
  name          text not null,
  url           text not null,                 -- https://xxxx.supabase.co
  enabled       boolean not null default true,
  schemas       text[] not null default array['public'],
  config        jsonb  not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);
comment on column monitoring.mon_projects.config is
  'Per-project overrides, e.g. {"max_tables":300,"exact_count_max":2000000}';

-- ---------------------------------------------------------------------
-- 2. REUSABLE MONITORING RULES
--    scope: global | project | table | column
--    More specific scope wins. Ties broken by priority (higher wins).
-- ---------------------------------------------------------------------
create table if not exists monitoring.mon_rules (
  id            bigserial primary key,
  rule_name     text not null,
  check_type    text not null,      -- see docs/CHECKS.md
  scope         text not null default 'global'
                 check (scope in ('global','project','table','column')),
  project_code  text,
  schema_name   text,
  table_name    text,
  column_name   text,
  -- Optional pattern targeting: applies rule to any table/column matching regex
  table_pattern  text,
  column_pattern text,
  thresholds    jsonb not null default '{}'::jsonb,
  severity      text not null default 'MEDIUM'
                 check (severity in ('INFO','LOW','MEDIUM','HIGH','CRITICAL')),
  enabled       boolean not null default true,
  priority      int not null default 0,
  recommendation text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_mon_rules_lookup
  on monitoring.mon_rules (enabled, check_type, scope, project_code);

-- ---------------------------------------------------------------------
-- 3. RUN HISTORY
-- ---------------------------------------------------------------------
create table if not exists monitoring.mon_runs (
  id                 uuid primary key,
  started_at         timestamptz not null,
  finished_at        timestamptz not null default now(),
  duration_ms        bigint,
  status             text not null default 'SUCCESS',
  projects_total     int default 0,
  projects_ok        int default 0,
  projects_failed    int default 0,
  tables_scanned     int default 0,
  columns_scanned    int default 0,
  checks_performed   int default 0,
  issues_found       int default 0,
  critical_count     int default 0,
  high_count         int default 0,
  avg_health_score   numeric(5,2),
  report_text        text,
  summary            jsonb not null default '{}'::jsonb
);
create index if not exists idx_mon_runs_started on monitoring.mon_runs (started_at desc);

create table if not exists monitoring.mon_project_runs (
  id            bigserial primary key,
  run_id        uuid not null references monitoring.mon_runs(id) on delete cascade,
  project_code  text not null,
  project_name  text,
  status        text not null,                -- SUCCESS | FAILED
  error_message text,
  health_score  numeric(5,2),
  health_grade  text,
  tables_scanned int default 0,
  checks_performed int default 0,
  issues_found  int default 0,
  stats         jsonb not null default '{}'::jsonb,
  captured_at   timestamptz not null default now()
);
create index if not exists idx_mon_project_runs on monitoring.mon_project_runs (project_code, captured_at desc);

-- ---------------------------------------------------------------------
-- 4. METRIC HISTORY  (the time-series used for trend / anomaly detection)
-- ---------------------------------------------------------------------
create table if not exists monitoring.mon_metrics (
  id            bigserial primary key,
  run_id        uuid not null references monitoring.mon_runs(id) on delete cascade,
  project_code  text not null,
  schema_name   text not null,
  table_name    text not null,
  column_name   text,
  metric        text not null,
  value         numeric,
  meta          jsonb not null default '{}'::jsonb,
  captured_at   timestamptz not null default now()
);
create index if not exists idx_mon_metrics_series
  on monitoring.mon_metrics (project_code, schema_name, table_name, coalesce(column_name,''), metric, captured_at desc);

-- ---------------------------------------------------------------------
-- 5. ALERTS
-- ---------------------------------------------------------------------
create table if not exists monitoring.mon_alerts (
  id             bigserial primary key,
  run_id         uuid not null references monitoring.mon_runs(id) on delete cascade,
  project_code   text not null,
  severity       text not null check (severity in ('INFO','LOW','MEDIUM','HIGH','CRITICAL')),
  check_type     text not null,
  rule_name      text,
  schema_name    text,
  table_name     text,
  column_name    text,
  message        text not null,
  current_value  numeric,
  previous_value numeric,
  threshold_value numeric,
  change_pct     numeric,
  trend          text,
  explanation    text,
  recommendation text,
  details        jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);
create index if not exists idx_mon_alerts_run on monitoring.mon_alerts (run_id);
create index if not exists idx_mon_alerts_sev on monitoring.mon_alerts (project_code, severity, created_at desc);

-- ---------------------------------------------------------------------
-- 6. SCHEMA SNAPSHOTS (for schema-drift detection)
-- ---------------------------------------------------------------------
create table if not exists monitoring.mon_schema_snapshots (
  id            bigserial primary key,
  run_id        uuid not null references monitoring.mon_runs(id) on delete cascade,
  project_code  text not null,
  schema_name   text not null,
  table_name    text not null,
  fingerprint   text not null,
  columns       jsonb not null default '[]'::jsonb,
  indexes       jsonb not null default '[]'::jsonb,
  captured_at   timestamptz not null default now()
);
create index if not exists idx_mon_schema_snap
  on monitoring.mon_schema_snapshots (project_code, schema_name, table_name, captured_at desc);

-- ---------------------------------------------------------------------
-- 7. RLS: locked down. service_role (used by n8n) bypasses RLS.
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['mon_projects','mon_rules','mon_runs','mon_project_runs',
                           'mon_metrics','mon_alerts','mon_schema_snapshots']
  loop
    execute format('alter table monitoring.%I enable row level security', t);
  end loop;
end $$;

-- Expose the schema to PostgREST (also add "monitoring" in Dashboard >
-- Settings > API > Exposed schemas, or keep everything via RPC below).
grant usage on schema monitoring to service_role;
grant all on all tables in schema monitoring to service_role;
grant all on all sequences in schema monitoring to service_role;

-- =====================================================================
-- 8. RPC: mon_bootstrap()
--    ONE call returns everything n8n needs to start a run:
--    enabled projects + rules + previous metric values + previous schema.
-- =====================================================================
create or replace function public.mon_bootstrap(p_project_codes text[] default null)
returns jsonb
language sql
security definer
set search_path = monitoring, public, pg_catalog
as $$
  with projects as (
    select jsonb_agg(to_jsonb(p) order by p.code) as v
    from monitoring.mon_projects p
    where p.enabled
      and (p_project_codes is null or p.code = any(p_project_codes))
  ),
  rules as (
    select jsonb_agg(to_jsonb(r) order by r.priority desc, r.id) as v
    from monitoring.mon_rules r where r.enabled
  ),
  last_run as (
    select id, started_at from monitoring.mon_runs
    order by started_at desc limit 1
  ),
  prev_metrics as (
    select jsonb_agg(jsonb_build_object(
             'k', m.project_code||'|'||m.schema_name||'|'||m.table_name||'|'||
                  coalesce(m.column_name,'')||'|'||m.metric,
             'v', m.value,
             'at', m.captured_at,
             'meta', m.meta)) as v
    from (
      select distinct on (project_code, schema_name, table_name, coalesce(column_name,''), metric)
             project_code, schema_name, table_name, column_name, metric, value, meta, captured_at
      from monitoring.mon_metrics
      where captured_at > now() - interval '30 days'
      order by project_code, schema_name, table_name, coalesce(column_name,''), metric, captured_at desc
    ) m
  ),
  prev_schema as (
    select jsonb_agg(jsonb_build_object(
             'k', s.project_code||'|'||s.schema_name||'|'||s.table_name,
             'fingerprint', s.fingerprint,
             'columns', s.columns,
             'at', s.captured_at)) as v
    from (
      select distinct on (project_code, schema_name, table_name)
             project_code, schema_name, table_name, fingerprint, columns, captured_at
      from monitoring.mon_schema_snapshots
      order by project_code, schema_name, table_name, captured_at desc
    ) s
  )
  select jsonb_build_object(
    'projects',      coalesce((select v from projects), '[]'::jsonb),
    'rules',         coalesce((select v from rules), '[]'::jsonb),
    'prev_metrics',  coalesce((select v from prev_metrics), '[]'::jsonb),
    'prev_schema',   coalesce((select v from prev_schema), '[]'::jsonb),
    'last_run_at',   (select started_at from last_run),
    'server_time',   now()
  );
$$;

-- =====================================================================
-- 9. RPC: mon_persist_run(payload jsonb)
--    ONE call writes run + project runs + metrics + alerts + snapshots.
-- =====================================================================
create or replace function public.mon_persist_run(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = monitoring, public, pg_catalog
as $$
declare
  v_run_id uuid := (payload->'run'->>'id')::uuid;
  v_metrics int := 0;
  v_alerts  int := 0;
  v_snaps   int := 0;
begin
  insert into monitoring.mon_runs (
    id, started_at, finished_at, duration_ms, status, projects_total, projects_ok,
    projects_failed, tables_scanned, columns_scanned, checks_performed, issues_found,
    critical_count, high_count, avg_health_score, report_text, summary)
  select v_run_id,
         (r->>'started_at')::timestamptz,
         coalesce((r->>'finished_at')::timestamptz, now()),
         (r->>'duration_ms')::bigint,
         coalesce(r->>'status','SUCCESS'),
         coalesce((r->>'projects_total')::int,0),
         coalesce((r->>'projects_ok')::int,0),
         coalesce((r->>'projects_failed')::int,0),
         coalesce((r->>'tables_scanned')::int,0),
         coalesce((r->>'columns_scanned')::int,0),
         coalesce((r->>'checks_performed')::int,0),
         coalesce((r->>'issues_found')::int,0),
         coalesce((r->>'critical_count')::int,0),
         coalesce((r->>'high_count')::int,0),
         (r->>'avg_health_score')::numeric,
         payload->>'report_text',
         coalesce(r->'summary','{}'::jsonb)
  from jsonb_extract_path(payload,'run') r
  on conflict (id) do update set
     finished_at = excluded.finished_at,
     report_text = excluded.report_text,
     summary     = excluded.summary;

  insert into monitoring.mon_project_runs (
    run_id, project_code, project_name, status, error_message, health_score,
    health_grade, tables_scanned, checks_performed, issues_found, stats)
  select v_run_id, e->>'project_code', e->>'project_name', e->>'status',
         e->>'error_message', (e->>'health_score')::numeric, e->>'health_grade',
         coalesce((e->>'tables_scanned')::int,0),
         coalesce((e->>'checks_performed')::int,0),
         coalesce((e->>'issues_found')::int,0),
         coalesce(e->'stats','{}'::jsonb)
  from jsonb_array_elements(coalesce(payload->'project_runs','[]'::jsonb)) e;

  insert into monitoring.mon_metrics (
    run_id, project_code, schema_name, table_name, column_name, metric, value, meta)
  select v_run_id, e->>'project_code', e->>'schema_name', e->>'table_name',
         nullif(e->>'column_name',''), e->>'metric',
         (e->>'value')::numeric, coalesce(e->'meta','{}'::jsonb)
  from jsonb_array_elements(coalesce(payload->'metrics','[]'::jsonb)) e;
  get diagnostics v_metrics = row_count;

  insert into monitoring.mon_alerts (
    run_id, project_code, severity, check_type, rule_name, schema_name, table_name,
    column_name, message, current_value, previous_value, threshold_value, change_pct,
    trend, explanation, recommendation, details)
  select v_run_id, e->>'project_code', e->>'severity', e->>'check_type', e->>'rule_name',
         e->>'schema_name', e->>'table_name', nullif(e->>'column_name',''), e->>'message',
         (e->>'current_value')::numeric, (e->>'previous_value')::numeric,
         (e->>'threshold_value')::numeric, (e->>'change_pct')::numeric,
         e->>'trend', e->>'explanation', e->>'recommendation',
         coalesce(e->'details','{}'::jsonb)
  from jsonb_array_elements(coalesce(payload->'alerts','[]'::jsonb)) e;
  get diagnostics v_alerts = row_count;

  insert into monitoring.mon_schema_snapshots (
    run_id, project_code, schema_name, table_name, fingerprint, columns, indexes)
  select v_run_id, e->>'project_code', e->>'schema_name', e->>'table_name',
         e->>'fingerprint', coalesce(e->'columns','[]'::jsonb), coalesce(e->'indexes','[]'::jsonb)
  from jsonb_array_elements(coalesce(payload->'schema_snapshots','[]'::jsonb)) e;
  get diagnostics v_snaps = row_count;

  -- retention (keep 180 days of raw metrics)
  delete from monitoring.mon_metrics where captured_at < now() - interval '180 days';

  return jsonb_build_object('run_id', v_run_id, 'metrics', v_metrics,
                            'alerts', v_alerts, 'snapshots', v_snaps);
end $$;

revoke all on function public.mon_bootstrap(text[]) from public, anon, authenticated;
revoke all on function public.mon_persist_run(jsonb) from public, anon, authenticated;
grant execute on function public.mon_bootstrap(text[]) to service_role;
grant execute on function public.mon_persist_run(jsonb) to service_role;
