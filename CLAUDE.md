# ATLAS — Project Brain

**Version:** 0.4 (Multi-Modal + Folder Widget + Dry Run)
**Status:** Active Build
**Last Updated:** 2026-04-22
**Current Build Status:** Hackathon build complete — all 10 hours delivered, 119 tests passing.

---

## What Atlas Is

Atlas is a **consent-first, filesystem-native, multi-modal workspace intelligence assistant**.

It ingests any unstructured folder of files — documents, audio recordings, video meetings,
presentations, emails, spreadsheets, and images — builds a **persistent local knowledge graph**,
and answers natural language questions with exact source citations, augmented by external
industry benchmarks via Genspark.

Atlas is NOT a cloud connector, NOT a search index, NOT a chatbot over documents.
It is a **graph-powered knowledge system** that understands relationships between people,
projects, decisions, and meetings — and can synthesise them into podcasts, briefs, handover
documents, and decision logs.

---

## Two-Tier Architecture

```
TIER 1 — INGESTION
  User specifies root folder
       ↓
  Deep Recursive Crawler      (skills/ingestion.md)
       ↓
  Dry Run Engine              (skills/dry_run.md)        [optional — user initiated]
       ↓
  Multi-Modal File Parser     (skills/ingestion.md)
       ↓
  PII Redactor                (skills/pii_redactor.md)
       ↓
  Entity Extractor            (skills/entity_extractor.md)
       ↓
  Knowledge Graph Store       (skills/graph_store.md)
       ↓
  CDC via delta_log.jsonl

TIER 2 — QUERY & SYNTHESIS
  User query
       ↓
  Query Router                (skills/query_router.md)
       ↓
  Graph Retriever + Genspark
       ↓
  Response Synthesiser        (skills/response_synth.md)
       ↓
  Synthesis Agent             (skills/synthesis_agent.md)  [optional — artefact generation]
```

---

## Ingestion Path — Folder Widget

The user specifies the root folder via the browser UI:

1. **Manual path input** — user types a folder path directly
2. **Browse button** — uses `webkitdirectory` HTML attribute to trigger native folder picker

```jsx
<input type="file" webkitdirectory="true" directory="true" ref={folderInputRef} onChange={handleFolderSelect} />
```

**Recommended path for M365 users:**
```
C:\Users\[username]\OneDrive - [Organisation]\
```

This is the OneDrive sync folder — a live local mirror of SharePoint and OneDrive content,
updated automatically, with zero API calls and zero Conditional Access issues.

```
SharePoint → OneDrive Sync → Local Filesystem → Atlas
```

The ingestion path is saved to `config/ingestion_config.json` as `ingestion_path`.

---

## Multi-Modal Support

Atlas processes ALL of the following file types:

| Extension | Parser | Notes |
|---|---|---|
| `.docx` | mammoth.js | Word documents |
| `.pdf` | pdf-parse | Standard PDFs (not encrypted) |
| `.txt` | fs.readFile | Plain text |
| `.pptx` | pptx-parser | PowerPoint slides |
| `.xlsx` | xlsx library | Excel spreadsheets |
| `.csv` | fs.readFile | Data exports |
| `.md` | fs.readFile | Markdown notes |
| `.eml` | email-parser | Email exports |
| `.msg` | node-msg-parser | Outlook messages |
| `.vtt` | text parse | Teams/Zoom transcripts |
| `.srt` | text parse | Subtitle / transcript |
| `.mp3` | OpenAI Whisper API | Audio recordings |
| `.m4a` | OpenAI Whisper API | Teams audio |
| `.wav` | OpenAI Whisper API | Audio files |
| `.mp4` | ffmpeg → Whisper API | Video — extract audio first |
| `.png` | Claude Vision API | Screenshots, diagrams |
| `.jpg` | Claude Vision API | Images |
| `.jpeg` | Claude Vision API | Images |

**Skipped (unsupported):** `.zip`, `.exe`, `.db`, `.dmg`, `.iso`, encrypted PDFs,
files with no extension, files under 100 bytes, files over 500MB.

---

## Audio and Video Processing

**Model:** `gpt-4o-mini-transcribe` (OpenAI Whisper API)
**Cost:** $0.003 per minute (cheapest accurate option — half price of standard Whisper)

