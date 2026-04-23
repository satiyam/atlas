# Atlas — Judge Q&A Prep

Ten questions we expect. Honest answers kept under a minute each.

---

## 1. How is this different from NotebookLM?

NotebookLM is stateless — each notebook is a fresh session over a fixed set of
documents. Atlas is **graph-native and persistent**. Every ingest updates a
structured knowledge graph with 8 entity types and 9 relationship types.
Ask the same question six months later — the graph has grown, the answer is
better, nothing is re-parsed. NotebookLM also doesn't cross-reference content
across documents the way a graph can, and it has no external benchmarking.

---

## 2. How is this different from Microsoft Copilot?

Three differences:

1. **Locked out** — Copilot is blocked by Conditional Access policies in
   most enterprise tenants. Atlas runs on local files you already own.
2. **Locked in** — Copilot only works inside M365 apps. Atlas works on any
   folder, any format — including OneDrive sync folders, which is the
   workaround that gets you most of M365's content anyway.
3. **Cost** — Copilot is $30/user/month. Atlas API costs are ~$7/user/month
   at power-user scale.

---

## 3. Why local filesystem instead of M365 API?

Because the M365 Graph API is gate-kept. In most enterprise tenants:
Conditional Access blocks third-party access, IT admins have to consent to
every app, and rollout timelines are measured in quarters. The OneDrive sync
folder is already running on every M365 user's laptop — it's a live local
mirror of SharePoint. Atlas points at that folder and gets real org data with
zero API calls and zero IT approval. **User-level decision, not tenant-level.**

---

## 4. What about data governance and privacy?

Privacy by design:

- **Local-first** — file content never leaves the machine except for Whisper
  (audio) and Vision (images), both documented and minimal.
- **RED classification blocks** — content matching salary, medical, HR,
  disciplinary patterns is detected at ingestion and never enters the graph.
- **AMBER redaction** — NRIC/FIN, emails, phone numbers are transformed
  before extraction.
- **Consent act** — pointing at a folder is the consent. Dry Run shows
  exactly what will be ingested. "You Decide" review for sensitive filenames.
- **Right to erasure** — `purgeByFile(path)` removes all derived nodes and
  edges; `PURGE` events recorded in the CDC log.
- **PDPA Singapore compliant** — NRIC regex detection is built into the
  AMBER classifier by default.

---

## 5. What if someone ingests sensitive documents?

Two defences:

1. **Filename flagging** — regex patterns (`/payroll/i`, `/salary/i`,
   `/performance.?review/i`, etc.) trigger "You Decide" review at dry-run.
   Default is Skip. User explicitly has to Allow.
2. **Content classification** — even if a user Allows a flagged file, the
   PII Redactor runs first. Content matching RED triggers is blocked from
   entering the graph. This is a governance guarantee, not a policy.

A file that's mostly clean but contains one salary number gets blocked. A file
with names and emails gets redacted to AMBER form before extraction.

---

## 6. Can this scale beyond one user?

Three tiers:

- **Personal** works today.
- **Team** works today when team members point at the same shared OneDrive
  folder. Each gets their own graph. Graphs are JSON and mergeable.
- **Enterprise** needs: persistent embeddings (vector store instead of local
  JSON), role-based query scoping, SSO, centralised audit — all on the
  roadmap.

The ingestion pipeline is stateless per file and parallel by design —
concurrency limits already respect Whisper rate limits. Scaling to 100k
documents in JSON works; past that we swap to Neo4j + Weaviate, documented in
`ATLAS_PLAN.md` section 14.

---

## 7. What does Genspark add that Claude alone cannot?

Genspark provides **structured citations with retrievable URLs**. Claude's
web search is ad-hoc and embedded in a response — hard to audit, hard to show
to a compliance officer. Genspark returns `{ findings, sources }` as first-
class data. We use it for the COMBINED routing class: the moment a query
involves "industry standard", "best practice", or "compare", we route to
Genspark in parallel with the graph retriever.

If Genspark is unavailable or the key is missing, we fall back to Claude's
`web_search_20250305` tool — different format, same effect. Response always
cites either way.

---

## 8. What is the monetisation strategy?

Three-tier SaaS:

| Tier | Price | Gross margin |
|---|---|---|
| Personal | $10–15/user/mo | ~50% (low-use) |
| Team | $25–40/user/mo | ~76% |
| Enterprise | $50+/user/mo | ~80% |

API costs scale linearly with usage (Whisper + Vision + Genspark). Claude
reasoning is the biggest variable cost. Unit economics work at the team tier
today. Enterprise tier unlocks procurement budgets — organisations that can't
deploy Copilot (Conditional Access blocked) have a real need and a real budget.

---

## 9. What does post-hackathon look like?

Immediate (next 4 weeks):
- Persistent embeddings (FAISS or Chroma) so retrieval stops relying on
  keyword match
- Electron wrapper so we can read full absolute paths instead of relative
  paths via browser File API
- Shared graph mode — two users pointing at the same folder get one merged
  graph with conflict resolution via the CDC event log

Next 3 months:
- Enterprise features: SSO, centralised audit, role-based query scoping
- On-prem deployment for regulated sectors (banking, healthcare, government)
- Integration marketplace (Slack connector, Jira connector, Linear connector)

---

## 10. What is the biggest risk to this product?

Two candidates.

**User risk:** Users point Atlas at a folder containing content they didn't
realise was sensitive. The dry-run and "You Decide" review mitigate this, but
not perfectly. An HR folder named generically slips through. Mitigation:
expand sensitive filename patterns based on usage, add content-based sampling
in dry-run.

**Moat risk:** Anthropic or OpenAI ships a "local folder" feature that makes
Atlas redundant. Our moat is the **graph persistence and event-driven
updates** — those are product decisions that take time to replicate, and
they're the thing that turns "a chatbot over files" into "institutional
memory". If the big labs do ship this, we win on governance depth (PDPA,
per-file erasure, audit trail) — features they will commoditise slowly because
they're enterprise-only concerns.
