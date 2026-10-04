/**
 * ctx.store / ctx.jobs（Task 6 配套能力）。
 *
 * store：插件私有持久化（卸载即清）；jobs：定时任务（卸载即停）。
 * 两条的核心都是**卸载后不留垃圾**。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Hono } from 'hono'
import { Context, setDefaultCapabilityLayerFactory } from '@mini-canvas/kernel'
import { createServerCapabilityLayer } from '../serverFramework/capabilityLayer.js'

let root: string
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-store-'))
})
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

function boot() {
  const app = new Hono()
  setDefaultCapabilityLayerFactory(() => createServerCapabilityLayer({ app, root }))
  return new Context()
}

describe('ctx.store —— 插件私有持久化', () => {
  it('set/get/keys/delete 基本可用，且真的落盘', async () => {
    const ctx = boot()
    let ns: { set(k: string, v: unknown): Promise<void>; get<T>(k: string): Promise<T | undefined> } | undefined
    ctx.plugin({ name: 'p1', apply: (c) => { ns = c.store.namespace('p1') } })
    await ctx.start()
    await ns!.set('last-run', 12345)
    expect(await ns!.get<number>('last-run')).toBe(12345)
    const file = path.join(root, 'plugin-data', 'p1.json')
    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual({ 'last-run': 12345 })
    ctx.stop()
  })

  it('两个插件的命名空间互不可见', async () => {
    const ctx = boot()
    const stores: Record<string, { set(k: string, v: unknown): Promise<void>; get<T>(k: string): Promise<T | undefined> }> = {}
    ctx.plugin({ name: 'a', apply: (c) => { stores.a = c.store.namespace('a') } })
    ctx.plugin({ name: 'b', apply: (c) => { stores.b = c.store.namespace('b') } })
    await ctx.start()
    await stores.a!.set('k', 'from-a')
    expect(await stores.b!.get('k')).toBeUndefined()
    ctx.stop()
  })

  it('卸载插件 → 它的命名空间被清掉（不留垃圾）', async () => {
    const ctx = boot()
    let ns: { set(k: string, v: unknown): Promise<void> } | undefined
    ctx.plugin({ name: 'temp', apply: (c) => { ns = c.store.namespace('temp') } })
    await ctx.start()
    await ns!.set('x', 1)
    const file = path.join(root, 'plugin-data', 'temp.json')
    expect(await fs.readFile(file, 'utf8')).toContain('1')
    ctx.uninstallPlugin('temp')
    // 卸载是同步触发 effect 清理（store.clear 是 async，等一拍）
    await new Promise((r) => setTimeout(r, 30))
    await expect(fs.readFile(file, 'utf8')).rejects.toThrow()
    ctx.stop()
  })

  it('非法命名空间名（路径穿越）→ 抛错', async () => {
    const ctx = boot()
    let err: Error | undefined
    ctx.plugin({
      name: 'evil',
      apply: (c) => {
        try {
          c.store.namespace('../escape')
        } catch (e) {
          err = e as Error
        }
      },
    })
    await ctx.start()
    expect(String(err?.message)).toContain('store')
    ctx.stop()
  })
})

describe('ctx.jobs —— 定时任务', () => {
  it('every 会按周期跑，cancel 后停', async () => {
    const ctx = boot()
    let count = 0
    let handle: { cancel(): void } | undefined
    ctx.plugin({
      name: 'ticker',
      apply: (c) => {
        handle = c.jobs.every(50, () => {
          count += 1
        })
      },
    })
    await ctx.start()
    await new Promise((r) => setTimeout(r, 170))
    expect(count).toBeGreaterThanOrEqual(2)
    handle!.cancel()
    const after = count
    await new Promise((r) => setTimeout(r, 120))
    expect(count).toBe(after)
    ctx.stop()
  })

  it('卸载插件 → 定时器自动停（作用域回收）', async () => {
    const ctx = boot()
    let count = 0
    ctx.plugin({ name: 'auto', apply: (c) => { c.jobs.every(50, () => { count += 1 }) } })
    await ctx.start()
    await new Promise((r) => setTimeout(r, 120))
    expect(count).toBeGreaterThan(0)
    ctx.uninstallPlugin('auto')
    const after = count
    await new Promise((r) => setTimeout(r, 150))
    expect(count).toBe(after)
    ctx.stop()
  })
})
