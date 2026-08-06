<img
    src="n8nMain.png"
    alt="Build Your Own Agent Now - n8n AI Agents"
    width="100%"
  />


# n8n Agents
 
This repository contains a collection of **AI agents built with n8n** — automated workflows that don't just follow fixed steps, but actually *think*, decide, and take action using AI models.
 
If you're new to n8n or AI agents, this README will walk you through everything from scratch.
 
---
 
## 📖 What is n8n?
 
**n8n** (short for "nodemation," pronounced *n-eight-n*) is a free, open-source tool for building automations by connecting different apps and services together — without writing a full application from scratch.
 
Think of it like this: instead of writing code every time you want two apps to talk to each other (like "when I get a new email, add it to a spreadsheet"), you build that logic visually by dragging and connecting **nodes** on a canvas.
 
### Why people use n8n
 
- **No-code / low-code** — build automations visually, add custom code only when you need to.
- **Self-hostable** — you can run it on your own computer or server, so your data stays with you.
- **Huge library of integrations** — Gmail, Slack, Notion, Google Sheets, Airtable, Telegram, and hundreds more.
- **Built-in AI support** — n8n has native nodes for connecting to AI models (OpenAI, Anthropic/Claude, local models via Ollama), giving your workflows the ability to "think" and not just follow fixed rules.
- **Free and open source** — the core product is free to self-host.
### A simple example
 
Without n8n: You'd need to manually check your email, copy details into a spreadsheet, and send a Slack message every time something important comes in.
 
With n8n: You build one workflow once —
`New Email Arrives → Extract Details → Add Row to Spreadsheet → Send Slack Notification`
— and it runs automatically, every time, forever.
 
---
 
## ⚙️ How to Install n8n
 
There are a few ways to get n8n running. Pick the one that fits your comfort level.
 
### Option 1: npm (fastest way to try it locally)
 
Best if you already have Node.js installed and just want to try n8n quickly on your own machine.
 
```bash
npm install n8n -g
n8n start
```
 
Once it starts, open your browser and go to:
```
http://localhost:5678
```
 
That's it — you now have n8n running locally.
 
---
 
### Option 2: Docker (recommended for most people)
 
Docker packages n8n and everything it needs into one container, so you don't have to worry about installing Node.js or managing dependencies yourself.
 
```bash
docker volume create n8n_data
 
docker run -it --rm \
  --name n8n \
  -p 5678:5678 \
  -v n8n_data:/home/node/.n8n \
  docker.n8n.io/n8nio/n8n
```
 
**What this does:**
- Creates a storage volume (`n8n_data`) so your workflows and credentials are saved even if you restart the container.
- Runs n8n on port `5678`.
- Pulls the official n8n Docker image and starts it.
Once running, visit `http://localhost:5678`.
 
---
 
### Option 3: Docker Compose (best for keeping it running long-term)
 
This is the recommended setup if you want n8n running persistently on your own server (e.g., a home lab, VPS, or Raspberry Pi).
 
Create a file named `docker-compose.yml`:
 
```yaml
version: "3.7"
services:
  n8n:
    image: docker.n8n.io/n8nio/n8n
    restart: unless-stopped
    ports:
      - "5678:5678"
    environment:
      - N8N_BASIC_AUTH_ACTIVE=true
      - N8N_BASIC_AUTH_USER=admin
      - N8N_BASIC_AUTH_PASSWORD=changeme
    volumes:
      - n8n_data:/home/node/.n8n
 
volumes:
  n8n_data:
```
 
Then run:
 
```bash
docker compose up -d
```
 
**Important:** Change `N8N_BASIC_AUTH_USER` and `N8N_BASIC_AUTH_PASSWORD` to your own credentials before deploying anywhere publicly accessible.
 
---
 
### Option 4: n8n Cloud (no installation at all)
 
If you'd rather not manage any servers, sign up directly at [n8n.io](https://n8n.io) for a hosted version. This costs money but removes all setup and maintenance work.
 
---
 
## 🤖 What are n8n Agents?
 
A regular n8n workflow follows a **fixed path**: step 1, then step 2, then step 3 — always in the same order, no matter what.
 
An **n8n Agent** is different. It uses an AI model (an LLM like GPT or Claude) as the "brain" of the workflow. Instead of following a fixed path, the agent:
 
1. **Looks at the goal or input** it's been given (a message, a question, a task).
2. **Thinks about what needs to happen** to accomplish that goal.
3. **Decides which tool to use** — and there can be several available (search the web, send an email, query a database, call another workflow, etc.).
4. **Uses memory** to remember earlier parts of the conversation or task.
5. **Keeps going** until it has a complete answer or has finished the task — sometimes using multiple tools in sequence, on its own.
### A simple analogy
 
A normal workflow is like a **recipe**: do step 1, then step 2, then step 3, always the same way.
 
An agent is like an **assistant you give a task to**: "Find out if it's going to rain tomorrow and email me a summary." The assistant figures out *how* to do that — checking the weather, writing the email, and sending it — without you specifying each exact step.
 
---
 
### The building blocks of an n8n Agent
 
Every agent workflow is made up of a few key pieces:
 
| Component | What it does | Example |
|---|---|---|
| **Trigger node** | Starts the workflow | A chat message comes in, a form is submitted, a schedule fires |
| **AI Agent node** | The decision-making core — this is what makes it an "agent" and not just a workflow | Decides whether to search, calculate, or respond directly |
| **Chat Model node** | The actual AI model powering the agent's reasoning | OpenAI GPT-4, Anthropic Claude, or a local model via Ollama |
| **Tool nodes** | Actions the agent is *allowed* to take | Web search, calculator, HTTP request, database lookup, another n8n workflow |
| **Memory node** | Lets the agent remember previous messages or steps | Window buffer memory, Postgres, Redis |
| **Output node** | Sends the final result somewhere | A chat reply, a Slack message, an email, a spreadsheet update |
 
### How it fits together (visually)
 
```
[Trigger] → [AI Agent] → [Chat Model + Memory + Tools] → [Output]
```
 
The AI Agent node sits at the center, consulting the Chat Model to reason, checking Memory for context, and calling Tools when it needs to take action — then produces the final Output.

## 🚀 Getting Started
 
1. **Install n8n** using one of the options above.
2. **Import a workflow:** In the n8n editor, go to **Workflows → Import from File**, and select a `.json` file from the `/workflows` folder in this repo.
3. **Add your credentials:** Go to **Credentials** and add your API key for whichever AI model the workflow uses (OpenAI, Anthropic, etc.).
4. **Activate and test:** Turn the workflow on, then trigger it (send a chat message, submit a form, or run it manually) to see the agent in action.
