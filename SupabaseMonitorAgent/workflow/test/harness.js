/* Offline smoke test for the Code nodes. Run:  node test/harness.js
   Simulates n8n's $(), $input and this.helpers so logic bugs surface
   before the workflow ever touches a real database. */
const fs = require('fs');
const path = require('path');
const SRC = path.join(__dirname, '..', 'src');

function runNode(file, sandbox) {
  const code = fs.readFileSync(path.join(SRC, file), 'utf8');
  const fn = new Function('$', '$input', 'Buffer', 'process', 'context',
    `return (async function(){ ${code} }).call(context)`);
  return fn(sandbox.$, sandbox.$input, Buffer, sandbox.process, sandbox.context || {});
}

const items = (arr) => ({
  all: () => arr, first: () => arr[0], last: () => arr[arr.length - 1],
});

// ── mock env ─────────────────────────────────────────────────────────
const mockProcess = { env: {} };

// ── mock "Monitor Config" node output ───────────────────────────────
const monitorConfig = {
  MON_CENTRAL_URL: 'https://central.supabase.co',
  MON_CENTRAL_KEY: 'central-key',
  MON_REPORT_TO: 'ops@example.com',
};

// ── mock collect() output ────────────────────────────────────────────
const nowIso = new Date().toISOString();
const collect = {
  collected_at: nowIso, collection_ms: 812, server_version: '15.6',
  database: 'postgres', schemas_requested: ['public'], db_size_bytes: 1024 * 1024 * 512,
  table_count: 2,
  tables: [
    {
      schema_name: 'public', table_name: 'users', fingerprint: 'fp-users-v2',
      exact_profile: true, est_rows: 1200, total_bytes: 40 * 1024 * 1024,
      heap_bytes: 30 * 1024 * 1024, index_bytes: 10 * 1024 * 1024,
      stats: { n_live_tup: 1200, n_dead_tup: 900, n_tup_ins: 5, seq_scan: 5000, idx_scan: 100,
               last_vacuum: null, last_analyze: '2025-01-01T00:00:00Z' },
      columns: [
        { name: 'id', type: 'uuid', base_type: 'uuid', ordinal: 1, nullable: false },
        { name: 'email', type: 'text', base_type: 'text', ordinal: 2, nullable: true },
        { name: 'org_id', type: 'uuid', base_type: 'uuid', ordinal: 3, nullable: true },
        { name: 'created_at', type: 'timestamptz', base_type: 'timestamptz', ordinal: 4, nullable: false },
        { name: 'updated_at', type: 'timestamptz', base_type: 'timestamptz', ordinal: 5, nullable: true },
      ],
      indexes: [{ name: 'users_pkey', is_primary: true, is_unique: true, is_valid: true,
                  size_bytes: 1024, scans: 900, columns: ['id'], definition: 'CREATE UNIQUE INDEX ...' },
                { name: 'users_junk_idx', is_primary: false, is_unique: false, is_valid: true,
                  size_bytes: 50 * 1024 * 1024, scans: 0, columns: ['email'], definition: 'CREATE INDEX ...' }],
      foreign_keys: [],
      orphans: [],
      timestamp_columns: ['created_at', 'updated_at'],
      profile: {
        row_count: 1200,
        nulls_1: 0, distinct_1: 1200,
        nulls_2: 480, empty_2: 12, blank_2: 3, sentinel_2: 5, distinct_2: 700,
        nulls_3: 0, distinct_3: 40,
        tmin_4: '2024-01-01T00:00:00Z', tmax_4: new Date(Date.now() - 5 * 3600 * 1000).toISOString(),
        w1m_4: 0, w1h_4: 0, w24h_4: 3, w7d_4: 900, future_4: 4, ancient_4: 2,
        tmin_5: '2024-01-01T00:00:00Z', tmax_5: nowIso,
        w1m_5: 0, w1h_5: 1, w24h_5: 9, w7d_5: 90, future_5: 0, ancient_5: 0,
        ts_inconsistent: 7,
      },
    },
    {
      schema_name: 'public', table_name: 'orders', fingerprint: 'fp-orders',
      exact_profile: true, est_rows: 0, total_bytes: 8192, heap_bytes: 8192, index_bytes: 0,
      stats: { n_live_tup: 0, n_dead_tup: 0, seq_scan: 2, idx_scan: 0 },
      columns: [{ name: 'id', type: 'bigint', base_type: 'int8', ordinal: 1, nullable: false },
                { name: 'user_id', type: 'uuid', base_type: 'uuid', ordinal: 2, nullable: true }],
      indexes: [], foreign_keys: [], orphans: [], timestamp_columns: [],
      profile: { row_count: 0, nulls_1: 0, distinct_1: 0, nulls_2: 0, distinct_2: 0 },
    },
  ],
};

