/**
 * 聚焦缩放的取景公式（用户 2026-10-29：「双击聚焦参考 F 键那个插件」）。
 *
 * 本插件自己留一份实现，不 import auto-layout（插件之间零引用，测试也算）。
 * 公式的期望值在这里直接写死：算错就红，不需要靠和另一份实现对比来间接验证。
 */
import { describe, expect, it } from 'vitest'
import { calculateFocusZoom as bottomBarZoom } from '../focusZoom'

describe('底栏聚焦缩放的取景公式', () => {
  it.each([
    // 视口高 / 内容高 x 占比，再夹到 [minZoom, maxZoom]
    { boundsHeight: 200, viewportHeight: 800, heightRatio: 0.5, minZoom: 0.1, maxZoom: 4, want: 2 },
    { boundsHeight: 1, viewportHeight: 100, heightRatio: 0.9, minZoom: 0.1, maxZoom: 1, want: 1 },
    { boundsHeight: 5000, viewportHeight: 100, heightRatio: 0.5, minZoom: 0.1, maxZoom: 4, want: 0.1 },
    { boundsHeight: 320, viewportHeight: 950, heightRatio: 0.5, minZoom: 0.1, maxZoom: 4, want: 1.484375 },
    // 0 高被兜底成 1（避免除零）：1/1 x 0.5 = 0.5
    { boundsHeight: 0, viewportHeight: 0, heightRatio: 0.5, minZoom: 0.2, maxZoom: 2, want: 0.5 },
  ])('同样输入得到同样缩放 %o', ({ want, ...input }) => {
    expect(bottomBarZoom(input)).toBe(want)
  })

  it('节点占视口一半（占比 0.5）：200 高 / 800 视口 → 2 倍', () => {
    expect(bottomBarZoom({ boundsHeight: 200, viewportHeight: 800, heightRatio: 0.5, minZoom: 0.1, maxZoom: 4 })).toBe(2)
  })

  it('极小内容被 maxZoom 夹住', () => {
    expect(bottomBarZoom({ boundsHeight: 10, viewportHeight: 800, heightRatio: 0.5, minZoom: 0.1, maxZoom: 2 })).toBe(2)
  })
})

