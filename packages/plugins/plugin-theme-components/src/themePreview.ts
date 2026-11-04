/**
 * 默认主题的「主题工作台预览层」注册。
 *
 * 预览层属于通用组件（应用级常驻）：它只画节点壳/连线的基础视觉与状态色，
 * 不需要 doc，也不应该把整个画布外观插件拖进项目页。
 */
import type { Context } from '@mini-canvas/canvas-base'
import { THEME_PREVIEW_SLOT } from '@mini-canvas/canvas-render'
import ThemePreviewBase from './components/preview/ThemePreviewBase.vue'

export { ThemePreviewBase }

export function registerThemePreview(ctx: Context): void {
  ctx.slots.register(THEME_PREVIEW_SLOT, {
    id: 'theme-components/preview',
    order: 100,
    component: ThemePreviewBase,
    meta: { title: '节点与连线' },
  })
}
