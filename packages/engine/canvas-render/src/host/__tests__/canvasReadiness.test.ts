import { describe, expect, it, vi } from 'vitest'
import { createCanvasReadiness, CANVAS_READY_TIMEOUT_MS } from '../canvas-host/canvasReadiness'

/**
 * 画布就绪闸门：让画布等插件的异步初始化（联网恢复画布等）完成后再取景，只取一次。
 *
 * 用户口径 2026-11-16：「等待所有同步插件加载完成之后再初始化画布」，
 * 并且异步插件要能被等到，不能靠"再取一次景"硬补。
 */
describe('canvasReadiness · 启动取景前等异步插件', () => {
  it('默认超时 8 秒（插件卡死时画布仍能打开）', () => {
    expect(CANVAS_READY_TIMEOUT_MS).toBe(8000)
  })

  it('没有登记时 wait 立即完成（同步插件无需任何改动）', async () => {
    const gate = createCanvasReadiness()
    expect(gate.pending()).toBe(false)
    await expect(gate.wait()).resolves.toBeUndefined()
  })

  it('登记的异步初始化没落地之前，wait 不会提前完成', async () => {
    const gate = createCanvasReadiness()
    let release!: () => void
    const held = gate.hold(
      () => new Promise<void>((resolve) => { release = resolve }),
      'demo:restore',
    )
    let settled = false
    const waiting = gate.wait().then(() => { settled = true })
    await Promise.resolve()
    await Promise.resolve()
    expect(settled).toBe(false)
    expect(gate.pending()).toBe(true)
    release()
    await waiting
    await held
    expect(settled).toBe(true)
    expect(gate.pending()).toBe(false)
  })

  it('等待期间后到的登记也会被等到（插件是逐个 apply 的）', async () => {
    const gate = createCanvasReadiness()
    let releaseA!: () => void
    let releaseB!: () => void
    void gate.hold(() => new Promise<void>((r) => { releaseA = r }), 'a')
    const waiting = gate.wait()
    // wait 已开始后才登记第二个（真实场景：另一个插件此刻才 apply）
    void gate.hold(() => new Promise<void>((r) => { releaseB = r }), 'b')
    let done = false
    void waiting.then(() => { done = true })
    releaseA()
    await Promise.resolve()
    await new Promise((r) => setTimeout(r, 10))
    expect(done).toBe(false) // b 还没完成
    releaseB()
    await waiting
    expect(done).toBe(true)
  })

  it('某个插件初始化失败：不阻断画布，wait 照常完成', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const gate = createCanvasReadiness()
    void gate.hold(() => Promise.reject(new Error('网络断了')), 'cloud-client:restore')
    await expect(gate.wait()).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('同步抛错的登记同样不卡死', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const gate = createCanvasReadiness()
    void gate.hold(() => { throw new Error('同步就炸了') }, 'bad')
    await expect(gate.wait()).resolves.toBeUndefined()
    warn.mockRestore()
  })

  it('超时后放行：插件永远不完成，画布也不能一直不开', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const gate = createCanvasReadiness({ timeoutMs: 30 })
    void gate.hold(() => new Promise<void>(() => {}), 'hang')
    await expect(gate.wait()).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('关闭闸门后登记的异步动作不再阻塞（画布已呈现 / 用户手动装插件）', async () => {
    const gate = createCanvasReadiness()
    gate.close()
    expect(gate.closed()).toBe(true)
    let finished = false
    const p = gate
      .hold(async () => {
        await new Promise((r) => setTimeout(r, 20))
        finished = true
      }, 'late')
    await p
    expect(finished).toBe(true)
    expect(gate.pending()).toBe(false)
  })

  it('wait 可重复调用，返回同一趟（不会每次各开一条超时计时器）', async () => {
    const gate = createCanvasReadiness()
    const a = gate.wait()
    const b = gate.wait()
    expect(a).toBe(b)
  })
})
