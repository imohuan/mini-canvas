/**
 * plugin-multi-select 装配集成测试 —— 验证多选 Service 语义（全选/清除/读选中）与命令注册。
 *
 * 环境：node（无 DOM），故 window keydown 绑定跳过；快捷键语义经 handleMultiSelectKey 纯函数直测。
 */
import { describe, it, expect } from 'vitest'
import { createMiniCanvasHost } from '../createMiniCanvasHost'
import { MemoryStorageAdapter } from '@mini-canvas/canvas-core-v2'
import type { MultiSelectService } from '@mini-canvas/plugin-multi-select'
import { multiSelectPlugin, handleMultiSelectKey } from '@mini-canvas/plugin-multi-select'
import { nodeTextPlugin } from '@mini-canvas/plugin-node-text'
import type { TextNodeService } from '@mini-canvas/plugin-node-text'

async function boot() {
  const { host } = await createMiniCanvasHost({
    adapter: new MemoryStorageAdapter(),
    coldPlugins: [nodeTextPlugin, multiSelectPlugin],
  })
  return host
}

function getMultiSelect(host: Awaited<ReturnType<typeof boot>>): MultiSelectService {
  const svc = host.ctx.get<MultiSelectService>('multi-select')
  expect(svc).toBeDefined()
  return svc
}

function keyLike(partial: { key: string; ctrlKey?: boolean; metaKey?: boolean }) {
  return {
    key: partial.key,
    ctrlKey: partial.ctrlKey ?? false,
    metaKey: partial.metaKey ?? false,
    preventDefault: () => {},
  }
}

describe('multi-select 插件（Service 语义 + 装配）', () => {
  it('装配后上架 multi-select 服务；命令可查', async () => {
    const host = await boot()
    expect(host.ctx.get('multi-select')).toBeDefined()
    expect(host.command.has('multi-select:select-all')).toBe(true)
    expect(host.command.has('multi-select:clear')).toBe(true)
    host.stop()
  })

  it('selectAll 全选全部节点；getSelectedNodeIds/无选中时为空', async () => {
    const host = await boot()
    const text = host.ctx.get<TextNodeService>('text')
    text.addTextNode({ x: 0, y: 0 })
    text.addTextNode({ x: 10, y: 10 })
    const svc = getMultiSelect(host)
    expect(svc.hasSelection()).toBe(false)
    expect(svc.getSelectedNodes()).toEqual([])
    svc.selectAll()
    expect(svc.getSelectedNodeIds().size).toBe(2)
    expect(svc.getSelectedNodes().length).toBe(2)
    expect(svc.hasSelection()).toBe(true)
    host.stop()
  })

  it('clearSelection 清空节点与边选中', async () => {
    const host = await boot()
    const text = host.ctx.get<TextNodeService>('text')
    const a = text.addTextNode({ x: 0, y: 0 })
    const b = text.addTextNode({ x: 10, y: 10 })
    host.edgeStore.addEdge({ source: a, target: b })
    const svc = getMultiSelect(host)
    svc.selectAll()
    host.selection.setEdges([host.edgeStore.getEdges()[0]!.id])
    expect(svc.hasSelection()).toBe(true)
    svc.clearSelection()
    expect(svc.getSelectedNodeIds().size).toBe(0)
    expect(svc.hasSelectedEdges()).toBe(false)
    expect(svc.hasSelection()).toBe(false)
    host.stop()
  })

  it('clear 命令执行等价清空', async () => {
    const host = await boot()
    const text = host.ctx.get<TextNodeService>('text')
    text.addTextNode({ x: 0, y: 0 })
    const svc = getMultiSelect(host)
    svc.selectAll()
    expect(svc.hasSelection()).toBe(true)
    host.command.execute('multi-select:clear')
    expect(svc.hasSelection()).toBe(false)
    host.stop()
  })
})

describe('handleMultiSelectKey 快捷键纯函数', () => {
  function makeActions() {
    let selected = 0
    return {
      selectAll: () => { selected = 99 },
      clearSelection: () => { selected = 0 },
      hasSelection: () => selected > 0,
      get selected() { return selected },
    }
  }

  it('Ctrl+A 全选并返回 true（已消费）', () => {
    let selected = 0
    const actions = {
      selectAll: () => { selected = 5 },
      clearSelection: () => { selected = 0 },
      hasSelection: () => selected > 0,
    }
    const handled = handleMultiSelectKey(keyLike({ key: 'a', ctrlKey: true }), actions)
    expect(handled).toBe(true)
    expect(selected).toBe(5)
  })

  it('Escape 有选中时清空并返回 true；无选中时返回 false', () => {
    const actions = {
      selectAll: () => {},
      clearSelection: () => { (actions as { cleared?: boolean }).cleared = true },
      hasSelection: () => true,
    }
    const handled = handleMultiSelectKey(keyLike({ key: 'Escape' }), actions)
    expect(handled).toBe(true)
    expect((actions as { cleared?: boolean }).cleared).toBe(true)

    const empty = {
      selectAll: () => {},
      clearSelection: () => { throw new Error('should not clear') },
      hasSelection: () => false,
    }
    expect(handleMultiSelectKey(keyLike({ key: 'Escape' }), empty)).toBe(false)
  })

  it('普通键不消费返回 false', () => {
    const actions = { selectAll: () => { throw new Error('x') }, clearSelection: () => {}, hasSelection: () => false }
    expect(handleMultiSelectKey(keyLike({ key: 'Delete' }), actions)).toBe(false)
  })
})

