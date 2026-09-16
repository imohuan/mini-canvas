/**
 * canvasOps 路由 —— 画布的**增量写**接口（`POST /api/canvas/nodes` · `POST /api/canvas/edges`）。
 *
 * ## 为什么需要它（这是关键，别当成「又多一套接口」）
 *
 * 画布有两个写方：网页端（用户在拖/连/删）与 AI（MCP 工具）。原先两边都只能「读全量 → 改 → 写全量」，
 * 于是**谁后写谁把对方整个盖掉** —— 实测过：AI 刚加的节点，会被画布紧接着的一次整包保存抹掉。
 *
 * 增量写让两边都只提交「我想改什么」，由服务端在同一份画布上依次应用。配合 CanvasDocument 的写锁，
 * 并发的两个写方都能生效（`canvasOps.test.ts` 里用十个并发新增钉死了这条）。
 *
 * ## 契约
 *
 *   POST /api/canvas/nodes  { add?, delete?, update? }  → BatchResult
 *   POST /api/canvas/edges  { add?, delete?, update? }  → BatchResult
 *
 * 语义与 MCP 的 `canvas.batch_nodes` / `canvas.batch_edges` 同源（同一套 CanvasDocument 方法）。
 * **但容错策略不同**，这是有意的：
 *
 *   MCP 口（AI 用）  严格：说错 id 就报错。AI 会看到错误并改正。
 *   同步口（网页用） 幂等：重复新增=更新、删不存在=跳过。因为网页端提交的是「我这份与上一份的差集」，
 *                        而「我这边还在、云端已被 AI 删掉」是并发下的正常时序，不是错误。
 *
 * ## 为什么必须在这里校验形状
 *
 * MCP 那条路有 zod 挡着，这个口没有 —— 而它是**对浏览器开放**的。不校验的后果实测过：
 *   - `{"delete":{}}` / `{"update":5}` → `for...of` 直接 TypeError，500；
 *   - `{"add":[{"position":{"x":"oops"}}]}` → 写进画布，之后**每个**新节点的自动定位都算出
 *     `NaN`/`null`，且自己好不了（画布被永久污染）。
 * 所以这里做一层小而硬的形状校验：宁可 400 说清楚，也不让脏数据进画布。
 */
import { Hono } from 'hono'
import type { CanvasDocument } from '../mcp/canvasDoc.js'

/** 请求体的体积上限（与 kv 路由的 MAX_KEY_LENGTH 同精神：挡住意外/恶意的巨物，而不是精确配额） */
const MAX_BODY_BYTES = 16 * 1024 * 1024

/**
 * 请求体的**嵌套深度**上限。
 *
 * 为什么字节上限不够：实测约 1.2MB 的深层嵌套（远低于 16MB）会让落盘那一步的
 * `JSON.stringify` 爆栈抛 RangeError，最后以 500 收场。深度是另一条轴，得单独卡。
 *
 * 注意这个数算的是**整个 body** 的深度（`depthOf(parsed)`），不是某个字段自身的：
 * body → add 数组 → 项对象 → data 对象 → 它里面的第一层…… 就已经用掉 4~5 层。
 * 100 层对真实画布数据（data 通常 2~4 层）绰绰有余，设它只是拦住病态输入。
 */
const MAX_BODY_DEPTH = 100

