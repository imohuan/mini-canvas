import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

async function main() {
  const transport = new StreamableHTTPClientTransport(new URL('http://localhost:8765/mcp'))
  const client = new Client({ name: 'probe', version: '1.0.0' })
  await client.connect(transport)
  console.log('✅ 已连接 http://localhost:8765/mcp')

  const { tools } = await client.listTools()
  console.log(`工具数量: ${tools.length}`)
  console.log('工具名:', tools.map(t => t.name).join(', '))

  const canvasId = `http-${Date.now()}`
  const r = await client.callTool({ name: 'canvas.create_canvas', arguments: { taskId: canvasId, name: 'HTTP连接测试' } })
  console.log('create_canvas:', JSON.stringify(r.content))

  const n = await client.callTool({ name: 'canvas.create_node', arguments: { taskId: canvasId, type: 'image', position: { x: 1, y: 2 }, data: { label: '图A' } } })
  console.log('create_node:', JSON.stringify(n.content))

  await client.close()
  console.log('🎉 MCP Streamable HTTP 连接验证通过')
}
main().catch(e => { console.error('❌ 失败:', e.message); process.exit(1) })
