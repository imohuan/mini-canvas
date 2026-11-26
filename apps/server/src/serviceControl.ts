/**
 * 服务进程管理：后台启动用的状态文件、停止服务、查端口占用。
 *
 * 为什么需要它：`serve` 是前台常驻进程（占着终端，Ctrl+C 才停），
 * 而很多人希望「起好就走」，之后随手一句 `stop` 关掉。
 * 这里只管进程层面的事，不碰 HTTP 与插件。
 *
 * 两条约束：
 * 1. 状态文件（<数据根>/server-state.json）只记一个小 JSON：pid / 端口 / 日志路径。
 *    前台 serve 也会写一份，`stop` 才能精确关掉它。
 * 2. 端口的兜底扫描只认「像 plume-canvas 的进程」（命令行里有 plume-canvas，
 *    或 cli.js/cli.ts + serve）。别人家的程序在占端口就只报告、不动手；
 *    用户确认真要关，才加 --force。
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'

export interface ServerState {
  pid: number
  port: number
  url: string
  startedAt: string
  /** 后台启动时的日志文件（前台 serve 不写这个字段） */
  logFile?: string
  /** 启动入口（dist/cli.js 或 src/cli.ts），排查用 */
  entry?: string
}

export interface PortEntry {
  pid: number
  command: string
}

export interface StopResult {
  port: number
  /** 真正结束掉的进程 */
  killed: PortEntry[]
  /** 看起来不像 plume-canvas、没有动的进程 */
  refused: PortEntry[]
  /** 端口上原来有没有监听者 */
  wasRunning: boolean
  /** 结束后端口是否已经空出来 */
  freed: boolean
}

export function serverStateFile(dataDir: string): string {
  return path.join(path.resolve(dataDir), 'server-state.json')
}

export function serverLogFile(dataDir: string): string {
  return path.join(path.resolve(dataDir), 'server.log')
}

export function readServerState(dataDir: string): ServerState | null {
  try {
    const raw = JSON.parse(fs.readFileSync(serverStateFile(dataDir), 'utf8')) as Partial<ServerState>
    if (typeof raw.pid !== 'number' || !Number.isInteger(raw.pid) || raw.pid <= 0) return null
    if (typeof raw.port !== 'number' || !Number.isInteger(raw.port) || raw.port <= 0) return null
    return {
      pid: raw.pid,
      port: raw.port,
      url: typeof raw.url === 'string' ? raw.url : '',
      startedAt: typeof raw.startedAt === 'string' ? raw.startedAt : '',
      ...(typeof raw.logFile === 'string' ? { logFile: raw.logFile } : {}),
      ...(typeof raw.entry === 'string' ? { entry: raw.entry } : {}),
    }
  } catch {
    return null
  }
}

/** 写状态文件：同步写，进程刚起来就要能被 stop 看见，异步会留出空窗 */
export function writeServerState(dataDir: string, state: ServerState): void {
  try {
    const file = serverStateFile(dataDir)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(state, null, 2) + '\n', 'utf8')
  } catch {
    // 状态文件只是方便 stop，写不进去不该拦服务启动
  }
}

/** 清状态文件；给了 pid 时只清自己那一份，避免误删另一个实例的记录 */
export function clearServerState(dataDir: string, pid?: number): void {
  try {
    const file = serverStateFile(dataDir)
    if (pid !== undefined) {
      const current = readServerState(dataDir)
      if (current && current.pid !== pid) return
    }
    fs.rmSync(file, { force: true })
  } catch {
    // 删不掉就留着，stop 会判定 pid 已死并覆盖
  }
}

export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 跑一个命令收输出；命令不存在 / 退出码非 0 都不抛异常 */
function runCapture(command: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    } catch (err) {
      resolve({ code: -1, stdout: '', stderr: String(err) })
      return
    }
    let stdout = ''
    let stderr = ''
    // Windows 自带命令输出常是 GBK，按系统代码页解码，免得中文提示乱码
    const decoding = process.platform === 'win32' ? new TextDecoder('gbk') : new TextDecoder('utf-8')
    child.stdout.on('data', (data: Buffer) => {
      stdout += decoding.decode(data, { stream: true })
    })
    child.stderr.on('data', (data: Buffer) => {
      stderr += decoding.decode(data, { stream: true })
    })
    child.stdout.on('end', () => {
      stdout += decoding.decode()
    })
    child.stderr.on('end', () => {
      stderr += decoding.decode()
    })
    child.on('error', (err) => resolve({ code: -1, stdout, stderr: String(err) }))
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }))
  })
}

