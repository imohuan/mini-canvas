/**
 * 多模型测试必须并发（用户口径 2026-11-11）。
 *
 * 判据不是「源码里有没有 Promise.all」，而是**真实耗时**：
 * 4 个各 120ms 的请求，串行至少 480ms；并发应接近 120ms。
 */
import { describe, expect, it } from 'vitest'
import { probeModelsConcurrently } from '../ui/settings/modelProbeBatch'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

describe('多模型并发测试', () => {
  it('4 个模型同时发，总耗时接近单个而不是相加', async () => {
    const ids = ['a', 'b', 'c', 'd']
    const seen: string[] = []
    const started = Date.now()
    await probeModelsConcurrently(
      ids,
      async (id) => {
        await sleep(120)
        return 'ok-' + id
      },
      (id) => seen.push(id),
    )
    const elapsed = Date.now() - started
    expect(seen.sort()).toEqual([...ids].sort())
    // 串行会是 ~480ms；给并发留足环境抖动空间
    expect(elapsed).toBeLessThan(400)
  })

  it('一个失败不拦住其它模型，成功的结果照样回来', async () => {
    const seen: string[] = []
    await probeModelsConcurrently(
      ['ok-1', 'boom', 'ok-2'],
      async (id) => {
        await sleep(30)
        if (id === 'boom') throw new Error('炸了')
        return id
      },
      (id) => seen.push(id),
    )
    expect(seen.sort()).toEqual(['ok-1', 'ok-2'])
  })

  it('每个请求都回调一次 settled（用来更新 3/5 进度）', async () => {
    let settled = 0
    await probeModelsConcurrently(
      ['a', 'b', 'c'],
      async () => {
        await sleep(10)
        return 1
      },
      () => undefined,
      () => settled++,
    )
    expect(settled).toBe(3)
  })

  it('空列表：不发请求、立刻结束（不会卡在“测试中”）', async () => {
    let called = 0
    await probeModelsConcurrently([], async () => { called++ }, () => undefined)
    expect(called).toBe(0)
  })
})
