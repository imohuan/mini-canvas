/**
 * 探针 O：对**真实 cloud-server** 用「简单请求」（无预检、不读响应）打写接口，
 * 看副作用能不能真的落地。
 *
 * 打三条：
 *   1. POST /api/canvases/default/resources?name=x.txt  （text/plain 体）
 *   2. POST /api/canvases/default/nodes                （节点增量写）
 *   3. POST /api/kv/config/probe                       （KV 写）
 */
import http from 'node:http'

const BASE = process.env.BASE ?? 'http://127.0.0.1:8934'

function send(path, { method = 'POST', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(BASE + path)
    const r = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method, headers }, (res) => {
      let b = ''
      res.on('data', (d) => { b += d })
      res.on('end', () => resolve({ status: res.statusCode, body: b }))
    })
    r.on('error', reject)
    if (body) r.write(body)
    r.end()
  })
}

const evil = { origin: 'http://evil.test:9999', 'content-type': 'text/plain' }

console.log('=== 1. 资源上传（text/plain 体，不带 json 头）===')
const up = await send('/api/canvases/default/resources?name=simple.txt', { headers: evil, body: 'written-by-evil' })
console.log(up.status, up.body.slice(0, 160))

console.log('\n=== 2. 节点写（text/plain，但 body 是 JSON 文本）===')
const nodes = await send('/api/canvases/default/nodes', {
  headers: evil,
  body: JSON.stringify({ add: [{ id: 'evil-1', type: 'text', position: { x: 1, y: 1 }, data: { text: 'pwned' } }] }),
})
console.log(nodes.status, nodes.body.slice(0, 200))

console.log('\n=== 3. KV 写（text/plain，JSON 文本）===')
const kv = await send('/api/kv/config/probe', {
  method: 'PUT',
  headers: { origin: evil.origin, 'content-type': 'text/plain' },
  body: JSON.stringify({ v: 1 }),
})
console.log(kv.status, kv.body.slice(0, 200))

console.log('\n=== 4. 回读校验 ===')
const back = await send('/api/canvases/default', { method: 'GET' })
console.log('画布是否包含 evil-1：', back.body.includes('evil-1'))
const kvBack = await send('/api/kv/config/probe', { method: 'GET' })
console.log('KV 是否写进去了：', kvBack.status, kvBack.body.slice(0, 120))
