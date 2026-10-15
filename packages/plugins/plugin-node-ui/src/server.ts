/**
 * plugin-node-ui · 后台半 —— 给 AI 的「怎么画」工具（**这是本插件的核心缝**）。
 *
 * ## 为什么必须有它
 *
 * 用户在画布里引用一个可视化节点时，AI 只拿到一个节点 id。它**不知道**：
 *   - 这个节点是什么（一块会渲染 HTML 的画布）；
 *   - 内容该写进哪个字段；
 *   - 写出来的 HTML 跑在什么环境里、有什么约定；
 *   - 能调哪些后台接口。
 * 少任何一条，AI 都只能瞎猜（或者干脆不画）。所以把它做成 MCP 工具：
 * AI 调一次拿到完整约定，再调一次就把界面写进去。
 *
 * ## 四个工具（**其余用内置的**）
 *
 *   canvas_ui_guide    读「怎么画」的手册（含这张画布现有的节点，便于引用别的节点）
 *   canvas_ui_write    把界面整段写进可视化节点（第一次画 / 整段重画）
 *   canvas_ui_update   在现有 HTML 里**局部替换**（old → new）：改一个 class 不必重写整段
 *   canvas_ui_read     读节点现在的内容（改之前先看一眼）
 *
 * 改**已有节点**的字段、删节点，都用云服务**内置的** canvas_batch_nodes（它本来就支持
 * update / delete，而且是增量、带写锁的）—— 本插件不再各造一个重复工具。
 * 2026-10-12 用户指出：「我不是有一个删除的功能吗」，对，重复了。
 *
 * ## 这个文件怎么被加载、能用什么
 *
 * 打成单文件 dist/server.js → 丢进 cloud-server 的 server-plugins → 启动时用
 * import(data:text/javascript) 加载。**data: URL 里解析不了裸模块名**，所以产物必须自包含：
 * 除了 node: 内置模块，什么都不许 external（见 scripts/build-server.mjs）。
 * 于是这里只用 ctx 给的能力段（routes / mcp / tryGet），零第三方依赖。
 */

/** 手册里最多列多少个节点（防大画布把工具返回撑爆） */
const MAX_LISTED_NODES = 60

/**
 * 手册正文 —— 从**独立的 MD 文件**读进来（用户口径 2026-10-14：「这个文档单独作为一个 MD 文件，
 * 我当前使用的是 vite，它可以直接加载这个文件到一个变量中 ?raw」）。
 *
 * 为什么抽出去：它有两三百行、还要给人和 AI 同时看，塞在 TS 的字符串数组里改起来是灾难
 * （引号要转义、缩进跟着代码走）。抽成 guide.md 之后就是一个正常的 Markdown 文件。
 *
 * 两端各怎么加载：
 *   · 前端/测试（vite / vitest）：原生支持 \`?raw\`，由 vite 处理；
 *   · 后台单文件（esbuild）：esbuild 不认识 \`?raw\`，由 scripts/build-server.mjs 里的
 *     raw-text 插件顶上（少了它后台产物构建会直接失败）。
 */
import GUIDE from './guide.md?raw'

export const name = 'node-ui'

/**
 * 任务脚本（/api/task/*）—— 让节点里那段 HTML 能叫后台干活。
 *
 * 它跟本文件前半段（给 AI 的四个工具）是同一件事的两半：那边是"把界面画上去"，
 * 这边是"画上去的界面能请求后台跑脚本"。实现拆在 src/task/ 下：
 *   scripts.ts  目录与名字校验（白名单、只认 .mjs）
 *   context.ts  造脚本能拿到的上下文（只有信息与环境，不给命令）
 *   runner.ts   一次调用 = 一个独立子进程（超时、取消杀整棵树、日志转发）
 *   runs.ts     把三块拼起来（运行表单例）
 *   routes.ts   六条 HTTP 口（call / list / info / events / status / cancel）
 */
import { promises as fs } from 'node:fs'
import { formatScriptList, registerTaskRoutes, resolveTaskScriptsDir } from './task/routes.js'
import { getTaskRuns, listDraftScripts, listFunctions, listScripts, runScript, scriptDocs, scriptMethods } from './task/runs.js'
import { isDraftScriptName } from './task/scripts.js'
import { saveToDownloads } from './task/downloadDir.js'
import { PACK_EXT } from './task/pack.js'
import { planDeclared, UI_SCRIPTS_KEY } from './task/declarePlan.js'
import { registerPackRoutes } from './task/packRoutes.js'
import { registerImportRoutes } from './task/importRoutes.js'
import { UI_DEBUG_INVITE_KEY, isAcceptMatching, newSessionId, readInvite, type DebugAcceptPayload } from './debugSession.js'
import { NODE_DOC_KEY, describeNodeDoc, nodeDocOf } from './task/nodeDoc.js'
import { describeFunction } from './task/fnDoc.js'
import { uniqueLabel } from './task/uniqueLabel.js'
import { readNodePack } from './task/pack.js'
import { planImport } from './task/importPack.js'
import { resolveScriptPath } from './task/scripts.js'

/** 后台 ctx 的最小形状（就地声明，不 import 工作区包 —— 见文件头说明） */
interface ServerCtx {
  routes: {
    get(path: string, handler: (c: ServerCtxLike) => Response | Promise<Response>): void
    post(path: string, handler: (c: ServerCtxLike) => Response | Promise<Response>): void
  }
  mcp: {
    tool(def: {
      name: string
      description: string
      input?: Record<string, 'string' | 'number' | 'boolean'>
      required?: string[]
      handler(args: Record<string, unknown>): unknown | Promise<unknown>
    }): void
  }
  tryGet<T = unknown>(name: string): T | undefined
}

/** Hono 处理函数的参数（只声明本文件用到的字段） */
interface ServerCtxLike {
  json(body: unknown, status?: number): Response
  req: {
    json(): Promise<unknown>
    header(name: string): string | undefined
    url: string
    /** 查询串参数（真 Hono 的 ctx 一定有；声明成可选是为了让测试里的假 ctx 也成立） */
    query?(name: string): string | undefined
  }
}

/** 画布存储（宿主上架的服务；用来读任意画布的节点） */
interface CanvasStoreLike {
  readCanvas(id: string): Promise<{ nodes: unknown[]; edges: unknown[] } | undefined>
  writeCanvas(id: string, data: { nodes: unknown[]; edges: unknown[] }): Promise<void>
  list(): Promise<string[]>
}

/** 节点形状（本文件只关心这几个字段） */
interface NodeLike {
  id: string
  type: string
  data?: Record<string, unknown>
}

/**
 * 资产库里一条登记（本文件只用到这几个字段）。
 *
 * 为什么要读它：用户要「列出**收藏的**可视化节点」—— 收藏就是资产库里 kind 为
 * node-package 的那些条目。没有这一条，有哪些收藏可复用就只能靠人肉翻抽屉。
 */
interface AssetLike {
  id: string
  name: string
  kind?: string
  url: string
  folderId?: string
  size?: number
  createdAt?: number
}

/** 资产服务的最小用面（读清单 + 读某个包的字节） */
interface AssetStoreLike {
  list(): Promise<AssetLike[]>
  readFile?(hashName: string): Promise<Uint8Array | undefined>
}

/** 增量改画布的结果（只声明用到的那几个字段） */
interface PatchResult {
  ok?: boolean
  added?: string[]
  deleted?: string[]
  updated?: string[]
  errors?: Array<{ message: string }>
}

