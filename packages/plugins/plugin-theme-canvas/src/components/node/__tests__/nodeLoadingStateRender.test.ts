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
import { RENDER_CONTEXT_KEY, type CanvasRenderContext } from '@plume-canvas/canvas-render'
import NodeLoadingState from '../NodeLoadingState.vue'

/**
 * 带渲染上下文渲染：档位要从 flow.viewport.zoom 与 settings 里读，
 * 不给上下文就是「默认阈值 + zoom=1」= 第 1 档（下面大多数用例就是这种）。
 */
function render(
  props: Record<string, unknown>,
  opts: { zoom?: number; settings?: Record<string, unknown> } = {},
): Promise<string> {
  const app = createSSRApp({ render: () => h(NodeLoadingState, props) })
  if (opts.zoom !== undefined) {
    const settingsMap = opts.settings ?? {}
    const settingsSvc = {
      get: (key: string) => settingsMap[key],
      onChange: () => ({ dispose: () => {} }),
    }
    const renderCtx = {
      ctx: {
        get: (name: string) => (name === 'settings' ? settingsSvc : undefined),
        tryGet: (name: string) => (name === 'settings' ? settingsSvc : undefined),
      },
      flow: { viewport: { value: { zoom: opts.zoom } } },
    } as unknown as CanvasRenderContext
    app.provide(RENDER_CONTEXT_KEY, renderCtx)
  }
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

  /**
   * 用户口径 2026-11-09：「失败状态那个正在移动的球，背景为什么还在？」
   *
   * 流光是「正在处理」的装饰。失败之后任务不跑了，再留着会让人以为还在继续，
   * 所以整层不渲染 —— 不是调暗（调暗了它还在动）。
   */
  it('★ 失败态不画流光层（连光斑元素都不出现）', async () => {
    const html = await render({ tone: 'error', message: 'ffmpeg 退出码 1' })
    expect(html).not.toContain('ld-fluid')
    expect(html).not.toContain('ld-blob')
    // 底色还在（红调试底不能丢）
    expect(html).toContain('ld-base')
    // 加载态照常有流光
    expect(await render({ percent: 10 })).toContain('ld-blob--1')
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

  /**
   * 用户口径 2026-11-08：加载态要分档，不同档位显示不同 UI。
   *
   * 三档的差别都在 DOM 上可验证：第 1 档有状态词与耗时；第 2 档去掉耗时、保留文案；
   * 第 3 档只剩中心数字（或光圈），不写状态词与文案。
   */
  it('★ 第 1 档（放大）：状态词 + 耗时 + 文案 + 取消位都在', async () => {
    const html = await render(
      { percent: 42, message: '生成中…', startedAt: Date.now() - 3000 },
      { zoom: 1 },
    )
    expect(html).toContain('is-tier1')
    expect(html).toContain('ld-top')
    expect(html).toContain('ld-timer')
    expect(html).toContain('生成中')
    expect(html).toContain('生成中…')
  })

  it('★ 第 2 档（缩小）：去掉耗时，保留阶段文案', async () => {
    const html = await render(
      { percent: 42, message: '生成中…', startedAt: Date.now() - 3000 },
      { zoom: 0.5 },
    )
    expect(html).toContain('is-tier2')
    expect(html).not.toContain('ld-top')
    expect(html).not.toContain('ld-timer')
    expect(html).toContain('生成中…')
  })

  /**
   * 用户口径（2026-11-10 截图红框）：数字留在正中，**只是后缀**落到数字的右下角。
   * 之前把整块进度搬到卡片右下角是理解错了，这里锁死正确版式。
   */
  it('★ 数字仍在正中，后缀单独一个元素（.ld-pct）挂在它右下角', async () => {
    const html = await render({ value: 451, suffix: 'tokens', message: '生成中…' }, { zoom: 1 })
    expect(html).toContain('ld-progress')
    expect(html).toContain('ld-num')
    expect(html).toContain('451')
    expect(html).toContain('ld-pct')
    expect(html).toContain('tokens')
    // 整块进度不再被搬到右下角那个容器里
    expect(html).not.toContain('ld-corner')
  })

  it('★ 第 2 档同样保留中心数字 + 右下角后缀', async () => {
    const html = await render({ percent: 42, message: '生成中…' }, { zoom: 0.5 })
    expect(html).toContain('ld-num')
    expect(html).toContain('ld-pct')
    expect(html).toContain('42')
  })

  it('★ progressText 整段照画（优先于数字 + 后缀）', async () => {
    const html = await render({ progressText: '≈1.2k tokens', message: '生成中…' }, { zoom: 1 })
    expect(html).toContain('≈1.2k tokens')
    expect(html).toContain('ld-progress-text')
  })

  it('★ 第 3 档（缩到很小）：只留中心数字，不写状态词与文案', async () => {
    const html = await render({ percent: 42, message: '生成中…' }, { zoom: 0.2 })
    expect(html).toContain('is-tier3')
    expect(html).toContain('>42<')
    expect(html).not.toContain('ld-top')
    expect(html).not.toContain('ld-prompt')
    // 不确定态在第 3 档也要保留那个旋转光圈
    const indet = await render({ message: '排队中' }, { zoom: 0.2 })
    expect(indet).toContain('ld-spinner')
    // 可见文案不画，但 aria-label 仍带着阶段文案给读屏用户
    expect(indet).not.toContain('ld-prompt')
    expect(indet).toContain('aria-label="排队中"')
  })

  it('★ 档位阈值走全局设置（nodeLoadingTier2Zoom / Tier3Zoom）', async () => {
    // 把第二档阈值压到 0.2 以下 → 0.5 倍仍是第 1 档
    const cfg = { nodeLoadingTier2Zoom: 0.15, nodeLoadingTier3Zoom: 0.1 }
    const wide = await render({ percent: 10, message: 'x' }, { zoom: 0.5, settings: cfg })
    expect(wide).toContain('is-tier1')

    // 抬高阈值 → 同样的 0.5 倍进第 2 档
    const cfg2 = { nodeLoadingTier2Zoom: 0.8, nodeLoadingTier3Zoom: 0.45 }
    const narrow = await render({ percent: 10, message: 'x' }, { zoom: 0.55, settings: cfg2 })
    expect(narrow).toContain('is-tier2')
  })
})
