
<img
    src="ChatWithYourPdfAgent.png"
    alt="Build Your Own Agent Now - n8n AI Agents"
    width="100%"
  />

# Chat With Your PDF Bot — n8n Workflow

**Platform:** n8n (self-hosted / cloud) &nbsp;|&nbsp; **Trigger:** Telegram Trigger &nbsp;|&nbsp; **Destination:** Telegram + Pinecone &nbsp;|&nbsp; **Nodes:** 14

A Telegram bot that turns any uploaded PDF into a searchable knowledge base. A user sends a PDF to the bot; the workflow extracts its text, chunks it, embeds each chunk with Google Gemini, and upserts the vectors into Pinecone. When the same user later asks a question in the chat, a Gemini-powered AI Agent searches Pinecone for relevant passages and answers using only that retrieved content, with short-term memory so follow-up questions resolve correctly.

> **Built offline.** This workflow JSON was written directly rather than created and validated live inside an n8n instance. Import it, then confirm credentials and the Pinecone index picker before activating — see **Prerequisites & Setup** below.

---

## 1. Overview

**Useful for:**
- Letting a team or individual "chat" with reference documents (handbooks, manuals, contracts, reports) over Telegram instead of opening the PDF.
- Building a lightweight, chat-first document Q&A tool without a custom frontend.
- A reusable base template for retrieval-augmented generation (RAG) bots — swap Telegram for another chat channel, or Gemini/Pinecone for other providers, with minimal rewiring.

---

## 2. Workflow Architecture

The workflow branches into two independent paths off a single trigger, depending on whether the incoming Telegram message contains a file.

```
1. Telegram Trigger              → fires on any incoming message
2. Has Document? (IF)            → branches on message.document

  ── Upload branch (message has a PDF attached) ──
  3. Download PDF from Telegram  → fetches the file binary
  4. Extract PDF Text            → pulls plain text out of the PDF
  5. Recursive Character Text
     Splitter → Default Data
     Loader                      → chunks the PDF (1000 chars, 200 overlap)
  6. Embeddings Google Gemini    → embeds each chunk (text-embedding-004)
  7. Store PDF in Pinecone       → upserts embedded chunks into the index
  8. Confirm Upload              → replies in Telegram once indexed

  ── Question branch (message is plain text) ──
  9. PDF Q&A Agent               → Gemini 2.0 Flash agent, backed by:
       - Search PDF Knowledge    → Pinecone retrieval tool (retrieve-as-tool)
       - Embeddings Google
         Gemini (Query)          → embeds the question for retrieval
       - Google Gemini Chat
         Model                   → the agent's language model
       - Chat Memory             → windowed buffer, keyed by Telegram chat ID
  10. Send Reply                 → sends the agent's answer back to Telegram
```

---

## 3. Node-by-Node Breakdown

### 1 — Telegram Trigger
**Type:** Telegram Trigger (`n8n-nodes-base.telegramTrigger`)
**Purpose:** Entry point. Fires whenever the bot receives any message (text or file).
**Config:** `updates: ["message"]` · Credential: Telegram Bot API token

### 2 — Has Document?
**Type:** IF (`n8n-nodes-base.if`)
**Purpose:** Branches the run based on whether the message includes a file attachment.
**Config:** Condition — `{{$json.message.document}}` → operator `object.exists`. True → upload branch. False → question branch.

### 3 — Download PDF from Telegram
**Type:** Telegram (`n8n-nodes-base.telegram`, resource: `file`, operation: `get`)
**Purpose:** Downloads the uploaded file's binary data from the Telegram Bot API.
**Config:** `fileId = {{$json.message.document.file_id}}` · `download: true`

### 4 — Extract PDF Text
**Type:** Extract From File (`n8n-nodes-base.extractFromFile`, operation: `pdf`)
**Purpose:** Converts the downloaded PDF binary into plain text for chunking.
**Config:** `binaryPropertyName: data`

### 5 — Recursive Character Text Splitter → Default Data Loader
**Type:** Text Splitter + Document Loader (`@n8n/n8n-nodes-langchain.textSplitterRecursiveCharacterTextSplitter`, `@n8n/n8n-nodes-langchain.documentDefaultDataLoader`)
**Purpose:** Splits the PDF binary into overlapping text chunks sized for embedding.
**Config:** `chunkSize: 1000` · `chunkOverlap: 200` · loader reads `binaryDataKey: data`

