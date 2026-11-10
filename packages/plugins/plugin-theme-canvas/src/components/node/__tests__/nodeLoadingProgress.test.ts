/**
 * NodeLoadingState 的进度显示扩展（用户 2026-11-10）。
 *
 * 用户口径：
 * · 进度不一定只有百分比 —— token 数会超过 100，不能钳；
 * · 后缀要能换（默认 %，文本对话传 tokens）；
 * · 允许直接给一整段进度文案；
 * · 还要能看到「正在返回的那一小段文字」。
 */
import { describe, it, expect } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import NodeLoadingState from '../NodeLoadingState.vue'

describe('NodeLoadingState 进度扩展（用户 2026-11-10：token 数、自定义后缀、整段文案）', () => {
  function renderLoading(props: Record<string, unknown>, slots: Record<string, () => unknown> = {}): Promise<string> {
    const app = createSSRApp({
      render: () => h(NodeLoadingState as never, props, slots as never),
    })
    return renderToString(app)
  }

  it('默认后缀是 %（老行为不变）', async () => {
    const html = await renderLoading({ percent: 42 })
    expect(html).toContain('>42<')
    expect(html).toContain('>%<')
  })

  it('value + suffix：token 数超过 100 不被钳住，后缀可换成 tokens', async () => {
    const html = await renderLoading({ value: 20000, suffix: 'tokens' })
    expect(html).toContain('20000')
    expect(html).toContain('tokens')
  })

  it('progressText 优先于 value + suffix', async () => {
    const html = await renderLoading({ value: 30, suffix: '%', progressText: '已接收 1.2k tokens' })
    expect(html).toContain('已接收 1.2k tokens')
    expect(html).not.toContain('>30<')
  })

  it('streamTail：显示正在返回的那一小段（最多 20 字）', async () => {
    const long = '一二三四五六七八九十甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉'
    const html = await renderLoading({ percent: 10, streamTail: long })
    expect(html).toContain('ld-stream-tail')
    expect(html).toContain('申酉')
  })
})
