/**
 * AudioContent 的渲染契约（SSR 拿真 HTML 断言）。
 *
 * 用户口径（这是本文件的裁判）：**从头到尾只有一条波形**；进度条做的事只是把播放位置**左边**
 * 染成主题色。曾经写成"两层波形叠放、上层按宽度裁切"，上层容器一变窄，里面的竖条就被压扁、
 * 看起来像"又拉出来一条波纹"（用户实测截图报的 bug）。所以这里钉死：竖条**只有一层**，
 * 每根自己带"已播/未播"状态。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { createSSRApp, h, type Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { RENDER_CONTEXT_KEY, type CanvasRenderContext } from '@mini-canvas/canvas-render'
import AudioContent from '../AudioContent.vue'
import { WAVEFORM_BUCKETS } from '../waveform'

const AUDIO = 'blob:mock-audio'

/** 一条形状有起伏的假波形（大小交替，便于断言真的按高度画了） */
function waveform(): number[] {
  return Array.from({ length: WAVEFORM_BUCKETS }, (_, i) => (i % 2 === 0 ? 90 : 20))
}

function renderCtx(): CanvasRenderContext {
  const services: Record<string, unknown> = {
    doc: { getNode: () => undefined, getNodes: () => [] },
    command: { execute: () => undefined },
    settings: { get: () => undefined, onChange: () => ({ dispose: () => {} }) },
  }
  return {
    ctx: { get: (name: string) => services[name], on: () => ({ dispose: () => {} }) },
    viewport: { value: { zoom: 1 } },
  } as unknown as CanvasRenderContext
}

function render(id: string, data: Record<string, unknown>): Promise<string> {
  const app = createSSRApp({ render: () => h(AudioContent as Component, { id, data }) })
  app.provide(RENDER_CONTEXT_KEY, renderCtx())
  return renderToString(app)
}

function count(html: string, cls: string): number {
  return [...html.matchAll(new RegExp('class="' + cls, 'g'))].length
}

describe('波形：只有一条（单层竖条，每根自带已播状态）', () => {
  it('竖条只有一层：不存在"已播层/底色层"两个容器', async () => {
    const html = await render('a1', { audioUrl: AUDIO, audioWaveform: waveform(), audioDuration: 30 })
    // 这是用户报的「拖进度条又拉出一条波纹」的根源：两层叠加 + 上层变窄被压扁
    expect(html).not.toContain('aw-base-box')
    expect(html).not.toContain('aw-played-box')
    expect(count(html, 'aw-wave-bar')).toBeGreaterThan(0)
  })

  it('每根竖条自己带 is-played 标记（播放头左边的才染色）', async () => {
    const html = await render('a1', { audioUrl: AUDIO, audioWaveform: waveform(), audioDuration: 30 })
    // 进度 0：全都没播 → 没有任何一根带 is-played
    const played = [...html.matchAll(/class="aw-wave-bar[^"]*is-played/g)].length
    expect(played).toBe(0)
  })

  it('竖条宽度是固定像素（走 CSS 变量），不随窗口缩放', async () => {
    const html = await render('a1', { audioUrl: AUDIO, audioWaveform: waveform(), audioDuration: 30 })
    expect(html).toContain('--aw-bar-width:')
  })

  it('高度真的取到了波形值（不是一条平线）', async () => {
    const html = await render('a1', { audioUrl: AUDIO, audioWaveform: waveform(), audioDuration: 30 })
    const heights = [...html.matchAll(/class="aw-wave-bar[^"]*"[^>]*height:\s*([\d.]+)%/g)].map((m) => m[1])
    expect(heights.length).toBeGreaterThan(1)
    expect(new Set(heights).size).toBeGreaterThan(1)
  })

  it('旧的已存波形（100 个整数）仍能画出来 —— 向后兼容', async () => {
    const html = await render('a1', { audioUrl: AUDIO, audioWaveform: waveform(), audioDuration: 30 })
    expect(count(html, 'aw-wave-bar')).toBeGreaterThan(0)
  })

  it('没有波形时给提示而不是空白', async () => {
    const html = await render('a1', { audioUrl: AUDIO })
    expect(count(html, 'aw-wave-bar')).toBe(0)
    expect(html).toContain('aw-hint')
  })
})

describe('播放头与手势边界', () => {
  it('播放头是一条贯穿全高的竖线，且是唯一带 nodrag 的元素之一', async () => {
    const html = await render('a1', { audioUrl: AUDIO, audioWaveform: waveform(), audioDuration: 30 })
    const knob = html.match(/class="[^"]*aw-knob[^"]*"/)
    expect(knob).toBeTruthy()
    expect(knob![0]).toContain('nodrag')
    expect(knob![0]).toContain('nopan')
    expect(knob![0]).toContain('nowheel')
  })

  it('控制条本体不拦手势（否则时间/文件名拖不动节点）', async () => {
    const html = await render('a1', { audioUrl: AUDIO, audioWaveform: waveform(), audioDuration: 30 })
    const bar = html.match(/class="[^"]*aw-bar[^"]*"/)
    expect(bar).toBeTruthy()
    expect(bar![0]).not.toContain('nodrag')
  })

  it('播放与刷新两个按钮各自拦手势', async () => {
    const html = await render('a1', { audioUrl: AUDIO, audioWaveform: waveform(), audioDuration: 30 })
    const btns = [...html.matchAll(/class="([^"]*aw-btn[^"]*)"/g)].map((m) => m[1])
    const barBtns = btns.filter((c) => !c.includes('aw-btn-upload'))
    expect(barBtns.length).toBe(2)
    for (const c of barBtns) expect(c).toContain('nodrag')
  })
})

describe('时长与文案', () => {
  it('显示 已播 / 总时长', async () => {
    const html = await render('a1', { audioUrl: AUDIO, audioWaveform: waveform(), audioDuration: 30 })
    expect(html).toContain('0:00')
    expect(html).toContain('0:30')
  })

  it('hover 只提亮波形本身，不铺灰底（用户指定）', () => {
    // 波形样式随抽组件搬进了 AudioWavePlayer.vue（渲染入口仍是 AudioContent，SSR 用例已覆盖）
    const SFC = readFileSync(new URL('../AudioWavePlayer.vue', import.meta.url), 'utf8')
    const hoverRule = SFC.match(/\.aw-wave:hover\s*\{[^}]*\}/)?.[0] ?? ''
    expect(hoverRule).not.toMatch(/background\s*:/)
    expect(SFC).toMatch(/\.aw-wave:hover\s+\.aw-wave-bar\s*\{/)
  })
})

describe('空态', () => {
  it('没有音频 → 显示「（无音频）」并给上传入口', async () => {
    const html = await render('a1', {})
    expect(html).toContain('（无音频）')
    expect(html).toContain('aria-label="上传音频"')
    expect(html).not.toContain('<audio')
  })
})
