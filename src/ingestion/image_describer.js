const fs = require('fs')
const path = require('path')
const Anthropic = require('@anthropic-ai/sdk')

const VISION_MODEL = 'claude-haiku-4-5-20251001'
const MAX_TOKENS = 400
const DEFAULT_CONCURRENCY = 3

const VISION_PROMPT = `Extract organisational knowledge from this image. Cover only what is actually present:
- Visible text
- Decisions, outcomes, conclusions
- People, roles, team names
- Project names, dates, timelines
- Chart/diagram/process-flow content
- Action items or next steps
Be concise — one short paragraph or a tight bulleted list. Skip sections that don't apply.`

let _client = null
function getClient() {
  if (!_client) {
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || 'sk-missing-key' })
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
      event: 'IMAGE_DESCRIPTION_ERROR',
      context,
      error: err.message,
      timestamp: new Date().toISOString(),
    }) + '\n'
    fs.appendFileSync(logPath, line, 'utf8')
  } catch (_) {}
}

function detectMediaType(imagePath) {
  const ext = path.extname(imagePath).toLowerCase()
  if (ext === '.png') return 'image/png'
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  return 'image/png'
}

async function describeImageBuffer(buffer, mediaType, contextLabel = 'buffer') {
  try {
    const base64Data = Buffer.from(buffer).toString('base64')
    const client = getClient()
    const debugLogger = require('../debug/debug_logger')
    const response = await debugLogger.tracked({
      type: 'vision', file: contextLabel, call: 'vision description', model: VISION_MODEL,
      apiFn: () => client.messages.create({
      model: VISION_MODEL,
      max_tokens: MAX_TOKENS,
      system: [
        { type: 'text', text: VISION_PROMPT, cache_control: { type: 'ephemeral' } },
      ],
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType, data: base64Data },
          },
        ],
      }],
    }),
    })
    const description = response?.content?.[0]?.text || ''
    return { description, described_at: new Date().toISOString() }
  } catch (err) {
    logError(`describeImageBuffer:${contextLabel}`, err)
    return { description: '', described_at: new Date().toISOString(), error: err.message }
  }
}

async function describeImage(imagePath) {
  try {
    const buffer = fs.readFileSync(imagePath)
    const mediaType = detectMediaType(imagePath)
    const result = await describeImageBuffer(buffer, mediaType, imagePath)
    return { ...result, image_path: imagePath }
  } catch (err) {
    logError(`describeImage:${imagePath}`, err)
    return {
      description: '',
      image_path: imagePath,
      described_at: new Date().toISOString(),
      error: err.message,
    }
  }
}

async function describeBatch(imagePaths, concurrency = DEFAULT_CONCURRENCY) {
  const results = []
  for (let i = 0; i < imagePaths.length; i += concurrency) {
    const batch = imagePaths.slice(i, i + concurrency)
    const batchResults = await Promise.all(batch.map(p => describeImage(p)))
    results.push(...batchResults)
  }
  return results
}

module.exports = {
  describeImage,
  describeImageBuffer,
  describeBatch,
  detectMediaType,
  VISION_MODEL,
  VISION_PROMPT,
}
