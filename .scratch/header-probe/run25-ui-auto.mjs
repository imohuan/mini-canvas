/** 探针 AG：视觉节点加载后自动保存，验证宿主代发 + 令牌全链路 */
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const CHROME = process.env.CHROME_EXE ??
  'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe'
const BASE = process.argv[2] ?? 'http://127.0.0.1:8952'
const TOKEN = process.argv[3] ?? ''

const userDataDir = mkdtempSync(path.join(os.tmpdir(), 'mc-e2e25-'))
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
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(String(ev.data))
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
  if (msg.method === 'Network.responseReceived') {
    const { status, url } = msg.params.response
    if (status >= 400 && url.startsWith(BASE)) bad.push(status + ' ' + url.slice(0, 100))
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
await new Promise((r) => setTimeout(r, 2000))
if (TOKEN) await send('Runtime.evaluate', { expression: `localStorage.setItem('mc_admin_token', ${JSON.stringify(TOKEN)})` })
await send('Page.navigate', { url: BASE + '/#/canvas/default' })
await new Promise((r) => setTimeout(r, 7000))

const node = await send('Runtime.evaluate', {
  expression: `fetch('/api/canvases/default').then(r=>r.json()).then(j => JSON.stringify((j.nodes||[]).map(n => ({ id: n.id, out: n.data && n.data.uiOutputUrl, text: n.data && n.data.text }))))`,
  awaitPromise: true, returnByValue: true,
})
console.log('=== 节点字段 ===')
console.log(node.result?.result?.value)
console.log('\n=== 4xx/5xx ===')
console.log(bad.length ? bad.join('\n') : '(无)')

ws.close(); chrome.kill()
process.exit(0)
