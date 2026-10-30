/**
 * 吸底滚动的平滑动画定时器必须在卸载时停掉（2026-10-30 扫描发现）。
 *
 * smoothScrollToBottom 用 setInterval(16ms) 驱动插值（rAF 在某些环境被节流）。
 * 定时器只存在局部变量里，onBeforeUnmount 停不到 —— Agent 面板关掉后，
 * 那次 300ms 动画仍会每 16ms 摸一次已经卸载的 DOM。这里锁住「卸载会清掉它」。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../useStickyScroll.ts', import.meta.url), 'utf-8')

describe('useStickyScroll 清理', () => {
  it('定时器存在可被卸载钩子看到的变量里（不是函数内局部常量）', () => {
    expect(src, '平滑动画仍用局部 const timer（卸载时停不到）')
      .not.toMatch(/const timer = window\.setInterval/)
    expect(src).toMatch(/animTimer = window\.setInterval/)
  })

  it('onBeforeUnmount 里清掉动画定时器', () => {
    const unmount = src.slice(src.indexOf('onBeforeUnmount('), src.length)
    expect(unmount, '卸载钩子没有清动画定时器').toMatch(/clearInterval\(animTimer\)/)
  })
})
