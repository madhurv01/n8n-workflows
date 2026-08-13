# Node Configuration — Order_Monitor

| Node | Type | Purpose | Key Parameters |
|---|---|---|---|
| **Webhook** | `n8n-nodes-base.webhook` | Entry point. Receives Supabase DB change events (`INSERT`/`UPDATE`) via realtime webhook trigger. | Method: `POST` · Path: `supabase-order-update` · No credentials required |
| **Switch** | `n8n-nodes-base.switch` | Routes the event based on `body.type` from the Supabase payload. | Output 0: `body.type == "INSERT"` → new supply request path. Output 1: `body.type == "UPDATE"` → status change path |
| **Send a message** | `n8n-nodes-base.gmail` | Notifies government admin of a new supply request (fires on `INSERT`). | To: `governmentadmin2@gmail.com` · Subject/body use `{{ $json.body.record.* }}` fields (agency_name, raw_material, stock_count, unit_type, expected_price) |
| **Send an SMS/MMS/WhatsApp message** | `n8n-nodes-base.twilio` | Sends a WhatsApp alert in parallel with the admin email (fires on `INSERT`). | From: `+14155238886` (Twilio sandbox) · To: `+917204775288` · `toWhatsapp: true` |
| **Send a message1** | `n8n-nodes-base.gmail` | Notifies vendor when order status changes (fires on `UPDATE`). | To: `testvendor2108@gmail.com` · Subject/body use `{{ $json.body.record.* }}` fields (vendor_name, raw_material, status, stock_count, unit_type, expected_price) |

## Credentials required
- **Gmail** OAuth2 credential (used by both Gmail nodes)
- **Twilio** API credential (Account SID / Auth Token)

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

## Routing logic
- `INSERT` → Gmail (admin) + Twilio WhatsApp, in parallel
- `UPDATE` → Gmail (vendor) only
- Any other `type` value → no branch matches, workflow ends silently
