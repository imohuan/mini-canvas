/**
 * plugin-hot-reload-demo —— 热重载试验台（开发用）。
 *
 * 目的只有一个：给热重载链路当**靶子**。它往画布右上角挂一块显眼卡片（overlay 槽），
 * 卡片上有版本徽标与文案。验证方法：改 src/index.ts 或 DemoCard.vue 里的显眼内容 →
 * pnpm build（或 build:watch）→ 产物一变，热重载链路应自动重装本插件、卡片变样。
 *
 * 为什么是 overlay 槽 + Vue 组件：与真实插件同构（经 themeRegistry / overlay 槽渲染），
 * 热重载后组件**整棵换新**，视觉差异立即可见 —— 比改一个 service 字段直观得多。
 */
import { markRaw } from 'vue'
import DemoCard from './DemoCard.vue'

export const name = 'hot-reload-demo'
export const inject = [] as string[]

export function apply(ctx: {
  slots: { register(slot: string, req: { id: string; order?: number; component: unknown; meta?: unknown }): string }
}): void {
  // overlay 槽：宿主会把它画在画布上层（与多选框、任务进度覆盖层同一层）。
  // order 拉大排最后，免得跟真插件的功能浮层抢位置 —— 它只是块"靶子"。
  ctx.slots.register('overlay', {
    id: 'hot-reload-demo/card',
    order: 9999,
    component: markRaw(DemoCard),
    meta: { style: 'position:fixed; top:64px; right:16px; z-index:50; pointer-events:none;' },
  })
}

export const hotReloadDemoPlugin = { name, inject, apply }
export default hotReloadDemoPlugin
