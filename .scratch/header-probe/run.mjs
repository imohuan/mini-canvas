/**
 * 实测探针：沙箱 iframe（sandbox="allow-scripts"，无 allow-same-origin）发请求时，
 * 浏览器到底带什么 Origin / Sec-Fetch-*。
 *
 * 为什么要实测：文档第十六节那张表里的「Origin: null + Sec-Fetch-Site: same-origin」
 * 是推断。如果实际不是这个值，requestTrust 的判断会写错。
 *
 * 用法：node run.mjs
 */
import http from 'node:http'
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const CHROME = process.env.CHROME_EXE ??
  'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe'

/** 收请求的端口：把每个请求头原样记下来 */
const seen = []
const api = http.createServer((req, res) => {
  const h = req.headers
  seen.push({
    method: req.method,
    url: req.url,
    origin: h.origin ?? null,
    secFetchSite: h['sec-fetch-site'] ?? null,
    secFetchMode: h['sec-fetch-mode'] ?? null,
    secFetchDest: h['sec-fetch-dest'] ?? null,
    acrMethod: h['access-control-request-method'] ?? null,
    acrHeaders: h['access-control-request-headers'] ?? null,
  })
  const cors = {
    'access-control-allow-origin': h.origin ?? '*',
    'access-control-allow-methods': 'GET,POST,PUT,DELETE,PATCH',
    'access-control-allow-headers': h['access-control-request-headers'] ?? '*',
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors)
    res.end()
    return
  }
  res.writeHead(200, { 'content-type': 'application/json', ...cors })
  res.end(JSON.stringify({ ok: true }))
})
await new Promise((r) => api.listen(0, '127.0.0.1', r))
const apiPort = api.address().port

const apiBase = `http://127.0.0.1:${apiPort}`

// 沙箱页：正常 HTTP 文档，但被 sandbox="allow-scripts"（无 allow-same-origin）加载 = 不透明源
const sandboxHtml = (mode) => `<!doctype html><meta charset="utf-8"><body>
<script>
  var url = ${JSON.stringify(apiBase)} + ${JSON.stringify(mode === 'json' ? '/sandbox-fetch' : '/sandbox-simple')};
  var init = ${mode === 'json'
    ? '{"method":"POST","headers":{"content-type":"application/json","x-probe":"1"},"body":"{}"}'
    : '{"method":"POST","headers":{"content-type":"text/plain"},"body":"x"}'};
  fetch(url, init)
    .then(function (r) { return r.text(); })
    .then(function (t) { parent.postMessage({ t: t }, '*'); })
    .catch(function (e) { parent.postMessage({ e: String(e) }, '*'); });
</script></body>`

const hostHtml = `<!doctype html><meta charset="utf-8"><body style="font:14px sans-serif">
<h1>header probe</h1>
<script>
  var API = ${JSON.stringify(apiBase)};
  var results = [];
  function sandboxRun(mode, label) {
    return new Promise(function (resolve) {
      var f = document.createElement('iframe');
      f.setAttribute('sandbox', 'allow-scripts');
      f.src = '/sandbox.html?mode=' + mode + '&t=' + Date.now();
      function onMsg(ev) {
        if (ev.source !== f.contentWindow) return;
        results.push(label + ': ' + JSON.stringify(ev.data));
        removeEventListener('message', onMsg);
        resolve();
      }
      addEventListener('message', onMsg);
      document.body.appendChild(f);
      setTimeout(function () { results.push(label + ': timeout'); resolve(); }, 5000);
    });
  }
  window.__run = async function () {
    try {
      await fetch(API + '/same-origin', { method: 'POST', headers: { 'content-type': 'application/json', 'x-probe': '1' }, body: '{}' });
      results.push('same-origin-fetch: ok');
    } catch (e) { results.push('same-origin-fetch: fail ' + e.message); }
    await sandboxRun('json', 'sandbox-fetch');
    await sandboxRun('simple', 'sandbox-simple');
    return results;
  };
</script></body>`

const host = http.createServer((req, res) => {
  if (req.url === '/dump') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(seen, null, 2))
    return
  }
  if (req.url?.startsWith('/sandbox.html')) {
    const mode = new URL(req.url, 'http://x').searchParams.get('mode') === 'simple' ? 'simple' : 'json'
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(sandboxHtml(mode))
    return
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  res.end(hostHtml)
})
await new Promise((r) => host.listen(0, '127.0.0.1', r))
const hostPort = host.address().port

const userDataDir = mkdtempSync(path.join(os.tmpdir(), 'mc-probe-'))
const chrome = spawn(CHROME, [
  '--headless=new',
  '--remote-debugging-port=0',
  '--user-data-dir=' + userDataDir,
  '--no-first-run',
  '--no-default-browser-check',
  'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] })

let stderr = ''
chrome.stderr.on('data', (d) => { stderr += String(d) })

// 从 stderr 里抓 DevTools 端口
const wsUrl = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('chrome 没启动：' + stderr.slice(-2000))), 20000)
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
    const d = msg.params?.exceptionDetails
    console.log('[page-exception]', d?.text, d?.exception?.description ?? '')
  }
  if (msg.method === 'Log.entryAdded') {
    console.log('[page-log]', msg.params?.entry?.text)
  }
})
function send(method, params = {}) {
  const myId = ++id
  ws.send(JSON.stringify({ id: myId, method, params }))
  return new Promise((r) => pending.set(myId, r))
}

await send('Page.enable')
await send('Runtime.enable')
await send('Page.navigate', { url: `http://127.0.0.1:${hostPort}/` })
await new Promise((r) => setTimeout(r, 1200))

const dbg = await send('Runtime.evaluate', {
  expression: 'JSON.stringify({ url: location.href, title: document.title, has: typeof window.__run, bodyLen: document.body ? document.body.innerHTML.length : -1, head: document.body ? document.body.innerHTML.slice(0, 300) : "" })',
  returnByValue: true,
})
console.log('=== 页面状态 ===')
console.log(dbg.result?.result?.value)

const res = await send('Runtime.evaluate', {
  expression: 'window.__run()',
  awaitPromise: true,
  returnByValue: true,
})
console.log('=== 页面内结果 ===')
console.log(JSON.stringify(res.result?.result?.value ?? res.result, null, 2))

await new Promise((r) => setTimeout(r, 500))

console.log('=== 服务端收到的请求头 ===')
console.log(JSON.stringify(seen, null, 2))

ws.close()
chrome.kill()
host.close()
api.close()
process.exit(0)
