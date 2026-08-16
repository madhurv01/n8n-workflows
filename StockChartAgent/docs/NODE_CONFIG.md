# StockChartAgent — Node Configuration Reference

Per-node parameter reference and reconfiguration guide. Matches the live workflow at
https://hug-multitask-granny.ngrok-free.dev/workflow/4lrl9R7xJCfR7MPU and `../workflow.json`.
Every fix below was found by executing the workflow and reading the actual n8n execution error, not guessed.

---

## 1. Enter Stock Symbol — `n8n-nodes-base.formTrigger`

Public form that starts the workflow.

| Parameter | Value | Notes |
|---|---|---|
| `formFields.values[0].fieldName` | `stockSymbol` | The **only** field. Referenced downstream via `$('Enter Stock Symbol').item.json.stockSymbol` |
| `responseMode` | `lastNode` | The **last node's** output becomes the HTTP response (a plain-text confirmation) |
| `options.appendAttribution` | `false` | Removes the "n8n workflow" footer |

**Gotcha:** the field's internal key is `stockSymbol`, not its label "Stock Ticker Symbol". If you test-execute this
workflow via the API (`execute_workflow`), pass `{"stockSymbol": "AAPL"}`, not the label text.

---

## 2. Resolve TradingView Symbol — `n8n-nodes-base.httpRequest`

Resolves a plain ticker into TradingView's `EXCHANGE:SYMBOL` format via TradingView's symbol-search endpoint.

| Parameter | Value | Notes |
|---|---|---|
| `url` | `https://symbol-search.tradingview.com/symbol_search/` | Unofficial/internal endpoint, no API key |
| `queryParameters` | `text=<ticker>`, `type=stock`, `domain=production`, `lang=en` | `text` comes from `$json.stockSymbol` |
| `headerParameters` | Full Chrome `User-Agent`, `Referer`, `Origin`, `Accept: application/json` | **Required** — see the 403 note below |
| `options.response.response.neverError` | `true` | Lets a bad/empty response flow to "Pick Best Match" instead of failing the run |

**Root cause of a 403 Forbidden hit during setup:** the initial `User-Agent` was truncated (missing the `(KHTML,
like Gecko) Chrome/120.0.0.0 Safari/537.36` suffix). CloudFront treats a short/incomplete UA as a bot signature and
blocks it with an HTML `403` page (which then breaks the node with "Response body is not valid JSON" since it
expected JSON). A complete UA plus `Origin`/`Accept` fixed it. If this endpoint fails again, `curl` it directly with
these exact headers first to confirm whether it's a header issue or TradingView changed the endpoint.

---

## 3. Pick Best Match — `n8n-nodes-base.code` (JavaScript, runOnceForAllItems)

Picks the best stock match and determines which TradingView scanner region to query next.

**Root cause of a "no symbol found" bug hit during setup:** TradingView's symbol-search returns a **raw JSON array**
at the top level. n8n auto-splits a top-level array response into **one item per element** — it does not arrive as
a single item with a `.symbols` field. The original code read only `$json` (effectively one arbitrary item), so
`list` was always empty. Fixed by reading `$input.all().map(item => item.json)` (with a fallback to `.symbols` in
case a future API version wraps results in an object).

Outputs `{ tvSymbol, exchange, symbol, region, description, requestedSymbol }`, or
`{ error: true, requestedSymbol, errorMessage }` if nothing matched.

**Region mapping** (`regionMap`, extend as needed): NASDAQ/NYSE/AMEX/OTC → `america`, NSE/BSE → `india`,
LSE → `uk`, TSX/TSXV → `canada`, ASX → `australia`, XETR/FWB → `germany`; anything else defaults to `america`.

---

## 4. Fetch TradingView Market Data — `n8n-nodes-base.httpRequest`

POSTs to TradingView's live screener/scanner API — the real data source behind TradingView's own website widgets.

| Parameter | Value | Notes |
|---|---|---|
| `url` | `https://scanner.tradingview.com/{{ $json.region }}/scan` | Region-specific, from step 3 |
| `headerParameters` | Same full UA + `Origin`/`Referer`/`Content-Type` as step 2 | Same 403 risk without them |
| `jsonBody` | `{ symbols: { tickers: [tvSymbol], query: { types: [] } }, columns: [...] }` | Column order below must match the parsing in step 5 exactly |

**Columns requested, in order (index 0-30):** `description`, `close`, `change`, `change_abs`, `high`, `low`,
`volume`, `average_volume_10d_calc`, `High.1M`, `Low.1M`, `High.3M`, `Low.3M`, `High.6M`, `Low.6M`,
`price_52_week_high`, `price_52_week_low`, `Perf.W`, `Perf.1M`, `Perf.3M`, `Perf.6M`, `Perf.Y`, `Perf.YTD`,
`SMA20`, `SMA50`, `SMA200`, `RSI`, `Volatility.D`, `market_cap_basic`, `sector`, `industry`, `currency`.

