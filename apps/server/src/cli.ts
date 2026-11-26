#!/usr/bin/env node
/**
 * plume-canvas CLI —— `npx plume-canvas serve` 的入口。
 *
 * 命令名就叫 `plume-canvas`：本包（cloud-server）是唯一的主启动入口。
 *
 * 做的事：解析参数 → 起 cloud-server → 打印访问地址与数据落点 → 打印外部插件条数。
 * 端口被占用时直接报错（用户口径 2026-11-22）：顺延端口会让页面/代理对不上号，宁可报错。
 */
import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import fsSync from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCloudServer, DEFAULT_DATA_DIR, DEFAULT_PORT } from './server.js'
import { packagedPluginsDir } from './static.js'
import { buildPluginCatalog } from './plugins/catalog.js'
import { resolvePluginRoots } from './plugins/pluginRoots.js'
import { BUILTIN_PLUGINS, FIRST_INSTALL_DIRS } from './plugins/builtinPlugins.js'
import {
  clearServerState,
  describePort,
  isPortBusy as isTcpPortBusy,
  isProcessAlive,
  isPlumeServerCommand,
  readServerState,
  serverLogFile,
  stopServer,
  writeServerState,
} from './serviceControl.js'

interface CliOptions {
  /** 子命令（缺省 serve） */
  command: 'serve' | 'start' | 'stop' | 'status' | 'restart' | 'logs' | 'list-tools' | 'audit-verify'
  port: number
  portExplicit: boolean
  dir: string
  hostname: string
  ui?: string
  plugins?: string
  providers?: string
  open: boolean
  /** 跳过启动初始化的全部联网步骤（装插件/装 UI/查更新） */
  offline: boolean
  /** 是否提供 MCP 接口（缺省开） */
  mcp: boolean
  /** 关闭管理令牌鉴权（必须配合 PLUME_ALLOW_INSECURE=1） */
  noAdminAuth: boolean
  /** 额外信任的 Host（可重复） */
  trustedHosts: string[]
  /** 额外信任的 Origin（可重复） */
  trustedOrigins: string[]
  /** stop 时连同「看起来不像 plume-canvas」的进程也关掉 */
  force: boolean
  /** logs 显示多少行 */
  lines: number
}

const HELP = `plume-canvas —— 自托管画布服务

用法:
  plume-canvas serve [选项]      在前台起服务（占着终端，Ctrl+C 停止）
  plume-canvas start [选项]      在后台起服务（命令立刻返回，终端可以继续用）
  plume-canvas stop [选项]       关掉后台/前台正在跑的服务
  plume-canvas status            看服务在不在、端口是谁占的
  plume-canvas restart [选项]    先 stop 再 start
  plume-canvas logs              看后台服务的日志（默认最后 40 行）
  plume-canvas list-tools        列出 MCP 暴露的工具
  plume-canvas --help            看这份帮助
  plume-canvas --version         看版本
  plume-canvas audit-verify      校验 <数据目录>/audit.log 的 hash 链（不开服务）

选项:
  -p, --port <号>     监听端口（默认 ${DEFAULT_PORT}；被占用时报错，不自动换）
  -d, --dir <目录>    数据目录（默认 ${DEFAULT_DATA_DIR}，固定在用户主目录，不跟启动目录走）
      --host <地址>   监听地址（默认 127.0.0.1，只本机可访问）
      --ui <目录>     画布界面产物目录（默认自动探测 apps/web/dist）
      --plugins <目录> 插件目录（默认自动探测 packages/plugins）
      --providers <目录> 平台提供方目录（后台的"投递箱"；默认 <数据目录>/providers）
      --no-mcp        不提供 MCP 接口（默认提供）
      --no-admin-auth 关闭管理令牌与来源边界（**必须**同时设 PLUME_ALLOW_INSECURE=1）
      --trusted-host <host:port>   额外信任的 Host（反代 / 另一个主机名；可重复）
      --trusted-origin <origin>    额外信任的 Origin（如 dev 的 http://localhost:5288；可重复）
      --open          启动后自动打开浏览器（可选；默认不打开）
      --no-open       不自动打开浏览器（默认行为，保留给旧脚本）
stop 选项:
      --force         端口被别的程序占用时也结束它（默认只关自己人）

logs 选项:
      --lines <行数>  显示最后多少行（默认 40）

启动后（网页与 MCP 共用一个服务、一份数据）:
  http://127.0.0.1:<端口>/            画布界面
  http://127.0.0.1:<端口>/mcp          MCP 接口（Streamable HTTP，配置给 AI 客户端）
  GET|PUT|DELETE /api/kv/:type/:key   设置 / 快捷这类小数据（画布数据不在这里）
  GET|PUT /api/canvases/:id           画布本体（节点 + 边）与视口
  POST/GET /api/canvases/:id/resources/:name   画布资源上传与回读
  GET /api/actions                    动作清单（前端菜单来源；后台加平台即多一项）
  POST /api/jobs · GET /api/jobs/:id · POST /api/jobs/:id/cancel   任务下单 / 查单 / 撤单
  GET /api/history                    生成历史（分页 + 汇总）
  GET /plugin-manifest.json           外部插件清单
`

