const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const audioTranscriber = require('./audio_transcriber')
const videoProcessor = require('./video_processor')
const imageDescriber = require('./image_describer')

function loadMammoth() { return require('mammoth') }
function loadPdfParse() { return require('pdf-parse') }
function loadXLSX() { return require('xlsx') }
function loadJSZip() { return require('jszip') }

function sha256(text) {
  return crypto.createHash('sha256').update(text || '', 'utf8').digest('hex')
}

function logError(context, err) {
  try {
    const logPath = path.join(__dirname, '../../logs/audit_log.jsonl')
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
    return buildOutput({ filePath, stat, extNoDot, rawText: result.value })
  } catch (err) {
    logError(`parseDocx:${filePath}`, err)
    return buildOutput({ filePath, stat, extNoDot, rawText: '', error: err.message })
  }
}

async function parsePdf(filePath, stat, extNoDot) {
  try {
    const pdfParse = loadPdfParse()
    const buf = fs.readFileSync(filePath)
    const result = await pdfParse(buf)
    return buildOutput({
      filePath, stat, extNoDot,
      rawText: result.text,
      metadata: {
        page_count: result.numpages,
        title: result.info?.Title || null,
        author: result.info?.Author || null,
        created: result.info?.CreationDate || null,
      },
    })
  } catch (err) {
    logError(`parsePdf:${filePath}`, err)
    return buildOutput({ filePath, stat, extNoDot, rawText: '', error: err.message })
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

    return buildOutput({
      filePath, stat, extNoDot,
      rawText: slides.join('\n\n'),
      metadata: { page_count: slideNames.length },
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
