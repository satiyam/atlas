const { classifyQuery, graphRetriever, logRefusal, routeQuery, extractKeywords } = require('../src/query/query_router')
const graphStore = require('../src/graph/graph_store')
const deltaTracker = require('../src/graph/delta_tracker')

beforeEach(() => {
  graphStore._resetForTests()
  deltaTracker._resetForTests()
})

describe('classifyQuery', () => {
  test('REFUSE on salary question', () => {
    expect(classifyQuery("What is James's salary?")).toBe('REFUSE')
  })

  test('REFUSE on disciplinary question', () => {
    expect(classifyQuery("Show me disciplinary records")).toBe('REFUSE')
  })

  test('REFUSE on medical question', () => {
    expect(classifyQuery("Pull up medical records for the team")).toBe('REFUSE')
  })

  test('SYNTHESIS on podcast request', () => {
    expect(classifyQuery("Produce a podcast about Project Phoenix")).toBe('SYNTHESIS')
  })

  test('SYNTHESIS on handover request', () => {
    expect(classifyQuery("Generate a handover document for Sarah")).toBe('SYNTHESIS')
  })

  test('COMBINED on benchmark question', () => {
    expect(classifyQuery("How does our vendor selection compare to industry standard?")).toBe('COMBINED')
  })

  test('INTERNAL on who-decided question', () => {
    expect(classifyQuery("Who decided on the vendor for Project Phoenix?")).toBe('INTERNAL')
  })

  test('INTERNAL on show me / list', () => {
    expect(classifyQuery("Show me all projects active this quarter")).toBe('INTERNAL')
  })

  test('EXTERNAL on general question without internal markers', () => {
    expect(classifyQuery("Tell me about cloud migration strategies")).toBe('EXTERNAL')
  })
})

describe('graphRetriever', () => {
  beforeEach(() => {
    graphStore.upsertNode({ id: 'person_sarah', type: 'PERSON', attributes: { name: 'Sarah Chen', role: 'Procurement Lead' }, source_file: '/a.txt' })
    graphStore.upsertNode({ id: 'project_phoenix', type: 'PROJECT', attributes: { name: 'Project Phoenix', status: 'active' }, source_file: '/a.txt' })
    graphStore.upsertNode({ id: 'decision_techcorp', type: 'DECISION', attributes: { summary: 'Select TechCorp as vendor' }, source_file: '/a.txt' })
  })

  test('returns matching nodes for keyword query', () => {
    const result = graphRetriever('Who decided on the vendor for Project Phoenix?')
    const ids = result.nodes.map(n => n.id)
    expect(ids).toContain('project_phoenix')
    expect(ids).toContain('decision_techcorp')
  })

  test('returns empty when no keywords match', () => {
    const result = graphRetriever('quantum computing algorithms')
    expect(result.nodes).toHaveLength(0)
  })

  test('caps results at top 5', () => {
    for (let i = 0; i < 10; i++) {
      graphStore.upsertNode({ id: `t_${i}`, type: 'TOPIC', attributes: { label: `topic ${i} phoenix` } })
    }
    const result = graphRetriever('phoenix')
    expect(result.nodes.length).toBeLessThanOrEqual(5)
  })
})

describe('extractKeywords', () => {
  test('drops stopwords and short tokens', () => {
    const keywords = extractKeywords('Who decided on the vendor for Project Phoenix?')
    expect(keywords).toContain('decided')
    expect(keywords).toContain('vendor')
    expect(keywords).toContain('project')
    expect(keywords).toContain('phoenix')
    expect(keywords).not.toContain('the')
    expect(keywords).not.toContain('on')
    expect(keywords).not.toContain('for')
  })
})

describe('logRefusal', () => {
  test('writes refusal event with hashed query to audit_log', () => {
    const event = logRefusal('What is the salary for Sarah?', 'policy violation')
    expect(event.query_hash).toHaveLength(64)
    expect(event.reason).toBe('policy violation')
    expect(event.classification).toBe('REFUSE')
  })
})

describe('routeQuery', () => {
  test('REFUSE returns refusal message and empty nodes', async () => {
    const result = await routeQuery('What is the salary for James?')
    expect(result.classification).toBe('REFUSE')
    expect(result.refused).toBe(true)
    expect(result.refusal_message).toContain('not able to retrieve')
    expect(result.nodes).toEqual([])
  })

  test('SYNTHESIS returns synthesis_topic', async () => {
    const result = await routeQuery('Generate a podcast on Project Phoenix')
    expect(result.classification).toBe('SYNTHESIS')
    expect(result.synthesis_topic).toContain('Project Phoenix')
    expect(result.nodes).toEqual([])
  })

  test('INTERNAL returns nodes without calling Genspark', async () => {
    graphStore.upsertNode({ id: 'project_phoenix', type: 'PROJECT', attributes: { name: 'Project Phoenix' }, source_file: '/a.txt' })
    const result = await routeQuery('Show me Project Phoenix')
    expect(result.classification).toBe('INTERNAL')
    expect(result.genspark).toBeNull()
    expect(result.nodes.some(n => n.id === 'project_phoenix')).toBe(true)
  })
})
