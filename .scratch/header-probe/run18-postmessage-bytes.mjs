/**
 * 探针 Z：沙箱 iframe（sandbox="allow-scripts"，不透明源）能不能用 postMessage
 * 把字节交给宿主？这是 commit 1「宿主代发上传」的基石。
 *
 * 测三种载荷：Uint8Array、ArrayBuffer、Blob（Blob 预期不可克隆）。
 */
import http from 'node:http'
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const CHROME = process.env.CHROME_EXE ??
  'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe'

const sandboxDoc = `<!doctype html><meta charset="utf-8"><body><script>
  // 注意：iframe 自己捕获了异常，宿主侧「没收到」也是一种结果，所以这里额外发一条 done
  function send(kind) {
    try {
      var payload;
      if (kind === 'u8') payload = new Uint8Array([1,2,3,4,5]);
      else if (kind === 'ab') payload = new Uint8Array([9,8,7,6]).buffer;
      else if (kind === 'blob') payload = new Blob(['hello'], { type: 'text/plain' });
      else payload = new Uint8Array([0]);
      parent.postMessage({ __probe: 1, kind: kind, payload: payload }, '*');
      parent.postMessage({ __probe: 1, kind: kind, stage: 'posted' }, '*');
    } catch (e) {
      parent.postMessage({ __probe: 1, kind: kind, stage: 'throw', error: String(e) }, '*');
    }
  }
  parent.postMessage({ __probe: 1, stage: 'ready' }, '*');
  addEventListener('message', function (e) {
    if (e.data && e.data.__cmd) send(e.data.__cmd);
  });
<\/script></body>`

const hostHtml = `<!doctype html><meta charset="utf-8"><body><h1>pm probe</h1><script>
  window.__results = [];
  window.__start = function () {
    return new Promise(function (resolve) {
      var f = document.createElement('iframe');
      f.setAttribute('sandbox', 'allow-scripts');
      f.srcdoc = atob(${JSON.stringify(Buffer.from(sandboxDoc, 'utf8').toString('base64'))});
      var got = 0;
      addEventListener('message', function (e) {
        if (e.source !== f.contentWindow) return;
        var d = e.data;
        if (!d || d.__probe !== 1) return;
        if (d.stage === 'ready') {
          ['u8', 'ab', 'blob'].forEach(function (k) { f.contentWindow.postMessage({ __cmd: k }, '*'); });
          return;
        }
        if (d.stage === 'posted') return;
        var desc;
        if (d.stage === 'throw') desc = 'THROW ' + d.error;
        else {
          var p = d.payload;
          if (p instanceof Uint8Array) desc = 'Uint8Array len=' + p.length + ' [' + Array.from(p).join(',') + ']';
          else if (p instanceof ArrayBuffer) desc = 'ArrayBuffer bytes=' + new Uint8Array(p).length + ' [' + Array.from(new Uint8Array(p)).join(',') + ']';
          else desc = 'other: ' + Object.prototype.toString.call(p);
        }
        __results.push(d.kind + ' → ' + desc);
        got++;
        if (got === 3) resolve(__results);
      });
      document.body.appendChild(f);
      setTimeout(function () { resolve(__results.concat(['timeout: got ' + got])); }, 5000);
    });
  };
</script></body>`

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  res.end(hostHtml)
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const port = server.address().port

const userDataDir = mkdtempSync(path.join(os.tmpdir(), 'mc-probe18-'))
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
await send('Page.navigate', { url: `http://127.0.0.1:${port}/` })
await new Promise((r) => setTimeout(r, 800))
const res = await send('Runtime.evaluate', { expression: 'window.__start()', awaitPromise: true, returnByValue: true })
console.log('=== 沙箱 iframe → 宿主 ===')
for (const line of res.result?.result?.value ?? []) console.log(' ', line)

ws.close(); chrome.kill(); server.close()
process.exit(0)