/** 算一个值的嵌套深度（迭代式，自己不吃栈） */
function depthOf(v: unknown): number {
  let max = 0
  const stack: Array<{ node: unknown; depth: number }> = [{ node: v, depth: 1 }]
  while (stack.length > 0) {
    const { node, depth } = stack.pop()!
    if (depth > max) max = depth
    if (depth > MAX_BODY_DEPTH) return depth // 够了，不必再往下走
    if (node && typeof node === 'object') {
      for (const child of Object.values(node as Record<string, unknown>)) {
        stack.push({ node: child, depth: depth + 1 })
      }
    }
  }
  return max
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

/** 有限数（挡住 NaN/Infinity/字符串数字/null —— 它们会让后续几何计算变成 NaN 并永久污染画布） */
function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

/** 位置：{ x, y } 两个有限数 */
function isPosition(v: unknown): boolean {
  return isPlainObject(v) && isFiniteNumber(v.x) && isFiniteNumber(v.y)
}

/** 尺寸：{ w, h } 两个有限数 */
function isSize(v: unknown): boolean {
  return isPlainObject(v) && isFiniteNumber(v.w) && isFiniteNumber(v.h)
}

/** 三段式字段：要么没有，要么是数组（`{"delete":{}}` 这种必须在进业务前挡住） */
function checkSegments(body: Record<string, unknown>): string | null {
  for (const key of ["add", "delete", "update"]) {
    const v = body[key]
    if (v === undefined) continue
    if (!Array.isArray(v)) return `字段 ${key} 必须是数组`
  }
  return null
}

function checkDeleteList(v: unknown): string | null {
  if (!Array.isArray(v)) return null
  for (const id of v) {
    if (typeof id !== 'string' || id === '') return 'delete 的每一项必须是非空字符串 id'
  }
  return null
}

/** 校验一条新增/更新的形状；返回错误文案或 null */
function checkNodeEntry(entry: unknown, kind: "add" | "update"): string | null {
  if (!isPlainObject(entry)) return `${kind} 的每一项必须是对象`
  // 新增时 id 可省略（服务端生成一个 ai- 前缀的）；给了就必须是字符串。更新则必须给 id。
  if (kind === 'update' ? typeof entry.id !== 'string' : entry.id !== undefined && typeof entry.id !== 'string') {
    return kind === 'update' ? 'update 的 id 必须是字符串' : 'add 的 id 给了就必须是字符串'
  }
  if (kind === 'add' && typeof entry.type !== 'string') return 'add 的 type 必须是字符串'
  if (entry.position !== undefined && !isPosition(entry.position)) return 'position 必须是 { x, y } 两个有限数'
  if (entry.size !== undefined && !isSize(entry.size)) return 'size 必须是 { w, h } 两个有限数'
  if (entry.data !== undefined && !isPlainObject(entry.data)) return 'data 必须是对象'
  // parentId 只认字符串或 null（null = 解除父子）；不给数字/对象，否则会原样落盘成脏数据
  if (entry.parentId !== undefined && entry.parentId !== null && typeof entry.parentId !== 'string') {
    return 'parentId 必须是字符串或 null'
  }
  return null
}

/** 校验一条连线的形状 */
function checkEdgeEntry(entry: unknown, kind: "add" | "update"): string | null {
  if (!isPlainObject(entry)) return `${kind} 的每一项必须是对象`
  // 同上：边的新增 id 也可省略（按 e-{source}-{target} 生成）
  if (kind === 'update' ? typeof entry.id !== 'string' : entry.id !== undefined && typeof entry.id !== 'string') {
    return kind === 'update' ? 'update 的 id 必须是字符串' : 'add 的 id 给了就必须是字符串'
  }
  if (kind === 'add' && (typeof entry.source !== 'string' || typeof entry.target !== 'string')) {
    return 'add 的 source / target 必须是字符串'
  }
  if (entry.data !== undefined && !isPlainObject(entry.data)) return 'data 必须是对象'
  return null
}

/** 逐项校验数组；返回第一个错误文案或 null */
function checkList(v: unknown, check: (entry: unknown) => string | null): string | null {
  if (!Array.isArray(v)) return null
  for (const entry of v) {
    const bad = check(entry)
    if (bad) return bad
  }
  return null
}

export function canvasOpsRoutes(doc: CanvasDocument): Hono {
  const app = new Hono()

  /**
   * 读 body：先按文本量大小（巨物不该进 JSON.parse，超深嵌套还会让 stringify 爆栈），
   * 再解析成对象。返回错误响应或解析好的对象（两个端点共用，避免抄两遍走样）。
   */
  async function readBody(c: { req: { text: () => Promise<string> } }): Promise<
    { ok: true; body: Record<string, unknown> } | { ok: false; res: Response }
  > {
    const raw = await c.req.text().catch(() => '')
    if (raw.length > MAX_BODY_BYTES) {
      return { ok: false, res: Response.json({ ok: false, error: 'body 过大' }, { status: 413 }) }
    }
    try {
      const parsed = JSON.parse(raw)
      if (isPlainObject(parsed)) {
        // 深度也要卡：字节数合格但嵌套过深的输入会让落盘时的 stringify 爆栈（最后以 500 收场）
        if (depthOf(parsed) > MAX_BODY_DEPTH) {
          return {
            ok: false,
            res: Response.json({ ok: false, error: `body 嵌套过深（上限 ${MAX_BODY_DEPTH} 层）` }, { status: 400 }),
          }
        }
        return { ok: true, body: parsed }
      }
    } catch {
      /* 落到下面的统一报错 */
    }
    return {
      ok: false,
      res: Response.json({ ok: false, error: 'body 不是合法 JSON 对象（应为 { add?, delete?, update? }）' }, { status: 400 }),
    }
  }

  app.post('/api/canvas/nodes', async (c) => {
    const read = await readBody(c)
    if (!read.ok) return read.res
    const { body } = read

    const segErr = checkSegments(body)
    if (segErr) return c.json({ ok: false, error: segErr }, 400)
    const delErr = checkDeleteList(body.delete)
    if (delErr) return c.json({ ok: false, error: delErr }, 400)
    const addErr = checkList(body.add, (e) => checkNodeEntry(e, 'add'))
    if (addErr) return c.json({ ok: false, error: addErr }, 400)
    const updErr = checkList(body.update, (e) => checkNodeEntry(e, 'update'))
    if (updErr) return c.json({ ok: false, error: updErr }, 400)

    const result = await doc.batchNodes({
      ...(body.add ? { add: body.add as never } : {}),
      ...(body.delete ? { delete: body.delete as never } : {}),
      ...(body.update ? { update: body.update as never } : {}),
      // 同步口的幂等语义（见文件头）：重复新增=更新、删/改不存在=跳过
      upsert: true,
      lenient: true,
    })
    return c.json(result)
  })

  app.post('/api/canvas/edges', async (c) => {
    const read = await readBody(c)
    if (!read.ok) return read.res
    const { body } = read

    const segErr = checkSegments(body)
    if (segErr) return c.json({ ok: false, error: segErr }, 400)
    const delErr = checkDeleteList(body.delete)
    if (delErr) return c.json({ ok: false, error: delErr }, 400)
    const addErr = checkList(body.add, (e) => checkEdgeEntry(e, 'add'))
    if (addErr) return c.json({ ok: false, error: addErr }, 400)
    const updErr = checkList(body.update, (e) => checkEdgeEntry(e, 'update'))
    if (updErr) return c.json({ ok: false, error: updErr }, 400)

    const result = await doc.batchEdges({
      ...(body.add ? { add: body.add as never } : {}),
      ...(body.delete ? { delete: body.delete as never } : {}),
      ...(body.update ? { update: body.update as never } : {}),
      upsert: true,
      lenient: true,
    })
    return c.json(result)
  })

  return app
}
