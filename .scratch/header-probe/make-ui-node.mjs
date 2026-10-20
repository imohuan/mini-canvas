/** 造一个真实的可视化节点（用于真机验收 iframe 行为） */
import http from 'node:http'
import { readFileSync } from 'node:fs'

const BASE = process.argv[2] ?? 'http://127.0.0.1:8952'
const TOKEN = process.argv[3] ?? readFileSync('.scratch/e2e1/admin-token', 'utf8').trim()

const html = `<!doctype html><meta charset="utf-8"><body style="font:14px system-ui;padding:12px">
<h3 id="t">节点脚本</h3>
<button id="save">保存产物</button>
<pre id="out"></pre>
<script>
  // 真机验收：加载后自动存一次，免去「点没点到」的不确定性
  setTimeout(function () {
    CanvasUI.save(new Blob(['auto-from-ui'], { type: 'text/plain' }), 'auto.txt')
      .then(function (u) { document.getElementById('out').textContent = 'AUTO OK ' + u; })
      .catch(function (e) { document.getElementById('out').textContent = 'AUTO ERR ' + (e && e.message); })
  }, 300)
  document.getElementById('save').onclick = async function () {
    try {
      const url = await CanvasUI.save(new Blob(['hello-from-ui'], { type: 'text/plain' }), 'ui.txt')
      document.getElementById('out').textContent = 'saved: ' + url
    } catch (e) {
      document.getElementById('out').textContent = 'ERR ' + (e && e.message)
    }
  }
<\/script>`

const body = JSON.stringify({
  nodes: [{ id: 'u1', type: 'ui', position: { x: 160, y: 140 }, data: { uiHtml: html, uiInputs: {} } }],
  edges: [],
})

const u = new URL(BASE + '/api/canvases/default')
const req = http.request(
  { host: u.hostname, port: u.port, path: u.pathname, method: 'PUT',
    headers: { 'content-type': 'application/json', 'x-admin-token': TOKEN } },
  (res) => {
    let d = ''
    res.on('data', (c) => { d += c })
    res.on('end', () => {
      console.log('put', res.statusCode, d.slice(0, 160))
      console.log('打开：' + BASE + '/#/canvas/default')
    })
  },
)
req.write(body)
req.end()
