/**
 * 可视化节点 / 后台功能函数 的 MCP 工具（用户 2026-10-14 那批要求）。
 *
 * 用户口径（分四处）：
 *   ① 每个可视化节点要有详细功能描述（含自己的输入输出）；
 *   ② 能列出收藏的可视化节点、能把收藏的节点建成节点、能查这些节点能干什么；
 *   ③ 能列出全部功能函数、调用指定功能函数、查它的参数与返回值；
 *   ④ 调用后台函数时**不必传 Canvas ID / Node ID**（工具自己造虚拟上下文）。
 *
 * 这组用例跑的是**真插件 apply**（注册到假 ctx 上），所以它同时钉住了
 * 「工具注册了」「工具真能干活」两件事 —— 光注册不干活是最容易骗过测试的那种假通过。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { apply, ensureVirtualCanvas } from '../server'
import { readFileSync } from 'node:fs'

let dir = ''

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-nodemcp-'))
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

/**
 * 假后台 ctx：把注册的工具/路由收下来，供用例直接调。
 *
 * 为什么要写**真的有状态的 doc / canvasStore / assetStore**（而不是空壳）：
 * 这些工具的价值全在"读到了什么、写进去了什么"。空壳只能证明"函数被调了"，
 * 证明不了它算得对 —— 而算错正是这类功能最容易出的问题。
 */
function fakeCtx(opts: { nodes?: Array<Record<string, unknown>>; assets?: Array<Record<string, unknown>> } = {}) {
  const tools = new Map<string, { name: string; handler: (a: Record<string, unknown>) => unknown }>()
  const routes = new Map<string, (c: unknown) => unknown>()
  const nodes = opts.nodes ?? []
  const assets = opts.assets ?? []
  const writes: unknown[] = []
  const canvasWrites: Array<{ id: string; data: unknown }> = []
  const doc = {
    getNodes: () => nodes,
    getNode: (id: string) => nodes.find((n) => String(n.id) === id),
    getEdges: () => [],
    read: async () => ({ nodes, edges: [] }),
    batchNodes: async (input: unknown) => {
      writes.push(input)
      return { ok: true, added: ['99'], errors: [] }
    },
  }
  const canvasStore = {
    readCanvas: async (id: string) => {
      const hit = canvasWrites.find((w) => w.id === id)
      if (hit) return hit.data as { nodes: unknown[]; edges: unknown[] }
      return id === 'default' ? { nodes, edges: [] } : undefined
    },
    writeCanvas: async (id: string, data: unknown) => {
      canvasWrites.push({ id, data })
    },
    list: async () => ['default'],
    dataRoot: () => dir,
  }
  /** 非默认画布的 doc：与宿主池同形；用于验证“不再绕过统一锁” */
  const otherDocWrites: unknown[] = []
  const otherDoc = {
    getNodes: () => [{ id: '2', type: 'ui', data: { label: '可视化 1' } }],
    getEdges: () => [],
    batchNodes: async (input: unknown) => {
      otherDocWrites.push(input)
      return { ok: true, added: ['88'], errors: [] }
    },
  }
  const assetStore = {
    list: async () => assets,
    readFile: async (name: string) => (name === 'pack1'
      ? new Uint8Array(await fs.readFile(path.join(dir, 'p1.mcnode')))
      : undefined),
  }
  const ctx = {
    routes: {
      get: (p: string, h: (c: unknown) => unknown) => routes.set('GET ' + p, h),
      post: (p: string, h: (c: unknown) => unknown) => routes.set('POST ' + p, h),
    },
    mcp: { tool: (def: { name: string }) => tools.set(def.name, def as never) },
    tryGet: (n: string) =>
      n === 'taskScriptsDir'
        ? dir
        : n === 'doc'
          ? doc
          : n === 'canvasStore'
            ? canvasStore
            : n === 'assetStore'
              ? assetStore
              : n === 'canvasDocPool'
                ? { for: (id: string) => (id === 'other' ? otherDoc : doc) }
              : n === 'selfOrigin'
                ? 'http://127.0.0.1:8865'
                : undefined,
  } as never
  return { ctx, tools, writes, canvasWrites, nodes, otherDocWrites }
}

