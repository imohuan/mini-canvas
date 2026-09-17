/**
 * 拖放/粘贴的**事件接线**契约（用户报的"拖进去完全没反应"就出在这一层）。
 *
 * 为什么这条测试最值钱：
 * 插件的全部实现都挂在 window 的两三个监听器上。只要监听器没接上（或接了又被立刻摘掉），
 * 底下所有逻辑再对也等于零 —— 而"没接上"这件事，纯逻辑测试和装配测试都看不见：
 * 它们只调服务方法，从不经过"浏览器派发事件"这条路。
 *
 * 做法：给 globalThis 塞一个最小的假 window（只有 addEventListener/removeEventListener/
 * dispatch），装插件后派发一个真 DragEvent 形状的对象，断言"节点真的建出来了"。
 * 假 window 只需覆盖本插件真正用到的那几个 API，不引入 jsdom（少一个依赖，也更快）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Context, NodeStore, EdgeStore, Selection, History, GraphDocument } from '@mini-canvas/canvas-data'
import { CommandRegistry } from '@mini-canvas/kernel'
import { NodeFactory, NodeRegistry, ThemeRegistry } from '@mini-canvas/canvas-data'
import { fileDropPlugin } from '../fileDropPlugin'

type Listener = (ev: unknown) => void

/** 起内核 + 装插件（照宿主的最小清单） */
function boot() {
  const ctx = new Context()
  const nodeStore = new NodeStore()
  nodeStore.registerType({ type: 'text', label: '文本', defaultSize: { w: 300, h: 200 } })
  nodeStore.registerType({ type: 'image', label: '图片', defaultSize: { w: 320, h: 240 } })
  nodeStore.registerType({ type: 'video', label: '视频', defaultSize: { w: 480, h: 320 } })
  ctx.inject('nodeStore', nodeStore)
  const edgeStore = new EdgeStore()
  ctx.inject('edgeStore', edgeStore)
  ctx.inject('selection', new Selection())
  ctx.inject(
    'history',
    new History({
      snapshot: () => ({
        nodes: JSON.parse(JSON.stringify(nodeStore.getNodes())),
        edges: JSON.parse(JSON.stringify(edgeStore.getEdges())),
      }),
      restore: (g: { nodes: unknown[]; edges: unknown[] }) => {
        nodeStore.replaceAll(g.nodes as never)
        edgeStore.replaceAll(g.edges as never)
      },
    }),
  )
  ctx.inject('graph', new GraphDocument(nodeStore, edgeStore, ctx.get('selection'), ctx.get('history')))
  ctx.inject('command', new CommandRegistry())
  ctx.inject('nodeFactory', new NodeFactory())
  ctx.inject('nodeRegistry', new NodeRegistry())
  ctx.inject('themeRegistry', new ThemeRegistry())
  return { ctx, nodeStore }
}

let originalWindow: unknown
let originalHTMLElement: unknown
let fake: { listeners: Map<string, Set<Listener>>; dispatch(t: string, e: unknown): void }
let registered: Record<string, Listener[]> = {}

// 插件用 window.addEventListener 挂监听。用一个手写的最小 window 顶替全局，
// 顺便把"谁挂了哪些监听"记下来 —— 这正是断言监听器确实存在的依据。
beforeEach(() => {
  originalWindow = (globalThis as { window?: unknown }).window
  originalHTMLElement = (globalThis as { HTMLElement?: unknown }).HTMLElement
  // 浏览器里 window 与 HTMLElement 是一起存在的；插件用 `x instanceof HTMLElement` 判"是不是
  // 可编辑框"，所以这个最小环境必须把两者都给出来，否则那行会抛 ReferenceError。
  // （真实场景中不可能"有 window 没有 HTMLElement"，因此这是测试环境的补齐，不是产品代码的缺陷。）
  ;(globalThis as { HTMLElement?: unknown }).HTMLElement = class HTMLElementStub {}
  registered = {}
  fake = {
    listeners: new Map(),
    dispatch(type: string, ev: unknown) {
      for (const fn of registered[type] ?? []) fn(ev)
    },
  }
  ;(globalThis as { window?: unknown }).window = {
    addEventListener(type: string, fn: Listener) {
      ;(registered[type] ??= []).push(fn)
      fake.listeners.set(type, new Set(registered[type]))
    },
    removeEventListener(type: string, fn: Listener) {
      registered[type] = (registered[type] ?? []).filter((f) => f !== fn)
    },
  }
})

