const fs = require('fs')
const path = require('path')

require('dotenv').config()
const Anthropic = require('@anthropic-ai/sdk')
const { graphRetriever } = require('../query/query_router')
const { buildArtefactFooter } = require('../query/response_synth')

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_AI_KEY || process.env.ANTHROPIC_API_KEY })
const CONFIG_PATH = path.join(__dirname, '../../config/ingestion_config.json')
const NODES_PATH = path.join(__dirname, '../../graph/nodes.json')

function getPersonData(personName) {
  try {
    const nodes = JSON.parse(fs.readFileSync(NODES_PATH, 'utf8'))
    const person = nodes.find(n => n.type === 'PERSON' && n.data.name?.toLowerCase().includes(personName.toLowerCase()))
    if (!person) return null

    const sourceFile = person.data.source_file
    const projects = nodes.filter(n => n.type === 'PROJECT' && n.data.source_file === sourceFile)
    const decisions = nodes.filter(n => n.type === 'DECISION' && (n.data.made_by || []).includes(person.id))
    const meetings = nodes.filter(n => n.type === 'MEETING' && (n.data.attendee_ids || []).includes(person.id))
    const documents = nodes.filter(n => n.type === 'DOCUMENT' && n.data.author_id === person.id)

    return {
      person: person.data,
      projects: projects.map(p => p.data),
      decisions: decisions.map(d => d.data),
      meetings: meetings.map(m => m.data),
      documents: documents.map(d => d.data),
    }
  } catch (_) {
    return null
  }
}

async function generateHandoverDoc(personName) {
  const graphResults = graphRetriever(personName)
  const personData = getPersonData(personName)
  const context = graphResults.results.slice(0, 20).map(n => JSON.stringify(n.data, null, 2)).join('\n\n')
  const sources = graphResults.sources

  const prompt = `Generate a comprehensive handover document for: "${personName}"

The document must have exactly these 7 sections with citations:

## 1. Role Overview
(Responsibilities, team, reporting line)

## 2. Active Projects
(All projects this person contributed to or owns — with current status)

## 3. Key Decisions Authored
(Decisions this person made or co-made — chronological)

## 4. Meetings and Relationships
(Regular meetings attended, key professional relationships)

## 5. Documents Owned
(Documents authored or maintained by this person)

## 6. Knowledge Gaps
(Topics this person was involved in where documentation is thin — flag for knowledge transfer)

## 7. Recommended Handover Actions
(Specific, actionable steps for knowledge transfer to successor)

Every claim must cite a source: [Source: filename]
Do not reproduce verbatim content.

Context:
${context || 'Limited data available for this person.'}

${personData ? `\nPerson data:\n${JSON.stringify(personData, null, 2)}` : ''}`

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 3000,
    messages: [{ role: 'user', content: prompt }],
  })

  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
  const footer = buildArtefactFooter(sources.length, 0, config)
  const doc = response.content[0].text

  return {
    document: `# Handover Document: ${personName}\n\n${doc}\n\n${footer}`,
    sources,
    person_name: personName,
  }
}

module.exports = { generateHandoverDoc }
