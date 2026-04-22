const fs = require('fs')
const path = require('path')

require('dotenv').config()
const Anthropic = require('@anthropic-ai/sdk')
const { graphRetriever } = require('../query/query_router')
const { buildArtefactFooter } = require('../query/response_synth')

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const CONFIG_PATH = path.join(__dirname, '../../config/ingestion_config.json')
const NODES_PATH = path.join(__dirname, '../../graph/nodes.json')

function getProjectData(projectName) {
  try {
    const nodes = JSON.parse(fs.readFileSync(NODES_PATH, 'utf8'))
    const project = nodes.find(n => n.type === 'PROJECT' && n.data.name?.toLowerCase().includes(projectName.toLowerCase()))
    if (!project) return null

    const projectId = project.id
    const decisions = nodes.filter(n => n.type === 'DECISION' && n.data.source_file === project.data.source_file)
    const persons = nodes.filter(n => n.type === 'PERSON' && n.data.source_file === project.data.source_file)
    const meetings = nodes.filter(n => n.type === 'MEETING' && n.data.source_file === project.data.source_file)
    const documents = nodes.filter(n => n.type === 'DOCUMENT' && n.data.source_file === project.data.source_file)

    return { project: project.data, decisions: decisions.map(d => d.data), persons: persons.map(p => p.data), meetings: meetings.map(m => m.data), documents: documents.map(d => d.data) }
  } catch (_) {
    return null
  }
}

async function generateProjectBrief(projectName) {
  const graphResults = graphRetriever(projectName)
  const projectData = getProjectData(projectName)
  const context = graphResults.results.slice(0, 15).map(n => JSON.stringify(n.data, null, 2)).join('\n\n')
  const sources = graphResults.sources

  const prompt = `Generate a comprehensive project brief for: "${projectName}"

The brief must have exactly these 6 sections with citations from the context:

## 1. Executive Summary
(3-5 sentences: what the project is and why it matters)

## 2. Background and Context
(Problem being solved, strategic alignment)

## 3. Key Decisions Made
(Chronological decision log — cite specific decisions from context)

## 4. Team and Stakeholders
(People involved with their roles)

## 5. Status and Next Steps
(Current status, action items)

## 6. Source Documents
(Bibliography of all relevant documents from context)

Every claim must cite a source: [Source: filename]
Do not reproduce verbatim content.

Context:
${context || 'Limited data available for this project.'}

${projectData ? `\nProject data:\n${JSON.stringify(projectData, null, 2)}` : ''}`

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 3000,
    messages: [{ role: 'user', content: prompt }],
  })

  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
  const footer = buildArtefactFooter(sources.length, 0, config)
  const brief = response.content[0].text

  return {
    brief: `# Project Brief: ${projectName}\n\n${brief}\n\n${footer}`,
    sources,
    project_name: projectName,
  }
}

module.exports = { generateProjectBrief }
