/**
 * 渲染契约（SSR 真 HTML）。与 audioContentRender 分开：这里只盯**画布手势边界** ——
 * 哪些元素该拦、哪些该放行，是用户实测踩过的坑（文字拖不动节点 / 拖节点变成拖进度）。
 */
import { describe, it, expect } from 'vitest'
import { createSSRApp, h, type Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { RENDER_CONTEXT_KEY, type CanvasRenderContext } from '@mini-canvas/canvas-render'
import AudioContent from '../AudioContent.vue'
import { WAVEFORM_BUCKETS } from '../waveform'

const AUDIO = 'blob:mock-audio'
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

describe('画布手势：只有按钮与播放头拦，其它一律放行（用户指定）', () => {
  it('控制条本体不再拦手势（否则时间/文件名拖不动节点）', async () => {
    const html = await render('a1', { audioUrl: AUDIO, audioWaveform: waveform(), audioDuration: 30 })
    const bar = html.match(/class="[^"]*aw-bar[^"]*"/)
    expect(bar).toBeTruthy()
    expect(bar![0]).not.toContain('nodrag')
    expect(bar![0]).not.toContain('nowheel')
  })

  it('播放与刷新两个按钮各自拦手势', async () => {
    const html = await render('a1', { audioUrl: AUDIO, audioWaveform: waveform(), audioDuration: 30 })
    const btns = [...html.matchAll(/class="([^"]*aw-btn[^"]*)"/g)].map((m) => m[1])
    const barBtns = btns.filter((c) => !c.includes('aw-btn-upload'))
    expect(barBtns.length).toBe(2)
    for (const c of barBtns) {
      expect(c).toContain('nodrag')
      expect(c).toContain('nowheel')
    }
  })

  it('播放头是一条竖线，没有圆球（用户不要那颗球）', async () => {
    const html = await render('a1', { audioUrl: AUDIO, audioWaveform: waveform(), audioDuration: 30 })
    const knob = html.match(/class="[^"]*aw-knob[^"]*"/)
    expect(knob).toBeTruthy()
    expect(knob![0]).not.toContain('aw-knob-dot')
  })

 it('播放头不再自作主张当 slider（拖动即可，不再挂键盘语义）', async () => {
   const html = await render('a1', { audioUrl: AUDIO, audioWaveform: waveform(), audioDuration: 30 })
    // 2026-10-01 第八轮起：波纹上的播放头只管拖拽（不挂键盘语义），
    // slider 语义归**波纹下面那条整体进度条**（它才是标准的可拖进度条，见 audioSeekAndProgress）。
    const knob = html.match(/class="[^"]*aw-knob[^"]*"[^>]*/)
    expect(knob).toBeTruthy()
    expect(knob![0]).not.toContain('role="slider"')
    expect(html).toContain('role="slider"')
 })

  it('波形区与时间文字都不拦手势（拖它们等于拖节点）', async () => {
    const html = await render('a1', { audioUrl: AUDIO, audioWaveform: waveform(), audioDuration: 30 })
    const wave = html.match(/class="[^"]*aw-wave[^"]*"/)
    expect(wave).toBeTruthy()
    expect(wave![0]).not.toContain('nodrag')
    expect(html).toContain('aw-time')
  })
})
