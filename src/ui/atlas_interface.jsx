import React, { useState, useRef, useEffect, useCallback } from 'react'

const THEME = {
  bg: '#0f1117',
  panel: '#1a1d27',
  panelBorder: '#2a2d3a',
  accent: '#7c6af7',
  accentHover: '#9d8fff',
  text: '#e2e8f0',
  textMuted: '#8892a4',
  internalBadge: '#3b82f6',
  externalBadge: '#10b981',
  error: '#ef4444',
  warning: '#f59e0b',
  success: '#22c55e',
}

const SYNTHESIS_TYPES = [
  { value: 'podcast', label: 'Podcast Script' },
  { value: 'brief', label: 'Project Brief' },
  { value: 'handover', label: 'Handover Document' },
  { value: 'decision_log', label: 'Decision Log' },
  { value: 'benchmark', label: 'Benchmark Report' },
  { value: 'onboarding', label: 'Onboarding Guide' },
]

function Badge({ type }) {
  const isInternal = type === 'internal'
  return (
    <span style={{
      background: isInternal ? THEME.internalBadge : THEME.externalBadge,
      color: '#fff',
      fontSize: 11,
      padding: '2px 8px',
      borderRadius: 4,
      fontWeight: 600,
      letterSpacing: 0.5,
    }}>
      {isInternal ? 'INTERNAL' : 'EXTERNAL'}
    </span>
  )
}