### 6 — Embeddings Google Gemini
**Type:** Embeddings (`@n8n/n8n-nodes-langchain.embeddingsGoogleGemini`)
**Purpose:** Converts each text chunk into a 768-dimension vector.
**Config:** `modelName: models/text-embedding-004` · Credential: Google Gemini API key

### 7 — Store PDF in Pinecone
**Type:** Pinecone Vector Store (`@n8n/n8n-nodes-langchain.vectorStorePinecone`, mode: `insert`)
**Purpose:** Upserts the embedded chunks into the configured Pinecone index.
**Config:** `pineconeIndex` → your index (must exist, dimension 768) · Credential: Pinecone API key

### 8 — Confirm Upload
**Type:** Telegram (`n8n-nodes-base.telegram`, resource: `message`, operation: `sendMessage`)
**Purpose:** Lets the user know their PDF was read and indexed.
**Config:** `chatId = {{$('Telegram Trigger').item.json.message.chat.id}}` · confirmation text referencing the file name

### 9 — PDF Q&A Agent
**Type:** AI Agent (`@n8n/n8n-nodes-langchain.agent`)
**Purpose:** Answers the user's question using retrieved PDF content and recent chat history.
**Config:** `promptType: define` · `text = {{$json.message.text}}` · `maxIterations: 6` · system prompt instructs the agent to call `search_pdf_knowledge` before answering and to say when it can't find something, rather than guess.

**Sub-nodes wired into the agent:**
- **Search PDF Knowledge** — Pinecone Vector Store (`mode: retrieve-as-tool`), `toolName: search_pdf_knowledge`, `topK: 4`, same index as node 7.
- **Embeddings Google Gemini (Query)** — a second embeddings instance (same model) feeding the retrieval tool.
- **Google Gemini Chat Model** — `modelName: models/gemini-2.0-flash`, `temperature: 0.3`.
- **Chat Memory** — windowed buffer memory, `sessionKey = {{$('Telegram Trigger').item.json.message.chat.id}}`, `contextWindowLength: 10`.

### 10 — Send Reply
**Type:** Telegram (`n8n-nodes-base.telegram`, resource: `message`, operation: `sendMessage`)
**Purpose:** Sends the agent's generated answer back to the same Telegram chat.
**Config:** `chatId = {{$('Telegram Trigger').item.json.message.chat.id}}` · `text = {{$json.output}}`

---

## 4. Example Data Flow

| Stage | Example Value |
|---|---|
| Telegram message (upload) | User sends `employee-handbook.pdf` as a document attachment |
| After Has Document? | Routed to upload branch (`message.document` present) |
| After Extract PDF Text | Raw text string of the handbook's contents |
| After Text Splitter / Loader | N overlapping chunks, ~1000 characters each |
| After Embeddings | N vectors, 768 dimensions each |
| After Store in Pinecone | Vectors upserted into the configured index |
| Telegram message (question) | `How many vacation days do new hires get?` |
| After Has Document? | Routed to question branch (`message.document` absent) |
| Inside PDF Q&A Agent | Calls `search_pdf_knowledge` → retrieves top 4 matching chunks → drafts an answer grounded in them |
| After Send Reply | Bot replies with the grounded answer in the same chat |

---

## 5. Step-by-Step Build Guide

