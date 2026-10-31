/**
 * 拖出分镜组 → 必须**真正解父**（用户口径 2026-10-30："我把图片拖拽到指定槽位后…
 * 只要松开节点，都会进入吸附效果"；反过来拖出卡片就该变回自由节点）。
 *
 * 为什么单列一份：前面几轮的 storyboard.test.ts 只测纯函数（decideSnap 返回 detach），
 * 没有任何一条测试真正跑 applyStoryboardDrop 的**写入**。于是"判定说 detach、库里 parentId 还在"
 * 这种错位完全测不出来 —— 浏览器实测（2026-10-31）就是这个现象：节点从 DOM 消失，
 * 数据里 parentId 仍指向分镜组，position 却已经写成绝对值。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Context } from '@mini-canvas/canvas-data'
import { createCanvasBasePlugin } from '@mini-canvas/canvas-data'
import { MemoryStorageAdapter } from '@mini-canvas/canvas-data'
import { NodeLayoutService } from '@mini-canvas/canvas-render'
import { applyStoryboardDrop, storyboardHitAt } from '../storyboardDrag'

interface Harness {
  ctx: Context
  doc: {
    getNode(id: string): { id: string; type?: string; parentId?: string; position: { x: number; y: number }; size?: { w: number; h: number }; data?: Record<string, unknown> } | undefined
    getNodes(): Array<{ id: string; type?: string; parentId?: string; position: { x: number; y: number }; size?: { w: number; h: number }; data?: Record<string, unknown> }>
    updateNode(id: string, patch: Record<string, unknown>): unknown
  }
  stop(): void
}

/** 最小真实宿主：基础插件（真 doc / 真 nodeLayout），不碰 DOM。 */
async function boot(): Promise<Harness> {
  const ctx = new Context()
  const base = createCanvasBasePlugin({ adapter: new MemoryStorageAdapter() })
  ctx.plugin(base.plugin)
  await ctx.start()
  const layout = new NodeLayoutService(base.services.nodeStore)
  ctx.provide('nodeLayout', layout)
  // 分镜组 + 一张已在槽位里的图片（父级 = 分镜组，position 相对父）
  base.services.nodeStore.registerType({ type: 'image', label: '图片', defaultSize: { w: 480, h: 240 } })
  base.services.nodeStore.registerType({ type: 'storyboard', label: '分镜组', transparent: true, defaultSize: { w: 480, h: 360 } })
  base.services.nodeStore.registerType({ type: 'video', label: '视频', defaultSize: { w: 480, h: 270 } })
  base.services.nodeStore.addNodes([
    {
      id: 'board',
      type: 'storyboard',
      position: { x: 1000, y: 1000 },
      size: { w: 600, h: 400 },
      data: { rows: 2, cols: 2, slots: ['img', null, null, null] },
    },
    {
      id: 'img',
      type: 'image',
      parentId: 'board',
      position: { x: 8, y: 42 },
      size: { w: 280, h: 160 },
      data: { imageWidth: 16, imageHeight: 9, _storyboardSize: { w: 320, h: 240 } },
    },
    {
      id: 'vid',
      type: 'video',
      position: { x: 100, y: 100 },
      size: { w: 320, h: 180 },
      data: { videoWidth: 16, videoHeight: 9 },
    },
    {
      id: 'vid2',
      type: 'image',
      position: { x: 200, y: 200 },
      size: { w: 320, h: 180 },
      data: { imageWidth: 16, imageHeight: 9 },
    },
  ])
  return {
    ctx,
    doc: base.services.doc as unknown as Harness['doc'],
    stop: () => ctx.stop(),
  }
}

describe('applyStoryboardDrop：拖出分镜组解父', () => {
  let h: Harness
  beforeEach(async () => { h = await boot() })
  afterEach(() => h.stop())

  it('拖到卡片外：parentId 清空、position 是绝对坐标、尺寸还原', () => {
    // 拖到明确在卡片外的地方（卡片绝对矩形 1000..1600 / 1000..1400）
    const handled = applyStoryboardDrop(h.ctx, { nodeId: 'img', position: { x: 200, y: 200 } })
    expect(handled).toBe(true)
    const img = h.doc.getNode('img')!
    expect(img.parentId).toBeUndefined()
    // 绝对坐标 = 卡片绝对位置 + 相对位置（1000+8 / 1000+42），不是拖拽落点
    expect(img.position).toEqual({ x: 1008, y: 1042 })
    expect(img.size).toEqual({ w: 320, h: 240 })
    expect(h.doc.getNode('board')!.data?.slots).toEqual([null, null, null, null])
  })

  it('拖到卡片外（宿主已先写相对坐标）：仍必须解父，且落在正确绝对位置', () => {
    // 真实宿主 onNodeDragStop 的顺序：先把 VueFlow 的**相对父**坐标写进 store，再 emit drag-end。
    // 这条路径是浏览器实测（2026-10-31）里唯一没被覆盖的：写完之后 parentId 还在，
    // 而 detach 若拿错基准就会把节点甩到画布外（外壳被剔除 → DOM 里“凭空消失”）。
    h.doc.updateNode('img', { position: { x: 700, y: 500 } }) // 相对父：已拖到卡片右下方之外
    const abs = { x: 1000 + 700, y: 1000 + 500 }
    const handled = applyStoryboardDrop(h.ctx, { nodeId: 'img', position: abs })
    expect(handled).toBe(true)
    const img = h.doc.getNode('img')!
    expect(img.parentId).toBeUndefined()
    expect(img.position).toEqual(abs)
  })
})

