/**
 * 浮层「外部打开」契约。
 *
 * 2026-11-05 用户实测：资产 / 画布树的**行右键**没有反应。
 * 根因不在业务侧 —— RowMenuShell 把 open 设成 true 之后，
 * 组件库的 usePopupOpenState 只在初始化时读过一次 props.open，
 * 内部 state 一直是 false，面板因此永远不渲染（触发器 aria-expanded 却已经是 true）。
 *
 * 这里钉住两件事：
 *   1. 外部传入的 open 变化必须同步进内部；
 *   2. 右键锚点必须用真实触发器（虚拟 reference 在 floating-ui 取矩形的链路上不生效）。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const popupSrc = readFileSync(
  new URL('../theme/popup/exclusive.ts', import.meta.url),
  'utf-8',
)
const shellSrc = readFileSync(
  new URL('../../../ui/src/components/RowMenuShell.vue', import.meta.url),
  'utf-8',
)

describe('浮层受控开合：外部 open 要真的打开面板', () => {
  it('usePopupOpenState 监听 props.open 并写回内部 state', () => {
    const fn = popupSrc.slice(popupSrc.indexOf('export function usePopupOpenState'))
    expect(fn, '没有监听 props.open，右键菜单会“开着却不显示”').toMatch(/watch\(\s*\(\) => props\.open/)
    expect(fn, '监听里没有同步 local').toMatch(/local\.value = value/)
  })
})

describe('行菜单右键锚点', () => {
  it('用真实触发器定位，不再传虚拟 reference', () => {
    expect(shellSrc, '右键又用回虚拟 reference 了（会弹到左上角）').not.toMatch(/:reference=/)
    expect(shellSrc, '触发器没有挪到鼠标点').toMatch(/left: point\.x \+ 'px'/)
  })
})
