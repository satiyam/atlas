const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const audioTranscriber = require('./audio_transcriber')
const videoProcessor = require('./video_processor')
const imageDescriber = require('./image_describer')
const visualExtractor = require('./visual_extractor')

const VISUAL_DESCRIBE_CONCURRENCY = 3
const APPROX_COST_PER_VISUAL_USD = 0.005

function loadMammoth() { return require('mammoth') }
function loadPdfParse() { return require('pdf-parse') }
function loadXLSX() { return require('xlsx') }
function loadJSZip() { return require('jszip') }

function sha256(text) {
  return crypto.createHash('sha256').update(text || '', 'utf8').digest('hex')
}

const { auditLogPath } = require('../collections/paths')

function logError(context, err) {
  try {
    const logPath = auditLogPath()
    const dir = path.dirname(logPath)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    const line = JSON.stringify({
      event: 'PARSE_ERROR',
      context,
      error: err.message,
      timestamp: new Date().toISOString(),
    }) + '\n'
    fs.appendFileSync(logPath, line, 'utf8')
  } catch (_) {}
}

function makeMetadata(partial = {}) {
  return {
    author: partial.author ?? null,
    title: partial.title ?? null,
    created: partial.created ?? null,
    page_count: partial.page_count ?? null,
    duration_seconds: partial.duration_seconds ?? null,
    transcription_cost_usd: partial.transcription_cost_usd ?? null,
    visual_count: partial.visual_count ?? null,
    visual_cost_usd: partial.visual_cost_usd ?? null,
  }
}

async function describeVisualsWithConcurrency(visuals, limit) {
  if (!visuals || visuals.length === 0) return []
  const results = new Array(visuals.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, visuals.length) }, async () => {
    while (true) {
      const idx = cursor++
      if (idx >= visuals.length) return
      const v = visuals[idx]
      try {
        const label = v.source || `visual_${idx}`
        const res = await imageDescriber.describeImageBuffer(v.buffer, v.mediaType, label)
        results[idx] = { ...v, ...res }
      } catch (err) {
        results[idx] = { ...v, description: '', error: err.message }
      }
    }
  })
  await Promise.all(workers)
  return results
}

function formatVisualLocation(v, extNoDot) {
  if (extNoDot === 'pdf' && v.page) return `page ${v.page}`
  if (extNoDot === 'pptx' && v.slide) return `slide ${v.slide}`
  return null
}

function appendVisualsToText(baseText, described, extNoDot) {
  const usable = (described || []).filter(d => d.description && d.description.trim().length > 0)
  if (usable.length === 0) return baseText
  const lines = ['', '[VISUALS EXTRACTED FROM DOCUMENT]']
  usable.forEach((d, i) => {
    const loc = formatVisualLocation(d, extNoDot)
    const prefix = loc ? `[VISUAL ${i + 1} (${loc})]` : `[VISUAL ${i + 1}]`
    lines.push(`${prefix} ${d.description.trim()}`)
  })
  return `${baseText || ''}\n${lines.join('\n')}`
}

async function attachVisuals(filePath, extNoDot, baseText) {
  const extracted = await visualExtractor.extractVisuals(filePath, extNoDot)
  if (!extracted || extracted.length === 0) {
    return { rawText: baseText, visual_count: 0, visual_cost_usd: 0 }
  }
  const described = await describeVisualsWithConcurrency(extracted, VISUAL_DESCRIBE_CONCURRENCY)
  const successful = described.filter(d => d.description && d.description.trim().length > 0).length
  return {
    rawText: appendVisualsToText(baseText, described, extNoDot),
    visual_count: successful,
    visual_cost_usd: Math.round(successful * APPROX_COST_PER_VISUAL_USD * 10000) / 10000,
  }
}

function buildOutput({ filePath, stat, extNoDot, rawText, metadata = {}, error = null }) {
  return {
    file_path: filePath,
    filename: path.basename(filePath),
    file_type: extNoDot,
    last_modified: stat ? stat.mtime.toISOString() : new Date().toISOString(),
    size_bytes: stat ? stat.size : 0,
    checksum: sha256(rawText || ''),
    raw_text: rawText || '',
    metadata: makeMetadata(metadata),
    parsed_at: new Date().toISOString(),
    error,
  }
}

