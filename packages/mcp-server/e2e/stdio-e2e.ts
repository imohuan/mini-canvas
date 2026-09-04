/**
 * MCP stdio 全链路集成测试
 *
 * 用官方 SDK Client 启动 server 子进程，验证精简后的工具面：
 * create_canvas → canvas.get（读全量）→ canvas.batch_nodes → canvas.batch_edges
 * → canvas.get 复核 → create_node（预览/生成双模式）。
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// 包根目录 = e2e/ 的上级
const PACKAGE_ROOT = path.resolve(__dirname, '..')
const CLI = path.resolve(PACKAGE_ROOT, 'src/cli.ts')
const TSX = path.resolve(PACKAGE_ROOT, 'node_modules/tsx/dist/cli.mjs')

async function main() {
  const workdir = mkdtempSync(path.join(os.tmpdir(), 'mcp-e2e-'))
  const transport = new StdioClientTransport({
    command: 'node',
    args: [TSX, CLI, 'mcp', 'start', '--transport', 'stdio', '--port', '18770', '--dir', workdir],
    cwd: PACKAGE_ROOT,
  })
  const client = new Client({ name: 'e2e-test', version: '1.0.0' })
  await client.connect(transport)

  const assert = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`断言失败: ${msg}`)
    console.log(`  ✓ ${msg}`)
  }

  /** 把 callTool 返回的 content 拼成纯文本 */
  const text = (r: any): string =>
    (r.content || [])
      .filter((c: any) => c.type === 'text')
      .map((c: any) => c.text)
      .join('\n')

  console.log('== 列出工具（精简面） ==')
  const { tools } = await client.listTools()
  const names = tools.map((t) => t.name)
  assert(tools.length === 9, `工具数量 = ${tools.length}`)
  for (const expect of ['canvas.create_canvas', 'canvas.list_canvases', 'canvas.delete_canvas', 'canvas.get', 'canvas.batch_nodes', 'canvas.batch_edges', 'create_node', 'node.status', 'models.list']) {
    assert(names.includes(expect), `包含工具 ${expect}`)
  }
  // 应已删除的冗余原语不得出现
  const banned = ['canvas.create_node', 'canvas.list_nodes', 'canvas.get_node', 'canvas.update_node', 'canvas.delete_node', 'canvas.create_edge', 'canvas.list_edges', 'canvas.delete_edge', 'canvas.set_node_position', 'canvas.set_viewport', 'canvas.save', 'canvas.load', 'canvas.export_json', 'task.create', 'task.status']
  for (const b of banned) {
    assert(!names.includes(b), `已删除工具 ${b} 不再暴露`)
  }

  console.log('== 创建画布 ==')
  const c1 = await client.callTool({ name: 'canvas.create_canvas', arguments: { taskId: 't1', name: '任务一' } })
  assert(text(c1).includes('t1'), `create_canvas 返回 t1，实际: ${JSON.stringify(c1)}`)

  console.log('== 批量新增节点 ==')
  const n = await client.callTool({
    name: 'canvas.batch_nodes',
    arguments: {
      canvasId: 't1',
      add: [
        { type: 'image', position: { x: 10, y: 20 }, data: { label: '输入' } },
        { type: 'text', data: { label: '输出' } },
      ],
    },
  })
  const nText = text(n)
  const nParsed = JSON.parse(nText)
  assert(nParsed.ok && nParsed.added.length === 2, 'batch_nodes.add 成功新增 2 节点')

  // 提取新增节点 id
  const added = nParsed.added
  const id1 = added[0]
  const id2 = added[1]

  console.log('== 批量新增连线 ==')
  const e = await client.callTool({
    name: 'canvas.batch_edges',
    arguments: { canvasId: 't1', add: [{ source: id1, target: id2 }] },
  })
  assert(text(e).includes('"ok":true'), 'batch_edges.add 成功')

  console.log('== canvas.get 读回全量复核 ==')
  const g = await client.callTool({ name: 'canvas.get', arguments: { canvasId: 't1' } })
  const gText = text(g)
  const gParsed = JSON.parse(gText)
  assert(gParsed.nodeCount === 2 && gParsed.edgeCount === 1, 'canvas.get 返回 2 节点 / 1 连线')
  const types = gParsed.nodes.map((nn: any) => nn.data?.nodeType ?? nn.type).sort()
  assert(JSON.stringify(types) === JSON.stringify(['image', 'text'].sort()), 'batch_nodes.add 后节点类型含 image/text')

  console.log('== canvas.batch_nodes.update 更新位置 ==')
  const up = await client.callTool({
    name: 'canvas.batch_nodes',
    arguments: { canvasId: 't1', update: [{ id: id1, position: { x: 100, y: 200 } }] },
  })
  assert(text(up).includes('"updated"'), 'batch_nodes.update 生效')

  console.log('== canvas.batch_nodes.delete 删除 ==')
  const del = await client.callTool({
    name: 'canvas.batch_nodes',
    arguments: { canvasId: 't1', delete: [id2] },
  })
  assert(text(del).includes('"ok":true'), 'batch_nodes.delete 生效')

  console.log('== create_node 预览模式（展示资源，不提交任务） ==')
  const pv = await client.callTool({
    name: 'create_node',
    arguments: { canvasId: 't1', type: 'image', args: { path: 'C:/tmp/demo.png' } },
  })
  assert(text(pv).includes('"ok":true') && text(pv).includes('"mode":"preview"'), 'create_node 预览模式返回 mode=preview')

  await client.close()
  rmSync(workdir, { recursive: true, force: true })
  console.log('\n✅ 全链路集成测试通过')
}

main().catch((err) => {
  console.error('❌ 集成测试失败:', err)
  process.exit(1)
})
