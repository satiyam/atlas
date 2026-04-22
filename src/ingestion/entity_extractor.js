const fs = require('fs')
const path = require('path')
const { v4: uuidv4 } = require('uuid')

require('dotenv').config()
const Anthropic = require('@anthropic-ai/sdk')

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const SCHEMA_PATH = path.join(__dirname, '../../graph/schema.json')
const MIN_SIGNAL_WORDS = 50

let _schema = null

async function loadSchema() {
  const raw = await fs.promises.readFile(SCHEMA_PATH, 'utf8')
  _schema = JSON.parse(raw)
  return _schema
}

function getSchema() {
  if (!_schema) throw new Error('Schema not loaded. Call loadSchema() before extraction.')
  return _schema
}

function filterSignal(content) {
  if (!content || typeof content !== 'string') return false
  const words = content.trim().split(/\s+/).filter(Boolean)
  if (words.length < MIN_SIGNAL_WORDS) return false

  const boilerplatePatterns = [
    /^(confidentiality notice|this email|disclaimer|please do not reply)/i,
    /^(copyright|all rights reserved|\d{4} .* all rights)/i,
  ]
  if (boilerplatePatterns.some(p => p.test(content.trim()))) return false

  return true
}

async function extractEntityType(entityType, fieldDefs, content, sourceFile) {
  const fieldList = Object.entries(fieldDefs)
    .map(([name, def]) => `  - ${name} (${def.type}${def.required ? ', required' : ', optional'}): ${def.description || ''}`)
    .join('\n')

  const prompt = `Extract all ${entityType} entities from the following content.
For each entity, return a JSON object with ONLY fields defined in the schema below.
Required fields must be present. Optional fields: include only if clearly present in text.
Do not invent data. If a field is uncertain, omit it.
Return a JSON array of entity objects, or an empty array [] if none found.
Do not include any explanation — return only valid JSON.

Schema for ${entityType}:
${fieldList}

Content:
${content.slice(0, 8000)}`

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    })

    const text = response.content[0].text.trim()
    const jsonMatch = text.match(/\[[\s\S]*\]/)
    if (!jsonMatch) return []

    const entities = JSON.parse(jsonMatch[0])
    return entities.map(e => ({
      ...e,
      id: e.id || uuidv4(),
      ingested_at: new Date().toISOString(),
      source_file: sourceFile,
    }))
  } catch (err) {
    return []
  }
}

async function extractEntities(redactedFile) {
  if (redactedFile.classification === 'RED' || redactedFile.blocked) {
    return { source_file: redactedFile.file_path, entities: {}, edges: [], skipped: true, skip_reason: 'RED classification', extraction_errors: [] }
  }

  const content = redactedFile.content || ''
  if (!filterSignal(content)) {
    return { source_file: redactedFile.file_path, entities: {}, edges: [], skipped: true, skip_reason: 'Insufficient signal', extraction_errors: [] }
  }

  const schema = getSchema()
  const extractableTypes = ['PERSON', 'PROJECT', 'DECISION', 'MEETING', 'TOPIC']
  const errors = []
  const entities = {}

  const extractionPromises = extractableTypes.map(async (entityType) => {
    const fieldDefs = schema.entities[entityType]?.fields || {}
    try {
      const results = await extractEntityType(entityType, fieldDefs, content, redactedFile.file_path)
      entities[entityType] = results
    } catch (err) {
      errors.push(`${entityType}: ${err.message}`)
      entities[entityType] = []
    }
  })

  await Promise.all(extractionPromises)

  const fileSourceId = uuidv4()
  entities.FILE_SOURCE = [{
    id: fileSourceId,
    path: redactedFile.file_path,
    filename: redactedFile.filename,
    file_type: redactedFile.file_type,
    size_bytes: redactedFile.metadata?.size_bytes || 0,
    last_modified: redactedFile.metadata?.last_modified || new Date().toISOString(),
    ingested_at: new Date().toISOString(),
    checksum: redactedFile.original_checksum || '',
    ingestion_status: 'complete',
    transcription_id: redactedFile.metadata?.transcription_id || null,
    transcription_cost_usd: redactedFile.metadata?.transcription_cost_usd || null,
  }]

  const edges = buildEdges(entities, redactedFile.file_path)

  return {
    source_file: redactedFile.file_path,
    source_checksum: redactedFile.original_checksum,
    entities,
    edges,
    skipped: false,
    skip_reason: null,
    extraction_errors: errors,
  }
}

function buildEdges(entities, sourceFile) {
  const edges = []
  const now = new Date().toISOString()

  const persons = entities.PERSON || []
  const projects = entities.PROJECT || []
  const decisions = entities.DECISION || []
  const meetings = entities.MEETING || []
  const documents = entities.DOCUMENT || []

  for (const person of persons) {
    for (const project of projects) {
      edges.push({ id: uuidv4(), from_id: person.id, from_type: 'PERSON', to_id: project.id, to_type: 'PROJECT', relationship: 'CONTRIBUTED_TO', created_at: now, source_file: sourceFile })
    }
    for (const decision of decisions) {
      if (!decision.made_by || decision.made_by.length === 0) {
        edges.push({ id: uuidv4(), from_id: person.id, from_type: 'PERSON', to_id: decision.id, to_type: 'DECISION', relationship: 'MADE', created_at: now, source_file: sourceFile })
      }
    }
    for (const meeting of meetings) {
      edges.push({ id: uuidv4(), from_id: person.id, from_type: 'PERSON', to_id: meeting.id, to_type: 'MEETING', relationship: 'ATTENDED', created_at: now, source_file: sourceFile })
    }
  }

  for (const meeting of meetings) {
    for (const decision of decisions) {
      edges.push({ id: uuidv4(), from_id: meeting.id, from_type: 'MEETING', to_id: decision.id, to_type: 'DECISION', relationship: 'PRODUCED', created_at: now, source_file: sourceFile })
    }
  }

  const fileSources = entities.FILE_SOURCE || []
  for (const fileSource of fileSources) {
    for (const meeting of meetings) {
      edges.push({ id: uuidv4(), from_id: fileSource.id, from_type: 'FILE_SOURCE', to_id: meeting.id, to_type: 'MEETING', relationship: 'PRODUCED', created_at: now, source_file: sourceFile })
    }
    for (const decision of decisions) {
      edges.push({ id: uuidv4(), from_id: fileSource.id, from_type: 'FILE_SOURCE', to_id: decision.id, to_type: 'DECISION', relationship: 'PRODUCED', created_at: now, source_file: sourceFile })
    }
  }

  return edges
}

async function mergeAndValidate(results) {
  const schema = getSchema()
  const merged = { nodes: [], edges: [] }
  const seenKeys = new Map()

  for (const result of results) {
    if (result.skipped) continue

    for (const [entityType, entityList] of Object.entries(result.entities)) {
      for (const entity of entityList) {
        const key = `${entityType}:${entity.name || entity.label || entity.path || entity.id}`
        if (seenKeys.has(key)) {
          const existing = seenKeys.get(key)
          Object.assign(existing.data, entity)
        } else {
          const node = { id: entity.id || uuidv4(), type: entityType, data: entity, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
          seenKeys.set(key, node)
          merged.nodes.push(node)
        }
      }
    }

    for (const edge of result.edges) {
      if (edge.from_id && edge.to_id && edge.relationship) {
        merged.edges.push(edge)
      }
    }
  }

  return merged
}

async function extractBatch(redactedFiles) {
  await loadSchema()
  return Promise.all(redactedFiles.map(f => extractEntities(f)))
}

module.exports = { loadSchema, filterSignal, extractEntities, extractBatch, mergeAndValidate }
