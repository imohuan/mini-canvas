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

  /**
   * 2026-10-29 真机截图复现的错位：全屏把共用条直接摊在 flex 里，条被排到画面**外面**。
   * 共用条只负责长相，浮动定位必须由宿主包一层（节点是 .video-controls，全屏是 .vpv-bar-wrap）。
   */
  it('★ 全屏必须给共用条包一层定位容器（否则会跑到画面外）', () => {
    // 外层是 v-else 分支里的定位容器（内部还嵌着渐变阴影，所以不要求紧贴 v-else）
    expect(preview).toMatch(/<template v-else>[\s\S]{0,600}<div class="vpv-bar-wrap">/)
    const wrapRule = preview.slice(preview.indexOf('.vpv-bar-wrap {'), preview.indexOf('}', preview.indexOf('.vpv-bar-wrap {')))
    expect(wrapRule).toContain('position: absolute')
    expect(wrapRule).toMatch(/bottom:\s*8px/)
    // 与节点同款的底部渐变衬底（白字压在亮画面上也读得清）
    expect(preview).toContain('class="vpv-scrim"')
  })

  /**
   * 2026-10-29 用户连报两次的同一类错：
   * ① 控件条只占左侧一小块 —— 拆组件后条没有"吃掉剩余宽度"（width:100% 不够，
   *    与条外兄弟按钮抢空间时会被压窄）；全屏那边则是定位容器没铺满。
   * ② 全屏底部阴影没对齐视频底边 —— 阴影被放进了有 14px 内缩的控件条容器里。
   * 这两条都只能靠**结构**钉住，所以写在这里。
   */
  it('★ 控件条自己撑满宽度（进度条才有整条的空间）', () => {
    const rule = bar.slice(bar.indexOf('.vcb-bar {'), bar.indexOf('}', bar.indexOf('.vcb-bar {')))
    expect(rule).toMatch(/flex:\s*1 1 auto/)
    expect(rule).toMatch(/min-width:\s*0/)
  })

  it('★ 节点把「全屏播放」放进条内尾部（不再和条并排抢宽度）', () => {
    const seg = content.slice(content.indexOf('<VideoPlayerBar'), content.indexOf('</VideoPlayerBar>'))
    expect(seg).toMatch(/<template #end>/)
    expect(seg).toMatch(/aria-label="全屏播放"/)
    expect(content).not.toMatch(/<\/VideoPlayerBar>\s*<button class="vc-btn"[^>]*aria-label="全屏播放"/)
  })

  it('★ 全屏底部阴影贴在视频层上（bottom:0、左右铺满），不在控件条容器里', () => {
    // 阴影必须与控件条容器是兄弟，而不是它的子元素
    const wrapOpen = preview.indexOf('<div class="vpv-bar-wrap">')
    const scrimAt = preview.indexOf('class="vpv-scrim"')
    expect(scrimAt).toBeGreaterThan(-1)
    expect(scrimAt).toBeLessThan(wrapOpen)
    const scrimRule = preview.slice(preview.indexOf('.vpv-scrim {'), preview.indexOf('}', preview.indexOf('.vpv-scrim {')))
    expect(scrimRule).toMatch(/left:\s*0/)
    expect(scrimRule).toMatch(/right:\s*0/)
    expect(scrimRule).toMatch(/bottom:\s*0/)
    const wrapRule = preview.slice(preview.indexOf('.vpv-bar-wrap {'), preview.indexOf('}', preview.indexOf('.vpv-bar-wrap {')))
    expect(wrapRule).toMatch(/left:\s*10px/)
    expect(wrapRule).toMatch(/right:\s*10px/)
  })

  /**
   * 2026-10-29 用户截图报的两条样式问题：
   * ① 进度条紧贴「0:10 / 0:10」和「1x」—— 条本身只有 4px gap；
   * ② 看着没居中 —— 轨道靠写死的 top:9.5px 定位，与 22px 行高硬绑。
   */
  it('★ 进度条左右各留 6px（叠加 4px gap = 10px），两端圆点不顶邻居', () => {
    const rule = bar.slice(bar.indexOf('.vcb-progress {'), bar.indexOf('}', bar.indexOf('.vcb-progress {')))
    expect(rule).toMatch(/margin:\s*0 6px/)
  })

  it('★ 进度轨道/填充/圆点都按 50% 居中，不再写死 9.5px', () => {
    for (const sel of ['.vcb-progress::before', '.vcb-progress-fill', '.vcb-progress-thumb']) {
      const at = bar.indexOf(sel + ' {')
      expect(at).toBeGreaterThan(-1)
      const rule = bar.slice(at, bar.indexOf('}', at))
      expect(rule).toMatch(/top:\s*50%/)
      expect(rule).toMatch(/translate:\s*0 -50%/)
      expect(rule).not.toMatch(/top:\s*9\.5px/)
      expect(rule).not.toMatch(/top:\s*5\.5px/)
    }
  })

  /**
   * 音量竖杆拖不动（用户 2026-10-29 报）：抽组件时把「算出音量」的结果丢进了空函数
   * `(v) => void 0`，拖拽只在改内部标志、从没 emit 出去。
   * 这里钉住「拖动必须真的把音量 emit 给宿主」。
   */
  it('★ 音量竖杆拖拽必须 emit volume（不能只算不用）', () => {
    expect(bar).not.toMatch(/\(v\)\s*=>\s*void 0/)
    const fnAt = bar.indexOf('function setVolumeFromPointer')
    expect(fnAt).toBeGreaterThan(-1)
    const fnBody = bar.slice(fnAt, bar.indexOf('\n}', fnAt))
    expect(fnBody).toMatch(/emit\('volume',/)
    // 拖动期间弹层不能被延迟收起：指针按下也要通知宿主保持展开
    expect(bar).toMatch(/@pointerdown\.stop="onVolumeTrackDown"/)
    expect(bar).toMatch(/@pointermove="onVolumeTrackMove"/)
    expect(bar).toMatch(/@pointerup="onVolumeTrackUp"/)
  })
})
