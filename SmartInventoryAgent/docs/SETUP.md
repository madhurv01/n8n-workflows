# Setup & Node Configuration Reference

Step-by-step setup, plus a reference for every node in
`workflow/SmartInventoryAgent.json`, in execution order.

```
Schedule Trigger → Agent Config → Get Weather Forecast → Analyze Weather Risk
   → Get Inventory Items → Compute Inventory Actions
        ├─▶ Needs Update? → Update Inventory
        └─▶ Build Report → Send Report Email
```

---

## 0. Pre-flight checklist

Quick sanity check before you start — you'll need all of these:

- [ ] Supabase project URL and `service_role` key
- [ ] `inventory_items` table created and seeded (§2)
- [ ] Supabase credential saved in n8n (§3)
- [ ] Gmail (or alternative) credential saved in n8n (§3)
- [ ] Workflow imported or already present in your n8n instance (§4)
- [ ] `Agent Config` node updated with real location/coordinates
- [ ] One manual "Execute workflow" run completed successfully (§6)

## 1. Prerequisites

- A Supabase project with SQL editor access.
- An n8n instance you can import workflows / manage credentials on.
- A Gmail account for OAuth2 (or swap in Slack/Telegram — see §9).
- No weather API key needed — [Open-Meteo](https://open-meteo.com/) is free and keyless.

## 2. Supabase: create the inventory table

1. Supabase → **SQL Editor** → run [`sql/01_inventory_schema.sql`](../sql/01_inventory_schema.sql).
   This creates `inventory_items`, adds a unique index on `(sku, location_name)`,
   an `updated_at` trigger, 4 seed rows for `"Mumbai Warehouse"`, and an RLS
   policy allowing the `service_role`.
2. Supabase → **Project Settings → API** → copy the **Project URL** and the
   **service_role key** (not `anon` — RLS will block writes with `anon`).

### Data model: `inventory_items`

| Column | Owner | Meaning |
|---|---|---|
| `id` | Supabase | Primary key, used to target updates |
| `sku`, `item_name` | you | Product identity |
| `location_name` | you | Must match `Agent Config.location_name` exactly — scopes a run to one warehouse |
| `stock_quantity` | you / your inventory system | Current stock on hand |
| `reorder_threshold` | you | Stock level below which the item is "low" |
| `recommended_reorder_qty` | **workflow** | Computed reorder amount |
| `expedite_shipping` | **workflow** | `true` when bad weather + low stock coincide |
| `priority_level` | **workflow** | `NORMAL` / `LOW_STOCK_ONLY` / `LOW` / `MODERATE` / `HIGH` / `SEVERE` |
| `weather_risk_level`, `weather_risk_reasons` | **workflow** | Risk at last check, and why |
| `last_weather_check` | **workflow** | ISO timestamp of last evaluation |

Columns marked "workflow" are overwritten on flagged rows every run —
don't hand-edit them.

## 3. n8n credentials

- **Supabase API** credential: Host = Project URL, Service Role Secret =
  the key from step 2. Name it `Supabase account` to match the default
  node bindings.
- **Gmail OAuth2** credential: connect your Google account. Name it
  `Gmail account`.

If these already exist in your n8n instance, just point the relevant
nodes at them instead of creating new ones.

## 4. Import the workflow

1. n8n → **Workflows → Import from File** → select
   [`workflow/SmartInventoryAgent.json`](../workflow/SmartInventoryAgent.json).
2. On **Get Inventory Items** and **Update Inventory**, set the credential
   dropdown to your Supabase credential.
3. On **Send Report Email**, set it to your Gmail credential.

(If pushed in directly via the n8n API, credential IDs are already wired —
just confirm they resolve to real credentials in *your* instance.)

---

## 5. Node-by-node reference

| Node | Type | Key config |
|---|---|---|
| **Schedule Trigger** | `scheduleTrigger` | Cron `0 */6 * * *` (every 6h). Change to `0 6,18 * * *` for twice daily, `0 5 * * *` for once at 5am, etc. |
| **Agent Config** | `set` | Holds `location_name`, `latitude`, `longitude`, `supabase_table`, `low_stock_multiplier` (default 1.5), `alert_email`. Everything downstream reads from here since Code nodes can't read env vars on free/cloud plans. |
| **Get Weather Forecast** | `httpRequest` (GET) | Calls Open-Meteo with `latitude`/`longitude` from config, requesting `temperature_2m_max/min`, `precipitation_sum`, `precipitation_probability_max`, `windspeed_10m_max`, `weathercode` for `forecast_days=7`. No auth needed. |
| **Analyze Weather Risk** | `code` | Zips the daily arrays into per-day records, scores each day (rain/wind/temp/storm code — see §7), sums into `risk_score`, buckets into `risk_level` (`NONE→SEVERE`), sets `expedite_recommended` when `HIGH`/`SEVERE`. Output referenced later via `$('Analyze Weather Risk')`. |
| **Get Inventory Items** | `supabase` (`getAll`) | Table from `{{ $json.supabase_table }}`, filtered `location_name eq {{ $json.location_name }}`, `returnAll: true`. `onError: continueRegularOutput` so a brief Supabase outage doesn't crash the run. |
| **Compute Inventory Actions** | `code` | Per row: `isLowStock = stock_quantity <= reorder_threshold * low_stock_multiplier`; `expedite_shipping = isLowStock AND risk_level in (HIGH, SEVERE)`; `recommended_reorder_qty = max(reorder_threshold*2 - stock_quantity, 0)`; `action_needed = expedite_shipping OR isLowStock`. |
| **Needs Update?** | `filter` | Keeps only items where `action_needed == true`, so writes/`last_weather_check` stay meaningful. |
| **Update Inventory** | `supabase` (`update`) | Matches on `id eq {{ $json.id }}`, writes `expedite_shipping`, `priority_level`, `weather_risk_level`, `weather_risk_reasons`, `recommended_reorder_qty`, `last_weather_check`. |
| **Build Report** | `code`, `executeOnce: true` | Waits for all items (`$('Compute Inventory Actions').all()`), builds one HTML summary: risk level/reasons + a table of flagged items. |
| **Send Report Email** | `gmail` | To `alert_email`, subject includes location/risk/flagged count. Sends every run (even "all clear") as a liveness signal — add an `IF` on `flagged_count > 0` if you'd rather skip those. |

To monitor a second location, duplicate `Agent Config` → ... →
`Send Report Email` with a new name/coordinates, fed by the same
`Schedule Trigger`. Each branch runs independently and stays scoped to its
own rows via the `location_name` filter, so branches never collide.

---

## 6. Test and activate

1. Click **"Execute workflow"** to run once manually.
2. Check: `Analyze Weather Risk` output looks sane for your coordinates,
   `Get Inventory Items` returned the right rows, flagged rows updated in
   Supabase, and the report email arrived.
3. Toggle the workflow **Active** to enable the schedule.

Common cron patterns for `Schedule Trigger`, if the default doesn't fit:

| Interval | Cron |
|---|---|
| Every 6 hours (default) | `0 */6 * * *` |
| Twice daily (6am/6pm) | `0 6,18 * * *` |
| Once daily, before morning dispatch | `0 5 * * *` |
| Hourly | `0 * * * *` |

## 7. Tuning the risk model

Per forecast day, in `Analyze Weather Risk`:

| Check | Threshold | Points |
|---|---|---|
| Rain | `precipitation_sum >= 40mm` or `probability >= 80%` | +3 |
| Rain | `precipitation_sum >= 15mm` | +1 |
| Wind | `windspeed_max >= 60 km/h` | +3 |
| Wind | `windspeed_max >= 40 km/h` | +1 |
| Temperature | `tempMax >= 42°C` or `tempMin <= 0°C` | +2 |
| WMO code | severe (65,67,75,82,86,95,96,99) | +3 |
| WMO code | moderate (55,63,73,81,85) | +1 |

Score → level: `>=8 SEVERE`, `>=5 HIGH`, `>=2 MODERATE`, `>=1 LOW`, `0 NONE`.
Only `HIGH`/`SEVERE` trigger expediting. Raise the `HIGH` cutoff for fewer
false positives, lower it to act on weaker signals sooner. Adjust
`low_stock_multiplier` in `Agent Config` to change how eagerly items count
as "low stock."

## 8. Swapping the notification channel

Delete/disable `Send Report Email`, add the equivalent node
(`n8n-nodes-base.slack`, `.telegram`, `.twilio`, ...) after `Build Report`,
map `{{ $json.subject }}` / `{{ $json.report_html }}` into it, attach the
credential.

## 9. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `Get Inventory Items` returns 0 rows | `location_name` mismatch | Confirm it matches `inventory_items.location_name` exactly (case, whitespace) |
| `Update Inventory` never changes rows | Used `anon` key instead of `service_role` | Recreate the Supabase credential with the service_role key |
| Weather always `NONE`/`LOW` | Wrong lat/lon | Double-check coordinates |
| Email never arrives | Gmail OAuth2 expired/missing send scope | Re-authenticate the credential |
| Nothing updates in Supabase | Every item had `action_needed = false` | Expected when stock is healthy and weather is calm |
| `settings must NOT have additional properties` pushing via API | Extra keys (`availableInMCP`, `binaryMode`) not accepted | Strip `settings` to just `{ "executionOrder": "v1" }` |
| `request/body could not be parsed` pushing via the n8n API | UTF-8 BOM in the JSON file (common when PowerShell writes it) | Write/strip the file without a BOM, e.g. `[System.IO.File]::WriteAllText(path, json, (New-Object System.Text.UTF8Encoding $false))` |
| Report shows mangled characters (e.g. `â€”` instead of `—`) | Payload re-encoded through a tool that mis-handled UTF-8 (e.g. PowerShell `ConvertTo-Json` piped through default encoding) | Rebuild the payload with a UTF-8-safe tool (Node, or `curl --data-binary` on the original file) and re-PUT the workflow |
| Two locations' emails/updates seem to interleave or overwrite each other | Both `Agent Config` branches reference node names ambiguously (e.g. both still use the default node name) | Rename each duplicated branch's nodes uniquely, and update any `$('Node Name')` references inside its Code nodes to match |
| Workflow executes but no execution shows in n8n's history | Workflow is still inactive and you're relying on the schedule instead of manual "Execute workflow" | Toggle **Active**, or trigger manually and check the execution list immediately after |

## 10. Operating notes

- The workflow is inactive by default after import — turn on **Active**
  once you've validated a manual run.
- n8n's execution history keeps full input/output for every node on every
  run — the fastest way to debug an unexpected risk level or a Supabase
  write that didn't happen.
- If you rename `Analyze Weather Risk`, `Agent Config`, or `Compute
  Inventory Actions`, update every `$('Node Name')` reference inside the
  other Code nodes — they resolve by name, not by node ID.
- Treat the `service_role` Supabase key and the Gmail OAuth2 credential as
  secrets: they live only inside n8n's encrypted credential store, never
  in a Set/Config node or committed to this repo.
