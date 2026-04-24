const path = require('path')
const collectionManager = require('./collection_manager')

const LEGACY_AUDIT = path.join(__dirname, '../../logs/audit_log.jsonl')

function auditLogPath() {
  try {
    return collectionManager.getActivePaths().auditLog
  } catch (_) {
    return LEGACY_AUDIT
  }
}

module.exports = { auditLogPath }
