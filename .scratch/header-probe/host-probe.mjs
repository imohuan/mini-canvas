/**
 * 探针 K：@hono/node-server 下，Host 头读得到吗？伪造 Host 会不会被 URL 盖掉？
 *
 * Host 白名单是整个请求边界的承重墙，先确认读取方式可靠。
 */
import { createRequire } from 'node:module'
const require = createRequire('D:/Code/Git/mini-canvas/packages/cloud-server/package.json')
const { Hono } = require('hono')
const { serve } = require('@hono/node-server')

const app = new Hono()
app.all('*', (c) => c.json({
  hostHeader: c.req.header('host') ?? null,
  urlHost: new URL(c.req.url).host,
  url: c.req.url,
  xfh: c.req.header('x-forwarded-host') ?? null,
  path: c.req.path,
}))

const server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' })
const port = await new Promise((r) => server.once('listening', () => r(server.address().port)))

import http from 'node:http'

// fetch() 不允许改 Host，必须用原生 http 才测得出来
function probe(label, headers) {
  return new Promise((resolve) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: '/api/x', method: 'GET', headers },
      (res) => {
        let body = ''
        res.on('data', (d) => { body += d })
        res.on('end', () => {
          console.log(label.padEnd(28), body)
          resolve()
        })
      },
    )
    req.end()
  })
}

await probe('正常', {})
await probe('伪造 Host（原生 http）', { host: 'evil.test:8865' })
await probe('伪造 Host + XFH', { host: 'evil.test:8865', 'x-forwarded-host': '127.0.0.1:8865' })
await probe('Host 为空串', { host: '' })

server.close()
process.exit(0)
