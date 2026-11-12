/**
 * watchThemeMode 测试 —— 锁住"多个消费方共用同一个 `<html>` 观察器"这条性能不变量。
 *
 * 为什么值得单开：消费方是**每个边组件一份**，一张画布几百条连线。若每次调用各建一个
 * MutationObserver，就是几百个观察器盯着同一个元素 —— 功能照常、只在规模上出问题，
 * 这类"能用但会拖垮"的回归靠人工极难察觉。
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { watchThemeMode } from '../themePalette'

/** 假元素：只记账观察器挂/卸 + 提供 classList.contains */
function fakeEl(isDark = false) {
  let dark = isDark
  const observed: Array<{ cb: () => void; disconnected: boolean }> = []
  const el = {
    classList: { contains: (c: string) => (c === 'dark' ? dark : false) },
    setDark(v: boolean) { dark = v },
    observed,
    /** 手动触发一次观察回调（模拟 class 变化） */
    fire() { for (const o of observed) if (!o.disconnected) o.cb() },
  }
  return el
}

type FakeObserver = { cb: () => void; observed: boolean; disconnected: boolean }
let created: FakeObserver[] = []

class MockMutationObserver {
  private rec: FakeObserver
  constructor(cb: () => void) {
    this.rec = { cb, observed: false, disconnected: false }
    created.push(this.rec)
  }
  observe(): void { this.rec.observed = true }
  disconnect(): void { this.rec.disconnected = true }
}

afterEach(() => { created = []; vi.unstubAllGlobals() })

describe('watchThemeMode（共享观察器）', () => {
  it('N 个订阅者只创建 1 个 MutationObserver（几百条连线也只挂一个）', () => {
    vi.stubGlobal('MutationObserver', MockMutationObserver)
    const el = fakeEl(false)
    const modes: string[] = []
    const offs = Array.from({ length: 50 }, () => watchThemeMode((m) => modes.push(m), el as unknown as Element))
    expect(created).toHaveLength(1)
    expect(created[0].observed).toBe(true)

    el.setDark(true)
    created[0].cb()
    expect(modes).toHaveLength(50)
    expect(modes.every((m) => m === 'dark')).toBe(true)

    for (const off of offs) off()
    // 全部退订 → 观察器断开（不留空转的 observer）
    expect(created[0].disconnected).toBe(true)
  })

  it('部分退订不影响其它订阅者；全部退订后重新订阅能再挂上', () => {
    vi.stubGlobal('MutationObserver', MockMutationObserver)
    const el = fakeEl(false)
    const a: string[] = []
    const b: string[] = []
    const offA = watchThemeMode((m) => a.push(m), el as unknown as Element)
    const offB = watchThemeMode((m) => b.push(m), el as unknown as Element)
    expect(created).toHaveLength(1)

    offA()
    el.setDark(true)
    created[0].cb()
    expect(a).toEqual([])
    expect(b).toEqual(['dark'])

    offB()
    expect(created[0].disconnected).toBe(true)

    // 再订阅 → 新观察器（旧账目已回收）
    const c: string[] = []
    const offC = watchThemeMode((m) => c.push(m), el as unknown as Element)
    expect(created).toHaveLength(2)
    expect(created[1].observed).toBe(true)
    created[1].cb()
    expect(c).toEqual(['dark'])
    offC()
  })

  it('回调里退订不会让同批次其它订阅者被漏掉', () => {
    vi.stubGlobal('MutationObserver', MockMutationObserver)
    const el = fakeEl(false)
    const seen: number[] = []
    const off1 = watchThemeMode(() => { seen.push(1); off1() }, el as unknown as Element)
    const off2 = watchThemeMode(() => seen.push(2), el as unknown as Element)
    el.setDark(true)
    created[0].cb()
    expect(seen).toEqual([1, 2])
    off2()
  })

  it('无 DOM 环境返回 no-op（不抛）', () => {
    vi.stubGlobal('MutationObserver', undefined)
    const off = watchThemeMode(() => {})
    expect(typeof off).toBe('function')
    expect(() => off()).not.toThrow()
  })
})
