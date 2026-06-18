import test from 'node:test'
import assert from 'node:assert/strict'
import { mergeAutoLayoutConfig } from '../config.ts'

test('mergeAutoLayoutConfig keeps nested spacing fields when override is partial', () => {
  const merged = mergeAutoLayoutConfig({
    direction: 'LR',
    intraSpacing: { x: 60, y: 80 },
    interSpacing: { x: 120, y: 140 },
    focusHeightRatio: 0.5,
    minZoom: 0.1,
    maxZoom: 4,
    debug: false,
  }, {
    intraSpacing: { x: 100 },
  })

  assert.deepEqual(merged.intraSpacing, { x: 100, y: 80 })
  assert.deepEqual(merged.interSpacing, { x: 120, y: 140 })
})
