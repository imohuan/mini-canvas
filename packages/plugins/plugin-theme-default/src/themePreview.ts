/** 默认主题的「主题工作台预览层」注册。 */
import type { Context } from '@mini-canvas/canvas-base'
import { THEME_PREVIEW_SLOT } from '@mini-canvas/canvas-render'
import ThemePreviewBase from './components/preview/ThemePreviewBase.vue'

export { ThemePreviewBase }

export function registerThemePreview(ctx: Context): void {
  ctx.slots.register(THEME_PREVIEW_SLOT, {
    id: 'theme-default/preview',
    order: 100,
    component: ThemePreviewBase,
    meta: { title: '节点与连线' },
  })
}