const call = async (tools: ReturnType<typeof fakeCtx>['tools'], name: string, args: Record<string, unknown> = {}) =>
  (await tools.get(name)!.handler(args)) as Record<string, unknown>

describe('① 节点说明书：写 / 读 / 进手册', () => {
  const uiNode = { id: '2', type: 'ui', data: { label: '可视化 1' } }

  it('非默认画布也走宿主文档池（不再绕过统一写锁）', async () => {
    const s = fakeCtx({ nodes: [uiNode] })
    apply(s.ctx)
    const r = await call(s.tools, 'canvas_ui_write', {
      canvasId: 'other',
      nodeId: '2',
      html: '<div>other docs</div>',
    })
    expect(r.ok).toBe(true)
    // 走 docPool.batchNodes，而不是 canvasStore.writeCanvas 整包写回
    expect(s.otherDocWrites).toHaveLength(1)
    expect(JSON.stringify(s.otherDocWrites[0])).toContain('other docs')
    expect(s.canvasWrites).toHaveLength(0)
  })

  it('canvas_ui_describe 把四件事写进节点 data', async () => {
    const s = fakeCtx({ nodes: [uiNode] })
    apply(s.ctx)
    const r = await call(s.tools, 'canvas_ui_describe', {
      nodeId: '2',
      what: '把视频转成宫格图',
      effect: '一眼看全',
      inputsJson: '["视频"]',
      outputsJson: '[{"name":"宫格图","type":"image"}]',
    })
    expect(r.ok).toBe(true)
    const sent = JSON.stringify(s.writes[0])
    expect(sent).toContain('uiNodeDoc')
    expect(sent).toContain('把视频转成宫格图')
    expect(sent).toContain('宫格图')
  })

  it('没写 what → 明确报错（说明书的核心那句不能空）', async () => {
    const s = fakeCtx({ nodes: [uiNode] })
    apply(s.ctx)
    const r = await call(s.tools, 'canvas_ui_describe', { nodeId: '2' })
    expect(r.ok).toBe(false)
    expect(String(r.error)).toContain('what')
    expect(s.writes).toHaveLength(0)
  })

  it('非可视化节点 → 拒绝（不往图片节点里塞说明书）', async () => {
    const s = fakeCtx({ nodes: [{ id: '1', type: 'image', data: {} }] })
    apply(s.ctx)
    const r = await call(s.tools, 'canvas_ui_describe', { nodeId: '1', what: 'x' })
    expect(r.ok).toBe(false)
    expect(s.writes).toHaveLength(0)
  })

  it('inputsJson 不是合法 JSON → 明确报错（不静默丢掉输入说明）', async () => {
    const s = fakeCtx({ nodes: [uiNode] })
    apply(s.ctx)
    const r = await call(s.tools, 'canvas_ui_describe', { nodeId: '2', what: 'x', inputsJson: '{oops' })
    expect(r.ok).toBe(false)
    expect(String(r.error)).toContain('JSON')
    expect(s.writes).toHaveLength(0)
  })

  it('canvas_ui_read 把说明书一起带回来', async () => {
    const withDoc = {
      id: '2',
      type: 'ui',
      data: {
        uiHtml: '<b>hi</b>',
        uiNodeDoc: { what: '转宫格', outputs: ['图'] },
        uiScripts: { 'video-grid': {} },
      },
    }
    const s = fakeCtx({ nodes: [withDoc] })
    apply(s.ctx)
    const r = await call(s.tools, 'canvas_ui_read', { nodeId: '2' })
    expect((r.doc as { what: string }).what).toBe('转宫格')
    expect(String(r.docText)).toContain('做什么：转宫格')
    expect(r.scripts).toEqual(['video-grid'])
  })

  it('画布上的节点列表也带上说明书（手册里那句「这块画布上有什么」）', async () => {
    const withDoc = { id: '2', type: 'ui', data: { label: '转宫格', uiNodeDoc: { what: '把视频转宫格' } } }
    const s = fakeCtx({ nodes: [withDoc] })
    apply(s.ctx)
    const r = await call(s.tools, 'canvas_ui_guide', { canvasId: 'default' })
    expect(String(r.guide)).toContain('把视频转宫格')
  })
})

