/**
 * 探针 R：`https://evil.test:PORT` 页面打 `http://127.0.0.1:8936`，浏览器会不会直接拦？
 *
 * 这是 Private Network Access 的「公网→本机」方向。如果被拦，说明文档里
 * 「任何网页都能打本机后台」需要补一句适用范围（不是所有浏览器都允许）。
 */
import http from 'node:http'
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const CHROME = process.env.CHROME_EXE ??
  'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe'

const evilHtml = `<!doctype html><meta charset="utf-8"><body><script>
  window.__out = [];
  window.__go = async function () {
    try {
      var r = await fetch('http://127.0.0.1:8936/api/canvases', { method: 'GET' });
      __out.push('GET 成功 status=' + r.status + ' body=' + (await r.text()).slice(0, 80));
    } catch (e) { __out.push('GET 被拦：' + e.message); }
    try {
      var r2 = await fetch('http://127.0.0.1:8936/api/canvas/nodes', {
        method: 'POST', headers: { 'content-type': 'text/plain' },
        body: JSON.stringify({ add: [{ id: 'evil-https', type: 'text', position: {x:0,y:0}, data: { text: 'x' } }] }),
      });
      __out.push('POST 成功 status=' + r2.status);
    } catch (e) { __out.push('POST 被拦：' + e.message); }
    return __out;
  };
</script></body>`

const evil = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  res.end(evilHtml)
})
await new Promise((r) => evil.listen(0, '0.0.0.0', r))
const evilPort = evil.address().port

const userDataDir = mkdtempSync(path.join(os.tmpdir(), 'mc-probe13-'))
const chrome = spawn(CHROME, [
  '--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + userDataDir,
  '--no-first-run', '--no-default-browser-check', '--no-proxy-server', '--proxy-bypass-list=*',
  '--host-resolver-rules=MAP evil.test 127.0.0.1',
  '--ignore-certificate-errors',
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
const logs = []
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(String(ev.data))
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
  if (msg.method === 'Log.entryAdded') logs.push(msg.params?.entry?.text ?? '')
  if (msg.method === 'Network.requestWillBeSent') {
    const h = msg.params?.request?.headers ?? {}
    if (String(msg.params?.request?.url).includes('127.0.0.1:8936')) {
      logs.push('[net] ' + msg.params.request.method + ' ' + msg.params.request.url +
        ' pna=' + (h['Access-Control-Request-Private-Network'] ?? '(none)'))
    }
  }
})
function send(method, params = {}) {
  const myId = ++id
  ws.send(JSON.stringify({ id: myId, method, params }))
  return new Promise((r) => pending.set(myId, r))
}

await send('Page.enable')
await send('Runtime.enable')
await send('Log.enable')
await send('Network.enable')

// 页面本身用 http://（自签 https 会让页面加载失败，与本题无关）
await send('Page.navigate', { url: `http://evil.test:${evilPort}/` })
await new Promise((r) => setTimeout(r, 1200))
const res = await send('Runtime.evaluate', { expression: 'window.__go()', awaitPromise: true, returnByValue: true })
console.log('=== 页面结果 ===')
console.log(JSON.stringify(res.result?.result?.value ?? res.result, null, 2))
console.log('=== 相关日志 ===')
for (const l of logs.slice(-12)) console.log(' ', l.slice(0, 200))

ws.close(); chrome.kill(); evil.close()
process.exit(0)
