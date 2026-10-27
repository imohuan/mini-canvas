/**
 * 右键菜单视口内定位的回归（用户口径 2026-10-27 截图）。
 *
 * 旧实现按「条数 × 44 + 48」估算主菜单高度，估算偏小就压到屏幕底边；
 * 二级菜单横坐标写死「主菜单左缘 + 252」，右侧没空间时直接弹到屏幕外。
 * 这里把用户症状写成最小几何用例：任何面板的四条边都不得越过「视口 - 8px」。
 */
import { describe, it, expect } from 'vitest'
import { mainMenuPosition, submenuPosition, MENU_VIEWPORT_GAP } from '../menuPlacement'

const viewport = { width: 1024, height: 640 }

function staysInside(
  pos: { left: number; top: number },
  size: { width: number; height: number },
  vp = viewport,
) {
  expect(pos.left).toBeGreaterThanOrEqual(MENU_VIEWPORT_GAP - 0.5)
  expect(pos.top).toBeGreaterThanOrEqual(MENU_VIEWPORT_GAP - 0.5)
  expect(pos.left + size.width).toBeLessThanOrEqual(vp.width - MENU_VIEWPORT_GAP + 0.5)
  expect(pos.top + size.height).toBeLessThanOrEqual(vp.height - MENU_VIEWPORT_GAP + 0.5)
}

describe('mainMenuPosition（主菜单）', () => {
  it('空间足够时贴着鼠标点展开', () => {
    const pos = mainMenuPosition({ x: 200, y: 120 }, { width: 252, height: 388 }, viewport)
    expect(pos).toEqual({ left: 200, top: 120 })
  })

  it('右下角右键：整块收进视口，底部留 8px 间隔（用户截图症状）', () => {
    const size = { width: 252, height: 388 }
    const pos = mainMenuPosition({ x: 1000, y: 620 }, size, viewport)
    expect(pos.left).toBe(viewport.width - MENU_VIEWPORT_GAP - size.width)
    expect(pos.top).toBe(viewport.height - MENU_VIEWPORT_GAP - size.height)
    staysInside(pos, size)
  })

  it('回归：菜单实际比“按条数估算”更高时不再压到底边', () => {
    // 旧算法：4 条 × 44 + 48 = 224 → top = min(560, 600 - 224) = 376，
    // 而实际面板 388 高 → 底边 764，越出 600 的视口。
    const size = { width: 252, height: 388 }
    const vp = { width: 900, height: 600 }
    const oldTop = Math.min(560, vp.height - 224)
    expect(oldTop + size.height).toBeGreaterThan(vp.height)
    const pos = mainMenuPosition({ x: 700, y: 560 }, size, vp)
    staysInside(pos, size, vp)
  })

  it('鼠标点在视口外（负坐标）也落回间隔内', () => {
    const pos = mainMenuPosition({ x: -20, y: -5 }, { width: 252, height: 200 }, viewport)
    expect(pos).toEqual({ left: MENU_VIEWPORT_GAP, top: MENU_VIEWPORT_GAP })
  })
})

describe('submenuPosition（二级菜单）', () => {
  const main = { left: 764, top: 220 }
  const mainSize = { width: 252, height: 388 }
  const subSize = { width: 252, height: 190 }

  it('右侧没空间时翻到主菜单左侧（用户截图症状：直接弹到屏幕外）', () => {
    const pos = submenuPosition(main, mainSize, 280, subSize, viewport)
    expect(pos.left).toBe(main.left - subSize.width - 4)
    staysInside(pos, subSize)
  })

  it('右侧有空间时贴着入口行右侧展开', () => {
    const pos = submenuPosition({ left: 100, top: 100 }, mainSize, 120, subSize, viewport)
    expect(pos.left).toBe(100 + mainSize.width + 4)
    expect(pos.top).toBe(220)
  })

  it('入口行靠近底部时向上收，不越过下边界', () => {
    const pos = submenuPosition({ left: 100, top: 100 }, mainSize, 380, subSize, viewport)
    staysInside(pos, subSize)
    expect(pos.top).toBe(viewport.height - MENU_VIEWPORT_GAP - subSize.height)
  })

  it('窄视口两侧都放不下时，选空间大的一侧并夹进视口', () => {
    const vp = { width: 600, height: 640 }
    const pos = submenuPosition({ left: 340, top: 100 }, mainSize, 40, subSize, vp)
    staysInside(pos, subSize, vp)
  })

  it('超宽二级菜单在极窄视口也优先保住左缘间隔', () => {
    const vp = { width: 400, height: 640 }
    const pos = submenuPosition({ left: 140, top: 100 }, mainSize, 40, subSize, vp)
    expect(pos.left).toBe(MENU_VIEWPORT_GAP)
  })
})
