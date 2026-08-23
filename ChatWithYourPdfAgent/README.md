
<img
    src="ChatWithYourPdfAgent.png"
    alt="Build Your Own Agent Now - n8n AI Agents"
    width="100%"
  />


# Chat With Your PDF Bot (Telegram + Google Gemini + Pinecone)

A Telegram bot built in n8n: send it a PDF, it reads and indexes it into Pinecone using Google Gemini embeddings,
then answers your questions about that PDF in the same chat using a Gemini-powered AI Agent with short-term memory.


## How it works

1. **Telegram Trigger** — listens for any message sent to the bot.
2. **Has Document?** (IF) — branches on whether the incoming message includes a file attachment.

**Upload branch** (message has a document):

3. **Download PDF from Telegram** — fetches the file binary via the Telegram Bot API.
4. **Extract PDF Text** — pulls plain text out of the PDF.
5. **Recursive Character Text Splitter → Default Data Loader** — chunks the text (1000 chars, 200 overlap) for embedding.
6. **Embeddings Google Gemini** — embeds each chunk with `text-embedding-004`.
7. **Store PDF in Pinecone** — upserts the embedded chunks into your Pinecone index.
8. **Confirm Upload** — replies in Telegram once the PDF is indexed.

**Question branch** (message is plain text):

3. **PDF Q&A Agent** — a Gemini 2.0 Flash agent that:
   - uses **Search PDF Knowledge** (Pinecone, `retrieve-as-tool` mode) to look up relevant chunks before answering,
   - uses **Chat Memory** (windowed buffer, keyed by Telegram chat ID) to remember recent turns in the conversation,
   - is instructed to answer only from retrieved PDF content and say so when it can't find an answer.
4. **Send Reply** — sends the agent's answer back to the same Telegram chat.

## Setup

1. **Import** `n8n/ChatWithYourPDFBot.json` in n8n: Workflows → Import from File.
2. **Telegram credential** — this repo already has a `Telegram account` credential; confirm it's attached to the
   trigger and both `sendMessage`/`file get` nodes. If you want a dedicated bot for this workflow, create a new bot
   via [@BotFather](https://t.me/BotFather) and add its token as a new Telegram credential instead.
3. **Google Gemini credential** — this repo already has a `Google Gemini(PaLM) Api account` credential, used for
   both the embeddings and chat model nodes. Confirm your Gemini API key has access to `text-embedding-004` and
   `gemini-2.0-flash`.
4. **Pinecone** — you need a Pinecone account and index (not already configured in this repo):
   - Create an index with dimension **768** (matches Gemini's `text-embedding-004`) and your preferred metric
     (cosine is the usual default).
   - Add a Pinecone credential in n8n named `Pinecone account` (or update the two Pinecone nodes to point at
     whatever you name it).
   - Open **Store PDF in Pinecone** and **Search PDF Knowledge**, and reselect your index in the Pinecone Index
     picker — the JSON ships with a placeholder name (`chat-with-pdf-index`) that won't exist until you create it.
5. **Test it**: message your bot a PDF, wait for the confirmation, then ask it a question about the PDF's content.
6. **Activate** the workflow once a manual test run succeeds end-to-end.

## Notes & things you may want to adjust

- **Multiple PDFs / multiple users:** Pinecone upserts here aren't namespaced per user or per document, so
  everyone's uploaded PDFs share one searchable pool. For per-user or per-document isolation, add a Pinecone
  **namespace** (e.g. the Telegram chat ID) in both Pinecone nodes' options, or add metadata filtering.
- **Large PDFs:** very long PDFs will produce many chunks; Gemini embeddings and Pinecone upserts both have rate
  limits — for big documents consider batching via `Split In Batches` between the loader and the Pinecone insert.
- **Chat memory** is in-memory per execution context (windowed buffer keyed by chat ID) — it resets if the workflow
  or n8n instance restarts. For persistent multi-session memory, swap in a database-backed memory node.
- **Answer scope:** the system prompt tells the agent to answer only from retrieved PDF passages. Loosen or tighten
  this in **PDF Q&A Agent** → `options.systemMessage` depending on how strict you want it.
- **File types:** only PDFs are handled (`Extract PDF Text` is PDF-specific). To support other formats (docx, txt),
  branch on MIME type before extraction and add the matching Extract From File operation.

## Example conversation

```
You:  [uploads "employee-handbook.pdf"]
Bot:  ✅ Got your PDF ("employee-handbook.pdf"). I've read it and stored it
      in memory — ask me anything about it!

You:  How many vacation days do new hires get in their first year?
Bot:  According to the handbook, new hires accrue 15 vacation days in their
      first year, prorated from their start date.

You:  What about after year 3?
Bot:  After 3 years of service, accrual increases to 20 days per year.
```

Chat memory means follow-up questions like "What about after year 3?" resolve correctly without repeating context.

## Troubleshooting

- **Bot never responds at all** — the workflow isn't activated, or the Telegram Trigger's webhook wasn't registered.
  Activate the workflow, then check the Telegram Trigger node for a webhook error.
- **"index not found" / Pinecone node errors** — you haven't created the Pinecone index yet, or the index picker in
  **Store PDF in Pinecone** / **Search PDF Knowledge** still points at the placeholder name. Fix both — they must
  match each other and an index that actually exists.
- **Bot replies "I don't know" to everything** — check that a PDF was actually uploaded and indexed first (look for
  the ✅ confirmation), and that both Pinecone nodes reference the *same* index — data inserted into one index is
  invisible to a search against a different one.
- **Answers ignore earlier context** — verify **Chat Memory**'s `sessionKey` is resolving to a real chat ID (not
  `undefined`) and that `contextWindowLength` isn't set too low for your conversation style.
- **Embeddings/chat calls fail with auth errors** — confirm the Gemini API key in `Google Gemini(PaLM) Api account`
  has access to both `text-embedding-004` and `gemini-2.0-flash`; some API keys are scoped to only one model family.
- **PDF text comes out garbled or empty** — some PDFs are scanned images with no embedded text layer;
  `Extract PDF Text` can't OCR them. You'd need an OCR step (e.g. a vision-capable Gemini call) before this will
  work on scanned documents.

## Project files

| File | Purpose |
|---|---|
| `README.md` | This file |
| `docs/NODE_CONFIG.md` | Per-node parameter reference and reconfiguration guide |
| `n8n/ChatWithYourPDFBot.json` | Importable n8n workflow export |
| `.env.example` | Sample of every credential value needed (Telegram token, Gemini API key, Pinecone API key/index) — n8n stores credentials itself, this is a setup reference, not a loaded env file |
