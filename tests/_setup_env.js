const fs = require('fs')
const os = require('os')
const path = require('path')

const TEST_ROOT = path.join(os.tmpdir(), `atlas-test-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`)
const TEST_COLLECTIONS_DIR = path.join(TEST_ROOT, 'collections')

process.env.ATLAS_COLLECTIONS_DIR = TEST_COLLECTIONS_DIR
process.env.ATLAS_TEST_ROOT = TEST_ROOT

fs.mkdirSync(TEST_COLLECTIONS_DIR, { recursive: true })

const collectionManager = require('../src/collections/collection_manager')
collectionManager.createCollection({ name: 'test', rootPath: null })
const activeId = collectionManager.getActiveCollection()
const paths = collectionManager.getPaths(activeId)
const legacySchemaSrc = path.join(__dirname, '..', 'graph', 'schema.json')
if (!fs.existsSync(paths.schemaFile) && fs.existsSync(legacySchemaSrc)) {
  fs.copyFileSync(legacySchemaSrc, paths.schemaFile)
}
