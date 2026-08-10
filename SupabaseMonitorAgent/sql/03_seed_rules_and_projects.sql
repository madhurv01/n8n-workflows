-- =====================================================================
-- 03_seed_rules_and_projects.sql   (run on the CENTRAL project)
-- Default global rule set + example project registration.
-- Every rule here is optional: the workflow ships with the same values
-- as built-in defaults, so rows in mon_rules act as OVERRIDES.
-- Specificity wins: column > table > project > global, then priority.
-- =====================================================================

-- ---------------------------------------------------------------------
-- A. Register the project being monitored (NO KEYS HERE — the key lives
--    in the "Monitor Config" node in n8n). Single-project mode: this row's
--    `url` should just be this same project's URL.
-- ---------------------------------------------------------------------
insert into monitoring.mon_projects (code, name, url, schemas, config) values
  ('prod',    'Production',  'https://REPLACE_ME.supabase.co', array['public'],
              '{"max_tables":200,"exact_count_max":5000000}'::jsonb)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------
-- B. Global defaults
-- ---------------------------------------------------------------------
insert into monitoring.mon_rules
  (rule_name, check_type, scope, thresholds, severity, priority, recommendation) values

('Empty table',              'empty_table',        'global', '{}', 'LOW', 0,
 'Confirm the table is intentionally empty or that its writer is running.'),

('Row count drop',           'row_count_drop',     'global',
 '{"warn_pct":5,"high_pct":20,"critical_pct":50,"min_rows":50}', 'HIGH', 0,
 'Investigate deletes, a failed migration, or an accidental truncate.'),

('Row count spike',          'row_count_spike',    'global',
 '{"warn_pct":100,"high_pct":500,"min_rows":100}', 'MEDIUM', 0,
 'Check for duplicate ingestion or a runaway backfill job.'),

('Table growth (size)',      'table_size_growth',  'global',
 '{"warn_pct":50,"high_pct":200,"min_bytes":10485760}', 'LOW', 0,
 'Review retention policy, large payload columns, and index bloat.'),

('High NULL percentage',     'null_percentage',    'global',
 '{"warn_pct":30,"high_pct":60,"critical_pct":90,"min_rows":100}', 'MEDIUM', 0,
 'Confirm the column is optional; consider a NOT NULL constraint or a default.'),

('Rising NULL rate',         'null_rate_increase', 'global',
 '{"warn_delta_pct":5,"high_delta_pct":15,"min_rows":100}', 'HIGH', 0,
 'A writer likely stopped populating this column. Check recent deploys.'),

('Duplicate values',         'duplicate_values',   'global',
 '{"warn_pct":1,"high_pct":10,"min_rows":50}', 'MEDIUM', 0,
 'Deduplicate and add a UNIQUE index if the column should be unique.'),

('Unique column violated',   'unique_like_duplicates','global',
 '{"min_rows":1}', 'HIGH', 0,
 'This column looks like a natural key (email/slug/uuid) but has duplicates.'),

('Orphaned records',         'orphaned_records',   'global',
 '{"warn_count":1,"high_count":100,"critical_count":1000}', 'HIGH', 0,
 'Clean up orphans and verify ON DELETE behaviour on the foreign key.'),

('Missing relationship',     'missing_foreign_key','global', '{}', 'LOW', 0,
 'Column looks like a foreign key but has no FK constraint. Add one to protect integrity.'),

('Empty / sentinel strings', 'empty_string_values','global',
 '{"warn_pct":2,"high_pct":15,"min_rows":50}', 'LOW', 0,
 'Normalise empty strings and literal "null"/"N/A" values to real NULLs.'),

('Future timestamps',        'future_timestamps',  'global',
 '{"warn_count":1,"high_count":50}', 'HIGH', 0,
 'Clock skew or bad client input. Validate timestamps server-side.'),

('Ancient timestamps',       'invalid_timestamps', 'global',
 '{"warn_count":1,"high_count":100}', 'MEDIUM', 0,
 'Rows dated before 1980 usually mean an epoch/parse bug.'),

('updated_at before created_at','timestamp_inconsistency','global',
 '{"warn_count":1,"high_count":50}', 'HIGH', 0,
 'Fix the trigger/application code that maintains updated_at.'),

('Data freshness',           'data_freshness',     'global',
 '{"warn_minutes":120,"high_minutes":720,"critical_minutes":2880}', 'HIGH', 0,
 'No recent rows. Check the ingestion pipeline, queue workers and cron jobs.'),

