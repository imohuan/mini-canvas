import test from 'node:test'
import assert from 'node:assert/strict'
import type { Edge } from '@vue-flow/core'
import { HistoryPlugin } from '../HistoryPlugin.ts'
import type { PluginContext } from '../../types.ts'

function createHarness(initialEdges: Edge[] = []) {
  const handlers = new Map<string, ((payload: any) => void)[]>()
  const edges = [...initialEdges]
  const shortcuts = new Map<string, () => void>()
  const emit = (event: string, payload: any) => {
    for (const handler of handlers.get(event) ?? []) handler(payload)
  }

  const context = {
    logger: {
      debug() {},
      info() {},
      warn() {},
      error() {},
    },
    actions: {
      getNodes: () => [],
      getEdges: () => edges,
      addNodes() {},
      removeNodes() {},
      addEdges(nextEdges: Edge[]) {
        edges.push(...nextEdges)
        emit('edgesChange', nextEdges.map(item => ({ type: 'add', item })))
      },
      removeEdges(ids: string[]) {
        for (const id of ids) {
          const index = edges.findIndex(edge => edge.id === id)
          if (index >= 0) edges.splice(index, 1)
        }
        emit('edgesChange', ids.map(id => ({ type: 'remove', id })))
      },
    },
    on(event: string, handler: (payload: any) => void) {
      const list = handlers.get(event) ?? []
      list.push(handler)
      handlers.set(event, list)
      return () => handlers.set(event, list.filter(item => item !== handler))
    },
    emit,
    registerShortcut(keys: string, handler: () => void) {
      shortcuts.set(keys, handler)
    },
  } as unknown as PluginContext

  const result = HistoryPlugin.install(context, {}) as { api: NonNullable<ReturnType<typeof HistoryPlugin.install>> extends { api?: infer API } ? API : never }

  return {
    api: result.api as any,
    edges,
    emit: context.emit,
  }
}

const edge = {
  id: 'edge-a-b',
  source: 'a',
  target: 'b',
  sourceHandle: 'source',
  targetHandle: 'target',
  data: { edgeColor: '#fff' },
} as Edge

test('records added edges from edgesChange', () => {
  const harness = createHarness([edge])

  harness.emit('edgesChange', [{ type: 'add', item: edge }])

  assert.equal(harness.api.undoCount, 1)
  harness.api.undo()
  assert.deepEqual(harness.edges.map(item => item.id), [])
  harness.api.redo()
  assert.deepEqual(harness.edges.map(item => item.id), ['edge-a-b'])
})

test('records removed edges from edgesChange', () => {
  const harness = createHarness([edge])

  harness.edges.splice(0, 1)
  harness.emit('edgesChange', [{ type: 'remove', id: edge.id }])

  assert.equal(harness.api.undoCount, 1)
  harness.api.undo()
  assert.deepEqual(harness.edges.map(item => item.id), ['edge-a-b'])
  harness.api.redo()
  assert.deepEqual(harness.edges.map(item => item.id), [])
})