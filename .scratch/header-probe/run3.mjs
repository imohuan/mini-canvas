/**
 * 探针 D：证明「Origin: null」不是视觉节点的独有特征。
 *
 * 第三方网页（evil 端口）自己造一个 sandbox iframe 打目标服务，
 * 看它发出去的 Origin 是什么、请求有没有到达。
 *
 * 如果也是 Origin: null，那「给 Origin: null 开例外」就等于对所有网页开例外，
 * 文档第十六节的方案必须推翻。
 */
import http from 'node:http'
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const CHROME = process.env.CHROME_EXE ??
  'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe'

const seen = []

// 目标：模拟 cloud-server，只记录
const target = http.createServer((req, res) => {
  const h = req.headers
  if (req.url?.startsWith('/api/')) {
    seen.push({
      method: req.method,
      url: req.url,
      origin: h.origin ?? null,
      secFetchSite: h['sec-fetch-site'] ?? null,
      secFetchDest: h['sec-fetch-dest'] ?? null,
      acrHeaders: h['access-control-request-headers'] ?? null,
      body: null,
    })
    const cors = {
      'access-control-allow-origin': h.origin ?? '*',
      'access-control-allow-methods': 'GET,POST',
      'access-control-allow-headers': h['access-control-request-headers'] ?? '*',
    }
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return }
    res.writeHead(200, { 'content-type': 'application/json', ...cors })
    res.end('{"ok":true,"secret":"leaked"}')
    return
  }
  res.writeHead(404); res.end()
})
await new Promise((r) => target.listen(0, '127.0.0.1', r))
const targetPort = target.address().port

// 恶意站点：三种打法
const sandboxB64 = Buffer.from(
  `<script>fetch('http://127.0.0.1:${targetPort}/api/write',{method:'POST',headers:{'content-type':'application/json','x-probe':'evil-sandbox'},body:'{}'}).then(r=>r.text()).then(t=>parent.postMessage({t:t},'*')).catch(e=>parent.postMessage({e:String(e)},'*'));<\/script>`,
  'utf8',
).toString('base64')

const evilHtml = `<!doctype html><meta charset="utf-8"><body>
<script>
  var API = 'http://127.0.0.1:${targetPort}';
  window.__out = [];
  window.__go = async function () {
    // ① 自己的 sandbox iframe（和视觉节点一模一样的手法）
    await new Promise(function (resolve) {
      var f = document.createElement('iframe');
      f.setAttribute('sandbox', 'allow-scripts');
      f.srcdoc = atob(${JSON.stringify(sandboxB64)});
      addEventListener('message', function onMsg(ev) {
        if (ev.source !== f.contentWindow) return;
        __out.push('① 恶意 sandbox iframe → ' + JSON.stringify(ev.data));
        removeEventListener('message', onMsg); resolve();
      });
      document.body.appendChild(f);
      setTimeout(function () { __out.push('① timeout'); resolve(); }, 4000);
    });
    // ② 直接 fetch（跨源，带自定义头 → 要预检）
    try {
      var r = await fetch(API + '/api/read', { headers: { 'x-probe': 'evil-direct' } });
      var t = await r.text();
      __out.push('② 直接 fetch → 读到 ' + t);
    } catch (e) { __out.push('② 直接 fetch → 被拦 ' + e.message); }
    // ③ 简单请求（不预检）+ 读响应：text/plain 的 POST
    try {
      var r2 = await fetch(API + '/api/read2', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'x' });
      var t2 = await r2.text();
      __out.push('③ 简单 POST → 读到 ' + t2);
    } catch (e) { __out.push('③ 简单 POST → 被拦 ' + e.message); }
    return __out;
  };
</script></body>`

const evil = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  res.end(evilHtml)
})
await new Promise((r) => evil.listen(0, '127.0.0.1', r))
const evilPort = evil.address().port

const userDataDir = mkdtempSync(path.join(os.tmpdir(), 'mc-probe3-'))
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
await send('Page.navigate', { url: `http://127.0.0.1:${evilPort}/` })
await new Promise((r) => setTimeout(r, 900))
const res = await send('Runtime.evaluate', { expression: 'window.__go()', awaitPromise: true, returnByValue: true })
console.log('=== 恶意页面能做什么 ===')
console.log(JSON.stringify(res.result?.result?.value ?? res.result, null, 2))
await new Promise((r) => setTimeout(r, 400))
console.log('=== 目标服务收到的请求 ===')
console.log(JSON.stringify(seen, null, 2))

ws.close(); chrome.kill(); target.close(); evil.close()
process.exit(0)
