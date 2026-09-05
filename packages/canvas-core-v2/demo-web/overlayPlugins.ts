/**
 * overlayPlugins —— Goal A"通用 UI 槽同屏按序渲染"的 demo 验证插件。
 *
 * 两个插件各自 ctx.slots.register('overlay', { component, order }) 往画布浮层叠一个角标，
 * order 0 在左上、order 1 在左下，宿主按 order 顺序同屏渲染两处 → 证明"两插件同槽按序同屏渲染"。
 * 组件用 defineComponent+h 轻量内联，避免为演示再堆 SFC 文件。
 */
import { defineComponent, h } from 'vue'
import type { PluginModule, PluginScope } from '@mini-canvas/canvas-core-v2'

/** order 0：左上角一个说明浮标（"开放 UI 槽 A"） */
const CornerA = defineComponent({
  name: 'OverlayCornerA',
  setup() {
    return () =>
      h(
        'div',
        {
          class: 'ov-corner',
          style: { position: 'absolute', top: '64px', left: '12px' },
        },
        '● 开放槽 A (order 0)',
      )
  },
})

/** order 1：左下角另一个浮标（"开放 UI 槽 B"），证明与 A 同屏共存 */
const CornerB = defineComponent({
  name: 'OverlayCornerB',
  setup() {
    return () =>
      h(
        'div',
        {
          class: 'ov-corner',
          style: { position: 'absolute', bottom: '12px', left: '12px' },
        },
        '● 开放槽 B (order 1)',
      )
  },
})

export const overlayCornerAPlugin: PluginModule = {
  name: 'demo-overlay-a',
  apply(ctx: PluginScope) {
    ctx.slots.register('overlay', { id: 'demo-overlay-a', order: 0, component: CornerA })
  },
}

export const overlayCornerBPlugin: PluginModule = {
  name: 'demo-overlay-b',
  apply(ctx: PluginScope) {
    ctx.slots.register('overlay', { id: 'demo-overlay-b', order: 1, component: CornerB })
  },
}