1. **Create the trigger** — Add a **Telegram Trigger** node, `updates: ["message"]`, connected to your bot's credential.
2. **Branch on attachment** — Add an **IF** node checking whether `{{$json.message.document}}` exists.
3. **Download the file** — On the true branch, add a **Telegram** node (resource `file`, operation `get`) using `{{$json.message.document.file_id}}`, with `download: true`.
4. **Extract text** — Add an **Extract From File** node, operation `pdf`.
5. **Chunk the document** — Add a **Recursive Character Text Splitter** (chunk size 1000, overlap 200) feeding a **Default Data Loader**.
6. **Embed the chunks** — Add an **Embeddings Google Gemini** node using `text-embedding-004`.
7. **Store the vectors** — Add a **Pinecone Vector Store** node in `insert` mode, connected to the loader (`ai_document`) and embeddings (`ai_embedding`), pointed at your Pinecone index.
8. **Confirm the upload** — Add a **Telegram sendMessage** node replying to the same chat.
9. **Build the retrieval tool** — On the false branch, add a second **Pinecone Vector Store** node in `retrieve-as-tool` mode, named `search_pdf_knowledge`, with its own **Embeddings Google Gemini** input pointed at the same index.
10. **Add the agent** — Add an **AI Agent** node with the retrieval tool, a **Google Gemini Chat Model**, and a **Window Buffer Memory** (keyed by chat ID) wired in as sub-nodes.
11. **Send the answer** — Add a **Telegram sendMessage** node using `{{$json.output}}` as the reply text.
12. **Wire connections and activate** — Connect the trigger through the IF node into both branches as shown in section 2, save, and toggle the workflow **Active**.

---

## 6. Prerequisites & Setup

**Credentials required:**
- **Telegram Bot API token** — create a bot via [@BotFather](https://t.me/BotFather) if you don't already have one.
- **Google Gemini API key** — from [Google AI Studio](https://aistudio.google.com/app/apikey), with access to `text-embedding-004` and `gemini-2.0-flash`.
- **Pinecone API key** — from the [Pinecone console](https://app.pinecone.io), plus an index created with **768 dimensions** (matching the Gemini embedding size).

**n8n environment:** Telegram Trigger v1.1, Telegram v1.2, Extract From File v1, LangChain Text Splitter / Document Loader / Embeddings / Vector Store / Agent / Memory nodes v1+, plus outbound internet access to Telegram, Google, and Pinecone APIs.

See `.env.example` for a sample of every credential value needed, and `docs/NODE_CONFIG.md` for full per-node parameter detail.

---

## 7. Configuring the Pinecone Credential

1. Sign up / log in at [app.pinecone.io](https://app.pinecone.io).
2. Create an index with **dimension 768** and metric **cosine** (the standard default; serverless free-tier works fine for testing).
3. Generate an API key under **API Keys** in the Pinecone console.
4. In n8n, open either Pinecone node in this workflow → **Create New Credential** → **Pinecone API**, and paste in the key.
5. Open **Store PDF in Pinecone** and **Search PDF Knowledge**, and select your newly created index in the Pinecone Index picker on both — they must point at the **same index**.
6. Run a manual test: upload a small PDF, confirm the ✅ reply, then ask a question about its contents before activating the workflow.

---

## 8. Known Limitations

- **No per-user isolation:** Pinecone upserts are not namespaced, so every uploaded PDF shares one searchable pool across all Telegram users.
- **No rate-limit handling:** large PDFs can produce many chunks; there's no batching against Gemini/Pinecone rate limits.
- **In-memory chat history:** the windowed buffer memory resets on workflow or n8n instance restart — it isn't persisted to a database.
- **PDF-only ingestion:** `Extract PDF Text` only handles PDFs; other file types are not supported.
- **No OCR:** scanned PDFs with no embedded text layer will extract empty or garbled text.

---

## 9. Suggested Improvements

- Add a Pinecone **namespace** per Telegram chat ID for per-user document isolation.
- Add a `Split In Batches` step before the Pinecone insert to respect embedding/upsert rate limits on large documents.
- Swap the in-memory buffer for a persistent memory node (e.g. Postgres/Redis-backed chat memory).
- Branch on MIME type before extraction to support additional file formats (`.docx`, `.txt`).
- Add a vision-capable OCR step for scanned/image-only PDFs.

---

## 10. Project Files

| File | Purpose |
|---|---|
| `README.md` | This file |
| `docs/NODE_CONFIG.md` | Per-node parameter reference and reconfiguration guide |
| `n8n/ChatWithYourPDFBot.json` | Importable n8n workflow export |
| `.env.example` | Sample of every credential value needed (Telegram token, Gemini API key, Pinecone API key/index) — n8n stores credentials itself; this is a setup reference, not a loaded env file |

---

*Documentation based on the exported workflow file `n8n/ChatWithYourPDFBot.json`.*
