// ── NODE: "Compose Report" (Code, run once for all items) ─────────────
// Input: one item per analysed project (accumulated by the loop).
// Output: a single item containing the persistence payload for
//         mon_persist_run() plus the full plain-text report.

const ctx = $('Prepare Run').first().json;
const results = $input.all().map((i) => i.json);

const SEV = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];
const startedAt = ctx.started_at;
const finishedAt = new Date().toISOString();
const durationMs = new Date(finishedAt) - new Date(startedAt);

const pad = (s, n) => String(s ?? '').padEnd(n);
const lpad = (s, n) => String(s ?? '').padStart(n);
const line = (ch = '-', n = 78) => ch.repeat(n);
const fmtNum = (v) => (v === null || v === undefined ? 'n/a' : Number(v).toLocaleString('en-US'));
const fmtVal = (v) => (v === null || v === undefined ? 'n/a' : String(v));
const humanBytes = (b) => {
  if (b === null || b === undefined) return 'n/a';
  const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; let n = Number(b);
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return n.toFixed(n < 10 && i > 0 ? 1 : 0) + ' ' + u[i];
};

// ── aggregate ─────────────────────────────────────────────────────────
const allAlerts = [];
const allMetrics = [];
const allSnapshots = [];
const projectRuns = [];
const totals = { INFO: 0, LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 };
let tablesScanned = 0, columnsScanned = 0, checksPerformed = 0, ok = 0, failed = 0;

for (const r of results) {
  tablesScanned += r.tables_scanned || 0;
  columnsScanned += r.columns_scanned || 0;
  checksPerformed += r.checks_performed || 0;
  if (r.status === 'SUCCESS') ok++; else failed++;
  for (const a of r.alerts || []) { allAlerts.push(a); totals[a.severity] = (totals[a.severity] || 0) + 1; }
  for (const m of r.metrics || []) allMetrics.push(m);
  for (const s of r.schema_snapshots || []) allSnapshots.push(s);
  projectRuns.push({
    project_code: r.project_code, project_name: r.project_name, status: r.status,
    error_message: r.error_message, health_score: r.health_score, health_grade: r.health_grade,
    tables_scanned: r.tables_scanned, checks_performed: r.checks_performed,
    issues_found: (r.alerts || []).length, stats: r.stats || {},
  });
}

const avgHealth = results.length
  ? Number((results.reduce((s, r) => s + Number(r.health_score || 0), 0) / results.length).toFixed(2))
  : null;
const runStatus = failed === 0 ? 'SUCCESS' : (ok === 0 ? 'FAILED' : 'PARTIAL');

// ── build the .txt report ─────────────────────────────────────────────
const L = [];
L.push(line('='));
L.push('  SUPABASE DATABASE MONITORING & DATA QUALITY REPORT');
L.push(line('='));
L.push(`  Run ID            : ${ctx.run_id}`);
L.push(`  Started (UTC)     : ${startedAt}`);
L.push(`  Finished (UTC)    : ${finishedAt}`);
L.push(`  Duration          : ${(durationMs / 1000).toFixed(1)}s`);
L.push(`  Run status        : ${runStatus}`);
L.push(`  Projects          : ${results.length}  (ok: ${ok}, failed: ${failed})`);
L.push(`  Tables scanned    : ${fmtNum(tablesScanned)}`);
L.push(`  Columns scanned   : ${fmtNum(columnsScanned)}`);
L.push(`  Checks performed  : ${fmtNum(checksPerformed)}`);
L.push(`  Issues detected   : ${fmtNum(allAlerts.length)}`);
L.push(`  Average health    : ${avgHealth === null ? 'n/a' : avgHealth + ' / 100'}`);
L.push('');
L.push('  Severity breakdown:');
for (const s of SEV) L.push(`    ${pad(s, 10)} ${lpad(totals[s] || 0, 5)}`);
if ((ctx.project_filter || []).length) L.push(`\n  Project filter applied: ${ctx.project_filter.join(', ')}`);
L.push('');

// executive summary table
L.push(line('='));
L.push('  PROJECT HEALTH SCORECARD');
L.push(line('='));
L.push(`  ${pad('PROJECT', 20)}${pad('STATUS', 10)}${pad('SCORE', 9)}${pad('GRADE', 7)}${pad('TABLES', 8)}${'ISSUES'}`);
L.push('  ' + line('-', 74));
for (const p of projectRuns.sort((a, b) => (a.health_score || 0) - (b.health_score || 0))) {
  L.push(`  ${pad(p.project_code, 20)}${pad(p.status, 10)}${pad(fmtVal(p.health_score), 9)}${pad(p.health_grade || '-', 7)}${pad(fmtNum(p.tables_scanned), 8)}${p.issues_found}`);
}
L.push('');
L.push('  Scoring: 100 - weighted severity penalties (CRITICAL 25, HIGH 10,');
L.push('  MEDIUM 4, LOW 1.5), damped above 40 so noise cannot zero the score.');
L.push('  Grades: A >=90  B >=75  C >=60  D >=40  F <40');
L.push('');

