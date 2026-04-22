const fs = require('fs')
const path = require('path')
const { v4: uuidv4 } = require('uuid')

const DELTA_LOG_PATH = path.join(__dirname, '../../logs/delta_log.jsonl')
const CONFIG_PATH = path.join(__dirname, '../../config/ingestion_config.json')

function ensureLogFile() {
  const dir = path.dirname(DELTA_LOG_PATH)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  if (!fs.existsSync(DELTA_LOG_PATH)) fs.writeFileSync(DELTA_LOG_PATH, '', 'utf8')
}

function appendEvent(event) {
  ensureLogFile()
  const line = JSON.stringify(event) + '\n'
  fs.appendFileSync(DELTA_LOG_PATH, line, 'utf8')
}

function createEvent(eventType, entityType, entityId, operation, payload, triggeredBy) {
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
  return {
    id: uuidv4(),
    event_type: eventType,
    entity_type: entityType,
    entity_id: entityId,
    operation,
    payload,
    cursor: config.last_cursor || '1970-01-01T00:00:00.000Z',
    timestamp: new Date().toISOString(),
    triggered_by: triggeredBy || null,
  }
}

function nodeCreated(node, triggeredBy) {
  const event = createEvent('NODE_CREATED', node.type, node.id, 'insert', node, triggeredBy)
  appendEvent(event)
}

function nodeUpdated(entityType, entityId, before, after, triggeredBy) {
  const event = createEvent('NODE_UPDATED', entityType, entityId, 'update', { before, after }, triggeredBy)
  appendEvent(event)
}

function edgeCreated(edge, triggeredBy) {
  const event = createEvent('EDGE_CREATED', 'edge', edge.id, 'insert', edge, triggeredBy)
  appendEvent(event)
}

function edgeUpdated(edgeId, before, after, triggeredBy) {
  const event = createEvent('EDGE_UPDATED', 'edge', edgeId, 'update', { before, after }, triggeredBy)
  appendEvent(event)
}

function purgeEvent(entityType, entityId, snapshot, triggeredBy) {
  const event = createEvent('PURGE', entityType, entityId, 'delete', snapshot, triggeredBy)
  appendEvent(event)
}

function writeCheckpoint(stats, triggeredBy = 'ingestion-complete') {
  const event = createEvent('SYNC_CHECKPOINT', null, null, 'checkpoint', stats, triggeredBy)
  appendEvent(event)

  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
  config.last_cursor = event.timestamp
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8')

  return event.timestamp
}

function getLastCursor() {
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
  return config.last_cursor || '1970-01-01T00:00:00.000Z'
}

function getEventsSince(cursor) {
  ensureLogFile()
  const lines = fs.readFileSync(DELTA_LOG_PATH, 'utf8').split('\n').filter(Boolean)
  const cursorTime = new Date(cursor).getTime()

  return lines
    .map(line => { try { return JSON.parse(line) } catch (_) { return null } })
    .filter(e => e && new Date(e.timestamp).getTime() > cursorTime)
}

module.exports = { appendEvent, nodeCreated, nodeUpdated, edgeCreated, edgeUpdated, purgeEvent, writeCheckpoint, getLastCursor, getEventsSince }
