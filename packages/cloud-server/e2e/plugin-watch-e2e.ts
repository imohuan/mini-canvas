import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createCloudServer } from '../src/server.js'

const root = await mkdtemp(path.join(tmpdir(), 'mc-sl-e2e-'))
const pluginsDir = path.join(root, 'plugins')
const dist = path.join(pluginsDir, 'plugin-demo', 'dist')
await mkdir(dist, { recursive: true })
await writeFile(path.join(pluginsDir, 'plugin-demo', 'package.json'), JSON.stringify({ miniCanvas: { pluginName: 'demo' } }))
await writeFile(path.join(dist, 'plugin-demo.js'), 'v1')

const srv = await createCloudServer({ port: 0, dir: path.join(root, 'data'), pluginsDir, watchProviders: false, mcp: false })
const info = await srv.start()
console.log('server up at', info.url)

// 连 SSE
const res = await fetch(info.url + '/api/plugin-events', { headers: { accept: 'text/event-stream' } })
console.log('sse status', res.status, res.headers.get('content-type'))
const reader = res.body!.getReader()
const decoder = new TextDecoder()
let buf = ''
let got: unknown = null

const readPromise = (async () => {
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const lines = buf.split('\n')
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const payload = line.slice(6)
        const e = JSON.parse(payload)
        if (e.type === 'plugin-changed') { got = e; return }
      }
    }
  }
})()

// 等基准取到（首订阅者 startWatcher 会立刻取基准），再改产物
await new Promise((r) => setTimeout(r, 800))
await writeFile(path.join(dist, 'plugin-demo.js'), 'v2-changed-more-bytes')

const raced = await Promise.race([readPromise.then(() => got), new Promise((r) => setTimeout(() => r('TIMEOUT'), 6000))])
console.log('SSE event:', JSON.stringify(raced))
await reader.cancel().catch(() => {})
await srv.stop()
await rm(root, { recursive: true, force: true })
if (raced === 'TIMEOUT') { console.log('FAIL'); process.exit(1) }
console.log('PASS')
