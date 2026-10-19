/**
 * 探针 Y：在**真实的** createServerFramework 上验证三件事：
 *   1. 在 host.start() 之前挂 app.use('/api/*', ...)，能拦住插件通过 ctx.routes 注册的路由；
 *   2. 挂在 start() 之后则拦不住（证明文档里「必须挂在 start 之前」的说法）；
 *   3. 对直挂的 app.route('/mcp') 是否也生效。
 *
 * 用 tsx 跑源码（dist 可能是旧的）：tsx .scratch/header-probe/framework-guard.mjs
 */
import { createServerFramework } from '../../packages/cloud-server/src/serverFramework/index.ts'

const TOKEN = 'a'.repeat(64)
const GUARDED = ['/api/task/', '/api/canvases/']
const isAdminPath = (method, path) =>
  ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && GUARDED.some((p) => path === p.slice(0, -1) || path.startsWith(p))

async function build({ afterStart }) {
  const host = createServerFramework({})
  const app = host.app

  const guard = async (c, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) return next()
    if (!isAdminPath(c.req.method, c.req.path)) return next()
    if (c.req.header('x-admin-token') !== TOKEN) return c.json({ ok: false, error: 'blocked' }, 403)
    await next()
  }

  if (!afterStart) app.use('/api/*', guard)

  // 模拟插件：运行期通过 ctx.routes 注册（内置插件是装载期登记，同样走注册场）
  host.ctx.plugin({
    name: 'fake-task-plugin',
    apply: (c) => {
      c.routes.post('/api/task/call', (ctx) => ctx.json({ ok: true, ran: 'task/call' }))
      c.routes.post('/api/canvases/:id/nodes', (ctx) => ctx.json({ ok: true, ran: 'nodes' }))
      c.routes.get('/api/task/events', (ctx) => ctx.text('SSE'))
    },
  })

  await host.start()

  if (afterStart) app.use('/api/*', guard)

  if (!afterStart) {
    // 模拟直挂路由（server.ts 里 app.route('/', mcpRoutes(...)) 与 testModelRoutes 都是这种）
    app.post('/mcp', (c) => c.json({ ok: true, ran: 'mcp' }))
  }

  return app
}

async function hit(app, method, path, headers = {}) {
  const res = await app.fetch(new Request('http://127.0.0.1:8865' + path, { method, headers, body: method === 'GET' ? undefined : '{}' }))
  return { status: res.status, body: (await res.text()).slice(0, 60) }
}

for (const afterStart of [false, true]) {
  const app = await build({ afterStart })
  console.log('\n=== ' + (afterStart ? '挂在 start() 之后' : '挂在 start() 之前') + ' ===')
  console.log('无令牌 POST /api/task/call      ', JSON.stringify(await hit(app, 'POST', '/api/task/call')))
  console.log('带令牌 POST /api/task/call      ', JSON.stringify(await hit(app, 'POST', '/api/task/call', { 'x-admin-token': TOKEN })))
  console.log('无令牌 POST /api/canvases/x/nodes', JSON.stringify(await hit(app, 'POST', '/api/canvases/x/nodes')))
  console.log('无令牌 GET  /api/task/events    ', JSON.stringify(await hit(app, 'GET', '/api/task/events')))
  if (!afterStart) console.log('无令牌 POST /mcp               ', JSON.stringify(await hit(app, 'POST', '/mcp')))
}

// 第三组：把 requestTrust 挂到 '*' 上，看直挂的 /mcp 是否也受 Host/Origin 约束
console.log('\n=== 挂在 "*" 上（含 Host 检查）===')
{
  const host = createServerFramework({})
  const app = host.app
  app.use('*', async (c, next) => {
    const hostHeader = c.req.header('host') ?? ''
    if (!hostHeader.startsWith('127.0.0.1')) return c.json({ ok: false, error: 'bad host' }, 403)
    const origin = c.req.header('origin')
    if (origin && origin !== 'http://127.0.0.1:8865') return c.json({ ok: false, error: 'bad origin' }, 403)
    await next()
  })
  host.ctx.plugin({
    name: 'fake',
    apply: (c) => c.routes.post('/api/task/call', (ctx) => ctx.json({ ok: true })),
  })
  await host.start()
  app.post('/mcp', (c) => c.json({ ok: true, ran: 'mcp' }))

  const req = (hostHeader, origin) =>
    app.fetch(new Request('http://127.0.0.1:8865/mcp', {
      method: 'POST',
      headers: { host: hostHeader, ...(origin ? { origin } : {}), 'content-type': 'application/json' },
      body: '{}',
    }))

  for (const [label, h, o] of [
    ['正常 Host', '127.0.0.1:8865', null],
    ['恶意 Host', 'evil.test:8865', null],
    ['恶意 Origin', '127.0.0.1:8865', 'http://evil.test:9999'],
  ]) {
    const res = await req(h, o)
    console.log(label.padEnd(16), res.status, (await res.text()).slice(0, 50))
  }
}
