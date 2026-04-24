const debugBus    = require('./debug_bus')
const debugLogger = require('./debug_logger')

module.exports = function mountDebugRoutes(app) {

  app.get('/api/debug/stream', (req, res) => {
    res.setHeader('Content-Type',      'text/event-stream')
    res.setHeader('Cache-Control',     'no-cache')
    res.setHeader('Connection',        'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')
    res.flushHeaders()

    function send(event, data) {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    }

    for (const entry of debugLogger.getRecentLogs(50)) send('log', entry)
    send('summary', debugLogger.getSessionSummary())

    function onLog(entry) {
      send('log', entry)
      send('summary', debugLogger.getSessionSummary())
    }
    function onAlert(alert) {
      send('alert', alert)
    }

    debugBus.on('log',   onLog)
    debugBus.on('alert', onAlert)

    const ping = setInterval(() => res.write('event: ping\ndata: {}\n\n'), 20_000)

    req.on('close', () => {
      debugBus.off('log',   onLog)
      debugBus.off('alert', onAlert)
      clearInterval(ping)
    })
  })

  app.get('/api/debug/logs', (req, res) => {
    const limit = Math.min(parseInt(req.query.limit || '50', 10), 200)
    res.json({ logs: debugLogger.getRecentLogs(limit) })
  })

  app.get('/api/debug/token-summary', (req, res) => {
    res.json(debugLogger.getSessionSummary())
  })
}
