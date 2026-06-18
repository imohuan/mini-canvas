import test from 'node:test'
import assert from 'node:assert/strict'
import { calculateGroupFrameFromAbsoluteChildren } from '../groupBounds.ts'

test('calculateGroupFrameFromAbsoluteChildren uses absolute layout positions, not stale relative positions', () => {
  const frame = calculateGroupFrameFromAbsoluteChildren([
    { id: 'a', position: { x: 120, y: 80 }, dimensions: { width: 40, height: 40 } },
    { id: 'b', position: { x: 220, y: 80 }, dimensions: { width: 40, height: 40 } },
  ])

  assert.deepEqual(frame, {
    x: 90,
    y: 40,
    w: 200,
    h: 150,
  })
})
