/**
 * plugin-image-grid-split —— 图片节点的宫格切分（按 docs/examples/node-toolbar.md 写法）。
 *
 * 三件事：
 * ① 方式 A：往 image.topToolbar 按钮组里插一条「宫格切分」下拉
 *    （与上传/裁剪/扩展同排；预设 + 二级菜单在本插件自己组件里）；
 * ② 方式 C：注册一个功能模式 image-grid-split/workbench
 *    —— 进入后底栏整格换成切分操作面板（topBar 不接管：仍由图片默认顶栏显示）；
 * ③ 进入/退出模式时清掉自己的会话（onSplitChange 两腿同步，双保险防旧 UI 残留）。
 *
 * 卸载本插件：插槽条目与模式注册自动回收；会话跟着包作用域一起清。
 */
import { markRaw } from 'vue'
import type { ConfigSchema, PluginModule, Context } from '@mini-canvas/canvas-base'
import GridSplitEntry from './GridSplitEntry.vue'
import GridSplitPanel from './GridSplitPanel.vue'
import GridSplitOverlay from './GridSplitOverlay.vue'
import StoryboardGrid from './StoryboardGrid.vue'
import { endSplit, onSplitChange, splitNodeIds } from './splitSession'
import { onStoryboardDragEnd, onStoryboardDragMove } from './storyboardDrag'
import { STORYBOARD_LAYOUT_KEYS } from './storyboard'

export const name = 'image-grid-split'
/**
 * nodeToolbar 是主题插件的服务（可选依赖用 tryGet，不进 inject）。
 * doc 也不是硬依赖：本插件现阶段只在 UI 上接线，写库由后续命令走 doc。
 */
export const inject = [] as string[]

/**
 * 设置面板「布局/分镜组」：行/列间距、内边距、顶部标题留白都可配
 * （用户口径 2026-10-30：间距写死应对不了隐藏标题等特殊情况）。
 * 读取不落地缓存 —— 消费方每次现取 settings，改配置立刻生效（与分组留白同一条规矩）。
 */
export const Config = {
  [STORYBOARD_LAYOUT_KEYS.rowGap]: {
    type: 'number', default: 10, min: 0, max: 120, step: 2,
    label: '行间距（px）', group: '布局/分镜组',
    description: '分镜组里上下两行图片之间的间距。',
  },
  [STORYBOARD_LAYOUT_KEYS.colGap]: {
    type: 'number', default: 10, min: 0, max: 120, step: 2,
    label: '列间距（px）', group: '布局/分镜组',
    description: '分镜组里左右两列图片之间的间距。',
  },
  [STORYBOARD_LAYOUT_KEYS.padding]: {
    type: 'number', default: 8, min: 0, max: 120, step: 2,
    label: '内边距（px）', group: '布局/分镜组',
    description: '槽位网格到分镜组卡片边缘的距离（左/右/下；顶部另配）。',
  },
  [STORYBOARD_LAYOUT_KEYS.topPadding]: {
    type: 'number', default: 34, min: 0, max: 120, step: 2,
    label: '顶部留白（px）', group: '布局/分镜组',
    description: '给标题条留的位置。隐藏标题的画布可以把这项调小。',
  },
} as const satisfies ConfigSchema