// per-project detail
for (const r of results) {
  L.push(line('='));
  L.push(`  PROJECT: ${r.project_name || r.project_code}  [${r.project_code}]`);
  L.push(line('='));

  if (r.status !== 'SUCCESS') {
    L.push('  STATUS: FAILED');
    L.push(`  Error : ${r.error_message}`);
    L.push('');
    L.push('  This project was skipped. The rest of the run completed normally.');
    L.push('');
    continue;
  }

  const st = r.stats || {};
  L.push(`  Health score      : ${r.health_score} / 100  (grade ${r.health_grade})`);
  L.push(`  Database          : ${st.database || 'n/a'}  (PostgreSQL ${st.server_version || 'n/a'})`);
  L.push(`  Database size     : ${humanBytes(st.db_size_bytes)}`);
  L.push(`  Schemas monitored : ${(st.schemas || ['public']).join(', ')}`);
  L.push(`  Tables scanned    : ${fmtNum(r.tables_scanned)}   Columns: ${fmtNum(r.columns_scanned)}`);
  L.push(`  Rows accounted    : ${fmtNum(st.total_rows)}`);
  L.push(`  Ingested last 24h : ${fmtNum(st.ingested_last_24h)}`);
  L.push(`  Checks performed  : ${fmtNum(r.checks_performed)}`);
  L.push(`  Collection time   : ${fmtNum(st.collection_ms)} ms`);
  const sc = r.severity_counts || {};
  L.push(`  Issues            : ` + SEV.map((s) => `${s}=${sc[s] || 0}`).join('  '));
  L.push('');

  const alerts = (r.alerts || []).slice().sort(
    (a, b) => SEV.indexOf(a.severity) - SEV.indexOf(b.severity) ||
              String(a.table_name).localeCompare(String(b.table_name))
  );

  if (!alerts.length) {
    L.push('  No issues detected. All configured checks passed.');
    L.push('');
    continue;
  }

  let idx = 0;
  let currentSev = null;
  for (const a of alerts) {
    if (a.severity !== currentSev) {
      currentSev = a.severity;
      L.push('  ' + line('-', 74));
      L.push(`  ${currentSev} SEVERITY  (${alerts.filter((x) => x.severity === currentSev).length})`);
      L.push('  ' + line('-', 74));
    }
    idx++;
    const target = [a.schema_name, a.table_name].filter(Boolean).join('.') +
                   (a.column_name ? '.' + a.column_name : '');
    L.push(`  [${String(idx).padStart(3, '0')}] ${a.message}`);
    L.push(`        Check          : ${a.check_type}`);
    L.push(`        Rule           : ${a.rule_name}`);
    L.push(`        Target         : ${target || '(project-level)'}`);
    L.push(`        Current value  : ${fmtVal(a.current_value)}`);
    L.push(`        Previous value : ${fmtVal(a.previous_value)}`);
    L.push(`        Threshold      : ${fmtVal(a.threshold_value)}`);
    if (a.change_pct !== null && a.change_pct !== undefined)
      L.push(`        Change         : ${a.change_pct > 0 ? '+' : ''}${a.change_pct}%`);
    if (a.trend) L.push(`        Trend          : ${a.trend}`);
    if (a.explanation) L.push(`        Why            : ${a.explanation}`);
    if (a.recommendation) L.push(`        Action         : ${a.recommendation}`);
    const d = a.details && Object.keys(a.details).length ? JSON.stringify(a.details) : null;
    if (d) L.push(`        Details        : ${d.length > 400 ? d.slice(0, 400) + '…' : d}`);
    L.push('');
  }
}

// cross-project top issues
if (allAlerts.length) {
  L.push(line('='));
  L.push('  CROSS-PROJECT PRIORITY QUEUE (top 20)');
  L.push(line('='));
  const top = allAlerts.slice().sort((a, b) => SEV.indexOf(a.severity) - SEV.indexOf(b.severity)).slice(0, 20);
  top.forEach((a, i) => {
    L.push(`  ${lpad(i + 1, 3)}. [${pad(a.severity, 8)}] ${a.project_code} :: ${a.message}`);
  });
  L.push('');

  L.push(line('='));
  L.push('  ISSUES BY CHECK TYPE');
  L.push(line('='));
  const byType = {};
  for (const a of allAlerts) byType[a.check_type] = (byType[a.check_type] || 0) + 1;
  Object.entries(byType).sort((a, b) => b[1] - a[1]).forEach(([k, v]) =>
    L.push(`  ${pad(k, 32)} ${lpad(v, 5)}`));
  L.push('');
}