/** 解析参数；遇到 --help/--version 直接打印退出 */
async function parseArgs(argv: string[]): Promise<CliOptions> {
  const args = argv.slice(2)
  /** 子命令（先记下、解析完参数再执行） */
  let subcommand: CliOptions['command'] | undefined
  const opts: CliOptions = {
    command: 'serve',
    port: Number(process.env.PLUME_PORT ?? '') || DEFAULT_PORT,
    portExplicit: false,
    dir: DEFAULT_DATA_DIR,
    hostname: '127.0.0.1',
    // 启动服务时不要自动弹浏览器：由人或代理手动打开页面（用户 2026-10-30 明确要求）
    open: false,
    offline: false,
    mcp: true,
    noAdminAuth: false,
    trustedHosts: [],
    trustedOrigins: [],
    force: false,
    lines: 40,
  }

  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    // 取值型选项：缺值直接报错（比"悄悄用默认值"好排查）
    const takeValue = (name: string): string => {
      const v = args[++i]
      if (v === undefined || v.startsWith('-')) throw new Error(`${name} 后面缺少值`)
      return v
    }
    if (
      a === 'serve' ||
      a === 'start' ||
      a === 'stop' ||
      a === 'status' ||
      a === 'restart' ||
      a === 'logs' ||
      a === 'list-tools' ||
      a === 'audit-verify'
    ) {
      // 子命令只记下、**继续解析后面的参数**（`stop --port 8865` 这种写法很常见）。
      // 两个不同子命令同时给就报错，免得后一个把前一个静默覆盖。
      if (subcommand && subcommand !== a) {
        throw new Error(`子命令 ${subcommand} 与 ${a} 不能同时使用（一次只做一件事）`)
      }
      subcommand = a
    }
    else if (a === '-p' || a === '--port') {
      const v = Number(takeValue(a))
      if (!Number.isInteger(v) || v < 0 || v > 65535) throw new Error(`端口不合法: ${v}`)
      opts.port = v
      opts.portExplicit = true
    } else if (a === '-d' || a === '--dir') opts.dir = takeValue(a)
    else if (a === '--host' || a === '--hostname') opts.hostname = takeValue(a)
    else if (a === '--ui') opts.ui = takeValue(a)
    else if (a === '--plugins') opts.plugins = takeValue(a)
    else if (a === '--providers') opts.providers = takeValue(a)
    else if (a === '--mcp') opts.mcp = true
    else if (a === '--no-mcp') opts.mcp = false
    else if (a === '--no-admin-auth') opts.noAdminAuth = true
    else if (a === '--trusted-host') opts.trustedHosts.push(takeValue(a))
    else if (a === '--trusted-origin') opts.trustedOrigins.push(takeValue(a))
    else if (a === '--open') opts.open = true
    else if (a === '--no-open') opts.open = false
    else if (a === '--offline') opts.offline = true
    else if (a === '--force' || a === '-f') opts.force = true
    else if (a === '--lines' || a === '-n') {
      const v = Number(takeValue(a))
      if (!Number.isInteger(v) || v < 1) throw new Error(`--lines 需要正整数，收到: ${v}`)
      opts.lines = v
    }
    else if (a === '-y' || a === '--yes') {
      // 兼容 npx 交互确认习惯（用户 2026-11-21 报「未知参数: -y」）：
      // 本 CLI 无交互提示，这个参数只是被 npx 提示语带出来的习惯写法，接受并忽略。
      continue
    }
    else if (a === '-h' || a === '--help') {
      console.log(HELP)
      process.exit(0)
    } else if (a === '-v' || a === '--version') {
      console.log(await readVersion())
      process.exit(0)
    } else {
      throw new Error(`未知参数: ${a}（--help 看用法）`)
    }
  }

  opts.command = subcommand ?? 'serve'

  if (subcommand === 'audit-verify') {
    // 只读日志、不开服务：让「链有没有断」不用手算 sha256
    const { createAuditLog } = await import('./audit.js')
    const target = path.join(path.resolve(opts.dir), 'audit.log')
    const verdict = await createAuditLog(target).verify()
    if (verdict.ok) {
      console.log('审计链完整：' + target)
      process.exit(0)
    }
    console.error('审计链在第 ' + verdict.line + ' 行断裂：' + verdict.reason)
    console.error(target)
    process.exit(1)
  }

  if (subcommand === 'list-tools') {
      // 打印 MCP 工具面（不启服务）—— 配 AI 客户端前先看它能干什么
      //
      // ⚠️ 这里**只列内置的工具**。插件注册的工具（ctx.mcp）是运行期才有的，
      //    本命令不启服务就看不到它们 —— 所以下面会明说一句，别让人以为"没有那些工具"
      //    就是代码没写（审查实测踩到过：配 AI 客户端前拿这个自检，被骗着去翻源码）。
      //    真要核对全量，就查运行中的服务（下面的提示给了确切做法）。
      const { listTools } = await import('./mcp/server.js')
      const builtin = listTools()
      console.log('MCP 暴露的工具（**只含内置**）:')
      for (const t of builtin) console.log(`  - ${t.name}: ${t.description}`)
      console.log(
        `\n共 ${builtin.length} 个内置工具。\n` +
          '插件注册的工具（如 canvas_ui_* / canvas_fn_*）**不在这里**：它们是运行期才注册的。\n' +
          '要核对全量，查运行中的服务（下面的 <端口> 换成实际端口）：\n' +
          '  curl -s -X POST http://127.0.0.1:<端口>/mcp \\' +
          '\n    -H "content-type: application/json" -H "accept: application/json, text/event-stream" \\' +
          '\n    -d \'{"jsonrpc":"2.0","id":1,"method":"tools/list"}\'',
      )
    process.exit(0)
  }
  return opts
}


