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

function collectActionContext(topic) {
  const allNodes = Object.values(graphStore.readNodes())
  const allEdges = graphStore.readEdgesArray()
  const keyword = (topic || '').toLowerCase()

  // Actions are surfaced from MEETING nodes (action items) and DECISION nodes
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
    meetings: allNodes.filter(n => n.type === 'MEETING' && linkedIds.has(n.id)),
    decisions: allNodes.filter(n => n.type === 'DECISION' && linkedIds.has(n.id)),
    people: allNodes.filter(n => n.type === 'PERSON' && linkedIds.has(n.id)),
    projects: allNodes.filter(n => n.type === 'PROJECT' && linkedIds.has(n.id)),
    all: allNodes.filter(n => linkedIds.has(n.id)),
  }
}

function buildFallbackActionsCSV(topic, ctx, error) {
  const rows = [
    `# Open Actions Register${topic ? `: ${topic}` : ''}`,
    '',
    `_Claude API unavailable (${error}). Structured view from knowledge graph._`,
    '',
    'Action,Owner,Due Date,Status,Source',
  ]

  const actions = []
  for (const m of ctx.meetings) {
    const items = m.attributes?.action_items || m.attributes?.actions || []
    if (Array.isArray(items)) {
      for (const item of items) {
        const text = typeof item === 'string' ? item : (item.action || item.text || JSON.stringify(item))
        actions.push({
          action: text,
          owner: item.owner || m.attributes?.owner || '—',
          due: item.due_date || item.due || '—',
          status: item.status || 'Open',
          source: m.source_file || '—',
        })
      }
    }
    if (actions.length === 0 && m.attributes?.summary) {
      actions.push({
        action: `Review meeting outcomes — ${m.attributes.summary}`,
        owner: '—',
        due: '—',
        status: 'Open',
        source: m.source_file || '—',
      })
    }
  }

  if (actions.length === 0) {
    rows.push('No explicit action items found in the knowledge graph,—,—,Open,—')
  } else {
    for (const a of actions) {
      const escape = s => `"${String(s || '').replace(/"/g, '""')}"`
      rows.push([escape(a.action), escape(a.owner), escape(a.due), escape(a.status), escape(a.source)].join(','))
    }
  }

  return rows.join('\n')
}

async function generateActionsRegister(topic) {
  const ctx = collectActionContext(topic)

  const prompt = `Generate an open actions register${topic ? ` for "${topic}"` : ''} using ONLY the knowledge graph data below.
Do not invent facts. Extract every action item, task, or follow-up you can find.

Meetings: ${JSON.stringify(ctx.meetings)}
Decisions: ${JSON.stringify(ctx.decisions)}
People: ${JSON.stringify(ctx.people)}
Projects: ${JSON.stringify(ctx.projects)}

Produce two sections:

## Summary
(1–2 sentences: how many actions found, any notable gaps)

## Open Actions

A CSV block (fenced with \`\`\`csv) with exactly these columns:
Action,Owner,Due Date,Status,Source

Rules:
- One row per action item
- Owner: name if known, else "—"
- Due Date: date if mentioned, else "—"
- Status: "Open" unless explicitly marked complete
- Source: filename where the action was found
- Escape commas in field values with double-quotes
- If no actions found, write one row: "No explicit action items found,—,—,Open,—"`.trim()

  let doc
  try {
    const client = getClient()
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    })
    doc = response?.content?.[0]?.text || buildFallbackActionsCSV(topic, ctx, 'empty response')
  } catch (err) {
    doc = buildFallbackActionsCSV(topic, ctx, err.message)
  }

  // Extract the CSV block if Claude returned fenced format
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

module.exports = { generateActionsRegister }
