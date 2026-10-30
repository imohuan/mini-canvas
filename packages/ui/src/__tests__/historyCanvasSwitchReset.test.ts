/**
 * 切画布时历史必须回到第 1 页（2026-10-30 扫描发现）。
 *
 * 症状推演：ui 状态是模块级单例，切画布只重建路由组件、不清状态。
 * 用户在 A 画布翻到第 3 页历史，切到 B 画布：
 *   · 画布 id 不在筛选 watch 的源里 → 没人重新拉数据；
 *   · onReady 的 loadHistory() 用旧页码 3 发起，落表前被「pageNo 必须 = 当前页 + 1」
 *     的分页校验丢掉 → 历史墙一直显示 A 画布的卡片。
 * 修法是在 onReady 里识别「画布变了」并把页码/签名复位（onReady 的 loadHistory 自然拉第 1 页）。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const ui = readFileSync(new URL('../composables/ui.ts', import.meta.url), 'utf-8')

describe('切画布后历史页码复位', () => {
  it('onReady 里有「画布变了就复位历史」的调用，且在 loadHistory 之前', () => {
    const onReady = ui.slice(ui.indexOf('async function onReady()'), ui.indexOf('function bindAssetsChanged'))
    expect(onReady, 'onReady 没有对齐历史到当前画布').toMatch(/alignHistoryToCanvas\(\)/)
    expect(onReady.indexOf('alignHistoryToCanvas()'), '复位在拉数据之后等于没做')
      .toBeLessThan(onReady.indexOf('void loadHistory()'))
  })

  it('复位包含：作废在途请求 + 页码回 1 + 清掉旧签名', () => {
    const fn = ui.slice(ui.indexOf('function alignHistoryToCanvas'), ui.indexOf('function bindHistoryFilters'))
    expect(fn, '找不到 alignHistoryToCanvas').not.toBe('')
    expect(fn, '没有作废在途请求').toMatch(/resetHistoryRequest\(\)/)
    expect(fn, '页码没有回到第 1 页').toMatch(/state\.histPage = 1/)
    expect(fn, '旧签名没清（会让第 1 页走成「只插新卡」，旧卡片留在墙上）').toMatch(/state\.histSignature = ''/)
  })
})
