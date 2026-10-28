/**
 * VideoPlayerBar —— 控件条共用的**结构契约**（用户口径 2026-10-29：以节点底栏为标准）。
 *
 * 读源码断言（与 historyMediaCardLayout 同手法）：两条宿主的差异必须只落在开关上 ——
 *   · 节点形态：有截图插槽、无循环按钮；
 *   · 全屏形态：有循环按钮、无截图。
 * 视觉数值（26px 按钮 / 32px 行高 / 无胶囊底）钉在组件样式里，改样式就得回来改这里。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const bar = readFileSync(path.resolve(HERE, '../VideoPlayerBar.vue'), 'utf8')
const content = readFileSync(path.resolve(HERE, '../VideoContent.vue'), 'utf8')
const preview = readFileSync(path.resolve(HERE, '../VideoPreview.vue'), 'utf8')

describe('VideoPlayerBar 结构契约', () => {
  it('视觉标准 = 节点底栏：26px 圆钮 / 32px 行高 / 无胶囊底（透明条）', () => {
    expect(bar).toMatch(/\.vcb-bar\s*\{[^}]*height:\s*32px/)
    expect(bar).toMatch(/\.vcb-btn\s*\{[^}]*width:\s*26px/)
    expect(bar).toMatch(/\.vcb-btn\s*\{[^}]*border-radius:\s*50%/)
    // 条本身没有底色（旧 .vpv-bar 的胶囊底被否了 —— 用户：以节点的 UI 为标准）
    const barRule = bar.slice(bar.indexOf('.vcb-bar {'), bar.indexOf('}', bar.indexOf('.vcb-bar {')))
    expect(barRule).not.toMatch(/background:\s*(?!transparent)/)
  })

  it('循环按钮由 loop prop 控制显示（不传 = 不出现）', () => {
    expect(bar).toMatch(/v-if="loop !== undefined"/)
  })

  it('截图按钮走插槽（宿主传什么画什么）', () => {
    expect(bar).toMatch(/<slot name="capture"/)
  })

  it('节点形态：传截图插槽、不传 loop', () => {
    const seg = content.slice(content.indexOf('<VideoPlayerBar'), content.indexOf('</VideoPlayerBar>'))
    expect(seg).not.toMatch(/:loop=/)
    expect(seg).toMatch(/<template #capture>/)
  })

  it('全屏形态：传 loop、不传截图', () => {
    const seg = preview.slice(preview.indexOf('<VideoPlayerBar'), preview.indexOf('/>', preview.indexOf('<VideoPlayerBar')))
    expect(seg).toMatch(/:loop="loop"/)
    expect(seg).not.toMatch(/show-capture/)
  })

  it('两条宿主都不再各自画控制条（旧 .vpv-bar / 节点内联按钮已删）', () => {
    expect(preview).not.toMatch(/class="vpv-bar"/)
    expect(content).not.toMatch(/<button class="vc-btn"[^>]*aria-label="播放"/)
  })
})
