/**
 * MCP 连接器脚本 — 连接 mini-canvas MCP 后台服务并测试工具
 *
 * 用法：
 *   node node_modules/tsx/dist/cli.mjs packages/mcp-server/scripts/mcp-client.ts
 *
 * 功能：连接 stdio 服务 → 列出工具（精简面）→ 创建画布 → batch 批量增删节点/连线
 *       → create_node（预览 + 生成模式）→ node.status 查任务 → canvas.get 复核。
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = path.resolve(__dirname, '..')
const CLI = path.resolve(PACKAGE_ROOT, 'src/cli.ts')
const TSX = path.resolve(PACKAGE_ROOT, 'node_modules/tsx/dist/cli.mjs')

/** 把 callTool 返回的 content 拼成纯文本 */
function text(r: any): string {
  return (r.content || [])
    .filter((c: any) => c.type === 'text')
    .map((c: any) => c.text)
    .join('\n')
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`断言失败: ${msg}`)
  console.log(`  ✓ ${msg}`)
}

export async function runMcpTests(workdir?: string, port = 18780): Promise<string> {
  const transport = new StdioClientTransport({
    command: 'node',
    args: [TSX, CLI, 'mcp', 'start', '--transport', 'stdio', '--port', String(port), '--dir', workdir ?? './workspace'],
    cwd: PACKAGE_ROOT,
  })
  const client = new Client({ name: 'mcp-connector', version: '1.0.0' })
  await client.connect(transport)
  console.log('✅ 已连接 MCP 后台服务 (stdio)')

  // 1. 列出工具（精简面）
  console.log('\n== 列出工具 ==')
  const { tools } = await client.listTools()
  const names = tools.map((t) => t.name)
  console.log(`  工具数量: ${tools.length}`)
  assert(tools.length === 9, `精简后工具数量 = 9 (实际 ${tools.length})`)
  console.log('  工具:', names.join(', '))

  // 2. 创建画布（taskId 即画布 id）
  console.log('\n== 创建画布 ==')
  const canvasId = `auto-${Date.now()}`
  const c = await client.callTool({ name: 'canvas.create_canvas', arguments: { taskId: canvasId, name: '自动化测试画布' } })
  assert(text(c).includes('"ok":true'), `create_canvas: ${text(c)}`)

  // 3. 批量新增节点 + 连线（一次合并执行）
  console.log('\n== 批量新增节点 + 连线 ==')
  const n = await client.callTool({
    name: 'canvas.batch_nodes',
    arguments: {
      canvasId,
      add: [
        { type: 'image', position: { x: 100, y: 100 }, data: { label: '输入图' } },
        { type: 'text', position: { x: 400, y: 100 }, data: { label: '说明' } },
      ],
    },
  })
  const nText = text(n)
  assert(nText.includes('"type":"image"') && nText.includes('"type":"text"'), 'batch_nodes.add(image+text)')
  const added = JSON.parse(nText).added
  const n1id = added[0]
  const n2id = added[1]

  const e = await client.callTool({ name: 'canvas.batch_edges', arguments: { canvasId, add: [{ source: n1id, target: n2id }] } })
  assert(text(e).includes('"ok":true'), 'batch_edges.add')

  // 4. 批量更新位置
  console.log('\n== 批量更新节点位置 ==')
  const up = await client.callTool({ name: 'canvas.batch_nodes', arguments: { canvasId, update: [{ id: n1id, position: { x: 250, y: 300 } }] } })
  assert(text(up).includes('"updated"'), 'batch_nodes.update')

  // 5. 预览模式 create_node（展示本地媒体，去重建预览节点）
  console.log('\n== create_node 预览模式 ==')
  const pv = await client.callTool({ name: 'create_node', arguments: { canvasId, type: 'image', args: { path: 'C:/tmp/demo.png' } } })
  assert(text(pv).includes('"mode":"preview"'), 'create_node 预览模式')

  // 6. 生成模式 create_node（带参考图：自动建预览节点+连线+提交任务）
  console.log('\n== create_node 生成模式（提交后台任务） ==')
  const gen = await client.callTool({
    name: 'create_node',
    arguments: { canvasId, type: 'image', args: { prompt: '一只猫', model: 'doubao-seedream-45', referenceImages: ['C:/tmp/ref1.png'] } },
  })
  const genText = text(gen)
  assert(genText.includes('"mode":"generate"'), 'create_node 生成模式')
  const genNodeId = genText.match(/"nodeId":"([^"]+)"/)![1]

  // 7. 用 node.status 查任务（替代已删 task.status）
  console.log('\n== node.status 查任务（轮询至终态） ==')
  let terminal = false
  for (let i = 0; i < 30; i++) {
    const st = await client.callTool({ name: 'node.status', arguments: { canvasId, nodeId: genNodeId } })
    const parsed = JSON.parse(text(st))
    const s = parsed.runState?.status
    if (s === 'done' || s === 'error') { terminal = true; console.log(`  任务终态 = ${s}`); break }
    await new Promise((r) => setTimeout(r, 200))
  }
  assert(terminal, 'node.status 任务进入终态（无真实后台时为 error）')

  // 8. canvas.get 复核全量
  console.log('\n== canvas.get 复核全量 ==')
  const g = await client.callTool({ name: 'canvas.get', arguments: { canvasId } })
  const parsedG = JSON.parse(text(g))
  assert(parsedG.nodeCount >= 3, `canvas.get 返回 ${parsedG.nodeCount} 节点`)

  await client.close()
  console.log(`\n🎉 MCP 连接器测试全部通过 (画布: ${canvasId})`)
  return canvasId
}

// 直接运行时执行
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  runMcpTests().catch((err) => {
    console.error('❌ MCP 连接器测试失败:', err)
    process.exit(1)
  })
}
