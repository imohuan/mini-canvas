/**
 * 资源「同源地址 → 本机磁盘路径」这条缝（用户 2026-11-25 提的痛点）。
 *
 * 背景：Agent 手里只有 `/api/canvases/<id>/resources/<名>`，没有 `ctx.file` ——
 * 那是脚本子进程里的函数。以前它只能从系统提示里抄数据根、自己拼路径，
 * 换部署就错。两个新工具把「算路径」搬回服务端：
 *   · resource_local_path（要路径）
 *   · canvas_resource_fetch（连路径都不要，直接给字节）
 *
 * 顺带盯一条安全线：调用方塞 `../` 进来不能拼出画布外。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createCloudServer } from '../server.js'

const CANVAS = '59343957e74b4ce9'
const NAME = 'c4d62955120799cc.png'

let dir = ''
let srv: Awaited<ReturnType<typeof createCloudServer>> | undefined

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'plume-respath-'))
  // 造一张画布 + 一个图片节点 + 一份真实资源文件
  await fs.mkdir(path.join(dir, 'canvases', CANVAS, 'resources'), { recursive: true })
  await fs.writeFile(path.join(dir, 'canvases', CANVAS, 'canvas.json'), JSON.stringify({
    nodes: [
      {
        id: '84',
        type: 'image',
        position: { x: 0, y: 0 },
        data: {
          label: '图片 11',
          resourceId: CANVAS + '/' + NAME,
          imageUrl: '/api/canvases/' + CANVAS + '/resources/' + NAME + '?v=1',
        },
      },
    ],
    edges: [],
  }))
  await fs.writeFile(path.join(dir, 'canvases', CANVAS, 'resources', NAME), new Uint8Array([137, 80, 78, 71, 1, 2, 3]))
})

afterEach(async () => {
  srv?.stop()
  srv = undefined
  await fs.rm(dir, { recursive: true, force: true })
})

async function mcpCall(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const app = srv!.app
  const post = (body: unknown) =>
    app.fetch(
      new Request('http://localhost/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify(body),
      }),
    )
  await (
    await post({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '0' } },
    })
  ).text()
  const text = await (await post({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } })).text()
  const line = text.split('\n').find((l) => l.startsWith('data:')) ?? text
  const json = JSON.parse(line.replace(/^data:\s*/, ''))
  return JSON.parse(json.result.content[0].text)
}

async function boot(): Promise<void> {
  srv = await createCloudServer({ dir, port: 0, hostname: '127.0.0.1', watchProviders: false, agent: false })
  await srv.start()
}

const expected = () => path.join(dir, 'canvases', CANVAS, 'resources', NAME)

describe('资源本机路径', () => {
  it('★ resource_local_path：给 url 或给节点，两条都能算', async () => {
    await boot()
    const byUrl = await mcpCall('resource_local_path', {
      canvasId: CANVAS,
      url: '/api/canvases/' + CANVAS + '/resources/' + NAME + '?v=99',
    })
    expect(byUrl.ok).toBe(true)
    expect(byUrl.localPath).toBe(expected())
    expect(byUrl.exists).toBe(true)

    const byNode = await mcpCall('resource_local_path', { canvasId: CANVAS, nodeId: '84' })
    expect(byNode.localPath).toBe(expected())
  })

  it('★ 路径穿越被挡：不在白名单的资源名算不出来', async () => {
    await boot()
    const r = await mcpCall('resource_local_path', {
      canvasId: CANVAS,
      url: '/api/canvases/' + CANVAS + '/resources/../../../secret.txt',
    })
    expect(r.ok).toBe(false)
    expect(r.localPath).toBeUndefined()
  })

  it('★ canvas_resource_fetch：取回字节，并落一份到 Agent 工作目录', async () => {
    await boot()
    const r = await mcpCall('canvas_resource_fetch', { canvasId: CANVAS, nodeId: '84' })
    expect(r.ok).toBe(true)
    expect(r.size).toBe(7)
    expect(r.mime).toContain('image')
    expect(Buffer.from(String(r.base64), 'base64')).toEqual(Buffer.from([137, 80, 78, 71, 1, 2, 3]))
    // 落盘那份必须真的存在（Agent 的文件工具只能读自己工作目录）
    const agentPath = String(r.agentLocalPath)
    expect(agentPath).toContain(path.join('canvases', CANVAS, 'agent', 'workspace'))
    expect([...await fs.readFile(agentPath)]).toEqual([137, 80, 78, 71, 1, 2, 3])
  })
})
