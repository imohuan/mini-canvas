/**
 * canvasReadiness —— 「画布可以直接呈现给用户了吗」的唯一判据（服务名 canvasReady）。
 *
 * 为什么需要它：插件分两截生效 ——
 *   ① apply() 同步注册（装完就在）；② 插件自己声明的**异步初始化**（联网拉画布、等后台清单）。
 * 以前画布一挂上就取景，此时 ② 往往还没完成；等它们回来把节点换掉，画面就对不上了，
 * 只能靠「再取景一次」硬补 —— 于是同一次打开会有两次取景，还会跳。
 *
 * 现在改成闸门：插件在 apply 里把异步初始化 Promise 交给 hold()；画布启动取景前
 * wait() 一次，等这些 Promise 全落地（成功或失败都算落地）再取景。**同步插件不需要做任何事** ——
 * 它们的注册在 apply 返回时就已完成，闸门自然是空的。
 *
 * 设计取舍：
 * - hold() 必须**尽早**登记（在发起异步工作的同一个同步段里），否则 wait() 可能已经结算过。
 * - 只等「启动阶段」登记的 Promise。画布呈现之后再 hold() 的（用户手动装插件）不参与等待，
 *   否则用户临时装个插件、画布就整个停住。
 * - 单项失败不阻断：闸门只关心"这类异步动作有没有结束"，插件自己的错误照旧写进自己的状态。
 * - 兜底超时：插件卡死（网络挂起）时画布仍要能打开，超时后照常取景。
 */

/** 插件登记的异步初始化句柄 */
export interface CanvasReadinessHandle {
  /**
   * 登记一个「画布呈现前要等它完成」的异步动作。
   *
   * @param fn 返回 Promise 的初始化（通常是联网恢复画布、拉清单）
   * @param label 诊断名（出错时日志里能看到是谁）
   * @returns 该次登记完成后的 Promise（成功/失败都会 resolve；不需要可忽略）
   */
  hold(fn: () => Promise<unknown>, label?: string): Promise<void>
  /** 当前是否还有未落地的登记 */
  pending(): boolean
  /** 等待当前全部登记落地（无登记时立即 resolve） */
  wait(): Promise<void>
  /** 是否已经关闭闸门：画布已呈现 / 已取景过一次。之后 hold() 不再参与等待 */
  closed(): boolean
  /** 关闭闸门（画布已呈现）。之后登记的异步动作不再影响启动取景 */
  close(): void
}

/**
 * 换存储后端的时机闸口（服务名 canvasSource）。
 *
 * 用途：让「数据从哪儿来」的插件（云端连接）在**宿主读取画布之前**把 save 的 canvas 域换成自己的后端。
 * 换完之后，宿主那一次普通的 save.get(GRAPH_KEY) 就天然读到云端数据 —— 不需要先写本地再覆盖，
 * 也不需要插件自己再把画布替换一遍。
 *
 * 契约只有一条：beforeRestore() 必须**先完成换后端**，再返回；返回后宿主才开始读。
 */
export interface CanvasSourceHandle {
  /**
   * 登记一个「读画布之前要先跑完」的异步动作（通常是换 adapter）。
   * @param fn 返回 Promise；完成后宿主才读画布
   * @param label 诊断名
   */
  beforeRestore(fn: () => Promise<unknown> | void, label?: string): void
  /** 依次执行已登记的动作（宿主在读画布前调用一次） */
  runBeforeRestore(): Promise<void>
}

export function createCanvasSource(): CanvasSourceHandle {
  const jobs: Array<{ label: string; fn: () => Promise<unknown> | void }> = []
  return {
    beforeRestore(fn, label = 'plugin') {
      jobs.push({ label, fn })
    },
    async runBeforeRestore() {
      for (const job of jobs) {
        try {
          await job.fn()
        } catch (err) {
          // 换后端失败不能拦住画布打开：退回原来的后端（宿主会用默认那份读）
          console.warn('[canvasSource] ' + job.label + ' 准备数据源失败，继续用默认存储', err)
        }
      }
      jobs.length = 0
    },
  }
}

/** 兜底超时：插件卡死时画布不能永远不打开 */
export const CANVAS_READY_TIMEOUT_MS = 8000

export function createCanvasReadiness(opts: { timeoutMs?: number } = {}): CanvasReadinessHandle {
  const timeoutMs = opts.timeoutMs ?? CANVAS_READY_TIMEOUT_MS
  const pending = new Set<Promise<void>>()
  let closed = false
  /** 已经结算过的 wait：避免每个调用方各开一条超时计时器 */
  let settledWait: Promise<void> | undefined

  function track(label: string, p: Promise<unknown>): Promise<void> {
    const settled = Promise.resolve(p)
      .then(
        () => undefined,
        (err) => {
          // 插件自己的错误由插件负责上报；这里只留一条诊断，绝不让它挡住画布打开
          console.warn('[canvasReady] ' + label + ' 初始化失败，画布继续打开', err)
        },
      )
      .finally(() => {
        pending.delete(settled)
      })
    pending.add(settled)
    return settled
  }

  function wait(): Promise<void> {
    if (settledWait) return settledWait
    /*
     * 不能「当前为空就直接结算」：插件是一个个 apply 的，先调 wait 的那个插件会把闸门
     * 提前关掉。真实用例：cloud-client 先 apply 并登记，后面才轮到其它插件。
     * 所以等到下一个宏任务再判空 —— 同一轮启动里所有插件都已在那个时刻前登记完毕。
     */
    settledWait = (async () => {
      await Promise.resolve()
      if (pending.size === 0) return
      const deadline = Date.now() + timeoutMs
      while (pending.size > 0) {
        const batch = [...pending]
        const remaining = deadline - Date.now()
        if (remaining <= 0) {
          console.warn('[canvasReady] 仍有 ' + batch.length + ' 项初始化未完成，超时后先按现状取景')
          return
        }
        await Promise.race([
          Promise.allSettled(batch),
          new Promise<void>((resolve) => setTimeout(resolve, remaining)),
        ])
      }
    })()
    return settledWait
  }

  return {
    hold(fn, label = 'plugin') {
      if (closed) {
        // 画布已经呈现：照常执行，只是不再阻塞启动取景
        return Promise.resolve()
          .then(() => fn())
          .then(
            () => undefined,
            (err) => {
              console.warn('[canvasReady] ' + label + ' 异步初始化失败', err)
            },
          )
      }
      let p: Promise<unknown>
      try {
        p = fn()
      } catch (err) {
        p = Promise.reject(err)
      }
      return track(label, p)
    },
    pending: () => pending.size > 0,
    wait,
    closed: () => closed,
    close() {
      closed = true
    },
  }
}
