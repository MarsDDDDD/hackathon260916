# BronWijzer MVP

An evidence-first Dutch back-office prototype for the PROV-AI Challenge 2.

## Run locally

Because this is a dependency-free local prototype, run the included local server:

```powershell
node server.mjs
```

Open [http://127.0.0.1:4173](http://127.0.0.1:4173). The demo uses the Schoten market regulation (article 13, pages 5-6) and the 2026-2031 market-fee regulation (article 4.1, page 1) as its initial controlled source set.

## Optional OpenAI connection

The default evidence workflow is deterministic and works without an API key. To have OpenAI write an additional source-bounded concept, open **AI-instellingen**:

- Paste a project API key; it is sent only to the local `server.mjs` process and held only in that process's memory. It is not written to browser storage, source files, or history.
- The local server asks OpenAI for the models available to that project and allows the officer to select one.
- On analysis, only the customer question and the active evidence excerpts are sent to OpenAI. The original PDFs and disabled sources stay local.

For a deployment, do not use the key-entry form. Start the server with `OPENAI_API_KEY` set by the deployment environment or a secret manager. Never put a key in the browser bundle, Git repository, or client-side storage.

## What the demo demonstrates

- Only active, reviewed sources can support an answer.
- Each answer claim has a quote, article/page location and original-source link.
- The UI shows applicability and an explicit uncertainty check.
- Disabling the procedural regulation blocks the answer instead of inventing one.
- The officer records a review and edits a draft; the app intentionally cannot send it.
- Uploaded files start as **te beoordelen** and cannot be used until their metadata is reviewed.

The UI contains locally embedded evidence excerpts solely for a stable hackathon demo. A production build would extract, store, and index officer-provided source files while keeping that metadata and the original source file linked to each answer.
