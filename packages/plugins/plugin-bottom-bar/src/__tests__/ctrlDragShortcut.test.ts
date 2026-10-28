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
 */
import { describe, expect, it } from 'vitest'
import { canEnterCtrlDragMode } from '../ctrlDragMode'

const base = {
  key: 'Control',
  repeat: false,
  barShown: true,
  editableTarget: false,
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
})
