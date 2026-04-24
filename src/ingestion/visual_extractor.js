const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const DEFAULT_MAX_VISUALS_PER_FILE = 20
const MIN_IMAGE_BYTES = 4 * 1024

function getMaxVisualsPerFile() {
  const v = parseInt(process.env.ATLAS_MAX_VISUALS_PER_FILE, 10)
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_MAX_VISUALS_PER_FILE
}

const { auditLogPath } = require('../collections/paths')

function logError(context, err) {
  try {
    const logPath = auditLogPath()
    const dir = path.dirname(logPath)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    const line = JSON.stringify({
      event: 'VISUAL_EXTRACT_ERROR',
      context,
      error: err.message,
      timestamp: new Date().toISOString(),
    }) + '\n'
    fs.appendFileSync(logPath, line, 'utf8')
  } catch (_) {}
}

function detectMediaTypeFromBuffer(buf) {
  if (!buf || buf.length < 4) return null
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png'
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'image/gif'
  return null
}

function hashBuffer(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex')
}

function dedupAndCap(rawImages, cap) {
  const seen = new Set()
  const out = []
  for (const img of rawImages) {
    if (!img || !img.buffer || img.buffer.length < MIN_IMAGE_BYTES) continue
    const mediaType = img.mediaType || detectMediaTypeFromBuffer(img.buffer)
    if (!mediaType) continue
    const hash = hashBuffer(img.buffer)
    if (seen.has(hash)) continue
    seen.add(hash)
    out.push({ ...img, mediaType, hash })
    if (out.length >= cap) break
  }
  return out
}

async function extractDocxImages(filePath) {
  try {
    const JSZip = require('jszip')
    const buf = fs.readFileSync(filePath)
    const zip = await JSZip.loadAsync(buf)
    const mediaNames = Object.keys(zip.files).filter(name => /^word\/media\//i.test(name))
    const raw = []
    for (const name of mediaNames) {
      const entry = zip.files[name]
      if (entry.dir) continue
      const imgBuf = await entry.async('nodebuffer')
      raw.push({ buffer: imgBuf, source: name })
    }
    return dedupAndCap(raw, getMaxVisualsPerFile())
  } catch (err) {
    logError(`extractDocxImages:${filePath}`, err)
    return []
  }
}

async function extractPptxImages(filePath) {
  try {
    const JSZip = require('jszip')
    const buf = fs.readFileSync(filePath)
    const zip = await JSZip.loadAsync(buf)

    const slideRelsByMedia = new Map()
    const relsNames = Object.keys(zip.files)
      .filter(n => /^ppt\/slides\/_rels\/slide(\d+)\.xml\.rels$/i.test(n))
    for (const relName of relsNames) {
      const slideNumMatch = relName.match(/slide(\d+)\.xml\.rels/i)
      const slideNum = slideNumMatch ? parseInt(slideNumMatch[1], 10) : null
      const xml = await zip.files[relName].async('string')
      const targets = xml.match(/Target="\.\.\/media\/[^"]+"/g) || []
      for (const t of targets) {
        const m = t.match(/Target="\.\.\/media\/([^"]+)"/)
        if (m) {
          const mediaName = `ppt/media/${m[1]}`
          if (!slideRelsByMedia.has(mediaName)) slideRelsByMedia.set(mediaName, slideNum)
        }
      }
    }

    const mediaNames = Object.keys(zip.files)
      .filter(name => /^ppt\/media\//i.test(name))
      .sort((a, b) => {
        const sa = slideRelsByMedia.get(a) ?? 9999
        const sb = slideRelsByMedia.get(b) ?? 9999
        return sa - sb
      })

    const raw = []
    for (const name of mediaNames) {
      const entry = zip.files[name]
      if (entry.dir) continue
      const imgBuf = await entry.async('nodebuffer')
      raw.push({
        buffer: imgBuf,
        source: name,
        slide: slideRelsByMedia.get(name) ?? null,
      })
    }
    return dedupAndCap(raw, getMaxVisualsPerFile())
  } catch (err) {
    logError(`extractPptxImages:${filePath}`, err)
    return []
  }
}

let _pdfjsPromise = null
function loadPdfjs() {
  if (!_pdfjsPromise) {
    _pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs')
  }
  return _pdfjsPromise
}

async function extractPdfImages(filePath) {
  try {
    const pdfjsLib = await loadPdfjs()
    const data = new Uint8Array(fs.readFileSync(filePath))
    const loadingTask = pdfjsLib.getDocument({ data, disableFontFace: true, isEvalSupported: false })
    const pdf = await loadingTask.promise

    const cap = getMaxVisualsPerFile()
    const raw = []

    for (let pageNum = 1; pageNum <= pdf.numPages && raw.length < cap * 2; pageNum++) {
      let page
      try {
        page = await pdf.getPage(pageNum)
      } catch (err) {
        logError(`extractPdfImages:getPage:${filePath}:${pageNum}`, err)
        continue
      }

      let opList
      try {
        opList = await page.getOperatorList()
      } catch (err) {
        logError(`extractPdfImages:getOperatorList:${filePath}:${pageNum}`, err)
        continue
      }

      const OPS = pdfjsLib.OPS
      for (let i = 0; i < opList.fnArray.length; i++) {
        const fn = opList.fnArray[i]
        if (fn !== OPS.paintImageXObject && fn !== OPS.paintJpegXObject) continue
        const objId = opList.argsArray[i][0]
        if (!objId) continue

        let imgObj = null
        try {
          imgObj = await new Promise((resolve) => {
            let resolved = false
            const timer = setTimeout(() => { if (!resolved) { resolved = true; resolve(null) } }, 2000)
            try {
              page.objs.get(objId, (obj) => {
                if (!resolved) { resolved = true; clearTimeout(timer); resolve(obj) }
              })
            } catch (_) {
              if (!resolved) { resolved = true; clearTimeout(timer); resolve(null) }
            }
          })
        } catch (_) { imgObj = null }

        if (!imgObj) continue

        if (Buffer.isBuffer(imgObj) || imgObj instanceof Uint8Array) {
          const b = Buffer.from(imgObj)
          raw.push({ buffer: b, source: objId, page: pageNum })
          continue
        }
        if (imgObj.data && (imgObj.data instanceof Uint8Array || Buffer.isBuffer(imgObj.data))) {
          const b = Buffer.from(imgObj.data)
          const mt = detectMediaTypeFromBuffer(b)
          if (mt) raw.push({ buffer: b, source: objId, page: pageNum, mediaType: mt })
        }
      }

      try { page.cleanup() } catch (_) {}
    }

    try { await pdf.cleanup() } catch (_) {}
    try { await loadingTask.destroy() } catch (_) {}

    return dedupAndCap(raw, cap)
  } catch (err) {
    logError(`extractPdfImages:${filePath}`, err)
    return []
  }
}

async function extractVisuals(filePath, extNoDot) {
  const ext = (extNoDot || path.extname(filePath).replace(/^\./, '')).toLowerCase()
  if (ext === 'docx') return extractDocxImages(filePath)
  if (ext === 'pptx') return extractPptxImages(filePath)
  if (ext === 'pdf')  return extractPdfImages(filePath)
  return []
}

module.exports = {
  extractVisuals,
  extractDocxImages,
  extractPptxImages,
  extractPdfImages,
  detectMediaTypeFromBuffer,
  getMaxVisualsPerFile,
  MIN_IMAGE_BYTES,
}