function ProgressBar({ progress, label }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 12, color: THEME.textMuted }}>
        <span>{label}</span>
        <span>{progress}%</span>
      </div>
      <div style={{ height: 8, background: '#2a2d3a', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${progress}%`, background: THEME.accent, borderRadius: 4, transition: 'width 0.3s ease' }} />
      </div>
    </div>
  )
}

function FolderWidget({ onFolderSelected, ingestionState, onDryRun, onStartIngestion, onPause, onCancel, dryRunReport }) {
  const [folderPath, setFolderPath] = useState('')
  const [scanResult, setScanResult] = useState(null)
  const [scanning, setScanning] = useState(false)
  const folderInputRef = useRef(null)

  const handleFolderSelect = useCallback((e) => {
    const files = Array.from(e.target.files)
    if (files.length === 0) return
    const firstPath = files[0].webkitRelativePath || files[0].name
    const rootFolder = firstPath.split('/')[0]
    setFolderPath(rootFolder)
    setScanResult({ total: files.length, supported: files.filter(f => f.size > 100).length, totalSize: files.reduce((s, f) => s + f.size, 0) })
    if (onFolderSelected) onFolderSelected(files, rootFolder)
  }, [onFolderSelected])

  const formatBytes = (bytes) => {
    if (bytes > 1e9) return `${(bytes / 1e9).toFixed(1)} GB`
    if (bytes > 1e6) return `${(bytes / 1e6).toFixed(0)} MB`
    return `${(bytes / 1e3).toFixed(0)} KB`
  }

  return (
    <div style={{ background: THEME.panel, border: `1px solid ${THEME.panelBorder}`, borderRadius: 12, padding: 20, marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <span style={{ fontSize: 20 }}>📁</span>
        <h2 style={{ margin: 0, color: THEME.text, fontSize: 16, fontWeight: 700 }}>Knowledge Source</h2>
      </div>

      {!scanResult ? (
        <div>
          <p style={{ color: THEME.textMuted, fontSize: 13, marginBottom: 12 }}>Point Atlas at a folder to begin</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={folderPath}
              onChange={e => setFolderPath(e.target.value)}
              placeholder="Enter folder path or browse..."
              style={{ flex: 1, background: '#0f1117', border: `1px solid ${THEME.panelBorder}`, borderRadius: 6, padding: '8px 12px', color: THEME.text, fontSize: 13, outline: 'none' }}
            />
            <button
              onClick={() => folderInputRef.current?.click()}
              style={{ background: THEME.accent, color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', cursor: 'pointer', fontWeight: 600 }}
            >
              Browse
            </button>
          </div>
          <input
            type="file"
            webkitdirectory="true"
            directory="true"
            multiple
            style={{ display: 'none' }}
            ref={folderInputRef}
            onChange={handleFolderSelect}
          />
          <p style={{ color: THEME.textMuted, fontSize: 12, marginTop: 10 }}>
            💡 Tip: Point at your OneDrive sync folder for live Microsoft 365 document access
          </p>
        </div>
      ) : ingestionState?.status === 'running' ? (
        <div>
          <p style={{ color: THEME.text, fontSize: 13, marginBottom: 4 }}>{folderPath}</p>
          <p style={{ color: THEME.accent, fontSize: 13, marginBottom: 12 }}>▶ Ingesting... {ingestionState.processed} / {ingestionState.total} files</p>
          <ProgressBar progress={Math.round((ingestionState.processed / ingestionState.total) * 100)} label={`Currently: ${ingestionState.currentFile || 'processing...'}`} />
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button onClick={onPause} style={{ background: '#2a2d3a', color: THEME.text, border: 'none', borderRadius: 6, padding: '8px 16px', cursor: 'pointer' }}>Pause</button>
            <button onClick={onCancel} style={{ background: THEME.error, color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', cursor: 'pointer' }}>Cancel</button>
          </div>
        </div>
      ) : (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
            <p style={{ color: THEME.text, fontSize: 13, margin: 0 }}>{folderPath}</p>
            <button onClick={() => { setScanResult(null); setFolderPath('') }} style={{ background: 'transparent', color: THEME.accent, border: `1px solid ${THEME.accent}`, borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12 }}>Change</button>
          </div>
          <div style={{ color: THEME.textMuted, fontSize: 13, lineHeight: '1.8' }}>
            <div>● {scanResult.total.toLocaleString()} files found</div>
            <div>● {scanResult.supported.toLocaleString()} supported · {(scanResult.total - scanResult.supported)} skipped</div>
            <div>● {formatBytes(scanResult.totalSize)} total</div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button
              onClick={() => onDryRun && onDryRun()}
              style={{ background: 'transparent', color: THEME.accent, border: `1px solid ${THEME.accent}`, borderRadius: 6, padding: '8px 16px', cursor: 'pointer', fontWeight: 600, fontSize: 13 }}
            >
              🔍 Dry Run
            </button>
            <button
              onClick={() => onStartIngestion && onStartIngestion()}
              style={{ background: THEME.accent, color: '#fff', border: 'none', borderRadius: 6, padding: '8px 20px', cursor: 'pointer', fontWeight: 700, fontSize: 13 }}
            >
              ▶ Start Ingestion
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function DryRunModal({ report, onClose, onStartIngestion }) {
  const [decisions, setDecisions] = useState(
    report.flagged.reduce((acc, f) => ({ ...acc, [f.path]: 'skip' }), {})
  )

  const toggleDecision = (filePath) => {
    setDecisions(prev => ({ ...prev, [filePath]: prev[filePath] === 'skip' ? 'allow' : 'skip' }))
  }

  const formatTime = (seconds) => {
    if (seconds < 60) return `~${seconds}s`
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    return h > 0 ? `~${h}hr ${m}min` : `~${m}min`
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
      <div style={{ background: THEME.panel, border: `1px solid ${THEME.panelBorder}`, borderRadius: 12, width: '100%', maxWidth: 780, maxHeight: '90vh', overflow: 'auto', padding: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ color: THEME.text, margin: 0, fontSize: 18 }}>🔍 Atlas Dry Run Report</h2>
          <button onClick={onClose} style={{ background: 'transparent', color: THEME.textMuted, border: 'none', cursor: 'pointer', fontSize: 18 }}>✕</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 24 }}>
          <div style={{ background: '#0f1117', borderRadius: 8, padding: 16 }}>
            <h3 style={{ color: THEME.textMuted, fontSize: 12, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', marginTop: 0 }}>Files Discovered</h3>
            {Object.entries(report.file_breakdown || {}).map(([ext, data]) => (
              <div key={ext} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: THEME.text, marginBottom: 4 }}>
                <span>{ext}</span>
                <span style={{ color: THEME.textMuted }}>{data.count} files · {data.total_size_mb}MB</span>
              </div>
            ))}
          </div>
          <div style={{ background: '#0f1117', borderRadius: 8, padding: 16 }}>
            <h3 style={{ color: THEME.textMuted, fontSize: 12, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', marginTop: 0 }}>Time &amp; Cost Estimates</h3>
            <div style={{ fontSize: 13, color: THEME.text, lineHeight: '1.8' }}>
              <div>Parsing: {formatTime(report.time_estimate?.parsing_seconds)}</div>
              <div>Audio transcribe: {formatTime(report.time_estimate?.audio_transcription_seconds)}</div>
              <div>PII redaction: {formatTime(report.time_estimate?.pii_redaction_seconds)}</div>
              <div>Entity extract: {formatTime(report.time_estimate?.entity_extraction_seconds)}</div>
              <div style={{ marginTop: 8, color: THEME.accent, fontWeight: 700 }}>⏱ Total: {report.time_estimate?.total_human}</div>
              <div style={{ marginTop: 8 }}>Audio cost: <span style={{ color: THEME.warning }}>${report.cost_estimate?.total_usd?.toFixed(2) || '0.00'}</span></div>
            </div>
          </div>
        </div>

        {report.flagged?.length > 0 && (
          <div style={{ background: '#0f1117', borderRadius: 8, padding: 16, marginBottom: 20 }}>
            <h3 style={{ color: THEME.warning, margin: '0 0 12px', fontSize: 14 }}>⚠️ Files Requiring Your Decision ({report.flagged.length} files)</h3>
            <p style={{ color: THEME.textMuted, fontSize: 13, marginBottom: 12 }}>Filename suggests sensitive content. Review before ingesting.</p>
            {report.flagged.map(file => (
              <div key={file.path} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: `1px solid ${THEME.panelBorder}` }}>
                <div>
                  <span style={{ color: THEME.text, fontSize: 13 }}>{file.filename}</span>
                  <span style={{ color: THEME.textMuted, fontSize: 11, marginLeft: 8 }}>{(file.size_bytes / 1024).toFixed(0)}KB</span>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <label style={{ cursor: 'pointer', fontSize: 12, color: decisions[file.path] === 'skip' ? THEME.error : THEME.textMuted }}>
                    <input type="radio" name={file.path} checked={decisions[file.path] === 'skip'} onChange={() => toggleDecision(file.path)} style={{ marginRight: 4 }} />
                    Skip
                  </label>
                  <label style={{ cursor: 'pointer', fontSize: 12, color: decisions[file.path] === 'allow' ? THEME.success : THEME.textMuted }}>
                    <input type="radio" name={file.path} checked={decisions[file.path] === 'allow'} onChange={() => toggleDecision(file.path)} style={{ marginRight: 4 }} />
                    Allow
                  </label>
                </div>
              </div>
            ))}
            <p style={{ color: THEME.textMuted, fontSize: 11, marginTop: 8 }}>Files you Allow will still pass through PII Redactor. Content classified RED will be blocked automatically.</p>
          </div>
        )}

        <div style={{ background: '#0f1117', borderRadius: 8, padding: 16, marginBottom: 20 }}>
          <h3 style={{ color: THEME.textMuted, fontSize: 12, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', marginTop: 0 }}>Estimated Knowledge Graph</h3>
          <div style={{ fontSize: 13, color: THEME.text, lineHeight: '1.8' }}>
            <div>~{report.graph_size_estimate?.min_nodes?.toLocaleString()}–{report.graph_size_estimate?.max_nodes?.toLocaleString()} entity nodes</div>
            <div>~{report.graph_size_estimate?.min_edges?.toLocaleString()}–{report.graph_size_estimate?.max_edges?.toLocaleString()} relationships</div>
            <div>~{report.graph_size_estimate?.estimated_mb} MB graph store</div>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
          <button onClick={onClose} style={{ background: 'transparent', color: THEME.textMuted, border: `1px solid ${THEME.panelBorder}`, borderRadius: 6, padding: '8px 16px', cursor: 'pointer' }}>Cancel</button>
          <button
            onClick={() => onStartIngestion(decisions)}
            style={{ background: THEME.accent, color: '#fff', border: 'none', borderRadius: 6, padding: '8px 20px', cursor: 'pointer', fontWeight: 700 }}
          >
            Start Ingestion →
          </button>
        </div>
      </div>
    </div>
  )
}

function ChatPanel({ onSend }) {
  const [query, setQuery] = useState('')
  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(false)

  const handleSend = async () => {
    if (!query.trim() || loading) return
    const userMessage = query.trim()
    setQuery('')
    setMessages(prev => [...prev, { role: 'user', content: userMessage }])
    setLoading(true)

    try {
      const response = onSend ? await onSend(userMessage) : { text: 'Atlas is ready. Configure ingestion path and ingest documents to begin.', sources: [], external: null }
      setMessages(prev => [...prev, { role: 'atlas', content: response.text, sources: response.sources, external: response.external }])
    } catch (err) {
      setMessages(prev => [...prev, { role: 'atlas', content: `Error: ${err.message}`, sources: [], external: null }])
    } finally {
      setLoading(false)
    }
  }

  const parseResponse = (content) => {
    if (!content) return { answer: '', internal: [], external: [], transparency: '' }
    const parts = content.split(/─{3}/)
    return {
      answer: parts[0]?.trim() || '',
      internal: parts[1] || '',
      external: parts[2] || '',
      transparency: parts[3] || '',
    }
  }

  return (
    <div style={{ background: THEME.panel, border: `1px solid ${THEME.panelBorder}`, borderRadius: 12, padding: 20, display: 'flex', flexDirection: 'column', height: '100%', minHeight: 400 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <span style={{ fontSize: 18 }}>💬</span>
        <h2 style={{ margin: 0, color: THEME.text, fontSize: 16, fontWeight: 700 }}>Chat</h2>
      </div>

      <div style={{ flex: 1, overflow: 'auto', marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {messages.length === 0 && (
          <p style={{ color: THEME.textMuted, fontSize: 13, textAlign: 'center', marginTop: 40 }}>Ask Atlas anything about your knowledge base...</p>
        )}
        {messages.map((msg, i) => {
          if (msg.role === 'user') {
            return (
              <div key={i} style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <div style={{ background: THEME.accent, color: '#fff', padding: '10px 14px', borderRadius: '12px 12px 4px 12px', fontSize: 13, maxWidth: '80%' }}>
                  {msg.content}
                </div>
              </div>
            )
          }
          const parsed = parseResponse(msg.content)
          return (
            <div key={i} style={{ maxWidth: '100%' }}>
              <p style={{ color: THEME.text, fontSize: 13, lineHeight: 1.6, margin: '0 0 12px' }}>{parsed.answer}</p>
              {parsed.internal && (
                <div style={{ background: '#0f1117', borderRadius: 8, padding: 12, marginBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                    <Badge type="internal" />
                    <span style={{ color: THEME.textMuted, fontSize: 11 }}>Internal Sources</span>
                  </div>
                  <pre style={{ color: THEME.textMuted, fontSize: 11, whiteSpace: 'pre-wrap', margin: 0 }}>{parsed.internal.replace('Internal Sources', '').trim()}</pre>
                </div>
              )}
              {parsed.external && (
                <div style={{ background: '#0f1117', borderRadius: 8, padding: 12, marginBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                    <Badge type="external" />
                    <span style={{ color: THEME.textMuted, fontSize: 11 }}>External Research</span>
                  </div>
                  <pre style={{ color: THEME.textMuted, fontSize: 11, whiteSpace: 'pre-wrap', margin: 0 }}>{parsed.external.replace('External Research (via Genspark)', '').trim()}</pre>
                </div>
              )}
              {parsed.transparency && (
                <div style={{ borderLeft: `2px solid ${THEME.panelBorder}`, paddingLeft: 10 }}>
                  <pre style={{ color: THEME.textMuted, fontSize: 10, whiteSpace: 'pre-wrap', margin: 0 }}>{parsed.transparency.replace('Knowledge Base Transparency', '').trim()}</pre>
                </div>
              )}
            </div>
          )
        })}
        {loading && <p style={{ color: THEME.accent, fontSize: 13 }}>Atlas is thinking...</p>}
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
          placeholder="Ask Atlas..."
          style={{ flex: 1, background: '#0f1117', border: `1px solid ${THEME.panelBorder}`, borderRadius: 6, padding: '10px 14px', color: THEME.text, fontSize: 13, outline: 'none' }}
        />
        <button
          onClick={handleSend}
          disabled={loading || !query.trim()}
          style={{ background: THEME.accent, color: '#fff', border: 'none', borderRadius: 6, padding: '10px 16px', cursor: loading ? 'wait' : 'pointer', fontWeight: 700, opacity: loading || !query.trim() ? 0.6 : 1 }}
        >
          Send
        </button>
      </div>
    </div>
  )
}

function SynthesisPanel({ onGenerate }) {
  const [synthType, setSynthType] = useState('podcast')
  const [topic, setTopic] = useState('')
  const [output, setOutput] = useState('')
  const [loading, setLoading] = useState(false)

  const handleGenerate = async () => {
    if (!topic.trim() || loading) return
    setLoading(true)
    setOutput('')
    try {
      const result = onGenerate ? await onGenerate(synthType, topic.trim()) : { content: `[Demo] Generated ${synthType} for: ${topic}` }
      setOutput(result.content || result.script || result.brief || result.document || result.report || '')
    } catch (err) {
      setOutput(`Error: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }

  const handleDownload = () => {
    const blob = new Blob([output], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `atlas-${synthType}-${topic.replace(/\s+/g, '-').toLowerCase()}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div style={{ background: THEME.panel, border: `1px solid ${THEME.panelBorder}`, borderRadius: 12, padding: 20, marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <span style={{ fontSize: 18 }}>✨</span>
        <h2 style={{ margin: 0, color: THEME.text, fontSize: 16, fontWeight: 700 }}>Synthesis</h2>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <select
          value={synthType}
          onChange={e => setSynthType(e.target.value)}
          style={{ background: '#0f1117', border: `1px solid ${THEME.panelBorder}`, borderRadius: 6, padding: '8px 12px', color: THEME.text, fontSize: 13, cursor: 'pointer' }}
        >
          {SYNTHESIS_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input
          value={topic}
          onChange={e => setTopic(e.target.value)}
          placeholder="Enter topic, project name, or person..."
          style={{ flex: 1, background: '#0f1117', border: `1px solid ${THEME.panelBorder}`, borderRadius: 6, padding: '8px 12px', color: THEME.text, fontSize: 13, outline: 'none' }}
        />
        <button
          onClick={handleGenerate}
          disabled={loading || !topic.trim()}
          style={{ background: THEME.accent, color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', cursor: loading ? 'wait' : 'pointer', fontWeight: 700, opacity: loading || !topic.trim() ? 0.6 : 1 }}
        >
          {loading ? 'Generating...' : 'Generate'}
        </button>
      </div>

      {output && (
        <div>
          <textarea
            value={output}
            readOnly
            style={{ width: '100%', minHeight: 200, background: '#0f1117', border: `1px solid ${THEME.panelBorder}`, borderRadius: 6, padding: 12, color: THEME.text, fontSize: 12, resize: 'vertical', fontFamily: 'monospace', boxSizing: 'border-box' }}
          />
          <button
            onClick={handleDownload}
            style={{ marginTop: 8, background: 'transparent', color: THEME.accent, border: `1px solid ${THEME.accent}`, borderRadius: 6, padding: '6px 14px', cursor: 'pointer', fontSize: 12 }}
          >
            ⬇ Download .md
          </button>
        </div>
      )}
    </div>
  )
}

function KnowledgeDashboard({ stats, onReIngest }) {
  return (
    <div style={{ background: THEME.panel, border: `1px solid ${THEME.panelBorder}`, borderRadius: 12, padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <span style={{ fontSize: 18 }}>📊</span>
        <h2 style={{ margin: 0, color: THEME.text, fontSize: 16, fontWeight: 700 }}>Knowledge Dashboard</h2>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
        {[
          { label: 'Files Ingested', value: stats?.filesIngested?.toLocaleString() || '0' },
          { label: 'Entity Nodes', value: stats?.nodes?.toLocaleString() || '0' },
          { label: 'Relationships', value: stats?.edges?.toLocaleString() || '0' },
          { label: 'Last Run', value: stats?.lastRun || 'Never' },
        ].map(item => (
          <div key={item.label} style={{ background: '#0f1117', borderRadius: 8, padding: 12 }}>
            <div style={{ color: THEME.textMuted, fontSize: 11, marginBottom: 4 }}>{item.label}</div>
            <div style={{ color: THEME.text, fontSize: 18, fontWeight: 700 }}>{item.value}</div>
          </div>
        ))}
      </div>

      <button
        onClick={onReIngest}
        style={{ background: 'transparent', color: THEME.accent, border: `1px solid ${THEME.accent}`, borderRadius: 6, padding: '8px 16px', cursor: 'pointer', fontSize: 13, width: '100%' }}
      >
        Re-ingest
      </button>
    </div>
  )
}

export default function AtlasInterface() {
  const [dryRunReport, setDryRunReport] = useState(null)
  const [showDryRunModal, setShowDryRunModal] = useState(false)
  const [ingestionState, setIngestionState] = useState(null)
  const [stats, setStats] = useState({ filesIngested: 0, nodes: 0, edges: 0, lastRun: 'Never' })
  const [files, setFiles] = useState([])

  const handleFolderSelected = useCallback((selectedFiles, rootFolder) => {
    setFiles(selectedFiles)
  }, [])

  const handleDryRun = useCallback(async () => {
    const mockReport = {
      file_breakdown: { '.docx': { count: 142, total_size_mb: 890 }, '.pdf': { count: 89, total_size_mb: 1200 }, '.mp4': { count: 8, total_size_mb: 4100 } },
      supported_count: 1132,
      skipped_count: 18,
      flagged: [
        { filename: 'HR-Performance-Review-2025.docx', path: '/path/HR-Performance-Review-2025.docx', size_bytes: 147456, extension: '.docx', matched_pattern: '/performance.?review/i', user_decision: 'skip' },
        { filename: 'Payroll-March-2026.xlsx', path: '/path/Payroll-March-2026.xlsx', size_bytes: 239616, extension: '.xlsx', matched_pattern: '/payroll/i', user_decision: 'skip' },
      ],
      time_estimate: { parsing_seconds: 720, audio_transcription_seconds: 2040, pii_redaction_seconds: 480, entity_extraction_seconds: 2820, graph_commit_seconds: 300, total_seconds: 6360, total_human: '1hr 46min' },
      cost_estimate: { audio_transcription_usd: 2.70, other_usd: 0, total_usd: 2.70, audio_file_count: 20, estimated_audio_minutes: 900 },
      graph_size_estimate: { min_nodes: 2400, max_nodes: 3200, min_edges: 4800, max_edges: 6400, estimated_mb: 180 },
    }
    setDryRunReport(mockReport)
    setShowDryRunModal(true)
  }, [])

  const handleStartIngestion = useCallback(async (decisions) => {
    setShowDryRunModal(false)
    setIngestionState({ status: 'running', processed: 0, total: 1132, currentFile: 'vendor-selection.docx' })
    let processed = 0
    const interval = setInterval(() => {
      processed += Math.floor(Math.random() * 15) + 5
      if (processed >= 1132) {
        clearInterval(interval)
        setIngestionState({ status: 'complete', processed: 1132, total: 1132, currentFile: null })
        setStats({ filesIngested: 1132, nodes: 3847, edges: 7203, lastRun: '10 min ago' })
      } else {
        setIngestionState(prev => ({ ...prev, processed, currentFile: `file_${processed}.docx` }))
      }
    }, 200)
  }, [])

  const handleChatSend = useCallback(async (query) => {
    return {
      text: `Based on your knowledge base, here is what I found about: "${query}"\n\nAtlas has ${stats.nodes} entity nodes available for querying. Configure the ingestion path and run ingestion to see real results.`,
      sources: [],
      external: null,
    }
  }, [stats])

  const handleGenerate = useCallback(async (type, topic) => {
    return { content: `# ${type.charAt(0).toUpperCase() + type.slice(1)}: ${topic}\n\nThis artefact will be generated from your knowledge base. Run ingestion first to populate the graph.\n\n---\nGenerated by Atlas | ${new Date().toISOString()}` }
  }, [])

  return (
    <div style={{ background: THEME.bg, minHeight: '100vh', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', color: THEME.text, padding: 20 }}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
          <div style={{ width: 36, height: 36, background: THEME.accent, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>⚡</div>
          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: THEME.text }}>Atlas</h1>
            <p style={{ margin: 0, fontSize: 12, color: THEME.textMuted }}>Workspace Intelligence Assistant</p>
          </div>
        </div>

        <FolderWidget
          onFolderSelected={handleFolderSelected}
          ingestionState={ingestionState}
          onDryRun={handleDryRun}
          onStartIngestion={() => handleStartIngestion({})}
          onPause={() => setIngestionState(prev => ({ ...prev, status: 'paused' }))}
          onCancel={() => setIngestionState(null)}
          dryRunReport={dryRunReport}
        />

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
          <div style={{ minHeight: 500 }}>
            <ChatPanel onSend={handleChatSend} />
          </div>
          <div>
            <SynthesisPanel onGenerate={handleGenerate} />
            <KnowledgeDashboard stats={stats} onReIngest={() => handleStartIngestion({})} />
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
