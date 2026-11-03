/**
 * node-ui 后台：画布读写与节点查找（从 server.ts 原样迁出）。
 */
import type { CanvasStoreLike, DocLike, DocPoolLike, NodeLike, ServerCtx, ServerCtxLike } from './shared-types.js'
import { describeNodeDoc, nodeDocOf } from '../task/nodeDoc.js'
import { uniqueLabel } from '../task/uniqueLabel.js'

export function docFor(ctx: ServerCtx, canvasId: string): DocLike | undefined {
  const doc = ctx.tryGet<DocLike>('doc')
  if (canvasId === 'default') return doc
  const pool = ctx.tryGet<DocPoolLike>('canvasDocPool')
  if (pool && typeof pool.for === 'function') return pool.for(canvasId)
  return undefined
}

/** path.join 的极简替代（本文件只有正斜杠拼接需要） */
export function pathJoin(dir: string, name: string): string {
  return dir.endsWith('\\') || dir.endsWith('/') ? dir + name : dir + '/' + name
}

/**
 * 本服务自己的 origin。
 *
 * 生成的页面住在不透明源沙箱里（Origin: null），请求什么都算跨源；dev 下前端地址经 vite
 * 代理转发还会把预检搞坏（实测）。所以让**后台自报**地址，前端写进节点，渲染时页面直连这里。
 */
