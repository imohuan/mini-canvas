#!/usr/bin/env node
/**
 * watch —— bottom-bar 的调试监听（协议见 docs/plugin-dev/10-debug-protocol.md）。
 *
 *   pnpm watch
 *
 * 与旧版的区别（都是真踩过的坑，别改回去）：
 * 1. **不跨包引依赖**。旧版从 plugin-hot-reload-demo 的 node_modules 里 import chokidar，
 *    demo 包一动（重装依赖 / 被删）这里立刻崩。本版用 Node 自带的 fs.watch，零依赖。
 * 2. **构建期间不丢变更**。旧版 building=true 时直接 return —— 你在构建那 1~2 秒里
 *    再保存一次，那次改动就静默没了。本版记 pending，构建完立刻补跑。
 * 3. **接入心跳**。产物记录只说明「构建成功过」，不说明 watch 活着；
 *    没心跳时调试页只能显示「未上报心跳」。构建期间心跳也照发（长构建不被误判掉线）。
 *
 * 值里带地址（唯一真相源，读取方不猜目录）：
 *   { t, front: "http://…/plugins/<包目录>/<产物>.js", server?: "D:\\…\\dist\\server.js" }
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, watch as fsWatch } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PKG_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const SRC_DIR = join(PKG_ROOT, 'src')
const BACKEND = (process.argv.includes('--backend')
  ? process.argv[process.argv.indexOf('--backend') + 1]
  : process.env.MINI_CANVAS_BACKEND) || 'http://127.0.0.1:8865'

/** 前端产物地址覆盖（产物不在后台插件目录里时用） */
const FRONT_OVERRIDE = process.argv.includes('--front')
  ? process.argv[process.argv.indexOf('--front') + 1]
  : process.env.MINI_CANVAS_PLUGIN_FRONT
/** 后台产物路径覆盖（跨机器调试时不要带） */
const SERVER_OVERRIDE = process.argv.includes('--server')
  ? process.argv[process.argv.indexOf('--server') + 1]
  : process.env.MINI_CANVAS_PLUGIN_SERVER

const pkg = JSON.parse(readFileSync(join(PKG_ROOT, 'package.json'), 'utf8'))
const PLUGIN_NAME = pkg.miniCanvas?.pluginName || String(pkg.name || '').replace(/^@[^/]+\//, '')
const PKG_DIR = PKG_ROOT.split(/[\\/]/).filter(Boolean).pop() || PLUGIN_NAME
const KV_URL = BACKEND + '/api/kv/config/plugin-watch:' + encodeURIComponent(PLUGIN_NAME)
const HEARTBEAT_URL = BACKEND + '/api/plugin-presence/heartbeat'
const LEAVE_URL = BACKEND + '/api/plugin-presence/leave'
/** 本 watch 进程的唯一 id（同一插件跑两个 watch 时，调试页会提示多实例） */
const INSTANCE = process.pid + '-' + Math.random().toString(36).slice(2, 8)
const HEARTBEAT_MS = 10_000

/** dist 里的前端产物（实际扫描，避免 vite fileName 与插件名不一致时拼错） */
function frontUrlNow() {
  if (FRONT_OVERRIDE) return FRONT_OVERRIDE
  const distDir = join(PKG_ROOT, 'dist')
  if (existsSync(distDir)) {
    const found = readdirSync(distDir).find((f) => f === PLUGIN_NAME + '.js' || (f.endsWith('.js') && !f.endsWith('.min.js')))
    if (found) return BACKEND.replace(/\/+$/, '') + '/plugins/' + PKG_DIR + '/' + found
  }
  return BACKEND.replace(/\/+$/, '') + '/plugins/' + PKG_DIR + '/' + PLUGIN_NAME + '.js'
}

function serverPathNow() {
  if (SERVER_OVERRIDE) return resolve(SERVER_OVERRIDE)
  for (const name of ['server.js', 'plugin-server.js']) {
    const p = join(PKG_ROOT, 'dist', name)
    if (existsSync(p)) return p
  }
  return undefined
}

/** 心跳 / 产物上报共用的属性包（少一处不一致） */
function presenceProps() {
  const front = frontUrlNow()
  const server = serverPathNow()
  return { ...(front ? { front } : {}), ...(server ? { server } : {}) }
}

/** 心跳。失败静默：后台没起 / 没开在场通道时，构建照样能跑 */
function beat(state, message) {
  const body = {
    name: PLUGIN_NAME,
    instance: INSTANCE,
    state,
    ...presenceProps(),
    ...(message ? { message } : {}),
  }
  void fetch(HEARTBEAT_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
    .then((res) => {
      // 后台没开调试开关时这里是 404 —— 不说清，用户会一直盯着「未上报心跳」找不到原因
      if (!res.ok && !hbWarned) {
        hbWarned = true
        console.error(
          '[watch] 心跳被后台拒绝（HTTP ' + res.status + '）：' +
            (res.status === 404
              ? '后台没开启调试在场通道。启动后台前设置 $env:MINI_CANVAS_DEBUG_PRESENCE=1 并重启。'
              : '后台返回异常。'),
        )
      }
    })
    .catch(() => {
      // 连不上（后台没起）：只警告一次，别每 10 秒刷屏
      if (!hbWarned) {
        hbWarned = true
        console.error('[watch] 心跳发不出去（后台没起？' + HEARTBEAT_URL + '）——构建与产物上报不受影响')
      }
    })
}

/**
 * **启动上报**：把当前 dist 里已有的产物先登记一遍（不构建）。
 *
 * 为什么需要：调试页的行来自**产物记录**（`plugin-watch:<名>`），心跳只管「在不在线」。
 * 只发心跳的话，watch 挂着但一行都不出现，用户会以为脚本没生效（真机踩到）。
 * dist 还没有产物时也发（只有 t）—— 这样调试页至少能看到这一行，地址在首次构建后补上。
 */
async function reportArtifacts(reason) {
  const { front, server } = presenceProps()
  try {
    const res = await fetch(KV_URL, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: { t: Date.now(), ...(front ? { front } : {}), ...(server ? { server } : {}) } }),
    })
    console.log('[watch] ' + reason + ' → 产物记录 ' + (res.ok ? 'OK' : '失败 ' + res.status) + ' | front=' + (front || '-'))
    if (!res.ok) console.error('[watch] 后台拒绝了产物记录（HTTP ' + res.status + '）——检查后台是否在跑、地址是否正确')
  } catch (err) {
    console.error('[watch] 产物记录发不出去（后台没起？）：' + String(err?.cause?.code ?? err?.message ?? err))
  }
}

