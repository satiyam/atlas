# ATLAS — Technical Plan

**Version:** 0.6
**Status:** Active Build
**Last Updated:** 2026-04-24

---

## Problem

Organisational knowledge is scattered across unstructured folders — documents,
slides, spreadsheets, emails, meeting transcripts. When someone leaves or is
unavailable, context is lost. Existing tools (NotebookLM, M365 Copilot) are
stateless, locked to single platforms, or blocked by corporate IT policies.

**Atlas** points at any local folder, builds a persistent knowledge graph plus
a local semantic-search index, and answers questions with file-level citations.
Nothing leaves the machine except calls to Anthropic (extraction + synthesis)
and, optionally, Genspark (external research).

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  UI (React + Vite, localhost:5173)                          │
│  ┌─────────────┐  ┌─────────────────────────────────────┐   │
│  │ Collections │  │ Folder widget                       │   │
│  │ sidebar     │  │ Chat                                │   │
│  │             │  │ Synthesis panel                     │   │
│  │             │  │ Knowledge Base (nodes/edges/chunks) │   │
│  └─────────────┘  └─────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
              │                              │
              ▼                              ▼
┌─────────────────────────────────────────────────────────────┐
│  Express API (localhost:3001)                               │
│    /api/collections   /api/scan     /api/dry-run            │
│    /api/ingest        /api/query    /api/synthesise         │
│    /api/stats         /api/reset-graph                      │
└─────────────────────────────────────────────────────────────┘
              │                              │
              ▼                              ▼
┌──────────────────────────────┐   ┌─────────────────────────┐
│  INGESTION PIPELINE          │   │  QUERY PIPELINE         │
│                              │   │                         │
│  Crawler (delta cursor)      │   │  Query Router           │
│       ↓                      │   │     ↓                   │
│  File Parser                 │   │  Graph Retriever  +     │
│  (pdf/docx/pptx/xlsx/eml/…)  │   │  Embedding Retriever    │
│       ↓                      │   │  (cosine, top-15)       │
│  Visual Extractor            │   │     +                   │
│  (embedded PDF/DOCX/PPTX     │   │  Genspark (optional)    │
│   images → Claude Vision)    │   │     ↓                   │
│       ↓                      │   │  Response Synth         │
│  Chunker (1000/200 overlap)  │   │  (Sonnet, chunks        │
│       ↓                      │   │   primary evidence)     │
│  Local Embedder              │   └─────────────────────────┘
│  (Xenova all-MiniLM-L6-v2)   │
│       ↓                      │
│  Entity Extractor            │
│  (Claude Haiku + JSON)       │
│       ↓                      │
│  Graph + Vector Store        │
│  per collection              │
└──────────────────────────────┘
```

Per-collection storage:

```
collections/
  index.json                        — active collection id + list
  <collection_id>/
    collection.json                 — name, root path, timestamps
    graph/
      nodes.json     edges.json
      schema.json    embeddings.json
    logs/
      delta_log.jsonl               — append-only cursor + CDC events
      ingestion_log.jsonl           — per-run summaries
      audit_log.jsonl               — errors, resets
    config/
      ingestion_config.json
