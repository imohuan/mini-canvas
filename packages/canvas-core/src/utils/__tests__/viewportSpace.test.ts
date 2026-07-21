import assert from 'node:assert/strict'
import test from 'node:test'
import { createNodeTitleLayout } from '../viewportSpace'

test('node title keeps its screen size and offset above min zoom', () => {
  const layout = createNodeTitleLayout(2, { offset: 12, minZoom: 0.5 })

  assert.equal(layout.scale, 0.5)
  assert.equal(layout.offset, 6)
  assert.equal(layout.scale * 2, 1)
  assert.equal(layout.offset * 2, 12)
})

test('node title shrinks with the canvas below min zoom', () => {
  const layout = createNodeTitleLayout(0.25, { offset: 12, minZoom: 0.5 })

  assert.equal(layout.scale, 2)
  assert.equal(layout.offset, 24)
  assert.equal(layout.scale * 0.25, 0.5)
  assert.equal(layout.offset * 0.25, 6)
})

test('node title layout stays finite for an invalid zoom', () => {
  const layout = createNodeTitleLayout(0, { offset: 12, minZoom: 0.5 })

  assert.equal(Number.isFinite(layout.scale), true)
  assert.equal(Number.isFinite(layout.offset), true)
})
