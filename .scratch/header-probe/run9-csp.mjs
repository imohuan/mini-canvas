/**
 * 探针 J：验证「回读加 CSP + nosniff」到底能不能挡住 SVG 里的脚本。
 *
 * 四种响应头组合，各打开一次，看 document.title 有没有被脚本改掉：
 *   A 什么都不加（现状）
 *   B CSP: sandbox
 *   C CSP: default-src 'none'; style-src 'unsafe-inline'; sandbox
 *   D B + X-Content-Type-Options: nosniff
 *
 * 另外验证：<img src=svg> 在加了 CSP 之后还能不能正常显示（不能为了安全把图弄坏）。
 */
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const CHROME = process.env.CHROME_EXE ??
  'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe'

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40">
<rect width="120" height="40" fill="#1e6"/>
<script>document.title='PWNED';</script>
</svg>`

const variants = {
  A: { label: '现状（无头）', headers: {} },
  B: { label: 'CSP sandbox', headers: { 'content-security-policy': 'sandbox' } },
  C: { label: 'CSP sandbox + default-src none', headers: { 'content-security-policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'" } },
  D: { label: 'CSP sandbox + nosniff', headers: { 'content-security-policy': 'sandbox', 'x-content-type-options': 'nosniff' } },
  E: { label: "仅 default-src 'none'", headers: { 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'" } },
  F: { label: "script-src 'none'", headers: { 'content-security-policy': "script-src 'none'" } },
  G: { label: "script-src 'none' + nosniff", headers: { 'content-security-policy': "script-src 'none'; object-src 'none'", 'x-content-type-options': 'nosniff' } },
  H: { label: "sandbox allow-popups 等空值", headers: { 'content-security-policy': 'sandbox ' } },
}

// 用 Node 原生 http，这样能精确控制响应头
import http from 'node:http'
const server = http.createServer((req, res) => {
  const m = /^\/([A-H])\.svg$/.exec((req.url ?? '').split('?')[0] ?? '')
  if (m) {
    res.writeHead(200, { 'content-type': 'image/svg+xml', ...variants[m[1]].headers })
    res.end(svg)
    return
  }
  if (req.url === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end('<!doctype html><title>host</title><body>host')
    return
  }
  res.writeHead(404); res.end()
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const port = server.address().port
const base = `http://127.0.0.1:${port}`

const userDataDir = mkdtempSync(path.join(os.tmpdir(), 'mc-probe9-'))
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
const logs = []
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(String(ev.data))
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
  if (msg.method === 'Log.entryAdded') logs.push(msg.params?.entry?.text ?? '')
})
function send(method, params = {}) {
  const myId = ++id
  ws.send(JSON.stringify({ id: myId, method, params }))
  return new Promise((r) => pending.set(myId, r))
}

await send('Page.enable')
await send('Runtime.enable')
await send('Log.enable')

console.log('变体'.padEnd(34), '| 标题', '| 判定')
console.log('-'.repeat(80))
for (const key of Object.keys(variants)) {
  logs.length = 0
  await send('Page.navigate', { url: `${base}/${key}.svg` })
  await new Promise((r) => setTimeout(r, 700))
  const title = await send('Runtime.evaluate', { expression: 'document.title', returnByValue: true })
  const t = title.result?.result?.value ?? '(读不到)'
  const blocked = !String(t).includes('PWNED')
  console.log(
    (key + ' ' + variants[key].label).padEnd(34),
    '|', String(t).padEnd(8),
    '|', blocked ? '✅ 挡住了' : '❌ 脚本执行了',
  )
  const cspLog = logs.find((l) => /Content Security Policy|Refused/i.test(l))
  if (cspLog) console.log('   ↳', cspLog.slice(0, 120))
}

// <img> 还能不能显示：逐个变体当图片载入，量自然尺寸
await send('Page.navigate', { url: `${base}/` })
await new Promise((r) => setTimeout(r, 400))
console.log('\n<img> 引用各变体的结果：')
for (const key of Object.keys(variants)) {
  const img = await send('Runtime.evaluate', {
    expression: `new Promise(function(res){
      var i = new Image();
      i.onload = function(){ res('onload ' + i.naturalWidth + 'x' + i.naturalHeight); };
      i.onerror = function(){ res('onerror'); };
      i.src = '${base}/${key}.svg?' + Date.now();
      setTimeout(function(){ res('超时'); }, 2500);
    })`,
    awaitPromise: true,
    returnByValue: true,
  })
  console.log('  ', (key + ' ' + variants[key].label).padEnd(34), '→', img.result?.result?.value)
}

ws.close(); chrome.kill(); server.close()
process.exit(0)
