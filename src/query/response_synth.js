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

function shortenFilename(filePath) {
  if (!filePath) return '(no source)'
  return String(filePath).split(/[\\/]/).pop()
}

function richNode(n) {
  if (!n) return null
  return {
    id: n.id,
    type: n.type,
    attributes: n.attributes || {},
    source_file: shortenFilename(n.source_file),
  }
}

function groupChunksByFile(chunks) {
  const byFile = new Map()
  for (const c of chunks) {
    const key = c.source_file || '(unknown)'
    if (!byFile.has(key)) byFile.set(key, { source_file: key, passages: [] })
    byFile.get(key).passages.push({
      score: typeof c.score === 'number' ? Math.round(c.score * 1000) / 1000 : null,
      chunk_index: c.chunk_index ?? null,
      text: c.text,
    })
  }
  return Array.from(byFile.values()).map(group => ({
    source_file: shortenFilename(group.source_file),
    passages: group.passages.sort((a, b) => (a.chunk_index ?? 0) - (b.chunk_index ?? 0)),
  }))
}

function slimGenspark(g) {
  if (!g) return null
  const sources = Array.isArray(g.sources)
    ? g.sources.slice(0, 5).map(s => ({ title: s?.title || null, url: s?.url || null, snippet: s?.snippet || null }))
    : []
  return { summary: g.summary || null, sources }
}

const SYSTEM_PROMPT = `You answer questions about a user's documents using two kinds of retrieved context:

1. "Passages" — verbatim excerpts from source files, grouped by filename. These are the PRIMARY evidence for any factual claim. When you cite a fact, name the file it came from.

2. "Graph entities" — structured records (people, projects, decisions, meetings) extracted from the same documents. Use these for who's-who and relationships, or when the passages don't directly name an entity referenced in the question.

Rules:
- Be specific and detailed. Name people, dates, decisions, and outcomes when the sources support them.
- Cite the source file for each claim, inline: "...according to [filename.pdf]".
- If passages and entities conflict, trust the passage.
- If the sources don't cover part of the question, say what's missing — don't invent.
- Structure longer answers with short headers or bullets where helpful.
- Write in clear prose, not bullet-point telegraphy.`

async function generateAnswer(query, routerResult) {
  const topNodes = (routerResult.nodes || []).slice(0, 8).map(richNode).filter(Boolean)
  const slimmedGenspark = slimGenspark(routerResult.genspark)
  const topChunks = (routerResult.chunks || []).slice(0, 15)
  const passageGroups = groupChunksByFile(topChunks)

  const userPrompt = `Question: "${query}"

═══ PASSAGES (verbatim excerpts from source files, ranked by semantic similarity to the question) ═══
${JSON.stringify(passageGroups, null, 2)}

═══ GRAPH ENTITIES (structured records matching the question keywords) ═══
${JSON.stringify(topNodes, null, 2)}

═══ EXTERNAL RESEARCH ═══
${JSON.stringify(slimmedGenspark)}

Answer the question using the passages as primary evidence. Cite filenames inline.`

  try {
    const debugLogger = require('../debug/debug_logger')
    const client = getClient()
    const response = await debugLogger.tracked({
      type: 'query', file: query, call: 'query synth', model: 'claude-sonnet-4-6',
      apiFn: () => client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1200,
        system: [
          { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
        ],
        messages: [{ role: 'user', content: userPrompt }],
      }),
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
