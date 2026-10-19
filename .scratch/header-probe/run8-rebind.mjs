/**
 * 探针 I：DNS 重绑定能不能绕过「Origin 必须等于 Host」这条规则？
 *
 * 做法：把 rebind.test 解析到 127.0.0.1（--host-resolver-rules），
 * 页面从 http://rebind.test:PORT 打开，再用**相对路径** fetch 同一个源。
 * 浏览器认为这是同源请求，于是 Origin 和 Host 都是 rebind.test:PORT。
 *
 * 结论用来判断：requestTrust 里的哪一条规则是真正承重的。
 */
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire('D:/Code/Git/mini-canvas/packages/cloud-server/package.json')
const { Hono } = require('hono')
const { cors } = require('hono/cors')
const { serve } = require('@hono/node-server')

const CHROME = process.env.CHROME_EXE ??
  'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe'

const seen = []
const app = new Hono()
app.use('*', cors())
app.get('/api/write', (c) => {
  seen.push({ host: c.req.header('host') ?? null, origin: c.req.header('origin') ?? null })
  return c.json({ ok: true, secret: 'internal-data' })
})
// 页面本身：模拟「恶意站点被重绑定到 127.0.0.1」
app.get('/', (c) => c.html(`<!doctype html><meta charset="utf-8"><body><script>
  window.__out = [];
  window.__go = async function () {
    try {
      var r = await fetch('/api/write');
      __out.push('同源（按名字）fetch 成功，status=' + r.status + ' body=' + (await r.text()));
    } catch (e) { __out.push('被拦：' + e.message); }
    return __out;
  };
</script></body>`))

const server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' })
const port = await new Promise((r) => server.once('listening', () => r(server.address().port)))

const userDataDir = mkdtempSync(path.join(os.tmpdir(), 'mc-probe8-'))
const chrome = spawn(CHROME, [
  '--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + userDataDir,
  '--no-first-run', '--no-default-browser-check', '--no-proxy-server', '--proxy-bypass-list=*',
  `--host-resolver-rules=MAP rebind.test 127.0.0.1, MAP evil.test 127.0.0.1`,
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
await send('Page.navigate', { url: `http://rebind.test:${port}/` })
await new Promise((r) => setTimeout(r, 1200))
const res = await send('Runtime.evaluate', { expression: 'window.__go()', awaitPromise: true, returnByValue: true })
console.log('=== 重绑定页面看到的结果 ===')
console.log(JSON.stringify(res.result?.result?.value ?? res.result, null, 2))
console.log('=== 服务端收到的 Host / Origin ===')
console.log(JSON.stringify(seen, null, 2))

ws.close(); chrome.kill(); server.close()
process.exit(0)
