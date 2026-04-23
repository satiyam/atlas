const fs = require('fs')
const path = require('path')
const Anthropic = require('@anthropic-ai/sdk')

const SCHEMA_PATH = path.join(__dirname, '../../graph/schema.json')
const EXTRACTABLE_TYPES = ['PERSON', 'PROJECT', 'DECISION', 'DOCUMENT', 'MEETING', 'TOPIC']
const VALID_RELATIONSHIPS = [
  'CONTRIBUTED_TO', 'MADE', 'AUTHORED', 'ATTENDED',
  'REFERENCES', 'PRODUCED', 'CONTAINS', 'INCLUDES', 'TAGS',
]
const ALL_SCHEMA_TYPES = ['PERSON', 'PROJECT', 'DECISION', 'DOCUMENT', 'MEETING', 'TOPIC', 'FILE_SOURCE', 'DELTA_EVENT']
const MIN_SIGNAL_WORDS = 50

const DECISION_KEYWORDS = ['decided', 'agreed', 'approved', 'resolved', 'confirmed', 'selected']
const PROJECT_KEYWORDS = ['project', 'initiative', 'workstream']
const ACTION_PATTERNS = [/\b[A-Z][a-z]+\s+(will|to|shall)\b/, /\bassigned to\b/i]
const MEETING_KEYWORDS = ['action item', 'next steps', 'follow up', 'follow-up']

const GREETING_PATTERNS = [
  /^(hi|hello|hey|greetings|dear)\b/i,
  /^thanks?\s+(for|you)/i,
  /^please\s+(find|see|note)/i,
]

let _schema = null
let _client = null
const _checksumCache = new Set()

function getClient() {
  if (!_client) {
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || 'sk-missing-key' })
  }
  return _client
}

function loadSchema() {
  if (_schema) return _schema
  const raw = fs.readFileSync(SCHEMA_PATH, 'utf8')
  const parsed = JSON.parse(raw)
  if (!parsed.entities) throw new Error('Invalid schema: missing "entities" key')

  for (const type of ALL_SCHEMA_TYPES) {
    if (!parsed.entities[type]) {
      throw new Error(`Invalid schema: missing required entity type "${type}"`)
    }
  }

  _schema = parsed
  return _schema
}

function _resetSchemaCacheForTests() {
  _schema = null
  _checksumCache.clear()
}

function countWords(s) {
  return (s || '').trim().split(/\s+/).filter(Boolean).length
}

function filterSignal(content, checksum = null) {
  if (!content || typeof content !== 'string') {
    return { isSignal: false, reason: 'empty content' }
  }

  if (checksum && _checksumCache.has(checksum)) {
    return { isSignal: false, reason: 'duplicate checksum' }
  }

  const wordCount = countWords(content)
  if (wordCount < MIN_SIGNAL_WORDS) {
    return { isSignal: false, reason: `below ${MIN_SIGNAL_WORDS} word threshold (${wordCount} words)` }
  }

  const trimmed = content.trim()
  const isJustGreeting = GREETING_PATTERNS.some(p => p.test(trimmed)) && wordCount < 80
  if (isJustGreeting) {
    return { isSignal: false, reason: 'greeting/logistics only' }
  }

  const lower = content.toLowerCase()
  const hasDecision = DECISION_KEYWORDS.some(k => lower.includes(k))
  const hasProject = PROJECT_KEYWORDS.some(k => lower.includes(k))
  const hasAction = ACTION_PATTERNS.some(p => p.test(content))
  const hasMeeting = MEETING_KEYWORDS.some(k => lower.includes(k))

  if (hasDecision || hasProject || hasAction || hasMeeting) {
    if (checksum) _checksumCache.add(checksum)
    return {
      isSignal: true,
      reason: 'signal detected',
      markers: { decision: hasDecision, project: hasProject, action: hasAction, meeting: hasMeeting },
    }
  }

  return { isSignal: false, reason: 'no decision/project/action/meeting markers found' }
}

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60) || 'unknown'
}

function extractJsonBlock(text) {
  if (!text) return null
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced) {
    try { return JSON.parse(fenced[1].trim()) } catch (_) {}
  }
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start !== -1 && end > start) {
    try { return JSON.parse(text.slice(start, end + 1)) } catch (_) {}
  }
  return null
}

