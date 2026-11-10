/**
 * taskRuntime —— 把一个底栏动作**交出去**（只负责提交，不负责等结果）。
 *
 * 用户口径 2026-11-10：任务只有后台在跑。前端没有、也不该有自己执行 / 自己轮询的
 * 第二条链路 —— 那会变成「每个任务一个定时器」，10 个任务就是 10 份请求，还会和后台
 * 写的进度互相覆盖。所以这里只剩三件事：
 *
 * 1. 提交那一帧立刻写 running（用户点了就要看到转圈，不等后台第一帧）；
 * 2. 调动作的 run（云端动作内部就是 POST /api/jobs）；
 * 3. 提交失败就写 error，不留悬挂的 running。
 *
 * 之后的进度、终态、产物全部由后台写进节点，前端那条**唯一的**全局定时器
 * （plugin-cloud-client 的 jobsWatcher）负责兜底对账。
 */
import type { BarAction, BarLookup, BarRunContext, BarRunInput } from './barTypes'
import type { ToolOutcome, ToolResult } from '@mini-canvas/kernel'
import { errorState, runningState, type NodeRunState } from './runState'

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
}

/**
 * 提交一个动作。返回「提交这一步」的结果（同步完成的动作会直接给最终结果）。
 *
 * 任何异常都被收敛成 { ok:false, error }，不留悬挂 running。
 */
export async function runAction(args: RunActionArgs, deps: TaskDeps): Promise<ToolResult> {
  const { nodeId, action, input, registry } = args
  const runCtx: BarRunContext = {
    nodeId,
    nodeType: args.nodeType,
    signal: new AbortController().signal,
    onProgress: () => {},
    readData: () => deps.readData(nodeId),
  }

  /**
   * 提交帧：running 0% + 能不能取消。
   *
   * canCancel 写在**节点数据**里（不在内存里）—— 节点壳只读数据画按钮，
   * 刷新 / 换标签页之后还是同一个答案。后台建好任务后会在自己的帧里再写一次。
   */
  const bootstrap = runningState(action.id)
  deps.writeRuntime(nodeId, {
    runState: {
      ...bootstrap,
      canCancel: action.cancellable === true || typeof action.onCancel === 'function',
    },
  })

  let outcome: ToolOutcome
  try {
    outcome = await action.run(input, runCtx)
  } catch (err) {
    const rs = errorState(action.id, toError(err, '动作执行失败').error ?? '动作执行失败', '可以调整参数后再点一次')
    deps.writeRuntime(nodeId, { runState: rs })
    return toError(err, '动作执行失败')
  }

  // 同步完成的动作（不是生成类）：结果直接落地，没有后台任务可等
  if (typeof outcome !== 'function') {
    const result = outcome as ToolResult
    /**
     * 「已经交给后台了」：动作声明了 externalRunState（云端动作就是这样），
     * 返回的 taskId 是后台任务号，**不是**最终结果。
     *
     * 这时不能写 done —— 写了卡片就立刻显示完成，后台其实还在跑。
     * 进度与终态由后台写节点，SSE / 全局定时器把结果带回来。
     */
    if (action.externalRunState && result.ok && result.taskId) {
      deps.writeRuntime(nodeId, {
        runState: {
          ...runningState(action.id),
          taskId: result.taskId,
          canCancel: action.cancellable === true || typeof action.onCancel === 'function',
        },
      })
      return result
    }
    return finish(action, args.nodeType, result)
  }

  /**
   * 交了任务、给了轮询函数 —— **前端不去驱动它**。
   *
   * 进度与终态由后台写节点、SSE 推回来；SSE 断了由全局定时器批量对账。
   * 在这里再开一个循环，就是同一件事的第二条链路（也正是要删掉的那条）。
   */
  return { ok: true }

  /** 同步完成的终态：写 done/error，再交给写入器（除非动作声明了 self） */
  async function finish(action: BarAction, nodeType: string, result: ToolResult): Promise<ToolResult> {
    if (result.ok) {
      deps.writeRuntime(nodeId, {
        runState: { status: 'done', progress: 100, actionId: action.id, ...(result.taskId ? { taskId: result.taskId } : {}) },
      })
      if (action.apply !== 'self') {
        const applier = registry.applierOf(nodeType)
        if (applier) await applier(nodeId, result, { nodeType })
        else if (deps.writeResult) deps.writeResult(nodeId, { runState: doneFrame(action.id, result.taskId) })
      }
      return result
    }
    const rs = errorState(action.id, result.error ?? '任务失败')
    deps.writeRuntime(nodeId, { runState: rs })
    return result
  }
}

/** 同步完成时写进 data.runState 的那一帧（与 doneState 同形，就地收口避免多引一个导出） */
function doneFrame(actionId: string, taskId?: string): NodeRunState {
  return { status: 'done', progress: 100, actionId, ...(taskId ? { taskId } : {}) }
}
