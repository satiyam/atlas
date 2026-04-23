const fs = require('fs')
const path = require('path')

const deltaTracker = require('./delta_tracker')

const NODES_FILE = path.join(__dirname, '../../graph/nodes.json')
const EDGES_FILE = path.join(__dirname, '../../graph/edges.json')
const INGESTION_LOG = path.join(__dirname, '../../logs/ingestion_log.jsonl')

function readJSON(file) {
  try {
    if (!fs.existsSync(file)) return {}
    const raw = fs.readFileSync(file, 'utf8')
    if (!raw.trim()) return {}
    return JSON.parse(raw)
  } catch (_) {
    return {}
  }
}

function writeJSON(file, data) {
  const dir = path.dirname(file)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8')
}

function readNodes() {
  const data = readJSON(NODES_FILE)
  return (data && typeof data === 'object' && !Array.isArray(data)) ? data : {}
}

function readEdges() {
  const data = readJSON(EDGES_FILE)
  return (data && typeof data === 'object' && !Array.isArray(data)) ? data : {}
}

function upsertNode(node) {
  if (!node || !node.id || !node.type) {
    return { operation: 'SKIPPED', node_id: node?.id || null, reason: 'missing id or type' }
  }

  const nodes = readNodes()
  const exists = Object.prototype.hasOwnProperty.call(nodes, node.id)
  const operation = exists ? 'UPDATE' : 'INSERT'

  if (exists) {
    nodes[node.id] = {
      ...nodes[node.id],
      ...node,
      attributes: { ...(nodes[node.id].attributes || {}), ...(node.attributes || {}) },
      updated_at: new Date().toISOString(),
    }
  } else {
    nodes[node.id] = { ...node, created_at: new Date().toISOString() }
  }

  writeJSON(NODES_FILE, nodes)

  deltaTracker.appendEvent({
    event_type: 'UPSERT',
    operation,
    entity_type: node.type,
    entity_id: node.id,
  })

  return { operation, node_id: node.id }
}

function _edgeKey(edge) {
  return `${edge.source_id}::${edge.target_id}::${edge.relationship_type}`
}

function upsertEdge(edge) {
  if (!edge || !edge.source_id || !edge.target_id || !edge.relationship_type) {
    return { operation: 'SKIPPED', reason: 'missing fields' }
  }

  const edges = readEdges()
  const key = _edgeKey(edge)
  const exists = Object.prototype.hasOwnProperty.call(edges, key)

  if (exists) {
    edges[key] = { ...edges[key], ...edge, updated_at: new Date().toISOString() }
  } else {
    edges[key] = { ...edge, id: key, created_at: new Date().toISOString() }
  }

  writeJSON(EDGES_FILE, edges)

  deltaTracker.appendEvent({
    event_type: 'UPSERT',
    operation: 'INSERT',
    entity_type: 'EDGE',
    entity_id: key,
  })

  return { operation: exists ? 'UPDATE' : 'INSERT', edge_id: key }
}

function purgeByFile(filePath) {
  const nodes = readNodes()
  const edges = readEdges()

  const purgedNodeIds = []
  for (const [id, node] of Object.entries(nodes)) {
    if (node.source_file === filePath) {
      deltaTracker.appendEvent({
        event_type: 'PURGE',
        operation: 'DELETE',
        entity_type: node.type,
        entity_id: id,
        source_file: filePath,
      })
      purgedNodeIds.push(id)
      delete nodes[id]
    }
  }

  const purgedSet = new Set(purgedNodeIds)
  let purgedEdges = 0
  for (const [key, edge] of Object.entries(edges)) {
    if (purgedSet.has(edge.source_id) || purgedSet.has(edge.target_id) || edge.source_file === filePath) {
      deltaTracker.appendEvent({
        event_type: 'PURGE',
        operation: 'DELETE',
        entity_type: 'EDGE',
        entity_id: key,
        source_file: filePath,
      })
      delete edges[key]
      purgedEdges++
    }
  }

  writeJSON(NODES_FILE, nodes)
  writeJSON(EDGES_FILE, edges)

  return { purged_nodes: purgedNodeIds.length, purged_edges: purgedEdges }
}

