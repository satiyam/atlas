# Ingestion Skill

**Inherits from:** `skills/governance.md`
**Governs:** Deep Recursive Crawler + Multi-Modal File Parser
**Implementation:** `src/ingestion/crawler.js`, `src/ingestion/file_parser.js`

---

## Deep Recursive Crawler

### Behaviour

The crawler walks the user-specified root folder with **no structure assumptions** and
**no depth limit**. It handles arbitrary nesting, mixed naming conventions, and all
filesystem anomalies gracefully.

### Crawl Output Object

```javascript
{
  changed: [],      // files modified after last_cursor — to be processed
  unchanged: [],    // checksum matches existing node — skip processing
  unsupported: [],  // extension not in supported list — log and skip
  flagged: [],      // sensitive filename pattern matched — "You Decide" review
  errors: []        // permission denied, corrupt file, symlink loop, etc.
}
```

### Supported Extensions

The authoritative list is in `config/ingestion_config.json`. At runtime, load this list
from config — never hardcode it. Current list:

```
.docx  .pdf   .txt   .pptx  .xlsx  .eml   .msg
.vtt   .srt   .mp3   .m4a   .wav   .mp4
.png   .jpg   .jpeg  .csv   .md
```

### Skip Conditions

Skip (move to `errors[]` or `unsupported[]`) when ANY of the following apply:

| Condition | Result bucket | Action |
|---|---|---|
| File size < 100 bytes | `unsupported` | Log as noise threshold |
| File size > 500MB | `unsupported` | Log as oversized — chunking not supported |
| Extension not in supported list | `unsupported` | Log extension for stats |
| Permission denied on file | `errors` | Log error, continue crawl |
| Permission denied on directory | `errors` | Log error, skip subtree, continue |
| Symlink detected | Check for loop | If loop: `errors`, else follow once only |
| File has no extension | `unsupported` | Log and skip |
| File is in excluded folder | `unsupported` | Skip entire subtree |

**Excluded folders** (from `config/ingestion_config.json`):
`node_modules`, `.git`, `_archive`, `.tmp`, `Thumbs.db`

### Checksum-Based Change Detection

For each file discovered:
1. Read file `last_modified` timestamp from filesystem metadata (no content read)
2. If `last_modified <= last_cursor`: check existing checksum in `graph/nodes.json`
   - If checksum matches: add to `unchanged[]` — skip ingestion
   - If checksum differs (file modified but timestamp stale): add to `changed[]`
3. If `last_modified > last_cursor`: add to `changed[]` — process file
4. If no existing node found: add to `changed[]` — new file

### Sensitive Filename Detection

On every file discovered, test filename against patterns from `skills/governance.md`:
- If any pattern matches: add to BOTH `changed[]` AND `flagged[]`
- Do NOT skip flagged files from `changed[]` — they remain in scope for ingestion
- Flagged files are surfaced in Dry Run "You Decide" screen
- If user skips a flagged file: remove from `changed[]` before parser runs
- If user allows a flagged file: it stays in `changed[]` and passes through PII Redactor

### Handling Special Cases

**Unicode and emoji filenames:** Use Node.js `fs.readdir` with `{ encoding: 'utf8' }` —
handles all unicode filenames natively.

**Spaces in filenames:** Always use absolute path joining — never string concatenation.

**Symlink loops:** Track visited real paths using a Set. If `fs.realpathSync(entry)` is
already in the Set, log and skip. Add to Set before recursing.

**Very deep nesting:** Use iterative traversal with an explicit stack, not recursive
function calls, to avoid stack overflow on deep folder structures (>1000 levels).

---

## Multi-Modal File Parser

### Routing Table

Every file in `changed[]` is routed to the correct parser based on extension:

| Extension | Parser | Library / API |
|---|---|---|
| `.docx` | Word document parser | mammoth.js |
| `.pdf` | PDF text extractor | pdf-parse |
| `.txt`, `.csv`, `.md` | Plain text reader | fs.readFileSync |
| `.xlsx` | Spreadsheet text extractor | xlsx library |
| `.pptx` | PowerPoint text extractor | Custom PPTX parser |
| `.eml` | Email parser | nodemailer / custom |
| `.msg` | Outlook message parser | node-msg-parser |
| `.vtt` | VTT transcript parser | Custom VTT stripper |
| `.srt` | SRT subtitle parser | Custom SRT stripper |
| `.mp3`, `.m4a`, `.wav` | Whisper API | OpenAI audio.transcriptions |
| `.mp4` | ffmpeg → Whisper API | fluent-ffmpeg + OpenAI |
| `.png`, `.jpg`, `.jpeg` | Claude Vision API | @anthropic-ai/sdk |

### Standard Parser Output Object

Every parser MUST return this structure:

```javascript
{
  file_path: string,         // absolute path
  filename: string,          // basename with extension
  file_type: string,         // extension e.g. ".docx"
  last_modified: string,     // ISO datetime
  size_bytes: number,
  checksum: string,          // SHA-256 of file content
  raw_text: string,          // extracted text content
  metadata: {
    author: string | null,
    created_at: string | null,
    page_count: number | null,    // for documents
    duration_seconds: number | null,  // for audio/video
    transcription_id: string | null,
    transcription_cost_usd: number | null,
    language: string | null,
    slide_count: number | null,   // for .pptx
    sheet_names: string[] | null  // for .xlsx
  },
  parse_error: string | null    // null if successful
}
```

### Audio/Video Parsing Rules

**25MB Limit:** OpenAI Whisper API rejects audio files over 25MB.

- If audio file size ≤ 25MB: send directly to `gpt-4o-mini-transcribe`
- If audio file size > 25MB: chunk using ffmpeg into ≤24MB segments, transcribe each,
  concatenate transcripts in order
- Video files (.mp4): extract audio track to temp `.mp3` file first via ffmpeg,
  then apply 25MB check and transcribe
- Temp audio files MUST be deleted immediately after transcription completes
- Track `transcription_cost_usd` = (duration_seconds / 60) × 0.003

**Audio transcription metadata:**
```javascript
metadata: {
  transcription_id: response.id,
  transcription_cost_usd: (duration_seconds / 60) * 0.003,
  duration_seconds: estimatedDuration,
  language: response.language || 'en',
  model: 'gpt-4o-mini-transcribe'
}
```

### Image Parsing Rules

For `.png`, `.jpg`, `.jpeg`:
1. Read file as base64
2. Detect MIME type from extension
3. Send to Claude Vision API with this exact prompt:
   ```
   Describe all text, diagrams, charts, and information visible in this image.
   Focus on extracting: decisions made, project names, people mentioned, dates,
   outcomes, action items, and any organisational context. Be thorough.
   ```
4. Return Vision API response as `raw_text`

### VTT/SRT Parsing Rules

Strip timestamp headers and speaker labels to extract clean spoken text:
- VTT: Remove `WEBVTT` header, remove `HH:MM:SS.mmm --> HH:MM:SS.mmm` lines,
  remove cue identifiers, join remaining text
- SRT: Remove sequence numbers, remove `HH:MM:SS,mmm --> HH:MM:SS,mmm` lines,
  join remaining text

### Batch Processing

`parseBatch(filePaths)` processes files in parallel with concurrency limits:
- Documents/text: up to 10 concurrent
- Audio/video (Whisper API): respect `audio_concurrency_limit` from config (default: 3)
- Images (Vision API): up to 5 concurrent