describe('② 收藏的可视化节点：列出 / 建到画布', () => {
  it('★ canvas_ui_add_favorite 画布上已有同名节点 → 名字自动加号（不撞名）', async () => {
    // 用户 2026-10-14 口径：「拖出来的这些节点，名称没有自动追加，导致了名称重复。
    // 我的画布里面添加节点的时候，名称是会自动累加的」。
    const { buildNodePack } = await import('../task/pack')
    const built = await buildNodePack(
      { id: 'g', type: 'ui', data: { label: '演示节点', uiHtml: '<div>x</div>' } },
      dir,
      Date.now(),
    )
    await fs.writeFile(path.join(dir, 'p1.mcnode'), built.bytes)
    // 画布上已经有一个「演示节点」（比如刚拖过一次 / 上一批建的）
    const s = fakeCtx({
      nodes: [{ id: '1', type: 'ui', data: { label: '演示节点' } }],
      assets: [{ id: 'a1', name: '演示节点.mcnode', kind: 'node-package', url: '/api/assets/files/pack1' }],
    })
    apply(s.ctx)
    const r = await call(s.tools, 'canvas_ui_add_favorite', { name: '演示节点.mcnode' })
    expect(r.ok).toBe(true)
    const sent = JSON.stringify(s.writes[0])
    expect(sent).toContain('演示节点 2')
    expect(sent).not.toContain('"label":"演示节点"')
  })

  it('★ 画布上还有「演示节点 2」→ 顺着接「演示节点 3」（与自动名同一形态）', async () => {
    const { buildNodePack } = await import('../task/pack')
    const built = await buildNodePack(
      { id: 'g', type: 'ui', data: { label: '演示节点', uiHtml: '<div>x</div>' } },
      dir,
      Date.now(),
    )
    await fs.writeFile(path.join(dir, 'p1.mcnode'), built.bytes)
    const s = fakeCtx({
      nodes: [
        { id: '1', type: 'ui', data: { label: '演示节点' } },
        { id: '2', type: 'ui', data: { label: '演示节点 2' } },
      ],
      assets: [{ id: 'a1', name: '演示节点.mcnode', kind: 'node-package', url: '/api/assets/files/pack1' }],
    })
    apply(s.ctx)
    const r = await call(s.tools, 'canvas_ui_add_favorite', { name: '演示节点.mcnode' })
    expect(r.ok).toBe(true)
    expect(JSON.stringify(s.writes[0])).toContain('演示节点 3')
  })

  it('画布上没有同名 → 原样用包里的名字（不画蛇添足）', async () => {
    const { buildNodePack } = await import('../task/pack')
    const built = await buildNodePack(
      { id: 'g', type: 'ui', data: { label: '独一个', uiHtml: '<div>x</div>' } },
      dir,
      Date.now(),
    )
    await fs.writeFile(path.join(dir, 'p1.mcnode'), built.bytes)
    const s = fakeCtx({ assets: [{ id: 'a1', name: '独一个.mcnode', kind: 'node-package', url: '/api/assets/files/pack1' }] })
    apply(s.ctx)
    const r = await call(s.tools, 'canvas_ui_add_favorite', { name: '独一个.mcnode' })
    expect(r.ok).toBe(true)
    expect(JSON.stringify(s.writes[0])).toContain('独一个')
  })

  it('canvas_ui_favorites 只列节点包，并带出说明书与脚本清单', async () => {
    // 先在临时目录造一个真包（走真打包逻辑，shape 才不会漂）
    const { buildNodePack } = await import('../task/pack')
    await fs.writeFile(path.join(dir, 'video-grid.mjs'), 'export const run = () => 1\n')
    const built = await buildNodePack(
      {
        id: 'grid1',
        type: 'ui',
        data: {
          label: '视频转宫格图',
          uiHtml: '<script>fetch(0,{body:JSON.stringify({name:"video-grid"})})</script>',
          uiScripts: { 'video-grid': {} },
          uiNodeDoc: { what: '把视频转九宫格', outputs: ['宫格图'] },
        },
      },
      dir,
      Date.now(),
    )
    await fs.writeFile(path.join(dir, 'p1.mcnode'), built.bytes)

    const s = fakeCtx({
      assets: [
        { id: 'a1', name: '视频转宫格图.mcnode', kind: 'node-package', url: '/api/assets/files/pack1' },
        { id: 'a2', name: '一张图.png', kind: 'image', url: '/api/assets/files/xxx' },
      ],
    })
    apply(s.ctx)
    const r = await call(s.tools, 'canvas_ui_favorites')
    expect(r.total).toBe(1)
    const fav = (r.favorites as Array<Record<string, unknown>>)[0]
    expect(fav.name).toBe('视频转宫格图.mcnode')
    expect(fav.scripts).toEqual(['video-grid'])
    expect(String(fav.doc)).toContain('把视频转九宫格')
  })

  it('keyword 能按说明过滤', async () => {
    const { buildNodePack } = await import('../task/pack')
    const built = await buildNodePack(
      { id: 'g', type: 'ui', data: { label: 'A', uiHtml: '<div>x</div>', uiNodeDoc: { what: '转宫格' } } },
      dir,
      Date.now(),
    )
    await fs.writeFile(path.join(dir, 'p1.mcnode'), built.bytes)
    const s = fakeCtx({ assets: [{ id: 'a1', name: 'A.mcnode', kind: 'node-package', url: '/api/assets/files/pack1' }] })
    apply(s.ctx)
    expect((await call(s.tools, 'canvas_ui_favorites', { keyword: '宫格' })).shown).toBe(1)
    expect((await call(s.tools, 'canvas_ui_favorites', { keyword: '不存在的东西' })).shown).toBe(0)
  })

  it('★ canvas_ui_export 打包落到本机下载目录，并给绝对路径（用户：节点删了也要能恢复）', async () => {
    const dl = path.join(dir, 'dl')
    const prev = process.env.MINI_CANVAS_DOWNLOAD_DIR
    process.env.MINI_CANVAS_DOWNLOAD_DIR = dl
    try {
      const painted = { id: '2', type: 'ui', data: { label: '演示', uiHtml: '<div>x</div>' } }
      const s = fakeCtx({ nodes: [painted] })
      apply(s.ctx)
      const r = await call(s.tools, 'canvas_ui_export', { nodeId: '2' })
      expect(r.ok).toBe(true)
      expect(String(r.path)).toBe(path.join(dl, '演示.mcnode'))
      expect(String(r.dir)).toBe(dl)
      expect(Number(r.bytes)).toBeGreaterThan(0)
      // 指定了 MINI_CANVAS_DOWNLOAD_DIR 就**只写那里**（不许悄悄回落到真实下载目录 —— 踩过）
      expect(String(r.path).startsWith(dl)).toBe(true)
      // 文件真的在盘上
      const onDisk = await fs.readFile(String(r.path))
      expect(onDisk.length).toBe(Number(r.bytes))
      // 第二次导出不覆盖（旧那份是保命符）
      const r2 = await call(s.tools, 'canvas_ui_export', { nodeId: '2' })
      expect(path.basename(String(r2.path))).toBe('演示 (2).mcnode')
    } finally {
      if (prev === undefined) delete process.env.MINI_CANVAS_DOWNLOAD_DIR
      else process.env.MINI_CANVAS_DOWNLOAD_DIR = prev
    }
  })

  it('★ canvas_ui_add_favorite 把包里的脚本写进目录，并还原节点到画布', async () => {
    const { buildNodePack } = await import('../task/pack')
    await fs.writeFile(path.join(dir, 'video-grid.mjs'), 'export const run = () => 1\n')
    const built = await buildNodePack(
      {
        id: 'grid1',
        type: 'ui',
        data: {
          label: '视频转宫格图',
          uiHtml: '<script>fetch(0,{body:JSON.stringify({name:"video-grid"})})</script>',
          uiScripts: { 'video-grid': {} },
          uiNodeDoc: { what: '把视频转九宫格' },
        },
      },
      dir,
      Date.now(),
    )
    await fs.writeFile(path.join(dir, 'p1.mcnode'), built.bytes)
    // 本机那份脚本换个内容 → 触发整包升版本（顺带验"不动本机已有脚本"）
    await fs.writeFile(path.join(dir, 'video-grid.mjs'), 'export const run = () => 999\n')

    const s = fakeCtx({ assets: [{ id: 'a1', name: '视频转宫格图.mcnode', kind: 'node-package', url: '/api/assets/files/pack1' }] })
    apply(s.ctx)
    const r = await call(s.tools, 'canvas_ui_add_favorite', { name: '视频转宫格图.mcnode' })
    expect(r.ok).toBe(true)
    expect(r.nodeId).toBe('99') // 来自 doc.batchNodes 的 added
    expect(r.action).toBe('bump')
    expect(r.written).toEqual(['video-grid_v2'])
    // 本机原来那份必须一个字没动
    expect(await fs.readFile(path.join(dir, 'video-grid.mjs'), 'utf8')).toBe('export const run = () => 999\n')
    // 新节点带界面与声明
    const sent = JSON.stringify(s.writes[0])
    expect(sent).toContain('uiHtml')
    expect(sent).toContain('video-grid_v2')
  })

  it('指定不存在的包 → 明确报错并列出有哪些', async () => {
    const s = fakeCtx({ assets: [{ id: 'a1', name: 'A.mcnode', kind: 'node-package', url: '/api/assets/files/pack1' }] })
    apply(s.ctx)
    const r = await call(s.tools, 'canvas_ui_add_favorite', { name: '不存在.mcnode' })
    expect(r.ok).toBe(false)
    expect(String(r.error)).toContain('A.mcnode')
  })

  it('不给 url / name → 明确报错（不是静默什么都不做）', async () => {
    const s = fakeCtx({ assets: [] })
    apply(s.ctx)
    const r = await call(s.tools, 'canvas_ui_add_favorite', {})
    expect(r.ok).toBe(false)
    expect(String(r.error)).toContain('url')
  })
})

