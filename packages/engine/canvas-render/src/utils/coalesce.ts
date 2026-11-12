/**
 * coalesce —— 高频值"合帧"工具(目标 B2 性能约束③：滑块/颜色拖拽这类连续值合并到一帧再应用一次)。
 *
 * 为什么：颜色/滑块的 @input 每动一格就调一次 settings.set，若每次 set 都立即触发一次重绘，
 * 高频拖动会每帧重算。合帧器把同一帧内的多次提交合并成**一帧一次**调用(取每 key 最新值)，
 * 实时但不每帧算全图。
 *
 * 实现：默认用 requestAnimationFrame 作为 flush 调度；Node 测试可注入手动 scheduler(如 setTimeout/微任务)
 * 以同步推进合帧，保证纯逻辑可单测。
 *
 * rAF 兜底：页面不可见/后台标签页/无头环境会暂停 rAF，若只靠 rAF 合帧，滑块/颜色的 set 会永远不提交
 * （表现为"设置项拖了没反应"）。故每次 push 同时挂一个最大等待 timer(maxWaitMs，默认 120ms)：
 * rAF 正常时先到先 flush(行为不变，仍每帧一次)；rAF 被暂停时由 timer 保底提交，值不会丢失。
 */
export type CoalesceScheduler = (flush: () => void) => unknown

/** 帧调度：浏览器用 rAF；无 rAF(SSR/测试环境)回落到宏任务(setTimeout 0)。 */
export function rafScheduler(flush: () => void): unknown {
  const g = globalThis as { requestAnimationFrame?: (cb: () => void) => unknown }
  if (typeof g.requestAnimationFrame === 'function') return g.requestAnimationFrame(flush)
  return setTimeout(flush, 0)
}

/** 手动调度器：调用方手动 flush，便于测试把 N 次提交合并成 1 次。 */
export function manualScheduler(queue: Array<() => void>): CoalesceScheduler {
  return (flush) => queue.push(flush)
}

/**
 * 建一个按 key 合帧的提交器：coalesce(key, value) 把该 key 最新值暂存，
 * 到帧尾一次性把暂存的 (key,value) 全部交给 apply。帧内同 key 只保留最后一次。
 *
 * @param maxWaitMs rAF 保底等待：超过该时长仍未到帧尾则强制 flush（默认 120ms，约 8 帧/60fps）。
 *   传 Infinity 可完全禁用保底（仅 rAF 提交，测试/特殊场景用）。
 */
export function createCoalescer(
  apply: (pairs: Array<[string, unknown]>) => void,
  scheduler: CoalesceScheduler = rafScheduler,
  maxWaitMs = 120,
): {
  push(key: string, value: unknown): void
  /** 手动立即冲刷(不排队)；返回是否冲刷了东西 */
  flush(): boolean
  dispose(): void
} {
  let pending = new Map<string, unknown>()
  let scheduled = false
  let rafId: unknown
  let timerId: unknown

  function clearPending(): void {
    const g = globalThis as {
      cancelAnimationFrame?: (id: unknown) => void
      clearTimeout?: (id: unknown) => void
    }
    if (rafId !== undefined && typeof g.cancelAnimationFrame === 'function') g.cancelAnimationFrame(rafId)
    if (timerId !== undefined && typeof g.clearTimeout === 'function') g.clearTimeout(timerId as Parameters<typeof g.clearTimeout>[0])
    rafId = undefined
    timerId = undefined
  }
  function flushNow(): boolean {
    if (pending.size === 0) return false
    const pairs: Array<[string, unknown]> = [...pending.entries()]
    pending = new Map()
    scheduled = false
    clearPending()
    apply(pairs)
    return true
  }
  function schedule(): void {
    if (scheduled) return
    scheduled = true
    rafId = scheduler(flushNow)
    if (maxWaitMs !== Infinity) timerId = setTimeout(flushNow, maxWaitMs)
  }

  return {
    push(key, value) {
      pending.set(key, value)
      schedule()
    },
    flush: flushNow,
    dispose() {
      clearPending()
      pending = new Map()
      scheduled = false
    },
  }
}
