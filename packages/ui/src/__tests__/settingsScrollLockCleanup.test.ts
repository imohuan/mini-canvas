/**
 * 设置面板的滚动锁必须随组件卸载释放。
 *
 * 现状：lockScrollUntilSettles 往容器上挂了一个 scrollend 监听，并起了一个兜底定时器；
 * onBeforeUnmount 只 cancelScrollAnimation()，两个都没清。
 * 后果虽不致命（DOM 与组件一起被回收，定时器最多多活 620ms），但会留一个悬空定时器 ——
 * 在「关面板后立刻重开」的路径上，旧的 releaseScrollLock 会把新面板的滚动锁提前放掉，
 * 表现为高亮在途经分段之间闪一下（正是这个锁要防的现象）。
 *
 * 这里用源码契约钉住：卸载时必须释放锁（清定时器 + 摘监听）。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const source = readFileSync(
  new URL('../components/settings/AppSettingsPanel.vue', import.meta.url),
  'utf-8',
)

describe('设置面板卸载时释放滚动锁', () => {
  it('onBeforeUnmount 里调了 releaseScrollLock', () => {
    const from = source.indexOf('onBeforeUnmount(')
    expect(from, '找不到 onBeforeUnmount').toBeGreaterThan(-1)
    const block = source.slice(from, source.indexOf('\n})', from) + 3)
    expect(block, '卸载时没有释放滚动锁（定时器会悬空）').toMatch(/releaseScrollLock\(\)/)
  })

  it('releaseScrollLock 会摘掉 scrollend 监听（不只清定时器）', () => {
    const from = source.indexOf('function releaseScrollLock')
    const block = source.slice(from, source.indexOf('\n}', from) + 2)
    expect(block, '释放锁时没摘 scrollend 监听').toMatch(/removeEventListener\(\s*'scrollend'/)
  })
})
