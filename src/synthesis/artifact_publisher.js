const fs = require('fs')
const path = require('path')
const collectionManager = require('../collections/collection_manager')

function getPublishDir(overridePath) {
  if (overridePath) return overridePath

  // Check if active collection has a configured publish path
  try {
    const id = collectionManager.getActiveCollection()
    if (id) {
      const meta = collectionManager.getCollectionMeta(id)
      if (meta?.publishPath) return meta.publishPath
      // Default: published/ inside the collection directory
      const paths = collectionManager.getPaths(id)
      return path.join(paths.base, 'published')
    }
  } catch (_) {}

  // Fallback: published/ at repo root
  return path.join(__dirname, '../../published')
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function publishMarkdown(filename, content, overridePath) {
  const dir = getPublishDir(overridePath)
  ensureDir(dir)
  const filePath = path.join(dir, filename)
  fs.writeFileSync(filePath, content, 'utf8')
  return filePath
}

function publishCSV(filename, content, overridePath) {
  const dir = getPublishDir(overridePath)
  ensureDir(dir)
  const filePath = path.join(dir, filename)
  fs.writeFileSync(filePath, content, 'utf8')
  return filePath
}

function publishAll({ handover, decisionLog, actionsRegister, riskRegister, topic, overridePath } = {}) {
  const dir = getPublishDir(overridePath)
  ensureDir(dir)
  const written = []

  if (handover?.document) {
    const name = topic
      ? `handover-pack-${slugify(topic)}.md`
      : 'handover-pack.md'
    written.push({ file: publishMarkdown(name, handover.document, overridePath), type: 'handover-pack' })
  }

  if (decisionLog?.document) {
    written.push({ file: publishMarkdown('decision-log.md', decisionLog.document, overridePath), type: 'decision-log' })
  }

  if (actionsRegister?.csv) {
    written.push({ file: publishCSV('open-actions.csv', actionsRegister.csv, overridePath), type: 'open-actions' })
  }

  if (riskRegister?.csv) {
    written.push({ file: publishCSV('risk-register.csv', riskRegister.csv, overridePath), type: 'risk-register' })
  }

  // Write a manifest so the team can see what was generated
  const manifest = {
    generated_at: new Date().toISOString(),
    topic: topic || null,
    publish_dir: dir,
    files: written.map(w => ({ type: w.type, path: w.file })),
  }
  const manifestPath = path.join(dir, 'manifest.json')
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')
  written.push({ file: manifestPath, type: 'manifest' })

  return { publish_dir: dir, files: written }
}

function slugify(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'output'
}

module.exports = { publishAll, publishMarkdown, publishCSV, getPublishDir }
