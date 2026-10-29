/**
 * launch-server —— mini-canvas 一键启动（node 版）。
 *
 * 复刻桌面上的「启动mini-canvas-server.ps1」，顺序保持一致：
 *   1. pnpm bundle        构建后台
 *   2. pnpm build:assets  构建前端和插件资源（有指纹，没改动会跳过）
 *   3. 结束占用端口的进程
 *   4. pnpm serve         启动 cloud-server
 *
 * 用法：
 *   node scripts/launch-server.mjs
 *   node scripts/launch-server.mjs --port 8865
 *   node scripts/launch-server.mjs --no-build
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { freePorts } from './kill-port.mjs'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..')
const SERVER_DIR = path.join(REPO_ROOT, 'packages/cloud-server')
const DEFAULT_PORT = 8865

function parsePort(value, name) {
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} 端口不合法: ${value}`)
  }
  return port
}

function parsePositiveInt(value, name) {
  const n = Number(value)
  if (!Number.isInteger(n) || n < 1) throw new Error(`${name} 需要正整数，收到: ${value}`)
  return n
}

function parseArgs(argv) {
  const options = {
    port: DEFAULT_PORT,
    open: false,
    build: true,
    force: false,
    jobs: undefined,
    pause: false,
    help: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') options.help = true
    else if (arg === '--port' || arg === '-p' || arg === '-Port') {
      const value = argv[++i]
      if (value === undefined) throw new Error(`${arg} 后面缺少端口`)
      options.port = parsePort(value, arg)
    } else if (arg.startsWith('--port=')) {
      options.port = parsePort(arg.slice('--port='.length), '--port')
    } else if (arg === '--open' || arg === '-Open') {
      // 浏览器由调用方手动打开：忽略历史脚本里的 --open，不在启动时弹页面
      options.open = false
    } else if (arg === '--no-open') options.open = false
    else if (arg === '--no-build' || arg === '--skip-build') options.build = false
    else if (arg === '--build') options.build = true
    else if (arg === '--force') options.force = true
    else if (arg === '--jobs') {
      const value = argv[++i]
      if (value === undefined) throw new Error('--jobs 后面缺少并发数')
      options.jobs = parsePositiveInt(value, '--jobs')
    } else if (arg.startsWith('--jobs=')) {
      options.jobs = parsePositiveInt(arg.slice('--jobs='.length), '--jobs')
    } else if (arg === '--pause') options.pause = true
    else if (arg === '--no-pause') options.pause = false
    else throw new Error(`未知参数: ${arg}`)
  }
  return options
}

/** Windows 的 pnpm 是 .cmd：交给 cmd.exe 执行，避免 Node 的 shell 弃用警告。 */
function spawnPnpm(args, options) {
  if (process.platform === 'win32') {
    return spawn('cmd.exe', ['/d', '/s', '/c', 'pnpm', ...args], { ...options, windowsHide: true })
  }
  return spawn('pnpm', args, { ...options, windowsHide: true })
}

function run(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawnPnpm(args, { cwd, stdio: 'inherit', env: process.env })
    child.on('error', reject)
    child.on('close', (code, signal) => resolve({ code: code ?? 1, signal }))
  })
}

async function runStep(step, label, args, cwd) {
  console.log(`\n[${step}] ${label} ...`)
  const result = await run(args, cwd)
  if (result.code !== 0) throw new Error(`${label} 失败（exit ${result.code}）`)
  console.log(`[${step}] ${label} 完成`)
}

async function pauseIfNeeded(options) {
  if (!options.pause || !process.stdin.isTTY) return
  process.stdout.write('\n按 Enter 关闭窗口...')
  await new Promise((resolve) => process.stdin.once('data', resolve))
}

function printHelp() {
  console.log(`mini-canvas 一键启动（node 版）

默认流程和 启动mini-canvas-server.ps1 一样：
  1. pnpm bundle        构建后台
  2. pnpm build:assets  构建前端和插件资源
  3. 结束占用端口的进程
  4. pnpm serve         启动 cloud-server

用法:
  node scripts/launch-server.mjs [选项]
  node scripts/launch-server-8860.mjs

选项:
  -p, --port <号>   监听端口（默认 8865）
  --open            已停用（浏览器由调用方手动打开；保留仅为兼容旧脚本）
  --no-build        跳过第 1、2 步，直接用现有产物启动
  --force           强制重建全部资源（传给 build:assets）
  --jobs <数>       资源构建并发数（传给 build:assets）
  --pause           退出前等待按 Enter（双击运行时用）
  -h, --help        看这份帮助

例子:
  node scripts/launch-server.mjs --port 8865
  node scripts/launch-server.mjs --port 8860
  node scripts/kill-port.mjs 8865 8860`)
}

async function main() {
  let options
  try {
    options = parseArgs(process.argv.slice(2))
  } catch (err) {
    console.error(err.message)
    printHelp()
    process.exitCode = 1
    return
  }
  if (options.help) {
    printHelp()
    return
  }
  if (!existsSync(SERVER_DIR)) {
    console.error(`ERROR: 目录不存在: ${SERVER_DIR}`)
    process.exitCode = 1
    await pauseIfNeeded(options)
    return
  }

  console.log(`工作目录: ${SERVER_DIR}`)
  try {
    if (options.build) {
      await runStep('1/4', '构建后台（pnpm bundle）', ['bundle'], SERVER_DIR)
      const assetArgs = ['build:assets']
      if (options.force) assetArgs.push('--force')
      if (options.jobs) assetArgs.push('--jobs', String(options.jobs))
      await runStep('2/4', '构建前端与插件资源（pnpm build:assets）', assetArgs, SERVER_DIR)
    } else {
      console.log('\n[1/4] 跳过后台构建（--no-build）')
      console.log('[2/4] 跳过资源构建（--no-build）')
    }

    console.log(`\n[3/4] 检查端口 ${options.port} ...`)
    const freed = await freePorts([options.port])
    if (!freed.ok) {
      // 照原来的 PowerShell 行为：杀不掉也继续启动（服务会自己往后找端口）。
      // 但至少把结果说清楚，方便排查。
      console.warn(`[port] 端口 ${options.port} 仍被占用，继续启动；实际端口以启动日志为准`)
    }

    console.log(`\n[4/4] 启动 cloud-server（端口 ${options.port}）...`)
    console.log('按 Ctrl+C 停止。\n')
    const serveArgs = ['serve']
    if (!options.open) serveArgs.push('--no-open')
    const child = spawnPnpm(serveArgs, {
      cwd: SERVER_DIR,
      stdio: 'inherit',
      env: { ...process.env, MINI_CANVAS_PORT: String(options.port) },
    })
    const result = await new Promise((resolve, reject) => {
      child.on('error', reject)
      child.on('close', (exitCode, signal) => resolve({ exitCode, signal }))
    })
    // Windows 上 Ctrl+C 常表现为 4294967295（-1）；按正常停止处理，不当作失败。
    const interrupted = result.signal != null
      || result.exitCode === 4294967295
      || result.exitCode === 3221225786
    const code = interrupted ? 0 : (result.exitCode ?? 0)
    console.log(`\ncloud-server 已停止（exit ${code}）。`)
    process.exitCode = code
  } catch (err) {
    console.error(`\nERROR: ${err.message}`)
    console.error('服务没有启动。')
    process.exitCode = 1
  } finally {
    await pauseIfNeeded(options)
  }
}

main().catch((err) => {
  console.error(err && err.message ? err.message : err)
  process.exitCode = 1
})
