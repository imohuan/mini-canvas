import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const root = join(here, '../../..')
const demo = join(root, 'packages/ui/public/video-clip-demo.html')
const port = Number(process.argv[2]) || 5333

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
}

createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost')
  const file = url.pathname === '/'
    ? demo
    : url.pathname === '/video-clip-demo.html'
      ? demo
      : join(here, decodeURIComponent(url.pathname))
  if (!existsSync(file) || statSync(file).isDirectory()) {
    response.writeHead(404)
    response.end('not found')
    return
  }
  response.writeHead(200, {
    'Content-Type': types[extname(file)] || 'application/octet-stream',
    'Cache-Control': 'no-store',
  })
  createReadStream(file).pipe(response)
}).listen(port, '127.0.0.1', () => {
  console.log(`video clip demo: http://127.0.0.1:${port}`)
})
