/**
 * 探针 P：真实服务上，`PUT /api/canvases/:id`（整画布保存）在跨源页面里能不能打穿？
 *
 * 关键点：PUT 一定触发预检。当前 `cors()` 是 `origin: '*'`，预检会通过；
 * 所以「收紧 CORS」到底能不能挡住整画布覆盖，取决于这一步。
 */
import http from 'node:http'

const BASE = process.env.BASE ?? 'http://127.0.0.1:8935'

function send(path, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(BASE + path)
    const r = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method, headers }, (res) => {
      let b = ''
      res.on('data', (d) => { b += d })
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b }))
    })
    r.on('error', reject)
    if (body) r.write(body)
    r.end()
  })
}

const origin = 'http://evil.test:9999'

const pre = await send('/api/canvases/default', {
  method: 'OPTIONS',
  headers: {
    origin,
    'access-control-request-method': 'PUT',
    'access-control-request-headers': 'content-type',
  },
})
console.log('=== 预检 ===')
console.log('status:', pre.status)
console.log('allow-origin:', pre.headers['access-control-allow-origin'] ?? '(none)')
console.log('allow-methods:', pre.headers['access-control-allow-methods'] ?? '(none)')

const put = await send('/api/canvases/default', {
  method: 'PUT',
  headers: { origin, 'content-type': 'application/json' },
  body: JSON.stringify({ nodes: [{ id: 'hacked', type: 'text', position: { x: 0, y: 0 }, data: { text: 'wiped' } }], edges: [] }),
})
console.log('')
console.log('=== PUT 整画布 ===')
console.log('status:', put.status)
console.log('allow-origin:', put.headers['access-control-allow-origin'] ?? '(none)')
console.log('body:', put.body.slice(0, 200))

const back = await send('/api/canvases/default')
console.log('')
console.log('=== 回读节点 id ===')
try {
  const parsed = JSON.parse(back.body)
  console.log(JSON.stringify((parsed.nodes ?? []).map((n) => n.id)))
} catch {
  console.log(back.body.slice(0, 200))
}
