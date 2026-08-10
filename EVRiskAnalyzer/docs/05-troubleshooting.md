# Troubleshooting

Real issues hit while building and hardening this workflow, and how they were fixed. Useful if you're modifying the workflow and something breaks in a familiar-looking way.

### Groq: "Request too large ... Limit 12000, Requested 68981"

The raw Google News RSS response can be tens of thousands of tokens. Groq's free tier caps requests at 12,000 tokens/minute per model.
**Fix**: `Truncate RSS Feed` cuts the body to 9,000 characters before it reaches the AI Agent.

### AI Agent fabricates filler rows ("No relevant item found", "EMPTY") to hit 5 items

When the feed only has 2–4 genuinely relevant articles, an LLM asked for "the top 5" will sometimes invent placeholder entries to pad the count.
**Fix**: the prompt explicitly says a shorter array is correct and forbids fabrication, and `Filter Genuine News Items` independently drops anything without a real `https://` URL as a backstop.

### Supabase insert fails: `violates check constraint "ev_news_alerts_category_check"`

The LLM sometimes returns a category value that's close but not an exact match to `scooter`/`bike`/`car` (different casing, "two-wheeler", etc.).
**Fix**: `Normalize Category` maps any wording variant to one of the three exact allowed values before insert.

### Supabase error: `getaddrinfo ENOTFOUND <random-project-ref>.supabase.co`

The Supabase credential in n8n was pointed at a stale or wrong project.
**Fix**: update the credential's Host to `https://<your-actual-project-ref>.supabase.co` and make sure the Service Role Secret matches that same project (see `03-credentials.md`).

### Duplicate emails and duplicate `.txt` files sent in one run

Root cause was **item multiplication**: `Update Rows With Jira Key` is a bulk Supabase update matching multiple rows, and it returns one output item *per row updated*. Earlier versions chained the email steps directly off that node, so if 4 rows matched, the email/file steps ran 4 times.
**Fix**: `Prepare Email Content` branches directly off `Create Jira Ticket` (always exactly 1 item), not through the bulk update. `Combine News For Report` also has `Execute Once` enabled for the same reason (see below).

### `jira_ticket_key` stays `null` after the ticket is created successfully

Root cause was a **race condition**: when `Insert News Row` and the Jira/report branch both ran in parallel (fanned out from the same upstream node), the Jira ticket could be created and `Update Rows With Jira Key` could fire *before* the database inserts had actually committed — the UPDATE's `WHERE execution_id = ...` matched zero rows because they didn't exist yet.
**Fix**: `Combine News For Report` is chained *after* `Insert News Row` (restoring serial ordering) rather than running in parallel with it, while still sourcing its actual data from `$('Normalize Category').all()` to stay immune to insert-failure data loss (see next item). `Execute Once` must be enabled on this node, otherwise it would run once per inserted row and reintroduce the duplicate-email bug.

### Jira ticket has an empty description / emailed `.txt` file is empty

Root cause: when every article in a run was a duplicate (all inserts failed the unique constraint), `onError: continueRegularOutput` replaced each failed item's JSON with just `{"error": "..."}`  — wiping `title`/`url`/`category`/`summary`. Since the report was being built from `Insert News Row`'s own (now-poisoned) output, the report ended up empty.
**Fix**: `Combine News For Report`'s `jsonOutput` expression explicitly re-reads from `$('Normalize Category').all()` instead of from its own input — this data can never be poisoned by a downstream insert failure.

### A Merge node silently deadlocks and reports "success" despite never actually running the rest of the workflow

An earlier version tried to deduplicate by fetching all existing URLs into the workflow (`Get Existing News URLs`) and cross-referencing them via a `Merge` node (`chooseBranch` mode) before the Filter step. This worked when the lookup returned rows, but **hung indefinitely** whenever the table was empty (zero rows returned) — n8n's Merge node doesn't reliably treat a zero-item branch as "arrived" in `waitForAll` mode. The execution UI still showed a "success" toast and stale green checkmarks from a previous run, which made this look like everything worked when it hadn't (verify with `execute_sql` / direct Jira lookup, not just the canvas).
**Fix**: removed the lookup + Merge entirely in favor of the database-level `UNIQUE` constraint (see `04-database-schema.md`) — much simpler and no deadlock risk.

### `$('NodeName')` expression errors: "no connection back to the node"

n8n requires an actual graph connection (direct or via intermediate nodes) to a node before you can reference its data with `$('NodeName')` — even if that node already executed earlier in the same run. Two nodes running as parallel siblings can't reference each other this way.
**Fix**: make sure any node you reference with `$('NodeName')` is a genuine upstream ancestor in the connection graph, not just a node that happens to run earlier.

### `when:2d` (or similar Google News search operators) returns zero results

Adding certain search operators to the Google News RSS query URL can cause Google to return a feed with zero `<item>` entries rather than an error — this silently breaks everything downstream (empty news array, nothing to report).
**Fix**: keep the query to plain keywords; recency is handled by the AI Agent's own prompt instructions plus the feed's natural (already recency-sorted) ordering, not by search operators.

### Validation warning: `Missing discriminator "parameters.operation"` on the Gmail or Supabase node

This is generally **benign**. n8n automatically omits parameter fields that equal their default value when it saves a node (e.g. Gmail's `resource: message` is its only/default option). The strict validator flags the absence, but n8n resolves it to the same default at execution time — this doesn't change actual behavior. Don't chase this warning if the node otherwise executes correctly.
