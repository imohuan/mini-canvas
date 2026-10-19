/**
 * 探针 N：到底哪些写请求能在「不放 CORS」的情况下直达服务端（副作用发生）？
 *
 * 逐条验证：POST text/plain、POST form-urlencoded、POST json、PUT text/plain、
 * PUT json、DELETE、以及带 x-admin-token 的 POST。
 */
import http from 'node:http'
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const CHROME = process.env.CHROME_EXE ??
  'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe'

const hits = []

// 目标：**不放任何 CORS 头**
const target = http.createServer((req, res) => {
  let body = ''
  req.on('data', (d) => { body += d })
  req.on('end', () => {
    hits.push({ method: req.method, path: req.url, origin: req.headers.origin ?? null })
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end('{"ok":true}')
  })
})
await new Promise((r) => target.listen(0, '127.0.0.1', r))
const targetPort = target.address().port

const evilHtml = `<!doctype html><meta charset="utf-8"><body><script>
  var API = 'http://127.0.0.1:${targetPort}';
  window.__out = [];
  window.__go = async function () {
    var cases = [
      ['POST text/plain', '/c1', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'x' }],
      ['POST form', '/c2', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'a=1' }],
      ['POST json', '/c3', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }],
      ['PUT text/plain', '/c4', { method: 'PUT', headers: { 'content-type': 'text/plain' }, body: 'x' }],
      ['PUT json', '/c5', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{}' }],
      ['DELETE', '/c6', { method: 'DELETE' }],
      ['POST json + token', '/c7', { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-token': 'x' }, body: '{}' }],
      ['POST FormData', '/c8', { method: 'POST', body: (function(){ var f = new FormData(); f.append('a','1'); return f; })() }],
    ];
    for (var i = 0; i < cases.length; i++) {
      var c = cases[i];
      try {
        var r = await fetch(API + c[1], c[2]);
        __out.push('✅ 能读到响应 ' + c[0] + ' status=' + r.status);
      } catch (e) {
        __out.push('❌ 读不到 ' + c[0] + '（' + e.message + '）');
      }
    }
    return __out;
  };
</script></body>`

const evil = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  res.end(evilHtml)
})
await new Promise((r) => evil.listen(0, '0.0.0.0', r))
const evilPort = evil.address().port

const userDataDir = mkdtempSync(path.join(os.tmpdir(), 'mc-probe10-'))
const chrome = spawn(CHROME, [
  '--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + userDataDir,
  '--no-first-run', '--no-default-browser-check', '--no-proxy-server', '--proxy-bypass-list=*',
  '--host-resolver-rules=MAP evil.test 127.0.0.1', 'about:blank',
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
await send('Page.navigate', { url: `http://evil.test:${evilPort}/` })
await new Promise((r) => setTimeout(r, 1000))
const res = await send('Runtime.evaluate', { expression: 'window.__go()', awaitPromise: true, returnByValue: true })

console.log('=== 页面视角 ===')
for (const line of res.result?.result?.value ?? []) console.log(' ', line)

console.log('\n=== 服务端收到的请求（出现 = 副作用已发生）===')
const byPath = new Map()
for (const h of hits) byPath.set(h.path, h)
const labelOf = {
  '/c1': 'POST text/plain', '/c2': 'POST form', '/c3': 'POST json',
  '/c4': 'PUT text/plain', '/c5': 'PUT json', '/c6': 'DELETE',
  '/c7': 'POST json + token', '/c8': 'POST FormData',
}
for (const [p, label] of Object.entries(labelOf)) {
  const h = byPath.get(p)
  console.log(' ', label.padEnd(22), h ? '✅ 到达了（' + h.method + '）' : '— 没到（预检被拦）')
}

ws.close(); chrome.kill(); target.close(); evil.close()
process.exit(0)
