/**
 * 参数面板：「面板内点空白只收起内层下拉」的契约（用户 2026-11-18 第三步）。
 *
 * 现场：打开参数面板 → 打开里面的「规划强度」下拉 → 点面板内空白处，
 * 内层下拉收起时焦点掉到画布节点上，外层 panel 收到 focus-outside，
 * 事件目标是画布节点 —— 只看「目标在不在面板里」必然判成外部，整块面板跟着消失。
 *
 * 修法：判据改成「这次按下的起点在不在面板里」。这里钉住三件事：
 *   1. 记录起点用的是 pointerdown（捕获阶段挂在 document 上）；
 *   2. 起点在面板外时要立刻作废记录，否则紧随其后点画布会被 300ms 窗口误拦；
 *   3. focus-outside 也走同一条判据（Reka 把它和 pointer 分成两个事件）。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const src = readFileSync(
  new URL('../ToolParamGroup.vue', import.meta.url),
  'utf-8',
)

describe('参数面板：点内部空白不关外层', () => {
  it('记录按下起点，并在起点位于面板外时作废', () => {
    const fn = src.slice(src.indexOf('function onPanelPointerDown'), src.indexOf('const pressedInsidePanel'))
    expect(fn, '没有记录起点').toMatch(/lastPanelPointerAt = isInsidePanel/)
    expect(fn, '起点在面板外时没有作废（点画布会关不掉面板）').toMatch(/: 0/)
  })

  it('pointerdown 监听挂在 document 捕获阶段', () => {
    expect(src, '监听没挂 document').toMatch(/document\.addEventListener\('pointerdown', onPanelPointerDown, true\)/)
  })

  it('三个「点到外面」事件共用同一条判据', () => {
    const fn = src.slice(src.indexOf('function onOutside'), src.indexOf('</script>'))
    expect(fn, '没有用「起点在面板里」判').toMatch(/pressedInsidePanel\(\)/)
    expect(fn, '没有保住「目标在面板里」这一支').toMatch(/isInsidePanel\(e\.target\)/)
  })

  it('三个事件都接到了 PopoverContent 上', () => {
    for (const ev of ['interact-outside', 'pointer-down-outside', 'focus-outside']) {
      expect(src, '缺少 @' + ev).toContain('@' + ev + '="onOutside"')
    }
  })
})
