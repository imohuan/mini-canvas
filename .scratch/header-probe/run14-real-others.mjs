/**
 * 探针 S：真实服务上，资产 / 项目 / 历史 / KV 的写接口能不能被跨源简单请求打穿？
 *
 * 目的：确认「首版暂缓保护」这四个域到底安不安全。
 */
import http from 'node:http'

const BASE = process.env.BASE ?? 'http://127.0.0.1:8938'

function send(path, method, body, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(BASE + path)
    const r = http.request({
      host: u.hostname, port: u.port, path: u.pathname + u.search, method,
      headers: headers ?? { origin: 'http://evil.test:9999', 'content-type': 'text/plain' },
    }, (res) => {
      let b = ''
      res.on('data', (d) => { b += d })
      res.on('end', () => resolve({ status: res.statusCode, body: b }))
    })
    r.on('error', reject)
    if (body !== undefined) r.write(body)
    r.end()
  })
}

const cases = [
  ['POST /api/projects', '/api/projects', 'POST', JSON.stringify({ name: 'evil' })],
  ['POST /api/assets', '/api/assets?name=x.txt', 'POST', 'hello'],
  ['POST /api/asset-folders', '/api/asset-folders', 'POST', JSON.stringify({ name: 'evil-folder' })],
  ['POST /api/history/batch-delete', '/api/history/batch-delete', 'POST', JSON.stringify({ ids: [] })],
  ['POST /api/history/batch-rating', '/api/history/batch-rating', 'POST', JSON.stringify({ ids: [], rating: 5 })],
  ['PUT /api/kv/config/k', '/api/kv/config/k', 'PUT', JSON.stringify({ value: 1 })],
  ['POST /api/assets/batch', '/api/assets/batch', 'POST', JSON.stringify({ items: [] })],
]

for (const [label, path, method, body] of cases) {
  const r = await send(path, method, body)
  console.log(label.padEnd(32), '→', r.status, r.body.slice(0, 90).replace(/\s+/g, ' '))
}
