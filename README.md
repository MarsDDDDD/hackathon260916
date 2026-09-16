# BronWijzer MVP

An evidence-first Dutch back-office prototype for the PROV-AI Challenge 2.

## Run locally

Because this is a dependency-free static prototype, serve the folder with any local web server. For example:

```powershell
npx --yes serve .
```

Open the local URL shown by the server. The demo uses the Schoten market regulation (article 13, pages 5-6) and the 2026-2031 market-fee regulation (article 4.1, page 1) as its initial controlled source set.

## What the demo demonstrates

- Only active, reviewed sources can support an answer.
- Each answer claim has a quote, article/page location and original-source link.
- The UI shows applicability and an explicit uncertainty check.
- Disabling the procedural regulation blocks the answer instead of inventing one.
- The officer records a review and edits a draft; the app intentionally cannot send it.
- Uploaded files start as **te beoordelen** and cannot be used until their metadata is reviewed.

The UI contains locally embedded evidence excerpts solely for a stable hackathon demo. A production build would extract, store, and index officer-provided source files while keeping that metadata and the original source file linked to each answer.
