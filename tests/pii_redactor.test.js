const { classify, redact, redactBatch, RedactionError } = require('../src/ingestion/pii_redactor')

describe('classify', () => {
  test('GREEN: clean organisational content', () => {
    expect(classify('Project Phoenix met on Monday to review vendor proposals.')).toBe('GREEN')
  })

  test('GREEN: empty or null input defaults to GREEN', () => {
    expect(classify('')).toBe('GREEN')
    expect(classify(null)).toBe('GREEN')
    expect(classify(undefined)).toBe('GREEN')
  })

  test('AMBER: content with email address', () => {
    expect(classify('Please contact sarah.chen@phoenix.com for the vendor list.')).toBe('AMBER')
  })

  test('AMBER: content with Singapore NRIC', () => {
    expect(classify('Employee record S1234567A was updated today.')).toBe('AMBER')
  })

  test('AMBER: content with Singapore phone number', () => {
    expect(classify('Reach me on 91234567 for project updates.')).toBe('AMBER')
  })

  test('RED: content mentioning salary', () => {
    expect(classify('The salary for this role is under review.')).toBe('RED')
  })

  test('RED: content mentioning termination', () => {
    expect(classify('Termination of employment effective immediately.')).toBe('RED')
  })

  test('RED: content mentioning disciplinary action', () => {
    expect(classify('Disciplinary hearing scheduled for Monday.')).toBe('RED')
  })

  test('RED: content mentioning PIP', () => {
    expect(classify('Employee placed on PIP this quarter.')).toBe('RED')
  })

  test('RED: RED takes precedence over AMBER', () => {
    expect(classify('Contact sarah@phoenix.com regarding the salary review.')).toBe('RED')
  })
})

describe('redact', () => {
  test('GREEN content passes through unchanged', () => {
    const result = redact('Project Phoenix vendor selection process.')
    expect(result.classification).toBe('GREEN')
    expect(result.content).toBe('Project Phoenix vendor selection process.')
    expect(result.redactions_applied).toEqual([])
  })

  test('AMBER: email is replaced with [EMAIL REDACTED]', () => {
    const result = redact('Contact sarah.chen@phoenix.com today.')
    expect(result.classification).toBe('AMBER')
    expect(result.content).not.toContain('sarah.chen@phoenix.com')
    expect(result.content).toContain('[EMAIL REDACTED]')
    expect(result.redactions_applied.some(r => r.type === 'email')).toBe(true)
  })

  test('AMBER: NRIC is replaced with [ID REDACTED]', () => {
    const result = redact('Record S1234567A needs review.')
    expect(result.classification).toBe('AMBER')
    expect(result.content).not.toContain('S1234567A')
    expect(result.content).toContain('[ID REDACTED]')
    expect(result.redactions_applied.some(r => r.type === 'nric')).toBe(true)
  })

  test('AMBER: SG phone number is replaced with [PHONE REDACTED]', () => {
    const result = redact('Call 91234567 for updates.')
    expect(result.classification).toBe('AMBER')
    expect(result.content).not.toContain('91234567')
    expect(result.content).toContain('[PHONE REDACTED]')
    expect(result.redactions_applied.some(r => r.type === 'sgPhone')).toBe(true)
  })

  test('AMBER: multiple PII types are all redacted', () => {
    const result = redact('Contact sarah@x.com or 91234567. Record S1234567A.')
    expect(result.classification).toBe('AMBER')
    expect(result.content).toContain('[EMAIL REDACTED]')
    expect(result.content).toContain('[PHONE REDACTED]')
    expect(result.content).toContain('[ID REDACTED]')
    expect(result.redactions_applied).toHaveLength(3)
  })

  test('RED content throws RedactionError', () => {
    expect(() => redact('Salary adjustment pending.')).toThrow(RedactionError)
    expect(() => redact('Termination effective today.')).toThrow(/RED content blocked/)
  })
})

describe('redactBatch', () => {
  test('processes mixed GREEN/AMBER/RED batch correctly', () => {
    const files = [
      { file_path: '/a.txt', raw_text: 'Clean project content here.' },
      { file_path: '/b.txt', raw_text: 'Contact sarah@phoenix.com about procurement.' },
      { file_path: '/c.txt', raw_text: 'Salary review is scheduled.' },
      { file_path: '/d.txt', raw_text: 'Another clean document.' },
    ]

    const batch = redactBatch(files)

    expect(batch.processed).toBe(4)
    expect(batch.green).toBe(2)
    expect(batch.redacted).toBe(1)
    expect(batch.blocked).toBe(1)
    expect(batch.results).toHaveLength(3)

    const paths = batch.results.map(r => r.file_path)
    expect(paths).not.toContain('/c.txt')
  })

  test('results carry classification and redactions_applied', () => {
    const files = [
      { file_path: '/a.txt', raw_text: 'Clean content.' },
      { file_path: '/b.txt', raw_text: 'Email: alice@acme.com here.' },
    ]
    const batch = redactBatch(files)
    expect(batch.results[0].classification).toBe('GREEN')
    expect(batch.results[1].classification).toBe('AMBER')
    expect(batch.results[1].raw_text).toContain('[EMAIL REDACTED]')
  })

  test('empty batch returns zero counts', () => {
    const batch = redactBatch([])
    expect(batch).toEqual({ processed: 0, redacted: 0, blocked: 0, green: 0, results: [] })
  })
})
