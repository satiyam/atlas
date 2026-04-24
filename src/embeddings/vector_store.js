const fs = require('fs')
const path = require('path')

const collectionManager = require('../collections/collection_manager')

const _indexByCollection = new Map()

function embeddingsPath() {
  return collectionManager.getActivePaths().embeddingsFile
}

function collectionKey() {
  try { return collectionManager.getActiveCollection() || '__default__' } catch (_) { return '__default__' }
}

function readFromDisk() {
  const file = embeddingsPath()
  try {
    if (!fs.existsSync(file)) return {}
    const raw = fs.readFileSync(file, 'utf8')
    if (!raw.trim()) return {}
    const parsed = JSON.parse(raw)
    return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {}
  } catch (_) {
    return {}
  }
}

function writeToDisk(map) {
  const file = embeddingsPath()
  const dir = path.dirname(file)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(file, JSON.stringify(map, null, 2), 'utf8')
}

function getIndex() {
  const key = collectionKey()
  if (!_indexByCollection.has(key)) {
    _indexByCollection.set(key, readFromDisk())
  }
  return _indexByCollection.get(key)
}

function persist() {
  writeToDisk(getIndex())
}

function hasChecksum(checksum) {
  if (!checksum) return false
  const idx = getIndex()
  for (const entry of Object.values(idx)) {
    if (entry && entry.checksum === checksum) return true
  }
  return false
}

function upsertChunks(chunksWithVectors) {
  const idx = getIndex()
  let added = 0
  for (const c of chunksWithVectors) {
    if (!c || !c.id || !Array.isArray(c.vector)) continue
    if (!idx[c.id]) added++
    idx[c.id] = {
      id: c.id,
      text: c.text,
      source_file: c.source_file,
      checksum: c.checksum || null,
      chunk_index: c.chunk_index ?? null,
      char_start: c.char_start ?? null,
      char_end: c.char_end ?? null,
      vector: c.vector,
    }
  }
  persist()
  return { added, total: Object.keys(idx).length }
}

function removeByFile(filePath) {
  const idx = getIndex()
  let removed = 0
  for (const [id, entry] of Object.entries(idx)) {
    if (entry.source_file === filePath) {
      delete idx[id]
      removed++
    }
  }
  if (removed > 0) persist()
  return removed
}

function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0
  let dot = 0
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i]
  return dot
}

function search(queryVector, { k = 5, minScore = 0.1 } = {}) {
  if (!Array.isArray(queryVector)) return []
  const idx = getIndex()
  const scored = []
  for (const entry of Object.values(idx)) {
    if (!entry || !Array.isArray(entry.vector)) continue
    const score = cosine(queryVector, entry.vector)
    if (score >= minScore) scored.push({ score, entry })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, k).map(({ score, entry }) => ({
    score,
    id: entry.id,
    text: entry.text,
    source_file: entry.source_file,
    checksum: entry.checksum,
    chunk_index: entry.chunk_index,
  }))
}

function stats() {
  const idx = getIndex()
  return { total_chunks: Object.keys(idx).length }
}

function listAll() {
  return Object.values(getIndex())
}

function listSourceFiles() {
  const idx = getIndex()
  const set = new Set()
  for (const entry of Object.values(idx)) {
    if (entry && entry.source_file) set.add(entry.source_file)
  }
  return Array.from(set)
}

function _resetForTests() {
  _indexByCollection.clear()
  try { writeToDisk({}) } catch (_) {}
}

module.exports = {
  upsertChunks,
  removeByFile,
  hasChecksum,
  search,
  stats,
  listAll,
  listSourceFiles,
  _resetForTests,
}
