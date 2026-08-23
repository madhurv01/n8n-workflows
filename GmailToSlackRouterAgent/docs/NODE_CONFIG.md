# Gmail to Slack Router — Node Configuration Reference

Per-node parameter reference for `../n8n/GmailToSlackRouter.json`. Built offline (no live n8n API access at the
time) — treat this as a config map to check against the actual node UI after import, not a guarantee of exact
parameter names for your n8n version.

---

## 1. Gmail Trigger — `n8n-nodes-base.gmailTrigger`

| Parameter | Value | Notes |
|---|---|---|
| `pollTimes` | every minute | Lower/raise polling frequency to taste |
| `simple` | `true` | Returns simplified fields: `subject`, `from`, `snippet`, `id`, `threadId` |
| `filters` | `{}` | Empty — fires on every new email. Add a label/query filter here to scope which mail gets classified |
| Credential | `Gmail account` (`gmailOAuth2`) | Already exists in this n8n instance |

**To scope to specific mail:** set `filters.q` to a Gmail search query (e.g. `is:unread -category:promotions`) so
newsletters/promo mail don't get classified and routed unnecessarily.

---

## 2. Classify Email with Llama 3 — `n8n-nodes-base.httpRequest`

| Parameter | Value | Notes |
|---|---|---|
| `url` | `https://openrouter.ai/api/v1/chat/completions` | OpenRouter's OpenAI-compatible chat completions endpoint |
| `authentication` | `genericCredentialType` / `httpBearerAuth` | OpenRouter uses `Authorization: Bearer <key>` |
| `headerParameters` | `Content-Type: application/json`, `HTTP-Referer`, `X-Title` | The last two are OpenRouter-recommended (not required) attribution headers |
| `jsonBody.model` | `meta-llama/llama-3-8b-instruct` | Any Llama 3 model id available on OpenRouter works — see [openrouter.ai/models](https://openrouter.ai/models) |
| `jsonBody.temperature` | `0.2` | Low, for consistent classification |
| `jsonBody.messages[0]` (system) | Strict-JSON instruction | Demands `{"category":...,"priority":...,"summary":...}` with no markdown/extra text |
| `jsonBody.messages[1]` (user) | `Subject: ... From: ... Body: ...` | Built from the Gmail Trigger's `subject`/`from`/`snippet` |
| `options.response.response.neverError` | `true` | Lets a bad/error response flow into the parser instead of failing the run |

**To use a different provider/model:** change `url` and `model`, and adjust `authentication`/headers to match that
provider's API (e.g. `Authorization: Bearer <key>` is common across OpenAI-compatible APIs).

---

## 3. Parse Classification — `n8n-nodes-base.code` (JavaScript, runOnceForAllItems)

Reads `response.choices[0].message.content`, `JSON.parse`s it, and falls back to a regex extraction of the first
`{...}` block if the model wrapped the JSON in prose or markdown fences. Validates:

- `category` must be one of `Urgent`, `Sales`, `Support`, `Other` — anything else is coerced to `Other`.
- `priority` must be one of `High`, `Medium`, `Low` — anything else is coerced to `Medium`.

Outputs `{ category, priority, summary, subject, from, emailId, threadId, snippet }`.

**To add a category:** add it to the `allowedCategories` array here **and** add a matching case in **Route by
Category** **and** a new Slack node for it.

---

## 4. Route by Category — `n8n-nodes-base.switch`

| Output | Condition |
|---|---|
| 0 — Urgent | `{{$json.category}} == "Urgent"` |
| 1 — Sales | `{{$json.category}} == "Sales"` |
| 2 — Support | `{{$json.category}} == "Support"` |
| 3 — Other (fallback) | anything not matching the above (`options.fallbackOutput: extra`, renamed `Other`) |

---

## 5–8. Notify #urgent-emails / #sales-leads / #support-tickets / #general-inbox — `n8n-nodes-base.slack`

All four are `resource: message`, `operation: post`, differing only in `channelId.value` and emoji/label in the
message text.

| Parameter | Value | Notes |
|---|---|---|
| `select` | `channel` | Targets a channel, not a DM |
| `channelId` (resource locator) | `mode: name`, e.g. `#urgent-emails` | **Reselect in the UI** after import — n8n typically wants a real channel ID once you pick from the list, not just a typed name |
| `text` | `🚨 *Urgent* ({{$json.priority}} priority)\n*From:* {{$json.from}}\n*Subject:* {{$json.subject}}\n*Summary:* {{$json.summary}}` | Slack `mrkdwn` formatting; edit freely per channel |
| Credential | `Slack account` (`slackApi`) | Bot token, must be invited into each target channel |

**To route to a different channel:** either rename the target Slack channel to match `channelId.value`, or reselect
a different channel in the node's channel picker after import.

---

## Credentials required

| Credential name | Type | Status | Used by |
|---|---|---|---|
| `Gmail account` | `gmailOAuth2` | Already exists in this n8n instance | Gmail Trigger |
| `OpenRouter account` | `httpBearerAuth` | **Not yet created** — see `../.env.example` | Classify Email with Llama 3 |
| `Slack account` | `slackApi` | **Not yet created** — see `../.env.example` | All four Notify nodes |

See `../.env.example` for the raw values needed to create the OpenRouter and Slack credentials.
