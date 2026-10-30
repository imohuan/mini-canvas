/**
 * 底栏的悬停预览定时器必须随组件卸载清掉（2026-10-30 扫描发现）。
 *
 * schedulePreview / schedulePreviewClose 各挂一个 setTimeout：前者在悬停时把预览浮层
 * 立起来，后者延迟 300ms 关。两个定时器都只存在模块级变量里，**onBeforeUnmount 没清** ——
 * 底栏卸载（预览层关闭 / 切画布）后它们仍会按时回调，改一个已经没人看的 ref，
 * 并把预览图/音频的引用多留一拍。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../NodeBottomBar.vue', import.meta.url), 'utf-8')

describe('NodeBottomBar 定时器清理', () => {
  it('卸载时清悬停预览的两个定时器', () => {
    // 取最后一个 onBeforeUnmount（底栏自己的总清理块）
    const at = src.lastIndexOf('onBeforeUnmount(() => {')
    expect(at, '找不到底栏的 onBeforeUnmount').toBeGreaterThan(0)
    const block = src.slice(at, src.indexOf('\n})', at))
    expect(block, '卸载没清 previewTimer').toMatch(/cancelPreviewSchedule\(\)|clearTimeout\(previewTimer\)/)
    expect(block, '卸载没清 previewCloseTimer').toMatch(/cancelPreviewClose\(\)|clearTimeout\(previewCloseTimer\)/)
  })
})
