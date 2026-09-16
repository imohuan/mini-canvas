/**
 * 画布增量写接口（`POST /api/canvas/nodes` · `POST /api/canvas/edges`）单测。
 *
 * 这两个口子存在的理由：画布有**两个写方** —— 网页端（用户在拖/连/删）与 AI（MCP 工具）。
 * 只要两边都「读全量 → 改 → 写全量」，谁后写谁就把对方整个盖掉（AI 刚加的节点会凭空消失）。
 * 增量写让两边都只提交「我想改什么」，由服务端在同一份画布上依次应用 —— 谁都不会覆盖谁。
 *
 * 因此这里锁住两件事：
 * 1. 增删改（含尺寸/父子这类只有整包写才表达得出的字段）都能经这个口子生效；
 * 2. **并发写不互相覆盖** —— 这条是接口存在的全部意义，靠 CanvasDocument 的写锁保证。
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

async function boot(): Promise<void> {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'canvas-ops-'))
  srv = await createCloudServer({ dir })
}

/** 发一条增量写请求，返回解析后的 JSON（含 status） */
async function post(pathname: string, body: unknown) {
  const res = await srv.app.fetch(
    new Request('http://localhost' + pathname, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
  const text = await res.text()
  let json: any
  try {
    json = JSON.parse(text)
  } catch {
    json = undefined
  }
  return { status: res.status, json }
}

/** 读当前画布（走 KV 读口，等于是「第三方视角」看到的落盘结果） */
async function readGraph<T = any[]>(): Promise<T> {
  const res = await srv.app.fetch(new Request('http://localhost/api/kv/canvas/graph'))
  const body: any = await res.json()
  return body.value as T
}

async function readEdges<T = any[]>(): Promise<T> {
  const res = await srv.app.fetch(new Request('http://localhost/api/kv/canvas/graph-edges'))
  const body: any = await res.json()
  return body.value as T
}

describe('POST /api/canvas/nodes —— 增量加节点', () => {
  it('能往画布里加节点，并真的落盘', async () => {
    await boot()
    const r = await post('/api/canvas/nodes', { add: [{ type: 'text', id: 'n1', data: { text: '嗨' } }] })
    expect(r.status).toBe(200)
    expect(r.json.ok).toBe(true)
    expect(r.json.added).toEqual(['n1'])

    const nodes = await readGraph()
    expect(nodes.map((n: any) => n.id)).toEqual(['n1'])
    expect(nodes[0].data.text).toBe('嗨')
  })

  it('没给位置时自动摆一个位置（与 MCP 建节点同一套规则）', async () => {
    await boot()
    await post('/api/canvas/nodes', { add: [{ type: 'text', id: 'a', position: { x: 0, y: 0 } }] })
    const r = await post('/api/canvas/nodes', { add: [{ type: 'text', id: 'b' }] })
    expect(r.json.ok).toBe(true)
    const nodes = await readGraph()
    const b = nodes.find((n: any) => n.id === 'b')
    expect(b.position.x).toBeGreaterThan(0)
  })
})

describe('POST /api/canvas/nodes —— 增量改节点', () => {
  it('能改位置与数据（AI 改节点状态走的就是这条）', async () => {
    await boot()
    await post('/api/canvas/nodes', { add: [{ type: 'text', id: 'a', data: { runState: 'idle' } }] })
    const r = await post('/api/canvas/nodes', {
      update: [{ id: 'a', position: { x: 88, y: 99 }, data: { runState: 'running' } }],
    })
    expect(r.json.ok).toBe(true)
    const a = (await readGraph()).find((n: any) => n.id === 'a')
    expect(a.position).toEqual({ x: 88, y: 99 })
    expect(a.data.runState).toBe('running')
  })

  it('也能改尺寸与父子（只有整包写才能表达的字段，增量写不能漏）', async () => {
    await boot()
    await post('/api/canvas/nodes', { add: [{ type: 'text', id: 'p' }, { type: 'text', id: 'c' }] })
    await post('/api/canvas/nodes', { update: [{ id: 'c', size: { w: 300, h: 200 }, parentId: 'p' }] })
    const nodes = await readGraph()
    const c = nodes.find((n: any) => n.id === 'c')
    expect(c.size).toEqual({ w: 300, h: 200 })
    expect(c.parentId).toBe('p')
  })

  it('update 的 data 是浅合并（只动给出的字段）', async () => {
    await boot()
    await post('/api/canvas/nodes', { add: [{ type: 'text', id: 'a', data: { keep: 1, change: 'old' } }] })
    await post('/api/canvas/nodes', { update: [{ id: 'a', data: { change: 'new' } }] })
    const a = (await readGraph()).find((n: any) => n.id === 'a')
    expect(a.data).toEqual({ keep: 1, change: 'new' })
  })
})

describe('POST /api/canvas/nodes —— 增量删节点', () => {
  it('删节点会连带删掉它的连线（不留悬挂边）', async () => {
    await boot()
    await post('/api/canvas/nodes', { add: [{ type: 'text', id: 'a' }, { type: 'text', id: 'b' }] })
    await post('/api/canvas/edges', { add: [{ source: 'a', target: 'b' }] })
    await post('/api/canvas/nodes', { delete: ['a'] })
    expect((await readGraph()).map((n: any) => n.id)).toEqual(['b'])
    expect(await readEdges()).toEqual([])
  })
})

describe('POST /api/canvas/nodes —— 非法请求被挡下', () => {
  it('删不存在的节点 → ok:false 且画布一个字节都没动', async () => {
    await boot()
    await post('/api/canvas/nodes', { add: [{ type: 'text', id: 'a' }] })
    const r = await post('/api/canvas/nodes', { delete: ['ghost'] })
    // 同步口的语义是幂等：删一个「云端已经没有」的东西 = 目的已达成，跳过而不是拒绝整批。
    // （MCP 口没这层宽容，那边写错 id 会明确报错 —— 别把两个口的容错策略搞混。）
    expect(r.json.ok).toBe(true)
    expect(r.json.deleted).toEqual([])
    expect((await readGraph()).map((n: any) => n.id)).toEqual(['a'])
  })

  it('缺 type 的新增被挡下', async () => {
    await boot()
    const r = await post('/api/canvas/nodes', { add: [{ data: {} }] })
    expect(r.json.ok).toBe(false)
  })

  it('body 不是 JSON 对象 → 400（明确报错，不静默当成空操作）', async () => {
    await boot()
    const bad = await post('/api/canvas/nodes', 'not an object')
    expect(bad.status).toBe(400)
  })
})

describe('POST /api/canvas/edges —— 增量连线', () => {
  it('加连线（端点必须已存在）', async () => {
    await boot()
    await post('/api/canvas/nodes', { add: [{ type: 'text', id: 'a' }, { type: 'text', id: 'b' }] })
    const r = await post('/api/canvas/edges', { add: [{ source: 'a', target: 'b' }] })
    expect(r.json.ok).toBe(true)
    expect((await readEdges()).length).toBe(1)
  })

  it('端点不存在 → 拒绝，不写悬挂边', async () => {
    await boot()
    await post('/api/canvas/nodes', { add: [{ type: 'text', id: 'a' }] })
    const r = await post('/api/canvas/edges', { add: [{ source: 'a', target: 'ghost' }] })
    expect(r.json.ok).toBe(false)
    expect(await readEdges()).toEqual([])
  })
})

describe('两个写方同时改画布：谁都不会盖掉谁', () => {
  /**
   * 这条来自一个真实的时序：
   *   AI 加了节点 Y → 实时通道把 Y 合进网页端 → 用户接着拖了个节点 → 网页端保存
   * 网页端这次提交里就带上了「新增 Y」，可 Y 早在云端了。
   *
   * 若把这种「新增一个已存在的 id」当成错误（MCP 的 batch_nodes 就是这语义，因为对 AI 来说那确实是说错了），
   * 整批会被**一个都不改**地拒绝 —— 用户那次拖动就白拖了。所以这个同步口把这种情况当成「更新」处理。
   */
  it('新增一个已经存在的节点 → 当成更新，不整批拒绝（两个写方并发后的常见时序）', async () => {
    await boot()
    await post('/api/canvas/nodes', { add: [{ type: 'text', id: 'y', data: { text: 'AI 加的' } }] })

    // 网页端这次提交里既带了「已经存在的 y」，也带了真正的新节点 z
    const r = await post('/api/canvas/nodes', {
      add: [
        { type: 'text', id: 'y', data: { text: 'AI 加的' } },
        { type: 'text', id: 'z', data: { text: '本地加的' } },
      ],
    })
    expect(r.json.ok).toBe(true)
    expect(r.json.added).toEqual(['z']) // y 不算新增（它已经在了）

    const ids = (await readGraph()).map((n: any) => n.id).sort()
    expect(ids).toEqual(['y', 'z'])
  })

  /**
  * 这条是这两个接口存在的理由。
   *
   * 没有写锁时，每次调用都是「读全量 → 改 → 写全量」，十个并发调用会各自读到同一份旧数据、
   * 再各自写回自己那份（只有自己那一个新增），后写的把先写的盖掉 —— 实测只剩一两个节点。
   * 有写锁后它们排成一条链，每一个都在前一个的结果上继续，十个全在。
   */
  it('十个并发新增，一个都不能少', async () => {
    await boot()
    await post('/api/canvas/nodes', { add: [{ type: 'text', id: 'base' }] })

    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        post('/api/canvas/nodes', { add: [{ type: 'text', id: 'n' + i }] }),
      ),
    )
    expect(results.every((r) => r.json.ok)).toBe(true)

    const ids = (await readGraph()).map((n: any) => n.id).sort()
    expect(ids.length).toBe(11)
    expect(ids).toEqual(['base', ...Array.from({ length: 10 }, (_, i) => 'n' + i)].sort())
  })

  it('并发「加节点」与「改节点」混着来，两边都生效', async () => {
    await boot()
    await post('/api/canvas/nodes', { add: [{ type: 'text', id: 'seed', data: { runState: 'idle' } }] })

    await Promise.all([
      post('/api/canvas/nodes', { update: [{ id: 'seed', data: { runState: 'running' } }] }),
      post('/api/canvas/nodes', { add: [{ type: 'text', id: 'ai-1' }] }),
      post('/api/canvas/nodes', { add: [{ type: 'text', id: 'ai-2' }] }),
    ])

    const nodes = await readGraph()
    const seed = nodes.find((n: any) => n.id === 'seed')
    expect(seed.data.runState).toBe('running')
    expect(nodes.length).toBe(3)
  })
})