describe('③ 后台功能函数：列出 / 查 schema', () => {
  beforeEach(async () => {
    await fs.writeFile(
      path.join(dir, 'scale.mjs'),
      [
        'export const docs = {',
        '  run: { what: "把图片缩放到指定宽度", args: [{ name: "width", type: "number", required: true, desc: "目标宽度" }], returns: "缩放后的地址", example: "scale.run(640)" },',
        '}',
        'export async function run(width) { return { width } }',
        'export async function probe() { return 1 }',
        '',
      ].join('\n'),
    )
  })

  it('canvas_fn_list 列出所有函数，带说明书', async () => {
    const s = fakeCtx()
    apply(s.ctx)
    const r = await call(s.tools, 'canvas_fn_list')
    expect(r.total).toBe(2)
    const fns = (r.functions as Array<Record<string, unknown>>).map((f) => f.fn).sort()
    expect(fns).toEqual(['probe', 'run'])
    expect(String(r.text)).toContain('把图片缩放到指定宽度')
    expect(String(r.text)).toContain('width:number（必填）')
  })

  it('keyword 过滤', async () => {
    const s = fakeCtx()
    apply(s.ctx)
    expect((await call(s.tools, 'canvas_fn_list', { keyword: '缩放' })).shown).toBe(1)
    expect((await call(s.tools, 'canvas_fn_list', { keyword: 'probe' })).shown).toBe(1)
  })

  it('★ 有函数没写说明书 → 点名 + 给出照着能改的做法（不是只抱怨一句）', async () => {
    // 这台机器上多数脚本是用户自己放的、没写 docs（实测 13 个脚本 0 个写）。
    // 「没写说明书」如果不给补法，用户只看到一片「没写说明书」，无从下手。
    const s = fakeCtx()
    apply(s.ctx)
    const r = await call(s.tools, 'canvas_fn_list')
    // probe 没写 docs、run 写了 → 只点名 probe
    expect(r.missingDocs).toEqual(['scale.probe'])
    expect(String(r.howToAddDocs)).toContain('export const docs')
    expect(String(r.howToAddDocs)).toContain('demo.mjs')
  })

  it('全都写了说明书 → 不出现那两条提示（不画蛇添足）', async () => {
    await fs.writeFile(
      path.join(dir, 'scale.mjs'),
      [
        'export const docs = { only: { what: "只此一个" } }',
        'export async function only() { return 1 }',
        '',
      ].join('\n'),
    )
    const s = fakeCtx()
    apply(s.ctx)
    const r = await call(s.tools, 'canvas_fn_list')
    expect(r.missingDocs).toBeUndefined()
    expect(r.howToAddDocs).toBeUndefined()
  })

  it('★ 在建脚本（下划线打头）不进可用清单，但单独报出来（作者要知道它还在）', async () => {
    await fs.writeFile(path.join(dir, 'scale.mjs'), 'export async function run() { return 1 }\n')
    await fs.writeFile(path.join(dir, '_wip.mjs'), 'export async function run() { return 2 }\n')
    const s = fakeCtx()
    apply(s.ctx)
    const r = await call(s.tools, 'canvas_fn_list')
    // 可用清单里没有它（生产环境就是被这个坑到）
    expect((r.functions as Array<Record<string, unknown>>).map((f) => f.script)).toEqual(['scale'])
    // 但要告诉作者它存在、且没验完
    expect(r.drafts).toEqual(['_wip'])
    expect(String(r.draftHint)).toContain('_wip')
    expect(String(r.draftHint)).toContain('下划线')
  })

  it('★ canvas_fn_call 允许调在建脚本（否则作者没法测自己的东西）并标注"在建"', async () => {
    const body = 'export async function go(x) { return { got: String(x) } }\n'
    await fs.writeFile(path.join(dir, 'echo2.mjs'), body)
    await fs.writeFile(path.join(dir, '_echo2.mjs'), body)
    const s = fakeCtx()
    apply(s.ctx)
    const r = await call(s.tools, 'canvas_fn_call', { script: '_echo2', fn: 'go', argsJson: '["hi"]' })
    expect(r.ok).toBe(true)
    expect(r.draft).toBe(true)
    expect(String(r.draftNote)).toContain('_echo2')
    // 已验证的调起来不带那两条
    const r2 = await call(s.tools, 'canvas_fn_call', { script: 'echo2', fn: 'go', argsJson: '["hi"]' })
    expect(r2.ok).toBe(true)
    expect(r2.draft).toBeUndefined()
  })

  it('canvas_fn_info 查一个函数的参数与返回', async () => {
    const s = fakeCtx()
    apply(s.ctx)
    const r = await call(s.tools, 'canvas_fn_info', { script: 'scale', fn: 'run' })
    expect(r.what).toBe('把图片缩放到指定宽度')
    expect(r.returns).toBe('缩放后的地址')
    expect(r.example).toBe('scale.run(640)')
    expect((r.args as unknown[]).length).toBe(1)
  })

  it('函数不存在 → 报错并列出可用的', async () => {
    const s = fakeCtx()
    apply(s.ctx)
    const r = await call(s.tools, 'canvas_fn_info', { script: 'scale', fn: 'nope' })
    expect(r.ok).toBe(false)
    expect(String(r.error)).toContain('probe')
  })
})

