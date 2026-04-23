const fs = require('fs')
const path = require('path')

const deltaTracker = require('../graph/delta_tracker')

let _client = null
function getClient() {
  if (!_client) {
    const Anthropic = require('@anthropic-ai/sdk')
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || 'sk-missing-key' })
  }
  return _client
}

function getLastIngestionTime() {
  try {
    const cursor = deltaTracker.getLastCursor()
    if (cursor === '1970-01-01T00:00:00.000Z') return 'never'
    return cursor
  } catch (_) {
    return 'unknown'
  }
}

function formatInternalSources(nodes) {
  if (!nodes || nodes.length === 0) return 'No internal sources found'
  return nodes.map(n => {
    const title = n.attributes?.title || n.attributes?.name || n.attributes?.summary || n.id
    return `• ${title} | ${n.type} | ${n.source_file || '(no source file)'}`
  }).join('\n')
}

function formatExternalSources(genspark) {
  if (!genspark || !Array.isArray(genspark.sources) || genspark.sources.length === 0) return null
  return genspark.sources
    .filter(s => s && (s.title || s.url))
    .map(s => `• ${s.title || '(no title)'} | ${s.url || '(no url)'}`)
    .join('\n')
}

async function generateAnswer(query, routerResult) {
  const prompt = `
Answer this question: "${query}"

Internal knowledge graph data:
${JSON.stringify(routerResult.nodes || [])}

External research:
${JSON.stringify(routerResult.genspark || null)}

Rules:
- Answer in natural language
- Only use information from the sources above
- Do not invent facts
- Keep answer concise and clear
`.trim()

  try {
    const client = getClient()
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }],
    })
    return response?.content?.[0]?.text || '(no answer generated)'
  } catch (err) {
    const nodes = routerResult.nodes || []
    if (nodes.length === 0 && !routerResult.genspark) {
      return `I could not find relevant information in your knowledge base for: "${query}". (Claude API unavailable: ${err.message})`
    }
    const bullets = nodes.slice(0, 5).map(n => {
      const title = n.attributes?.title || n.attributes?.name || n.attributes?.summary || n.id
      return `- ${title} (${n.type})`
    }).join('\n')
    return `Answer generation unavailable (${err.message}). Graph matches for "${query}":\n${bullets || '(none)'}`
  }
}

async function synthesise(routerResult, query) {
  if (routerResult.refused) {
    return routerResult.refusal_message
  }

  if (routerResult.classification === 'SYNTHESIS') {
    return `This query looks like a synthesis request. Use the Synthesis panel to generate a podcast, brief, or handover for: "${routerResult.synthesis_topic || query}"`
  }

  const answer = await generateAnswer(query, routerResult)
  const internalSources = formatInternalSources(routerResult.nodes)
  const externalSources = formatExternalSources(routerResult.genspark)
  const lastIngestion = getLastIngestionTime()
  const nodesSearched = routerResult.total_searched ?? routerResult.nodes?.length ?? 0

  let output = `${answer}\n\n--- Internal Sources ---\n${internalSources}\n`

  if (externalSources) {
    output += `\n--- External Research (via Genspark) ---\n${externalSources}\n`
  }

  output += `\n--- Knowledge Base Transparency ---\n`
  output += `Nodes searched: ${nodesSearched}\n`
  output += `Nodes returned: ${routerResult.nodes?.length ?? 0}\n`
  output += `Last ingestion: ${lastIngestion}\n`

  return output
}

module.exports = {
  synthesise,
  generateAnswer,
  formatInternalSources,
  formatExternalSources,
  getLastIngestionTime,
}
