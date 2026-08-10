// ── NODE: "Analyze Project" (Code, run once for all items) ────────────
// Turns one raw mon_collect() snapshot into: metrics, alerts, a health
// score and a schema snapshot. Compares against the previous run's
// metrics (loaded once by "Central: Bootstrap") to detect trends and
// anomalies. Never throws — a failed project degrades to a CRITICAL
// alert so the rest of the run continues.

const proj = $('Build Project Queue').first().json;
const boot = (() => {
  const b = $('Central: Bootstrap').first().json;
  return Array.isArray(b) ? b[0] : b;
})();

const rules = boot.rules || [];
const prevMetrics = new Map();
for (const m of boot.prev_metrics || []) prevMetrics.set(m.k, m);
const prevSchema = new Map();
for (const s of boot.prev_schema || []) prevSchema.set(s.k, s);

const raw = $input.first().json;
const collect = Array.isArray(raw) ? raw[0] : raw;

const out = {
  project_code: proj.project_code,
  project_name: proj.project_name,
  run_id: proj.run_id,
  status: 'SUCCESS',
  error_message: null,
  health_score: 100,
  health_grade: 'A',
  tables_scanned: 0,
  columns_scanned: 0,
  checks_performed: 0,
  metrics: [],
  alerts: [],
  schema_snapshots: [],
  stats: {},
};

// ── helpers ──────────────────────────────────────────────────────────
const SEV_ORDER = { INFO: 0, LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };
const PENALTY = { INFO: 0, LOW: 1.5, MEDIUM: 4, HIGH: 10, CRITICAL: 25 };
const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const pct = (a, b) => (b ? (a / b) * 100 : 0);
const round = (v, d = 2) => (v === null || !isFinite(v) ? null : Number(Number(v).toFixed(d)));
const bytes = (b) => {
  if (b === null || b === undefined) return 'n/a';
  const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; let n = Number(b);
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return n.toFixed(n < 10 && i > 0 ? 1 : 0) + ' ' + u[i];
};

// Built-in defaults — mon_rules rows override these.
const DEFAULTS = {
  empty_table:            { severity: 'LOW',      t: {} },
  row_count_drop:         { severity: 'HIGH',     t: { warn_pct: 5, high_pct: 20, critical_pct: 50, min_rows: 50 } },
  row_count_spike:        { severity: 'MEDIUM',   t: { warn_pct: 100, high_pct: 500, min_rows: 100 } },
  table_size_growth:      { severity: 'LOW',      t: { warn_pct: 50, high_pct: 200, min_bytes: 10485760 } },
  null_percentage:        { severity: 'MEDIUM',   t: { warn_pct: 30, high_pct: 60, critical_pct: 90, min_rows: 100 } },
  null_rate_increase:     { severity: 'HIGH',     t: { warn_delta_pct: 5, high_delta_pct: 15, min_rows: 100 } },
  duplicate_values:       { severity: 'MEDIUM',   t: { warn_pct: 1, high_pct: 10, min_rows: 50 } },
  unique_like_duplicates: { severity: 'HIGH',     t: { min_rows: 1 } },
  orphaned_records:       { severity: 'HIGH',     t: { warn_count: 1, high_count: 100, critical_count: 1000 } },
  missing_foreign_key:    { severity: 'LOW',      t: {} },
  empty_string_values:    { severity: 'LOW',      t: { warn_pct: 2, high_pct: 15, min_rows: 50 } },
  future_timestamps:      { severity: 'HIGH',     t: { warn_count: 1, high_count: 50 } },
  invalid_timestamps:     { severity: 'MEDIUM',   t: { warn_count: 1, high_count: 100 } },
  timestamp_inconsistency:{ severity: 'HIGH',     t: { warn_count: 1, high_count: 50 } },
  data_freshness:         { severity: 'HIGH',     t: { warn_minutes: 120, high_minutes: 720, critical_minutes: 2880 } },
  ingestion_inactivity:   { severity: 'HIGH',     t: { expect_rows_24h: 1 } },
  ingestion_drop:         { severity: 'HIGH',     t: { warn_pct: 40, high_pct: 70, critical_pct: 90, min_baseline: 20 } },
  ingestion_spike:        { severity: 'MEDIUM',   t: { warn_pct: 200, high_pct: 500, min_baseline: 20 } },
  schema_change:          { severity: 'MEDIUM',   t: {} },
  column_removed:         { severity: 'CRITICAL', t: {} },
  column_type_changed:    { severity: 'HIGH',     t: {} },
  table_removed:          { severity: 'CRITICAL', t: {} },
  invalid_index:          { severity: 'HIGH',     t: {} },
  unused_index:           { severity: 'LOW',      t: { min_size_bytes: 10485760, max_scans: 0 } },
  missing_fk_index:       { severity: 'MEDIUM',   t: { min_rows: 10000 } },
  table_bloat:            { severity: 'MEDIUM',   t: { warn_pct: 20, high_pct: 40, min_rows: 10000 } },
  seq_scan_heavy:         { severity: 'MEDIUM',   t: { min_rows: 50000, min_seq_scans: 1000, max_idx_ratio: 0.1 } },
  stale_statistics:       { severity: 'LOW',      t: { warn_days: 7, high_days: 30 } },
  project_unreachable:    { severity: 'CRITICAL', t: {} },
};