/** 版本号取自本包 package.json（dist/cli.js 的上两级） */
async function readVersion(): Promise<string> {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url))
    const raw = await fs.readFile(path.join(here, '..', 'package.json'), 'utf8')
    return (JSON.parse(raw) as { version?: string }).version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
}

/** 监听失败是不是「端口被占」（EADDRINUSE） */
function isAddrInUse(err: unknown): boolean {
  return (err as NodeJS.ErrnoException | undefined)?.code === 'EADDRINUSE'
}

/**
 * 起服务。
 * 端口被占用直接报错（用户口径 2026-11-22：顺延端口会让"以为起了 8865 其实起了 8866"，
 * 页面/代理/脚本全对不上号）。想换端口用 --port 显式指定。
 */
async function startWithPortFallback(opts: CliOptions) {
  // 关鉴权必须显式二次确认：裸跑等于把「装插件 / 执行脚本 / 改画布」的入口对外开放。
  if (opts.noAdminAuth && process.env.PLUME_ALLOW_INSECURE !== '1') {
    throw new Error(
      '--no-admin-auth 需要同时设置环境变量 PLUME_ALLOW_INSECURE=1。\n' +
        '这是有意的二次确认：关掉之后任何网页都能装插件、跑脚本、改画布。',
    )
  }
  const srv = await createCloudServer({
    port: opts.port,
    dir: opts.dir,
    hostname: opts.hostname,
    ...(opts.ui ? { uiDist: opts.ui } : {}),
    ...(opts.plugins ? { pluginsDir: opts.plugins } : {}),
    ...(opts.providers ? { providersDir: opts.providers } : {}),
    ...(opts.noAdminAuth ? { adminAuth: false } : {}),
    ...(opts.trustedHosts.length ? { trustedHosts: opts.trustedHosts } : {}),
    ...(opts.trustedOrigins.length ? { trustedOrigins: opts.trustedOrigins } : {}),
    mcp: opts.mcp,
  })
  try {
    const info = await srv.start()
    return { srv, info, portChanged: false }
  } catch (err) {
    srv.stop()
    if (isAddrInUse(err)) {
      throw new Error(portBusyMessage(opts.port))
    }
    throw err
  }
}

