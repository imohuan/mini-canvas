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
 *    画布里的热重载监听看到 key 前缀就对产物 HEAD 对比，变了才拉新重装。
 *
 * 全程只需要后台在跑（开发时它本来就在跑）。无自建端口、无 SSE 客户端、无声明文件。
 * 插件名取自 package.json 的 miniCanvas.pluginName（退回落包名去作用域）。
 * 后台地址：--backend 或环境变量 MINI_CANVAS_BACKEND，缺省 http://127.0.0.1:8865。
 */
import { watch } from 'chokidar'
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PKG_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const SRC_DIR = join(PKG_ROOT, 'src')
const BACKEND = (process.argv.includes('--backend')
  ? process.argv[process.argv.indexOf('--backend') + 1]
  : process.env.MINI_CANVAS_BACKEND) || 'http://127.0.0.1:8865'

/** 插件身份：package.json 的 miniCanvas.pluginName（前端按它卸旧装新） */
const pkg = JSON.parse(await import('node:fs').then(m => m.readFileSync(join(PKG_ROOT, 'package.json'), 'utf8')))
const PLUGIN_NAME = pkg.miniCanvas?.pluginName || String(pkg.name || '').replace(/^@[^/]+\//, '')
const KV_URL = BACKEND + '/api/kv/config/plugin-watch:' + encodeURIComponent(PLUGIN_NAME)

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
    // build 成功才通知（半成品不进画布）：门铃模式 —— value 只有时间戳，细节订阅方 HEAD 自己看
    const res = await fetch(KV_URL, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: { t: Date.now() } }),
    })
    console.log('[watch] built in ' + (Date.now() - t0) + 'ms (' + reason + ') → 通知 ' + (res.ok ? 'OK' : '失败 ' + res.status))
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
console.log('[watch] Ctrl+C 停止')
