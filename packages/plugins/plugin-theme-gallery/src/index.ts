/**
 * plugin-theme-gallery —— 组件展厅：把默认主题注册的组件**真的渲染在画布 UI 上**。
 *
 * 为什么做它：默认主题给全画布提供了一整套组件（按钮 / 下拉 / 气泡 / 滑块 / 参数件 / 取色器 /
 * 节点壳 / 连线 / 背景 / 浮动端口）。文档只能贴代码，看的人得自己在脑子里拼出样子。
 * 本插件把这些件**真跑起来**挂在画布上一层可开关的浮层里 —— 组件是活的（能点、能拖、能看流光），
 * 样式与行为就是画布里的那一份，不存在"文档里的样子和实际不一样"。
 *
 * 落点：overlay 槽（渲染层 SlotHost 渲染，属渲染子树内部）。因此：
 *   - 设计系统件（按钮/下拉/…）直接渲染即可，它们本来就不依赖画布上下文；
 *   - 画布件（节点壳 / 连线 / 背景）注意**不能**直接塞进浮层 —— 它们要 VueFlow 的节点上下文，
 *     所以展厅里嵌一块**真画布**（CanvasHost）来展示，那才是它们真正的运行环境。
 *
 * 依赖方向：plugin-theme-gallery → canvas-render（useCanvasRender 拿 ctx）→ canvas-data → kernel。
 */
import { markRaw } from 'vue'
import type { Context, PluginModule } from '@mini-canvas/canvas-base'
import ThemeGalleryOverlay from './ThemeGalleryOverlay.vue'

export const name = 'theme-gallery'
/** 只往 overlay 槽放一个组件，不消费任何服务 */
export const inject = [] as string[]

export function apply(ctx: Context): void {
  // 画布之上的一层：一个可开关的展厅浮层
  ctx.slots.register('overlay', {
    id: 'theme-gallery-overlay',
    order: 60,
    component: markRaw(ThemeGalleryOverlay),
    meta: { title: '组件展厅' },
  })
}

export const themeGalleryPlugin: PluginModule = { name, inject, apply }

