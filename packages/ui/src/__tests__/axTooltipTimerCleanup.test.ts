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
const kit = readFileSync(new URL('../../../ui-kit/src/components/tooltip/Tooltip.vue', import.meta.url), 'utf-8')
const kitHook = readFileSync(new URL('../../../ui-kit/src/components/dropdown/useDropdown.ts', import.meta.url), 'utf-8')

describe('AxTooltip 定时器', () => {
  /**
   * 悬停延迟现在由 ui-kit 的 Dropdown（Tooltip 的底座）计时，所以清理也必须在那里。
   * 适配层不再自己 setTimeout；它只管把 delay 传下去。
   */
  it('延迟计时与清理都在库的浮层 hook 里（适配层不再自己 setTimeout）', () => {
    expect(src, '适配层不该自己计时').not.toMatch(/setTimeout/)
    expect(kit).toMatch(/hoverOpenDelay/)
    expect(kitHook, '卸载时没取消悬停计时').toMatch(/onBeforeUnmount\(\(\) => \{[\s\S]{0,120}cancelShow\(\)/)
  })
})
