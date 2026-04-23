const graphStore = require('../graph/graph_store')
const queryRouter = require('../query/query_router')
const deltaTracker = require('../graph/delta_tracker')

let _client = null
function getClient() {
  if (!_client) {
    const Anthropic = require('@anthropic-ai/sdk')
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || 'sk-missing-key' })
  }
  return _client
}

function buildFallbackReport(topic, internalNodes, external, error) {
  const lines = [
    `# Benchmark Report: ${topic}`,
    '',
    `_Claude API unavailable (${error}). Structured view from knowledge graph + external research._`,
    '',
    '## 1. Internal Position',
  ]
  if (internalNodes.length === 0) {
    lines.push(`_No internal data matched "${topic}"._`)
  } else {
    for (const n of internalNodes.slice(0, 8)) {
      const title = n.attributes?.title || n.attributes?.name || n.attributes?.summary || n.id
      lines.push(`- ${title} (${n.type}) [Source: ${n.source_file}]`)
    }
  }

  lines.push('', '## 2. Industry Benchmarks')
  if (!external?.sources?.length) lines.push('_External research unavailable._')
  for (const s of external?.sources || []) lines.push(`- ${s.title || '(no title)'}${s.url ? ` — ${s.url}` : ''}`)

  lines.push('', '## 3. Gap Analysis')
  lines.push('_Gap analysis requires AI synthesis — currently unavailable._')

  lines.push('', '## 4. Recommendations')
  lines.push('_Recommendations require AI synthesis — currently unavailable._')

  return lines.join('\n')
}

async function generateBenchmarkReport(topic) {
  const [internalNodes, external] = await Promise.all([
    Promise.resolve(graphStore.queryNodes({ keyword: topic })),
    queryRouter.gensparkRetriever(`industry benchmarks best practices ${topic}`),
  ])

  const prompt = `
Generate a benchmark report on "${topic}" combining internal graph data and external research.

Internal data: ${JSON.stringify(internalNodes)}
External research: ${JSON.stringify(external)}

Produce markdown with these 4 sections:
## 1. Internal Position
## 2. Industry Benchmarks
## 3. Gap Analysis
## 4. Recommendations

Cite internal facts as [Source: filename]. Cite external facts as [External: title].
`.trim()

  let report
  try {
    const client = getClient()
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2500,
      messages: [{ role: 'user', content: prompt }],
    })
    report = response?.content?.[0]?.text || buildFallbackReport(topic, internalNodes, external, 'empty response')
  } catch (err) {
    report = buildFallbackReport(topic, internalNodes, external, err.message)
  }

  return {
    topic,
    report,
    internal_source_count: internalNodes.length,
    external_source_count: external?.sources?.length || 0,
    last_ingestion: deltaTracker.getLastCursor(),
  }
}

module.exports = { generateBenchmarkReport }
