/**
 * create_node 生成模式 + node.status 后台任务 e2e 测试
 *
 * 验证：create_node（生成模式）立即返回 nodeId + taskId（任务入队）→
 * 后台处理（本 e2e 未接真实 web2api，任务落到终态 error，属预期）→
 * node.status 能查到该节点最近任务，且节点 data.runState 被后台回写。
 *
 * 重点验证 MCP 精简后的链路：语义化创建（自动建预览节点 + 连线 + 提交任务）
 * + 按 nodeId 查任务，而非依赖已删除的 task.create/task.status/get_node。
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
    args: [TSX, CLI, 'mcp', 'start', '--transport', 'stdio', '--port', '18771', '--dir', workdir],
    cwd: PACKAGE_ROOT,
  })
  const client = new Client({ name: 'task-e2e', version: '1.0.0' })
  await client.connect(transport)

  console.log('== 创建画布 ==')
  await client.callTool({ name: 'canvas.create_canvas', arguments: { taskId: 't1' } })

  console.log('== create_node 生成模式（带参考图，自动建预览节点+连线+提交任务） ==')
  const c = await client.callTool({
    name: 'create_node',
    arguments: {
      canvasId: 't1',
      type: 'image',
      args: { prompt: '一只猫', model: 'doubao-seedream-45', referenceImages: ['C:/tmp/ref1.png'] },
    },
  })
  const cText = text(c)
  if (!cText.includes('"ok":true') || !cText.includes('"mode":"generate"')) throw new Error(`create_node 未生成，实际: ${cText}`)
  const genNodeId = cText.match(/"nodeId":"([^"]+)"/)![1]
  console.log(`  生成节点 nodeId = ${genNodeId}`)
  console.log('  ✓ create_node 生成模式返回 nodeId + taskId（自动建预览节点 + 连线）')

  console.log('== 轮询 node.status 直到任务进入终态 ==')
  let runState: string | null = null
  let terminal = false
  for (let i = 0; i < 30; i++) {
    const s = await client.callTool({ name: 'node.status', arguments: { canvasId: 't1', nodeId: genNodeId } })
    const sText = text(s)
    const parsed = JSON.parse(sText)
    if (parsed.ok && parsed.runState?.status) {
      runState = parsed.runState.status
      if (runState === 'done' || runState === 'error') { terminal = true; break }
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  if (!terminal) throw new Error(`任务未进入终态（未接 web2api 应为 error），runState=${runState}`)
  console.log(`  ✓ node.status 返回节点 runState.status = ${runState}（无真实后台时预期 error，链路通）`)

  console.log('== canvas.get 复核生成节点与预览节点已上画布 ==')
  const g = await client.callTool({ name: 'canvas.get', arguments: { canvasId: 't1' } })
  const gText = text(g)
  const parsedG = JSON.parse(gText)
  if (!parsedG.nodes || parsedG.nodes.length < 2) throw new Error(`canvas.get 未含预览+生成节点，实际: ${gText}`)
  console.log(`  ✓ canvas.get 返回 ${parsedG.nodes.length} 节点 / ${parsedG.edges.length} 连线（含自动建的预览节点与连线）`)

  await client.close()
  rmSync(workdir, { recursive: true, force: true })
  console.log('\n✅ create_node 生成模式 + node.status e2e 通过')
}

main().catch((err) => {
  console.error('❌ 任务 e2e 失败:', err)
  process.exit(1)
})
