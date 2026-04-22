const { loadSchema, filterSignal, mergeAndValidate } = require('../src/ingestion/entity_extractor')

describe('loadSchema', () => {
  test('loads and parses graph/schema.json successfully', async () => {
    const schema = await loadSchema()
    expect(schema).toBeTruthy()
    expect(schema.entities).toBeDefined()
    expect(schema._meta).toBeDefined()
  })

  test('schema contains all 8 required entity types', async () => {
    const schema = await loadSchema()
    const entityTypes = Object.keys(schema.entities)
    expect(entityTypes).toContain('PERSON')
    expect(entityTypes).toContain('PROJECT')
    expect(entityTypes).toContain('DECISION')
    expect(entityTypes).toContain('DOCUMENT')
    expect(entityTypes).toContain('MEETING')
    expect(entityTypes).toContain('TOPIC')
    expect(entityTypes).toContain('FILE_SOURCE')
    expect(entityTypes).toContain('DELTA_EVENT')
  })

  test('PERSON entity has required fields', async () => {
    const schema = await loadSchema()
    const personFields = schema.entities.PERSON.fields
    expect(personFields.id).toBeDefined()
    expect(personFields.id.required).toBe(true)
    expect(personFields.name).toBeDefined()
    expect(personFields.name.required).toBe(true)
    expect(personFields.ingested_at).toBeDefined()
    expect(personFields.source_file).toBeDefined()
    expect(personFields.checksum).toBeDefined()
  })

  test('FILE_SOURCE entity has transcription fields', async () => {
    const schema = await loadSchema()
    const fsFields = schema.entities.FILE_SOURCE.fields
    expect(fsFields.transcription_id).toBeDefined()
    expect(fsFields.transcription_cost_usd).toBeDefined()
    expect(fsFields.checksum).toBeDefined()
    expect(fsFields.ingestion_status).toBeDefined()
  })

  test('DELTA_EVENT has all 6 event types in enum', async () => {
    const schema = await loadSchema()
    const eventTypeField = schema.entities.DELTA_EVENT.fields.event_type
    expect(eventTypeField.enum).toContain('NODE_CREATED')
    expect(eventTypeField.enum).toContain('NODE_UPDATED')
    expect(eventTypeField.enum).toContain('EDGE_CREATED')
    expect(eventTypeField.enum).toContain('EDGE_UPDATED')
    expect(eventTypeField.enum).toContain('PURGE')
    expect(eventTypeField.enum).toContain('SYNC_CHECKPOINT')
  })

  test('schema contains relationships array', async () => {
    const schema = await loadSchema()
    expect(Array.isArray(schema.relationships)).toBe(true)
    expect(schema.relationships.length).toBeGreaterThan(0)
  })
})

describe('filterSignal', () => {
  test('returns false for empty content', () => {
    expect(filterSignal('')).toBe(false)
    expect(filterSignal(null)).toBe(false)
    expect(filterSignal(undefined)).toBe(false)
  })

  test('returns false for content below 50 words', () => {
    const shortContent = 'This is a very short piece of text.'
    expect(filterSignal(shortContent)).toBe(false)
  })

  test('returns true for content with 50+ words', () => {
    const longContent = 'The Atlas project team met on Monday April 22nd to review the Q1 vendor selection process. James Tan, the Project Lead, presented three vendor options: Option A from Vendor Corp, Option B from Tech Solutions, and Option C from DataSystems. After discussion, the steering committee decided to proceed with Option B based on cost and delivery timeline. Next steps include contract negotiation and onboarding by May 15th.'
    expect(filterSignal(longContent)).toBe(true)
  })

  test('returns false for boilerplate disclaimer text', () => {
    const boilerplate = 'Confidentiality notice: This email and any attachments are for the exclusive and confidential use of the intended recipient.'
    expect(filterSignal(boilerplate)).toBe(false)
  })

  test('returns true for meeting transcript content', () => {
    const transcript = 'James: Good morning everyone. Sarah: Good morning. Today we are discussing the Atlas rollout timeline. James: The engineering team has completed the core graph module. Sarah: When can we expect the UI to be ready? James: Target is end of May. We decided last week that the MVP needs to support all 18 file types before launch.'
    expect(filterSignal(transcript)).toBe(true)
  })
})