async function parseDocx(filePath, stat, extNoDot) {
  try {
    const mammoth = loadMammoth()
    const result = await mammoth.extractRawText({ path: filePath })
    const { rawText, visual_count, visual_cost_usd } = await attachVisuals(filePath, extNoDot, result.value)
    return buildOutput({
      filePath, stat, extNoDot,
      rawText,
      metadata: { visual_count, visual_cost_usd },
    })
  } catch (err) {
    logError(`parseDocx:${filePath}`, err)
    return buildOutput({ filePath, stat, extNoDot, rawText: '', error: err.message })
  }
}

async function parsePdf(filePath, stat, extNoDot) {
  let parser
  try {
    const pdfParseModule = loadPdfParse()
    const PDFParse = pdfParseModule.PDFParse || pdfParseModule.default?.PDFParse || pdfParseModule.default
    if (typeof PDFParse !== 'function') {
      throw new Error('pdf-parse PDFParse class not available — check installed version')
    }
    const buf = fs.readFileSync(filePath)
    parser = new PDFParse({ data: new Uint8Array(buf) })
    const textResult = await parser.getText()
    const fullText = textResult.text || (Array.isArray(textResult.pages) ? textResult.pages.map(p => p.text || '').join('\n') : '')

    let pageCount = null
    let title = null
    let author = null
    let created = null
    try {
      const info = await parser.getInfo()
      pageCount = info?.numPages ?? info?.pageCount ?? null
      const meta = info?.info || info?.metadata || info || {}
      title = meta.Title || meta.title || null
      author = meta.Author || meta.author || null
      created = meta.CreationDate || meta.created || null
    } catch (_) {}

    const { rawText, visual_count, visual_cost_usd } = await attachVisuals(filePath, extNoDot, fullText)
    return buildOutput({
      filePath, stat, extNoDot,
      rawText,
      metadata: {
        page_count: pageCount,
        title,
        author,
        created,
        visual_count,
        visual_cost_usd,
      },
    })
  } catch (err) {
    logError(`parsePdf:${filePath}`, err)
    return buildOutput({ filePath, stat, extNoDot, rawText: '', error: err.message })
  } finally {
    if (parser && typeof parser.destroy === 'function') {
      try { await parser.destroy() } catch (_) {}
    }
  }
}

function parsePlainText(filePath, stat, extNoDot) {
  try {
    const text = fs.readFileSync(filePath, 'utf8')
    return buildOutput({ filePath, stat, extNoDot, rawText: text })
  } catch (err) {
    logError(`parsePlainText:${filePath}`, err)
    return buildOutput({ filePath, stat, extNoDot, rawText: '', error: err.message })
  }
}

function parseXlsx(filePath, stat, extNoDot) {
  try {
    const XLSX = loadXLSX()
    const workbook = XLSX.readFile(filePath)
    const text = workbook.SheetNames.map(name => {
      const sheet = workbook.Sheets[name]
      const sheetText = typeof XLSX.utils.sheet_to_txt === 'function'
        ? XLSX.utils.sheet_to_txt(sheet)
        : XLSX.utils.sheet_to_csv(sheet)
      return `[Sheet: ${name}]\n${sheetText}`
    }).join('\n')
    return buildOutput({ filePath, stat, extNoDot, rawText: text })
  } catch (err) {
    logError(`parseXlsx:${filePath}`, err)
    return buildOutput({ filePath, stat, extNoDot, rawText: '', error: err.message })
  }
}

