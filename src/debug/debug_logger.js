const debugBus = require('./debug_bus')

const PRICING = {
  'claude-haiku-4-5-20251001': { input: 0.80,  output: 4.00,  cacheRead: 0.08 },
  'claude-sonnet-4-6':         { input: 3.00,  output: 15.00, cacheRead: 0.30 },
}

function calcCost(model, tokensIn, tokensOut, tokensCached) {
  const p = PRICING[model] || PRICING['claude-sonnet-4-6']
  const billable = Math.max(0, tokensIn - tokensCached)
  return (billable      * p.input     / 1_000_000)
       + (tokensCached  * p.cacheRead / 1_000_000)
       + (tokensOut     * p.output    / 1_000_000)
}

const session = {
  startedAt:     new Date().toISOString(),
  callCount:     0,
  haikuIn:       0,
  haikuOut:      0,
  haikuCached:   0,
  sonnetIn:      0,
  sonnetOut:     0,
  totalCostUsd:  0,
}

const MAX_LOG = 200
const ring = []

function pushLog(entry) {
  if (ring.length >= MAX_LOG) ring.shift()
  ring.push(entry)
  debugBus.emit('log', entry)
}

async function tracked({ type = 'ingest', file = '', call = '', model = 'claude-sonnet-4-6', apiFn }) {
  const t0 = Date.now()
  let response, error = null
  try {
    response = await apiFn()
  } catch (err) {
    error = err.message || String(err)
    pushLog({ id: uid(), type: 'error', file, model, call, tokensIn: 0, tokensOut: 0, tokensCached: 0, costUsd: 0, durationMs: Date.now() - t0, timestamp: new Date().toISOString(), error })
    throw err
  }
  const usage        = response?.usage || {}
  const tokensIn     = usage.input_tokens              || 0
  const tokensOut    = usage.output_tokens             || 0
  const tokensCached = usage.cache_read_input_tokens   || 0
  const costUsd      = calcCost(model, tokensIn, tokensOut, tokensCached)
  const durationMs   = Date.now() - t0
  session.callCount++
  session.totalCostUsd += costUsd
  if (model.includes('haiku')) {
    session.haikuIn     += tokensIn
    session.haikuOut    += tokensOut
    session.haikuCached += tokensCached
  } else {
    session.sonnetIn  += tokensIn
    session.sonnetOut += tokensOut
  }
  pushLog({ id: uid(), type, file, model, call, tokensIn, tokensOut, tokensCached, costUsd: round5(costUsd), durationMs, timestamp: new Date().toISOString(), error: null })
  return response
}

function log(type, file, call, extra = {}) {
  pushLog({ id: uid(), type, file, model: null, call, tokensIn: 0, tokensOut: 0, tokensCached: 0, costUsd: 0, durationMs: 0, timestamp: new Date().toISOString(), error: null, ...extra })
}

function getSessionSummary() {
  const fullCost   = calcCost('claude-haiku-4-5-20251001', session.haikuCached, 0, 0)
  const cachedCost = calcCost('claude-haiku-4-5-20251001', session.haikuCached, 0, session.haikuCached)
  return {
    startedAt:       session.startedAt,
    callCount:       session.callCount,
    haikuIn:         session.haikuIn,
    haikuOut:        session.haikuOut,
    haikuCached:     session.haikuCached,
    sonnetIn:        session.sonnetIn,
    sonnetOut:       session.sonnetOut,
    totalTokens:     session.haikuIn + session.haikuOut + session.sonnetIn + session.sonnetOut,
    totalCostUsd:    round5(session.totalCostUsd),
    cacheSavingsUsd: round5(Math.max(0, fullCost - cachedCost)),
  }
}

function getRecentLogs(limit = 50) {
  return ring.slice(-Math.min(limit, MAX_LOG))
}

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
}

function round5(n) {
  return Math.round(n * 100000) / 100000
}

module.exports = { tracked, log, getSessionSummary, getRecentLogs }
