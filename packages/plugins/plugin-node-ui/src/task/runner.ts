/**
 * runner —— 跑一个任务脚本：**一次调用 = 一个独立子进程**。
 *
 * ## 为什么不「在后台进程里 import 一下」
 *
 * 三条实测结论（Node v24 / Windows）：
 * 1. **ESM 缓存没有 API 能清**（官方原文：*there is currently no way to bypass the caching
 *    behavior*）。同一个进程里反复「重新执行」2000 次：内存涨 110MB 且一份都删不掉；
 *    带查询串"另开一份"只加不减。
 * 2. 独立进程用完即灭 → **改了脚本下次调用立刻生效**（不用重启服务、也不用加时间戳）。
 * 3. **取消收得干净**：杀整棵进程树时脚本自己拉起的 ffmpeg 一起收掉。实测"只杀脚本进程"时，
 *    若脚本是 detached 起的，ffmpeg 会变孤儿继续跑。
 *
 * ## 进程长什么样
 *
 * ```
 * node --input-type=module -e  <引导模块>  <上下文URL>  <脚本URL>
 *   ├─ import(上下文URL)    拿到函数名 / 参数 / ctx 数据
 *   ├─ import(脚本文件)     拿到导出
 *   └─ 调 fn(...args, ctx)  日志 / 进度 / 结果经 process.send 回主进程
 * ```
 *
 * 用 `stdio: [..., 'ipc']` + `process.send` 而不是 fork()：fork 的第二个参数是模块路径，
 * 没地方塞引导代码；而 `-e` 这条路实测能拿到 IPC 通道（子进程 stdout 也照样是流）。
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import type { TaskContextData } from './context.js'
import { removeWorkspace } from './context.js'

/** 默认超时（10 分钟：转码这类够用；到点连整棵树一起收） */
export const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000

/** 内存里最多留多少行输出（订阅来晚时的回放窗口） */
export const MAX_TAIL_LINES = 200

/** 跑完之后记录还留多久（页面刷新 / 断线重连回来还拿得到结果） */
export const KEEP_MS = 5 * 60 * 1000

/**
 * 引导模块：子进程里的入口。
 *
 * 三条都写对才跑得起来（都实测过）：
 * - `--input-type=module`：让 `-e` 的代码按 ES 模块解析（才能顶层 await）；
 * - 脚本用 **file: URL** import：走文件加载，脚本里的相对 import（`./lib/x.mjs`）正常；
 * - 结果与日志只走 `process.send`：协议通道干净，用户内容不混进去。
 *
 * 「函数不存在」的报错在这里就写清楚（带上可用的函数名）—— 脚本是用户写的，
 * 报错不给"可用的有哪些"，他只能猜自己写错了哪个字母。
 */