const SCOPE_WEIGHT = { global: 0, project: 1000, table: 2000, column: 3000 };

function matchRe(pattern, value) {
  if (!pattern) return true;
  try { return new RegExp(pattern).test(value || ''); } catch (e) { return false; }
}

function resolveRule(checkType, ctx) {
  const base = DEFAULTS[checkType] || { severity: 'MEDIUM', t: {} };
  let best = null, bestScore = -1;
  for (const r of rules) {
    if (r.check_type !== checkType) continue;
    if (r.project_code && r.project_code !== ctx.project) continue;
    if (r.schema_name && r.schema_name !== ctx.schema) continue;
    if (r.table_name && r.table_name !== ctx.table) continue;
    if (r.column_name && r.column_name !== ctx.column) continue;
    if (!matchRe(r.table_pattern, ctx.table)) continue;
    if (!matchRe(r.column_pattern, ctx.column)) continue;
    const score = (SCOPE_WEIGHT[r.scope] ?? 0) + (r.priority || 0);
    if (score > bestScore) { bestScore = score; best = r; }
  }
  return {
    rule_name: best ? best.rule_name : 'default:' + checkType,
    severity: best ? best.severity : base.severity,
    thresholds: Object.assign({}, base.t, (best && best.thresholds) || {}),
    recommendation: (best && best.recommendation) || null,
    disabled: false,
  };
}

function escalate(baseSev, value, t, keys) {
  // keys = [warnKey, highKey, criticalKey]; returns null if nothing crossed
  const [wk, hk, ck] = keys;
  if (ck && t[ck] != null && value >= t[ck]) return 'CRITICAL';
  if (hk && t[hk] != null && value >= t[hk]) return SEV_ORDER[baseSev] > SEV_ORDER.HIGH ? baseSev : 'HIGH';
  if (wk && t[wk] != null && value >= t[wk]) return baseSev;
  return null;
}

function metric(schema, table, column, name, value, meta) {
  out.metrics.push({
    project_code: proj.project_code, schema_name: schema, table_name: table,
    column_name: column || '', metric: name,
    value: value === null || value === undefined ? null : round(value, 4),
    meta: meta || {},
  });
}

function prev(schema, table, column, name) {
  const k = [proj.project_code, schema, table, column || '', name].join('|');
  const p = prevMetrics.get(k);
  return p ? { value: p.v === null ? null : Number(p.v), at: p.at } : null;
}

function alert(a) {
  out.alerts.push(Object.assign({
    project_code: proj.project_code,
    run_id: proj.run_id,
    current_value: null, previous_value: null, threshold_value: null,
    change_pct: null, trend: null, explanation: null, details: {},
  }, a));
}

function check(checkType, ctx, fn) {
  out.checks_performed++;
  const rule = resolveRule(checkType, ctx);
  try { fn(rule); } catch (e) { /* one bad check never kills the project */ }
}

// ── failure path ─────────────────────────────────────────────────────
const failed = raw && (raw.error || raw.message === 'error' || collect === undefined ||
  (collect && collect.code && !collect.tables));

if (failed || !collect || !collect.tables) {
  const msg = (raw && (raw.error?.message || raw.error || raw.message)) ||
              (collect && (collect.message || collect.hint)) || 'Unknown collection failure';
  out.status = 'FAILED';
  out.error_message = String(msg).slice(0, 900);
  out.health_score = 0;
  out.health_grade = 'F';
  const rule = resolveRule('project_unreachable', { project: proj.project_code });
  alert({
    severity: rule.severity, check_type: 'project_unreachable', rule_name: rule.rule_name,
    schema_name: null, table_name: null, column_name: null,
    message: `Could not collect metrics from project "${proj.project_code}"`,
    explanation: out.error_message,
    recommendation: rule.recommendation ||
      'Verify the project URL, the service_role key in MON_KEYS, and that mon_collect() is installed.',
    details: { url: proj.url },
  });
  return [{ json: out }];
}

// ── main analysis ────────────────────────────────────────────────────
out.stats = {
  database: collect.database,
  server_version: collect.server_version,
  db_size_bytes: collect.db_size_bytes,
  db_size_human: bytes(collect.db_size_bytes),
  collection_ms: collect.collection_ms,
  schemas: collect.schemas_requested,
  table_count: collect.table_count,
};

const nowMs = Date.now();
const seenTables = new Set();
let totalRows = 0, totalIngest24h = 0;

