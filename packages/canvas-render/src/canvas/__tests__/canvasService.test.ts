import { describe, expect, it, vi } from 'vitest'
import { CanvasService } from '../canvasService'
import { clearCommandRuntime, setCommandRuntime } from '@mini-canvas/canvas-data'

function fakeCtx(overrides: Record<string, unknown> = {}) {
  const services: Record<string, unknown> = {
    doc: { getNode: () => undefined, transaction: (_r: string, fn: () => unknown) => fn(), createNode: vi.fn(() => 'n1') },
    selection: { ids: new Set(), set: vi.fn() },
    view: { fitTo: vi.fn(() => true) },
    ...overrides,
  }
  return {
    get: (name: string) => services[name],
    tryGet: (name: string) => services[name],
  } as never
}

describe('canvas 动作门面', () => {
  it('createNode 委托 nodeFactory，找不到类型返回 undefined 不抛', () => {
    const factory = { create: vi.fn(() => 'n9'), creatableTypes: () => ['image'] }
    const c = new CanvasService(fakeCtx({ nodeFactory: factory }))
    expect(c.createNode('image', { x: 1, y: 2 })).toBe('n9')
    expect(c.createNode('image', { x: 1, y: 2 }, { sourceNodeId: 's1', gap: 32 })).toBe('n9')
    expect(factory.create).toHaveBeenLastCalledWith('image', { x: 1, y: 2 }, { sourceNodeId: 's1', gap: 32 })
    expect(c.creatableTypes()).toEqual(['image'])
    expect(new CanvasService(fakeCtx()).createNode('nope', { x: 0, y: 0 })).toBeUndefined()
    expect(new CanvasService(fakeCtx({ nodeFactory: factory })).createNode('nope', { x: 0, y: 0 })).toBeUndefined()
  })

  it('focus 传 selection 时先解析选中集再 fitTo', () => {
    const view = { fitTo: vi.fn(() => true) }
    const selection = { ids: new Set(['a', 'b']), set: vi.fn() }
    const c = new CanvasService(fakeCtx({ view, selection }))
    expect(c.focus('selection')).toBe(true)
    expect(view.fitTo).toHaveBeenCalledWith(['a', 'b'], undefined)
  })

  it('focus 传 select:true 时先选中再取景，不改 fitTo 的内部选中', () => {
    const view = { fitTo: vi.fn(() => true) }
    const selection = { ids: new Set<string>(), set: vi.fn() }
    const c = new CanvasService(fakeCtx({ view, selection }))
    expect(c.focus(['n1'], { keepZoom: true, select: true })).toBe(true)
    expect(selection.set).toHaveBeenCalledWith(['n1'])
    expect(view.fitTo).toHaveBeenCalledWith(['n1'], { keepZoom: true, select: true })
  })

  it('select 的 replace/add/toggle 语义与内核 selection 对齐', () => {
    const selection = {
      ids: new Set(['a']),
      has: (id: string) => id === 'a',
      set: vi.fn(),
      add: vi.fn(),
      remove: vi.fn(),
      clear: vi.fn(),
    }
    const c = new CanvasService(fakeCtx({ selection }))
    c.select(['b'], 'replace')
    expect(selection.set).toHaveBeenCalledWith(['b'])
    c.select(['b'], 'add')
    expect(selection.add).toHaveBeenCalledWith('b')
    c.select(['a'], 'toggle')
    expect(selection.remove).toHaveBeenCalledWith('a')
  })

  it('enterMode 缺 nodeToolbar 时返回 false，不抛', () => {
    const c = new CanvasService(fakeCtx())
    expect(c.enterMode('n1', 'image/crop')).toBe(false)
    expect(c.activeMode('n1')).toBeUndefined()
  })

  it('enterMode 委托 nodeToolbar；exitMode 在会话不匹配时也不抛', () => {
    const toolbar = {
      enter: vi.fn(),
      exit: vi.fn(),
      activeModeId: vi.fn(() => 'image/crop'),
    }
    const c = new CanvasService(fakeCtx({ nodeToolbar: toolbar }))
    expect(c.enterMode('n1', 'image/crop')).toBe(true)
    expect(toolbar.enter).toHaveBeenCalledWith('n1', 'image/crop')
    expect(c.activeMode('n1')).toBe('image/crop')
    c.exitMode()
    expect(toolbar.exit).toHaveBeenCalledWith(undefined)
  })

  it('group / ungroup 缺 group 服务时安静返回', () => {
    const c = new CanvasService(fakeCtx())
    expect(c.group(['a', 'b'])).toBeNull()
    expect(() => c.ungroup('g1')).not.toThrow()
  })

  it('notify 立即进队列，返回撤回函数', () => {
    const c = new CanvasService(fakeCtx())
    const off = c.notify('网络慢', { source: 'gen' })
    expect(c.notifications.list().map((x) => x.message)).toEqual(['网络慢'])
    off()
    expect(c.notifications.list()).toHaveLength(0)
  })

  it('runBarAction 缺 nodeTask 时明确拒绝，其它路径不抛', async () => {
    const c = new CanvasService(fakeCtx())
    await expect(c.runBarAction('n1', 'a1')).rejects.toThrow('[canvas] nodeTask 未安装')
    expect(() => c.cancelBarAction('n1')).not.toThrow()
  })

  it('runBarAction 有 nodeTask 时转发 nodeId/actionId/input', async () => {
    const nodeTask = { run: vi.fn(async () => ({ ok: true })), cancel: vi.fn() }
    const c = new CanvasService(fakeCtx({ nodeTask }))
    await expect(c.runBarAction('n1', 'a1', { prompt: 'x' })).resolves.toEqual({ ok: true })
    expect(nodeTask.run).toHaveBeenCalledWith('n1', 'a1', { prompt: 'x' })
    c.cancelBarAction('n1')
    expect(nodeTask.cancel).toHaveBeenCalledWith('n1')
  })

  it('命令入口走内部运行时：list / run / remap 都能用，不依赖 command 服务名', () => {
    const command = {
      execute: vi.fn(() => 'ran'),
      list: vi.fn(() => [{ id: 'command:delete', keys: ['Delete'], run: () => undefined }]),
      has: vi.fn(() => true),
      register: vi.fn(() => ({ dispose() {} })),
      remapKeys: vi.fn(() => ['Backspace']),
      resetKeys: vi.fn(() => ['Delete']),
      originalKeys: vi.fn(() => ['Delete']),
      isRemapped: vi.fn(() => true),
    }
    setCommandRuntime(command)
    try {
      const c = new CanvasService(fakeCtx())
      expect(c.listCommands().map((d) => d.id)).toEqual(['command:delete'])
      expect(c.runCommand('command:delete')).toBe('ran')
      expect(command.execute).toHaveBeenCalledWith('command:delete')
      expect(c.hasCommand('command:delete')).toBe(true)
      expect(c.remapCommandKeys('command:delete', ['Backspace'])).toEqual(['Backspace'])
      expect(c.resetCommandKeys('command:delete')).toEqual(['Delete'])
      expect(c.originalCommandKeys('command:delete')).toEqual(['Delete'])
      expect(c.isCommandRemapped('command:delete')).toBe(true)
    } finally {
      clearCommandRuntime()
    }
  })
})