export const BOOTSTRAP = [
  "const [infoURL, scriptURL] = process.argv.slice(1)",
  "const info = await import(infoURL)",
  "const send = (msg) => { try { process.send && process.send(msg) } catch {} }",
  'const logLine = (s) => send({ type: "log", line: String(s) })',
  // —— 交给脚本的三个助手需要的内部件（都是 JS，不走 import：让引导保持零依赖）——
  'const fsp = (await import("node:fs")).default',
  'const pathMod = (await import("node:path")).default',
  "const resolvePath = (a, b) => pathMod.resolve(a, b)",
  // 扩展名 → MIME（后台白名单里那几种；认不出就 octet-stream，不猜）
  "const MIME = {",
  '  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",',
  '  ".webp": "image/webp", ".svg": "image/svg+xml", ".bmp": "image/bmp", ".avif": "image/avif",',
  '  ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime",',
  '  ".mp3": "audio/mpeg", ".wav": "audio/wav",',
  '  ".pdf": "application/pdf", ".txt": "text/plain", ".json": "application/json",',
  "}",
  'const guessMime = (ext) => MIME[String(ext).toLowerCase()] || "application/octet-stream"',
  // 地址 → 本地路径（与主进程侧 task/resolve.ts 同一套规则；
  // 子进程里拿不到那份模块，所以在这儿现写一遍 —— **规则改了要一起改**，有测试盯着）
  "const resolveLocalFile = (raw, env) => {",
  '  let s = String(raw || "").trim()',
  "  if (!s) return undefined",
  '  s = s.split("#")[0].split("?")[0]',
  "  try { if (/^[a-z][a-z0-9+.-]*:\\/\\//i.test(s)) s = new URL(s).pathname } catch {}",
  '  const root = env.dataRoot || ""',
  '  const canvasAt = s.indexOf("/api/canvases/")',
  "  if (canvasAt >= 0 && root) {",
  '    const rest = s.slice(canvasAt + 14).split("/")',
  '    if (rest.length >= 3 && rest[1] === "resources" && /^[A-Za-z0-9_-]{1,64}$/.test(rest[0])) {',
  '      const abs = pathMod.join(root, "canvases", rest[0], "resources", rest[2])',
  "      if (fsp.existsSync(abs)) return abs",
  "    }",
  "  }",
  '  const assetAt = s.indexOf("/api/assets/files/")',
  "  if (assetAt >= 0 && root) {",
  "    const name = s.slice(assetAt + 18)",
  "    if (/^[A-Za-z0-9._-]{1,128}$/.test(name)) {",
  '      const abs = pathMod.join(root, "assets", "files", name)',
  "      if (fsp.existsSync(abs)) return abs",
  "    }",
  "  }",
  '  const rel = s.replace(/^\\/+/, "")',
  '  if (!rel.includes("..")) {',
  "    for (const base of [env.workspace, env.dir, root]) {",
  "      if (!base) continue",
  "      const abs = pathMod.resolve(base, rel)",
  "      if (!abs.startsWith(pathMod.resolve(base) + pathMod.sep)) continue",
  "      if (fsp.existsSync(abs)) return abs",
  "    }",
  "  }",
  "  return undefined",
  "}",
  // 用户脚本里的 console.log 也变成一条日志（否则它直写 stdout，会绕开我们的协议）
  "const write = process.stdout.write.bind(process.stdout)",
  "process.stdout.write = (chunk, enc, cb) => {",
  "  logLine(chunk)",
  '  if (typeof enc === "function") enc()',
  "  else if (cb) cb()",
  "  return true",
  "}",
  "const main = async () => {",
  "  const mod = await import(scriptURL)",
  "  const fn = mod[info.methods]",
  '  if (typeof fn !== "function") {',
  '    const names = Object.keys(mod).filter((k) => typeof mod[k] === "function").sort()',
  '    throw new Error("\u811A\u672C " + info.name + " \u91CC\u6CA1\u6709\u5BFC\u51FA\u51FD\u6570 " + info.methods +',
  '      (names.length ? "\uFF08\u53EF\u7528\u7684\uFF1A" + names.join("\u3001") + "\uFF09" : "\uFF08\u8FD9\u4E2A\u811A\u672C\u4E00\u4E2A\u51FD\u6570\u90FD\u6CA1\u5BFC\u51FA\uFF09"))',
  "  }",
  "  const aborter = new AbortController()",
  '  process.on("message", (m) => { if (m && m.type === "cancel") aborter.abort() })',
  "  const ctx = Object.assign({}, info.ctx, {",
  "    log: logLine,",
  "    signal: aborter.signal,",
  '    progress: (v) => send({ type: "progress", value: Number(v) || 0 }),',
  // ── 交产物：脚本算出来的东西落回**本节点自己的槽位**（同址覆盖，下游随之更新）──
  //    把"拼地址、猜扩展名、写 content-type"三件小事全吃掉 —— 以前每个脚本各写一遍，必漏。
  "    save: async (data, name, opts) => {",
  '      const bytes = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data)',
  '      const fileName = String(name || "out.bin")',
  '      const dot = fileName.lastIndexOf(".")',
  '      const ext = dot >= 0 ? fileName.slice(dot) : ""',
  "      const slot = (opts && opts.slot) ? String(opts.slot) : info.ctx.nodeId",
  '      if (!info.ctx.baseUrl) throw new Error("\u62FF\u4E0D\u5230\u540E\u53F0\u5730\u5740\uFF08ctx.baseUrl \u4E3A\u7A7A\uFF09\uFF0C\u65E0\u6CD5\u4FDD\u5B58\u4EA7\u7269")',
  '      const to = info.ctx.baseUrl + "/api/canvases/" + encodeURIComponent(info.ctx.canvasId) +',
  '        "/resources?slot=" + encodeURIComponent(slot) + (ext ? "&name=" + encodeURIComponent(fileName) : "")',
  "      const type = (opts && opts.mime) || guessMime(ext)",
  '      const r = await fetch(to, { method: "POST", headers: { "content-type": type }, body: bytes })',
  "      const j = await r.json().catch(() => null)",
  '      if (!j || !j.ok) throw new Error("\u4FDD\u5B58\u4EA7\u7269\u5931\u8D25\uFF1A" + ((j && j.error) || r.status))',
  // 顺手把**节点字段**写上（imageUrl / videoUrl / audioUrl / text）：下游是按字段名认类型的。
  // 走**增量口**（POST /api/canvases/:id/nodes）而不是让宿主代写：
  //   ① 并发交产物由后台那把写锁串起来，不会各读各的旧值再互相覆盖；
  //   ② 非默认画布同样能写（宿主直连的那份 doc 只管默认画布）。
  //
  // 只在「落到本节点自己的槽位」时写：显式存到别的槽位不是本节点的产物，宿主不该替它改。
  "      if (!(opts && opts.slot) || opts.slot === info.ctx.nodeId) {",
  "        const field = ext === \".mp4\" || ext === \".webm\" || ext === \".mov\" ? \"videoUrl\"",
  "          : ext === \".mp3\" || ext === \".wav\" || ext === \".ogg\" || ext === \".m4a\" ? \"audioUrl\"",
  "          : ext === \".txt\" || ext === \".md\" || ext === \".json\" || ext === \".csv\" ? \"text\" : \"imageUrl\"",
  // 槽位地址不变（一个节点一份文件），字段里带 ?v= 让下游知道"内容换了，重新取"
  "        const versioned = j.url + (j.url.indexOf(\"?\") >= 0 ? \"&v=\" : \"?v=\") + Date.now()",
  "        const patch = { uiOutputUrl: j.url }",
  // 文本给的是**正文**（下游 data.text 的约定就是内容，不是地址 —— 文本节点一直如此）。
  // 交字节也认得出来：按 UTF-8 解一次（把地址当正文写进去更糟）。
  "        if (field === \"text\") patch.text = typeof data === \"string\" ? data : new TextDecoder().decode(bytes)",
  "        else patch[field] = versioned",
  "        const r2 = await fetch(info.ctx.baseUrl + \"/api/canvases/\" + encodeURIComponent(info.ctx.canvasId) + \"/nodes\", {",
  "          method: \"POST\", headers: { \"content-type\": \"application/json\" },",
  "          body: JSON.stringify({ update: [{ id: info.ctx.nodeId, data: patch }] }) })",
  "        if (!r2.ok) logLine(\"产物已存，但写节点字段没成功（HTTP \" + r2.status + \"）\")",
  "      }",
  '      logLine("\u4EA7\u7269\u5DF2\u4FDD\u5B58\uFF1A" + j.url)',
  "      return { ok: true, url: j.url, bytes: bytes.length }",
  "    },",
  // ── 地址 → 本地路径：喂给 ffmpeg 这类命令（读本地文件最快最稳）──
  "    file: (raw) => resolveLocalFile(String(raw), info.ctx) || String(raw),",
  // ── 工作目录里的一个路径（"中间文件该写哪"）──
  '    temp: (name) => resolvePath(info.ctx.workspace || ".", String(name || "tmp")),',
  "  })",
  "  const result = await fn(...(info.args || []), ctx)",
  '  send({ type: "done", result: result === undefined ? null : result })',
  "}",
  "main().catch((err) => {",
  '  send({ type: "error", message: String((err && err.message) || err) })',
  "  process.exitCode = 1",
  "})"
].join("\n")

