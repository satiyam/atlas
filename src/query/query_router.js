const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const graphStore = require('../graph/graph_store')

const AUDIT_LOG = path.join(__dirname, '../../logs/audit_log.jsonl')

const REFUSE_KEYWORDS = [
  'salary', 'compensation', 'bonus', 'pay band',
  'medical', 'health record', 'disability',
  'disciplinary', 'termination', 'performance review',
  'pip', 'probation', 'grievance', 'misconduct',
  'personal performance', 'private comms',
  'private communication', 'private message',
]

const SYNTHESIS_KEYWORDS = [
  'generate', 'create', 'draft', 'produce',
  'podcast', 'handover', 'project brief',
  'decision log', 'benchmark report',
]

const COMBINED_KEYWORDS = [
  'compare', 'benchmark', 'industry standard',
  'best practice', 'best practices', 'how do others',
  'versus industry',
]

const INTERNAL_KEYWORDS = [
  'who', 'what', 'when', 'find', 'show', 'list',
  'decided', 'agreed', 'which project',
]

const STOPWORDS = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'and', 'or', 'of', 'in', 'on', 'at', 'to', 'for', 'with', 'about', 'by', 'this', 'that', 'these', 'those', 'who', 'what', 'when', 'where', 'why', 'how', 'which', 'it', 'its', 'as', 'be', 'been', 'do', 'did', 'does', 'our'])

function classifyQuery(query) {
  if (!query || typeof query !== 'string') return 'INTERNAL'
  const q = query.toLowerCase()

  if (REFUSE_KEYWORDS.some(k => q.includes(k))) return 'REFUSE'

  if (SYNTHESIS_KEYWORDS.some(k => q.includes(k))) return 'SYNTHESIS'

  if (COMBINED_KEYWORDS.some(k => q.includes(k))) return 'COMBINED'

  if (INTERNAL_KEYWORDS.some(k => q.includes(k))) return 'INTERNAL'

  return 'EXTERNAL'
}

function extractKeywords(query) {
  return (query || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(w => w && w.length > 2 && !STOPWORDS.has(w))
}

function graphRetriever(query) {
  const keywords = extractKeywords(query)
  if (keywords.length === 0) return { nodes: [], keywords, total_searched: 0 }

  const allNodes = Object.values(graphStore.readNodes())
  const scored = allNodes.map(node => {
    const hay = JSON.stringify(node).toLowerCase()
    const matches = keywords.filter(k => hay.includes(k)).length
    return { node, score: matches / keywords.length }
  }).filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)

  return {
    nodes: scored.map(s => s.node),
    scores: scored.map(s => s.score),
    keywords,
    total_searched: allNodes.length,
  }
}

async function gensparkRetriever(query) {
  const retrievedAt = new Date().toISOString()
  const apiKey = process.env.GENSPARK_API_KEY

  if (apiKey) {
    try {
      const response = await fetch('https://api.genspark.ai/v1/search', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query, format: 'structured', citations: true }),
      })
      if (response.ok) {
        const data = await response.json()
        return {
          findings: data.findings || data.results || [],
          sources: data.sources || data.citations || [],
          retrieved_at: retrievedAt,
          provider: 'genspark',
        }
      }
    } catch (_) { /* fall through to Claude fallback */ }
  }

  try {
    const Anthropic = require('@anthropic-ai/sdk')
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || 'sk-missing' })
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{
        role: 'user',
        content: `Research this question and return findings with source citations: "${query}"`,
      }],
    })

    const findings = []
    const sources = []
    for (const block of response?.content || []) {
      if (block.type === 'text') {
        findings.push({ text: block.text })
      }
      if (block.type === 'tool_use' && block.name === 'web_search') {
        sources.push({ title: block.input?.query || 'web search', url: '' })
      }
      if (block.type === 'web_search_tool_result') {
        for (const result of block.content || []) {
          if (result.type === 'web_search_result') {
            sources.push({ title: result.title || '', url: result.url || '' })
          }
        }
      }
    }

    return { findings, sources, retrieved_at: retrievedAt, provider: 'claude_web_search' }
  } catch (err) {
    return { findings: [], sources: [], retrieved_at: retrievedAt, provider: 'unavailable', error: err.message }
  }
}

function logRefusal(query, reason) {
  const hash = crypto.createHash('sha256').update(query).digest('hex')
  const event = {
    timestamp: new Date().toISOString(),
    query_hash: hash,
    reason,
    classification: 'REFUSE',
  }
  try {
    const dir = path.dirname(AUDIT_LOG)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.appendFileSync(AUDIT_LOG, JSON.stringify(event) + '\n', 'utf8')
  } catch (_) {}
  return event
}

async function routeQuery(query) {
  const classification = classifyQuery(query)

  if (classification === 'REFUSE') {
    logRefusal(query, 'policy violation')
    const hash = crypto.createHash('sha256').update(query).digest('hex').slice(0, 16)
    return {
      classification,
      refused: true,
      refusal_message:
        `I'm not able to retrieve that information. Atlas governance rules classify this content ` +
        `as sensitive under the RED data policy (salary, medical, disciplinary, or private information).\n\n` +
        `If you believe this restriction is incorrect, contact your Atlas administrator.\n` +
        `Refusal logged: ${new Date().toISOString()} | Query ID: ${hash}`,
      nodes: [],
      genspark: null,
    }
  }

  if (classification === 'SYNTHESIS') {
    return {
      classification,
      synthesis_topic: query,
      nodes: [],
      genspark: null,
    }
  }

  if (classification === 'INTERNAL') {
    const graphResult = graphRetriever(query)
    return {
      classification,
      nodes: graphResult.nodes,
      keywords: graphResult.keywords,
      total_searched: graphResult.total_searched,
      genspark: null,
    }
  }

  if (classification === 'EXTERNAL') {
    const genspark = await gensparkRetriever(query)
    return {
      classification,
      nodes: [],
      genspark,
    }
  }

  // COMBINED
  const [graphResult, genspark] = await Promise.all([
    Promise.resolve(graphRetriever(query)),
    gensparkRetriever(query),
  ])
  return {
    classification,
    nodes: graphResult.nodes,
    keywords: graphResult.keywords,
    total_searched: graphResult.total_searched,
    genspark,
  }
}

module.exports = {
  classifyQuery,
  graphRetriever,
  gensparkRetriever,
  routeQuery,
  logRefusal,
  extractKeywords,
}
