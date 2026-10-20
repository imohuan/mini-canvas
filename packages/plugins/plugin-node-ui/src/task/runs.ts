/**
 * runs —— task 的「对外面」：把 scripts / context / runner 三块拼成一件能用的东西。
 *
 * ## 为什么单独一个文件
 *
 * server.ts 是**外挂后台插件**（打成单文件丢进 server-plugins，运行期 import）。
 * 它要"随时取到那张运行表"，而运行表必须是**模块级单例**（同一个后台进程里只能有一张）。
 * 所以：
 * - 模块级 `let` 把实例挂住，`getTaskRuns()` 永远返回同一个；
 * - server.ts 的 `apply` 里调一次 `configureTaskRuns({ dir })`（脚本目录由服务给），
 *   路由层再取 `getTaskRuns()`。测试也走同一条路，不必自己 new。
 */
import { isDraftScriptName, listAllScriptNames, listScriptNames, resolveScriptPath } from './scripts.js'
import { contextDataOf, createWorkspace } from './context.js'
import { createTaskRuns, type TaskRuns, type TaskRun, type TaskEvent } from './runner.js'
import { inspectScript } from './inspect.js'
import { mergeFunctions, normalizeScriptDocs, type FnSummary } from './fnDoc.js'

export interface TaskRunsConfig {
  /** task-scripts 目录（数据根下） */
  dir: string
  /** 单次调用超时（毫秒；缺省见 runner.DEFAULT_TIMEOUT_MS） */
  timeoutMs?: number
}

let instance: TaskRuns | undefined
let config: TaskRunsConfig | undefined

/** 装配（server.ts 的 apply 里调一次；重复调只换配置，不换运行表） */
export function configureTaskRuns(next: TaskRunsConfig): TaskRuns {
  config = next
  instance ??= createTaskRuns(next.timeoutMs === undefined ? {} : { timeoutMs: next.timeoutMs })
  return instance
}

/** 取运行表；没装配过也能用（测试里常见） */
export function getTaskRuns(): TaskRuns {
  instance ??= createTaskRuns({})
  return instance
}

/** 当前脚本目录（诊断用） */
export function taskScriptsDir(): string | undefined {
  return config?.dir
}

/** list 的一条：脚本名 + 它导出了哪些函数 */
export interface ScriptInfo {
  name: string
  methods: string[]
}

/**
 * 列脚本（名字 + 每个脚本导出的函数）。
 *
 * 「有哪些函数」走 `inspect.ts`（**子进程里问**）：主进程一次都不加载用户脚本。
 * 为什么不在主进程 import：用户脚本可能建连接/改全局，而且 ESM 缓存清不掉（越用越涨），
 * 实测在测试运行器里那条路还会直接失败。
 */
export async function listScripts(dir: string): Promise<ScriptInfo[]> {
  const names = await listScriptNames(dir)
  const out: ScriptInfo[] = []
  for (const name of names) {
    const abs = resolveScriptPath(dir, name)
    if (!abs) continue
    const r = await inspectScript(abs)
    out.push({ name, methods: r.methods })
  }
  return out
}

/** 某个脚本导出了哪些函数（脚本不存在 / 加载失败 → undefined） */
export async function scriptMethods(dir: string, name: unknown): Promise<string[] | undefined> {
  const abs = resolveScriptPath(dir, name)
  if (!abs) return undefined
  const r = await inspectScript(abs)
  return r.ok ? r.methods : undefined
}

/** 一个脚本的**说明书**（作者写的 `export const docs`；没写 / 读不到 → 空对象） */
export async function scriptDocs(dir: string, name: unknown): Promise<ReturnType<typeof normalizeScriptDocs>> {
  const abs = resolveScriptPath(dir, name)
  if (!abs) return {}
  const r = await inspectScript(abs)
  return r.ok ? normalizeScriptDocs(r.docs) : {}
}

