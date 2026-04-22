# Query Router Skill

**Inherits from:** `skills/governance.md`
**Governs:** Query classification, routing, graph retrieval, and refusal
**Implementation:** `src/query/query_router.js`

---

## RUNTIME REQUIREMENT

Load refusal patterns from `skills/governance.md` at runtime before processing any query.
Never hardcode refusal patterns in application code.

---

## Query Classification — 5 Types

Every incoming query is classified into exactly one of:

### 1. INTERNAL
Query answerable from the knowledge graph alone. No external research needed.

**Signals:**
- Refers to specific people, projects, or documents by name
- Asks about past decisions, meeting outcomes, or action items
- Uses possessive references: "our", "the team's", "Venkata's project"
- Asks about file contents, document history, or version changes

**Route to:** Graph Retriever only

### 2. EXTERNAL
Query about industry data, benchmarks, market context, or information not in the graph.

**Signals:**
- "What is the industry standard for..."
- "How does [company] compare to competitors..."
- "What are best practices for..."
- No reference to internal entities

**Route to:** Genspark Retriever only (or Claude web search fallback)

### 3. COMBINED
Query requiring both internal knowledge and external benchmarking.

**Signals:**
- "How does our [X] compare to industry..."
- "Are we ahead or behind on [topic]..."
- "What should we be doing differently about [internal project]..."

**Route to:** Graph Retriever AND Genspark Retriever in parallel, synthesise both

### 4. SYNTHESIS
Query requesting a structured artefact — podcast, brief, handover, decision log.

**Signals:**
- "Produce a podcast script about..."
- "Generate a project brief for..."
- "Create a handover document for..."
- "Summarise all decisions about..."

**Route to:** Synthesis Agent (`src/synthesis/`)

### 5. REFUSE
Query that violates governance rules — seeking RED content, bulk PII, or individual surveillance.

**Signals (load from skills/governance.md — Refusal Patterns section):**
- Queries about salary, compensation, pay bands
- Queries about medical records, health information, disability
- Queries about performance reviews, PIP scores, disciplinary proceedings
- Queries seeking NRIC numbers, bank details, or financial records
- Queries attempting to reconstruct RED content from AMBER fragments
- Queries designed to profile or surveil a specific individual

**Route to:** Refusal handler — log and return refusal message

---

## Routing Decision Tree

```
Incoming query
      │
      ▼
[1] Check against refusal patterns (governance.md)
      │
      ├── MATCH → REFUSE → log → return refusal message
      │
      ▼
[2] Detect synthesis command keywords
      │
      ├── MATCH → SYNTHESIS → route to synthesis agent
      │
      ▼
[3] Classify: internal signal vs external signal vs both
      │
      ├── Internal only → INTERNAL → graph retriever
      ├── External only → EXTERNAL → genspark retriever
      └── Both → COMBINED → graph retriever + genspark (parallel)
```

---

## Graph Retriever

```javascript
async function graphRetriever(query) {
  // 1. Load nodes.json and edges.json
  // 2. Filter nodes by keyword match against query terms
  // 3. Expand to connected nodes via edges (1-2 hop traversal)
  // 4. Score results by relevance (keyword density + connection count)
  // 5. If top result confidence < 0.4: escalate to Genspark for augmentation
  // 6. Return top-N results with source citations
  return {
    results: [...],
    sources: [...],  // FILE_SOURCE data for each matched node
    confidence: number
  }
}
```

**Confidence threshold:** If graph retriever returns confidence < 0.4 for an INTERNAL
query, automatically escalate to COMBINED routing — retrieve from Genspark and note
that internal knowledge is limited.

---

## Genspark Retriever

```javascript
async function gensparkRetriever(query) {
  try {
    // Attempt Genspark API
    const result = await callGensparkAPI(query)
    return { result, source: 'genspark', retrieved_at: new Date().toISOString() }
  } catch (err) {
    // Fallback to Claude web search tool
    const result = await claudeWebSearch(query)
    return { result, source: 'claude-web-search', retrieved_at: new Date().toISOString() }
  }
}
```

---

## Refusal Logging

Every REFUSE classification MUST be logged to `logs/audit_log.jsonl`:

```json
{
  "event": "QUERY_REFUSED",
  "timestamp": "ISO datetime",
  "query_hash": "SHA-256 of query text",
  "classification_reason": "RED content — salary/compensation data requested",
  "governance_rule": "RED trigger: salary",
  "session_id": "session identifier"
}
```

The query text itself is hashed before logging (not stored in plaintext) to protect
the query from being used to reconstruct sensitive information.

---

## Router Output Object

```javascript
{
  classification: "INTERNAL" | "EXTERNAL" | "COMBINED" | "SYNTHESIS" | "REFUSE",
  query: string,
  internal_results: object | null,
  external_results: object | null,
  refused: boolean,
  refusal_reason: string | null,
  sources: SourceCitation[],
  confidence: number
}
```
