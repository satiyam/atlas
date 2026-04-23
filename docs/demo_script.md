# Atlas — 5 Minute Demo Script

**Scenario:** Meridian Corporation is selecting a vendor for Project Phoenix. The
knowledge lives in a mix of Word docs, meeting recordings, and emails — spread
across the OneDrive sync folder. We point Atlas at the folder and show how the
questions answer themselves.

---

## [0:00] Hook — 30 seconds

> "What happens to your organisation's knowledge when someone leaves?
> You rebuild context from scratch. Every time. You're paying for the same
> conversations, the same research, the same decisions — again and again.
>
> Atlas solves this. Point it at any folder of documents, audio, and images —
> and it builds a persistent knowledge graph that answers natural language
> questions with exact citations."

**On screen:** Atlas homepage in dark mode. Accent purple. Logo pulses once.

---

## [0:30] Folder Widget — 30 seconds

**[ACTION]** Click **Browse**. Select `demo-workspace/meridian/`.

**[SAY]**
> "Atlas works on any filesystem folder — Dropbox, Google Drive, SharePoint
> via OneDrive sync. I'm pointing it at a workspace that has Project Phoenix
> documents, meeting recordings, and emails."

**On screen:**
- Path appears in the input
- Scan results populate: "847 files · 143 folders · 7.5 GB"
- "2 sensitive filenames require review" warning

---

## [1:00] Dry Run — 45 seconds

**[ACTION]** Click **🔍 Dry Run**.

**[SAY]**
> "Before Atlas touches any content, it shows you exactly what it will
> ingest — time estimates, cost estimates, and sensitive file review."

**Walk through the modal:**
- File breakdown by extension (`.docx`, `.pdf`, `.mp4`, `.vtt`)
- Time estimate: `~1hr 46min`
- Cost estimate: `$2.70` for audio transcription (Whisper API)
- Graph estimate: `2,400–3,200 nodes`

**[ACTION]** Scroll to the "You Decide" section.

**[SAY]**
> "Atlas flags two files — `Payroll-March-2026.xlsx` and
> `HR-Performance-Review.docx`. Default is Skip. You can Allow them, but RED
> content still gets blocked by the PII redactor automatically. That's
> consent by configuration."

---

## [1:45] Start Ingestion — 30 seconds

**[ACTION]** Click **▶ Start Ingestion**.

**[SAY]**
> "Atlas is now crawling the folder, parsing 18 file formats — including
> audio transcription via OpenAI Whisper and image understanding via Claude
> Vision. Every file runs through the PII redactor first. Entities are
> extracted by parallel Claude sub-agents. Everything is tracked in a CDC
> event log for incremental re-ingestion later."

**On screen:** Progress bar advances. Current file name ticks through.

---

## [2:15] Internal Query — 45 seconds

**[ACTION]** Type into chat: *"Who decided on the vendor for Project Phoenix and why?"*

**[SAY]**
> "Here's the payoff. This question normally takes 45 minutes in Slack.
> Watch what Atlas does."

**On screen (annotated response):**
```
Sarah Chen, Procurement Lead, selected TechCorp as the primary vendor
for Project Phoenix. The decision was made during the April 15 steering
committee based on three criteria: cost, delivery timeline, and
existing integration capabilities.

--- Internal Sources ---
• Project Phoenix | PROJECT | phoenix-kickoff.docx
• Sarah Chen | PERSON | march-steering-committee.mp4
• Select TechCorp as vendor | DECISION | march-steering-committee.mp4

--- Knowledge Base Transparency ---
Nodes searched: 3,847
Last ingestion: 10 min ago
```

**[SAY]**
> "Every claim is cited — exact file, exact source. The decision came from
> a meeting recording, not a document. Atlas transcribed it and extracted
> the decision as a graph node."

---

## [3:00] Benchmark Query — 45 seconds

**[ACTION]** Type: *"How does our vendor selection process compare to industry best practice?"*

**[SAY]**
> "When a question needs outside context, Atlas routes it COMBINED —
> internal graph AND external research via Genspark. Notice the green
> border — that's the external research block."

**On screen:** Response shows Internal Sources (blue) + External Research (green).

---

## [3:45] Synthesis — 45 seconds

**[ACTION]** Switch to the right panel. Select **Podcast Script**. Type *"Project Phoenix"*. Click **Generate**.

**[SAY]**
> "This is where Atlas becomes a force multiplier. Generate a two-voice
> podcast script, a project brief, or a handover document — all grounded
> in your knowledge graph. No hallucinations. Every fact cited."

**On screen:** Script streams in with HOST / EXPERT dialogue. Scroll through.

**[ACTION]** Click **📥 Download .md**.

---

## [4:30] Dashboard — 20 seconds

**[SAY]**
> "The Knowledge Dashboard on the right shows exactly what Atlas knows.
> 3,847 nodes. 7,203 relationships. Ingested 10 minutes ago. Recent files.
>
> Atlas only knows what you gave it. Nothing more. No cloud connector.
> No M365 admin approval. No Conditional Access fight."

---

## [5:00] Close — 10 seconds

**[SAY]**
> "Institutional memory that grows with your team. Point. Ask. Generate.
> That's Atlas."

**On screen:** Atlas logo. Tagline: *"Consent-first workspace intelligence."*

---

## Demo checklist

- [ ] Meridian workspace folder staged with `.docx`, `.mp4`, `.eml`, `.vtt`, plus 2 sensitive filenames
- [ ] OneDrive icon visible in taskbar (reinforces "live M365" narrative)
- [ ] `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` set in `.env`
- [ ] Express server running on port 3001 (`npm run dev`)
- [ ] Browser at `http://localhost:3001` in full-screen mode
- [ ] Screen-recording dry-run as a backup in case live crawl is slow
- [ ] Practice flow in under 5 minutes, leaving 60s for judge Q&A
