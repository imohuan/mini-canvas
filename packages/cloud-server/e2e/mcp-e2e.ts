#!/usr/bin/env node
/**
 * MCP 端到端验收（**真 MCP 客户端 + 真服务 + 真浏览器**）。
 *
 * 验的核心命题只有一句：**AI 改的和网页上看到的是同一张画布**。
 * 所以不满足于"工具返回 ok"，而是：
 *   1. 用官方 SDK 的 MCP 客户端连上 /mcp（走的是 AI 客户端真会用的那条协议）；
 *   2. 让"AI"经 MCP 建节点/连线；
 *   3. **真浏览器打开**网页画布，确认看到的就是 AI 建的那些；
 *   4. 反向再来一遍：浏览器里建节点，MCP 读得到；
 *   5. 重启服务，确认 AI 改的东西还在（落盘了）。
 *
 * 跑法：cd packages/cloud-server && pnpm e2e:mcp
 * （需要先构建 ui：cd packages/ui && pnpm build）
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { createCloudServer } from '../src/server.js'
import { launchChrome, openPage, sleep } from './lib/cdp.js'

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const REPO_ROOT = path.resolve(PACKAGE_ROOT, '../..')
const UI_DIST = path.join(REPO_ROOT, 'packages/ui/dist')

let failures = 0
function check(label: string, ok: boolean, extra?: unknown): void {
  console.log(`${ok ? '  PASS  ' : '  FAIL  '}${label}${extra !== undefined ? '   ' + JSON.stringify(extra) : ''}`)
  if (!ok) failures += 1
}

/** 取工具返回里的 JSON（MCP 工具统一返回一段 text） */
function parseToolResult(r: unknown): any {
  const content = (r as { content?: { type: string; text?: string }[] }).content ?? []
  const text = content.find((c) => c.type === 'text')?.text ?? '{}'
  return JSON.parse(text)
}