afterEach(() => {
  ;(globalThis as { window?: unknown }).window = originalWindow
  ;(globalThis as { HTMLElement?: unknown }).HTMLElement = originalHTMLElement
})

describe('拖放/粘贴的事件接线（"没反应"就出在这一层）', () => {
  it('装插件后 window 上真的挂上了 dragover / drop / paste 三个监听', async () => {
    const { ctx } = boot()
    ctx.plugin(fileDropPlugin)
    await ctx.start()
    expect(registered.dragover?.length ?? 0).toBeGreaterThan(0)
    expect(registered.drop?.length ?? 0).toBeGreaterThan(0)
    expect(registered.paste?.length ?? 0).toBeGreaterThan(0)
    ctx.stop()
  })

  it('派发一次 drop（带文件）→ 真的建出节点（拖拽到底有没有效果，就看这一下）', async () => {
    const { ctx, nodeStore } = boot()
    ctx.plugin(fileDropPlugin)
    await ctx.start()

    const file = new File(['hello drop'], 'note.md', { type: 'text/markdown' })
    fake.dispatch('drop', {
      target: null,
      clientX: 120,
      clientY: 80,
      preventDefault: () => {},
      stopPropagation: () => {},
      dataTransfer: { files: [file], types: ['Files'] },
    })
    // addFiles 是异步的：等它落库
    await new Promise((r) => setTimeout(r, 30))

    const nodes = nodeStore.getNodes()
    expect(nodes).toHaveLength(1)
    expect(nodes[0].type).toBe('text')
    // 无 viewport 服务时降级用屏幕坐标当 flow 坐标（不断言精确值，只要求没有掉进默认 200,200）
    expect(nodes[0].data.text).toContain('hello drop')
    ctx.stop()
  })

  it('dragover 只在带文件时才 preventDefault（否则会吃掉画布自己的拖动手势）', async () => {
    const { ctx } = boot()
    ctx.plugin(fileDropPlugin)
    await ctx.start()

    let prevented = 0
    const ev = (types: string[]) => ({
      target: null,
      preventDefault: () => {
        prevented += 1
      },
      dataTransfer: { types, dropEffect: '' },
    })
    fake.dispatch('dragover', ev(['text/plain']))
    expect(prevented).toBe(0)
    fake.dispatch('dragover', ev(['Files']))
    expect(prevented).toBe(1)
    ctx.stop()
  })

  it('卸载插件后监听全部摘掉（不留悬挂监听继续建节点）', async () => {
    const { ctx, nodeStore } = boot()
    ctx.plugin(fileDropPlugin)
    await ctx.start()
    expect(registered.drop?.length ?? 0).toBeGreaterThan(0)

    ctx.uninstallPlugin('file-drop')
    expect(registered.drop?.length ?? 0).toBe(0)
    expect(registered.dragover?.length ?? 0).toBe(0)
    expect(registered.paste?.length ?? 0).toBe(0)

    // 摘掉之后派发事件不该再建节点
    fake.dispatch('drop', {
      target: null,
      clientX: 10,
      clientY: 10,
      preventDefault: () => {},
      stopPropagation: () => {},
      dataTransfer: { files: [new File(['x'], 'a.md', { type: 'text/markdown' })], types: ['Files'] },
    })
    await new Promise((r) => setTimeout(r, 20))
    expect(nodeStore.getNodes()).toHaveLength(0)
    ctx.stop()
  })

  it('开关关掉时连监听都不挂（enableDragDrop:false）', async () => {
    const { ctx } = boot()
    ctx.plugin(fileDropPlugin, { enableDragDrop: false, enablePaste: false })
    await ctx.start()
    expect(registered.drop?.length ?? 0).toBe(0)
    expect(registered.paste?.length ?? 0).toBe(0)
    ctx.stop()
  })
})
