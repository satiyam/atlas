const PROCESSING_RATES_SECONDS_PER_MB = {
  '.txt':  0.2,
  '.vtt':  0.2,
  '.srt':  0.2,
  '.csv':  0.2,
  '.md':   0.2,
  '.eml':  0.35,
  '.msg':  0.35,
  '.docx': 0.8,
  '.pdf':  1.2,
  '.pptx': 1.0,
  '.xlsx': 0.5,
  '.png':  1.5,
  '.jpg':  1.5,
  '.jpeg': 1.5,
}

const AUDIO_EXTENSIONS = new Set(['.mp3', '.m4a', '.wav'])
const VIDEO_EXTENSIONS = new Set(['.mp4'])
const AUDIO_PROCESSING_RATE_PER_SEC = 0.18
const VIDEO_PROCESSING_RATE_PER_SEC = 0.25
const AUDIO_MINUTES_PER_MB = 1.0
const VIDEO_MINUTES_PER_MB = 0.5
const OVERHEAD_MULTIPLIER = 1.55
const GRAPH_COMMIT_SECONDS = 300
const WHISPER_COST_PER_MINUTE = 0.003

const DOCUMENT_NODES_PER_FILE = 3
const DOCUMENT_EDGES_PER_FILE = 4
const AUDIO_VIDEO_NODES_PER_FILE = 5
const AUDIO_VIDEO_EDGES_PER_FILE = 8
const IMAGE_NODES_PER_FILE = 1
const IMAGE_EDGES_PER_FILE = 2

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg'])

function isAudio(ext) { return AUDIO_EXTENSIONS.has(ext) }
function isVideo(ext) { return VIDEO_EXTENSIONS.has(ext) }
function isImage(ext) { return IMAGE_EXTENSIONS.has(ext) }
function isAudioOrVideo(ext) { return isAudio(ext) || isVideo(ext) }

function fileSizeMb(file) {
  if (typeof file.size_mb === 'number') return file.size_mb
  if (typeof file.size_bytes === 'number') return file.size_bytes / 1024 / 1024
  return 0
}

function humanDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0s'
  const whole = Math.round(seconds)
  if (whole < 60) return `~${whole}s`
  const hours = Math.floor(whole / 3600)
  const minutes = Math.floor((whole % 3600) / 60)
  if (hours > 0) return `~${hours}hr ${minutes}min`
  return `~${minutes}min`
}

function estimateTime(files) {
  const breakdown = {}
  let rawParsingSeconds = 0

  for (const f of files) {
    const ext = (f.extension || '').toLowerCase()
    const sizeMb = fileSizeMb(f)
    let seconds = 0

    if (isAudio(ext)) {
      const minutes = sizeMb * AUDIO_MINUTES_PER_MB
      seconds = minutes * 60 * AUDIO_PROCESSING_RATE_PER_SEC
    } else if (isVideo(ext)) {
      const minutes = sizeMb * VIDEO_MINUTES_PER_MB
      seconds = minutes * 60 * VIDEO_PROCESSING_RATE_PER_SEC
    } else if (PROCESSING_RATES_SECONDS_PER_MB[ext] !== undefined) {
      seconds = sizeMb * PROCESSING_RATES_SECONDS_PER_MB[ext]
    } else {
      seconds = sizeMb * 1.0
    }

    rawParsingSeconds += seconds
    if (!breakdown[ext]) breakdown[ext] = { count: 0, seconds: 0 }
    breakdown[ext].count++
    breakdown[ext].seconds += seconds
  }

  for (const key of Object.keys(breakdown)) {
    breakdown[key].seconds = Math.round(breakdown[key].seconds * 100) / 100
  }

  const total_seconds = Math.round(rawParsingSeconds * OVERHEAD_MULTIPLIER + GRAPH_COMMIT_SECONDS)

  return {
    total_seconds,
    raw_parsing_seconds: Math.round(rawParsingSeconds),
    overhead_multiplier: OVERHEAD_MULTIPLIER,
    graph_commit_seconds: GRAPH_COMMIT_SECONDS,
    human: humanDuration(total_seconds),
    breakdown,
  }
}

function estimateCost(files) {
  const breakdown = {}
  let total = 0

  for (const f of files) {
    const ext = (f.extension || '').toLowerCase()
    const sizeMb = fileSizeMb(f)
    let minutes = 0

    if (isAudio(ext)) minutes = sizeMb * AUDIO_MINUTES_PER_MB
    else if (isVideo(ext)) minutes = sizeMb * VIDEO_MINUTES_PER_MB
    else continue

    const cost = minutes * WHISPER_COST_PER_MINUTE
    total += cost

    if (!breakdown[ext]) breakdown[ext] = { count: 0, minutes: 0, usd: 0 }
    breakdown[ext].count++
    breakdown[ext].minutes += minutes
    breakdown[ext].usd += cost
  }

  for (const key of Object.keys(breakdown)) {
    breakdown[key].minutes = Math.round(breakdown[key].minutes * 10) / 10
    breakdown[key].usd = Math.round(breakdown[key].usd * 10000) / 10000
  }

  return {
    total_usd: Math.round(total * 10000) / 10000,
    whisper_rate_per_minute: WHISPER_COST_PER_MINUTE,
    breakdown_by_type: breakdown,
  }
}

