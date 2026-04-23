const path = require('path')
const express = require('express')
const cors = require('cors')

require('dotenv').config({ path: path.join(__dirname, '../.env') })

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

app.post('/api/scan', handle(async (req) => {
  const { folderPath } = req.body || {}
  if (!folderPath) throw new Error('folderPath is required')
  const cursor = deltaTracker.getLastCursor()
  return crawler.crawl(folderPath, cursor)
}))

app.post('/api/dry-run', handle(async (req) => {
  const { crawlResults, rootPath } = req.body || {}
  if (!crawlResults) throw new Error('crawlResults is required')
  return dryRunEngine.generateReport(crawlResults, rootPath || null)
}))

app.post('/api/ingest', handle(async (req) => {
  const { folderPath, skipFlagged } = req.body || {}
  if (!folderPath) throw new Error('folderPath is required')
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
  const nodesByType = {}
  for (const node of Object.values(nodes)) {
    nodesByType[node.type] = (nodesByType[node.type] || 0) + 1
  }
  return {
    nodes: Object.keys(nodes).length,
    edges: Object.keys(edges).length,
    lastIngestion: cursor,
    nodesByType,
  }
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
