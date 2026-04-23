const fs = require('fs')
const path = require('path')

const DELTA_LOG = path.join(__dirname, '../../logs/delta_log.jsonl')

function ensureLogFile() {
  const dir = path.dirname(DELTA_LOG)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  if (!fs.existsSync(DELTA_LOG)) fs.writeFileSync(DELTA_LOG, '', 'utf8')
}

function appendEvent(event) {
  ensureLogFile()
  event.id = event.id || ('evt_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6))
  event.timestamp = event.timestamp || new Date().toISOString()
  fs.appendFileSync(DELTA_LOG, JSON.stringify(event) + '\n', 'utf8')
  return event
}

function readAllEvents() {
  ensureLogFile()
  const raw = fs.readFileSync(DELTA_LOG, 'utf8')
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
  try { fs.writeFileSync(DELTA_LOG, '', 'utf8') } catch (_) {}
}

module.exports = {
  appendEvent,
  getLastCursor,
  getEventsSince,
  writeCheckpoint,
  readAllEvents,
  DELTA_LOG,
  _resetForTests,
}