('Ingestion stopped',        'ingestion_inactivity','global',
 '{"expect_rows_24h":1}', 'HIGH', 0,
 'Zero inserts in the last 24h for a normally-active table.'),

('Ingestion rate drop',      'ingestion_drop',     'global',
 '{"warn_pct":40,"high_pct":70,"critical_pct":90,"min_baseline":20}', 'HIGH', 0,
 'Throughput fell versus the previous run. Inspect producers and rate limits.'),

('Ingestion rate spike',     'ingestion_spike',    'global',
 '{"warn_pct":200,"high_pct":500,"min_baseline":20}', 'MEDIUM', 0,
 'Unusual write volume: possible retry storm, bot traffic or duplicate publisher.'),

('Schema change',            'schema_change',      'global', '{}', 'MEDIUM', 0,
 'Verify the change was intentional and that dependent clients were updated.'),

('Column removed',           'column_removed',     'global', '{}', 'CRITICAL', 0,
 'Dropping a column is breaking. Confirm it was planned and coordinated.'),

('Column type changed',      'column_type_changed','global', '{}', 'HIGH', 0,
 'Type changes break clients and can silently truncate data.'),

('Table disappeared',        'table_removed',      'global', '{}', 'CRITICAL', 0,
 'A previously monitored table is gone. Confirm it was intentional.'),

('Invalid index',            'invalid_index',      'global', '{}', 'HIGH', 0,
 'REINDEX the index: a concurrent build probably failed.'),

('Unused index',             'unused_index',       'global',
 '{"min_size_bytes":10485760,"max_scans":0}', 'LOW', 0,
 'Large index never used. Consider dropping it to reclaim space and write speed.'),

('Missing index on FK',      'missing_fk_index',   'global',
 '{"min_rows":10000}', 'MEDIUM', 0,
 'Add an index on the foreign key column to avoid slow joins and lock waits.'),

('Table bloat (dead rows)',  'table_bloat',        'global',
 '{"warn_pct":20,"high_pct":40,"min_rows":10000}', 'MEDIUM', 0,
 'Run VACUUM (ANALYZE) and review autovacuum settings for this table.'),

('Sequential scan heavy',    'seq_scan_heavy',     'global',
 '{"min_rows":50000,"min_seq_scans":1000,"max_idx_ratio":0.1}', 'MEDIUM', 0,
 'Add supporting indexes for the most common query predicates.'),

('Stale statistics',         'stale_statistics',   'global',
 '{"warn_days":7,"high_days":30}', 'LOW', 0,
 'Run ANALYZE so the planner has fresh statistics.'),

('Project collection failed','project_unreachable','global', '{}', 'CRITICAL', 0,
 'Check the project URL, service_role key, and that mon_collect is installed.')

on conflict do nothing;

-- ---------------------------------------------------------------------
-- C. Example overrides (delete or adapt)
-- ---------------------------------------------------------------------

-- events table on prod must never be stale for more than 10 minutes
insert into monitoring.mon_rules
 (rule_name, check_type, scope, project_code, schema_name, table_name,
  thresholds, severity, priority, recommendation)
values
 ('Events must be near-realtime','data_freshness','table','prod','public','events',
  '{"warn_minutes":10,"high_minutes":30,"critical_minutes":60}','CRITICAL',10,
  'Events feed is the core pipeline — page the on-call engineer.');

-- users.email must be unique-ish and never NULL
insert into monitoring.mon_rules
 (rule_name, check_type, scope, project_code, schema_name, table_name, column_name,
  thresholds, severity, priority, recommendation)
values
 ('users.email uniqueness','duplicate_values','column','prod','public','users','email',
  '{"warn_pct":0,"high_pct":0,"critical_pct":0.5,"min_rows":1}','CRITICAL',10,
  'Duplicate emails break login. Deduplicate and enforce a unique index.'),
 ('users.email not null','null_percentage','column','prod','public','users','email',
  '{"warn_pct":0,"high_pct":1,"critical_pct":5,"min_rows":1}','HIGH',10,
  'Email should always be populated.');

-- Pattern-based: any *_audit table may be huge, relax growth alerts
insert into monitoring.mon_rules
 (rule_name, check_type, scope, table_pattern, thresholds, severity, priority)
values
 ('Audit tables grow fast','table_size_growth','global','.*_(audit|log|logs|events)$',
  '{"warn_pct":300,"high_pct":1000,"min_bytes":104857600}','INFO',5);
