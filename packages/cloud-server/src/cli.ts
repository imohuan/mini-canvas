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
  open: boolean
}

const HELP = `mini-canvas-cloud —— 自托管画布服务

用法:
  mini-canvas-cloud serve [选项]      起服务（默认子命令）
  mini-canvas-cloud --help            看这份帮助
  mini-canvas-cloud --version         看版本

选项:
  -p, --port <号>     监听端口（默认 ${DEFAULT_PORT}；被占用时自动往后找）
  -d, --dir <目录>    数据目录（默认当前目录下的 ${DEFAULT_DATA_DIR}/）
      --host <地址>   监听地址（默认 127.0.0.1，只本机可访问）
      --ui <目录>     画布界面产物目录（默认自动探测 packages/ui/dist）
      --plugins <目录> 插件目录（默认自动探测 packages/plugins）
      --open          启动后自动打开浏览器（默认开）
      --no-open       不自动打开浏览器

启动后:
  http://127.0.0.1:<端口>/            画布界面
  GET|PUT|DELETE /api/kv/:type/:key   画布数据读写
  POST /api/files · GET /uploads/*    资源上传与回读
  GET /plugin-manifest.json           外部插件清单
`

/** 解析参数；遇到 --help/--version 直接打印退出 */
async function parseArgs(argv: string[]): Promise<CliOptions> {
  const args = argv.slice(2)
  const opts: CliOptions = {
    port: DEFAULT_PORT,
    portExplicit: false,
    dir: DEFAULT_DATA_DIR,
    hostname: '127.0.0.1',
    open: true,
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
    else if (a === '--open') opts.open = true
    else if (a === '--no-open') opts.open = false
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
  const maxTries = opts.portExplicit ? 1 : 10
  for (let i = 0; i < maxTries; i++) {
    const port = opts.port + i
    const srv = await createCloudServer({
      port,
      dir: opts.dir,
      hostname: opts.hostname,
      ...(opts.ui ? { uiDist: opts.ui } : {}),
      ...(opts.plugins ? { pluginsDir: opts.plugins } : {}),
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
  console.log(`         kv/      ${srv.paths.kv}`)
  console.log(`         uploads/ ${srv.paths.uploads}`)
  console.log(`  界面   ${srv.paths.ui ?? '未找到 packages/ui/dist —— 先执行 cd packages/ui && pnpm build'}`)
  console.log(`  插件   ${srv.paths.plugins ?? '(未找到插件目录)'} · 清单里 ${manifest.length} 个`)
  for (const p of manifest) console.log(`         - ${p.id}  → ${p.url}`)
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
