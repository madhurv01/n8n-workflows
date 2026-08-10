// ── NODE: "Build Project Queue" (Code, run once for all items) ────────
// Single-project mode: takes the one project row returned by
// mon_bootstrap() (registered in monitoring.mon_projects) and emits a
// single item carrying its collection config. Auth reuses the project
// URL/key from "Prepare Run" — there is only one project.

const ctx = $('Prepare Run').first().json;
const boot = $input.first().json;

// PostgREST returns the jsonb result directly for `returns jsonb` RPCs.
const payload = Array.isArray(boot) ? boot[0] : boot;
const projects = payload.projects || [];

if (!projects.length) {
  throw new Error(
    'No project found in monitoring.mon_projects. Seed exactly one row (enabled=true).'
  );
}

const p = projects[0];
const cfg = p.config || {};

return [{
  json: {
    run_id: ctx.run_id,
    started_at: ctx.started_at,
    project_code: p.code,
    project_name: p.name,
    url: (p.url || ctx.central_url).replace(/\/+$/, ''),
    key: ctx.central_key,
    schemas: p.schemas && p.schemas.length ? p.schemas : ['public'],
    max_tables: cfg.max_tables ?? 200,
    exact_count_max: cfg.exact_count_max ?? 5000000,
    max_profile_cols: cfg.max_profile_cols ?? 40,
    max_fk_checks: cfg.max_fk_checks ?? 60,
  },
}];
