const fs = require('fs')
const path = require('path')

const collectionManager = require('../collections/collection_manager')

function deltaLogPath() {
  return collectionManager.getActivePaths().deltaLog
}

function ensureLogFile() {
  const file = deltaLogPath()
  const dir = path.dirname(file)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  if (!fs.existsSync(file)) fs.writeFileSync(file, '', 'utf8')
  return file
}

function appendEvent(event) {
  const file = ensureLogFile()
  event.id = event.id || ('evt_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6))
  event.timestamp = event.timestamp || new Date().toISOString()
  fs.appendFileSync(file, JSON.stringify(event) + '\n', 'utf8')
  return event
}

function readAllEvents() {
  const file = ensureLogFile()
  const raw = fs.readFileSync(file, 'utf8')
  if (!raw.trim()) return []
  return raw.split('\n').filter(Boolean).map(line => {
    try { return JSON.parse(line) } catch (_) { return null }
  }).filter(Boolean)
}

function getLastCursor() {
  const events = readAllEvents()
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if (e.event_type === 'SYNC_CHECKPOINT') {
      return e.cursor || e.timestamp || '1970-01-01T00:00:00.000Z'
    }
  }
  return '1970-01-01T00:00:00.000Z'
}

function getEventsSince(cursor) {
  const cutoff = new Date(cursor).getTime()
  return readAllEvents().filter(e => new Date(e.timestamp).getTime() > cutoff)
}

function writeCheckpoint() {
  return appendEvent({
    event_type: 'SYNC_CHECKPOINT',
    operation: 'CURSOR',
    cursor: new Date().toISOString(),
  })
}

function _resetForTests() {
  try { fs.writeFileSync(deltaLogPath(), '', 'utf8') } catch (_) {}
}

module.exports = {
  appendEvent,
  getLastCursor,
  getEventsSince,
  writeCheckpoint,
  readAllEvents,
  _resetForTests,
}
