/**
 * kill-port —— 结束占用指定端口的进程，支持一次给多个端口。
 *
 * 用途：一键启动脚本在 `pnpm serve` 之前先把旧服务停掉，避免端口被占用后
 * 服务悄悄换到别的端口（或直接启动失败）。
 *
 * 用法：
 *   node scripts/kill-port.mjs 8865 8860
 *   node scripts/kill-port.mjs --port 8865 --port 8860
 *   pnpm kill-port 8865 8860
 *
 * 选项：
 *   -t, --timeout <毫秒>  等待端口释放的最长时间（默认 10000）
 *   --dry-run             只列出会结束的进程，不真的结束
 *   -h, --help            看帮助
 *
 * 只结束“正在监听”的进程；已经退出、只是在 TIME_WAIT 的连接不会动。
 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_TIMEOUT_MS = 10_000
const SCRIPT_FILE = fileURLToPath(import.meta.url)

function isMainModule() {
  const entry = process.argv[1]
  if (!entry) return false
  return path.resolve(entry) === path.resolve(SCRIPT_FILE)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 跑一个命令并收集输出；命令不存在或退出码非 0 都不抛异常，交给调用方判断。 */
function runCapture(command, args, options = {}) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(command, args, {
        ...options,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
    } catch (err) {
      resolve({ code: -1, stdout: '', stderr: String(err) })
      return
    }
    let stdout = ''
    let stderr = ''
    // Windows 自带命令的输出常是 GBK；按系统代码页解码，避免中文提示变乱码。
    const decoding = process.platform === 'win32'
      ? new TextDecoder('gbk')
      : new TextDecoder('utf-8')
    child.stdout.on('data', (data) => { stdout += decoding.decode(data, { stream: true }) })
    child.stderr.on('data', (data) => { stderr += decoding.decode(data, { stream: true }) })
    child.stdout.on('end', () => { stdout += decoding.decode() })
    child.stderr.on('end', () => { stderr += decoding.decode() })
    child.on('error', (err) => resolve({ code: -1, stdout, stderr: String(err) }))
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }))
  })
}

/** 端口可以写成 8865、"8865,8860" 或数字数组；去重并保持顺序。 */
export function normalizePorts(input) {
  const list = Array.isArray(input) ? input : [input]
  const ports = []
  for (const item of list) {
    for (const raw of String(item).split(',')) {
      const text = raw.trim()
      if (!text) continue
      const port = Number(text)
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error(`端口不合法: ${text}`)
      }
      if (!ports.includes(port)) ports.push(port)
    }
  }
  return ports
}

/** PowerShell 输出形如 "8865 1234" 的行。 */
function parsePairs(text) {
  const map = new Map()
  for (const line of text.split(/\r?\n/)) {
    const match = line.trim().match(/^(\d+)\s+(\d+)$/)
    if (!match) continue
    const port = Number(match[1])
    const pid = Number(match[2])
    if (!map.has(port)) map.set(port, new Set())
    if (pid > 0) map.get(port).add(pid)
  }
  return map
}

/** netstat 兜底：TCP 0.0.0.0:8865 ... LISTENING 1234 */
function parseNetstat(text, ports) {
  const wanted = new Set(ports)
  const map = new Map()
  for (const line of text.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/)
    if (parts.length < 5) continue
    if (parts[0].toUpperCase() !== 'TCP') continue
    if (parts[3].toUpperCase() !== 'LISTENING') continue
    const local = parts[1]
    const pid = Number(parts[4])
    if (!(pid > 0)) continue
    for (const port of wanted) {
      if (!local.endsWith(':' + port)) continue
      if (!map.has(port)) map.set(port, new Set())
      map.get(port).add(pid)
    }
  }
  return map
}

