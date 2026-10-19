/**
 * 探针 B：真实拓扑对照。
 *
 * 场景（都在同一个端口，模拟 cloud-server 托管画布页 + 提供 /api/*）：
 *   1) 同源页面 fetch        → 正常的画布页写请求
 *   2) sandbox="allow-scripts" + srcdoc 的 iframe fetch → 视觉节点（真实形态）
 *   3) 另一个端口的页面 fetch → 第三方网页攻击
 *
 * 目的：看服务端能不能**只看请求头**把 2 和 3 分开。如果不能，文档第十六节要改。
 */
import http from 'node:http'
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const CHROME = process.env.CHROME_EXE ??
  'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe'

const seen = []

// 注意：srcdoc 里的 </script> 必须先转义成 <\/script>，否则会提前关掉外面的 <script> 块
const sandboxSrcdoc = `<!doctype html><meta charset="utf-8"><body><script>
  fetch('/api/write', { method: 'POST', headers: { 'content-type': 'application/json', 'x-probe': 'sandbox' }, body: '{}' })
    .then(function (r) { return r.text(); })
    .then(function (t) { parent.postMessage({ t: t }, '*'); })
    .catch(function (e) { parent.postMessage({ e: String(e) }, '*'); });
<\/script></body>`

// srcdoc 用 base64 传进页面，避免 </script> 提前截断（第一版就是踩了这个坑）
const srcdocB64 = Buffer.from(sandboxSrcdoc, 'utf8').toString('base64')

const mainHtml = `<!doctype html><meta charset="utf-8"><body>
<h1>probe</h1>
<script>
  var results = [];
  function run(label, url, init) {
    return fetch(url, init)
      .then(function (r) { return r.text(); })
      .then(function (t) { results.push(label + ' ok'); })
      .catch(function (e) { results.push(label + ' fail ' + e.message); });
  }
  window.__run = async function () {
    await run('① 同源页面 fetch', '/api/write', { method: 'POST', headers: { 'content-type': 'application/json', 'x-probe': 'same' }, body: '{}' });
    await new Promise(function (resolve) {
      var f = document.createElement('iframe');
      f.setAttribute('sandbox', 'allow-scripts');
      f.srcdoc = atob(${JSON.stringify(srcdocB64)});
      function onMsg(ev) {
        if (ev.source !== f.contentWindow) return;
        results.push('② 沙箱 srcdoc fetch ' + JSON.stringify(ev.data));
        removeEventListener('message', onMsg);
        resolve();
      }
      addEventListener('message', onMsg);
      document.body.appendChild(f);
      setTimeout(function () { results.push('② 沙箱 srcdoc: timeout'); resolve(); }, 5000);
    });
    return results;
  };
</script></body>`

function record(req) {
  const h = req.headers
  seen.push({
    method: req.method,
    url: req.url,
    probe: h['x-probe'] ?? null,
    origin: h.origin ?? null,
    referer: h.referer ? h.referer.slice(0, 60) : null,
    secFetchSite: h['sec-fetch-site'] ?? null,
    secFetchMode: h['sec-fetch-mode'] ?? null,
    secFetchDest: h['sec-fetch-dest'] ?? null,
    acrMethod: h['access-control-request-method'] ?? null,
    acrHeaders: h['access-control-request-headers'] ?? null,
  })
}

// 主服务：既托管页面，又是 API
const main = http.createServer((req, res) => {
  if (req.url?.startsWith('/api/')) {
    record(req)
    const h = req.headers
    const cors = {
      'access-control-allow-origin': h.origin ?? '*',
      'access-control-allow-methods': 'GET,POST,PUT,DELETE,PATCH',
      'access-control-allow-headers': h['access-control-request-headers'] ?? '*',
    }
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return }
    res.writeHead(200, { 'content-type': 'application/json', ...cors })
    res.end('{"ok":true}')
    return
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  res.end(mainHtml)
})
await new Promise((r) => main.listen(0, '127.0.0.1', r))
const mainPort = main.address().port
console.log('main port =', mainPort)

// 第三方站点：另一个端口，来打 mainPort 的接口
const evilHtml = `<!doctype html><meta charset="utf-8"><body><script>
  fetch('http://127.0.0.1:${mainPort}/api/write', { method: 'POST', headers: { 'content-type': 'application/json', 'x-probe': 'evil' }, body: '{}' })
    .then(function (r) { return r.text(); })
    .then(function (t) { document.title = 'done'; })
    .catch(function (e) { document.title = 'fail'; });
</script></body>`
const evil = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  res.end(evilHtml)
})
await new Promise((r) => evil.listen(0, '127.0.0.1', r))
const evilPort = evil.address().port
console.log('evil port =', evilPort)

const userDataDir = mkdtempSync(path.join(os.tmpdir(), 'mc-probe2-'))
const chrome = spawn(CHROME, [
  '--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + userDataDir,
  '--no-first-run', '--no-default-browser-check', 'about:blank',
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
const target = await (await fetch(`http://127.0.0.1:${dbgPort}/json/new?about:blank`, { method: 'PUT' })).json()
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r))

let id = 0
const pending = new Map()
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(String(ev.data))
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
  if (msg.method === 'Runtime.exceptionThrown') {
    console.log('[page-exception]', msg.params?.exceptionDetails?.exception?.description ?? msg.params?.exceptionDetails?.text)
  }
})
function send(method, params = {}) {
  const myId = ++id
  ws.send(JSON.stringify({ id: myId, method, params }))
  return new Promise((r) => pending.set(myId, r))
}

await send('Page.enable')
await send('Runtime.enable')

await send('Page.navigate', { url: `http://127.0.0.1:${mainPort}/` })
await new Promise((r) => setTimeout(r, 1000))
const runRes = await send('Runtime.evaluate', { expression: 'window.__run()', awaitPromise: true, returnByValue: true })
console.log('=== 主页面结果 ===')
console.log(JSON.stringify(runRes.result?.result?.value ?? runRes.result, null, 2))

await new Promise((r) => setTimeout(r, 400))

// 第三方站点
const evilTarget = await (await fetch(`http://127.0.0.1:${dbgPort}/json/new?about:blank`, { method: 'PUT' })).json()
const ws2 = new WebSocket(evilTarget.webSocketDebuggerUrl)
await new Promise((r) => ws2.addEventListener('open', r))
let id2 = 0
const pending2 = new Map()
ws2.addEventListener('message', (ev) => {
  const msg = JSON.parse(String(ev.data))
  if (msg.id && pending2.has(msg.id)) { pending2.get(msg.id)(msg); pending2.delete(msg.id) }
})
function send2(method, params = {}) {
  const myId = ++id2
  ws2.send(JSON.stringify({ id: myId, method, params }))
  return new Promise((r) => pending2.set(myId, r))
}
await send2('Page.enable')
await send2('Page.navigate', { url: `http://127.0.0.1:${evilPort}/` })
await new Promise((r) => setTimeout(r, 1500))

console.log('=== 服务端收到的请求 ===')
console.log(JSON.stringify(seen, null, 2))

ws.close(); ws2.close(); chrome.kill(); main.close(); evil.close()
process.exit(0)
