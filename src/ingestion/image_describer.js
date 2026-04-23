const fs = require('fs')
const path = require('path')
const Anthropic = require('@anthropic-ai/sdk')

const VISION_MODEL = 'claude-sonnet-4-6'
const MAX_TOKENS = 1024
const DEFAULT_CONCURRENCY = 3

const VISION_PROMPT = `Analyse this image and extract all information relevant to organisational knowledge. Focus on:
- Any text visible in the image
- Decisions, outcomes, or conclusions shown
- People, roles, or team names referenced
- Project names, dates, or timelines
- Charts, diagrams, or process flows
- Action items or next steps
Return a structured description covering all of the above that are present.`

let _client = null
function getClient() {
  if (!_client) {
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || 'sk-missing-key' })
  }
  return _client
}

function logError(context, err) {
  try {
    const logPath = path.join(__dirname, '../../logs/audit_log.jsonl')
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

async function describeImage(imagePath) {
  try {
    const buffer = fs.readFileSync(imagePath)
    const base64Data = buffer.toString('base64')
    const mediaType = detectMediaType(imagePath)

    const client = getClient()
    const response = await client.messages.create({
      model: VISION_MODEL,
      max_tokens: MAX_TOKENS,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType, data: base64Data },
          },
          {
            type: 'text',
            text: VISION_PROMPT,
          },
        ],
      }],
    })

    const description = response?.content?.[0]?.text || ''

    return {
      description,
      image_path: imagePath,
      described_at: new Date().toISOString(),
    }
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
  describeBatch,
  detectMediaType,
  VISION_MODEL,
  VISION_PROMPT,
}
