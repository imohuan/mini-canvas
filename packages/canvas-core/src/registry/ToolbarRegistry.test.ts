import test from 'node:test'
import assert from 'node:assert/strict'
import { ToolbarRegistry } from './ToolbarRegistry.ts'

test('ToolbarRegistry register and getByPosition', () => {
  const reg = new ToolbarRegistry()
  reg.register('image-tools', {
    id: 'image.crop',
    source: 'image-tools',
    commandId: 'image.crop',
    position: 'top',
    nodeTypes: ['image'],
    order: 10,
  })
  reg.register('image-tools', {
    id: 'image.reset',
    source: 'image-tools',
    commandId: 'image.reset',
    position: 'bottom',
    nodeTypes: ['image'],
    order: 20,
  })
  const top = reg.getByPosition('top')
  const bottom = reg.getByPosition('bottom')
  assert.equal(top.length, 1)
  assert.equal(top[0].id, 'image.crop')
  assert.equal(bottom.length, 1)
  assert.equal(bottom[0].id, 'image.reset')
})

test('ToolbarRegistry getByPosition sorts by order', () => {
  const reg = new ToolbarRegistry()
  reg.register('p', { id: 'b', source: 'p', commandId: 'c.b', position: 'top', order: 20 })
  reg.register('p', { id: 'a', source: 'p', commandId: 'c.a', position: 'top', order: 10 })
  const top = reg.getByPosition('top')
  assert.deepEqual(top.map(b => b.id), ['a', 'b'])
})

test('ToolbarRegistry unregisterSource removes only that source', () => {
  const reg = new ToolbarRegistry()
  reg.register('a', { id: 'a.1', source: 'a', commandId: 'c', position: 'top' })
  reg.register('b', { id: 'b.1', source: 'b', commandId: 'c', position: 'top' })
  reg.unregisterSource('a')
  const top = reg.getByPosition('top')
  assert.equal(top.length, 1)
  assert.equal(top[0].source, 'b')
})

test('ToolbarRegistry duplicate id overwrites', () => {
  const reg = new ToolbarRegistry()
  reg.register('a', { id: 'dup', source: 'a', commandId: 'c1', position: 'top' })
  reg.register('b', { id: 'dup', source: 'b', commandId: 'c2', position: 'top' })
  const top = reg.getByPosition('top')
  assert.equal(top.length, 1)
  assert.equal(top[0].commandId, 'c2')
})