async function parsePptx(filePath, stat, extNoDot) {
  try {
    const JSZip = loadJSZip()
    const buf = fs.readFileSync(filePath)
    const zip = await JSZip.loadAsync(buf)
    const slideNames = Object.keys(zip.files)
      .filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name))
      .sort((a, b) => {
        const na = parseInt(a.match(/slide(\d+)/)[1], 10)
        const nb = parseInt(b.match(/slide(\d+)/)[1], 10)
        return na - nb
      })

    const slides = []
    for (const slideName of slideNames) {
      const xml = await zip.files[slideName].async('string')
      const matches = xml.match(/<a:t[^>]*>([^<]*)<\/a:t>/g) || []
      const text = matches.map(m => m.replace(/<[^>]+>/g, '')).join(' ')
      if (text.trim()) slides.push(text)
    }

    const slideText = slides.join('\n\n')
    const { rawText, visual_count, visual_cost_usd } = await attachVisuals(filePath, extNoDot, slideText)
    return buildOutput({
      filePath, stat, extNoDot,
      rawText,
      metadata: { page_count: slideNames.length, visual_count, visual_cost_usd },
    })
  } catch (err) {
    logError(`parsePptx:${filePath}`, err)
    return buildOutput({ filePath, stat, extNoDot, rawText: '', error: err.message })
  }
}

function parseEml(filePath, stat, extNoDot) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8')
    const split = raw.split(/\r?\n\r?\n/)
    const headerBlock = split[0] || ''
    const body = split.slice(1).join('\n\n')

    const headers = {}
    let currentKey = null
    for (const line of headerBlock.split(/\r?\n/)) {
      if (/^\s/.test(line) && currentKey) {
        headers[currentKey] += ' ' + line.trim()
        continue
      }
      const m = line.match(/^([^:]+):\s*(.*)/)
      if (m) {
        currentKey = m[1].toLowerCase()
        headers[currentKey] = m[2].trim()
      }
    }

    const subject = headers['subject'] || ''
    const rawText = subject ? `${subject}\n${body}` : body

    return buildOutput({
      filePath, stat, extNoDot, rawText,
      metadata: {
        author: headers['from'] || null,
        title: subject || null,
        created: headers['date'] || null,
      },
    })
  } catch (err) {
    logError(`parseEml:${filePath}`, err)
    return buildOutput({ filePath, stat, extNoDot, rawText: '', error: err.message })
  }
}

function parseMsg(filePath, stat, extNoDot) {
  try {
    const MsgReaderModule = require('@kenjiuno/msgreader')
    const Reader = MsgReaderModule.default || MsgReaderModule
    const buf = fs.readFileSync(filePath)
    const reader = new Reader(buf)
    const data = reader.getFileData()
    const subject = data.subject || ''
    const body = data.body || ''
    const rawText = subject || body
      ? `${subject}\n${body}`.trim()
      : path.basename(filePath)

    return buildOutput({
      filePath, stat, extNoDot, rawText,
      metadata: {
        author: data.senderName || data.senderEmail || null,
        title: subject || null,
      },
    })
  } catch (err) {
    logError(`parseMsg:${filePath}`, err)
    return buildOutput({
      filePath, stat, extNoDot,
      rawText: path.basename(filePath),
      error: err.message,
    })
  }
}

function stripTimestamps(rawText) {
  return rawText
    .split(/\r?\n/)
    .filter(line => {
      const t = line.trim()
      if (t === '' || t === 'WEBVTT' || t.startsWith('WEBVTT ')) return false
      if (/^\d{2}:\d{2}:\d{2}[.,]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[.,]\d{3}/.test(t)) return false
      if (/^\d+$/.test(t)) return false
      if (/^NOTE\b/.test(t)) return false
      return true
    })
    .join('\n')
    .trim()
}

function parseVttSrt(filePath, stat, extNoDot) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8')
    const clean = stripTimestamps(raw)
    return buildOutput({ filePath, stat, extNoDot, rawText: clean })
  } catch (err) {
    logError(`parseVttSrt:${filePath}`, err)
    return buildOutput({ filePath, stat, extNoDot, rawText: '', error: err.message })
  }
}

async function parseAudio(filePath, stat, extNoDot) {
  try {
    const result = await audioTranscriber.transcribeAudio(filePath)
    return buildOutput({
      filePath, stat, extNoDot,
      rawText: result.transcript || '',
      metadata: {
        duration_seconds: result.duration_seconds ?? null,
        transcription_cost_usd: result.cost_usd ?? null,
      },
      error: result.error || null,
    })
  } catch (err) {
    logError(`parseAudio:${filePath}`, err)
    return buildOutput({ filePath, stat, extNoDot, rawText: '', error: err.message })
  }
}

