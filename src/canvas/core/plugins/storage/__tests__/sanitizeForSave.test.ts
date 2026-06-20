import test from 'node:test'
import assert from 'node:assert/strict'
import { sanitizeForSave } from '../sanitizeForSave.ts'

test('sanitizeForSave preserves node.type as custom and node.data.nodeType', () => {
  const nodes = [{ id: '1', type: 'custom', data: { nodeType: 'image', label: 'test' } }]
  const result = sanitizeForSave(nodes, [])
  assert.equal(result.nodes[0].type, 'custom')
  assert.equal(result.nodes[0].data.nodeType, 'image')
})

test('sanitizeForSave removes runtime fields', () => {
  const nodes = [{ id: '1', type: 'custom', data: { nodeType: 'image', imageUrl: 'blob:...', videoUrl: 'blob:...', thumbUrl: 'blob:...', _cropMode: true, _cropRect: { x: 0 }, label: 'test' } }]
  const result = sanitizeForSave(nodes, [])
  const data = result.nodes[0].data
  assert.equal(data.imageUrl, undefined)
  assert.equal(data.videoUrl, undefined)
  assert.equal(data.thumbUrl, undefined)
  assert.equal(data._cropMode, undefined)
  assert.equal(data._cropRect, undefined)
  assert.equal(data.label, 'test')
})

test('sanitizeForSave removes temp nodes and edges', () => {
  const nodes = [
    { id: '1', type: 'custom', data: { nodeType: 'text' } },
    { id: 'temp-123', type: 'custom', data: { nodeType: 'text' } },
    { id: '2', type: 'tempTarget', data: { nodeType: 'text' } },
    { id: '3', type: 'custom', data: { nodeType: 'text', isTemp: true } },
  ]
  const edges = [
    { id: 'e1', source: '1', target: '2' },
    { id: 'temp-e1', source: '1', target: '2', data: { isTemp: true } },
  ]
  const result = sanitizeForSave(nodes, edges)
  assert.equal(result.nodes.length, 1)
  assert.equal(result.nodes[0].id, '1')
  assert.equal(result.edges.length, 1)
  assert.equal(result.edges[0].id, 'e1')
})

test('sanitizeForSave removes values._url', () => {
  const nodes = [{ id: '1', type: 'custom', data: { nodeType: 'stage', values: { a: { _url: 'blob:...', name: 'x' }, b: { name: 'y' } } } }]
  const result = sanitizeForSave(nodes, [])
  const values = result.nodes[0].data.values
  assert.equal(values.a._url, undefined)
  assert.equal(values.a.name, 'x')
  assert.equal(values.b.name, 'y')
})

test('sanitizeForSave does not mutate input', () => {
  const nodes = [{ id: '1', type: 'custom', data: { nodeType: 'image', imageUrl: 'blob:...' } }]
  const edges = [{ id: 'e1', source: '1', target: '2' }]
  sanitizeForSave(nodes, edges)
  assert.equal(nodes[0].data.imageUrl, 'blob:...')
})