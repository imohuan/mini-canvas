import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

async function main() {
  const transport = new StreamableHTTPClientTransport(new URL('http://localhost:8033/mcp'))
  const client = new Client({ name: 'probe', version: '1.0.0' })
  await client.connect(transport)
  console.log('✅ 已连接 web2api MCP: http://localhost:8033/mcp')
  const { tools } = await client.listTools()
  console.log(`工具数量: ${tools.length}`)
  for (const t of tools) {
    const props = t.inputSchema?.properties ? Object.keys(t.inputSchema.properties) : []
    console.log(`- ${t.name}  [${props.join(', ')}]`)
  }
  await client.close()
}
main().catch(e => { console.error('❌ 失败:', e.message); process.exit(1) })
