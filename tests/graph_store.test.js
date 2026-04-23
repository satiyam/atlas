const fs = require('fs')
const path = require('path')

const deltaTracker = require('../src/graph/delta_tracker')
const graphStore = require('../src/graph/graph_store')

beforeEach(() => {
  graphStore._resetForTests()
  deltaTracker._resetForTests()
})

describe('delta_tracker', () => {
  test('appendEvent generates id and timestamp', () => {
    const event = deltaTracker.appendEvent({ event_type: 'TEST', operation: 'X' })
    expect(event.id).toMatch(/^evt_/)
    expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  test('getLastCursor returns epoch when no checkpoints exist', () => {
    expect(deltaTracker.getLastCursor()).toBe('1970-01-01T00:00:00.000Z')
  })

  test('writeCheckpoint creates a SYNC_CHECKPOINT event', () => {
    const event = deltaTracker.writeCheckpoint()
    expect(event.event_type).toBe('SYNC_CHECKPOINT')
    expect(event.cursor).toBeTruthy()
    expect(deltaTracker.getLastCursor()).toBe(event.cursor)
  })

  test('getEventsSince returns only events after cursor', () => {
    const first = deltaTracker.appendEvent({ event_type: 'A' })
    const cursor = new Date().toISOString()
    // Brief delay so second timestamp is strictly after cursor
    const waitUntilFuture = Date.now() + 5
    while (Date.now() < waitUntilFuture) { /* spin */ }
    deltaTracker.appendEvent({ event_type: 'B' })
    const since = deltaTracker.getEventsSince(cursor)
    expect(since.map(e => e.event_type)).toContain('B')
    expect(since.map(e => e.event_type)).not.toContain('A')
  })
})

describe('graph_store.upsertNode', () => {
  test('INSERT returns operation INSERT for new node', () => {
    const result = graphStore.upsertNode({
      id: 'person_sarah',
      type: 'PERSON',
      attributes: { name: 'Sarah Chen' },
      source_file: '/x.txt',
    })
    expect(result.operation).toBe('INSERT')
    expect(result.node_id).toBe('person_sarah')
  })

  test('UPDATE returns operation UPDATE when node exists', () => {
    graphStore.upsertNode({ id: 'p1', type: 'PROJECT', attributes: { name: 'Phoenix' } })
    const result = graphStore.upsertNode({ id: 'p1', type: 'PROJECT', attributes: { name: 'Phoenix', status: 'active' } })
    expect(result.operation).toBe('UPDATE')
    const nodes = graphStore.readNodes()
    expect(nodes.p1.attributes.status).toBe('active')
  })

  test('writes node to nodes.json and emits UPSERT event', () => {
    graphStore.upsertNode({ id: 'person_james', type: 'PERSON', attributes: { name: 'James Tan' } })
    const nodes = graphStore.readNodes()
    expect(nodes.person_james).toBeDefined()
    const events = deltaTracker.readAllEvents()
    expect(events.some(e => e.event_type === 'UPSERT' && e.entity_id === 'person_james')).toBe(true)
  })

  test('skips nodes without id or type', () => {
    const result = graphStore.upsertNode({ type: 'PERSON' })
    expect(result.operation).toBe('SKIPPED')
  })
})

describe('graph_store.upsertEdge', () => {
  test('INSERT new edge by source+target+type key', () => {
    const result = graphStore.upsertEdge({
      source_id: 'a', target_id: 'b', relationship_type: 'MADE',
    })
    expect(result.operation).toBe('INSERT')
    const edges = graphStore.readEdges()
    expect(edges['a::b::MADE']).toBeDefined()
  })

  test('duplicate edge returns UPDATE operation', () => {
    graphStore.upsertEdge({ source_id: 'a', target_id: 'b', relationship_type: 'MADE' })
    const result = graphStore.upsertEdge({ source_id: 'a', target_id: 'b', relationship_type: 'MADE' })
    expect(result.operation).toBe('UPDATE')
  })
})

describe('graph_store.purgeByFile', () => {
  test('removes all nodes and edges tied to a source file', () => {
    graphStore.upsertNode({ id: 'n1', type: 'PERSON', attributes: {}, source_file: '/file-a.txt' })
    graphStore.upsertNode({ id: 'n2', type: 'PROJECT', attributes: {}, source_file: '/file-a.txt' })
    graphStore.upsertNode({ id: 'n3', type: 'PERSON', attributes: {}, source_file: '/file-b.txt' })
    graphStore.upsertEdge({ source_id: 'n1', target_id: 'n2', relationship_type: 'CONTRIBUTED_TO' })

    const result = graphStore.purgeByFile('/file-a.txt')

    expect(result.purged_nodes).toBe(2)
    expect(result.purged_edges).toBe(1)
    const nodes = graphStore.readNodes()
    expect(nodes.n1).toBeUndefined()
    expect(nodes.n2).toBeUndefined()
    expect(nodes.n3).toBeDefined()
  })

  test('emits PURGE delta events', () => {
    graphStore.upsertNode({ id: 'nX', type: 'PERSON', attributes: {}, source_file: '/x.txt' })
    graphStore.purgeByFile('/x.txt')
    const events = deltaTracker.readAllEvents()
    expect(events.some(e => e.event_type === 'PURGE' && e.entity_id === 'nX')).toBe(true)
  })
})

describe('graph_store.queryNodes', () => {
  beforeEach(() => {
    graphStore.upsertNode({ id: 'p_sarah', type: 'PERSON', attributes: { name: 'Sarah Chen' }, source_file: '/a.txt' })
    graphStore.upsertNode({ id: 'p_james', type: 'PERSON', attributes: { name: 'James Tan' }, source_file: '/b.txt' })
    graphStore.upsertNode({ id: 'proj_phoenix', type: 'PROJECT', attributes: { name: 'Phoenix' }, source_file: '/a.txt' })
  })

  test('filters by type', () => {
    const persons = graphStore.queryNodes({ type: 'PERSON' })
    expect(persons).toHaveLength(2)
  })

  test('filters by keyword', () => {
    const results = graphStore.queryNodes({ keyword: 'Phoenix' })
    expect(results.some(n => n.id === 'proj_phoenix')).toBe(true)
  })

  test('filters by source_file', () => {
    const fromA = graphStore.queryNodes({ source_file: '/a.txt' })
    expect(fromA).toHaveLength(2)
  })
})

describe('graph_store.readJSON / writeJSON', () => {
  test('returns {} for missing file', () => {
    const tmp = path.join(require('os').tmpdir(), `atlas-missing-${Date.now()}.json`)
    expect(graphStore.readJSON(tmp)).toEqual({})
  })

  test('roundtrips object through write+read', () => {
    const tmp = path.join(require('os').tmpdir(), `atlas-rt-${Date.now()}.json`)
    graphStore.writeJSON(tmp, { hello: 'world' })
    expect(graphStore.readJSON(tmp)).toEqual({ hello: 'world' })
    fs.unlinkSync(tmp)
  })
})
