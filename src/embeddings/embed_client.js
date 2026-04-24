const MODEL_NAME = 'Xenova/all-MiniLM-L6-v2'

let _pipelinePromise = null

async function getPipeline() {
  if (!_pipelinePromise) {
    _pipelinePromise = (async () => {
      const mod = await import('@xenova/transformers')
      mod.env.allowLocalModels = false
      const pipeline = await mod.pipeline('feature-extraction', MODEL_NAME)
      return pipeline
    })()
  }
  return _pipelinePromise
}

async function embed(text) {
  if (!text || typeof text !== 'string') return null
  const pipeline = await getPipeline()
  const output = await pipeline(text, { pooling: 'mean', normalize: true })
  return Array.from(output.data)
}

async function embedBatch(texts, concurrency = 4) {
  const results = new Array(texts.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(concurrency, texts.length) }, async () => {
    while (true) {
      const i = cursor++
      if (i >= texts.length) return
      try {
        results[i] = await embed(texts[i])
      } catch (_) {
        results[i] = null
      }
    }
  })
  await Promise.all(workers)
  return results
}

module.exports = { embed, embedBatch, MODEL_NAME, getPipeline }
