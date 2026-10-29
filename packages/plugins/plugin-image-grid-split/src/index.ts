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
import type { PluginModule, Context } from '@mini-canvas/canvas-base'
import GridSplitEntry from './GridSplitEntry.vue'
import GridSplitPanel from './GridSplitPanel.vue'
import GridSplitOverlay from './GridSplitOverlay.vue'
import { endSplit, onSplitChange, splitNodeIds } from './splitSession'

export const name = 'image-grid-split'
/**
 * nodeToolbar 是主题插件的服务（可选依赖用 tryGet，不进 inject）。
 * doc 也不是硬依赖：本插件现阶段只在 UI 上接线，写库由后续命令走 doc。
 */
export const inject = [] as string[]

export function apply(ctx: Context): void {
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
}

export const gridSplitPlugin: PluginModule = { name, inject, apply }
export default gridSplitPlugin
