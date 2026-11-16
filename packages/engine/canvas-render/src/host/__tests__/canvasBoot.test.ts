import { describe, expect, it, vi } from 'vitest'
import { createCanvasBoot, CANVAS_BOOT_TIMEOUT_MS } from '../canvas-host/canvasBoot'

/**
 * canvasBoot —— 画布启动的唯二时机：准备数据源 → 等初始化 → 呈现。
 *
 * 这两件事曾经是两个服务（canvasSource / canvasReady），云端插件两处都要登记、
 * 两处都要写兜底。合成一个后，插件只面对一份契约。
 */
describe('canvasBoot · 阶段一：读画布前准备数据源', () => {
  it('默认超时 8 秒', () => {
    expect(CANVAS_BOOT_TIMEOUT_MS).toBe(8000)
  })

  it('按登记顺序执行完，宿主才开始读画布', async () => {
    const boot = createCanvasBoot()
    const order: string[] = []
    void boot.beforeRestore(async () => {
      await new Promise((r) => setTimeout(r, 10))
      order.push('switch-adapter')
    }, 'cloud:adapters')
    void boot.beforeRestore(() => { order.push('second') })
    await boot.runBeforeRestore()
    order.push('read-canvas')
    expect(order).toEqual(['switch-adapter', 'second', 'read-canvas'])
  })

  it('换后端失败不阻断读取（退回原后端，画布照常打开）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const boot = createCanvasBoot()
    void boot.beforeRestore(() => { throw new Error('网关没通') }, 'cloud:adapters')
    await expect(boot.runBeforeRestore()).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('只跑一次：重复调用不会把换后端做两遍', async () => {
    const boot = createCanvasBoot()
    let count = 0
    void boot.beforeRestore(() => { count += 1 })
    await boot.runBeforeRestore()
    await boot.runBeforeRestore()
    expect(count).toBe(1)
  })
})

describe('canvasBoot · 阶段二：算构图前等异步初始化', () => {
  it('没有登记时立即完成（同步插件无需任何改动）', async () => {
    const boot = createCanvasBoot()
    await expect(boot.waitReady()).resolves.toBeUndefined()
  })

  it('登记的初始化没落地之前，不会提前放行', async () => {
    const boot = createCanvasBoot()
    let release!: () => void
    void boot.ready(() => new Promise<void>((resolve) => { release = resolve }), 'demo:restore')
    let done = false
    const waiting = boot.waitReady().then(() => { done = true })
    await Promise.resolve()
    await Promise.resolve()
    expect(done).toBe(false)
    release()
    await waiting
    expect(done).toBe(true)
  })

  it('等待期间后到的登记也会被等到（插件是逐个 apply 的）', async () => {
    const boot = createCanvasBoot()
    let releaseA!: () => void
    let releaseB!: () => void
    void boot.ready(() => new Promise<void>((r) => { releaseA = r }), 'a')
    const waiting = boot.waitReady()
    // ready 内部先让出一个微任务再执行 fn，这里等它把 releaseA 赋上
    await Promise.resolve()
    await Promise.resolve()
    void boot.ready(() => new Promise<void>((r) => { releaseB = r }), 'b')
    let done = false
    void waiting.then(() => { done = true })
    releaseA()
    await new Promise((r) => setTimeout(r, 10))
    expect(done).toBe(false)
    releaseB()
    await waiting
    expect(done).toBe(true)
  })

  it('初始化失败 / 同步抛错：都不阻断画布', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const boot = createCanvasBoot()
    void boot.ready(() => Promise.reject(new Error('网络断了')), 'cloud:restore')
    void boot.ready(() => { throw new Error('同步就炸了') }, 'bad')
    await expect(boot.waitReady()).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('超时后放行：插件永远不完成，画布也不能一直不开', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const boot = createCanvasBoot({ timeoutMs: 30 })
    void boot.ready(() => new Promise<void>(() => {}), 'hang')
    await expect(boot.waitReady()).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('close 之后登记的初始化照常执行，但不再阻塞启动', async () => {
    const boot = createCanvasBoot()
    boot.close()
    expect(boot.closed()).toBe(true)
    let finished = false
    boot.ready(async () => {
      await new Promise((r) => setTimeout(r, 20))
      finished = true
    }, 'late')
    // ready 只登记；画布已呈现时它立刻开跑，但没有人等它 —— 这里等一小会儿确认它确实跑了
    await new Promise((r) => setTimeout(r, 40))
    expect(finished).toBe(true)
  })

  it('waitReady 可重复调用，返回同一趟', () => {
    const boot = createCanvasBoot()
    expect(boot.waitReady()).toBe(boot.waitReady())
  })

  it('登记后不会立刻执行：执行时机由 waitReady 决定', async () => {
    const boot = createCanvasBoot()
    let started = 0
    boot.ready(() => { started += 1 }, 'demo:pull')
    await Promise.resolve()
    await Promise.resolve()
    expect(started, 'ready 只登记，不能自己先跑起来').toBe(0)
    await boot.waitReady()
    expect(started).toBe(1)
  })
})
