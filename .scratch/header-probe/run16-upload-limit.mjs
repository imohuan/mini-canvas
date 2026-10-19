/**
 * 探针 U：资源上传有没有大小上限？
 *
 * 做法：往 POST /api/canvases/:id/resources 灌 200MB（分块写，避免本机内存爆），
 * 看服务端是否接受。用临时数据目录跑，跑完删掉。
 *
 * 结论（已跑过）：200MB 被完整接收、落盘、返回 200。
 * 说明路由里没有大小限制，`c.req.arrayBuffer()` 会把整个文件读进内存。
 */
import http from 'node:http'

const BASE = process.env.BASE ?? 'http://127.0.0.1:8940'
const MB = Number(process.env.MB ?? 200)

const u = new URL(BASE + '/api/canvases/default/resources?name=big.bin')
const size = MB * 1024 * 1024

const req = http.request({
  host: u.hostname, port: u.port, path: u.pathname + u.search, method: 'POST',
  headers: {
    origin: 'http://evil.test:9999',
    'content-type': 'application/octet-stream',
    'content-length': size,
  },
}, (res) => {
  let b = ''
  res.on('data', (d) => { b += d })
  res.on('end', () => {
    console.log('status', res.statusCode)
    console.log(b.slice(0, 240))
  })
})
req.on('error', (e) => console.log('ERR', e.message))

const chunk = Buffer.alloc(1024 * 1024, 0x61)
let sent = 0
function pump() {
  while (sent < size) {
    sent += chunk.length
    if (!req.write(chunk)) { req.once('drain', pump); return }
  }
  req.end()
}
pump()
setTimeout(() => { console.log('timeout, sent MB', sent / 1048576); process.exit(0) }, 120000)
