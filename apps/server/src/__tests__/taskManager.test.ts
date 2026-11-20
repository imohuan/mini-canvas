/**
 * TaskManager 单测 —— 假 provider + 假时钟（不等真时间）。
 *
 * 锁的是「后台跑任务」这条链：下单立刻返回、进度写进节点、终态写节点并归档历史、
 * 取消会去服务端真取消（不是只停本地）、超时会收敛成失败（不留悬挂 running）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { CanvasStore } from '../store/canvasStore'
import { CanvasResourceStore } from '../store/canvasResources'
import { CanvasDocument } from '../mcp/canvasDoc'
import { ProviderRegistry } from '../providers/registry'
import { HistoryStore } from '../tasks/history'
import { TaskManager } from '../tasks/taskManager'
import type { ActionDef, Provider, ProviderPollResult } from '../providers/types'

let root: string
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'tasks-'))
})
afterEach(async () => {
  // 收掉可能还在跑的任务循环（否则它会继续往临时目录写，导致清理失败）
  await tasksRef?.dispose()
  tasksRef = undefined
  await fs.rm(root, { recursive: true, force: true })
})

/** 记住当前用例的 TaskManager，便于 afterEach 收尾 */
let tasksRef: TaskManager | undefined

const ACTION: ActionDef = { id: 'p:gen', title: '测试生成', nodeTypes: ['image'], tool: 't/x' }

/** 造一个带 IHDR 的最小 PNG（宽高可读），用来验后台收产物时能量出图片尺寸 */
function pngBytes(w: number, h: number): Uint8Array {
  const b = new Uint8Array(24)
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  b.set([0, 0, 0, 13], 8)
  b.set([0x49, 0x48, 0x44, 0x52], 12)
  b[16] = (w >> 24) & 0xff; b[17] = (w >> 16) & 0xff; b[18] = (w >> 8) & 0xff; b[19] = w & 0xff
  b[20] = (h >> 24) & 0xff; b[21] = (h >> 16) & 0xff; b[22] = (h >> 8) & 0xff; b[23] = h & 0xff
  return b
}

/** 造一套依赖：真 doc（写临时目录）+ 指定行为的假 provider */
async function setup(
  provider: Provider,
  opts: {
    interval?: number
    timeoutMs?: number
    artifact?: Uint8Array
    /** 按产物地址给不同字节（多产物用例要能造出内容不同的几张图） */
    artifacts?: (url: string) => Uint8Array | undefined
    action?: ActionDef
  } = {},
) {
  const action = opts.action ?? ACTION
  const doc = new CanvasDocument(new CanvasStore(root), new CanvasResourceStore(root))
  const registry = new ProviderRegistry()
  registry.add({ ...provider, actions: [action] })
  const history = new HistoryStore(root)
  let clock = 1_000_000
  const tasks = new TaskManager({
    doc,
    registry,
    history,
    resolveResourceUrl: async (canvasId, ref) => '/api/canvases/' + canvasId + '/resources/' + ref.replace('res:', ''),
    // 假取字节：测试里不去连真地址（产物地址都是编的），给一小段假 PNG 字节即可
    fetchArtifact: async (url) =>
      opts.artifacts?.(url) ?? opts.artifact ?? new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    now: () => clock,
    // 假睡眠：不动真时间，但推进假时钟（否则超时判断永远为假）
    sleep: async (ms) => {
      clock += ms
    },
  })
  registry.getAction(action.id)!.pollIntervalMs = opts.interval ?? 0
  registry.getAction(action.id)!.pollTimeoutMs = opts.timeoutMs ?? 10_000_000
  tasksRef = tasks

  // 先建一个节点（任务要往它身上写进度）
  await doc.batchNodes({ add: [{ type: 'image', id: 'n1' }] })
  return { doc, registry, history, tasks }
}

/** 等条件成立（后台任务是异步跑的） */
async function waitFor(cond: () => boolean, ms = 2000): Promise<boolean> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (cond()) return true
    await new Promise((r) => setTimeout(r, 5))
  }
  return cond()
}

