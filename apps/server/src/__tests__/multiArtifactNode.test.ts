/**
 * 生图多产物 → 自动拆节点（真实 HTTP 全链路）。
 *
 * 用户口径（2026-11-20）：豆包一次回多张图时，现在只显示第一张。
 * 单测已锁住 taskManager 的拆分逻辑；这里再走一遍「下单 → 轮询 → 落画布」，
 * 确认经过真实 server（画布落盘、增量写口、资源入库）之后仍然成立：
 *
 * 1. 第一张填原节点，其余各建一个图片节点；
 * 2. 新节点复制原节点的入边与底栏参数；
 * 3. 每张图都进了本画布资源目录（不再是 provider 的外链）。
 */
import { describe, it, expect, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createCloudServer, type CloudServer } from '../server'

let dir: string
let srv: CloudServer

afterEach(async () => {
  srv?.stop()
  if (dir) await fs.rm(dir, { recursive: true, force: true })
})

/** 造一张最小可读尺寸的 PNG（宽高写进 IHDR，后台能量出来） */
function pngBytes(w: number, h: number): Uint8Array {
  const b = new Uint8Array(24)
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  b.set([0, 0, 0, 13], 8)
  b.set([0x49, 0x48, 0x44, 0x52], 12)
  b[16] = (w >> 24) & 0xff; b[17] = (w >> 16) & 0xff; b[18] = (w >> 8) & 0xff; b[19] = w & 0xff
  b[20] = (h >> 24) & 0xff; b[21] = (h >> 16) & 0xff; b[22] = (h >> 8) & 0xff; b[23] = h & 0xff
  return b
}

/** 假 provider：一次任务回三张（data URL，后台可直接取字节，不依赖外部服务） */
function fakeProviderSource(urls: string[]): string {
  return `
export default {
  id: 'multi-artifact-demo',
  actions: [{
    id: 'demo:multi-image',
    title: '多图演示',
    group: '演示',
    nodeTypes: ['image'],
    needsPrompt: true,
    pollIntervalMs: 20,
    pollTimeoutMs: 20000,
  }],
  async submit() {
    return { taskId: 't1' }
  },
  async poll() {
    return { status: 'done', urls: ${JSON.stringify(urls)} }
  },
}
`
}

async function boot(urls: string[]): Promise<void> {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'multi-artifact-'))
  const providersDir = path.join(dir, 'providers')
  await fs.mkdir(providersDir, { recursive: true })
  await fs.writeFile(path.join(providersDir, 'multi-artifact.js'), fakeProviderSource(urls), 'utf8')
  srv = await createCloudServer({
    dir,
    providersDir,
    watchProviders: false,
    agent: false,
    mcp: false,
    requestTrust: false,
  })
}

async function post(pathname: string, body: unknown) {
  const res = await srv.app.fetch(
    new Request('http://localhost' + pathname, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
  return { status: res.status, json: (await res.json()) as any }
}

async function readCanvas(): Promise<{ nodes: any[]; edges: any[] }> {
  const res = await srv.app.fetch(new Request('http://localhost/api/canvases/default'))
  const body: any = await res.json()
  return { nodes: body.nodes ?? [], edges: body.edges ?? [] }
}

async function waitFor(cond: () => Promise<boolean>, ms = 8000): Promise<boolean> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await cond()) return true
    await new Promise((r) => setTimeout(r, 50))
  }
  return cond()
}

describe('多产物落画布（真实 server）', () => {
  it('回 3 张 → 3 个图片节点，新节点带上原节点的连线与底栏参数', async () => {
    const urls = [pngBytes(40, 40), pngBytes(64, 64), pngBytes(80, 80)].map(
      (bytes) => 'data:image/png;base64,' + Buffer.from(bytes).toString('base64'),
    )
    await boot(urls)

    // 上游参考文本 + 目标图片节点，先连一条线
    await post('/api/canvas/nodes', { add: [{ type: 'text', id: 'ref', data: { text: '一只猫' } }] })
    await post('/api/canvas/nodes', {
      add: [{
        type: 'image',
        id: 'n1',
        data: { barValues: { ratio: '16:9', actionId: 'demo:multi-image' }, barPrompt: '一只猫' },
      }],
    })
    await post('/api/canvas/edges', { add: [{ source: 'ref', target: 'n1' }] })

    const r = await post('/api/jobs', {
      canvasId: 'default',
      nodeId: 'n1',
      actionId: 'demo:multi-image',
      prompts: [{ type: 'prompt', value: '一只猫' }],
    })
    expect(r.status).toBe(200)
    const jobId = r.json.jobId as string

    // 等到任务终态（后台自己写节点）
    const done = await waitFor(async () => {
      const res = await srv.app.fetch(new Request('http://localhost/api/jobs/' + jobId))
      const body: any = await res.json()
      return body.ok && body.job?.status === 'done'
    })
    expect(done).toBe(true)

    const snap = await readCanvas()
    const images = snap.nodes.filter((n) => n.type === 'image')
    expect(images).toHaveLength(3)
    // 三张图各自有引用，且地址是本画布资源（不是 provider 外链）
    const refs = images.map((n) => String(n.data?.resourceId))
    expect(new Set(refs).size).toBe(3)
    for (const n of images) {
      expect(String(n.data?.imageUrl)).toMatch(/^\/api\/canvases\/default\/resources\//)
      expect(String(n.data?.resourceId)).toMatch(/^default\//)
    }
    // 新节点：抄了底栏参数、连着同一个上游、摆在原节点右侧
    const origin = images.find((n) => n.id === 'n1')!
    for (const extra of images.filter((n) => n.id !== 'n1')) {
      expect(extra.data?.barValues).toEqual({ ratio: '16:9', actionId: 'demo:multi-image' })
      expect(extra.data?.barPrompt).toBe('一只猫')
      expect(snap.edges.some((e) => e.target === extra.id && e.source === 'ref')).toBe(true)
      expect(extra.position.x).toBeGreaterThan(origin.position.x)
    }
  })
})
