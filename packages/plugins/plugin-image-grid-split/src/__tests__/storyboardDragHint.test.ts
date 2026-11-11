/**
 * 拖拽中的类型提示（用户口径 2026-11-02）：
 *
 * - 非图片节点与分镜组交叉时，立即显示跟随鼠标的 tip；
 * - 只高亮分镜组背景，不进入“槽位高亮”这一步（类型检查没过）；
 * - 拖出分镜组或松手后，tip 必须立即消失；
 * - 图片与分镜组交叉时不出提示，仍然高亮目标槽位。
 *
 * 这条测试直接驱动真实的 NodeDrag / NodeDragEnd 事件，锁定“提示不消失”的回归。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Context, createCanvasBasePlugin, MemoryStorageAdapter } from '@plume-canvas/canvas-data'
import { ViewService, createNotifyService } from '@plume-canvas/canvas-render'
import { disposeGhostSweep, onStoryboardDragEnd, onStoryboardDragMove, storyboardHover } from '../storyboardDrag'

interface Harness {
  ctx: Context
  notifications: ReturnType<typeof createNotifyService>
  move: { dispose(): void }
  end: { dispose(): void }
  stop(): void
}

async function boot(): Promise<Harness> {
  const ctx = new Context()
  const base = createCanvasBasePlugin({ adapter: new MemoryStorageAdapter() })
  ctx.plugin(base.plugin)
  await ctx.start()
  ctx.provide('view', new ViewService({ nodeStore: base.services.nodeStore }))
  const notifications = createNotifyService()
  ctx.provide('canvas', { notify: notifications.notify })

  base.services.nodeStore.registerType({ type: 'image', label: '图片', defaultSize: { w: 320, h: 240 } })
  base.services.nodeStore.registerType({ type: 'storyboard', label: '分镜组', transparent: true, defaultSize: { w: 480, h: 360 } })
  base.services.nodeStore.registerType({ type: 'video', label: '视频', defaultSize: { w: 480, h: 270 } })
  base.services.nodeStore.registerType({ type: 'text', label: '文本', defaultSize: { w: 300, h: 200 } })
  base.services.nodeStore.addNodes([
    {
      id: 'board',
      type: 'storyboard',
      position: { x: 1000, y: 1000 },
      size: { w: 600, h: 400 },
      data: { rows: 2, cols: 2, slots: [null, null, null, null] },
    },
    {
      id: 'vid',
      type: 'video',
      position: { x: 100, y: 100 },
      size: { w: 320, h: 180 },
      data: {},
    },
    {
      id: 'img',
      type: 'image',
      position: { x: 200, y: 200 },
      size: { w: 320, h: 180 },
      data: { imageWidth: 16, imageHeight: 9 },
    },
    // 文字节点：store 里没有 size（卡片大小来自类型默认值）—— 用户实测的真实形状。
    {
      id: 'txt',
      type: 'text',
      position: { x: -400, y: 900 },
      data: { label: '文本 156', text: '双击编辑' },
    },
  ])

  return {
    ctx,
    notifications,
    move: onStoryboardDragMove(ctx),
    end: onStoryboardDragEnd(ctx),
    stop: () => ctx.stop(),
  }
}

const insideBoard = { x: 1010, y: 1010 }
const outsideBoard = { x: 100, y: 100 }

describe('分镜组拖拽提示：交叉时出现，移开/松手时消失', () => {
  let h: Harness
  beforeEach(async () => { h = await boot() })
  afterEach(() => {
    h.move.dispose()
    h.end.dispose()
    // 提示的“已显示”标记是模块级的（生产由松手/指针抬起清）；用例之间必须回收，
    // 否则上一条用例留下的 tip 会让下一条用例的第一次拖动被当成重复而不显示。
    disposeGhostSweep()
    h.stop()
  })

  it('视频与分镜组交叉：显示跟随鼠标的常驻 tip，并只标记背景拒绝态', () => {
    h.ctx.emit('canvas:node:drag', { nodeId: 'vid', position: insideBoard })
    const tips = h.notifications.list()
    expect(tips.map((x) => x.message)).toEqual(['分镜组只收图片节点'])
    expect(tips[0]).toMatchObject({ followPointer: true, durationMs: 0 })
    expect(storyboardHover()).toMatchObject({ boardId: 'board', invalid: true, slotIndex: -1 })
  })

  it('视频拖出分镜组：tip 立即消失，背景拒绝态也清掉', () => {
    h.ctx.emit('canvas:node:drag', { nodeId: 'vid', position: insideBoard })
    h.ctx.emit('canvas:node:drag', { nodeId: 'vid', position: outsideBoard })
    expect(h.notifications.list()).toHaveLength(0)
    expect(storyboardHover()).toMatchObject({ boardId: '', invalid: false, slotIndex: -1 })
  })

  it('视频在分镜组上松手：tip 和悬停态都必须清掉', () => {
    h.ctx.emit('canvas:node:drag', { nodeId: 'vid', position: insideBoard })
    h.ctx.emit('canvas:node:drag-end', { nodeId: 'vid', position: insideBoard })
    expect(h.notifications.list()).toHaveLength(0)
    expect(storyboardHover()).toMatchObject({ boardId: '', invalid: false, slotIndex: -1 })
  })

  it('图片与分镜组交叉：不出拒绝提示，进入槽位高亮', () => {
    h.ctx.emit('canvas:node:drag', { nodeId: 'img', position: insideBoard })
    expect(h.notifications.list()).toHaveLength(0)
    expect(storyboardHover().boardId).toBe('board')
    expect(storyboardHover().invalid).toBe(false)
    expect(storyboardHover().slotIndex).toBeGreaterThanOrEqual(0)
  })

  it('视频在画布空白处拖动：既不提示，也不高亮', () => {
    h.ctx.emit('canvas:node:drag', { nodeId: 'vid', position: outsideBoard })
    expect(h.notifications.list()).toHaveLength(0)
    expect(storyboardHover().boardId).toBe('')
  })

  it('文字节点没有 size 时，用画布实测矩形判定交叉（不能退化成 0×0）', () => {
    h.ctx.emit('canvas:node:drag', { nodeId: 'txt', position: { x: 1000, y: 1000 } })
    expect(h.notifications.list().map((x) => x.message)).toEqual(['分镜组只收图片节点'])
    expect(storyboardHover()).toMatchObject({ boardId: 'board', invalid: true, slotIndex: -1 })
  })

  it('连续两帧都在组上：只保留一条提示（不重复入队）', () => {
    h.ctx.emit('canvas:node:drag', { nodeId: 'vid', position: insideBoard })
    h.ctx.emit('canvas:node:drag', { nodeId: 'vid', position: { x: 1012, y: 1012 } })
    expect(h.notifications.list()).toHaveLength(1)
  })
})
