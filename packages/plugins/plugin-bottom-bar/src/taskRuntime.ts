/**
 * taskRuntime —— 执行一个底栏动作的纯逻辑流程（提交 → 轮询 → 终态 → 写回 / 刷新续查）。
 *
 * 复用内核已有的轮询语义（ToolPollFn / ToolPollState，见 kernel/toolRegistry.ts），
 * 但自己驱动循环：动作不是注册在 ctx.tools 里，不能借用 ToolRegistry.invoke。
 *
 * 写盘口径（唯一，见计划 §0.4）：
 * - runState 每一帧都写节点，走 doc.updateNodeRuntime（落盘但**不进撤销栈**）；
 * - 产物落到节点（图/文/视频地址）走写入器自己的 doc.updateNode（**进历史**，那是作品）。
 * - 中间帧 200ms 节流：节流窗口内**不写**（不论进度是否变），终态不节流、必写。
 *   为什么：scheduleCommit 每次都全图深拷贝 + save.set，650ms 一次全图序列化代价太高。
 */
import type { BarAction, BarLookup, BarRunContext, BarRunInput } from './barTypes'
import type { ToolOutcome, ToolPollFn, ToolPollState, ToolProgress, ToolResult } from '@mini-canvas/kernel'
import { doneState, errorState, progressState, runningState, type NodeRunState } from './runState'

/** 默认轮询间隔（与内核 DEFAULT_TOOL_INTERVAL 同口径） */
export const DEFAULT_INTERVAL = 650
/** 默认整体超时（与内核 DEFAULT_TOOL_TIMEOUT 同口径） */
export const DEFAULT_TIMEOUT = 300_000
/** 中间帧写盘节流窗口（ms）：窗口内不写，终态不受影响 */
export const DEFAULT_THROTTLE = 200

/** 执行依赖（组件装配真实现，测试注假货；node 可单测的关键） */
export interface TaskDeps {
  /** 读本节点 data */
  readData(nodeId: string): Record<string, unknown>
  /** 写运行期状态（= doc.updateNodeRuntime，落盘不进历史） */
  writeRuntime(nodeId: string, data: Record<string, unknown>): void
  /** 写作品结果（= doc.updateNode，进历史）。写入器自己写节点时用它 */
  writeResult?(nodeId: string, data: Record<string, unknown>): void
  /** 调同 kind 写入器（可选；动作 apply:'self' 或没注册写入器时不调） */
  runApplier?(nodeId: string, result: ToolResult, ctx: { nodeType: string }): void | Promise<void>
  interval?: number
  timeoutMs?: number
  throttleMs?: number
  now?: () => number
}

/**
 * 睡到时间到 **或** 被取消（哪个先到算哪个）。
 *
 * 为什么不能直接 sleep：轮询循环只在每圈开头查一次 signal，而轮询间隔默认 3 秒 ——
 * 用户点了「取消」要**等下一拍**才看到反应（实测反馈「点取消没反应」）。
 * 这里让等待本身可被打断，取消立即收敛。
 */
