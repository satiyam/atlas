# Dry Run Skill

**Inherits from:** `skills/governance.md`
**Governs:** Dry Run Engine — estimation, flagging, and "You Decide" review
**Implementation:** `src/ingestion/dry_run.js`

---

## What Dry Run Does

Dry run is a **metadata-only scan**. It:

- Walks the entire root folder via the Deep Recursive Crawler
- Reads only filesystem metadata: filename, size, extension, last_modified
- DOES NOT read file content
- DOES NOT call any external API (no Whisper, no Vision, no Claude)
- DOES NOT write any graph data
- DOES NOT modify `config/ingestion_config.json`
- DOES NOT append to `logs/delta_log.jsonl`

Dry run produces a **Dry Run Report** that the user reviews before deciding to ingest.

---

## Dry Run Report — Output Format

```javascript
{
  scanned_at: string,          // ISO datetime
  root_path: string,           // folder path scanned
  scan_duration_ms: number,
  file_breakdown: {
    [extension]: {
      count: number,
      total_size_bytes: number,
      total_size_mb: number
    }
  },
  supported_count: number,
  skipped_count: number,
  skipped_breakdown: {
    [extension]: number        // count of unsupported files per extension
  },
  flagged: [
    {
      filename: string,
      path: string,
      size_bytes: number,
      extension: string,
      matched_pattern: string, // which governance pattern triggered the flag
      user_decision: string    // "skip" | "allow" — default "skip"
    }
  ],
  time_estimate: {
    parsing_seconds: number,
    audio_transcription_seconds: number,
    pii_redaction_seconds: number,
    entity_extraction_seconds: number,
    graph_commit_seconds: number,
    total_seconds: number,
    total_human: string        // e.g. "1hr 46min"
  },
  cost_estimate: {
    audio_transcription_usd: number,
    other_usd: 0,
    total_usd: number,
    audio_file_count: number,
    estimated_audio_minutes: number
  },
  graph_size_estimate: {
    min_nodes: number,
    max_nodes: number,
    min_edges: number,
    max_edges: number,
    estimated_mb: number
  }
}
```

---

## Time Estimation Algorithm

Processing rates in seconds per MB of file size:

```javascript
const PROCESSING_RATES_SECONDS_PER_MB = {
  '.txt':   0.2,
  '.vtt':   0.2,
  '.srt':   0.2,
  '.csv':   0.3,
  '.md':    0.2,
  '.docx':  0.8,
  '.pdf':   1.2,
  '.xlsx':  0.5,
  '.eml':   0.3,
  '.msg':   0.4,
  '.pptx':  1.0,
  '.png':   1.5,
  '.jpg':   1.5,
  '.jpeg':  1.5,
  '.mp3':   0.18,
  '.m4a':   0.18,
  '.wav':   0.18,
  '.mp4':   0.25
}

const OVERHEAD = {
  pii_redaction: 0.15,       // 15% multiplier applied to all files
  entity_extraction: 0.40,   // 40% multiplier (Claude sub-agent calls)
  graph_commit: 300           // flat 5 minutes regardless of file count
}
```

**Audio/video time estimation:**
- 1MB of MP3 ≈ 1 minute of audio at 128kbps (rough proxy for duration)
- `estimatedMinutes = size_mb * 1.0`
- `processingSeconds = estimatedMinutes * 60 * rate[extension]`

**Other formats:**
- `processingSeconds = size_mb * rate[extension]` (minimum 1.0 if extension unknown)

**Apply overhead:**
```javascript
totalSeconds = parsingSeconds * (1 + OVERHEAD.pii_redaction + OVERHEAD.entity_extraction)
totalSeconds += OVERHEAD.graph_commit
```

---

## Cost Estimation Algorithm

Only audio and video files have API costs. All other parsing is free.

**Whisper API cost:** $0.003 per minute of audio

```javascript
function estimateCost(files) {
  const audioExtensions = ['.mp3', '.m4a', '.wav', '.mp4']
  const audioFiles = files.filter(f => audioExtensions.includes(f.extension))

  // 1MB ≈ 1 minute of audio (128kbps MP3 approximation)
  const totalMinutes = audioFiles.reduce((sum, f) => sum + (f.size_bytes / 1024 / 1024), 0)
  const cost = totalMinutes * 0.003

  return {
    audio_transcription_usd: Math.round(cost * 100) / 100,
    other_usd: 0,
    total_usd: Math.round(cost * 100) / 100,
    audio_file_count: audioFiles.length,
    estimated_audio_minutes: Math.round(totalMinutes)
  }
}
```

---

## Graph Size Estimation

Estimate based on file count by type:

```javascript
const NODES_PER_FILE_TYPE = {
  '.docx': { min: 3, max: 8 },
  '.pdf':  { min: 2, max: 6 },
  '.pptx': { min: 2, max: 5 },
  '.eml':  { min: 2, max: 4 },
  '.msg':  { min: 2, max: 4 },
  '.vtt':  { min: 4, max: 10 },  // meeting transcripts — highest entity density
  '.srt':  { min: 4, max: 10 },
  '.mp3':  { min: 3, max: 8 },
  '.mp4':  { min: 3, max: 8 },
  default: { min: 1, max: 3 }
}

const EDGES_PER_NODE = { min: 1.8, max: 2.5 }
const BYTES_PER_NODE = 450  // estimated JSON size per graph node
```

---

## Sensitive Filename Flagging

Load sensitive filename patterns from `skills/governance.md` at runtime. Apply to every
discovered file. If any pattern matches, add to `flagged[]` array.

**Default decision: Skip.** The "You Decide" UI renders all flagged files with:
- Filename and path
- File size
- Which pattern triggered the flag
- Toggle: Skip (default, highlighted) | Allow

If user toggles a file to Allow:
- File is added to the approved list
- File still passes through PII Redactor during actual ingestion
- Content classified RED is blocked automatically — the Allow decision does NOT bypass RED

**You Decide is mandatory for flagged files** — ingestion cannot begin until the user
has made a decision (Skip or Allow) for every flagged file.

---

## User Decision Logging

Before ingestion begins (after user clicks Start Ingestion), log all dry run decisions
to `logs/audit_log.jsonl`:

```json
{
  "event": "DRY_RUN_DECISION",
  "timestamp": "2026-04-22T10:00:00Z",
  "root_path": "/path/to/folder",
  "decisions": [
    {
      "filename": "HR-Performance-Review-2025.docx",
      "path": "/path/to/file",
      "decision": "skip",
      "matched_pattern": "/performance.?review/i"
    }
  ],
  "total_approved": 1124,
  "total_skipped": 8
}
```

---

## Subsequent Run Behaviour

On subsequent ingestion runs (after initial full ingest):

- Dry run only shows files modified after `last_cursor` timestamp
- Time and cost estimates reflect only the delta (changed files), not the full folder
- Graph size estimate shows incremental additions, not full graph size
- "Note: Subsequent runs are faster — only changed files are processed" shown in UI
