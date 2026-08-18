
<img
    src="StockChartAgent.png"
    alt="Build Your Own Agent Now - n8n AI Agents"
    width="100%"
  />


# StockChartAgent

An n8n workflow that scrapes **live data from TradingView** for a stock ticker you type into a form, computes real
technical analytics from it, has an AI agent (Groq, not OpenAI) write a detailed equity-research-style report, and
**emails the finished report to you as a `.txt` file via Gmail**.

- **Workflow:** `StockChartAgent` (id `4lrl9R7xJCfR7MPU`) — **Active**
- **Recipient:** reports are always emailed to a hardcoded address (the form only asks for the ticker) — see the **Send Report via Gmail** node's `sendTo` parameter

## How it works

1. **Enter Stock Symbol** (n8n Form Trigger) — a public web form with one field: a stock ticker, e.g. `AAPL`, `MSFT`,
   `TSLA`, `RELIANCE`. Submitting it starts the run.
2. **Resolve TradingView Symbol** (HTTP Request) — calls TradingView's symbol-search endpoint
   (`symbol-search.tradingview.com`) to resolve a plain ticker into TradingView's `EXCHANGE:SYMBOL` format, e.g.
   `NASDAQ:AAPL`. Requires a full, realistic browser `User-Agent` plus `Origin`/`Accept`/`Referer` headers — without
   them TradingView's CloudFront returns a bare `403 Forbidden`.
3. **Pick Best Match** (Code) — TradingView's search returns a raw JSON array, which n8n auto-splits into one item
   per result. This node reads all of those items (`$input.all()`), picks the best stock match, and maps the
   exchange to a TradingView scanner region (`america`, `india`, `uk`, `canada`, `australia`, `germany`).
4. **Fetch TradingView Market Data** (HTTP Request) — POSTs to TradingView's live screener/scanner API
   (`scanner.tradingview.com/<region>/scan`), the same data source TradingView's own website widgets use, requesting
   price, change, volume, moving averages, RSI, volatility, and performance columns for the resolved symbol.
5. **Compute Stock Analytics** (Code) — turns the raw scanner row into a clean analytics object: today's change (%,
   absolute, high/low, volume vs. 10-day average), 52-week high/low, SMA20/50/200, RSI(14), daily volatility, and
   performance for **Last 1 Week, Last 30 Days, Last 3 Months, Last 6 Months, Last 1 Year, and Year-to-Date**.
6. **Generate Stock Analysis Report** (AI Agent + Groq `llama-3.3-70b-versatile`) — writes a full plain-text report
   from the live analytics: header, today's snapshot, key technical parameters, period performance breakdown, a
   detailed narrative analysis, and a summary/outlook with a disclaimer. No OpenAI or Anthropic involved.
7. **Convert Report to TXT** — converts the AI's text output into a `.txt` binary file.
8. **Save Report to Disk** — writes a copy to `C:/Users/mohit/.n8n-files/StockChartAgent/<SYMBOL>_analysis_<date>.txt`
   on the n8n host (see *Why this exact path* below — it's not arbitrary).
9. **Send Report via Gmail** — emails the `.txt` file as an attachment to the hardcoded recipient, using the `Gmail
   account` OAuth2 credential.
10. **Deliver Report** — the form shows a plain-text confirmation once the email has been sent.

## Using it

1. Open the form trigger's **Production URL** (in the n8n editor, click the "Enter Stock Symbol" node → copy the
   Production URL).
2. Enter a ticker symbol and submit.
3. The form shows a confirmation once the email has gone out. Check the inbox for the `.txt` attachment; a copy is
   also saved on the n8n host.

## Why this exact save path

This n8n install's security config restricts the **Read/Write Files from Disk** node to a single whitelisted
directory, `~/.n8n-files` (`N8N_RESTRICT_FILE_ACCESS_TO`, defaults to that value if unset) — **any other path is
silently rejected as "not writable"**, regardless of normal OS file permissions. This is not a bug in the workflow;
it tripped us up during setup because the error message doesn't mention the whitelist at all. If you want reports
saved somewhere else, either:
- set `N8N_RESTRICT_FILE_ACCESS_TO` to include your preferred directory and restart n8n, or
- change **Save Report to Disk**'s `fileName` to a path under `C:/Users/mohit/.n8n-files/`.

