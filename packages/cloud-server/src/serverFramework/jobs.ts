/**
 * jobs —— `ctx.jobs` 能力段：插件自己的**定时任务 / 延时任务 / 事件订阅**。
 *
 * 为什么需要它：后台插件常见"每隔几分钟做点什么"（轮询外部平台、清理缓存、上报）。
 * 没有它，插件得自己 `setInterval` + 自己记得卸载时 clear —— 漏一个就是内存泄漏 + 幽灵定时器。
 * 有了它：注册随插件 scope 回收（内核的 `ctx.effect` 白送）。
 *
 * 边界：这是**进程内**的轻量调度，不是持久化任务队列。进程重启就没了 ——
 * 需要跨重启的任务应该用任务系统（tasks/），不是这里。
 */
import type { PluginScope } from '@mini-canvas/kernel'

/** `ctx.jobs` 的形状 */
export interface JobsRegistrar {
  /** 每 intervalMs 跑一次（首次不立即跑，等一个周期）；返回可手动停的句柄 */
  every(intervalMs: number, fn: () => void | Promise<void>): JobHandle
  /** 延时 delayMs 跑一次 */
  once(delayMs: number, fn: () => void | Promise<void>): JobHandle
  /** 跑一次（下一拍） */
  soon(fn: () => void | Promise<void>): JobHandle
  /**
   * 订阅一个内核事件（如 'ctx:plugin-installed'）。
   *
   * 计划 Task 6 要求有它。为什么归在 jobs 而不是别处：对插件作者来说
   * 「定时做点什么」和「有事发生时做点什么」是同一类需求（都是"以后再说"）。
   * 订阅随插件卸载自动解除（内核的 ctx.on 本来就挂在插件 fiber 上）。
   */
  on(event: string, fn: (...args: unknown[]) => void): JobHandle
}

export interface JobHandle {
  /** 取消（幂等） */
  cancel(): void
}

/** 最小间隔（防插件写出 1ms 的死循环把 CPU 打满） */
const MIN_INTERVAL_MS = 50

export function createJobsRegistrar(ctx: PluginScope, scopeName: string): JobsRegistrar {
  /** 本插件登记的全部定时器（卸载时统一清） */
  const timers = new Set<ReturnType<typeof setInterval> | ReturnType<typeof setTimeout>>()

  ctx.effect(() => () => {
    for (const t of timers) {
      clearInterval(t as ReturnType<typeof setInterval>)
      clearTimeout(t as ReturnType<typeof setTimeout>)
    }
    timers.clear()
  })

  function guard(ms: number): number {
    if (!Number.isFinite(ms) || ms < MIN_INTERVAL_MS) return MIN_INTERVAL_MS
    return Math.floor(ms)
  }

  /** 包一层：单个任务抛错不把定时器带崩（记一条日志，继续跑） */
  const wrap = (fn: () => void | Promise<void>) => (): void => {
    try {
      const r = fn()
      if (r && typeof (r as Promise<void>).catch === 'function') {
        void (r as Promise<void>).catch((err) => {
          console.warn('[jobs] ' + scopeName + ' 的定时任务出错：', err)
        })
      }
    } catch (err) {
      console.warn('[jobs] ' + scopeName + ' 的定时任务出错：', err)
    }
  }

  function every(intervalMs: number, fn: () => void | Promise<void>): JobHandle {
    const t = setInterval(wrap(fn), guard(intervalMs))
    timers.add(t)
    return {
      cancel() {
        if (!timers.has(t)) return
        clearInterval(t)
        timers.delete(t)
      },
    }
  }

  function once(delayMs: number, fn: () => void | Promise<void>): JobHandle {
    const t = setTimeout(() => {
      timers.delete(t)
      wrap(fn)()
    }, guard(delayMs))
    timers.add(t)
    return {
      cancel() {
        if (!timers.has(t)) return
        clearTimeout(t)
        timers.delete(t)
      },
    }
  }

  return {
    every,
    once,
    // 用局部函数而非 this：注册器对象经 Proxy/解构后 this 不保证可用
    soon: (fn) => once(MIN_INTERVAL_MS, fn),
    on(event, fn) {
      // ctx.on 的订阅本来就随插件 fiber 回收（内核保证）；这里只把它包成 JobHandle 形状。
      const sub = ctx.on(event, fn)
      return {
        cancel() {
          sub.dispose()
        },
      }
    },
  }
}
