/**
 * 探针 AB：`/api/task/call` 到底能不能被外部调用执行脚本？授权检查会不会被「形状不对」绕过？
 *
 * 源码里 `shapeOk` 为 false 时会**跳过** authorizeScriptCall（task/routes.ts:254-269）。
 * 这里逐条打：
 *   0) list（应当可用）
 *   1) 缺 nodeId 的 call（期望 403：授权检查拒绝）
 *   2) 缺 methods 的 call（shapeOk=false → 可能绕过授权）
 *   3) methods 正常但 nodeId 不存在（403）
 */
import http from 'node:http'

const BASE = process.env.BASE ?? 'http://127.0.0.1:8946'

function post(path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(BASE + path)
    const r = http.request({
      host: u.hostname, port: u.port, path: u.pathname, method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
    }, (res) => {
      let b = ''
      res.on('data', (d) => { b += d })
      res.on('end', () => resolve({ status: res.statusCode, body: b }))
    })
    r.on('error', reject)
    r.write(JSON.stringify(body))
    r.end()
  })
}

const evil = { origin: 'http://evil.test:9999' }

const cases = [
  ['0 list', { type: 'list' }],
  ['1 缺 nodeId', { type: 'call', name: 'demo', methods: 'echo', args: ['hi'] }],
  ['2 缺 methods（shapeOk=false）', { type: 'call', name: 'demo', args: ['hi'] }],
  ['3 nodeId 不存在', { type: 'call', name: 'demo', methods: 'echo', args: ['hi'], canvasId: 'default', nodeId: 'nope' }],
  ['4 args 不是数组（shapeOk=false）', { type: 'call', name: 'demo', methods: 'echo', args: 'hi' }],
  ['5 args 是数字 + 无 nodeId', { type: 'call', name: 'demo', methods: 'echo', args: 1 }],
]

for (const [label, body] of cases) {
  const r = await post('/api/task/call', body, evil)
  console.log(label.padEnd(30), '→', r.status, r.body.slice(0, 150).replace(/\s+/g, ' '))
}