Every audio/video file produces a transcript object:
```json
{
  "source_file": "/recordings/march-steering-committee.mp4",
  "transcript": "[full transcription text]",
  "duration_seconds": 3420,
  "language": "en",
  "model": "gpt-4o-mini-transcribe",
  "cost_usd": 0.342,
  "transcribed_at": "2026-04-22T10:00:00Z"
}
```

**25MB Limit:** Whisper API rejects files over 25MB. Atlas handles this automatically:
- Audio files >25MB → split into chunks via ffmpeg before API call
- Video files → extract audio track via ffmpeg → chunk if audio >25MB
- Temp audio files are deleted after transcription completes

---

## Dry Run Feature

Before any ingestion, the user can click **[Dry Run]** to:

1. Walk the entire folder (metadata only — no file content read)
2. Classify every file by type and size
3. Estimate processing time per file type
4. Estimate Whisper API costs for audio/video
5. Flag filenames suggesting sensitive content ("You Decide" screen)
6. Show estimated knowledge graph size (nodes + edges)

**No files are processed. No graph is written during dry run.**

The "You Decide" screen shows flagged files with default **Skip**. User toggles each to Allow.
Files set to Allow still pass through PII Redactor — RED content is blocked automatically
regardless of the user's allow decision.

User decisions are logged to `logs/audit_log.jsonl` before ingestion starts.

---

## Skill File Inheritance Hierarchy

```
skills/governance.md          ← MASTER RULES — ALL skills inherit from this
    ├── skills/ingestion.md        ← deep crawler + multi-modal parser rules
    ├── skills/dry_run.md          ← dry run engine rules
    ├── skills/pii_redactor.md     ← classification + transformation
    ├── skills/entity_extractor.md ← extraction (refs schema.json at runtime)
    ├── skills/graph_store.md      ← CDC + persistence
    ├── skills/query_router.md     ← routing + refusal
    ├── skills/response_synth.md   ← mandatory citation template
    └── skills/synthesis_agent.md  ← artefact generation
```

**CRITICAL RULE:** Load the relevant skill file before EVERY operation.
Never operate without the governing skill file loaded. Governance rules always apply.

---

## Schema — Single Source of Truth

**CRITICAL RULE:** Always load `graph/schema.json` at runtime before any operation
that reads from or writes to the knowledge graph. NEVER hardcode entity schemas in code.
The schema is the single canonical definition — it may change between sessions.

The graph stores data in three local JSON files:
- `graph/schema.json` — canonical entity schema
- `graph/nodes.json` — all entity nodes
- `graph/edges.json` — all relationships
- `graph/embeddings.json` — vector embeddings (future use)

---

## CDC — Change Data Capture

All graph mutations are tracked via **delta_log.jsonl** in `logs/`.

**NEVER compare snapshots.** Atlas uses cursor-based incremental ingestion:
- On each run, read `last_cursor` from `config/ingestion_config.json`
- Crawl only files modified after that cursor timestamp
- Append CDC events to `logs/delta_log.jsonl` (NEVER overwrite — append only)
- Write a `SYNC_CHECKPOINT` event at the end of successful ingestion
- Update `last_cursor` with the new checkpoint timestamp

CDC event types: `NODE_CREATED`, `NODE_UPDATED`, `EDGE_CREATED`, `EDGE_UPDATED`, `PURGE`, `SYNC_CHECKPOINT`

---

## External Research — Genspark + Fallback

Atlas uses Genspark API for external industry benchmarking and research.

If Genspark API is unavailable or not configured, fall back to Claude's built-in web search tool.

The "External Research" section in responses is **omitted entirely** if Genspark is not activated
for that query (INTERNAL-only queries do not call Genspark).

---

## Environment Variables

```
OPENAI_API_KEY=        # Required for Whisper audio transcription
ANTHROPIC_API_KEY=     # Required for Claude Vision API + reasoning
GENSPARK_API_KEY=      # Required for external research (optional — web search fallback)
ATLAS_INGESTION_PATH=  # Default folder path (can also be set in UI)
```

Load from `.env` file at startup. Never hardcode API keys.

---

## Entity Types

8 entity types defined in `graph/schema.json`:

| Entity | Purpose |
|---|---|
| `PERSON` | People mentioned across all documents |
| `PROJECT` | Projects, initiatives, workstreams |
| `DECISION` | Decisions made, with context and attribution |
| `DOCUMENT` | Documents in the knowledge graph |
| `MEETING` | Meetings with attendees, decisions, action items |
| `TOPIC` | Thematic tags linking entities |
| `FILE_SOURCE` | Every ingested file with metadata and checksum |
| `DELTA_EVENT` | CDC events tracking all graph mutations |

