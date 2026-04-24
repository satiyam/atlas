import { useState, useRef, useEffect } from 'react'

const COLORS = {
  bg: '#0f1117',
  panel: '#1a1d27',
  accent: '#7c6af7',
  internal: '#3b82f6',
  external: '#10b981',
  text: '#e2e8f0',
  muted: '#64748b',
  border: '#2d3748',
  red: '#ef4444',
  yellow: '#f59e0b',
}

const API_BASE = typeof window !== 'undefined' && window.ATLAS_API_BASE
  ? window.ATLAS_API_BASE
  : ''

async function apiCall(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: options.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
  if (!response.ok) {
    let message = response.statusText
    try {
      const body = await response.json()
      if (body.error) message = body.error
    } catch (_) {
      try { message = await response.text() } catch (_) { /* keep statusText */ }
    }
    throw new Error(message)
  }
  return response.json()
}

const PANEL_STYLE = {
  background: COLORS.panel,
  border: `1px solid ${COLORS.border}`,
  borderRadius: 12,
  padding: 20,
  boxSizing: 'border-box',
}

function FolderWidget({ folderPath, setFolderPath, scanResults, scanError, scanning, dryRunning, onScan, onDryRun, onStartIngestion, ingesting, ingestionResult, watcherRunning, watcherPath, onStartWatcher, onStopWatcher }) {
  const folderRef = useRef(null)
  const [browseHint, setBrowseHint] = useState(null)

  const handleFolderSelect = (e) => {
    const files = Array.from(e.target.files)
    if (files.length === 0) return
    const firstRel = files[0].webkitRelativePath || files[0].name
    const folderName = firstRel.split('/')[0]
    setBrowseHint({
      folderName,
      fileCount: files.length,
      totalSize: files.reduce((s, f) => s + f.size, 0),
    })
  }

  const formatBytes = (bytes) => {
    if (!bytes) return '0 B'
    if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`
    if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)} MB`
    return `${(bytes / 1e3).toFixed(0)} KB`
  }

  return (
    <div style={{ ...PANEL_STYLE, marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <span style={{ fontSize: 22 }}>📁</span>
        <h2 style={{ margin: 0, color: COLORS.text, fontSize: 18, fontWeight: 700 }}>Knowledge Source</h2>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input
          type="text"
          value={folderPath}
          onChange={(e) => setFolderPath(e.target.value)}
          placeholder="C:\Users\you\OneDrive - Your Org\   (paste an absolute path)"
          style={{
            flex: 1,
            background: COLORS.bg,
            border: `1px solid ${COLORS.border}`,
            borderRadius: 6,
            padding: '10px 14px',
            color: COLORS.text,
            fontSize: 13,
            outline: 'none',
          }}
        />
        <button
          onClick={() => folderRef.current?.click()}
          style={{
            background: 'transparent',
            color: COLORS.accent,
            border: `1px solid ${COLORS.accent}`,
            borderRadius: 6,
            padding: '10px 18px',
            cursor: 'pointer',
            fontWeight: 600,
            fontSize: 13,
          }}
          title="Preview — Browse only counts files. Still need to paste the full absolute path above."
        >
          Browse
        </button>
        <button
          onClick={onScan}
          disabled={!folderPath || ingesting || scanning}
          style={{
            background: COLORS.accent,
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            padding: '10px 18px',
            cursor: (!folderPath || ingesting || scanning) ? 'not-allowed' : 'pointer',
            fontWeight: 700,
            fontSize: 13,
            opacity: (!folderPath || ingesting || scanning) ? 0.5 : 1,
          }}
        >
          {scanning ? 'Scanning...' : 'Scan'}
        </button>
      </div>

      <input
        type="file"
        webkitdirectory="true"
        directory="true"
        multiple
        style={{ display: 'none' }}
        ref={folderRef}
        onChange={handleFolderSelect}
      />

      {browseHint && (
        <div style={{ background: COLORS.bg, border: `1px solid ${COLORS.border}`, borderRadius: 6, padding: 10, marginBottom: 12, fontSize: 12, color: COLORS.text }}>
          <div style={{ color: COLORS.accent, fontWeight: 700, marginBottom: 4 }}>Browse preview: {browseHint.folderName}</div>
          <div style={{ color: COLORS.muted }}>
            {browseHint.fileCount} files · {formatBytes(browseHint.totalSize)} — browsers don't expose absolute paths,
            so please <b>paste the full path</b> to this folder in the input above, then click Scan.
          </div>
        </div>
      )}

      {scanError && (
        <div style={{ background: '#2a1515', border: `1px solid ${COLORS.red}`, borderRadius: 6, padding: 10, marginBottom: 12, fontSize: 13, color: '#fecaca' }}>
          <div style={{ color: COLORS.red, fontWeight: 700, marginBottom: 4 }}>⚠ Scan failed</div>
          <div style={{ fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-word' }}>{scanError}</div>
        </div>
      )}

      {scanResults && !ingesting && (
        <div style={{ color: COLORS.muted, fontSize: 13, lineHeight: 1.8, marginBottom: 12 }}>
          <div>● {scanResults.summary?.total_found ?? 0} files found</div>
          <div>● {scanResults.summary?.total_supported ?? 0} supported · {scanResults.summary?.total_skipped ?? 0} skipped</div>
          <div>● {formatBytes(scanResults.summary?.total_size_bytes)} total</div>
          {scanResults.summary?.total_flagged > 0 && (
            <div style={{ color: COLORS.yellow }}>⚠ {scanResults.summary.total_flagged} sensitive filenames require review</div>
          )}
          {scanResults.errors?.length > 0 && (
            <div style={{ color: COLORS.yellow, marginTop: 4 }}>⚠ {scanResults.errors.length} path error(s) during crawl</div>
          )}
          {scanResults.summary?.total_found === 0 && (
            <div style={{ color: COLORS.yellow, marginTop: 4 }}>
              ⚠ No files were discovered. Check that the path is correct and accessible.
            </div>
          )}
        </div>
      )}

      {ingesting && (
        <IngestionProgress />
      )}

      {!ingesting && ingestionResult && (
        <IngestionResultBanner result={ingestionResult} />
      )}

      {folderPath && !ingesting && (
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button
            onClick={onDryRun}
            disabled={dryRunning}
            style={{
              background: 'transparent',
              color: COLORS.accent,
              border: `1px solid ${COLORS.accent}`,
              borderRadius: 6,
              padding: '10px 18px',
              cursor: dryRunning ? 'wait' : 'pointer',
              fontWeight: 600,
              fontSize: 13,
              opacity: dryRunning ? 0.6 : 1,
            }}
          >
            {dryRunning ? '🔍 Dry running…' : '🔍 Dry Run'}
          </button>
          <button
            onClick={onStartIngestion}
            disabled={!scanResults || scanResults.summary?.total_supported === 0}
            style={{
              background: COLORS.accent,
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              padding: '10px 24px',
              cursor: (!scanResults || scanResults.summary?.total_supported === 0) ? 'not-allowed' : 'pointer',
              fontWeight: 700,
              fontSize: 13,
              opacity: (!scanResults || scanResults.summary?.total_supported === 0) ? 0.5 : 1,
            }}
            title={!scanResults ? 'Run Scan first' : (scanResults.summary?.total_supported === 0 ? 'No supported files to ingest' : '')}
          >
            ▶ Start Ingestion
          </button>
        </div>
      )}

      <div style={{ marginTop: 16, borderTop: `1px dashed ${COLORS.border}`, paddingTop: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ fontSize: 12, color: COLORS.muted, lineHeight: 1.5 }}>
            <div style={{ color: COLORS.text, fontWeight: 600, marginBottom: 2 }}>🛰 Real-time watcher (AID-LAS)</div>
            {watcherRunning
              ? <>🟢 Watching <code style={{ color: COLORS.text }}>{(watcherPath || '').split(/[\\/]/).pop()}</code> — new files are auto-ingested and checked for conflicts.</>
              : <>Start the watcher to detect changes & contradictions in real time.</>}
          </div>
          {watcherRunning ? (
            <button
              onClick={onStopWatcher}
              style={{ background: 'transparent', color: COLORS.red, border: `1px solid ${COLORS.red}`, borderRadius: 6, padding: '8px 16px', cursor: 'pointer', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}
            >■ Stop</button>
          ) : (
            <button
              onClick={onStartWatcher}
              disabled={!folderPath}
              style={{ background: COLORS.external, color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', cursor: folderPath ? 'pointer' : 'not-allowed', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', opacity: folderPath ? 1 : 0.5 }}
            >▶ Start Watcher</button>
          )}
        </div>
      </div>
    </div>
  )
}

function DryRunModal({ report, onClose, onStartIngestion }) {
  const [decisions, setDecisions] = useState(
    (report.flagged_files || []).reduce((acc, f) => ({ ...acc, [f.path]: 'skip' }), {})
  )

  const toggle = (path) => setDecisions(prev => ({
    ...prev,
    [path]: prev[path] === 'skip' ? 'allow' : 'skip',
  }))

  const fmt = (b) => {
    if (!b) return '0 B'
    if (b >= 1e6) return `${(b / 1e6).toFixed(1)} MB`
    return `${(b / 1e3).toFixed(0)} KB`
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1000, padding: 20,
    }}>
      <div style={{
        ...PANEL_STYLE, width: '100%', maxWidth: 820, maxHeight: '90vh', overflow: 'auto',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ color: COLORS.text, margin: 0, fontSize: 20 }}>🔍 Atlas Dry Run Report</h2>
          <button onClick={onClose} style={{ background: 'transparent', color: COLORS.muted, border: 'none', fontSize: 22, cursor: 'pointer' }}>✕</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
          <div style={{ background: COLORS.bg, borderRadius: 8, padding: 16 }}>
            <h3 style={{ color: COLORS.muted, fontSize: 11, textTransform: 'uppercase', marginTop: 0, letterSpacing: 1 }}>Files Discovered</h3>
            {Object.entries(report.file_breakdown || {}).sort().map(([ext, info]) => (
              <div key={ext} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: COLORS.text, marginBottom: 4 }}>
                <span>{ext}</span>
                <span style={{ color: COLORS.muted }}>{info.count} · {info.total_size_mb} MB</span>
              </div>
            ))}
          </div>
          <div style={{ background: COLORS.bg, borderRadius: 8, padding: 16 }}>
            <h3 style={{ color: COLORS.muted, fontSize: 11, textTransform: 'uppercase', marginTop: 0, letterSpacing: 1 }}>Estimates</h3>
            <div style={{ color: COLORS.text, fontSize: 13, marginBottom: 6 }}>
              <span style={{ color: COLORS.muted }}>Time: </span>
              <strong style={{ color: COLORS.accent }}>{report.time_estimate?.human || '—'}</strong>
              <span style={{ color: COLORS.muted, fontSize: 11 }}>  ({report.time_estimate?.total_seconds ?? 0}s)</span>
            </div>
            <div style={{ color: COLORS.text, fontSize: 13, marginBottom: 6 }}>
              <span style={{ color: COLORS.muted }}>Graph: </span>
              <strong>{report.graph_estimate?.min_nodes ?? 0}–{report.graph_estimate?.max_nodes ?? 0}</strong>
              <span style={{ color: COLORS.muted }}> nodes · </span>
              <strong>{report.graph_estimate?.min_edges ?? 0}–{report.graph_estimate?.max_edges ?? 0}</strong>
              <span style={{ color: COLORS.muted }}> edges</span>
            </div>
            <div style={{ borderTop: `1px solid ${COLORS.border}`, margin: '8px 0', paddingTop: 8 }}>
              <div style={{ color: COLORS.yellow, fontSize: 13, marginBottom: 4 }}>
                <strong>💵 ${(report.cost_estimate?.total_usd || 0).toFixed(4)}</strong>
                <span style={{ color: COLORS.muted, fontSize: 11 }}> estimated API cost</span>
              </div>
              <div style={{ color: COLORS.muted, fontSize: 11, lineHeight: 1.6 }}>
                <div>Transcription: ${(report.cost_estimate?.transcription_usd || 0).toFixed(4)}</div>
                <div>Vision (max): ${(report.cost_estimate?.visual_usd || 0).toFixed(4)} (up to {report.cost_estimate?.visual_count || 0} image(s))</div>
                {report.cost_estimate?.visual_is_ceiling && (
                  <div style={{ color: COLORS.muted, marginTop: 4, fontSize: 10, fontStyle: 'italic' }}>Vision cost is a ceiling — dry run doesn't open documents. Actual cost is almost always lower.</div>
                )}
              </div>
            </div>
          </div>
        </div>

        {report.flagged_files?.length > 0 && (
          <div style={{ background: COLORS.bg, borderRadius: 8, padding: 16, marginBottom: 16 }}>
            <h3 style={{ color: COLORS.yellow, fontSize: 14, margin: '0 0 8px' }}>
              ⚠ Sensitive Files ({report.flagged_files.length})
            </h3>
            <div style={{ color: COLORS.muted, fontSize: 12, marginBottom: 10 }}>
              Allowed files are sent to Claude verbatim. Skip anything you don't want uploaded.
            </div>
            {report.flagged_files.map(f => (
              <div key={f.path} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '6px 0', borderBottom: `1px solid ${COLORS.border}`,
              }}>
                <div style={{ fontSize: 13 }}>
                  <span style={{ color: COLORS.text }}>{f.filename}</span>
                  <span style={{ color: COLORS.muted, marginLeft: 8, fontSize: 11 }}>{fmt(f.size_bytes)}</span>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <label style={{ fontSize: 12, cursor: 'pointer', color: decisions[f.path] === 'skip' ? COLORS.red : COLORS.muted }}>
                    <input type="radio" name={f.path} checked={decisions[f.path] === 'skip'} onChange={() => toggle(f.path)} /> Skip
                  </label>
                  <label style={{ fontSize: 12, cursor: 'pointer', color: decisions[f.path] === 'allow' ? COLORS.external : COLORS.muted }}>
                    <input type="radio" name={f.path} checked={decisions[f.path] === 'allow'} onChange={() => toggle(f.path)} /> Allow
                  </label>
                </div>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
          <button onClick={onClose} style={{
            background: 'transparent', color: COLORS.muted,
            border: `1px solid ${COLORS.border}`, borderRadius: 6,
            padding: '10px 18px', cursor: 'pointer',
          }}>Cancel</button>
          <button onClick={() => onStartIngestion(decisions)} style={{
            background: COLORS.accent, color: '#fff', border: 'none',
            borderRadius: 6, padding: '10px 24px', cursor: 'pointer', fontWeight: 700,
          }}>Start Ingestion →</button>
        </div>
      </div>
    </div>
  )
}

function ResponseDisplay({ content }) {
  if (!content) return null

  const parts = content.split(/---\s*([^-]+?)\s*---/g)
  const blocks = []
  for (let i = 0; i < parts.length; i++) {
    if (i === 0) {
      if (parts[i].trim()) blocks.push({ title: null, body: parts[i] })
    } else if (i % 2 === 1) {
      blocks.push({ title: parts[i].trim(), body: parts[i + 1] || '' })
      i++
    }
  }

  return (
    <div>
      {blocks.map((block, idx) => {
        if (!block.title) {
          return (
            <div key={idx} style={{ color: COLORS.text, fontSize: 13, lineHeight: 1.6, marginBottom: 12, whiteSpace: 'pre-wrap' }}>
              {block.body.trim()}
            </div>
          )
        }
        const isInternal = /internal/i.test(block.title)
        const isExternal = /external/i.test(block.title)
        const isTransparency = /transparency/i.test(block.title)
        const borderColor = isInternal ? COLORS.internal : isExternal ? COLORS.external : COLORS.muted

        if (isTransparency) {
          return (
            <details key={idx} style={{ marginBottom: 8, paddingLeft: 10, borderLeft: `3px solid ${borderColor}` }}>
              <summary style={{ cursor: 'pointer', fontSize: 12, color: COLORS.muted }}>
                {block.title}
              </summary>
              <pre style={{ color: COLORS.muted, fontSize: 11, margin: '6px 0 0', whiteSpace: 'pre-wrap' }}>{block.body.trim()}</pre>
            </details>
          )
        }

        return (
          <div key={idx} style={{ marginBottom: 10, paddingLeft: 10, borderLeft: `3px solid ${borderColor}` }}>
            <div style={{ fontSize: 11, color: COLORS.muted, textTransform: 'uppercase', marginBottom: 4, letterSpacing: 1 }}>
              {block.title}
            </div>
            <pre style={{ color: COLORS.text, fontSize: 12, margin: 0, whiteSpace: 'pre-wrap' }}>{block.body.trim()}</pre>
          </div>
        )
      })}
    </div>
  )
}

function ChatPanel() {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [thinking, setThinking] = useState(false)
  const scrollRef = useRef(null)

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages, thinking])

  const send = async () => {
    const trimmed = input.trim()
    if (!trimmed || thinking) return
    setMessages(prev => [...prev, { role: 'user', content: trimmed }])
    setInput('')
    setThinking(true)
    try {
      const { response } = await apiCall('/api/query', { method: 'POST', body: { query: trimmed } })
      setMessages(prev => [...prev, { role: 'atlas', content: response }])
    } catch (err) {
      setMessages(prev => [...prev, { role: 'atlas', content: `Error contacting Atlas: ${err.message}` }])
    } finally {
      setThinking(false)
    }
  }

  return (
    <div style={{ ...PANEL_STYLE, display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 20 }}>💬</span>
        <h2 style={{ margin: 0, color: COLORS.text, fontSize: 16, fontWeight: 700 }}>Chat</h2>
      </div>

      <div ref={scrollRef} style={{ flex: 1, overflow: 'auto', marginBottom: 12 }}>
        {messages.length === 0 && (
          <div style={{ color: COLORS.muted, fontSize: 13, textAlign: 'center', padding: 32 }}>
            Ask Atlas anything about your knowledge base.
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} style={{ marginBottom: 12, display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
            <div style={{
              maxWidth: msg.role === 'user' ? '75%' : '95%',
              background: msg.role === 'user' ? COLORS.accent : COLORS.bg,
              color: msg.role === 'user' ? '#fff' : COLORS.text,
              padding: '10px 14px',
              borderRadius: msg.role === 'user' ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
              fontSize: 13,
              lineHeight: 1.6,
              whiteSpace: msg.role === 'user' ? 'pre-wrap' : 'normal',
            }}>
              {msg.role === 'user' ? msg.content : <ResponseDisplay content={msg.content} />}
            </div>
          </div>
        ))}
        {thinking && (
          <div style={{ color: COLORS.accent, fontSize: 13, padding: '8px 0' }}>
            <span style={{ animation: 'pulse 1.2s infinite' }}>●</span> Atlas is thinking...
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) send() }}
          placeholder="Ask Atlas..."
          disabled={thinking}
          style={{
            flex: 1, background: COLORS.bg, border: `1px solid ${COLORS.border}`,
            borderRadius: 6, padding: '10px 14px', color: COLORS.text, fontSize: 13, outline: 'none',
          }}
        />
        <button onClick={send} disabled={thinking || !input.trim()} style={{
          background: COLORS.accent, color: '#fff', border: 'none',
          borderRadius: 6, padding: '10px 20px', fontWeight: 700, fontSize: 13,
          cursor: (thinking || !input.trim()) ? 'not-allowed' : 'pointer',
          opacity: (thinking || !input.trim()) ? 0.6 : 1,
        }}>Send</button>
      </div>
    </div>
  )
}

const INGESTION_STAGES = [
  { id: 'crawl', label: 'Crawling files' },
  { id: 'parse', label: 'Parsing content' },
  { id: 'extract', label: 'Extracting entities (Claude API)' },
  { id: 'merge', label: 'Merging into graph' },
  { id: 'embed', label: 'Building vector index' },
]

function IngestionProgress() {
  const [elapsed, setElapsed] = useState(0)
  const [stageIdx, setStageIdx] = useState(0)

  useEffect(() => {
    const start = Date.now()
    // Advance visible stage roughly every 8s to give users a sense of progress
    const stageTick = setInterval(() => {
      setStageIdx(i => Math.min(i + 1, INGESTION_STAGES.length - 1))
    }, 8000)
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000)
    return () => { clearInterval(stageTick); clearInterval(timer) }
  }, [])

  return (
    <div style={{ background: COLORS.bg, borderRadius: 6, padding: 12, marginTop: 12, border: `1px solid ${COLORS.accent}` }}>
      <div style={{ color: COLORS.accent, fontSize: 13, fontWeight: 700, marginBottom: 10 }}>
        Ingesting — {elapsed}s elapsed
      </div>
      {INGESTION_STAGES.map((s, i) => {
        const done = i < stageIdx
        const active = i === stageIdx
        return (
          <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, marginBottom: 4,
            color: done ? COLORS.external : active ? COLORS.text : COLORS.muted }}>
            <span>{done ? '✓' : active ? '●' : '○'}</span>
            <span>{s.label}{active ? '…' : ''}</span>
          </div>
        )
      })}
      <div style={{ fontSize: 11, color: COLORS.muted, marginTop: 8 }}>
        The UI will update automatically when the pipeline completes.
      </div>
    </div>
  )
}

