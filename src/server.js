const path = require('path')
const express = require('express')
const cors = require('cors')

require('dotenv').config({ path: path.join(__dirname, '../.env') })

// Crash guard — keep the server alive through unhandled errors from parsers,
// ffmpeg streams, dangling promises, etc. Log and continue rather than exit.
process.on('unhandledRejection', (reason, promise) => {
  console.error('[atlas] UnhandledRejection:', reason?.stack || reason)
})
process.on('uncaughtException', (err) => {
  console.error('[atlas] UncaughtException:', err?.stack || err)
})

const graphStore = require('./graph/graph_store')
const deltaTracker = require('./graph/delta_tracker')
const queryRouter = require('./query/query_router')
const responseSynth = require('./query/response_synth')
const podcastWriter = require('./synthesis/podcast_writer')
const briefGenerator = require('./synthesis/brief_generator')
const handoverBuilder = require('./synthesis/handover_builder')
const benchmarkReporter = require('./synthesis/benchmark_reporter')
const dryRunEngine = require('./ingestion/dry_run')
const crawler = require('./ingestion/crawler')
const collectionManager = require('./collections/collection_manager')
const fileWatcher = require('./aidlas/file_watcher')
const alertsStore = require('./aidlas/alerts_store')

collectionManager.migrateLegacyIfNeeded()

const app = express()
app.use(express.json({ limit: '10mb' }))
app.use(cors())

const PUBLIC_DIR = path.join(__dirname, '../public')
app.use(express.static(PUBLIC_DIR))

function handle(handler) {
  return async (req, res) => {
    try {
      const result = await handler(req, res)
      if (result !== undefined) res.json(result)
    } catch (err) {
      console.error(`[server] ${req.method} ${req.path} — ${err.message}`)
      res.status(500).json({ error: err.message })
    }
  }
}

app.get('/api/health', handle(() => ({ ok: true, timestamp: new Date().toISOString() })))

app.post('/api/scan', handle(async (req, res) => {
  const fs = require('fs')
  const path = require('path')
  const { folderPath } = req.body || {}
  if (!folderPath) {
    res.status(400).json({ error: 'folderPath is required' })
    return
  }
  if (!path.isAbsolute(folderPath)) {
    res.status(400).json({ error: `folderPath must be an absolute path. Received: "${folderPath}". On Windows, paste the full path (e.g. C:\\Users\\You\\Documents).` })
    return
  }
  let stat
  try {
    stat = fs.statSync(folderPath)
  } catch (err) {
    res.status(400).json({ error: `Cannot access folder "${folderPath}": ${err.code || err.message}` })
    return
  }
  if (!stat.isDirectory()) {
    res.status(400).json({ error: `Path is not a directory: "${folderPath}"` })
    return
  }
  const cursor = deltaTracker.getLastCursor()
  return crawler.crawl(folderPath, cursor)
}))

app.post('/api/dry-run', handle(async (req, res) => {
  const fs = require('fs')
  const path = require('path')
  const { folderPath, crawlResults, rootPath } = req.body || {}

  if (crawlResults) {
    return dryRunEngine.generateReport(crawlResults, rootPath || null)
  }

  if (!folderPath) {
    res.status(400).json({ error: 'folderPath is required' })
    return
  }
  if (!path.isAbsolute(folderPath)) {
    res.status(400).json({ error: `folderPath must be an absolute path. Received: "${folderPath}".` })
    return
  }
  try {
    if (!fs.statSync(folderPath).isDirectory()) {
      res.status(400).json({ error: `Path is not a directory: "${folderPath}"` })
      return
    }
  } catch (err) {
    res.status(400).json({ error: `Cannot access folder "${folderPath}": ${err.code || err.message}` })
    return
  }

  const cursor = deltaTracker.getLastCursor()
  const fresh = await crawler.crawl(folderPath, cursor)
  return dryRunEngine.generateReport(fresh, folderPath)
}))

app.get('/api/env-status', handle(() => ({
  anthropic: Boolean(process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY.trim().length > 10),
  openai: Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim().length > 10),
  genspark: Boolean(process.env.GENSPARK_API_KEY && process.env.GENSPARK_API_KEY.trim().length > 10),
})))

app.post('/api/ingest', handle(async (req, res) => {
  const fs = require('fs')
  const path = require('path')
  const { folderPath, skipFlagged } = req.body || {}
  if (!folderPath) {
    res.status(400).json({ error: 'folderPath is required' })
    return
  }
  if (!path.isAbsolute(folderPath)) {
    res.status(400).json({ error: `folderPath must be an absolute path. Received: "${folderPath}".` })
    return
  }
  try {
    if (!fs.statSync(folderPath).isDirectory()) {
      res.status(400).json({ error: `Path is not a directory: "${folderPath}"` })
      return
    }
  } catch (err) {
    res.status(400).json({ error: `Cannot access folder "${folderPath}": ${err.code || err.message}` })
    return
  }
  try {
    const activeId = collectionManager.getActiveCollection()
    if (activeId) collectionManager.updateCollection(activeId, { rootPath: folderPath })
  } catch (_) {}
  return graphStore.runIncrementalIngestion(folderPath, { skipFlagged })
}))

app.post('/api/query', handle(async (req) => {
  const { query } = req.body || {}
  if (!query) throw new Error('query is required')
  const routerResult = await queryRouter.routeQuery(query)
  const response = await responseSynth.synthesise(routerResult, query)
  return { response, classification: routerResult.classification, nodes: routerResult.nodes, genspark: routerResult.genspark }
}))

