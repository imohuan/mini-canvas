/**
 * SSE 实时推送集成测试（进程内验证）
 *
 * 在同一个进程里创建 GraphModel + SseServer（模拟单进程服务）。
 * 直接对 model 做写操作（相当于 MCP 命令），验证 SSE /events 实时收到事件。
 */
import os from 'node:os'
import { GraphModel } from '../src/graph/GraphModel'
import { SseServer } from '../src/sse/SseServer'

const PORT = 18766

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
            // 按空行分割事件
            const blocks = buffer.split(/\r?\n\r?\n/)
            buffer = blocks.pop() ?? ''
            for (const block of blocks) {
              for (const line of block.split(/\r?\n/)) {
                if (line.startsWith('event:')) currentEvent = line.slice(6).trim()
                if (line.startsWith('data:')) currentData.push(line.slice(5).trim())
              }
              // 一个事件完整结束
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
  const workdir = `${os.tmpdir()}/mcp-sse-${Date.now()}`

  console.log('== 创建 GraphModel + SseServer（模拟单进程服务） ==')
  const model = new GraphModel()
  const sse = new SseServer({ model, port: PORT })
  await sse.start()

  console.log('== 预创建画布 ==')
  model.createCanvas('t1', '任务一')

  console.log('== 连接 /events 订阅画布 t1 ==')
  const ssePromise = readBusinessEvent(`http://localhost:${PORT}/events?canvasId=t1`)
  await new Promise((r) => setTimeout(r, 500))

  console.log('== 执行写操作（模拟 MCP create_node 命令） ==')
  model.createNode('t1', { type: 'image', data: { label: '图A' } })

  const sseEvent = await ssePromise
  const parsed = JSON.parse(sseEvent.data)
  if (sseEvent.event !== 'node:added' || parsed.node?.type !== 'image') {
    throw new Error(`期望 node:added/image，实际 event=${sseEvent.event}`)
  }
  console.log(`  ✓ SSE 实时收到 node:added，节点 id=${parsed.node.id}`)

  sse.stop()
  console.log('\n✅ SSE 集成测试通过')
}

main().catch((err) => {
  console.error('❌ SSE 集成测试失败:', err)
  process.exit(1)
})
