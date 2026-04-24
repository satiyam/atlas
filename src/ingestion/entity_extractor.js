const fs = require('fs')
const path = require('path')
const Anthropic = require('@anthropic-ai/sdk')

const collectionManager = require('../collections/collection_manager')
const LEGACY_SCHEMA_PATH = path.join(__dirname, '../../graph/schema.json')
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

const _schemaByCollection = new Map()
const _checksumCacheByCollection = new Map()
const _ingestedChecksumsByCollection = new Map()
let _client = null

function getClient() {
  if (!_client) {
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || 'sk-missing-key' })
  }
  return _client
}

function currentCollectionId() {
  try { return collectionManager.getActivePaths().id } catch (_) { return '__default__' }
}

function getChecksumCache() {
  const id = currentCollectionId()
  if (!_checksumCacheByCollection.has(id)) _checksumCacheByCollection.set(id, new Set())
  return _checksumCacheByCollection.get(id)
}

function resolveSchemaPath() {
  try {
    const p = collectionManager.getActivePaths().schemaFile
    if (fs.existsSync(p)) return p
  } catch (_) {}
  return LEGACY_SCHEMA_PATH
}

function loadSchema() {
  const id = currentCollectionId()
  if (_schemaByCollection.has(id)) return _schemaByCollection.get(id)
  const raw = fs.readFileSync(resolveSchemaPath(), 'utf8')
  const parsed = JSON.parse(raw)
  if (!parsed.entities) throw new Error('Invalid schema: missing "entities" key')

  for (const type of ALL_SCHEMA_TYPES) {
    if (!parsed.entities[type]) {
      throw new Error(`Invalid schema: missing required entity type "${type}"`)
    }
  }

  _schemaByCollection.set(id, parsed)
  return parsed
}

function loadIngestedChecksums() {
  const id = currentCollectionId()
  if (_ingestedChecksumsByCollection.has(id)) return _ingestedChecksumsByCollection.get(id)
  const set = new Set()
  try {
    const graphStore = require('../graph/graph_store')
    const nodes = graphStore.readNodes()
    for (const node of Object.values(nodes)) {
      if (node && node.checksum) set.add(node.checksum)
    }
  } catch (_) {}
  _ingestedChecksumsByCollection.set(id, set)
  return set
}

function invalidateIngestedChecksums() {
  _ingestedChecksumsByCollection.clear()
}

function _resetSchemaCacheForTests() {
  _schemaByCollection.clear()
  _checksumCacheByCollection.clear()
  _ingestedChecksumsByCollection.clear()
}

function countWords(s) {
  return (s || '').trim().split(/\s+/).filter(Boolean).length
}

function filterSignal(content, checksum = null) {
  if (!content || typeof content !== 'string') {
    return { isSignal: false, reason: 'empty content' }
  }

  const cache = getChecksumCache()
  if (checksum && cache.has(checksum)) {
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
    if (checksum) cache.add(checksum)
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
  // Assistant prefill case: response starts without the leading "{".
  const trimmed = text.trim()
  if (trimmed && !trimmed.startsWith('{')) {
    const candidate = '{' + trimmed
    const candidateEnd = candidate.lastIndexOf('}')
    if (candidateEnd > 0) {
      try { return JSON.parse(candidate.slice(0, candidateEnd + 1)) } catch (_) {}
    }
  }
  return null
}

const EXTRACTION_MODEL = 'claude-haiku-4-5-20251001'
const EXTRACTION_MAX_TOKENS = 4000
const EXTRACTION_CONCURRENCY = parseInt(process.env.ATLAS_EXTRACTION_CONCURRENCY, 10) || 2
const MAX_RATE_LIMIT_RETRIES = 4
const DEFAULT_RATE_LIMIT_BACKOFF_MS = 45000
const MAX_BACKOFF_MS = 120000

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }
function jitter(ms) { return ms + Math.floor(Math.random() * 2000) }

function parseRetryAfter(err) {
  try {
    const headers = err?.response?.headers || err?.headers
    const raw = headers?.get ? headers.get('retry-after') : headers?.['retry-after']
    if (!raw) return null
    const secs = parseFloat(raw)
    if (Number.isFinite(secs) && secs > 0) return Math.min(120000, Math.round(secs * 1000))
  } catch (_) {}
  return null
}

