/**
 * MCP stdio 全链路集成测试
 *
 * 用官方 SDK Client 启动 server 子进程，调用工具验证：
 * create_canvas → create_node → create_edge → set_node_position → save → load
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
    args: [TSX, CLI, 'mcp', 'start', '--transport', 'stdio', '--dir', workdir],
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

  console.log('== 列出工具 ==')
  const { tools } = await client.listTools()
  assert(tools.length === 18, `工具数量 = ${tools.length}`)

  console.log('== 创建画布 ==')
  const c1 = await client.callTool({ name: 'canvas.create_canvas', arguments: { taskId: 't1', name: '任务一' } })
  assert(text(c1).includes('t1'), `create_canvas 返回 t1，实际: ${JSON.stringify(c1)}`)

  console.log('== 创建节点 ==')
  const n1 = await client.callTool({ name: 'canvas.create_node', arguments: { taskId: 't1', type: 'image', position: { x: 10, y: 20 }, data: { label: '输入' } } })
  const node1Text = text(n1)
  assert(node1Text.includes('image'), 'create_node 返回 image 节点')
  const n2 = await client.callTool({ name: 'canvas.create_node', arguments: { taskId: 't1', type: 'text', data: { label: '输出' } } })
  assert(text(n2).includes('text'), 'create_node 返回 text 节点')

  // 提取节点 id
  const id1 = node1Text.match(/"id":"([^"]+)"/)![1]
  const id2 = text(n2).match(/"id":"([^"]+)"/)![1]

  console.log('== 创建连线 ==')
  const e1 = await client.callTool({ name: 'canvas.create_edge', arguments: { taskId: 't1', source: id1, target: id2 } })
  assert(text(e1).includes('"ok":true'), 'create_edge 成功')

  console.log('== 设置位置 ==')
  const p1 = await client.callTool({ name: 'canvas.set_node_position', arguments: { taskId: 't1', nodeId: id1, x: 100, y: 200 } })
  assert(text(p1).includes('"x":100'), 'set_node_position 生效')

  console.log('== 保存并重新加载 ==')
  await client.callTool({ name: 'canvas.save', arguments: { taskId: 't1' } })
  const load = await client.callTool({ name: 'canvas.load', arguments: { taskId: 't1' } })
  assert(text(load).includes('"nodeCount":2'), 'load 恢复 2 个节点')

  console.log('== 导出 ==')
  const exp = await client.callTool({ name: 'canvas.export_json', arguments: { taskId: 't1' } })
  assert(text(exp).includes('"edges"'), 'export_json 返回 edges')

  await client.close()
  rmSync(workdir, { recursive: true, force: true })
  console.log('\n✅ 全链路集成测试通过')
}

main().catch((err) => {
  console.error('❌ 集成测试失败:', err)
  process.exit(1)
})
