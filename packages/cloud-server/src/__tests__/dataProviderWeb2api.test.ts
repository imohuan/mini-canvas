/**
 * 数据根 providers/ 下的 web2api 三个文件 —— 用**真实文件**跑单测。
 *
 * 背景：2026-11-08 把 web2api 从 cloud-server 内置代码改成外挂 provider
 * （<数据根>/providers/web2api-{image,video,audio}.js）。内置那份已删，所以这里
 * 直接加载数据目录里的真文件，锁住三条以前真出过的问题：
 *
 * 1. 动作 id 与旧前端插件一致（旧画布里存过的 actionId 不能失效）；
 * 2. 每个动作都显式声明轮询节奏与超时（视频不能被默认 5 分钟误杀）；
 * 3. web2api 的中间态（paused 等验证码 / retrying / pending）不能当失败。
 *
 * 不联网：给 provider 注入假 fetch。
 */
import { describe, it, expect } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Provider } from '../providers/types'

const HERE = path.dirname(fileURLToPath(import.meta.url))
/**
 * 仓库里可版本化的源文件：packages/cloud-server/providers/*.js
 *
 * 运行时那三个文件在数据根（默认 <仓库>/.mini-canvas/providers/，被 .gitignore 忽略），
 * 由部署脚本从这份源文件复制过去。测试测源文件，另有一条守卫检查两边是否同步。
 */
const PROVIDERS_DIR = path.resolve(HERE, '../../providers')
/** 运行时数据目录（本地开发时就是仓库根的 .mini-canvas） */
const REPO_ROOT = path.resolve(HERE, '../../../..')
const DEPLOYED_DIR = path.join(REPO_ROOT, '.mini-canvas', 'providers')

/** 按数据根装载真实 provider 文件（与 load.ts 同一手法：data: URL） */
async function load(file: string): Promise<Provider> {
  const text = await fs.readFile(path.join(PROVIDERS_DIR, file), 'utf8')
  const mod = (await import(/* @vite-ignore */ 'data:text/javascript,' + encodeURIComponent(text))) as {
    default?: Provider
  }
  if (!mod.default) throw new Error(file + ' 没有 default 导出')
  return mod.default
}

const FILES = ['web2api-image.js', 'web2api-video.js', 'web2api-audio.js'] as const

describe('数据根里的 web2api provider 文件', () => {
  it('部署副本与仓库源文件内容一致（改了源文件记得同步到数据根）', async () => {
    for (const f of FILES) {
      const src = await fs.readFile(path.join(PROVIDERS_DIR, f), 'utf8')
      let deployed: string
      try {
        deployed = await fs.readFile(path.join(DEPLOYED_DIR, f), 'utf8')
      } catch {
        // 还没部署过（CI / 干净检出）：跳过这一条，不影响源文件的其它断言
        continue
      }
      expect(deployed.trimEnd(), f + ' 与仓库源文件不同步').toBe(src.trimEnd())
    }
  })

  it('三个文件都能装载，且都导出 id / actions / submit', async () => {
    for (const f of FILES) {
      const p = await load(f)
      expect(typeof p.id, f).toBe('string')
      expect(p.id.length, f).toBeGreaterThan(0)
      expect(Array.isArray(p.actions), f).toBe(true)
      expect(typeof p.submit, f).toBe('function')
    }
  })

  it('id 互不相同，动作 id 全局唯一（同名会互相覆盖）', async () => {
    const ids: string[] = []
    const actionIds: string[] = []
    for (const f of FILES) {
      const p = await load(f)
      ids.push(p.id)
      for (const a of p.actions) actionIds.push(a.id)
    }
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(actionIds).size).toBe(actionIds.length)
  })

  it('动作 id 与旧前端插件一致（旧画布里的 actionId 继续有效）', async () => {
    // 这 18 条是 plugin-web2api-tools 当初注册的全部动作，一条不能少
    const expected = [
      'web2api:doubao-image-seedream45',
      'web2api:doubao-image-seedream50lite',
      'web2api:doubao-image-seedream40',
      'web2api:dola-image-seedream50pro',
      'web2api:dola-image-seedream45',
      'web2api:chatgpt-image',
      'web2api:apimart-image',
      'web2api:doubao-video-fast',
      'web2api:doubao-video-mini',
      'web2api:dola-video-seedance25',
      'web2api:dola-video-seedance20',
      'web2api:dola-video-seedance10',
      'web2api:doubao-video-api-mini',
      'web2api:doubao-video-api-fast',
      'web2api:seedance-video-fast',
      'web2api:seedance-video-20',
      'web2api:doubao-tts',
      'web2api:volcengine-audio',
    ]
    const actual: string[] = []
    for (const f of FILES) {
      for (const a of (await load(f)).actions) actual.push(a.id)
    }
    expect(actual.sort()).toEqual(expected.sort())
  })

  it('每个动作都声明轮询节奏与超时，视频 ≥ 30 分钟', async () => {
    for (const f of FILES) {
      for (const a of (await load(f)).actions) {
        expect(a.pollIntervalMs, a.id).toBeGreaterThan(0)
        expect(a.pollTimeoutMs, a.id).toBeGreaterThan(0)
        if (a.nodeTypes?.includes('video')) {
          expect(a.pollTimeoutMs!, a.id).toBeGreaterThanOrEqual(30 * 60_000)
        }
      }
    }
  })

  it('每条动作都有 title / group / nodeTypes（缺了前端会显示空白）', async () => {
    for (const f of FILES) {
      for (const a of (await load(f)).actions) {
        expect(a.title, a.id).toBeTruthy()
        expect(a.group, a.id).toBeTruthy()
        expect(Array.isArray(a.nodeTypes), a.id).toBe(true)
      }
    }
  })

  it('每条动作都声明 refFields（收哪些参考素材）', async () => {
    for (const f of FILES) {
      for (const a of (await load(f)).actions) {
        expect(a.refFields, a.id + ' 没有声明 refFields').toBeTruthy()
      }
    }
  })
})

