const fs = require('fs')
const path = require('path')
const ffmpeg = require('fluent-ffmpeg')

const audioTranscriber = require('./audio_transcriber')

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm'])

function isVideoFile(extension) {
  if (!extension) return false
  const normalized = extension.startsWith('.')
    ? extension.toLowerCase()
    : '.' + extension.toLowerCase()
  return VIDEO_EXTENSIONS.has(normalized)
}

const { auditLogPath } = require('../collections/paths')

function logError(context, err) {
  try {
    const logPath = auditLogPath()
    const dir = path.dirname(logPath)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    const line = JSON.stringify({
      event: 'VIDEO_PROCESSING_ERROR',
      context,
      error: err.message,
      timestamp: new Date().toISOString(),
    }) + '\n'
    fs.appendFileSync(logPath, line, 'utf8')
  } catch (_) {}
}

function deriveAudioPath(videoPath) {
  return videoPath.replace(/\.[^.]+$/, '_audio_temp.mp3')
}

async function extractAudio(videoPath) {
  const audioPath = deriveAudioPath(videoPath)

  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .noVideo()
      .audioCodec('libmp3lame')
      .audioBitrate('64k')
      .save(audioPath)
      .on('end', () => resolve(audioPath))
      .on('error', (err) => {
        logError(`extractAudio:${videoPath}`, err)
        reject(err)
      })
  })
}

async function processVideo(videoPath) {
  let audioPath = null

  try {
    audioPath = await extractAudio(videoPath)
    const result = await audioTranscriber.transcribeAudio(audioPath)

    return {
      transcript: result.transcript || '',
      duration_seconds: result.duration_seconds ?? 0,
      cost_usd: result.cost_usd ?? 0,
      model: result.model || audioTranscriber.WHISPER_MODEL,
      transcribed_at: result.transcribed_at || new Date().toISOString(),
      source: videoPath,
      error: result.error || null,
    }
  } catch (err) {
    logError(`processVideo:${videoPath}`, err)
    return {
      transcript: '',
      duration_seconds: 0,
      cost_usd: 0,
      source: videoPath,
      error: 'ffmpeg extraction failed',
    }
  } finally {
    if (audioPath) {
      try { fs.unlinkSync(audioPath) } catch (_) {}
    }
  }
}

module.exports = {
  extractAudio,
  processVideo,
  isVideoFile,
  VIDEO_EXTENSIONS,
}