const bootstrap = {
  projects: [
    { code: 'prod', name: 'Production', url: 'https://prod.supabase.co', schemas: ['public'], config: {} },
  ],
  rules: [
    { rule_name: 'users.email must be populated', check_type: 'null_percentage', scope: 'column',
      project_code: 'prod', schema_name: 'public', table_name: 'users', column_name: 'email',
      thresholds: { warn_pct: 1, high_pct: 5, critical_pct: 20, min_rows: 1 },
      severity: 'HIGH', priority: 10, recommendation: 'Email must always be set.' },
  ],
  prev_metrics: [
    { k: 'prod|public|users|null_pct', v: 0, at: '2026-01-01T00:00:00Z' },
    { k: 'prod|public|users||row_count', v: 4000, at: '2026-01-01T00:00:00Z' },
    { k: 'prod|public|users||total_bytes', v: 10 * 1024 * 1024, at: '2026-01-01T00:00:00Z' },
    { k: 'prod|public|users|email|null_pct', v: 5, at: '2026-01-01T00:00:00Z' },
    { k: 'prod|public|users|created_at|rows_last_24h', v: 800, at: '2026-01-01T00:00:00Z' },
  ],
  prev_schema: [
    { k: 'prod|public|users', fingerprint: 'fp-users-v1', at: '2026-01-01T00:00:00Z',
      columns: [
        { name: 'id', type: 'uuid', nullable: false },
        { name: 'email', type: 'text', nullable: false },
        { name: 'legacy_flag', type: 'boolean', nullable: true },
        { name: 'org_id', type: 'text', nullable: true },
        { name: 'created_at', type: 'timestamptz', nullable: false },
        { name: 'updated_at', type: 'timestamptz', nullable: true },
      ] },
    { k: 'prod|public|ghost_table', fingerprint: 'x', at: '2026-01-01T00:00:00Z', columns: [] },
  ],
};

(async () => {
  const $mk = (map) => (name) => items(map[name]);

  // 1 ── prepare run
  const prepare = (await runNode('01_prepare_run.js', {
    $: $mk({ 'Monitor Config': [{ json: monitorConfig }] }), $input: items([]), process: mockProcess,
  }))[0].json;
  console.log('✓ Prepare Run  run_id=%s central_url=%s', prepare.run_id, prepare.central_url);

  // 2 ── queue (single project)
  const queue = (await runNode('02_build_queue.js', {
    $: $mk({ 'Prepare Run': [{ json: prepare }] }),
    $input: items([{ json: bootstrap }]), process: mockProcess,
  })).map((i) => i.json);
  console.log('✓ Build Queue  %d project: %s', queue.length, queue.map((q) => q.project_code).join(', '));

  // 3 ── analyze: success path (real collect payload) + failure path
  //     (a bad mon_collect() response) exercised independently
  const analysed = [];
  for (const [label, httpResult] of [['success', collect], ['failure', { error: { message: 'connect ETIMEDOUT 1.2.3.4:443' } }]]) {
    const res = await runNode('03_analyze_project.js', {
      $: $mk({ 'Build Project Queue': [{ json: queue[0] }], 'Central: Bootstrap': [{ json: bootstrap }] }),
      $input: items([{ json: httpResult }]), process: mockProcess,
    });
    analysed.push(res[0]);
    const j = res[0].json;
    console.log(`✓ Analyze [${label}] ${j.project_code.padEnd(8)} status=${String(j.status).padEnd(7)} ` +
      `score=${String(j.health_score).padEnd(6)} alerts=${j.alerts.length} ` +
      `checks=${j.checks_performed} metrics=${j.metrics.length}`);
    if (j.status === 'SUCCESS') {
      const byType = {};
      j.alerts.forEach((a) => { byType[a.check_type] = (byType[a.check_type] || 0) + 1; });
      console.log('    detected:', Object.keys(byType).sort().join(', '));
    }
  }

  // 4 ── report
  const report = (await runNode('04_compose_report.js', {
    $: $mk({ 'Prepare Run': [{ json: prepare }] }),
    $input: items(analysed), process: mockProcess,
  }))[0].json;
  console.log('✓ Compose Report  %d chars, %d alerts persisted, file=%s',
    report.report_text.length, report.payload.alerts.length, report.file_name);

  // 5 ── attachment
  const att = (await runNode('05_build_attachment.js', {
    $: $mk({ 'Compose Report': [{ json: report }] }),
    $input: items([{ json: { run_id: prepare.run_id, alerts: 1 } }]),
    process: mockProcess,
    context: { helpers: { prepareBinaryData: async (buf, name, mime) =>
      ({ data: buf.toString('base64'), fileName: name, mimeType: mime, fileSize: buf.length }) } },
  }))[0];
  console.log('✓ Attachment  %s (%d bytes)', att.binary.data.fileName, att.binary.data.fileSize);

  fs.writeFileSync(path.join(__dirname, 'sample-report.txt'), report.report_text);
  console.log('\n--- sample report written to test/sample-report.txt ---\n');
  console.log(report.report_text.split('\n').slice(0, 60).join('\n'));
})().catch((e) => { console.error('HARNESS FAILED:', e); process.exit(1); });
