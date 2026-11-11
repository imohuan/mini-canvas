/**
 * 分镜组层级（用户截图 2026-11-02）：
 *  - 分镜组外框必须垫在图片**下面**（图片不能被底板盖住）；
 *  - 从源图接进来的连线必须还能看见。
 *
 * 这两个需求看起来冲突：壳给普通节点的 z 比它自己的子节点**低**（父 z + 1 才是子节点），
 * 如果分镜组声明成普通实底卡片，底板就压在所有子图上；如果只是透明，卡片又没有白色底。
 * 正确解法是声明 transparent（壳把容器降到 groupBase、不铺卡片色），
 * 白底由 StoryboardGrid 自己画。
 */
import { describe, it, expect, afterEach } from 'vitest'
import { Context, createCanvasBasePlugin, MemoryStorageAdapter } from '@plume-canvas/canvas-data'
import { LAYERS, nodesFromStore } from '@plume-canvas/canvas-render'
import { gridSplitPlugin } from '../index'

async function boot() {
  const ctx = new Context()
  const base = createCanvasBasePlugin({ adapter: new MemoryStorageAdapter() })
  ctx.plugin(base.plugin)
  ctx.plugin(gridSplitPlugin)
  await ctx.start()
  const doc = base.services.doc
  // 只测层级：补一个最小 image 类型（生产由 plugin-node-image 注册；这里不装整包）
  doc.registerType({ type: 'image', label: '图片', defaultSize: { w: 320, h: 240 } })
  const board = doc.createNode('storyboard', { x: 100, y: 100 }, { rows: 2, cols: 2, slots: [null, null, null, null] })
  doc.setNodeSize(board, 600, 400)
  const img = doc.createNode('image', { x: 10, y: 10 }, {})
  doc.setNodeParent(img, board)
  return { ctx, doc, base, board, img, stop: () => ctx.stop() }
}

describe('分镜组层级与透明能力', () => {
  let h: Awaited<ReturnType<typeof boot>> | undefined
  afterEach(() => h?.stop())

  it('storyboard 类型声明 transparent（否则实底卡片 z=node 会盖住子图/连线）', async () => {
    h = await boot()
    const def = h.doc.types.get('storyboard')
    expect(def?.transparent).toBe(true)
  })

  it('渲染投影：分镜组 z 落在 groupBase，图片子节点比它高（图片能透出来）', async () => {
    h = await boot()
    const flow = nodesFromStore(h.base.services.nodeStore)
    const b = flow.find((n) => n.id === h!.board)!
    const i = flow.find((n) => n.id === h!.img)!
    expect(b.zIndex).toBe(LAYERS.groupBase)
    expect(i.zIndex).toBeGreaterThan(b.zIndex!)
    // 连线（LAYERS.edge）仍在容器之上：从源图接到分镜图的线不会被底板吃掉
    expect(b.zIndex!).toBeLessThan(LAYERS.edge)
  })
})
