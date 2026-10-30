/**
 * AxTooltip 的延迟显示定时器必须随卸载清掉（2026-10-30 扫描发现）。
 *
 * show() 会挂一个 delay 毫秒的 setTimeout。悬停后在这段时间内组件被销毁
 * （切画布 / 关面板 / 卡片被替换）时，回调仍会把 visible 置真 —— 一个已经不在
 * 页面上的 tooltip 被标记成「显示中」。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../components/AxTooltip.vue', import.meta.url), 'utf-8')

describe('AxTooltip 定时器', () => {
  it('卸载时清掉 delay 定时器', () => {
    expect(src, '没有 onBeforeUnmount').toMatch(/onBeforeUnmount\(/)
    const at = src.indexOf('onBeforeUnmount(')
    const block = src.slice(at, src.indexOf('</script>', at))
    expect(block, '卸载没 clearTimeout(timer)').toMatch(/clearTimeout\(timer\)/)
  })
})
