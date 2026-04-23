const RED_TRIGGERS = [
  'salary', 'compensation', 'bonus', 'payroll',
  'medical', 'health', 'disability', 'insurance claim',
  'underperforming', 'pip', 'probation', 'warning letter',
  'misconduct', 'termination', 'hr investigation',
  'disciplinary', 'grievance', 'redundancy',
]

const AMBER_PATTERNS = {
  nric: /[STFG]\d{7}[A-Z]/g,
  email: /[\w.-]+@[\w.-]+\.\w{2,}/g,
  sgPhone: /[689]\d{7}/g,
}

const AMBER_REPLACEMENTS = {
  nric: '[ID REDACTED]',
  email: '[EMAIL REDACTED]',
  sgPhone: '[PHONE REDACTED]',
}

class RedactionError extends Error {
  constructor(message, matchedTrigger = null) {
    super(message)
    this.name = 'RedactionError'
    this.matchedTrigger = matchedTrigger
  }
}

function classify(content) {
  if (!content || typeof content !== 'string') return 'GREEN'

  const lower = content.toLowerCase()
  for (const trigger of RED_TRIGGERS) {
    if (lower.includes(trigger)) return 'RED'
  }

  for (const pattern of Object.values(AMBER_PATTERNS)) {
    pattern.lastIndex = 0
    if (pattern.test(content)) return 'AMBER'
  }

  return 'GREEN'
}

function findRedTrigger(content) {
  const lower = content.toLowerCase()
  for (const trigger of RED_TRIGGERS) {
    if (lower.includes(trigger)) return trigger
  }
  return null
}

function redact(content) {
  const classification = classify(content)

  if (classification === 'RED') {
    const trigger = findRedTrigger(content)
    throw new RedactionError(`RED content blocked: matched trigger "${trigger}"`, trigger)
  }

  if (classification === 'GREEN') {
    return { classification: 'GREEN', content, redactions_applied: [] }
  }

  let redacted = content
  const applied = []

  for (const [name, pattern] of Object.entries(AMBER_PATTERNS)) {
    pattern.lastIndex = 0
    const matches = redacted.match(pattern) || []
    if (matches.length > 0) {
      redacted = redacted.replace(pattern, AMBER_REPLACEMENTS[name])
      applied.push({ type: name, count: matches.length, replacement: AMBER_REPLACEMENTS[name] })
    }
  }

  return { classification: 'AMBER', content: redacted, redactions_applied: applied }
}

function redactBatch(parsedFiles) {
  const results = []
  const stats = { processed: 0, redacted: 0, blocked: 0, green: 0 }

  for (const file of parsedFiles) {
    stats.processed++
    const rawText = file?.raw_text ?? ''

    try {
      const { classification, content, redactions_applied } = redact(rawText)

      if (classification === 'AMBER') stats.redacted++
      else stats.green++

      results.push({
        ...file,
        raw_text: content,
        classification,
        redactions_applied,
      })
    } catch (err) {
      stats.blocked++
      console.log(`[pii_redactor] BLOCKED ${file?.file_path || '(unknown)'} — ${err.message}`)
    }
  }

  return { ...stats, results }
}

module.exports = {
  classify,
  redact,
  redactBatch,
  RedactionError,
  RED_TRIGGERS,
  AMBER_PATTERNS,
}
