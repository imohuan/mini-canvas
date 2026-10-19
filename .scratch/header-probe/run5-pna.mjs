/**
 * 探针 F：一个「公网域名」的恶意页面，在现在的 Chrome 里还能不能打 127.0.0.1:8865？
 *
 * 做法：--host-resolver-rules 把 evil.test 指到 127.0.0.1，页面从 http://evil.test:PORT 加载，
 * 然后 fetch http://127.0.0.1:TARGET/api/write。
 *
 * 目的：验证文档第一节「任何网页都能 POST 本机后台」在 2026 年的 Chrome 上还成不成立。
 * 如果不成立，威胁模型要改写（本地恶意页面 / 旧浏览器 / 非浏览器程序才是主入口）。
 */
import http from 'node:http'
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const CHROME = process.env.CHROME_EXE ??
  'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe'

const seen = []

// 目标：本机后台（127.0.0.1）
const target = http.createServer((req, res) => {
  if (req.url?.startsWith('/api/')) {
    seen.push({
      method: req.method,
      url: req.url,
      origin: req.headers.origin ?? null,
      secFetchSite: req.headers['sec-fetch-site'] ?? null,
      pna: req.headers['access-control-request-private-network'] ?? null,
      acrHeaders: req.headers['access-control-request-headers'] ?? null,
    })
    // 故意**完全不放 CORS**：模拟「服务端没配跨源」
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end('{"ok":true}')
    return
  }
  res.writeHead(404); res.end()
})
await new Promise((r) => target.listen(0, '127.0.0.1', r))
const targetPort = target.address().port

const evilHtml = `<!doctype html><meta charset="utf-8"><body><script>
  var API = 'http://127.0.0.1:${targetPort}';
  window.__out = [];
  window.__go = async function () {
    // ① 简单请求（不发预检）：状态码是副作用的分界
    try {
      var r = await fetch(API + '/api/simple-write', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'x' });
      __out.push('① simple POST 完成，status=' + r.status);
    } catch (e) { __out.push('① simple POST 被拦：' + e.message); }
    // ② 带自定义头（要预检）
    try {
      var r2 = await fetch(API + '/api/json-write', { method: 'POST', headers: { 'content-type': 'application/json', 'x-a': '1' }, body: '{}' });
      __out.push('② json POST 完成，status=' + r2.status);
    } catch (e) { __out.push('② json POST 被拦：' + e.message); }
    // ③ GET
    try {
      var r3 = await fetch(API + '/api/read');
      __out.push('③ GET 完成，status=' + r3.status);
    } catch (e) { __out.push('③ GET 被拦：' + e.message); }
    return __out;
  };
</script></body>`

const evil = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  res.end(evilHtml)
})
await new Promise((r) => evil.listen(0, '0.0.0.0', r))
const evilPort = evil.address().port

const userDataDir = mkdtempSync(path.join(os.tmpdir(), 'mc-probe5-'))
const chrome = spawn(CHROME, [
  '--headless=new',
  '--remote-debugging-port=0',
  '--user-data-dir=' + userDataDir,
  '--no-first-run',
  '--no-default-browser-check',
  '--no-proxy-server',
  '--proxy-bypass-list=*',
  '--host-resolver-rules=MAP evil.test 127.0.0.1',
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

const version = await (await fetch(`http://127.0.0.1:${new URL(wsUrl).port}/json/version`)).json()
console.log('Browser:', version.Browser)

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

const loc = await send('Runtime.evaluate', { expression: 'location.href', returnByValue: true })
console.log('page:', loc.result?.result?.value)

const res = await send('Runtime.evaluate', { expression: 'window.__go()', awaitPromise: true, returnByValue: true })
console.log('=== 恶意页面看到的结果 ===')
console.log(JSON.stringify(res.result?.result?.value ?? res.result, null, 2))
await new Promise((r) => setTimeout(r, 400))
console.log('=== 目标服务收到的请求（收到 = 副作用已经发生）===')
console.log(JSON.stringify(seen, null, 2))

ws.close(); chrome.kill(); target.close(); evil.close()
process.exit(0)