for (const tb of collect.tables) {
  const schema = tb.schema_name, table = tb.table_name;
  const tctx = { project: proj.project_code, schema, table };
  const key = `${schema}.${table}`;
  seenTables.add(`${proj.project_code}|${schema}|${table}`);
  out.tables_scanned++;

  const p = tb.profile || {};
  const cols = tb.columns || [];
  out.columns_scanned += cols.length;

  const rowCount = p.row_count != null ? Number(p.row_count) : Number(p.row_count_estimated ?? tb.est_rows ?? 0);
  const exact = !!tb.exact_profile && p.row_count != null;
  totalRows += rowCount;

  metric(schema, table, null, 'row_count', rowCount, { exact });
  metric(schema, table, null, 'total_bytes', tb.total_bytes);
  metric(schema, table, null, 'index_bytes', tb.index_bytes);

  const st = tb.stats || {};
  const dead = Number(st.n_dead_tup || 0), live = Number(st.n_live_tup || 0);
  const deadPct = live + dead > 0 ? pct(dead, live + dead) : 0;
  metric(schema, table, null, 'dead_tuple_pct', deadPct);

  // ---- table-level: empty ------------------------------------------
  check('empty_table', tctx, (r) => {
    if (rowCount === 0) {
      alert({
        severity: r.severity, check_type: 'empty_table', rule_name: r.rule_name,
        schema_name: schema, table_name: table, column_name: null,
        message: `Table ${key} is empty`, current_value: 0,
        explanation: 'No rows found in this table during this run.',
        recommendation: r.recommendation || 'Confirm the table is intentionally empty.',
      });
    }
  });

  // ---- row count trend ---------------------------------------------
  const prevRows = prev(schema, table, null, 'row_count');
  if (prevRows && prevRows.value != null) {
    const delta = rowCount - prevRows.value;
    const changePct = prevRows.value ? (delta / prevRows.value) * 100 : (rowCount ? 100 : 0);
    metric(schema, table, null, 'row_count_change_pct', changePct);

    check('row_count_drop', tctx, (r) => {
      const t = r.thresholds;
      if (prevRows.value < (t.min_rows ?? 0)) return;
      if (delta >= 0) return;
      const dropPct = Math.abs(changePct);
      const sev = escalate(r.severity, dropPct, t, ['warn_pct', 'high_pct', 'critical_pct']);
      if (!sev) return;
      alert({
        severity: sev, check_type: 'row_count_drop', rule_name: r.rule_name,
        schema_name: schema, table_name: table, column_name: null,
        message: `Row count in ${key} dropped ${round(dropPct)}% (${prevRows.value} → ${rowCount})`,
        current_value: rowCount, previous_value: prevRows.value,
        threshold_value: t.warn_pct, change_pct: round(changePct), trend: 'DECREASING',
        explanation: `${Math.abs(delta)} rows disappeared since the previous run at ${prevRows.at}. ` +
          'Row counts are normally monotonic for append-style tables.',
        recommendation: r.recommendation || 'Investigate deletes, a failed migration or an accidental truncate.',
      });
    });

    check('row_count_spike', tctx, (r) => {
      const t = r.thresholds;
      if (delta <= 0 || prevRows.value < (t.min_rows ?? 0)) return;
      const sev = escalate(r.severity, changePct, t, ['warn_pct', 'high_pct', 'critical_pct']);
      if (!sev) return;
      alert({
        severity: sev, check_type: 'row_count_spike', rule_name: r.rule_name,
        schema_name: schema, table_name: table, column_name: null,
        message: `Row count in ${key} grew ${round(changePct)}% (${prevRows.value} → ${rowCount})`,
        current_value: rowCount, previous_value: prevRows.value,
        threshold_value: t.warn_pct, change_pct: round(changePct), trend: 'INCREASING',
        explanation: 'Growth well above the historical rate for this table.',
        recommendation: r.recommendation || 'Check for duplicate ingestion or a runaway backfill.',
      });
    });
  }

  // ---- table size growth -------------------------------------------
  const prevSize = prev(schema, table, null, 'total_bytes');
  if (prevSize && prevSize.value) {
    const growth = pct(tb.total_bytes - prevSize.value, prevSize.value);
    check('table_size_growth', tctx, (r) => {
      const t = r.thresholds;
      if (tb.total_bytes < (t.min_bytes ?? 0) || growth <= 0) return;
      const sev = escalate(r.severity, growth, t, ['warn_pct', 'high_pct', 'critical_pct']);
      if (!sev) return;
      alert({
        severity: sev, check_type: 'table_size_growth', rule_name: r.rule_name,
        schema_name: schema, table_name: table, column_name: null,
        message: `${key} grew ${round(growth)}% on disk (${bytes(prevSize.value)} → ${bytes(tb.total_bytes)})`,
        current_value: tb.total_bytes, previous_value: prevSize.value,
        threshold_value: t.warn_pct, change_pct: round(growth), trend: 'INCREASING',
        explanation: 'Physical size increase exceeds the configured growth threshold.',
        recommendation: r.recommendation || 'Review retention, large payload columns and index bloat.',
      });
    });
  }

  // ---- bloat / vacuum / statistics / scans --------------------------
  check('table_bloat', tctx, (r) => {
    const t = r.thresholds;
    if (rowCount < (t.min_rows ?? 0)) return;
    const sev = escalate(r.severity, deadPct, t, ['warn_pct', 'high_pct', 'critical_pct']);
    if (!sev) return;
    alert({
      severity: sev, check_type: 'table_bloat', rule_name: r.rule_name,
      schema_name: schema, table_name: table, column_name: null,
      message: `${key} has ${round(deadPct)}% dead tuples (${dead} dead / ${live} live)`,
      current_value: round(deadPct), threshold_value: t.warn_pct,
      explanation: 'Dead tuples waste storage and slow scans until vacuumed.',
      recommendation: r.recommendation || 'Run VACUUM (ANALYZE) and review autovacuum settings.',
      details: { last_vacuum: st.last_vacuum },
    });
  });

  check('stale_statistics', tctx, (r) => {
    const t = r.thresholds;
    if (!st.last_analyze) return;
    const days = (nowMs - new Date(st.last_analyze).getTime()) / 86400000;
    metric(schema, table, null, 'days_since_analyze', days);
    const sev = escalate(r.severity, days, t, ['warn_days', 'high_days', 'critical_days']);
    if (!sev) return;
    alert({
      severity: sev, check_type: 'stale_statistics', rule_name: r.rule_name,
      schema_name: schema, table_name: table, column_name: null,
      message: `${key} statistics are ${Math.round(days)} days old`,
      current_value: round(days), threshold_value: t.warn_days,
      explanation: 'Stale planner statistics lead to bad query plans.',
      recommendation: r.recommendation || 'Run ANALYZE on this table.',
    });
  });

  check('seq_scan_heavy', tctx, (r) => {
    const t = r.thresholds;
    const seq = Number(st.seq_scan || 0), idx = Number(st.idx_scan || 0);
    metric(schema, table, null, 'seq_scan', seq);
    metric(schema, table, null, 'idx_scan', idx);
    if (rowCount < (t.min_rows ?? 0) || seq < (t.min_seq_scans ?? 0)) return;
    const ratio = seq + idx > 0 ? idx / (seq + idx) : 0;
    if (ratio > (t.max_idx_ratio ?? 0.1)) return;
    alert({
      severity: r.severity, check_type: 'seq_scan_heavy', rule_name: r.rule_name,
      schema_name: schema, table_name: table, column_name: null,
      message: `${key} is scanned sequentially (${seq} seq scans vs ${idx} index scans)`,
      current_value: seq, threshold_value: t.min_seq_scans,
      explanation: `Only ${round(ratio * 100)}% of scans use an index on a ${rowCount}-row table.`,
      recommendation: r.recommendation || 'Add indexes supporting the common query predicates.',
    });
  });

  // ---- indexes ------------------------------------------------------
  const indexes = tb.indexes || [];
  const indexedFirstCols = new Set(
    indexes.map((i) => (i.columns && i.columns[0]) || null).filter(Boolean)
  );
  for (const ix of indexes) {
    if (ix.is_valid === false) {
      check('invalid_index', tctx, (r) => alert({
        severity: r.severity, check_type: 'invalid_index', rule_name: r.rule_name,
        schema_name: schema, table_name: table, column_name: null,
        message: `Index ${ix.name} on ${key} is INVALID`,
        explanation: 'An invalid index is ignored by the planner — usually a failed CREATE INDEX CONCURRENTLY.',
        recommendation: r.recommendation || `REINDEX INDEX ${schema}.${ix.name};`,
        details: { definition: ix.definition },
      }));
      continue;
    }
    check('unused_index', tctx, (r) => {
      const t = r.thresholds;
      if (ix.is_primary || ix.is_unique) return;
      if (Number(ix.size_bytes || 0) < (t.min_size_bytes ?? 0)) return;
      if (Number(ix.scans || 0) > (t.max_scans ?? 0)) return;
      alert({
        severity: r.severity, check_type: 'unused_index', rule_name: r.rule_name,
        schema_name: schema, table_name: table, column_name: null,
        message: `Index ${ix.name} (${bytes(ix.size_bytes)}) on ${key} has never been used`,
        current_value: Number(ix.scans || 0), threshold_value: t.max_scans,
        explanation: 'Unused indexes consume storage and slow every INSERT/UPDATE.',
        recommendation: r.recommendation || `Consider DROP INDEX ${schema}.${ix.name};`,
        details: { definition: ix.definition, size_bytes: ix.size_bytes },
      });
    });
  }

  // ---- foreign keys: orphans + missing index ------------------------
  for (const o of tb.orphans || []) {
    check('orphaned_records', { ...tctx, column: o.column }, (r) => {
      const t = r.thresholds;
      const n = Number(o.orphan_count);
      metric(schema, table, o.column, 'orphan_count', n);
      const sev = escalate(r.severity, n, t, ['warn_count', 'high_count', 'critical_count']);
      if (!sev) return;
      const pv = prev(schema, table, o.column, 'orphan_count');
      alert({
        severity: sev, check_type: 'orphaned_records', rule_name: r.rule_name,
        schema_name: schema, table_name: table, column_name: o.column,
        message: `${n} orphaned rows in ${key}.${o.column} → ${o.ref}`,
        current_value: n, previous_value: pv ? pv.value : null,
        threshold_value: t.warn_count,
        trend: pv && pv.value != null ? (n > pv.value ? 'INCREASING' : n < pv.value ? 'DECREASING' : 'STABLE') : null,
        explanation: `Rows reference a parent key that no longer exists (constraint ${o.constraint}).`,
        recommendation: r.recommendation || 'Delete or repair orphans and review ON DELETE behaviour.',
        details: o,
      });
    });
  }

  for (const fk of tb.foreign_keys || []) {
    const col = (fk.columns && fk.columns[0]) || null;
    if (!col) continue;
    check('missing_fk_index', { ...tctx, column: col }, (r) => {
      const t = r.thresholds;
      if (rowCount < (t.min_rows ?? 0)) return;
      if (indexedFirstCols.has(col)) return;
      alert({
        severity: r.severity, check_type: 'missing_fk_index', rule_name: r.rule_name,
        schema_name: schema, table_name: table, column_name: col,
        message: `Foreign key ${key}.${col} has no supporting index`,
        current_value: rowCount, threshold_value: t.min_rows,
        explanation: 'Un-indexed FKs cause slow joins and long lock waits on parent deletes.',
        recommendation: r.recommendation || `CREATE INDEX ON ${schema}.${table} (${col});`,
      });
    });
  }

  // ---- missing relationships (column looks like an FK, isn't one) ---
  const fkCols = new Set((tb.foreign_keys || []).flatMap((f) => f.columns || []));
  const pkCols = new Set(
    (indexes.filter((i) => i.is_primary).flatMap((i) => i.columns || []))
  );
  for (const c of cols) {
    if (!/_id$/.test(c.name) || fkCols.has(c.name) || pkCols.has(c.name)) continue;
    if (c.name === 'id') continue;
    check('missing_foreign_key', { ...tctx, column: c.name }, (r) => alert({
      severity: r.severity, check_type: 'missing_foreign_key', rule_name: r.rule_name,
      schema_name: schema, table_name: table, column_name: c.name,
      message: `${key}.${c.name} looks like a relationship but has no FK constraint`,
      explanation: 'Naming convention suggests a reference; without a constraint orphans can accumulate silently.',
      recommendation: r.recommendation || 'Add a FOREIGN KEY constraint if this column references another table.',
      details: { type: c.type },
    }));
  }

  // ---- per-column data quality --------------------------------------
  if (exact && rowCount > 0) {
    for (const c of cols) {
      const cctx = { ...tctx, column: c.name };
      const ord = c.ordinal;

      // NULL percentage + trend
      const nulls = num(p['nulls_' + ord]);
      if (nulls !== null) {
        const nullPct = pct(nulls, rowCount);
        metric(schema, table, c.name, 'null_pct', nullPct);
        metric(schema, table, c.name, 'null_count', nulls);

        check('null_percentage', cctx, (r) => {
          const t = r.thresholds;
          if (rowCount < (t.min_rows ?? 0)) return;
          const sev = escalate(r.severity, nullPct, t, ['warn_pct', 'high_pct', 'critical_pct']);
          if (!sev) return;
          alert({
            severity: sev, check_type: 'null_percentage', rule_name: r.rule_name,
            schema_name: schema, table_name: table, column_name: c.name,
            message: `${key}.${c.name} is ${round(nullPct)}% NULL (${nulls}/${rowCount})`,
            current_value: round(nullPct), threshold_value: t.warn_pct,
            explanation: 'NULL density above the configured limit for this column.',
            recommendation: r.recommendation || 'Confirm the column is optional; consider NOT NULL or a default.',
            details: { nullable: c.nullable, type: c.type },
          });
        });

        const pn = prev(schema, table, c.name, 'null_pct');
        if (pn && pn.value != null) {
          const delta = nullPct - pn.value;
          check('null_rate_increase', cctx, (r) => {
            const t = r.thresholds;
            if (rowCount < (t.min_rows ?? 0) || delta <= 0) return;
            const sev = escalate(r.severity, delta, t, ['warn_delta_pct', 'high_delta_pct', 'critical_delta_pct']);
            if (!sev) return;
            alert({
              severity: sev, check_type: 'null_rate_increase', rule_name: r.rule_name,
              schema_name: schema, table_name: table, column_name: c.name,
              message: `NULL rate for ${key}.${c.name} rose ${round(delta)} pts (${round(pn.value)}% → ${round(nullPct)}%)`,
              current_value: round(nullPct), previous_value: round(pn.value),
              threshold_value: t.warn_delta_pct, change_pct: round(delta), trend: 'INCREASING',
              explanation: `A writer likely stopped populating this column after ${pn.at}.`,
              recommendation: r.recommendation || 'Check recent deploys and the producing service.',
            });
          });
        }
      }

      // duplicates
      const distinct = num(p['distinct_' + ord]);
      if (distinct !== null) {
        const nonNull = rowCount - (nulls || 0);
        const dupCount = Math.max(0, nonNull - distinct);
        const dupPct = pct(dupCount, nonNull || 1);
        metric(schema, table, c.name, 'distinct_count', distinct);
        metric(schema, table, c.name, 'duplicate_pct', dupPct);

        const looksUnique = /(^|_)(email|slug|username|uuid|token|sku|code|reference|phone)($|_)/i.test(c.name);
        const isUniqueIndexed = indexes.some(
          (i) => i.is_unique && (i.columns || []).length === 1 && i.columns[0] === c.name
        );

        check(looksUnique && !isUniqueIndexed ? 'unique_like_duplicates' : 'duplicate_values', cctx, (r) => {
          const t = r.thresholds;
          if (nonNull < (t.min_rows ?? 0) || dupCount === 0) return;
          const sev = escalate(r.severity, dupPct, t, ['warn_pct', 'high_pct', 'critical_pct']) ||
                      (looksUnique ? r.severity : null);
          if (!sev) return;
          const pd = prev(schema, table, c.name, 'duplicate_pct');
          alert({
            severity: sev,
            check_type: looksUnique && !isUniqueIndexed ? 'unique_like_duplicates' : 'duplicate_values',
            rule_name: r.rule_name,
            schema_name: schema, table_name: table, column_name: c.name,
            message: `${key}.${c.name} has ${dupCount} duplicate values (${round(dupPct)}% of ${nonNull})`,
            current_value: round(dupPct), previous_value: pd ? round(pd.value) : null,
            threshold_value: t.warn_pct,
            trend: pd && pd.value != null ? (dupPct > pd.value ? 'INCREASING' : dupPct < pd.value ? 'DECREASING' : 'STABLE') : null,
            explanation: looksUnique
              ? 'Column name suggests a natural key, but values repeat and no UNIQUE index protects it.'
              : 'Duplicate ratio above the configured threshold.',
            recommendation: r.recommendation ||
              `Deduplicate, then CREATE UNIQUE INDEX ON ${schema}.${table} (${c.name});`,
            details: { distinct, non_null: nonNull },
          });
        });
      }

      // empty / sentinel strings
      const empty = num(p['empty_' + ord]);
      const blank = num(p['blank_' + ord]);
      const sentinel = num(p['sentinel_' + ord]);
      const badStrings = (empty || 0) + (blank || 0) + (sentinel || 0);
      if (empty !== null) {
        const bsPct = pct(badStrings, rowCount);
        metric(schema, table, c.name, 'empty_string_pct', bsPct);
        check('empty_string_values', cctx, (r) => {
          const t = r.thresholds;
          if (rowCount < (t.min_rows ?? 0) || badStrings === 0) return;
          const sev = escalate(r.severity, bsPct, t, ['warn_pct', 'high_pct', 'critical_pct']);
          if (!sev) return;
          alert({
            severity: sev, check_type: 'empty_string_values', rule_name: r.rule_name,
            schema_name: schema, table_name: table, column_name: c.name,
            message: `${key}.${c.name} has ${badStrings} empty/placeholder values (${round(bsPct)}%)`,
            current_value: round(bsPct), threshold_value: t.warn_pct,
            explanation: `Empty: ${empty}, whitespace-only: ${blank || 0}, literal "null"/"n/a": ${sentinel || 0}.`,
            recommendation: r.recommendation || 'Normalise these to real NULLs and validate on write.',
          });
        });
      }

      // timestamp sanity + freshness + ingestion
      const tmax = p['tmax_' + ord] || null;
      if (tmax !== undefined && (p['tmax_' + ord] || p['tmin_' + ord])) {
        const future = num(p['future_' + ord]) || 0;
        const ancient = num(p['ancient_' + ord]) || 0;

        if (future > 0) {
          check('future_timestamps', cctx, (r) => {
            const t = r.thresholds;
            const sev = escalate(r.severity, future, t, ['warn_count', 'high_count', 'critical_count']);
            if (!sev) return;
            alert({
              severity: sev, check_type: 'future_timestamps', rule_name: r.rule_name,
              schema_name: schema, table_name: table, column_name: c.name,
              message: `${future} rows in ${key}.${c.name} are dated in the future`,
              current_value: future, threshold_value: t.warn_count,
              explanation: 'Timestamps more than 1 day ahead of server time indicate clock skew or unvalidated client input.',
              recommendation: r.recommendation || 'Set timestamps server-side (now()) and validate on write.',
            });
          });
        }
        if (ancient > 0) {
          check('invalid_timestamps', cctx, (r) => {
            const t = r.thresholds;
            const sev = escalate(r.severity, ancient, t, ['warn_count', 'high_count', 'critical_count']);
            if (!sev) return;
            alert({
              severity: sev, check_type: 'invalid_timestamps', rule_name: r.rule_name,
              schema_name: schema, table_name: table, column_name: c.name,
              message: `${ancient} rows in ${key}.${c.name} predate 1980`,
              current_value: ancient, threshold_value: t.warn_count,
              explanation: 'Usually an epoch-zero default or a timestamp parsing bug.',
              recommendation: r.recommendation || 'Backfill or null out the invalid values and fix the writer.',
            });
          });
        }

        // Only treat "creation-like" columns as the ingestion clock.
        const isIngestionClock = /^(created_at|inserted_at|created_on|created|timestamp|occurred_at|event_time)$/i.test(c.name);
        if (isIngestionClock && tmax) {
          const ageMin = (nowMs - new Date(tmax).getTime()) / 60000;
          const w1m = num(p['w1m_' + ord]) || 0;
          const w1h = num(p['w1h_' + ord]) || 0;
          const w24h = num(p['w24h_' + ord]) || 0;
          const w7d = num(p['w7d_' + ord]) || 0;
          totalIngest24h += w24h;

          metric(schema, table, c.name, 'freshness_minutes', ageMin, { latest_record: tmax });
          metric(schema, table, c.name, 'rows_last_1m', w1m);
          metric(schema, table, c.name, 'rows_last_1h', w1h);
          metric(schema, table, c.name, 'rows_last_24h', w24h);
          metric(schema, table, c.name, 'rows_last_7d', w7d);
          metric(schema, table, c.name, 'rows_per_minute', w1h / 60);
          metric(schema, table, c.name, 'rows_per_hour', w24h / 24);
          metric(schema, table, c.name, 'rows_per_day', w7d / 7);

          check('data_freshness', cctx, (r) => {
            const t = r.thresholds;
            const sev = escalate(r.severity, ageMin, t, ['warn_minutes', 'high_minutes', 'critical_minutes']);
            if (!sev) return;
            alert({
              severity: sev, check_type: 'data_freshness', rule_name: r.rule_name,
              schema_name: schema, table_name: table, column_name: c.name,
              message: `${key} is stale — newest row is ${Math.round(ageMin)} min old`,
              current_value: round(ageMin), threshold_value: t.warn_minutes,
              trend: 'STALE',
              explanation: `Latest ${c.name} = ${tmax}. Expected fresh data within ${t.warn_minutes} minutes.`,
              recommendation: r.recommendation || 'Check the ingestion pipeline, queue workers and cron jobs.',
            });
          });

          check('ingestion_inactivity', cctx, (r) => {
            const t = r.thresholds;
            if (w24h >= (t.expect_rows_24h ?? 1)) return;
            const p7 = prev(schema, table, c.name, 'rows_last_7d');
            if (!(w7d > 0 || (p7 && p7.value > 0))) return; // never active -> not an alert
            alert({
              severity: r.severity, check_type: 'ingestion_inactivity', rule_name: r.rule_name,
              schema_name: schema, table_name: table, column_name: c.name,
              message: `No new rows in ${key} for 24h (7-day total: ${w7d})`,
              current_value: w24h, threshold_value: t.expect_rows_24h, trend: 'INACTIVE',
              explanation: 'This table normally receives writes but has been silent for a full day.',
              recommendation: r.recommendation || 'Verify the producing service is running.',
            });
          });

          const prevRate = prev(schema, table, c.name, 'rows_last_24h');
          if (prevRate && prevRate.value != null) {
            const base = prevRate.value;
            const changePct = base ? ((w24h - base) / base) * 100 : 0;
            metric(schema, table, c.name, 'ingestion_change_pct', changePct);

            check('ingestion_drop', cctx, (r) => {
              const t = r.thresholds;
              if (base < (t.min_baseline ?? 0) || changePct >= 0) return;
              const sev = escalate(r.severity, Math.abs(changePct), t, ['warn_pct', 'high_pct', 'critical_pct']);
              if (!sev) return;
              alert({
                severity: sev, check_type: 'ingestion_drop', rule_name: r.rule_name,
                schema_name: schema, table_name: table, column_name: c.name,
                message: `Ingestion into ${key} fell ${round(Math.abs(changePct))}% (${base} → ${w24h} rows/24h)`,
                current_value: w24h, previous_value: base, threshold_value: t.warn_pct,
                change_pct: round(changePct), trend: 'DECREASING',
                explanation: `24h write volume dropped versus the previous run (${prevRate.at}).`,
                recommendation: r.recommendation || 'Inspect producers, rate limits and upstream errors.',
              });
            });

            check('ingestion_spike', cctx, (r) => {
              const t = r.thresholds;
              if (base < (t.min_baseline ?? 0) || changePct <= 0) return;
              const sev = escalate(r.severity, changePct, t, ['warn_pct', 'high_pct', 'critical_pct']);
              if (!sev) return;
              alert({
                severity: sev, check_type: 'ingestion_spike', rule_name: r.rule_name,
                schema_name: schema, table_name: table, column_name: c.name,
                message: `Ingestion into ${key} spiked ${round(changePct)}% (${base} → ${w24h} rows/24h)`,
                current_value: w24h, previous_value: base, threshold_value: t.warn_pct,
                change_pct: round(changePct), trend: 'INCREASING',
                explanation: 'Write volume far above the previous run.',
                recommendation: r.recommendation || 'Check for retry storms, bot traffic or a duplicate publisher.',
              });
            });
          }
        }
      }
    }

    // created_at / updated_at consistency
    const tsBad = num(p.ts_inconsistent);
    if (tsBad !== null && tsBad > 0) {
      check('timestamp_inconsistency', tctx, (r) => {
        const t = r.thresholds;
        const sev = escalate(r.severity, tsBad, t, ['warn_count', 'high_count', 'critical_count']);
        if (!sev) return;
        alert({
          severity: sev, check_type: 'timestamp_inconsistency', rule_name: r.rule_name,
          schema_name: schema, table_name: table, column_name: 'updated_at',
          message: `${tsBad} rows in ${key} have updated_at earlier than created_at`,
          current_value: tsBad, threshold_value: t.warn_count,
          explanation: 'Logically impossible ordering — usually a bad trigger or a client-supplied timestamp.',
          recommendation: r.recommendation || 'Fix the trigger/application code that maintains updated_at.',
        });
      });
    }
  }

  // ---- schema drift --------------------------------------------------
  const snapKey = `${proj.project_code}|${schema}|${table}`;
  const before = prevSchema.get(snapKey);
  out.schema_snapshots.push({
    project_code: proj.project_code, schema_name: schema, table_name: table,
    fingerprint: tb.fingerprint,
    columns: cols.map((c) => ({ name: c.name, type: c.type, nullable: c.nullable })),
    indexes: indexes.map((i) => ({ name: i.name, unique: i.is_unique, columns: i.columns })),
  });

  if (before && before.fingerprint !== tb.fingerprint) {
    const oldCols = new Map((before.columns || []).map((c) => [c.name, c]));
    const newCols = new Map(cols.map((c) => [c.name, c]));
    const added = [...newCols.keys()].filter((n) => !oldCols.has(n));
    const removed = [...oldCols.keys()].filter((n) => !newCols.has(n));
    const changed = [...newCols.keys()].filter(
      (n) => oldCols.has(n) && oldCols.get(n).type !== newCols.get(n).type
    );
    const nullability = [...newCols.keys()].filter(
      (n) => oldCols.has(n) && oldCols.get(n).nullable !== newCols.get(n).nullable
    );

    if (removed.length) {
      check('column_removed', tctx, (r) => alert({
        severity: r.severity, check_type: 'column_removed', rule_name: r.rule_name,
        schema_name: schema, table_name: table, column_name: removed.join(', '),
        message: `${removed.length} column(s) removed from ${key}: ${removed.join(', ')}`,
        explanation: `Present at ${before.at}, gone now. Dropping columns is a breaking change for clients.`,
        recommendation: r.recommendation || 'Confirm the drop was planned and coordinated with API consumers.',
        details: { removed },
      }));
    }
    if (changed.length) {
      check('column_type_changed', tctx, (r) => alert({
        severity: r.severity, check_type: 'column_type_changed', rule_name: r.rule_name,
        schema_name: schema, table_name: table, column_name: changed.join(', '),
        message: `Column type changed in ${key}: ` +
          changed.map((n) => `${n} ${oldCols.get(n).type} → ${newCols.get(n).type}`).join('; '),
        explanation: 'Type changes can silently truncate data and break typed clients.',
        recommendation: r.recommendation || 'Verify the migration and regenerate client types.',
        details: { changed: changed.map((n) => ({ column: n, from: oldCols.get(n).type, to: newCols.get(n).type })) },
      }));
    }
    if (added.length || nullability.length) {
      check('schema_change', tctx, (r) => alert({
        severity: r.severity, check_type: 'schema_change', rule_name: r.rule_name,
        schema_name: schema, table_name: table,
        column_name: [...added, ...nullability].join(', ') || null,
        message: `Schema changed in ${key}` +
          (added.length ? ` — added: ${added.join(', ')}` : '') +
          (nullability.length ? ` — nullability changed: ${nullability.join(', ')}` : ''),
        explanation: `Fingerprint moved from ${String(before.fingerprint).slice(0, 8)} to ${String(tb.fingerprint).slice(0, 8)} since ${before.at}.`,
        recommendation: r.recommendation || 'Verify the change was intentional and update dependent clients.',
        details: { added, nullability_changed: nullability },
      }));
    }
  }
}

