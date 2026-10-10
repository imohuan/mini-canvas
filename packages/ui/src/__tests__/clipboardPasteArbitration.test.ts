/**
 * 端到端复现 + 回归：用户 2026-10-10 报的缺陷
 * 「我复制了一张图片，想粘到画布，结果粘出来的是之前复制的节点」。
 *
 * 根因：clipboard 把 Ctrl+V 注册成命令，宿主 keydown 命中后 preventDefault ——
 * 真机实测表明这会让浏览器**根本不派发原生 paste 事件**，file-drop 的粘贴通道被掐死。
 *
 * 修法：复制/粘贴走注册场仲裁（clipboard/copy|cut|paste），按 order 定优先级，
 * 用"系统剪贴板里带不带画布标记"判定归属。本文件把 clipboard + file-drop 装进同一个 ctx，
 * 直接对仲裁场派发真实的 paste 载荷，断言"谁接管、建了什么节点"。
 */
import { describe, it, expect } from 'vitest'
import {
  Context,
  NodeStore,
  EdgeStore,
  Selection,
  History,
  GraphDocument,
  createDocService,
  NodeFactory,
  NodeRegistry,
  ThemeRegistry,
  CLIPBOARD_PASTE_KIND,
  CLIPBOARD_PASTE_KEY,
  CANVAS_CLIPBOARD_MIME,
  CANVAS_CLIPBOARD_TEXT_PREFIX,
  canvasClipboardMarker,
  buildClipboardPastePayload,
  dispatchClipboardPaste,
  type ClipboardEntry,
  type ClipboardPasteHandler,
} from '@mini-canvas/canvas-data'
import { CommandRegistry } from '@mini-canvas/kernel'
import { clipboardPlugin } from '@mini-canvas/plugin-clipboard'
import { FileDropServiceImpl, createFileDropPasteHandlers, type FileDropReaders } from '@mini-canvas/plugin-file-drop'

interface GraphEnvelope {
  nodes: Array<{ id: string; type: string; position: { x: number; y: number }; data: Record<string, unknown> }>
  edges: unknown[]
}

/** 假浏览器 IO（node 无 FileReader/Image/URL.createObjectURL） */
function fakeReaders(): FileDropReaders {
  return {
    readText: async (f) => f.text(),
    readImageDims: async () => ({ width: 2000, height: 1000 }),
    readVideoMeta: async () => ({ width: 1280, height: 720, duration: 3 }),
    createObjectURL: () => 'blob:mock',
  }
}

/** 起带真实内核服务的最小 ctx（对齐宿主注入），clipboard + file-drop 都装上 */
function boot() {
  const ctx = new Context()
  const nodeStore = new NodeStore()
  nodeStore.registerType({ type: 'text', label: '文本', defaultSize: { w: 300, h: 200 } })
  nodeStore.registerType({ type: 'image', label: '图片', defaultSize: { w: 320, h: 240 } })
  nodeStore.registerType({ type: 'video', label: '视频', defaultSize: { w: 480, h: 320 } })
  const edgeStore = new EdgeStore()
  const selection = new Selection()
  ctx.inject('selection', selection)
  const history = new History({
    snapshot: () => ({
      nodes: JSON.parse(JSON.stringify(nodeStore.getNodes())) as GraphEnvelope['nodes'],
      edges: JSON.parse(JSON.stringify(edgeStore.getEdges())) as GraphEnvelope['edges'],
    }),
    restore: (g) => {
      const env = (g as GraphEnvelope) ?? { nodes: [], edges: [] }
      nodeStore.replaceAll(env.nodes as never)
      edgeStore.replaceAll((env.edges ?? []) as never)
    },
  })
  ctx.inject('doc', createDocService({ nodeStore, edgeStore, graph: new GraphDocument(nodeStore, edgeStore, selection, history), history }))
  ctx.inject('command', new CommandRegistry())
  ctx.inject('nodeFactory', new NodeFactory())
  ctx.inject('nodeRegistry', new NodeRegistry())
  ctx.inject('themeRegistry', new ThemeRegistry())
  return { ctx, nodeStore, selection }
}

