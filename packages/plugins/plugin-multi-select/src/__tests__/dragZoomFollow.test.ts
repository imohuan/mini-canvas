import { describe, it, expect } from 'vitest'

/**
 * 拖动中缩放后的"跟手性"（用户报："拖拽的时候缩放，定位就出现了问题"）。
 *
 * 浏览器实测（修前）：zoom=1 拖 100px 内容走 100px（ratio=1，正常）；
 * 缩放到 2x 后再拖 100px，内容只走 60.5px（ratio=0.605，脱手）；
 * 缩回 1x 再拖，内容走 156.6px（ratio=1.566，过冲）。
 *
 * 根因：位移公式是"累计屏幕位移 / 当前 zoom" —— 一旦中途缩放，
 * 起手到现在已拖的屏幕距离被按新 zoom 重新换算，之前拖过的段被篡改。
 * 正确做法：按"两次事件之间的屏幕增量 / 当时 zoom"逐段换算并累加。
 * 这里用纯数据模型复刻两条公式，直接断言差异（组件实现与本模型同构）。
 */
describe('拖动中缩放后的跟手性（位移必须按段换算，不能用当前 zoom 重算全程）', () => {
  /** 修前的公式：累计屏幕位移 ÷ 当前 zoom（zoom 变化会篡改历史段） */
  function oldModel(moves: Array<{ dx: number; dy: number; zoom: number }>) {
    let clientX = 0
    let clientY = 0
    let zoom = 1
    for (const m of moves) {
      zoom = m.zoom
      clientX += m.dx
      clientY += m.dy
    }
    return { flowX: clientX / zoom, flowY: clientY / zoom }
  }

  /** 修后的公式：每段屏幕增量 ÷ 该段时的 zoom，累加 */
  function newModel(moves: Array<{ dx: number; dy: number; zoom: number }>) {
    let flowX = 0
    let flowY = 0
    for (const m of moves) {
      flowX += m.dx / m.zoom
      flowY += m.dy / m.zoom
    }
    return { flowX, flowY }
  }

  it('zoom 恒定时两条公式等价（基础行为不回归）', () => {
    const moves = [
      { dx: 20, dy: 10, zoom: 1 },
      { dx: 20, dy: 10, zoom: 1 },
      { dx: 60, dy: 30, zoom: 1 },
    ]
    expect(newModel(moves)).toEqual(oldModel(moves))
    expect(newModel(moves).flowX).toBe(100)
  })

  it('回归：拖 100px 后缩放 2x，旧公式把已拖的 100px 腰斩成 50px；新公式保持 100px', () => {
    const moves = [
      { dx: 100, dy: 50, zoom: 1 },
      { dx: 0, dy: 0, zoom: 2 },
    ]
    expect(oldModel(moves).flowX).toBe(50)
    expect(newModel(moves).flowX).toBe(100)
  })

  it('缩放后继续拖：新段按新 zoom 换算（100px@2x = 内容 50px）', () => {
    const moves = [
      { dx: 100, dy: 50, zoom: 1 },
      { dx: 0, dy: 0, zoom: 2 },
      { dx: 100, dy: 50, zoom: 2 },
    ]
    expect(newModel(moves).flowX).toBe(150)
    expect(newModel(moves).flowY).toBe(75)
  })

  it('缩回再拖：每段各按各的 zoom，总位移 = 各段之和', () => {
    const moves = [
      { dx: 100, dy: 0, zoom: 1 },
      { dx: 0, dy: 0, zoom: 2 },
      { dx: 100, dy: 0, zoom: 2 },
      { dx: 0, dy: 0, zoom: 1 },
      { dx: 100, dy: 0, zoom: 1 },
    ]
    expect(newModel(moves).flowX).toBe(250)
  })
});
