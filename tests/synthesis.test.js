const graphStore = require('../src/graph/graph_store')
const deltaTracker = require('../src/graph/delta_tracker')
const { collectProjectNodes } = require('../src/synthesis/brief_generator')
const { collectPersonContext } = require('../src/synthesis/handover_builder')

beforeEach(() => {
  graphStore._resetForTests()
  deltaTracker._resetForTests()
})

describe('brief_generator.collectProjectNodes', () => {
  test('returns project-matching nodes and connected nodes', () => {
    graphStore.upsertNode({ id: 'project_phoenix', type: 'PROJECT', attributes: { name: 'Project Phoenix' }, source_file: '/x.txt' })
    graphStore.upsertNode({ id: 'person_sarah', type: 'PERSON', attributes: { name: 'Sarah Chen' }, source_file: '/x.txt' })
    graphStore.upsertNode({ id: 'unrelated_topic', type: 'TOPIC', attributes: { label: 'completely unrelated' }, source_file: '/y.txt' })
    graphStore.upsertEdge({ source_id: 'person_sarah', target_id: 'project_phoenix', relationship_type: 'CONTRIBUTED_TO' })

    const bundle = collectProjectNodes('Phoenix')
    const ids = bundle.all.map(n => n.id)
    expect(ids).toContain('project_phoenix')
    expect(ids).toContain('person_sarah')
    expect(ids).not.toContain('unrelated_topic')
  })
})

describe('handover_builder.collectPersonContext', () => {
  test('collects persons and their connected entities', () => {
    graphStore.upsertNode({ id: 'person_james', type: 'PERSON', attributes: { name: 'James Tan', role: 'Procurement' }, source_file: '/a.txt' })
    graphStore.upsertNode({ id: 'decision_vendor', type: 'DECISION', attributes: { summary: 'Select vendor' }, source_file: '/a.txt' })
    graphStore.upsertNode({ id: 'project_phoenix', type: 'PROJECT', attributes: { name: 'Project Phoenix' }, source_file: '/a.txt' })
    graphStore.upsertEdge({ source_id: 'person_james', target_id: 'decision_vendor', relationship_type: 'MADE' })
    graphStore.upsertEdge({ source_id: 'person_james', target_id: 'project_phoenix', relationship_type: 'CONTRIBUTED_TO' })

    const ctx = collectPersonContext('James')
    expect(ctx.persons).toHaveLength(1)
    expect(ctx.decisions.map(d => d.id)).toContain('decision_vendor')
    expect(ctx.projects.map(p => p.id)).toContain('project_phoenix')
  })

  test('returns empty persons array for unknown name', () => {
    const ctx = collectPersonContext('Nobody')
    expect(ctx.persons).toHaveLength(0)
  })
})