**To add more data** (MACD, Bollinger Bands, EMA, etc.): append the TradingView field name to `columns` here, then
add a matching `col(N)` line in **Compute Stock Analytics**, keeping index order in sync. Field names match
TradingView's public Stock Screener.

---

## 5. Compute Stock Analytics — `n8n-nodes-base.code` (JavaScript, runOnceForAllItems)

Parses `data[0].d` (positional array, matching the column list above) into a named analytics object covering price,
technicals (SMA20/50/200, RSI14, daily volatility), and performance for 1w/30d/3m/6m/1y/YTD. If step 3 flagged an
error, or TradingView returned no `data[0].d` row, this outputs `{ symbol, error: true, errorMessage }` instead — the
AI agent is instructed to turn that into a short error message rather than a fabricated report.

---

## 6. Groq Model — `@n8n/n8n-nodes-langchain.lmChatGroq`

| Parameter | Value | Notes |
|---|---|---|
| `model` | `llama-3.3-70b-versatile` | Groq's flagship general-purpose model |
| `options.maxTokensToSample` | `4096` | Raise if reports get cut off |
| `options.temperature` | `0.4` | Lower = more consistent/factual tone |
| Credential | `Groq account` (`groqApi`) | Already connected — **not OpenAI/Anthropic**, per requirement |

---

## 7. Generate Stock Analysis Report — `@n8n/n8n-nodes-langchain.agent`

Writes the plain-text report from the analytics JSON. `options.systemMessage` is the single source of truth for the
six required sections (report header, today's snapshot, key technical parameters, period performance, narrative
analysis, summary/outlook) and enforces plain-text formatting (no `#`/`**` markdown, since this becomes a `.txt`
file). Edit it there to change structure or tone. `hasOutputParser: false` — output is plain text at `$json.output`.

---

## 8. Convert Report to TXT — `n8n-nodes-base.convertToFile`

`operation: toText`, `sourceProperty: output`, `binaryPropertyName: data`. Filename:
`{{ $('Compute Stock Analytics').item.json.symbol }}_analysis_{{ $now.toFormat('yyyy-MM-dd') }}.txt`.

---

## 9. Save Report to Disk — `n8n-nodes-base.readWriteFile`

| Parameter | Value |
|---|---|
| `fileName` | `C:/Users/mohit/.n8n-files/StockChartAgent/<SYMBOL>_analysis_<date>.txt` |
| `dataPropertyName` | `data` |

**Root cause of a "file is not writable" bug hit during setup (two separate issues):**

1. This n8n install's `SecurityConfig.restrictFileAccessTo` defaults to `~/.n8n-files` — the Read/Write File node
   is whitelisted to **only** write inside that directory. Every other path tried was silently blocked as "not
   writable" despite fine OS permissions. Found by reading n8n's own source (`isFilePathBlocked` in
   `n8n-core/.../file-system-helper-functions.js`) — the error message alone doesn't mention the whitelist.
2. Separately, a path written with **backslashes** silently broke n8n's `{{ }}` expression parser — the literal
   unresolved `{{ }}` text ended up in the filename. Fix: always use **forward slashes**, which Node accepts fine
   on Windows.

---

## 10. Send Report via Gmail — `n8n-nodes-base.gmail` (resource: `message`, operation: `send`)

| Parameter | Value | Notes |
|---|---|---|
| `sendTo` | `madhurvwork@gmail.com` | Hardcoded — the form no longer asks for an email address |
| `subject` | `Stock Analysis Report - <SYMBOL> - <date>` | |
| `options.attachmentsUi.attachmentsBinary` | `[{ property: 'data' }]` | Must match the binary field from steps 8/9 |
| Credential | `Gmail account` (`gmailOAuth2`) | Requires Gmail send scope |

**To send elsewhere:** change `sendTo` directly, or reintroduce a form field (`recipientEmail`) and reference
`{{ $('Enter Stock Symbol').item.json.recipientEmail }}` instead.

---

## 11. Deliver Report — `n8n-nodes-base.form` (operation: `completion`)

`respondWith: text` — a simple confirmation page, since the file itself was already emailed rather than downloaded.

---

## Credentials used

| Credential | Type | Used by |
|---|---|---|
| Groq account | `groqApi` | Groq Model |
| Gmail account | `gmailOAuth2` | Send Report via Gmail |

No credential is needed for the two TradingView HTTP nodes — they are public/unauthenticated endpoints identified
via browser-like headers rather than an API key.