function estimateGraphSize(files) {
  let minNodes = 0
  let maxNodes = 0
  let minEdges = 0
  let maxEdges = 0

  for (const f of files) {
    const ext = (f.extension || '').toLowerCase()
    if (isAudioOrVideo(ext)) {
      minNodes += Math.max(1, AUDIO_VIDEO_NODES_PER_FILE - 2)
      maxNodes += AUDIO_VIDEO_NODES_PER_FILE + 2
      minEdges += Math.max(1, AUDIO_VIDEO_EDGES_PER_FILE - 3)
      maxEdges += AUDIO_VIDEO_EDGES_PER_FILE + 3
    } else if (isImage(ext)) {
      minNodes += IMAGE_NODES_PER_FILE
      maxNodes += IMAGE_NODES_PER_FILE + 1
      minEdges += IMAGE_EDGES_PER_FILE
      maxEdges += IMAGE_EDGES_PER_FILE + 2
    } else {
      minNodes += Math.max(1, DOCUMENT_NODES_PER_FILE - 1)
      maxNodes += DOCUMENT_NODES_PER_FILE + 2
      minEdges += Math.max(1, DOCUMENT_EDGES_PER_FILE - 1)
      maxEdges += DOCUMENT_EDGES_PER_FILE + 2
    }
  }

  return { min_nodes: minNodes, max_nodes: maxNodes, min_edges: minEdges, max_edges: maxEdges }
}

function groupByExtension(files) {
  const groups = {}
  for (const f of files) {
    const ext = (f.extension || 'unknown').toLowerCase()
    if (!groups[ext]) groups[ext] = { count: 0, total_size_bytes: 0, total_size_mb: 0 }
    groups[ext].count++
    groups[ext].total_size_bytes += f.size_bytes || 0
  }
  for (const key of Object.keys(groups)) {
    groups[key].total_size_mb = Math.round(groups[key].total_size_bytes / 1024 / 1024 * 10) / 10
  }
  return groups
}

function buildWarnings(crawlResults) {
  const warnings = []
  const oversized = crawlResults.unsupported?.filter(f => f.reason === 'above_max_size') || []
  const undersized = crawlResults.unsupported?.filter(f => f.reason === 'below_min_size') || []
  const noExt = crawlResults.unsupported?.filter(f => f.reason === 'no_extension') || []
  const permissionErrors = crawlResults.errors?.filter(e => /permission|EACCES|EPERM/i.test(e.error || '')) || []

  if (oversized.length > 0) {
    warnings.push({ type: 'oversized_files', count: oversized.length, message: `${oversized.length} file(s) exceed the 500MB limit and will be skipped.` })
  }
  if (undersized.length > 0) {
    warnings.push({ type: 'undersized_files', count: undersized.length, message: `${undersized.length} file(s) are below the 100-byte noise threshold and will be skipped.` })
  }
  if (noExt.length > 0) {
    warnings.push({ type: 'no_extension', count: noExt.length, message: `${noExt.length} file(s) have no extension and will be skipped.` })
  }
  if (permissionErrors.length > 0) {
    warnings.push({ type: 'permission_denied', count: permissionErrors.length, message: `${permissionErrors.length} path(s) could not be read due to permission errors.` })
  }
  if ((crawlResults.flagged || []).length > 0) {
    warnings.push({ type: 'sensitive_filenames', count: crawlResults.flagged.length, message: `${crawlResults.flagged.length} file(s) have sensitive filename patterns and require "You Decide" review.` })
  }
  return warnings
}

function generateReport(crawlResults, rootPath = null) {
  const startedAt = Date.now()
  const changed = crawlResults.changed || []

  const report = {
    scanned_at: new Date().toISOString(),
    root_path: rootPath ?? null,
    scan_duration_ms: crawlResults.summary?.scan_duration_ms ?? 0,
    file_breakdown: groupByExtension(changed),
    skipped_files: crawlResults.unsupported || [],
    flagged_files: crawlResults.flagged || [],
    time_estimate: estimateTime(changed),
    cost_estimate: estimateCost(changed),
    graph_estimate: estimateGraphSize(changed),
    warnings: buildWarnings(crawlResults),
    summary: {
      total_supported: crawlResults.summary?.total_supported ?? changed.length,
      total_changed: changed.length,
      total_skipped: (crawlResults.unsupported || []).length,
      total_flagged: (crawlResults.flagged || []).length,
      total_size_bytes: crawlResults.summary?.total_size_bytes ?? 0,
    },
  }

  report.report_generation_ms = Date.now() - startedAt
  return report
}

