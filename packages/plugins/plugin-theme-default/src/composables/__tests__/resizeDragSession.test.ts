/**
 * resize 拖拽会话 —— 回归测试（线上 bug：拖到一半鼠标移出手柄就断）。
 *
 * 根因：move/up 绑在手柄元素自己身上 + 依赖 setPointerCapture 兜住元素外的事件；
 * 捕获一旦没生效（实测 hasPointerCapture 恒 false），指针离开手柄就收不到 move。
 * 修法：move/up 一律绑到**全局**（document），与指针当前在不在手柄内无关。
 *
 * 本测试盯住"全局"这个关键点：事件从 document 派发（不经手柄元素）也必须继续缩放。
 */
import { describe, expect, it, vi } from 'vitest'
import { createResizeDragSession, type PointerLike } from '../resizeDragSession'

/** 最小全局事件目标：记录监听、可手动派发 */
function makeTarget() {
  const listeners = new Map<string, Array<(e: PointerLike) => void>>()
  return {
    addEventListener(type: string, h: (e: PointerLike) => void) {
      if (!listeners.has(type)) listeners.set(type, [])
      listeners.get(type)!.push(h)
    },
    removeEventListener(type: string, h: (e: PointerLike) => void) {
      const arr = listeners.get(type)
      if (arr) listeners.set(type, arr.filter((x) => x !== h))
    },
    /** 派发一个事件（从"全局"发出，模拟指针已离开手柄元素） */
    emit(type: string, e: Partial<PointerLike> = {}) {
      for (const h of [...(listeners.get(type) ?? [])]) h({ clientX: 0, clientY: 0, ...e })
    },
    /** 当前某类型监听数（验证结束时已摘干净） */
    count(type: string) {
      return (listeners.get(type) ?? []).length
    },
  }
}

function makeSession(
  target: ReturnType<typeof makeTarget> | null,
  live = vi.fn(),
  commit = vi.fn(),
  visual = vi.fn(),
) {
  const session = createResizeDragSession({
    minW: 120,
    minH: 80,
    zoom: () => 1,
    onLive: live,
    onVisualSize: visual,
    onCommit: commit,
    eventTarget: () => target,
  })
  return { session, live, commit, visual }
}

