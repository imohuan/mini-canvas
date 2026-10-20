#!/usr/bin/env node
/**
 * mini-canvas-cloud CLI —— `npx mini-canvas-cloud serve` 的入口。
 *
 * 命令名带 `-cloud` 后缀：仓库里 mcp-server 的 bin 已经叫 `mini-canvas`（面向 AI 工具链），
 * 两个包若用同一个 bin 名，谁先装谁生效、后装的会被静默覆盖。分开命名免得踩。
 *
 * 做的事：解析参数 → 起 cloud-server → 打印访问地址与数据落点 → 打印外部插件条数。
 * 端口被占用时（且用户没写死端口）自动往后找下一个可用端口，不让"怎么又起不来"成为日常。
 */
import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCloudServer, DEFAULT_DATA_DIR, DEFAULT_PORT } from './server.js'
import { buildManifest, resolvePluginsDir } from './static.js'

interface CliOptions {
  port: number
  portExplicit: boolean
  dir: string
  hostname: string
  ui?: string
  plugins?: string
  providers?: string
  serverPlugins?: string
  open: boolean
  /** 是否提供 MCP 接口（缺省开） */
  mcp: boolean
  /** 关闭管理令牌鉴权（必须配合 MINI_CANVAS_ALLOW_INSECURE=1） */
  noAdminAuth: boolean
  /** 额外信任的 Host（可重复） */
  trustedHosts: string[]
  /** 额外信任的 Origin（可重复） */
  trustedOrigins: string[]
}

