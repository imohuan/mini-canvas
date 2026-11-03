/**
 * node-ui 后台：轮询运行表（从 server.ts 原样迁出）。
 */
import { getTaskRuns } from '../task/runs.js'


/**
 * 等一次调用跑完（轮询运行表，拿终态）。
 *
 * 为什么不用 SSE：MCP 工具是一次请求-响应，没有长连接可以推；
 * 运行表在**同一个进程**里（子进程的事件经 IPC 回来），所以直接轮询它最快也最稳。
 * 超时兜底：到点就返回当前状态（不卡住 MCP 调用），让调用方自己决定要不要再问。
 */
export async function waitRun(
  runId: string,
  timeoutMs: number,
): Promise<{ state: 'running' | 'done' | 'error' | 'cancelled'; result?: unknown; error?: string; tail: string[] }> {
  const runs = getTaskRuns()
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const run = runs.get(runId)
    if (!run) return { state: 'error', error: '这次调用找不到了：' + runId, tail: [] }
    if (run.state !== 'running') {
      return {
        state: run.state,
        ...(run.result === undefined ? {} : { result: run.result }),
        ...(run.error === undefined ? {} : { error: run.error }),
        tail: run.tail ?? [],
      }
    }
    if (Date.now() >= deadline) {
      return { state: 'running', tail: run.tail ?? [], error: '等超时了（还在跑）；可以稍后再查，或用 canvas_fn_list 看别的' }
    }
    await new Promise((r) => setTimeout(r, 120))
  }
}


