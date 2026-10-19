/**
 * 探针 Q：`startsWith('/api/task/')` 这种前缀判定，能不能被「前缀同名接口」绕过？
 *
 * 例如 /api/tasks、/api/taskfoo、/api/task 本身。
 * 目的是给出 isAdminPath 的实现约束（是否要额外判 `path === prefix 去尾斜杠`）。
 */
import { createRequire } from 'node:module'
const require = createRequire('D:/Code/Git/mini-canvas/packages/cloud-server/package.json')
const { Hono } = require('hono')

const PREFIXES = ['/api/task/', '/api/canvases/', '/api/canvas/']

function guarded(method, path) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return false
  return PREFIXES.some((p) => path === p.slice(0, -1) || path.startsWith(p))
}

const cases = [
  ['正常', 'POST', '/api/task/call'],
  ['无尾段', 'POST', '/api/task'],
  ['同名后缀', 'POST', '/api/tasks'],
  ['同名后缀2', 'POST', '/api/taskfoo'],
  ['多层', 'POST', '/api/task/a/b'],
  ['画布正常', 'POST', '/api/canvases/default/nodes'],
  ['画布无尾段', 'POST', '/api/canvases'],
  ['画布相似名', 'POST', '/api/canvases2/x'],
  ['老接口', 'POST', '/api/canvas/nodes'],
  ['PUT 画布', 'PUT', '/api/canvases/default'],
]

console.log('case'.padEnd(16), '| 判定')
console.log('-'.repeat(40))
for (const [label, m, p] of cases) {
  console.log(label.padEnd(16), '|', guarded(m, p) ? '🔒 受保护' : '— 放行')
}

// 再看 Hono 实际会把这些路径归一成什么（决定是否要额外解码）
const app = new Hono()
app.all('*', (c) => c.json({ seen: c.req.path }))

console.log('')
console.log('=== Hono 归一后的 path ===')
for (const p of ['/api/task//call', '/api/./task/call', '/api/task/%63all', '/API/task/call']) {
  const res = await app.fetch(new Request('http://x' + p, { method: 'POST' }))
  console.log(p.padEnd(24), '→', res.status, (await res.text()).slice(0, 60))
}