const CONTINUITY_OPTIONS = [
  { value: 'handover', label: 'Handover Pack', placeholder: 'Person name (e.g. Sarah Chen)', ext: 'md', key: 'document' },
  { value: 'decision-log', label: 'Decision Log', placeholder: 'Topic or project (e.g. Project Phoenix)', ext: 'md', key: 'document' },
  { value: 'open-actions', label: 'Open Actions Register', placeholder: 'Topic or project (e.g. Project Phoenix)', ext: 'csv', key: 'csv' },
  { value: 'risk-register', label: 'Risk Register', placeholder: 'Topic or project (e.g. Project Phoenix)', ext: 'csv', key: 'csv' },
]

const OTHER_SYNTHESIS_OPTIONS = [
  { value: 'podcast', label: 'Podcast Script', placeholder: 'Topic (e.g. Project Phoenix)', ext: 'md', key: 'script' },
  { value: 'brief', label: 'Project Brief', placeholder: 'Project name (e.g. Project Phoenix)', ext: 'md', key: 'brief' },
  { value: 'benchmark', label: 'Benchmark Report', placeholder: 'Topic (e.g. Vendor selection)', ext: 'md', key: 'report' },
]

const ALL_SYNTHESIS_OPTIONS = [...CONTINUITY_OPTIONS, ...OTHER_SYNTHESIS_OPTIONS]