/**
 * 「分镜组只收图片节点」这句提示的触发条件（用户口径 2026-10-31）。
 *
 * 以前只要拖的节点不是图片就会弹，拖视频去画布空白处、拖文字挪个位置都会被打断。
 * 现在必须**真的压在分镜组内部**才提示 —— 判定与吸附同一套几何。
 */
describe('storyboardHitAt：只在真压到分镜组内部时才算命中', () => {
  let h: Harness
  beforeEach(async () => { h = await boot() })
  afterEach(() => h.stop())

  it('视频拖到画布空白处：不命中（不该弹提示）', () => {
    expect(storyboardHitAt(h.ctx, { nodeId: 'vid', position: { x: 100, y: 100 } })).toBeNull()
  })

  it('视频拖进分镜组内部：命中，且报出目标槽位', () => {
    // 卡片绝对矩形 1000..1600 / 1000..1400；落点压在第一格
    const hit = storyboardHitAt(h.ctx, { nodeId: 'vid', position: { x: 1010, y: 1010 } })
    expect(hit).not.toBeNull()
    expect(hit!.boardId).toBe('board')
    expect(hit!.slotIndex).toBe(0)
  })

  it('图片同样适用：拖出组外不命中，拖回组内命中', () => {
    expect(storyboardHitAt(h.ctx, { nodeId: 'img', position: { x: 200, y: 200 } })).toBeNull()
    expect(storyboardHitAt(h.ctx, { nodeId: 'img', position: { x: 1300, y: 1100 } })).not.toBeNull()
  })

  it('拖分镜组自己：永远不算命中（不能把自己吸进自己）', () => {
    expect(storyboardHitAt(h.ctx, { nodeId: 'board', position: { x: 1010, y: 1010 } })).toBeNull()
  })
})

/**
 * 一槽一图：外部拖进来的图把原住户挤走，且**不会**留下“同一格两个 parentId”。
 *
 * 用户实测 2026-10-31：外部拖入时宿主已经先给节点写了 parentId，slots 里还没有它，
 * 于是两张图挂在同一格上重叠。这里直接跑 applyStoryboardDrop 的写入路径来钉住。
 */
describe('applyStoryboardDrop：一槽一图（外部拖入）', () => {
  let h: Harness
  beforeEach(async () => { h = await boot() })
  afterEach(() => h.stop())

  it('拖进已被占用的格：原住户被挤出该格，槽位表不出现两个 id', () => {
    // board 的卡片矩形 1000..1600 / 1000..1400；第 0 格左上区域
    const handled = applyStoryboardDrop(h.ctx, { nodeId: 'vid2', position: { x: 1010, y: 1010 } })
    expect(handled).toBe(true)
    const board = h.doc.getNode('board')!
    const slots = board.data!.slots as Array<string | null>
    // 第 0 格只剩一个 id
    expect(slots[0]).toBe('vid2')
    expect(slots.filter((s) => s === 'vid2')).toHaveLength(1)
    // 原来占第 0 格的 img 不能再挂在组里（它是被顶掉的那张）
    const img = h.doc.getNode('img')!
    expect(img.parentId).toBeUndefined()
    // 新来的图落在组里
    expect(h.doc.getNode('vid2')!.parentId).toBe('board')
  })

  it('组内每个槽位最多一个节点：脏数据里的“多出来那张”会被解父', () => {
    // 制造脏数据：再挂一张图到组里，但 slots 里没有它
    h.ctx.tryGet<{ addNodes(inputs: unknown[]): unknown }>('doc')!.addNodes([
      { id: 'extra', type: 'image', parentId: 'board', position: { x: 10, y: 40 }, size: { w: 100, h: 60 }, data: {} },
    ])
    applyStoryboardDrop(h.ctx, { nodeId: 'vid2', position: { x: 1300, y: 1300 } })
    expect(h.doc.getNode('extra')!.parentId).toBeUndefined()
  })
})
