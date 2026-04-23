# Atlas — One Pager

**Consent-first, filesystem-native workspace intelligence.**

---

## Problem

Organisational knowledge is fragmented. It lives in Word docs, PowerPoints,
meeting recordings, emails, and images — under folder structures no one agreed
on. When someone leaves, goes on leave, or is unavailable, that knowledge
disappears. Everyone rebuilds context from scratch, over and over.

Existing tools fall short:

- **NotebookLM** is stateless — no persistent graph, no entity relationships, no cross-document intelligence, no external benchmarking.
- **Microsoft Copilot** is locked inside M365 apps, blocked by Conditional Access policies in most enterprise tenants, costs $30/user/month.
- **Cowork** does tasks with files but doesn't understand them.

## Solution

Atlas ingests any unstructured folder of files — documents, audio, video,
presentations, emails, images — and builds a persistent local knowledge graph.
Users ask natural language questions and get answers with exact citations,
augmented by external industry benchmarks via Genspark.

## How It Works

1. **Point at a folder** — user specifies the root path via a browser widget
   (OneDrive sync folder recommended for M365 users). Dry-run shows time, cost,
   and sensitive files before anything is ingested.
2. **Multi-modal ingestion** — 18 file formats parsed locally. Audio/video
   transcribed via Whisper ($0.003/min). Images described via Claude Vision.
   PII redaction runs on every parsed file. Entities extracted by parallel
   Claude sub-agents against a schema-driven model.
3. **Query and synthesise** — the Query Router classifies each question as
   INTERNAL, EXTERNAL, COMBINED, SYNTHESIS, or REFUSE. The graph retriever
   pulls cited nodes; Genspark adds industry context when needed; the
   synthesis agent generates podcasts, briefs, and handover documents.

## Why Atlas — at a glance

|  | NotebookLM | Copilot | Cowork | **Atlas** |
|---|:---:|:---:|:---:|:---:|
| Persistent knowledge graph | ❌ | ❌ | ❌ | ✅ |
| Works on any filesystem folder | ❌ | ❌ | ❌ | ✅ |
| Multi-modal (audio, video, images) | partial | ✅ | ❌ | ✅ |
| External benchmarking | ❌ | ❌ | ❌ | ✅ Genspark |
| No IT approval required | ✅ | ❌ | ✅ | ✅ |
| Consent-first by design | ✅ | ❌ | ❌ | ✅ |
| PDPA / GDPR governance | partial | ✅ | ❌ | ✅ |
| Citation-mandatory output | ✅ | partial | ❌ | ✅ |

## Three Deployment Tiers

1. **Personal (today)** — Any user, any folder. Zero IT involvement.
2. **Team (this quarter)** — Point at a shared OneDrive sync folder. Graphs mergeable with consent.
3. **Enterprise (next quarter)** — Atlas as an approved app. Role-based query scoping. Full audit trail for ISO 27001, SOC 2, PDPA.

## Tech Stack

| Layer | Technology |
|---|---|
| AI reasoning | Claude Sonnet 4.x via Anthropic SDK |
| Audio transcription | OpenAI `gpt-4o-mini-transcribe` ($0.003/min) |
| Image understanding | Claude Vision API |
| Document parsing | mammoth.js, pdf-parse, xlsx, JSZip, ffmpeg |
| External research | Genspark API (Claude web search fallback) |
| Graph storage | Local JSON + JSONL CDC stream |
| UI | React with browser-native folder picker (`webkitdirectory`) |
| API | Express + CORS |
| Runtime | Node.js 22 |

## Pricing Model

| Tier | Target | Price |
|---|---|---|
| Personal | Individual knowledge workers | Free during hackathon / $10–15/user/mo thereafter |
| Team | 5–50 person teams | $25–40/user/mo |
| Enterprise | ISO/SOC/PDPA-governed orgs | Custom, starts $50/user/mo |

**Unit economics (power user):** Whisper ~$1.80 + Vision ~$0.25 + Genspark ~$5
= **~$7 API cost / user / month**. Gross margin at $30 price point: **~76%**.

## Status

Hackathon build. Works end to end. Roadmap after hackathon:
persistent embeddings, team graph merging, Electron app for full filesystem
access, enterprise SSO, and an on-prem deployment mode for regulated sectors.