/** 一次运行的对外状态 */
export interface TaskRun {
  runId: string
  canvasId: string
  nodeId: string
  name: string
  methods: string
  state: 'running' | 'done' | 'error' | 'cancelled'
  tail: string[]
  progress?: number
  result?: unknown
  error?: string
  startedAt: number
  finishedAt?: number
}

/** 一条事件（SSE 的帧就是它） */
export type TaskEvent =
  | { type: 'log'; line: string }
  | { type: 'progress'; value: number }
  | { type: 'done'; result: unknown }
  | { type: 'error'; message: string }
  | { type: 'cancelled' }

export interface StartRunInput {
  /** 脚本绝对路径（已过白名单，见 scripts.ts） */
  scriptPath: string
  name: string
  methods: string
  args: unknown[]
  canvasId: string
  nodeId: string
  /** 上下文里可序列化的那一半（见 context.ts） */
  contextData: TaskContextData
  timeoutMs?: number
  /** 每有一个新事件就叫一下（路由层据此唤醒 SSE 的等待） */
  onEvent?: (runId: string, e: TaskEvent) => void
  /** 跑完（无论成败）调一次 */
  onFinish?: (run: TaskRun) => void
}

/** 记录的增删查：路由层只经这个接口，不自己摸内部表 */
export interface TaskRuns {
  start(input: StartRunInput): TaskRun
  get(runId: unknown): TaskRun | undefined
  /** 取消（杀整棵树）；返回这次是否真的动到了手 */
  cancel(runId: unknown): boolean
  /** 现在还有几个在跑 */
  runningCount(): number
  /** 停掉全部（服务关停用）；await 到进程都退干净 */
  dispose(): Promise<void>
}

