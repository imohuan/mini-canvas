#!/usr/bin/env node
/**
 * watch —— 插件热重载的本地半（用户口径的最终形态，**零 SSE、零自建服务**）。
 *
 *   pnpm watch
 *
 * 做两件事：
 * 1. **盯 src/**：文件一变就自动 vite build（构建失败不通知 —— 半成品不该进画布）；
 * 2. **build 成功后发一条 HTTP PUT**：
 *      PUT {后台}/api/kv/config/plugin-watch:<插件名>   值 = { t: 时间戳 }
 *    后台的 KV 实时通道（/api/kv/events，现成）会把它推给所有打开的画布页；
 *    画布里的热重载监听看到 key 前缀就**读这条值里的地址**，按它拉新产物重装。
 *
 * 值里带什么（用户口径：地址由上报方给出，读取方不再猜目录）：
 *   {
 *     "t": 1760000000000,
 *     "front":  "http://127.0.0.1:8865/plugins/<包目录>/<产物>.js",  // 浏览器可直接请求
 *     "server": "D:\\work\\my-plugin\\dist\\server.js"                // 后台可直接读的磁盘路径（有才带）
 *   }
 * 地址就是"这个插件此刻在哪"的唯一真相源；插件换目录、换端口，改这里即可，
 * 画布和后台都不需要重新配置。
 *
 * 全程只需要后台在跑（开发时它本来就在跑）。无自建端口、无 SSE 客户端、无声明文件。
 *
 * ## 另外还要发心跳（协议见 docs/plugin-dev/10-debug-protocol.md）
 *
 *   POST /api/plugin-presence/heartbeat  { name, instance, state, front?, server?, message? }
 *   POST /api/plugin-presence/leave      { name, instance }
 *
 * 为什么：产物记录只说明「某次构建成功过」，不说明 watch 还在跑。
 * 心跳每 10 秒一次，**构建期间也照发**（长构建不能被误判掉线）；
 * 正常退出补一条 leave，界面立刻显示「已停止」而不是等 30 秒超时。
 *
 * ⚠️ 本脚本只是**参考实现**：构建工具随便换，只要按协议发这几条 HTTP 就行。
 * 插件名取自 package.json 的 miniCanvas.pluginName（退回落包名去作用域）。
 * 后台地址：--backend 或环境变量 MINI_CANVAS_BACKEND，缺省 http://127.0.0.1:8865。
 */
import { watch } from 'chokidar'
import { spawn } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PKG_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const SRC_DIR = join(PKG_ROOT, 'src')
const BACKEND = (process.argv.includes('--backend')
  ? process.argv[process.argv.indexOf('--backend') + 1]
  : process.env.MINI_CANVAS_BACKEND) || 'http://127.0.0.1:8865'

/**
 * 前端产物地址（浏览器请求用）。
 * 缺省：按后台的插件托管规则拼出来（/plugins/<包目录>/<产物文件名>）。
 * 插件不在后台插件目录里时，用 --front 明确给一个浏览器能打开的地址。
 */
const FRONT_OVERRIDE = process.argv.includes('--front')
  ? process.argv[process.argv.indexOf('--front') + 1]
  : process.env.MINI_CANVAS_PLUGIN_FRONT

/**
 * 后端产物路径（后台机器上的绝对路径）。
 * 缺省：dist/server.js（存在才带）；不存在就只上报前端半。
 */
const SERVER_OVERRIDE = process.argv.includes('--server')
  ? process.argv[process.argv.indexOf('--server') + 1]
  : process.env.MINI_CANVAS_PLUGIN_SERVER

