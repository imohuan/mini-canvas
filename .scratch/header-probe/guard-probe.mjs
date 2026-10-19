/**
 * 探针 E：把「令牌中间件」按方案写进一个真 Hono app，验证四件事：
 *   1. 中间件挂在路由之前，能不能拦住后注册的插件代理路由；
 *   2. 跨源写请求被 403 时，响应里**有没有** CORS 头（决定前端看到的是 403 还是网络错误）；
 *   3. OPTIONS 预检会不会被令牌中间件误杀；
 *   4. 前端带 x-admin-token 时，预检的 Access-Control-Allow-Headers 是否包含它。
 */
import { createRequire } from 'node:module'
const require = createRequire('D:/Code/Git/mini-canvas/packages/cloud-server/package.json')
const { Hono } = require('hono')
const { cors } = require('hono/cors')

const TOKEN = 'a'.repeat(64)
const app = new Hono()

// ① 先挂 cors（与 server.ts:445 同位置）
app.use('*', cors({ origin: (o) => (o === 'http://127.0.0.1:8865' ? o : null) }))

// ② 紧接着挂令牌中间件（与方案一致）
app.use('/api/*', async (c, next) => {
  const p = c.req.path
  const guarded = p.startsWith('/api/task/') || p.startsWith('/api/server-plugins/')
  if (!guarded) return next()
  if (c.req.method === 'GET' || c.req.method === 'HEAD' || c.req.method === 'OPTIONS') return next()
  if (c.req.header('x-admin-token') !== TOKEN) {
    return c.json({ ok: false, error: '需要管理令牌' }, 403)
  }
  await next()
})

// ③ 再注册业务路由（模拟 flushRoutes 在 start() 里挂的插件代理）
app.post('/api/task/call', (c) => c.json({ ok: true, ran: 'task/call' }))
app.post('/api/server-plugins/install', (c) => c.json({ ok: true, ran: 'install' }))
app.post('/api/canvases/:id/nodes', (c) => c.json({ ok: true, ran: 'nodes' }))

const cases = [
  ['同源 + 令牌', { origin: 'http://127.0.0.1:8865', token: TOKEN }, 'POST', '/api/task/call'],
  ['同源 无令牌', { origin: 'http://127.0.0.1:8865' }, 'POST', '/api/task/call'],
  ['跨源 无令牌', { origin: 'http://evil.example' }, 'POST', '/api/task/call'],
  ['无 Origin（curl）无令牌', {}, 'POST', '/api/task/call'],
  ['跨源 预检', { origin: 'http://127.0.0.1:8865', preflight: 'x-admin-token,content-type' }, 'OPTIONS', '/api/task/call'],
  ['画布写（不在清单）', { origin: 'http://evil.example' }, 'POST', '/api/canvases/c1/nodes'],
  ['GET 清单内路径', { origin: 'http://127.0.0.1:8865' }, 'GET', '/api/task/events'],
]

for (const [label, opt, method, path] of cases) {
  const headers = {}
  if (opt.origin) headers.origin = opt.origin
  if (opt.token) headers['x-admin-token'] = opt.token
  if (opt.preflight) {
    headers['access-control-request-method'] = 'POST'
    headers['access-control-request-headers'] = opt.preflight
  } else if (method !== 'GET') {
    headers['content-type'] = 'application/json'
  }
  const res = await app.fetch(new Request('http://127.0.0.1:8865' + path, {
    method,
    headers,
    ...(method === 'GET' || method === 'OPTIONS' ? {} : { body: '{}' }),
  }))
  console.log(
    label.padEnd(24),
    '|', String(res.status).padEnd(4),
    '| ACAO:', (res.headers.get('access-control-allow-origin') ?? '(none)').padEnd(24),
    '| ACAH:', res.headers.get('access-control-allow-headers') ?? '(none)',
    '|', (await res.text()).slice(0, 60),
  )
}
