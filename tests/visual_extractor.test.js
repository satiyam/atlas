const fs = require('fs')
const os = require('os')
const path = require('path')
const JSZip = require('jszip')
const {
  extractDocxImages,
  extractPptxImages,
  detectMediaTypeFromBuffer,
  MIN_IMAGE_BYTES,
} = require('../src/ingestion/visual_extractor')

const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const JPEG_HEADER = Buffer.from([0xff, 0xd8, 0xff, 0xe0])

function makePngBuffer(sizeBytes, seed = 0) {
  const body = Buffer.alloc(sizeBytes - PNG_HEADER.length, seed)
  return Buffer.concat([PNG_HEADER, body])
}

function makeJpegBuffer(sizeBytes, seed = 0) {
  const body = Buffer.alloc(sizeBytes - JPEG_HEADER.length, seed)
  return Buffer.concat([JPEG_HEADER, body])
}

let tmpDir
let docxPath
let pptxPath
let pptxWithRelsPath

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-visual-test-'))

  const docxZip = new JSZip()
  docxZip.file('word/document.xml', '<xml/>')
  docxZip.file('word/media/image1.png', makePngBuffer(MIN_IMAGE_BYTES + 100, 1))
  docxZip.file('word/media/image2.jpeg', makeJpegBuffer(MIN_IMAGE_BYTES + 200, 2))
  docxZip.file('word/media/image3.png', makePngBuffer(MIN_IMAGE_BYTES + 100, 1))
  docxZip.file('word/media/tiny.png', makePngBuffer(500, 9))
  docxPath = path.join(tmpDir, 'sample.docx')
  fs.writeFileSync(docxPath, await docxZip.generateAsync({ type: 'nodebuffer' }))

  const pptxZip = new JSZip()
  pptxZip.file('ppt/slides/slide1.xml', '<xml/>')
  pptxZip.file('ppt/slides/slide2.xml', '<xml/>')
  pptxZip.file('ppt/media/image1.png', makePngBuffer(MIN_IMAGE_BYTES + 300, 3))
  pptxZip.file('ppt/media/image2.png', makePngBuffer(MIN_IMAGE_BYTES + 400, 4))
  pptxPath = path.join(tmpDir, 'sample.pptx')
  fs.writeFileSync(pptxPath, await pptxZip.generateAsync({ type: 'nodebuffer' }))

  const pptxWithRels = new JSZip()
  pptxWithRels.file('ppt/slides/slide1.xml', '<xml/>')
  pptxWithRels.file('ppt/slides/slide2.xml', '<xml/>')
  pptxWithRels.file(
    'ppt/slides/_rels/slide1.xml.rels',
    '<?xml version="1.0"?><Relationships><Relationship Target="../media/image1.png"/></Relationships>',
  )
  pptxWithRels.file(
    'ppt/slides/_rels/slide2.xml.rels',
    '<?xml version="1.0"?><Relationships><Relationship Target="../media/image2.png"/></Relationships>',
  )
  pptxWithRels.file('ppt/media/image1.png', makePngBuffer(MIN_IMAGE_BYTES + 300, 5))
  pptxWithRels.file('ppt/media/image2.png', makePngBuffer(MIN_IMAGE_BYTES + 400, 6))
  pptxWithRelsPath = path.join(tmpDir, 'with-rels.pptx')
  fs.writeFileSync(pptxWithRelsPath, await pptxWithRels.generateAsync({ type: 'nodebuffer' }))
})

afterAll(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch (_) {}
})

describe('detectMediaTypeFromBuffer', () => {
  test('identifies PNG', () => {
    expect(detectMediaTypeFromBuffer(PNG_HEADER)).toBe('image/png')
  })
  test('identifies JPEG', () => {
    expect(detectMediaTypeFromBuffer(JPEG_HEADER)).toBe('image/jpeg')
  })
  test('returns null for unknown bytes', () => {
    expect(detectMediaTypeFromBuffer(Buffer.from([0, 1, 2, 3]))).toBe(null)
  })
  test('returns null for empty input', () => {
    expect(detectMediaTypeFromBuffer(Buffer.alloc(0))).toBe(null)
  })
})

describe('extractDocxImages', () => {
  test('extracts images from word/media/ and assigns media types', async () => {
    const images = await extractDocxImages(docxPath)
    expect(images.length).toBe(2)
    const types = images.map(i => i.mediaType).sort()
    expect(types).toEqual(['image/jpeg', 'image/png'])
  })

  test('dedupes identical images by content hash', async () => {
    const images = await extractDocxImages(docxPath)
    const hashes = new Set(images.map(i => i.hash))
    expect(hashes.size).toBe(images.length)
  })

  test('skips images below minimum size', async () => {
    const images = await extractDocxImages(docxPath)
    for (const img of images) {
      expect(img.buffer.length).toBeGreaterThanOrEqual(MIN_IMAGE_BYTES)
    }
  })

  test('returns empty array for nonexistent file', async () => {
    const images = await extractDocxImages('/definitely/not/a/real/file.docx')
    expect(images).toEqual([])
  })
})

describe('extractPptxImages', () => {
  test('extracts images from ppt/media/', async () => {
    const images = await extractPptxImages(pptxPath)
    expect(images.length).toBe(2)
  })

  test('tags images with slide number when resolvable via _rels', async () => {
    const images = await extractPptxImages(pptxWithRelsPath)
    expect(images.length).toBe(2)
    const bySource = Object.fromEntries(images.map(i => [i.source, i.slide]))
    expect(bySource['ppt/media/image1.png']).toBe(1)
    expect(bySource['ppt/media/image2.png']).toBe(2)
  })

  test('leaves slide null when rels missing', async () => {
    const images = await extractPptxImages(pptxPath)
    for (const img of images) {
      expect(img.slide).toBe(null)
    }
  })
})

describe('per-file cap', () => {
  test('ATLAS_MAX_VISUALS_PER_FILE caps the output count', async () => {
    const cappedZip = new JSZip()
    for (let i = 0; i < 8; i++) {
      cappedZip.file(`word/media/image${i}.png`, makePngBuffer(MIN_IMAGE_BYTES + 50, i + 100))
    }
    const cappedPath = path.join(tmpDir, 'many.docx')
    fs.writeFileSync(cappedPath, await cappedZip.generateAsync({ type: 'nodebuffer' }))

    const prev = process.env.ATLAS_MAX_VISUALS_PER_FILE
    process.env.ATLAS_MAX_VISUALS_PER_FILE = '3'
    try {
      const images = await extractDocxImages(cappedPath)
      expect(images.length).toBe(3)
    } finally {
      if (prev === undefined) delete process.env.ATLAS_MAX_VISUALS_PER_FILE
      else process.env.ATLAS_MAX_VISUALS_PER_FILE = prev
    }
  })
})