describe('POST /api/canvas/nodes —— 形状校验（这个口对浏览器开放，必须有）', () => {
  /**
   * 这些用例全部来自实测：不校验时 `{"delete":{}}` 会让 `for...of` 崩成 500，
   * 而坏 position 会写进画布、把之后每个新节点的自动定位都算成 NaN/null（且自己好不了）。
   */
  it('三段不是数组 → 400（不是 500 崩掉）', async () => {
    await boot()
    expect((await post('/api/canvas/nodes', { delete: {} })).status).toBe(400)
    expect((await post('/api/canvas/nodes', { add: {} })).status).toBe(400)
    expect((await post('/api/canvas/nodes', { update: 5 })).status).toBe(400)
    expect((await post('/api/canvas/edges', { add: {} })).status).toBe(400)
  })

  it('坏 position / size 被拒，脏数据进不了画布', async () => {
    await boot()
    const bad = await post('/api/canvas/nodes', {
      add: [{ type: 'text', id: 'bad', position: { x: 'oops', y: null } }],
    })
    expect(bad.status).toBe(400)
    // 画布必须还是干净的：否则之后每个新节点的自动定位都会被这个坏值带坏
    // 被拒的请求连画布文件都不该创建（readGraph 在「从未保存过」时返回 undefined）
    expect(await readGraph()).toBeUndefined()

    expect((await post('/api/canvas/nodes', { add: [{ type: 'text', id: 'b2', size: { w: 'x', h: 1 } }] })).status).toBe(400)
  })

  it('项不是对象、id 给了但不是字符串 → 400', async () => {
    await boot()
    expect((await post('/api/canvas/nodes', { add: [5] })).status).toBe(400)
    expect((await post('/api/canvas/nodes', { add: [{ type: 'text', id: 7 }] })).status).toBe(400)
    expect((await post('/api/canvas/nodes', { update: [{ id: 'a' }] })).json.ok).toBe(true) // 合法形状，只是目标不存在 → lenient 跳过
  })

  it('超大 body → 413（不把这个巨物丢进 JSON.parse）', async () => {
    await boot()
    const huge = { add: [{ type: 'text', id: 'x', data: { blob: 'a'.repeat(17 * 1024 * 1024) } }] }
    expect((await post('/api/canvas/nodes', huge)).status).toBe(413)
  })
})

