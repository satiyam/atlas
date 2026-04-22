const fs = require('fs')
const path = require('path')
const { v4: uuidv4 } = require('uuid')
const crypto = require('crypto')

const delta = require('./delta_tracker')
const { crawl } = require('../ingestion/crawler')
const { parseBatch } = require('../ingestion/file_parser')
const { redactBatch } = require('../ingestion/pii_redactor')
const { extractBatch, mergeAndValidate, loadSchema } = require('../ingestion/entity_extractor')

const NODES_PATH = path.join(__dirname, '../../graph/nodes.json')
const EDGES_PATH = path.join(__dirname, '../../graph/edges.json')
const CONFIG_PATH = path.join(__dirname, '../../config/ingestion_config.json')

function loadNodes() {
  if (!fs.existsSync(NODES_PATH)) return []
  try { return JSON.parse(fs.readFileSync(NODES_PATH, 'utf8')) } catch (_) { return [] }
}

function loadEdges() {
  if (!fs.existsSync(EDGES_PATH)) return []
  try { return JSON.parse(fs.readFileSync(EDGES_PATH, 'utf8')) } catch (_) { return [] }
}

function saveNodes(nodes) {
  fs.writeFileSync(NODES_PATH, JSON.stringify(nodes, null, 2), 'utf8')
}

function saveEdges(edges) {
  fs.writeFileSync(EDGES_PATH, JSON.stringify(edges, null, 2), 'utf8')
}

function checksumNode(data) {
  return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex')
}

function findExistingNode(nodes, newNode) {
  return nodes.find(n => {
    if (n.type !== newNode.type) return false
    if (n.data.path && newNode.data.path) return n.data.path === newNode.data.path
    if (n.data.name && newNode.data.name) return n.data.name.toLowerCase() === newNode.data.name.toLowerCase()
    if (n.data.label && newNode.data.label) return n.data.label.toLowerCase() === newNode.data.label.toLowerCase()
    if (n.data.summary && newNode.data.summary) return n.data.summary.slice(0, 60) === newNode.data.summary.slice(0, 60)
    return n.id === newNode.id
  })
}

function upsertNode(newNode, triggeredBy) {
  const nodes = loadNodes()
  const existing = findExistingNode(nodes, newNode)

  if (!existing) {
    const node = { id: newNode.id || uuidv4(), type: newNode.type, data: newNode.data, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
    nodes.push(node)
    saveNodes(nodes)
    delta.nodeCreated(node, triggeredBy)
    return { action: 'created', node }
  }

  const existingChecksum = checksumNode(existing.data)
  const newChecksum = checksumNode(newNode.data)

  if (existingChecksum === newChecksum) {
    return { action: 'unchanged', node: existing }
  }

  const before = { ...existing.data }
  Object.assign(existing.data, newNode.data)
  existing.updated_at = new Date().toISOString()
  saveNodes(nodes)
  delta.nodeUpdated(existing.type, existing.id, before, existing.data, triggeredBy)
  return { action: 'updated', node: existing }
}

function upsertEdge(edge, triggeredBy) {
  const edges = loadEdges()
  const existing = edges.find(e =>
    e.from_id === edge.from_id &&
    e.to_id === edge.to_id &&
    e.relationship === edge.relationship
  )

  if (!existing) {
    const newEdge = { id: edge.id || uuidv4(), ...edge, created_at: new Date().toISOString() }
    edges.push(newEdge)
    saveEdges(edges)
    delta.edgeCreated(newEdge, triggeredBy)
    return { action: 'created', edge: newEdge }
  }

  return { action: 'unchanged', edge: existing }
}

function purgeByFile(filePath) {
  const nodes = loadNodes()
  const edges = loadEdges()
  const purgedNodeIds = new Set()
  const remaining = []

  for (const node of nodes) {
    if (node.data.source_file === filePath || node.data.path === filePath) {
      delta.purgeEvent(node.type, node.id, node, `user-requested-erasure:${filePath}`)
      purgedNodeIds.add(node.id)
    } else {
      remaining.push(node)
    }
  }

  const remainingEdges = edges.filter(e => {
    if (purgedNodeIds.has(e.from_id) || purgedNodeIds.has(e.to_id)) {
      delta.purgeEvent('edge', e.id, e, `cascaded-purge:${filePath}`)
      return false
    }
    return true
  })

  saveNodes(remaining)
  saveEdges(remainingEdges)

  const fileSourceNode = remaining.find(n => n.type === 'FILE_SOURCE' && n.data.path === filePath)
  if (fileSourceNode) {
    fileSourceNode.data.ingestion_status = 'purged'
    fileSourceNode.updated_at = new Date().toISOString()
    saveNodes(remaining)
  }

  delta.writeCheckpoint({ files_purged: 1, nodes_removed: purgedNodeIds.size, edges_removed: edges.length - remainingEdges.length }, `purge:${filePath}`)

  return { nodes_removed: purgedNodeIds.size, edges_removed: edges.length - remainingEdges.length }
}

function queryNodes(filters = {}) {
  const nodes = loadNodes()
  return nodes.filter(node => {
    if (filters.type && node.type !== filters.type) return false
    if (filters.name && !node.data.name?.toLowerCase().includes(filters.name.toLowerCase())) return false
    if (filters.source_file && node.data.source_file !== filters.source_file) return false
    if (filters.ingestion_status && node.data.ingestion_status !== filters.ingestion_status) return false
    return true
  })
}

async function runIncrementalIngestion(rootPath, options = {}) {
  await loadSchema()

  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
  const lastCursor = delta.getLastCursor()
  const existingNodes = loadNodes()

  const crawlResults = await crawl(rootPath, lastCursor, existingNodes)

  let filesToProcess = crawlResults.changed
  if (options.approvedFiles) {
    const approvedSet = new Set(options.approvedFiles)
    filesToProcess = filesToProcess.filter(f => !crawlResults.flagged.find(fl => fl.path === f.path && fl.user_decision === 'skip'))
  }

  const stats = { files_processed: 0, nodes_created: 0, nodes_updated: 0, edges_created: 0, errors: crawlResults.errors.length }

  const BATCH_SIZE = 20
  for (let i = 0; i < filesToProcess.length; i += BATCH_SIZE) {
    const batch = filesToProcess.slice(i, i + BATCH_SIZE)
    const filePaths = batch.map(f => f.path)

    const parsed = await parseBatch(filePaths, { audioConcurrencyLimit: config.audio_concurrency_limit || 3 })
    const redacted = await redactBatch(parsed)
    const extractionResults = await extractBatch(redacted)
    const { nodes: mergedNodes, edges: mergedEdges } = await mergeAndValidate(extractionResults)

    for (const node of mergedNodes) {
      const result = upsertNode(node, batch[0]?.path)
      if (result.action === 'created') stats.nodes_created++
      else if (result.action === 'updated') stats.nodes_updated++
    }

    for (const edge of mergedEdges) {
      const result = upsertEdge(edge, batch[0]?.path)
      if (result.action === 'created') stats.edges_created++
    }

    stats.files_processed += batch.length
  }

  delta.writeCheckpoint(stats)
  return { ...stats, crawl: { changed: crawlResults.changed.length, unchanged: crawlResults.unchanged.length, unsupported: crawlResults.unsupported.length, errors: crawlResults.errors.length } }
}

module.exports = { upsertNode, upsertEdge, purgeByFile, queryNodes, runIncrementalIngestion }
