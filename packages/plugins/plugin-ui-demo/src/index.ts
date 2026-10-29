/**
 * plugin-ui-demo —— UI 扩展能力演示插件（不做业务，只演示接线）。
 *
 * 演示三件事：
 * ① 图片顶栏按钮组内部插一条：ctx.slots.register('image.topToolbar', …)
 *    —— 与上传/裁剪/扩展排在同一排（不会在组外另起一块面板）；
 * ② 下拉按钮 + 二级菜单：主题库默认件 toolbarDropdown
 *    （触发器 = 主题 button；二级菜单是独立浮层，不嵌进主面板）；
 * ③ 功能模式：**同一根顶栏、同一根底栏换内容**（不是叠加第二套栏）：
 *    - 顶栏：入口组件自己按会话切换成功能按钮（还在同一个按钮组里）；
 *    - 底栏：nodeToolbar 服务的模式 bottomBar —— 进入模式后下栏整格替换；
 *    两边共享 nodeToolbar 服务（主题件）上的会话（enter / exit），同步开合。
 *
 * 卸载本插件：条目自动回收，画布回原样。
 */
import { markRaw } from 'vue'
import type { PluginModule, Context } from '@mini-canvas/canvas-base'
import DemoTopEntry from './DemoTopEntry.vue'
import DemoFeaturePanel from './DemoFeaturePanel.vue'
import { closeDemoMode } from './demoMode'

export const name = 'ui-demo'
/**
 * nodeToolbar 是主题插件的服务（模式注册表 + 会话）：没装主题时本插件照常工作
 * （顶栏按钮仍在），只是 enter 拿不到 —— 所以不进 inject（可选依赖用 tryGet）。
 */
export const inject = [] as string[]

export function apply(ctx: Context): void {
  // ① 顶栏：图片按钮组内部的一条（与 host/upload、host/crop、host/expand 一起排）
  ctx.slots.register('image.topToolbar', {
    id: 'ui-demo/top-entry',
    order: 400,
    component: markRaw(DemoTopEntry),
  })

  // ② 功能模式：注册到 nodeToolbar（主题件）。进入后下栏整格换成 DemoFeaturePanel。
  const registerMode = (): boolean => {
    const svc = ctx.tryGet<{
      registerMode?(mode: unknown): void
    } | undefined>('nodeToolbar')
    if (!svc?.registerMode) return false
    svc.registerMode({
      id: 'ui-demo/feature',
      types: ['image'],
      title: '功能演示',
      description: '演示：下栏换成该功能的 UI（同一格，不叠加）',
      bottomBar: markRaw(DemoFeaturePanel),
    })
    return true
  }
  if (!registerMode()) {
    // 主题还没装（装配顺序在后/热装）：等它上架再注册一次
    const off = ctx.on('ctx:plugin-installed', () => {
      if (registerMode()) off.dispose()
    })
  }
}

export const uiDemoPlugin: PluginModule = { name, inject, apply }
export default uiDemoPlugin
