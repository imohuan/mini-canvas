/** 多选插件的「主题工作台预览层」注册。 */
import type { Context } from '@mini-canvas/canvas-base'
import { THEME_PREVIEW_SLOT } from '@mini-canvas/canvas-render'
import ThemePreviewSelection from './ThemePreviewSelection.vue'

export { ThemePreviewSelection }

export function registerThemePreview(ctx: Context): void {
  ctx.slots.register(THEME_PREVIEW_SLOT, {
    id: 'multi-select/preview-frame',
    order: 120,
    component: ThemePreviewSelection,
    meta: { title: '多选框' },
  })
}
