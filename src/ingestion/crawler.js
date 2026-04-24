const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const LEGACY_CONFIG_PATH = path.join(__dirname, '../../config/ingestion_config.json')
const collectionManager = require('../collections/collection_manager')

function resolveConfigPath() {
  try {
    const p = collectionManager.getActivePaths().configFile
    if (fs.existsSync(p)) {
      const raw = fs.readFileSync(p, 'utf8')
      const parsed = JSON.parse(raw)
      if (parsed && (parsed.supported_extensions || parsed.exclude_folders)) return p
    }
  } catch (_) {}
  return LEGACY_CONFIG_PATH
}

const SENSITIVE_PATTERNS = [
  /payroll/i,
  /salary/i,
  /compensation/i,
  /performance.?review/i,
  /disciplinary/i,
  /termination/i,
  /grievance/i,
  /medical/i,
  /insurance.?claim/i,
  /hr.?investigation/i,
  /redundancy/i,
  /\bpip\b/i,
  /personal.?data/i,
  /health.?record/i,
  /retrenchment/i,
  /misconduct/i,
  /probation/i,
]

function loadConfig() {
  const raw = fs.readFileSync(resolveConfigPath(), 'utf8')
  return JSON.parse(raw)
}

function isSensitiveFilename(filename) {
  return SENSITIVE_PATTERNS.some(p => p.test(filename))
}

function matchedPattern(filename) {
  const match = SENSITIVE_PATTERNS.find(p => p.test(filename))
  return match ? match.toString() : null
}

function computeFastChecksum(filePath, lastModifiedIso) {
  return crypto
    .createHash('sha256')
    .update(`${filePath}::${lastModifiedIso}`, 'utf8')
    .digest('hex')
}

function toMs(value) {
  if (value == null) return 0
  if (value instanceof Date) return value.getTime()
  const parsed = new Date(value).getTime()
  return Number.isFinite(parsed) ? parsed : 0
}

async function crawl(rootPath, lastCursor) {
  const startedAt = Date.now()
  const config = loadConfig()
  const supportedExtensions = new Set((config.supported_extensions || []).map(e => e.toLowerCase()))
  const excludedFolders = new Set(config.exclude_folders || [])
  const minBytes = config.min_file_size_bytes ?? 100
  const maxBytes = config.max_file_size_bytes ?? 524288000
  const lastCursorMs = toMs(lastCursor)

  const results = {
    changed: [],
    unchanged: [],
    unsupported: [],
    flagged: [],
    errors: [],
    summary: {
      total_found: 0,
      total_supported: 0,
      total_changed: 0,
      total_flagged: 0,
      total_skipped: 0,
      scan_duration_ms: 0,
      total_size_bytes: 0,
    },
  }

  let rootResolved
  try {
    rootResolved = fs.realpathSync(rootPath)
  } catch (err) {
    results.errors.push({ path: rootPath, type: 'root_not_accessible', error: err.message })
    results.summary.scan_duration_ms = Date.now() - startedAt
    return results
  }

  const visitedRealPaths = new Set([rootResolved])
  const stack = [rootResolved]

  while (stack.length > 0) {
    const currentDir = stack.pop()

    let entries
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true, encoding: 'utf8' })
    } catch (err) {
      results.errors.push({ path: currentDir, type: 'directory_read_error', error: err.message })
      continue
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name)

      if (entry.isSymbolicLink()) {
        let realTarget
        try {
          realTarget = fs.realpathSync(fullPath)
        } catch (err) {
          results.errors.push({ path: fullPath, type: 'symlink_error', error: err.message })
          continue
        }
        if (visitedRealPaths.has(realTarget)) {
          results.errors.push({ path: fullPath, type: 'symlink_loop', error: `Loops back to ${realTarget}` })
          continue
        }
        visitedRealPaths.add(realTarget)

        let targetStat
        try {
          targetStat = fs.statSync(realTarget)
        } catch (err) {
          results.errors.push({ path: fullPath, type: 'symlink_stat_error', error: err.message })
          continue
        }
        if (targetStat.isDirectory()) {
          if (!excludedFolders.has(path.basename(realTarget))) stack.push(realTarget)
          continue
        }
      }

      if (entry.isDirectory()) {
        if (excludedFolders.has(entry.name)) continue
        stack.push(fullPath)
        continue
      }

      if (!entry.isFile()) continue

      results.summary.total_found++

      let stat
      try {
        stat = fs.statSync(fullPath)
      } catch (err) {
        results.errors.push({ path: fullPath, type: 'stat_error', error: err.message })
        continue
      }

      const ext = path.extname(entry.name).toLowerCase()
      const lastModifiedIso = stat.mtime.toISOString()
      const fileRecord = {
        path: fullPath,
        filename: entry.name,
        extension: ext,
        size_bytes: stat.size,
        size_mb: stat.size / 1024 / 1024,
        last_modified: lastModifiedIso,
        checksum: computeFastChecksum(fullPath, lastModifiedIso),
      }

      if (!ext) {
        results.unsupported.push({ ...fileRecord, reason: 'no_extension' })
        results.summary.total_skipped++
        continue
      }

      if (!supportedExtensions.has(ext)) {
        results.unsupported.push({ ...fileRecord, reason: 'unsupported_extension' })
        results.summary.total_skipped++
        continue
      }

      if (stat.size < minBytes) {
        results.unsupported.push({ ...fileRecord, reason: 'below_min_size' })
        results.summary.total_skipped++
        continue
      }

      if (stat.size > maxBytes) {
        results.unsupported.push({ ...fileRecord, reason: 'above_max_size' })
        results.summary.total_skipped++
        continue
      }

      results.summary.total_supported++
      results.summary.total_size_bytes += stat.size

      const flagged = isSensitiveFilename(entry.name)
      if (flagged) {
        fileRecord.matched_pattern = matchedPattern(entry.name)
        fileRecord.user_decision = 'skip'
        results.flagged.push({ ...fileRecord })
        results.summary.total_flagged++
      }

      const modifiedMs = stat.mtime.getTime()
      if (modifiedMs > lastCursorMs) {
        results.changed.push(fileRecord)
        results.summary.total_changed++
      } else {
        results.unchanged.push(fileRecord)
      }
    }
  }

  results.summary.scan_duration_ms = Date.now() - startedAt
  return results
}

module.exports = { crawl, isSensitiveFilename, matchedPattern, computeFastChecksum, SENSITIVE_PATTERNS }