function SynthesisPanel() {
  const [type, setType] = useState('handover')
  const [topic, setTopic] = useState('')
  const [output, setOutput] = useState('')
  const [generating, setGenerating] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [publishResult, setPublishResult] = useState(null)
  const [publishPath, setPublishPath] = useState('')

  const current = ALL_SYNTHESIS_OPTIONS.find(o => o.value === type)

  const generate = async () => {
    if (!topic.trim() || generating) return
    setGenerating(true)
    setOutput('')
    setPublishResult(null)
    try {
      const result = await apiCall('/api/synthesise', { method: 'POST', body: { type, topic: topic.trim() } })
      const text = result[current.key] || result.script || result.brief || result.document || result.report || JSON.stringify(result, null, 2)
      setOutput(text)
    } catch (err) {
      setOutput(`Error: ${err.message}`)
    } finally {
      setGenerating(false)
    }
  }

  const publishAll = async () => {
    if (!topic.trim() || publishing) return
    setPublishing(true)
    setPublishResult(null)
    try {
      const body = { topic: topic.trim() }
      if (publishPath.trim()) body.publishPath = publishPath.trim()
      const result = await apiCall('/api/publish', { method: 'POST', body })
      setPublishResult({ ok: true, dir: result.publish_dir, count: result.files?.length ?? 0 })
    } catch (err) {
      setPublishResult({ ok: false, error: err.message })
    } finally {
      setPublishing(false)
    }
  }

  const download = () => {
    const isCsv = current.ext === 'csv'
    const blob = new Blob([output], { type: isCsv ? 'text/csv' : 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `atlas-${type}-${topic.replace(/\s+/g, '-').toLowerCase()}.${current.ext}`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div style={{ ...PANEL_STYLE, marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 20 }}>📋</span>
        <h2 style={{ margin: 0, color: COLORS.text, fontSize: 16, fontWeight: 700 }}>Continuity Artifacts</h2>
      </div>

      <div style={{ fontSize: 11, color: COLORS.muted, marginBottom: 10 }}>
        PRIMARY — <span style={{ color: COLORS.accent }}>Handover Pack · Decision Log · Open Actions · Risk Register</span>
      </div>

      <select value={type} onChange={e => setType(e.target.value)} style={{
        width: '100%', background: COLORS.bg, color: COLORS.text,
        border: `1px solid ${COLORS.border}`, borderRadius: 6,
        padding: '8px 12px', fontSize: 13, marginBottom: 8,
      }}>
        <optgroup label="Continuity Artifacts (primary)">
          {CONTINUITY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </optgroup>
        <optgroup label="Other Synthesis">
          {OTHER_SYNTHESIS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </optgroup>
      </select>

      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <input
          value={topic}
          onChange={e => setTopic(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && generate()}
          placeholder={current.placeholder}
          style={{
            flex: 1, background: COLORS.bg, color: COLORS.text,
            border: `1px solid ${COLORS.border}`, borderRadius: 6,
            padding: '8px 12px', fontSize: 13, outline: 'none',
          }}
        />
        <button onClick={generate} disabled={generating || !topic.trim()} style={{
          background: COLORS.accent, color: '#fff', border: 'none',
          borderRadius: 6, padding: '8px 16px', fontWeight: 700, fontSize: 13,
          cursor: (generating || !topic.trim()) ? 'not-allowed' : 'pointer',
          opacity: (generating || !topic.trim()) ? 0.6 : 1,
        }}>{generating ? 'Generating...' : 'Generate'}</button>
      </div>

      {output && (
        <>
          <textarea readOnly value={output} style={{
            width: '100%', minHeight: 200, maxHeight: 320,
            background: COLORS.bg, color: COLORS.text,
            border: `1px solid ${COLORS.border}`, borderRadius: 6,
            padding: 12, fontSize: 12, fontFamily: 'monospace',
            resize: 'vertical', boxSizing: 'border-box',
          }} />
          <button onClick={download} style={{
            marginTop: 8, background: 'transparent', color: COLORS.accent,
            border: `1px solid ${COLORS.accent}`, borderRadius: 6,
            padding: '6px 14px', cursor: 'pointer', fontSize: 12,
          }}>📥 Download .{current.ext}</button>
        </>
      )}

      <div style={{ marginTop: 16, borderTop: `1px solid ${COLORS.border}`, paddingTop: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: COLORS.text, marginBottom: 8 }}>Publish All Artifacts to Disk</div>
        <div style={{ fontSize: 11, color: COLORS.muted, marginBottom: 8 }}>
          Generates all 4 continuity artifacts and writes them to the published/ folder (or a custom path below).
          Use this to share outputs with your team via a synced folder.
        </div>
        <input
          value={publishPath}
          onChange={e => setPublishPath(e.target.value)}
          placeholder="Optional: custom publish path (e.g. C:\Users\You\OneDrive\Atlas-Outputs)"
          style={{
            width: '100%', background: COLORS.bg, color: COLORS.text,
            border: `1px solid ${COLORS.border}`, borderRadius: 6,
            padding: '8px 12px', fontSize: 12, outline: 'none',
            marginBottom: 8, boxSizing: 'border-box',
          }}
        />
        <button onClick={publishAll} disabled={publishing || !topic.trim()} style={{
          background: publishing ? 'transparent' : COLORS.external, color: publishing ? COLORS.muted : '#fff',
          border: `1px solid ${publishing ? COLORS.border : COLORS.external}`,
          borderRadius: 6, padding: '8px 18px', fontWeight: 700, fontSize: 13,
          cursor: (publishing || !topic.trim()) ? 'not-allowed' : 'pointer',
          opacity: !topic.trim() ? 0.5 : 1,
        }}>
          {publishing ? '⏳ Publishing...' : '📤 Publish All to Disk'}
        </button>
        {publishResult && (
          <div style={{
            marginTop: 8, padding: 10, borderRadius: 6, fontSize: 12,
            background: publishResult.ok ? '#0f2a1f' : '#2a1515',
            border: `1px solid ${publishResult.ok ? COLORS.external : COLORS.red}`,
            color: publishResult.ok ? '#86efac' : '#fecaca',
          }}>
            {publishResult.ok
              ? `✓ ${publishResult.count} file(s) written to: ${publishResult.dir}`
              : `⚠ Publish failed: ${publishResult.error}`}
          </div>
        )}
      </div>
    </div>
  )
}

function KnowledgeDashboard({ folderPath, onReIngest, onResetComplete }) {
  const [stats, setStats] = useState({ nodes: 0, edges: 0, chunks: 0, lastIngestion: 'never', nodesByType: {} })
  const [recentFiles, setRecentFiles] = useState([])
  const [resetConfirming, setResetConfirming] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [resetMessage, setResetMessage] = useState(null)

  const refresh = async () => {
    try {
      const s = await apiCall('/api/stats')
      setStats(s)
      const f = await apiCall('/api/recent-files')
      setRecentFiles(f)
    } catch (_) { /* ignore */ }
  }

  useEffect(() => {
    refresh()
    const interval = setInterval(refresh, 10000)
    return () => clearInterval(interval)
  }, [])

  const handleReset = async () => {
    setResetting(true)
    setResetMessage(null)
    try {
      const result = await apiCall('/api/reset-graph', { method: 'POST', body: { confirm: 'RESET' } })
      setResetMessage({ type: 'ok', text: `Cleared ${result.cleared.length} file(s). Knowledge base is empty.` })
      setResetConfirming(false)
      await refresh()
      if (typeof onResetComplete === 'function') onResetComplete()
    } catch (err) {
      setResetMessage({ type: 'error', text: `Reset failed: ${err.message}` })
    } finally {
      setResetting(false)
    }
  }

  return (
    <div style={PANEL_STYLE}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 20 }}>📊</span>
        <h2 style={{ margin: 0, color: COLORS.text, fontSize: 16, fontWeight: 700 }}>Knowledge Base</h2>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 12 }}>
        <div style={{ background: COLORS.bg, borderRadius: 6, padding: 10 }}>
          <div style={{ color: COLORS.muted, fontSize: 11 }}>Nodes</div>
          <div style={{ color: COLORS.text, fontSize: 18, fontWeight: 700 }}>{stats.nodes.toLocaleString()}</div>
        </div>
        <div style={{ background: COLORS.bg, borderRadius: 6, padding: 10 }}>
          <div style={{ color: COLORS.muted, fontSize: 11 }}>Edges</div>
          <div style={{ color: COLORS.text, fontSize: 18, fontWeight: 700 }}>{stats.edges.toLocaleString()}</div>
        </div>
        <div style={{ background: COLORS.bg, borderRadius: 6, padding: 10 }}>
          <div style={{ color: COLORS.muted, fontSize: 11 }}>Chunks</div>
          <div style={{ color: COLORS.text, fontSize: 18, fontWeight: 700 }}>{(stats.chunks ?? 0).toLocaleString()}</div>
        </div>
      </div>

      <div style={{ fontSize: 11, color: COLORS.muted, marginBottom: 10 }}>
        <div>Last ingestion: {stats.lastIngestion === 'never' || stats.lastIngestion === '1970-01-01T00:00:00.000Z' ? 'never' : new Date(stats.lastIngestion).toLocaleString()}</div>
        {folderPath && <div style={{ marginTop: 4, wordBreak: 'break-all' }}>📁 {folderPath}</div>}
      </div>

      {Object.keys(stats.nodesByType || {}).length > 0 && (
        <div style={{ fontSize: 11, color: COLORS.muted, marginBottom: 10 }}>
          {Object.entries(stats.nodesByType).map(([type, count]) => (
            <div key={type}>• {type}: {count}</div>
          ))}
        </div>
      )}

      {recentFiles.length > 0 && (
        <div style={{ fontSize: 11, color: COLORS.muted, marginBottom: 10 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Recent files:</div>
          {recentFiles.slice(0, 5).map(f => (
            <div key={f.file} style={{ wordBreak: 'break-all', marginBottom: 2 }}>• {f.file.split(/[\\/]/).pop()}</div>
          ))}
        </div>
      )}

      <button onClick={onReIngest} style={{
        width: '100%', background: 'transparent', color: COLORS.accent,
        border: `1px solid ${COLORS.accent}`, borderRadius: 6,
        padding: '8px 14px', cursor: 'pointer', fontSize: 13,
      }}>🔄 Re-ingest</button>

      {!resetConfirming ? (
        <button
          onClick={() => { setResetMessage(null); setResetConfirming(true) }}
          disabled={resetting}
          style={{
            width: '100%', marginTop: 8, background: 'transparent', color: COLORS.red,
            border: `1px solid ${COLORS.red}`, borderRadius: 6,
            padding: '8px 14px', cursor: resetting ? 'not-allowed' : 'pointer', fontSize: 13,
            opacity: resetting ? 0.6 : 1,
          }}
        >🗑 Reset knowledge base</button>
      ) : (
        <div style={{
          marginTop: 8, padding: 10, background: COLORS.bg,
          border: `1px solid ${COLORS.red}`, borderRadius: 6,
        }}>
          <div style={{ color: COLORS.text, fontSize: 12, marginBottom: 8 }}>
            This will permanently delete all nodes, edges, and the delta log.
            You'll need to re-ingest to rebuild the graph. Continue?
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={handleReset}
              disabled={resetting}
              style={{
                flex: 1, background: COLORS.red, color: '#fff', border: 'none',
                borderRadius: 6, padding: '6px 10px', fontSize: 12,
                cursor: resetting ? 'not-allowed' : 'pointer',
              }}
            >{resetting ? 'Resetting…' : 'Yes, reset'}</button>
            <button
              onClick={() => setResetConfirming(false)}
              disabled={resetting}
              style={{
                flex: 1, background: 'transparent', color: COLORS.muted,
                border: `1px solid ${COLORS.border}`, borderRadius: 6,
                padding: '6px 10px', fontSize: 12, cursor: 'pointer',
              }}
            >Cancel</button>
          </div>
        </div>
      )}

      {resetMessage && (
        <div style={{
          marginTop: 8, fontSize: 11,
          color: resetMessage.type === 'ok' ? COLORS.internal : COLORS.red,
        }}>
          {resetMessage.text}
        </div>
      )}
    </div>
  )
}

function classifyApiError(errMsg) {
  if (!errMsg) return 'unknown'
  const s = errMsg.toLowerCase()
  if (s.includes('credit balance') || s.includes('billing') || s.includes('insufficient_quota')) return 'billing'
  if (s.includes('401') || s.includes('invalid x-api-key') || s.includes('authentication_error') || s.includes('invalid api key')) return 'auth'
  if (s.includes('429') || s.includes('rate_limit') || s.includes('rate limit')) return 'rate_limit'
  if (s.includes('overloaded') || s.includes('529')) return 'overloaded'
  return 'other'
}

const API_ERROR_GUIDANCE = {
  billing: {
    title: '💳 Anthropic credit balance is too low',
    body: (
      <>
        Your API key is valid, but the account has no credits. Top up at{' '}
        <a href="https://console.anthropic.com/settings/billing" target="_blank" rel="noreferrer" style={{ color: COLORS.accent }}>
          console.anthropic.com/settings/billing
        </a>
        . No server restart needed — just re-ingest once credits post.
      </>
    ),
  },
  auth: {
    title: '🔑 Invalid API key',
    body: (
      <>
        Claude rejected the key (401). Check <code>ANTHROPIC_API_KEY</code> in your <code>.env</code> file. Get a new
        key at <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer" style={{ color: COLORS.accent }}>console.anthropic.com/settings/keys</a>.
        Save <code>.env</code>, restart <code>npm start</code>, then re-ingest.
      </>
    ),
  },
  rate_limit: {
    title: '⏱ Rate limited',
    body: <>You hit Anthropic's rate limit. Wait a minute and re-ingest. Large folders may need multiple passes.</>,
  },
  overloaded: {
    title: '🌩 Anthropic API overloaded',
    body: <>Claude returned 529 (servers busy). Wait a moment and re-ingest.</>,
  },
  other: {
    title: '⚠ Unknown extraction error',
    body: <>See the error detail above. Try restarting the server.</>,
  },
  unknown: {
    title: '⚠ 0 entities extracted',
    body: <>See the error detail above.</>,
  },
}

function IngestionResultBanner({ result }) {
  if (result.error) {
    return (
      <div style={{ background: '#2a1515', border: `1px solid ${COLORS.red}`, borderRadius: 6, padding: 12, marginTop: 12, fontSize: 13, color: '#fecaca' }}>
        <div style={{ color: COLORS.red, fontWeight: 700, marginBottom: 4 }}>⚠ Ingestion failed</div>
        <div style={{ fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-word' }}>{result.error}</div>
      </div>
    )
  }

  const zeroNodes = result.nodes_added === 0 && result.nodes_updated === 0
  const firstApiErr = result.api_errors?.[0]?.error
  const errorKind = classifyApiError(firstApiErr)
  const bannerColor = zeroNodes ? COLORS.yellow : COLORS.external
  const bannerBg = zeroNodes ? '#2a1f0f' : '#0f2a1f'
  const icon = zeroNodes ? '⚠' : '✓'

  return (
    <div style={{ background: bannerBg, border: `1px solid ${bannerColor}`, borderRadius: 6, padding: 12, marginTop: 12, fontSize: 13, color: COLORS.text }}>
      <div style={{ color: bannerColor, fontWeight: 700, marginBottom: 6 }}>{icon} Ingestion complete</div>
      <div style={{ fontSize: 12, lineHeight: 1.8, color: COLORS.muted }}>
        <div>Files processed: <span style={{ color: COLORS.text }}>{result.files_processed ?? 0}</span></div>
        {typeof result.files_skipped_by_checksum === 'number' && result.files_skipped_by_checksum > 0 && (
          <div>Skipped (unchanged checksum): <span style={{ color: COLORS.text }}>{result.files_skipped_by_checksum}</span></div>
        )}
        <div>Nodes added / updated: <span style={{ color: COLORS.text }}>{result.nodes_added ?? 0} / {result.nodes_updated ?? 0}</span></div>
        <div>Chunks embedded: <span style={{ color: COLORS.text }}>{result.chunks_embedded ?? 0}</span> across <span style={{ color: COLORS.text }}>{result.files_embedded ?? 0}</span> file(s){result.embedding_errors > 0 ? <span style={{ color: COLORS.yellow }}> ({result.embedding_errors} error(s))</span> : null}</div>
        <div>Edges added: <span style={{ color: COLORS.text }}>{result.edges_added ?? 0}</span></div>
        <div>Duration: <span style={{ color: COLORS.text }}>{result.duration_ms ?? 0}ms</span></div>
      </div>
      {zeroNodes && (
        <div style={{ marginTop: 8, padding: 10, background: '#1a1308', borderRadius: 4, fontSize: 12, color: '#fde68a' }}>
          {result.api_errors && result.api_errors.length > 0 ? (
            <>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>{API_ERROR_GUIDANCE[errorKind].title}</div>
              <div style={{ marginBottom: 6 }}>
                {API_ERROR_GUIDANCE[errorKind].body}
              </div>
              <details style={{ marginTop: 6 }}>
                <summary style={{ cursor: 'pointer', color: COLORS.muted }}>
                  Error details — {result.api_errors.length} file(s) affected
                </summary>
                <div style={{ fontFamily: 'monospace', fontSize: 11, marginTop: 6, wordBreak: 'break-word', color: '#fecaca' }}>
                  {firstApiErr}
                </div>
              </details>
            </>
          ) : result.parse_errors && result.parse_errors.length > 0 ? (
            <>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>🧩 Claude returned non-JSON responses</div>
              <div style={{ marginBottom: 6 }}>
                {result.parse_errors.length} file(s) extracted successfully via the API, but Claude's response
                couldn't be parsed as JSON. This usually means the model returned prose instead of the
                structured output we asked for — retry often fixes it.
              </div>
              <details style={{ marginTop: 6 }}>
                <summary style={{ cursor: 'pointer', color: COLORS.muted }}>
                  Response previews
                </summary>
                <div style={{ fontFamily: 'monospace', fontSize: 11, marginTop: 6, wordBreak: 'break-word', color: '#fecaca' }}>
                  {result.parse_errors.slice(0, 3).map((pe, i) => (
                    <div key={i} style={{ marginBottom: 6 }}>
                      <div style={{ color: COLORS.muted }}>{pe.source_file?.split(/[\\/]/).pop()}</div>
                      <div>{pe.raw_preview || '(empty response)'}</div>
                    </div>
                  ))}
                </div>
              </details>
            </>
          ) : result.extractions_with_signal === 0 ? (
            <>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>All files parsed to empty text</div>
              <div>
                {result.files_processed ?? 0} file(s) were read but none produced any text. Likely causes:
                scanned PDFs with no text layer, encrypted PDFs, or a parser library mismatch.
                Check the <code>npm start</code> terminal for <code>[PARSE_ERROR]</code> lines, or run
                <code> logs/audit_log.jsonl</code> for the error detail.
              </div>
            </>
          ) : (
            <>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>0 entities extracted — reason unclear</div>
              <div>
                All files were sent to Claude and returned parseable JSON, but no entities were extracted.
                The documents may not contain recognizable people / projects / decisions, or the extraction
                prompt didn't find a match. Try a folder with clearer meeting notes or project docs.
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function ServerStatusBanner() {
  const [status, setStatus] = useState('checking')
  const [lastOk, setLastOk] = useState(null)

  useEffect(() => {
    let cancelled = false
    async function ping() {
      try {
        const r = await fetch(`${API_BASE}/api/health`, { signal: AbortSignal.timeout(3000) })
        if (!cancelled && r.ok) {
          setStatus('online')
          setLastOk(new Date())
        }
      } catch (_) {
        if (!cancelled) setStatus('offline')
      }
    }
    ping()
    const interval = setInterval(ping, 4000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [])

  if (status !== 'offline') return null

  return (
    <div style={{
      background: '#2a1515',
      border: `1px solid ${COLORS.red}`,
      borderRadius: 8,
      padding: 12,
      marginBottom: 16,
      fontSize: 13,
      color: '#fecaca',
    }}>
      <div style={{ color: COLORS.red, fontWeight: 700, marginBottom: 4 }}>
        ⚠ Atlas server is unreachable
      </div>
      <div style={{ color: '#fee2e2', fontSize: 12, lineHeight: 1.6 }}>
        The browser can't reach <code>localhost:3001</code>. Your <code>npm start</code> terminal probably exited or crashed.
        Reopen the terminal, re-run <code>npm start</code> (or <code>npm run dev</code> for auto-restart on crash),
        and this banner will disappear when the server is back up.
        {lastOk && <div style={{ marginTop: 4, color: COLORS.muted }}>Last successful connection: {lastOk.toLocaleTimeString()}</div>}
      </div>
    </div>
  )
}

function EnvStatusBanner({ envStatus }) {
  if (!envStatus) return null
  if (envStatus.anthropic) return null

  return (
    <div style={{
      background: '#2a1f0f',
      border: `1px solid ${COLORS.yellow}`,
      borderRadius: 8,
      padding: 12,
      marginBottom: 16,
      fontSize: 13,
      color: '#fde68a',
    }}>
      <div style={{ color: COLORS.yellow, fontWeight: 700, marginBottom: 4 }}>
        ⚠ ANTHROPIC_API_KEY is not set
      </div>
      <div style={{ color: '#fef3c7', fontSize: 12, lineHeight: 1.6 }}>
        Atlas can scan and parse files, but entity extraction requires a Claude API key. Without it,
        ingestion will complete with <b>0 nodes / 0 edges</b>. Add <code>ANTHROPIC_API_KEY=sk-ant-…</code>
        to your <code>.env</code> file and restart <code>npm start</code>.
        Get a key at <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer" style={{ color: COLORS.accent }}>console.anthropic.com/settings/keys</a>.
      </div>
    </div>
  )
}

function AidlasAlertsPanel() {
  const [alerts, setAlerts] = useState([])
  const [watcher, setWatcher] = useState({ running: false, watching_path: null, queued: 0 })
  const seenIdsRef = useRef(new Set())
  const [flashId, setFlashId] = useState(null)

  const refresh = async () => {
    try {
      const r = await apiCall('/api/alerts?limit=15')
      const incoming = r.alerts || []
      if (incoming.length > 0) {
        const newest = incoming[0]
        if (!seenIdsRef.current.has(newest.id)) {
          seenIdsRef.current.add(newest.id)
          setFlashId(newest.id)
          setTimeout(() => setFlashId(null), 1500)
        }
        for (const a of incoming) seenIdsRef.current.add(a.id)
      }
      setAlerts(incoming)
    } catch (_) {}
    try {
      const s = await apiCall('/api/watcher/status')
      setWatcher(s)
    } catch (_) {}
  }

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, 2000)
    return () => clearInterval(id)
  }, [])

  const severityStyle = (sev) => ({
    info: { color: COLORS.internal, border: COLORS.internal },
    warn: { color: COLORS.yellow, border: COLORS.yellow },
    error: { color: COLORS.red, border: COLORS.red },
  }[sev] || { color: COLORS.muted, border: COLORS.border })

  return (
    <div style={{
      ...PANEL_STYLE,
      marginBottom: 16,
      background: '#141824',
      border: `1px solid ${watcher.running ? COLORS.external : COLORS.border}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 20 }}>🛰</span>
          <div>
            <div style={{ color: COLORS.text, fontSize: 15, fontWeight: 700 }}>AID-LAS Alerts</div>
            <div style={{ color: COLORS.muted, fontSize: 11 }}>
              {watcher.running
                ? <>🟢 Watching <code style={{ color: COLORS.text }}>{(watcher.watching_path || '').split(/[\\/]/).pop()}</code> · queued: {watcher.queued}</>
                : <>⚪ Watcher idle — start from Knowledge Source panel</>}
            </div>
          </div>
        </div>
      </div>

      {alerts.length === 0 ? (
        <div style={{ color: COLORS.muted, fontSize: 12, fontStyle: 'italic' }}>
          No alerts yet. Start the watcher and drop a file into the watched folder to see real-time conflict detection.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 360, overflowY: 'auto' }}>
          {alerts.map(a => {
            const style = severityStyle(a.severity)
            const isFlash = a.id === flashId
            return (
              <div key={a.id} style={{
                background: isFlash ? '#1f2a3a' : COLORS.bg,
                border: `1px solid ${style.border}`,
                borderRadius: 6,
                padding: 10,
                transition: 'background 800ms',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                  <div style={{ color: style.color, fontSize: 13, fontWeight: 700 }}>{a.title}</div>
                  <div style={{ color: COLORS.muted, fontSize: 10 }}>
                    {new Date(a.timestamp).toLocaleTimeString()}
                  </div>
                </div>
                {a.message && (
                  <div style={{ color: COLORS.text, fontSize: 12, lineHeight: 1.5, marginBottom: a.details ? 6 : 0 }}>
                    {a.message}
                  </div>
                )}
                {a.details && (
                  <div style={{ background: '#0c0f18', border: `1px solid ${COLORS.border}`, borderRadius: 4, padding: 8, fontSize: 11, color: COLORS.muted, lineHeight: 1.6 }}>
                    <div><span style={{ color: COLORS.muted }}>Existing source:</span> <span style={{ color: COLORS.text }}>{a.details.existing_file}</span></div>
                    {a.details.quoted_existing && <div style={{ marginTop: 2 }}><span style={{ color: COLORS.muted }}>Existing quote:</span> <span style={{ color: COLORS.text, fontStyle: 'italic' }}>"{a.details.quoted_existing}"</span></div>}
                    {a.details.quoted_new && <div style={{ marginTop: 2 }}><span style={{ color: COLORS.muted }}>New quote:</span> <span style={{ color: COLORS.text, fontStyle: 'italic' }}>"{a.details.quoted_new}"</span></div>}
                    {a.details.detail_engineer && <div style={{ marginTop: 4 }}><span style={{ color: COLORS.muted }}>For engineers:</span> <span style={{ color: COLORS.text }}>{a.details.detail_engineer}</span></div>}
                    {typeof a.details.confidence === 'number' && <div style={{ marginTop: 4, color: COLORS.muted }}>Confidence: {(a.details.confidence * 100).toFixed(0)}% · similarity: {a.details.similarity}</div>}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function CollectionSidebar({ onCollectionChange }) {
  const [state, setState] = useState({ active: null, collections: [] })
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newPath, setNewPath] = useState('')
  const [confirmingDelete, setConfirmingDelete] = useState(null)
  const [error, setError] = useState(null)

  const refresh = async () => {
    try {
      const result = await apiCall('/api/collections')
      setState(result)
    } catch (err) {
      setError(err.message)
    }
  }

  useEffect(() => {
    refresh()
    const interval = setInterval(refresh, 8000)
    return () => clearInterval(interval)
  }, [])

  const activate = async (id) => {
    try {
      await apiCall(`/api/collections/${id}/activate`, { method: 'POST' })
      await refresh()
      if (typeof onCollectionChange === 'function') onCollectionChange(id)
    } catch (err) { setError(err.message) }
  }

  const create = async () => {
    const name = newName.trim()
    if (!name) return
    try {
      await apiCall('/api/collections', { method: 'POST', body: { name, rootPath: newPath.trim() || null } })
      setNewName(''); setNewPath(''); setCreating(false)
      await refresh()
      if (typeof onCollectionChange === 'function') onCollectionChange(null)
    } catch (err) { setError(err.message) }
  }

  const remove = async (id) => {
    try {
      await apiCall(`/api/collections/${id}`, { method: 'DELETE' })
      setConfirmingDelete(null)
      await refresh()
      if (typeof onCollectionChange === 'function') onCollectionChange(null)
    } catch (err) { setError(err.message) }
  }

  return (
    <div style={{
      ...PANEL_STYLE,
      position: 'sticky',
      top: 20,
      maxHeight: 'calc(100vh - 40px)',
      overflowY: 'auto',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 18 }}>📚</span>
          <h2 style={{ margin: 0, color: COLORS.text, fontSize: 15, fontWeight: 700 }}>Collections</h2>
        </div>
        <button
          onClick={() => setCreating(v => !v)}
          style={{ background: 'transparent', color: COLORS.accent, border: `1px solid ${COLORS.accent}`, borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer' }}
        >{creating ? 'Cancel' : '+ New'}</button>
      </div>

      {creating && (
        <div style={{ background: COLORS.bg, border: `1px solid ${COLORS.border}`, borderRadius: 6, padding: 10, marginBottom: 12 }}>
          <input
            type="text"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="Collection name"
            style={{ width: '100%', boxSizing: 'border-box', background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 4, padding: 6, color: COLORS.text, fontSize: 12, marginBottom: 6 }}
          />
          <input
            type="text"
            value={newPath}
            onChange={e => setNewPath(e.target.value)}
            placeholder="Root folder (optional)"
            style={{ width: '100%', boxSizing: 'border-box', background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 4, padding: 6, color: COLORS.text, fontSize: 12, marginBottom: 6 }}
          />
          <button
            onClick={create}
            disabled={!newName.trim()}
            style={{ width: '100%', background: COLORS.accent, color: '#fff', border: 'none', borderRadius: 4, padding: 6, fontSize: 12, cursor: newName.trim() ? 'pointer' : 'not-allowed', opacity: newName.trim() ? 1 : 0.5 }}
          >Create</button>
        </div>
      )}

      {error && (
        <div style={{ color: COLORS.red, fontSize: 11, marginBottom: 8 }}>{error}</div>
      )}

      <div>
        {state.collections.length === 0 && (
          <div style={{ color: COLORS.muted, fontSize: 12 }}>No collections yet. Click + New.</div>
        )}
        {state.collections.map(c => {
          const isActive = c.id === state.active
          const isConfirming = confirmingDelete === c.id
          return (
            <div
              key={c.id}
              style={{
                background: isActive ? COLORS.bg : 'transparent',
                border: `1px solid ${isActive ? COLORS.accent : COLORS.border}`,
                borderRadius: 6,
                padding: 10,
                marginBottom: 6,
                cursor: isActive ? 'default' : 'pointer',
              }}
              onClick={() => !isActive && !isConfirming && activate(c.id)}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: isActive ? COLORS.accent : COLORS.text, fontSize: 13, fontWeight: 600, wordBreak: 'break-word' }}>{c.name}</div>
                  {c.rootPath && (
                    <div style={{ color: COLORS.muted, fontSize: 10, marginTop: 2, wordBreak: 'break-all' }}>{c.rootPath}</div>
                  )}
                </div>
                {!isConfirming ? (
                  <button
                    onClick={(e) => { e.stopPropagation(); setConfirmingDelete(c.id) }}
                    title="Delete"
                    style={{ background: 'transparent', color: COLORS.muted, border: 'none', cursor: 'pointer', fontSize: 14, padding: 2 }}
                  >🗑</button>
                ) : (
                  <div style={{ display: 'flex', gap: 4 }} onClick={e => e.stopPropagation()}>
                    <button onClick={() => remove(c.id)} style={{ background: COLORS.red, color: '#fff', border: 'none', borderRadius: 4, padding: '2px 6px', fontSize: 10, cursor: 'pointer' }}>Delete</button>
                    <button onClick={() => setConfirmingDelete(null)} style={{ background: 'transparent', color: COLORS.muted, border: `1px solid ${COLORS.border}`, borderRadius: 4, padding: '2px 6px', fontSize: 10, cursor: 'pointer' }}>Cancel</button>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function AtlasInterface() {
  const [folderPath, setFolderPath] = useState('')
  const [scanResults, setScanResults] = useState(null)
  const [scanError, setScanError] = useState(null)
  const [scanning, setScanning] = useState(false)
  const [dryRunReport, setDryRunReport] = useState(null)
  const [dryRunning, setDryRunning] = useState(false)
  const [showDryRunModal, setShowDryRunModal] = useState(false)
  const [ingesting, setIngesting] = useState(false)
  const [ingestionResult, setIngestionResult] = useState(null)
  const [envStatus, setEnvStatus] = useState(null)

  useEffect(() => {
    apiCall('/api/env-status').then(setEnvStatus).catch(() => setEnvStatus(null))
  }, [])

  const handleScan = async () => {
    setScanning(true)
    setScanError(null)
    setScanResults(null)
    setIngestionResult(null)
    try {
      const results = await apiCall('/api/scan', { method: 'POST', body: { folderPath } })
      setScanResults(results)
    } catch (err) {
      setScanError(err.message)
    } finally {
      setScanning(false)
    }
  }

  const handleDryRun = async () => {
    if (!folderPath) return
    setDryRunning(true)
    try {
      const report = await apiCall('/api/dry-run', { method: 'POST', body: { folderPath } })
      setDryRunReport(report)
      setShowDryRunModal(true)
    } catch (err) {
      alert(`Dry run failed: ${err.message}`)
    } finally {
      setDryRunning(false)
    }
  }

  const handleStartIngestion = async () => {
    setShowDryRunModal(false)
    setIngesting(true)
    setIngestionResult(null)
    try {
      const result = await apiCall('/api/ingest', { method: 'POST', body: { folderPath, skipFlagged: true } })
      setIngestionResult(result)
    } catch (err) {
      setIngestionResult({ error: err.message })
    } finally {
      setIngesting(false)
    }
  }

  const handleResetComplete = () => {
    setScanResults(null)
    setScanError(null)
    setDryRunReport(null)
    setIngestionResult(null)
  }

  const handleCollectionChange = async () => {
    setScanResults(null)
    setScanError(null)
    setDryRunReport(null)
    setIngestionResult(null)
    try {
      const s = await apiCall('/api/stats')
      if (s.collection_root) setFolderPath(s.collection_root)
      else setFolderPath('')
    } catch (_) {}
  }

  const [watcherStatus, setWatcherStatus] = useState({ running: false, watching_path: null })

  const refreshWatcher = async () => {
    try {
      const s = await apiCall('/api/watcher/status')
      setWatcherStatus(s)
    } catch (_) {}
  }

  const handleStartWatcher = async () => {
    if (!folderPath) return
    try {
      await apiCall('/api/watcher/start', { method: 'POST', body: { folderPath } })
      refreshWatcher()
    } catch (err) { alert(`Watcher failed: ${err.message}`) }
  }

  const handleStopWatcher = async () => {
    try {
      await apiCall('/api/watcher/stop', { method: 'POST' })
      refreshWatcher()
    } catch (err) { alert(`Stop failed: ${err.message}`) }
  }

  useEffect(() => {
    handleCollectionChange()
    refreshWatcher()
    const id = setInterval(refreshWatcher, 3000)
    return () => clearInterval(id)
  }, [])

  return (
    <div style={{
      background: COLORS.bg, minHeight: '100vh', color: COLORS.text,
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      padding: 20,
    }}>
      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
      `}</style>

      <div style={{ maxWidth: 1440, margin: '0 auto', display: 'grid', gridTemplateColumns: '240px 1fr', gap: 16 }}>
        <aside>
          <CollectionSidebar onCollectionChange={handleCollectionChange} />
        </aside>

        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
            <div style={{ width: 36, height: 36, background: COLORS.accent, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>⚡</div>
            <div>
              <h1 style={{ margin: 0, color: COLORS.text, fontSize: 22, fontWeight: 800 }}>AID-LAS</h1>
              <p style={{ margin: 0, fontSize: 12, color: COLORS.muted }}>Real-time delivery intelligence · powered by Claude + Genspark</p>
            </div>
          </div>

          <ServerStatusBanner />
          <EnvStatusBanner envStatus={envStatus} />

          <AidlasAlertsPanel />

          <FolderWidget
            folderPath={folderPath}
            setFolderPath={setFolderPath}
            scanResults={scanResults}
            scanError={scanError}
            scanning={scanning}
            dryRunning={dryRunning}
            onScan={handleScan}
            onDryRun={handleDryRun}
            onStartIngestion={handleStartIngestion}
            ingesting={ingesting}
            ingestionResult={ingestionResult}
            watcherRunning={watcherStatus.running}
            watcherPath={watcherStatus.watching_path}
            onStartWatcher={handleStartWatcher}
            onStopWatcher={handleStopWatcher}
          />

          <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 16 }}>
            <div style={{ minHeight: 540 }}>
              <ChatPanel />
            </div>
            <div>
              <SynthesisPanel />
              <KnowledgeDashboard folderPath={folderPath} onReIngest={handleStartIngestion} onResetComplete={handleResetComplete} />
            </div>
          </div>
        </div>

        {showDryRunModal && dryRunReport && (
          <DryRunModal
            report={dryRunReport}
            onClose={() => setShowDryRunModal(false)}
            onStartIngestion={handleStartIngestion}
          />
        )}
      </div>
    </div>
  )
}
