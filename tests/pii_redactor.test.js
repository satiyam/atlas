const { classify, redact, redactBatch } = require('../src/ingestion/pii_redactor')

function makeFile(rawText, filename = 'test.txt', fileType = '.txt') {
  return {
    file_path: `/test/${filename}`,
    filename,
    file_type: fileType,
    raw_text: rawText,
    metadata: { author: null, created_at: null, page_count: null, duration_seconds: null, transcription_id: null, transcription_cost_usd: null, language: null },
    parse_error: null,
  }
}

describe('classify — GREEN cases', () => {
  test('classifies clean project content as GREEN', () => {
    const content = 'The Atlas project is progressing well. The team met on Monday to review the vendor proposal and decided to proceed with Option B.'
    expect(classify(content)).toBe('GREEN')
  })

  test('classifies technical documentation as GREEN', () => {
    const content = 'The API endpoint accepts a POST request with a JSON body containing the query parameter. Returns a 200 status with the graph results.'
    expect(classify(content)).toBe('GREEN')
  })

  test('classifies meeting notes as GREEN when no PII present', () => {
    const content = 'Steering committee agreed to extend the project timeline by two weeks. Action item: prepare updated Gantt chart by Friday.'
    expect(classify(content)).toBe('GREEN')
  })
})

describe('classify — AMBER cases', () => {
  test('classifies content with email address as AMBER', () => {
    const content = 'Please contact james.tan@temus.com for more information about the project.'
    expect(classify(content)).toBe('AMBER')
  })

  test('classifies content with Singapore NRIC as AMBER', () => {
    const content = 'Employee ID: S1234567A. Please process the access request.'
    expect(classify(content)).toBe('AMBER')
  })

  test('classifies content with phone number as AMBER', () => {
    const content = 'Call 9123 4567 to reach the project lead.'
    expect(classify(content)).toBe('AMBER')
  })
})

describe('classify — RED cases', () => {
  test('classifies salary content as RED', () => {
    const content = 'The salary for this role is SGD 8,500 per month.'
    expect(classify(content)).toBe('RED')
  })

  test('classifies performance review content as RED', () => {
    const content = 'The performance review for Q3 shows the employee is underperforming against targets.'
    expect(classify(content)).toBe('RED')
  })

  test('classifies medical record content as RED', () => {
    const content = 'Medical record shows the employee has a disability affecting mobility.'
    expect(classify(content)).toBe('RED')
  })

  test('classifies termination content as RED', () => {
    const content = 'The termination letter was sent to the employee on 15 April 2026.'
    expect(classify(content)).toBe('RED')
  })

  test('classifies PIP content as RED', () => {
    const content = 'The employee has been placed on a performance improvement plan effective immediately.'
    expect(classify(content)).toBe('RED')
  })

  test('classifies compensation content as RED', () => {
    const content = 'Total compensation package including base, bonus, and equity.'
    expect(classify(content)).toBe('RED')
  })

  test('classifies HR investigation content as RED', () => {
    const content = 'The HR investigation into the misconduct allegation is ongoing.'
    expect(classify(content)).toBe('RED')
  })
})

describe('redact — GREEN content', () => {
  test('returns GREEN content unchanged', () => {
    const file = makeFile('The project is on track. Team delivered the milestone on time.')
    const result = redact(file)
    expect(result.classification).toBe('GREEN')
    expect(result.content).toBe(file.raw_text)
    expect(result.redacted).toBe(false)
    expect(result.blocked).toBe(false)
  })
})

describe('redact — AMBER content', () => {
  test('anonymises email addresses', () => {
    const file = makeFile('Contact james.tan@temus.com for project access.')
    const result = redact(file)
    expect(result.classification).toBe('AMBER')
    expect(result.content).not.toContain('james.tan')
    expect(result.content).toContain('[name]@temus.com')
    expect(result.transforms_applied).toContain('email_anonymised')
    expect(result.blocked).toBe(false)
  })

  test('redacts NRIC/FIN numbers', () => {
    const file = makeFile('Employee NRIC: S1234567A. Process the request.')
    const result = redact(file)
    expect(result.classification).toBe('AMBER')
    expect(result.content).not.toContain('S1234567A')
    expect(result.content).toContain('[REDACTED-ID]')
    expect(result.transforms_applied).toContain('nric_fin_redacted')
  })

  test('redacts phone numbers', () => {
    const file = makeFile('Call 9123 4567 to reach the office.')
    const result = redact(file)
    expect(result.classification).toBe('AMBER')
    expect(result.content).toContain('[REDACTED-PHONE]')
    expect(result.transforms_applied).toContain('phone_redacted')
  })
})

describe('redact — RED content', () => {
  test('blocks RED content and returns null content', () => {
    const file = makeFile('The salary for this position is SGD 10,000.')
    const result = redact(file)
    expect(result.classification).toBe('RED')
    expect(result.content).toBeNull()
    expect(result.blocked).toBe(true)
    expect(result.block_reason).toBeTruthy()
  })

  test('preserves original checksum for audit trail', () => {
    const file = makeFile('Disciplinary action was taken against the employee.')
    const result = redact(file)
    expect(result.original_checksum).toBeTruthy()
    expect(typeof result.original_checksum).toBe('string')
    expect(result.original_checksum.length).toBe(64)
  })
})

describe('redactBatch', () => {
  test('processes multiple files in parallel and returns array', async () => {
    const files = [
      makeFile('Clean project content here.', 'project.txt'),
      makeFile('Contact user@company.com for details.', 'email.txt'),
      makeFile('Performance improvement plan initiated.', 'pip.txt'),
    ]
    const results = await redactBatch(files)
    expect(results).toHaveLength(3)
    expect(results[0].classification).toBe('GREEN')
    expect(results[1].classification).toBe('AMBER')
    expect(results[2].classification).toBe('RED')
  })

  test('batch does not let RED files contaminate other results', async () => {
    const files = [
      makeFile('Clean content A.', 'a.txt'),
      makeFile('Salary information is confidential.', 'b.txt'),
      makeFile('Clean content C.', 'c.txt'),
    ]
    const results = await redactBatch(files)
    expect(results[0].classification).toBe('GREEN')
    expect(results[1].classification).toBe('RED')
    expect(results[2].classification).toBe('GREEN')
    expect(results[0].content).toBeTruthy()
    expect(results[2].content).toBeTruthy()
  })
})
