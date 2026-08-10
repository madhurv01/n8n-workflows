# Architecture

## Flow diagram

```
Every 6 Hours (Schedule Trigger)
        │
        ▼
Fetch EV News (Google News RSS)  [HTTP Request]
        │
        ▼
Truncate RSS Feed  [Set]
        │
        ▼
Classify Top 5 EV News  [AI Agent] ──uses──▶ Groq Model [Groq Chat Model]
        │                          ──uses──▶ News Output Schema [Structured Output Parser]
        ▼
Split News Items  [Split Out]
        │
        ▼
Filter Genuine News Items  [Filter]
        │
        ▼
Normalize Category  [Set]
        │
        ▼
Insert News Row  [Supabase: create row]  ──▶ writes to ev_news_alerts
        │
        ▼
Combine News For Report  [Set, raw mode, Execute Once]
        │
        ▼
Build Report Content  [Set]
        │
        ▼
Create Jira Ticket  [Jira: create issue]
        │
        ├──▶ Update Rows With Jira Key  [Supabase: update row]  (side branch, terminal)
        │
        └──▶ Prepare Email Content  [Set]
                     │
                     ▼
             Convert Report To Text File  [Convert to File]
                     │
                     ▼
             Send IT Summary Email  [Gmail]
```

## Why it's shaped this way

**Everything is a strict linear chain, not parallel branches — on purpose.**
An earlier version of this workflow fanned `Normalize Category` out into two parallel branches (one to insert rows, one to build the report). That seemed faster, but it created a **race condition**: the Jira ticket could get created and its key written back to Supabase *before* the row inserts had actually committed, silently updating zero rows. The fix was to make `Insert News Row → Combine News For Report` a serial dependency again, so nothing downstream can run before the inserts are done — at the cost of a few hundred milliseconds, in exchange for correctness.

**`Combine News For Report` doesn't read its own input.**
It's positioned *after* `Insert News Row` purely for **timing** (so it only fires once inserts are finished), but its actual `jsonOutput` expression explicitly pulls fresh data from `$('Normalize Category').all()` instead of from `$json` (the Insert Row node's output). This matters because if `Insert News Row` fails on a duplicate URL (expected and handled — see below), n8n's `continueRegularOutput` error handling replaces that item's JSON with just `{"error": "..."}`, which would otherwise poison the report with blank titles/URLs. Sourcing from `Normalize Category` instead makes the report immune to insert failures.

**Deduplication happens at the database, not in the workflow graph.**
An earlier version tried to fetch all existing URLs into the workflow and cross-reference them with a Merge node before inserting. This required routing a completely separate branch through a `chooseBranch`-mode Merge node just so `$('Get Existing News URLs')` was a valid expression reference (n8n requires an actual graph connection to a node before you can reference it by name, even if that node already executed in the same run). It also **deadlocked**: n8n's Merge node can hang indefinitely waiting for a second input if that branch returns zero items — which is exactly what happens on an empty or fully-deduplicated table. The final design is much simpler: `ev_news_alerts.url` has a `UNIQUE` constraint, and `Insert News Row` has `onError: continueRegularOutput` — a duplicate insert just fails silently for that one row and the workflow moves on. No lookup branch, no Merge node, no deadlock risk.

**The AI Agent is explicitly told it's allowed to return fewer than 5 items.**
Early versions asked the model for exactly 5 items, and when the real feed only had 2–3 genuinely relevant articles, the model **fabricated filler entries** (`"No relevant item found"`, `"EMPTY"`, etc.) to hit the count — which then got inserted into the database and Jira ticket as garbage rows. The fix has two layers: (1) the prompt explicitly forbids padding and says a shorter array is correct, and (2) `Filter Genuine News Items` independently drops any item without a real `https://` URL or a title of reasonable length, as a backstop in case the model doesn't fully comply.

**The RSS feed is truncated before it reaches the LLM.**
The raw Google News RSS response for this query is large enough (tens of thousands of tokens) to exceed Groq's free-tier rate limit (12,000 tokens/minute) in a single request. `Truncate RSS Feed` cuts the body to the first 9,000 characters — comfortably under the limit — while still leaving enough of the (recency-ordered) feed for the model to find real, relevant articles.

**Gmail instead of SMTP.**
The workflow originally used the generic SMTP `Send Email` node, which was noticeably slower (a full SMTP handshake per send) than the Gmail node's single authenticated API call. Since a Gmail OAuth2 credential was already available, the SMTP node was swapped out.

## Design decisions log (chronological)

| Decision | Reason |
|---|---|
| Groq model: `llama-3.3-70b-versatile` | Flagship model, avoids the legacy `llama3-8b-8192` default |
| Structured Output Parser instead of free-text parsing | Guarantees `news` is a real JSON array the rest of the graph can rely on |
| `execution_id` column added to `ev_news_alerts` | Lets `Update Rows With Jira Key` target exactly the rows from *this* run |
| `UNIQUE` constraint on `ev_news_alerts.url` | Database-level dedup guarantee, simpler and more robust than an in-workflow lookup |
| `onError: continueRegularOutput` on both Supabase nodes | A duplicate-key error or a zero-row update should not fail the whole execution |
| Report data sourced via `$('Normalize Category').all()`, not from Insert Row's output | Immune to data loss when `onError` replaces a failed item's JSON |
