const path = require('path')
const fs = require('fs')
const crypto = require('crypto')

let _watcher = null
let _watching = null
let _processing = new Set()

const IGNORED = /(^|[\\/])(\.|~\$|Thumbs\.db|desktop\.ini)/i

function status() {
  return {
    running: !!_watcher,
    watching_path: _watching,
    queued: _processing.size,
  }
}

async function stop() {
  if (_watcher) {
    try { await _watcher.close() } catch (_) {}
  }
  _watcher = null
  _watching = null
  _processing.clear()
  return { ok: true }
}

function debounce(fn, ms) {
  const pending = new Map()
  return (key, ...args) => {
    if (pending.has(key)) clearTimeout(pending.get(key))
    pending.set(key, setTimeout(() => { pending.delete(key); fn(key, ...args) }, ms))
  }
}

async function processFile(filePath) {
  if (_processing.has(filePath)) return
  _processing.add(filePath)

  try {
    if (!fs.existsSync(filePath)) return
    try {
      const stat = fs.statSync(filePath)
      if (!stat.isFile()) return
      if (stat.size < 100) return
    } catch (_) { return }

    const fileParser = require('../ingestion/file_parser')
    const entityExtractor = require('../ingestion/entity_extractor')
    const graphStore = require('../graph/graph_store')
    const chunker = require('../embeddings/chunker')
    const embedClient = require('../embeddings/embed_client')
    const vectorStore = require('../embeddings/vector_store')
    const conflictDetector = require('./conflict_detector')
    const alertsStore = require('./alerts_store')

    alertsStore.addAlert({
      kind: 'file_detected',
      severity: 'info',
      filename: path.basename(filePath),
      file_path: filePath,
      title: 'New file detected',
      message: `Ingesting ${path.basename(filePath)}…`,
    })

    const parsed = await fileParser.parseFile(filePath)
    if (!parsed || !parsed.raw_text || !parsed.raw_text.trim()) {
      alertsStore.addAlert({
        kind: 'parse_skip',
        severity: 'warn',
        filename: path.basename(filePath),
        file_path: filePath,
        title: 'File parsed to empty text',
        message: `${path.basename(filePath)} was parsed but produced no text. Skipped.`,
      })
      return
    }

    // Remove old chunks + nodes for this file (modification case)
    try { vectorStore.removeByFile(filePath) } catch (_) {}
    try { graphStore.purgeByFile(filePath) } catch (_) {}

    // Chunk + embed
    const chunks = chunker.chunkParsedFile(parsed)
    const vectors = await embedClient.embedBatch(chunks.map(c => c.text))
    const enriched = chunks.map((c, i) => ({ ...c, vector: vectors[i] })).filter(c => Array.isArray(c.vector))
    if (enriched.length > 0) vectorStore.upsertChunks(enriched)

    // Extract entities
    const extractionResults = await entityExtractor.extractBatch([parsed])
    const validated = entityExtractor.mergeAndValidate(extractionResults)
    let nodesAdded = 0
    for (const node of validated.nodes) {
      const r = graphStore.upsertNode(node)
      if (r.operation === 'INSERT') nodesAdded++
    }
    for (const edge of validated.edges) graphStore.upsertEdge(edge)

    // Run conflict detection against the rest of the graph
    const conflicts = await conflictDetector.findConflictsForFile(filePath)

    if (conflicts.length === 0) {
      alertsStore.addAlert({
        kind: 'ingest_ok',
        severity: 'info',
        filename: path.basename(filePath),
        file_path: filePath,
        title: 'File ingested — no conflicts',
        message: `${path.basename(filePath)}: ${enriched.length} chunks, ${nodesAdded} new node(s). No contradictions found.`,
      })
    } else {
      for (const c of conflicts) {
        alertsStore.addAlert({
          kind: 'conflict',
          severity: 'warn',
          filename: path.basename(filePath),
          file_path: filePath,
          title: `⚠ ${conflictTypeLabel(c.conflict_type)} — ${c.summary_pm || 'Conflict detected'}`,
          message: c.summary_pm,
          details: {
            existing_file: c.existing_file,
            conflict_type: c.conflict_type,
            quoted_new: c.quoted_new,
            quoted_existing: c.quoted_existing,
            detail_engineer: c.detail_engineer,
            similarity: c.similarity,
            confidence: c.confidence,
          },
        })
      }
    }
  } catch (err) {
    try {
      const alertsStore = require('./alerts_store')
      alertsStore.addAlert({
        kind: 'error',
        severity: 'error',
        filename: path.basename(filePath),
        file_path: filePath,
        title: 'Processing error',
        message: err.message,
      })
    } catch (_) {}
  } finally {
    _processing.delete(filePath)
  }
}

function conflictTypeLabel(t) {
  const labels = { count: 'Count mismatch', date: 'Date mismatch', vendor: 'Vendor mismatch', owner: 'Owner mismatch', reversal: 'Decision reversal' }
  return labels[t] || 'Conflict detected'
}

const debouncedProcess = debounce(processFile, 1500)

async function start(rootPath) {
  if (_watcher) await stop()
  if (!rootPath || !fs.existsSync(rootPath)) {
    throw new Error(`rootPath does not exist: ${rootPath}`)
  }
  const chokidar = require('chokidar')
  _watcher = chokidar.watch(rootPath, {
    ignored: IGNORED,
    ignoreInitial: true,
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 800, pollInterval: 200 },
    depth: 10,
  })
  _watching = rootPath
  _watcher.on('add', (p) => debouncedProcess(p, p))
  _watcher.on('change', (p) => debouncedProcess(p, p))
  _watcher.on('unlink', async (p) => {
    try {
      const graphStore = require('../graph/graph_store')
      const vectorStore = require('../embeddings/vector_store')
      const alertsStore = require('./alerts_store')
      const { purged_nodes = 0, purged_edges = 0 } = graphStore.purgeByFile(p)
      const removed = vectorStore.removeByFile(p)
      alertsStore.addAlert({
        kind: 'file_removed',
        severity: 'info',
        filename: path.basename(p),
        file_path: p,
        title: 'File removed from folder',
        message: `${path.basename(p)} deleted. Purged ${purged_nodes} node(s), ${purged_edges} edge(s), ${removed} chunk(s).`,
      })
    } catch (_) {}
  })
  return { ok: true, watching: rootPath }
}

module.exports = { start, stop, status }
