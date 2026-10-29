import test from 'node:test'
import assert from 'node:assert/strict'
import { isPolylineHitByCut } from '../geometry.ts'

test('isPolylineHitByCut returns true when cut crosses a segment', () => {
  const edge = [{ x: 0, y: 10 }, { x: 100, y: 10 }]
  const cut = [{ x: 50, y: 0 }, { x: 50, y: 30 }]

  assert.equal(isPolylineHitByCut(edge, cut, 0), true)
})

test('isPolylineHitByCut returns true when cut is within screen tolerance', () => {
  const edge = [{ x: 0, y: 10 }, { x: 100, y: 10 }]
  const cut = [{ x: 40, y: 16 }, { x: 80, y: 16 }]

  assert.equal(isPolylineHitByCut(edge, cut, 7), true)
})

test('isPolylineHitByCut returns false when cut is outside screen tolerance', () => {
  const edge = [{ x: 0, y: 10 }, { x: 100, y: 10 }]
  const cut = [{ x: 40, y: 24 }, { x: 80, y: 24 }]

  assert.equal(isPolylineHitByCut(edge, cut, 7), false)
})

test('isPolylineHitByCut ignores incomplete polylines', () => {
  assert.equal(isPolylineHitByCut([{ x: 0, y: 0 }], [{ x: 0, y: 0 }, { x: 1, y: 1 }], 4), false)
  assert.equal(isPolylineHitByCut([{ x: 0, y: 0 }, { x: 1, y: 1 }], [{ x: 0, y: 0 }], 4), false)
})