export function apply(ctx: Context): void {
  // ⓪ 分镜组节点类型：**容器节点**（和分组同一族，但会把子节点锁进槽位）。
  //    - data.slots 存子节点 id（图片仍是真节点，不是卡片里画的图）；
  //    - transparent 让子节点透出、卡片只画底板；
  //    - resizable 允许用户改行列后拉大卡片；
  //    - 不接边（inputs/outputs 显式空数组 = 无端口）。
  // 真实宿主 nodeStore/nodeRegistry 恒在；极简 ctx（单测桩）没有 → 跳过节点注册（无画布，注册无意义）
  try {
    ctx.nodes.register({
      type: 'storyboard',
      label: '分镜组',
      nameTemplate: '分镜组 {{ID}}',
      description: '把图片节点拖进槽位自动吸附，可在槽位间拖拽排序、拖出解除',
      size: { w: 480, h: 360 },
      in: StoryboardGrid,
      inputs: [],
      outputs: [],
      // 容器语义：透明底（子节点在上面），可缩放（行列固定、格子跟着变大）
      transparent: true,
      resizable: true,
    })
  } catch {
    // 服务缺席/类型冲突：静默跳过（与 overlay/contribute 同一条宽容口径）
  }

  // ① 顶栏入口（与 host/upload / host/crop / host/expand 同排；order 500 排在演示条目后面）
  ctx.slots.register('image.topToolbar', {
    id: 'image-grid-split/entry',
    order: 500,
    component: markRaw(GridSplitEntry),
  })

  // ①b 图片上的格子勾选层：往 image 的 over:inset 段叠一个 occupant
  //    （与 image 插件的 ImageOverlays 同段同屏；本层按会话状态自己显隐）。
  //    装配顺序上 image 可能还没注册 —— 用 node/region 能力的 contribute，宿主装好 type 后自动补渲染。
  // 真实宿主 nodeRegistry 恒在；极简 ctx（单测桩）没有 → 跳过即可（没有节点渲染，层挂不挂无意义）
  try {
    ctx.nodes.contribute('image', 'over:inset', markRaw(GridSplitOverlay), {
      id: 'image-grid-split/overlay',
      order: 10,
    })
  } catch {
    // nodeRegistry 缺席：静默降级（与"主题缺席"同一条宽容口径）
  }

  // ② 功能模式：进入后底栏整格换成 GridSplitPanel（顶栏不动，图片默认栏照常）
  const registerMode = (): boolean => {
    const svc = ctx.tryGet<{
      registerMode?(mode: unknown): void
    } | undefined>('nodeToolbar')
    if (!svc?.registerMode) return false
    svc.registerMode({
      id: 'image-grid-split/workbench',
      types: ['image'],
      title: '宫格切分',
      description: '宫格切分工作台：底栏换成勾选与发布操作',
      // order 大于默认（100）：本插件不顶替别人的默认栏
      order: 500,
      // 用户口径 2026-10-30：进入模式后**只有底部状态栏**，顶栏整排让位。
      // nodeToolbar 的 null = 这一格故意不显示（不是"沿用默认"）。
      topBar: null,
      bottomBar: markRaw(GridSplitPanel),
    })
    return true
  }
  if (!registerMode()) {
    // 主题还没装（装配顺序在后/热装）：等它上架再注册一次
    const off = ctx.on('ctx:plugin-installed', () => {
      if (registerMode()) off.dispose()
    })
  }

  // ③ 会话 ↔ 模式双向同步：谁先退都行，另一边跟着清（双保险，防旧 UI 残留）
  const offSession = onSplitChange((nodeId, active) => {
    const svc = ctx.tryGet<{
      enter?(nodeId: string, modeId: string): void
      exit?(nodeId: string): void
    } | undefined>('nodeToolbar')
    if (!svc) return
    if (active) svc.enter?.(nodeId, 'image-grid-split/workbench')
    else svc.exit?.(nodeId)
  })
  ctx.effect(() => () => {
    offSession()
    // 包作用域回收时清掉所有会话（防热重载后残留旧状态）
    for (const id of splitNodeIds()) endSplit(id)
  })

  // ④ 拖拽归属：图片拖进分镜组 → 吸附到槽位/换位；拖出 → 脱离还原
  const offDrop = onStoryboardDragEnd(ctx, (handled, payload) => {
    // 非图片节点被拖到槽位上时不吸附，给一句提示（只在真的落在组范围里才提示）
    if (handled) return
    const doc = ctx.tryGet<{ getNode(id: string): { type?: string } | undefined } | undefined>('doc')
    const type = doc?.getNode(payload.nodeId)?.type
    if (type && type !== 'image' && type !== 'storyboard') {
      ctx.tryGet<{ show?(t: string): void }>('tip')?.show?.('分镜组只收图片节点')
    }
  })
  ctx.effect(() => () => offDrop.dispose())
  // 拖动逐帧：获胜槽位高亮 + 拖动节点半透明（用户口径 2026-10-30）
  const offMove = onStoryboardDragMove(ctx)
  ctx.effect(() => () => offMove.dispose())
}

export const gridSplitPlugin: PluginModule<{ [K in keyof typeof Config]: unknown }> = { name, inject, Config, apply }
export default gridSplitPlugin
