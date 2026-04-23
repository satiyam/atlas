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
    const text = await response.text().catch(() => response.statusText)
    throw new Error(`${response.status}: ${text}`)
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

function FolderWidget({ folderPath, setFolderPath, scanResults, onScan, onDryRun, onStartIngestion, ingesting, progress }) {
  const folderRef = useRef(null)

  const handleFolderSelect = (e) => {
    const files = Array.from(e.target.files)
    if (files.length === 0) return
    const firstRel = files[0].webkitRelativePath || files[0].name
    setFolderPath(firstRel.split('/')[0])
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
          placeholder="C:\Users\you\OneDrive - Your Org\   (paste a path or browse)"
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
        >
          Browse
        </button>
        <button
          onClick={onScan}
          disabled={!folderPath || ingesting}
          style={{
            background: COLORS.accent,
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            padding: '10px 18px',
            cursor: (!folderPath || ingesting) ? 'not-allowed' : 'pointer',
            fontWeight: 700,
            fontSize: 13,
            opacity: (!folderPath || ingesting) ? 0.5 : 1,
          }}
        >
          Scan
        </button>
      </div>

      <input
        type="file"
        webkitdirectory=""
        directory=""
        multiple
        style={{ display: 'none' }}
        ref={folderRef}
        onChange={handleFolderSelect}
      />

      {scanResults && !ingesting && (
        <div style={{ color: COLORS.muted, fontSize: 13, lineHeight: 1.8, marginBottom: 12 }}>
          <div>● {scanResults.summary?.total_found ?? 0} files found</div>
          <div>● {scanResults.summary?.total_supported ?? 0} supported · {scanResults.summary?.total_skipped ?? 0} skipped</div>
          <div>● {formatBytes(scanResults.summary?.total_size_bytes)} total</div>
          {scanResults.summary?.total_flagged > 0 && (
            <div style={{ color: COLORS.yellow }}>⚠ {scanResults.summary.total_flagged} sensitive filenames require review</div>
          )}
        </div>
      )}

      {ingesting && progress && (
        <div style={{ marginTop: 12 }}>
          <div style={{ color: COLORS.accent, fontSize: 13, marginBottom: 4 }}>
            ▶ Ingesting... {progress.current} / {progress.total}
          </div>
          <div style={{ height: 8, background: '#2a2d3a', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{
              height: '100%',
              width: `${progress.total > 0 ? (progress.current / progress.total) * 100 : 0}%`,
              background: COLORS.accent,
              transition: 'width 0.3s ease',
            }} />
          </div>
          {progress.currentFile && (
            <div style={{ color: COLORS.muted, fontSize: 12, marginTop: 4 }}>
              Currently: {progress.currentFile}
            </div>
          )}
        </div>
      )}

      {scanResults && !ingesting && (
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button
            onClick={onDryRun}
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
          >
            🔍 Dry Run
          </button>
          <button
            onClick={onStartIngestion}
            style={{
              background: COLORS.accent,
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              padding: '10px 24px',
              cursor: 'pointer',
              fontWeight: 700,
              fontSize: 13,
            }}
          >
            ▶ Start Ingestion
          </button>
        </div>
      )}

      <div style={{ marginTop: 16, fontSize: 12, color: COLORS.muted, borderTop: `1px dashed ${COLORS.border}`, paddingTop: 10 }}>
        💡 Tip: Point at your OneDrive sync folder for live Microsoft 365 document access
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
            <div style={{ color: COLORS.text, fontSize: 14, marginBottom: 8 }}>
              <strong style={{ color: COLORS.accent }}>⏱ {report.time_estimate?.human || '—'}</strong>
            </div>
            <div style={{ color: COLORS.yellow, fontSize: 14, marginBottom: 8 }}>
              <strong>💵 ${(report.cost_estimate?.total_usd || 0).toFixed(4)}</strong>
              <span style={{ color: COLORS.muted, fontSize: 12 }}> Whisper API</span>
            </div>
            <div style={{ color: COLORS.text, fontSize: 13 }}>
              Graph: {report.graph_estimate?.min_nodes}–{report.graph_estimate?.max_nodes} nodes
            </div>
          </div>
        </div>

        {report.flagged_files?.length > 0 && (
          <div style={{ background: COLORS.bg, borderRadius: 8, padding: 16, marginBottom: 16 }}>
            <h3 style={{ color: COLORS.yellow, fontSize: 14, margin: '0 0 8px' }}>
              ⚠ Sensitive Files ({report.flagged_files.length})
            </h3>
            <div style={{ color: COLORS.muted, fontSize: 12, marginBottom: 10 }}>
              Files you Allow still pass PII Redactor. RED content is blocked automatically.
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

const SYNTHESIS_OPTIONS = [
  { value: 'podcast', label: 'Podcast Script', placeholder: 'Topic (e.g. Project Phoenix)' },
  { value: 'brief', label: 'Project Brief', placeholder: 'Project name (e.g. Project Phoenix)' },
  { value: 'handover', label: 'Handover Document', placeholder: 'Person name (e.g. Sarah Chen)' },
  { value: 'benchmark', label: 'Benchmark Report', placeholder: 'Topic (e.g. Vendor selection)' },
]

function SynthesisPanel() {
  const [type, setType] = useState('podcast')
  const [topic, setTopic] = useState('')
  const [output, setOutput] = useState('')
  const [generating, setGenerating] = useState(false)

  const current = SYNTHESIS_OPTIONS.find(o => o.value === type)

  const generate = async () => {
    if (!topic.trim() || generating) return
    setGenerating(true)
    setOutput('')
    try {
      const result = await apiCall('/api/synthesise', { method: 'POST', body: { type, topic: topic.trim() } })
      setOutput(result.script || result.brief || result.document || result.report || JSON.stringify(result, null, 2))
    } catch (err) {
      setOutput(`Error: ${err.message}`)
    } finally {
      setGenerating(false)
    }
  }

  const download = () => {
    const blob = new Blob([output], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `atlas-${type}-${topic.replace(/\s+/g, '-').toLowerCase()}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div style={{ ...PANEL_STYLE, marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 20 }}>✨</span>
        <h2 style={{ margin: 0, color: COLORS.text, fontSize: 16, fontWeight: 700 }}>Synthesis</h2>
      </div>

      <select value={type} onChange={e => setType(e.target.value)} style={{
        width: '100%', background: COLORS.bg, color: COLORS.text,
        border: `1px solid ${COLORS.border}`, borderRadius: 6,
        padding: '8px 12px', fontSize: 13, marginBottom: 8,
      }}>
        {SYNTHESIS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>

      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <input
          value={topic}
          onChange={e => setTopic(e.target.value)}
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
          }}>📥 Download .md</button>
        </>
      )}
    </div>
  )
}

function KnowledgeDashboard({ folderPath, onReIngest }) {
  const [stats, setStats] = useState({ nodes: 0, edges: 0, lastIngestion: 'never', nodesByType: {} })
  const [recentFiles, setRecentFiles] = useState([])

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

  return (
    <div style={PANEL_STYLE}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 20 }}>📊</span>
        <h2 style={{ margin: 0, color: COLORS.text, fontSize: 16, fontWeight: 700 }}>Knowledge Base</h2>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
        <div style={{ background: COLORS.bg, borderRadius: 6, padding: 10 }}>
          <div style={{ color: COLORS.muted, fontSize: 11 }}>Nodes</div>
          <div style={{ color: COLORS.text, fontSize: 20, fontWeight: 700 }}>{stats.nodes.toLocaleString()}</div>
        </div>
        <div style={{ background: COLORS.bg, borderRadius: 6, padding: 10 }}>
          <div style={{ color: COLORS.muted, fontSize: 11 }}>Edges</div>
          <div style={{ color: COLORS.text, fontSize: 20, fontWeight: 700 }}>{stats.edges.toLocaleString()}</div>
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
    </div>
  )
}

export default function AtlasInterface() {
  const [folderPath, setFolderPath] = useState('')
  const [scanResults, setScanResults] = useState(null)
  const [dryRunReport, setDryRunReport] = useState(null)
  const [showDryRunModal, setShowDryRunModal] = useState(false)
  const [ingesting, setIngesting] = useState(false)
  const [progress, setProgress] = useState(null)

  const handleScan = async () => {
    try {
      const results = await apiCall('/api/scan', { method: 'POST', body: { folderPath } })
      setScanResults(results)
    } catch (err) {
      alert(`Scan failed: ${err.message}`)
    }
  }

  const handleDryRun = async () => {
    if (!scanResults) return
    try {
      const report = await apiCall('/api/dry-run', { method: 'POST', body: { crawlResults: scanResults, rootPath: folderPath } })
      setDryRunReport(report)
      setShowDryRunModal(true)
    } catch (err) {
      alert(`Dry run failed: ${err.message}`)
    }
  }

  const handleStartIngestion = async () => {
    setShowDryRunModal(false)
    setIngesting(true)
    const total = scanResults?.summary?.total_changed || 1
    setProgress({ current: 0, total, currentFile: 'preparing...' })

    const simInterval = setInterval(() => {
      setProgress(prev => {
        if (!prev) return prev
        const next = Math.min(prev.current + 1, prev.total - 1)
        return { ...prev, current: next, currentFile: `processing file ${next + 1}...` }
      })
    }, 500)

    try {
      const result = await apiCall('/api/ingest', { method: 'POST', body: { folderPath, skipFlagged: true } })
      clearInterval(simInterval)
      setProgress({ current: total, total, currentFile: `done — ${result.nodes_added} nodes, ${result.edges_added} edges` })
      setTimeout(() => { setIngesting(false); setProgress(null) }, 2500)
    } catch (err) {
      clearInterval(simInterval)
      alert(`Ingestion failed: ${err.message}`)
      setIngesting(false)
      setProgress(null)
    }
  }

  return (
    <div style={{
      background: COLORS.bg, minHeight: '100vh', color: COLORS.text,
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      padding: 20,
    }}>
      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
      `}</style>

      <div style={{ maxWidth: 1280, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
          <div style={{ width: 36, height: 36, background: COLORS.accent, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>⚡</div>
          <div>
            <h1 style={{ margin: 0, color: COLORS.text, fontSize: 22, fontWeight: 800 }}>Atlas</h1>
            <p style={{ margin: 0, fontSize: 12, color: COLORS.muted }}>Workspace Intelligence Assistant</p>
          </div>
        </div>

        <FolderWidget
          folderPath={folderPath}
          setFolderPath={setFolderPath}
          scanResults={scanResults}
          onScan={handleScan}
          onDryRun={handleDryRun}
          onStartIngestion={handleStartIngestion}
          ingesting={ingesting}
          progress={progress}
        />

        <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 16 }}>
          <div style={{ minHeight: 540 }}>
            <ChatPanel />
          </div>
          <div>
            <SynthesisPanel />
            <KnowledgeDashboard folderPath={folderPath} onReIngest={handleStartIngestion} />
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
