/**
 * CanvasSurface 的「平移快速模式」定时器必须随卸载清掉（2026-10-30 扫描发现）。
 *
 * 平移画布时给节点层加一层合成提示（backface-visibility），300ms 后由 setTimeout 摘掉。
 * 定时器只存在模块变量里，onBeforeUnmount 没清 —— 切画布后那次回调仍会执行，
 * 去摸已经卸载的 surface 的 DOM。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../CanvasSurface.vue', import.meta.url), 'utf-8')

describe('CanvasSurface 定时器清理', () => {
  it('卸载钩子里清掉 rapidOffTimer', () => {
    const at = src.indexOf('onBeforeUnmount(() => {')
    expect(at).toBeGreaterThan(0)
    const block = src.slice(at, src.indexOf('\n})', at))
    expect(block, '卸载没清 rapidOffTimer（会去摸已卸载的 DOM）').toMatch(/clearTimeout\(rapidOffTimer\)/)
  })
})