async function windowsListeners(ports) {
  if (ports.length === 0) return new Map()
  const command = [
    `$ports = @(${ports.join(',')})`,
    'Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |',
    'Where-Object { $ports -contains $_.LocalPort } |',
    'ForEach-Object { "$($_.LocalPort) $($_.OwningProcess)" }',
  ].join(' ')
  const result = await runCapture('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command])
  // 没输出且没报错 = 这些端口都空闲；有报错才落到 netstat 兜底。
  if (result.code === 0 && !result.stderr.trim()) return parsePairs(result.stdout)

  const fallback = await runCapture('netstat', ['-ano'])
  if (fallback.code !== 0) {
    throw new Error('查询端口失败：' + (fallback.stderr || result.stderr || '未知错误').trim())
  }
  return parseNetstat(fallback.stdout, ports)
}

async function unixListeners(ports) {
  const map = new Map()
  let missingTool = false
  for (const port of ports) {
    const lsof = await runCapture('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'])
    if (lsof.code === 0) {
      for (const line of lsof.stdout.split(/\s+/)) {
        const pid = Number(line)
        if (pid > 0) {
          if (!map.has(port)) map.set(port, new Set())
          map.get(port).add(pid)
        }
      }
      continue
    }

    const ss = await runCapture('ss', ['-ltnp', `sport = :${port}`])
    if (ss.code === 0) {
      for (const match of ss.stdout.matchAll(/pid=(\d+)/g)) {
        const pid = Number(match[1])
        if (pid > 0) {
          if (!map.has(port)) map.set(port, new Set())
          map.get(port).add(pid)
        }
      }
      continue
    }
    if (lsof.code === -1 && ss.code === -1) missingTool = true
  }
  if (missingTool) throw new Error('找不到 lsof 或 ss，无法查询端口占用')
  return map
}

/** 返回 Map<端口, Set<PID>>；只包含正在监听的连接。 */
export async function findListeningMap(inputPorts) {
  const ports = normalizePorts(inputPorts)
  if (ports.length === 0) return new Map()
  return process.platform === 'win32' ? windowsListeners(ports) : unixListeners(ports)
}

async function killPid(pid) {
  if (process.platform === 'win32') {
    // /T 连子进程一起结束，避免 pnpm / vite 留下孤儿进程。
    const result = await runCapture('taskkill', ['/PID', String(pid), '/T', '/F'])
    // taskkill 在不同语言环境下的成功文案不一样；对外只说“已结束 + 是否带子进程”。
    const withTree = /\b[1-9]\d*\b/.test(result.stdout) || /\b[1-9]\d*\b/.test(result.stderr)
    return { ok: result.code === 0, output: withTree ? '含子进程' : '' }
  }

  try {
    process.kill(pid, 'SIGTERM')
  } catch (err) {
    if (err.code === 'ESRCH') return { ok: true, output: '进程已退出' }
    return { ok: false, output: err.message }
  }
  await sleep(300)
  try {
    process.kill(pid, 0)
  } catch {
    return { ok: true, output: 'SIGTERM' }
  }
  try {
    process.kill(pid, 'SIGKILL')
    return { ok: true, output: 'SIGKILL' }
  } catch (err) {
    return { ok: false, output: err.message }
  }
}

/**
 * 结束所有占用这些端口的进程，并等到端口真正释放。
 *
 * @param {Array<number|string>} inputPorts
 * @param {{ timeoutMs?: number, dryRun?: boolean, log?: (message: string) => void }} options
 */
