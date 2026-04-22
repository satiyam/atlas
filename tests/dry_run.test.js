const {
  estimateTime,
  estimateCost,
  estimateGraphSize,
  generateReport,
  formatReport,
  humanDuration,
  dryRun,
} = require('../src/ingestion/dry_run')

function makeFile(extension, sizeMb, filename = `sample${extension}`) {
  return {
    filename,
    path: `/test/${filename}`,
    extension,
    size_bytes: Math.round(sizeMb * 1024 * 1024),
    size_mb: sizeMb,
    last_modified: new Date().toISOString(),
    checksum: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  }
}

function fakeCrawlResults({ changed = [], unsupported = [], flagged = [], errors = [] } = {}) {
  return {
    changed,
    unchanged: [],
    unsupported,
    flagged,
    errors,
    summary: {
      total_found: changed.length + unsupported.length,
      total_supported: changed.length,
      total_changed: changed.length,
      total_flagged: flagged.length,
      total_skipped: unsupported.length,
      scan_duration_ms: 42,
      total_size_bytes: changed.reduce((s, f) => s + (f.size_bytes || 0), 0),
    },
  }
}

describe('estimateTime', () => {
  test('returns total_seconds as a positive number with graph commit overhead', () => {
    const files = [makeFile('.docx', 5), makeFile('.pdf', 3)]
    const result = estimateTime(files)
    expect(typeof result.total_seconds).toBe('number')
    expect(result.total_seconds).toBeGreaterThan(300)
    expect(result.graph_commit_seconds).toBe(300)
    expect(result.overhead_multiplier).toBe(1.55)
  })

  test('breakdown groups seconds by extension', () => {
    const files = [makeFile('.docx', 2), makeFile('.docx', 3), makeFile('.pdf', 4)]
    const result = estimateTime(files)
    expect(result.breakdown['.docx'].count).toBe(2)
    expect(result.breakdown['.pdf'].count).toBe(1)
    expect(result.breakdown['.docx'].seconds).toBeGreaterThan(0)
  })

  test('audio file uses size_mb × 1.0 minutes × 0.18 s/s formula', () => {
    const result = estimateTime([makeFile('.mp3', 10)])
    const rawExpected = 10 * 1.0 * 60 * 0.18
    const expectedTotal = Math.round(rawExpected * 1.55 + 300)
    expect(result.total_seconds).toBe(expectedTotal)
  })

  test('video file uses size_mb × 0.5 minutes × 0.25 s/s formula', () => {
    const result = estimateTime([makeFile('.mp4', 20)])
    const rawExpected = 20 * 0.5 * 60 * 0.25
    const expectedTotal = Math.round(rawExpected * 1.55 + 300)
    expect(result.total_seconds).toBe(expectedTotal)
  })

  test('empty input still returns graph_commit_seconds baseline', () => {
    const result = estimateTime([])
    expect(result.total_seconds).toBe(300)
  })

  test('human duration formats correctly', () => {
    expect(humanDuration(45)).toBe('~45s')
    expect(humanDuration(180)).toBe('~3min')
    expect(humanDuration(3720)).toBe('~1hr 2min')
  })
})

describe('estimateCost', () => {
  test('returns 0 when no audio or video files present', () => {
    const files = [makeFile('.docx', 10), makeFile('.pdf', 20), makeFile('.txt', 5)]
    const result = estimateCost(files)
    expect(result.total_usd).toBe(0)
    expect(Object.keys(result.breakdown_by_type).length).toBe(0)
  })

  test('computes mp3 cost at size_mb × 1.0 min × $0.003', () => {
    const result = estimateCost([makeFile('.mp3', 60)])
    expect(result.total_usd).toBeCloseTo(0.18, 4)
    expect(result.breakdown_by_type['.mp3'].count).toBe(1)
  })

  test('computes mp4 cost at size_mb × 0.5 min × $0.003', () => {
    const result = estimateCost([makeFile('.mp4', 100)])
    expect(result.total_usd).toBeCloseTo(0.15, 4)
  })

  test('sums across multiple audio/video extensions', () => {
    const files = [makeFile('.mp3', 10), makeFile('.m4a', 5), makeFile('.wav', 3), makeFile('.mp4', 20)]
    const result = estimateCost(files)
    const expected = (10 * 1.0 + 5 * 1.0 + 3 * 1.0 + 20 * 0.5) * 0.003
    expect(result.total_usd).toBeCloseTo(expected, 4)
  })
})

