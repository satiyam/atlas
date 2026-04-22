const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { v4: uuidv4 } = require('uuid')

const AUDIT_LOG_PATH = path.join(__dirname, '../../logs/audit_log.jsonl')
const NODES_PATH = path.join(__dirname, '../../graph/nodes.json')
const EDGES_PATH = path.join(__dirname, '../../graph/edges.json')
const CONFIG_PATH = path.join(__dirname, '../../config/ingestion_config.json')

const RED_QUERY_PATTERNS = [
  /\bsalar(y|ies)\b/i, /\bcompensation\b/i, /\bbonus(es)?\b/i,
  /\bpay\s?band\b/i, /\bremuneration\b/i,
  /\bmedical\s?record\b/i, /\bhealth\s?record\b/i, /\bdisabilit/i,
  /\bperformance\s?review\b/i, /\bpip\s?score\b/i, /\bprobation\b/i,
  /\bdisciplinar/i, /\bgrievance\b/i, /\bhr\s?investigation\b/i,
  /\btermination\b/i, /\bredundanc/i, /\bmisconduct\b/i,
  /\bnric\b/i, /\bbank\s?account\b/i, /\binsurance\s?claim\b/i,
]

const SYNTHESIS_KEYWORDS = [
  /\bproduce\s+(a\s+)?podcast\b/i,
  /\bgenerate\s+(a\s+)?podcast\b/i,
  /\bsynthesize\s+(a\s+)?project\s+brief\b/i,
  /\bsynthesize\s+(a\s+)?brief\b/i,
  /\bdraft\s+(a\s+)?handover\b/i,
  /\bgenerate\s+(a\s+)?handover\b/i,
  /\bcreate\s+(a\s+)?decision\s+log\b/i,
  /\bgenerate\s+(a\s+)?benchmark\s+report\b/i,
  /\bgenerate\s+(an\s+)?onboarding\s+guide\b/i,
]

const EXTERNAL_KEYWORDS = [
  /\bindustry\s+standard\b/i, /\bbenchmark\b/i, /\bcompetitor\b/i,
  /\bbest\s+practice\b/i, /\bmarket\b/i, /\btrend\b/i,
  /\baccording\s+to\b/i, /\bexternal\b/i, /\bworld\s+wide\b/i,
]

const INTERNAL_KEYWORDS = [
  /\bour\b/i, /\bteam\b/i, /\bwe\b/i, /\bus\b/i,
  /\bproject\b/i, /\bdecision\b/i, /\bmeeting\b/i,
]

function hashQuery(query) {
  return crypto.createHash('sha256').update(query, 'utf8').digest('hex').slice(0, 16)
}

function logAudit(event) {
  const line = JSON.stringify({ ...event, timestamp: new Date().toISOString() }) + '\n'
  try {
    fs.appendFileSync(AUDIT_LOG_PATH, line, 'utf8')
  } catch (_) {}
}

function logRefusal(query, reason) {
  logAudit({
    event: 'QUERY_REFUSED',
    query_hash: hashQuery(query),
    classification_reason: reason,
    governance_rule: 'RED trigger in query',
  })
}

function classifyQuery(query) {
  for (const pattern of RED_QUERY_PATTERNS) {
    if (pattern.test(query)) {
      return { type: 'REFUSE', reason: `Query seeks RED-classified information: ${pattern}` }
    }
  }

  for (const pattern of SYNTHESIS_KEYWORDS) {
    if (pattern.test(query)) return { type: 'SYNTHESIS' }
  }

  const hasInternal = INTERNAL_KEYWORDS.some(p => p.test(query))
  const hasExternal = EXTERNAL_KEYWORDS.some(p => p.test(query))

  if (hasInternal && hasExternal) return { type: 'COMBINED' }
  if (hasExternal && !hasInternal) return { type: 'EXTERNAL' }
  return { type: 'INTERNAL' }
}