/** 默认画布的文档（宿主上架的服务；有写锁，优先用它） */
interface DocLike {
  getNodes(): NodeLike[]
  getEdges(): Array<{ source: string; target: string }>
  batchNodes(input: unknown): Promise<PatchResult>
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
function describeNode(n: NodeLike): string {
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
async function nodesOf(ctx: ServerCtx, canvasId: string): Promise<NodeLike[]> {
  if (canvasId === 'default') {
    const doc = ctx.tryGet<DocLike>('doc')
    if (doc && typeof doc.getNodes === 'function') return doc.getNodes()
  }
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
async function writeUiHtml(
  ctx: ServerCtx,
  canvasId: string,
  nodeId: string,
  data: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string }> {
  if (canvasId === 'default') {
    const doc = ctx.tryGet<DocLike>('doc')
    if (doc && typeof doc.batchNodes === 'function') {
      try {
        const res = await doc.batchNodes({ update: [{ id: nodeId, data }] })
        if (!res.ok) return { ok: false, error: (res.errors ?? []).map((e) => e.message).join('; ') || '写入失败' }
        return { ok: true }
      } catch (err) {
        return { ok: false, error: '写入失败：' + String(err) }
      }
    }
  }
  // 非默认画布：宿主没给那张画布的 doc，只能自己读-改-写（只改这一个节点）。
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
function assetNameOf(url: string): string {
  const clean = (url || '').split('?')[0].split('#')[0]
  const at = clean.indexOf('/api/assets/files/')
  return at < 0 ? '' : clean.slice(at + '/api/assets/files/'.length)
}

/** 这张画布上现有的全部显示名（给「建进来的节点别撞名」用） */
async function canvasLabelsOf(ctx: ServerCtx, canvasId: string): Promise<string[]> {
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
function dedupeLabel(data: Record<string, unknown>, taken: string[]): Record<string, unknown> {
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
async function uiNodeOf(
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
async function addNodeToCanvas(

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
  if (canvasId === 'default') {
    const doc = ctx.tryGet<DocLike>('doc')
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
  }
  // 非默认画布：宿主没给那张画布的 doc，只能自己读-改-写（只追加）
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

/** 虚拟画布的 id 前缀：一眼看得出是「为调函数现造的」，也避开用户画布 id（那些不带这个前缀） */
const VIRTUAL_CANVAS_PREFIX = 'fn-probe-'

/** 虚拟画布里那个占位节点（脚本回写产物时会用到它的 id） */
const VIRTUAL_NODE_ID = 'probe'

/**
 * 造（或复用）一张**虚拟画布**，专供 canvas_fn_call 取返回值。
 *
 * ## 为什么要它（用户口径）
 *
 * 「调用时不需要外部传 Canvas ID / Node ID」——但脚本的 ctx 里本来就有这两个字段，
 * 脚本作者会拿它们拼"把结果写回画布"的地址。若不传，脚本里 `ctx.save(...)` 那条路会直接报错，
 * 于是"调用一下看它返回什么"这件事就做不成。
 *
 * 所以这里替调用方**造一个虚拟上下文**：一张固定 id 的空画布 + 一个占位节点。
 * 它落在数据目录里（和真画布同一种文件），但 id 带 `fn-probe-` 前缀 ——
 * 既不是用户列表里那些画布，也不会被 `canvas_list_canvases` 之外的东西误认。
 * 脚本即使真往里写了产物，也只是写进这张临时画布，**碰不到用户的任何画布**。
 *
 * 画布不存在就现建一张（幂等：第二次直接复用）。
 */
export async function ensureVirtualCanvas(ctx: ServerCtx): Promise<{ canvasId: string; nodeId: string }> {
  const store = ctx.tryGet<CanvasStoreLike>('canvasStore')
  const canvasId = VIRTUAL_CANVAS_PREFIX + 'default'
  if (store && typeof store.readCanvas === 'function') {
    const snap = await store.readCanvas(canvasId)
    if (!snap) {
      await store.writeCanvas(canvasId, {
        nodes: [{ id: VIRTUAL_NODE_ID, type: 'ui', position: { x: 0, y: 0 }, data: { label: '函数探针' } }],
        edges: [],
      })
    }
  }
  return { canvasId, nodeId: VIRTUAL_NODE_ID }
}

/**
 * 等一次调用跑完（轮询运行表，拿终态）。
 *
 * 为什么不用 SSE：MCP 工具是一次请求-响应，没有长连接可以推；
 * 运行表在**同一个进程**里（子进程的事件经 IPC 回来），所以直接轮询它最快也最稳。
 * 超时兜底：到点就返回当前状态（不卡住 MCP 调用），让调用方自己决定要不要再问。
 */
export async function waitRun(
  runId: string,
  timeoutMs: number,
): Promise<{ state: 'running' | 'done' | 'error' | 'cancelled'; result?: unknown; error?: string; tail: string[] }> {
  const runs = getTaskRuns()
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const run = runs.get(runId)
    if (!run) return { state: 'error', error: '这次调用找不到了：' + runId, tail: [] }
    if (run.state !== 'running') {
      return {
        state: run.state,
        ...(run.result === undefined ? {} : { result: run.result }),
        ...(run.error === undefined ? {} : { error: run.error }),
        tail: run.tail ?? [],
      }
    }
    if (Date.now() >= deadline) {
      return { state: 'running', tail: run.tail ?? [], error: '等超时了（还在跑）；可以稍后再查，或用 canvas_fn_list 看别的' }
    }
    await new Promise((r) => setTimeout(r, 120))
  }
}

export function apply(ctx: ServerCtx): void {
  // ① 「我是谁」：前端靠它拿后台真实地址（见 selfOrigin 的说明）
  ctx.routes.get('/api/node-ui/info', (c) => c.json({ ok: true, origin: selfOrigin(c) }))

  // ①.5 任务脚本：节点里那段 HTML 请求后台干活的那几条口（call / list / info / events / status / cancel）
  //
  //     目录解析：优先宿主上架的 taskScriptsDir；没有就按"server-plugins 的上一级"推
  //     （两者都挂在数据根下、并列）。**不在这里 mkdir**：目录不存在就是"一个脚本都没有"，
  //     list 回空数组即可；要加脚本的人自己往那儿放文件。
  //     （"放文件 = 能在服务器上跑代码"这件事写在 docs/plan/task-script-router-plan.md §七。）
  registerTaskRoutes(ctx, resolveTaskScriptsDir(ctx))

  // ①.6 节点包：把「这个节点 + 它依赖的脚本」打成一个文件（导出 / 收藏 / 拖回来）。
  //
  //      打包**只能在后台做**：脚本内容在服务器上，前端拿不到。
  //      宿主得给出两件事：读节点（getNode）与存资产（saveAsset）——
  //      少了哪一件都明确报错，不静默降级成"打个空包"。
  registerPackRoutes(ctx, resolveTaskScriptsDir(ctx), {
    // 宿主那份画布文档只有 read()（见 canvasDoc.ts）——按它取节点。
    // 第一版写成同步 getNode，真机上永远拿不到（2026-10-13 实测踩到）。
    //
    // ⚠️ 而且它**只管默认画布**：别的画布（用户在项目里建的那些）在它里面根本找不到，
    //    于是"导出画布 4 的节点"会直接 400「画布 X 上没有节点 Y」（2026-10-13 用户实测）。
    //    所以默认画布走 doc，其余走 canvasStore 快照 —— 与授权那条路的取法**保持一致**。
    getNode: async (canvasId, id) => {
      let raw: Record<string, unknown> | undefined
      if (canvasId === 'default') {
        const doc = ctx.tryGet<{
          read(): Promise<{ nodes?: Array<Record<string, unknown>> }>
        }>('doc')
        if (doc && typeof doc.read === 'function') {
          const snap = await doc.read()
          raw = (snap?.nodes ?? []).find((n) => String(n.id) === String(id))
        }
      }
      if (!raw) {
        const store = ctx.tryGet<{
          readCanvas(cid: string): Promise<{ nodes?: Array<Record<string, unknown>> } | undefined>
        }>('canvasStore')
        if (store && typeof store.readCanvas === 'function') {
          const snap = await store.readCanvas(canvasId)
          raw = (snap?.nodes ?? []).find((n) => String(n.id) === String(id))
        }
      }
      if (!raw) return undefined
      return {
        id: String(raw.id),
        type: String(raw.type ?? ''),
        ...(raw.position ? { position: raw.position as { x: number; y: number } } : {}),
        ...(raw.size ? { size: raw.size as { w: number; h: number } } : {}),
        ...(raw.data ? { data: raw.data as Record<string, unknown> } : {}),
      }
    },
    saveAsset: async (bytes, name, folderId) => {
      const store = ctx.tryGet<{
        saveUpload(
          bytes: Uint8Array,
          name: string,
          folderId?: string,
        ): Promise<{ id: string; name: string; url: string }>
      }>('assetStore')
      if (!store || typeof store.saveUpload !== 'function') throw new Error('宿主没有资产服务（assetStore）')
      return store.saveUpload(bytes, name, folderId)
    },
  })

  // ①.7 导入节点包：体检（会不会升版本）+ 落地（写脚本、还原节点）。
  //      落地**不弹确认**（用户 2026-10-13 口径），护栏靠同源 + 版本隔离
  //      （有冲突就整包升版本，绝不动本机已有的脚本）。
  registerImportRoutes(ctx, resolveTaskScriptsDir(ctx))

  // ② 给 AI 的手册（含这张画布现有的节点）
  ctx.mcp.tool({
    name: 'canvas_ui_guide',
    description:
      '读「怎么给可视化节点画界面」的手册：它是什么、内容写进哪、HTML 跑在什么环境、' +
      '必须遵守哪些约定、能调哪些接口。给可视化节点画东西之前**先调它**。' +
      '里面还有**实时**清单：这张画布的节点、这台机器上的脚本、以及前后端完整接口表。' +
      '用户一提「可视化节点 / ui 节点 / 面板 / 预览器」，第一个动作就应该是它。' +
      '⚠️ 别去翻项目源码（那是实现、随时会变；本手册是稳定契约）。' +
      '⚠️ 动手前先照手册第〇节**跟用户确认需求**（只展示还是要干活），别埋头就写。',
    input: { canvasId: 'string' },
    handler: async (args) => {
      const canvasId = typeof args.canvasId === 'string' && args.canvasId ? args.canvasId : 'default'
      let list = ''
      try {
        const nodes = await nodesOf(ctx, canvasId)
        const shown = nodes.slice(0, MAX_LISTED_NODES)
        list =
          '\n\n## 这块画布上有什么（canvasId = ' +
          canvasId +
          '，共 ' +
          nodes.length +
          ' 个节点）\n\n' +
          (shown.length ? shown.map(describeNode).join('\n') : '（空画布）') +
          (nodes.length > shown.length ? '\n…还有 ' + (nodes.length - shown.length) + ' 个' : '')
      } catch (err) {
        list = '\n\n（画布节点列表读取失败：' + String(err) + '）'
      }
      // 任务脚本的**实时清单**：AI 靠它知道「这台机器上现在能叫后台做什么」。
      // 每次现读目录（不缓存）：用户往 task-scripts 放一个文件，下一次读手册就该看得见。
      let tasks = ''
      try {
        const scripts = await listScripts(resolveTaskScriptsDir(ctx))
        tasks =
          '\n\n## 这台机器上的任务脚本（实时）\n\n' +
          formatScriptList(scripts) +
          '\n\n（要新动作 = 往 task-scripts 放一个 .mjs；脚本是用户写的，AI 只负责调。）'
      } catch (err) {
        tasks = '\n\n（任务脚本清单读取失败：' + String(err) + '）'
      }
      return { ok: true, guide: GUIDE + list + tasks }
    },
  })

  // ③ 写：把界面画进可视化节点（第一次画 / 重画都走它）
  ctx.mcp.tool({
    name: 'canvas_ui_write',
    description:
      '把一段自包含的 HTML 写进某个**可视化节点**（type = "ui"），节点里立刻渲染出来。' +
      '写之前先调 canvas_ui_guide 读手册（有必须遵守的约定），改之前可先 canvas_ui_read 看现状。' +
      'html 直接给代码本体，不用包 markdown 代码块。只写这一个节点，不动别的。',
    input: { canvasId: 'string', nodeId: 'string', html: 'string' },
    required: ['nodeId', 'html'],
    handler: async (args) => {
      const picked = await uiNodeOf(ctx, args)
      if (!picked.ok) return picked
      const { canvasId, nodeId, node } = picked
      const html = typeof args.html === 'string' ? args.html : ''
      if (!html.trim()) return { ok: false, error: '缺少 html（要写的界面内容）' }

      // 双保险（用户 2026-10-13 确认）：顺手扫一遍这段界面调了哪些脚本，补进节点声明。
      //
      // 为什么必须兜：AI 会忘写声明，忘了的后果是"界面画出来了、用户点一下 403"，
      // 而 AI 从画面上看不出哪里错 —— 那种坏法最难查。
      //
      // ⚠️ 声明必须并进**同一次写盘**。第一版让它自己去读 doc、再单独写一次 ——
      // 真机上那条路读不到东西，于是静默什么都不做（界面照写、返回值正常、声明空着）。
      // 现在：先问 plan（纯计算，拿 node.data 当输入），再和 uiHtml 一起交上去。
      const plan = await planDeclared(html, node.data?.[UI_SCRIPTS_KEY], resolveTaskScriptsDir(ctx), Date.now())
      const res = await writeUiHtml(ctx, canvasId, nodeId, {
        uiHtml: html,
        uiGeneratedAt: Date.now(),
        uiBy: 'mcp',
        ...(plan ? { [UI_SCRIPTS_KEY]: plan.next } : {}),
      })
      if (!res.ok) return { ok: false, error: res.error ?? '写入失败' }
      return {
        ok: true,
        nodeId,
        canvasId,
        bytes: html.length,
        // 把"我替你补了哪些"回给 AI —— 它下次就知道该自己写上（声明仍是它的责任）
        ...(plan ? { declaredScripts: plan.added } : {}),
      }
    },
  })

  // ③b 更新：**在现有 HTML 里做局部替换**（像改代码那样，不必整段重写）
  //
  //     为什么它不能被 canvas_batch_nodes 取代：那条只能整段替换 uiHtml 的值。
  //     而 AI 写完几百行 HTML 后想改一个 class，整段重写既费 token 又容易改坏别处。
  //     这里给 old / new 两个参数：old = 现在的片段，new = 改后的片段。
  ctx.mcp.tool({
    name: 'canvas_ui_update',
    description:
      '在可视化节点**现有的 HTML 里做局部替换**（改一小块，不必整段重写）。' +
      'old = 现在的代码片段（要原样、能在当前 HTML 里找到），new = 改后的片段。' +
      '例：old: "class=\\\"card\\\"" , new: "class=\\\"card card--big\\\""。' +
      'old 在当前 HTML 里找不到时会报错，并把当前内容的一小段回给你，方便你对着改。' +
      '整段重画用 canvas_ui_write；想先看现状用 canvas_ui_read。',
    input: { canvasId: 'string', nodeId: 'string', old: 'string', new: 'string' },
    required: ['nodeId', 'old'],
    handler: async (args) => {
      const oldText = typeof args.old === 'string' ? args.old : ''
      const newText = typeof args.new === 'string' ? args.new : ''
      if (!oldText) return { ok: false, error: '缺少 old（要改掉的现有代码片段）' }
      const picked = await uiNodeOf(ctx, args)
      if (!picked.ok) return picked
      const { canvasId, nodeId, node } = picked
      const html = typeof node.data?.uiHtml === 'string' ? node.data.uiHtml : ''
      if (!html) {
        return { ok: false, error: '这个节点还没有内容（还没画过）。整段画上去请用 canvas_ui_write。' }
      }

      // 数一数 old 出现几次：0 次要报错（并且把现状回一小段，让它知道该拿什么当 old）
      const count = html.split(oldText).length - 1
      if (count === 0) {
        return {
          ok: false,
          error: '当前 HTML 里找不到这段 old。下面是现在内容的前 800 个字符，照着它改 old 再试：\n' + html.slice(0, 800),
        }
      }
      // 出现多次：全换掉，并把次数报回去（AI 若只想换一处，就该把 old 写得更长更精确）
      const next = html.split(oldText).join(newText)
      // 同 canvas_ui_write：局部改也可能引入一次新的脚本调用（加了段 fetch），照样兜一下。
      // 声明与 uiHtml 并进**同一次写**（理由见上面那段注释）。
      const plan = await planDeclared(next, node.data?.[UI_SCRIPTS_KEY], resolveTaskScriptsDir(ctx), Date.now())
      const res = await writeUiHtml(ctx, canvasId, nodeId, {
        uiHtml: next,
        uiGeneratedAt: Date.now(),
        uiBy: 'mcp',
        ...(plan ? { [UI_SCRIPTS_KEY]: plan.next } : {}),
      })
      if (!res.ok) return { ok: false, error: res.error ?? '写入失败' }
      return {
        ok: true,
        nodeId,
        canvasId,
        replaced: count,
        bytes: next.length,
        ...(plan ? { declaredScripts: plan.added } : {}),
      }
    },
  })

  // ④ 读：改之前先看一眼现状
  ctx.mcp.tool({
    name: 'canvas_ui_read',
    description:
      '读某个可视化节点：现在渲染的 HTML、它的**功能说明书**（做什么 / 效果 / 输入 / 输出）、' +
      '以及它声明依赖的后台脚本。改之前先看一眼，避免把用户满意的东西改掉。' +
      'html 是空字符串 = 这个节点还没画过。',
    input: { canvasId: 'string', nodeId: 'string' },
    required: ['nodeId'],
    handler: async (args) => {
      const picked = await uiNodeOf(ctx, args)
      if (!picked.ok) return picked
      const { canvasId, nodeId, node } = picked
      const html = typeof node.data?.uiHtml === 'string' ? node.data.uiHtml : ''
      const doc = nodeDocOf(node.data)
      const declared = node.data?.[UI_SCRIPTS_KEY]
      return {
        ok: true,
        nodeId,
        canvasId,
        type: node.type,
        html,
        empty: !html,
        ...(doc ? { doc } : {}),
        docText: describeNodeDoc(doc),
        ...(declared && typeof declared === 'object' ? { scripts: Object.keys(declared) } : {}),
      }
    },
  })

  // ⑤ 打包：把「这个节点 + 它依赖的脚本」收成一个包，放进资产库。
  //
  //     为什么要给 AI 这个工具：它写完界面与脚本之后，成品就这样**收进库**，
  //     下一张画布可以直接拖出来用 —— 不必等人去点右键。
  //     导出成文件（下载）仍走右键：那是一次浏览器下载，MCP 表达不了。
  ctx.mcp.tool({
    name: 'canvas_ui_package',
    description:
      '把某个**可视化节点**连同它依赖的后台脚本打成一个包，收进资产库（之后可以从左侧资源库拖到任何画布复用）。' +
      '包名默认取节点标题，可用 name 指定；folderId 指定存进哪个资产文件夹（不传 = 个人资产库根）。' +
      '只会带**节点声明过的**脚本（data.uiScripts）；声明里列了但机器上没有的，会在 missing 里如实报出来。' +
      '前提：这个节点得有界面内容（先 canvas_ui_write）。' +
      '⚠️ 收藏前建议先 canvas_ui_describe 写功能说明书 —— 库里没有说明书的包，别人只能靠猜。',
    input: { canvasId: 'string', nodeId: 'string', name: 'string', folderId: 'string' },
    required: ['nodeId'],
    handler: async (args) => {
      const picked = await uiNodeOf(ctx, args)
      if (!picked.ok) return picked
      const { canvasId, nodeId, node } = picked

      // 与 HTTP 那条路共用同一份打包逻辑（避免"两条路各写一遍"）
      try {
        const { buildNodePack } = await import('./task/pack.js')
        const dir = resolveTaskScriptsDir(ctx)
        const built = await buildNodePack(
          { id: node.id, type: node.type, ...(node.data ? { data: node.data } : {}) },
          dir,
          Date.now(),
        )
        const store = ctx.tryGet<{
          saveUpload(bytes: Uint8Array, name: string, folderId?: string): Promise<{ id: string; name: string; url: string }>
        }>('assetStore')
        if (!store || typeof store.saveUpload !== 'function') return { ok: false, error: '宿主没有资产服务，存不进库' }
        const wantedName = typeof args.name === 'string' && args.name ? args.name : built.manifest.name
        const fileName = wantedName.endsWith('.mcnode') ? wantedName : wantedName + '.mcnode'
        const folderId = typeof args.folderId === 'string' && args.folderId ? args.folderId : undefined
        const asset = await store.saveUpload(built.bytes, fileName, folderId)
        return {
          ok: true,
          nodeId,
          canvasId,
          assetId: asset.id,
          name: asset.name,
          url: asset.url,
          scripts: Object.keys(built.manifest.scripts),
          ...(built.manifest.missing.length ? { missing: built.manifest.missing } : {}),
          bytes: built.bytes.length,
          // 顺手回报有没有说明书：没有的话提醒一句（收藏的意义就是给别人复用）
          ...(nodeDocOf(node.data)
            ? { doc: describeNodeDoc(nodeDocOf(node.data)) }
            : { warning: '这个节点还没写功能说明书（canvas_ui_describe）。收藏进库之后，别人只能看包名猜它是干什么的。' }),
        }
      } catch (err) {
        return { ok: false, error: '打包失败：' + (err instanceof Error ? err.message : String(err)) }
      }
    },
  })

  // ==================== 可视化节点：说明书 + 收藏可复用（用户 2026-10-14 口径）====================
  // ⑤b 导出到**本机下载目录**（用户口径 2026-10-14：「调试通过之后自动打包成一个 zip 文件，
  //     保存到默认的下载地址。不然的话，你的这个节点一删，后台就完全没有意义了，
  //     还要重新写 HTML 代码」）。
  //
  //     与 canvas_ui_package 的区别：那条是收进**资产库**（能在画布间拖），
  //     这条是落成**本机文件**（节点删了也能靠它恢复）。两条都该做，用途不同。
  ctx.mcp.tool({
    name: 'canvas_ui_export',
    description:
      '把某个**可视化节点**（界面 + 它依赖的后台脚本）打包成一个 .mcnode 文件，' +
      '**自动保存到本机下载目录**，返回值里给绝对路径。' +
      '用途：给"这个节点 + 它的后台"留一份可带走的存档 —— 节点删了、画布没了，都能从它原样恢复。' +
      '★ 前后端调通之后**建议收尾就调它**（用户点名要的）。' +
      '同名文件已存在时不会覆盖，自动加 " (2)" 这样的后缀（旧那份是用户的保命符）。' +
      '想同时收进资产库（之后能从左侧资源库拖到别的画布）就再调 canvas_ui_package。' +
      '前提：这个节点得有界面内容（先 canvas_ui_write）。',
    input: { canvasId: 'string', nodeId: 'string', name: 'string' },
    required: ['nodeId'],
    handler: async (args) => {
      const picked = await uiNodeOf(ctx, args)
      if (!picked.ok) return picked
      const { canvasId, nodeId, node } = picked
      try {
        const { buildNodePack } = await import('./task/pack.js')
        const dir = resolveTaskScriptsDir(ctx)
        const built = await buildNodePack(
          { id: node.id, type: node.type, ...(node.data ? { data: node.data } : {}) },
          dir,
          Date.now(),
        )
        const wanted = typeof args.name === 'string' && args.name ? args.name : built.manifest.name
        const saved = await saveToDownloads(built.bytes, wanted + PACK_EXT)
        return {
          ok: true,
          nodeId,
          canvasId,
          path: saved.path,
          dir: saved.dir,
          fileName: saved.fileName,
          bytes: saved.bytes,
          scripts: Object.keys(built.manifest.scripts),
          ...(built.manifest.missing.length ? { missing: built.manifest.missing } : {}),
          note:
            '已保存到下载目录：' + saved.path +
            '（节点删了也能从这个文件恢复；要能拖到别的画布用，再调一次 canvas_ui_package 收进资产库）',
        }
      } catch (err) {
        return { ok: false, error: '导出失败：' + (err instanceof Error ? err.message : String(err)) }
      }
    },
  })

  //
  // 用户原话：「每个可视化节点要有详细的功能描述，包括它自己的输入和输出」、
  // 「列出收藏的可视化节点」、「把收藏的可视化节点加到画布、建成节点」、
  // 「查这些节点各自能干什么（功能说明 + 输入 + 输出）」。
  //
  // 落点：说明书写在**节点 data 里**（键 NODE_DOC_KEY），随节点包一起走 ——
  // 收藏进库时进包、从库建节点时随节点还原、上面那些工具直接读它。

  // ⑥ 写说明书：把「这个节点是做什么的、要什么输入、给什么输出」写到节点上
  ctx.mcp.tool({
    name: 'canvas_ui_describe',
    description:
      '给一个**可视化节点**写功能说明书（它做什么 / 功能效果 / 输入参数 / 输出或影响）。' +
      '这份说明书会跟着节点包一起被收藏进资产库 —— 别人（和别的 Agent）从库里挑节点时，' +
      '看的就是这几句。**收藏之前建议先写它**，否则库里只有一堆看不懂的包名。' +
      'what 是必填的那一句。输入输出各给一个 **JSON 字符串**（这套参数表只收字符串）：' +
      'inputsJson 例如 \'["参考图", "列数"]\' 或 \'[{"name":"列数","type":"number","desc":"几列"}]\'；' +
      'outputsJson 同理。只写这一个节点，不动别的。',
    // ⚠️ inputsJson / outputsJson 走**JSON 字符串**而不是数组：插件的 MCP 参数简表只认
    //    string / number / boolean（见 serverFramework/mcp.ts 的说明），数组传不进来 ——
    //    写成字符串是这套朴素 schema 下唯一能让复杂结构过关的形态（与 canvas_fn_call 的 argsJson 同一条）。
    input: {
      canvasId: 'string',
      nodeId: 'string',
      what: 'string',
      effect: 'string',
      inputsJson: 'string',
      outputsJson: 'string',
    },
    required: ['nodeId', 'what'],
    handler: async (args) => {
      const what = typeof args.what === 'string' ? args.what.trim() : ''
      if (!what) return { ok: false, error: '缺少 what（这个节点是做什么的，一句话）' }
      const picked = await uiNodeOf(ctx, args)
      if (!picked.ok) return picked
      const { canvasId, nodeId, node } = picked

      // 四件事摊平收：inputs / outputs 收「一行字」或「{name,type,desc}」两种写法（见 nodeDoc.ts）
      const doc: Record<string, unknown> = { what }
      const effect = typeof args.effect === 'string' ? args.effect.trim() : ''
      if (effect) doc.effect = effect
      for (const [key, field] of [
        ['inputsJson', 'inputs'],
        ['outputsJson', 'outputs'],
      ] as const) {
        const raw = typeof args[key] === 'string' ? args[key].trim() : ''
        if (!raw) continue
        try {
          doc[field] = JSON.parse(raw)
        } catch (err) {
          return { ok: false, error: key + ' 不是合法 JSON：' + (err instanceof Error ? err.message : String(err)) }
        }
      }

      const res = await writeUiHtml(ctx, canvasId, nodeId, { [NODE_DOC_KEY]: doc })
      if (!res.ok) return { ok: false, error: res.error ?? '写入失败' }
      return { ok: true, nodeId, canvasId, doc: nodeDocOf({ [NODE_DOC_KEY]: doc }) }
    },
  })

  // ⑦ 列收藏的可视化节点（资产库里的节点包），带上各自的功能说明
  ctx.mcp.tool({
    name: 'canvas_ui_favorites',
    description:
      '列出**资产库里收藏的可视化节点**（节点包 .mcnode），每个带上它的功能说明书' +
      '（做什么 / 效果 / 输入 / 输出）与包里的脚本清单。' +
      '用它来回答「有哪些收藏的节点可以复用」，或者照着挑一个用 canvas_ui_add_favorite 建到画布上。' +
      'keyword 可以按名字 / 说明过滤。',
    input: { keyword: 'string' },
    handler: async (args) => {
      const store = ctx.tryGet<AssetStoreLike>('assetStore')
      if (!store || typeof store.list !== 'function') return { ok: false, error: '宿主没有资产服务，读不了收藏' }
      const keyword = typeof args.keyword === 'string' ? args.keyword.trim() : ''
      const all = await store.list()
      const packs = all.filter((a) => a.kind === 'node-package')
      const readOne = ctx.tryGet<{ readFile?(n: string): Promise<Uint8Array | undefined> }>('assetStore')
      const items: Array<Record<string, unknown>> = []
      for (const a of packs) {
        let doc: string | undefined
        let scripts: string[] = []
        try {
          const bytes = readOne?.readFile ? await readOne.readFile(assetNameOf(a.url)) : undefined
          if (bytes) {
            const pack = readNodePack(bytes)
            doc = describeNodeDoc(nodeDocOf(pack.node.data))
            scripts = Object.keys(pack.scripts)
          }
        } catch {
          // 读不出来（老包 / 坏包）：照样列出来，只是不带说明书 —— 藏起来更糟
        }
        const hit = !keyword || a.name.includes(keyword) || (doc ? doc.includes(keyword) : false)
        if (!hit) continue
        items.push({
          assetId: a.id,
          name: a.name,
          url: a.url,
          ...(a.folderId ? { folderId: a.folderId } : {}),
          ...(scripts.length ? { scripts } : {}),
          ...(doc ? { doc } : { doc: '（这个包没写说明书：不知道它是做什么的）' }),
        })
      }
      return {
        ok: true,
        total: packs.length,
        shown: items.length,
        favorites: items,
        // 这条提示原先写"它自己会开一张虚拟画布取数据"——**是错的**：虚拟画布只有
        // canvas_fn_call 用（脚本的 ctx 要 canvasId/nodeId 才拼得出回写地址），
        // 建收藏节点走的是真实目标画布，只需要给它画布 id（不传 = 默认画布）。
        // 照错的那句办事，AI 会等一个不会发生的行为（审查发现）。
        hint: '用 canvas_ui_add_favorite 把其中某一个建到画布上（给 name 或 url 指定是哪个；canvasId 不传就是默认画布）',
      }
    },
  })

  // ⑧ 把收藏的节点建成节点（落到指定画布；不传 canvasId 就落到默认画布）
  ctx.mcp.tool({
    name: 'canvas_ui_add_favorite',
    description:
      '把**资产库里收藏的可视化节点**（节点包）建成画布上的一个节点。' +
      '传 url（canvas_ui_favorites 给的）或者 name（包名）来指定是哪一个。' +
      '建之前会先把包里的脚本写到服务器（有同名不同内容的脚本就整包升版本，不动本机已有的），' +
      '然后把节点数据（含界面与依赖声明）还原到画布上。' +
      '返回建出来的 nodeId —— 之后就能用 canvas_ui_read / canvas_ui_write 改它。',
    input: { url: 'string', name: 'string', canvasId: 'string', positionX: 'number', positionY: 'number' },
    handler: async (args) => {
      const store = ctx.tryGet<AssetStoreLike>('assetStore')
      if (!store || typeof store.list !== 'function') return { ok: false, error: '宿主没有资产服务，读不了收藏' }
      const url = typeof args.url === 'string' ? args.url.trim() : ''
      const name = typeof args.name === 'string' ? args.name.trim() : ''
      if (!url && !name) return { ok: false, error: '要指定建哪一个：给 url（canvas_ui_favorites 的 url）或 name（包名）' }
      const packs = (await store.list()).filter((a) => a.kind === 'node-package')
      const asset = url ? packs.find((a) => a.url === url) : packs.find((a) => a.name === name || a.name.replace(/\.mcnode$/i, '') === name)
      if (!asset) {
        return {
          ok: false,
          error: '收藏里没有这一项：' + (url || name) + '（现有：' + (packs.map((p) => p.name).join('、') || '一个都没有') + '）',
        }
      }
      const bytes = await store.readFile?.(assetNameOf(asset.url))
      if (!bytes) return { ok: false, error: '取不到这个包的字节：' + asset.url }

      const canvasId = typeof args.canvasId === 'string' && args.canvasId ? args.canvasId : 'default'
      const dir = resolveTaskScriptsDir(ctx)
      let pack
      try {
        pack = readNodePack(bytes)
      } catch (err) {
        return { ok: false, error: '这个包读不出来：' + (err instanceof Error ? err.message : String(err)) }
      }

      // 落地：与「拖包进画布」同一条路（写脚本 → 算好节点数据）
      let plan
      try {
        plan = await planImport(pack, dir)
      } catch (err) {
        return { ok: false, error: '算导入计划失败：' + (err instanceof Error ? err.message : String(err)) }
      }
      const written: string[] = []
      try {
        await fs.mkdir(dir, { recursive: true })
        for (const w of plan.write) {
          const abs = resolveScriptPath(dir, w.name)
          if (!abs) throw new Error('脚本名不合法：' + w.name)
          await fs.writeFile(abs, w.text, 'utf8')
          written.push(w.name)
        }
      } catch (err) {
        return { ok: false, error: '写脚本失败：' + (err instanceof Error ? err.message : String(err)), written }
      }

      // 建节点：走宿主那份有写锁的画布文档（与网页端 / AI 的写排成一条链）
      const x = typeof args.positionX === 'number' ? args.positionX : undefined
      const y = typeof args.positionY === 'number' ? args.positionY : undefined
      const nodeType = String((pack.node as { type?: unknown }).type ?? 'ui')
      const res = await addNodeToCanvas(ctx, canvasId, {
        type: nodeType,
        data: plan.data as Record<string, unknown>,
        ...(x !== undefined && y !== undefined ? { position: { x, y } } : {}),
      })
      if (!res.ok) return { ok: false, error: res.error }
      return {
        ok: true,
        canvasId,
        nodeId: res.id,
        name: asset.name,
        action: plan.action,
        ...(plan.version === undefined ? {} : { version: plan.version }),
        written,
        skipped: plan.skip,
        doc: describeNodeDoc(nodeDocOf(plan.data)),
      }
    },
  })

  // ==================== 后台功能函数：列出 / 查 / 调用（用户 2026-10-14 口径）====================
  //
  // 用户原话：「梳理每个可视化节点可能导出的后台接口或扩展工具函数」，写清
  // 「工具做什么 / 输入参数有哪些 / 返回结果是什么 / 调用示例」，并且
  // 「MCP 可直接调用这些后台接口；调用时不需要外部传 Canvas ID / Node ID」；
  // 另要「列出所有功能函数」「调用指定功能函数」「可选：查询参数与返回值 schema」。
  //
  // 关于「不传 Canvas ID / Node ID」：脚本的 ctx 里本来要这两个（用来回写画布）。
  // 既然调用方不必提供，就由这里**造一张虚拟画布**顶上（见 virtualContext）——
  // 虚拟画布的 id 固定带前缀，与用户真实画布不冲突，也不会污染任何真画布。
  //
  // 关于「要不要声明依赖」：`/api/task/call` 那道 403 是给**节点界面**设的（防界面乱调机器上的脚本）。
  // 这里的调用方是 Agent 本人（MCP），它要的是「跑一下看返回什么」，没有节点可声明 ——
  // 所以直接走 runScript（与路由同一个执行体）而不过那道校验。**这不是绕过权限**：
  // 能调 MCP 的人本来就能读画布、能建节点、能调生成；脚本清单本来就是给 Agent 发现的
  // （见 canvas_fn_list）。护栏仍在两处：脚本名白名单 + 跑在虚拟画布上。

  // ⑨ 列出全部功能函数（脚本 × 函数 × 说明书）
  ctx.mcp.tool({
    name: 'canvas_fn_list',
    description:
      '列出**这台机器上所有能调的后台功能函数**（task-scripts 里每个脚本导出的每个函数）。' +
      '每个函数带上它的说明书：做什么 / 参数 / 返回 / 示例（作者写了才有；没写会标出来）。' +
      '用它来回答「有哪些后台能力可以用」，或者照着挑一个用 canvas_fn_call 调。' +
      'keyword 可按脚本名 / 函数名 / 说明过滤。',
    input: { keyword: 'string' },
    handler: async (args) => {
      const dir = resolveTaskScriptsDir(ctx)
      const all = await listFunctions(dir)
      // 在建脚本（下划线打头）不进上面的清单 —— 但要让作者知道它们**存在**且没验完，
      // 否则他会以为自己的脚本没了。见 guide 的 0.3 那三条约定。
      const drafts = await listDraftScripts(dir)
      const keyword = typeof args.keyword === 'string' ? args.keyword.trim() : ''
      const hit = keyword
        ? all.filter((f) => f.script.includes(keyword) || f.fn.includes(keyword) || (f.what ?? '').includes(keyword))
        : all
      return {
        ok: true,
        total: all.length,
        shown: hit.length,
        functions: hit,
        text: hit.length ? hit.map(describeFunction).join('\n') : '（没有匹配的功能函数）',
        // 在建脚本单独报一句：它们不在上面那份清单里，但确实存在（作者要知道）
        ...(drafts.length
          ? {
              drafts: drafts.map((x) => x.name),
              draftHint:
                '这些是**在建脚本**（文件名下划线打头、未验证），故意不进上面的可用清单：' +
                drafts.map((x) => x.name + '（可调：' + (x.methods.join('、') || '没有导出函数') + '）').join('；') +
                '。要测它们就把名字直接传给 canvas_fn_call（带下划线即可）；跑通了把下划线去掉，它就成了可用脚本。',
            }
          : {}),
        // 「没写说明书」不该只是一句抱怨 —— 给出**照着能改**的做法（用户口径要「给例子」）。
        // 说明书由**脚本作者**写在脚本里（AI 改不了服务器上的文件），所以这句是写给"用户/作者"看的。
        ...(hit.some((f) => !f.what)
          ? {
              missingDocs: hit.filter((f) => !f.what).map((f) => f.script + '.' + f.fn),
              howToAddDocs:
                '想让上面这些函数也带上说明（做什么 / 参数 / 返回 / 示例），在脚本里 export 一个 docs 对象即可，' +
                '照 <数据根>/task-scripts/demo.mjs 那份抄（它每一行都有注释）：' +
                'export const docs = { run: { what: "...", args: [{ name: "width", type: "number", required: true, desc: "..." }], returns: "...", example: "run(640)" } }',
            }
          : {}),
      }
    },
  })

  // ⑩ 查一个函数的参数与返回值（「可选：查询功能函数的参数与返回值 schema」）
  ctx.mcp.tool({
    name: 'canvas_fn_info',
    description:
      '查某个后台功能函数的详情：它做什么、输入参数有哪些（名字 / 类型 / 是否必填 / 说明）、' +
      '返回什么、怎么调用（示例）。给 script（脚本名）与 fn（函数名）。' +
      '说明文字来自脚本作者写的 docs；没写就只能列出参数名（按真实导出）。',
    input: { script: 'string', fn: 'string' },
    required: ['script'],
    handler: async (args) => {
      const dir = resolveTaskScriptsDir(ctx)
      const script = typeof args.script === 'string' ? args.script.trim() : ''
      const fn = typeof args.fn === 'string' ? args.fn.trim() : ''
      if (!script) return { ok: false, error: '缺少 script（脚本名，不带 .mjs）' }
      const docs = await scriptDocs(dir, script)
      const methods = await scriptMethods(resolveTaskScriptsDir(ctx), script)
      if (!methods) return { ok: false, error: '拿不到脚本的方法（不存在 / 加载失败）：' + script }
      if (!fn) {
        return { ok: true, script, functions: methods.map((m) => ({ fn: m, ...(docs[m] ?? {}) })) }
      }
      if (!methods.includes(fn)) {
        return {
          ok: false,
          error: '脚本 ' + script + ' 里没有导出函数 ' + fn + '（可用的：' + methods.join('、') + '）',
        }
      }
      return { ok: true, script, fn, ...(docs[fn] ?? {}), args: docs[fn]?.args ?? [] }
    },
  })

  // ⑪ 调用指定功能函数（**不必传 Canvas ID / Node ID**）
  ctx.mcp.tool({
    name: 'canvas_fn_call',
    description:
      '直接调用一个**后台功能函数**（task-scripts 里的 script.fn），把结果拿回来。' +
      'args 是位置参数数组（按 canvas_fn_info 给的顺序）；wait 缺省为真 = 等它跑完并回结果。' +
      '**不需要传 Canvas ID / Node ID** —— 这类函数要它们只是为了"回写画布"，' +
      '而这里由工具自己造一张虚拟画布顶上，专门给你取返回值用。' +
      '先 canvas_fn_list / canvas_fn_info 看清参数与返回，再来调。' +
      '★ script 允许**下划线打头**：那是在建脚本（还没验证），这样你才能测自己刚写的那份；' +
      '测通过之后把下划线去掉，它才会出现在 canvas_fn_list 里给别人用。',
    input: { script: 'string', fn: 'string', argsJson: 'string', wait: 'boolean', timeoutMs: 'number' },
    required: ['script', 'fn'],
    handler: async (args) => {
      const script = typeof args.script === 'string' ? args.script.trim() : ''
      const fn = typeof args.fn === 'string' ? args.fn.trim() : ''
      if (!script) return { ok: false, error: '缺少 script（脚本名，不带 .mjs）' }
      if (!fn) return { ok: false, error: '缺少 fn（要调的函数名）' }
      let callArgs: unknown[] = []
      if (typeof args.argsJson === 'string' && args.argsJson.trim()) {
        try {
          const parsed = JSON.parse(args.argsJson)
          if (!Array.isArray(parsed)) return { ok: false, error: 'argsJson 必须是 JSON 数组，例如 "[640, \"x.png\"]"' }
          callArgs = parsed
        } catch (err) {
          return { ok: false, error: 'argsJson 不是合法 JSON：' + (err instanceof Error ? err.message : String(err)) }
        }
      }
      const dir = resolveTaskScriptsDir(ctx)
      const methods = await scriptMethods(dir, script)
      if (!methods) return { ok: false, error: '拿不到脚本的方法（不存在 / 加载失败）：' + script }
      if (!methods.includes(fn)) {
        return { ok: false, error: '脚本 ' + script + ' 里没有导出函数 ' + fn + '（可用的：' + methods.join('、') + '）' }
      }
      // 虚拟画布上下文：见文件末尾 virtualContext 的说明（不碰任何真画布）
      const vctx = await ensureVirtualCanvas(ctx)
      const wait = args.wait !== false
      const timeoutMs = typeof args.timeoutMs === 'number' && args.timeoutMs > 0 ? args.timeoutMs : undefined
      const started = await runScript({
        dir,
        name: script,
        methods: fn,
        args: callArgs,
        canvasId: vctx.canvasId,
        nodeId: vctx.nodeId,
        baseUrl: ctx.tryGet<string>('selfOrigin') ?? '',
        dataRoot: ctx.tryGet<{ dataRoot?(): string }>('canvasStore')?.dataRoot?.() ?? '',
        ...(timeoutMs === undefined ? {} : { timeoutMs }),
      })
      if (!started.ok) return { ok: false, error: started.error }
      if (!wait) return { ok: true, runId: started.run.runId, state: started.run.state, canvasId: vctx.canvasId, nodeId: vctx.nodeId }
      // 等待比脚本自己的超时**多留 5 秒**：脚本超时那一刻会由它的超时器收成 error 并落进运行表，
      // 擦边相等的话我们会先一步判成「还在跑」，把它自己的报错盖掉（报出来的就成了「等超时了」）。
      const scriptTimeout = timeoutMs ?? 10 * 60 * 1000
      const final = await waitRun(started.run.runId, scriptTimeout + 5000)
      return {
        ok: final.state === 'done',
        script,
        fn,
        // 在建脚本（下划线打头）如实标出来：这次是"作者在测自己的东西"，不是"用了别人的成品"
        ...(isDraftScriptName(script)
          ? {
              draft: true,
              draftNote:
                '这次调的是**在建脚本**（下划线打头、还没验证）。跑通之后把 ' + script + '.mjs 改名为 ' +
                script.slice(1) + '.mjs，它才会进 canvas_fn_list 的可用清单。',
            }
          : {}),
        ...(final.state === 'error' ? { error: final.error } : { result: final.result }),
        logs: final.tail.slice(-20),
        state: final.state,
        virtualCanvasId: vctx.canvasId,
        note: '这次调用跑在一张虚拟画布上（只为取返回值）；产物写在它名下，不碰你的画布。',
      }
    },
  })

  // ==================== 调试连接（用户 2026-10-15 定的邀请制）====================
  //
  // 要解决的问题：Agent 想调试一个可视化节点的**运行实例**（读变量、执行脚本），
  // 而同一张画布可能开着多个标签页 —— 必须让用户选一个，且后续重连认的还是同一个。
  //
  // 职责划分（与 debugSession.ts 的注释同口径）：
  //   · 后台（这两个工具）：放邀请标记 / 收回执并记住「谁被选中」；不碰 HTML。
  //   · 前端（UiContent）：看到标记弹确认框；被点中的标签页写 sessionStorage 凭据、
  //     回执、清标记、进调试态（iframe 注入 SDK、拦截刷新）。
  //
  // 为什么 SDK 连接走 WebSocket 而后台不发 HTTP 给页面：页面在沙箱 iframe 里，
  // 后台无法直接叫它 —— 只能由页面里的 SDK 主动拨过来（浏览器安全的常识约束）。
  // 所以这里只「留名字」：连接建立后 SDK 报 hello（session / canvasId / nodeId），
  // 后台按名字认识它。

  /** 当前挂着的调试会话（每张画布同时最多一个 —— 调试是独占动作） */
  const debugSessions = new Map<string, { session: string; nodeId: string }>()

  /**
   * eval 执行通道（SSE 下行 + HTTP POST 上行）。
   *
   * 为什么不是 WebSocket：cloud-server 没有 WS 设施，外挂插件也拿不到 http server 挂
   * upgrade 监听；SSE 项目里已有成熟先例（任务日志 watchRun）。SDK 脚本里 EventSource
   * 拨号到 debug-events，后台把 eval 任务塞进 pending 表；执行结果从 debug-result 回来，
   * 由 waiter 的 resolve 送回 MCP 调用方。stop 同理：挂一个 promise，disconnect 时 resolve。
   */
  type DebugEval = { id: string; code: string }
  type DebugWaiter = { resolve: (v: { ok: boolean; result?: unknown; error?: string; stopped?: boolean }) => void }
  const debugEvals = new Map<string, DebugEval[]>() // session → 未被 SDK 取走的 eval 队列
  const debugSse = new Map<string, (e: DebugEval | { type: 'stop' }) => void>() // session → SSE 投递口
  const debugResults = new Map<string, DebugWaiter>() // evalId → 等结果的 resolve
  const debugStops = new Map<string, DebugWaiter>() // session → 等 disconnect 的 resolve
  let debugEvalSeq = 0

  // ⑫ 发起调试连接：在节点上放邀请标记，等用户在某个标签页上确认
  ctx.mcp.tool({
    name: 'canvas_ui_connect',
    description:
      '对某个可视化节点发起**调试连接**（临时状态，不改节点 HTML）。' +
      '调用后，所有打开这张画布的标签页都会弹一个确认对话框；用户点中哪个标签页，' +
      '调试链接就建在哪个标签页的节点实例上（多标签页只认被点中的那一个）。' +
      '用户确认后用 canvas_ui_debug_eval 在这个连接里执行脚本；' +
      '调试完用 canvas_ui_disconnect 断开。连接只对**当前开着画布页面**的节点有效，' +
      '页面没开 / 用户没确认都会让它一直挂着（返回里给了 session，可再次 connect 重发邀请）。',
    input: { canvasId: 'string', nodeId: 'string' },
    required: ['nodeId'],
    handler: async (args) => {
      const picked = await uiNodeOf(ctx, args)
      if (!picked.ok) return picked
      const { canvasId, nodeId } = picked
      const session = newSessionId()
      // 邀请写成**合并**进 data（batchNodes 的 update 是浅合并）：只添这一个字段，
      // 不碰 uiHtml / uiInputs 等既有字段 —— 这是「临时状态」与「重写内容」的根本区别。
      const res = await writeUiHtml(ctx, canvasId, nodeId, {
        [UI_DEBUG_INVITE_KEY]: { session, at: Date.now() },
      })
      if (!res.ok) return { ok: false, error: res.error ?? '放邀请标记失败' }
      debugSessions.set(canvasId, { session, nodeId })
      return {
        ok: true,
        canvasId,
        nodeId,
        session,
        hint: '邀请已发出：打开这张画布的每个标签页都会弹确认框，用户点中哪个就用哪个。' +
          '用户确认后，前端会清掉邀请标记并连上后台（WebSocket hello 带 session）。' +
          '如果标签页上没弹框，检查画布页面是否开着。',
      }
    },
  })

  // ⑬ 收回执：前端把「用户点了哪个标签页」报上来
  ctx.routes.post('/api/node-ui/debug-accept', async (c) => {
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ ok: false, error: '请求体不是合法 JSON' }, 400)
    }
    const accept = body as DebugAcceptPayload | undefined
    if (!accept || typeof accept.session !== 'string' || typeof accept.nodeId !== 'string' || typeof accept.canvasId !== 'string') {
      return c.json({ ok: false, error: '缺少 session / nodeId / canvasId' }, 400)
    }
    // 回执必须配得上当前邀请：邀请没了（前端已清）或对不上号都拒绝。
    // 为什么查节点 data 而不是内存 Map：Map 只在**这个**后台进程里，而邀请标记在
    // 画布数据里（后台重启也能恢复判断）—— 用同一份事实，别养两套。
    const node = (await nodesOf(ctx, accept.canvasId)).find((n) => String(n.id) === accept.nodeId)
    const invite = readInvite(node?.data)
    if (!isAcceptMatching(invite, accept)) {
      return c.json({ ok: false, error: '回执与当前邀请不匹配（可能已被确认过或已过期）' }, 409)
    }
    // 邀请标记落盘清除（前端只是 updateNodeRuntime——不落盘，刷新后标记会复活）。
    // 必须在记会话之前清：标记在 = 邀请还挂着，清掉才是「已被认领」的语义。
    await writeUiHtml(ctx, accept.canvasId, accept.nodeId, { [UI_DEBUG_INVITE_KEY]: null })
    // 记下被选中的标签页：后续 eval 只对它生效（eval 找的是 SSE 通道里的 session）
    debugSessions.set(accept.canvasId, { session: accept.session, nodeId: accept.nodeId })
    return c.json({ ok: true, wsPath: '/api/node-ui/debug-events', session: accept.session })
  })

  // SSE 下行通道：SDK 脚本拨进来，等 eval / stop。
  ctx.routes.get('/api/node-ui/debug-events', (c) => {
    const session = c.req.query?.('session') ?? ''
    const owning = [...debugSessions.entries()].find(([, s]) => s.session === session)
    if (!session || !owning) {
      return c.json({ ok: false, error: '未知调试会话' }, 404)
    }
    // 手写 SSE 流（外挂插件产物零第三方依赖：不 import hono/streaming）。
    // 格式：每条事件一行 data: <json> + 空行；每 20 秒一行注释帧保活。
    const encoder = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        let closed = false
        let ping: ReturnType<typeof setInterval> | undefined
        const send = (text: string): void => {
          if (closed) return
          try { controller.enqueue(encoder.encode(text)) } catch { closed = true }
        }
        const teardown = (): void => {
          if (closed) return
          closed = true
          if (ping !== undefined) clearInterval(ping)
          debugSse.delete(session)
          try { controller.close() } catch { /* 已关 */ }
        }
        const push = (e: DebugEval | { type: 'stop' }): void => {
          send('data: ' + JSON.stringify(e) + '\n\n')
          if ('type' in e && e.type === 'stop') {
            // stop 发完就收流：SDK 的 fetch 流读到的 done 会自然结束重连循环
            setTimeout(teardown, 50)
          }
        }
        // 重连恢复：把还没取走的 eval 立刻补发一遍
        const backlog = debugEvals.get(session) ?? []
        for (const e of backlog) push(e)
        debugEvals.set(session, [])
        debugSse.set(session, push)
        // 保活 + 最长存活：调试会话不该无限挂着（长流会把 CDP/代理拖死）
        ping = setInterval(() => send(': ping\n\n'), 20_000)
        setTimeout(teardown, 15 * 60_000)
        // 请求中断（页签关闭 / SDK 重连）时清理
        const raw = (c as unknown as { req: { raw?: Request } }).req.raw
        raw?.signal?.addEventListener('abort', teardown)
      },
    })
    return new Response(body, {
      headers: {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      },
    })
  })

  // 上行回包：SDK 执行完 eval 从这里交结果
  ctx.routes.post('/api/node-ui/debug-result', async (c) => {
    let body: unknown
    try { body = await c.req.json() } catch { return c.json({ ok: false, error: '请求体不是合法 JSON' }, 400) }
    const m = body as { session?: unknown; id?: unknown; ok?: unknown; result?: unknown; error?: unknown } | null
    if (!m || typeof m.id !== 'string') return c.json({ ok: false, error: '缺少 id' }, 400)
    const waiter = debugResults.get(m.id)
    if (!waiter) return c.json({ ok: false, error: '没有在等的 eval（可能已超时）' }, 404)
    debugResults.delete(m.id)
    waiter.resolve({
      ok: m.ok === true,
      ...(m.ok === true ? { result: m.result } : { error: typeof m.error === 'string' ? m.error : '执行失败' }),
    })
    return c.json({ ok: true })
  })

  // ⑭ 在调试连接里执行一段脚本（eval）
  ctx.mcp.tool({
    name: 'canvas_ui_debug_eval',
    description:
      '在**已建立的调试连接**里执行一段 JavaScript（跑在用户确认过的那个标签页的节点 iframe 里，' +
      '与页面同上下文：能读 window、DOM、页面里的变量），把结果或报错拿回来。' +
      '前提：先 canvas_ui_connect 且用户已在某个标签页上确认。结果不能结构化克隆的部分会被 JSON 化。',
    input: { canvasId: 'string', code: 'string' },
    required: ['canvasId', 'code'],
    handler: async (args) => {
      const canvasId = typeof args.canvasId === 'string' && args.canvasId ? args.canvasId : 'default'
      const code = typeof args.code === 'string' ? args.code : ''
      if (!code.trim()) return { ok: false, error: '缺少 code（要执行的 JavaScript）' }
      const sess = debugSessions.get(canvasId)
      if (!sess) return { ok: false, error: '这张画布没有挂着的调试会话：先 canvas_ui_connect' }
      const push = debugSse.get(sess.session)
      if (!push) return { ok: false, error: '标签页的 SDK 还没连上（确认对话框被点了吗？页面开着吗？）' }
      const id = 'e' + ++debugEvalSeq
      const result = await new Promise<{ ok: boolean; result?: unknown; error?: string; stopped?: boolean }>((resolve) => {
        debugResults.set(id, { resolve })
        push({ id, code })
        // 30 秒兜底：SDK 挂了不该让 MCP 调用永远挂着
        setTimeout(() => {
          if (debugResults.has(id)) {
            debugResults.delete(id)
            resolve({ ok: false, error: '执行超时（30 秒没等到回包）' })
          }
        }, 30_000)
      })
      if (result.stopped) return { ok: false, error: '调试会话已被断开' }
      return result.ok ? { ok: true, result: result.result } : { ok: false, error: result.error ?? '执行失败' }
    },
  })

  // ⑮ 断开调试连接：给 SDK 发 stop，等它收线；清会话
  ctx.mcp.tool({
    name: 'canvas_ui_disconnect',
    description:
      '断开某个可视化节点的**调试连接**（canvas_ui_connect 建立的）。节点数据不动、' +
      '页面不动 —— 只是停掉执行通道。断开后 sessionStorage 里的凭据由前端在组件卸载时清。',
    input: { canvasId: 'string' },
    handler: async (args) => {
      const canvasId = typeof args.canvasId === 'string' && args.canvasId ? args.canvasId : 'default'
      const sess = debugSessions.get(canvasId)
      if (!sess) return { ok: false, error: '这张画布没有挂着的调试会话' }
      const push = debugSse.get(sess.session)
      push?.({ type: 'stop' })
      // 等 stop 送达（最多 2 秒）再清，避免 SDK 还挂着就丢队列
      await new Promise((r2) => setTimeout(r2, 300))
      debugSessions.delete(canvasId)
      debugEvals.delete(sess.session)
      debugStops.delete(sess.session)
      return { ok: true, canvasId, note: '调试连接已断开。' }
    },
  })
}











