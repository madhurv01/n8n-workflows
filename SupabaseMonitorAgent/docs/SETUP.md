# Node-by-node setup

Do the SQL steps first (once), then configure these nodes after importing
`workflow/workflow.json` into n8n.

## 1. Database (SQL editor, run once, in order)

```
sql/01_central_store.sql
sql/02_collector_rpc.sql
sql/03_seed_rules_and_projects.sql
```

Then edit the single row `03_seed_rules_and_projects.sql` inserted into
`monitoring.mon_projects`: set `url` to your real project URL
(`https://<project-ref>.supabase.co`). No keys go into the database.

## 2. Monitor Config (Set node)

Fill in three fields (values live only in your n8n instance):

| Field | Value |
|---|---|
| `MON_CENTRAL_URL` | `https://<project-ref>.supabase.co` |
| `MON_CENTRAL_KEY` | Settings → API → `service_role` **secret** key (not `anon`) |
| `MON_REPORT_TO` | email address(es) to receive the report, comma-separated |

This node exists because n8n's free/cloud plan blocks Code nodes from
reading `process.env` — so config is entered here instead and passed
downstream to every node that needs it.

## 3. Monitoring Schedule (Schedule Trigger)

Set the interval (default: every 6 hours). Use a Cron expression instead if
you need finer control.

## 4. Email Report (Send Email node)

1. Click the credential dropdown → **Create New Credential** → SMTP.
2. Fill in:
   - **User**: your email address
   - **Password**: an app password (for Gmail: enable 2-Step Verification,
     then generate one at https://myaccount.google.com/apppasswords)
   - **Host**: `smtp.gmail.com` (or your provider's SMTP host)
   - **Port**: `465`, **SSL/TLS**: on
3. Save the credential, select it on the node.
4. Set `fromEmail` to the same address used as **User**.

## 5. Everything else

`Prepare Run`, `Central: Bootstrap`, `Build Project Queue`,
`Project: Collect`, `Analyze Project`, `Compose Report`,
`Central: Persist Run`, `Build .txt Attachment` need no manual setup —
they read their config from `Monitor Config` / `Prepare Run` automatically.

## 6. First run

Execute the workflow manually once. Check:
- `Project: Collect` output isn't an `error` (if it is: wrong URL/key, or
  `mon_collect()` wasn't installed on the project)
- The email arrives with the attached `.txt` report
- `monitoring.mon_runs` in Supabase has a new row

Then activate the schedule trigger.

## Tuning for large databases

Edit `monitoring.mon_projects.config` (jsonb) for your project row:

| Key | Default | Effect |
|---|---|---|
| `max_tables` | 200 | largest N tables by size get profiled |
| `exact_count_max` | 5,000,000 | above this row count, size is estimated only |
| `max_profile_cols` | 40 | columns profiled per table |
| `max_fk_checks` | 60 | orphan-row checks per run |

Start with `max_tables: 50` and a 12-hour schedule on a busy production
database, then widen once you've confirmed collection time is acceptable.