function addNode(ns: NodeStore, type: string, x: number, y: number) {
  ns.addNodes([{ type, position: { x, y }, data: { label: 'n' } }])
  return ns.getNodes().at(-1)!.id
}

/** 造一个模拟原生 paste 的事件（覆盖载荷归一用到的字段） */
function pasteEvent(opts: { types?: string[]; files?: File[]; data?: Record<string, string> }) {
  const data = opts.data ?? {}
  const ev = {
    preventDefault() {},
    clipboardData: {
      types: opts.types ?? [],
      files: opts.files ?? [],
      items: Object.entries(data).map(([type, value]) => ({
        kind: 'string',
        type,
        getAsString(cb: (s: string) => void) {
          cb(value)
        },
      })),
      getData(mime: string) {
        return data[mime] ?? ''
      },
    },
  }
  return ev as unknown as ClipboardEvent
}

/**
 * 装 file-drop 的**真实**粘贴处理器（走生产同一份 createFileDropPasteHandlers），
 * 只是 IO 用假实现（node 无 FileReader/Image/URL.createObjectURL）。
 * 不复制粘贴逻辑到测试里 —— 那样生产代码改了测试也不会红。
 */
function installFakeFileDrop(ctx: Context) {
  const svc = new FileDropServiceImpl(ctx, fakeReaders())
  for (const h of createFileDropPasteHandlers(svc)) {
    ctx.registryOf(CLIPBOARD_PASTE_KIND).add(h.key, h.handler, { id: h.id, order: h.order })
  }
  return svc
}

/** 读仲裁场（list() 返回 Entry<unknown>；这里窄成"处理器 + order/id"） */
type PasteEntry = ClipboardEntry<ClipboardPasteHandler> & { order: number; id: string }
function pasteEntries(ctx: Context): PasteEntry[] {
  return ctx.registryOf(CLIPBOARD_PASTE_KIND).list(CLIPBOARD_PASTE_KEY) as unknown as PasteEntry[]
}