/**
 * 端口冲突时的说明。
 *
 * 用户 2026-11-26 的要求：把「怎么关掉它」直接写在报错最后，
 * 而不是让人自己去找任务管理器或翻文档。
 */
function portBusyMessage(port: number): string {
  return (
    `端口 ${port} 已被占用。\n` +
    `  · 先看是谁占着：npx plume-canvas status\n` +
    `  · 关掉之前起的 plume-canvas：npx plume-canvas stop\n` +
    `  · 占用者是别的程序：npx plume-canvas stop --force  （会结束占用该端口的进程）\n` +
    `  · 或者换端口：npx plume-canvas serve --port ${port + 1}`
  )
}

/** 把当前选项还原成子进程的命令行参数（start / restart 用） */
function serveArgsOf(opts: CliOptions): string[] {
  const args = ['serve', '-p', String(opts.port), '-d', opts.dir, '--host', opts.hostname]
  if (opts.ui) args.push('--ui', opts.ui)
  if (opts.plugins) args.push('--plugins', opts.plugins)
  if (opts.providers) args.push('--providers', opts.providers)
  if (!opts.mcp) args.push('--no-mcp')
  if (opts.noAdminAuth) args.push('--no-admin-auth')
  for (const host of opts.trustedHosts) args.push('--trusted-host', host)
  for (const origin of opts.trustedOrigins) args.push('--trusted-origin', origin)
  if (opts.offline) args.push('--offline')
  args.push(opts.open ? '--open' : '--no-open')
  return args
}

/**
 * 重新启动自己：开发态（tsx）与发布态（node dist/cli.js）都要能跑。
 *
 * 直接复用 `process.execPath + process.execArgv + process.argv[1]`：
 * 这样 tsx 的 --import loader、npx 的临时安装目录都原样带过去，不必猜。
 */
function spawnSelf(args: string[], options: import('node:child_process').SpawnOptions): import('node:child_process').ChildProcess {
  const entry = process.argv[1]
  if (!entry) throw new Error('拿不到当前脚本路径（process.argv[1] 为空）')
  return spawn(process.execPath, [...process.execArgv, entry, ...args], options)
}

function printEndpoint(url: string): void {
  console.log('')
  console.log('  plume-canvas 已启动')
  console.log('')
  console.log(`  画布   ${url}/`)
}

/**
 * 给用户抄的 stop 命令：数据目录不是默认值时要把 -d 带上，
 * 否则用户在自己终端里敲一条 `stop`，认的是默认目录，找不到这个服务。
 */
function stopHintOf(opts: CliOptions): string {
  const parts = ['npx plume-canvas stop']
  if (path.resolve(opts.dir) !== path.resolve(DEFAULT_DATA_DIR)) parts.push('-d', quoteIfNeeded(opts.dir))
  if (opts.portExplicit) parts.push('-p', String(opts.port))
  return parts.join(' ')
}

/** 路径带空格时要加引号，用户才能直接复制这条命令 */
function quoteIfNeeded(value: string): string {
  return /\s/.test(value) ? `"${value}"` : value
}

/** 探测端口用的地址：监听 0.0.0.0 / :: 时用回环连 */
function probeHost(hostname: string): string {
  return hostname === '0.0.0.0' || hostname === '::' || hostname === '' ? '127.0.0.1' : hostname
}

/** 打印给人看的地址：监听 0.0.0.0 时写回环 */
function displayHost(hostname: string): string {
  return probeHost(hostname)
}

