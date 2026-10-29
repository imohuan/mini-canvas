/**
 * 聚焦缩放与 auto-layout 的 calculateFocusZoom **行为同源**（用户 2026-10-29：
 * 「双击聚焦参考 F 键那个插件」）。两边各自留一份实现（插件互不依赖），
 * 但公式必须一致 —— 这组用例就是那条契约。
 */
import { describe, expect, it } from 'vitest'
import { calculateFocusZoom as bottomBarZoom } from '../focusZoom'
import { calculateFocusZoom as autoLayoutZoom } from '../../../plugin-auto-layout/src/focusViewport'

const cases = [
  { boundsHeight: 200, viewportHeight: 800, heightRatio: 0.5, minZoom: 0.1, maxZoom: 4 },
  { boundsHeight: 1, viewportHeight: 100, heightRatio: 0.9, minZoom: 0.1, maxZoom: 1 },
  { boundsHeight: 5000, viewportHeight: 100, heightRatio: 0.5, minZoom: 0.1, maxZoom: 4 },
  { boundsHeight: 320, viewportHeight: 950, heightRatio: 0.5, minZoom: 0.1, maxZoom: 4 },
  { boundsHeight: 0, viewportHeight: 0, heightRatio: 0.5, minZoom: 0.2, maxZoom: 2 },
]

describe('底栏聚焦缩放 = auto-layout 的取景公式', () => {
  it.each(cases)('同样输入得到同样缩放 %o', (input) => {
    expect(bottomBarZoom(input)).toBe(autoLayoutZoom(input))
  })

  it('节点占视口一半（占比 0.5）：200 高 / 800 视口 → 2 倍', () => {
    expect(bottomBarZoom({ boundsHeight: 200, viewportHeight: 800, heightRatio: 0.5, minZoom: 0.1, maxZoom: 4 })).toBe(2)
  })

  it('极小内容被 maxZoom 夹住', () => {
    expect(bottomBarZoom({ boundsHeight: 10, viewportHeight: 800, heightRatio: 0.5, minZoom: 0.1, maxZoom: 2 })).toBe(2)
  })
})
