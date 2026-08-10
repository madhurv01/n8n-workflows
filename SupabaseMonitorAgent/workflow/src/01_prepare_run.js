// ── NODE: "Prepare Run" (Code, run once for all items) ────────────────
// Reads configuration from the "Monitor Config" node (a Set/Edit Fields
// node) instead of process.env, since n8n's free/cloud plan blocks
// environment-variable access from Code nodes.
//
// This workflow monitors a single Supabase project. Fields expected on
// "Monitor Config":
//   MON_CENTRAL_URL   https://<project-ref>.supabase.co
//   MON_CENTRAL_KEY   service_role key of the project
// Optional:
//   MON_REPORT_TO     ops@example.com

function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

const cfg = $('Monitor Config').first().json;

const centralUrl = (cfg.MON_CENTRAL_URL || '').replace(/\/+$/, '');
const centralKey = cfg.MON_CENTRAL_KEY || '';

if (!centralUrl || !centralKey) {
  throw new Error(
    'Missing MON_CENTRAL_URL / MON_CENTRAL_KEY. Fill them in on the "Monitor Config" node.'
  );
}

return [{
  json: {
    run_id: uuidv4(),
    started_at: new Date().toISOString(),
    central_url: centralUrl,
    central_key: centralKey,
    report_to: cfg.MON_REPORT_TO || '',
  },
}];
