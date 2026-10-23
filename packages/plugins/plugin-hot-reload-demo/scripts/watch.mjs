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

let building = false
/** 防抖：一次保存会触发一串 change 事件，等 200ms 静默了再 build */
let debounce = null

async function buildOnce(reason) {
  if (building) return
  building = true
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
  } catch (err) {
    console.error('[watch] build failed:', err?.message ?? err)
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
console.log('[watch] Ctrl+C 停止')