/** 正常退出时的告别（最多等 500ms，不阻塞退出） */
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
    /* 后台不在了：没什么可告别 */
  } finally {
    clearTimeout(timer)
  }
}

let building = false
/** 构建期间又来了变更 → 记下来，构建完立刻补跑（旧版这里直接丢，改动会静默消失） */
let pending = false
let debounce = null
let presenceState = 'watching'
let presenceMessage = ''
/** 心跳失败只警告一次（每 10 秒打一遍就是刷屏） */
let hbWarned = false

async function buildOnce(reason) {
  if (building) {
    pending = true
    return
  }
  building = true
  presenceState = 'building'
  presenceMessage = ''
  beat(presenceState)
  const t0 = Date.now()
  try {
    await new Promise((resolve, reject) => {
      const child = spawn('pnpm', ['build'], { cwd: PKG_ROOT, shell: true, stdio: 'pipe' })
      let out = ''
      child.stdout.on('data', (d) => { out += d })
      child.stderr.on('data', (d) => { out += d })
      child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('vite build exit ' + code + '\n' + out.slice(-800)))))
    })
    const { front, server } = presenceProps()
    const res = await fetch(KV_URL, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: { t: Date.now(), ...(front ? { front } : {}), ...(server ? { server } : {}) } }),
    })
    if (!res.ok) console.error('[watch] 后台拒绝了产物记录（HTTP ' + res.status + '）——检查后台是否在跑、地址是否正确')
    presenceState = 'watching'
    presenceMessage = ''
    console.log(
      '[watch] built in ' + (Date.now() - t0) + 'ms (' + reason + ') → 通知 ' +
        (res.ok ? 'OK' : '失败 ' + res.status) + ' | front=' + (front || '-') +
        (server ? ' | server=' + server : ''),
    )
  } catch (err) {
    // 如实上报失败：调试页显示「构建失败」+ 原因，但仍算在线（进程活着，能重试）
    presenceState = 'failed'
    presenceMessage = '构建失败：' + String(err?.message ?? err).slice(0, 300)
    console.error('[watch] build failed:', err?.message ?? err)
  } finally {
    building = false
    beat(presenceState, presenceMessage)
    if (pending) {
      pending = false
      scheduleBuild('pending-changes')
    }
  }
}

function scheduleBuild(file) {
  if (debounce) clearTimeout(debounce)
  debounce = setTimeout(() => {
    debounce = null
    void buildOnce(String(file ?? ''))
  }, 200)
}

/**
 * 盯 src/：Node 自带 fs.watch，零依赖（旧版跨包引 chokidar 是真坑）。
 * recursive: true —— Windows 支持子目录；Node ≥20 在 Linux/macOS 也支持。
 * 编辑器保存常见的「先删临时文件再改名」会被防抖窗口归并，不需要逐事件精确处理。
 */
const watcher = fsWatch(SRC_DIR, { recursive: true }, (_event, file) => {
  scheduleBuild(file)
})
watcher.on('error', (err) => {
  console.error('[watch] 目录监听出错（文件保存可能不再触发构建，请重启本脚本）：', err?.message ?? err)
  presenceState = 'paused'
  presenceMessage = '目录监听出错，请重启 watch'
  beat(presenceState, presenceMessage)
})

console.log('[watch] bottom-bar · 盯着 src/（插件: ' + PLUGIN_NAME + '）')
console.log('[watch] 变更 → 自动 build → 通知 ' + KV_URL)
console.log('[watch] 上报地址：front=' + frontUrlNow() + (serverPathNow() ? ' | server=' + serverPathNow() : ''))
console.log('[watch] 改地址：--front <浏览器可访问的地址> / --server <后台产物绝对路径> / --backend <后台地址>')
console.log('[watch] 心跳 ' + HEARTBEAT_URL + '（实例 ' + INSTANCE + '，' + HEARTBEAT_MS / 1000 + 's）')
console.log('[watch] Ctrl+C 停止')

// 启动：① 把当前 dist 里的产物先登记一遍（调试页的行由此而来）；② 报在线。
// 之后定期心跳（构建期间也照发）。心跳打不通会在 beat 里打一行提示。
void reportArtifacts('启动上报')
beat(presenceState)
const heartbeatTimer = setInterval(() => beat(presenceState, presenceMessage), HEARTBEAT_MS)
heartbeatTimer.unref?.()

// Ctrl+C / 正常退出：先告别再走（强杀时只能靠 30 秒超时发现）
let stopping = false
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    if (stopping) return
    stopping = true
    clearInterval(heartbeatTimer)
    watcher.close()
    void sayGoodbye().finally(() => process.exit(0))
  })
}