async function extractEntities(parsedFile) {
  const schema = loadSchema()
  const content = parsedFile?.raw_text || ''
  const signal = filterSignal(content, parsedFile?.checksum)

  if (!signal.isSignal) {
    return null
  }

  const sourceFile = parsedFile.file_path
  const checksum = parsedFile.checksum
  const ingestedAt = new Date().toISOString()
  const snippet = content.slice(0, 6000)

  const prompt = `You are an entity extractor for a knowledge graph.
Extract entities from this content following the schema.

Schema: ${JSON.stringify(schema)}

Content: ${snippet}
Source file: ${sourceFile}

Return ONLY a JSON object:
{
  "nodes": [
    {
      "id": "unique_id",
      "type": "PERSON|PROJECT|DECISION|DOCUMENT|MEETING|TOPIC",
      "attributes": { ...type-specific fields },
      "source_file": "${sourceFile}",
      "ingested_at": "${ingestedAt}",
      "checksum": "${checksum}"
    }
  ],
  "edges": [
    {
      "source_id": "node_id",
      "target_id": "node_id",
      "relationship_type": "CONTRIBUTED_TO|MADE|AUTHORED|ATTENDED|REFERENCES|PRODUCED|CONTAINS|INCLUDES|TAGS"
    }
  ]
}

Rules:
- Only extract entities clearly present in the content
- Generate deterministic ids: type_slug_of_name (e.g. person_sarah_chen, project_phoenix)
- Do not invent information not in the content
- Return empty nodes/edges arrays if nothing found`

  try {
    const client = getClient()
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2500,
      messages: [{ role: 'user', content: prompt }],
    })

    const text = response?.content?.[0]?.text || ''
    const parsed = extractJsonBlock(text)

    if (!parsed || !Array.isArray(parsed.nodes)) {
      return { nodes: [], edges: [], source_file: sourceFile, checksum, parse_error: 'could not parse JSON response' }
    }

    const nodes = parsed.nodes.map(n => ({
      id: n.id || `${(n.type || 'unknown').toLowerCase()}_${slugify(n.attributes?.name || n.attributes?.title || n.attributes?.label || 'unnamed')}`,
      type: n.type,
      attributes: n.attributes || {},
      source_file: sourceFile,
      ingested_at: ingestedAt,
      checksum,
    }))

    const edges = Array.isArray(parsed.edges) ? parsed.edges.map(e => ({
      source_id: e.source_id,
      target_id: e.target_id,
      relationship_type: e.relationship_type,
      source_file: sourceFile,
      ingested_at: ingestedAt,
    })) : []

    return { nodes, edges, source_file: sourceFile, checksum }
  } catch (err) {
    return { nodes: [], edges: [], source_file: sourceFile, checksum, api_error: err.message }
  }
}

async function extractBatch(redactedFiles) {
  loadSchema()
  const promises = (redactedFiles || []).map(f => extractEntities(f).catch(err => ({
    nodes: [], edges: [], source_file: f?.file_path, api_error: err.message,
  })))
  const results = await Promise.all(promises)
  return results.filter(r => r !== null)
}

function mergeAndValidate(extractionResults) {
  loadSchema()

  const nodesById = new Map()
  const edgeKey = (e) => `${e.source_id}::${e.target_id}::${e.relationship_type}`
  const edgesByKey = new Map()
  const rejected = []

  for (const result of extractionResults || []) {
    if (!result) continue
    const nodes = Array.isArray(result.nodes) ? result.nodes : []
    const edges = Array.isArray(result.edges) ? result.edges : []

    for (const node of nodes) {
      if (!node.id || !node.type) {
        rejected.push({ item: node, kind: 'node', reason: 'missing id or type' })
        continue
      }
      if (!EXTRACTABLE_TYPES.includes(node.type)) {
        rejected.push({ item: node, kind: 'node', reason: `invalid type ${node.type}` })
        continue
      }

      const existing = nodesById.get(node.id)
      if (!existing) {
        nodesById.set(node.id, node)
      } else {
        const existingTime = new Date(existing.ingested_at || 0).getTime()
        const newTime = new Date(node.ingested_at || 0).getTime()
        if (newTime >= existingTime) {
          nodesById.set(node.id, { ...existing, ...node, attributes: { ...existing.attributes, ...node.attributes } })
        }
      }
    }

    for (const edge of edges) {
      if (!edge.source_id || !edge.target_id || !edge.relationship_type) {
        rejected.push({ item: edge, kind: 'edge', reason: 'missing fields' })
        continue
      }
      if (!VALID_RELATIONSHIPS.includes(edge.relationship_type)) {
        rejected.push({ item: edge, kind: 'edge', reason: `invalid relationship_type ${edge.relationship_type}` })
        continue
      }
      const key = edgeKey(edge)
      if (!edgesByKey.has(key)) edgesByKey.set(key, edge)
    }
  }

  const mergedNodes = Array.from(nodesById.values())
  const mergedEdges = Array.from(edgesByKey.values())

  const orphanFiltered = mergedEdges.filter(e => nodesById.has(e.source_id) && nodesById.has(e.target_id))
  const orphanCount = mergedEdges.length - orphanFiltered.length

  return {
    nodes: mergedNodes,
    edges: orphanFiltered,
    rejected,
    summary: {
      total_nodes: mergedNodes.length,
      total_edges: orphanFiltered.length,
      rejected_count: rejected.length,
      orphan_edges_dropped: orphanCount,
      by_type: mergedNodes.reduce((acc, n) => { acc[n.type] = (acc[n.type] || 0) + 1; return acc }, {}),
    },
  }
}

module.exports = {
  loadSchema,
  filterSignal,
  extractEntities,
  extractBatch,
  mergeAndValidate,
  slugify,
  extractJsonBlock,
  EXTRACTABLE_TYPES,
  VALID_RELATIONSHIPS,
  _resetSchemaCacheForTests,
}