describe('同一批里既要删又要加同一个 id → 明确报错（不是 500 崩掉）', () => {
  it('预校验报出人话，而不是让内部 find 落空后抛 TypeError', async () => {
    await boot()
    await post('/api/canvas/nodes', { add: [{ type: 'text', id: 'a' }] })
    const r = await post('/api/canvas/nodes', { delete: ['a'], add: [{ type: 'text', id: 'a' }] })
    // 意图矛盾：到底要它还是不要它。不能静默把节点弄没，也不能 500。
    expect(r.status).toBe(200)
    expect(r.json.ok).toBe(false)
    expect(r.json.errors[0].message).toContain('既要删又要加')
    expect((await readGraph()).map((n: any) => n.id)).toEqual(['a'])
  })
})

describe('边的 type 必须落盘（不写会让云端与本地对同一条边判定不一致）', () => {
  /**
   * 数据层会给边补一个默认 type（custom），云端若留空就是 null。两边对同一条边判成「不一样」后，
   * 表现为「AI 改了边本地看不到」与「AI 删了边本地删不掉」（本地误以为「这条我改过」而保留）。
   */
  it('新增的边带默认 type，与数据层一致', async () => {
    await boot()
    await post('/api/canvas/nodes', { add: [{ type: 'text', id: 'a' }, { type: 'text', id: 'b' }] })
    await post('/api/canvas/edges', { add: [{ source: 'a', target: 'b' }] })
    expect((await readEdges())[0].type).toBe('custom')
  })

  it('显式给的 type 被保留', async () => {
    await boot()
    await post('/api/canvas/nodes', { add: [{ type: 'text', id: 'a' }, { type: 'text', id: 'b' }] })
    await post('/api/canvas/edges', { add: [{ source: 'a', target: 'b', type: 'custom' }] })
    expect((await readEdges())[0].type).toBe('custom')
  })
})

