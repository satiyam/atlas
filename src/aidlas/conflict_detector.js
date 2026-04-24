const path = require('path')

const MODEL = 'claude-haiku-4-5-20251001'
const MAX_TOKENS = 800
const MAX_CANDIDATE_PAIRS = 5
const SIM_THRESHOLD = 0.55

let _client = null
function getClient() {
  if (!_client) {
    const Anthropic = require('@anthropic-ai/sdk')
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || 'sk-missing-key' })
  }
  return _client
}

const SYSTEM_PROMPT = `You are a project-documentation conflict detector for a consulting firm.

You receive two passages that may or may not factually contradict each other. Your job is to decide: do they describe the same project fact with different values?

Only flag genuine factual or temporal contradictions:
- Different numeric counts of the same thing ("3 deliverables" vs "4 deliverables")
- Different dates for the same milestone
- Different vendors/owners/roles assigned to the same responsibility
- Explicit decision reversals

DO NOT flag:
- Different topics that happen to mention overlapping keywords
- Progressive refinement (estimate → final value)
- Forward-looking plans vs past commitments, unless directly contradictory
- Stylistic differences, rephrasings, summaries

Respond with a single JSON object. No markdown, no prose, no code fences.

Shape:
{
  "is_conflict": true|false,
  "conflict_type": "count" | "date" | "vendor" | "owner" | "reversal" | "other" | null,
  "quoted_new": "<short verbatim quote from the NEW passage>",
  "quoted_existing": "<short verbatim quote from the EXISTING passage>",
  "summary_pm": "<one-sentence plain-English description for a non-technical PM, <=25 words>",
  "detail_engineer": "<specific technical description of the disagreement, <=40 words>",
  "confidence": 0.0-1.0
}

If is_conflict is false, summary_pm and detail_engineer can be empty strings.`

function slimText(s, maxLen = 600) {
  if (!s) return ''
  const one = String(s).replace(/\s+/g, ' ').trim()
  return one.length <= maxLen ? one : one.slice(0, maxLen) + '…'
}

async function callClaude(newPassage, existingPassage) {
  const client = getClient()
  const user = `NEW PASSAGE (from file "${newPassage.source_file}"):
${slimText(newPassage.text)}

EXISTING PASSAGE (from file "${existingPassage.source_file}"):
${slimText(existingPassage.text)}`
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [
        { role: 'user', content: user },
        { role: 'assistant', content: '{' },
      ],
    })
    const text = response?.content?.[0]?.text || ''
    const body = text.trim().startsWith('{') ? text : '{' + text
    const end = body.lastIndexOf('}')
    if (end < 0) return null
    try {
      return JSON.parse(body.slice(0, end + 1))
    } catch {
      return null
    }
  } catch (err) {
    return { _error: err.message }
  }
}

async function findConflictsForFile(filePath, opts = {}) {
  const vectorStore = require('../embeddings/vector_store')

  const allEntries = vectorStore.listAll()
  const newEntries = allEntries.filter(e => e && e.source_file === filePath)
  const otherEntries = allEntries.filter(e => e && e.source_file && e.source_file !== filePath)
  if (newEntries.length === 0 || otherEntries.length === 0) return []

  const candidatePairs = []
  for (const n of newEntries) {
    if (!Array.isArray(n.vector)) continue
    for (const o of otherEntries) {
      if (!Array.isArray(o.vector)) continue
      let dot = 0
      for (let i = 0; i < n.vector.length; i++) dot += n.vector[i] * o.vector[i]
      if (dot >= SIM_THRESHOLD) {
        candidatePairs.push({ score: dot, newEntry: n, existingEntry: o })
      }
    }
  }
  candidatePairs.sort((a, b) => b.score - a.score)

  const seenExisting = new Set()
  const top = []
  for (const c of candidatePairs) {
    const key = c.existingEntry.id
    if (seenExisting.has(key)) continue
    seenExisting.add(key)
    top.push(c)
    if (top.length >= MAX_CANDIDATE_PAIRS) break
  }

  const conflicts = []
  for (const pair of top) {
    const verdict = await callClaude(
      { source_file: pair.newEntry.source_file, text: pair.newEntry.text },
      { source_file: pair.existingEntry.source_file, text: pair.existingEntry.text },
    )
    if (!verdict || verdict._error) continue
    if (!verdict.is_conflict) continue
    if (typeof verdict.confidence === 'number' && verdict.confidence < 0.5) continue
    conflicts.push({
      new_file: path.basename(pair.newEntry.source_file || ''),
      new_file_full: pair.newEntry.source_file,
      existing_file: path.basename(pair.existingEntry.source_file || ''),
      existing_file_full: pair.existingEntry.source_file,
      similarity: Math.round(pair.score * 1000) / 1000,
      conflict_type: verdict.conflict_type,
      quoted_new: verdict.quoted_new,
      quoted_existing: verdict.quoted_existing,
      summary_pm: verdict.summary_pm,
      detail_engineer: verdict.detail_engineer,
      confidence: verdict.confidence,
    })
  }
  return conflicts
}

module.exports = { findConflictsForFile, MODEL }
