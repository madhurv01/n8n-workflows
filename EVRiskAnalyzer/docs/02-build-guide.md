# Node-by-node build guide

Build the nodes in this order and wire each one to the previous as you go. Screenshots referenced below (`![...](../images/xx.png)`) live in [`../images/`](../images/) — see that folder's README for what to capture if they're missing.

---

## 1. Every 6 Hours — Schedule Trigger

`n8n-nodes-base.scheduleTrigger`

![Schedule Trigger](../images/02-schedule-trigger.png)

- Add node → **Schedule Trigger**
- Trigger Interval → **Hours**, Hours Between Triggers → `6`
- (Currently live-configured as every 2 days at 05:00 — adjust the interval to whatever cadence you want; hourly/6-hourly is reasonable for a news feed like this.)

No credentials needed.

---

## 2. Fetch EV News (Google News RSS) — HTTP Request

`n8n-nodes-base.httpRequest`

![HTTP Request](../images/03-http-request-rss.png)

- Method: `GET`
- URL:
  ```
  https://news.google.com/rss/search?q=India+electric+vehicle+scooter+bike+car+fire+accident+crash&hl=en-IN&gl=IN&ceid=IN:en
  ```
- Options → Response → Response Format: **Text**, Output Property Name: `body`
  (This is important — without it, n8n auto-detects the RSS/XML as an unparseable format. Forcing Text puts the raw XML into `$json.body` for the next nodes.)

No credentials needed (public feed). Connect: **Every 6 Hours → this node**.

---

## 3. Truncate RSS Feed — Set

`n8n-nodes-base.set`

![Set - Truncate](../images/04-set-truncate.png)

- Mode: **Manual Mapping**
- Include Other Fields: **On**
- Add field `body` (String), value:
  ```
  {{ $json.body.slice(0, 9000) }}
  ```

**Why**: the full RSS response is large enough to exceed Groq's 12,000 token/minute rate limit in one request. Truncating to 9,000 characters keeps the request comfortably under that limit while preserving enough of the (recency-sorted) feed to find real articles. Connect: **Fetch EV News → this node**.

---

## 4. Groq Model — Groq Chat Model (subnode)

`@n8n/n8n-nodes-langchain.lmChatGroq`

![Groq Model](../images/07-groq-model.png)

- Credential: your Groq API credential
- Model: `llama-3.3-70b-versatile`
- Options → Sampling Temperature: `0.2` (low, for consistent classification)

This is a **subnode** — add it by dragging from the "Model" connector on the AI Agent node (step 5), not as a standalone canvas node.

---

## 5. News Output Schema — Structured Output Parser (subnode)

`@n8n/n8n-nodes-langchain.outputParserStructured`

![Output Parser](../images/08-output-parser-schema.png)

- Schema Type: **Generate From JSON Example**
- JSON Example:
  ```json
  {
    "news": [
      {
        "title": "Electric scooter catches fire in Pune residential complex",
        "url": "https://example.com/news1",
        "category": "scooter",
        "summary": "A parked electric scooter caught fire due to a suspected battery malfunction; no injuries reported."
      }
    ]
  }
  ```

Also a subnode — drag from the "Output Parser" connector on the AI Agent node.

---

## 6. Classify Top 5 EV News — AI Agent

`@n8n/n8n-nodes-langchain.agent`

![AI Agent prompt](../images/05-ai-agent-prompt.png) ![AI Agent system message](../images/06-ai-agent-system-message.png)

- Source for Prompt: **Define Below**
- Prompt (User Message):
  ```
  ### LIVE NEWS FEED (Google News RSS - India EV related)
  {{ $json.body }}

  ### TASK
  Extract the TOP 5 most relevant and recent news items about Indian electric vehicle (EV) incidents - scooter, bike (two-wheeler), or car - covering topics like fires, accidents, crashes, battery explosions, or recalls.
  For each item, copy the REAL headline title and REAL article URL directly from the RSS feed (the <title> and <link> tags of each <item>). NEVER invent or paraphrase URLs.
  Classify each item into exactly one category: "scooter", "bike", or "car", based on the vehicle type actually mentioned in that specific headline - do NOT force items into categories they don't belong to.
  Write a concise summary (max 30 words) for each item, based only on the real headline/content.

  ### CRITICAL RULE - NO FABRICATION
  Only include items that are genuinely present in the feed above and genuinely relevant to EV scooter/bike/car incidents.
  If the feed contains fewer than 5 such genuinely relevant items, return ONLY that many items in the "news" array (e.g. 2, 3, or 4) - a shorter array is correct and expected.
  NEVER pad the array to reach 5 items. NEVER invent placeholder entries, and NEVER use text like "No relevant item found", "N/A", "EMPTY", or similar filler for title, url, or summary. Every single item in your output must be a real, verifiable article from the feed.
  ```