/** start：后台起服务，命令立刻返回 */
async function runStart(opts: CliOptions): Promise<void> {
  const dataDir = path.resolve(opts.dir)
  const state = readServerState(dataDir)
  const probe = probeHost(opts.hostname)

  // 已经在跑就直接告诉地址，别重复起一份
  if (state && isProcessAlive(state.pid)) {
    const { entries } = await describePort(state.port)
    if (entries.some((e) => e.pid === state.pid)) {
      console.log(`  服务已经在运行（端口 ${state.port}，pid ${state.pid}）`)
      console.log(`  画布   ${state.url}/`)
      if (opts.portExplicit && opts.port !== state.port) {
        console.log(`  想换到端口 ${opts.port}：先 npx plume-canvas stop，再重新 start`)
      }
      console.log('  想关掉：' + stopHintOf(opts))
      return
    }
  }
  if (state && !isProcessAlive(state.pid)) clearServerState(dataDir, state.pid)

  if (await isTcpPortBusy(opts.port, probe)) {
    throw new Error(portBusyMessage(opts.port))
  }

  const logFile = serverLogFile(dataDir)
  fsSync.mkdirSync(dataDir, { recursive: true })
  const fd = fsSync.openSync(logFile, 'a')
  const child = spawnSelf(serveArgsOf(opts), {
    detached: true,
    windowsHide: true,
    stdio: ['ignore', fd, fd],
    cwd: process.cwd(),
    env: process.env,
  })
  fsSync.closeSync(fd)

  // 用对象包一层：TS 会把「闭包里赋值」的变量窄化成 never，读完报错（实测）
  const exitInfo: { value: { code: number | null; signal: NodeJS.Signals | null } | null } = { value: null }
  child.once('exit', (code, signal) => {
    exitInfo.value = { code, signal }
  })
  child.unref()

  // 等端口起来。只等一小会儿：start 的卖点就是「命令不占终端」，
  // 首次启动要下载插件和界面时不该把人卡在命令行里。
  const deadline = Date.now() + 15_000
  let lastNotice = Date.now()
  process.stdout.write('  正在后台启动（首次启动可能要下载插件与界面，请稍等）')
  while (Date.now() < deadline) {
    if (await isTcpPortBusy(opts.port, probe)) {
      process.stdout.write('\n')
      printEndpoint(`http://${displayHost(opts.hostname)}:${opts.port}`)
      console.log(`  日志   ${logFile}`)
      console.log(`  停止   ${stopHintOf(opts)}`)
      console.log('  终端可以直接继续用；服务在后台跑着。')
      return
    }
    if (exitInfo.value) break
    if (Date.now() - lastNotice > 3000) {
      process.stdout.write('.')
      lastNotice = Date.now()
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  process.stdout.write('\n')

  if (exitInfo.value) {
    throw new Error(
      `后台进程已退出（exit ${exitInfo.value.code ?? exitInfo.value.signal}）。日志最后几行：\n` + tailText(logFile, 20),
    )
  }
  // 还在启动（多半是首次下载插件 / 界面）：交给用户自己看进度，命令照样结束
  console.log(`  服务正在后台启动（首次启动要下载插件和界面，可能慢一些）`)
  const dirArg = path.resolve(opts.dir) === path.resolve(DEFAULT_DATA_DIR) ? '' : ' -d ' + quoteIfNeeded(opts.dir)
  console.log(`  进度   npx plume-canvas logs${dirArg}        # 或 npx plume-canvas status${dirArg}`)
  console.log(`  日志   ${logFile}`)
}

/** stop：关掉后台或前台在跑的服务 */
async function runStop(opts: CliOptions, quiet = false): Promise<boolean> {
  const dataDir = path.resolve(opts.dir)
  const state = readServerState(dataDir)
  const port = opts.portExplicit ? opts.port : (state?.port ?? opts.port)
  const result = await stopServer({ dataDir, port, force: opts.force })

  if (result.killed.length === 0 && result.refused.length === 0) {
    if (!quiet) console.log(`  服务没在运行（端口 ${port} 空闲）`)
    return true
  }
  for (const entry of result.killed) {
    console.log(`  已停止 PID ${entry.pid}${entry.command ? '  ' + shorten(entry.command) : ''}`)
  }
  for (const entry of result.refused) {
    console.log(`  没动 PID ${entry.pid}${entry.command ? '  ' + shorten(entry.command) : ''}（看起来不像 plume-canvas；要关它加 --force）`)
  }
  if (result.freed) console.log(`  端口 ${port} 已释放`)
  else console.log(`  端口 ${port} 仍被占用。加 --force 可以强制结束占用它的进程。`)
  return result.freed
}

/** status：服务在不在、端口是谁占的 */
async function runStatus(opts: CliOptions): Promise<void> {
  const dataDir = path.resolve(opts.dir)
  const state = readServerState(dataDir)
  const port = opts.portExplicit ? opts.port : (state?.port ?? opts.port)
  const { entries } = await describePort(port)
  const alive = entries.length > 0

  if (alive) {
    const self = state && entries.some((e) => e.pid === state.pid)
    const ours = entries.some((e) => isPlumeServerCommand(e.command))
    if (ours) console.log(`  plume-canvas 正在运行（端口 ${port}）`)
    else console.log(`  端口 ${port} 被别的程序占用（不是 plume-canvas）`)
    if (self) console.log(`  画布   ${state.url}/`)
    for (const entry of entries) {
      console.log(`  PID ${entry.pid}${entry.command ? '  ' + shorten(entry.command) : ''}`)
    }
    console.log(ours ? '  想关掉：npx plume-canvas stop' : '  想关掉它：npx plume-canvas stop --force')
    return
  }

  console.log(`  服务没在运行（端口 ${port} 空闲）`)
  if (state && !isProcessAlive(state.pid)) clearServerState(dataDir, state.pid)
}

/** logs：看后台服务的日志尾巴 */
async function runLogs(opts: CliOptions): Promise<void> {
  const logFile = serverLogFile(opts.dir)
  if (!fsSync.existsSync(logFile)) {
    console.log('  还没有日志。执行 npx plume-canvas start 之后才会写 ' + logFile)
    return
  }
  console.log('  日志 ' + logFile + '\n')
  console.log(tailText(logFile, opts.lines))
}

/** 取文件最后 n 行；文件很大时只读尾部一块，避免整份读进内存 */
function tailText(file: string, lines: number): string {
  try {
    const size = fsSync.statSync(file).size
    const chunk = 64 * 1024
    const start = Math.max(0, size - chunk)
    const fd = fsSync.openSync(file, 'r')
    const buffer = Buffer.alloc(size - start)
    fsSync.readSync(fd, buffer, 0, buffer.length, start)
    fsSync.closeSync(fd)
    // 去掉结尾空行：日志通常以换行结尾，不去掉的话「最后 3 行」只会显示 2 行（实测）
    const all = buffer.toString('utf8').replace(/\s+$/, '').split(/\r?\n/)
    return all.slice(-lines).join('\n').trim()
  } catch (err) {
    return '（读取日志失败：' + (err instanceof Error ? err.message : String(err)) + '）'
  }
}

function shorten(command: string, max = 90): string {
  const line = command.replace(/\s+/g, ' ').trim()
  return line.length > max ? line.slice(0, max - 1) + '…' : line
}

async function main(): Promise<void> {
  const opts = await parseArgs(process.argv)
  if (opts.command === 'stop') {
    if (!(await runStop(opts))) process.exitCode = 1
    return
  }
  if (opts.command === 'status') return runStatus(opts)
  if (opts.command === 'logs') return runLogs(opts)
  if (opts.command === 'start') return runStart(opts)
  if (opts.command === 'restart') {
    // 原服务不在记录里、端口又是别的程序占着时，restart 不能硬起
    const ok = await runStop(opts, true)
    if (!ok) throw new Error(portBusyMessage(opts.portExplicit ? opts.port : (readServerState(opts.dir)?.port ?? opts.port)))
    return runStart(opts)
  }
  return runServe(opts)
}

async function runServe(opts: CliOptions): Promise<void> {
  //
  // 启动初始化必须在 createCloudServer **之前**同步完成：
  // uiDist 解析、插件目录扫描都在构造函数里定型，异步后装等于白装
  // （实测：npx 首次启动，日志说「装上了 24 个插件 · 界面已就绪」，
  //   但页面还是「未构建画布界面」、插件识别 0 个 —— 因为路由在装之前就定型了）。
  // 首次启动多等几十秒是必要代价；已装好的后续启动 skipped 全跳过，几乎无耗时。
  if (!opts.offline) {
    try {
      const { runBootstrap } = await import('./updater/bootstrap.js')
      const version = await readVersion()
      const r = await runBootstrap({
        dataDir: opts.dir,
        // 包根 builtin-manifest.json（files 里列了；dist/cli.js 的上一级 = 包根，与 readVersion 同源）
        manifestPath: path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'builtin-manifest.json'),
        // registry 可用 PLUME_REGISTRY 指到本地假 registry（自验证 / 离线环境）
        ...(process.env.PLUME_REGISTRY ? { registry: process.env.PLUME_REGISTRY } : {}),
        uiPkgName: '@plume-canvas/web',
        serverPkgName: '@plume-canvas/server',
        currentServerVersion: version,
      })
      if (r.installed.length) console.log('  启动初始化：装上了 ' + r.installed.length + ' 个插件（' + r.installed.slice(0, 3).join(', ') + (r.installed.length > 3 ? ' 等' : '') + '）')
      if (r.failed.length) console.warn('  启动初始化失败（下次启动再试）：' + r.failed.join(', '))
      if (r.uiVersion) console.log('  界面 v' + r.uiVersion + ' 已就绪')
    } catch (err) {
      console.warn('  启动初始化异常（继续启动）：' + (err instanceof Error ? err.message : String(err)))
    }
  }
  /*
   * 部署侧首次初始化：用环境变量预置登录密码，替代「SSH 进容器调 setup」。
   *
   * 时机必须在 createCloudServer **之前**：createCloudServer 构造时就读 auth.json
   * 定型了鉴权状态；之后再写等于白写（与上面 bootstrap 同一个坑）。
   */
  try {
    const { applyInitialPassword } = await import('./initialPassword.js')
    const r = await applyInitialPassword({
      // 和 createCloudServer 同一口径：相对路径按当前目录解析，别两边算出不同的 auth.json
      dataDir: path.resolve(opts.dir),
      password: process.env.PLUME_INITIAL_PASSWORD,
    })
    if (r === 'applied') {
      console.log('  初始密码已从 PLUME_INITIAL_PASSWORD 设置（请登录后尽快修改）')
    } else if (r === 'too-short') {
      console.warn('  PLUME_INITIAL_PASSWORD 少于 5 位，已忽略；请到登录面板设置密码')
    }
  } catch (err) {
    // 初始化失败不该拦启动：用户仍可在登录面板设置（本机）或走恢复令牌
    console.warn('  初始密码初始化失败（继续启动）：' + (err instanceof Error ? err.message : String(err)))
  }
  const { srv, info, portChanged } = await startWithPortFallback(opts)

  // 前台 serve 也记一份状态：这样另一个终端执行 `stop` 能精确关掉它，
  // 不必靠扫端口猜。状态文件写不进去不影响服务。
  const statePid = process.pid
  writeServerState(opts.dir, {
    pid: statePid,
    port: info.port,
    url: info.url,
    startedAt: new Date().toISOString(),
    entry: process.argv[1] ?? '',
  })

  // 打印前先扫一次插件清单：让用户一眼看到"装了几个插件、其中几个是开箱就用的"。
  // 这里报**插件管理清单**（/plugin-catalog.json 那份），因为界面现在按它装载；
  // 旧的 ESM manifest 只服务历史路径，拿它报数会显示成 0~2 个，误导用户。
  const catalog = await buildPluginCatalog(
    opts.plugins ? { global: opts.plugins } : await resolvePluginRoots(opts.dir, packagedPluginsDir()),
  )
  const builtinIds = new Set(BUILTIN_PLUGINS.map((e) => e.dir))
  const builtinEntries = catalog.plugins.filter((p) => builtinIds.has(p.id))

  console.log('')
  console.log('  plume-canvas 已启动')
  console.log('')
  console.log(`  画布   ${info.url}/`)
  if (portChanged) console.log(`         （端口 ${opts.port} 被占用，已自动改用 ${info.port}）`)
  /*
   * 数据目录打印**真实路径**：本地 `.plume` 现在是指向 `~/.plume` 的链接，
   * 直接打 `srv.paths.data` 会显示链接位置，用户看不出数据到底落在哪。
   * 子目录只列名字：同一段长路径重复三遍既难读，也看不出层级。
   */
  const realDir = await realPathOf(srv.paths.data)
  console.log(`  数据   ${realDir}`)
  console.log('         画布 canvases/ · 设置 kv/ · 平台 providers/ · 插件 plugins/')
  console.log(`  界面   ${srv.paths.ui ?? '未找到 apps/web/dist —— 先执行 cd apps/web && pnpm build'}`)
  const realPlugins = await realPathOf(srv.paths.plugins)
  console.log(
    `  插件   ${realPlugins ?? '(未找到插件目录)'} · 识别到 ${catalog.plugins.length} 个，` +
      `开箱自动装 ${builtinEntries.length} 个（首装 ${FIRST_INSTALL_DIRS.length} 个）`,
  )
  for (const p of builtinEntries) console.log(`         - ${p.id}  → ${p.url}`)
  console.log(`  平台   ${await realPathOf(srv.paths.providers)}（丢 .js 进去即多一个平台）`)
  // ---- 管理面安全：令牌与白名单**逐行**打印（配错时能一眼看出来，而不是等 403 才猜）----
  if (srv.adminTokenSource === 'disabled') {
    console.log('')
    console.log('  ⚠️  管理鉴权已关闭（--no-admin-auth）—— 任何网页都能装插件 / 跑脚本 / 改画布')
  } else {
    console.log('')
    /*
     * 这串不是日常登录密码：登录用 cloud-client 面板里自己设的密码（首次打开设置一次，
     * 之后自动登录）。它只是「忘记密码 / 直接调用接口」时的恢复通道，打印出来备用。
     */
    console.log(
      '  恢复令牌 ' +
        (srv.adminTokenSource === 'env'
          ? '（来自 PLUME_ADMIN_TOKEN）'
          : await realPathOf(srv.adminTokenFile)),
    )
    console.log('           ' + srv.adminToken)
    console.log('           忘记登录密码时用它重置；删掉该文件并重启即轮换')
  }
  console.log('  信任来源 ' + srv.trust.hosts.join(' · '))
  if (srv.trust.origins.length) console.log('           额外 Origin: ' + srv.trust.origins.join(' · '))
  if (srv.debugOriginUrl) {
    // 可视化节点的「调试」页跑在这上面（另一个端口）：它只读、只认调试文件，
    // 不算可信来源。单独打一行，用户排查「调试页打不开」时一眼能看到。
    console.log('  调试页 ' + srv.debugOriginUrl + '（独立源，只能读调试产物）')
  }
  if (srv.mcpEnabled) {
    // MCP 地址一定要显眼：用户是拿这行去配 AI 客户端的
    console.log('')
    console.log(`  MCP    ${info.url}/mcp`)
    console.log(`         工具 ${srv.tools.map((t) => t.name).join(' · ')}`)
    console.log('         （Streamable HTTP；AI 与网页画布共用同一份数据）')
  }
  console.log('')
  console.log('  按 Ctrl+C 停止')
  console.log('')

  if (opts.open) openBrowser(info.url)

  // Ctrl+C / 结束信号：优雅关掉监听再退出（避免端口半开占着）
  const shutdown = (): void => {
    srv.stop()
    clearServerState(opts.dir, statePid)
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
  // 进程被外部直接结束（taskkill / 关机）时也要把状态文件清掉，
  // 否则下次 stop 会拿一个死 pid 去折腾。
  process.on('exit', () => clearServerState(opts.dir, statePid))
}

/** 打开默认浏览器（跨平台；失败只提示，不影响服务） */
function openBrowser(url: string): void {
  const cmd = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open'
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url]
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true, windowsHide: true }).unref()
  } catch {
    console.log(`  （没能自动打开浏览器，手动访问 ${url} 即可）`)
  }
}