describe('④ canvas_fn_call：不必传 Canvas ID / Node ID', () => {
  beforeEach(async () => {
    await fs.writeFile(
      path.join(dir, 'hello.mjs'),
      [
        'export async function echo(text, ctx) {',
        '  return { text: String(text), canvasId: ctx.canvasId, nodeId: ctx.nodeId }',
        '}',
        '',
      ].join('\n'),
    )
  })

  it('★ 不传 canvasId / nodeId 也能调，且用一张虚拟画布', async () => {
    const s = fakeCtx()
    apply(s.ctx)
    const r = await call(s.tools, 'canvas_fn_call', { script: 'hello', fn: 'echo', argsJson: '["hi"]' })
    expect(r.ok).toBe(true)
    const result = r.result as { text: string; canvasId: string }
    expect(result.text).toBe('hi')
    // ★ 虚拟画布：id 带前缀，绝不是用户的画布
    expect(result.canvasId).toContain('fn-probe-')
    expect(String(r.virtualCanvasId)).toContain('fn-probe-')
    expect(String(r.note)).toContain('虚拟画布')
  })

  it('argsJson 不是数组 / 不是 JSON → 明确报错', async () => {
    const s = fakeCtx()
    apply(s.ctx)
    expect((await call(s.tools, 'canvas_fn_call', { script: 'hello', fn: 'echo', argsJson: '{}' })).ok).toBe(false)
    const r = await call(s.tools, 'canvas_fn_call', { script: 'hello', fn: 'echo', argsJson: '{oops' })
    expect(String(r.error)).toContain('JSON')
  })

  it('函数不存在 → 报错并列出可用的（连进程都不起）', async () => {
    const s = fakeCtx()
    apply(s.ctx)
    const r = await call(s.tools, 'canvas_fn_call', { script: 'hello', fn: 'nope' })
    expect(r.ok).toBe(false)
    expect(String(r.error)).toContain('echo')
  })

  it('虚拟画布是幂等的：第二次调不会重复建', async () => {
    const s = fakeCtx()
    apply(s.ctx)
    await ensureVirtualCanvas(s.ctx)
    const before = s.canvasWrites.filter((w) => w.id.startsWith('fn-probe-')).length
    await ensureVirtualCanvas(s.ctx)
    const after = s.canvasWrites.filter((w) => w.id.startsWith('fn-probe-')).length
    expect(after).toBe(before)
  })

  it('★ 虚拟画布不碰用户的真画布', async () => {
    const s = fakeCtx()
    apply(s.ctx)
    await call(s.tools, 'canvas_fn_call', { script: 'hello', fn: 'echo', argsJson: '["x"]' })
    const touched = new Set(s.canvasWrites.map((w) => w.id))
    expect([...touched].every((id) => id.startsWith('fn-probe-'))).toBe(true)
    expect(touched.has('default')).toBe(false)
  })

  /**
    * ★ 前缀在两边各有一份（插件是外挂单文件，不能 import cloud-server），
    *   漂了的后果是"过滤不干净 → 虚拟画布冒进用户的画布列表"。用后台源码当尺子量一次。
    */
  it('★ 虚拟画布前缀与 cloud-server 那份一致（防悄悄漂移）', () => {
    const src = readFileSync(
      path.join(__dirname, '../../../../cloud-server/src/store/canvasPaths.ts'),
      'utf8',
    )
    const m = /export const VIRTUAL_CANVAS_PREFIX = '([^']+)'/.exec(src)
    expect(m, 'cloud-server 的 canvasPaths.ts 里应当有 VIRTUAL_CANVAS_PREFIX').not.toBeNull()
    expect(m![1]).toBe('fn-probe-')
  })
})
