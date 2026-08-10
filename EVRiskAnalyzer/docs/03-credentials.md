# Credentials setup

Four credentials are required. All are configured in n8n under **Settings → Credentials**.

## 1. Groq API

- Type: `groqApi`
- Get an API key from [console.groq.com](https://console.groq.com) → API Keys
- Used by: **Groq Model** (subnode of Classify Top 5 EV News)
- Note: Groq's free tier caps requests at 12,000 tokens/minute per model — this is why the RSS feed is truncated before reaching the AI Agent (see `01-architecture.md`).

## 2. Supabase API

- Type: `supabaseApi`
- Host: `https://<your-project-ref>.supabase.co`
- Service Role Secret: from your Supabase project → **Project Settings → API → service_role secret key**
  - The `service_role` key is required (not the `anon`/publishable key) because the `ev_news_alerts` table has Row Level Security enabled with a policy that only grants access to `service_role`.
- Used by: **Insert News Row**, **Update Rows With Jira Key**

## 3. Jira Software Cloud

- Type: `jiraSoftwareCloudApi`
- Email: your Atlassian account email
- API Token: generate at [id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens)
- Domain: your Jira Cloud site, e.g. `your-domain.atlassian.net`
- Used by: **Create Jira Ticket**

## 4. Gmail OAuth2

- Type: `gmailOAuth2`
- Set up via n8n's OAuth2 flow (Credentials → New → Gmail → follow the Google sign-in prompt)
- Requires the Gmail API enabled on the underlying Google Cloud project
- Used by: **Send IT Summary Email**
- **Check this one is actually authorized** (green checkmark in n8n), not just created — an unauthorized credential will fail on first send.

## No credential needed

- **Fetch EV News (Google News RSS)** — public RSS feed, no authentication.
