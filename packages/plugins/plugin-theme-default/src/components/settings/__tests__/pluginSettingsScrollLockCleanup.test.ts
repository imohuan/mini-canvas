/**
 * 设置面板的滚动锁兜底定时器必须在卸载时收掉（2026-10-30 扫描发现）。
 *
 * 设置面板的滚动锁会挂兜底 setTimeout；面板关掉后这个定时器仍会按时回调，
 * 改一个已经没人看的 scrollLocked —— 面板反复开关时留下的是「关掉之后还在跑的回调」。
 * 默认皮与成品皮都必须按同一契约在卸载时释放。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../settings/useSettingsNavigation.ts', import.meta.url), 'utf-8')
const app = readFileSync(
  new URL('../../../../../../ui/src/components/settings/settings/useSettingsNavigation.ts', import.meta.url),
  'utf-8',
)

describe('设置面板滚动锁', () => {
  it('卸载钩子里释放滚动锁（含清兜底定时器）', () => {
    const at = src.indexOf('onBeforeUnmount(() => {')
    expect(at).toBeGreaterThan(0)
    const block = src.slice(at, src.indexOf('\n  })', at))
    expect(block, '卸载没有 releaseScrollLock()').toMatch(/releaseScrollLock\(\)/)
  })

  it('成品皮同样在卸载时释放滚动锁', () => {
    expect(app).toMatch(/onBeforeUnmount\(\(\) => \{[\s\S]*?releaseScrollLock\(\)/)
  })
})
