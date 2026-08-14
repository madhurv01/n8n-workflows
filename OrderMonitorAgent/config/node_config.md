# Node Configuration — Order_Monitor

Detailed per-node reference for every node in `workflow/Order_Monitor.json`.
Use this alongside the README when wiring up credentials or debugging a
specific branch of the workflow.

---

## 1. Webhook
- **Type:** `n8n-nodes-base.webhook` (v2.1)
- **Role:** Entry point of the whole workflow. Supabase calls this node
  directly whenever a row in the supply-request table is inserted or
  updated (configured as a Postgres/DB webhook or a Realtime hook on the
  Supabase side).
- **HTTP Method:** `POST`
- **Path:** `supabase-order-update`
  (full URL = `<n8n-host>/webhook/supabase-order-update`)
- **Response mode:** Responds immediately with `"Workflow got started."` so
  Supabase's webhook call doesn't block waiting on email/SMS delivery.
- **Credentials:** None — it's a public inbound endpoint, so protect it at
  the network layer (firewall, secret path segment, or Supabase's built-in
  webhook signing) rather than with n8n credentials.
- **Output:** Raw request body under `$json.body`, forwarded to Switch.

## 2. Switch
- **Type:** `n8n-nodes-base.switch` (v3.4)
- **Role:** The single decision point in the workflow. Reads
  `$json.body.type` (set by Supabase to describe what kind of change just
  happened) and sends the item down one of two outputs.
- **Rule 1 (Output 0):** `body.type equals "INSERT"` — a brand-new supply
  request was created. Feeds both `Send a message` and
  `Send an SMS/MMS/WhatsApp message` in parallel.
- **Rule 2 (Output 1):** `body.type equals "UPDATE"` — an existing
  request's fields (usually `status`) changed. Feeds `Send a message1`.
- **Fallback:** None configured. Any other `type` value (e.g. `DELETE`)
  matches no rule and the item is silently dropped — no notification is
  sent and no error is raised.
- **Comparison mode:** Strict string equality, case-sensitive.

## 3. Send a message (Gmail — admin notification)
- **Type:** `n8n-nodes-base.gmail` (v2.2) · fires on the **INSERT** branch
- **Role:** Alerts the government admin that a new supply request needs
  review.
- **To:** `governmentadmin2@gmail.com`
- **Subject:** `New Supply Request: {{ record.raw_material }}`
- **Body fields used:** `agency_name`, `raw_material`, `stock_count`,
  `unit_type`, `expected_price` — all pulled from `$json.body.record`.
- **Format:** HTML email with inline styling.
- **`alwaysOutputData: true`** — keeps the item flowing even if Gmail
  returns an unusual/empty response, so downstream nodes (if any) don't
  break the run.

## 4. Send an SMS/MMS/WhatsApp message (Twilio)
- **Type:** `n8n-nodes-base.twilio` (v1) · fires on the **INSERT** branch,
  in parallel with the admin email
- **Role:** Gives admins a mobile-first alert via WhatsApp in case the
  email is missed.
- **From:** `+14155238886` (Twilio's shared WhatsApp sandbox number)
- **To:** `+917204775288` (fixed recipient)
- **`toWhatsapp: true`** — routes through Twilio's WhatsApp channel rather
  than plain SMS.
- **Message fields used:** `agency_name`, `raw_material`, `expected_price`.
- **Note:** the sandbox number requires the recipient to have opted in via
  Twilio's WhatsApp sandbox join code before messages will deliver; swap
  in a production WhatsApp sender for real use.

## 5. Send a message1 (Gmail — vendor notification)
- **Type:** `n8n-nodes-base.gmail` (v2.2) · fires on the **UPDATE** branch
- **Role:** Tells the vendor their request's status has changed (e.g.
  approved, countered, rejected).
- **To:** `testvendor2108@gmail.com`
- **Subject:** `Update on Order: {{ record.raw_material }}`
- **Body fields used:** `vendor_name`, `raw_material`, `status`,
  `stock_count`, `unit_type`, `expected_price`.
- **Format:** HTML email, highlights the current `status` value and
  directs the vendor to the Vendor Hub to respond to any counter-offer.
- **`alwaysOutputData: true`** — same reasoning as node 3.

---

## Credentials required
| Credential | Used by | Notes |
|---|---|---|
| Gmail OAuth2 | `Send a message`, `Send a message1` | One shared credential is fine since both send from the same mailbox |
| Twilio API (Account SID + Auth Token) | `Send an SMS/MMS/WhatsApp message` | Sandbox numbers work for testing; use a verified sender in production |

See `.env.example` for the environment variable names to populate before
setting these credentials up in n8n.

## Expected webhook payload (Supabase DB Webhook / Realtime)
```json
{
  "type": "INSERT | UPDATE",
  "record": {
    "agency_name": "string",
    "vendor_name": "string",
    "raw_material": "string",
    "stock_count": "number",
    "unit_type": "string",
    "expected_price": "number",
    "status": "string"
  }
}
```

## Routing logic summary
- `INSERT` → Gmail (admin) **+** Twilio WhatsApp, sent in parallel
- `UPDATE` → Gmail (vendor) only
- Any other `type` value → no Switch rule matches, workflow ends silently
  with no notification sent
