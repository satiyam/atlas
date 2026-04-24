const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const ROOT = path.join(__dirname, '../..')
const COLLECTIONS_DIR = process.env.ATLAS_COLLECTIONS_DIR || path.join(ROOT, 'collections')
const INDEX_FILE = path.join(COLLECTIONS_DIR, 'index.json')

const LEGACY_NODES = path.join(ROOT, 'graph', 'nodes.json')
const LEGACY_EDGES = path.join(ROOT, 'graph', 'edges.json')
const LEGACY_SCHEMA = path.join(ROOT, 'graph', 'schema.json')
const LEGACY_EMBEDDINGS = path.join(ROOT, 'graph', 'embeddings.json')
const LEGACY_DELTA = path.join(ROOT, 'logs', 'delta_log.jsonl')
const LEGACY_INGESTION = path.join(ROOT, 'logs', 'ingestion_log.jsonl')
const LEGACY_AUDIT = path.join(ROOT, 'logs', 'audit_log.jsonl')
const LEGACY_CONFIG = path.join(ROOT, 'config', 'ingestion_config.json')

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true })
}

function readJSON(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback
    const raw = fs.readFileSync(file, 'utf8')
    if (!raw.trim()) return fallback
    return JSON.parse(raw)
  } catch (_) { return fallback }
}

function writeJSON(file, data) {
  ensureDir(path.dirname(file))
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8')
}

function readIndex() {
  return readJSON(INDEX_FILE, { active: null, collections: [] })
}

function writeIndex(index) {
  writeJSON(INDEX_FILE, index)
}

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'collection'
}

function newId(name) {
  const slug = slugify(name)
  const suffix = crypto.randomBytes(3).toString('hex')
  return `${slug}_${suffix}`
}

function collectionDir(id) {
  return path.join(COLLECTIONS_DIR, id)
}

function getPaths(id) {
  const base = collectionDir(id)
  return {
    base,
    nodesFile:     path.join(base, 'graph', 'nodes.json'),
    edgesFile:     path.join(base, 'graph', 'edges.json'),
    embeddingsFile:path.join(base, 'graph', 'embeddings.json'),
    schemaFile:    path.join(base, 'graph', 'schema.json'),
    deltaLog:      path.join(base, 'logs', 'delta_log.jsonl'),
    ingestionLog:  path.join(base, 'logs', 'ingestion_log.jsonl'),
    auditLog:      path.join(base, 'logs', 'audit_log.jsonl'),
    configFile:    path.join(base, 'config', 'ingestion_config.json'),
    publishedDir:  path.join(base, 'published'),
  }
}

function scaffoldCollection(id, name, rootPath) {
  const paths = getPaths(id)
  ensureDir(path.join(paths.base, 'graph'))
  ensureDir(path.join(paths.base, 'logs'))
  ensureDir(path.join(paths.base, 'config'))

  if (!fs.existsSync(paths.nodesFile)) writeJSON(paths.nodesFile, {})
  if (!fs.existsSync(paths.edgesFile)) writeJSON(paths.edgesFile, {})
  if (!fs.existsSync(paths.embeddingsFile)) writeJSON(paths.embeddingsFile, {})
  if (!fs.existsSync(paths.deltaLog)) fs.writeFileSync(paths.deltaLog, '', 'utf8')
  if (!fs.existsSync(paths.ingestionLog)) fs.writeFileSync(paths.ingestionLog, '', 'utf8')
  if (!fs.existsSync(paths.auditLog)) fs.writeFileSync(paths.auditLog, '', 'utf8')
  if (!fs.existsSync(paths.configFile)) {
    writeJSON(paths.configFile, {
      ingestion_path: rootPath || null,
      created_at: new Date().toISOString(),
    })
  }
  if (!fs.existsSync(paths.schemaFile) && fs.existsSync(LEGACY_SCHEMA)) {
    fs.copyFileSync(LEGACY_SCHEMA, paths.schemaFile)
  }

  const meta = {
    id,
    name: name || id,
    rootPath: rootPath || null,
    created_at: new Date().toISOString(),
  }
  writeJSON(path.join(paths.base, 'collection.json'), meta)
  return meta
}

function copyIfExists(src, dest) {
  if (fs.existsSync(src)) {
    ensureDir(path.dirname(dest))
    fs.copyFileSync(src, dest)
  }
}