- Require Specific Output Format: **On** (this activates the Output Parser connector)
- Options → System Message:
  ```
  You are an EV Safety Intelligence Analyst. You read raw Google News RSS XML and extract only real, verifiable news items - titles and URLs must be copied exactly from the feed, never fabricated. You always respond using the required structured JSON format with a "news" array. Do not include any commentary outside the JSON.
  ```
- Options → Max Iterations: `10`
- Subnodes: **Model** → Groq Model (step 4), **Output Parser** → News Output Schema (step 5)

**Why the anti-fabrication rule is this explicit**: without it, the model would pad its output to exactly 5 items using placeholder text whenever the feed had fewer genuine matches, and that garbage would flow all the way into Supabase and the Jira ticket. Connect: **Truncate RSS Feed → this node**.

---

## 7. Split News Items — Split Out

`n8n-nodes-base.splitOut`

![Split Out](../images/09-split-out.png)

- Fields To Split Out: `output.news`
- Include: **No Other Fields**

Turns the single `{output: {news: [...]}}` item into one item per news article. Connect: **Classify Top 5 EV News → this node**.

---

## 8. Filter Genuine News Items — Filter

`n8n-nodes-base.filter`

![Filter](../images/10-filter-genuine.png)

Two conditions, combinator **AND**:

1. `{{ $json.url }}` **starts with** `https://`
2. `{{ $json.title.length }}` **is greater than** `10`

**Why**: this is the backstop against AI fabrication — even if the model ever slips a placeholder past the prompt instructions, a fake entry won't have a real `https://` URL, so it gets dropped here before it can reach the database or Jira. Connect: **Split News Items → this node**.

---

## 9. Normalize Category — Set

`n8n-nodes-base.set`

![Set - Normalize Category](../images/11-set-normalize-category.png)

- Mode: **Manual Mapping**, Include Other Fields: **On**
- Field `category` (String), value:
  ```
  {{ $json.category.toLowerCase().includes("scoot") ? "scooter" : ($json.category.toLowerCase().includes("bike") || $json.category.toLowerCase().includes("two") || $json.category.toLowerCase().includes("motor") ? "bike" : "car") }}
  ```

**Why**: the Supabase table enforces a `CHECK` constraint that `category` must be exactly `scooter`, `bike`, or `car`. The LLM occasionally returns close-but-not-exact values (different casing, "two-wheeler", etc.) which would fail that constraint. This node normalizes any wording variant into one of the three exact allowed values, defaulting to `car` if neither scooter/bike/motor/two-wheeler is mentioned. Connect: **Filter Genuine News Items → this node**.

---

## 10. Insert News Row — Supabase (create row)

`n8n-nodes-base.supabase`, resource `row`, operation `create`

![Supabase Insert](../images/12-supabase-insert.png)

- Credential: your Supabase API credential
- Table: `ev_news_alerts`
- Data to Send: **Define Below for Each Column**
- Fields:
  | Field | Value |
  |---|---|
  | `title` | `{{ $json.title }}` |
  | `url` | `{{ $json.url }}` |
  | `category` | `{{ $json.category }}` |
  | `summary` | `{{ $json.summary }}` |
  | `execution_id` | `{{ $execution.id }}` |
- **Settings tab → On Error: Continue (using regular output)**

**Why `execution_id`**: it's used later by `Update Rows With Jira Key` to identify exactly which rows belong to this run, so the Jira ticket key can be written back onto them in one bulk update rather than tracking individual row IDs.

**Why `On Error: Continue`**: `ev_news_alerts.url` has a `UNIQUE` constraint (see [`04-database-schema.md`](04-database-schema.md)). If this run's article was already inserted by a previous run, the insert fails with a unique-violation — and that's the intended, silent dedup mechanism. Without `Continue`, that single duplicate would halt the entire execution. Connect: **Normalize Category → this node**.

---

## 11. Combine News For Report — Set (raw mode)

`n8n-nodes-base.set`, mode `raw`

![Set - Combine Report](../images/13-set-combine-report.png)

- Mode: **JSON**
- JSON Output:
  ```
  {{ { "items": $('Normalize Category').all().map(i => ({ title: i.json.title, url: i.json.url, category: i.json.category, summary: i.json.summary })) } }}
  ```
- **Settings tab → Execute Once: On**

**Why this node is unusual**: it's positioned *after* `Insert News Row` purely so it only fires once the DB writes are actually finished (correct ordering for the Jira-key backfill later) — but its value expression deliberately ignores its own input (`$json`) and instead re-reads the clean, untouched data straight from `Normalize Category`. This makes the report immune to the `{"error": "..."}` JSON that a duplicate-key insert failure would otherwise leave behind on that item. **Execute Once must be enabled** — without it, this node would run once per row from `Insert News Row` and produce duplicate reports/tickets/emails downstream. Connect: **Insert News Row → this node**.

