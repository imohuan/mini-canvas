/**
 * context —— 造脚本能拿到的那点「上下文」。
 *
 * ## 只给信息与环境，**不给命令**
 *
 * 这里刻意不提供 `ctx.ffmpeg` / `ctx.readFile` / `ctx.http` 这类东西 ——
 * 脚本要干活就用 Node 自带的模块自己写（`node:child_process` / `node:fs` / `fetch`）。
 * 若在这里替脚本封好命令，等于替它决定了"该怎么干活"，那它就只是填空、不是自定义脚本了。
 *
 * 于是 `ctx` 只有六样：
 *
 *   workspace   这次调用专属的空目录（随便写，跑完自动删）
 *   dir         这个脚本自己所在的目录（想 import 旁边的 lib/ 用）
 *   baseUrl     **后台自己的地址**（要回写画布 / 调画布接口时用它拼绝对地址）
 *   dataRoot    数据根目录（**兜底用**：ctx.save / ctx.file 已经在进程里实现，
 *               一般用不到它；留着是为了"脚本想自己算点什么"时有据可依）
 *   canvasId    谁在问
 *   nodeId      谁在问
 *   name        正在跑哪个脚本
 *   log(s)      往实时通道写一行
 *   signal      取消信号（AbortSignal）—— 用户点取消时脚本能自己收摊
 *
 * 前五样是**纯数据**，可以直接穿过进程边界；`log` / `signal` 在进程里现造（见 runner.ts）。
 */
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** 脚本能拿到的上下文（可序列化的那一半 + 进程内现造的那一半） */
export interface TaskContext {
  /** 本次调用专属的空目录 */
  workspace: string
  /** 脚本自己所在的目录 */
  dir: string
  /**
   * 数据根目录（`<根>/canvases`、`<根>/assets` 的上一级）。
   *
   * 为什么给：`ctx.file` 要靠它把"同源地址"翻成本地磁盘路径。脚本一般不直接用，
   * 但留一份在 ctx 里，出问题时能一眼看出"后台认为的资源根在哪"。
   */
  dataRoot: string
  /**
   * 后台自己的地址（形如 http://127.0.0.1:8865）。
   *
   * 为什么要有它（2026-10-13 补）：脚本跑完常要把结果交回画布 ——
   * 而"画布接口在哪"以前只能靠 ctx.dir 推数据根、再自己拼 URL
   * （用户的 video-grid.mjs 就是这么绕过去的，它的文件头还专门写了一段）。
   * 给了它，脚本就能直接 fetch(baseUrl + '/api/canvases/' + canvasId + '/resources?slot=' + nodeId)。
   */
  baseUrl: string
  canvasId: string
  nodeId: string
  name: string
  /** 往实时通道写一行 */
  log(s: string): void
  /** 取消信号 */
  signal: AbortSignal
}

/** 穿过进程边界的那一半（纯数据，结构化克隆能过） */
export interface TaskContextData {
  workspace: string
  dir: string
  baseUrl: string
  dataRoot: string
  canvasId: string
  nodeId: string
  name: string
}

/**
 * 建一个本次调用专属的工作目录。
 *
 * 为什么不直接在系统临时目录里裸写：脚本往哪儿写是它自己的事，但**我们得知道该删什么**。
 * 一次调用一个目录 → 跑完 `rm -rf` 这一个目录就完事，不留垃圾、也不用猜它写了什么。
 */
export async function createWorkspace(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'minicanvas-task-'))
}

/** 删掉工作目录（失败不抛：清了是好事，清不掉不该把这次调用的结果带崩） */
export async function removeWorkspace(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined)
}

/** 造「穿过进程边界」的那一半上下文 */
export function contextDataOf(input: {
  workspace: string
  scriptPath: string
  baseUrl: string
  dataRoot: string
  canvasId: string
  nodeId: string
  name: string
}): TaskContextData {
  return {
    workspace: input.workspace,
    dir: path.dirname(input.scriptPath),
    baseUrl: input.baseUrl,
    dataRoot: input.dataRoot,
    canvasId: input.canvasId,
    nodeId: input.nodeId,
    name: input.name,
  }
}