async function main(): Promise<void> {
  if (!path.isAbsolute(UI_DIST) || !exists(UI_DIST)) {
    console.error(`✗ 没找到画布构建产物：${UI_DIST}\n  请先执行：cd packages/ui && pnpm build`)
    process.exit(2)
  }

  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-e2e-'))
  const srv = await createCloudServer({ dir: dataDir, uiDist: UI_DIST, port: 0 })
  const { url } = await srv.start()
  console.log(`服务已起：${url}（数据目录 ${dataDir}）`)
  console.log(`MCP 端点：${url}/mcp\n`)

  // ==================== 连上 MCP（AI 客户端视角）====================
  console.log('--- 用官方 MCP 客户端连接 /mcp ---')
  const client = new Client({ name: 'cloud-e2e', version: '1.0.0' })
  const transport = new StreamableHTTPClientTransport(new URL(`${url}/mcp`))
  await client.connect(transport)
  check('MCP 客户端连接成功', true)

  const listed = await client.listTools()
  const toolNames = listed.tools.map((t) => t.name).sort()
  check(
    '工具面里有画布读写四件套',
    ['canvas.batch_edges', 'canvas.batch_nodes', 'canvas.get', 'canvas.overview'].every((n) => toolNames.includes(n)),
    toolNames,
  )

  // ==================== AI 经 MCP 改画布 ====================
  console.log('\n--- AI 经 MCP 建节点 + 连线 ---')
  const before = parseToolResult(await client.callTool({ name: 'canvas.overview', arguments: {} }))
  check('空画布起始状态', before.nodeCount === 0 && before.edgeCount === 0, before)

  const addRes = parseToolResult(
    await client.callTool({
      name: 'canvas.batch_nodes',
      arguments: {
        add: [
          { type: 'text', id: 'ai-a', position: { x: 80, y: 80 }, data: { text: 'AI 写的第一段' } },
          { type: 'text', id: 'ai-b', position: { x: 480, y: 80 }, data: { text: 'AI 写的第二段' } },
        ],
      },
    }),
  )
  check('AI 经 MCP 建了 2 个节点', addRes.ok === true && addRes.added.length === 2, addRes)

  const edgeRes = parseToolResult(
    await client.callTool({
      name: 'canvas.batch_edges',
      arguments: { add: [{ source: 'ai-a', target: 'ai-b' }] },
    }),
  )
  check('AI 经 MCP 连了一条线', edgeRes.ok === true && edgeRes.added.length === 1, edgeRes)

  const got = parseToolResult(await client.callTool({ name: 'canvas.get', arguments: {} }))
  check('canvas.get 读回来节点与连线齐全', got.nodeCount === 2 && got.edgeCount === 1, {
    nodeCount: got.nodeCount,
    edgeCount: got.edgeCount,
  })

  // 磁盘上确实落了（不是只在内存里）
  const disk = diskState(dataDir)
  check('AI 的改动落到了服务器磁盘', disk.nodes?.length === 2 && disk.edges?.length === 1, {
    nodes: disk.nodes?.length,
    edges: disk.edges?.length,
  })

  // ==================== 真浏览器看到的就是 AI 建的那张画布 ====================
  console.log('\n--- 真浏览器打开网页画布，核对与 AI 改的是同一张 ---')
  const chrome = await launchChrome()
  const page = await openPage(chrome.port)
  await page.goto(url + '/')
  await sleep(8000)

  const seen = await page.ev<{ nodes: string[]; edges: number; texts: string[] }>(
    `(() => {
       const host = window.MiniCanvasUI.getHost()
       const nodes = host.nodeStore.getNodes()
       return {
         nodes: nodes.map((n) => n.id),
         edges: host.graph.getEdges().length,
         texts: nodes.map((n) => n.data && n.data.text).filter(Boolean),
       }
     })()`,
  )
  check('★ 浏览器里看到 AI 建的 2 个节点', seen.nodes.length === 2 && seen.nodes.includes('ai-a') && seen.nodes.includes('ai-b'), seen)
  check('★ 浏览器里看到 AI 连的那条线', seen.edges === 1, { edges: seen.edges })
  check('★ 节点内容正是 AI 写的那两段文字', seen.texts.includes('AI 写的第一段') && seen.texts.includes('AI 写的第二段'), seen.texts)

  // ==================== 反向：浏览器改 → MCP 读得到 ====================
  console.log('\n--- 反向：浏览器建节点 → MCP 读得到 ---')
  const webCreated = await page.ev<{ before: number; after: number }>(
    `(() => {
       const host = window.MiniCanvasUI.getHost()
       const before = host.nodeStore.getNodes().length
       host.command.execute('command:create-node', { type: 'text', position: { x: 200, y: 400 } })
       return { before, after: host.nodeStore.getNodes().length }
     })()`,
  )
  check('浏览器里建了一个节点', webCreated.after === webCreated.before + 1, webCreated)
  await sleep(2500) // 等网页端的防抖落盘 + 云端同步

  const afterWeb = parseToolResult(await client.callTool({ name: 'canvas.overview', arguments: {} }))
  check('★ MCP 读得到浏览器刚建的那个节点（同一份数据）', afterWeb.nodeCount === 3, afterWeb)

  const errs = page.consoleErrors.filter((e) => !/favicon/i.test(e))
  check('网页端零控制台报错', errs.length === 0, errs)
  page.close()
  chrome.kill()

  // ==================== 重启后仍在（真落盘）====================
  console.log('\n--- 重启服务，确认 AI 改的东西还在 ---')
  await client.close()
  srv.stop()
  const srv2 = await createCloudServer({ dir: dataDir, uiDist: UI_DIST, port: 0 })
  const { url: url2 } = await srv2.start()
  const client2 = new Client({ name: 'cloud-e2e-2', version: '1.0.0' })
  await client2.connect(new StreamableHTTPClientTransport(new URL(`${url2}/mcp`)))
  const afterRestart = parseToolResult(await client2.callTool({ name: 'canvas.overview', arguments: {} }))
  check('★ 重启后画布还在（AI 的改动真的落了盘）', afterRestart.nodeCount === 3, afterRestart)
  await client2.close()
  srv2.stop()

  await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {})
  console.log('\n' + (failures === 0 ? '*** 全部通过 ***' : `${failures} 项失败`))
  process.exit(failures === 0 ? 0 : 1)
}

/** 读服务器磁盘上的 kv 文件 */
function diskState(dataDir: string): { nodes: unknown[] | null; edges: unknown[] | null } {
  const kv = path.join(dataDir, 'kv')
  if (!exists(kv)) return { nodes: null, edges: null }
  const files = readdirSync(kv)
  const read = (name: string): unknown[] | null => {
    const f = files.find((n) => n === name)
    return f ? (JSON.parse(readFileSync(path.join(kv, f), 'utf8')) as unknown[]) : null
  }
  return { nodes: read('canvas%3Agraph.json'), edges: read('canvas%3Agraph-edges.json') }
}

function exists(p: string): boolean {
  try {
    statSync(p)
    return true
  } catch {
    return false
  }
}

main().catch((err: unknown) => {
  console.error('\nMCP 端到端脚本崩了: ' + (err instanceof Error ? err.stack : String(err)))
  process.exit(1)
})