/** 打印用的真实路径：链接（`.plume` → `~/.plume`）解析成实际目录，取不到就原样 */
async function realPathOf(target: string | null | undefined): Promise<string | undefined> {
  if (!target) return undefined
  try {
    return await fs.realpath(target)
  } catch {
    return target
  }
}

/**
 * 只有直接执行本文件时才跑 main；被测试 import 时只导出函数。
 *
 * 不能只比 path.resolve：npm 装的 bin 在 Linux 上是**符号链接**，
 * argv[1] 是链接路径、import.meta.url 是真实路径，直接比会判成「不是主模块」，
 * 结果 npx 起服务什么都没干（很隐蔽）。两边都先 realpath 再比。
 */
function isMainModule(): boolean {
  const entry = process.argv[1]
  if (!entry) return false
  try {
    return fsSync.realpathSync(entry) === fsSync.realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return path.resolve(entry) === path.resolve(fileURLToPath(import.meta.url))
  }
}

if (isMainModule()) {
  main().catch((err: unknown) => {
    console.error(`\n启动失败: ${err instanceof Error ? err.message : String(err)}\n`)
    process.exit(1)
  })
}

export { parseArgs, startWithPortFallback, portBusyMessage, serveArgsOf, stopHintOf }
export type { CliOptions }
