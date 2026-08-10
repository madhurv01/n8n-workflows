# Check reference

`check_type` is the value you put in `monitoring.mon_rules.check_type`.
`thresholds` is a JSON object; only the keys listed are read. Any key you omit
falls back to the built-in default.

Severity shown is the **default floor**. Crossing a `high_*` threshold escalates
to `HIGH`, crossing a `critical_*` threshold escalates to `CRITICAL`.

## Volume & growth

| check_type | Threshold keys | Default severity | Fires when |
|---|---|---|---|
| `empty_table` | — | LOW | table has zero rows |
| `row_count_drop` | `warn_pct` 5, `high_pct` 20, `critical_pct` 50, `min_rows` 50 | HIGH | row count fell by ≥ warn_pct vs previous run |
| `row_count_spike` | `warn_pct` 100, `high_pct` 500, `min_rows` 100 | MEDIUM | row count grew abnormally |
| `table_size_growth` | `warn_pct` 50, `high_pct` 200, `min_bytes` 10485760 | LOW | physical size grew beyond threshold |

## Column data quality

| check_type | Threshold keys | Default severity | Fires when |
|---|---|---|---|
| `null_percentage` | `warn_pct` 30, `high_pct` 60, `critical_pct` 90, `min_rows` 100 | MEDIUM | NULL share exceeds threshold |
| `null_rate_increase` | `warn_delta_pct` 5, `high_delta_pct` 15, `min_rows` 100 | HIGH | NULL share rose by N percentage points vs last run |
| `duplicate_values` | `warn_pct` 1, `high_pct` 10, `min_rows` 50 | MEDIUM | duplicate ratio among non-NULL values |
| `unique_like_duplicates` | `min_rows` 1 | HIGH | column named like a natural key (email/slug/sku/uuid/token/username/phone/reference/code) has duplicates and no unique index |
| `empty_string_values` | `warn_pct` 2, `high_pct` 15, `min_rows` 50 | LOW | `''`, whitespace-only, or literal `null`/`undefined`/`n/a`/`none` |

## Relationships

| check_type | Threshold keys | Default severity | Fires when |
|---|---|---|---|
| `orphaned_records` | `warn_count` 1, `high_count` 100, `critical_count` 1000 | HIGH | FK value has no matching parent row |
| `missing_foreign_key` | — | LOW | column matches `*_id`, is not a PK, has no FK constraint |
| `missing_fk_index` | `min_rows` 10000 | MEDIUM | FK column is not the leading column of any index |

## Timestamps

| check_type | Threshold keys | Default severity | Fires when |
|---|---|---|---|
| `future_timestamps` | `warn_count` 1, `high_count` 50 | HIGH | value > now() + 1 day |
| `invalid_timestamps` | `warn_count` 1, `high_count` 100 | MEDIUM | value < 1980-01-01 |
| `timestamp_inconsistency` | `warn_count` 1, `high_count` 50 | HIGH | `updated_at` < `created_at` |

## Ingestion & freshness

Applied to "creation clock" columns only: `created_at`, `inserted_at`,
`created_on`, `created`, `timestamp`, `occurred_at`, `event_time`.

| check_type | Threshold keys | Default severity | Fires when |
|---|---|---|---|
| `data_freshness` | `warn_minutes` 120, `high_minutes` 720, `critical_minutes` 2880 | HIGH | newest row is older than threshold |
| `ingestion_inactivity` | `expect_rows_24h` 1 | HIGH | zero rows in 24 h on a table that was active in the last 7 days |
| `ingestion_drop` | `warn_pct` 40, `high_pct` 70, `critical_pct` 90, `min_baseline` 20 | HIGH | 24 h volume fell vs previous run |
| `ingestion_spike` | `warn_pct` 200, `high_pct` 500, `min_baseline` 20 | MEDIUM | 24 h volume rose sharply |

Metrics recorded per clock column: `rows_last_1m`, `rows_last_1h`,
`rows_last_24h`, `rows_last_7d`, `rows_per_minute`, `rows_per_hour`,
`rows_per_day`, `freshness_minutes`, `ingestion_change_pct`.

## Schema drift

| check_type | Default severity | Fires when |
|---|---|---|
| `schema_change` | MEDIUM | columns added or nullability changed |
| `column_removed` | CRITICAL | a column present last run is gone |
| `column_type_changed` | HIGH | a column's type changed |
| `table_removed` | CRITICAL | a previously seen table is missing or no longer readable |

## Index & engine health

| check_type | Threshold keys | Default severity | Fires when |
|---|---|---|---|
| `invalid_index` | — | HIGH | `pg_index.indisvalid = false` |
| `unused_index` | `min_size_bytes` 10485760, `max_scans` 0 | LOW | large non-unique index with no scans |
| `table_bloat` | `warn_pct` 20, `high_pct` 40, `min_rows` 10000 | MEDIUM | dead tuples / (live + dead) above threshold |
| `seq_scan_heavy` | `min_rows` 50000, `min_seq_scans` 1000, `max_idx_ratio` 0.1 | MEDIUM | large table read mostly by sequential scan |
| `stale_statistics` | `warn_days` 7, `high_days` 30 | LOW | last ANALYZE older than threshold |

## Availability

| check_type | Default severity | Fires when |
|---|---|---|
| `project_unreachable` | CRITICAL | `mon_collect()` call failed (network, key, function missing) |

---

## Adding a new check

1. Extend the aggregate builder in `sql/02_collector_rpc.sql` so the raw number
   is returned inside `profile`.
2. Add a `DEFAULTS` entry and a `check('my_check', ctx, r => …)` block in
   `workflow/src/03_analyze_project.js`.
3. `python3 workflow/build_workflow.py`, re-import, done.

Emit a `metric(...)` alongside the alert so the next run can trend it —
anything written to `mon_metrics` is automatically available as
`prev(schema, table, column, name)` on the following run.