/**
 * 列出这台机器上**所有能调的功能函数**（脚本名 × 函数名 × 说明书）。
 *
 * 这是用户点名要的那条「列出所有功能函数」：
 * 「可发现：列出所有插件功能、服务函数、可视化节点、后台函数」。
 * 名字以**真实导出**为准，说明书是作者顺手写的补充（没写也列出来）。
 *
 * ⚠️ **只列已验证的脚本**（文件名不带下划线打头）—— 用户口径 2026-10-14：
 * 在建的脚本（`_名字.mjs`）不进这份清单，免得别人（和别的 Agent）拿去做半成品试验。
 * 在建的那些去哪看：`listDraftScripts`（作者自己要调试时用）。
 */
export async function listFunctions(dir: string): Promise<FnSummary[]> {
  const names = await listScriptNames(dir)
  const out: FnSummary[] = []
  for (const name of names) {
    const abs = resolveScriptPath(dir, name)
    if (!abs) continue
    const r = await inspectScript(abs)
    if (!r.ok) continue
    out.push(...mergeFunctions(name, r.methods, normalizeScriptDocs(r.docs)))
  }
  return out
}

/** 在建脚本（下划线打头）的名字 + 它们导出了哪些函数 */
export interface DraftScriptInfo {
  name: string
  methods: string[]
}

/**
 * 列出**在建**脚本（`_名字.mjs`）。
 *
 * 为什么不并进 listFunctions：那是"给别人用"的清单，在建品混进去正是生产环境踩到的坑
 * （半成品 / 老 API 被误当可用）。这里单独列，是留给"作者想看看自己还有哪些没验完"的场景。
 */
export async function listDraftScripts(dir: string): Promise<DraftScriptInfo[]> {
  const all = await listAllScriptNames(dir)
  const out: DraftScriptInfo[] = []
  for (const name of all) {
    if (!isDraftScriptName(name)) continue
    const abs = resolveScriptPath(dir, name)
    if (!abs) continue
    const r = await inspectScript(abs)
    out.push({ name, methods: r.ok ? r.methods : [] })
  }
  return out
}

export interface RunScriptInput {
  dir: string
  name: unknown
  methods: unknown
  args: unknown[]
  /** 后台自己的地址（写进 ctx.baseUrl，供脚本回写画布） */
  baseUrl: string
  /** 数据根目录（写进 ctx.dataRoot，供 ctx.file 把同源地址翻成本地路径） */
  dataRoot: string
  canvasId: string
  nodeId: string
  /** 只允许写本节点槽位 / 本节点的短时令牌（由宿主签发；拿不到就空串） */
  taskToken?: string
  timeoutMs?: number
  onEvent?: (runId: string, e: TaskEvent) => void
  onFinish?: (run: TaskRun) => void
}

export type RunScriptResult = { ok: true; run: TaskRun } | { ok: false; error: string }

/**
 * 起一次调用。
 *
 * 校验顺序有讲究：**先挡名字**（路径穿越），再看参数形状，最后才起进程 ——
 * 别让一个非法名字把进程也拉起来。
 */
export async function runScript(input: RunScriptInput): Promise<RunScriptResult> {
  const abs = resolveScriptPath(input.dir, input.name)
  if (!abs) {
    return {
      ok: false,
      error: '非法脚本名：' + String(input.name) + '（只允许字母数字下划线连字符，1-64 位）',
    }
  }
  const methods = typeof input.methods === 'string' ? input.methods : ''
  if (!methods) return { ok: false, error: '缺少 methods（要调的函数名）' }
  if (!Array.isArray(input.args)) return { ok: false, error: 'args 必须是数组' }

  // 工作目录先建好（子进程要用它）
  const workspace = await createWorkspace()
  const run = getTaskRuns().start({
    scriptPath: abs,
    name: String(input.name),
    methods,
    args: input.args,
    canvasId: input.canvasId,
    nodeId: input.nodeId,
    contextData: contextDataOf({
      workspace,
      scriptPath: abs,
      baseUrl: input.baseUrl,
      dataRoot: input.dataRoot,
      canvasId: input.canvasId,
      nodeId: input.nodeId,
      name: String(input.name),
      taskToken: input.taskToken ?? '',
    }),
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
    ...(input.onEvent ? { onEvent: input.onEvent } : {}),
    ...(input.onFinish ? { onFinish: input.onFinish } : {}),
  })
  return { ok: true, run }
}
