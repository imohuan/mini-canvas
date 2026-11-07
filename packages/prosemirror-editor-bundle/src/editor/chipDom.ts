/**
 * 这次点击是否落在标签**左侧图标格**（用户 2026-10-29 定案：标签分左右两半）。
 *
 * 图标格 = 缩略图（.resource-chip-thumb，绝对定位在图标位上）或类型图标本身。
 * 按真实 DOM 矩形判断，不猜 padding/宽度 —— 换主题改尺寸也不用同步常量。
 * 缩略图是 pointer-events:none，事件目标一定是外层 chip，所以只能按坐标判。
 */
import { itemRegistry } from './chipRegistry'

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

/**
 * 当前正在编辑的标签 id（用户 2026-11-06）。
 *
 * 菜单开着期间，标签左侧必须**固定显示铅笔**，不能被缩略图盖回去。
 * 为什么要记在模块里：标签 DOM 会被 ProseMirror 整颗重建（换内容 / 刷新），
 * 只在上层加一次类，重建后就丢了。渲染完由 applyChipEditingState 统一补回来。
 */
let editingChipId = ''

/**
 * 给一颗标签补两件事（标签 DOM 每次重建后调用）：
 *
 * 1. 「正在编辑」类（菜单开着时需要一直显示铅笔）；
 * 2. 「可编辑」类 —— 只要注册表里这颗标签带了 onIconClick / onReplaceClick，
 *    就一定要有 `resource-chip--editable`。
 *
 * 为什么第 2 条要在这里兜底（用户 2026-11-07 实测）：toDOM 里虽然会补这个类，
 * 但标签频繁重建（缩略图刷新 / 换绑）时会走到别的分支，真机上出现过
 * 「点了能开菜单、hover 却不换铅笔」—— 那个类的缺失就是直接原因。
 * 这里在每次绑定事件时按注册表重新对齐一次，两条渲染路径的结果就一致了。
 */
export function applyChipEditingState(el: HTMLElement): void {
  const id = el.getAttribute('data-id') ?? ''
  const on = !!editingChipId && id === editingChipId
  el.classList.toggle('resource-chip--editing', on)

  if (!id) return
  const item = itemRegistry.get(id)
  const interactive = Boolean(item?.onIconClick || item?.onReplaceClick)
  if (interactive && !item?.invalid) el.classList.add('resource-chip--editable')
  else if (!interactive) el.classList.remove('resource-chip--editable')
}

/** 标记 / 取消「这颗标签正在编辑」（菜单开 = true，关 = false） */
export function setChipEditing(id: string, editing: boolean): void {
  if (editing) editingChipId = id
  else if (editingChipId === id) editingChipId = ''
  if (typeof document === 'undefined') return
  document.querySelectorAll<HTMLElement>('.resource-chip').forEach(applyChipEditingState)
}

