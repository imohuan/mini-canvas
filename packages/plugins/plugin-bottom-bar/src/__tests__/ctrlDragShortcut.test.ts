/**
 * Ctrl 进入选择态的**快捷键门槛**（纯逻辑，Node 可测）。
 *
 * 用户口径（2026-10-27）：「只有打开底部状态栏的时候，按 Ctrl 才进入选择状态」；
 * 选中可视化节点（type = 'ui'，没有任何底栏动作）时**不能**触发。
 *
 * 2026-10-28 更新：参考模式进行中也**可以**按 Ctrl 临时切到拖拽模式，
 * 松开后自动回参考（两套会话已经合并成一套）。
 *
 * 真机复现：可视化节点被选中时，画布 overlay 槽里仍会挂 `.nb-overlay` 外壳
 * （NodeBottomBarOverlay 只判单选），但里面的 NodeBottomBar 因为 `hasActions=false`
 * 不渲染 `.nb-root` 本体。旧判定只看 `.nb-overlay` → 误把「外壳在」当成「底栏开着」。
 *
 * 所以门槛必须喂**底栏本体是否真的渲染**（visible && hasActions && !submitted），
 * 不能喂外壳是否存在。
 *
 * 2026-11-11 更新：底栏开着还不够，**鼠标必须停在某张素材卡上**才进入，
 * 在画布空白处或底栏其它位置按 Ctrl 不触发。
 */
import { describe, expect, it } from 'vitest'
import { canEnterCtrlDragMode, ctrlBlockedByEditable, pointerOnBottomBarCard } from '../ctrlDragMode'

const base = {
  key: 'Control',
  repeat: false,
  barShown: true,
  editableTarget: false,
  hoveringCard: true,
}

describe('Ctrl 进入选择态：只在底栏真的显示时', () => {
  it('图片节点有底栏 → 按 Ctrl 进入', () => {
    expect(canEnterCtrlDragMode(base)).toBe(true)
  })

  it('可视化节点：只有 .nb-overlay 外壳、没有底栏本体 → 不进入（本次回归）', () => {
    expect(canEnterCtrlDragMode({ ...base, barShown: false })).toBe(false)
  })

  it('按住不放的重复 keydown 不重复进入（既有语义）', () => {
    expect(canEnterCtrlDragMode({ ...base, repeat: true })).toBe(false)
  })

  it('焦点在输入框 / 可编辑区 → 不进入（既有语义）', () => {
    expect(canEnterCtrlDragMode({ ...base, editableTarget: true })).toBe(false)
  })

  it('不是 Ctrl 键 → 不进入', () => {
    expect(canEnterCtrlDragMode({ ...base, key: 'Shift' })).toBe(false)
  })

  it('鼠标不在任何素材卡上 → 不进入（用户 2026-11-11）', () => {
    expect(canEnterCtrlDragMode({ ...base, hoveringCard: false })).toBe(false)
  })
})

describe('Ctrl 的可编辑区保护：底栏自己的输入框要放行（用户 2026-10-28 真机）', () => {
  it('页面别处的输入框 → 拦下（文本快捷键归输入框）', () => {
    expect(ctrlBlockedByEditable({ inEditable: true, inBottomBar: false })).toBe(true)
  })

  it('底栏里的正文编辑器 → 不拦（点节点后自动聚焦，否则按 Ctrl 永远没反应）', () => {
    expect(ctrlBlockedByEditable({ inEditable: true, inBottomBar: true })).toBe(false)
  })

  it('焦点在画布 / 普通元素 → 不拦', () => {
    expect(ctrlBlockedByEditable({ inEditable: false, inBottomBar: false })).toBe(false)
  })
})

describe('鼠标是否停在素材卡上（用户 2026-11-11）', () => {
  /** 用一个假的底栏根节点：只关心 querySelector 的返回值 */
  const fakeBar = (hovered: boolean) =>
    ({ querySelector: (sel: string) => (hovered && sel === '.nb-card:hover' ? {} : null) }) as unknown as HTMLElement

  it('卡片被鼠标盖住 → true', () => {
    expect(pointerOnBottomBarCard(fakeBar(true))).toBe(true)
  })

  it('鼠标在别处（画布 / 输入框 / 底栏其它位置）→ false', () => {
    expect(pointerOnBottomBarCard(fakeBar(false))).toBe(false)
  })

  it('底栏还没挂上 / 已卸载 → false（不抛错）', () => {
    expect(pointerOnBottomBarCard(null)).toBe(false)
    expect(pointerOnBottomBarCard(undefined)).toBe(false)
  })
})
