/**
 * 生成历史媒体卡的独立 Vue 应用必须带上画布 ctx。
 *
 * 现场（2026-11-11 真机）：切到「音频」页签，卡片墙整面空白；控制台反复报
 * `[useCanvasContext] 缺少应用上下文`，堆栈是 AudioPreview.setup → useUiComponent。
 *
 * 根因：卡片用 createApp(...).mount() 单独挂载，不继承宿主的 provide。
 * 这组用例锁两件事：
 *   1. 挂载**之前**补 ctx（预览件是在 setup 里取件的，晚了就已抛错）；
 *   2. 单个预览件挂载失败时回落静态卡面，不能带走整面墙。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const card = readFileSync(
  new URL('../components/areas/modals-area/createHistoryCard.ts', import.meta.url),
  'utf-8',
)
const modal = readFileSync(
  new URL('../components/areas/modals-area/HistoryModal.vue', import.meta.url),
  'utf-8',
)

describe('生成历史媒体卡的应用上下文', () => {
  it('挂载前补宿主 ctx（provide 必须在 mount 之前）', () => {
    const mountAt = card.indexOf('app.mount(mount)')
    const provideAt = card.indexOf('provideCardContext?.(app)')
    expect(provideAt, '卡片应用没有补宿主上下文').toBeGreaterThan(0)
    expect(mountAt, '找不到 app.mount(mount)').toBeGreaterThan(0)
    expect(provideAt, '补充上下文发生在 mount 之后，预览件 setup 时已经抛错').toBeLessThan(mountAt)
  })

  it('宿主侧把 ctx 装进卡片应用，并带上同一个注入键', () => {
    expect(modal, 'HistoryModal 没有传 provideCardContext').toMatch(/provideCardContext,?\s*$/m)
    const fn = modal.slice(
      modal.indexOf('function provideCardContext'),
      modal.indexOf('const Button = useUiComponent'),
    )
    expect(fn, '没有取宿主 readyHost.ctx').toMatch(/readyHost\.ctx/)
    expect(fn, '没有 provide 画布上下文键').toMatch(/app\.provide\(CANVAS_CONTEXT_KEY/)
  })

  it('单个预览件挂载失败要回落静态卡面（整面墙不能空）', () => {
    const body = card.slice(card.indexOf('app.mount(mount)'), card.indexOf('// 登记：这张卡的 Vue 应用'))
    expect(body, 'mount 没有兜底').toMatch(/catch/)
    expect(body, '失败后没有回落静态卡面').toMatch(/buildStaticMediaCard\(/)
  })
})
