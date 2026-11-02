/** 切割插件的「主题工作台预览层」注册。 */
import type { Context } from '@mini-canvas/canvas-base'
import { THEME_PREVIEW_SLOT } from '@mini-canvas/canvas-render'
import ThemePreviewCut from './ThemePreviewCut.vue'

export { ThemePreviewCut }

export function registerThemePreview(ctx: Context): void {
  ctx.slots.register(THEME_PREVIEW_SLOT, {
    id: 'edge-cutting/preview',
    order: 160,
    component: ThemePreviewCut,
    meta: { title: '切割刀光' },
  })
}