describe('estimateGraphSize', () => {
  test('min_nodes < max_nodes for any non-empty file set', () => {
    const files = [makeFile('.docx', 2), makeFile('.pdf', 3), makeFile('.mp3', 5)]
    const result = estimateGraphSize(files)
    expect(result.min_nodes).toBeLessThan(result.max_nodes)
    expect(result.min_edges).toBeLessThan(result.max_edges)
  })

  test('audio/video files produce richer graph than documents', () => {
    const audioResult = estimateGraphSize([makeFile('.mp3', 1)])
    const docResult = estimateGraphSize([makeFile('.docx', 1)])
    expect(audioResult.max_nodes).toBeGreaterThan(docResult.max_nodes)
  })

  test('images produce smaller graph than documents', () => {
    const imgResult = estimateGraphSize([makeFile('.png', 1)])
    const docResult = estimateGraphSize([makeFile('.docx', 1)])
    expect(imgResult.max_nodes).toBeLessThanOrEqual(docResult.max_nodes)
  })

  test('empty input returns zero nodes and zero edges', () => {
    const result = estimateGraphSize([])
    expect(result.min_nodes).toBe(0)
    expect(result.max_nodes).toBe(0)
    expect(result.min_edges).toBe(0)
    expect(result.max_edges).toBe(0)
  })
})

describe('generateReport', () => {
  test('returns a report with all required top-level fields', () => {
    const crawlResults = fakeCrawlResults({
      changed: [makeFile('.docx', 1), makeFile('.pdf', 2), makeFile('.mp3', 10)],
      unsupported: [{ filename: 'x.zip', reason: 'unsupported_extension', extension: '.zip', size_bytes: 1024 }],
      flagged: [{ filename: 'payroll.xlsx', path: '/test/payroll.xlsx', size_bytes: 2048, matched_pattern: '/payroll/i' }],
    })

    const report = generateReport(crawlResults, '/test/root')

    expect(report).toHaveProperty('scanned_at')
    expect(report).toHaveProperty('root_path', '/test/root')
    expect(report).toHaveProperty('scan_duration_ms')
    expect(report).toHaveProperty('file_breakdown')
    expect(report).toHaveProperty('skipped_files')
    expect(report).toHaveProperty('flagged_files')
    expect(report).toHaveProperty('time_estimate')
    expect(report).toHaveProperty('cost_estimate')
    expect(report).toHaveProperty('graph_estimate')
    expect(report).toHaveProperty('warnings')

    expect(report.time_estimate.total_seconds).toBeGreaterThan(0)
    expect(report.cost_estimate.total_usd).toBeGreaterThan(0)
    expect(report.graph_estimate.min_nodes).toBeLessThan(report.graph_estimate.max_nodes)
  })

  test('cost_estimate is 0 when crawl has no audio files', () => {
    const crawlResults = fakeCrawlResults({ changed: [makeFile('.docx', 5), makeFile('.txt', 2)] })
    const report = generateReport(crawlResults, '/test')
    expect(report.cost_estimate.total_usd).toBe(0)
  })

  test('surfaces warning for flagged files', () => {
    const crawlResults = fakeCrawlResults({
      changed: [makeFile('.docx', 1)],
      flagged: [{ filename: 'salary.xlsx', size_bytes: 1024, matched_pattern: '/salary/i' }],
    })
    const report = generateReport(crawlResults, '/test')
    const types = report.warnings.map(w => w.type)
    expect(types).toContain('sensitive_filenames')
  })

  test('surfaces warning for oversized files', () => {
    const crawlResults = fakeCrawlResults({
      changed: [makeFile('.docx', 1)],
      unsupported: [{ filename: 'huge.mp4', reason: 'above_max_size', size_bytes: 600 * 1024 * 1024 }],
    })
    const report = generateReport(crawlResults, '/test')
    const types = report.warnings.map(w => w.type)
    expect(types).toContain('oversized_files')
  })
})

describe('formatReport', () => {
  test('produces a non-empty, multi-line human-readable string', () => {
    const crawlResults = fakeCrawlResults({
      changed: [makeFile('.docx', 2), makeFile('.mp3', 5)],
      flagged: [{ filename: 'payroll.xlsx', size_bytes: 2048, matched_pattern: '/payroll/i' }],
    })
    const report = generateReport(crawlResults, '/tmp/atlas-sample')
    const text = formatReport(report)

    expect(typeof text).toBe('string')
    expect(text.length).toBeGreaterThan(200)
    expect(text).toContain('ATLAS DRY RUN REPORT')
    expect(text).toContain('TIME ESTIMATE')
    expect(text).toContain('COST ESTIMATE')
    expect(text).toContain('KNOWLEDGE GRAPH ESTIMATE')
  })
})

describe('dryRun (async wrapper)', () => {
  test('returns the same structure as generateReport', async () => {
    const crawlResults = fakeCrawlResults({ changed: [makeFile('.txt', 1)] })
    const report = await dryRun(crawlResults, '/test')
    expect(report).toHaveProperty('time_estimate')
    expect(report).toHaveProperty('cost_estimate')
    expect(report).toHaveProperty('graph_estimate')
  })
})
