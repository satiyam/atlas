const fs = require('fs')
const path = require('path')

require('dotenv').config()
const Anthropic = require('@anthropic-ai/sdk')
const { graphRetriever, gensparkRetriever } = require('../query/query_router')
const { buildArtefactFooter } = require('../query/response_synth')

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const CONFIG_PATH = path.join(__dirname, '../../config/ingestion_config.json')

async function generateBenchmarkReport(topic) {
  const [graphResults, externalResults] = await Promise.all([
    Promise.resolve(graphRetriever(topic)),
    gensparkRetriever(`industry benchmarks best practices ${topic}`),
  ])

  const internalContext = graphResults.results.slice(0, 15).map(n => JSON.stringify(n.data, null, 2)).join('\n\n')
  const externalContext = externalResults.result ? JSON.stringify(externalResults.result, null, 2) : 'No external data retrieved.'
  const sources = graphResults.sources

  const prompt = `Generate a benchmark report on: "${topic}"

You have both internal knowledge base data and external industry research. Use both.

The report must have exactly these 4 sections:

## 1. Internal Position
(What the knowledge graph reveals about the current internal state — cite sources with [Source: filename])

## 2. Industry Benchmarks
(What industry standards and external research show — cite with [External: source name])

## 3. Gap Analysis
(Where the internal state differs from industry norms — be specific)

## 4. Recommendations
(Specific, actionable steps — cite both internal and external evidence)

Do not reproduce verbatim content from any source.

Internal knowledge base data:
${internalContext || 'No internal data found for this topic.'}

External industry research:
${externalContext}`

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 3000,
    messages: [{ role: 'user', content: prompt }],
  })

  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
  const externalCount = externalResults.result ? 1 : 0
  const footer = buildArtefactFooter(sources.length, externalCount, config)
  const report = response.content[0].text

  return {
    report: `# Benchmark Report: ${topic}\n\n${report}\n\n${footer}`,
    sources,
    external_source: externalResults.source,
    topic,
  }
}

module.exports = { generateBenchmarkReport }
