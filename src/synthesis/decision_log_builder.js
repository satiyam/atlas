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

function collectDecisionContext(topic) {
  const allNodes = Object.values(graphStore.readNodes())
  const allEdges = graphStore.readEdgesArray()
  const keyword = (topic || '').toLowerCase()

  const decisions = allNodes.filter(n =>
    n.type === 'DECISION' && (!keyword || JSON.stringify(n).toLowerCase().includes(keyword))
  )
  const decisionIds = new Set(decisions.map(d => d.id))

  const linkedIds = new Set(decisionIds)
  for (const edge of allEdges) {
    if (decisionIds.has(edge.source_id)) linkedIds.add(edge.target_id)
    if (decisionIds.has(edge.target_id)) linkedIds.add(edge.source_id)
  }

  return {
    decisions,
    all: allNodes.filter(n => linkedIds.has(n.id)),
    people: allNodes.filter(n => n.type === 'PERSON' && linkedIds.has(n.id)),
    meetings: allNodes.filter(n => n.type === 'MEETING' && linkedIds.has(n.id)),
  }
}

function buildFallbackDecisionLog(topic, ctx, error) {
  const lines = [
    `# Decision Log${topic ? `: ${topic}` : ''}`,
    '',
    `_Claude API unavailable (${error}). Structured view from knowledge graph._`,
    '',
    '## Summary',
    '',
    `${ctx.decisions.length} decision(s) found in the knowledge graph.`,
    '',
    '## Decision Log',
    '',
    '| # | Summary | Date | Participants | Rationale | Source |',
    '|---|---------|------|--------------|-----------|--------|',
  ]

  if (ctx.decisions.length === 0) {
    lines.push('| — | No decisions found in the knowledge graph | — | — | — | — |')
  } else {
    ctx.decisions.forEach((d, i) => {
      const summary = (d.attributes?.summary || d.attributes?.title || d.id).replace(/\|/g, '\\|')
      const date = d.attributes?.date || d.attributes?.decision_date || '—'
      const participants = Array.isArray(d.attributes?.participants) ? d.attributes.participants.join(', ') : (d.attributes?.participants || '—')
      const rationale = (d.attributes?.rationale || '—').replace(/\|/g, '\\|').slice(0, 80)
      const source = d.source_file ? `[Source: ${d.source_file}]` : '—'
      lines.push(`| ${i + 1} | ${summary} | ${date} | ${participants} | ${rationale} | ${source} |`)
    })
  }

  return lines.join('\n')
}

async function generateDecisionLog(topic) {
  const ctx = collectDecisionContext(topic)

  const prompt = `Generate a decision log${topic ? ` for "${topic}"` : ''} using ONLY the knowledge graph data below.
Do not invent facts. If a field is unknown, write "—".

Decisions: ${JSON.stringify(ctx.decisions)}
People: ${JSON.stringify(ctx.people)}
Meetings: ${JSON.stringify(ctx.meetings)}

Produce a markdown document with these sections:

## Summary
(1–2 sentence overview of the decisions captured)

## Decision Log

A markdown table with exactly these columns:
| # | Summary | Date | Participants | Rationale | Source |

Rules:
- One row per decision node
- Source: use [Source: filename] if source_file is present, else "—"
- Participants: comma-separated names if known, else "—"
- Rationale: the WHY behind the decision, concise (≤15 words)
- Include inline citations [Source: filename] after factual claims outside the table`.trim()

  let doc
  try {
    const client = getClient()
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    })
    doc = response?.content?.[0]?.text || buildFallbackDecisionLog(topic, ctx, 'empty response')
  } catch (err) {
    doc = buildFallbackDecisionLog(topic, ctx, err.message)
  }

  const sourceFiles = Array.from(new Set(ctx.all.map(n => n.source_file).filter(Boolean)))
  const footer = [
    '',
    '---',
    `**Generated:** ${new Date().toISOString()}`,
    `**Decisions captured:** ${ctx.decisions.length}`,
    `**Internal sources:** ${sourceFiles.length} file(s)`,
    sourceFiles.map(f => `- ${f}`).join('\n'),
    `**Last ingestion:** ${deltaTracker.getLastCursor()}`,
  ].join('\n')

  return {
    topic,
    document: doc + footer,
    decision_count: ctx.decisions.length,
    source_files: sourceFiles,
  }
}

module.exports = { generateDecisionLog }
