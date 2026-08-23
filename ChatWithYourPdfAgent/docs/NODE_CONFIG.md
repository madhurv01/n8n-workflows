# Chat With Your PDF Bot — Node Configuration Reference

Per-node parameter reference for `../n8n/ChatWithYourPDFBot.json`. This workflow was built offline (no live n8n API
access at the time), so treat this as a config map to check against the actual node UI after import, not a
guarantee of exact parameter names for your n8n version.

---

## 1. Telegram Trigger — `n8n-nodes-base.telegramTrigger`

| Parameter | Value | Notes |
|---|---|---|
| `updates` | `["message"]` | Fires on any incoming message (text or file) |
| Credential | `Telegram account` (`telegramApi`) | Bot token from [@BotFather](https://t.me/BotFather) |

---

## 2. Has Document? — `n8n-nodes-base.if`

Checks `{{ $json.message.document }}` with operator `object.exists`. **True** → upload branch. **False** → treated
as a text question (does not separately check `message.text` exists — a non-document, non-text message like a
sticker will still hit the Q&A branch and likely fail gracefully via the agent).

---

## 3. Download PDF from Telegram — `n8n-nodes-base.telegram` (resource: `file`, operation: `get`)

| Parameter | Value |
|---|---|
| `fileId` | `{{ $json.message.document.file_id }}` |
| `download` | `true` — puts the binary in the output for the next node |
| Credential | `Telegram account` |

---

## 4. Extract PDF Text — `n8n-nodes-base.extractFromFile`

`operation: pdf`, `binaryPropertyName: data`. Reads the binary from step 3 and outputs plain text in `$json.text`.

---

## 5. Recursive Character Text Splitter — `@n8n/n8n-nodes-langchain.textSplitterRecursiveCharacterTextSplitter`

`chunkSize: 1000`, `chunkOverlap: 200`. Feeds into **Default Data Loader** via `ai_textSplitter`. Increase
`chunkSize` for fewer/larger chunks (cheaper embedding calls, coarser retrieval); decrease for more precise
retrieval on long documents.

## 6. Default Data Loader — `@n8n/n8n-nodes-langchain.documentDefaultDataLoader`

`dataType: binary`, `binaryDataKey: data`. Reads the PDF binary directly (not the extracted text field) and applies
the text splitter above internally. Feeds **Store PDF in Pinecone** via `ai_document`.

---

## 7. Embeddings Google Gemini — `@n8n/n8n-nodes-langchain.embeddingsGoogleGemini`

There are **two instances** of this node — one for indexing (`Embeddings Google Gemini`), one for querying
(`Embeddings Google Gemini (Query)`). Both must use the **same model** so vectors are comparable.

| Parameter | Value |
|---|---|
| `modelName` | `models/text-embedding-004` |
| Credential | `Google Gemini(PaLM) Api account` (`googlePalmApi`) |

Output dimension is **768** — your Pinecone index must be created with matching dimensionality.

---

## 8. Store PDF in Pinecone — `@n8n/n8n-nodes-langchain.vectorStorePinecone` (mode: `insert`)

| Parameter | Value | Notes |
|---|---|---|
| `mode` | `insert` | Upserts new vectors |
| `pineconeIndex` | placeholder `chat-with-pdf-index` | **Must reselect** in the UI after creating your real index |
| Credential | `Pinecone account` (`pineconeApi`) | Not present in this n8n instance yet — create it |

Inputs: `ai_document` from Default Data Loader, `ai_embedding` from Embeddings Google Gemini.

**To namespace by user/document:** add `options.pineconeNamespace` (e.g.
`={{ $('Telegram Trigger').item.json.message.chat.id }}`) so each Telegram chat's PDFs stay isolated.

---

## 9. Confirm Upload — `n8n-nodes-base.telegram` (resource: `message`, operation: `sendMessage`)

`chatId` and `text` reference `$('Telegram Trigger').item.json.message.chat.id` / `.document.file_name`. Edit the
confirmation copy here.

---

## 10. Search PDF Knowledge — `@n8n/n8n-nodes-langchain.vectorStorePinecone` (mode: `retrieve-as-tool`)

| Parameter | Value | Notes |
|---|---|---|
| `mode` | `retrieve-as-tool` | Exposes this vector store as a callable tool for the agent |
| `toolName` | `search_pdf_knowledge` | Referenced by name in the agent's system prompt |
| `toolDescription` | see JSON | Tells the agent when to call this tool |
| `topK` | `4` | Number of chunks retrieved per query — raise for broader context, lower for tighter/faster answers |
| `pineconeIndex` | same placeholder as step 8 — **must match** the index used for insertion |

Input: `ai_embedding` from **Embeddings Google Gemini (Query)**. Output: `ai_tool` into **PDF Q&A Agent**.

---

## 11. Google Gemini Chat Model — `@n8n/n8n-nodes-langchain.lmChatGoogleGemini`

| Parameter | Value |
|---|---|
| `modelName` | `models/gemini-2.0-flash` |
| `options.temperature` | `0.3` — low, for factual/grounded answers |
| Credential | `Google Gemini(PaLM) Api account` |

---

## 12. Chat Memory — `@n8n/n8n-nodes-langchain.memoryBufferWindow`

| Parameter | Value |
|---|---|
| `sessionKey` | `{{ $('Telegram Trigger').item.json.message.chat.id }}` |
| `sessionIdType` | `customKey` |
| `contextWindowLength` | `10` — last 10 exchanges kept in context |

In-memory only — resets on workflow/instance restart. Swap for a persistent memory node (e.g. Postgres/Redis chat
memory) if you need conversations to survive restarts.

---

## 13. PDF Q&A Agent — `@n8n/n8n-nodes-langchain.agent`

`promptType: define`, `text: {{ $json.message.text }}`. `options.systemMessage` instructs the agent to use
`search_pdf_knowledge` before answering and to admit when it can't find something in the PDF rather than guessing.
`maxIterations: 6`. Edit `systemMessage` to change tone, strictness, or add more tools.

---

## 14. Send Reply — `n8n-nodes-base.telegram` (resource: `message`, operation: `sendMessage`)

`chatId` from the trigger, `text: {{ $json.output }}` (the agent's final answer).

---

## Credentials required

| Credential name | Type | Status | Used by |
|---|---|---|---|
| `Telegram account` | `telegramApi` | Already exists in this n8n instance | Trigger, Download PDF, Confirm Upload, Send Reply |
| `Google Gemini(PaLM) Api account` | `googlePalmApi` | Already exists in this n8n instance | Both embeddings nodes, chat model |
| `Pinecone account` | `pineconeApi` | **Not yet created** — see `.env.example` and README Setup | Both Pinecone vector store nodes |

See `../.env.example` for the raw values needed to create the Pinecone (and, if you want a dedicated bot, Telegram)
credentials.
