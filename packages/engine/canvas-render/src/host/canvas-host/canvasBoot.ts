/**
 * canvasBoot —— 画布启动的**唯一时序契约**（服务名 canvasBoot）。
 *
 * 画布启动只有两个阶段，插件各管一段（顺序由宿主保证，插件不用自己排）：
 *
 *   ① 准备数据源  beforeRestore(fn)
 *      在宿主「读画布」之前跑。云端连接在这里把 save 的 canvas 域换成自己的后端，
 *      于是宿主那一次普通 save.get 读到的就是云端数据 —— 不需要先写本地、再被覆盖。
 *
 *   ② 等待初始化  ready(fn)
 *      在「读画布之后、算构图之前」跑。插件若还有别的异步准备（拉清单、预热资源），交给它。
 *      同步插件不需要登记：apply 返回时它们已经就绪。
 *
 * 为什么合成一个服务：这两件本质是同一个问题 —— 「画布什么时候可以呈现」。
 * 拆成两个服务时，云端插件两处都要登记、两处都要写兜底，调用方也要问两遍。
 *
 * 三条硬规则（调用方不用关心，实现里保证）：
 * - 单项失败不阻断启动，只记一条诊断；
 * - 有兜底超时，插件卡死时画布照样打开；
 * - 画布呈现之后再登记的，不再阻塞启动。
 *
 * 一条时序规则：**`ready(fn)` 只登记，不立即执行**。什么时候跑由宿主决定（`waitReady`）——
 * 于是插件可以在很早的时候（读画布之前）就把任务交上来，宿主保证它在数据就位之后才跑。
 * 旧做法是登记即执行，插件就只能等到自己「确定宿主已经读完」时才敢登记，时序责任又漏回插件里。
 */

/** 兜底超时：插件卡死（网络挂起）时画布不能永远不打开 */
export const CANVAS_BOOT_TIMEOUT_MS = 8000

export interface CanvasBootHandle {
  /**
   * 登记「宿主读画布之前要先完成」的动作（典型：换存储后端）。
   * 返回的 Promise 在该动作完成（或失败）时 resolve，成功/失败都不 reject。
   */
  beforeRestore(fn: () => Promise<unknown> | void, label?: string): Promise<void>
  /**
   * 登记「画布呈现之前要等它完成」的异步初始化（不含数据源切换的都用它）。
   *
   * 只登记，不执行；执行时机由宿主的 `waitReady()` 统一触发。
   */
  ready(fn: () => Promise<unknown> | void, label?: string): void
  /** 依次执行 beforeRestore 登记（宿主在读画布前调用一次） */
  runBeforeRestore(): Promise<void>
  /**
   * 宿主把「这一次读到了什么」记下来（读完立刻调用一次）。
   *
   * 为什么需要：插件要判断「服务器上是不是还没有这张画布」（首次上云），
   * 旧做法是自己再 GET 一次 —— 同一份数据读两遍，还可能拿到不同版本。
   * 现在宿主把唯一那次读取的结果挂在这里，插件读这份即可。
   */
  setRestoreResult(result: CanvasRestoreResult): void
  /** 宿主这次读画布的结果；还没读时为 undefined */
  restoreResult(): CanvasRestoreResult | undefined
  /** 等待全部 ready 登记落地（宿主在算构图前调用一次） */
  waitReady(): Promise<void>
  /** 画布已呈现：之后登记的 ready 不再阻塞启动 */
  close(): void
  /** 是否已关闭 */
  closed(): boolean
}

/**
 * 宿主那一次读画布的结果：已经进 store 的最终节点与边（媒体地址也重建过了）。
 *
 * 只给「画布里现在是什么」这一件事 —— 不做“存储里原来有没有存档”的判断：
 * 云端后端永远能返回一份（可能是空的）画布，语义上分不出“从没存过”。
 */
export interface CanvasRestoreResult {
  nodes: unknown[]
  edges: unknown[]
}

/** 把「同步函数 / 返回 Promise 的函数」统一成 Promise，并把失败吞成一条诊断 */
function settle(label: string, phase: string, fn: () => Promise<unknown> | void): Promise<void> {
  return Promise.resolve()
    .then(() => fn())
    .then(
      () => undefined,
      (err) => {
        console.warn('[canvasBoot] ' + label + ' 在「' + phase + '」阶段失败，画布继续启动', err)
      },
    )
}

export function createCanvasBoot(opts: { timeoutMs?: number } = {}): CanvasBootHandle {
  const timeoutMs = opts.timeoutMs ?? CANVAS_BOOT_TIMEOUT_MS
  /** 阶段① 的任务（按登记顺序执行） */
  const beforeJobs: Array<{ label: string; fn: () => Promise<unknown> | void }> = []
  /** 阶段② 还没开跑的任务（登记顺序 = 执行顺序） */
  const pendingReady: Array<{ label: string; fn: () => Promise<unknown> | void }> = []
  /** 阶段② 的未落地任务 */
  const readyTasks = new Set<Promise<void>>()
  let bootClosed = false
  let beforeRan = false
  let readyWait: Promise<void> | undefined
  let restored: CanvasRestoreResult | undefined

  function trackReady(label: string, fn: () => Promise<unknown> | void): Promise<void> {
    const task = settle(label, 'ready', fn).finally(() => readyTasks.delete(task))
    readyTasks.add(task)
    return task
  }

  /** 把还没开跑的任务全部启动（waitReady 与 close 都走这里） */
  function startPending(): void {
    const batch = pendingReady.splice(0)
    for (const job of batch) trackReady(job.label, job.fn)
  }

  return {
    beforeRestore(fn, label = 'plugin') {
      beforeJobs.push({ label, fn })
      return Promise.resolve()
    },

    ready(fn, label = 'plugin') {
      // 画布已经呈现：直接跑，不再阻塞启动
      if (bootClosed) {
        void settle(label, 'ready', fn)
        return
      }
      pendingReady.push({ label, fn })
    },

    async runBeforeRestore() {
      if (beforeRan) return
      beforeRan = true
      for (const job of beforeJobs) await settle(job.label, '准备数据源', job.fn)
      beforeJobs.length = 0
    },

    setRestoreResult(result) {
      restored = { nodes: result.nodes, edges: result.edges }
    },

    restoreResult: () => restored,

    waitReady() {
      if (readyWait) return readyWait
      /*
       * 先把已登记的任务开跑，再判空。等一轮之后仍可能有新登记（插件是逐个 apply 的），
       * 所以循环里每一轮都重新启动一次待跑队列，直到没有未落地的任务。
       */
      readyWait = (async () => {
        await Promise.resolve()
        startPending()
        if (readyTasks.size === 0) return
        const deadline = Date.now() + timeoutMs
        while (readyTasks.size > 0) {
          const batch = [...readyTasks]
          const remaining = deadline - Date.now()
          if (remaining <= 0) {
            console.warn('[canvasBoot] 仍有 ' + batch.length + ' 项初始化未完成，超时后先呈现画布')
            return
          }
          await Promise.race([
            Promise.allSettled(batch),
            new Promise<void>((resolve) => setTimeout(resolve, remaining)),
          ])
          startPending()
        }
      })()
      return readyWait
    },

    close() {
      bootClosed = true
      // 还没开跑的照常跑（它们可能是用户新装插件的初始化），只是不再有人等它们
      startPending()
    },
    closed: () => bootClosed
  }
}