describe('用户缺陷回归：外部复制图片 vs 内存里的旧节点快照', () => {
  it('先复制画布节点（内存有快照），再从外部复制图片粘贴 → 应建图片节点，不贴旧节点', async () => {
    const { ctx, nodeStore, selection } = boot()
    ctx.plugin(clipboardPlugin)
    await ctx.start()
    const fileDrop = installFakeFileDrop(ctx)

    // ① 复制画布节点：选中一个 **text** 节点并走 clipboard 的复制（会写内存快照）。
    //    故意用 text —— 这样"贴了旧节点"与"贴了外部图片"产出的节点类型不同，
    //    断言能精确区分（若回归成贴旧节点，会得到 text 而不是 image）。
    const a = addNode(nodeStore, 'text', 0, 0)
    selection.set([a])
    const svc = ctx.get<{ copy(): boolean }>('clipboard')
    expect(svc.copy()).toBe(true) // 内存快照已就绪（正是"之前复制的节点"）

    const before = nodeStore.getNodes().length
    const copiedType = nodeStore.getNode(a)!.type
    expect(copiedType).toBe('text')

    // ② 外部复制图片后粘贴：剪贴板只有 image/png，**没有**画布标记
    const payload = buildClipboardPastePayload(
      pasteEvent({ types: ['image/png'], files: [new File(['img'], 'pasted.png', { type: 'image/png' })] }),
    )
    const entries = pasteEntries(ctx)
    const claimed = dispatchClipboardPaste(entries, payload)
    expect(claimed).toBe(true)
    await new Promise((r) => setTimeout(r, 30))

    // ③ 断言：新增的是**图片节点**（不是被复制的 text 节点），且节点数只 +1
    //    （若回归成"贴内存旧快照"，这里会拿到 text 节点 → 本条测试当场红）
    const nodes = nodeStore.getNodes()
    expect(nodes.length).toBe(before + 1)
    const added = nodes.at(-1)!
    expect(added.type).toBe('image')
    expect(added.data.imageUrl).toBe('blob:mock')
    void fileDrop
    ctx.stop()
  })

  it('画布内复制节点后粘贴（剪贴板带画布标记）→ 贴节点快照（图片处理器让位）', async () => {
    const { ctx, nodeStore, selection } = boot()
    ctx.plugin(clipboardPlugin)
    await ctx.start()
    installFakeFileDrop(ctx)

    const a = addNode(nodeStore, 'image', 100, 100)
    selection.set([a])
    const svc = ctx.get<{ copy(): boolean; markSystemClipboard(w?: unknown): void }>('clipboard')
    expect(svc.copy()).toBe(true)
    const before = nodeStore.getNodes().length

    // 剪贴板里的标记显示"这次复制来自画布"（并**没有**文件，只有标记）
    const payload = buildClipboardPastePayload(
      pasteEvent({
        types: [CANVAS_CLIPBOARD_MIME, 'text/plain'],
        data: {
          [CANVAS_CLIPBOARD_MIME]: canvasClipboardMarker(1, 0),
          'text/plain': CANVAS_CLIPBOARD_TEXT_PREFIX + canvasClipboardMarker(1, 0),
        },
      }),
    )
    const entries = pasteEntries(ctx)
    expect(dispatchClipboardPaste(entries, payload)).toBe(true)
    await new Promise((r) => setTimeout(r, 20))

    // 贴的是节点快照（克隆 1 个），不是图片节点
    expect(nodeStore.getNodes().length).toBe(before + 1)
    ctx.stop()
  })

  it('外部复制纯文本（无标记、无文件）→ 建文本节点', async () => {
    const { ctx, nodeStore } = boot()
    ctx.plugin(clipboardPlugin)
    await ctx.start()
    installFakeFileDrop(ctx)

    const before = nodeStore.getNodes().length
    const payload = buildClipboardPastePayload(
      pasteEvent({ types: ['text/plain'], data: { 'text/plain': 'external text' } }),
    )
    const entries = pasteEntries(ctx)
    expect(dispatchClipboardPaste(entries, payload)).toBe(true)
    await new Promise((r) => setTimeout(r, 20))

    const nodes = nodeStore.getNodes()
    expect(nodes.length).toBe(before + 1)
    const added = nodes.at(-1)!
    expect(added.type).toBe('text')
    expect(added.data.text).toContain('external text')
    ctx.stop()
  })

  it('真机形状：图片粘贴时 types 只有 ["Files"]，真实类型在 files 上 → 仍应建图片节点', async () => {
    const { ctx, nodeStore } = boot()
    ctx.plugin(clipboardPlugin)
    await ctx.start()
    installFakeFileDrop(ctx)

    const before = nodeStore.getNodes().length
    // 真机实测：粘贴系统剪贴板里的图片时 clipboardData.types 常是 ['Files']，
    // 真实 MIME 在 files[0].type 上 —— 判据必须看 files，不能看 types。
    const payload = buildClipboardPastePayload(
      pasteEvent({ types: ['Files'], files: [new File(['img'], 'image.png', { type: 'image/png' })] }),
    )
    const entries = pasteEntries(ctx)
    expect(dispatchClipboardPaste(entries, payload)).toBe(true)
    await new Promise((r) => setTimeout(r, 30))

    const nodes = nodeStore.getNodes()
    expect(nodes.length).toBe(before + 1)
    expect(nodes.at(-1)!.type).toBe('image')
    ctx.stop()
  })

  it('仲裁优先级：clipboard 节点(10) 先于 file-drop 媒体(20) 先于 file-drop 文本(30)', async () => {
    const { ctx } = boot()
    ctx.plugin(clipboardPlugin)
    await ctx.start()
    installFakeFileDrop(ctx)
    const orders = pasteEntries(ctx).map((e) => e.order)
    expect(orders).toEqual([10, 20, 30])
    ctx.stop()
  })
})
