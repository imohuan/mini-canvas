import test from 'node:test'
import assert from 'node:assert/strict'
import { Position } from '@vue-flow/core'
import { runAutoLayout } from '../layoutEngine.ts'

const config = {
  direction: 'LR' as const,
  intraSpacing: { x: 60, y: 80 },
  interSpacing: { x: 120, y: 120 },
  focusHeightRatio: 0.5,
  minZoom: 0.1,
  maxZoom: 4,
  debug: false,
}

function makeNodes(singleX: number) {
  return [
    { id: '1', type: 'custom', position: { x: 80, y: 80 }, dimensions: { width: 256, height: 256 }, data: { label: '输入图像' }, sourcePosition: Position.Right },
    { id: '2', type: 'custom', position: { x: 416, y: 80 }, dimensions: { width: 256, height: 256 }, data: { label: '生成图像' }, sourcePosition: Position.Right, targetPosition: Position.Left },
    { id: '3', type: 'custom', position: { x: singleX, y: 75 }, dimensions: { width: 256, height: 256 }, data: { label: '生成图像' }, targetPosition: Position.Left },
  ] as any[]
}

const edges = [
  { id: 'e1-2', source: '1', target: '2' },
  { id: 'e2-3', source: '2', target: '3' },
] as any[]
const groups = [{ id: 'group-a', nodeIds: new Set(['1', '2']) }]

test('runAutoLayout is stable for a group connected to a single node', () => {
  const first = runAutoLayout({ nodes: makeNodes(875.08), edges, groups, config })
  const firstNode3 = first.nodes.find(n => n.id === '3')!.position

  const second = runAutoLayout({ nodes: makeNodes(firstNode3.x), edges, groups, config })
  const secondNode3 = second.nodes.find(n => n.id === '3')!.position

  assert.deepEqual(secondNode3, firstNode3)
})
