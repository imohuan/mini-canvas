/**
 * NodeStore.subscribe —— 节点集变更订阅单测。
 *
 * 动机（CanvasHost 依赖）：宿主把内核 nodeStore 与 VueFlow 渲染态解耦——订阅 store 变化即自动重灌，
 * 业务代码(命令/插件 service/拖拽)无需在每次改动后手动同步。本测试验证各变更点都广播 + 可取消。
 */
import { describe, expect, it, vi } from 'vitest'
import { NodeStore } from '../nodeStore'

function makeStore(): NodeStore {
  const s = new NodeStore()
  s.registerType({ type: 'text', label: '文本', defaultSize: { w: 100, h: 40 } })
  return s
}

describe('NodeStore.subscribe', () => {
  it('addNode 广播 add 并带 nodeId', () => {
    const s = makeStore()
    const fn = vi.fn()
    s.subscribe(fn)
    const id = s.addNode('text', { x: 0, y: 0 })
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith('add', id)
  })

  it('updateNodeData 广播 update 并带 nodeId', () => {
    const s = makeStore()
    const id = s.addNode('text', { x: 0, y: 0 })
    const fn = vi.fn()
    s.subscribe(fn)
    s.updateNodeData(id, { text: 'hi' })
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith('update', id)
  })

  it('removeNode 广播 remove；删除不存在的节点不广播', () => {
    const s = makeStore()
    const id = s.addNode('text', { x: 0, y: 0 })
    const fn = vi.fn()
    s.subscribe(fn)
    expect(s.removeNode(id)).toBe(true)
    expect(fn).toHaveBeenCalledWith('remove', id)
    fn.mockClear()
    expect(s.removeNode('nope')).toBe(false)
    expect(fn).not.toHaveBeenCalled()
  })

  it('replaceAll 广播 replace（无 nodeId）', () => {
    const s = makeStore()
    const fn = vi.fn()
    s.subscribe(fn)
    s.replaceAll([{ id: '1', type: 'text', position: { x: 1, y: 2 }, data: {} }])
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith('replace', undefined)
  })

  it('取消订阅后不再广播', () => {
    const s = makeStore()
    const fn = vi.fn()
    const unsub = s.subscribe(fn)
    unsub()
    s.addNode('text', { x: 0, y: 0 })
    expect(fn).not.toHaveBeenCalled()
  })

  it('多个订阅方各自收到广播；取消一个不影响其它', () => {
    const s = makeStore()
    const a = vi.fn()
    const b = vi.fn()
    const unsubA = s.subscribe(a)
    s.subscribe(b)
    s.addNode('text', { x: 0, y: 0 })
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)
    unsubA()
    a.mockClear()
    s.addNode('text', { x: 1, y: 1 })
    expect(a).not.toHaveBeenCalled()
    expect(b).toHaveBeenCalledTimes(2)
  })
})
