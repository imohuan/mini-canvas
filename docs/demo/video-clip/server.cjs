const http = require('http')
const fs = require('fs')
const path = require('path')

const root = process.argv[2] || process.cwd()
const port = Number(process.argv[3]) || 5333
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
}

http
  .createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost')
    let file = path.join(root, decodeURIComponent(url.pathname))
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html')
    fs.readFile(file, (error, data) => {
      if (error) {
        response.writeHead(404)
        response.end('not found')
        return
      }
      response.writeHead(200, {
        'Content-Type': types[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      })
      response.end(data)
    })
  })
  .listen(port, '127.0.0.1', () => console.log(`video clip demo: http://127.0.0.1:${port}`))