```

---

## Supported file types (current build)

Text-extractable only. Audio, video, and standalone image ingestion are not wired.

`.pdf`, `.docx`, `.txt`, `.md`, `.csv`, `.xlsx`, `.pptx`, `.eml`, `.msg`, `.vtt`, `.srt`

PDF, DOCX, PPTX also have **embedded images** extracted and described by Claude
Vision (Haiku). SHA-256 dedup, per-file cap via `ATLAS_MAX_VISUALS_PER_FILE` (default 20),
4KB minimum-size filter, magic-byte media-type detection.

---

## Models and cost controls

| Call site | Model | `max_tokens` | Notes |
|---|---|---|---|
| Entity extraction | `claude-haiku-4-5-20251001` | 4000 | Prompt caching on schema; `{`-prefilled JSON |
| Vision (embedded images) | `claude-haiku-4-5-20251001` | 400 | Prompt caching on instruction block |
| Query response synth | `claude-sonnet-4-6` | 1200 | Rich passages + 8 rich nodes |
| Synthesis agents (brief/handover/podcast/benchmark) | `claude-sonnet-4-6` | 1500 | Graph-only today (gap — see below) |
| Web-search fallback | `claude-sonnet-4-6` | 800 | Only when Genspark unavailable |
| Embedding | `Xenova/all-MiniLM-L6-v2` (local) | — | 384-dim, CPU, ~30MB model download on first use |

Cost controls in force:

- **Checksum skip** — unchanged files bypass Claude entirely on re-ingest.
- **Prompt caching** — system/schema blocks cached ephemeral, ~90% input discount after first call in 5-min window.
- **Concurrency cap + 429 backoff** — max 2–3 parallel extractions, exponential backoff honouring `retry-after` header, up to 4 retries.
- **Slim query payload** — `response_synth` sends rich attributes for top 8 matched nodes only (not all 20+); passages are the primary evidence.

---

## Shipped features

**Ingestion**
- Multiple isolated collections. First-boot migration of legacy `graph/` into a `default` collection (copy, not move).
- Crawler with sensitive-filename flagger, delta cursor, supported-extension filter.
- Dry run — fast, no document-open (vision cost shown as ceiling estimate).
- Two-track pipeline per file: Claude extraction → graph; local embedding → vector store.
- Embedded-visual extraction from PDF/DOCX/PPTX.
- Checksum-based incremental skip.
- JSON-parse hardening on Haiku responses (assistant prefill, fallback recovery).

**Query & synthesis**
- Graph retriever (keyword match) + embedding retriever (cosine) in parallel.
- Response synthesis with passages-primary framing, grouped by source file.
- Four synthesis agents: project brief, handover doc, podcast script, benchmark report.
- Claude web-search fallback when Genspark is unset.

**UI**
- Collections sidebar (create / activate / delete).
- Folder widget (paste path or Browse; file-count preview).
- Chat panel.
- Synthesis panel (type picker + topic input).
- Knowledge Base panel (nodes / edges / chunks + Reset + Re-ingest).
- Server-status and env-status banners.
- Ingestion result banner with error-specific guidance (auth / billing / rate-limit / JSON parse / empty text).
- Dry-run modal with time estimate, graph-size range, cost ceiling.

**Operational**
- `/api/reset-graph` clears active collection's files and in-memory vector index.
- Delta log gives append-only cursor-based incremental ingestion.

---

## In flight

- **Incremental correctness** (sub-agent): detect files deleted from the root folder and purge their nodes / edges / chunks; purge old state before re-embed on modified files. Integration test at `tests/incremental_ingestion.test.js`.
- **Test backfill** (queued): unit tests for `embed_client`, `chunker`, `vector_store`, `collection_manager`; end-to-end ingestion integration test with mocked Claude and real local embeddings.

---

## Known gaps

- **Synthesis agents don't use the vector store.** `brief_generator`, `handover_builder`, `podcast_writer`, `benchmark_reporter` read only from `graphStore.readNodes()` / `readEdgesArray()`. When the graph is thin they produce "no data found" even when 190+ relevant chunks exist. Fix: retrieve topic-matching chunks alongside nodes.
- **Extraction snippet capped at 6000 chars per file.** Dense documents' later pages never reach Claude. Levers: raise to ~20000 chars (small cost bump) or shift to per-chunk extraction (bigger cost).
- **No ingestion progress bar.** Backend has per-file state; UI shows only "Ingesting...". Polling endpoint design agreed, not built.
- **`atlas_interface.jsx` is monolithic** (~1000 lines). Component-file split deferred.
- **Anthropic tier-1 rate limit (30K TPM)** is comfortably exceeded by a 15-file ingestion even with throttle + Haiku. Top-up on console.anthropic.com bumps to a higher tier.

---

## Removed by design

- **PII redactor.** Was RED/AMBER/GREEN keyword-based blocking. Removed; users curate their own ingestion folder and use the filename-flagger "You Decide" toggle. Full file text goes to Claude.
- **Keyword signal filter.** Was dropping files that didn't contain "decided" / "project" / "action item" etc. Removed — was producing false negatives on real meeting minutes.
- **Audio / video / standalone-image ingestion.** Parser code remains in the tree but not wired; Whisper / standalone vision not called in this build.
- **Background file watching.** Considered; not built. Ingestion is on-demand.

---

## Environment

```
ANTHROPIC_API_KEY=sk-ant-...            # required
GENSPARK_API_KEY=gsk-...                # optional — Claude web-search fallback if unset
OPENAI_API_KEY=                         # unused in current build
ATLAS_INGESTION_PATH=                   # optional default folder
ATLAS_MAX_VISUALS_PER_FILE=20           # embedded-image cap per PDF/DOCX/PPTX
ATLAS_EXTRACTION_CONCURRENCY=2          # parallel Claude extractions
ATLAS_COLLECTIONS_DIR=                  # test-only override
ATLAS_PORT=3001                         # optional backend port override
```

---

## Running locally

```bash
npm install
npm start              # backend, http://localhost:3001
npm run ui:dev         # UI, http://localhost:5173   (use this, not 3001, while developing)
npm test               # Jest, maxWorkers 1, uses a temp collection
```

See [QUICKSTART.md](QUICKSTART.md) for the end-user walkthrough.