function sleepOrAbort(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      resolve()
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/** 把异常收敛成失败结果（不往外抛，调用方路径统一） */
function toError(err: unknown, fallback: string): ToolResult {
  const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : ''
  return { ok: false, error: msg || fallback }
}

export interface RunActionArgs {
  nodeId: string
  nodeType: string
  action: BarAction
  input: BarRunInput
  registry: BarLookup
  signal?: AbortSignal
}

/**
 * 执行一个动作到终态。返回值就是动作的最终 ToolResult（UI 不必再读节点）。
 * 任何异常都被收敛成 { ok:false, error }，不留悬挂 running。
 */
export async function runAction(args: RunActionArgs, deps: TaskDeps): Promise<ToolResult> {
  const { nodeId, nodeType, action, input, registry, signal } = args
  const interval = deps.interval ?? DEFAULT_INTERVAL
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT
  const throttleMs = deps.throttleMs ?? DEFAULT_THROTTLE
  const now = deps.now ?? Date.now
  // 动作可以覆盖共享默认值（长视频任务不能被共享的 5 分钟超时误杀）
  const actionInterval = action.pollIntervalMs
  const actionTimeout = action.pollTimeoutMs

  const runCtx: BarRunContext = {
    nodeId,
    nodeType,
    signal: signal ?? new AbortController().signal,
    onProgress: () => {},
    readData: () => deps.readData(nodeId),
  }

  /** 服务端任务 id（异步任务拿到后记下来，取消时要拿它去服务端真取消）。
   *  注意：`let` 而不是塞进 runCtx —— runCtx 是给动作用的只读上下文，不该被它改写。 */
  let serverTaskId: string | undefined
  /** 取消：先 abort 客户端等待，再让动作自己去服务端取消（拿得到 taskId 才有意义） */
  const cancelUpstream = async (): Promise<void> => {
    if (!action.onCancel || !serverTaskId) return
    try {
      await action.onCancel(serverTaskId, runCtx)
    } catch {
      /* 服务端取消失败不改变本地已取消的事实（本地已 abort，用户已看到取消） */
    }
  }

  const writeRuntime = (rs: NodeRunState): void => deps.writeRuntime(nodeId, { runState: rs })

  // ① 取消：直接收敛（不留悬挂 running）
  if (signal?.aborted) {
    const rs = errorState(action.id, '已取消')
    writeRuntime(rs)
    return { ok: false, error: rs.message }
  }

  // ② 提交帧：running 0%（不节流——用户点了就要立刻看到）
  writeRuntime(runningState(action.id))
  const startedAt = now()
  let lastWriteAt = startedAt
  let lastState: NodeRunState | null = null

  // ③ 跑
  let outcome: ToolOutcome
  try {
    outcome = await action.run(input, runCtx)
  } catch (err) {
    const rs = errorState(action.id, toError(err, '动作执行失败').error ?? '动作执行失败')
    writeRuntime(rs)
    return toError(err, '动作执行失败')
  }

  // ④ 同步完成
  if (typeof outcome !== 'function') {
    return finish(action, nodeType, outcome as ToolResult)
  }

  // ⑤ 异步：驱动轮询到 done（超时收敛成失败）
  const poll = outcome as ToolPollFn
  while (true) {
    if (signal?.aborted) {
      const rs = errorState(action.id, '已取消')
      writeRuntime(rs)
      await cancelUpstream()
      return { ok: false, error: rs.message }
    }
    let state: ToolPollState
    try {
      state = await poll()
    } catch (err) {
      const rs = errorState(action.id, toError(err, '任务执行中断').error ?? '任务执行中断')
      writeRuntime(rs)
      return toError(err, '任务执行中断')
    }
    if (state.status === 'done') return finish(action, nodeType, state.result)
    // running 帧才带 taskId：记下来，取消时要用它去服务端真取消
    if (typeof state.taskId === 'string' && state.taskId) serverTaskId = state.taskId
    // 中间帧：节流窗口内不写（不论进度是否变）；窗口外写
    const t = now()
    const next = progressState(lastState ?? runningState(action.id), state)
    lastState = next
    if (t - lastWriteAt >= throttleMs) {
      writeRuntime(next)
      lastWriteAt = t
    }
    if (t - startedAt > (actionTimeout ?? timeoutMs)) {
      const rs = errorState(action.id, '任务超时（未在预期时间内完成）')
      writeRuntime(rs)
      return { ok: false, error: rs.message, taskId: next.taskId }
    }
    await sleepOrAbort(actionInterval ?? interval, signal ?? new AbortController().signal)
  }

  /** 终态（不节流）：写 done/error，再交给写入器（除非动作声明了 self） */
  async function finish(action: BarAction, nodeType: string, result: ToolResult): Promise<ToolResult> {
    if (result.ok) {
      writeRuntime(doneState(action.id, result.taskId))
      if (action.apply !== 'self') {
        const applier = registry.applierOf(nodeType)
        if (applier) await applier(nodeId, result, { nodeType })
        else if (deps.writeResult) deps.writeResult(nodeId, { runState: doneState(action.id, result.taskId) })
      }
      return result
    }
    const rs = errorState(action.id, result.error ?? '任务失败')
    writeRuntime(rs)
    return result
  }
}

export interface ResumeActionArgs {
  nodeId: string
  nodeType: string
  registry: BarLookup
  taskId: string
  actionId: string
  /** 取消信号：续查出来的任务同样要能被「取消」中断（不传 = 不可取消） */
  signal?: AbortSignal
}

export interface ResumeResult {
  resumed: boolean
  state: NodeRunState
}

/**
 * 刷新后续查：拿 data.runState 里的 taskId/actionId 把上次 running 的任务接回来。
 *
 * 关键约定：**错误分支必须在第一个 await 之前同步写完**——restoreAll 用 void 调它，
 * 异步分支抛错会被吞掉；同步写下的错误态是刷新场景唯一的兜底显示。
 */
export async function resumeAction(args: ResumeActionArgs, deps: TaskDeps): Promise<ResumeResult> {
  const { nodeId, nodeType, registry, taskId, actionId, signal } = args
  const writeRuntime = (rs: NodeRunState): void => deps.writeRuntime(nodeId, { runState: rs })

  // 同步分支：动作不在了（提供方插件被卸/版本变了）或拿不到 taskId → 明确中断，不去猜
  const action = registry.get(actionId)
  if (!action?.resume || !taskId) {
    const rs = errorState(actionId, '刷新后任务已中断')
    writeRuntime(rs)
    return { resumed: false, state: rs }
  }

  const runCtx: BarRunContext = {
    nodeId,
    nodeType,
    signal: new AbortController().signal,
    onProgress: () => {},
    readData: () => deps.readData(nodeId),
  }

  let lastState: NodeRunState = { status: 'running', progress: 0, actionId, taskId }
  try {
    const poll = action.resume(taskId, runCtx)
    if (!poll) {
      const rs = errorState(actionId, '刷新后任务已中断')
      writeRuntime(rs)
      return { resumed: false, state: rs }
    }
    while (true) {
      // 取消：续查的任务同样要能被打断（覆盖层「取消」按钮），且要顺手清掉服务端任务
      if (signal?.aborted) {
        const rs = errorState(actionId, '已取消')
        writeRuntime(rs)
        try {
          if (typeof action.onCancel === 'function' && taskId) await action.onCancel(taskId, runCtx)
        } catch {
          /* 服务端取消失败不改本地已取消的事实 */
        }
        return { resumed: true, state: rs }
      }
      const state = await poll()
      if (state.status === 'done') {
        const result = state.result
        if (result.ok) {
          const rs = doneState(actionId, taskId)
          writeRuntime(rs)
          if (action.apply !== 'self') {
            const applier = registry.applierOf(nodeType)
            if (applier) await applier(nodeId, result, { nodeType })
          }
          return { resumed: true, state: rs }
        }
        const rs = errorState(actionId, result.error ?? '任务失败')
        writeRuntime(rs)
        return { resumed: true, state: rs }
      }
      lastState = progressState(lastState, state)
      writeRuntime(lastState)
      // ★ 等「interval」毫秒再问下一次 —— 续查循环漏了这一行，会变成疯狂连打服务端
      //   （实测每秒几百次 /mcp 请求 + 每帧全图写盘，5 秒拖垮 dev server）。
      //   间隔与主循环（runAction）同口径：deps.interval ?? DEFAULT_INTERVAL。
      //   等待本身可被打断：覆盖层点取消要立刻收敛（见 sleepOrAbort）。
      await sleepOrAbort(deps.interval ?? DEFAULT_INTERVAL, signal ?? new AbortController().signal)
    }
  } catch (err) {
    const rs = errorState(actionId, toError(err, '任务执行中断').error ?? '任务执行中断')
    writeRuntime(rs)
    return { resumed: true, state: rs }
  }
}
