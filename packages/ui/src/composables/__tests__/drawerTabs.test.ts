/**
 * 抽屉插件页签的纯逻辑契约。
 *
 * “插件页”= 左侧抽屉第三个及之后的页签 + 对应正文面板。
 * 这里只算“哪些能出现、点谁、插件没了回哪”，不碰 DOM：
 * - 保留 id（canvas/assets）不能被占用；
 * - 只有按钮没有面板 → 拒绝（避免点了出现空白页）；
 * - 按 order 排序；
 * - 插件卸载导致当前页签消失 → 回 canvas。
 */
import { describe, expect, it } from 'vitest'
import { fallbackDrawerTab, resolveDrawerTabs } from '../drawerTabs'

const A = { name: 'A' }
const B = { name: 'B' }
const P = { name: 'P' }

describe('resolveDrawerTabs', () => {
  it('按 order 排序，只保留带按钮与面板的页签', () => {
    const r = resolveDrawerTabs([
      { id: 'b', order: 20, component: B, meta: { panel: P, title: 'B' } },
      { id: 'a', order: 10, component: A, meta: { panel: P, title: 'A' } },
    ])
    expect(r.tabs.map((t) => t.id)).toEqual(['a', 'b'])
    expect(r.invalid).toEqual([])
  })

  it('保留 id、缺面板、缺按钮都被拒绝并给出原因', () => {
    const r = resolveDrawerTabs(
      [
        { id: 'canvas', order: 0, component: A, meta: { panel: P } },
        { id: 'no-panel', order: 30, component: A, meta: {} },
        { id: 'no-button', order: 40, component: undefined, meta: { panel: P } },
        { id: 'ok', order: 10, component: A, meta: { panel: P } },
      ],
      { reserved: ['canvas', 'assets'] },
    )
    expect(r.tabs.map((t) => t.id)).toEqual(['ok'])
    expect(r.invalid).toEqual([
      { id: 'canvas', reason: 'reserved' },
      { id: 'no-panel', reason: 'missing-panel' },
      { id: 'no-button', reason: 'missing-button' },
    ])
  })
})

describe('fallbackDrawerTab', () => {
  it('当前插件页签还在就保留，不在了回 canvas', () => {
    expect(fallbackDrawerTab('my-tab', ['my-tab'])).toBe('my-tab')
    expect(fallbackDrawerTab('gone', ['my-tab'])).toBe('canvas')
    expect(fallbackDrawerTab('assets', [])).toBe('assets')
  })
})
