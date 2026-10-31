import { describe, expect, it } from 'vitest'
import { clipKeyAction, isTypingTarget } from '../videoClipKeys'

describe('剪辑条键位', () => {
  it('方向键 = 平移选区，普通 0.25s', () => {
    expect(clipKeyAction({ key: 'ArrowLeft', shift: false, ctrl: false, meta: false })).toEqual({ kind: 'move', seconds: -0.25 })
    expect(clipKeyAction({ key: 'ArrowRight', shift: false, ctrl: false, meta: false })).toEqual({ kind: 'move', seconds: 0.25 })
  })

  it('Shift 按住 = 精确 0.1s（配置面板的「精确模式」）', () => {
    expect(clipKeyAction({ key: 'ArrowLeft', shift: true, ctrl: false, meta: false })).toEqual({ kind: 'move', seconds: -0.1 })
  })

  it('Ctrl 按住 = 快速 1s（配置面板的「快速调整」）', () => {
    expect(clipKeyAction({ key: 'ArrowUp', shift: false, ctrl: true, meta: false })).toEqual({ kind: 'resize', seconds: 1 })
    expect(clipKeyAction({ key: 'ArrowDown', shift: false, ctrl: true, meta: false })).toEqual({ kind: 'resize', seconds: -1 })
  })

  it('↑↓ 扩展/收缩选区（上扩、下收；起点不动）', () => {
    expect(clipKeyAction({ key: 'ArrowUp', shift: false, ctrl: false, meta: false })).toEqual({ kind: 'resize', seconds: 0.25 })
    expect(clipKeyAction({ key: 'ArrowDown', shift: false, ctrl: false, meta: false })).toEqual({ kind: 'resize', seconds: -0.25 })
  })

  it('I/O 设出入点、空格播放、Esc 退出、Enter 确认', () => {
    expect(clipKeyAction({ key: 'i', shift: false, ctrl: false, meta: false })).toEqual({ kind: 'set-in' })
    expect(clipKeyAction({ key: 'O', shift: false, ctrl: false, meta: false })).toEqual({ kind: 'set-out' })
    expect(clipKeyAction({ key: ' ', shift: false, ctrl: false, meta: false })).toEqual({ kind: 'toggle-play' })
    // 个别布局的 ev.key 不是空格字符，靠 code 兜底
    expect(clipKeyAction({ key: 'Unidentified', code: 'Space', shift: false, ctrl: false, meta: false })).toEqual({ kind: 'toggle-play' })
    expect(clipKeyAction({ key: 'Escape', shift: false, ctrl: false, meta: false })).toEqual({ kind: 'exit' })
    expect(clipKeyAction({ key: 'Enter', shift: false, ctrl: false, meta: false })).toEqual({ kind: 'confirm' })
  })

  it('不认识的键返回 none；输入框聚焦时不进快捷键', () => {
    expect(clipKeyAction({ key: 'a', shift: false, ctrl: false, meta: false })).toEqual({ kind: 'none' })
    const fakeInput = { tagName: 'INPUT' } as unknown as EventTarget
    expect(isTypingTarget(fakeInput)).toBe(true)
    expect(isTypingTarget(null)).toBe(false)
  })
})
