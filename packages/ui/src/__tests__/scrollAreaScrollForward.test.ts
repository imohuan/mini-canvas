/**
 * ScrollPane 的滚动事件必须能被外层接到（用户口径 2026-10-10：「生成历史」的
 * "加载更多"没效果）。
 *
 * 为什么需要这条测试：ScrollPane 的底座是 shadcn ScrollArea，真正滚动的是**内部的**
 * viewport（根元素 overflow: hidden）。Vue 把写在组件上的 @scroll 当作**自定义事件**消费，
 * 组件没声明 scroll emit 就直接吞掉 —— 外层的滚动位置记忆 / 触底逻辑永远不会被调用。
 *
 * 手法：node 环境没有真实样式表与 DOM 滚动，用**源码结构契约**钉住
 * 「内部滚动层的 scroll 被转发出去」，以及「滚动层查找只在一处认 shadcn 内部结构」。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const scrollPane = readFileSync(new URL('../components/ScrollPane.vue', import.meta.url), 'utf-8')
const scrollPaneUtil = readFileSync(new URL('../components/scrollPane.ts', import.meta.url), 'utf-8')
const modalsArea = readFileSync(new URL('../components/areas/modals-area/HistoryModal.vue', import.meta.url), 'utf-8')

describe('ScrollPane 转发内部滚动层的 scroll 事件', () => {
  it('声明 scroll 自定义事件（否则写在组件上的 @scroll 会被吞掉）', () => {
    expect(scrollPane, 'ScrollPane 没有声明 scroll emit').toMatch(/defineEmits[^)]*['"]scroll['"]/)
  })

  it('内部 viewport 的 scroll 被 emit 出去（连同原生事件）', () => {
    expect(scrollPane, '没有监听 viewport 的 scroll').toMatch(/addEventListener\(\s*['"]scroll['"]/)
    expect(scrollPane, 'scroll 必须把原生事件一起 emit（外层要读 e.target 的滚动几何）')
      .toMatch(/emit\(\s*['"]scroll['"]\s*,\s*e\s*\)/)
  })

  it('滚动层查找只在一处认 shadcn 内部结构', () => {
    expect(scrollPaneUtil, 'SCROLL_VIEWPORT_SELECTOR 丢了').toMatch(/SCROLL_VIEWPORT_SELECTOR/)
    expect(scrollPaneUtil, '查找函数丢了').toMatch(/export function scrollViewportOf/)
  })

  it('根 ref 挂在原生 div 上（组件实例没有 querySelector）', () => {
    // 真实 bug（2026-11-03）：ref 放在 ScrollArea 组件上，open Agent 面板时
    // `rootRef.value?.querySelector` 抛 "querySelector is not a function"。
    expect(scrollPane, 'rootRef 不能挂在组件上').not.toMatch(/<ScrollArea[^>]*ref="rootRef"/)
    expect(scrollPane, '找不到原生 root div').toMatch(/<div ref="rootRef"/)
  })
})

describe('生成历史的「加载更多」改走哨兵元素（用户口径 2026-10-15：禁止滚动触发）', () => {
  it('不再用 @scroll 触发加载（历史滚动容器上没有滚动监听）', () => {
    expect(modalsArea, '历史弹窗还在用滚动事件触发加载').not.toMatch(/@scroll=/)
    expect(modalsArea, 'onHistScroll 已按用户口径删除').not.toMatch(/function onHistScroll/)
  })

  it('滚动内容最底部放哨兵元素，进入可视区才拉下一页', () => {
    expect(modalsArea, '找不到哨兵元素').toMatch(/ref="loadSentinelEl"/)
    expect(modalsArea, '哨兵没有挂 IntersectionObserver').toMatch(/loadMoreObserver\.observe\(sentinel\)/)
    expect(modalsArea, '哨兵观察没有接到 ui.loadMoreHistory()').toMatch(/ui\.loadMoreHistory\(\)/)
  })

  it('两次拉页之间至少隔 1 秒（哨兵常驻可视区也不会连发请求）', () => {
    expect(modalsArea, '找不到最小拉页间隔').toMatch(/LOAD_MORE_INTERVAL_MS = 1000/)
    expect(modalsArea, '没有按间隔节流').toMatch(/elapsed < LOAD_MORE_INTERVAL_MS/)
  })
})
