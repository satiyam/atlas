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

function collectProjectNodes(projectName) {
  const allNodes = Object.values(graphStore.readNodes())
  const allEdges = graphStore.readEdgesArray()

  const keyword = projectName.toLowerCase()
  const matchesKeyword = (node) => JSON.stringify(node).toLowerCase().includes(keyword)

  const primary = allNodes.filter(matchesKeyword)
  const primaryIds = new Set(primary.map(n => n.id))

  const connectedIds = new Set(primaryIds)
  for (const edge of allEdges) {
    if (primaryIds.has(edge.source_id)) connectedIds.add(edge.target_id)
    if (primaryIds.has(edge.target_id)) connectedIds.add(edge.source_id)
  }

  return {
    primary,
    connected: allNodes.filter(n => connectedIds.has(n.id) && !primaryIds.has(n.id)),
    all: allNodes.filter(n => connectedIds.has(n.id)),
    edges: allEdges.filter(e => connectedIds.has(e.source_id) && connectedIds.has(e.target_id)),
  }
}

function buildFallbackBrief(projectName, bundle, error) {
  const lines = [
    `# Project Brief: ${projectName}`,
    '',
    `_Claude API unavailable (${error}). Structured view from knowledge graph._`,
    '',
    '## 1. Executive Summary',
  ]

  const project = bundle.primary.find(n => n.type === 'PROJECT')
  if (project) {
    lines.push(`- Project: ${project.attributes?.name || project.id}`)
    if (project.attributes?.status) lines.push(`- Status: ${project.attributes.status}`)
    if (project.attributes?.description) lines.push(`- Description: ${project.attributes.description}`)
  } else {
    lines.push(`- No PROJECT node found matching "${projectName}".`)
  }

  lines.push('', '## 2. Key Decisions')
  const decisions = bundle.all.filter(n => n.type === 'DECISION')
  if (decisions.length === 0) lines.push('_No decisions captured._')
  for (const d of decisions) lines.push(`- ${d.attributes?.summary || d.id} [Source: ${d.source_file}]`)

  lines.push('', '## 3. Team Members')
  const people = bundle.all.filter(n => n.type === 'PERSON')
  if (people.length === 0) lines.push('_No people captured._')
  for (const p of people) lines.push(`- ${p.attributes?.name || p.id}${p.attributes?.role ? ` — ${p.attributes.role}` : ''} [Source: ${p.source_file}]`)

  lines.push('', '## 4. Documents and Artefacts')
  const docs = bundle.all.filter(n => n.type === 'DOCUMENT')
  if (docs.length === 0) lines.push('_No documents captured._')
  for (const d of docs) lines.push(`- ${d.attributes?.title || d.id} [Source: ${d.source_file}]`)

  lines.push('', '## 5. Timeline')
  if (project?.attributes?.start_date) lines.push(`- Start: ${project.attributes.start_date}`)
  if (project?.attributes?.end_date) lines.push(`- End: ${project.attributes.end_date}`)
  const meetings = bundle.all.filter(n => n.type === 'MEETING')
  for (const m of meetings) lines.push(`- Meeting ${m.attributes?.date || '(date?)'}: ${m.attributes?.title || m.id}`)

  lines.push('', '## 6. Open Items')
  lines.push('_Open items pending — no data source parsed this explicitly._')

  return lines.join('\n')
}

async function generateProjectBrief(projectName) {
  const bundle = collectProjectNodes(projectName)

  const prompt = `
Generate a project brief for "${projectName}" using ONLY the knowledge graph data below.
Do not invent facts. If a section lacks data, say so explicitly.

Knowledge graph nodes:
${JSON.stringify(bundle.all)}

Knowledge graph edges:
${JSON.stringify(bundle.edges)}

Produce a markdown document with exactly these 6 sections:
## 1. Executive Summary
## 2. Key Decisions
## 3. Team Members
## 4. Documents and Artefacts
## 5. Timeline
## 6. Open Items

Include inline citations after factual claims: [Source: filename]
`.trim()

  let brief
  try {
    const debugLogger = require('../debug/debug_logger')
    const client = getClient()
    const response = await debugLogger.tracked({
      type: 'synth', file: projectName, call: 'brief generation', model: 'claude-sonnet-4-6',
      apiFn: () => client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1500,
        messages: [{ role: 'user', content: prompt }],
      }),
    })
    brief = response?.content?.[0]?.text || buildFallbackBrief(projectName, bundle, 'empty response')
  } catch (err) {
    brief = buildFallbackBrief(projectName, bundle, err.message)
  }

  const sourceFiles = Array.from(new Set(bundle.all.map(n => n.source_file).filter(Boolean)))
  const footer = [
    '',
    '---',
    `**Generated:** ${new Date().toISOString()}`,
    `**Internal sources:** ${sourceFiles.length} file(s)`,
    sourceFiles.map(f => `- ${f}`).join('\n'),
    `**Last ingestion:** ${deltaTracker.getLastCursor()}`,
  ].join('\n')

  return {
    project_name: projectName,
    brief: `# Project Brief: ${projectName}\n\n${brief}\n${footer}`,
    node_count: bundle.all.length,
    edge_count: bundle.edges.length,
    source_files: sourceFiles,
  }
}

module.exports = { generateProjectBrief, collectProjectNodes }