describe('整包保存（PUT /api/kv/canvas/graph）也要过同一把锁', () => {
  /**
   * 整包保存是「读全量 → 改 → 写全量」的兄弟形态，与 AI 的增量写并发时同样会互相覆盖。
   * 这条钉住「它也被排进串行链」——审查发现原先这条路径绕过了锁（等于漏了一整条数据丢失路径）。
   */
  it('整包保存与增量新增并发 → 两边都留着', async () => {
    await boot()
    await post('/api/canvas/nodes', { add: [{ type: 'text', id: 'base' }] })

    const put = srv.app.fetch(
      new Request('http://localhost/api/kv/canvas/graph', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ value: [{ id: 'base', type: 'text', position: { x: 0, y: 0 }, data: {} }, { id: 'from-page', type: 'text', position: { x: 1, y: 1 }, data: {} }] }),
      }),
    )
    const delta = post('/api/canvas/nodes', { add: [{ type: 'text', id: 'from-ai' }] })
    await Promise.all([put, delta])

    const ids = (await readGraph()).map((n: any) => n.id).sort()
    // 关键：无论两者谁先谁后，都不能出现「整包那份把 AI 新增的那个抹掉」
    expect(ids).toContain('from-page')
    expect(ids).toContain('from-ai')
  })

  it('其它作用域的写不受影响（不必排队）', async () => {
    await boot()
    const r = await srv.app.fetch(
      new Request('http://localhost/api/kv/config/theme', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ value: 'dark' }),
      }),
    )
    expect(r.status).toBe(200)
  })
})

