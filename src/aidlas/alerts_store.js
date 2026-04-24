const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const collectionManager = require('../collections/collection_manager')

const MAX_ALERTS = 50
const _byCollection = new Map()

function alertsFile() {
  const paths = collectionManager.getActivePaths()
  return path.join(paths.base, 'logs', 'alerts.jsonl')
}

function collectionKey() {
  try { return collectionManager.getActiveCollection() || '__default__' } catch (_) { return '__default__' }
}

function loadFromDisk() {
  try {
    const file = alertsFile()
    if (!fs.existsSync(file)) return []
    const raw = fs.readFileSync(file, 'utf8')
    if (!raw.trim()) return []
    return raw.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
  } catch (_) { return [] }
}

function getAlerts() {
  const key = collectionKey()
  if (!_byCollection.has(key)) _byCollection.set(key, loadFromDisk())
  return _byCollection.get(key)
}

function persistAlert(alert) {
  try {
    const file = alertsFile()
    const dir = path.dirname(file)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.appendFileSync(file, JSON.stringify(alert) + '\n', 'utf8')
  } catch (_) {}
}

function addAlert(partial) {
  const alert = {
    id: 'alert_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex'),
    timestamp: new Date().toISOString(),
    acknowledged: false,
    ...partial,
  }
  const list = getAlerts()
  list.unshift(alert)
  while (list.length > MAX_ALERTS) list.pop()
  persistAlert(alert)
  try { require('../debug/debug_bus').emit('alert', alert) } catch (_) {}
  return alert
}

function listAlerts({ limit = 20 } = {}) {
  return getAlerts().slice(0, limit)
}

function acknowledge(id) {
  const list = getAlerts()
  const found = list.find(a => a.id === id)
  if (found) {
    found.acknowledged = true
    persistAlert({ ...found, event: 'ACK' })
  }
  return found
}

function clearAll() {
  const key = collectionKey()
  _byCollection.set(key, [])
  try {
    const file = alertsFile()
    const dir = path.dirname(file)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(file, '', 'utf8')
  } catch (_) {}
  return { ok: true, cleared_collection: key }
}

function _resetForTests() { _byCollection.clear() }

module.exports = { addAlert, listAlerts, acknowledge, clearAll, _resetForTests }