/** 插件身份：package.json 的 miniCanvas.pluginName（前端按它卸旧装新） */
const pkg = JSON.parse(readFileSync(join(PKG_ROOT, 'package.json'), 'utf8'))
const PLUGIN_NAME = pkg.miniCanvas?.pluginName || String(pkg.name || '').replace(/^@[^/]+\//, '')
/** 包目录名：后台的 /plugins/<包目录>/<文件> 用的就是它 */
const PKG_DIR = PKG_ROOT.split(/[\\/]/).filter(Boolean).pop() || PLUGIN_NAME
const KV_URL = BACKEND + '/api/kv/config/plugin-watch:' + encodeURIComponent(PLUGIN_NAME)
const HEARTBEAT_URL = BACKEND + '/api/plugin-presence/heartbeat'
const LEAVE_URL = BACKEND + '/api/plugin-presence/leave'
/** 本 watch 进程的唯一 id：同一插件跑两个 watch 时靠它区分（界面上会提示多实例） */
const INSTANCE = process.pid + '-' + Math.random().toString(36).slice(2, 8)
/** 心跳间隔（协议建议 10 秒；后台 30 秒判失联） */
const HEARTBEAT_MS = 10_000
/** 当前监听状态：watching / building / failed / paused */
let presenceState = 'watching'
let presenceMessage = ''

/** 找 dist 里的前端产物（与 vite.config 的 fileName 一致） */
function frontUrlNow() {
  if (FRONT_OVERRIDE) return FRONT_OVERRIDE
  return BACKEND.replace(/\/+$/, '') + '/plugins/' + PKG_DIR + '/' + PLUGIN_NAME + '.js'
}

/** 找后端产物路径（dist/server.js / plugin-server.js） */
function serverPathNow() {
  if (SERVER_OVERRIDE) return resolve(SERVER_OVERRIDE)
  for (const name of ['server.js', 'plugin-server.js']) {
    const p = join(PKG_ROOT, 'dist', name)
    if (existsSync(p)) return p
  }
  return undefined
}

/**
 * 发一次心跳。失败只打一行日志，不打断构建（后台没起时调试照样能编）。
 * 用「发出去就不等」的方式：心跳不该拖慢构建。
 */
function beat(state = presenceState, message = presenceMessage) {
  const body = {
    name: PLUGIN_NAME,
    instance: INSTANCE,
    state,
    ...(frontUrlNow() ? { front: frontUrlNow() } : {}),
    ...(serverPathNow() ? { server: serverPathNow() } : {}),
    ...(message ? { message } : {}),
  }
  void fetch(HEARTBEAT_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => {})
}

/** 正常退出：先告别（最多等 500ms），再退出 */
async function sayGoodbye() {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 500)
  try {
    await fetch(LEAVE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: PLUGIN_NAME, instance: INSTANCE }),
      signal: ctrl.signal,
    })
  } catch {
    /* 后台已经不在：没什么可告别的 */
  } finally {
    clearTimeout(timer)
  }
}

let building = false
/** 防抖：一次保存会触发一串 change 事件，等 200ms 静默了再 build */
let debounce = null

async function buildOnce(reason) {
  if (building) return
  building = true
  // 构建开始：先把状态报上去（长构建期间心跳会一直重复这个状态，不会被判成掉线）
  presenceState = 'building'
  presenceMessage = ''
  beat()
  const t0 = Date.now()
  try {
    await new Promise((resolve, reject) => {
      const child = spawn('pnpm', ['build'], { cwd: PKG_ROOT, shell: true, stdio: 'pipe' })
      let out = ''
      child.stdout.on('data', (d) => { out += d })
      child.stderr.on('data', (d) => { out += d })
      child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('vite build exit ' + code + '\n' + out.slice(-600)))))
    })
    // build 成功才通知（半成品不进画布）。值里带地址：读取方不需要知道插件目录在哪。
    const front = frontUrlNow()
    const serverPath = serverPathNow()
    const value = {
      t: Date.now(),
      ...(front ? { front } : {}),
      ...(serverPath ? { server: serverPath } : {}),
    }
    const res = await fetch(KV_URL, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value }),
    })
    console.log(
      '[watch] built in ' + (Date.now() - t0) + 'ms (' + reason + ') → 通知 ' +
        (res.ok ? 'OK' : '失败 ' + res.status) + ' | front=' + (front || '-') +
        (serverPath ? ' | server=' + serverPath : ''),
    )
    presenceState = 'watching'
    presenceMessage = ''
    beat()
  } catch (err) {
    console.error('[watch] build failed:', err?.message ?? err)
    // 构建失败要如实报：界面显示「构建失败」，但仍算在线（进程还活着、还能重试）
    presenceState = 'failed'
    presenceMessage = '构建失败：' + String(err?.message ?? err).slice(0, 300)
    beat()
  } finally {
    building = false
  }
}

function scheduleBuild(file) {
  if (debounce) clearTimeout(debounce)
  debounce = setTimeout(() => void buildOnce(file), 200)
}

watch(SRC_DIR, { ignoreInitial: true, awaitWriteFinish: { stabilityThreshold: 80 } })
  .on('change', scheduleBuild)
  .on('add', scheduleBuild)
  .on('unlink', scheduleBuild)

console.log('[watch] 盯着 src/（插件: ' + PLUGIN_NAME + '）')
console.log('[watch] 变更 → 自动 build → 通知 ' + KV_URL)
console.log('[watch] 上报地址：front=' + frontUrlNow() + (serverPathNow() ? ' | server=' + serverPathNow() : ''))
console.log('[watch] 改地址：--front <浏览器可访问的地址> / --server <后台产物绝对路径>')
console.log('[watch] 心跳 ' + HEARTBEAT_URL + '（实例 ' + INSTANCE + '）')
console.log('[watch] Ctrl+C 停止')

// 启动立刻报一次在线，之后定期心跳（构建期间也照发：长构建不能被误判掉线）
beat()
const heartbeatTimer = setInterval(() => beat(), HEARTBEAT_MS)
heartbeatTimer.unref?.()

// Ctrl+C / 正常退出：先告别再走（被强杀时只能靠 30 秒超时发现）
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    clearInterval(heartbeatTimer)
    void sayGoodbye().finally(() => process.exit(0))
  })
}
