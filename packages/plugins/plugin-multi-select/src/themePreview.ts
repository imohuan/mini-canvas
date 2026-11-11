/**
 * 多选插件的「主题工作台预览层」—— 同步绘制函数。
 *
 * 用本插件自己的几何与样式函数（computeSelectionFrameGeometry / frameStrokeCss /
 * resolveMultiSelectFrameConfig）把内外两个框画在预览节点上；插件没装 → 这一层不存在。
 */
import type { Context } from '@plume-canvas/canvas-base'
import { THEME_PREVIEW_SLOT, type PreviewLayer, type PreviewPaintCtx } from '@plume-canvas/canvas-render'
import { computeSelectionFrameGeometry, type MultiSelectRect } from './multiSelectEngine'
import { framePaddingsOf, frameStrokeCss, resolveMultiSelectFrameConfig } from './multiSelectConfig'

function applyStyle(node: HTMLElement, style: Record<string, string>): void {
  for (const [k, v] of Object.entries(style)) {
    if (k.startsWith('--')) node.style.setProperty(k, v)
    else node.style.setProperty(kebab(k), v)
  }
}

/** camelCase → kebab-case（CSS 属性名）。 */
function kebab(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
}

function boxRect(rect: MultiSelectRect): string {
  return 'position:absolute;box-sizing:border-box;' +
    'left:' + rect.x + 'px;top:' + rect.y + 'px;width:' + rect.w + 'px;height:' + rect.h + 'px'
}

export const multiSelectPreviewLayer: PreviewLayer = {
  paint(ctx: PreviewPaintCtx): void {
    const cfg = resolveMultiSelectFrameConfig((key) => ctx.get(key), ctx.mode)
    if (!cfg.enabled) return

    const rects: MultiSelectRect[] = ctx.nodes.map((node) => ({
      id: node.id,
      x: node.x,
      y: node.y,
      w: node.w,
      h: node.h,
    }))
    if (rects.length < 2) return

    const pads = framePaddingsOf(cfg)
    const frame = computeSelectionFrameGeometry(rects, pads.gap, pads.inner)
    if (!frame) return

    const outer = document.createElement('span')
    outer.className = 'pv-selection-outer'
    outer.style.cssText = boxRect(frame.outer)
    applyStyle(outer, frameStrokeCss(cfg.outer, 1, 'var(--ui-select-outer, ' + ctx.colors('accentColor') + ')'))

    const inner = document.createElement('span')
    inner.className = 'pv-selection-inner'
    inner.style.cssText = boxRect(frame.inner)
    applyStyle(inner, frameStrokeCss(cfg.inner, 1, 'var(--ui-select-inner, ' + ctx.colors('accentColor') + ')'))

    ctx.el.appendChild(outer)
    ctx.el.appendChild(inner)

    // 选框比节点略大：如实上报，取景才会包住这两条线
    ctx.claim?.(frame.outer)
  },
}

export function registerThemePreview(ctx: Context): void {
  ctx.slots.register(THEME_PREVIEW_SLOT, {
    id: 'multi-select/preview-frame',
    order: 120,
    component: multiSelectPreviewLayer,
    meta: { title: '多选框' },
  })
}
