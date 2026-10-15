import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SFC = readFileSync(path.resolve(HERE, '../MiniMapOverlay.vue'), 'utf8')

/**
 * 小地图 canvas 化（2026-10-15 P5，docs/plan/2026-10-15-canvas-perf-diagnosis.md §9.6）：
 * 旧实现 v-for 渲染每节点一个 div（160 节点 = .mini-map 161 个子元素每帧跟随重绘）。
 * 改 canvas 后 DOM 恒为 1 个 canvas + 1 个 viewer。本包 vitest 跑在 node（无 jsdom），
 * 组件挂不起来（setup 要 useCanvasRender），按 queueUi.test.ts 先例锁源码结构：
 * 改回 v-for div、删掉 canvas、或命中判定退回 class 判断都会在这里红。
 */
describe('MiniMapOverlay canvas 化（结构断言）', () => {
  it('节点方块走 canvas，不再 v-for 渲染每节点 div', () => {
    expect(SFC).toContain('mini-node-canvas')
    expect(SFC).toContain('<canvas')
    expect(SFC).not.toContain('v-for="(rect, i) in contentRects"')
  })

  it('画布重画走 drawNodes（fillRect 批量绘制），且颜色只读 CSS 变量（主题色卫生）', () => {
    expect(SFC).toContain('function drawNodes')
    expect(SFC).toContain('fillRect')
    // 颜色只从 --mm-node 读（亮/暗主题各一套），不写字面量兜底
    expect(SFC).toMatch(/getPropertyValue\('--mm-node'\)/)
  })

  it('点击命中判定改几何（hitNode），不再依赖 .mini-node class（div 已删）', () => {
    expect(SFC).toContain('function hitNode')
    expect(SFC).toContain('!hitNode(e.clientX, e.clientY)')
    expect(SFC).not.toContain("classList.contains('mini-node')")
  })

  it('视口蓝框仍是独立 div（computed 驱动跟随，不进 canvas）', () => {
    expect(SFC).toContain('class="mini-viewer"')
  })
})
