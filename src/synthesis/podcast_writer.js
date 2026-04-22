const fs = require('fs')
const path = require('path')

require('dotenv').config()
const Anthropic = require('@anthropic-ai/sdk')
const { graphRetriever } = require('../query/query_router')
const { buildArtefactFooter } = require('../query/response_synth')

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const CONFIG_PATH = path.join(__dirname, '../../config/ingestion_config.json')

const MIN_WORDS = 800

async function generatePodcastScript(topic) {
  const graphResults = graphRetriever(topic)
  const context = graphResults.results.slice(0, 15).map(n => JSON.stringify(n.data, null, 2)).join('\n\n')
  const sources = graphResults.sources

  const prompt = `You are generating a two-voice podcast script about: "${topic}".

Rules:
- Two voices: HOST (narrative, accessible, storytelling) and EXPERT (analytical, data-driven, specific)
- Minimum 800 words total
- Every EXPERT claim must be grounded in the context below
- Include at least 5 HOST/EXPERT exchanges
- End with a "Key Takeaways" section (3-5 bullet points)
- Format: HOST: [text]\n\nEXPERT: [text]\n\n (alternating)
- Do not reproduce verbatim content from sources — synthesise and cite
- Use inline citations for major claims: [Source: filename]

Knowledge base context:
${context || 'Limited internal data available — note this in the script.'}

Generate the full podcast script now. Ensure it is at least 800 words.`

  const response = await anthropic.messages.create({
    model: 'claude-opus-4-7',
    max_tokens: 4000,
    messages: [{ role: 'user', content: prompt }],
  })

  let script = response.content[0].text

  const wordCount = script.split(/\s+/).length
  if (wordCount < MIN_WORDS) {
    const extendPrompt = `The script above is ${wordCount} words. Extend it to reach at least 800 words by adding 2 more HOST/EXPERT exchanges that dive deeper into implications and real-world application. Continue from the existing script:\n\n${script}`
    const extension = await anthropic.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 2000,
      messages: [{ role: 'user', content: extendPrompt }],
    })
    script += '\n\n' + extension.content[0].text
  }

  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
  const footer = buildArtefactFooter(sources.length, 0, config)

  return {
    script: `# Podcast Script: ${topic}\n\n${script}\n\n${footer}`,
    sources,
    word_count: script.split(/\s+/).length,
    topic,
  }
}

module.exports = { generatePodcastScript }
