// ── NODE: "Build .txt Attachment" (Code, run once for all items) ──────
// Runs AFTER persistence so the HTTP node cannot strip the binary.

const rep = $('Compose Report').first().json;
const persist = (() => {
  try {
    const p = $input.first().json;
    const r = Array.isArray(p) ? p[0] : p;
    return { ok: !!(r && r.run_id), detail: r };
  } catch (e) { return { ok: false, detail: { error: String(e) } }; }
})();

const buffer = Buffer.from(rep.report_text, 'utf8');
const binary = await this.helpers.prepareBinaryData(buffer, rep.file_name, 'text/plain');

const s = rep.summary;
const bodyLines = [
  `Supabase Monitoring run ${s.run_id}`,
  '',
  `Status            : ${rep.status}`,
  `Started (UTC)     : ${s.started_at}`,
  `Finished (UTC)    : ${s.finished_at}`,
  `Projects          : ${s.projects} (ok ${s.projects_ok} / failed ${s.projects_failed})`,
  `Tables scanned    : ${s.tables_scanned}`,
  `Checks performed  : ${s.checks_performed}`,
  `Issues detected   : ${s.issues_found}`,
  `Average health    : ${s.avg_health_score ?? 'n/a'} / 100`,
  '',
  'Severity: ' + Object.entries(s.severity_counts).map(([k, v]) => `${k}=${v}`).join('  '),
  '',
  'Scorecard:',
  ...s.scorecard.map((p) =>
    `  - ${p.code.padEnd(18)} ${String(p.score).padStart(6)} (${p.grade})  issues: ${p.issues}  [${p.status}]`),
  '',
  `History persisted to Supabase: ${persist.ok ? 'yes' : 'NO — check the persist step'}`,
  '',
  'The full plain-text report is attached.',
];

return [{
  json: {
    ...rep,
    persisted: persist.ok,
    persist_detail: persist.detail,
    email_body: bodyLines.join('\n'),
  },
  binary: { data: binary },
}];
