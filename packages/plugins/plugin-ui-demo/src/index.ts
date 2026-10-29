/**
 * plugin-ui-demo —— UI 扩展能力演示插件（不做业务，只演示接线）。
 *
 * 演示四件事：
 * ① 图片顶栏插槽：ctx.nodes.attach('image', { region: 'out:top' }) —— 与现有 ImageTopToolbar
 *    同区域叠加（BaseNode 会把同区域条目按 order 排一行）。
 * ② 下拉按钮 + 二级菜单：主题库 button / dropdown 按名取（DemoTopEntry.vue）。
 * ③ 功能模式（顶栏 + 底栏替换成独属于该功能的 UI）：
 *    - 顶栏：attach('image', { region: 'on:top', component: DemoTopPanel }) —— 功能激活时
 *      显示在卡片上边框外侧，盖住默认顶栏语义（顶栏替换演示）；
 *    - 底栏：attach('image', { region: 'on:bottom', component: DemoBottomPanel }) ——
 *      显示在卡片下边框外侧，演示「底栏被功能接管」。
 *    （为什么不往 out:top / out:bottom 再塞一条替换段：那会和现有条目并排/叠加，
 *      不是「替换」的语义；on:top / on:bottom 是贴边框外侧的独立层，正好承载「专属状态栏」。）
 * ④ 会话单源：demoMode 模块级响应式，顶栏按钮与顶/底栏面板读写同一份。
 *
 * 卸载本插件：attach 条目自动回收，画布回到原样。
 */
import { markRaw } from 'vue'
import type { PluginModule, Context } from '@mini-canvas/canvas-base'
import DemoTopEntry from './DemoTopEntry.vue'
import DemoTopPanel from './DemoTopPanel.vue'
import DemoBottomPanel from './DemoBottomPanel.vue'

export const name = 'ui-demo'
export const inject = [] as string[]

export function apply(ctx: Context): void {
  // ① 顶栏入口（与 ImageTopToolbar 同区域，显示在它旁边 —— 由节点壳上插槽统一排）
  ctx.nodes.attach('image', {
    id: 'ui-demo/top-entry',
    region: 'out:top',
    component: markRaw(DemoTopEntry),
  })

  // ② 功能模式顶栏（贴卡片上边框外侧；激活时就是「这个功能的顶栏」）
  ctx.nodes.attach('image', {
    id: 'ui-demo/top-panel',
    region: 'on:top',
    component: markRaw(DemoTopPanel),
  })

  // ③ 功能模式底栏（贴卡片下边框外侧；激活时就是「这个功能的底栏」）
  ctx.nodes.attach('image', {
    id: 'ui-demo/bottom-panel',
    region: 'on:bottom',
    component: markRaw(DemoBottomPanel),
  })
}

export const uiDemoPlugin: PluginModule = { name, inject, apply }
export default uiDemoPlugin
