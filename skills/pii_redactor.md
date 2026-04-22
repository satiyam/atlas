# PII Redactor Skill

**Inherits from:** `skills/governance.md`
**Governs:** Content classification and PII transformation pipeline
**Implementation:** `src/ingestion/pii_redactor.js`

---

## Classification Rules

Load classification rules from `skills/governance.md` at runtime. The authoritative
classification tiers are defined there. This file specifies operational behaviour.

### GREEN
No transformation needed. Pass content through as-is to Entity Extractor.

### AMBER
Apply transformation rules before passing to Entity Extractor.
Content is usable but must have PII normalised.

### RED
**Block entirely.** Do NOT pass to Entity Extractor. Do NOT return to user.
Log the block to `logs/audit_log.jsonl` with:
- File path
- Classification reason (which RED trigger matched)
- Timestamp

The FILE_SOURCE node for a RED-blocked file is created with `ingestion_status: "skipped"`.
No DOCUMENT, DECISION, MEETING, or PERSON nodes are derived from RED content.

---

## Processing Order

```
Input: parsed file object from file_parser.js

Step 1: CLASSIFY
  → classify(content) → GREEN | AMBER | RED

Step 2a (if GREEN):
  → return { classification: "GREEN", content: originalContent, redacted: false }

Step 2b (if AMBER):
  → apply transformation rules
  → return { classification: "AMBER", content: transformedContent, redacted: true, transforms_applied: [...] }

Step 2c (if RED):
  → log to audit_log.jsonl
  → return { classification: "RED", content: null, reason: "[trigger matched]", blocked: true }

Step 3:
  → pass result to entity_extractor.js
  → entity extractor MUST check classification before processing
  → if classification === "RED": entity extractor must skip — do not process null content
```

---

## AMBER Transformation Rules

Applied in this exact order when content is classified AMBER:

1. **NRIC/FIN redaction** (highest priority — Singapore legal requirement)
   - Pattern: `[STFG]\d{7}[A-Z]`
   - Replace with: `[REDACTED-ID]`

2. **Email address anonymisation**
   - Pattern: `\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z]{2,}\b`
   - Replace with: `[name]@[domain]` preserving domain for context

3. **Phone number redaction**
   - Patterns: Singapore (+65), international formats, local 8-digit numbers
   - Replace with: `[REDACTED-PHONE]`

4. **Bank/card number redaction**
   - Pattern: 16-digit sequences, IBAN patterns
   - Replace with: `[REDACTED-FINANCIAL]`

5. **Home address redaction**
   - Pattern: Street + postal code combinations
   - Replace with: `[REDACTED-ADDRESS]`

6. **Full name normalisation** (last step — after identifiers removed)
   - Only applied when name appears in combination with a redacted identifier
   - Replace: `FirstName LastName` → `[Team Member]` or role label if determinable
   - Do NOT redact names that appear in a purely professional context (project lead, approver)

---

## Batch Processing

```javascript
async function redactBatch(parsedFiles) {
  return Promise.all(parsedFiles.map(file => redact(file)))
}
```

Runs in parallel — no concurrency limit (classification is CPU-only, no API calls).

Each file in the batch receives its own classification. Files in the same batch may
receive different classifications (e.g., some GREEN, some AMBER, some RED).

---

## Output Object

```javascript
{
  file_path: string,
  filename: string,
  file_type: string,
  classification: "GREEN" | "AMBER" | "RED",
  content: string | null,          // null if RED
  redacted: boolean,
  transforms_applied: string[],    // list of transform types applied (AMBER only)
  blocked: boolean,                // true if RED
  block_reason: string | null,     // which RED trigger matched
  original_checksum: string        // SHA-256 of pre-redaction content (for audit)
}
```

---

## Never Return RED Content

Under NO circumstances may RED-classified content be:
- Passed to the Entity Extractor
- Stored in the knowledge graph
- Returned in a query response
- Included in synthesis artefacts
- Shown in the UI

If any downstream component receives content with `classification: "RED"`, it must
immediately stop processing that content and log an error. This is a governance violation.