app.post('/api/synthesise', handle(async (req) => {
  const { type, topic } = req.body || {}
  if (!type || !topic) throw new Error('type and topic are required')

  if (type === 'podcast') return podcastWriter.generatePodcastScript(topic)
  if (type === 'brief') return briefGenerator.generateProjectBrief(topic)
  if (type === 'handover') return handoverBuilder.generateHandoverDoc(topic)
  if (type === 'benchmark') return benchmarkReporter.generateBenchmarkReport(topic)

  throw new Error(`Unsupported synthesis type: ${type}`)
}))

app.get('/api/stats', handle(() => {
  const nodes = graphStore.readNodes()
  const edges = graphStore.readEdges()
  const cursor = deltaTracker.getLastCursor()
  const activeId = collectionManager.getActiveCollection()
  const meta = activeId ? collectionManager.getCollectionMeta(activeId) : null
  const nodesByType = {}
  for (const node of Object.values(nodes)) {
    nodesByType[node.type] = (nodesByType[node.type] || 0) + 1
  }
  let chunks = 0
  try {
    const vectorStore = require('./embeddings/vector_store')
    chunks = vectorStore.stats().total_chunks
  } catch (_) {}
  return {
    collection_id: activeId,
    collection_name: meta?.name || null,
    collection_root: meta?.rootPath || null,
    nodes: Object.keys(nodes).length,
    edges: Object.keys(edges).length,
    chunks,
    lastIngestion: cursor,
    nodesByType,
  }
}))

app.post('/api/reset-graph', handle(async (req) => {
  const fs = require('fs')
  const path = require('path')
  const { confirm } = req.body || {}
  if (confirm !== 'RESET') {
    throw new Error('Reset requires confirm:"RESET" in request body to prevent accidents.')
  }

  const paths = collectionManager.getActivePaths()
  const filesToClear = [
    { file: paths.nodesFile, content: '{}' },
    { file: paths.edgesFile, content: '{}' },
    { file: paths.embeddingsFile, content: '{}' },
    { file: paths.deltaLog, content: '' },
    { file: paths.ingestionLog, content: '' },
  ]

  const cleared = []
  for (const { file, content } of filesToClear) {
    try {
      const dir = path.dirname(file)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(file, content, 'utf8')
      cleared.push(path.basename(file))
    } catch (err) {
      console.error(`[server] reset-graph: failed to clear ${file} — ${err.message}`)
    }
  }

  try {
    const vectorStore = require('./embeddings/vector_store')
    vectorStore._resetForTests()
  } catch (_) {}

  try {
    const auditPath = paths.auditLog
    if (!fs.existsSync(path.dirname(auditPath))) fs.mkdirSync(path.dirname(auditPath), { recursive: true })
    fs.appendFileSync(auditPath, JSON.stringify({
      event: 'GRAPH_RESET',
      collection_id: paths.id,
      cleared,
      timestamp: new Date().toISOString(),
    }) + '\n', 'utf8')
  } catch (_) {}

  return { ok: true, collection_id: paths.id, cleared }
}))

app.get('/api/collections', handle(() => collectionManager.listCollections()))

app.post('/api/collections', handle(async (req) => {
  const { name, rootPath } = req.body || {}
  if (!name) throw new Error('name is required')
  const meta = collectionManager.createCollection({ name, rootPath: rootPath || null })
  return { ok: true, collection: meta, active: collectionManager.getActiveCollection() }
}))

app.post('/api/collections/:id/activate', handle(async (req) => {
  const id = req.params.id
  collectionManager.setActiveCollection(id)
  return { ok: true, active: id }
}))

app.patch('/api/collections/:id', handle(async (req) => {
  const id = req.params.id
  const patch = req.body || {}
  const meta = collectionManager.updateCollection(id, patch)
  return { ok: true, collection: meta }
}))

app.delete('/api/collections/:id', handle(async (req) => {
  const id = req.params.id
  const result = collectionManager.deleteCollection(id)
  return { ok: true, active: result.active }
}))

app.post('/api/watcher/start', handle(async (req) => {
  const { folderPath } = req.body || {}
  if (!folderPath) throw new Error('folderPath is required')
  return await fileWatcher.start(folderPath)
}))

app.post('/api/watcher/stop', handle(async () => {
  return await fileWatcher.stop()
}))

app.get('/api/watcher/status', handle(() => fileWatcher.status()))

app.get('/api/alerts', handle((req) => {
  const limit = Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 20))
  return { alerts: alertsStore.listAlerts({ limit }) }
}))

app.post('/api/alerts/:id/ack', handle((req) => {
  const alert = alertsStore.acknowledge(req.params.id)
  return { ok: true, alert }
}))

app.get('/api/recent-files', handle(() => {
  const nodes = Object.values(graphStore.readNodes())
  const fileSet = new Map()
  for (const n of nodes) {
    if (!n.source_file) continue
    const existing = fileSet.get(n.source_file)
    const t = new Date(n.ingested_at || n.created_at || 0).getTime()
    if (!existing || existing < t) fileSet.set(n.source_file, t)
  }
  return Array.from(fileSet.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([file, ts]) => ({ file, ingested_at: new Date(ts).toISOString() }))
}))

const PORT = process.env.ATLAS_PORT || 3001

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`[atlas] Server running on http://localhost:${PORT}`)
    console.log(`[atlas] Health: http://localhost:${PORT}/api/health`)
  })
}

module.exports = app
