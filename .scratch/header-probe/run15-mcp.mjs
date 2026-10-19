/**
 * 探针 T：`/mcp` 在跨源页面里能不能被调用？它无鉴权，但 MCP 要求 application/json。
 *
 * 两点要分清：
 *   1. 非浏览器（curl / 本机程序）能直接调 —— 不需要任何头，本来就通；
 *   2. 跨源网页：application/json 会触发预检。当前 cors() 是 '*'，所以预检通过、也能调。
 * 这里验证第 2 点，并顺便确认「简单请求打不进来」（content-type 必须是 json）。
 */
import http from 'node:http'

const BASE = process.env.BASE ?? 'http://127.0.0.1:8939'

function post(path, headers, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(BASE + path)
    const r = http.request({ host: u.hostname, port: u.port, path: u.pathname, method: 'POST', headers }, (res) => {
      let b = ''
      res.on('data', (d) => { b += d })
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b }))
    })
    r.on('error', reject)
    r.write(body)
    r.end()
  })
}

const origin = 'http://evil.test:9999'
const payload = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })

// 1. 预检
const pre = await new Promise((resolve, reject) => {
  const u = new URL(BASE + '/mcp')
  const r = http.request({
    host: u.hostname, port: u.port, path: '/mcp', method: 'OPTIONS',
    headers: {
      origin,
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'content-type',
    },
  }, (res) => {
    let b = ''
    res.on('data', (d) => { b += d })
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers }))
  })
  r.on('error', reject)
  r.end()
})
console.log('=== 预检 ===')
console.log('status', pre.status, 'ACAO', pre.headers['access-control-allow-origin'] ?? '(none)')

// 2. 跨源 + application/json
const ok = await post('/mcp', { origin, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, payload)
console.log('=== 跨源 JSON ===')
console.log('status', ok.status, 'ACAO', ok.headers['access-control-allow-origin'] ?? '(none)')
console.log(ok.body.slice(0, 160))

// 3. 跨源 + text/plain（简单请求，不打预检）
const simple = await post('/mcp', { origin, 'content-type': 'text/plain', accept: 'application/json, text/event-stream' }, payload)
console.log('=== 跨源 text/plain ===')
console.log('status', simple.status)
console.log(simple.body.slice(0, 200))

// 4. 本机无 Origin（curl 形态）
const curl = await post('/mcp', { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, payload)
console.log('=== 无 Origin ===')
console.log('status', curl.status)
