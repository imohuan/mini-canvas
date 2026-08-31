/**
 * MCP 连接器脚本 — 连接 mini-canvas MCP 后台服务并测试工具
 *
 * 用法：
 *   node node_modules/tsx/dist/cli.mjs packages/mcp-server/scripts/mcp-client.ts
 *
 * 功能：连接 stdio 服务 → 列出工具 → 创建画布 → 创建节点/连线 → 设置位置
 *       → 保存 → 创建异步任务并查询 → 加载验证。
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

export async function runMcpTests(workdir?: string, port = 18780): Promise<void> {
  const transport = new StdioClientTransport({
    command: 'node',
    args: [TSX, CLI, 'mcp', 'start', '--transport', 'stdio', '--port', String(port), '--dir', workdir ?? './workspace'],
    cwd: PACKAGE_ROOT,
  })
  const client = new Client({ name: 'mcp-connector', version: '1.0.0' })
  await client.connect(transport)
  console.log('✅ 已连接 MCP 后台服务 (stdio)')

  // 1. 列出工具
  console.log('\n== 列出工具 ==')
  const { tools } = await client.listTools()
  console.log(`  工具数量: ${tools.length}`)
  assert(tools.length >= 18, `工具数量 >= 18 (实际 ${tools.length})`)

  // 2. 创建画布（taskId 即画布 id）
  console.log('\n== 创建画布 ==')
  const canvasId = `auto-${Date.now()}`
  const c = await client.callTool({ name: 'canvas.create_canvas', arguments: { taskId: canvasId, name: '自动化测试画布' } })
  assert(text(c).includes('"ok":true'), `create_canvas: ${text(c)}`)

  // 3. 创建节点
  console.log('\n== 创建节点 ==')
  const n1 = await client.callTool({ name: 'canvas.create_node', arguments: { taskId: canvasId, type: 'image', position: { x: 100, y: 100 }, data: { label: '输入图' } } })
  const n1text = text(n1)
  assert(n1text.includes('"type":"image"'), 'create_node(image)')
  const n1id = n1text.match(/"id":"([^"]+)"/)![1]

  const n2 = await client.callTool({ name: 'canvas.create_node', arguments: { taskId: canvasId, type: 'text', position: { x: 400, y: 100 }, data: { label: '说明' } } })
  const n2text = text(n2)
  assert(n2text.includes('"type":"text"'), 'create_node(text)')
  const n2id = n2text.match(/"id":"([^"]+)"/)![1]

  // 4. 创建连线
  console.log('\n== 创建连线 ==')
  const e = await client.callTool({ name: 'canvas.create_edge', arguments: { taskId: canvasId, source: n1id, target: n2id } })
  assert(text(e).includes('"ok":true'), 'create_edge')

  // 5. 设置节点位置
  console.log('\n== 设置位置 ==')
  const p = await client.callTool({ name: 'canvas.set_node_position', arguments: { taskId: canvasId, nodeId: n1id, x: 250, y: 300 } })
  assert(text(p).includes('"x":250'), 'set_node_position')

  // 6. 导出 JSON 验证
  console.log('\n== 导出 JSON ==')
  const exp = await client.callTool({ name: 'canvas.export_json', arguments: { taskId: canvasId } })
  const expText = text(exp)
  assert(expText.includes('"edges"') && expText.includes('"nodes"'), 'export_json 含 nodes/edges')

  // 7. 保存
  console.log('\n== 保存 ==')
  const s = await client.callTool({ name: 'canvas.save', arguments: { taskId: canvasId } })
  assert(text(s).includes('"ok":true'), 'canvas.save')

  // 8. 异步任务
  console.log('\n== 创建异步任务 ==')
  const t = await client.callTool({
    name: 'task.create',
    arguments: { kind: 'image', canvasId, targetNodeId: n1id, payload: { prompt: 'a cat' } },
  })
  const tText = text(t)
  assert(tText.includes('"ok":true'), 'task.create 立即返回')
  const taskId = tText.match(/"taskId":"([^"]+)"/)![1]

  console.log('\n== 轮询任务状态 ==')
  let done = false
  for (let i = 0; i < 30; i++) {
    const st = await client.callTool({ name: 'task.status', arguments: { taskId } })
    const stText = text(st)
    if (stText.includes('"status":"done"')) { done = true; break }
    await new Promise((r) => setTimeout(r, 200))
  }
  assert(done, '任务后台完成 (status=done)')

  // 9. 加载验证（数据已落盘）
  console.log('\n== 加载验证 ==')
  const ld = await client.callTool({ name: 'canvas.load', arguments: { taskId: canvasId } })
  assert(text(ld).includes('"nodeCount":2'), 'load 恢复 2 个节点')

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
