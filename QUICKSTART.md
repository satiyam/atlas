# Atlas — Quickstart

Atlas is a workspace intelligence assistant. Point it at a folder — documents, slides,
spreadsheets, emails, meeting transcripts — and it builds a local knowledge graph you
can ask questions against. Every answer cites the exact file it came from.

Nothing leaves your machine except calls to Anthropic (Claude) and, optionally, Genspark.

---

## What you need

1. **Node.js 22+** — `node --version` to check. Install from https://nodejs.org if missing.
2. **An Anthropic API key** — https://console.anthropic.com → **API Keys** → Create. Note: this is **separate from your claude.ai subscription** and needs its own prepaid credit. $5 is plenty for testing.
3. **A Genspark API key** (optional) — enables external benchmarks in answers.
4. **A folder of files** to point Atlas at.

You do **not** need Python, Docker, a database, or an OpenAI key.

---

## Setup — four steps

### 1. Install

```bash
npm install
```

This pulls everything including `@xenova/transformers` (the local embedding library, ~50MB). The first time you run an ingestion, the embedding model itself (~30MB of weights) downloads from HuggingFace on demand.

> If you ever upgrade from an older Atlas checkout, re-run `npm install` to pick up `@xenova/transformers`. The backend will still start without it, but embeddings will silently fail and you'll see `embedding_errors` in the ingestion summary.

### 2. Configure `.env`

```bash
cp .env.example .env
```

Open `.env` and fill in:

```
ANTHROPIC_API_KEY=sk-ant-...
GENSPARK_API_KEY=gsk-...
OPENAI_API_KEY=
ATLAS_INGESTION_PATH=
ATLAS_MAX_VISUALS_PER_FILE=20
```

- Leave `OPENAI_API_KEY` blank — audio/video transcription isn't wired up in this build.
- No spaces around `=`, no quotes around the value.

### 3. Start the backend (terminal 1)

```bash
npm start
```

You should see:
```
[atlas] Server running on http://localhost:3001
```

Leave this terminal running.

### 4. Start the UI (terminal 2)

```bash
npm run ui:dev
```

It prints a URL — usually **http://localhost:5173**. Open it in your browser.

> **Two ports, important distinction:**
> - **`localhost:5173`** — the live dev UI (what you want while using Atlas). Hot-reloads on code changes.
> - **`localhost:3001`** — the backend API. Also serves a bundled static UI from `public/`, but that copy only updates when you run `npm run ui:build`.
>
> **Use 5173.** If you see an older-looking UI, you're probably on 3001.

---

## First run — what happens

