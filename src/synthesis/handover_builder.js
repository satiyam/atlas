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

function collectPersonContext(personName) {
  const allNodes = Object.values(graphStore.readNodes())
  const allEdges = graphStore.readEdgesArray()

  const needle = personName.toLowerCase()
  const persons = allNodes.filter(n => n.type === 'PERSON' && (n.attributes?.name || '').toLowerCase().includes(needle))
  const personIds = new Set(persons.map(p => p.id))

  const relatedNodeIds = new Set(personIds)
  for (const edge of allEdges) {
    if (personIds.has(edge.source_id)) relatedNodeIds.add(edge.target_id)
    if (personIds.has(edge.target_id)) relatedNodeIds.add(edge.source_id)
  }

  const related = allNodes.filter(n => relatedNodeIds.has(n.id))
  const relatedEdges = allEdges.filter(e => relatedNodeIds.has(e.source_id) && relatedNodeIds.has(e.target_id))

  return {
    persons,
    related,
    edges: relatedEdges,
    projects: related.filter(n => n.type === 'PROJECT'),
    decisions: related.filter(n => n.type === 'DECISION'),
    documents: related.filter(n => n.type === 'DOCUMENT'),
    meetings: related.filter(n => n.type === 'MEETING'),
    otherPeople: related.filter(n => n.type === 'PERSON' && !personIds.has(n.id)),
  }
}

function buildFallbackHandover(personName, ctx, error) {
  const lines = [
    `# Handover Document: ${personName}`,
    '',
    `_Claude API unavailable (${error}). Structured view from knowledge graph._`,
    '',
    '## 1. Role Overview',
  ]

  if (ctx.persons.length === 0) {
    lines.push(`- No PERSON node matching "${personName}" was found in the graph.`)
  } else {
    for (const p of ctx.persons) {
      lines.push(`- ${p.attributes?.name || p.id}${p.attributes?.role ? ` — ${p.attributes.role}` : ''}${p.attributes?.team ? ` (${p.attributes.team})` : ''}`)
    }
  }

  lines.push('', '## 2. Active Projects')
  if (ctx.projects.length === 0) lines.push('_No projects linked to this person._')
  for (const p of ctx.projects) lines.push(`- ${p.attributes?.name || p.id}${p.attributes?.status ? ` [${p.attributes.status}]` : ''} [Source: ${p.source_file}]`)

  lines.push('', '## 3. Key Decisions Made')
  if (ctx.decisions.length === 0) lines.push('_No decisions linked to this person._')
  for (const d of ctx.decisions) lines.push(`- ${d.attributes?.summary || d.id} [Source: ${d.source_file}]`)

  lines.push('', '## 4. Documents Owned')
  if (ctx.documents.length === 0) lines.push('_No documents linked to this person._')
  for (const d of ctx.documents) lines.push(`- ${d.attributes?.title || d.id} [Source: ${d.source_file}]`)

  lines.push('', '## 5. Key Relationships')
  if (ctx.otherPeople.length === 0) lines.push('_No collaborators identified from the graph._')
  for (const p of ctx.otherPeople) lines.push(`- ${p.attributes?.name || p.id}${p.attributes?.role ? ` — ${p.attributes.role}` : ''}`)

  lines.push('', '## 6. Pending Items')
  lines.push('_Pending items not explicitly captured. Review the source documents above._')

  lines.push('', '## 7. Recommended Next Steps')
  lines.push('- Schedule knowledge-transfer sessions covering the projects and decisions listed above.')
  lines.push('- Re-ingest recent folders to pick up any new documents owned by this person.')

  return lines.join('\n')
}

async function generateHandoverDoc(personName) {
  const ctx = collectPersonContext(personName)

  const prompt = `
Generate a handover document for "${personName}" using ONLY the knowledge graph data below.
Do not invent facts. If a section lacks data, say so explicitly.

Person nodes: ${JSON.stringify(ctx.persons)}
Related projects: ${JSON.stringify(ctx.projects)}
Related decisions: ${JSON.stringify(ctx.decisions)}
Related documents: ${JSON.stringify(ctx.documents)}
Related meetings: ${JSON.stringify(ctx.meetings)}
Related people: ${JSON.stringify(ctx.otherPeople)}
Edges: ${JSON.stringify(ctx.edges)}

Produce a markdown document with exactly these 7 sections:
## 1. Role Overview
## 2. Active Projects
## 3. Key Decisions Made
## 4. Documents Owned
## 5. Key Relationships
## 6. Pending Items
## 7. Recommended Next Steps

Include inline citations after factual claims: [Source: filename]
`.trim()

  let doc
  try {
    const client = getClient()
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    })
    doc = response?.content?.[0]?.text || buildFallbackHandover(personName, ctx, 'empty response')
  } catch (err) {
    doc = buildFallbackHandover(personName, ctx, err.message)
  }

  const sourceFiles = Array.from(new Set(ctx.related.map(n => n.source_file).filter(Boolean)))
  const footer = [
    '',
    '---',
    `**Generated:** ${new Date().toISOString()}`,
    `**Internal sources:** ${sourceFiles.length} file(s)`,
    sourceFiles.map(f => `- ${f}`).join('\n'),
    `**Last ingestion:** ${deltaTracker.getLastCursor()}`,
  ].join('\n')

  return {
    person_name: personName,
    document: `# Handover Document: ${personName}\n\n${doc}\n${footer}`,
    node_count: ctx.related.length,
    edge_count: ctx.edges.length,
    source_files: sourceFiles,
  }
}

module.exports = { generateHandoverDoc, collectPersonContext }
