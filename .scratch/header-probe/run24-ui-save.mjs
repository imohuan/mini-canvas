/**
 * 探针 AF：在真机里点视觉节点的「保存产物」，确认：
 *   1. iframe 自己不请求后台（Network 里没有 /api/canvases）；
 *   2. 宿主代发成功（节点出现 uiOutputUrl / text）；
 *   3. 没有任何 403。
 */
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const CHROME = process.env.CHROME_EXE ??
  'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe'
const BASE = process.argv[2] ?? 'http://127.0.0.1:8952'
const TOKEN = process.argv[3] ?? ''

const userDataDir = mkdtempSync(path.join(os.tmpdir(), 'mc-e2e24-'))
const chrome = spawn(CHROME, [
  '--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + userDataDir,
  '--no-first-run', '--no-default-browser-check', '--no-proxy-server', '--proxy-bypass-list=*',
  'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] })

let stderr = ''
chrome.stderr.on('data', (d) => { stderr += String(d) })
const wsUrl = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('chrome 没启动：' + stderr.slice(-1000))), 20000)
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
const bad = []
const apiFromIframe = []
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(String(ev.data))
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
  if (msg.method === 'Network.requestWillBeSent') {
    const r = msg.params.request
    if (r.url.includes('/api/canvases/') && msg.params.frameId && msg.params.frameId !== msg.params.loaderId) {
      // 只记录「不是顶层文档」的请求，用来判断是不是 iframe 在发
      apiFromIframe.push(r.method + ' ' + r.url.slice(0, 90))
    }
  }
  if (msg.method === 'Network.responseReceived') {
    const { status, url } = msg.params.response
    if (status >= 400 && url.startsWith(BASE)) bad.push(status + ' ' + url.slice(0, 90))
  }
})
function send(method, params = {}) {
  const myId = ++id
  ws.send(JSON.stringify({ id: myId, method, params }))
  return new Promise((r) => pending.set(myId, r))
}

await send('Page.enable')
await send('Runtime.enable')
await send('Network.enable')

await send('Page.navigate', { url: BASE + '/' })
await new Promise((r) => setTimeout(r, 2200))
if (TOKEN) await send('Runtime.evaluate', { expression: `localStorage.setItem('mc_admin_token', ${JSON.stringify(TOKEN)})` })
await send('Page.navigate', { url: BASE + '/#/canvas/default' })
await new Promise((r) => setTimeout(r, 5000))

// 在 iframe 里点按钮（不透明源：用 CDP 的目标隔离上下文拿不到，所以直接在页面上用坐标点）
const box = await send('Runtime.evaluate', {
  expression: `(() => {
    const f = document.querySelector('iframe');
    if (!f) return null;
    const r = f.getBoundingClientRect();
    return JSON.stringify({ x: r.left, y: r.top, w: r.width, h: r.height });
  })()`,
  returnByValue: true,
})
const rect = JSON.parse(box.result?.result?.value ?? 'null')
console.log('iframe rect:', JSON.stringify(rect))

if (rect) {
  // 「保存产物」按钮在 iframe 左上角附近；双击进入交互态后再点
  const cx = rect.x + 60
  const cy = rect.y + 70
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', { type, x: cx, y: cy, button: 'left', clickCount: 2 })
  }
  await new Promise((r) => setTimeout(r, 600))
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', { type, x: cx, y: cy, button: 'left', clickCount: 1 })
  }
  await new Promise((r) => setTimeout(r, 2500))
}

const after = await send('Runtime.evaluate', {
  expression: `fetch('/api/canvases/default').then(r=>r.json()).then(j => JSON.stringify((j.nodes||[]).map(n => ({ id: n.id, out: n.data && n.data.uiOutputUrl, text: n.data && n.data.text }))))`,
  awaitPromise: true, returnByValue: true,
})
console.log('\n=== 节点产物字段 ===')
console.log(after.result?.result?.value)
console.log('\n=== 非顶层文档发出的 /api/canvases 请求（应为空）===')
console.log(apiFromIframe.length ? apiFromIframe.join('\n') : '(无)')
console.log('\n=== 4xx/5xx ===')
console.log(bad.length ? bad.join('\n') : '(无)')

ws.close(); chrome.kill()
process.exit(0)