const STOPWORDS = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'and', 'or', 'of', 'in', 'on', 'at', 'to', 'for', 'with', 'about', 'by', 'this', 'that', 'these', 'those', 'who', 'what', 'when', 'where', 'why', 'how', 'which', 'it', 'its', 'as', 'be', 'been', 'do', 'did', 'does'])

function extractKeywords(text) {
  return (text || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(w => w && w.length > 2 && !STOPWORDS.has(w))
}

function queryNodes(filters = {}) {
  const nodes = readNodes()
  let list = Object.values(nodes)

  if (filters.type) list = list.filter(n => n.type === filters.type)

  if (filters.source_file) list = list.filter(n => n.source_file === filters.source_file)

  if (filters.keyword) {
    const kw = String(filters.keyword).toLowerCase()
    list = list.filter(n => JSON.stringify(n).toLowerCase().includes(kw))
  }

  if (filters.keywords && Array.isArray(filters.keywords) && filters.keywords.length > 0) {
    const kws = filters.keywords.map(k => k.toLowerCase())
    list = list.map(n => {
      const hay = JSON.stringify(n).toLowerCase()
      const matches = kws.filter(k => hay.includes(k)).length
      return { node: n, score: matches / kws.length }
    }).filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .map(({ node }) => node)
  }

  return list
}

function readEdgesArray() {
  return Object.values(readEdges())
}

function logIngestionSummary(summary) {
  try {
    const dir = path.dirname(INGESTION_LOG)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.appendFileSync(INGESTION_LOG, JSON.stringify({ ...summary, logged_at: new Date().toISOString() }) + '\n', 'utf8')
  } catch (_) {}
}

async function runIncrementalIngestion(rootPath, options = {}) {
  const startedAt = Date.now()

  const crawler = require('../ingestion/crawler')
  const fileParser = require('../ingestion/file_parser')
  const piiRedactor = require('../ingestion/pii_redactor')
  const entityExtractor = require('../ingestion/entity_extractor')

  const lastCursor = deltaTracker.getLastCursor()
  const crawlResults = await crawler.crawl(rootPath, lastCursor)

  let toProcess = crawlResults.changed || []
  if (options.skipFlagged) {
    const skipSet = new Set((crawlResults.flagged || []).map(f => f.path))
    toProcess = toProcess.filter(f => !skipSet.has(f.path))
  }

  const filePaths = toProcess.map(f => f.path)

  const parsedFiles = await fileParser.parseBatch(filePaths)

  const redactResult = piiRedactor.redactBatch(parsedFiles)

  const extractionResults = await entityExtractor.extractBatch(redactResult.results)

  const validated = entityExtractor.mergeAndValidate(extractionResults)

  let nodesAdded = 0
  let nodesUpdated = 0
  for (const node of validated.nodes) {
    const result = upsertNode(node)
    if (result.operation === 'INSERT') nodesAdded++
    else if (result.operation === 'UPDATE') nodesUpdated++
  }

  let edgesAdded = 0
  for (const edge of validated.edges) {
    const result = upsertEdge(edge)
    if (result.operation === 'INSERT') edgesAdded++
  }

  deltaTracker.writeCheckpoint()

  const duration = Date.now() - startedAt
  const summary = {
    root_path: rootPath,
    files_processed: redactResult.processed,
    files_blocked_red: redactResult.blocked,
    files_redacted_amber: redactResult.redacted,
    extraction_results: extractionResults.length,
    nodes_added: nodesAdded,
    nodes_updated: nodesUpdated,
    edges_added: edgesAdded,
    rejected: validated.rejected?.length || 0,
    duration_ms: duration,
    crawl_errors: crawlResults.errors?.length || 0,
  }

  logIngestionSummary(summary)
  return summary
}

function _resetForTests() {
  try { fs.writeFileSync(NODES_FILE, '{}', 'utf8') } catch (_) {}
  try { fs.writeFileSync(EDGES_FILE, '{}', 'utf8') } catch (_) {}
}

module.exports = {
  upsertNode,
  upsertEdge,
  purgeByFile,
  queryNodes,
  runIncrementalIngestion,
  readNodes,
  readEdges,
  readEdgesArray,
  readJSON,
  writeJSON,
  extractKeywords,
  logIngestionSummary,
  NODES_FILE,
  EDGES_FILE,
  _resetForTests,
}
