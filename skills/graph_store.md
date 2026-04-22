# Graph Store Skill

**Inherits from:** `skills/governance.md`
**Governs:** Local JSON graph persistence, CDC event tracking, incremental ingestion
**Implementation:** `src/graph/graph_store.js`, `src/graph/delta_tracker.js`

---

## Local Storage Structure

The knowledge graph is stored in three local JSON files:

```
graph/
├── schema.json       ← canonical entity schema (SINGLE SOURCE OF TRUTH)
├── nodes.json        ← all entity nodes as JSON array
├── edges.json        ← all relationship edges as JSON array
└── embeddings.json   ← vector embeddings (future use — initialise as empty array)

logs/
├── delta_log.jsonl   ← CDC event stream (NEVER overwrite — append only)
└── audit_log.jsonl   ← governance audit trail (NEVER overwrite — append only)
```

**Node format in nodes.json:**
```json
[
  {
    "id": "uuid",
    "type": "PERSON",
    "data": { /* all entity fields per schema */ },
    "created_at": "ISO datetime",
    "updated_at": "ISO datetime"
  }
]
```

**Edge format in edges.json:**
```json
[
  {
    "id": "uuid",
    "from_id": "uuid",
    "from_type": "PERSON",
    "to_id": "uuid",
    "to_type": "PROJECT",
    "relationship": "CONTRIBUTED_TO",
    "created_at": "ISO datetime",
    "source_file": "file path"
  }
]
```

---

## CDC Event Types

All five CDC event types must be written to `logs/delta_log.jsonl` as JSONL (one JSON object per line).

### NODE_CREATED
```json
{
  "id": "uuid",
  "event_type": "NODE_CREATED",
  "entity_type": "PERSON",
  "entity_id": "uuid",
  "operation": "insert",
  "payload": { /* full node data */ },
  "cursor": "ISO datetime",
  "timestamp": "ISO datetime",
  "triggered_by": "file/path/here.docx"
}
```

### NODE_UPDATED
```json
{
  "id": "uuid",
  "event_type": "NODE_UPDATED",
  "entity_type": "PROJECT",
  "entity_id": "uuid",
  "operation": "update",
  "payload": {
    "before": { /* previous field values */ },
    "after": { /* new field values */ }
  },
  "cursor": "ISO datetime",
  "timestamp": "ISO datetime",
  "triggered_by": "file/path/here.pdf"
}
```

### EDGE_CREATED
```json
{
  "id": "uuid",
  "event_type": "EDGE_CREATED",
  "entity_type": "edge",
  "entity_id": "uuid",
  "operation": "insert",
  "payload": { /* full edge data */ },
  "cursor": "ISO datetime",
  "timestamp": "ISO datetime",
  "triggered_by": "file/path/here.eml"
}
```

### EDGE_UPDATED
```json
{
  "id": "uuid",
  "event_type": "EDGE_UPDATED",
  "entity_type": "edge",
  "entity_id": "uuid",
  "operation": "update",
  "payload": {
    "before": { /* previous edge data */ },
    "after": { /* new edge data */ }
  },
  "cursor": "ISO datetime",
  "timestamp": "ISO datetime",
  "triggered_by": "file/path"
}
```

### PURGE
```json
{
  "id": "uuid",
  "event_type": "PURGE",
  "entity_type": "PERSON",
  "entity_id": "uuid",
  "operation": "delete",
  "payload": { /* snapshot of deleted node at time of purge */ },
  "cursor": "ISO datetime",
  "timestamp": "ISO datetime",
  "triggered_by": "user-requested-erasure | file-deleted"
}
```

### SYNC_CHECKPOINT
```json
{
  "id": "uuid",
  "event_type": "SYNC_CHECKPOINT",
  "entity_type": null,
  "entity_id": null,
  "operation": "checkpoint",
  "payload": {
    "files_processed": 342,
    "nodes_created": 1204,
    "nodes_updated": 87,
    "edges_created": 2108,
    "errors": 3
  },
  "cursor": "ISO datetime",
  "timestamp": "ISO datetime",
  "triggered_by": "ingestion-complete"
}
```

---

## Incremental Ingestion Algorithm

```
1. Read last_cursor from config/ingestion_config.json
2. Call crawler.crawl(rootPath, lastCursor) → crawl results
3. For each file in changed[]:
   a. Call fileParser.parseFile(filePath) → parsed content
   b. Call piiRedactor.redact(parsed) → redacted content
   c. If classification === RED: skip to (f)
   d. Call entityExtractor.extractEntities(redacted) → entities
   e. Call graphStore.upsertNode() and upsertEdge() for each entity
      → appends NODE_CREATED / NODE_UPDATED / EDGE_CREATED CDC events
   f. Update FILE_SOURCE node with new checksum and ingestion_status
4. For each file in errors[]:
   → Update FILE_SOURCE.ingestion_status = "error"
5. Write SYNC_CHECKPOINT event to delta_log.jsonl
6. Update last_cursor to current timestamp in config/ingestion_config.json
```

---

## Checksum-Based Change Detection

On upsert:
1. Compute SHA-256 of new content
2. Find existing node by entity type + name (or file path for FILE_SOURCE)
3. If no existing node: CREATE (NODE_CREATED event)
4. If existing node found and checksum matches: SKIP (no CDC event — unchanged)
5. If existing node found and checksum differs: UPDATE (NODE_UPDATED event with before/after)

---

## NEVER Overwrite delta_log.jsonl

`logs/delta_log.jsonl` is an **append-only event stream**. Rules:
- Always use append mode: `fs.appendFileSync` or `createWriteStream({ flags: 'a' })`
- Never truncate, overwrite, or delete delta_log.jsonl
- If the file doesn't exist, create it — first append creates the file
- Each line is a single complete JSON object (JSONL format)

The same rule applies to `logs/audit_log.jsonl`.

---

## Purge Procedure

`purgeByFile(filePath)`:
1. Find all nodes where `data.source_file === filePath`
2. For each node: write PURGE CDC event, then delete node from nodes.json
3. Find all edges connected to any purged node
4. For each edge: write PURGE CDC event, then delete edge from edges.json
5. Update FILE_SOURCE node: `ingestion_status = "purged"`
6. Write SYNC_CHECKPOINT event recording the purge

Purge is permanent. The source file itself is NOT deleted — only the graph data derived
from it is removed. User must re-ingest the file to restore graph data.