interface LiveRun {
  info: TaskRun
  child: ChildProcess
  workspace: string
  timer: ReturnType<typeof setTimeout>
  /** 已经终态过就不再被 close 覆盖（取消之后 close 也会来） */
  settled: boolean
  /** 起这次运行的入参（终态时要用它的 onEvent / onFinish） */
  input: StartRunInput
}

/**
 * 杀整棵进程树。
 *
 * 为什么不是 `child.kill()`：那只会收掉脚本进程本身，脚本自己拉起的 ffmpeg 可能留下
 * （实测：detached 起的子进程在父进程被杀后仍在跑）。Windows 用 `taskkill /T /F`，
 * 其它平台把子进程放进自己的进程组、杀负号那个组。
 */
export function killTree(child: ChildProcess): void {
  const pid = child.pid
  if (!pid) return
  try {
    if (process.platform === 'win32') {
      // 同步调用：取消路径上不能是"发出去就不管了"
      spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' })
      return
    }
    process.kill(-pid, 'SIGKILL')
  } catch {
    // 已经退了 / 权限不够：退回到单进程 kill，至少把脚本自己收掉
    try {
      child.kill('SIGKILL')
    } catch {
      console.warn('[node-ui] 收不掉任务进程 pid=' + pid)
    }
  }
}