/** 正在监听该端口的 PID（Windows 走 netstat，其它平台走 lsof / ss） */
export async function listeningPids(port: number): Promise<number[]> {
  if (process.platform === 'win32') {
    const r = await runCapture('netstat', ['-ano'])
    if (r.code !== 0) return []
    const pids = new Set<number>()
    for (const line of r.stdout.split(/\r?\n/)) {
      const parts = line.trim().split(/\s+/)
      if (parts.length < 5) continue
      if (parts[0].toUpperCase() !== 'TCP') continue
      if (parts[3].toUpperCase() !== 'LISTENING') continue
      if (!parts[1].endsWith(':' + port)) continue
      const pid = Number(parts[4])
      if (pid > 0) pids.add(pid)
    }
    return [...pids]
  }

  const lsof = await runCapture('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'])
  if (lsof.code === 0) {
    return [...new Set(lsof.stdout.split(/\s+/).map(Number).filter((n) => n > 0))]
  }
  const ss = await runCapture('ss', ['-ltnp', `sport = :${port}`])
  if (ss.code === 0) {
    return [...new Set([...ss.stdout.matchAll(/pid=(\d+)/g)].map((m) => Number(m[1])).filter((n) => n > 0))]
  }
  return []
}

/** 进程的完整命令行；读不到返回空串（权限不够是常见原因） */
export async function processCommandLine(pid: number): Promise<string> {
  if (process.platform === 'win32') {
    const r = await runCapture('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" -ErrorAction SilentlyContinue).CommandLine`,
    ])
    return r.code === 0 ? r.stdout.trim() : ''
  }
  const r = await runCapture('ps', ['-o', 'command=', '-p', String(pid)])
  return r.code === 0 ? r.stdout.trim() : ''
}

/**
 * 这行命令像不像 plume-canvas 服务（防止 stop 误杀别人家的进程）。
 *
 * 两种情况：
 * - 命令行里有 plume-canvas（npx 装下来的路径带包名）；
 * - 仓库开发态：路径里有 canvas + 跑着 cli.js/cli.ts 的 serve 子命令。
 * 只凭 `cli.js serve` 不够——别的项目也可能这么起，不能替用户做主杀掉。
 */
export function isPlumeServerCommand(command: string): boolean {
  if (!command) return false
  if (/plume[-_ ]?canvas/i.test(command)) return true
  return /cli\.(?:js|ts)\b.*\bserve\b/i.test(command) && /canvas/i.test(command)
}

export async function killProcessTree(pid: number): Promise<boolean> {
  if (!Number.isInteger(pid) || pid <= 4) return false
  if (process.platform === 'win32') {
    // /T 连子进程一起结束（npx / pnpm 会多套一层），/F 强制
    const r = await runCapture('taskkill', ['/PID', String(pid), '/T', '/F'])
    return r.code === 0
  }
  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    return true
  }
  for (let i = 0; i < 20; i++) {
    await sleep(100)
    if (!isProcessAlive(pid)) return true
  }
  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    // 已经退出
  }
  await sleep(100)
  return !isProcessAlive(pid)
}

/** 端口上有没有东西在听：连一下最快，也不依赖系统工具 */
export async function isPortBusy(port: number, hostname = '127.0.0.1', timeoutMs = 600): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (busy: boolean): void => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(busy)
    }
    const socket = net.connect({ port, host: hostname })
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    // 超时说明本机这个端口没人应答（不是监听者），别误报占用
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

export async function waitForPortFree(port: number, hostname = '127.0.0.1', timeoutMs = 5000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (!(await isPortBusy(port, hostname))) return true
    if (Date.now() >= deadline) return false
    await sleep(150)
  }
}

/** 查端口上是谁：PID + 命令行（命令行读不到的留空） */
export async function describePort(port: number): Promise<{ pids: number[]; entries: PortEntry[] }> {
  const pids = await listeningPids(port)
  const entries: PortEntry[] = []
  for (const pid of pids) entries.push({ pid, command: await processCommandLine(pid) })
  return { pids, entries }
}

/**
 * 停服务：先按状态文件里的 pid 关，再扫端口兜底（前台 serve 没状态文件也能关）。
 */
export async function stopServer(opts: {
  dataDir: string
  port: number
  force?: boolean
  waitMs?: number
}): Promise<StopResult> {
  const killed: PortEntry[] = []
  const refused: PortEntry[] = []
  const state = readServerState(opts.dataDir)
  let statePid: number | undefined

  if (state && isProcessAlive(state.pid)) {
    statePid = state.pid
    const command = await processCommandLine(state.pid)
    if (await killProcessTree(state.pid)) {
      killed.push({ pid: state.pid, command })
    } else {
      refused.push({ pid: state.pid, command })
    }
    clearServerState(opts.dataDir, state.pid)
  } else if (state) {
    // pid 已经不在了：清掉过期记录，免得下次 stop 又去找它
    clearServerState(opts.dataDir, state.pid)
  }

  const pids = await listeningPids(opts.port)
  for (const pid of pids) {
    if (pid === statePid) continue
    const command = await processCommandLine(pid)
    if (!opts.force && !isPlumeServerCommand(command)) {
      refused.push({ pid, command })
      continue
    }
    if (await killProcessTree(pid)) killed.push({ pid, command })
    else refused.push({ pid, command })
  }

  const freed = await waitForPortFree(opts.port, '127.0.0.1', opts.waitMs ?? 5000)
  return { port: opts.port, killed, refused, wasRunning: pids.length > 0 || killed.length > 0, freed }
}
