/**
 * plugin-cursor-effect —— 画布光标特效插件。
 *
 * 效果（三个维度）：
 * - **光标指针**：图标跟随（会动）/ 系统内置 / 图片；统一用"透明原生指针 + 跟随元素"实现；
 * - **跟随特效**：鼠标划过的拖尾（彩虹 / 仙女尘 / 雪花 / 气泡 / 幽灵 / 蚂蚁…）；
 * - **点击特效**：单击炸开的粒子（烟花 / 星芒 / 涟漪 / 彩纸 / 爱心 / 冲击波 / 雪爆）。
 *
 * 分层（照本仓库插件的标准做法）：
 * - **渲染**：一个 overlay 组件（`CursorEffectOverlay.vue`）注册进 `overlay` 槽，画布之上的一层；
 * - **逻辑**：纯函数全在 `engine.ts`（粒子配方 / 帧推进 / 图标 → SVG），Node 可单测；
 * - **目录**：可选清单 + Config schema 全在 `catalog.ts`（单一事实源）；
 * - **配置页**：左导航项注册进 `settingsNav`、整页注册进 `settingsGroup/光标`（自绘 UI）。
 *
 * 配置（内核 Config，见 catalog.ts）：扁平分组「光标」→ 设置面板里独占一个一级页；
 * 自绘页直接以 Config 为唯一默认来源，改动写回 settings（随 settingsPersist 自动持久化、实时生效）。
 */
import { markRaw } from 'vue'
import type { Context, PluginModule } from '@mini-canvas/canvas-base'
import { Config, CURSOR_NAV_ID } from './catalog'
import CursorEffectOverlay from './CursorEffectOverlay.vue'
import CursorSettingsNav from './components/settings/CursorSettingsNav.vue'
import CursorSettingsPage from './components/settings/CursorSettingsPage.vue'

export const name = 'cursor-effect'
/** 不写死依赖：设置服务做可选探测（缺了就当全默认），不阻塞本插件；overlay 槽由渲染层恒在 */
export const inject = [] as string[]

export { Config }
export * from './catalog'
export {
  svgIcon, dataUri, hasColorAsset, TRANSPARENT_CURSOR,
  spawnSpec, pushWithin, stepParticles, stepRings,
} from './engine'
export type { Particle, Ring, SpawnSpec } from './engine'
export { COLOR_ASSETS } from './colorAssets'

export function apply(ctx: Context): void {
  // ① 画布之上的一层：光标跟随 + 拖尾 + 点击特效（组件内按配置决定画什么）
  ctx.slots.register('overlay', {
    id: 'cursor-effect-overlay',
    order: 45,
    component: markRaw(CursorEffectOverlay),
    meta: { title: '光标特效' },
  })

  // ② 设置面板：左导航「光标」项 + 整页正文（mode: replace = 这一页完全由本插件自绘）
  ctx.slots.register('settingsNav', {
    id: CURSOR_NAV_ID,
    order: 7,
    component: markRaw(CursorSettingsNav),
    meta: { title: '光标' },
  })
  ctx.slots.register('settingsGroup/' + CURSOR_NAV_ID, {
    id: 'cursor-effect-page',
    order: 7,
    component: markRaw(CursorSettingsPage),
    meta: { mode: 'replace' },
  })
}

export const cursorEffectPlugin: PluginModule = { name, inject, Config, apply }
