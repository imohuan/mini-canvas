/**
 * 左侧栏「定位节点」：保持当前缩放，只平移（用户 2026-10-08 的旧行为）。
 *
 * 回归点：fitTo 在「已经居中 / 已可见」时返回 false，旧代码随后用 padding 0.45
 * 再取景一次；若这次不带 keepZoom，就会把用户当前的缩放改掉。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useUi } from '../composables/ui'

describe('locateNode：定位不改缩放', () => {
  const ui = useUi()
  afterEach(() => {
    ui.setHostEl(null)
  })

  it('节点有矩形但已可见（fitTo 返回 false）时不再用 padding 0.45 改缩放', () => {
    const fitTo = vi.fn(() => false)
    const selection = { set: vi.fn() }
    const ctx = {
      get: (name: string) =>
        name === 'view'
          ? { fitTo, getNodeRect: () => ({ x: 0, y: 0, w: 100, h: 100 }) }
          : name === 'selection'
            ? selection
            : undefined,
      on: () => ({ dispose: () => {} }),
    }
    ui.setHostEl({ host: { ctx } })

    ui.locateNode('n1')

    expect(selection.set).toHaveBeenCalledWith(['n1'])
    expect(fitTo).toHaveBeenCalledTimes(1)
    expect(fitTo).toHaveBeenCalledWith(['n1'], { keepZoom: true, select: true })
  })

  it('没有节点矩形时才走 padding 0.45 的退路（旧行为）', () => {
    const fitTo = vi.fn(() => false)
    const ctx = {
      get: (name: string) =>
        name === 'view'
          ? { fitTo, getNodeRect: () => null }
          : name === 'selection'
            ? { set: vi.fn() }
            : undefined,
      on: () => ({ dispose: () => {} }),
    }
    ui.setHostEl({ host: { ctx } })

    ui.locateNode('n1')

    expect(fitTo).toHaveBeenCalledTimes(2)
    expect(fitTo).toHaveBeenLastCalledWith(['n1'], { padding: 0.45 })
  })
})
