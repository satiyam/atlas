const {
  loadSchema,
  filterSignal,
  mergeAndValidate,
  slugify,
  extractJsonBlock,
  _resetSchemaCacheForTests,
} = require('../src/ingestion/entity_extractor')

beforeEach(() => _resetSchemaCacheForTests())

describe('loadSchema', () => {
  test('reads graph/schema.json at runtime and caches it', () => {
    const s1 = loadSchema()
    const s2 = loadSchema()
    expect(s1).toBe(s2)
    expect(s1.entities).toBeDefined()
  })

  test('validates all 8 entity types present', () => {
    const schema = loadSchema()
    const required = ['PERSON', 'PROJECT', 'DECISION', 'DOCUMENT', 'MEETING', 'TOPIC', 'FILE_SOURCE', 'DELTA_EVENT']
    for (const type of required) {
      expect(schema.entities[type]).toBeDefined()
    }
  })
})

describe('filterSignal', () => {
  test('returns isSignal: false for short content', () => {
    const result = filterSignal('Hello team. Short update today.')
    expect(result.isSignal).toBe(false)
    expect(result.reason).toMatch(/word threshold/i)
  })

  test('returns isSignal: false for empty content', () => {
    expect(filterSignal('').isSignal).toBe(false)
    expect(filterSignal(null).isSignal).toBe(false)
  })

  test('returns isSignal: true when content contains decision language', () => {
    const content = 'The steering committee met on Monday to review the vendor proposals. After extensive discussion, ' +
      'the team decided to select TechCorp as the primary vendor for Project Phoenix. Sarah Chen will lead the ' +
      'procurement workstream and begin onboarding activities next week. The decision was agreed upon by all stakeholders ' +
      'and confirmed with executive sponsorship.'
    const result = filterSignal(content)
    expect(result.isSignal).toBe(true)
    expect(result.markers.decision).toBe(true)
  })

  test('returns isSignal: true when content contains project references', () => {
    const content = 'Project Phoenix is the flagship initiative for the Meridian organisation this year. The project ' +
      'covers three major workstreams across procurement, engineering, and operations. Phase one of the initiative ' +
      'focuses on vendor assessment, phase two covers implementation, and phase three handles rollout across departments. ' +
      'The workstream leads report weekly to the steering committee.'
    const result = filterSignal(content)
    expect(result.isSignal).toBe(true)
    expect(result.markers.project).toBe(true)
  })

  test('returns isSignal: false for duplicate checksum', () => {
    const content = 'Project Phoenix is the flagship initiative for the Meridian organisation this year. ' +
      'The project covers three major workstreams across procurement, engineering, and operations. ' +
      'After lengthy review the steering committee approved the scope and confirmed funding for all phases. ' +
      'Sarah Chen will lead the procurement workstream and begin onboarding activities next week. ' +
      'The team decided to proceed with the recommended vendor and agreed to the implementation timeline.'
    const first = filterSignal(content, 'checksum123')
    expect(first.isSignal).toBe(true)
    const second = filterSignal(content, 'checksum123')
    expect(second.isSignal).toBe(false)
    expect(second.reason).toMatch(/duplicate/i)
  })
})

describe('slugify', () => {
  test('converts names to lowercase underscore format', () => {
    expect(slugify('Sarah Chen')).toBe('sarah_chen')
    expect(slugify('Project Phoenix!')).toBe('project_phoenix')
    expect(slugify('  Decision 2026  ')).toBe('decision_2026')
  })

  test('handles empty and nullish input', () => {
    expect(slugify('')).toBe('unknown')
    expect(slugify(null)).toBe('unknown')
  })
})

describe('extractJsonBlock', () => {
  test('parses a fenced JSON response', () => {
    const text = 'Here is the result:\n```json\n{"nodes": [], "edges": []}\n```'
    const parsed = extractJsonBlock(text)
    expect(parsed).toEqual({ nodes: [], edges: [] })
  })

  test('parses a raw JSON object in text', () => {
    const text = 'Response: {"nodes": [{"id": "x"}], "edges": []}'
    const parsed = extractJsonBlock(text)
    expect(parsed.nodes).toHaveLength(1)
  })

  test('returns null on malformed JSON', () => {
    expect(extractJsonBlock('no json here')).toBeNull()
  })
})

