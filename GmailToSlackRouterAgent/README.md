
<img
    src="GmailToSlackRouterAgent.png"
    alt="Build Your Own Agent Now - n8n AI Agents"
    width="100%"
  />


# Route and Categorize Gmail Emails to Slack — n8n Workflow

**Platform:** n8n (self-hosted / cloud) &nbsp;|&nbsp; **Trigger:** Gmail Trigger &nbsp;|&nbsp; **Destination:** Slack &nbsp;|&nbsp; **Nodes:** 9

A Gmail-to-Slack triage bot. Every new email is classified by **Llama 3** (via **OpenRouter**) into `Urgent`, `Sales`, `Support`, or `Other`, given a one-line summary and priority, and routed to the matching Slack channel — so a team can watch a handful of focused channels instead of a shared inbox.

---

## 1. Overview

**Useful for:**
- Splitting a shared/support inbox into topic-specific Slack channels without manual triage.
- Giving urgent emails visibility in a dedicated channel instead of getting buried.
- A reusable base template for LLM-based email routing — swap the categories, channels, or model with minimal rewiring.

---

## 2. Workflow Architecture

```
1. Gmail Trigger              → fires when a new email arrives
2. Classify Email with
   Llama 3 (HTTP Request)     → sends subject/from/snippet to OpenRouter, asks for
                                 category + priority + summary as JSON
3. Parse Classification       → parses the model's JSON reply, with a regex fallback
                                 and category/priority validation
4. Route by Category (Switch) → 4 outputs based on the parsed category

  ── one of ──
  5a. Notify #urgent-emails
  5b. Notify #sales-leads
  5c. Notify #support-tickets
  5d. Notify #general-inbox   → fallback output for "Other" / unrecognized categories
```

---

## 3. Node-by-Node Breakdown

### 1 — Gmail Trigger
**Type:** Gmail Trigger (`n8n-nodes-base.gmailTrigger`)
**Purpose:** Entry point. Polls Gmail for new incoming mail.
**Config:** `pollTimes: every minute` · `simple: true` (returns subject/from/snippet) · Credential: Gmail OAuth2

### 2 — Classify Email with Llama 3
**Type:** HTTP Request (`n8n-nodes-base.httpRequest`)
**Purpose:** Sends the email's subject, sender, and snippet to OpenRouter's chat completions endpoint, asking Llama 3 to return strict JSON: `{category, priority, summary}`.
**Config:** `POST https://openrouter.ai/api/v1/chat/completions` · `model: meta-llama/llama-3-8b-instruct` · `temperature: 0.2` · Authentication: generic Bearer token · `neverError: true` (lets a bad response flow to the parser instead of failing the run)

### 3 — Parse Classification
**Type:** Code (`n8n-nodes-base.code`)
**Purpose:** Parses the model's JSON reply out of `choices[0].message.content`. If the model wraps the JSON in extra text, a regex fallback extracts the `{...}` block. Validates `category` is one of `Urgent/Sales/Support/Other` and `priority` is one of `High/Medium/Low`, defaulting to `Other`/`Medium` otherwise so a malformed reply never breaks routing.

### 4 — Route by Category
**Type:** Switch (`n8n-nodes-base.switch`)
**Purpose:** Sends the item down one of four outputs based on `{{$json.category}}` — `Urgent`, `Sales`, `Support` as named cases, everything else via the fallback output (renamed `Other`).

### 5 — Notify #urgent-emails / #sales-leads / #support-tickets / #general-inbox
**Type:** Slack (`n8n-nodes-base.slack`, resource: `message`, operation: `post`)
**Purpose:** Posts a formatted message (priority, sender, subject, one-line summary) into the Slack channel matching the email's category.
**Config:** One node per category, each targeting a different `channelId` (by name) with the same credential.

---

## 4. Example Data Flow

| Stage | Example Value |
|---|---|
| Gmail Trigger | New email: `Subject: Server down in prod`, `From: alerts@vendor.com` |
| After Classify Email | Model reply: `{"category":"Urgent","priority":"High","summary":"Vendor reports production server outage."}` |
| After Parse Classification | `{ category: "Urgent", priority: "High", summary: "Vendor reports production server outage.", subject, from, emailId, threadId, snippet }` |
| After Route by Category | Routed to output `0` (Urgent) |
| Final Slack message | Posted to `#urgent-emails`: 🚨 *Urgent* (High priority) ... |