describe('下单', () => {
  it('视频产物 → 量出 videoWidth/videoHeight 写进视频节点（9:16 不该显示成横的）', async () => {
    const VIDEO_ACTION: ActionDef = { id: 'p:vid', title: '测试出视频', nodeTypes: ['video'], tool: 't/v' }
    // 最小 MP4：ftyp + moov>trak>tkhd（宽 1080 高 1920）
    const box = (type: string, payload: Uint8Array): Uint8Array => {
      const out = new Uint8Array(8 + payload.length)
      const size = out.length
      out[0] = (size >> 24) & 0xff; out[1] = (size >> 16) & 0xff; out[2] = (size >> 8) & 0xff; out[3] = size & 0xff
      for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
      out.set(payload, 8)
      return out
    }
    const put32 = (a: Uint8Array, o: number, v: number) => { a[o] = (v >>> 24) & 0xff; a[o + 1] = (v >>> 16) & 0xff; a[o + 2] = (v >>> 8) & 0xff; a[o + 3] = v & 0xff }
    const tkhdPayload = new Uint8Array(84)
    put32(tkhdPayload, 76, 1080 << 16)
    put32(tkhdPayload, 80, 1920 << 16)
    const ftypBox = box('ftyp', new Uint8Array([0x69, 0x73, 0x6f, 0x6d]))
    const moovB = box('moov', box('trak', box('tkhd', tkhdPayload)))
    const mp4 = new Uint8Array(ftypBox.length + moovB.length)
    mp4.set(ftypBox, 0); mp4.set(moovB, ftypBox.length)

    const p: Provider = {
      id: 'p', actions: [VIDEO_ACTION],
      async submit() { return { taskId: 'pt1' } },
      async poll() { return { status: 'done', urls: ['http://localhost:8033/api/resources/videos/doubao/v-clip.mp4'] } },
    }
    const { doc, tasks } = await setup(p, { artifact: mp4, action: VIDEO_ACTION })
    const job = await tasks.createJob({ canvasId: 'default', nodeId: 'n1', actionId: VIDEO_ACTION.id })
    expect('error' in job).toBe(false)
    await waitFor(() => tasks.getJob((job as { id: string }).id)?.status === 'done')
    const node = (await doc.read()).nodes.find((n) => n.id === 'n1')!
    expect(node.data?.videoWidth).toBe(1080)
    expect(node.data?.videoHeight).toBe(1920)
  })

  it('任务成功 → 产物写进节点的媒体字段（同源地址），不是只写 runState.urls', async () => {
    const p: Provider = {
      id: 'p', actions: [ACTION],
      async submit() { return { taskId: 'pt1' } },
      async poll() { return { status: 'done', urls: ['http://localhost:8033/api/resources/images/doubao/x-abc.jpeg'] } },
    }
    // 产物字节给一张 9:16 的 PNG：验后台能量出尺寸并写进节点（否则卡片停在 4:3）
    const { doc, tasks } = await setup(p, { artifact: pngBytes(1152, 2048) })
    const job = await tasks.createJob({ canvasId: 'default', nodeId: 'n1', actionId: ACTION.id })
    expect('error' in job).toBe(false)
    await waitFor(() => tasks.getJob((job as { id: string }).id)?.status === 'done')
    const node = (await doc.read()).nodes.find((n) => n.id === 'n1')!
    // 关键：图片节点要靠 imageUrl 才显示；只写 runState.urls 会「生成了却看不到内容」。
    // 地址是**按内容哈希**存的（不是原文件名），所以只断言「同源 + 在画布资源目录下 + 扩展名对」。
    expect(String(node.data?.imageUrl)).toMatch(/^\/api\/canvases\/default\/resources\/[0-9a-f]+\.jpeg$/)
    expect((node.data?.runState as { urls?: string[] })?.urls).toHaveLength(1)
    // 文件真的落盘了（这是重点：没有它图片会显示「已失效」）
    const hashName = String(node.data?.imageUrl).split('/').pop()!
    await fs.access(path.join(root, 'canvases', 'default', 'resources', hashName))
    // 尺寸也量出来写进节点了（前端据此把卡片调成 9:16）
    expect(node.data?.imageWidth).toBe(1152)
    expect(node.data?.imageHeight).toBe(2048)
    // 历史也要存**同源地址**：前端拿它当缩略图；存 web2api 原始文件名会被资源接口判非法（400）→ 裂图
    const hist = await new HistoryStore(root).readAll('default')
    expect(hist[0]?.urls?.[0]).toBe(node.data?.imageUrl)
    const rsUrls = (node.data?.runState as { urls?: string[] } | undefined)?.urls
    expect(String(rsUrls?.[0] ?? '')).toMatch(/^\/api\/canvases\/default\/resources\//)
  })

  /**
   * 用户实测 2026-11-20（图片 17）：节点上本来有旧图（带 resourceId），重新生成后
   * 画布上还是旧图 —— 后台只写了 imageUrl，旧 resourceId 没换；而图片组件优先按
   * resourceId 现取、保存时又会把 imageUrl 当冗余地址删掉，于是新图整份丢掉。
   *
   * 锁住：产物落地时 resourceId 必须跟着换成新资源，旧地址也要被顶掉。
   */
  it('已有旧图的节点重新生成 → resourceId 换成新资源（不能只写 imageUrl）', async () => {
    const p: Provider = {
      id: 'p', actions: [ACTION],
      async submit() { return { taskId: 'pt1' } },
      async poll() { return { status: 'done', urls: ['http://localhost:8033/api/resources/images/doubao/new-abc.jpeg'] } },
    }
    const { doc, tasks } = await setup(p, { artifact: pngBytes(512, 512) })
    // 先放一张旧图（与线上那张 图片 17 一样：旧 resourceId + 旧 imageUrl）
    await doc.batchNodes({
      update: [{ id: 'n1', data: { resourceId: 'default/old.png', imageUrl: '/api/canvases/default/resources/old.png' } }],
    })
    const job = await tasks.createJob({ canvasId: 'default', nodeId: 'n1', actionId: ACTION.id })
    expect('error' in job).toBe(false)
    await waitFor(() => tasks.getJob((job as { id: string }).id)?.status === 'done')
    const node = (await doc.read()).nodes.find((n) => n.id === 'n1')!
    expect(node.data?.resourceId).toMatch(/^default\/[0-9a-f]+\.jpeg$/)
    // 旧图不能被留成第二份真相
    expect(node.data?.resourceId).not.toBe('default/old.png')
    expect(String(node.data?.imageUrl)).toContain(String(node.data?.resourceId).replace('default/', ''))
  })

  /**
   * 字段按**目标节点自己的类型**选（用户口径 2026-11-20：不管生成哪种类型，都必须设 resourceId）。
   * 可视化节点（type=ui）的产物地址在 uiOutputUrl —— 只按动作声明猜 imageUrl 的话，
   * UI 节点会「任务成功但卡片空着」。
   */
  it('可视化节点接生成任务 → 写 uiOutputUrl + uiOutputType，并设 resourceId', async () => {
    const p: Provider = {
      id: 'p', actions: [ACTION],
      async submit() { return { taskId: 'pt1' } },
      async poll() { return { status: 'done', urls: ['http://localhost:8033/api/resources/images/doubao/ui-out.png'] } },
    }
    const { doc, tasks } = await setup(p, { artifact: pngBytes(64, 64) })
    // 把节点改成可视化节点（同一个 id，任务仍写它）：先删再建，不能放同一批
    await doc.batchNodes({ delete: ['n1'] })
    await doc.batchNodes({ add: [{ type: 'ui', id: 'n1' }] })
    const job = await tasks.createJob({ canvasId: 'default', nodeId: 'n1', actionId: ACTION.id })
    expect('error' in job).toBe(false)
    await waitFor(() => tasks.getJob((job as { id: string }).id)?.status === 'done')
    const node = (await doc.read()).nodes.find((n) => n.id === 'n1')!
    expect(node.data?.resourceId).toMatch(/^default\/[0-9a-f]+\.png$/)
    expect(String(node.data?.uiOutputUrl)).toMatch(/^\/api\/canvases\/default\/resources\//)
    expect(node.data?.uiOutputType).toBe('image')
    // 地址就是引用的投影，不是另写一份
    expect(node.data?.uiOutputUrl).toContain(String(node.data?.resourceId).replace('default/', ''))
  })

  it('任务结果带回引用（前端不必从地址反推）', async () => {
    const p: Provider = {
      id: 'p', actions: [ACTION],
      async submit() { return { taskId: 'pt1' } },
      async poll() { return { status: 'done', urls: ['https://x/1.png'] } },
    }
    const { tasks } = await setup(p, { artifact: pngBytes(8, 8) })
    const job = (await tasks.createJob({ canvasId: 'default', nodeId: 'n1', actionId: ACTION.id })) as { id: string }
    await waitFor(() => tasks.getJob(job.id)?.status === 'done')
    expect(tasks.getJob(job.id)?.result?.resourceId).toMatch(/^default\/[0-9a-f]+\.png$/)
  })

  /**
   * 多产物（用户口径 2026-11-20）：豆包一次回多张时，只显示第一张是 bug。
   * 期望：第 1 张写原节点，其余每张各建一个图片节点，并复制原节点的入边与底栏参数。
   */
  it('一次回 3 张 → 原节点放第 1 张，另外各建一个节点（复制入边 + 底栏参数）', async () => {
    const p: Provider = {
      id: 'p',
      actions: [ACTION],
      async submit() { return { taskId: 'pt1' } },
      async poll() {
        return {
          status: 'done',
          urls: [
            'http://localhost:8033/api/resources/images/doubao/a.png',
            'http://localhost:8033/api/resources/images/doubao/b.png',
            'http://localhost:8033/api/resources/images/doubao/c.png',
          ],
        }
      },
    }
    // 三张必须是不同字节（内容哈希不同），否则会被当成同一张图去重
    const sizes: Record<string, number> = { 'a.png': 64, 'b.png': 96, 'c.png': 128 }
    const { doc, tasks } = await setup(p, {
      artifacts: (url) => pngBytes(sizes[url.split('/').pop() ?? ''] ?? 64, 64),
    })
    // 原节点带上底栏配置，并连一个上游参考图（新节点要把这条边也复制过去）
    await doc.batchNodes({
      update: [{
        id: 'n1',
        data: { barValues: { ratio: '16:9', actionId: ACTION.id }, barPrompt: '一只猫' },
      }],
    })
    await doc.batchNodes({ add: [{ type: 'image', id: 'ref' }] })
    await doc.batchEdges({ add: [{ source: 'ref', target: 'n1' }] })

    const job = (await tasks.createJob({ canvasId: 'default', nodeId: 'n1', actionId: ACTION.id })) as { id: string }
    expect(await waitFor(() => tasks.getJob(job.id)?.status === 'done')).toBe(true)

    const snap = await doc.read()
    // 原节点 + 2 个新节点（参考图节点另算）
    const images = snap.nodes.filter((n) => n.type === 'image' && n.id !== 'ref')
    expect(images).toHaveLength(3)
    // 每张图都有自己的资源，不是三份都指第一张
    const refs = images.map((n) => String(n.data?.resourceId))
    expect(new Set(refs).size).toBe(3)
    // 地址是引用的投影：每条地址都指向自己的那份资源
    for (const n of images) {
      expect(String(n.data?.imageUrl)).toContain(String(n.data?.resourceId).replace('default/', ''))
    }

    // 新节点抄了底栏参数（点开就是同一个模型同一套参数），并且已经是 done
    for (const extra of images.slice(1)) {
      expect(extra.data?.barValues).toEqual({ ratio: '16:9', actionId: ACTION.id })
      expect(extra.data?.barPrompt).toBe('一只猫')
      expect((extra.data?.runState as { status?: string })?.status).toBe('done')
      // 不带 taskId：否则前端对账会把它当成原任务再写一遍
      expect((extra.data?.runState as { taskId?: string })?.taskId).toBeUndefined()
      // 尺寸按各自那张图量
      expect(typeof extra.data?.imageWidth).toBe('number')
      // 入边复制：每个新节点都连着同一个上游参考图
      expect(snap.edges.some((e) => e.target === extra.id && e.source === 'ref')).toBe(true)
    }
    // 摆在原节点右侧，不重叠
    const originX = snap.nodes.find((n) => n.id === 'n1')!.position.x
    for (const extra of images.slice(1)) expect(extra.position.x).toBeGreaterThan(originX)

    // 历史与 runState 都是完整的一组同源地址（缩略图才打得开）
    const hist = await new HistoryStore(root).readAll('default')
    expect(hist[0]?.urls).toHaveLength(3)
    for (const u of hist[0]!.urls!) expect(u).toMatch(/^\/api\/canvases\/default\/resources\//)
  })

  /** 同一张图重复返回（内容哈希一样）只建一个节点，避免画出两个一模一样的节点 */
  it('重复返回同一张图 → 只建一个节点', async () => {
    const p: Provider = {
      id: 'p',
      actions: [ACTION],
      async submit() { return { taskId: 'pt1' } },
      async poll() {
        return {
          status: 'done',
          urls: [
            'http://localhost:8033/api/resources/images/doubao/a.png',
            'http://localhost:8033/api/resources/images/doubao/a-copy.png',
          ],
        }
      },
    }
    // 两个地址给同一份字节 → 内容哈希相同
    const { doc, tasks } = await setup(p, { artifact: pngBytes(32, 32) })
    const job = (await tasks.createJob({ canvasId: 'default', nodeId: 'n1', actionId: ACTION.id })) as { id: string }
    expect(await waitFor(() => tasks.getJob(job.id)?.status === 'done')).toBe(true)
    expect((await doc.read()).nodes.filter((n) => n.type === 'image')).toHaveLength(1)
  })

  /**
   * 同一个节点第二次生成（用户实测 2026-11-20）：第一批 4 个节点已经在右边了，
   * 第二批不能再压在它们身上 —— 看起来会像"没生成出来"。
   */
  it('同一节点再生成一批 → 新节点避开上一批的位置', async () => {
    let round = 0
    const p: Provider = {
      id: 'p',
      actions: [ACTION],
      async submit() { return { taskId: 'pt1' } },
      async poll() {
        round += 1
        const n = round * 100
        return {
          status: 'done',
          urls: [
            'https://x/a' + n + '.png',
            'https://x/b' + n + '.png',
          ],
        }
      },
    }
    const { doc, tasks } = await setup(p, { artifacts: (url) => pngBytes(url.includes('a') ? 64 : 96, 64) })
    const first = (await tasks.createJob({ canvasId: 'default', nodeId: 'n1', actionId: ACTION.id })) as { id: string }
    expect(await waitFor(() => tasks.getJob(first.id)?.status === 'done')).toBe(true)
    const second = (await tasks.createJob({ canvasId: 'default', nodeId: 'n1', actionId: ACTION.id })) as { id: string }
    expect(await waitFor(() => tasks.getJob(second.id)?.status === 'done')).toBe(true)

    const images = (await doc.read()).nodes.filter((n) => n.type === 'image')
    expect(images).toHaveLength(3)
    // 任何两个节点的位置都不能几乎重合
    for (const a of images) {
      for (const b of images) {
        if (a.id === b.id) continue
        const sameX = Math.abs(a.position.x - b.position.x) < 100
        const sameY = Math.abs(a.position.y - b.position.y) < 100
        expect(sameX && sameY).toBe(false)
      }
    }
  })

  /**
   * 同一行里有竖图 / 横图混着（用户实测截到过重叠）：
   * 以前按每个节点自己的高度算 y，矮的会往上浮、压住上一行；现在按「这一行最高的那张」算行高。
   * 这里造一批 3:4 竖图 + 一张 4:3 横图，断言同一行的 y 完全相同、两行之间不重叠。
   */
  it('竖图横图混排 → 同一行对齐、两行不重叠', async () => {
    const p: Provider = {
      id: 'p',
      actions: [ACTION],
      async submit() { return { taskId: 'pt1' } },
      async poll() {
        return {
          status: 'done',
          urls: ['https://x/1.png', 'https://x/2.png', 'https://x/3.png', 'https://x/4.png', 'https://x/5.png'],
        }
      },
    }
    // 1、2、4 是三张竖图（320×426），3 是横图（320×240）
    const shapes: Record<string, [number, number]> = {
      '1.png': [320, 426],
      '2.png': [320, 426],
      '3.png': [320, 240],
      '4.png': [320, 426],
      '5.png': [320, 426],
    }
    const { doc, tasks } = await setup(p, {
      artifacts: (url) => {
        const name = url.split('/').pop() ?? ''
        const [w, h] = shapes[name] ?? [320, 240]
        // 三张竖图尺寸一样，要补一点不同的字节，否则会被当成同一张图去重
        const bytes = pngBytes(w, h)
        const out = new Uint8Array(bytes.length + 1)
        out.set(bytes, 0)
        out[bytes.length] = (name.charCodeAt(0) % 97) + 1
        return out
      },
    })
    const job = (await tasks.createJob({ canvasId: 'default', nodeId: 'n1', actionId: ACTION.id })) as { id: string }
    expect(await waitFor(() => tasks.getJob(job.id)?.status === 'done')).toBe(true)

    const extras = (await doc.read()).nodes.filter((n) => n.type === 'image' && n.id !== 'n1')
    // 5 张 → 第 1 张进原节点，其余 4 张分两行（一行 3 个）
    expect(extras).toHaveLength(4)
    // 第一行（前两张）y 必须一致：不能一张高一张矮就错开
    expect(extras[0]!.position.y).toBe(extras[1]!.position.y)
    // 第二行（第 4 个）在第一行下面，且留出足够距离（第一行最高那张 426 高）
    expect(extras[3]!.position.y).toBeGreaterThanOrEqual(extras[0]!.position.y + 400)
    expect(extras[0]!.position.y).toBe(extras[2]!.position.y)
  })

  /**
   * 横向宽图（用户实测 2026-11-20：1296×500 的图卡片比 320 宽）：
   * 以前按固定列宽摆，它会压住右边那张；现在按 fitMediaCard 同一套规则算出卡片宽高，
   * 逐列累加摆放，并把尺寸直接写进节点。
   */
  it('横向宽图 → 卡片按图片比例算宽，不压住右边的节点', async () => {
    const p: Provider = {
      id: 'p',
      actions: [ACTION],
      async submit() { return { taskId: 'pt1' } },
      async poll() {
        return { status: 'done', urls: ['https://x/wide.png', 'https://x/next.png', 'https://x/third.png'] }
      },
    }
    // wide.png 是 1296×500（卡片宽约 429）；next.png / third.png 是 320×320（卡片 320）
    const shapes: Record<string, [number, number]> = { 'wide.png': [1296, 500], 'next.png': [320, 320] }
    const { doc, tasks } = await setup(p, {
      artifacts: (url) => {
        const name = url.split('/').pop() ?? ''
        const [w, h] = shapes[name] ?? [320, 320]
        // 三张里有两张尺寸一样，补一点字节差异，否则会被当成同一张去重
        const bytes = pngBytes(w, h)
        const out = new Uint8Array(bytes.length + 1)
        out.set(bytes, 0)
        out[bytes.length] = (name.charCodeAt(0) % 97) + 1
        return out
      },
    })
    const job = (await tasks.createJob({ canvasId: 'default', nodeId: 'n1', actionId: ACTION.id })) as { id: string }
    expect(await waitFor(() => tasks.getJob(job.id)?.status === 'done')).toBe(true)

    const images = (await doc.read()).nodes.filter((n) => n.type === 'image')
    expect(images).toHaveLength(3)
    const [origin, wide] = images
    // 摆放按真实卡片尺寸推：宽图卡片按 420 上限算宽（1296×500 → 420×162 附近），
    // 右边那张的 x 必须在宽图右边界 + 间距之后，而不是固定列宽的 808。
    expect(wide!.position.x).toBeGreaterThan(400)
    expect(wide!.position.x).toBeGreaterThanOrEqual(origin!.position.x + (origin!.size?.w ?? 320) + 48)
    const third = images[2]
    if (third) expect(third.position.x).toBeGreaterThanOrEqual(wide!.position.x + (wide!.size?.w ?? 320) + 48)
  })

  /**
   * 用户实测 2026-11-20（截图：图片 19/20 跑到了原节点右下角）：
   * 宽图卡片 420 宽，旧避让用「左上角距离」近似判断，把没重叠的一行误判成重叠，
   * 整行被推到下一行。锁住：卡片明明放得下时，必须停在第一行。
   */
  it('宽图能放下时不被误判重叠（不整行下坠）', async () => {
    const p: Provider = {
      id: 'p',
      actions: [ACTION],
      async submit() { return { taskId: 'pt1' } },
      async poll() {
        return { status: 'done', urls: ['https://x/tall.png', 'https://x/wide.png', 'https://x/legs.png'] }
      },
    }
    // tall.png 256×384（卡片约 165×248）；wide.png 1296×500（卡片约 420×162）；legs.png 410×410（卡片 320）
    const shapes: Record<string, [number, number]> = {
      'tall.png': [256, 384],
      'wide.png': [1296, 500],
      'legs.png': [410, 410],
    }
    const { doc, tasks } = await setup(p, {
      artifacts: (url) => {
        const name = url.split('/').pop() ?? ''
        const [w, h] = shapes[name] ?? [320, 320]
        const bytes = pngBytes(w, h)
        const out = new Uint8Array(bytes.length + 1)
        out.set(bytes, 0)
        out[bytes.length] = (name.charCodeAt(0) % 97) + 1
        return out
      },
    })
    // 原节点没有显式 size：按类型默认 320×240 估（与线上截图一致）
    const job = (await tasks.createJob({ canvasId: 'default', nodeId: 'n1', actionId: ACTION.id })) as { id: string }
    expect(await waitFor(() => tasks.getJob(job.id)?.status === 'done')).toBe(true)

    const images = (await doc.read()).nodes.filter((n) => n.type === 'image')
    expect(images).toHaveLength(3)
    // 两张新节点都在第一行（y 与原节点一致），没有被误判成重叠而掉到下一行
    const origin = images[0]!
    for (const extra of images.slice(1)) {
      expect(extra.position.y).toBe(origin.position.y)
      // x 依次往右排，且不与原节点重叠
      expect(extra.position.x).toBeGreaterThanOrEqual(origin.position.x + 320 + 48)
    }
    expect(images[2]!.position.x).toBeGreaterThanOrEqual(images[1]!.position.x + (images[1]!.size?.w ?? 320) + 48)
  })

  /** 第 2 张取不到字节：跳过它，第 1、3 张照常落地，任务仍算成功 */
  it('某一张取不到字节 → 跳过那一张，其它照常落地', async () => {
    const p: Provider = {
      id: 'p',
      actions: [ACTION],
      async submit() { return { taskId: 'pt1' } },
      async poll() {
        return {
          status: 'done',
          urls: [
            'http://localhost:8033/api/resources/images/doubao/ok1.png',
            'http://localhost:8033/api/resources/images/doubao/broken.png',
            'http://localhost:8033/api/resources/images/doubao/ok2.png',
          ],
        }
      },
    }
    const { doc, tasks } = await setup(p, {
      // 中间那张取字节直接失败（模拟上游资源 404）
      artifacts: (url) => {
        if (url.endsWith('broken.png')) throw new Error('取产物失败 404')
        // 两张好图要给不同字节，否则会被当成同一张去重
        return pngBytes(url.includes('ok1') ? 40 : 80, 40)
      },
    })
    const job = (await tasks.createJob({ canvasId: 'default', nodeId: 'n1', actionId: ACTION.id })) as { id: string }
    expect(await waitFor(() => tasks.getJob(job.id)?.status === 'done')).toBe(true)
    // 原节点 + 1 个新节点（坏的那张被跳过）
    expect((await doc.read()).nodes.filter((n) => n.type === 'image')).toHaveLength(2)
  })

  it('历史记下生成参数：提示词 / 参数 / 参考素材 / 媒体元数据（尺寸·时长·大小）', async () => {
    const p: Provider = {
      id: 'p', actions: [ACTION],
      async submit() { return { taskId: 'pt1' } },
      async poll() { return { status: 'done', urls: ['https://x/1.png'] } },
    }
    const { tasks, history } = await setup(p, { artifact: pngBytes(1024, 1536) })
    const job = await tasks.createJob({
      canvasId: 'default',
      nodeId: 'n1',
      actionId: ACTION.id,
      prompts: [{ type: 'prompt', value: '一个坐在窗边的女孩' }],
      values: { ratio: '2:3', quality: '2k' },
      resources: [
        { kind: 'image', url: '/api/canvases/default/resources/abc.png' },
        { kind: 'text', value: '参考风格：柔和逆光' },
      ],
    })
    expect('error' in job).toBe(false)
    await waitFor(() => tasks.getJob((job as { id: string }).id)?.status === 'done')
    const all = await history.readAll('default')
    expect(all).toHaveLength(1)
    const h = all[0]
    // 参数与参考素材必须落进账本 —— 否则详情弹窗只能看到一张图，无法复盘
    expect(h.prompts).toEqual([{ type: 'prompt', value: '一个坐在窗边的女孩' }])
    expect(h.values).toEqual({ ratio: '2:3', quality: '2k' })
    expect(h.resources).toEqual([
      { kind: 'image', url: '/api/canvases/default/resources/abc.png' },
      { kind: 'text', value: '参考风格：柔和逆光' },
    ])
    // 媒体元数据：尺寸 + 字节数（图片没有时长，不该瞎填一个 0）
    expect(h.media?.width).toBe(1024)
    expect(h.media?.height).toBe(1536)
    expect(h.media?.bytes).toBeGreaterThan(0)
    expect(h.media?.durationMs).toBeUndefined()
  })

  it('同一（画布, 节点）已有在跑任务时 → 挡下重复下单（连点保护）', async () => {
    const p: Provider = { id: 'p', actions: [ACTION], async submit() { return { taskId: 'pt1' } }, async poll() { return { status: 'running' } } }
    const { tasks } = await setup(p, { interval: 100000 })
    const first = await tasks.createJob({ canvasId: 'default', nodeId: 'n1', actionId: ACTION.id })
    expect('error' in first).toBe(false)
    // 第二次（同一个画布+节点）应被拒，而不是创建第二个任务
    const second = await tasks.createJob({ canvasId: 'default', nodeId: 'n1', actionId: ACTION.id })
    expect('error' in second).toBe(true)
    expect((second as { error: string }).error).toContain('已有任务在进行中')
    // 另一个节点仍然可以下单（不该误伤）
    const other = await tasks.createJob({ canvasId: 'default', nodeId: 'n2', actionId: ACTION.id })
    expect('error' in other).toBe(false)
  })

  it('多画布：进度写进**任务所属那张画布**（写错画布会表现为"进度一直卡 0"）', async () => {
    const p: Provider = {
      id: 'p', actions: [ACTION],
      async submit() { return { taskId: 'pt1' } },
      async poll(): Promise<ProviderPollResult> { return { status: 'done', urls: ['https://x/1.png'] } },
    }
    // 造两张画布：default（共享 doc）与 other（另一个 CanvasDocument）
    const defaultDoc = new CanvasDocument(new CanvasStore(root), new CanvasResourceStore(root))
    const otherDoc = new CanvasDocument(new CanvasStore(root), new CanvasResourceStore(root), 'other')
    const registry = new ProviderRegistry()
    registry.add({ ...p, actions: [ACTION] })
    const tasks = new TaskManager({
      doc: defaultDoc,
      docForCanvas: (id) => (id === 'other' ? otherDoc : defaultDoc),
      registry,
      history: new HistoryStore(root),
      resolveResourceUrl: async (canvasId, ref) => '/api/canvases/' + canvasId + '/resources/' + ref.replace('res:', ''),
      fetchArtifact: async () => new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    })
    tasksRef = tasks
    await defaultDoc.batchNodes({ add: [{ type: 'image', id: 'n1' }] })
    await otherDoc.batchNodes({ add: [{ type: 'image', id: 'n1' }] })

    const job = (await tasks.createJob({ canvasId: 'other', nodeId: 'n1', actionId: ACTION.id })) as { id: string }
    expect(await waitFor(() => tasks.getJob(job.id)?.status === 'done')).toBe(true)

    // other 那张画布上的节点拿到了终态；default 上同名节点**不该**被写（写错画布的症状）
    expect((await runStateOf(otherDoc, 'n1')).status).toBe('done')
    expect((await runStateOf(defaultDoc, 'n1')).status).toBeUndefined()
  })

  it('立刻返回 jobId，并把提交态写进节点', async () => {
    const p: Provider = { id: 'p', actions: [ACTION], async submit() { return { taskId: 'pt1' } }, async poll() { return { status: 'running' } } }
    const { doc, tasks } = await setup(p, { interval: 100000 })
    const job = await tasks.createJob({ canvasId: 'default', nodeId: 'n1', actionId: ACTION.id })
    expect('error' in job).toBe(false)
    const id = (job as { id: string }).id
    expect(id).toBeTruthy()
    const rs = await runStateOf(doc, 'n1')
    expect(rs.status).toBe('running')
    // runState.taskId 存的是 **jobId**（刷新续查 / 取消都打它）
    expect(rs.taskId).toBe(id)
  })

  /**
   * 用户口径 2026-11-10：取消按钮的显示依据写在节点数据里 ——
   * 节点壳只读 `runState.canCancel`，不查动作表（刷新后动作清单还没到也不会误判）。
   */
  it('提交帧就写 canCancel（动作有 cancel → true）', async () => {
    const p: Provider = {
      id: 'p',
      actions: [ACTION],
      async submit() {
        return { taskId: 'pt1' }
      },
      async poll() {
        return { status: 'running' as const }
      },
    }
    const { doc, tasks } = await setup(p, {
      interval: 100000,
      action: { ...ACTION, cancel: async () => {} },
    })
    await tasks.createJob({ canvasId: 'default', nodeId: 'n1', actionId: ACTION.id })
    expect((await runStateOf(doc, 'n1')).canCancel).toBe(true)
  })

  it('动作和平台都没有 cancel → canCancel:false（不给假按钮）', async () => {
    const p: Provider = {
      id: 'p',
      actions: [ACTION],
      async submit() {
        return { taskId: 'pt1' }
      },
      async poll() {
        return { status: 'running' as const }
      },
    }
    const { doc, tasks } = await setup(p, { interval: 100000 })
    await tasks.createJob({ canvasId: 'default', nodeId: 'n1', actionId: ACTION.id })
    expect((await runStateOf(doc, 'n1')).canCancel).toBe(false)
  })

  it('进度帧不会把 canCancel 冲掉（每一帧都要带）', async () => {
    let polls = 0
    const p: Provider = {
      id: 'p',
      actions: [ACTION],
      async submit() {
        return { taskId: 'pt1' }
      },
      async poll(): Promise<ProviderPollResult> {
        polls += 1
        if (polls < 3) return { status: 'running', progress: polls * 20 }
        return { status: 'done', urls: ['https://x/1.png'] }
      },
    }
    const { doc, tasks } = await setup(p, { action: { ...ACTION, cancel: async () => {} } })
    const job = (await tasks.createJob({ canvasId: 'default', nodeId: 'n1', actionId: ACTION.id })) as { id: string }
    expect(await waitFor(() => tasks.getJob(job.id)?.status === 'done')).toBe(true)
    expect((await runStateOf(doc, 'n1')).canCancel).toBe(true)
  })

  it('未知动作 → 明确报错（不是静默挂着）', async () => {
    const p: Provider = { id: 'p', actions: [ACTION], async submit() { return { done: true } } }
    const { tasks } = await setup(p)
    const r = await tasks.createJob({ canvasId: 'default', nodeId: 'n1', actionId: '不存在' })
    expect('error' in r).toBe(true)
  })
})

describe('异步推进到终态', () => {
  /**
   * 卡片上那行状态文案直接来自节点里的 runState.message，
   * 所以必须在后台就把上游的英文词翻成中文（用户 2026-11-10）。
   */
  it('进度写进节点，终态写 done + 归档一笔历史', async () => {
    let polls = 0
    const p: Provider = {
      id: 'p',
      actions: [ACTION],
      async submit() { return { taskId: 'pt1' } },
      async poll(): Promise<ProviderPollResult> {
        polls += 1
        if (polls < 3) return { status: 'running', progress: polls * 30, message: '跑了 ' + polls }
        return { status: 'done', urls: ['https://x/1.png'] }
      },
    }
    const { doc, history, tasks } = await setup(p)
    const job = (await tasks.createJob({ canvasId: 'default', nodeId: 'n1', actionId: ACTION.id })) as { id: string }

    expect(await waitFor(() => tasks.getJob(job.id)?.status === 'done')).toBe(true)

    // 节点上是终态（前端读的就是它）
    const rs = await runStateOf(doc, 'n1')
    expect(rs.status).toBe('done')
    // runState.urls 现在也存**同源地址**（与节点 media / 历史一致）——
    // 存 provider 原始地址的话，前端拿它当缩略图会被资源接口判非法（400）
    expect(String((rs.urls as string[] | undefined)?.[0] ?? '')).toMatch(/^\/api\/canvases\/default\/resources\/[0-9a-f]+\.png$/)

    // 历史里多了一笔（后台归档，所以 MCP 下的单也会被记上）
    const all = await history.readAll('default')
    expect(all).toHaveLength(1)
    expect(all[0]).toMatchObject({ title: '测试生成', kind: 'image', status: 'done', rating: 'passed' })
    // 历史里的产物地址也换成**同源地址**（前端缩略图直接用它）
    expect(String(all[0].urls?.[0] ?? '')).toMatch(/^\/api\/canvases\/default\/resources\/[0-9a-f]+\.png$/)
  })

  it('同步完成（submit 直接给结果）也写节点 + 归档', async () => {
    const p: Provider = { id: 'p', actions: [ACTION], async submit() { return { done: true, urls: ['https://x/ok.png'] } } }
    const { doc, history, tasks } = await setup(p)
    const job = (await tasks.createJob({ canvasId: 'default', nodeId: 'n1', actionId: ACTION.id })) as { id: string }
    expect(await waitFor(() => tasks.getJob(job.id)?.status === 'done')).toBe(true)
    expect((await runStateOf(doc, 'n1')).status).toBe('done')
    expect(await history.readAll('default')).toHaveLength(1)
  })

  it('失败也收敛成 error（不留悬挂 running）+ 归档一笔失败记录', async () => {
    const p: Provider = {
      id: 'p',
      actions: [ACTION],
      async submit() { return { taskId: 'pt1' } },
      async poll() { return { status: 'error', error: '平台说不行' } },
    }
    const { doc, history, tasks } = await setup(p)
    const job = (await tasks.createJob({ canvasId: 'default', nodeId: 'n1', actionId: ACTION.id })) as { id: string }
    expect(await waitFor(() => tasks.getJob(job.id)?.status === 'error')).toBe(true)
    const rs = await runStateOf(doc, 'n1')
    expect(rs.status).toBe('error')
    expect(rs.message).toBe('平台说不行')
    const all = await history.readAll('default')
    expect(all[0]).toMatchObject({ status: 'error', error: '平台说不行' })
  })

  it('超时 → 收敛成失败（长任务由动作自己的 pollTimeoutMs 顶掉）', async () => {
    const p: Provider = {
      id: 'p',
      actions: [ACTION],
      async submit() { return { taskId: 'pt1' } },
      async poll() { return { status: 'running', progress: 10 } },
    }
    const { tasks } = await setup(p, { timeoutMs: 3000, interval: 1000 })
    const job = (await tasks.createJob({ canvasId: 'default', nodeId: 'n1', actionId: ACTION.id })) as { id: string }
    expect(await waitFor(() => tasks.getJob(job.id)?.status === 'error')).toBe(true)
    expect(tasks.getJob(job.id)?.result?.error).toContain('超时')
  })

  /**
   * 「等外部条件」不占超时预算（用户实测的 bug，2026-10-08）。
   *
   * 现场：任务 paused 等用户在浏览器里过验证码，人处理多久不由程序决定 ——
   * 早先拿这段等待去顶 pollTimeoutMs，人还在操作就被判超时失败。
   * 现在 provider 会给这类中间态标 `waiting`，那部分时间从预算里扣掉；
   * **普通生成中的等待不在此列**（上一条用例已锁：照样超时）。
   */
  it('等待态（paused 等验证码）不占超时预算：等多久都不判超时，恢复后照样能成功', async () => {
    let polls = 0
    const p: Provider = {
      id: 'p',
      actions: [ACTION],
      async submit() { return { taskId: 'pt1' } },
      async poll() {
        polls += 1
        // 前 10 拍都在「等用户过验证码」（waiting），之后成功
        if (polls <= 10) return { status: 'running', message: '等验证码', waiting: true }
        return { status: 'done', urls: ['http://x/out.png'] }
      },
    }
    // 预算只有 3s，每拍间隔 1s —— 若等待占预算，第 4 拍就该超时失败
    const { tasks } = await setup(p, { timeoutMs: 3000, interval: 1000 })
    const job = (await tasks.createJob({ canvasId: 'default', nodeId: 'n1', actionId: ACTION.id })) as { id: string }
    // 等到它真的跑完（成功），而不是被判超时
    expect(await waitFor(() => tasks.getJob(job.id)?.status === 'done')).toBe(true)
    expect(tasks.getJob(job.id)?.result?.ok).toBe(true)
    expect(polls).toBeGreaterThan(10)
  })

  it('节点被删了也不炸（任务还在跑，只是没地方写进度）', async () => {
    const p: Provider = {
      id: 'p',
      actions: [ACTION],
      async submit() { return { taskId: 'pt1' } },
      async poll() { return { status: 'running' } },
    }
    const { doc, tasks } = await setup(p, { interval: 10 })
    const job = (await tasks.createJob({ canvasId: 'default', nodeId: 'n1', actionId: ACTION.id })) as { id: string }
    await doc.batchNodes({ delete: ['n1'] })
    // 不抛错即可（进度写不进去是预期行为）
    await new Promise((r) => setTimeout(r, 60))
    expect(tasks.getJob(job.id)).toBeTruthy()
  })
})

describe('取消', () => {
  it('取消会调 provider 的 cancel（去服务端真取消，不是只停本地）', async () => {
    const cancelled: string[] = []
    const p: Provider = {
      id: 'p',
      actions: [ACTION],
      async submit() { return { taskId: 'pt1' } },
      async poll() { return { status: 'running', taskId: 'pt1' } },
      async cancel(taskId) { cancelled.push(taskId) },
    }
    const { tasks } = await setup(p, { interval: 100000 })
    const job = (await tasks.createJob({ canvasId: 'default', nodeId: 'n1', actionId: ACTION.id })) as { id: string }
    // 等第一拍轮询把 providerTaskId 记下来
    expect(await waitFor(() => tasks.getJob(job.id)?.providerTaskId === 'pt1')).toBe(true)
    await tasks.cancel(job.id)
    expect(cancelled).toEqual(['pt1'])
  })
})

/** 读某节点当前的 runState（测试里反复要用；断言的是"前端读到的那个东西"） */
async function runStateOf(doc: CanvasDocument, nodeId: string): Promise<Record<string, unknown>> {
  const node = (await doc.read()).nodes.find((n) => n.id === nodeId)
  return (node?.data?.runState ?? {}) as Record<string, unknown>
}