describe('mergeAndValidate', () => {
  const meridianExtraction = {
    nodes: [
      {
        id: 'person_sarah_chen',
        type: 'PERSON',
        attributes: { name: 'Sarah Chen', role: 'Procurement Lead' },
        source_file: '/meridian/phoenix-decision.txt',
        ingested_at: '2026-04-22T10:00:00Z',
        checksum: 'abc123',
      },
      {
        id: 'decision_select_techcorp',
        type: 'DECISION',
        attributes: { summary: 'Selected TechCorp as primary vendor for Project Phoenix', date: '2026-04-15' },
        source_file: '/meridian/phoenix-decision.txt',
        ingested_at: '2026-04-22T10:00:00Z',
        checksum: 'abc123',
      },
      {
        id: 'project_phoenix',
        type: 'PROJECT',
        attributes: { name: 'Project Phoenix', status: 'active' },
        source_file: '/meridian/phoenix-decision.txt',
        ingested_at: '2026-04-22T10:00:00Z',
        checksum: 'abc123',
      },
    ],
    edges: [
      { source_id: 'person_sarah_chen', target_id: 'decision_select_techcorp', relationship_type: 'MADE' },
      { source_id: 'person_sarah_chen', target_id: 'project_phoenix', relationship_type: 'CONTRIBUTED_TO' },
    ],
    source_file: '/meridian/phoenix-decision.txt',
    checksum: 'abc123',
  }

  test('extracts PERSON and DECISION nodes from Meridian sample', () => {
    const result = mergeAndValidate([meridianExtraction])
    const personNode = result.nodes.find(n => n.type === 'PERSON')
    const decisionNode = result.nodes.find(n => n.type === 'DECISION')

    expect(personNode).toBeDefined()
    expect(personNode.attributes.name).toBe('Sarah Chen')
    expect(decisionNode).toBeDefined()
    expect(decisionNode.attributes.summary).toContain('TechCorp')
  })

  test('deduplicates nodes by id keeping the most recent', () => {
    const extractions = [
      { nodes: [{ id: 'person_sarah', type: 'PERSON', attributes: { name: 'Sarah', role: 'PM' }, ingested_at: '2026-04-22T10:00:00Z' }], edges: [] },
      { nodes: [{ id: 'person_sarah', type: 'PERSON', attributes: { name: 'Sarah', role: 'Lead PM', team: 'Product' }, ingested_at: '2026-04-22T11:00:00Z' }], edges: [] },
    ]
    const result = mergeAndValidate(extractions)
    expect(result.nodes).toHaveLength(1)
    expect(result.nodes[0].attributes.role).toBe('Lead PM')
    expect(result.nodes[0].attributes.team).toBe('Product')
  })

  test('rejects nodes with invalid types', () => {
    const extractions = [{
      nodes: [
        { id: 'x1', type: 'PERSON', attributes: {}, ingested_at: '2026-04-22T10:00:00Z' },
        { id: 'x2', type: 'NOT_A_TYPE', attributes: {}, ingested_at: '2026-04-22T10:00:00Z' },
      ],
      edges: [],
    }]
    const result = mergeAndValidate(extractions)
    expect(result.nodes).toHaveLength(1)
    expect(result.rejected.some(r => r.reason.includes('invalid type'))).toBe(true)
  })

  test('rejects edges with invalid relationship_type', () => {
    const extractions = [{
      nodes: [
        { id: 'a', type: 'PERSON', attributes: {}, ingested_at: '2026-04-22T10:00:00Z' },
        { id: 'b', type: 'PROJECT', attributes: {}, ingested_at: '2026-04-22T10:00:00Z' },
      ],
      edges: [
        { source_id: 'a', target_id: 'b', relationship_type: 'MADE_UP_RELATIONSHIP' },
      ],
    }]
    const result = mergeAndValidate(extractions)
    expect(result.edges).toHaveLength(0)
    expect(result.rejected.some(r => r.kind === 'edge')).toBe(true)
  })

  test('drops orphan edges (pointing to non-existent nodes)', () => {
    const extractions = [{
      nodes: [{ id: 'a', type: 'PERSON', attributes: {}, ingested_at: '2026-04-22T10:00:00Z' }],
      edges: [{ source_id: 'a', target_id: 'nonexistent', relationship_type: 'MADE' }],
    }]
    const result = mergeAndValidate(extractions)
    expect(result.edges).toHaveLength(0)
    expect(result.summary.orphan_edges_dropped).toBe(1)
  })

  test('summary reports node counts by type', () => {
    const result = mergeAndValidate([meridianExtraction])
    expect(result.summary.by_type.PERSON).toBe(1)
    expect(result.summary.by_type.PROJECT).toBe(1)
    expect(result.summary.by_type.DECISION).toBe(1)
  })
})