describe('提交与轮询：直接调 web2api 的 HTTP 接口', () => {
  it('下单：POST /api/tasks，body 带 platform / operation / params', async () => {
    const globalAny = globalThis as unknown as { fetch: typeof fetch }
    const original = globalAny.fetch
    const calls: Array<{ url: string; method: string; body: unknown }> = []
    globalAny.fetch = (async (url: string, init?: RequestInit) => {
      calls.push({
        url: String(url),
        method: init?.method ?? 'GET',
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      })
      return new Response(JSON.stringify({ code: 0, message: 'ok', data: { id: 'task-1' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as typeof fetch
    try {
      const p = await load('web2api-image.js')
      const action = p.actions.find((a) => a.id === 'web2api:doubao-image-seedream45')!
      const r = await p.submit(action, {
        canvasId: 'c1',
        nodeId: 'n1',
        actionId: action.id,
        prompt: '夕阳下的城市',
        values: { ratio: '16:9' },
      })
      expect(r).toEqual({ taskId: 'task-1' })
      expect(calls).toHaveLength(1)
      expect(calls[0].url).toBe('http://localhost:8033/api/tasks')
      expect(calls[0].method).toBe('POST')
      const body = calls[0].body as { platform: string; operation: string; params: Record<string, unknown> }
      expect(body.platform).toBe('doubao')
      expect(body.operation).toBe('chat-auto')
      expect(body.params.ratio).toBeUndefined() // 已拼进 prompt 前缀
      expect(body.params.prompt).toContain('/image(model:"Seedream 4.5", ratio:"16:9")')
    } finally {
      globalAny.fetch = original
    }
  })

  it('chat-auto：参数拼成括号前缀，不是空格分隔的纯文本', async () => {
    const globalAny = globalThis as unknown as { fetch: typeof fetch }
    const original = globalAny.fetch
    const calls: Array<{ body: unknown }> = []
    globalAny.fetch = (async (_url: string, init?: RequestInit) => {
      calls.push({ body: init?.body ? JSON.parse(String(init.body)) : undefined })
      return new Response(JSON.stringify({ code: 0, message: 'ok', data: { id: 'task-2' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as typeof fetch
    try {
      const p = await load('web2api-video.js')
      const action = p.actions.find((a) => a.id === 'web2api:doubao-video-fast')!
      await p.submit(action, {
        canvasId: 'c1',
        nodeId: 'n1',
        actionId: action.id,
        prompt: '一只猫在跑',
        values: { ratio: '9:16', durationSec: 10 },
      })
      const sent = calls[0].body as { params: { prompt: string } }
      expect(sent.params.prompt).toBe('/video(model:"Seedance 2.0 Fast", ratio:"9:16", durationSec:10) 一只猫在跑')
    } finally {
      globalAny.fetch = original
    }
  })

  it('plain 模式：模型烘焙进 params，参考图随 resources 一起带过去', async () => {
    const globalAny = globalThis as unknown as { fetch: typeof fetch }
    const original = globalAny.fetch
    const calls: Array<{ body: unknown }> = []
    globalAny.fetch = (async (_url: string, init?: RequestInit) => {
      calls.push({ body: init?.body ? JSON.parse(String(init.body)) : undefined })
      return new Response(JSON.stringify({ code: 0, message: 'ok', data: { id: 'task-3' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as typeof fetch
    try {
      const p = await load('web2api-image.js')
      const action = p.actions.find((a) => a.id === 'web2api:apimart-image')!
      await p.submit(action, {
        canvasId: 'c1',
        nodeId: 'n1',
        actionId: action.id,
        prompt: '画一只猫',
        values: { ratio: '1:1', resolution: '2k' },
        resources: [{ kind: 'image', url: 'data:image/png;base64,AAA' }],
      })
      const sent = calls[0].body as { platform: string; operation: string; params: Record<string, unknown> }
      expect(sent.platform).toBe('apimart')
      expect(sent.operation).toBe('generate-image')
      expect(sent.params.ratio).toBe('1:1')
      expect(sent.params.resolution).toBe('2k')
      expect(sent.params.prompt).toBe('画一只猫')
      expect(sent.params.referenceImages).toEqual(['data:image/png;base64,AAA'])
    } finally {
      globalAny.fetch = original
    }
  })

  it('中间态继续轮询：paused / retrying / pending → running + waiting', async () => {
    const globalAny = globalThis as unknown as { fetch: typeof fetch }
    const original = globalAny.fetch
    try {
      const p = await load('web2api-video.js')
      const action = p.actions[0]
      for (const status of ['paused', 'retrying', 'pending']) {
        globalAny.fetch = (async () =>
          new Response(
            JSON.stringify({ code: 0, message: 'ok', data: { status, message: '等验证码', progress: 30 } }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          )) as typeof fetch
        const r = await p.poll!('t-1', action)
        expect(r.status, status).toBe('running')
        expect(r.waiting, status).toBe(true)
      }
    } finally {
      globalAny.fetch = original
    }
  })

  it('终态：completed + 产物 → done（相对地址绝对化到 web2api）', async () => {
    const globalAny = globalThis as unknown as { fetch: typeof fetch }
    const original = globalAny.fetch
    globalAny.fetch = (async () =>
      new Response(
        JSON.stringify({
          code: 0,
          message: 'ok',
          data: { status: 'completed', result: [{ url: '/api/resources/images/doubao/a.png', type: 'image' }] },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as typeof fetch
    try {
      const p = await load('web2api-image.js')
      const r = await p.poll!('t-1', p.actions[0])
      expect(r.status).toBe('done')
      expect(r.urls).toEqual(['http://localhost:8033/api/resources/images/doubao/a.png'])
    } finally {
      globalAny.fetch = original
    }
  })

  it('终态：failed / cancelled → error', async () => {
    const globalAny = globalThis as unknown as { fetch: typeof fetch }
    const original = globalAny.fetch
    try {
      const p = await load('web2api-image.js')
      for (const status of ['failed', 'cancelled']) {
        globalAny.fetch = (async () =>
          new Response(JSON.stringify({ code: 0, message: 'ok', data: { status, message: '失败了' } }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })) as typeof fetch
        const r = await p.poll!('t-1', p.actions[0])
        expect(r.status, status).toBe('error')
      }
    } finally {
      globalAny.fetch = original
    }
  })

  it('连不上 web2api 时给的是人话，不是 fetch failed', async () => {
    const globalAny = globalThis as unknown as { fetch: typeof fetch }
    const original = globalAny.fetch
    globalAny.fetch = (async () => {
      throw new Error('fetch failed')
    }) as typeof fetch
    try {
      const p = await load('web2api-image.js')
      const r = await p.submit(p.actions[0], { canvasId: 'c1', nodeId: 'n1', actionId: p.actions[0].id, prompt: 'x' })
      expect('error' in r).toBe(true)
      if ('error' in r) expect(r.error).toContain('连不上 web2api')
    } finally {
      globalAny.fetch = original
    }
  })

  /**
   * 参考素材分发 —— 修的是「视频被当成图片发出去、音频参考完全没传」这两个真问题。
   *
   * 用户口径：连进来什么类型，就按类型各走各的字段；平台不收的类型要**明确告知**，
   * 不能静默吞掉、更不能塞进别的字段里让它去报一个莫名其妙的错。
   */
  describe('参考素材按类型分发', () => {
    const MIXED = [
      { kind: 'text', name: '标题内容', value: '一段标题文字' },
      { kind: 'image', name: '封面', url: 'data:image/png;base64,IMG1' },
      { kind: 'image', name: '参考2', url: 'data:image/png;base64,IMG2' },
      { kind: 'video', name: '片段', url: 'data:video/mp4;base64,VID' },
      { kind: 'audio', name: '访谈录音', url: 'data:audio/wav;base64,AUD' },
      { kind: 'text', name: '正文', value: '第二段正文' },
    ]

    /** 装上假 fetch：记录 /api/tasks 的 body，upload 回一个固定相对路径 */
    async function submitWith(
      file: string,
      actionId: string,
    ): Promise<{ body: { platform: string; operation: string; params: Record<string, unknown> }; uploads: number }> {
      const globalAny = globalThis as unknown as { fetch: typeof fetch }
      const original = globalAny.fetch
      const seen: Array<{ body: { platform: string; operation: string; params: Record<string, unknown> } }> = []
      let uploads = 0
      globalAny.fetch = (async (url: string, init?: RequestInit) => {
        if (String(url).includes('/api/resources/upload')) {
          uploads += 1
          return new Response(
            JSON.stringify({ code: 0, message: 'ok', data: { path: '/up' + uploads + '.wav' } }),
            { status: 201, headers: { 'content-type': 'application/json' } },
          )
        }
        seen.push({ body: JSON.parse(String(init?.body ?? '{}')) })
        return new Response(JSON.stringify({ code: 0, message: 'ok', data: { id: 't1' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }) as typeof fetch
      try {
        const p = await load(file)
        const action = p.actions.find((a) => a.id === actionId)!
        await p.submit(action, {
          canvasId: 'c1',
          nodeId: 'n1',
          actionId,
          prompt: '按 @封面 的风格，用 @标题内容',
          values: {},
          resources: MIXED,
        })
        return { body: seen[0].body, uploads }
      } finally {
        globalAny.fetch = original
      }
    }

    it('图片动作：只发图片，视频不再混进 referenceImages', async () => {
      const { body } = await submitWith('web2api-image.js', 'web2api:apimart-image')
      expect(body.params.referenceImages).toEqual([
        'data:image/png;base64,IMG1',
        'data:image/png;base64,IMG2',
      ])
      // 视频不能出现在任何参考字段里
      expect(JSON.stringify(body.params)).not.toContain('VID')
    })

    it('视频动作：同样只发图片（web2api 没有视频参考字段）', async () => {
      const { body } = await submitWith('web2api-video.js', 'web2api:doubao-video-fast')
      expect(body.params.referenceImages).toEqual([
        'data:image/png;base64,IMG1',
        'data:image/png;base64,IMG2',
      ])
      expect(JSON.stringify(body.params)).not.toContain('VID')
    })

    it('火山引擎音频：先把音频上传成 web2api 本机路径，再放进 referenceAudios', async () => {
      const { body, uploads } = await submitWith('web2api-audio.js', 'web2api:volcengine-audio')
      expect(uploads).toBe(1)
      expect(body.params.referenceAudios).toEqual(['/up1.wav'])
      // 音频不能混进图片字段
      expect(body.params.referenceImages).toBeUndefined()
    })

    it('豆包 TTS 没有参考字段：音频不传，也不报错（任务照常提交）', async () => {
      const { body, uploads } = await submitWith('web2api-audio.js', 'web2api:doubao-tts')
      expect(uploads).toBe(0)
      expect(body.params.referenceAudios).toBeUndefined()
      expect(body.params.text).toBeTruthy()
    })

    it('文本素材带名字进提示词（可以用 @名字 引用），且不糊成一段', async () => {
      const { body } = await submitWith('web2api-image.js', 'web2api:chatgpt-image')
      const prompt = String(body.params.prompt)
      expect(prompt).toContain('<text name="标题内容">')
      expect(prompt).toContain('一段标题文字')
      expect(prompt).toContain('<text name="正文">')
      expect(prompt).toContain('第二段正文')
      // 用户自己的提示词在
      expect(prompt).toContain('用 @标题内容')
    })

    it('文本没有名字时按 文本1 / 文本2 编号（保证引用名稳定）', async () => {
      const globalAny = globalThis as unknown as { fetch: typeof fetch }
      const original = globalAny.fetch
      const seen: Array<{ body: { params: Record<string, unknown> } }> = []
      globalAny.fetch = (async (_url: string, init?: RequestInit) => {
        seen.push({ body: JSON.parse(String(init?.body ?? '{}')) })
        return new Response(JSON.stringify({ code: 0, message: 'ok', data: { id: 't1' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }) as typeof fetch
      try {
        const p = await load('web2api-image.js')
        const action = p.actions.find((a) => a.id === 'web2api:chatgpt-image')!
        await p.submit(action, {
          canvasId: 'c1',
          nodeId: 'n1',
          actionId: action.id,
          prompt: 'x',
          resources: [
            { kind: 'text', value: 'A' },
            { kind: 'text', value: 'B' },
          ],
        })
        const prompt = String(seen[0].body.params.prompt)
        expect(prompt).toContain('<text name="文本1">')
        expect(prompt).toContain('<text name="文本2">')
      } finally {
        globalAny.fetch = original
      }
    })
  })
})