---

## 12. Build Report Content — Set

`n8n-nodes-base.set`

![Set - Build Report](../images/14-set-build-report.png)

- Mode: **Manual Mapping**
- Field `reportBody` (String):
  ```
  {{ $json.items.map((n, i) => (i + 1) + ". [" + n.category.toUpperCase() + "] " + n.title + "\nURL: " + n.url + "\nSummary: " + n.summary).join("\n\n") }}
  ```
- Field `reportDate` (String):
  ```
  {{ $now.toFormat("dd LLL yyyy") }}
  ```

Connect: **Combine News For Report → this node**.

---

## 13. Create Jira Ticket — Jira (create issue)

`n8n-nodes-base.jira`, resource `issue`, operation `create`

![Jira Create Issue](../images/15-jira-create-issue.png)

- Credential: your Jira Software Cloud credential
- Project: select your target project (resolved to a Project ID)
- Issue Type: `Task`
- Summary:
  ```
  {{ "EV Safety Alert: Top 5 Trending EV News (" + $json.reportDate + ")" }}
  ```
- Additional Fields → Description:
  ```
  {{ $json.reportBody }}
  ```
- Additional Fields → Priority: `High` (Jira Cloud's default scheme has no literal "P-2" — `High` was chosen to match that intent)

Connect: **Build Report Content → this node**.

---

## 14. Update Rows With Jira Key — Supabase (update row)

`n8n-nodes-base.supabase`, resource `row`, operation `update`

![Supabase Update](../images/16-supabase-update.png)

- Table: `ev_news_alerts`
- Filter (Must Match: **All Filters**): `execution_id` **equals** `{{ $execution.id }}`
- Field to update: `jira_ticket_key` → `{{ $json.key }}`
- **Settings tab → On Error: Continue (using regular output)**

Bulk-updates every row inserted by this run (matched via `execution_id`) with the Jira ticket key. Because this node is downstream of `Create Jira Ticket`, which is itself downstream of `Insert News Row`, the ordering is guaranteed correct — the rows always exist before this update runs. Connect: **Create Jira Ticket → this node** (side branch, terminal — nothing connects onward from here).

---

## 15. Prepare Email Content — Set

`n8n-nodes-base.set`

![Set - Prepare Email](../images/17-set-prepare-email.png)

- Mode: **Manual Mapping**, Include Other Fields: **Off**
- Field `reportBody`: `{{ $('Build Report Content').item.json.reportBody }}`
- Field `reportDate`: `{{ $('Build Report Content').item.json.reportDate }}`
- Field `jiraKey`: `{{ $('Create Jira Ticket').item.json.key }}`

Connect: **Create Jira Ticket → this node** (parallel branch alongside step 14, both stemming from Create Jira Ticket).

---

## 16. Convert Report To Text File — Convert to File

`n8n-nodes-base.convertToFile`, operation `toText`

![Convert to File](../images/18-convert-to-file.png)

- Operation: **Move to Text File** (`toText`)
- Source Property: `reportBody`
- Options → File Name: `ev_news_summary.txt`

Connect: **Prepare Email Content → this node**.

---

## 17. Send IT Summary Email — Gmail

`n8n-nodes-base.gmail`, resource `message`, operation `send`

![Gmail Send](../images/19-gmail-send.png)

- Credential: your Gmail OAuth2 credential
- To: the IT recipient's email address
- Subject:
  ```
  {{ 'EV Safety Alert: Top 5 Trending EV News - ' + $('Prepare Email Content').item.json.reportDate + ' (Jira ' + $('Prepare Email Content').item.json.jiraKey + ')' }}
  ```
- Email Type: **Text**
- Message:
  ```
  {{ 'Attached is the summary of the top EV-related news items detected in this monitoring cycle (' + $('Prepare Email Content').item.json.reportDate + ').\n\nJira ticket created: ' + $('Prepare Email Content').item.json.jiraKey + '\n\nFull details, including source URLs, are in the attached .txt file.' }}
  ```
- Options → Attachments → Attachment (Binary): property name `data`

Connect: **Convert Report To Text File → this node**. This is the last node in the chain.

---

## Wiring summary

```
Every 6 Hours
  → Fetch EV News (Google News RSS)
  → Truncate RSS Feed
  → Classify Top 5 EV News  [+ Groq Model, + News Output Schema as subnodes]
  → Split News Items
  → Filter Genuine News Items
  → Normalize Category
  → Insert News Row
  → Combine News For Report
  → Build Report Content
  → Create Jira Ticket
      → Update Rows With Jira Key   (branch 1, terminal)
      → Prepare Email Content        (branch 2)
          → Convert Report To Text File
          → Send IT Summary Email
```
