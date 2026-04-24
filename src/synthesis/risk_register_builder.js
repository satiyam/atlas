const graphStore = require('../graph/graph_store')
const deltaTracker = require('../graph/delta_tracker')

let _client = null
function getClient() {
  if (!_client) {
    const Anthropic = require('@anthropic-ai/sdk')
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || 'sk-missing-key' })
  }
  return _client
}

function collectRiskContext(topic) {
  const allNodes = Object.values(graphStore.readNodes())
  const allEdges = graphStore.readEdgesArray()
  const keyword = (topic || '').toLowerCase()

  const relevant = allNodes.filter(n =>
    !keyword || JSON.stringify(n).toLowerCase().includes(keyword)
  )
  const relevantIds = new Set(relevant.map(n => n.id))

  const linkedIds = new Set(relevantIds)
  for (const edge of allEdges) {
    if (relevantIds.has(edge.source_id)) linkedIds.add(edge.target_id)
    if (relevantIds.has(edge.target_id)) linkedIds.add(edge.source_id)
  }

  return {
    projects: allNodes.filter(n => n.type === 'PROJECT' && linkedIds.has(n.id)),
    decisions: allNodes.filter(n => n.type === 'DECISION' && linkedIds.has(n.id)),
    meetings: allNodes.filter(n => n.type === 'MEETING' && linkedIds.has(n.id)),
    people: allNodes.filter(n => n.type === 'PERSON' && linkedIds.has(n.id)),
    documents: allNodes.filter(n => n.type === 'DOCUMENT' && linkedIds.has(n.id)),
    all: allNodes.filter(n => linkedIds.has(n.id)),
  }
}

function buildFallbackRiskCSV(topic, ctx, error) {
  const rows = [
    `# Risk Register${topic ? `: ${topic}` : ''}`,
    '',
    `_Claude API unavailable (${error}). Structured view from knowledge graph._`,
    '',
    'Risk,Impact,Likelihood,Mitigation,Owner,Source',
    'No risks explicitly captured in the knowledge graph — review source documents,High,—,Manual review of source documents,—,—',
  ]
  return rows.join('\n')
}

async function generateRiskRegister(topic) {
  const ctx = collectRiskContext(topic)

  const prompt = `Generate a risk register${topic ? ` for "${topic}"` : ''} using ONLY the knowledge graph data below.
Do not invent facts. Identify every risk, concern, issue, or uncertainty mentioned.

Projects: ${JSON.stringify(ctx.projects)}
Decisions: ${JSON.stringify(ctx.decisions)}
Meetings: ${JSON.stringify(ctx.meetings)}
Documents: ${JSON.stringify(ctx.documents)}
People: ${JSON.stringify(ctx.people)}

Produce two sections:

## Summary
(1–2 sentences: how many risks identified, overall risk posture)

## Risk Register

A CSV block (fenced with \`\`\`csv) with exactly these columns:
Risk,Impact,Likelihood,Mitigation,Owner,Source

Rules:
- One row per risk
- Impact: High / Medium / Low
- Likelihood: High / Medium / Low
- Mitigation: brief action to reduce the risk (≤15 words), or "—" if unknown
- Owner: name if mentioned, else "—"
- Source: filename where the risk was found
- Escape commas in field values with double-quotes
- If no risks found, write one row: "No explicit risks captured — review source documents,High,—,Manual review required,—,—"`.trim()

  let doc
  try {
    const client = getClient()
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    })
    doc = response?.content?.[0]?.text || buildFallbackRiskCSV(topic, ctx, 'empty response')
  } catch (err) {
    doc = buildFallbackRiskCSV(topic, ctx, err.message)
  }

  const csvMatch = doc.match(/```csv\s*([\s\S]*?)```/)
  const csvContent = csvMatch
    ? csvMatch[1].trim()
    : doc

  const sourceFiles = Array.from(new Set(ctx.all.map(n => n.source_file).filter(Boolean)))
  const footer = `\n# Generated: ${new Date().toISOString()} | Sources: ${sourceFiles.length} file(s) | Last ingestion: ${deltaTracker.getLastCursor()}`

  return {
    topic,
    document: doc,
    csv: csvContent + footer,
    source_files: sourceFiles,
  }
}

module.exports = { generateRiskRegister }