// trend section
const trending = allMetrics.filter((m) => /change_pct$/.test(m.metric) && Math.abs(Number(m.value || 0)) >= 10);
if (trending.length) {
  L.push(line('='));
  L.push('  NOTABLE TRENDS VS PREVIOUS RUN (|change| >= 10%)');
  L.push(line('='));
  trending.sort((a, b) => Math.abs(b.value) - Math.abs(a.value)).slice(0, 30).forEach((m) => {
    const t = [m.schema_name, m.table_name, m.column_name].filter(Boolean).join('.');
    L.push(`  ${pad(m.project_code, 12)}${pad(t, 40)}${pad(m.metric.replace('_change_pct', ''), 14)}` +
           `${(m.value > 0 ? '+' : '')}${Number(m.value).toFixed(1)}%`);
  });
  L.push('');
}

if ((results[0] && results[0].skipped_projects) || (ctx.skipped_projects || []).length) { /* noop */ }

L.push(line('='));
L.push('  RECOMMENDED NEXT ACTIONS');
L.push(line('='));
const recs = new Map();
for (const a of allAlerts) {
  if (!a.recommendation) continue;
  const k = a.severity + '|' + a.recommendation;
  if (!recs.has(k)) recs.set(k, { severity: a.severity, text: a.recommendation, n: 0 });
  recs.get(k).n++;
}
const recList = [...recs.values()].sort(
  (a, b) => SEV.indexOf(a.severity) - SEV.indexOf(b.severity) || b.n - a.n
).slice(0, 25);
if (!recList.length) L.push('  Nothing to action. All monitored projects are healthy.');
recList.forEach((r, i) => L.push(`  ${lpad(i + 1, 3)}. [${pad(r.severity, 8)}] (${r.n}x) ${r.text}`));
L.push('');

L.push(line('='));
L.push('  END OF REPORT');
L.push(`  Generated by n8n · Supabase Monitor · run ${ctx.run_id}`);
L.push('  Full history: monitoring.mon_runs / mon_alerts / mon_metrics');
L.push(line('='));

const reportText = L.join('\n');
const fileName = 'supabase-monitor-' + startedAt.replace(/[:.]/g, '-').slice(0, 19) + '.txt';

// ── persistence payload for mon_persist_run() ─────────────────────────
const payload = {
  run: {
    id: ctx.run_id,
    started_at: startedAt,
    finished_at: finishedAt,
    duration_ms: durationMs,
    status: runStatus,
    projects_total: results.length,
    projects_ok: ok,
    projects_failed: failed,
    tables_scanned: tablesScanned,
    columns_scanned: columnsScanned,
    checks_performed: checksPerformed,
    issues_found: allAlerts.length,
    critical_count: totals.CRITICAL || 0,
    high_count: totals.HIGH || 0,
    avg_health_score: avgHealth,
    summary: { severity_counts: totals, projects: projectRuns.map((p) => ({ code: p.project_code, score: p.health_score, status: p.status })) },
  },
  project_runs: projectRuns,
  metrics: allMetrics,
  alerts: allAlerts,
  schema_snapshots: allSnapshots,
  report_text: reportText,
};

return [{
  json: {
    run_id: ctx.run_id,
    status: runStatus,
    report_to: ctx.report_to,
    file_name: fileName,
    report_text: reportText,
    subject: `[Supabase Monitor] ${runStatus} · health ${avgHealth ?? 'n/a'}/100 · ` +
             `${totals.CRITICAL || 0} critical, ${totals.HIGH || 0} high · ${results.length} project(s)`,
    summary: {
      run_id: ctx.run_id, started_at: startedAt, finished_at: finishedAt,
      projects: results.length, projects_ok: ok, projects_failed: failed,
      tables_scanned: tablesScanned, columns_scanned: columnsScanned,
      checks_performed: checksPerformed, issues_found: allAlerts.length,
      avg_health_score: avgHealth, severity_counts: totals,
      scorecard: projectRuns.map((p) => ({ code: p.project_code, score: p.health_score, grade: p.health_grade, issues: p.issues_found, status: p.status })),
    },
    payload,
  },
}];
