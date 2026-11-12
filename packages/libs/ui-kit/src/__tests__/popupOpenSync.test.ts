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
  /**
   * 2026-11-05 第二次实测（用户截图：菜单出现在鼠标右边 279px 处）。
   *
   * 上一版把行尾触发器挪成 fixed 当锚点，但它的祖先带 transform（-translate-y-1/2），
   * transform 祖先会成为 fixed 后代的包含块 → left/top 变成相对那一小格，落点整体偏。
   * 现在锚点 Teleport 到 body（没有 transform 祖先），再用真实元素做 reference。
   */
  it('锚点 Teleport 到 body，并用真实元素做 reference', () => {
    expect(shellSrc, '锚点没有 Teleport 到 body，会被抽屉里的 transform 改掉包含块').toMatch(/<Teleport to="body">[\s\S]{0,400}rms-anchor/)
    expect(shellSrc, 'reference 不是真实锚点元素').toMatch(/:reference="point \? anchorEl/)
    expect(shellSrc, '锚点没有跟着鼠标点定位').toMatch(/left: point\.x \+ 'px'/)
  })

  it('右键不再挪动行内触发器（transform 祖先会让 fixed 偏移）', () => {
    const triggerBlock = shellSrc.slice(shellSrc.indexOf('.rms-trigger.is-at-point'), shellSrc.indexOf('.rms-anchor'))
    expect(triggerBlock, '触发器又被改成 fixed 定位了').not.toMatch(/position:\s*fixed/)
  })
})