export function selfOrigin(c: ServerCtxLike): string {
  const host = c.req.header('host')
  if (!host) return ''
  const proto =
    c.req.header('x-forwarded-proto') ||
    (host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https')
  return proto + '://' + host
}

/** 取节点的短描述（给手册里那句「这块画布上有什么」用） */
export function describeNode(n: NodeLike): string {
  const d = n.data ?? {}
  const label = typeof d.label === 'string' && d.label ? ' "' + d.label + '"' : ''
  const bits: string[] = []
  for (const key of ['text', 'imageUrl', 'videoUrl', 'audioUrl']) {
    const v = d[key]
    if (typeof v !== 'string' || !v) continue
    bits.push(key + '=' + (v.length > 80 ? v.slice(0, 80) + '…' : v))
  }
  if (n.type === 'ui') bits.push('内容:' + (typeof d.uiHtml === 'string' && d.uiHtml ? '已画' : '还是空的'))
  const head = '- 节点 ' + n.id + '（' + n.type + '）' + label + (bits.length ? ' · ' + bits.join(' · ') : '')
  // 可视化节点把说明书摊在下一行（用户要的「每个可视化节点要有详细的功能描述」）：
  // 手册是 AI 了解这块画布的第一入口，说明书藏起来等于没写。
  const doc = n.type === 'ui' ? nodeDocOf(d) : undefined
  if (!doc) return head
  return head + '\n' + describeNodeDoc(doc).split('\n').map((l) => '    ' + l).join('\n')
}

/** 读某张画布的节点（默认画布优先用宿主那份有写锁的 doc） */

export async function nodesOf(ctx: ServerCtx, canvasId: string): Promise<NodeLike[]> {
  const doc = docFor(ctx, canvasId)
  if (doc && typeof doc.getNodes === 'function') return doc.getNodes()
  const store = ctx.tryGet<CanvasStoreLike>('canvasStore')
  if (!store) return []
  const data = await store.readCanvas(canvasId)
  return (data?.nodes ?? []) as NodeLike[]
}

/**
 * 把界面写进一个节点（**只写这一个**，不搬整张画布）。
 *
 * 默认画布走宿主那份 doc —— 它带写锁（与 AI / 网页端的写排成一条链，不会互相覆盖），
 * 而且写盘会走 canvasStore 的变更通知，前端实时通道能收到；直接写 storage 会绕过那把锁。
 */

export async function writeUiHtml(
  ctx: ServerCtx,
  canvasId: string,
  nodeId: string,
  data: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string }> {
  const doc = docFor(ctx, canvasId)
  if (doc && typeof doc.batchNodes === 'function') {
    try {
      const res = await doc.batchNodes({ update: [{ id: nodeId, data }] })
      if (!res.ok) return { ok: false, error: (res.errors ?? []).map((e) => e.message).join('; ') || '写入失败' }
      return { ok: true }
    } catch (err) {
      return { ok: false, error: '写入失败：' + String(err) }
    }
  }
  // 宿主没给该画布文档（旧宿主 / 独立运行）：退回读-改-写；新宿主走上面的统一锁。
  const store = ctx.tryGet<CanvasStoreLike>('canvasStore')
  if (!store) return { ok: false, error: '后台没有画布存储服务，无法写入' }
  const snap = await store.readCanvas(canvasId)
  if (!snap) return { ok: false, error: '画布不存在：' + canvasId }
  const nextNodes = (snap.nodes as Array<Record<string, unknown>>).map((n) =>
    String(n.id) === nodeId ? { ...n, data: { ...((n.data as Record<string, unknown>) ?? {}), ...data } } : n,
  )
  await store.writeCanvas(canvasId, { nodes: nextNodes, edges: snap.edges })
  return { ok: true }
}

/**
 * 从资产地址里取文件名（/api/assets/files/ 后面那一段）。
 *
 * 资产服务的 readFile 只认「文件名」这一种形态（它会再过一遍名字白名单），
 * 而库里登记的是完整 url —— 所以这里先把 url 拆成名字。拆不出来就是空串
 * （readFile 会当成非法名而返回 undefined，不会读错文件）。
 */

export function assetNameOf(url: string): string {
  const clean = (url || '').split('?')[0].split('#')[0]
  const at = clean.indexOf('/api/assets/files/')
  return at < 0 ? '' : clean.slice(at + '/api/assets/files/'.length)
}

/** 这张画布上现有的全部显示名（给「建进来的节点别撞名」用） */

export async function canvasLabelsOf(ctx: ServerCtx, canvasId: string): Promise<string[]> {
  const nodes = await nodesOf(ctx, canvasId)
  const out: string[] = []
  for (const n of nodes) {
    const label = n.data?.label
    if (typeof label === 'string' && label.trim()) out.push(label.trim())
  }
  return out
}

/**
 * 给 data 里的 label 换成不撞的名字；没 label（或空）→ 原样返回（交回数据层按类型补默认名）。
 *
 * 返回的是**要并进 data 的补丁**（不是整份 data）：调用方用它覆盖 label 一处即可。
 */

export function dedupeLabel(data: Record<string, unknown>, taken: string[]): Record<string, unknown> {
  const want = data.label
  if (typeof want !== 'string' || !want.trim()) return {}
  const next = uniqueLabel(want, taken)
  return next && next !== want ? { label: next } : {}
}

/**
 * 往画布上**加一个节点**（MCP 建节点走这条）。
 *
 * 默认画布用宿主那份 doc（带写锁，与网页端 / AI 的写排成一条链）；其它画布
 * 因为宿主没给那张画布的 doc，只能读-改-写（只在末尾追加，不动已有的）。
 *
 * 返回值里的 id 是**真的写进画布的 id**（从 batchNodes 的 added 里拿）——
 * 不自己编号（编号规则在数据层，各写一份迟早漂）。
 */
/**
 * 「把这次调用要的那个**可视化节点**读出来」——五个工具共用的一段前置检查。
 *
 * 为什么要抽：canvasId 回落、nodeId 必填、取节点、拒非 ui 类型，这四步在
 * canvas_ui_write / update / read / package / describe 里**各抄了一遍**。
 * 抄五遍的代价不是啰嗦，是「改规则要同步五处」——漏一处就是两个工具行为不一致。
 */

export async function uiNodeOf(
  ctx: ServerCtx,
  args: Record<string, unknown>,
): Promise<{ ok: true; canvasId: string; nodeId: string; node: NodeLike } | { ok: false; error: string }> {
  const canvasId = typeof args.canvasId === 'string' && args.canvasId ? args.canvasId : 'default'
  const nodeId = typeof args.nodeId === 'string' ? args.nodeId : ''
  if (!nodeId) return { ok: false, error: '缺少 nodeId' }
  const nodes = await nodesOf(ctx, canvasId)
  const node = nodes.find((n) => n.id === nodeId)
  if (!node) return { ok: false, error: '画布 ' + canvasId + ' 上没有节点 ' + nodeId }
  if (node.type !== 'ui') {
    return {
      ok: false,
      error:
        '节点 ' + nodeId + ' 是「' + node.type + '」类型，不是可视化节点（type 必须是 "ui"）。' +
        '要画界面请先建一个：用内置的 canvas_batch_nodes 加一个 { type: "ui", position: {...} }。',
    }
  }
  return { ok: true, canvasId, nodeId, node }
}

export async function addNodeToCanvas(

  ctx: ServerCtx,
  canvasId: string,
  node: { type: string; data?: Record<string, unknown>; position?: { x: number; y: number } },
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!node.type) return { ok: false, error: '缺少节点类型' }
  // ★ 名字要跟着**这张画布上已有**的去重（否则把同一个收藏包建两次 = 两个同名节点）。
  //   用户口径 2026-10-14：「拖出来的这些节点，名称没有自动追加，导致了名称重复」。
  //   与网页端那条路同一套规则（见 task/uniqueLabel.ts：两份规则由测试盯着一致）。
  const data = node.data
    ? { ...node.data, ...dedupeLabel(node.data, await canvasLabelsOf(ctx, canvasId)) }
    : undefined
  const entry = {
    type: node.type,
    ...(data ? { data } : {}),
    ...(node.position ? { position: node.position } : {}),
  }
  const doc = docFor(ctx, canvasId)
  if (doc && typeof doc.batchNodes === 'function') {
    try {
      const res = await doc.batchNodes({ add: [entry] })
      if (!res.ok) return { ok: false, error: (res.errors ?? []).map((e) => e.message).join('; ') || '建节点失败' }
      const id = res.added?.[0]
      if (!id) return { ok: false, error: '建节点没回 id（宿主实现可能不对）' }
      return { ok: true, id }
    } catch (err) {
      return { ok: false, error: '建节点失败：' + (err instanceof Error ? err.message : String(err)) }
    }
  }
  // 宿主没给该画布文档（旧宿主 / 独立运行）：退回读-改-写（只追加）。
  const store = ctx.tryGet<CanvasStoreLike>('canvasStore')
  if (!store) return { ok: false, error: '后台没有画布存储服务，建不了节点' }
  const snap = await store.readCanvas(canvasId)
  if (!snap) return { ok: false, error: '画布不存在：' + canvasId }
  const nodes = (snap.nodes as Array<Record<string, unknown>>) ?? []
  const taken = new Set(nodes.map((n) => String(n.id)))
  let max = 0
  for (const id of taken) {
    const n = Number.parseInt(id, 10)
    if (!Number.isNaN(n) && n > max) max = n
  }
  let id = ''
  do {
    max += 1
    id = String(max)
  } while (taken.has(id))
  const next = {
    id,
    type: node.type,
    position: node.position ?? { x: 120 + (nodes.length % 5) * 48, y: 120 + Math.floor(nodes.length / 5) * 60 },
    data: data ?? { label: node.type },
  }
  await store.writeCanvas(canvasId, { nodes: [...nodes, next], edges: (snap.edges as unknown[]) ?? [] })
  return { ok: true, id }
}

