/**
 * plugin-image-grid-split —— 图片宫格切分插件。
 *
 * 功能：
 * 1. 图片节点上控制栏的“宫格切分”入口（预设 + 自定义行列）；
 * 2. 全屏宫格工作台（勾选格子、退出、创建分镜组、发布到画布）；
 * 3. 分镜组节点类型（固定槽位容器；槽位图片可拖动交换）。
 *
 * 数据契约：
 * - 切片字节一律 resources.put → resourceId；节点数据不存 blob:/data: 地址；
 * - 分镜组槽位里只存 resourceId；隐藏引用清单 storyboardResourceIds 供宿主资源回收扫描；
 * - 图片节点 / 分镜组都遵守“尺寸写 node.size、卡片镜像由 nodeStore 自动补”的现行约定。
 */
import { markRaw } from 'vue'
import type { PluginModule, Context } from '@mini-canvas/canvas-base'
import { STORYBOARD_NODE_TYPE } from './gridLogic'
import GridSplitMenu from './GridSplitMenu.vue'
import GridSplitWorkbench from './GridSplitWorkbench.vue'
import StoryboardContent from './StoryboardContent.vue'
import {
  moveImageIntoSlot,
  takeImageOutOfSlot,
  swapStoryboardSlots,
  geometryOf,
} from './storyboardOps'

export const name = 'image-grid-split'
export const inject = [] as string[]

export function apply(ctx: Context): void {
  // ① 图片节点上控制栏入口：挂 image 插件的 out:top 区域（内容段由现有 ImageTopToolbar 占着；
  //    这里用 attach 星号通配会连文本/视频一起挂上，所以必须精确到 image 类型）。
  ctx.nodes.attach('image', {
    id: 'image-grid-split/menu',
    region: 'out:top',
    component: markRaw(GridSplitMenu),
  })

  // ② 全屏工作台：挂在画布 overlay 槽（.csurface-overlay，VueFlow 之上、外壳之下）；
  //    组件自己 Teleport 到 body，防止节点 transform 把它关进层叠上下文。
  ctx.slots.register('overlay', {
    id: 'image-grid-split/workbench',
    order: 40,
    component: markRaw(GridSplitWorkbench),
    meta: { title: '宫格切分工作台' },
  })

  // ③ 分镜组节点类型：固定槽位容器；不接输入输出（容器不参与连线），
  //    transparent = 让连接线透出卡片区域（与 group 同一条能力）。
  ctx.nodes.register({
    type: STORYBOARD_NODE_TYPE,
    label: '分镜组',
    nameTemplate: '宫格分镜组 {{ID}}',
    description: '固定槽位的分镜容器，槽位图片可拖动交换',
    size: { w: 900, h: 700 },
    transparent: true,
    inputs: [],
    outputs: [],
    in: StoryboardContent,
  })

  // ④ 命令：拖入/拖出/交换三个动作都走命令表（右键菜单 / 快捷键将来可复用）。
  ctx.commands.register({
    id: 'image-grid-split:drop-image',
    title: '把图片节点放进分镜槽位',
    run(_c, payload) {
      const p = (payload ?? {}) as { storyboardId?: string; imageNodeId?: string; slotIndex?: number }
      const doc = ctx.get('doc')
      if (!p.storyboardId || !p.imageNodeId || typeof p.slotIndex !== 'number') return false
      return moveImageIntoSlot(doc, { storyboardId: p.storyboardId, imageNodeId: p.imageNodeId, slotIndex: p.slotIndex }).ok
    },
  })
  ctx.commands.register({
    id: 'image-grid-split:take-out',
    title: '从分镜槽位取出图片',
    run(_c, payload) {
      const p = (payload ?? {}) as { storyboardId?: string; slotIndex?: number; position?: { x: number; y: number } }
      const doc = ctx.get('doc')
      if (!p.storyboardId || typeof p.slotIndex !== 'number') return false
      return takeImageOutOfSlot(doc, {
        storyboardId: p.storyboardId,
        slotIndex: p.slotIndex,
        position: p.position ?? { x: 0, y: 0 },
        createImageNode: (resourceId, pos, meta) => {
          const creator = ctx.registryOf<{ addNode?(request: { kind: string; resourceId: string; position: { x: number; y: number }; meta?: Record<string, unknown> }): string | undefined }>('media/creator').top('image')?.value
          return creator?.addNode?.({
            kind: 'image',
            resourceId,
            position: pos,
            meta: { name: meta.name, width: meta.width, height: meta.height },
          })
        },
      }).ok
    },
  })
  ctx.commands.register({
    id: 'image-grid-split:swap-slots',
    title: '交换分镜槽位',
    run(_c, payload) {
      const p = (payload ?? {}) as { storyboardId?: string; a?: number; b?: number }
      const doc = ctx.get('doc')
      if (!p.storyboardId || typeof p.a !== 'number' || typeof p.b !== 'number') return false
      return swapStoryboardSlots(doc, { storyboardId: p.storyboardId, a: p.a, b: p.b }).ok
    },
  })

  // ⑤ 拖动归组：分镜组的子图片节点拖出容器边界 = 取出；拖到另一个空槽 = 交换。
  //    这里用同一个 node-drag-end 事件处理，不再依赖 group 插件的自动归组。
  const offDrag = ctx.on('node-drag-end', (payload: { nodeId: string; position: { x: number; y: number } }) => {
    const doc = ctx.get('doc')
    const node = doc.getNode(payload.nodeId)
    if (!node || node.parentId === undefined) return
    const parent = doc.getNode(node.parentId)
    if (!parent || parent.type !== STORYBOARD_NODE_TYPE) return
    const rows = typeof parent.data.rows === 'number' ? parent.data.rows : 1
    const cols = typeof parent.data.cols === 'number' ? parent.data.cols : 1
    const geo = geometryOf(parent.data)
    const local = { x: payload.position.x - parent.position.x, y: payload.position.y - parent.position.y }
    const rel = { x: local.x - geo.padding, y: local.y - geo.padding }
    const col = Math.floor(rel.x / (geo.cellWidth + geo.gap))
    const row = Math.floor(rel.y / (geo.cellHeight + geo.gap))
    const inside = row >= 0 && col >= 0 && row < rows && col < cols
    if (inside) {
      const slotIndex = row * cols + col
      const slots = Array.isArray(parent.data.slots) ? (parent.data.slots as Array<{ resourceId?: string } | null>) : []
      const currentIndex = slots.findIndex((s) => s?.resourceId && s.resourceId === node.data.resourceId)
      if (currentIndex !== slotIndex && currentIndex >= 0) {
        swapStoryboardSlots(doc, { storyboardId: parent.id, a: currentIndex, b: slotIndex })
      }
      return
    }
    const slotIndex = Array.isArray(parent.data.slots)
      ? (parent.data.slots as Array<{ resourceId?: string } | null>).findIndex((s) => s?.resourceId === node.data.resourceId)
      : -1
    if (slotIndex >= 0) {
      takeImageOutOfSlot(doc, {
        storyboardId: parent.id,
        slotIndex,
        position: { x: payload.position.x, y: payload.position.y },
      })
    }
  })
  ctx.effect(() => () => offDrag.dispose())
}

export const imageGridSplitPlugin: PluginModule = { name, inject, apply }
export default imageGridSplitPlugin
