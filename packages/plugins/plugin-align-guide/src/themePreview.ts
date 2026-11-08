/**
 * 对齐插件的「主题工作台预览层」—— 同步绘制函数。
 *
 * 参考线本来就是一个 1px 的横条：这里按预览节点的顶边画一条，
 * 颜色取本插件申报的 alignGuideColor（清空时跟随强调色）。
 */
import type { Context } from '@mini-canvas/canvas-base'
import { THEME_PREVIEW_SLOT, type PreviewLayer, type PreviewPaintCtx } from '@mini-canvas/canvas-render'

export const alignGuidePreviewLayer: PreviewLayer = {
  paint(ctx: PreviewPaintCtx): void {
    const [a, b] = ctx.nodes
    if (!a || !b) return

    const guide = ctx.colors('alignGuideColor') || ctx.colors('accentColor')
    // 参考线画在两张卡片上沿之间（卡片上方的空档），不会横穿节点内容。
    const line = document.createElement('span')
    line.className = 'pv-align-guide'
    line.style.cssText =
      'position:absolute;height:1px;left:' + (a.x - 12) + 'px;top:' + (a.y - 10) + 'px;' +
      'width:' + (b.x + b.w - a.x + 24) + 'px;' +
      'background:color-mix(in srgb,' + guide + ' 75%,transparent)'
    ctx.el.appendChild(line)

    const tag = document.createElement('span')
    tag.className = 'pv-align-tag'
    tag.textContent = '顶边对齐'
    // 标签放在参考线右端、线与上沿之间的空档里，避开两个节点的标题
    tag.style.cssText =
      'position:absolute;left:' + (b.x + b.w - 68) + 'px;top:' + (a.y - 26) + 'px;' +
      'padding:1px 5px;border-radius:4px;white-space:nowrap;' +
      'background:color-mix(in srgb,' + guide + ' 12%,transparent);' +
      'color:color-mix(in srgb,' + guide + ' 75%,transparent);font-size:9px;font-weight:700'
    ctx.el.appendChild(tag)

    // 参考线横跨两卡、标签在线上方：整条带都要算进取景
    ctx.claim?.({
      x: a.x - 16,
      y: a.y - 34,
      w: b.x + b.w - a.x + 32,
      h: 40,
    })
  },
}

export function registerThemePreview(ctx: Context): void {
  ctx.slots.register(THEME_PREVIEW_SLOT, {
    id: 'align-guide/preview',
    order: 140,
    component: alignGuidePreviewLayer,
    meta: { title: '对齐参考线' },
  })
}
