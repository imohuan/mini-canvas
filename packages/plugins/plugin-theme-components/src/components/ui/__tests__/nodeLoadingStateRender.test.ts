/**
 * NodeLoadingState 的渲染契约（SSR 拿真 HTML 断言）。
 *
 * 锁三件用户看得见的事：
 * 1. 整块形态有流光层（3 个光斑）、大百分比、阶段文案；
 * 2. 不给百分比时显示**旋转的 SVG 图标**（不编假数字，也不放三个点）；
 * 3. 紧凑形态（chip）是一行小胶囊，失败态换文案与配色。
 */
import { describe, it, expect } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import NodeLoadingState from '../NodeLoadingState.vue'

function render(props: Record<string, unknown>): Promise<string> {
  const app = createSSRApp({ render: () => h(NodeLoadingState, props) })
  return renderToString(app)
}

describe('NodeLoadingState', () => {
  it('整块形态：3 个光斑 + 百分比 + 文案', async () => {
    const html = await render({ percent: 42, message: '生成中…' })
    expect(html).toContain('nls-root')
    expect(html).toContain('is-fill')
    expect(html).toContain('ld-blob--1')
    expect(html).toContain('ld-blob--3')
    // 数字与百分号是两个元素，分开断言
    expect(html).toContain('>42<')
    expect(html).toContain('%')
    expect(html).toContain('生成中…')
    // 缺省状态词
    expect(html).toContain('生成中')
  })

  it('★ 不给百分比 → 一个旋转的 SVG 图标（不是三个点，也不编数字）', async () => {
    const html = await render({ message: '排队中' })
    expect(html).toContain('ld-spinner')
    expect(html).toContain('ld-spinner-arc')
    expect(html).not.toContain('···')
    expect(html).not.toContain('ld-pct')
    expect(html).toContain('排队中')
  })

  it('百分比越界 / 非法值 → 夹回合法区间或走不确定态', async () => {
    expect(await render({ percent: 140 })).toContain('>100<')
    expect(await render({ percent: -5 })).toContain('>0<')
    expect(await render({ percent: Number.NaN })).toContain('ld-spinner')
  })

  it('失败态：感叹号 + 原因 + 下一步，没有百分比', async () => {
    const html = await render({ tone: 'error', message: 'ffmpeg 退出码 1', hint: '可再点一次发送重试' })
    expect(html).toContain('is-error')
    expect(html).toContain('ld-fail-mark')
    expect(html).toContain('ffmpeg 退出码 1')
    expect(html).toContain('可再点一次发送重试')
    expect(html).not.toContain('ld-pct')
  })

  it('紧凑形态：一行胶囊，带状态词与文案', async () => {
    const html = await render({ variant: 'chip', label: '裁剪中', message: '正在处理…' })
    expect(html).toContain('is-chip')
    expect(html).toContain('裁剪中')
    expect(html).toContain('正在处理…')
    // chip 不画整块底色层
    expect(html).not.toContain('ld-top')
  })

  it('surface=media 带上视频画面配色开关（不随亮暗主题白闪）', async () => {
    const html = await render({ surface: 'media', message: '加载预览…' })
    expect(html).toContain('is-media')
  })

  it('#action 插槽里的按钮照常渲染（只有它接指针）', async () => {
    const app = createSSRApp({
      render: () =>
        h(NodeLoadingState, { percent: 10, message: '执行中…' }, {
          action: () => h('button', { class: 'probe-cancel' }, '取消'),
        }),
    })
    const html = await renderToString(app)
    expect(html).toContain('probe-cancel')
    expect(html).toContain('取消')
  })
})
