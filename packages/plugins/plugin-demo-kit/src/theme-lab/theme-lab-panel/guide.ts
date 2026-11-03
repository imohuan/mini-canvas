import type { ThemeLabColorEntry } from '../catalog'
import { buildGuideLine, isSvgPath, isVisibleTarget, pointOnPath, type Box } from '../guide'
import type { ThemeLabState } from './state'

export function useThemeLabGuide(
  state: ThemeLabState,
  deps: { valueOf: (entry: ThemeLabColorEntry) => string },
) {
  const { boardEl, stageEl, entries, chipEls, available, lines, scene, installed, runtime } = state
  const valueOf = deps.valueOf

  function registerChip(id: string, element: Element | null): void {
    if (element instanceof HTMLElement) chipEls.set(id, element)
    else chipEls.delete(id)
  }

  /**
   * Vue 的 ref 回调按渲染顺序执行：列表少一格时，后面的色块会复用同一个回调，
   * 于是 Map 里可能留下“旧 id → 新元素”。这里直接按 DOM 补齐，保证 id 与色块一一对应。
   */
  function syncChipRefs(): void {
    const board = boardEl.value
    if (!board) return
    for (const entry of entries.value) {
      const el = board.querySelector<HTMLElement>('[data-chip-id="' + entry.id + '"]')
      if (el) chipEls.set(entry.id, el)
    }
  }

  function draw(): void {
    const board = boardEl.value
    const stage = stageEl.value
    if (!board || !stage) return
    syncChipRefs()
    // 先清掉上一帧对“多选/对齐/切割”目标的通知：这些目标只在特定场景存在，
    // 场景切换后必须让状态重新算，不能沿用旧值。
    for (const entry of entries.value) available.delete(entry.id)
    const boardRect = board.getBoundingClientRect()
    const stageRect = stage.getBoundingClientRect()
    const next: typeof lines.value = []
    for (const entry of entries.value) {
      const chip = chipEls.get(entry.id)
      if (!chip || !board.contains(chip)) {
        available.set(entry.id, false)
        continue
      }
      const chipRect = chip.getBoundingClientRect()
      const chipBox: Box = {
        x: chipRect.left - boardRect.left,
        y: chipRect.top - boardRect.top,
        w: chipRect.width,
        h: chipRect.height,
      }
      const anchor = pickAnchor(entry)
      if (!anchor) {
        available.set(entry.id, false)
        continue
      }
      const point = resolveAnchorPoint(anchor)
      if (!point) {
        available.set(entry.id, false)
        continue
      }
      const targetBox: Box = {
        x: point.rect.left - boardRect.left,
        y: point.rect.top - boardRect.top,
        w: Math.max(2, point.rect.width),
        h: Math.max(2, point.rect.height),
      }
      const line = buildGuideLine(chipBox, targetBox, { x: point.x - boardRect.left, y: point.y - boardRect.top })
      next.push({
        id: entry.id,
        color: valueOf(entry),
        d: line.d,
        start: line.start,
        end: line.end,
      })
      available.set(entry.id, true)
    }
    lines.value = next
    // 画布矩形只是用于“完全在画布外就不画”的可选过滤；这里保留以便以后加裁剪
    void stageRect
  }

  function scheduleRedraw(): void {
    cancelAnimationFrame(runtime.frame)
    runtime.frame = requestAnimationFrame(draw)
  }

  function pickAnchor(entry: ThemeLabColorEntry): ThemeLabColorEntry['anchors'][number] | null {
    for (const anchor of entry.anchors) {
      if (anchor.scenes && !anchor.scenes.includes(scene.value)) continue
      if (anchor.plugin && !installed.value.has(anchor.plugin)) continue
      const root = anchor.scope === 'document' ? document : stageEl.value
      const element = root?.querySelector(anchor.selector) ?? null
      if (isVisibleTarget(element)) return anchor
    }
    return null
  }

  function resolveAnchorPoint(
    anchor: ThemeLabColorEntry['anchors'][number],
  ): { x: number; y: number; rect: DOMRect } | null {
    const root = anchor.scope === 'document' ? document : stageEl.value
    const element = root?.querySelector(anchor.selector) ?? null
    if (!isVisibleTarget(element)) return null
    const rect = element.getBoundingClientRect()
    if (isSvgPath(element) && anchor.pathAt !== undefined) {
      const point = pointOnPath(element, anchor.pathAt)
      if (!point) return null
      return { ...point, rect }
    }
    const at = anchor.at ?? 'center'
    return {
      x: rect.left + rect.width * (at === 'left' ? 0.16 : at === 'right' ? 0.84 : 0.5),
      y: rect.top + rect.height * (at === 'top' ? 0.14 : at === 'bottom' ? 0.86 : 0.5),
      rect: anchor.thin ? new DOMRect(rect.left - 5, rect.top, 10, Math.max(rect.height, 6)) : rect,
    }
  }

  return { registerChip, syncChipRefs, scheduleRedraw, draw, pickAnchor, resolveAnchorPoint }
}
