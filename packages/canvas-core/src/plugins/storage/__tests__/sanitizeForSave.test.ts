import test from "node:test"
import assert from "node:assert/strict"
import { sanitizeForSave } from "../sanitizeForSave.ts"

test("sanitizeForSave removes panoUrl", () => {
  const nodes = [{ id: '1', type: 'custom', position: { x: 0, y: 0 }, data: { nodeType: 'panorama', panoUrl: 'blob:...', label: '360' } }]
  const result = sanitizeForSave(nodes, [])
  assert.equal((result.nodes[0].data as any).panoUrl, undefined)
  assert.equal((result.nodes[0].data as any).label, '360')
})

test("sanitizeForSave removes _editing", () => {
  const nodes = [{ id: '1', type: 'custom', position: { x: 0, y: 0 }, data: { nodeType: 'panorama', _editing: true, label: '360' } }]
  const result = sanitizeForSave(nodes, [])
  assert.equal((result.nodes[0].data as any)._editing, undefined)
})

test("sanitizeForSave removes leftImageUrl and rightImageUrl", () => {
  const nodes = [{ id: '1', type: 'custom', position: { x: 0, y: 0 }, data: { nodeType: 'image-compare', leftImageUrl: 'blob:...', rightImageUrl: 'blob:...' } }]
  const result = sanitizeForSave(nodes, [])
  assert.equal((result.nodes[0].data as any).leftImageUrl, undefined)
  assert.equal((result.nodes[0].data as any).rightImageUrl, undefined)
})
