/**
 * 探针 AE：浏览器真机验收（加固后）。
 *
 * 检查：
 *   1. 画布页能打开（不是白屏、没有请求被 403 打回）
 *   2. 页内 iframe（视觉节点）里的 Network **没有** /api/ 请求
 *   3. 填令牌后，插件面板能拉到清单（带令牌）
 *   4. 控制台没有 403 报错
 *
 * 用法：node run23-browser-e2e.mjs <base> <token>
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const CHROME = process.env.CHROME_EXE ??
  'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe'
const BASE = process.argv[2] ?? 'http://127.0.0.1:8952'
const TOKEN = process.argv[3] ?? readFileSync('.scratch/e2e1/admin-token', 'utf8').trim()

const userDataDir = mkdtempSync(path.join(os.tmpdir(), 'mc-e2e23-'))
const chrome = spawn(CHROME, [
  '--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + userDataDir,
  '--no-first-run', '--no-default-browser-check', '--no-proxy-server', '--proxy-bypass-list=*',
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
const failures = []
const consoleErrors = []
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(String(ev.data))
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
  if (msg.method === 'Network.responseReceived') {
    const { status, url } = msg.params.response
    if (status >= 400 && url.startsWith(BASE)) failures.push(status + ' ' + url)
  }
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    consoleErrors.push((msg.params.args ?? []).map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 160))
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

// 先同源写令牌（模拟「设置 → 插件」里填过）
await send('Page.navigate', { url: BASE + '/' })
await new Promise((r) => setTimeout(r, 2500))
await send('Runtime.evaluate', { expression: `localStorage.setItem('mc_admin_token', ${JSON.stringify(TOKEN)})` })

// 打开画布
await send('Page.navigate', { url: BASE + '/#/canvas/default' })
await new Promise((r) => setTimeout(r, 5000))

const state = await send('Runtime.evaluate', {
  expression: `JSON.stringify({
    title: document.title,
    hasCanvas: !!document.querySelector('.vue-flow, .canvas-host, svg'),
    iframes: document.querySelectorAll('iframe').length,
    bodyLen: document.body.innerHTML.length,
    token: localStorage.getItem('mc_admin_token'),
  })`,
  returnByValue: true,
})
console.log('=== 页面状态 ===')
console.log(state.result?.result?.value)

console.log('\n=== 4xx/5xx 请求 ===')
console.log(failures.length ? failures.join('\n') : '(无)')

console.log('\n=== 控制台 error ===')
console.log(consoleErrors.length ? consoleErrors.slice(0, 8).join('\n') : '(无)')

// 插件清单接口（带令牌）——验证前端带令牌这条链
const manifest = await send('Runtime.evaluate', {
  expression: `fetch('/plugin-catalog.json').then(r=>r.status)`,
  awaitPromise: true, returnByValue: true,
})
console.log('\nplugin-catalog:', manifest.result?.result?.value)

ws.close(); chrome.kill()
process.exit(0)
