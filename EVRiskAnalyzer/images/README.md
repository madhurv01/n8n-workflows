# Screenshots needed here

I can't capture live screenshots of the n8n UI from this session (no browser/GUI access), so this folder is a placeholder. To finish the docs, open each node listed below in n8n, take a screenshot of its **Parameters** panel, and save it here with the exact filename shown — the guides in `../docs/` already reference these filenames.

| Filename | Node | What to capture |
|---|---|---|
| `01-canvas-overview.png` | (whole canvas) | Full workflow canvas, zoomed to fit (`1` key in n8n) |
| `02-schedule-trigger.png` | Every 6 Hours | Parameters panel showing the interval config |
| `03-http-request-rss.png` | Fetch EV News (Google News RSS) | Parameters panel showing the URL and Options > Response Format |
| `04-set-truncate.png` | Truncate RSS Feed | Parameters panel showing the `body` assignment expression |
| `05-ai-agent-prompt.png` | Classify Top 5 EV News | Parameters panel showing the Prompt (User Message) field |
| `06-ai-agent-system-message.png` | Classify Top 5 EV News | Options > System Message field expanded |
| `07-groq-model.png` | Groq Model | Parameters panel showing model name + credential |
| `08-output-parser-schema.png` | News Output Schema | Parameters panel showing the JSON schema example |
| `09-split-out.png` | Split News Items | Parameters panel showing `Fields To Split Out: output.news` |
| `10-filter-genuine.png` | Filter Genuine News Items | Parameters panel showing both filter conditions |
| `11-set-normalize-category.png` | Normalize Category | Parameters panel showing the category expression |
| `12-supabase-insert.png` | Insert News Row | Parameters panel showing table + field mappings |
| `13-set-combine-report.png` | Combine News For Report | Parameters panel showing raw JSON output mode + Settings tab with Execute Once enabled |
| `14-set-build-report.png` | Build Report Content | Parameters panel showing reportBody/reportDate assignments |
| `15-jira-create-issue.png` | Create Jira Ticket | Parameters panel showing project/issue type/priority/description |
| `16-supabase-update.png` | Update Rows With Jira Key | Parameters panel showing the filter condition + field to update |
| `17-set-prepare-email.png` | Prepare Email Content | Parameters panel showing the three assignments |
| `18-convert-to-file.png` | Convert Report To Text File | Parameters panel showing Operation: toText + Source Property |
| `19-gmail-send.png` | Send IT Summary Email | Parameters panel showing To/Subject/Message + attachment config |
| `20-execution-success.png` | (Executions tab) | A successful execution run, canvas with all green checkmarks |

Tip: n8n lets you screenshot just the node detail panel by clicking the node, then use your OS screenshot tool on that panel area — no need to capture the whole browser window.