// ---- tables that vanished since the last run --------------------------
for (const k of prevSchema.keys()) {
  if (!k.startsWith(proj.project_code + '|')) continue;
  if (seenTables.has(k)) continue;
  const [, schema, table] = k.split('|');
  check('table_removed', { project: proj.project_code, schema, table }, (r) => alert({
    severity: r.severity, check_type: 'table_removed', rule_name: r.rule_name,
    schema_name: schema, table_name: table, column_name: null,
    message: `Table ${schema}.${table} no longer exists (or is no longer accessible)`,
    explanation: 'This table was present in a previous run and is missing now.',
    recommendation: r.recommendation || 'Confirm the drop was intentional, or check role privileges.',
  }));
}

// ---- project-level metrics + health score -----------------------------
// Project-level series are stored under the reserved key _meta._project
metric('_meta', '_project', null, 'db_size_bytes', collect.db_size_bytes);
metric('_meta', '_project', null, 'table_count', collect.table_count);
metric('_meta', '_project', null, 'total_rows_scanned', totalRows);
metric('_meta', '_project', null, 'collection_ms', collect.collection_ms);

const counts = { INFO: 0, LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 };
let penalty = 0;
for (const a of out.alerts) {
  counts[a.severity] = (counts[a.severity] || 0) + 1;
  penalty += PENALTY[a.severity] || 0;
}
// diminishing returns: repeated low-severity noise shouldn't zero the score
const damped = penalty <= 40 ? penalty : 40 + Math.sqrt(penalty - 40) * 6;
out.health_score = round(Math.max(0, Math.min(100, 100 - damped)), 2);
out.health_grade = out.health_score >= 90 ? 'A' : out.health_score >= 75 ? 'B'
  : out.health_score >= 60 ? 'C' : out.health_score >= 40 ? 'D' : 'F';
out.issues_found = out.alerts.length;
out.severity_counts = counts;
out.stats = Object.assign(out.stats, {
  total_rows: totalRows,
  ingested_last_24h: totalIngest24h,
  severity_counts: counts,
  health_score: out.health_score,
});

return [{ json: out }];
