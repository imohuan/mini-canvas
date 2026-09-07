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
 * 本插件主体极薄：只负责把 overlay 组件注册进槽（scope 自动回收）；逻辑全在组件与引擎。
 */
import type { Context, PluginModule } from '@mini-canvas/canvas-base'
import AlignGuideOverlay from './AlignGuideOverlay.vue'

export const name = 'align-guide'

export function apply(ctx: Context) {
  // 注册参考线浮层到 overlay 槽（宿主已渲染该槽；热卸时随插件 scope 自动移除）
  ctx.slots.register('overlay', {
    id: 'align-guide',
    order: 60,
    component: AlignGuideOverlay,
    meta: { title: '对齐辅助线' },
  })
}

/** 兼容旧装配的 PluginModule 出口 */
export const alignGuidePlugin: PluginModule = { name, apply }