async function dryRun(crawlResults, rootPath = null) {
  return generateReport(crawlResults, rootPath)
}

function formatReport(report) {
  const lines = []
  const divider = '─'.repeat(66)

  lines.push('╔' + '═'.repeat(66) + '╗')
  lines.push('║  🔍 ATLAS DRY RUN REPORT                                         ║')
  lines.push('╚' + '═'.repeat(66) + '╝')
  lines.push('')
  lines.push(`Scanned at:     ${report.scanned_at}`)
  if (report.root_path) lines.push(`Root path:      ${report.root_path}`)
  lines.push(`Scan duration:  ${report.scan_duration_ms}ms`)
  lines.push('')

  lines.push(divider)
  lines.push('FILES DISCOVERED')
  lines.push(divider)
  const bd = report.file_breakdown || {}
  const extsSorted = Object.keys(bd).sort()
  if (extsSorted.length === 0) {
    lines.push('  (no supported files found)')
  } else {
    for (const ext of extsSorted) {
      const info = bd[ext]
      const extStr = ext.padEnd(8)
      const countStr = String(info.count).padStart(5)
      const sizeStr = `${info.total_size_mb} MB`.padStart(10)
      lines.push(`  ${extStr} ${countStr} files  ${sizeStr}`)
    }
  }
  lines.push('')
  lines.push(`  Supported:  ${report.summary.total_supported} files`)
  lines.push(`  Skipped:    ${report.summary.total_skipped} files`)
  lines.push(`  Flagged:    ${report.summary.total_flagged} files (You Decide review required)`)
  lines.push(`  Total size: ${(report.summary.total_size_bytes / 1024 / 1024).toFixed(1)} MB`)
  lines.push('')

  lines.push(divider)
  lines.push('TIME ESTIMATE')
  lines.push(divider)
  lines.push(`  Raw parsing time:      ${report.time_estimate.raw_parsing_seconds}s`)
  lines.push(`  Overhead multiplier:   × ${report.time_estimate.overhead_multiplier}`)
  lines.push(`  Graph commit:          + ${report.time_estimate.graph_commit_seconds}s`)
  lines.push(`  ⏱  Total: ${report.time_estimate.total_seconds}s  (${report.time_estimate.human})`)
  lines.push('')

  lines.push(divider)
  lines.push('COST ESTIMATE (Whisper API)')
  lines.push(divider)
  const costBreakdown = report.cost_estimate.breakdown_by_type
  if (Object.keys(costBreakdown).length === 0) {
    lines.push('  No audio or video files — $0.00')
  } else {
    for (const [ext, info] of Object.entries(costBreakdown)) {
      lines.push(`  ${ext.padEnd(8)} ${String(info.count).padStart(4)} files  ${String(info.minutes).padStart(8)} min  $${info.usd.toFixed(4)}`)
    }
    lines.push('')
    lines.push(`  💵 Total: $${report.cost_estimate.total_usd.toFixed(4)}`)
  }
  lines.push('')

  lines.push(divider)
  lines.push('KNOWLEDGE GRAPH ESTIMATE')
  lines.push(divider)
  const g = report.graph_estimate
  lines.push(`  Nodes:        ${g.min_nodes.toLocaleString()} – ${g.max_nodes.toLocaleString()}`)
  lines.push(`  Edges:        ${g.min_edges.toLocaleString()} – ${g.max_edges.toLocaleString()}`)
  lines.push('')

  if (report.flagged_files && report.flagged_files.length > 0) {
    lines.push(divider)
    lines.push('⚠  FILES REQUIRING YOUR DECISION')
    lines.push(divider)
    lines.push('  Filename suggests sensitive content. Default: Skip')
    lines.push('')
    for (const f of report.flagged_files.slice(0, 20)) {
      const sizeKb = Math.round((f.size_bytes || 0) / 1024)
      lines.push(`  • ${f.filename}  (${sizeKb}KB)  pattern=${f.matched_pattern}`)
    }
    if (report.flagged_files.length > 20) {
      lines.push(`  ... and ${report.flagged_files.length - 20} more`)
    }
    lines.push('')
    lines.push('  ℹ  Files set to Allow still pass through PII Redactor.')
    lines.push('     Content classified RED will be blocked automatically.')
    lines.push('')
  }

  if (report.warnings && report.warnings.length > 0) {
    lines.push(divider)
    lines.push('WARNINGS')
    lines.push(divider)
    for (const w of report.warnings) {
      lines.push(`  ⚠  [${w.type}] ${w.message}`)
    }
    lines.push('')
  }

  lines.push(divider)
  lines.push('No files were processed. No graph data was written.')
  lines.push(divider)

  return lines.join('\n')
}

module.exports = {
  dryRun,
  estimateTime,
  estimateCost,
  estimateGraphSize,
  generateReport,
  formatReport,
  humanDuration,
}