const HELP = `mini-canvas-cloud —— 自托管画布服务

用法:
  mini-canvas-cloud serve [选项]      起服务（默认子命令）
  mini-canvas-cloud list-tools        列出 MCP 暴露的工具
  mini-canvas-cloud --help            看这份帮助
  mini-canvas-cloud --version         看版本
  mini-canvas-cloud audit-verify      校验 <数据目录>/audit.log 的 hash 链（不开服务）

选项:
  -p, --port <号>     监听端口（默认 ${DEFAULT_PORT}；被占用时自动往后找）
  -d, --dir <目录>    数据目录（默认当前目录下的 ${DEFAULT_DATA_DIR}/）
      --host <地址>   监听地址（默认 127.0.0.1，只本机可访问）
      --ui <目录>     画布界面产物目录（默认自动探测 packages/ui/dist）
      --plugins <目录> 插件目录（默认自动探测 packages/plugins）
      --providers <目录> 平台提供方目录（后台的"投递箱"；默认 <数据目录>/providers）
      --server-plugins <目录> 后台插件目录（丢 .js 进去即多一个后台插件；默认 <数据目录>/server-plugins）
      --no-mcp        不提供 MCP 接口（默认提供）
      --no-admin-auth 关闭管理令牌与来源边界（**必须**同时设 MINI_CANVAS_ALLOW_INSECURE=1）
      --trusted-host <host:port>   额外信任的 Host（反代 / 另一个主机名；可重复）
      --trusted-origin <origin>    额外信任的 Origin（如 dev 的 http://localhost:5288；可重复）
      --open          启动后自动打开浏览器（默认开）
      --no-open       不自动打开浏览器

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
  let subcommand: 'list-tools' | 'audit-verify' | undefined
  const opts: CliOptions = {
    port: Number(process.env.MINI_CANVAS_PORT ?? '') || DEFAULT_PORT,
    portExplicit: false,
    dir: DEFAULT_DATA_DIR,
    hostname: '127.0.0.1',
    open: true,
    mcp: true,
    noAdminAuth: false,
    trustedHosts: [],
    trustedOrigins: [],
  }

  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    // 取值型选项：缺值直接报错（比"悄悄用默认值"好排查）
    const takeValue = (name: string): string => {
      const v = args[++i]
      if (v === undefined || v.startsWith('-')) throw new Error(`${name} 后面缺少值`)
      return v
    }
    if (a === 'serve') continue
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
    else if (a === '--server-plugins') opts.serverPlugins = takeValue(a)
    else if (a === '--mcp') opts.mcp = true
    else if (a === '--no-mcp') opts.mcp = false
    else if (a === '--no-admin-auth') opts.noAdminAuth = true
    else if (a === '--trusted-host') opts.trustedHosts.push(takeValue(a))
    else if (a === '--trusted-origin') opts.trustedOrigins.push(takeValue(a))
    else if (a === '--open') opts.open = true
    else if (a === '--no-open') opts.open = false
    else if (a === '-h' || a === '--help') {
      console.log(HELP)
      process.exit(0)
    } else if (a === '-v' || a === '--version') {
      console.log(await readVersion())
      process.exit(0)
    } else if (a === 'audit-verify' || a === 'list-tools') {
      // 子命令先记下、**继续解析后面的参数**（`-d` 可能写在子命令之后），
      // 解析完再执行。早退会让 `audit-verify -d X` 悄悄校验默认目录（实测踩过）。
      subcommand = a
    } else {
      throw new Error(`未知参数: ${a}（--help 看用法）`)
    }
  }

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

/** 端口被占用（EADDRINUSE）—— 这是唯一值得"换端口重试"的错误 */
function isPortBusy(err: unknown): boolean {
  return (err as NodeJS.ErrnoException | undefined)?.code === 'EADDRINUSE'
}

/** 起服务：端口被占用且用户没写死端口时，往后找最多 10 个端口 */
async function startWithPortFallback(opts: CliOptions) {
  // 关鉴权必须显式二次确认：裸跑等于把「装插件 / 执行脚本 / 改画布」的入口对外开放。
  if (opts.noAdminAuth && process.env.MINI_CANVAS_ALLOW_INSECURE !== '1') {
    throw new Error(
      '--no-admin-auth 需要同时设置环境变量 MINI_CANVAS_ALLOW_INSECURE=1。\n' +
        '这是有意的二次确认：关掉之后任何网页都能装插件、跑脚本、改画布。',
    )
  }
  const maxTries = opts.portExplicit ? 1 : 10
  for (let i = 0; i < maxTries; i++) {
    const port = opts.port + i
    const srv = await createCloudServer({
      port,
      dir: opts.dir,
      hostname: opts.hostname,
      ...(opts.ui ? { uiDist: opts.ui } : {}),
      ...(opts.plugins ? { pluginsDir: opts.plugins } : {}),
      ...(opts.providers ? { providersDir: opts.providers } : {}),
      ...(opts.serverPlugins ? { serverPluginsDir: opts.serverPlugins } : {}),
      ...(opts.noAdminAuth ? { adminAuth: false } : {}),
      ...(opts.trustedHosts.length ? { trustedHosts: opts.trustedHosts } : {}),
      ...(opts.trustedOrigins.length ? { trustedOrigins: opts.trustedOrigins } : {}),
      mcp: opts.mcp,
    })
    try {
      const info = await srv.start()
      return { srv, info, portChanged: port !== opts.port }
    } catch (err) {
      srv.stop()
      if (isPortBusy(err)) continue
      throw err
    }
  }
  throw new Error(`端口 ${opts.port} 起连续 10 个都被占用了，用 --port 换一个吧`)
}

async function main(): Promise<void> {
  const opts = await parseArgs(process.argv)
  const { srv, info, portChanged } = await startWithPortFallback(opts)

  // 打印前先探一次插件清单：让用户一眼看到"有几个插件会被画布装上"
  const manifest = await buildManifest(await resolvePluginsDir(opts.plugins))

  console.log('')
  console.log('  mini-canvas-cloud 已启动')
  console.log('')
  console.log(`  画布   ${info.url}/`)
  if (portChanged) console.log(`         （端口 ${opts.port} 被占用，已自动改用 ${info.port}）`)
  console.log(`  数据   ${srv.paths.data}`)
  console.log(`         kv/       ${srv.paths.kv}（设置 / 快捷这类小数据）`)
  console.log(`         canvases/ ${srv.paths.canvases}（一个画布一个文件夹）`)
  console.log(`  界面   ${srv.paths.ui ?? '未找到 packages/ui/dist —— 先执行 cd packages/ui && pnpm build'}`)
  console.log(`  插件   ${srv.paths.plugins ?? '(未找到插件目录)'} · 清单里 ${manifest.length} 个`)
  for (const p of manifest) console.log(`         - ${p.id}  → ${p.url}`)
  console.log(`  平台   ${srv.paths.providers}（丢 .js 进去即多一个平台）`)
  console.log(`  后台插件 ${srv.paths.serverPlugins}（丢 .js 进去即多一个后台插件；重启生效）`)
  // ---- 管理面安全：令牌与白名单**逐行**打印（配错时能一眼看出来，而不是等 403 才猜）----
  if (srv.adminTokenSource === 'disabled') {
    console.log('')
    console.log('  ⚠️  管理鉴权已关闭（--no-admin-auth）—— 任何网页都能装插件 / 跑脚本 / 改画布')
  } else {
    console.log('')
    console.log('  管理令牌 ' + (srv.adminTokenSource === 'env' ? '（来自 MINI_CANVAS_ADMIN_TOKEN）' : srv.adminTokenFile))
    console.log('           ' + srv.adminToken)
    console.log('           前端在「设置 → 插件」里填一次；删掉令牌文件重启即轮换')
  }
  console.log('  信任来源 ' + srv.trust.hosts.join(' · '))
  if (srv.trust.origins.length) console.log('           额外 Origin: ' + srv.trust.origins.join(' · '))
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
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
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

main().catch((err: unknown) => {
  console.error(`\n启动失败: ${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
})

// 供将来测试直接引用；CLI 自身按上面的 main() 立即执行。
export { parseArgs, startWithPortFallback }
export type { CliOptions }