function migrateLegacyIfNeeded() {
  const index = readIndex()
  if (index.collections.length > 0) return index

  const hasLegacyData = fs.existsSync(LEGACY_NODES) || fs.existsSync(LEGACY_DELTA)
  const legacyConfig = readJSON(LEGACY_CONFIG, {})
  const legacyRoot = legacyConfig.ingestion_path || null

  const id = newId('default')
  const meta = scaffoldCollection(id, 'Default', legacyRoot)

  if (hasLegacyData) {
    const paths = getPaths(id)
    copyIfExists(LEGACY_NODES, paths.nodesFile)
    copyIfExists(LEGACY_EDGES, paths.edgesFile)
    copyIfExists(LEGACY_EMBEDDINGS, paths.embeddingsFile)
    copyIfExists(LEGACY_SCHEMA, paths.schemaFile)
    copyIfExists(LEGACY_DELTA, paths.deltaLog)
    copyIfExists(LEGACY_INGESTION, paths.ingestionLog)
    copyIfExists(LEGACY_AUDIT, paths.auditLog)
  }

  const newIndex = {
    active: id,
    collections: [meta],
    migrated_from_legacy: hasLegacyData,
    migrated_at: new Date().toISOString(),
  }
  writeIndex(newIndex)
  return newIndex
}

function listCollections() {
  const index = migrateLegacyIfNeeded()
  return { active: index.active, collections: index.collections }
}

function getActiveCollection() {
  const { active, collections } = listCollections()
  if (active && collections.find(c => c.id === active)) return active
  if (collections.length > 0) {
    const id = collections[0].id
    const index = readIndex()
    index.active = id
    writeIndex(index)
    return id
  }
  return null
}

function setActiveCollection(id) {
  const index = readIndex()
  if (!index.collections.find(c => c.id === id)) {
    throw new Error(`Unknown collection: ${id}`)
  }
  index.active = id
  writeIndex(index)
  return id
}

function createCollection({ name, rootPath }) {
  if (!name || !String(name).trim()) throw new Error('name is required')
  listCollections()
  const id = newId(name)
  const meta = scaffoldCollection(id, String(name).trim(), rootPath || null)
  const index = readIndex()
  index.collections.push(meta)
  if (!index.active) index.active = id
  writeIndex(index)
  return meta
}

function deleteCollection(id) {
  const index = readIndex()
  const found = index.collections.find(c => c.id === id)
  if (!found) throw new Error(`Unknown collection: ${id}`)

  const dir = collectionDir(id)
  try {
    fs.rmSync(dir, { recursive: true, force: true })
  } catch (err) {
    throw new Error(`Failed to remove collection directory: ${err.message}`)
  }

  index.collections = index.collections.filter(c => c.id !== id)
  if (index.active === id) {
    index.active = index.collections.length > 0 ? index.collections[0].id : null
  }
  writeIndex(index)
  return { ok: true, active: index.active }
}

function updateCollection(id, patch) {
  const index = readIndex()
  const found = index.collections.find(c => c.id === id)
  if (!found) throw new Error(`Unknown collection: ${id}`)
  const allowed = ['name', 'rootPath', 'publishPath']
  for (const k of allowed) {
    if (patch[k] !== undefined) found[k] = patch[k]
  }
  found.updated_at = new Date().toISOString()
  writeIndex(index)

  const metaFile = path.join(collectionDir(id), 'collection.json')
  if (fs.existsSync(metaFile)) writeJSON(metaFile, found)
  return found
}

function getCollectionMeta(id) {
  const { collections } = listCollections()
  return collections.find(c => c.id === id) || null
}

function getActivePaths() {
  const id = getActiveCollection()
  if (!id) throw new Error('No active collection. Create one first.')
  return { id, ...getPaths(id) }
}

function _resetForTests({ rootOverride } = {}) {
  const dir = rootOverride || COLLECTIONS_DIR
  try { fs.rmSync(dir, { recursive: true, force: true }) } catch (_) {}
}

module.exports = {
  listCollections,
  createCollection,
  deleteCollection,
  updateCollection,
  setActiveCollection,
  getActiveCollection,
  getCollectionMeta,
  getPaths,
  getActivePaths,
  migrateLegacyIfNeeded,
  COLLECTIONS_DIR,
  _resetForTests,
}