describe('mergeAndValidate', () => {
  test('returns nodes and edges arrays', async () => {
    await loadSchema()
    const mockResults = [
      {
        skipped: false,
        source_file: '/test/doc.txt',
        source_checksum: 'abc123',
        entities: {
          PERSON: [{ id: 'p1', name: 'James Tan', role: 'Project Lead', ingested_at: new Date().toISOString(), source_file: '/test/doc.txt', checksum: 'abc' }],
          PROJECT: [{ id: 'proj1', name: 'Atlas', status: 'active', ingested_at: new Date().toISOString(), source_file: '/test/doc.txt', checksum: 'def' }],
          DECISION: [], MEETING: [], TOPIC: [], FILE_SOURCE: [], DOCUMENT: [],
        },
        edges: [{ id: 'e1', from_id: 'p1', from_type: 'PERSON', to_id: 'proj1', to_type: 'PROJECT', relationship: 'CONTRIBUTED_TO', created_at: new Date().toISOString(), source_file: '/test/doc.txt' }],
        extraction_errors: [],
      },
    ]

    const result = await mergeAndValidate(mockResults)
    expect(result).toHaveProperty('nodes')
    expect(result).toHaveProperty('edges')
    expect(Array.isArray(result.nodes)).toBe(true)
    expect(Array.isArray(result.edges)).toBe(true)
    expect(result.nodes.length).toBeGreaterThan(0)
  })

  test('skips results marked as skipped', async () => {
    await loadSchema()
    const mockResults = [
      { skipped: true, source_file: '/test/red.txt', entities: {}, edges: [], skip_reason: 'RED classification' },
      {
        skipped: false,
        source_file: '/test/ok.txt',
        entities: {
          PERSON: [{ id: 'p2', name: 'Sarah', ingested_at: new Date().toISOString(), source_file: '/test/ok.txt', checksum: 'xyz' }],
          PROJECT: [], DECISION: [], MEETING: [], TOPIC: [], FILE_SOURCE: [], DOCUMENT: [],
        },
        edges: [],
        extraction_errors: [],
      },
    ]

    const result = await mergeAndValidate(mockResults)
    const names = result.nodes.map(n => n.data.name)
    expect(names).toContain('Sarah')
  })

  test('deduplicates entities with same name and type', async () => {
    await loadSchema()
    const mockResults = [
      {
        skipped: false,
        source_file: '/test/doc1.txt',
        entities: {
          PERSON: [{ id: 'p3a', name: 'Alice Wong', role: 'Lead', ingested_at: new Date().toISOString(), source_file: '/test/doc1.txt', checksum: 'aaa' }],
          PROJECT: [], DECISION: [], MEETING: [], TOPIC: [], FILE_SOURCE: [], DOCUMENT: [],
        },
        edges: [],
        extraction_errors: [],
      },
      {
        skipped: false,
        source_file: '/test/doc2.txt',
        entities: {
          PERSON: [{ id: 'p3b', name: 'Alice Wong', role: 'Senior Lead', ingested_at: new Date().toISOString(), source_file: '/test/doc2.txt', checksum: 'bbb' }],
          PROJECT: [], DECISION: [], MEETING: [], TOPIC: [], FILE_SOURCE: [], DOCUMENT: [],
        },
        edges: [],
        extraction_errors: [],
      },
    ]

    const result = await mergeAndValidate(mockResults)
    const aliceNodes = result.nodes.filter(n => n.type === 'PERSON' && n.data.name === 'Alice Wong')
    expect(aliceNodes.length).toBe(1)
  })
})
