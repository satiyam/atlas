# Synthesis Agent Skill

**Inherits from:** `skills/governance.md`
**Governs:** Artefact generation — podcasts, briefs, handovers, decision logs, benchmarks
**Implementation:** `src/synthesis/`

---

## Pre-Output Governance Check

Before generating ANY artefact, perform a governance check:
1. Load `skills/governance.md` — confirm rules are active
2. Verify all source content used is GREEN or AMBER (not RED)
3. Verify no AMBER content is un-redacted in the output
4. Confirm attribution will be present for every claim

If governance check fails for any reason, halt and return an error explaining the failure.

---

## Synthesis Commands and Output Formats

### 1. Podcast Script
**Command:** "Produce podcast script about [topic]"
**Output format:** Markdown (.md) with dialogue formatting
**Minimum length:** 800 words (enforced — return error if below)

**Two-voice format:**
```
HOST: [narrative question or setup — conversational, accessible]

EXPERT: [analytical response — draws from knowledge graph, specific facts and citations]

HOST: [follow-up question or transition]

EXPERT: [deeper analysis, context, or implications]
```

Rules:
- HOST role: narrative framing, accessible questions, storytelling
- EXPERT role: data-driven, specific, cites sources from the graph
- Multi-modal sourcing: use meeting transcripts as PRIMARY sources for content discussed
  in meetings. Audio/video transcripts carry equal weight to written documents.
- Every EXPERT claim must be attributable to a graph source
- Minimum 5 HOST/EXPERT exchanges before conclusion
- End with a "Key Takeaways" section (3-5 bullet points)
- Append transparency footer per `skills/response_synth.md`

### 2. Project Brief
**Command:** "Synthesise project brief for [project name]"
**Output format:** Markdown (.md)

6 required sections:
1. **Executive Summary** — 3-5 sentences, what the project is and why it matters
2. **Background and Context** — problem being solved, strategic alignment
3. **Key Decisions Made** — chronological decision log from DECISION nodes
4. **Team and Stakeholders** — PERSON nodes with CONTRIBUTED_TO relationships
5. **Status and Next Steps** — current status from PROJECT node + action items from MEETINGs
6. **Source Documents** — bibliography of all DOCUMENT nodes linked to project

Every section must cite specific source files.

### 3. Handover Document
**Command:** "Draft handover document for [person name]"
**Output format:** Markdown (.md)

7 required sections:
1. **Role Overview** — responsibilities, team, reporting line
2. **Active Projects** — all PROJECT nodes where person has CONTRIBUTED_TO or is owner
3. **Key Decisions Authored** — DECISION nodes where person is in `made_by`
4. **Meetings and Relationships** — MEETING attendance + key PERSON connections
5. **Documents Owned** — DOCUMENT nodes where person is author
6. **Knowledge Gaps** — topics the person was involved in where documentation is thin
7. **Recommended Handover Actions** — specific steps for knowledge transfer

### 4. Decision Log
**Command:** "Create decision log for [topic / project / time period]"
**Output format:** Markdown (.md) — chronological table + narrative

Table format:
| Date | Decision | Made By | Context | Source Document |
|---|---|---|---|---|

Followed by narrative synthesis of decision patterns and implications.

### 5. Benchmark Report
**Command:** "Generate benchmark report on [topic]"
**Output format:** Markdown (.md)

4 required sections:
1. **Internal Position** — what the knowledge graph reveals about current state
2. **Industry Benchmarks** — Genspark / external research data
3. **Gap Analysis** — where internal state differs from industry norms
4. **Recommendations** — specific, actionable, cited

Both internal graph and Genspark are REQUIRED for this command — do not proceed without both.

### 6. Onboarding Guide
**Command:** "Generate onboarding guide for [role / team]"
**Output format:** Markdown (.md)

Draws from recorded walkthroughs (if any audio/video ingested), key documents, and
meeting history. Covers: context, key people, active projects, decision history, tools,
and processes.

---

## Source Citation on All Artefacts

Every synthesis artefact must:
1. Cite all source files in a "Sources" section at the end
2. Include inline citations for major claims: `[Source: filename, p.3]` or
   `[Source: meeting-recording.mp4, transcript 00:12:34]`
3. Append transparency footer as defined in `skills/response_synth.md`

---

## Multi-Modal Sourcing

For meeting-related synthesis (meeting briefs, decision logs, handover sections about meetings):
- Use VTT/SRT transcripts as primary source if available
- Use audio/video transcripts (from Whisper) as equally valid source
- Written meeting notes are supplementary — transcripts take precedence for accuracy
- When citing a transcript: include timestamp reference e.g. `[Source: meeting.mp4, 00:23:15]`
