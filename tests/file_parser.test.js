const fs = require('fs')
const os = require('os')
const path = require('path')
const { parseFile, parseBatch } = require('../src/ingestion/file_parser')

let tmpDir
let txtPath
let vttPath
let emlPath
let xyzPath

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-parser-test-'))

  txtPath = path.join(tmpDir, 'project-notes.txt')
  fs.writeFileSync(
    txtPath,
    'Project Phoenix meeting notes. Sarah Chen decided to select TechCorp.',
    'utf8',
  )

  vttPath = path.join(tmpDir, 'transcript.vtt')
  fs.writeFileSync(
    vttPath,
    'WEBVTT\n\n' +
    '00:00:01.000 --> 00:00:04.000\n' +
    'Sarah: We have decided on TechCorp.\n\n' +
    '00:00:05.000 --> 00:00:08.000\n' +
    'James: Procurement will begin Monday.\n',
    'utf8',
  )

  emlPath = path.join(tmpDir, 'message.eml')
  fs.writeFileSync(
    emlPath,
    'From: sarah.chen@phoenix-project.com\n' +
    'To: james@phoenix-project.com\n' +
    'Subject: TechCorp vendor selection confirmed\n' +
    'Date: Mon, 20 Apr 2026 09:30:00 +0800\n' +
    '\n' +
    'Hi James,\n\n' +
    'Following our meeting, I am confirming the decision to proceed with TechCorp.\n' +
    'Please begin procurement on Monday morning.\n\n' +
    'Best,\nSarah\n',
    'utf8',
  )

  xyzPath = path.join(tmpDir, 'unknown-format.xyz')
  fs.writeFileSync(xyzPath, 'Binary-ish content that should not be parsed.', 'utf8')
})

afterAll(() => {
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('Test 1 — .txt file', () => {
  test('parses plain text and produces standard output object', async () => {
    const result = await parseFile(txtPath)

    expect(result.raw_text).toContain('Project Phoenix')
    expect(result.raw_text).toContain('Sarah Chen')
    expect(result.raw_text).toContain('TechCorp')

    expect(typeof result.checksum).toBe('string')
    expect(result.checksum).toMatch(/^[a-f0-9]{64}$/)

    expect(result.error).toBeNull()
    expect(result.file_type).toBe('txt')
    expect(result.filename).toBe('project-notes.txt')
  })
})

describe('Test 2 — .vtt transcript file', () => {
  test('parses VTT and strips timestamp lines', async () => {
    const result = await parseFile(vttPath)

    expect(result.raw_text).not.toMatch(/\d{2}:\d{2}:\d{2}\.\d{3}/)
    expect(result.raw_text).not.toContain('-->')
    expect(result.raw_text).not.toContain('WEBVTT')

    expect(result.raw_text).toContain('Sarah')
    expect(result.raw_text).toContain('TechCorp')
    expect(result.raw_text).toContain('James')

    expect(result.error).toBeNull()
    expect(result.file_type).toBe('vtt')
  })
})

describe('Test 3 — .eml email file', () => {
  test('extracts subject and body text', async () => {
    const result = await parseFile(emlPath)

    expect(result.raw_text).toContain('TechCorp vendor selection confirmed')
    expect(result.raw_text).toContain('confirming the decision')
    expect(result.raw_text).toContain('procurement')

    expect(result.metadata.author).toContain('sarah.chen@phoenix-project.com')
    expect(result.metadata.title).toContain('TechCorp')
    expect(result.error).toBeNull()
    expect(result.file_type).toBe('eml')
  })
})

describe('Test 4 — Unsupported format', () => {
  test('returns output with error set and empty raw_text', async () => {
    const result = await parseFile(xyzPath)

    expect(result.raw_text).toBe('')
    expect(result.error).toBeTruthy()
    expect(result.error).toMatch(/Unsupported/i)
    expect(result.file_type).toBe('xyz')
  })
})

describe('Test 5 — parseBatch on all test files', () => {
  test('returns an array of length 4 with no thrown errors', async () => {
    const paths = [txtPath, vttPath, emlPath, xyzPath]
    const results = await parseBatch(paths)

    expect(Array.isArray(results)).toBe(true)
    expect(results).toHaveLength(4)

    const filenames = results.map(r => r.filename)
    expect(filenames).toContain('project-notes.txt')
    expect(filenames).toContain('transcript.vtt')
    expect(filenames).toContain('message.eml')
    expect(filenames).toContain('unknown-format.xyz')

    for (const r of results) {
      expect(r).toHaveProperty('file_path')
      expect(r).toHaveProperty('filename')
      expect(r).toHaveProperty('file_type')
      expect(r).toHaveProperty('last_modified')
      expect(r).toHaveProperty('size_bytes')
      expect(r).toHaveProperty('checksum')
      expect(r).toHaveProperty('raw_text')
      expect(r).toHaveProperty('metadata')
      expect(r).toHaveProperty('parsed_at')
      expect(r).toHaveProperty('error')
    }

    const supported = results.filter(r => r.error === null)
    expect(supported).toHaveLength(3)
  })
})
