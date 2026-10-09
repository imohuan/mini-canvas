/**
 * SessionHub（设计 §3.2）：每会话常驻事件通道。
 *
 * 要钉住的行为：
 * 1. append 后订阅者立刻收到；since 回放拿缺口事件；
 * 2. 断开（unsubscribe）不影响这一轮继续跑；
 * 3. 缓冲超限裁剪后，gapDetected 为真（调用方走转录重放的保底路径）；
 * 4. 同一会话不并发两个 run；abort 能中止；
 * 5. start 的 promise 在整轮结束时 resolve（队列调度器靠它串行）。
 */
import { describe, it, expect, vi } from 'vitest'
import { SessionHub } from '../agent/sessionHub.js'
import type { AgentChatEvent } from '../agent/translate.js'

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

describe('SessionHub', () => {
  it('append → 订阅者收到；later 订阅者拿回放', () => {
    const hub = new SessionHub()
    const seen: number[] = []
    hub.subscribe('c', 's', 0, (item) => seen.push(item.seq))
    hub.append('c', 's', { type: 'notice', message: 'a' })
    hub.append('c', 's', { type: 'notice', message: 'b' })
    expect(seen).toEqual([1, 2])
    // 后进来的订阅者从 since=1 起：只拿 2
    const late: number[] = []
    hub.subscribe('c', 's', 1, (item) => late.push(item.seq))
    expect(late).toEqual([2])
  })

  it('同一会话的状态互相隔离（两个会话各一条通道）', () => {
    const hub = new SessionHub()
    hub.append('c1', 's1', { type: 'notice', message: 'x' })
    expect(hub.lastSeq('c1', 's1')).toBe(1)
    expect(hub.lastSeq('c2', 's2')).toBe(0)
  })

  it('断开订阅不影响 run 继续跑（刷新不断流的地基）', async () => {
    const hub = new SessionHub()
    const received: AgentChatEvent[] = []
    const { unsubscribe } = hub.subscribe('c', 's', 0, (item) => received.push(item.ev))
    const runPromise = hub.start('c', 's', {
      async *run() {
        yield { type: 'text', delta: '1', partial: true }
        await delay(10)
        yield { type: 'text', delta: '2', partial: true }
        await delay(10)
        yield { type: 'done' }
      },
    })
    await delay(5)
    unsubscribe() // 相当于页面刷新：连接断了
    await runPromise
    // 后台照跑完：缓冲里有全部 5 条（run_state 开 / 两条 delta / done / run_state 关）
    // —— 页面回来能回放（这就是"刷新不断流"）
    expect(hub.lastSeq('c', 's')).toBe(5)
    // 断开前收到 run_state(开) + 第一条 delta = 2 条；断开后的不再收
    expect(received.length).toBe(2)
    // 重连：拿回放补齐
    const replay: number[] = []
    hub.subscribe('c', 's', 0, (i) => replay.push(i.seq))
    expect(replay).toEqual([1, 2, 3, 4, 5])
  })

  it('abort 能中止正在跑的一轮', async () => {
    const hub = new SessionHub()
    let aborted = false
    const p = hub.start('c', 's', {
      async *run(signal) {
        yield { type: 'text', delta: 'x', partial: true }
        await delay(50)
        if (signal.aborted) aborted = true
        yield { type: 'done' }
      },
    })
    await delay(5)
    expect(hub.isRunning('c', 's')).toBe(true)
    expect(hub.abort('c', 's')).toBe(true)
    await p
    expect(aborted).toBe(true)
    expect(hub.isRunning('c', 's')).toBe(false)
    expect(hub.abort('c', 's')).toBe(false) // 已经停了
  })

  it('同一会话不并发两个 run（抛错而不是悄悄并行）', async () => {
    const hub = new SessionHub()
    const p = hub.start('c', 's', {
      async *run() {
        await delay(20)
        yield { type: 'done' }
      },
    })
    await expect(
      hub.start('c', 's', {
        async *run() {
          yield { type: 'done' }
        },
      }),
    ).rejects.toThrow(/已经在跑/)
    await p
  })

  it('生成器直接抛错时：补 error + done 事件，run 正常收尾', async () => {
    const hub = new SessionHub()
    const errors: unknown[] = []
    await hub.start('c', 's', {
      onError: (e) => errors.push(e),
      async *run(): AsyncGenerator<AgentChatEvent> {
        yield { type: 'text', delta: 'a', partial: true }
        throw new Error('boom')
      },
    })
    expect(errors).toHaveLength(1)
    const all: AgentChatEvent[] = []
    hub.subscribe('c', 's', 0, (i) => all.push(i.ev))
    // 事件序列：run_state(开) → delta → error → done → run_state(关)
    expect(all.at(-3)).toMatchObject({ type: 'error', message: 'boom' })
    expect(all.at(-2)).toEqual({ type: 'done' })
    expect(all.at(-1)).toEqual({ type: 'run_state', running: false })
  })

  it('缓冲超限裁剪：gapDetected 为真且 droppedSeq 记录水位', async () => {
    const hub = new SessionHub()
    // 灌 2100 条（超过 2000 上限）
    for (let i = 0; i < 2100; i++) hub.append('c', 's', { type: 'notice', message: 'n' + i })
    // since=0 是"从头要"——缓冲已裁，但 0 属于初始态，按设计不算 gap
    const from0 = hub.subscribe('c', 's', 0, () => undefined)
    expect(from0.replay.length).toBe(2000)
    expect(from0.droppedSeq).toBe(100)
    // since=1 太旧（1 < droppedSeq=100）⇒ gap
    const stale = hub.subscribe('c', 's', 1, () => undefined)
    expect(stale.gapDetected).toBe(true)
    // since=100 正好 = droppedSeq ⇒ 不算 gap（100 之后都还在）
    const fresh = hub.subscribe('c', 's', 100, () => undefined)
    expect(fresh.gapDetected).toBe(false)
  })

  it('订阅者抛错不影响其他订阅者与这一轮', async () => {
    const hub = new SessionHub({ log: vi.fn() })
    const good: number[] = []
    hub.subscribe('c', 's', 0, () => {
      throw new Error('bad subscriber')
    })
    hub.subscribe('c', 's', 0, (i) => good.push(i.seq))
    await hub.start('c', 's', {
      async *run() {
        yield { type: 'done' }
      },
    })
    // run_state(开) → done → run_state(关)：三拍都到了好订阅者手里，
    // 说明坏订阅者抛错没影响别人（也没影响这一轮）
    expect(good).toEqual([1, 2, 3])
    expect(hub.lastSeq('c', 's')).toBe(3)
  })

  it('forget 放掉通道（缓冲清空、run 中止）', async () => {
    const hub = new SessionHub()
    const p = hub.start('c', 's', {
      async *run() {
        await delay(30)
        yield { type: 'done' }
      },
    })
    await delay(5)
    hub.forget('c', 's')
    expect(hub.lastSeq('c', 's')).toBe(0)
    await p
  })

  it('runStartedAt 给出"正在跑"的时间锚', async () => {
    const hub = new SessionHub()
    expect(hub.runStartedAt('c', 's')).toBeNull()
    const before = Date.now()
    const p = hub.start('c', 's', {
      async *run() {
        await delay(20)
        yield { type: 'done' }
      },
    })
    await delay(2)
    const at = hub.runStartedAt('c', 's')
    expect(at).not.toBeNull()
    expect(at!).toBeGreaterThanOrEqual(before)
    await p
    expect(hub.runStartedAt('c', 's')).toBeNull()
  })
})
