const fs = require('fs')
const path = require('path')
const os = require('os')
const { crawl, isSensitiveFilename, computeFastChecksum } = require('../src/ingestion/crawler')

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-crawler-test-'))
}

function writeFile(dir, name, content, mtime = null) {
  const filePath = path.join(dir, name)
  fs.writeFileSync(filePath, content)
  if (mtime) {
    fs.utimesSync(filePath, mtime, mtime)
  }
  return filePath
}

describe('isSensitiveFilename', () => {
  test('flags payroll files', () => {
    expect(isSensitiveFilename('Payroll-March-2026.xlsx')).toBe(true)
  })

  test('flags performance review files', () => {
    expect(isSensitiveFilename('HR-Performance-Review.pdf')).toBe(true)
  })

  test('flags medical files', () => {
    expect(isSensitiveFilename('Medical-Certificate.pdf')).toBe(true)
  })

  test('does not flag project files', () => {
    expect(isSensitiveFilename('project-roadmap.docx')).toBe(false)
  })
})

describe('computeFastChecksum', () => {
  test('produces identical hash for identical path + mtime', () => {
    const iso = '2026-04-22T10:00:00.000Z'
    const a = computeFastChecksum('/tmp/file.txt', iso)
    const b = computeFastChecksum('/tmp/file.txt', iso)
    expect(a).toBe(b)
  })

  test('produces different hash when mtime changes', () => {
    const p = '/tmp/file.txt'
    const a = computeFastChecksum(p, '2026-04-22T10:00:00.000Z')
    const b = computeFastChecksum(p, '2026-04-23T10:00:00.000Z')
    expect(a).not.toBe(b)
  })

  test('produces different hash when path changes', () => {
    const iso = '2026-04-22T10:00:00.000Z'
    const a = computeFastChecksum('/tmp/a.txt', iso)
    const b = computeFastChecksum('/tmp/b.txt', iso)
    expect(a).not.toBe(b)
  })

  test('produces 64-char hex SHA-256', () => {
    const h = computeFastChecksum('/tmp/x.txt', '2026-01-01T00:00:00.000Z')
    expect(h).toMatch(/^[a-f0-9]{64}$/)
  })
})

describe('crawl — 5 test files of different types and sizes', () => {
  let tmp
  let filePaths

  beforeAll(() => {
    tmp = makeTempDir()

    writeFile(tmp, 'report.docx', Buffer.alloc(2048, 'x'))
    writeFile(tmp, 'notes.txt', 'A'.repeat(500))
    writeFile(tmp, 'salary-bands-2026.xlsx', Buffer.alloc(1024, 'y'))
    writeFile(tmp, 'archive.zip', Buffer.alloc(1024, 'z'))
    writeFile(tmp, 'tiny.txt', 'hi')

    filePaths = ['report.docx', 'notes.txt', 'salary-bands-2026.xlsx', 'archive.zip', 'tiny.txt']
      .map(n => path.join(tmp, n))
  })

  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  test('categorises supported files as changed when cursor is epoch', async () => {
    const results = await crawl(tmp, '1970-01-01T00:00:00.000Z')
    const changedNames = results.changed.map(f => f.filename).sort()
    expect(changedNames).toContain('report.docx')
    expect(changedNames).toContain('notes.txt')
    expect(changedNames).toContain('salary-bands-2026.xlsx')
  })

  test('places unsupported .zip in unsupported bucket', async () => {
    const results = await crawl(tmp, '1970-01-01T00:00:00.000Z')
    const unsupportedNames = results.unsupported.map(f => f.filename)
    expect(unsupportedNames).toContain('archive.zip')
  })

  test('places tiny (<100 byte) files in unsupported bucket', async () => {
    const results = await crawl(tmp, '1970-01-01T00:00:00.000Z')
    const unsupportedNames = results.unsupported.map(f => f.filename)
    expect(unsupportedNames).toContain('tiny.txt')
  })

  test('flags files with sensitive filename patterns', async () => {
    const results = await crawl(tmp, '1970-01-01T00:00:00.000Z')
    const flaggedNames = results.flagged.map(f => f.filename)
    expect(flaggedNames).toContain('salary-bands-2026.xlsx')
  })

  test('flagged file also appears in changed (does not skip from changed)', async () => {
    const results = await crawl(tmp, '1970-01-01T00:00:00.000Z')
    const changedNames = results.changed.map(f => f.filename)
    expect(changedNames).toContain('salary-bands-2026.xlsx')
  })

  test('returns summary object with all required fields', async () => {
    const results = await crawl(tmp, '1970-01-01T00:00:00.000Z')
    expect(results.summary).toEqual(expect.objectContaining({
      total_found: expect.any(Number),
      total_supported: expect.any(Number),
      total_changed: expect.any(Number),
      total_flagged: expect.any(Number),
      total_skipped: expect.any(Number),
      scan_duration_ms: expect.any(Number),
      total_size_bytes: expect.any(Number),
    }))
    expect(results.summary.total_flagged).toBeGreaterThanOrEqual(1)
  })

  test('each file record includes fast checksum derived from path + mtime', async () => {
    const results = await crawl(tmp, '1970-01-01T00:00:00.000Z')
    for (const file of results.changed) {
      expect(file.checksum).toMatch(/^[a-f0-9]{64}$/)
    }
  })

  test('files modified before cursor land in unchanged', async () => {
    const futureCursor = new Date(Date.now() + 60_000).toISOString()
    const results = await crawl(tmp, futureCursor)
    expect(results.changed.length).toBe(0)
    expect(results.unchanged.length).toBeGreaterThan(0)
  })

  test('recursively walks nested directories', async () => {
    const nested = path.join(tmp, 'subfolder', 'deeper')
    fs.mkdirSync(nested, { recursive: true })
    writeFile(nested, 'deep-notes.md', 'deep content '.repeat(30))
    const results = await crawl(tmp, '1970-01-01T00:00:00.000Z')
    const changedNames = results.changed.map(f => f.filename)
    expect(changedNames).toContain('deep-notes.md')
  })

  test('handles unicode and space-containing filenames', async () => {
    writeFile(tmp, '会议 纪要.txt', 'unicode content '.repeat(20))
    writeFile(tmp, 'file with spaces.md', 'content '.repeat(30))
    const results = await crawl(tmp, '1970-01-01T00:00:00.000Z')
    const changedNames = results.changed.map(f => f.filename)
    expect(changedNames).toContain('会议 纪要.txt')
    expect(changedNames).toContain('file with spaces.md')
  })

  test('handles missing root path gracefully (returns errors, empty changed)', async () => {
    const results = await crawl(path.join(tmp, 'does-not-exist'), '1970-01-01T00:00:00.000Z')
    expect(results.changed.length).toBe(0)
    expect(results.errors.length).toBeGreaterThan(0)
    expect(results.errors[0].type).toBe('root_not_accessible')
  })

  test('skips excluded folders (node_modules)', async () => {
    const nm = path.join(tmp, 'node_modules', 'pkg')
    fs.mkdirSync(nm, { recursive: true })
    writeFile(nm, 'inside-node-modules.txt', 'content '.repeat(30))
    const results = await crawl(tmp, '1970-01-01T00:00:00.000Z')
    const changedNames = results.changed.map(f => f.filename)
    expect(changedNames).not.toContain('inside-node-modules.txt')
  })
})
