/**
 * plugin-align-guide —— 对齐辅助线插件（独立包，v2 API）。
 *
 * 复刻老版 canvas-core/src/plugins/align-guide，但遵循 v2 铁律：
 * - 不直碰 VueFlow/宿主内部：拖拽事件从渲染层 RenderEvents 订阅，参考几何经 ctx.nodeLayout，
 *   吸附写回经渲染层 updateNodeVisual（拖拽中视觉写，不落盘、不整组重灌）。
 * - UI（参考线浮层）自管：AlignGuideOverlay.vue 注册进 overlay 槽（宿主 CanvasSurface 已渲染该槽），
 *   组件内 useCanvasRender 拿 viewport/updateNodeVisual 并订阅事件。
 * - 纯对齐/吸附算法在 alignGuideEngine.ts，独立单测。
 *
 * 本插件主体极薄：只负责把 overlay 组件按「总开关」注册进槽（scope 自动回收）；逻辑全在组件与引擎。
 * 总开关 = Config.alignGuideEnabled（设置面板可改，见 alignGuideConfig.ts）：
 * 关闭时浮层不装配（组件未挂载 = 不订阅拖拽、不吸附、不画线），开启时现装配，改动实时生效。
 */
import type { Context, PluginModule } from '@mini-canvas/canvas-base'
import AlignGuideOverlay from './AlignGuideOverlay.vue'
import { Config, ALIGN_GUIDE_COLOR_KEYS } from './alignGuideConfig'
import { bindAlignGuideToggle } from './alignGuideToggle'

export const name = 'align-guide'

/** 插件可配置项（P4：模块级 Config schema，随插件导出；默认值/分组见 alignGuideConfig.ts） */
export { Config }
export type { AlignGuideConfig } from './alignGuideConfig'

/**
 * 装配本插件的全部作用：把参考线浮层注册进 overlay 槽，并返回撤销函数。
 * 撤销 = 槽内 occupant 移除 = 组件卸载 = 拖拽订阅与参考线一起停（浮层组件即吸附与画线的全部实现）。
 */
function attach(ctx: Context): () => void {
  const id = ctx.slots.register('overlay', {
    id: 'align-guide',
    order: 60,
    component: AlignGuideOverlay,
    meta: { title: '对齐辅助线' },
  })
  return () => {
    if (id) ctx.slots.remove('overlay', id)
  }
}

/**
 * 把用户自定义的参考线颜色落到 <html> 内联变量（--uic-align-guide-light/dark）。
 *
 * 为什么写内联而不是别的：与宿主色板同一套机制（ui-theme.css 的 --ui-guide 消费这两个变量，
 * 亮/暗各挑一个；内联优先级最高、不怕加载顺序）。清空 = removeProperty，控制权交回 CSS 兜底
 * （--ui-accent，即跟随主题强调色）。随插件 fiber 回收，卸载时清干净不留"幽灵变量"。
 */
function bindGuideColorVars(ctx: Context): () => void {
  const settings = ctx.tryGet<{ get(k: string): unknown; onChange(cb: (k: string, v: unknown) => void): { dispose(): void } }>('settings')
  if (!settings || typeof document === 'undefined') return () => {}
  const root = document.documentElement
  const colorKeys = new Set<string>(Object.values(ALIGN_GUIDE_COLOR_KEYS))
  const sync = (): void => {
    for (const key of colorKeys) {
      const mode = key.endsWith('Dark') ? 'dark' : 'light'
      const varName = '--uic-align-guide-' + mode
      const raw = settings.get(key)
      const value = typeof raw === 'string' ? raw.trim() : ''
      if (value) root.style.setProperty(varName, value)
      else root.style.removeProperty(varName)
    }
  }
  sync()
  const off = settings.onChange((key) => {
    if (colorKeys.has(key)) sync()
  })
  return () => {
    off.dispose()
    for (const key of colorKeys) root.style.removeProperty('--uic-align-guide-' + (key.endsWith('Dark') ? 'dark' : 'light'))
  }
}

export function apply(ctx: Context) {
  // 总开关（alignGuideEnabled）关闭 → 连浮层都不装：不吸附、不画线、不订阅拖拽事件。
  // 重开 → 现装（浮层组件重新挂载并重新订阅），无需重载画布。
  // config 已由内核经 Config schema 校验 + 补默认并登记 settings；订阅见 bindAlignGuideToggle。
  // ctx.effect：订阅与浮层全随插件 fiber 自动回收（热卸/重载不留残线）。
  ctx.effect(() => {
    const stopToggle = bindAlignGuideToggle(ctx, () => attach(ctx))
    const stopColor = bindGuideColorVars(ctx)
    return () => {
      stopToggle()
      stopColor()
    }
  })
}

/** 兼容旧装配的 PluginModule 出口（Config 随模块声明，内核装配时校验 + 登记设置面板） */
export const alignGuidePlugin: PluginModule = { name, Config, apply }
