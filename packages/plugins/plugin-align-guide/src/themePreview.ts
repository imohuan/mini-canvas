/** 对齐插件的「主题工作台预览层」注册。 */
import type { Context } from '@mini-canvas/canvas-base'
import { THEME_PREVIEW_SLOT } from '@mini-canvas/canvas-render'
import ThemePreviewGuide from './ThemePreviewGuide.vue'

export { ThemePreviewGuide }

export function registerThemePreview(ctx: Context): void {
  ctx.slots.register(THEME_PREVIEW_SLOT, {
    id: 'align-guide/preview',
    order: 140,
    component: ThemePreviewGuide,
    meta: { title: '对齐参考线' },
  })
}