async function parseVideo(filePath, stat, extNoDot) {
  try {
    const result = await videoProcessor.processVideo(filePath)
    return buildOutput({
      filePath, stat, extNoDot,
      rawText: result.transcript || '',
      metadata: {
        duration_seconds: result.duration_seconds ?? null,
        transcription_cost_usd: result.cost_usd ?? null,
      },
      error: result.error || null,
    })
  } catch (err) {
    logError(`parseVideo:${filePath}`, err)
    return buildOutput({ filePath, stat, extNoDot, rawText: '', error: err.message })
  }
}

async function parseImage(filePath, stat, extNoDot) {
  try {
    const result = await imageDescriber.describeImage(filePath)
    return buildOutput({
      filePath, stat, extNoDot,
      rawText: result.description || '',
      error: result.error || null,
    })
  } catch (err) {
    logError(`parseImage:${filePath}`, err)
    return buildOutput({ filePath, stat, extNoDot, rawText: '', error: err.message })
  }
}

const ROUTE = {
  docx: parseDocx,
  pdf: parsePdf,
  txt: parsePlainText,
  md: parsePlainText,
  csv: parsePlainText,
  xlsx: parseXlsx,
  pptx: parsePptx,
  eml: parseEml,
  msg: parseMsg,
  vtt: parseVttSrt,
  srt: parseVttSrt,
  mp3: parseAudio,
  m4a: parseAudio,
  wav: parseAudio,
  mp4: parseVideo,
  png: parseImage,
  jpg: parseImage,
  jpeg: parseImage,
}

async function parseFile(filePath) {
  const extNoDot = path.extname(filePath).replace(/^\./, '').toLowerCase()

  let stat
  try {
    stat = fs.statSync(filePath)
  } catch (err) {
    logError(`parseFile:stat:${filePath}`, err)
    return buildOutput({
      filePath, stat: null, extNoDot,
      rawText: '',
      error: err.message,
    })
  }

  const handler = ROUTE[extNoDot]
  if (!handler) {
    return buildOutput({
      filePath, stat, extNoDot,
      rawText: '',
      error: `Unsupported file type: ${extNoDot ? '.' + extNoDot : '(none)'}`,
    })
  }

  try {
    return await handler(filePath, stat, extNoDot)
  } catch (err) {
    logError(`parseFile:handler:${filePath}`, err)
    return buildOutput({ filePath, stat, extNoDot, rawText: '', error: err.message })
  }
}

const AUDIO_VIDEO_EXTS = new Set(['mp3', 'm4a', 'wav', 'mp4'])
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg'])

async function runWithConcurrency(items, limit, fn) {
  if (items.length === 0) return []
  const results = new Array(items.length)
  let cursor = 0

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const idx = cursor++
      if (idx >= items.length) return
      try {
        results[idx] = await fn(items[idx])
      } catch (err) {
        results[idx] = { file_path: items[idx], error: err.message }
      }
    }
  })

  await Promise.all(workers)
  return results
}

async function parseBatch(filePaths) {
  const audioVideoFiles = []
  const imageFiles = []
  const documentFiles = []

  for (const p of filePaths) {
    const ext = path.extname(p).replace(/^\./, '').toLowerCase()
    if (AUDIO_VIDEO_EXTS.has(ext)) audioVideoFiles.push(p)
    else if (IMAGE_EXTS.has(ext)) imageFiles.push(p)
    else documentFiles.push(p)
  }

  const [docs, audios, images] = await Promise.all([
    runWithConcurrency(documentFiles, 10, parseFile),
    runWithConcurrency(audioVideoFiles, 3, parseFile),
    runWithConcurrency(imageFiles, 3, parseFile),
  ])

  const order = new Map(filePaths.map((p, i) => [p, i]))
  const combined = [...docs, ...audios, ...images]
  combined.sort((a, b) => (order.get(a.file_path) ?? 0) - (order.get(b.file_path) ?? 0))
  return combined
}

module.exports = {
  parseFile,
  parseBatch,
  stripTimestamps,
}
