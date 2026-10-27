/**
 * 极简静态服务：只给 demo 页用（不引依赖，起完就能在浏览器里看）。
 *
 * 用法：node docs/demo/serve-demo.mjs [端口]
 * 打开：http://127.0.0.1:5399/image-slot-demo.html
 */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('.', import.meta.url))
const port = Number(process.argv[2] || 5399)
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg',
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    let pathname = decodeURIComponent(url.pathname)
    if (pathname === '/' || pathname === '') pathname = '/image-slot-demo.html'
    // 只允许落在本目录内
    const file = normalize(join(root, pathname))
    if (!file.startsWith(root.endsWith(sep) ? root : root + sep)) {
      res.writeHead(403).end('forbidden')
      return
    }
    const body = await readFile(file)
    res.writeHead(200, { 'content-type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream' })
    res.end(body)
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('not found')
  }
}).listen(port, '127.0.0.1', () => {
  console.log('demo: http://127.0.0.1:' + port + '/image-slot-demo.html')
})
