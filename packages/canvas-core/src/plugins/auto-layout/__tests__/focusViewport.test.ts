import test from 'node:test'
import assert from 'node:assert/strict'
import { calculateFocusZoom, centerViewportOnBounds } from '../focusViewport.ts'

test('calculateFocusZoom makes selected bounds occupy requested viewport height ratio', () => {
  const zoom = calculateFocusZoom({ boundsHeight: 200, viewportHeight: 800, heightRatio: 0.5, minZoom: 0.1, maxZoom: 4 })
  assert.equal(zoom, 2)
})

test('calculateFocusZoom clamps to configured zoom limits', () => {
  assert.equal(calculateFocusZoom({ boundsHeight: 20, viewportHeight: 1000, heightRatio: 0.5, minZoom: 0.1, maxZoom: 4 }), 4)
  assert.equal(calculateFocusZoom({ boundsHeight: 2000, viewportHeight: 200, heightRatio: 0.5, minZoom: 0.2, maxZoom: 4 }), 0.2)
})

test('centerViewportOnBounds centers bounds using chosen zoom', () => {
  const viewport = centerViewportOnBounds({
    bounds: { x: 100, y: 200, width: 300, height: 100 },
    viewportWidth: 1000,
    viewportHeight: 800,
    zoom: 2,
  })
  assert.deepEqual(viewport, { x: 0, y: -100, zoom: 2 })
})
