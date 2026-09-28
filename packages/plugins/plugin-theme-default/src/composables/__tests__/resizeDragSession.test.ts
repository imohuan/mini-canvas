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
  toFlow: (x: number, y: number) => { x: number; y: number } = (x, y) => ({ x, y }),
) {
  const session = createResizeDragSession({
    minW: 120,
    minH: 80,
    toFlow,
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

  it('缩放不为 1 时：屏幕点经视口换算成画布坐标（屏幕位移 ÷ zoom）', () => {
    const target = makeTarget()
    const live = vi.fn()
    const session = createResizeDragSession({
      minW: 120,
      minH: 80,
      // 视口换算：zoom=2 → 屏幕位移减半
      toFlow: (x, y) => ({ x: x / 2, y: y / 2 }),
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
      toFlow: (x, y) => ({ x, y }),
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

/**
 * 线上缺陷（用户原话）："reset 节点的时候，如果我同时缩放……我的鼠标和那个控件就会形成一点距离，
 * 因为这个地方没有进行反缩放"。
 *
 * 旧实现：尺寸 = 起始尺寸 + (鼠标屏幕位移 除以 当前 zoom)。
 * 这在缩放全程不变时是对的（屏幕位移 除以 zoom = 画布位移）；但**拖拽途中缩放一变**，
 * 同一段屏幕位移对应的画布位移就变了 —— 于是卡片越拖越偏、和鼠标拉开距离，缩放越大偏得越狠。
 *
 * 正解：每帧都用**当前视口**把起点屏幕点与当前屏幕点各换算一次画布坐标，取两次之差。
 * 平移项在差值里相消，所以缩放不变时与旧公式逐帧同值（不会改坏既有手感），
 * 缩放变化时才给出正确位移。
 */
describe('resizeDragSession：拖拽中改缩放也不脱手（真实滚轮缩放路径）', () => {
  /**
   * 可控视口：画布 = (屏幕 - 平移) 除以 zoom。真实 VueFlow 的滚轮缩放正是这个线性映射。
   * setZoom 绕屏幕锚点改缩放 —— 锚点处的画布点保持不动（这正是滚轮缩放的行为）。
   *
   * 约定：本组把"节点左上角"放在画布原点，于是"卡片右下角画布坐标"就等于 (w, h)，
   * 可以反过来用视口把它还原成屏幕位置来断言。
   */
  function makeViewport() {
    let zoom = 1
    let tx = 0
    let ty = 0
    return {
      toFlow: (x: number, y: number) => ({ x: (x - tx) / zoom, y: (y - ty) / zoom }),
      setZoom(next: number, ax = 0, ay = 0) {
        tx = ax - ((ax - tx) / zoom) * next
        ty = ay - ((ay - ty) / zoom) * next
        zoom = next
      },
      /** 卡片右下角（画布坐标 = (w,h)）此刻落在屏幕上的位置 */
      cornerScreen: (w: number, h: number) => ({ x: zoom * w + tx, y: zoom * h + ty }),
    }
  }

  /** 判据：卡片右下角在**屏幕上**始终落在「指针 + 起手抓点偏移」处（控件贴住鼠标） */
  function expectSticksTo(live: ReturnType<typeof vi.fn>, vp: ReturnType<typeof makeViewport>, mx: number, my: number, grab = { x: 0, y: 0 }) {
    const [w, h] = live.mock.calls.at(-1) as [number, number]
    const cs = vp.cornerScreen(w, h)
    expect(cs.x).toBeCloseTo(mx + grab.x, 6)
    expect(cs.y).toBeCloseTo(my + grab.y, 6)
  }

  it('拖到一半把画布缩小：卡片右下角仍贴住鼠标（旧实现会偏）', () => {
    const target = makeTarget()
    const live = vi.fn()
    const vp = makeViewport()
    const session = createResizeDragSession({
      minW: 120,
      minH: 80,
      toFlow: vp.toFlow,
      onLive: live,
      onCommit: vi.fn(),
      eventTarget: () => target,
    })
    // 起点鼠标 (182,82)，抓点偏移 (18,18) → 卡片角屏幕 (200,100)；起始尺寸 200x100
    session.start({ clientX: 182, clientY: 82 }, 200, 100, { x: 18, y: 18 })
    target.emit('pointermove', { clientX: 182, clientY: 82 })
    expectSticksTo(live, vp, 182, 82, { x: 18, y: 18 })

    // 绕远离拖柄的锚点 (100,100) 缩小到 0.5 —— 这正是"旧实现会偏"的情形
    vp.setZoom(0.5, 100, 100)
    target.emit('pointermove', { clientX: 182, clientY: 82 })
    expectSticksTo(live, vp, 182, 82, { x: 18, y: 18 })
    // 该帧尺寸确实变了（不是"原地不动"混过去）
    expect((live.mock.calls.at(-1) as number[])[0]).toBeCloseTo(300, 6)

    // 再放大到 2：继续贴住
    vp.setZoom(2, 200, 120)
    target.emit('pointermove', { clientX: 190, clientY: 90 })
    expectSticksTo(live, vp, 190, 90, { x: 18, y: 18 })
    session.dispose()
  })

  it('缩放来回变 + 鼠标同时动：每一帧都贴住（不与缩放纠缠）', () => {
    const target = makeTarget()
    const live = vi.fn()
    const vp = makeViewport()
    const session = createResizeDragSession({
      minW: 120,
      minH: 80,
      toFlow: vp.toFlow,
      onLive: live,
      onCommit: vi.fn(),
      eventTarget: () => target,
    })
    // 抓点偏移缺省 0（抓点即角点）；起点取 (startW,startH) → 节点左上角落在画布原点，
    // 于是 cornerScreen(w,h) 的还原才成立（helper 的约定）。
    session.start({ clientX: 600, clientY: 400 }, 600, 400)
    target.emit('pointermove', { clientX: 620, clientY: 410 })
    expectSticksTo(live, vp, 620, 410)

    vp.setZoom(0.5, 100, 100)
    target.emit('pointermove', { clientX: 640, clientY: 420 })
    expectSticksTo(live, vp, 640, 420)

    vp.setZoom(2, 200, 150)
    target.emit('pointermove', { clientX: 660, clientY: 430 })
    expectSticksTo(live, vp, 660, 430)

    vp.setZoom(1, 0, 0)
    target.emit('pointermove', { clientX: 660, clientY: 430 }) // 鼠标不动、只缩放
    expectSticksTo(live, vp, 660, 430)
    session.dispose()
  })

  it('未给抓点偏移时按 (0,0)：起手即"指针就是卡片角"', () => {
    const target = makeTarget()
    const live = vi.fn()
    const vp = makeViewport()
    const session = createResizeDragSession({
      minW: 120,
      minH: 80,
      toFlow: vp.toFlow,
      onLive: live,
      onCommit: vi.fn(),
      eventTarget: () => target,
    })
    session.start({ clientX: 200, clientY: 100 }, 200, 100)
    target.emit('pointermove', { clientX: 240, clientY: 130 }) // 画布 240,130 → 240,130
    expect(live).toHaveBeenLastCalledWith(240, 130)
    vp.setZoom(0.5, 100, 100)
    target.emit('pointermove', { clientX: 240, clientY: 130 })
    expectSticksTo(live, vp, 240, 130)
    session.dispose()
  })

  /**
   * 滚轮缩放时鼠标常常不动（只是滚轮），此时**没有 pointermove**。
   * 若只在 move 时重算，卡片就会停在旧尺寸上、与指针短暂脱手 —— 用户报的"一点距离"。
   * 所以暴露 refresh()：调用方在视口变化时喊一声，用"上一次指针位置 + 当前视口"重算。
   */
  it('缩放变化但鼠标没动：refresh() 立刻重算，卡片角回到指针上（不脱手）', () => {
    const target = makeTarget()
    const live = vi.fn()
    const vp = makeViewport()
    const session = createResizeDragSession({
      minW: 120,
      minH: 80,
      toFlow: vp.toFlow,
      onLive: live,
      onCommit: vi.fn(),
      eventTarget: () => target,
    })
    session.start({ clientX: 182, clientY: 82 }, 200, 100, { x: 18, y: 18 })
    target.emit('pointermove', { clientX: 182, clientY: 82 })
    expectSticksTo(live, vp, 182, 82, { x: 18, y: 18 })

    // 缩放绕远处锚点变化，鼠标不动（也没有 pointermove）
    vp.setZoom(0.5, 100, 100)
    // 不 refresh 就会脱手 —— 这是修复前的行为
    const stale = live.mock.calls.at(-1) as [number, number]
    expect(vp.cornerScreen(stale[0], stale[1]).x).not.toBeCloseTo(200, 3)
    // refresh 之后立刻贴回
    session.refresh()
    expectSticksTo(live, vp, 182, 82, { x: 18, y: 18 })
    session.dispose()
  })

  it('refresh() 在未开始/已结束会话时是空操作（安全幂等）', () => {
    const target = makeTarget()
    const live = vi.fn()
    const vp = makeViewport()
    const session = createResizeDragSession({
      minW: 120,
      minH: 80,
      toFlow: vp.toFlow,
      onLive: live,
      onCommit: vi.fn(),
      eventTarget: () => target,
    })
    expect(() => session.refresh()).not.toThrow()
    expect(live).not.toHaveBeenCalled()
    session.start({ clientX: 200, clientY: 100 }, 200, 100)
    target.emit('pointerup', {})
    expect(() => session.refresh()).not.toThrow()
    session.dispose()
  })
})

/** 抓点偏移补偿：用户按下的位置是**拖柄中心**，而拖柄中心并不在卡片右下角上（见下组说明）。 */
describe('resizeDragSession：refresh() 也在场（接口存在性）', () => {
  it('会话暴露 refresh（供"视口变化时重算"用）', () => {
    const target = makeTarget()
    const { session } = makeSession(target)
    expect(typeof session.refresh).toBe('function')
    session.dispose()
  })
})

/**
 * 抓点偏移补偿：用户按下的位置是**拖柄中心**，而拖柄中心并不在卡片右下角上
 * （拖柄是反缩放的方块，卡在角内侧约 15px 屏幕距离），且这段屏幕距离随缩放变化
 * （取证实测：zoom 0.5 → 14px，zoom 2 → 18px）。所以起手时捕获它、每帧补回来，
 * 卡片才会在按下的那一刻就"钉"在指针上，而不是先跳一小段。
 */
describe('resizeDragSession：抓点偏移补偿（拖柄中心 ≠ 卡片角）', () => {
  it('传入抓点偏移：起手第一帧不跳（同一屏幕点算出的尺寸仍是起始尺寸）', () => {
    const target = makeTarget()
    const live = vi.fn()
    const session = createResizeDragSession({
      minW: 120,
      minH: 80,
      toFlow: (x, y) => ({ x, y }),
      onLive: live,
      onCommit: vi.fn(),
      eventTarget: () => target,
    })
    // 鼠标在拖柄中心 (100,100)，卡片右下角在 (118,118) → 偏移 (18,18)
    session.start({ clientX: 100, clientY: 100 }, 200, 100, { x: 18, y: 18 })
    // 没动鼠标 → 尺寸仍是起始尺寸（不补偏移的话这里会算成 182x82）
    target.emit('pointermove', { clientX: 100, clientY: 100 })
    expect(live).toHaveBeenLastCalledWith(200, 100)
    // 往外拖 (50,30) → 卡片角到 (168,148) → 尺寸 250,130
    target.emit('pointermove', { clientX: 150, clientY: 130 })
    expect(live).toHaveBeenLastCalledWith(250, 130)
    session.dispose()
  })
})
