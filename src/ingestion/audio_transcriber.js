const fs = require('fs')
const path = require('path')
const { OpenAI } = require('openai')

const WHISPER_MODEL = 'gpt-4o-mini-transcribe'
const WHISPER_COST_PER_MINUTE = 0.003
const MAX_DIRECT_SIZE_BYTES = 25 * 1024 * 1024
const CHUNK_DURATION_SECONDS = 20 * 60

let _client = null
function getClient() {
  if (!_client) {
    _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || 'sk-missing-key' })
  }
  return _client
}

const { auditLogPath } = require('../collections/paths')

function logError(context, err) {
  try {
    const logPath = auditLogPath()
    const dir = path.dirname(logPath)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    const line = JSON.stringify({
      event: 'TRANSCRIPTION_ERROR',
      context,
      error: err.message,
      timestamp: new Date().toISOString(),
    }) + '\n'
    fs.appendFileSync(logPath, line, 'utf8')
  } catch (_) {}
}

function estimateTranscriptionCost(fileSizeBytes, extension) {
  const sizeMb = fileSizeBytes / 1024 / 1024
  const ext = (extension || '').toLowerCase().replace(/^\./, '')
  const minutesPerMb = ext === 'wav' ? 0.5 : 1.0
  const estimatedMinutes = sizeMb * minutesPerMb
  return {
    estimated_minutes: Math.round(estimatedMinutes * 100) / 100,
    estimated_cost_usd: Math.round(estimatedMinutes * WHISPER_COST_PER_MINUTE * 10000) / 10000,
  }
}

async function transcribeAudio(filePath) {
  try {
    const stat = fs.statSync(filePath)
    const ext = path.extname(filePath).toLowerCase().replace(/^\./, '')
    const costEstimate = estimateTranscriptionCost(stat.size, ext)

    if (stat.size > MAX_DIRECT_SIZE_BYTES) {
      return await transcribeInChunks(filePath)
    }

    const client = getClient()
    const response = await client.audio.transcriptions.create({
      file: fs.createReadStream(filePath),
      model: WHISPER_MODEL,
      response_format: 'text',
    })

    const transcript = typeof response === 'string' ? response : (response?.text || '')

    return {
      transcript,
      duration_seconds: Math.round(costEstimate.estimated_minutes * 60),
      cost_usd: costEstimate.estimated_cost_usd,
      model: WHISPER_MODEL,
      transcribed_at: new Date().toISOString(),
    }
  } catch (err) {
    logError(`transcribeAudio:${filePath}`, err)
    return {
      transcript: '',
      duration_seconds: 0,
      cost_usd: 0,
      model: WHISPER_MODEL,
      transcribed_at: new Date().toISOString(),
      error: err.message,
    }
  }
}

async function transcribeInChunks(filePath) {
  const ffmpeg = require('fluent-ffmpeg')
  const stat = fs.statSync(filePath)
  const ext = path.extname(filePath).toLowerCase().replace(/^\./, '')
  const costEstimate = estimateTranscriptionCost(stat.size, ext)
  const totalDurationSeconds = Math.round(costEstimate.estimated_minutes * 60)
  const numChunks = Math.max(1, Math.ceil(totalDurationSeconds / CHUNK_DURATION_SECONDS))

  const tmpDir = path.join(path.dirname(filePath), `.atlas_chunks_${Date.now()}`)
  fs.mkdirSync(tmpDir, { recursive: true })
  const chunkPaths = []

  try {
    for (let i = 0; i < numChunks; i++) {
      const chunkPath = path.join(tmpDir, `chunk_${i}.mp3`)
      await new Promise((resolve, reject) => {
        ffmpeg(filePath)
          .setStartTime(i * CHUNK_DURATION_SECONDS)
          .setDuration(CHUNK_DURATION_SECONDS)
          .noVideo()
          .audioCodec('libmp3lame')
          .audioBitrate('64k')
          .save(chunkPath)
          .on('end', resolve)
          .on('error', reject)
      })
      chunkPaths.push(chunkPath)
    }

    const transcripts = []
    let totalCost = 0

    for (const chunkPath of chunkPaths) {
      const chunkResult = await transcribeAudio(chunkPath)
      transcripts.push(chunkResult.transcript || '')
      totalCost += chunkResult.cost_usd || 0
    }

    return {
      transcript: transcripts.join('\n'),
      duration_seconds: totalDurationSeconds,
      cost_usd: Math.round(totalCost * 10000) / 10000,
      model: WHISPER_MODEL,
      transcribed_at: new Date().toISOString(),
      chunked: true,
      num_chunks: numChunks,
    }
  } catch (err) {
    logError(`transcribeInChunks:${filePath}`, err)
    return {
      transcript: '',
      duration_seconds: 0,
      cost_usd: 0,
      model: WHISPER_MODEL,
      transcribed_at: new Date().toISOString(),
      error: err.message,
    }
  } finally {
    for (const cp of chunkPaths) {
      try { fs.unlinkSync(cp) } catch (_) {}
    }
    try { fs.rmdirSync(tmpDir) } catch (_) {}
  }
}

module.exports = {
  transcribeAudio,
  transcribeInChunks,
  estimateTranscriptionCost,
  WHISPER_MODEL,
  WHISPER_COST_PER_MINUTE,
  MAX_DIRECT_SIZE_BYTES,
}