---

## 5. Step-by-Step Build Guide

1. **Create the trigger** — Add a **Gmail Trigger** node, polling every minute, `simple: true`.
2. **Call the LLM** — Add an **HTTP Request** node, `POST https://openrouter.ai/api/v1/chat/completions`, generic Bearer auth, with a JSON body containing a system prompt that demands strict JSON output and a user message built from the email's subject/from/snippet.
3. **Parse the reply** — Add a **Code** node that extracts and validates the model's JSON, with a fallback for malformed output.
4. **Branch by category** — Add a **Switch** node with cases for `Urgent`, `Sales`, `Support`, and a renamed fallback output for `Other`.
5. **Post to Slack** — Add four **Slack** nodes (`message` → `post`), one per Switch output, each targeting its own channel and formatting the message with priority/sender/subject/summary.
6. **Wire connections and activate** — Connect nodes in the order shown in section 2, save, and toggle the workflow **Active**.

---

## 6. Prerequisites & Setup

**Credentials required:**
- **Gmail OAuth2** — read access to the inbox being monitored.
- **OpenRouter API key** — from [openrouter.ai/keys](https://openrouter.ai/keys), used as a Bearer token. Any Llama 3 model available on OpenRouter works; the default here is `meta-llama/llama-3-8b-instruct`.
- **Slack credential** — a Bot User OAuth Token (`xoxb-...`) with `chat:write` scope, invited into all four target channels.

**Slack channels expected:** `#urgent-emails`, `#sales-leads`, `#support-tickets`, `#general-inbox` — create these (or rename the `channelId` value in each Slack node to your own channels).

**n8n environment:** Gmail Trigger v1.2, HTTP Request v4.4, Code v2, Switch v3.2, Slack v2.3, plus outbound internet access to Gmail, OpenRouter, and Slack APIs.

See `.env.example` for a sample of every credential value needed, and `docs/NODE_CONFIG.md` for full per-node parameter detail.

---

## 7. Configuring the OpenRouter Credential

1. Sign up / log in at [openrouter.ai](https://openrouter.ai) and generate an API key under **Keys**.
2. In n8n, open **Classify Email with Llama 3** → credential dropdown → **Create New Credential** → **Bearer Auth**.
3. Paste the OpenRouter key as the token, name the credential `OpenRouter account`, and save.
4. Optionally swap `meta-llama/llama-3-8b-instruct` for another Llama 3 variant available on OpenRouter (e.g. `meta-llama/llama-3-70b-instruct` for higher accuracy at higher cost).
5. Run a manual test: trigger the workflow against one real email and confirm the Slack message lands in the expected channel before activating.

---

## 8. Known Limitations

- **No conversation/thread context:** each email is classified independently using only its snippet — long threads aren't summarized as a whole.
- **Fixed category set:** only `Urgent`, `Sales`, `Support`, `Other` are supported; adding a category requires a new Switch case and Slack node.
- **No retry/backoff on the LLM call:** a transient OpenRouter error just falls through the parser's fallback (category `Other`) rather than retrying.
- **Snippet-only classification:** Gmail's short snippet may not always contain enough signal for accurate classification on terse or image-heavy emails.
- **No dedupe:** if the trigger fires twice for the same message (rare, but possible under polling), it will be classified and posted twice.

---

## 9. Suggested Improvements

- Fetch the full email body (not just the snippet) for more accurate classification on longer emails.
- Add a Slack thread reply / reaction workflow so replying "resolved" in Slack marks the Gmail thread as read or labeled.
- Add retry logic around the OpenRouter call for transient failures.
- Log every classification (email, category, priority) to a sheet or database for auditing/model-quality review.
- Add a confidence field to the model's JSON output and route low-confidence classifications to a human-review channel instead of guessing.

---

## 10. Project Files

| File | Purpose |
|---|---|
| `README.md` | This file |
| `docs/NODE_CONFIG.md` | Per-node parameter reference and reconfiguration guide |
| `n8n/GmailToSlackRouter.json` | Importable n8n workflow export |
| `.env.example` | Sample of every credential value needed (Gmail OAuth2 setup notes, OpenRouter API key, Slack bot token) |

---

*Documentation based on the exported workflow file `n8n/GmailToSlackRouter.json`.*