function graphRetriever(query) {
  let nodes = []
  let edges = []

  try {
    nodes = JSON.parse(fs.readFileSync(NODES_PATH, 'utf8'))
    edges = JSON.parse(fs.readFileSync(EDGES_PATH, 'utf8'))
  } catch (_) {
    return { results: [], sources: [], confidence: 0 }
  }

  const queryTerms = query.toLowerCase().split(/\s+/).filter(w => w.length > 3)

  const scored = nodes.map(node => {
    const nodeText = JSON.stringify(node.data).toLowerCase()
    const matches = queryTerms.filter(term => nodeText.includes(term)).length
    const score = queryTerms.length > 0 ? matches / queryTerms.length : 0
    return { node, score }
  }).filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 20)

  const topNodeIds = new Set(scored.map(({ node }) => node.id))

  const connectedNodeIds = new Set()
  for (const edge of edges) {
    if (topNodeIds.has(edge.from_id)) connectedNodeIds.add(edge.to_id)
    if (topNodeIds.has(edge.to_id)) connectedNodeIds.add(edge.from_id)
  }

  const expanded = nodes.filter(n => connectedNodeIds.has(n.id) && !topNodeIds.has(n.id)).slice(0, 10)

  const allResults = [...scored.map(s => s.node), ...expanded]
  const maxScore = scored[0]?.score || 0
  const confidence = Math.min(maxScore, 1.0)

  const fileSources = nodes.filter(n => n.type === 'FILE_SOURCE' && n.data.ingestion_status === 'complete')
  const sourcesMap = {}
  for (const node of allResults) {
    const srcFile = node.data.source_file
    if (srcFile && !sourcesMap[srcFile]) {
      const src = fileSources.find(fs => fs.data.path === srcFile)
      if (src) sourcesMap[srcFile] = src.data
    }
  }

  return {
    results: allResults,
    sources: Object.values(sourcesMap),
    confidence,
  }
}

async function gensparkRetriever(query) {
  try {
    const apiKey = process.env.GENSPARK_API_KEY
    if (!apiKey) throw new Error('GENSPARK_API_KEY not configured')

    const response = await fetch('https://api.genspark.ai/v1/search', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, max_results: 5 }),
    })

    if (!response.ok) throw new Error(`Genspark API error: ${response.status}`)
    const data = await response.json()
    return { result: data, source: 'genspark', retrieved_at: new Date().toISOString() }
  } catch (err) {
    return { result: null, source: 'unavailable', error: err.message, retrieved_at: new Date().toISOString() }
  }
}

async function routeQuery(query) {
  const classification = classifyQuery(query)

  if (classification.type === 'REFUSE') {
    logRefusal(query, classification.reason)
    return {
      classification: 'REFUSE',
      query,
      internal_results: null,
      external_results: null,
      refused: true,
      refusal_reason: classification.reason,
      sources: [],
      confidence: 0,
      refusal_message: `I'm not able to retrieve that information. Atlas governance rules classify this content as sensitive.\n\nIf you believe this restriction is incorrect, contact your Atlas administrator.\nRefusal logged: ${new Date().toISOString()} | Query hash: ${hashQuery(query)}`,
    }
  }

  if (classification.type === 'SYNTHESIS') {
    return { classification: 'SYNTHESIS', query, internal_results: null, external_results: null, refused: false, refusal_reason: null, sources: [], confidence: 1.0 }
  }

  let internalResults = null
  let externalResults = null

  if (classification.type === 'INTERNAL' || classification.type === 'COMBINED') {
    internalResults = graphRetriever(query)
    if (internalResults.confidence < 0.4 && classification.type === 'INTERNAL') {
      classification.type = 'COMBINED'
    }
  }

  if (classification.type === 'EXTERNAL' || classification.type === 'COMBINED') {
    externalResults = await gensparkRetriever(query)
  }

  return {
    classification: classification.type,
    query,
    internal_results: internalResults,
    external_results: externalResults,
    refused: false,
    refusal_reason: null,
    sources: internalResults?.sources || [],
    confidence: internalResults?.confidence || 0,
  }
}

module.exports = { classifyQuery, routeQuery, graphRetriever, gensparkRetriever, logRefusal }
