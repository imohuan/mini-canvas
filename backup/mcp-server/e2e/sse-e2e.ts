/**
 * HTTP(REST) + SSE 集成测试（进程内验证）
 *
 * 验证：
 * 1. REST 创建画布/节点/连线/保存
 * 2. SSE /events 实时收到节点事件
 * 3. 前后端经 HTTP 读写同一 GraphModel
 */
import os from 'node:os'
import { GraphModel } from '../src/graph/GraphModel'
import { CanvasHttpServer } from '../src/http/CanvasHttpServer'
import { NodeStorage } from '../src/storage/NodeStorage'
import { TaskManager } from '../src/tasks/TaskManager'

const PORT = 18766
const BASE = `http://localhost:${PORT}`

/** 读取 SSE 流，返回第一个业务事件（跳过 ready）。按空行正确分割事件。 */
async function readBusinessEvent(url: string, timeoutMs = 8000): Promise<{ event: string; data: string }> {
  return new Promise((resolve, reject) => {
    const controller = new AbortController()
    const timer = setTimeout(() => {
      controller.abort()
      reject(new Error('SSE 业务事件超时'))
    }, timeoutMs)
    fetch(url, { signal: controller.signal })
      .then((res) => {
        if (!res.body) throw new Error('无响应体')
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        let currentEvent = ''
        let currentData: string[] = []
        const pump = () => {
          reader.read().then(({ done, value }) => {
            if (done) return
            buffer += decoder.decode(value, { stream: true })
            const blocks = buffer.split(/\r?\n\r?\n/)
            buffer = blocks.pop() ?? ''
            for (const block of blocks) {
              for (const line of block.split(/\r?\n/)) {
                if (line.startsWith('event:')) currentEvent = line.slice(6).trim()
                if (line.startsWith('data:')) currentData.push(line.slice(5).trim())
              }
              if (currentData.length > 0 && currentEvent !== 'ready') {
                clearTimeout(timer)
                controller.abort()
                resolve({ event: currentEvent, data: currentData.join('\n') })
                return
              }
              currentEvent = ''
              currentData = []
            }
            pump()
          })
        }
        pump()
      })
      .catch((err) => {
        if (err.name === 'AbortError') return
        reject(err)
      })
  })
}

async function main() {
  console.log('== 组装 GraphModel + NodeStorage + TaskManager + CanvasHttpServer ==')
  const workdir = `${os.tmpdir()}/mcp-http-${Date.now()}`
  const storage = new NodeStorage(workdir)
  await storage.init()
  const model = new GraphModel()
  const taskManager = new TaskManager(model)
  const http = new CanvasHttpServer({ model, storage, taskManager, port: PORT })
  await http.start()

  console.log('== REST: 创建画布 ==')
  let r = await fetch(`${BASE}/api/canvases`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ taskId: 't1', name: '任务一' }),
  })
  const created = await r.json()
  if (!created.ok) throw new Error('创建画布失败')

  console.log('== 连接 SSE 订阅画布 t1 ==')
  const ssePromise = readBusinessEvent(`${BASE}/events?canvasId=t1`)
  await new Promise((res) => setTimeout(res, 400))

  console.log('== REST: 创建节点 ==')
  r = await fetch(`${BASE}/api/canvases/t1/nodes`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'image', position: { x: 10, y: 20 }, data: { label: '图A' } }),
  })
  const nodeRes = await r.json()
  if (!nodeRes.ok) throw new Error('创建节点失败')

  console.log('== 验证 SSE 实时收到 node:added ==')
  const sseEvent = await ssePromise
  const parsed = JSON.parse(sseEvent.data)
  if (sseEvent.event !== 'node:added' || parsed.node?.type !== 'image') {
    throw new Error(`期望 node:added/image，实际 event=${sseEvent.event}`)
  }
  console.log(`  ✓ SSE 实时收到 node:added`)

  console.log('== REST: 保存画布 ==')
  r = await fetch(`${BASE}/api/canvases/t1/save`, { method: 'POST' })
  const saved = await r.json()
  if (!saved.ok) throw new Error('保存失败')

  console.log('== 重启后从磁盘恢复 ==')
  const storage2 = new NodeStorage(workdir)
  await storage2.init()
  const reloaded = await storage2.loadCanvas('t1')
  if (reloaded.nodes.length !== 1) throw new Error('磁盘恢复失败')
  console.log('  ✓ 磁盘恢复 1 个节点')

  http.stop()
  console.log('\n✅ HTTP + SSE 集成测试通过')
}

main().catch((err) => {
  console.error('❌ HTTP/SSE 测试失败:', err)
  process.exit(1)
})