async function callClaudeWithRetry({ system, user, sourceFile }) {
  const client = getClient()
  let attempt = 0
  while (true) {
    try {
      const debugLogger = require("../debug/debug_logger")
      return await debugLogger.tracked({
        type: "ingest", file: sourceFile || "unknown", call: "entity extraction", model: EXTRACTION_MODEL,
        apiFn: () => client.messages.create({
        model: EXTRACTION_MODEL,
        max_tokens: EXTRACTION_MAX_TOKENS,
        system: [
          { type: 'text', text: system, cache_control: { type: 'ephemeral' } },
        ],
        messages: [
          { role: 'user', content: user },
            { role: 'assistant', content: '{' },
        ],
      })
    } catch (err) {
      const status = err?.status || err?.response?.status
      const isRateLimit = status === 429
      if (!isRateLimit || attempt >= MAX_RATE_LIMIT_RETRIES) throw err
      const base = parseRetryAfter(err) ?? Math.min(MAX_BACKOFF_MS, DEFAULT_RATE_LIMIT_BACKOFF_MS * Math.pow(2, attempt))
      const wait = jitter(base)
      console.log(`[entity_extractor] 429 rate-limited; sleeping ${wait}ms before retry ${attempt + 1}/${MAX_RATE_LIMIT_RETRIES}`)
      await sleep(wait)
      attempt++
    }
  }
}

async function extractEntities(parsedFile) {
  const schema = loadSchema()
  const content = parsedFile?.raw_text || ''
  const checksum = parsedFile?.checksum || null
  const sourceFile = parsedFile?.file_path

  if (checksum) {
    const already = loadIngestedChecksums()
    if (already.has(checksum)) {
      return {
        nodes: [],
        edges: [],
        source_file: sourceFile,
        checksum,
        skipped_by_checksum: true,
      }
    }
  }

  if (!content || !content.trim()) {
    return null
  }

  const ingestedAt = new Date().toISOString()
  const snippet = content.slice(0, 6000)

  const systemPrompt = `You are an entity extractor for a knowledge graph.
Extract entities from the provided content following the schema below.

Schema: ${JSON.stringify(schema)}

Return ONLY a raw JSON object — do NOT wrap it in markdown fences (no \`\`\`json), do not prefix or suffix any prose, start directly with { and end with }.

Shape:
{
  "nodes": [
    { "id": "unique_id", "type": "PERSON|PROJECT|DECISION|DOCUMENT|MEETING|TOPIC", "attributes": { ...type-specific fields } }
  ],
  "edges": [
    { "source_id": "node_id", "target_id": "node_id", "relationship_type": "CONTRIBUTED_TO|MADE|AUTHORED|ATTENDED|REFERENCES|PRODUCED|CONTAINS|INCLUDES|TAGS" }
  ]
}

Rules:
- Only extract entities clearly present in the content.
- Generate deterministic ids: type_slug_of_name (e.g. person_sarah_chen, project_phoenix).
- Do not invent information not in the content.
- Return empty nodes/edges arrays if nothing found.
- Keep attributes concise — names, roles, short summaries only. Skip long descriptions, emails, phone numbers.
- If you are close to the token limit, stop at a clean closing } — prefer fewer complete entities over a truncated response.
- The caller attaches source_file, ingested_at, and checksum — omit them from your output.`

  const userPrompt = `Source file: ${sourceFile}

Content:
${snippet}`

  try {
    const response = await callClaudeWithRetry({
      system: systemPrompt,
      user: userPrompt,
      sourceFile,
    })

    const text = response?.content?.[0]?.text || ''
    const parsed = extractJsonBlock(text)

    if (!parsed || !Array.isArray(parsed.nodes)) {
      const preview = (text || '').slice(0, 400).replace(/\s+/g, ' ')
      console.log(`[entity_extractor] parse_error for ${sourceFile} — Haiku response preview: ${preview || '(empty)'}`)
      return {
        nodes: [],
        edges: [],
        source_file: sourceFile,
        checksum,
        parse_error: 'could not parse JSON response',
        raw_preview: preview || null,
      }
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
  invalidateIngestedChecksums()
  const files = (redactedFiles || []).filter(Boolean)
  const results = new Array(files.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(EXTRACTION_CONCURRENCY, files.length) }, async () => {
    while (true) {
      const i = cursor++
      if (i >= files.length) return
      try {
        results[i] = await extractEntities(files[i])
      } catch (err) {
        results[i] = { nodes: [], edges: [], source_file: files[i]?.file_path, api_error: err.message }
      }
    }
  })
  await Promise.all(workers)
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
