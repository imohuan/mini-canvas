/**
 * 「里层浮层不该关掉外层浮层」的组件库契约（用户 2026-11-18 报的 BUG）。
 *
 * 现场：底栏参数面板里再开一个下拉，第二次点它的触发器时，整个参数面板消失。
 *
 * 两处都容易写错，这里钉住：
 *   1. Reka 的这几个事件是自定义事件名，只有**模板上的监听**一定接得上；
 *      写成 `v-bind` 合并会被模板监听盖掉，或者反过来盖掉业务侧的监听。
 *   2. 组件库这层保护要和业务侧的监听**都跑**（业务侧也要自己的判断）。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const src = readFileSync(
  new URL('../components/ui/popover/PopoverContent.vue', import.meta.url),
  'utf-8',
)

describe('PopoverContent：里层浮层保护', () => {
  it('三个「点到外面」事件都在模板上挂了处理', () => {
    for (const ev of ['interact-outside', 'pointer-down-outside', 'focus-outside']) {
      expect(src, '缺少 @' + ev + '，点里层浮层会把外层关掉').toContain('@' + ev + '="runGuardAnd"')
    }
  })

  it('保护之后还要调用业务侧传进来的监听', () => {
    const from = src.indexOf('function runGuardAnd')
    const fn = src.slice(from, src.indexOf('</script>', from))
    expect(fn, '没有调用业务侧监听，业务自己的拦截会失效').toMatch(/attrs as Record<string, unknown>/)
    expect(fn, '没有 continue 调用，业务侧监听被吞掉了').toMatch(/outer as \(e: Event\) => void/)
  })

  it('判断「点在浮层里」覆盖 select / dropdown / listbox', () => {
    const sel = src.slice(src.indexOf('const LAYER_SELECTOR'), src.indexOf('function guardNestedLayer'))
    for (const slot of ['popover-content', 'select-content', 'dropdown-menu-content']) {
      expect(sel, '选择器漏了 ' + slot).toContain(slot)
    }
    expect(sel).toContain('[role="listbox"]')
  })
})
