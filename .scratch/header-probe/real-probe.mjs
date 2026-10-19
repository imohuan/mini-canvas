/**
 * 探针 L：对**真实 cloud-server**（8931）打几枪，验证文档里的现状描述。
 *
 * 只做只读 + 一次资源上传（落到临时数据目录 .scratch/real-data，不入库）。
 */
import http from 'node:http'
import { createHash } from 'node:crypto'

const BASE = process.env.BASE ?? 'http://127.0.0.1:8932'

function req(path, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(BASE + path)
    const r = http.request(
      { host: u.hostname, port: u.port, path: u.pathname + u.search, method, headers },
      (res) => {
        const chunks = []
        res.on('data', (d) => chunks.push(d))
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }))
      },
    )
    r.on('error', reject)
    if (body) r.write(body)
    r.end()
  })
}

const show = (label, r, extra = '') => {
  console.log('\n### ' + label)
  console.log('status:', r.status, extra)
  console.log('acao:', r.headers['access-control-allow-origin'] ?? '(none)')
  console.log('csp:', r.headers['content-security-policy'] ?? '(none)')
  console.log('nosniff:', r.headers['x-content-type-options'] ?? '(none)')
  const text = r.body.toString('utf8')
  console.log('body:', text.slice(0, 220).replace(/\s+/g, ' '))
}

// 1. 真实 CORS：跨源能不能读
const evilOrigin = 'http://evil.test:9999'
show('① GET /api/canvases（跨源）', await req('/api/canvases', { headers: { origin: evilOrigin } }))

// 2. 无令牌装后台插件（用假 code，看是否走到代码校验之前）
show('② POST /api/server-plugins/install（无令牌、无 Origin）', await req('/api/server-plugins/install', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ id: 'pwn', code: 'console.log(1)', confirm: true }),
}))

// 3. 上传带脚本的 SVG（真实接口）
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"><rect width="120" height="40" fill="#333"/><script>document.title='PWNED';</script></svg>`
const up = await req('/api/canvases/default/resources?name=probe.svg', {
  method: 'POST',
  headers: { 'content-type': 'image/svg+xml', origin: evilOrigin },
  body: svg,
})
show('③ 匿名上传 SVG', up)

let svgUrl = ''
try { svgUrl = JSON.parse(up.body.toString()).url } catch {}
if (svgUrl) {
  show('④ 回读该 SVG', await req(svgUrl, { headers: { origin: evilOrigin } }))
  const file = await req(svgUrl)
  const sha = createHash('sha256').update(file.body).digest('hex').slice(0, 16)
  console.log('   回读字节哈希前 16 位:', sha, '（与文件名一致 = 内容原样落盘）')
}

// 5. 伪造 Host
show('⑤ 伪造 Host 读设置', await req('/api/kv/config/settings', { headers: { host: 'evil.test:8931' } }))

// 6. /mcp 无鉴权
const mcp = await req('/mcp', {
  method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
})
show('⑥ POST /mcp tools/list', mcp)

// 7. 插件路由是否存在
show('⑦ POST /api/task/call（无令牌）', await req('/api/task/call', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ type: 'list' }),
}))

// 8. 风格库路由
show('⑧ GET /api/style-library/settings', await req('/api/style-library/settings'))
