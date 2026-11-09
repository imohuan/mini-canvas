/**
 * 底栏不能掐断「点外关闭」（用户 2026-11-09，带截图）。
 *
 * 现象：参数区唯一的下拉铺到外面后，点空白处关不掉、再点它自己不关、
 * 点左边的模型下拉也不关；只有点菜单里的选项才关。
 *
 * 根因：底栏根节点原本写 `@pointerdown.stop`，无条件 `stopPropagation`。
 * reka 的 DismissableLayer 是在 **document** 上听 pointerdown 来判断「点在外部」的
 * （见 `reka-ui/dist/DismissableLayer/utils.js` 的 usePointerDownOutside），
 * 事件被掐在这一层，document 永远收不到 → 三条关闭路径全部失效。
 *
 * 需要保留的只是「别让画布开始拖拽」，所以改成按需 stop：
 * 有浮层开着就放行。这里把这条契约钉在源码上。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const RAW = readFileSync(fileURLToPath(new URL('../NodeBottomBar.vue', import.meta.url)), 'utf8')
/** 注释里会写 `@pointerdown.stop` 解释为什么不能这么写，剥掉再查（本仓库踩过这个坑）。 */
const SFC = RAW.replace(/\/\*[\s\S]*?\*\//g, '')

describe('底栏根节点：浮层开着时不能拦 pointerdown', () => {
  it('模板上不再是无条件 @pointerdown.stop', () => {
    expect(SFC).not.toContain('@pointerdown.stop')
  })

  it('改走 onRootPointerDown', () => {
    expect(SFC).toMatch(/@pointerdown="onRootPointerDown"/)
    expect(RAW).toMatch(/function onRootPointerDown/)
  })

  it('开着的浮层一律放行（查 data-dismissable-layer）', () => {
    const at = RAW.indexOf('function onRootPointerDown')
    expect(at).toBeGreaterThan(-1)
    const body = RAW.slice(at, at + 800)
    expect(body).toContain("[data-dismissable-layer]")
    // 放行 = 提前 return，后面的 stopPropagation 走不到
    expect(body.indexOf('return')).toBeLessThan(body.indexOf('e.stopPropagation()'))
  })
})
