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

function buildCitationsFooter(topic, nodes, external) {
  const now = new Date().toISOString()
  const lines = [
    '',
    '---',
    `**Generated:** ${now}`,
    `**Topic:** ${topic}`,
    '',
    '### Internal Sources',
  ]

  if (!nodes || nodes.length === 0) {
    lines.push('_No internal knowledge graph sources matched this topic._')
  } else {
    for (const n of nodes) {
      const title = n.attributes?.title || n.attributes?.name || n.attributes?.summary || n.id
      lines.push(`- ${title} | ${n.type} | ${n.source_file || '(no source file)'}`)
    }
  }

  if (external?.sources?.length) {
    lines.push('', '### External Research')
    for (const s of external.sources) {
      if (!s?.title && !s?.url) continue
      lines.push(`- ${s.title || '(no title)'} | ${s.url || '(no url)'}`)
    }
  }

  lines.push('', `**Last ingestion:** ${deltaTracker.getLastCursor()}`)
  return lines.join('\n')
}

function buildFallbackScript(topic, nodes, external, apiError) {
  const lines = [
    `# Podcast: ${topic}`,
    '',
    `_Claude API unavailable (${apiError}). Showing a structured outline from available knowledge graph data._`,
    '',
    `HOST: Welcome to the Atlas briefing. Today we are looking at "${topic}".`,
    '',
    `EXPERT: Our knowledge graph surfaced ${nodes?.length || 0} relevant entities on this topic.`,
    '',
  ]

  if (nodes && nodes.length > 0) {
    lines.push('HOST: Let us walk through what we found.')
    lines.push('')
    for (const n of nodes.slice(0, 6)) {
      const title = n.attributes?.title || n.attributes?.name || n.attributes?.summary || n.id
      lines.push(`EXPERT: ${n.type} — ${title}.`)
      lines.push('')
    }
  }

  if (external?.findings?.length) {
    lines.push('HOST: Here is the external industry context.')
    lines.push('')
    for (const f of external.findings.slice(0, 3)) {
      lines.push(`EXPERT: ${f.text || JSON.stringify(f)}`)
      lines.push('')
    }
  }

  lines.push('HOST: That is our brief for today. Next steps live in your Atlas dashboard.')
  return lines.join('\n')
}

async function generatePodcastScript(topic) {
  const nodes = graphStore.queryNodes({ keyword: topic })
  const external = await queryRouter.gensparkRetriever(`best practices ${topic} organisations`)

  const prompt = `
Generate a podcast script about "${topic}".

Internal organisational knowledge:
${JSON.stringify(nodes)}

External industry context:
${JSON.stringify(external)}

Format the script as a dialogue between:
HOST: Narrative voice, contextual, accessible. Tells the story, provides background.
EXPERT: Analytical voice, challenges assumptions, adds depth, benchmarks against industry.

Structure:
[INTRO] Host introduces the topic
[BACKGROUND] Expert provides context from the data
[KEY DECISIONS] Both discuss what was decided and why
[INDUSTRY CONTEXT] Expert benchmarks using external data
[TAKEAWAYS] Host summarises key insights
[OUTRO] Host closes with next steps

Requirements:
- Minimum 800 words
- Conversational and engaging — not a report
- Reference specific decisions and people from the data
- Make it feel like a real business podcast
`.trim()

  let script
  try {
    const client = getClient()
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    })
    script = response?.content?.[0]?.text || buildFallbackScript(topic, nodes, external, 'empty response')
  } catch (err) {
    script = buildFallbackScript(topic, nodes, external, err.message)
  }

  const footer = buildCitationsFooter(topic, nodes, external)
  return {
    topic,
    script: `# Podcast Script: ${topic}\n\n${script}\n${footer}`,
    word_count: script.split(/\s+/).length,
    internal_source_count: nodes.length,
    external_source_count: external?.sources?.length || 0,
  }
}

module.exports = { generatePodcastScript, buildCitationsFooter }
