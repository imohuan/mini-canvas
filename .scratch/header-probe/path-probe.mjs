/**
 * 探针 C：前缀白名单能不能被「路径写法」绕过。
 *
 * 这决定了 adminAuth 里 isAdminPath(c.req.path) 是否可靠：
 *   - 大小写        /API/server-plugins/install
 *   - 尾部斜杠      /api/server-plugins/install/
 *   - 双斜杠        /api//server-plugins/install
 *   - 编码字符      /api/server-plugins/%69nstall、/%61pi/server-plugins/install
 *   - 点段          /api/x/../server-plugins/install
 *   - 查询串        ?a=1
 *
 * 判据：中间件拿到的 c.req.path 是什么，真实 handler 有没有被调到。
 */
import { createRequire } from 'node:module'

// 直接按路径取 cloud-server 依赖树里的 hono（.scratch 不在包内，解析不到裸名）
const require = createRequire('D:/Code/Git/mini-canvas/packages/cloud-server/package.json')
const { Hono } = require('hono')

const hits = []
const app = new Hono()

// 与方案里同形的中间件：只看 c.req.path 的前缀
const GUARDED = ['/api/server-plugins/', '/api/task/', '/api/agent/canvases/']
app.use('/api/*', async (c, next) => {
  const p = c.req.path
  const guarded = GUARDED.some((g) => p === g.slice(0, -1) || p.startsWith(g))
  hits.push({ stage: 'middleware', seenPath: p, rawUrl: c.req.url, guarded })
  if (guarded) {
    hits.push({ stage: 'guard', seenPath: p, decision: '403' })
    return c.json({ ok: false, error: 'blocked' }, 403)
  }
  await next()
})

app.post('/api/server-plugins/install', (c) => {
  hits.push({ stage: 'handler', ran: 'install', seenPath: c.req.path })
  return c.json({ ok: true, pwned: true })
})

app.post('/api/task/call', (c) => {
  hits.push({ stage: 'handler', ran: 'task/call', seenPath: c.req.path })
  return c.json({ ok: true, pwned: true })
})

const cases = [
  ['正常', '/api/server-plugins/install'],
  ['大小写', '/API/server-plugins/install'],
  ['尾部斜杠', '/api/server-plugins/install/'],
  ['双斜杠', '/api//server-plugins/install'],
  ['前缀后加点', '/api/./server-plugins/install'],
  ['点段回退', '/api/x/../server-plugins/install'],
  ['编码 i', '/api/server-plugins/%69nstall'],
  ['编码 api 首字符', '/%61pi/server-plugins/install'],
  ['编码斜杠', '/api%2Fserver-plugins%2Finstall'],
  ['查询串', '/api/server-plugins/install?a=1'],
  ['后缀骗前缀', '/api/server-plugins-evil/install'],
  ['task 正常', '/api/task/call'],
  ['task 编码', '/api/%74ask/call'],
]

console.log('case'.padEnd(18), '| status | middleware c.req.path'.padEnd(46), '| handler')
console.log('-'.repeat(110))
for (const [label, p] of cases) {
  hits.length = 0
  const res = await app.fetch(new Request('http://127.0.0.1:8865' + p, { method: 'POST', body: '{}' }))
  const mw = hits.find((h) => h.stage === 'middleware')
  const handler = hits.find((h) => h.stage === 'handler')
  console.log(
    label.padEnd(18),
    '|', String(res.status).padEnd(6),
    '|', (mw ? mw.seenPath : '(中间件没跑)').padEnd(44),
    '|', handler ? '★ 执行了 ' + handler.ran : '未执行',
  )
}
