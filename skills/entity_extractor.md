# Entity Extractor Skill

**Inherits from:** `skills/governance.md`
**Governs:** Schema-driven entity extraction from parsed, redacted content
**Implementation:** `src/ingestion/entity_extractor.js`

---

## CRITICAL RUNTIME REQUIREMENT

**Load `graph/schema.json` at the START of every extraction run.**

Never hardcode entity schemas, field names, or relationship types in application code.
The schema is the single source of truth and may be updated between sessions.

```javascript
async function loadSchema() {
  const schema = JSON.parse(await fs.readFile('graph/schema.json', 'utf8'))
  return schema
}
```

If `graph/schema.json` cannot be read, HALT and return an error — do not attempt
extraction with a stale or assumed schema.

---

## Signal vs Noise Filter

Before extraction, filter content to determine if it carries extractable signal.

**EXTRACT when content contains any of:**
- Named individuals with associated roles, teams, or actions
- Project names, initiative names, workstream labels
- Explicit decisions, approvals, or choices made
- Meeting references (dates, attendees, action items)
- Document references, version numbers, authorship
- Dates associated with events or outcomes
- Topic labels that recur across multiple files

**SKIP (treat as noise) when content:**
- Is fewer than 50 words after cleaning (insufficient context)
- Contains only boilerplate (auto-signatures, disclaimer footers, copyright notices)
- Is a navigation element, table of contents, or page header/footer
- Contains only numbers, codes, or system-generated identifiers with no context
- Is flagged as duplicate (checksum matches an already-processed content block)

---

## Extraction Process

### Step 1: Schema Load
```javascript
const schema = await loadSchema()
```

### Step 2: Signal Filter
```javascript
const hasSignal = filterSignal(redactedContent)
if (!hasSignal) return { entities: [], edges: [], skipped: true }
```

### Step 3: Parallel Sub-Agent Extraction
For each entity type defined in `graph/schema.json`:
- Spawn a sub-agent or parallel Claude call targeting that entity type
- Provide: (1) redacted content, (2) entity field definitions from schema,
  (3) extraction instructions below

**Extraction instruction for each entity type:**
```
Extract all [ENTITY_TYPE] entities from the following content.
For each entity, return a JSON object with ONLY fields defined in the schema.
Required fields must be present. Optional fields: include only if clearly present in text.
Do not invent data. If a field is uncertain, omit it.
Return an array of entity objects, or an empty array if none found.

Schema for [ENTITY_TYPE]:
[inject field definitions from schema]

Content:
[redacted content]
```

### Step 4: Staging
All extracted entities go to a staging area before graph commit.
Do not write to `graph/nodes.json` or `graph/edges.json` during extraction.

### Step 5: Merge and Validate
```javascript
async function mergeAndValidate(results) {
  // 1. Deduplicate: merge entities with same name+type using fuzzy match
  // 2. Validate: every required field present per schema
  // 3. Resolve references: link DECISION.made_by to PERSON.id where possible
  // 4. Assign UUIDs to new entities
  // 5. Validate edges against schema relationship definitions
  // 6. Return validated entities ready for graph commit
}
```

### Step 6: Schema Validation Before Graph Commit
Before writing anything:
- Verify each entity has all required fields
- Verify entity type is in schema
- Verify edge relationship type is in schema relationships list
- Reject any entity or edge that fails validation — log rejection to error log

---

## Multi-Modal Awareness

Transcripts (from `.vtt`, `.srt`, `.mp3`, `.m4a`, `.wav`, `.mp4`) and image descriptions
(from `.png`, `.jpg`, `.jpeg`) are treated as **equal signal** to text documents.

When extracting from transcript content:
- Speaker labels (`SPEAKER_01:`, `James:`) should be used to attribute decisions and actions
- Timestamps in transcripts are valid `date` values for DECISION and MEETING entities
- Action items stated verbally are as valid as written action items

When extracting from image descriptions:
- Treat the Claude Vision API description as the document text
- Extract project names, people, dates, and decisions visible in the image
- Note in entity metadata that source was an image description

---

## Output Object

```javascript
{
  source_file: string,
  source_checksum: string,
  entities: {
    PERSON: EntityObject[],
    PROJECT: EntityObject[],
    DECISION: EntityObject[],
    DOCUMENT: EntityObject[],
    MEETING: EntityObject[],
    TOPIC: EntityObject[],
    FILE_SOURCE: EntityObject[]
  },
  edges: EdgeObject[],
  skipped: boolean,
  skip_reason: string | null,
  extraction_errors: string[]
}
```
