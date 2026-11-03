/**
 * 这次点击是否落在标签**左侧图标格**（用户 2026-10-29 定案：标签分左右两半）。
 *
 * 图标格 = 缩略图（.resource-chip-thumb，绝对定位在图标位上）或类型图标本身。
 * 按真实 DOM 矩形判断，不猜 padding/宽度 —— 换主题改尺寸也不用同步常量。
 * 缩略图是 pointer-events:none，事件目标一定是外层 chip，所以只能按坐标判。
 */
export function clickInsideChipIcon(el: HTMLElement, e: MouseEvent | undefined): boolean {
  const b = chipIconRect(el)
  if (!b || !e) return false
  const pad = 2
  return e.clientX >= b.left - pad && e.clientX <= b.right + pad
    && e.clientY >= b.top - pad && e.clientY <= b.bottom + pad
}

/** 标签左侧图标格（缩略图或类型图标）的屏幕矩形；没有图标 → null */
export function chipIconRect(el: HTMLElement): DOMRect | null {
  const icon = (el.querySelector('.resource-chip-thumb') ?? el.querySelector('.resource-chip-icon')) as HTMLElement | null
  if (!icon) return null
  const b = icon.getBoundingClientRect()
  return b.width > 0 && b.height > 0 ? b : null
}

/**
 * 参考标签里的缩略图接上「加载状态」（用户 2026-10-29）。
 *
 * 为什么不在 renderRefChip 里直接接：DOM 每次重建都会重跑 toDOM，
 * 这里统一在挂载后按**真实 DOM** 接一次，图表和实际元素永远对得上。
 * 语义：loading 时图标位转圈；load 成功把图片盖上来；error 保持图标。
 */
export function attachChipThumbState(el: HTMLElement): void {
  const img = el.querySelector('img') as HTMLImageElement | null
  const icon = el.querySelector('.resource-chip-icon') as HTMLElement | null
  if (!img || !icon) return
  const done = () => {
    icon.classList.remove('is-loading')
    icon.classList.add('is-covered')
    img.style.display = ''
  }
  const fail = () => {
    icon.classList.remove('is-loading')
    icon.classList.remove('is-covered')
    img.style.display = 'none'
  }
  if (img.complete) {
    // 已经在缓存里：直接给结论，不要闪一下转圈
    if (img.naturalWidth > 0) done()
    else fail()
    return
  }
  icon.classList.add('is-loading')
  img.style.display = 'none'
  img.addEventListener('load', done)
  img.addEventListener('error', fail)
}