describe('POST /api/canvas/nodes —— delete 元素与 parentId 也要校验', () => {
  /**
   * 复核发现的两个漏网：`delete` 只查了「是数组」没查元素类型，`parentId` 完全没查。
   * 前者实测会把数字 id 当裸 key 写进节点存储（污染数据），后者会把数字原样落盘。
   */
  it('delete 里塞非字符串 → 400，且画布不受污染', async () => {
    await boot()
    await post('/api/canvas/nodes', { add: [{ type: 'text', id: 'a' }] })
    expect((await post('/api/canvas/nodes', { delete: [123] })).status).toBe(400)
    expect((await post('/api/canvas/nodes', { delete: [{}] })).status).toBe(400)
    expect((await post('/api/canvas/nodes', { delete: [''] })).status).toBe(400)
    // 节点还是干净的一个（没被塞进 '123' 之类的裸 key）
    const nodes = await readGraph()
    expect(nodes.length).toBe(1)
    expect(Object.keys(nodes[0]).sort()).toEqual(['data', 'id', 'position', 'type'])
  })

  it('parentId 给数字/对象 → 400；给字符串或 null 可以', async () => {
    await boot()
    await post('/api/canvas/nodes', { add: [{ type: 'text', id: 'p' }, { type: 'text', id: 'c' }] })
    expect((await post('/api/canvas/nodes', { update: [{ id: 'c', parentId: 42 }] })).status).toBe(400)
    expect((await post('/api/canvas/nodes', { update: [{ id: 'c', parentId: {} }] })).status).toBe(400)
    expect((await post('/api/canvas/nodes', { update: [{ id: 'c', parentId: 'p' }] })).status).toBe(200)
    expect((await post('/api/canvas/nodes', { update: [{ id: 'c', parentId: null }] })).status).toBe(200)
  })

  it('嵌套过深的 body → 400（字节数够小也挡，否则落盘时 stringify 爆栈 → 500）', async () => {
    await boot()
    let deep: any = { }
    for (let i = 0; i < 400; i++) deep = { a: deep }
    const r = await post('/api/canvas/nodes', { add: [{ type: 'text', id: 'x', data: deep }] })
    expect(r.status).toBe(400)
    expect(String(r.json.error)).toContain('嵌套过深')
  })
})

describe('PUT /api/kv —— 坏 value 给人话 400，而不是 500', () => {
  it('循环引用 → 400 且有说明', async () => {
    await boot()
    // 手写一个极深的 JSON 字符串（不经 JSON.stringify，模拟「别人直接发过来的 body」）：
    // 解析能过，但落盘序列化时会爆栈 —— 以前这条会以 500 收场，现在应当是明确的 400。
    const depth = 100000
    const body = '{"value":' + '{"a":'.repeat(depth) + '1' + '}'.repeat(depth) + '}'
    const res = await srv.app.fetch(
      new Request('http://localhost/api/kv/canvas/graph', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body,
      }),
    )
    expect(res.status).toBe(400)
    expect(String(((await res.json()) as { error?: string }).error)).toContain('嵌套过深')
  })
})
