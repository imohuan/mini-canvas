/**
 * MCP 工具的**多画布路由**（用户报的「AI 建的节点在画布上看不到」根因）。
 *
 * 以前所有 MCP 工具都绑死在默认画布上：AI 即使把用户的画布 id 传进 canvasId 也没用 ——
 * 节点还是落进 `default`，用户在 `430…` 那张画布上什么都看不到。
 * 这条链验的是：给了 canvasId 就真写进那张画布；不给才是默认画布。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createCloudServer, type CloudServer } from '../server.js'
import { collectReferenceResources } from '../mcp/server.js'

let dir: string
let srv: CloudServer
const CANVAS = '430c8f1f00bd4aba'

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-mcp-routing-'))
  srv = await createCloudServer({ dir, watchProviders: false })
  // 造一张非默认画布（模拟用户正在看的那张）
  await fs.mkdir(path.join(dir, 'canvases', CANVAS), { recursive: true })
  await fs.writeFile(
    path.join(dir, 'canvases', CANVAS, 'canvas.json'),
    JSON.stringify({ nodes: [], edges: [] }),
    'utf8',
  )
})

afterEach(async () => {
  srv.stop()
  await fs.rm(dir, { recursive: true, force: true })
})

/** 走一次 MCP 握手 + tools/call，拿回工具返回里的 JSON */
async function mcpCall(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const post = (body: unknown) =>
    srv.app.fetch(
      new Request('http://localhost/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify(body),
      }),
    )
  await (await post({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '0' } },
  })).text()
  const text = await (await post({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: { name, arguments: args },
  })).text()
  const line = text.split('\n').find((l) => l.startsWith('data:')) ?? text
  const json = JSON.parse(line.replace(/^data:\s*/, ''))
  return JSON.parse(json.result.content[0].text)
}

async function readCanvas(id: string): Promise<{ nodes: Array<{ id: string }> }> {
  return JSON.parse(await fs.readFile(path.join(dir, 'canvases', id, 'canvas.json'), 'utf8'))
}

describe('MCP 按画布路由', () => {
  it('canvas_list_canvases 列出画布（AI 据此发现该写哪张）', async () => {
    const r = await mcpCall('canvas_list_canvases', {})
    const ids = (r.canvases as Array<{ id: string }>).map((c) => c.id)
    expect(ids).toContain(CANVAS)
  })

  it('带 canvasId 建节点 → 写进那张画布，不是 default', async () => {
    const r = await mcpCall('canvas_batch_nodes', {
      canvasId: CANVAS,
      add: [{ type: 'text', data: { text: '嗨' } }],
    })
    expect(r.ok).toBe(true)
    expect((await readCanvas(CANVAS)).nodes).toHaveLength(1)
    // default 画布没被写（这是关键：以前恰恰相反）
    const def = await readCanvas('default').catch(() => ({ nodes: [] }))
    expect(def.nodes).toHaveLength(0)
  })

  it('不带 canvasId → 落到默认画布（旧行为保留）', async () => {
    await mcpCall('canvas_batch_nodes', { add: [{ type: 'text', data: { text: 'a' } }] })
    expect((await readCanvas('default')).nodes).toHaveLength(1)
    expect((await readCanvas(CANVAS)).nodes).toHaveLength(0)
  })

  it('canvas_get 只读到指定画布的节点（读写同一条路由）', async () => {
    await mcpCall('canvas_batch_nodes', { canvasId: CANVAS, add: [{ type: 'text', data: { text: 'x' } }] })
    const onCanvas = await mcpCall('canvas_get', { canvasId: CANVAS })
    const onDefault = await mcpCall('canvas_get', {})
    expect((onCanvas as { nodeCount: number }).nodeCount).toBe(1)
    expect((onDefault as { nodeCount: number }).nodeCount).toBe(0)
  })

  it('画布不存在 → 明确报错，不静默写进 default', async () => {
    const r = await mcpCall('canvas_batch_nodes', { canvasId: 'deadbeefdeadbeef', add: [{ type: 'text' }] })
    expect(r.ok).toBe(false)
    expect(String(r.error)).toContain('画布不存在')
  })
})

describe('generation_create 从入边收集参考图', () => {
  it('入边上的图片/视频/文本被识别成参考素材（连进来就算素材）', () => {
    const nodes = [
      { id: 'ref', type: 'image', data: { imageUrl: 'res:aaaa.png' } },
      { id: 'vid', type: 'video', data: { videoUrl: 'res:bbbb.mp4' } },
      { id: 'txt', type: 'text', data: { text: '一只猫' } },
      { id: 'out', type: 'image', data: {} },
    ]
    const edges = [
      { source: 'ref', target: 'out' },
      { source: 'vid', target: 'out' },
      { source: 'txt', target: 'out' },
      { source: 'out', target: 'z' }, // 出边不该收
    ]
    const r = collectReferenceResources(nodes, edges, 'out')
    expect(r).toEqual([
      { kind: 'image', url: 'res:aaaa.png' },
      { kind: 'video', url: 'res:bbbb.mp4' },
      { kind: 'other', value: '一只猫' },
    ])
  })

  it('referenceNodeIds 追加、且与入边去重', () => {
    const nodes = [
      { id: 'a', type: 'image', data: { imageUrl: 'res:a.png' } },
      { id: 'b', type: 'image', data: { imageUrl: 'res:b.png' } },
      { id: 'out', type: 'image', data: {} },
    ]
    const r = collectReferenceResources(nodes, [{ source: 'a', target: 'out' }], 'out', ['a', 'b'])
    expect(r.map((x) => x.url)).toEqual(['res:a.png', 'res:b.png'])
  })

  it('没有入边 → 空（不硬塞参考图）', () => {
    expect(collectReferenceResources([{ id: 'out', type: 'image', data: {} }], [], 'out')).toEqual([])
  })
})

describe('generation_create 把提示词与参数写进节点', () => {
  it('提示词落 data.barPrompt、参数落 data.barValues（点开节点就能看到那次用的内容）', async () => {
    await mcpCall('canvas_batch_nodes', { canvasId: CANVAS, add: [{ type: 'image', id: 'out', data: {} }] })
    // 用一个不存在的 actionId：下单会失败，但「写回提示词」在 createJob 之前就做了，正好单独验它
    const r = await mcpCall('generation_create', {
      canvasId: CANVAS,
      nodeId: 'out',
      actionId: '不存在的动作',
      prompt: '花海人像，9:16',
      values: { ratio: '9:16' },
    })
    expect(r.ok).toBe(false)
    const snap = await mcpCall('canvas_get', { canvasId: CANVAS, nodeId: 'out' }) as { node: { data: Record<string, unknown> } }
    expect(snap.node.data.barPrompt).toBe('花海人像，9:16')
    expect(snap.node.data.barValues).toEqual({ ratio: '9:16', actionId: '不存在的动作' })
  })
})
