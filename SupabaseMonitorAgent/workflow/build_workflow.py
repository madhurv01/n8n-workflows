#!/usr/bin/env python3
"""Assemble workflow.json from the readable JS sources in ./src."""
import json, os, pathlib

HERE = pathlib.Path(__file__).parent
SRC = HERE / "src"


def js(name):
    return (SRC / name).read_text(encoding="utf-8")


HDR = {"parameters": [
    {"name": "Content-Type", "value": "application/json"},
    {"name": "Accept", "value": "application/json"},
]}


def supa_headers(key_expr):
    return {"parameters": [
        {"name": "apikey", "value": key_expr},
        {"name": "Authorization", "value": "=Bearer " + key_expr[1:] if key_expr.startswith("=") else key_expr},
        {"name": "Content-Type", "value": "application/json"},
        {"name": "Accept", "value": "application/json"},
    ]}


nodes = []


def node(name, ntype, tv, params, pos, extra=None):
    n = {"parameters": params, "id": name.lower().replace(" ", "-").replace(":", "").replace(".", ""),
         "name": name, "type": ntype, "typeVersion": tv, "position": pos}
    if extra:
        n.update(extra)
    nodes.append(n)
    return n


# 1 ── Schedule -------------------------------------------------------
node("Monitoring Schedule", "n8n-nodes-base.scheduleTrigger", 1.2, {
    "rule": {"interval": [{"field": "hours", "hoursInterval": 6}]}
}, [-680, 300], {"notes": "Change the interval here. Use a Cron expression for finer control."})

# 2 ── Config (n8n free/cloud can't read process.env from a Code node,
#      so config values are entered here and passed down instead) ----
node("Monitor Config", "n8n-nodes-base.set", 3.4, {
    "mode": "manual",
    "assignments": {"assignments": [
        {"id": "central-url", "name": "MON_CENTRAL_URL",
         "value": "https://<project-ref>.supabase.co", "type": "string"},
        {"id": "central-key", "name": "MON_CENTRAL_KEY",
         "value": "<service_role key of the project>", "type": "string"},
        {"id": "mon-report-to", "name": "MON_REPORT_TO",
         "value": "ops@example.com", "type": "string"},
    ]},
    "options": {},
}, [-680, 480], {"notes": "n8n free/cloud plan can't read process.env in a Code node. "
                          "Fill in your real values here instead — this node feeds "
                          "\"Prepare Run\". Single-project mode: one Supabase project "
                          "holds both the monitoring tables and the data being monitored. "
                          "Consider restricting this workflow's sharing/credentials access "
                          "since values are stored in the workflow JSON."})

# 3 ── Prepare Run ------------------------------------------------------
node("Prepare Run", "n8n-nodes-base.code", 2, {
    "mode": "runOnceForAllItems", "jsCode": js("01_prepare_run.js")
}, [-460, 300])

# 3 ── Central bootstrap ---------------------------------------------
node("Central: Bootstrap", "n8n-nodes-base.httpRequest", 4.2, {
    "method": "POST",
    "url": "={{ $json.central_url }}/rest/v1/rpc/mon_bootstrap",
    "sendHeaders": True,
    "headerParameters": supa_headers("={{ $json.central_key }}"),
    "sendBody": True,
    "specifyBody": "json",
    "jsonBody": "={{ JSON.stringify({ p_project_codes: null }) }}",
    "options": {"timeout": 60000},
}, [-240, 300], {"retryOnFail": True, "maxTries": 3, "waitBetweenTries": 3000,
                 "notes": "Loads projects + rules + previous metrics + previous schema in ONE call."})

# 4 ── Build queue ----------------------------------------------------
node("Build Project Queue", "n8n-nodes-base.code", 2, {
    "mode": "runOnceForAllItems", "jsCode": js("02_build_queue.js")
}, [-20, 300])

# 5 ── Collect --------------------------------------------------------
node("Project: Collect", "n8n-nodes-base.httpRequest", 4.2, {
    "method": "POST",
    "url": "={{ $json.url }}/rest/v1/rpc/mon_collect",
    "sendHeaders": True,
    "headerParameters": supa_headers("={{ $json.key }}"),
    "sendBody": True,
    "specifyBody": "json",
    "jsonBody": "={{ JSON.stringify({ p_schemas: $json.schemas, p_max_tables: $json.max_tables, p_exact_count_max: $json.exact_count_max, p_max_profile_cols: $json.max_profile_cols, p_max_fk_checks: $json.max_fk_checks }) }}",
    "options": {"timeout": 600000, "response": {"response": {"neverError": True, "fullResponse": False}}},
}, [200, 300], {
    "onError": "continueRegularOutput", "retryOnFail": True, "maxTries": 2, "waitBetweenTries": 5000,
    "alwaysOutputData": True,
    "notes": "A failed collection never stops the run: the error flows through and becomes a CRITICAL alert.",
})

# 6 ── Analyze --------------------------------------------------------
node("Analyze Project", "n8n-nodes-base.code", 2, {
    "mode": "runOnceForAllItems", "jsCode": js("03_analyze_project.js")
}, [420, 300], {"onError": "continueRegularOutput", "alwaysOutputData": True,
                "notes": "Rules engine + anomaly detection + health score. Never throws."})