export async function freePorts(inputPorts, options = {}) {
  const ports = normalizePorts(inputPorts)
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs >= 0
    ? options.timeoutMs
    : DEFAULT_TIMEOUT_MS
  const dryRun = options.dryRun === true
  const log = typeof options.log === 'function' ? options.log : (message) => console.log(message)

  if (ports.length === 0) {
    return { ok: true, ports: [], killed: [], stillBusy: [] }
  }

  log(`[port] 检查 ${ports.join(', ')} ...`)
  let before
  try {
    before = await findListeningMap(ports)
  } catch (err) {
    log(`[port] 查询失败：${err.message}`)
    return { ok: false, ports: [], killed: [], stillBusy: ports, error: err.message }
  }

  const busy = ports.filter((port) => (before.get(port)?.size ?? 0) > 0)
  for (const port of ports) {
    const pids = [...(before.get(port) ?? [])]
    if (pids.length === 0) log(`[port] ${port} 空闲`)
    else log(`[port] ${port} 被 PID ${pids.join(', ')} 占用`)
  }

  if (busy.length === 0) {
    return {
      ok: true,
      ports: ports.map((port) => ({ port, pids: [], freed: true })),
      killed: [],
      stillBusy: [],
    }
  }

  const pidSet = new Set()
  for (const port of busy) for (const pid of before.get(port) ?? []) pidSet.add(pid)
  const pidList = [...pidSet]

  if (dryRun) {
    log(`[port] dry-run：会结束 PID ${pidList.join(', ')}（没有真的结束）`)
    return {
      ok: false,
      ports: ports.map((port) => ({ port, pids: [...(before.get(port) ?? [])], freed: false })),
      killed: [],
      stillBusy: busy,
      dryRun: true,
    }
  }

  const killed = []
  const failed = []
  for (const pid of pidList) {
    if (pid <= 4) {
      failed.push({ pid, reason: '系统进程，跳过' })
      log(`[port] PID ${pid} 是系统进程，跳过`)
      continue
    }
    const result = await killPid(pid)
    if (result.ok) {
      killed.push(pid)
      log(`[port] 已结束 PID ${pid}${result.output ? `（${result.output}）` : ''}`)
    } else {
      failed.push({ pid, reason: result.output })
      log(`[port] 结束 PID ${pid} 失败：${result.output}`)
    }
  }

  const deadline = Date.now() + timeoutMs
  let after = new Map()
  let lastError = null
  while (true) {
    try {
      after = await findListeningMap(ports)
      lastError = null
    } catch (err) {
      lastError = err
    }
    const still = ports.filter((port) => (after.get(port)?.size ?? 0) > 0)
    if (still.length === 0 || Date.now() >= deadline) break
    await sleep(250)
  }

  if (lastError) {
    log(`[port] 复查失败：${lastError.message}`)
    return {
      ok: false,
      ports: ports.map((port) => ({ port, pids: [...(after.get(port) ?? [])], freed: false })),
      killed,
      stillBusy: ports,
      failed,
      error: lastError.message,
    }
  }

  const stillBusy = ports.filter((port) => (after.get(port)?.size ?? 0) > 0)
  for (const port of ports) {
    if (stillBusy.includes(port)) {
      log(`[port] ${port} 仍被占用：PID ${[...(after.get(port) ?? [])].join(', ')}`)
    } else {
      log(`[port] ${port} 已释放`)
    }
  }
  return {
    ok: stillBusy.length === 0,
    ports: ports.map((port) => ({
      port,
      pids: [...(after.get(port) ?? [])],
      freed: !stillBusy.includes(port),
    })),
    killed,
    stillBusy,
    failed,
  }
}

function parseNonNegativeInt(value, name) {
  const n = Number(value)
  if (!Number.isInteger(n) || n < 0) throw new Error(`${name} 需要非负整数，收到: ${value}`)
  return n
}

function parseCli(argv) {
  const options = { ports: [], timeoutMs: DEFAULT_TIMEOUT_MS, dryRun: false, help: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') options.help = true
    else if (arg === '--dry-run') options.dryRun = true
    else if (arg === '--timeout' || arg === '-t') {
      const value = argv[++i]
      if (value === undefined) throw new Error(`${arg} 后面缺少毫秒数`)
      options.timeoutMs = parseNonNegativeInt(value, arg)
    } else if (arg.startsWith('--timeout=')) {
      options.timeoutMs = parseNonNegativeInt(arg.slice('--timeout='.length), '--timeout')
    } else if (arg === '--port' || arg === '-p') {
      const value = argv[++i]
      if (value === undefined) throw new Error(`${arg} 后面缺少端口`)
      options.ports.push(...normalizePorts(value))
    } else if (arg.startsWith('--port=')) {
      options.ports.push(...normalizePorts(arg.slice('--port='.length)))
    } else if (arg.startsWith('-')) {
      throw new Error(`未知参数: ${arg}`)
    } else {
      options.ports.push(...normalizePorts(arg))
    }
  }
  options.ports = normalizePorts(options.ports)
  return options
}

function printUsage() {
  console.log(`结束占用指定端口的进程（可一次给多个端口）

用法:
  node scripts/kill-port.mjs 8865 8860
  node scripts/kill-port.mjs --port 8865 --port 8860
  pnpm kill-port 8865 8860

选项:
  -t, --timeout <毫秒>   等待端口释放的最长时间（默认 ${DEFAULT_TIMEOUT_MS}）
  --dry-run              只列出会结束的进程，不真的结束
  -h, --help             看这份帮助`)
}

async function main() {
  let options
  try {
    options = parseCli(process.argv.slice(2))
  } catch (err) {
    console.error(err.message)
    printUsage()
    process.exitCode = 1
    return
  }
  if (options.help) {
    printUsage()
    return
  }
  if (options.ports.length === 0) {
    printUsage()
    process.exitCode = 1
    return
  }

  const result = await freePorts(options.ports, {
    timeoutMs: options.timeoutMs,
    dryRun: options.dryRun,
  })
  process.exitCode = result.ok ? 0 : 1
}

if (isMainModule()) {
  main().catch((err) => {
    console.error(err && err.message ? err.message : err)
    process.exitCode = 1
  })
}
