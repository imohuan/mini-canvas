/**
 * 拖拽交互契约（SSR + 源码断言）。
 *
 * 三条用户实测提出的要求，各写一条钉住：
* 1. **拖拽时不出声**：拖动进度不能一边拖一边出声（用户形容的"站停的播放"）；
 * 1. **拖拽时有声音**（第八轮反转了第七轮的要求）：拖动时要能听到声音（像"搓碟"），
 *    松手后**回到暂停**，不自动继续播；
 * 2. **波纹下面另有一条普通进度条**：它控制**整条音频**的进度（波纹只看得见一小段窗口）；
 * 3. **拖到一侧时波纹跟着滚动**：否则拖拽只能控制可视窗口那一小段，到不了全片。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { createSSRApp, h, type Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { RENDER_CONTEXT_KEY, type CanvasRenderContext } from '@mini-canvas/canvas-render'
import { RegistryImpl } from '@mini-canvas/kernel'
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
    ctx: {
      get: (name: string) => services[name],
      on: () => ({ dispose: () => {} }),
      registryOf: () => new RegistryImpl(),
    },
    viewport: { value: { zoom: 1 } },
  } as unknown as CanvasRenderContext
}
function render(id: string, data: Record<string, unknown>): Promise<string> {
  const app = createSSRApp({ render: () => h(AudioContent as Component, { id, data }) })
  app.provide(RENDER_CONTEXT_KEY, renderCtx())
  return renderToString(app)
}
// 波形/拖拽实现随抽组件搬进了 AudioWavePlayer.vue（行为契约原样搬走，测试跟着锁新家）
const SFC = readFileSync(new URL('../AudioWavePlayer.vue', import.meta.url), 'utf8')

describe('波纹下面那条整体进度条', () => {
  it('渲染出来了，且带无障碍语义（role=slider + 数值范围）', async () => {
    const html = await render('a1', { audioUrl: AUDIO, audioWaveform: waveform(), audioDuration: 30 })
    expect(html).toContain('aw-progress')
    expect(html).toContain('role="slider"')
    expect(html).toContain('aria-label="整体播放进度"')
  })

  it('带 nodrag/nopan/nowheel：拖它时不要拖走节点', async () => {
    const html = await render('a1', { audioUrl: AUDIO, audioWaveform: waveform(), audioDuration: 30 })
    const el = html.match(/class="([^"]*aw-progress[^"]*)"/)
    expect(el).toBeTruthy()
    expect(el![1]).toContain('nodrag')
    expect(el![1]).toContain('nopan')
    expect(el![1]).toContain('nowheel')
  })

  it('填充宽度按整条音频的比例，初值 0%', async () => {
    const html = await render('a1', { audioUrl: AUDIO, audioWaveform: waveform(), audioDuration: 30 })
    const fill = html.match(/class="aw-progress-fill[^"]*"[^>]*style="([^"]*)"/)
    expect(fill).toBeTruthy()
    expect(fill![1]).toMatch(/width:\s*0(\.0+)?%/)
  })
})

describe('拖拽手感：指针在动才出声，停手即静音（第十一轮），松手恢复"拖拽前"的状态', () => {
  it('按下时不静音（拖动过程要听得到声音）', () => {
    const downBlock = SFC.slice(SFC.indexOf('function onKnobPointerDown'), SFC.indexOf('function onKnobPointerMove'))
    expect(downBlock).not.toMatch(new RegExp('muted\\s*=\\s*true'))
  })

  it('用"节流定时器"实现：拖的时候一直响，手一停（SCRUB_IDLE_MS）就暂停', () => {
    // 回归（第十一轮）：按下时 play() 一直播，按住不放、指针停住时播放头会自己往前溜；
    // 用户口径：每次移动重置一个 60ms 定时器，到点还没再动就暂停。
    expect(SFC).toMatch(/SCRUB_IDLE_MS\s*=\s*60/)
    expect(SFC).toMatch(/function armScrubIdleTimer\(\)/)
    expect(SFC).toMatch(/clearTimeout\(scrubIdleTimer\)/)
    expect(SFC).toMatch(/scrubIdleTimer\s*=\s*window\.setTimeout\(pauseScrub,\s*SCRUB_IDLE_MS\)/)
    expect(SFC).toMatch(/function pauseScrub\(\)/)
    expect(SFC).toMatch(/scrubPaused\s*=\s*true/)
  })

  it('指针每次移动都重置定时器，且停手被暂停后能重新出声（拖动才播）', () => {
    const moveBlock = SFC.slice(SFC.indexOf('function onKnobPointerMove'), SFC.indexOf('function onKnobPointerUp'))
    expect(moveBlock).toMatch(/noteScrubActivity\(\)/)
    const noteBlock = SFC.slice(SFC.indexOf('function noteScrubActivity'), SFC.indexOf('function pauseScrub'))
    expect(noteBlock).toMatch(/play\(\)/)
    expect(noteBlock).toMatch(/armScrubIdleTimer\(\)/)
  })

  it('松手 / 卸载时清掉停手定时器（不留常驻计时）', () => {
    const upBlock = SFC.slice(SFC.indexOf('function onKnobPointerUp'), SFC.indexOf('function armScrubIdleTimer'))
    expect(upBlock).toMatch(/cancelScrubIdle\(\)/)
    const unmount = SFC.slice(SFC.indexOf('onBeforeUnmount'))
    expect(unmount).toMatch(/cancelScrubIdle\(\)/)
  })

  it('记住按下前的播放/暂停状态', () => {
    expect(SFC).toMatch(/wasPlayingBeforeSeek/)
  })

  it('松手后按"拖拽前的状态"恢复：原本暂停就回到暂停', () => {
    const upBlock = SFC.slice(SFC.indexOf('function onKnobPointerUp'), SFC.indexOf('function runEdgeScroll'))
    expect(upBlock).toMatch(/wasPlayingBeforeSeek/)
    expect(upBlock).toMatch(/pause\(\)/)
  })
})

describe('播放头线的外观（平时无形，hover 出高亮且**线宽不能变细**）', () => {
  const base = SFC.match(/\.aw-knob::after\s*\{[^}]*\}/)?.[0] ?? ''
  const hover = SFC.match(/\.aw-knob:hover::after[^{]*\{[^}]*\}/)?.[0] ?? ''

  it('平时：不画边框、不用阴影，就是一条半透明的线', () => {
    expect(base).not.toMatch(/border\s*:/)
    expect(base).not.toMatch(/box-shadow\s*:/)
  })

  it('hover 高亮画在盒子外面（outline），不能用 border 吃掉线宽', () => {
    // 回归：曾用 border + border-box，1px 边框从 3px 线宽里扣 → 悬停时线反而细成 1px
    expect(hover).toMatch(/outline(-color)?\s*:/)
    expect(hover).not.toMatch(/border\s*:/)
    expect(hover).not.toMatch(/box-shadow\s*:/)
  })

  it('hover 不改宽度（width / border-width 都不许出现）', () => {
    expect(hover).not.toMatch(/width\s*:/)
    expect(hover).not.toMatch(/border-width\s*:/)
  })
})

describe('拖到一侧时波纹跟着滚动', () => {
  it('有边缘滚动的实现（常量与推进函数）', () => {
    expect(SFC).toMatch(/EDGE_ZONE|EDGE_ZONE_PX/)
    expect(SFC).toMatch(/edgeScroll|runEdgeScroll/)
  })

  it('靠 rAF 逐帧推进，并在松手/卸载时取消（不留常驻循环）', () => {
    expect(SFC).toMatch(/requestAnimationFrame\(/)
    expect(SFC).toMatch(/cancelAnimationFrame\(/)
  })

  it('拖动中也要能补算新进入可视区的峰值（否则滚过去是空白）', () => {
    expect(SFC).not.toMatch(/if \(!src \|\| seeking\) return/)
  })
})



