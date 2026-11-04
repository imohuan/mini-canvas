/**
 * 滚动容器契约（用户口径 2026-11-04：取消统一滚动组件，改原生滚动 + 主题统一滚动条）。
 *
 * 手法：node 环境没有真实样式表与 DOM 滚动，用**源码结构契约**钉住
 * 「生成历史靠哨兵加载，不靠滚动事件」，以及「滚动层查找只在一处认容器」。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const scrollPaneUtil = readFileSync(new URL('../components/scrollPane.ts', import.meta.url), 'utf-8')
const modalsArea = readFileSync(new URL('../components/areas/modals-area/HistoryModal.vue', import.meta.url), 'utf-8')
const historyLoadMore = readFileSync(new URL('../components/areas/modals-area/useHistoryLoadMore.ts', import.meta.url), 'utf-8')

describe('滚动容器只在一处认', () => {
  it('滚动层查找只在一处认 shadcn 内部结构', () => {
    expect(scrollPaneUtil, 'SCROLL_VIEWPORT_SELECTOR 丢了').toMatch(/SCROLL_VIEWPORT_SELECTOR/)
    expect(scrollPaneUtil, '查找函数丢了').toMatch(/export function scrollViewportOf/)
  })

  it('查找器认得原生滚动容器与组件库 ScrollArea 的 viewport', () => {
    expect(scrollPaneUtil, '要认 ui-scroll 标记的滚动层').toMatch(/ui-scroll/)
    expect(scrollPaneUtil, '要兼容组件库 ScrollArea 的 viewport').toMatch(/data-slot="scroll-area-viewport"/)
  })
})

describe('生成历史的「加载更多」改走哨兵元素（用户口径 2026-10-15：禁止滚动触发）', () => {
  it('不再用 @scroll 触发加载（历史滚动容器上没有滚动监听）', () => {
    expect(modalsArea, '历史弹窗还在用滚动事件触发加载').not.toMatch(/@scroll=/)
    expect(modalsArea, 'onHistScroll 已按用户口径删除').not.toMatch(/function onHistScroll/)
  })

  it('滚动内容最底部放哨兵元素，进入可视区才拉下一页', () => {
    expect(modalsArea, '找不到哨兵元素').toMatch(/ref="loadSentinelEl"/)
    expect(historyLoadMore, '哨兵没有挂 IntersectionObserver').toMatch(/loadMoreObserver\.observe\(sentinel\)/)
    expect(historyLoadMore, '哨兵观察没有接到 ui.loadMoreHistory()').toMatch(/ui\.loadMoreHistory\(\)/)
  })

  it('两次拉页之间至少隔 1 秒（哨兵常驻可视区也不会连发请求）', () => {
    expect(historyLoadMore, '找不到最小拉页间隔').toMatch(/LOAD_MORE_INTERVAL_MS = 1000/)
    expect(historyLoadMore, '没有按间隔节流').toMatch(/elapsed < LOAD_MORE_INTERVAL_MS/)
  })
})
