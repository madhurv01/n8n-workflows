
<img
    src="EVRiskAnalyzerAgent.png"
    alt="Build Your Own Agent Now - n8n AI Agents"
    width="100%"
  />


# EV Risk Analyzer

An n8n workflow that monitors Indian electric-vehicle safety news (scooter/bike/car fires, accidents, crashes), classifies it with an LLM, deduplicates and logs it to Supabase, opens a Jira ticket, and emails IT a single plain-text summary — fully automated on a schedule.

This replaces the earlier **Conflict Risk Index** workflow (`../RiskAnalyzer/Conflict Risk Index.json`), which is no longer in use.

- **n8n workflow ID:** `WdvAxVsz5a8Ylv50`
- **n8n workflow name:** `EV Risk Analyzer`
- **Status:** ✅ Active
- **Exported JSON:** [`EV Risk Analyzer.json`](./EV%20Risk%20Analyzer.json)

## Repo structure

```
EVRiskAnalyzer/
├── README.md                    ← you are here
├── EV Risk Analyzer.json        ← exported n8n workflow (importable)
├── docs/
│   ├── 01-architecture.md       ← flow diagram + why it's built this way
│   ├── 02-build-guide.md        ← node-by-node build instructions with exact configs
│   ├── 03-credentials.md        ← credential setup for Groq / Supabase / Jira / Gmail
│   ├── 04-database-schema.md    ← ev_news_alerts table DDL and column reference
│   └── 05-troubleshooting.md    ← real issues hit while building this, and their fixes
└── images/
    ├── README.md                ← screenshot checklist (filenames referenced by docs/)
    └── *.png                    ← n8n node-config screenshots (add these — see images/README.md)
```

**Start here depending on what you need:**
- Rebuilding this from scratch → [`docs/02-build-guide.md`](docs/02-build-guide.md)
- Understanding *why* it's designed this way → [`docs/01-architecture.md`](docs/01-architecture.md)
- Something's broken and it looks familiar → [`docs/05-troubleshooting.md`](docs/05-troubleshooting.md)
- Just importing the workflow → [`EV Risk Analyzer.json`](./EV%20Risk%20Analyzer.json) + [`docs/03-credentials.md`](docs/03-credentials.md)

## What it does

```
Every 6 Hours (Schedule Trigger)
  → Fetch EV News (Google News RSS)
  → Truncate RSS Feed
  → Classify Top 5 EV News          [AI Agent: Groq llama-3.3-70b-versatile + Structured Output Parser]
  → Split News Items
  → Filter Genuine News Items       [drops anything without a real https:// URL]
  → Normalize Category              [forces category into exactly scooter/bike/car]
  → Insert News Row                 [Supabase — duplicates silently skipped via UNIQUE(url)]
  → Combine News For Report         [re-reads clean data, immune to insert failures]
  → Build Report Content
  → Create Jira Ticket              [Project: IT support system, Priority: High]
      ├→ Update Rows With Jira Key  [bulk-backfills jira_ticket_key for this run's rows]
      └→ Prepare Email Content
          → Convert Report To Text File
          → Send IT Summary Email   [Gmail, .txt attached]
```

Full node-by-node breakdown with exact expressions and parameter values: [`docs/02-build-guide.md`](docs/02-build-guide.md).

### In plain terms

1. **Fetch** — pulls a Google News RSS feed searching for Indian EV-related fires/accidents/crashes across scooters, bikes, and cars. No API key needed.
2. **Classify** — a Groq-backed AI Agent reads the raw feed and extracts up to 5 *genuinely relevant, real* articles (never fabricated), each tagged as `scooter`, `bike`, or `car`, with a short summary. It's explicitly allowed to return fewer than 5 if that's all the feed has — padding with fake entries is forbidden in the prompt.
3. **Filter + Normalize** — a safety net drops anything that isn't a real article, and forces the category into one of the three exact values the database expects.
4. **Log to Supabase** — each article becomes a row in `ev_news_alerts`. Articles already seen in a previous run are silently skipped (see [dedup design](docs/01-architecture.md#why-its-shaped-this-way)) rather than causing errors.
5. **Report** — once the DB writes are done, all of this run's articles are formatted into one numbered report.
6. **Jira ticket** — one ticket is created per run (not per article) in the **IT support system** project, priority **High**, containing the full report as its description.
7. **Backfill** — the new Jira ticket's key is written back onto every row this run inserted.
8. **Email** — exactly one email, with the same report saved as a `.txt` attachment, sent to IT via Gmail.

## Database

Supabase table `ev_news_alerts` in the **IT support system** project. Schema, constraints, and RLS policy: [`docs/04-database-schema.md`](docs/04-database-schema.md).

## Credentials

Four credentials, all already configured in this n8n instance: Groq API, Supabase API (service_role), Jira Software Cloud, Gmail OAuth2. Full setup notes: [`docs/03-credentials.md`](docs/03-credentials.md).

## Known limitations

- The Google News RSS query is keyword-based, not a structured filter — occasional loosely-related results are possible; the AI classification + filter steps are the actual relevance gate.
- Jira priority **High** was chosen to represent "P-2" since Jira Cloud's default scheme (Highest/High/Medium/Low/Lowest) has no literal "P-2" label.
- If every article in a run is a duplicate of a previous run, the Jira ticket and email steps still fire, but with an empty report. (This is arguably correct — "nothing new to report" — but worth knowing if you'd rather skip the Jira/email steps entirely on a fully-empty run. Not currently implemented.)

## History

This workflow went through several iterations while being hardened — a Groq rate-limit fix, an AI-fabrication fix, a database check-constraint fix, a duplicate-email/file fix caused by item multiplication, a race condition on the Jira-key backfill, and a Merge-node deadlock that was ultimately designed out entirely in favor of a simpler database-level dedup. All of these, and their fixes, are documented in [`docs/05-troubleshooting.md`](docs/05-troubleshooting.md) — worth reading before making further changes, since a few of these failure modes are easy to reintroduce by accident (e.g. running the insert and report branches in parallel looks harmless but reintroduces the race condition).