export function createTaskRuns(opts: { timeoutMs?: number } = {}): TaskRuns {
  const live = new Map<string, LiveRun>()
  /** 跑完的记录（留 KEEP_MS，供刷新后回来取） */
  const finished = new Map<string, TaskRun>()
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS

  function remember(run: TaskRun): void {
    finished.set(run.runId, run)
    // 顺手清过期的：不开定时器（量本来就小，一次调用清一遍就够）
    const now = Date.now()
    for (const [id, rec] of finished) {
      if (now - (rec.finishedAt ?? now) > KEEP_MS) finished.delete(id)
    }
  }

  function emit(l: LiveRun, e: TaskEvent): void {
    if (e.type === 'log') {
      l.info.tail.push(e.line)
      if (l.info.tail.length > MAX_TAIL_LINES) l.info.tail.splice(0, l.info.tail.length - MAX_TAIL_LINES)
    } else if (e.type === 'progress') {
      l.info.progress = e.value
    }
    l.input.onEvent?.(l.info.runId, e)
  }

  function settle(l: LiveRun, e: TaskEvent): void {
    if (l.settled) return
    l.settled = true
    clearTimeout(l.timer)
    if (e.type === 'done') {
      l.info.state = 'done'
      l.info.result = e.result
    } else if (e.type === 'error') {
      l.info.state = 'error'
      l.info.error = e.message
    } else {
      l.info.state = 'cancelled'
    }
    l.info.finishedAt = Date.now()
    live.delete(l.info.runId)
    remember(l.info)
    // 工作目录随这次调用一起收掉（不 await：别让清盘拖住事件交付）
    void removeWorkspace(l.workspace)
    l.input.onEvent?.(l.info.runId, e)
    l.input.onFinish?.(l.info)
  }

  return {
    start(input) {
      const runId = randomUUID() // ★ 猜不到的随机串：拿到它才能看/能取消，自增数字等于送人
      const info: TaskRun = {
        runId,
        canvasId: input.canvasId,
        nodeId: input.nodeId,
        name: input.name,
        methods: input.methods,
        state: 'running',
        tail: [],
        startedAt: Date.now(),
      }

      // 上下文（函数名 / 参数 / ctx 数据）塞进一条 data: URL 模块，子进程 import 它就有了。
      // 为什么不走环境变量或命令行：参数可能是结构化数据（对象/数组），只有这条能原样过去。
      const infoURL =
        'data:text/javascript,' +
        encodeURIComponent(
          'export const methods = ' + JSON.stringify(String(input.methods)) + '\n' +
            'export const name = ' + JSON.stringify(String(input.name)) + '\n' +
            'export const args = ' + JSON.stringify(input.args ?? []) + '\n' +
            'export const ctx = ' + JSON.stringify(input.contextData) + '\n',
        )

      const child = spawn(
        process.execPath,
        ['--input-type=module', '-e', BOOTSTRAP, infoURL, pathToFileURL(input.scriptPath).href],
        {
          // detached：让子进程自成一个进程组（非 Windows），取消时能整组收掉
          detached: process.platform !== 'win32',
          stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
          windowsHide: true,
        },
      )

      const l: LiveRun = {
        info,
        child,
        workspace: input.contextData.workspace,
        timer: undefined as never,
        settled: false,
        input,
      }
      live.set(runId, l)

      /** 子进程自己写出来的东西（未捕获异常、语法错误这类）也当日志带出去 */
      const relay = (chunk: unknown): void => {
        const text = String(chunk)
        if (!text.trim()) return
        emit(l, { type: 'log', line: text })
      }
      child.stdout?.on('data', relay)
      child.stderr?.on('data', relay)

      child.on('message', (raw) => {
        const e = raw as TaskEvent
        if (!e || typeof e !== 'object' || typeof e.type !== 'string') return
        if (e.type === 'done' || e.type === 'error') settle(l, e)
        else emit(l, e)
      })

      // 进程没了但还没终态（被外部杀掉、自己 assert 崩了）→ 收成 error，别让它永远 running
      child.on('close', (code) => {
        if (!l.settled) {
          settle(l, { type: 'error', message: '脚本进程结束但没给结果（退出码 ' + String(code) + '）' })
        }
      })
      child.on('error', (err) => {
        settle(l, { type: 'error', message: '起不了脚本进程：' + err.message })
      })

      l.timer = setTimeout(() => {
        killTree(child)
        settle(l, { type: 'error', message: '跑超时了（超过 ' + Math.round(timeoutMs / 1000) + ' 秒）' })
      }, input.timeoutMs ?? timeoutMs)

      return info
    },

    get(runId) {
      if (typeof runId !== 'string' || !runId) return undefined
      return live.get(runId)?.info ?? finished.get(runId)
    },

    cancel(runId) {
      if (typeof runId !== 'string' || !runId) return false
      const l = live.get(runId)
      if (!l) return false
      // 先给脚本一个自己收摊的机会（它可能要把 ffmpeg 收干净），再杀整棵树
      try {
        l.child.send({ type: 'cancel' })
      } catch {
        /* 通道已关：直接走下面的杀 */
      }
      killTree(l.child)
      settle(l, { type: 'cancelled' })
      return true
    },

    runningCount() {
      return live.size
    },

    async dispose() {
      const all = [...live.values()]
      for (const l of all) {
        clearTimeout(l.timer)
        killTree(l.child)
        live.delete(l.info.runId)
      }
      for (const l of all) await removeWorkspace(l.workspace)
    },
  }
}