describe('resizeDragSession：move/up 绑全局（而非手柄元素）', () => {
  it('从全局派发 pointermove 能继续缩放（核心回归点）', () => {
    const target = makeTarget()
    const { session, live } = makeSession(target)
    session.start({ clientX: 0, clientY: 0 }, 200, 100)

    // 关键：事件从 target(全局) 发出，而不是手柄元素 —— 旧实现这里不会有任何反应
    target.emit('pointermove', { clientX: 60, clientY: 30 })
    expect(live).toHaveBeenLastCalledWith(260, 130)
    session.dispose()
  })

  it('多次全局 move 持续生效（指针可以任意远离起点）', () => {
    const target = makeTarget()
    const { session, live } = makeSession(target)
    session.start({ clientX: 10, clientY: 10 }, 300, 200)
    target.emit('pointermove', { clientX: 110, clientY: 10 })
    target.emit('pointermove', { clientX: 1000, clientY: 1000 })
    expect(live).toHaveBeenLastCalledWith(1290, 1190)
    session.dispose()
  })

  it('全局 pointerup 提交最终尺寸并摘下全部监听', () => {
    const target = makeTarget()
    const { session, commit } = makeSession(target)
    session.start({ clientX: 0, clientY: 0 }, 200, 100)
    target.emit('pointermove', { clientX: 50, clientY: 20 })
    target.emit('pointerup', { clientX: 50, clientY: 20 })

    expect(commit).toHaveBeenCalledWith(250, 120)
    // 会话结束后监听必须摘干净，避免泄漏到下一个拖拽
    expect(target.count('pointermove')).toBe(0)
    expect(target.count('pointerup')).toBe(0)
    expect(target.count('pointercancel')).toBe(0)
    expect(session.active).toBe(false)
  })

  it('pointercancel（触摸被打断）也结束会话并摘监听', () => {
    const target = makeTarget()
    const { session, commit } = makeSession(target)
    session.start({ clientX: 0, clientY: 0 }, 200, 100)
    target.emit('pointermove', { clientX: 40, clientY: 0 })
    target.emit('pointercancel', {})
    expect(commit).toHaveBeenCalledWith(240, 100)
    expect(target.count('pointermove')).toBe(0)
  })

  it('缩放不为 1 时按 zoom 折算（屏幕位移 ÷ zoom）', () => {
    const target = makeTarget()
    const live = vi.fn()
    const session = createResizeDragSession({
      minW: 120,
      minH: 80,
      zoom: () => 2,
      onLive: live,
      onCommit: vi.fn(),
      eventTarget: () => target,
    })
    session.start({ clientX: 0, clientY: 0 }, 200, 100)
    target.emit('pointermove', { clientX: 100, clientY: 100 })
    expect(live).toHaveBeenLastCalledWith(250, 150) // 100/2 = 50
    session.dispose()
  })

  it('尺寸下限：拖到负方向也不小于 minW/minH', () => {
    const target = makeTarget()
    const { session, live } = makeSession(target)
    session.start({ clientX: 0, clientY: 0 }, 200, 100)
    target.emit('pointermove', { clientX: -500, clientY: -500 })
    expect(live).toHaveBeenLastCalledWith(120, 80)
    session.dispose()
  })

  it('dispose 摘掉监听并终止会话（组件卸载防泄漏）', () => {
    const target = makeTarget()
    const { session, commit } = makeSession(target)
    session.start({ clientX: 0, clientY: 0 }, 200, 100)
    session.dispose()
    expect(target.count('pointermove')).toBe(0)
    // dispose 后不该再有提交
    target.emit('pointerup', {})
    expect(commit).not.toHaveBeenCalled()
  })

  it('无全局目标（SSR/测试）时 start 不抛错、不假装拖拽', () => {
    const { session } = makeSession(null)
    expect(() => session.start({ clientX: 0, clientY: 0 }, 200, 100)).not.toThrow()
  })
})

describe('resizeDragSession：拖拽中同步尺寸给渲染层（端口/边跟上）', () => {
  it('每次全局 move 都触发 onVisualSize，且与 onLive 同值', () => {
    const target = makeTarget()
    const { session, live, visual } = makeSession(target)
    session.start({ clientX: 0, clientY: 0 }, 200, 100)
    target.emit('pointermove', { clientX: 60, clientY: 30 })
    target.emit('pointermove', { clientX: 90, clientY: 45 })

    expect(visual).toHaveBeenCalledTimes(2)
    expect(visual).toHaveBeenLastCalledWith(290, 145)
    // 视觉尺寸与实时尺寸一致（同一帧同一值，避免两边算错）
    expect(visual.mock.calls.at(-1)).toEqual(live.mock.calls.at(-1))
    session.dispose()
  })

  it('未传 onVisualSize 时不影响拖拽（向后兼容）', () => {
    const target = makeTarget()
    const live = vi.fn()
    const session = createResizeDragSession({
      minW: 120,
      minH: 80,
      zoom: () => 1,
      onLive: live,
      onCommit: vi.fn(),
      eventTarget: () => target,
    })
    session.start({ clientX: 0, clientY: 0 }, 200, 100)
    expect(() => target.emit('pointermove', { clientX: 30, clientY: 30 })).not.toThrow()
    expect(live).toHaveBeenLastCalledWith(230, 130)
    session.dispose()
  })

  it('松手提交时不再多叫一次 onVisualSize（提交走 store 重渲染）', () => {
    const target = makeTarget()
    const { session, visual, commit } = makeSession(target)
    session.start({ clientX: 0, clientY: 0 }, 200, 100)
    target.emit('pointermove', { clientX: 50, clientY: 0 })
    const beforeUp = visual.mock.calls.length
    target.emit('pointerup', {})
    expect(visual.mock.calls.length).toBe(beforeUp)
    expect(commit).toHaveBeenCalledWith(250, 100)
    session.dispose()
  })
})