# 7 ── Compose report -------------------------------------------------
node("Compose Report", "n8n-nodes-base.code", 2, {
    "mode": "runOnceForAllItems", "jsCode": js("04_compose_report.js")
}, [640, 300])

# 8 ── Persist --------------------------------------------------------
node("Central: Persist Run", "n8n-nodes-base.httpRequest", 4.2, {
    "method": "POST",
    "url": "={{ $('Prepare Run').first().json.central_url }}/rest/v1/rpc/mon_persist_run",
    "sendHeaders": True,
    "headerParameters": supa_headers("={{ $('Prepare Run').first().json.central_key }}"),
    "sendBody": True,
    "specifyBody": "json",
    "jsonBody": "={{ JSON.stringify({ payload: $json.payload }) }}",
    "options": {"timeout": 300000},
}, [860, 300], {"onError": "continueRegularOutput", "retryOnFail": True, "maxTries": 3,
                "waitBetweenTries": 5000, "alwaysOutputData": True,
                "notes": "Writes run + project runs + metrics + alerts + schema snapshots in ONE call."})

# 9 ── Attachment -------------------------------------------------------
node("Build .txt Attachment", "n8n-nodes-base.code", 2, {
    "mode": "runOnceForAllItems", "jsCode": js("05_build_attachment.js")
}, [1080, 300])

# 10 ── Email -------------------------------------------------------------
node("Email Report", "n8n-nodes-base.emailSend", 2.1, {
    "fromEmail": "supabase-monitor@example.com",
    "toEmail": "={{ $json.report_to || 'ops@example.com' }}",
    "subject": "={{ $json.subject }}",
    "emailFormat": "text",
    "text": "={{ $json.email_body }}",
    "options": {"attachments": "data", "appendAttribution": False},
}, [1300, 300], {
    "credentials": {"smtp": {"id": "REPLACE_WITH_SMTP_CREDENTIAL_ID", "name": "SMTP account"}},
    "retryOnFail": True, "maxTries": 3, "waitBetweenTries": 5000,
    "notes": "Set fromEmail and select your SMTP credential. Recipient comes from MON_REPORT_TO.",
})

# Sticky note ---------------------------------------------------------
nodes.append({
    "parameters": {
        "content": (
            "## Supabase Single-Project Monitoring & Data Quality\n\n"
            "**Setup**\n"
            "1. Run `sql/01_central_store.sql` + `sql/02_collector_rpc.sql` + "
            "`sql/03_seed_rules_and_projects.sql` on your ONE Supabase project — it holds both "
            "the monitoring tables and the data being monitored.\n"
            "2. Open the **Monitor Config** node and fill in `MON_CENTRAL_URL`, `MON_CENTRAL_KEY`, "
            "and `MON_REPORT_TO` (no environment variables needed — works on free/cloud n8n).\n"
            "3. Pick your SMTP credential on **Email Report** and set `fromEmail`.\n\n"
            "All discovery + profiling happens inside `mon_collect()` (one round trip), "
            "which is why so few nodes cover any number of tables."
        ),
        "height": 420, "width": 480, "color": 4,
    },
    "id": "setup-note", "name": "README", "type": "n8n-nodes-base.stickyNote",
    "typeVersion": 1, "position": [-700, -220],
})

connections = {
    "Monitoring Schedule": {"main": [[{"node": "Monitor Config", "type": "main", "index": 0}]]},
    "Monitor Config": {"main": [[{"node": "Prepare Run", "type": "main", "index": 0}]]},
    "Prepare Run": {"main": [[{"node": "Central: Bootstrap", "type": "main", "index": 0}]]},
    "Central: Bootstrap": {"main": [[{"node": "Build Project Queue", "type": "main", "index": 0}]]},
    "Build Project Queue": {"main": [[{"node": "Project: Collect", "type": "main", "index": 0}]]},
    "Project: Collect": {"main": [[{"node": "Analyze Project", "type": "main", "index": 0}]]},
    "Analyze Project": {"main": [[{"node": "Compose Report", "type": "main", "index": 0}]]},
    "Compose Report": {"main": [[{"node": "Central: Persist Run", "type": "main", "index": 0}]]},
    "Central: Persist Run": {"main": [[{"node": "Build .txt Attachment", "type": "main", "index": 0}]]},
    "Build .txt Attachment": {"main": [[{"node": "Email Report", "type": "main", "index": 0}]]},
}

workflow = {
    "name": "Supabase DB Monitoring & Data Quality",
    "nodes": nodes,
    "connections": connections,
    "active": False,
    "pinData": {},
    "settings": {
        "executionOrder": "v1",
        "saveManualExecutions": True,
        "saveExecutionProgress": True,
        "timezone": "Asia/Kolkata",
        "executionTimeout": 3600,
    },
    "tags": [{"name": "supabase"}, {"name": "monitoring"}, {"name": "data-quality"}],
    "meta": {"instanceId": "supabase-monitor"},
}

out = HERE / "workflow.json"
out.write_text(json.dumps(workflow, indent=2), encoding="utf-8")
print("wrote", out, os.path.getsize(out), "bytes,", len(nodes), "nodes")