On first boot, Atlas looks for an existing `graph/` folder from older versions. If it finds one, it auto-migrates your data into a new **"Default" collection** (copies, doesn't move — originals remain as a backup).

You'll see the **Collections sidebar** on the left with that Default collection already active.

---

## Using Atlas

### 1. Pick or create a collection

Each **collection** is an isolated knowledge graph for one root folder. Examples:

- "ACME Client Work" → `C:\OneDrive\ACME\`
- "Personal Notes" → `D:\Notes\`
- "Project Phoenix" → `C:\Projects\Phoenix\`

In the sidebar:
- Click an existing collection to activate it.
- Click **+ New** to create one (give it a name; root folder is optional at creation).
- Click **🗑** to delete (wipes the collection's graph + logs; doesn't touch your source files).

All subsequent scans, ingests, queries, and synthesis operate on the **active** collection.

### 2. Point at a folder

In the **Knowledge Source** panel:

- Paste the folder's absolute path, or click **Browse** to preview file count + size (browsers don't expose absolute paths, so you still paste the path after Browse tells you the count).
- Click **Scan** to see what Atlas will try to process.

### 3. Dry Run before ingesting

Click **🔍 Dry Run** to preview without any API calls or graph changes:

- Time estimate
- Estimated graph size (node/edge ranges)
- API cost estimate — broken into **Transcription** (Whisper, currently $0 since audio is off) and **Vision** (Claude Vision for embedded images in PDFs/DOCX/PPTX)
- **"You Decide"** list — filenames that look sensitive (payroll, medical, etc.). Default = Skip.

The Vision cost shown is a **ceiling** — dry-run doesn't open each document to count actual embedded images (that was slow and unreliable). It assumes up to `ATLAS_MAX_VISUALS_PER_FILE` images per PDF/DOCX/PPTX at ~$0.005/image. The real cost during ingestion is almost always lower.

### 4. Start Ingestion

Click **▶ Start Ingestion**. Atlas runs a **two-track pipeline** per file:

1. **Entity extraction via Claude** — produces structured nodes/edges for the knowledge graph (`collections/<id>/graph/nodes.json`, `edges.json`).
2. **Local embedding** — the file's text is chunked (~1000 chars with 200 overlap) and each chunk is turned into a 384-dim vector by a local model (`Xenova/all-MiniLM-L6-v2`, via `@xenova/transformers`). Chunks + vectors live in `embeddings.json`. Nothing leaves your machine for this step.

At query time both sources are used: the graph gives structured facts (who, what, when), and the vector store surfaces the exact passages that match your question.

> **Heads up on data handling:** Atlas sends the full text of each ingested file to the Anthropic API (Claude) for entity extraction. There is no PII redaction step. Use the "You Decide" Skip/Allow toggle to exclude files you don't want sent. Check Anthropic's data usage policy before ingesting sensitive content.
>
> **Embedding is local.** The embedding model runs on your CPU. No file content is sent to any embedding service. First run downloads ~30MB of model weights from HuggingFace.

**Cost-saving behavior you should know about:**
- **Checksum skip:** if a file's content hash is already in the graph, Atlas skips both extraction and embedding. Re-running ingestion on an unchanged folder is essentially free.
- **Prompt caching:** the entity-extraction schema is cached after the first call in a run.
- **Haiku for Vision:** embedded images use Claude Haiku (~3–5× cheaper than Sonnet).
- **Local embeddings:** zero cost per chunk. Just CPU time.

**The old keyword signal filter was removed.** Previously, files without words like "decided" / "project" / "action item" were dropped before reaching Claude — including legitimate meeting minutes that used different phrasing. Every file with non-empty text now flows to extraction.

### 5. Ask questions

Once ingestion finishes, type into the Chat panel:

- *"Who decided on the vendor for Project Phoenix?"*
- *"Summarise Sarah Chen's work last quarter."*
- *"What action items came out of the March steering committee?"*

Answers cite source files. External industry context (if Genspark is configured) appears in a labelled section.

### 6. Synthesis artefacts

The **Synthesis** panel on the right generates longer documents from the graph:

- **Podcast script** — narrative walkthrough of a topic
- **Project brief** — structured project summary
- **Handover document** — everything one person worked on
- **Benchmark report** — internal + external comparison

---

## Supported file types

Documents, slides, spreadsheets, emails, subtitles:
`.pdf`, `.docx`, `.txt`, `.md`, `.csv`, `.xlsx`, `.pptx`, `.eml`, `.msg`, `.vtt`, `.srt`

PDF, DOCX, and PPTX also get **embedded images** extracted and described by Claude Vision. SHA-256 dedup means a logo on every page isn't described 100 times. Per-file cap via `ATLAS_MAX_VISUALS_PER_FILE`.

Not supported in this build: `.mp3`, `.m4a`, `.wav`, `.mp4`, standalone `.png`/`.jpg`.

---

## Where your data lives

Each collection has its own folder under `collections/<id>/`:

```
collections/
  index.json                        — list of all collections + which is active
  default_abc123/
    collection.json                 — name, root path, timestamps
    graph/
      nodes.json                    — entity nodes
      edges.json                    — relationships
      schema.json                   — entity schema (copied from template)
      embeddings.json               — (reserved)
    logs/
      delta_log.jsonl               — append-only change log; holds the ingestion cursor
      ingestion_log.jsonl           — per-run summaries
      audit_log.jsonl               — refusals, reset events, parser errors
    config/
      ingestion_config.json         — root path, per-collection crawler overrides
```

To wipe a collection, use the **🗑 Reset knowledge base** button in the Knowledge Base panel (keeps the collection, empties its data), or use the trash icon in the sidebar (removes the collection entirely).

---

## Costs — what to expect

For a first-time ingestion of a moderately-sized folder (~50 mixed documents, some PDFs with embedded charts):

- **Entity extraction:** a few cents per 10 files.
- **Vision (embedded images):** ~$0.005 per image, capped per file.
- **Queries:** fractions of a cent each.
- **Synthesis:** ~$0.02–0.05 per generated artefact.

Rough totals: **small folder $0.10–$1**, **medium folder $1–$5**, **large folder $5–$20**.

Re-ingesting the same folder is near-free thanks to the checksum skip.

Check your real spend at https://console.anthropic.com → **Usage**.

---

## Troubleshooting

**The UI looks old / doesn't show a sidebar**
You're on http://localhost:3001. Switch to http://localhost:5173 (the Vite dev server). Or run `npm run ui:build` to rebuild the bundled version.

**"Atlas server unreachable" banner**
The backend terminal (step 3) died. Start it again with `npm run dev` (auto-restarts on crash) instead of `npm start`.

**Ingestion finishes but graph has zero nodes**
Check in this order:
1. **Backend wasn't restarted after an upgrade.** The server loads all code at boot — `npm start` must be killed and re-run after any code change. Hard-refresh the browser too (Ctrl-Shift-R) so you're not looking at a cached UI.
2. **Checksum skip blocks re-ingestion of already-seen files.** If you've ingested the folder before, every file's content hash is already in the graph and will be skipped. Click **🗑 Reset knowledge base** in the UI, then re-ingest.
3. **Anthropic key problem.** Visit `http://localhost:3001/api/env-status` — it should return `"anthropic": true`. If false, check `.env`: no quotes, no spaces around `=`, file is in project root. Restart the backend after editing.
4. **First-run Anthropic billing issue.** Check console.anthropic.com → Usage for authentication or quota errors around the time of the ingest. The banner shows the underlying API error if there is one — click "Error details" to expand.

**Dry Run empty after switching folders**
The collection's delta cursor only tracks files modified after the last successful ingest. If you swap folders and the new folder's files are all older than the cursor, they get classified as "unchanged." Fix: reset the knowledge base (🗑 button in the Knowledge Base panel), or create a brand-new collection for the new folder. Each collection has its own cursor.

**Port 3001 already in use**
Add `ATLAS_PORT=3002` to `.env` and restart.

**Answers don't include external benchmarks**
Genspark key missing or out of quota. Internal answers still work; external research is just a nice-to-have.

**"Parent Organization blocking new organization creation"**
Your corporate email (e.g. `@company.com`) has IT policies blocking third-party signups. Sign up to Anthropic's console with a personal email instead.

---

## Development

```bash
npm test            # full test suite — runs against a temp collection, won't touch your real data
npm run ui:build    # rebuild the bundled static UI into ./public
npm run dev         # backend with auto-restart on crash (nodemon)
```

---

## Want more detail?

- [CLAUDE.md](CLAUDE.md) — architecture, governance rules, skill hierarchy
- [skills/](skills/) — rule files loaded for each operation
- `collections/<id>/graph/schema.json` — entity schema for that collection

Atlas is a consent-first system. Every answer is citable. Files flagged as sensitive by filename get the "You Decide" Skip/Allow prompt before ingestion. Allowed files are sent to Claude verbatim — curate your ingestion folder accordingly.
