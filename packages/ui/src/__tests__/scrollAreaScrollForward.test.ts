/**
 * AxScrollArea 的滚动事件必须能被外层接到（用户口径 2026-10-10：「生成历史」的
 * "加载更多"没效果）。
 *
 * 为什么需要这条测试：AxScrollArea 的真正滚动层是**内部的** .ax-sa-view（根元素 .ax-sa 是
 * overflow: hidden），真机实测滚动时 .ax-sa-view 收到 scroll、.ax-sa 收不到。而 Vue 把写在
 * 组件上的 @scroll 当作**组件自定义事件**消费（不再 fallthrough 到根元素），组件没声明 scroll
 * emit 就直接吞掉 —— 于是 ModalsArea 的触底加载页逻辑永远不会被调用。
 *
 * 真机证据（Chrome MCP，2026-10-10）：给 .ax-sa-view 滚动，.ax-sa 收到 0 次 scroll；
 * 手动给 .ax-sa 派发 scroll 事件后卡片从 20 张涨到 34 张（加载逻辑本身是好的，只是没被触发）。
 *
 * 手法与 pageSelectNone / uiDropdownRegistration 同款：node 环境没有真实样式表与 DOM 滚动，
 * 用**源码结构契约**钉住「内部滚动层的 scroll 被转发出去」。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const scrollArea = readFileSync(new URL('../components/AxScrollArea.vue', import.meta.url), 'utf-8')
const modalsArea = readFileSync(new URL('../components/areas/ModalsArea.vue', import.meta.url), 'utf-8')

describe('AxScrollArea 转发内部滚动层的 scroll 事件', () => {
  it('声明 scroll 自定义事件（否则写在组件上的 @scroll 会被吞掉）', () => {
    expect(scrollArea, 'AxScrollArea 没有声明 scroll emit').toMatch(/defineEmits[^)]*['"]scroll['"]/)
  })

  it('内部滚动层 .ax-sa-view 上的 scroll 被 $emit 出去（连同原生事件）', () => {
    // 找 .ax-sa-view 那个 div 标签段，它必须把 scroll 转发出去
    const view = scrollArea.match(/<div class="ax-sa-view"[^>]*>/)?.[0] ?? ''
    expect(view, '找不到 .ax-sa-view 的标签').not.toBe('')
    expect(view, '.ax-sa-view 没有绑定 @scroll 转发').toMatch(/@scroll=/)
    expect(view, '@scroll 必须把原生事件一起 $emit（外层 onHistScroll 要读 e.target 的滚动几何）')
      .toMatch(/\$emit\(\s*['"]scroll['"]\s*,\s*\$event\s*\)/)
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
