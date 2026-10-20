/**
 * 探针 AD：对**已经加固后**的真实服务跑一遍验收清单。
 *
 * 用法：node run22-verify-hardening.mjs <base> <token>
 * 期望：无令牌的写入口 403、带令牌通过、跨源 403、伪造 Host 403、
 *       SVG 回读带 CSP、超限上传 413、V1 简单请求被挡。
 */
import http from 'node:http'
import { readFileSync } from 'node:fs'

const BASE = process.argv[2] ?? 'http://127.0.0.1:8950'
const TOKEN = process.argv[3] ?? readFileSync('.scratch/verify1/admin-token', 'utf8').trim()
const origin = 'http://evil.test:9999'

function req(path, { method = 'GET', headers = {}, body, host } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(BASE + path)
    const r = http.request(
      {
        host: u.hostname, port: u.port, path: u.pathname + u.search, method,
        headers: { ...(host ? { host } : {}), ...headers },
      },
      (res) => {
        const chunks = []
        res.on('data', (d) => chunks.push(d))
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }))
      },
    )
    r.on('error', reject)
    if (body !== undefined) r.write(body)
    r.end()
  })
}

const line = (label, ok, detail) => console.log((ok ? '✓' : '✗') + ' ' + label.padEnd(46) + (detail ?? ''))

// 1. 无令牌调受保护入口
const noTok = await req('/api/server-plugins/install', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ id: 'x', code: 'x', confirm: true }),
})
line('无令牌 install → 403', noTok.status === 403, String(noTok.status))

// 2. 带令牌 → 非 403
const withTok = await req('/api/server-plugins/install', {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-token': TOKEN },
  body: JSON.stringify({ id: 'x', code: 'x', confirm: true }),
})
line('带令牌 install → 非 403', withTok.status !== 403, String(withTok.status))

// 3. 简单请求改画布 → 403（这是第一节的洞）
const simple = await req('/api/canvases/default/nodes', {
  method: 'POST', headers: { origin, 'content-type': 'text/plain' },
  body: JSON.stringify({ add: [{ id: 'evil', type: 'text', position: { x: 0, y: 0 }, data: {} }] }),
})
line('跨源 text/plain 改节点 → 403', simple.status === 403, String(simple.status))

// 4. 老接口同样挡
const oldApi = await req('/api/canvas/nodes', {
  method: 'POST', headers: { origin, 'content-type': 'text/plain' },
  body: JSON.stringify({ add: [] }),
})
line('跨源 /api/canvas/nodes → 403', oldApi.status === 403, String(oldApi.status))

// 5. 跨源 PUT 整画布覆盖 → 403（来源边界）
const put = await req('/api/canvases/default', {
  method: 'PUT', headers: { origin, 'content-type': 'application/json' }, body: '{"nodes":[],"edges":[]}',
})
line('跨源 PUT 整画布 → 403', put.status === 403, String(put.status))

// 6. 伪造 Host → 403
const badHost = await req('/api/canvases', { headers: { host: 'evil.test:8950' } })
line('伪造 Host 读画布 → 403', badHost.status === 403, String(badHost.status))

// 7. 正常同源 GET 仍 200
const okGet = await req('/api/canvases')
line('同源 GET 画布 → 200', okGet.status === 200, String(okGet.status))

// 8. SVG 回读带 CSP
const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>document.title="PWNED"</script></svg>'
const up = await req('/api/canvases/default/resources?name=x.svg', {
  method: 'POST', headers: { 'content-type': 'image/svg+xml', 'x-admin-token': TOKEN }, body: svg,
})
line('带令牌上传 SVG → 200', up.status === 200, String(up.status))
if (up.status === 200) {
  const url = JSON.parse(up.body.toString()).url
  const back = await req(url)
  line('SVG 回读带 CSP sandbox', String(back.headers['content-security-policy'] ?? '').includes('sandbox'), String(back.headers['content-security-policy'] ?? '(none)'))
  line('SVG 回读带 nosniff', back.headers['x-content-type-options'] === 'nosniff')
}

// 9. 超限上传 → 413
const big = Buffer.alloc(60 * 1024 * 1024, 0x61)
const over = await req('/api/canvases/default/resources?name=big.bin', {
  method: 'POST', headers: { 'content-length': String(big.length), 'x-admin-token': TOKEN }, body: big,
})
line('60MB 上传 → 413', over.status === 413, String(over.status))

// 10. 审计日志有记录且链完整（由 CLI 单独校验）
console.log('\n（审计链用 `node dist/cli.js audit-verify -d …` 校验）')