---

## Governance — Non-Negotiable Rules

1. Every response must cite exact source file, path, and timestamp
2. RED-classified content is NEVER returned to the user under any circumstances
3. Every REFUSE routing decision must be logged to `logs/audit_log.jsonl`
4. Sensitive filename detection runs on every crawl — even incremental runs
5. PII Redactor runs on ALL parsed content regardless of source format
6. Dry run decisions (Skip/Allow) are logged before ingestion proceeds
7. GDPR + PDPA Singapore compliance governs all data handling
8. Right to erasure: purge by file path removes all derived nodes and edges

---

## Build Status (Updated Each Session)

| Component | Status | Tests |
|---|---|---|
| Project scaffold | ✅ Complete | — |
| Deep Recursive Crawler | ✅ Complete | 20/20 passing |
| Dry Run Engine | ✅ Complete | 20/20 passing |
| Multi-Modal File Parser | ✅ Complete | 5/5 passing |
| PII Redactor | ✅ Complete | 19/19 passing |
| Entity Extractor | ✅ Complete | 18/18 passing |
| Knowledge Graph Store + Delta Tracker | ✅ Complete | 17/17 passing |
| Query Router | ✅ Complete | 17/17 passing |
| Response Synthesiser | ✅ Complete | covered |
| Genspark Integration | ✅ Complete (+ Claude web search fallback) | covered |
| Synthesis Agents (podcast + brief + handover + benchmark) | ✅ Complete | 3/3 passing |
| Express API Server | ✅ Complete (boot-tested) | — |
| Atlas UI (React) | ✅ Complete | — |

**Test Summary:** 8 suites, 119/119 tests passing (`maxWorkers: 1` to avoid filesystem races between suites).

## End-to-End Integration Test Results

Two E2E runs executed:

**Run 1 — real pipeline (no API keys present):**
- Staged 3 text files with Meridian / Project Phoenix scenario content
- Ran `graphStore.runIncrementalIngestion(tempFolder)` — processed all 3 files end-to-end
- Crawl → parse → PII redact → entity extract → merge → upsert → checkpoint
- Final nodes: **0** (Claude API unavailable — no `ANTHROPIC_API_KEY` in this environment)
- Pipeline completed in 557ms without crashing
- Graceful fallback behaviour confirmed for all downstream stages

**Run 2 — simulated post-extraction graph (pre-populated):**
- 6 nodes, 8 edges (what Claude extraction would produce from the scenario)
- Node types: 2 PERSON, 1 PROJECT, 1 DECISION, 1 MEETING, 1 TOPIC
- Query `"Who decided on the vendor for Project Phoenix?"` → classified INTERNAL, matched 5 relevant nodes
- Project Brief for "Project Phoenix" — 33 lines, all citations resolved to source file
- Handover Document for "Sarah Chen" — 33 lines, 7 sections including role, projects, decisions
- Podcast Script for "Project Phoenix" — 27 lines, references graph entities + external context placeholder

## Final Node Count

- **E2E (no API keys):** 0 nodes — extraction requires Claude API
- **E2E (simulated):** 6 nodes, 8 edges
- **Production expectation:** with a real `ANTHROPIC_API_KEY`, 3 Meridian files produce ~8–15 nodes and ~12–20 edges per the dry-run estimates (documents = 3 nodes / 4 edges average)

## Deviations from Plan

- `node-msg-parser` does not exist on npm. Replaced with `@kenjiuno/msgreader` (active, maintained). `.msg` files now parse via that library.
- Sensitive content includes a content-based classifier in the PII redactor, which is stricter than the plan's filename-only flagging. This is additive — the filename flagger still exists in the crawler and dry-run.
- Jest runs with `maxWorkers: 1` because multiple suites share `graph/nodes.json` / `graph/edges.json` / `logs/delta_log.jsonl` and parallel workers race on these files. An alternative would be per-suite temp paths via env vars — we deferred that to post-hackathon.
- The initial Sonnet model ID in scaffolding (`claude-sonnet-4-20250514`) is now deprecated. All 8 call-sites updated to `claude-sonnet-4-6`.
- Fallback behaviour is more extensive than the plan specified: every module that calls Claude has a structured fallback that produces useful output (cited markdown) when the API is unavailable. This was necessary for the E2E test to demonstrate the pipeline without API keys present.
