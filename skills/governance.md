# Governance — Master Rules

**Role:** Master policy file. ALL Atlas skill files inherit from this.
**Authority:** Highest — no skill may override governance rules.
**Applies to:** Every operation Atlas performs — ingestion, query, synthesis, export.

---

## Data Classification

All content processed by Atlas is classified into one of three tiers:

### GREEN — Safe to Process and Return
Content that contains no personal identifiers, no sensitive HR or financial data,
and no regulated information. May be returned to the user with standard attribution.

**Examples:** Project plans, technical specifications, product roadmaps, public meeting notes,
industry research, vendor comparisons, process documentation, architecture diagrams.

### AMBER — Process with Transformation
Content that contains personal identifiers (names, email addresses, phone numbers)
or mildly sensitive operational data. May be processed and returned ONLY after
PII transformation rules are applied. Entities are extracted but identifying
details are normalised to role/function labels where appropriate.

**AMBER triggers (any of the following present):**
- Full name + email address in combination
- Singapore NRIC/FIN number: `[STFG]\d{7}[A-Z]`
- Passport or national ID numbers
- Phone numbers in combination with names
- Home address details
- Employee ID numbers
- Bank account or card numbers (partial)
- Date of birth

### RED — Block Entirely. Never Process, Never Return.
Content containing sensitive HR, medical, financial, or legally-regulated information.
RED content is blocked at the PII Redactor stage and never reaches the Entity Extractor
or Query Router. If a file is classified RED, its FILE_SOURCE node is created with
`ingestion_status: "skipped"` but no DOCUMENT or DECISION nodes are derived from it.

**RED triggers (any of the following present in filename OR content):**
- `salary`, `compensation`, `bonus`, `pay band`, `pay grade`, `remuneration`
- `medical`, `health record`, `disability`, `sick leave`, `diagnosis`
- `performance review`, `underperforming`, `PIP`, `performance improvement plan`
- `probation`, `misconduct`, `disciplinary`, `grievance`, `HR investigation`
- `termination`, `redundancy`, `dismissal`, `retrenchment`
- `insurance claim`, `NRIC` (in HR context), `personal data export`
- Full text of employment contracts with compensation terms
- Psychological assessment results
- Union membership or negotiation records

---

## PII Redaction Transformation Rules (AMBER content)

Apply in this order:
1. **Classify** the content block (GREEN / AMBER / RED)
2. **If RED:** return `{ classification: "RED", content: null, reason: "[trigger]" }` — stop here
3. **If AMBER:** apply transformations:
   - Replace full names with role+initial where context permits: `James Tan` → `Project Lead J.T.`
   - Replace email addresses with domain-anonymised form: `james@temus.com` → `[team-member]@temus.com`
   - Replace phone numbers with `[REDACTED-PHONE]`
   - Replace NRIC/FIN with `[REDACTED-ID]`
   - Replace bank/card numbers with `[REDACTED-FINANCIAL]`
   - Replace home addresses with `[REDACTED-ADDRESS]`
4. **If GREEN:** return content as-is

**Singapore NRIC/FIN Regex:**
```
[STFG]\d{7}[A-Z]
```

---

## Sensitive Filename Patterns (for Dry Run flagging)

The following patterns, when matched against a filename, trigger "You Decide" review:

```
/payroll/i
/salary/i
/compensation/i
/performance.?review/i
/disciplinary/i
/termination/i
/grievance/i
/medical/i
/insurance.?claim/i
/hr.?investigation/i
/redundancy/i
/\bpip\b/i
/personal.?data/i
/health.?record/i
/retrenchment/i
/misconduct/i
/probation/i
```

---

## Query Refusal Patterns

The Query Router MUST refuse queries that seek:

1. **Red-classified content:** Any query attempting to retrieve content that would have been
   classified RED during ingestion (salary data, medical records, HR investigation details,
   performance review scores, termination details)

2. **Individual surveillance:** Queries designed to track or profile a specific individual's
   movements, communications, or behaviour without clear business purpose

3. **Bulk PII extraction:** Queries that would produce a list of personal identifiers,
   NRIC numbers, bank details, or medical information

4. **Inference of RED from AMBER:** Queries that attempt to reconstruct RED-classified
   content by combining multiple AMBER sources

**Refusal response format:**
```
I'm not able to retrieve that information. Atlas governance rules classify this content
as sensitive under [GDPR / PDPA Singapore / RED data policy].

If you believe this restriction is incorrect, contact your Atlas administrator.
Refusal logged: [timestamp] | Query ID: [id]
```

**Every refusal MUST be logged** to `logs/audit_log.jsonl` with:
- Timestamp
- Query text (or hash if highly sensitive)
- Classification reason
- User session identifier

---

## Attribution and Citation Requirements

Every response from Atlas MUST include:

1. **Internal source citation:** For every claim drawn from the knowledge graph:
   - Exact source filename
   - File type
   - Author (if known)
   - Last modified date
   - Absolute file path

2. **External source citation:** For every claim drawn from Genspark or web search:
   - Source name / publication
   - URL
   - Retrieved date

3. **Transparency footer:** Every response must end with:
   - Root folder path
   - Number of files accessed
   - Last ingestion timestamp
   - Audio transcription cost (if audio files were accessed this session)

**Never reproduce verbatim source content** — summarise and cite. This applies to
all synthesis artefacts including podcasts, briefs, and handover documents.

---

## Right to Erasure Procedure

When a user requests erasure of a specific file's data:

1. Call `purgeByFile(filePath)` in `src/graph/graph_store.js`
2. This removes all nodes and edges where `source_file === filePath`
3. Appends a `PURGE` DELTA_EVENT to `logs/delta_log.jsonl` for each removed entity
4. Updates `FILE_SOURCE.ingestion_status` to `"purged"` for that file
5. The purge is permanent and irreversible — the file must be re-ingested to restore data

---

## GDPR + PDPA Singapore Compliance Declaration

Atlas is designed with privacy-by-design principles:

- **Data minimisation:** Only data necessary for organisational knowledge is extracted
- **Purpose limitation:** Extracted data is used only for knowledge graph queries and synthesis
- **Storage limitation:** All data stored locally — no cloud transmission without explicit consent
- **Integrity and confidentiality:** RED-classified content never stored in graph
- **Right to erasure:** Implemented via purge procedure above
- **PDPA Singapore:** Singapore NRIC/FIN numbers are detected and redacted under AMBER rules
- **Consent mechanism:** Pointing Atlas at a folder is the consent act — clearly communicated in UI

Atlas does NOT:
- Transmit file content to external services (except Whisper API for audio, Vision API for images)
- Store or log full file content in audit logs
- Share knowledge graph data with third parties

---

## Skill Inheritance Order

When a skill file is loaded, governance rules always take precedence. The priority order is:

```
1. governance.md (this file) — absolute authority
2. Specific skill file (ingestion, pii_redactor, etc.)
3. Runtime configuration (config/ingestion_config.json)
4. User instructions
```

If any user instruction conflicts with governance rules, governance wins.
Log the conflict to `logs/audit_log.jsonl` and explain the limitation to the user.
