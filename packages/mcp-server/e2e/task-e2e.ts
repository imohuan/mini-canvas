/**
 * 异步任务后台 e2e 测试
 *
 * 验证：task.create 立即返回 task_id（pending）→ 后台自动处理 →
 * 完成后节点 data 被回写（status=done, progress=100）→ task.status 可查询。
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import path from 'node:path'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'

const PACKAGE_ROOT = path.resolve('D:/Code/Git/mini-canvas/packages/mcp-server')
const CLI = path.resolve(PACKAGE_ROOT, 'src/cli.ts')
const TSX = path.resolve(PACKAGE_ROOT, 'node_modules/tsx/dist/cli.mjs')

const text = (r: any): string =>
  (r.content || [])
    .filter((c: any) => c.type === 'text')
    .map((c: any) => c.text)
    .join('\n')

async function main() {
  const workdir = mkdtempSync(path.join(os.tmpdir(), 'mcp-task-'))
  const transport = new StdioClientTransport({
    command: 'node',
    args: [TSX, CLI, 'mcp', 'start', '--transport', 'stdio', '--dir', workdir],
    cwd: PACKAGE_ROOT,
  })
  const client = new Client({ name: 'task-e2e', version: '1.0.0' })
  await client.connect(transport)

  console.log('== 创建画布和节点 ==')
  await client.callTool({ name: 'canvas.create_canvas', arguments: { taskId: 't1' } })
  const n = await client.callTool({ name: 'canvas.create_node', arguments: { taskId: 't1', type: 'image', data: { label: '生成图' } } })
  const nodeId = text(n).match(/"id":"([^"]+)"/)![1]

  console.log('== task.create 立即返回 task_id ==')
  const t = await client.callTool({
    name: 'task.create',
    arguments: { kind: 'image', canvasId: 't1', targetNodeId: nodeId, payload: { prompt: 'a cat' } },
  })
  const tText = text(t)
  const taskId = tText.match(/"taskId":"([^"]+)"/)![1]
  console.log(`  task_id = ${taskId}`)
  if (!tText.includes('"ok":true')) throw new Error('task.create 未返回 ok')

  console.log('== 轮询 task.status 直到完成 ==')
  let done = false
  for (let i = 0; i < 30; i++) {
    const s = await client.callTool({ name: 'task.status', arguments: { taskId } })
    const sText = text(s)
    if (sText.includes('"status":"done"')) {
      done = true
      console.log(`  ✓ 任务完成`)
      break
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  if (!done) throw new Error('任务未在预期时间内完成')

  console.log('== 验证节点已被后台回写 status=done ==')
  const node = await client.callTool({ name: 'canvas.get_node', arguments: { taskId: 't1', nodeId } })
  const nodeText = text(node)
  if (!nodeText.includes('"status":"done"') || !nodeText.includes('"progress":100')) {
    throw new Error(`节点未回写 done，实际: ${nodeText}`)
  }
  console.log('  ✓ 节点 data.status=done, progress=100')

  await client.close()
  rmSync(workdir, { recursive: true, force: true })
  console.log('\n✅ 异步任务后台 e2e 通过')
}

main().catch((err) => {
  console.error('❌ 任务 e2e 失败:', err)
  process.exit(1)
})