Always use **forward slashes** in the path expression — backslashes break n8n's `{{ }}` expression parsing on
Windows and leave the filename literally unresolved.

## Notes & things you may want to adjust

- **Live data, not placeholders.** All price/technical/performance figures come from TradingView's own symbol-search
  and scanner endpoints at execution time — nothing is hardcoded or simulated. These are TradingView's *internal*
  endpoints (the ones their own website widgets call), not a published/versioned public API, so they are unofficial
  and **can change shape, add stricter bot-detection, or rate-limit without notice**. If a run suddenly starts
  failing, check the raw response in **Fetch TradingView Market Data** / **Resolve TradingView Symbol** first.
- **Bot-detection headers matter.** A short/truncated `User-Agent` (e.g. missing the `Chrome/... Safari/...` suffix)
  gets flagged and blocked with a `403` by TradingView's CloudFront. Keep the full realistic UA string plus
  `Origin: https://www.tradingview.com` and `Referer: https://www.tradingview.com/` on both HTTP nodes.
- **Region mapping.** The scanner endpoint is region-specific. **Pick Best Match** maps common exchanges
  (NASDAQ/NYSE/AMEX → `america`, NSE/BSE → `india`, LSE → `uk`, etc.) and defaults to `america` for anything
  unmapped — extend `regionMap` in that node for more exchanges.
- **AI model:** Uses the `Groq account` credential with `llama-3.3-70b-versatile` (no OpenAI). Swap the model in the
  **Groq Model** node, or replace it entirely to use Gemini/Anthropic (also connected on this instance).
- **Email delivery:** Uses the `Gmail account` OAuth2 credential. The recipient is hardcoded in **Send Report via
  Gmail** → `sendTo`; change it there if you want a different address, or reintroduce a form field and reference it
  instead.
- **International tickers:** enter the plain ticker (e.g. `RELIANCE`, `HSBA`, `7203`) — TradingView's symbol search
  resolves the exchange automatically. If it picks the wrong exchange for an ambiguous ticker, you can type
  `EXCHANGE:SYMBOL` directly (e.g. `NSE:RELIANCE`) and adjust **Pick Best Match** to detect the `:` and skip search.

## Verified working (2026-08-16)

A live end-to-end test run for `AAPL` was executed directly against the n8n API and confirmed:
- TradingView symbol search resolved `AAPL` → `NASDAQ:AAPL`.
- Live scanner data was fetched (price $305.93, SMA20/50/200, RSI 43.67, 1w/30d/3m/6m/1y/YTD performance).
- Groq generated the full structured report.
- The `.txt` file was saved to disk.
- The email was actually sent via Gmail (message landed in Sent/Inbox).

## Sample report output

The `.txt` file follows the six-section structure enforced by the AI agent's system prompt. An excerpt from a real
`AAPL` run:

```
REPORT HEADER
------------------------------------------------
Apple Inc., symbol NASDAQ:AAPL, listed on the NASDAQ exchange, Electronic Technology sector...

TODAY'S SNAPSHOT
------------------------------------------------
Latest price: $305.93. Today's change: +0.22% (+$0.67)...

KEY TECHNICAL PARAMETERS
------------------------------------------------
SMA20: $318.43, SMA50: $309.19, SMA200: $280.48 — price below the 20-day average suggests...
RSI(14): 43.67 — neutral, neither overbought nor oversold...

PERIOD PERFORMANCE
------------------------------------------------
Last 30 Days: -3.68% | Last 3 Months: +2.70% | Last 6 Months: +16.76% | Last 1 Year: +30.71%...

DETAILED NARRATIVE ANALYSIS
------------------------------------------------
...

SUMMARY & OUTLOOK
------------------------------------------------
... This report is for informational purposes only and is not financial advice.
```

## Project files

| File | Purpose |
|---|---|
| `README.md` | This file — overview, usage, and troubleshooting notes |
| `docs/NODE_CONFIG.md` | Per-node parameter reference and reconfiguration guide |
| `workflow.json` | Importable n8n workflow export (Workflows → Import from File), kept in sync with the live workflow |
| `sdk/workflow.sdk.ts` | n8n Workflow SDK source — optional; see `sdk/README.md` for whether you need it |
| `reports/` | Local scratch folder from earlier testing — the workflow itself now saves to `C:/Users/mohit/.n8n-files/StockChartAgent/` on the n8n host, not here |
