#!/usr/bin/env node
/**
 * watch-server —— 热重载试验台的**自带服务**（用户口径：完全不需要 cloud-server 后台）。
 *
 *   pnpm watch  →  http://localhost:5333/sse
 *
 * 做三件事：
 * 1. **watch**：盯本插件 src/，文件一变就自动 vite build（等价于人工跑 pnpm build）；
 * 2. **SSE**：/sse 端点 —— 前端热重载面板登记这个链接，构建完成就收到一条
 *    { type: 'plugin-changed', id, name }（与 cloud-server 同一形状，前端零改动）；
 * 3. 首页 /：一行说明 + 当前状态（构建中 / 空闲 / 最近一次构建时间），浏览器打开就能看到。
 *
 * 为什么这样是"完全不需要后台"：这个服务就是插件自己的一部分（scripts/ 里的小 node 脚本），
 * 不依赖 cloud-server 在跑 —— 它自己盯自己的产物、自己发通知。前端的「热重载」面板
 * 本来就支持登记任意 SSE 地址，所以前端也不用改。
 */
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { watch } from 'chokidar'

const PKG_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const SRC_DIR = join(PKG_ROOT, 'src')
const PORT = Number(process.env.PORT || 5333)
/** 插件身份（与 package.json 的 miniCanvas.pluginName 一致，前端按它卸旧装新） */
const PLUGIN_NAME = 'hot-reload-demo'

/** /sse 的订阅者（每个前端标签页一条连接） */
const clients = new Set()
let building = false
let lastBuildAt = null
let lastChangeFile = ''

function broadcast(event) {
  const payload = 'data: ' + JSON.stringify(event) + '\n\n'
  for (const res of clients) {
    try { res.write(payload) } catch { clients.delete(res) }
  }
}

/** 构建一次（跑 pnpm build = vite build，产物与正式构建完全一致 —— UMD 头齐全，清单才认） */
async function buildOnce(reason) {
  if (building) return
  building = true
  const t0 = Date.now()
  try {
    await new Promise((resolve, reject) => {
      // Windows 下 spawn pnpm 要走 shell；产物 = dist/plugin-hot-reload-demo.js（vite.config 定义）
      const child = spawn('pnpm', ['build'], { cwd: PKG_ROOT, shell: true, stdio: 'pipe' })
      let out = ''
      child.stdout.on('data', (d) => { out += d })
      child.stderr.on('data', (d) => { out += d })
      child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('vite build exit ' + code + '\n' + out.slice(-600)))))
    })
    lastBuildAt = Date.now()
    const ms = lastBuildAt - t0
    console.log('[watch-server] built in ' + ms + 'ms (' + reason + ') → SSE 通知 ' + clients.size + ' 个订阅者')
    // 通知前端重装（形状与 cloud-server 的 /api/plugin-events 完全一致）
    broadcast({ type: 'plugin-changed', id: 'plugin-hot-reload-demo', name: PLUGIN_NAME })
  } catch (err) {
    console.error('[watch-server] build failed:', err?.message ?? err)
  } finally {
    building = false
  }
}

/** 防抖：一次保存会触发一串 change 事件，等 150ms 静默了再 build */
let debounce = null
function scheduleBuild(file) {
  lastChangeFile = file
  if (debounce) clearTimeout(debounce)
  debounce = setTimeout(() => void buildOnce(lastChangeFile), 150)
}

// —— 盯 src ——
watch(SRC_DIR, { ignoreInitial: true, awaitWriteFinish: { stabilityThreshold: 80 } })
  .on('change', (f) => scheduleBuild(f))
  .on('add', (f) => scheduleBuild(f))
  .on('unlink', (f) => scheduleBuild(f))

// —— 起服务 ——
createServer((req, res) => {
  const url = req.url ?? '/'
  if (url === '/sse' || url.startsWith('/sse?')) {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'access-control-allow-origin': '*', // 前端可能跨源（dev :5288 连这里）
    })
    res.write(': connected\n\n')
    clients.add(res)
    req.on('close', () => clients.delete(res))
    return
  }
  if (url === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(
      '<!doctype html><meta charset="utf-8"><title>hot-reload-demo watch</title>' +
      '<body style="font-family:system-ui;max-width:560px;margin:60px auto;line-height:1.8">' +
      '<h2>热重载试验台 · watch 服务</h2>' +
      '<p>SSE 地址：<code>http://localhost:' + PORT + '/sse</code>（填进画布「设置 → 热重载」）</p>' +
      '<p>状态：' + (building ? '构建中…' : '空闲') +
      (lastBuildAt ? ' · 上次构建 ' + new Date(lastBuildAt).toLocaleTimeString() : ' · 还没构建过') + '</p>' +
      '<p>订阅者 ' + clients.size + ' 个 · 盯着 <code>src/</code>，文件一变自动 build 并推送。</p>',
    )
    return
  }
  res.writeHead(404).end()
}).listen(PORT, () => {
  console.log('[watch-server] http://localhost:' + PORT + '  （SSE: /sse）')
  console.log('[watch-server] 盯着 src/ —— 改文件即自动 build 并推 SSE')
})
