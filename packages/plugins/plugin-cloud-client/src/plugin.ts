// plugin-cloud-client 主体 —— 与 cloud-server 对接的唯一前端插件。
//
// 它把四件事并在一起（都是"连后台"这一类，合并后共用一条 SSE）：
//   1. 画布存档 + 实时跟随（AI 改画布 / 后台推进任务进度，本地跟着变）
//   2. 拉后台的动作清单注册进底栏（后台加平台 → 前端菜单自动多一项，前端一行不用改）
//   3. 下单 / 看进度 / 取消（复用底栏既有的轮询流程，只换"问谁"）
//   4. 生成历史（读后台账本，供 ui 的历史弹窗渲染）
//
// 零 Vue、零工作区 import：它一行界面都不画 ——
// 底栏的皮由 plugin-bottom-bar 提供（它自己订阅了 node/bar 场，一广播就重画），
// 历史弹窗由 packages/ui 提供（读这里挂的服务）。
import type { Context, PluginModule } from './shims.js'
import { CloudApi } from './api.js'
import { toBarAction, diffActions, staleActionIds, type BarActionLike } from './actions.js'
import { CanvasDiffAdapter } from './canvasDiffAdapter.js'
import { createRemoteSync } from './remoteSync.js'
import { makeJobPoll, submitJob, type ResourceLike, type RunDeps } from './jobRunner.js'
import { writeAudioResult, writeVideoResult } from './appliers.js'
import { applyMergePlan, type DocLike } from './applyMerge.js'
import { restoreOrSeed } from './restore.js'
import { Config, configFrom } from './config.js'
import { CANVAS_ID, canvasId, restoreMediaUrls as restoreMediaUrlsList } from './keys.js'
import { createCloudResourceAdapter } from './cloudResourceAdapter.js'
import { createCloudKvAdapter } from './cloudKvAdapter.js'
import type { ServerAction, ServerHistoryPage } from './apiTypes.js'

export const name = 'cloud-client'
export const inject = ['doc'] as string[]
export { Config }

/** 挂在 ctx 上的历史服务（前端只读；ui 的历史弹窗读它渲染） */
export interface GenHistoryService {
  query(q?: {
    page?: number
    pageSize?: number
    kind?: string
    status?: string
    rating?: string
    order?: 'asc' | 'desc'
    canvasId?: string
  }): Promise<ServerHistoryPage>
  /** 历史变化通知（ui 侧用 ref 接住重拉） */
  subscribe(fn: () => void): () => void
}

export interface CloudClientStatus {
  active: boolean
  baseUrl: string
  actions: number
  /** 装载时的同步阶段：restored（用云端覆盖本地）/ seeded（首次上云）/ empty */
  phase?: 'restored' | 'seeded' | 'empty'
  error?: string
  /** 已确认的云端画布版本（旧服务端没有版本接口时为 undefined） */
  knownRevision?: number
  /** 最近一次核对到的后台版本（诊断用） */
  serverRevision?: number
  /** 后台是否支持版本核对（旧服务端为 false） */
  revisionSupported?: boolean
  /** 是否有远端更新因“用户正在编辑”而延迟（编辑结束后会自动补） */
  deferred?: boolean
}

export interface CloudClientService {
  status(): CloudClientStatus
  refreshActions(): Promise<void>
}

/** 宿主能提供的 doc 面（结构化取，不 import 数据层类型） */
interface HostDoc extends DocLike {
  getNodes(): unknown[]
  getEdges(): unknown[]
  types?: { has(t: string): boolean }
  replaceAll(nodes: unknown[], edges?: unknown[]): void
}

interface ViewportLike {
  setViewport(v: { x: number; y: number; zoom: number }): void
}

interface BarService {
  register(scope: unknown, a: BarActionLike): void
  registerApplier(scope: unknown, kind: string, fn: unknown): void
}

interface SaveLike {
  useAdapter(type: string, adapter: unknown): void
  get(key: string, type?: string): Promise<unknown>
  /** 取某 type 当前的 adapter（换资源后端前要先抓住本地那个，见下面的迁移） */
  adapterOf?(type: string): unknown
}

interface SettingsLike {
  get(key: string): unknown
  onChange?(fn: (key: string, value: unknown) => void): { dispose(): void }
}

/** 宿主资源服务里本插件用到的那一点（按结构取，不 import 数据层类型） */
interface ResourcesLike {
  /** 按资源引用重建当前可显示地址；资源已不在时返回 undefined */
  restore?(resourceId: string, kind: string): Promise<string | undefined>
  /** 收字节进资源库，返回持久引用（写入器要把产物落进本画布用） */
  put?(blob: Blob, opts?: { kind?: string; name?: string }): Promise<string>
  /** 引用 → 当前可显示地址 */
  resolve?(ref: string): Promise<string | undefined>
}

/**
 * dataURL / blobURL → Blob（下单前把素材传成资源用；后台拿不到这两种地址）。
 *
 * 走 fetch：data: 浏览器直接支持，blob: 是同源对象地址 —— 不必自己解析 base64。
 * 取不到返回 undefined，调用方按"这一项跳过"处理。
 */
async function urlToBlob(url: string): Promise<Blob | undefined> {
  if (typeof fetch !== 'function') return undefined
  try {
    const res = await fetch(url)
    if (!res.ok) return undefined
    return await res.blob()
  } catch {
    return undefined
  }
}

/** adapter 的「按引用取可显示地址」能力（本地是现建 objectURL，云端拼服务器地址） */
interface ResolveCapable {
  resolveResource?(ref: string): Promise<string | undefined>
}

/**
 * 首次上云：把节点里**本地引用的资源**搬到云端，换成同源 URL。
 *
 * 为什么需要：本地节点存的是本地引用（`res-…`）配 `blob:` 地址，字节在浏览器库里。
 * 直接整包推上去，云端两样都拿不到 —— 用户的图就没了。
 * 做法：用**切换前抓住的本地资源后端**按引用取回字节（本地 resolve 会给一个临时 objectURL），
 * fetch 成 Blob → 传给云端资源后端 → 换回**逻辑 ID**（`<画布id>/<哈希>`）写进 `resourceId`；
 * 迁移期再把可显示地址写进对应媒体字段（目标形态只留 ID）。
 *
 * 取不到字节的字段原样保留（宁可少搬一张，也不要因为一张图失败把整次迁移搞崩）。
 */
export async function migrateLocalResources(
  nodes: Array<{ type?: string; data?: Record<string, unknown> }>,
  localAdapter: ResolveCapable | undefined,
  api: CloudApi,
  /** 当前画布 id（多画布）：资源要传进**这张画布**的目录 */
  canvasIdArg: string = CANVAS_ID,
): Promise<unknown[]> {
  const cloudResource = createCloudResourceAdapter(api, canvasIdArg)
  /** 本画布的资源地址前缀：用它认出"已经传过的图"，避免重复上云时又传一遍 */
  const resourceUrlPrefix = '/api/canvases/' + canvasIdArg + '/resources/'
  /** 本画布逻辑 ID 的前缀（新形态）：`<画布id>/<哈希>` */
  const resourceIdPrefix = canvasIdArg + '/'
  const uploaded = new Map<string, string>()
  const out: unknown[] = []
  for (const node of nodes) {
    const data = node.data
    const ref = typeof data?.resourceId === 'string' ? data.resourceId : undefined
    if (!data || !ref || !localAdapter?.resolveResource) {
      out.push(node)
      continue
    }
    // 已是本画布的资源（旧 URL 或新逻辑 ID，重复上云）→ 不动。
    // 认不出的话首次上云会把已上传的图再传一遍。
    if (ref.startsWith(resourceUrlPrefix) || ref.startsWith(resourceIdPrefix)) {
      out.push(node)
      continue
    }
    let cloudRef = uploaded.get(ref)
    if (cloudRef === undefined) {
      try {
        const localUrl = await localAdapter.resolveResource(ref)
        const blob = localUrl ? await urlToBlob(localUrl) : undefined
        cloudRef = blob ? await cloudResource.putResource!(blob, { kind: 'image' }) : ''
      } catch {
        cloudRef = ''
      }
      uploaded.set(ref, cloudRef)
    }
    if (!cloudRef) {
      out.push(node)
      continue
    }
    // resourceId 写逻辑 ID；媒体字段写迁移期地址（与数据层的 mediaUrlFieldsOf 同口径）。
    // 地址由 ID 直接拼出 —— 刚上传成功，不必再 HEAD 一次。
    const cloudUrl = resourceUrlPrefix + cloudRef.slice(resourceIdPrefix.length)
    const fields = MEDIA_FIELDS_BY_TYPE[String(node.type ?? '')] ?? ['imageUrl']
    const next: Record<string, unknown> = { ...data, resourceId: cloudRef }
    for (const f of fields) next[f] = cloudUrl
    out.push({ ...node, data: next })
  }
  return out
}

/** 各节点类型该把资源引用写进哪个字段（与 canvas-data 的 mediaUrlFieldsOf 同口径） */
const MEDIA_FIELDS_BY_TYPE: Record<string, readonly string[]> = {
  image: ['imageUrl'],
  video: ['videoUrl'],
  audio: ['audioUrl'],
  panorama: ['panoUrl'],
  '3d-preview': ['imageUrl'],
  'image-compare': ['leftImageUrl', 'rightImageUrl'],
}

export function apply(ctx: Context): void {
  const settings = ctx.tryGet<SettingsLike>('settings')
  const cfg = configFrom(settings as never)
  const api = new CloudApi({ baseUrl: cfg.baseUrl })

  // 当前画布 id（多画布）：URL `?canvas=` 优先，拿不到回落默认。本插件的所有存档 / 资源 / 任务
  // 都围绕它走 —— 同一套代码服务任意一张画布，不再写死 default。
  const CID = canvasId()

  const doc = ctx.get<HostDoc>('doc')
const adapter = new CanvasDiffAdapter(api, CID)
  const status: CloudClientStatus = { active: true, baseUrl: cfg.baseUrl, actions: 0 }

  /**
   * 当前是否正在编辑某节点（只用于“哪些字段先别覆盖”）。
   *
   * 宿主可以在装配时提供 `cloud-client/edit-guard`（返回某节点当前被占用的字段）。
   * 没有这个服务时用 DOM 焦点兜底；都取不到就返回空集（宁可同步，也不整体停更）。
   */
  function editingFieldsOf(nodeId: string): ReadonlySet<'position' | 'data' | 'size'> {
    const out = new Set<'position' | 'data' | 'size'>()
    const guard = ctx.tryGet<(nodeId: string) => ReadonlySet<'position' | 'data' | 'size'>>('cloud-client/edit-guard')
    if (typeof guard === 'function') {
      for (const field of guard(nodeId)) out.add(field)
    }
    // 文本/可视化编辑没有统一事件：用 DOM 焦点所在的节点兜底。
    if (typeof document !== 'undefined') {
      const active = document.activeElement
      const nodeEl = active instanceof HTMLElement ? active.closest('.vue-flow__node') : null
      if (nodeEl instanceof HTMLElement) {
        // VueFlow 的节点外壳通常是 `data-id` / `id` 两者之一；只认精确 id，
        // 不用 endsWith（'1' 会误配 '11'，正好把别人的输入当成这个节点的）。
        const dataId = nodeEl.getAttribute('data-id')
        const domId = nodeEl.id
        const matches =
          dataId === nodeId || domId === nodeId || domId === 'vue-flow__node-' + nodeId
        if (matches) out.add('data')
      }
    }
    return out
  }

  // ==================== 1. 存档：画布域换成走后台的 adapter ====================
  //
  // adapter 必须最先换，之后所有读写才走网络。只换 canvas 域：
  // 四格全部换到云端（canvas / resource / config / shortcut）——
  // 用户要求：云端时配置与快捷键也用云端的，而不是本地的（否则换台机器设置全丢）。
  const save = ctx.tryGet<SaveLike>('save')
  save?.useAdapter('canvas', adapter)
  // 换资源后端**之前**先抓住本地那个：首次上云时要用它把本地已存的字节捞出来传到云端
  // （换完就够不着本地库了 —— 那正是"本地画布里已有的图，上云后全丢"的成因）。
  const localResourceAdapter = save?.adapterOf?.('resource') as
    | { resolveResource?(ref: string): Promise<string | undefined> }
    | undefined
  // 资源那一格也切到云端：上传/生成的字节直接落到画布文件夹，节点里存**逻辑 ID**
  // （`<画布id>/<哈希>`），地址由 resolve 现拼。
  // 与画布用同一个开关（用户最初的设计：一个 adapter 管文本 + 资源两种形式）。
  save?.useAdapter('resource', createCloudResourceAdapter(api, CID))
  // 配置与快捷键：走 cloud-server 的 KV 接口（服务端对这两类照常收，只有 canvas 被专属路由接管）
  save?.useAdapter('config', createCloudKvAdapter({ baseUrl: cfg.baseUrl, type: 'config' }))
  save?.useAdapter('shortcut', createCloudKvAdapter({ baseUrl: cfg.baseUrl, type: 'shortcut' }))

  // 装载先「以云端为准」：宿主的顺序是「先按本地存档恢复画布、再装外部插件」，
  // 也就是说，不做这一步的话用户看到的是本地那份、而不是服务器的真身。
  // 服务器上什么都没有时反过来：把本地这份推上去（首次上云）。
  const ready = (async () => {
    try {
      const viewport = ctx.tryGet<ViewportLike>('viewport')
      const r = await restoreOrSeed({
        readServer: () => adapter.getRaw(),
        readLocal: () => ({ nodes: doc.getNodes(), edges: doc.getEdges() }),
        replaceLocal: (nodes, edges) => {
          // 覆盖本地用 replaceAll：它表达得出"删掉你没提到的那些"（增量写表达不出）
          doc.replaceAll(nodes, edges)
        },
        // 覆盖本地之前，按节点里的 resourceId 重建可显示地址（imageUrl / videoUrl …）。
        // 服务器只存引用，渲染层只认真地址 —— 少这一步，云端恢复出来的图片/视频节点就是空白
        // （用户 2026-10-10 报的「刷新后图片/视频变空白」）。判定与本地加载路径同源，
        // 收在 canvas-data 的 restoreNodeMediaUrls 里，本插件不重复实现一份。
        restoreMediaUrls: async (nodes) => {
          const resources = ctx.tryGet<ResourcesLike>('resources')
          if (!resources?.restore) return
          await restoreMediaUrlsList(
            nodes as Array<{ type?: string; data?: Record<string, unknown> }>,
            (resourceId, kind) => resources.restore!(resourceId, kind),
          )
        },
        pushLocal: async (nodes, edges) => {
          // 首次上云要把**本地已有的图**也搬上去：节点里存的还是本地引用（res-…），
          // 直接整包推的话云端拿不到字节、图就丢了。逐个取字节 → 传到云端 → 换成服务器 URL。
          const migrated = await migrateLocalResources(
            nodes as Array<{ data?: Record<string, unknown> }>,
            localResourceAdapter,
            api,
            CID,
          )
          await api.replaceCanvas(CID, migrated, edges)
        },
        ...(viewport ? { setViewport: (v) => viewport.setViewport(v) } : {}),
        ...(doc.types ? { knownType: (t: string) => doc.types!.has(t) } : {}),
        onError: (msg, err) => console.warn(msg, err),
      })
      status.phase = r.phase
      await adapter.primeFromServer()
    } catch (err) {
      status.error = err instanceof Error ? err.message : String(err)
    }
  })()

  // ==================== 2. 动作清单 → 底栏 ====================
  let knownActionIds: string[] = []
  let actionVersion: number | undefined

  const bar = (): BarService | undefined => ctx.tryGet<BarService>('nodeBar')

  // 一条动作的行为（下单 + 轮询 + 取消）。与 plugin-web2api-tools 同构，只换"问谁"。
  function handlersFor(def: ServerAction) {
    const deps: RunDeps = {
      api,
      canvasId: CID,
      readNodeData: (nodeId) => doc.getNode(nodeId)?.data,
      uploadLocal: (canvasId, bytes, nm) => api.uploadResource(canvasId, bytes, nm),
      // data: 与 blob: 都取得到（共享实现；blob: 以前会被静默跳过）
      toBlob: (url) => urlToBlob(url),
      onError: (msg, err) => console.warn(msg, err),
    }
    return {
      // 节点 id 来自**第二个参数**（底栏契约 BarRunContext.nodeId），不在 input 里。
      // 之前误读 input.nodeId —— 那个键从来不存在，于是永远兜底成空串、被服务端判「缺少 nodeId」。
      async run(
        input: { prompt?: string; values?: Record<string, unknown>; resources?: ResourceLike[] },
        runCtx: { nodeId: string },
      ) {
        const r = await submitJob(deps, {
          nodeId: runCtx.nodeId,
          actionId: def.id,
          ...(input.prompt !== undefined ? { prompt: input.prompt } : {}),
          ...(input.values ? { values: input.values } : {}),
          ...(input.resources ? { resources: input.resources } : {}),
        })
        if ('done' in r) return r.done
        // 返回轮询函数：交给底栏既有的 taskRuntime 驱动
        return makeJobPoll(deps, r.jobId)
      },
      resume: (taskId: string) => makeJobPoll(deps, taskId),
      onCancel: (taskId: string) => api.cancelJob(taskId),
    }
  }

  /** 全量重建：先摘掉已消失的，再注册新清单（同 id = 替换） */
  async function reloadActions(): Promise<void> {
    const nodeBar = bar()
    if (!nodeBar) return
    try {
      const r = await api.fetchActions(actionVersion)
      actionVersion = r.version
      status.actions = r.actions.length
      status.error = undefined
      if (!r.changed) return
      const f = ctx.registryOf<BarActionLike>('node/bar')
      // 摘掉两类：① 上次有、这次没了的；② 同名族里不在清单中的
      //（后者是本地插件"等底栏装好再试一次"那条重试路径可能留下的，也可能是后台删了的）
      const existingIds = f.list('node/bar').map((e) => e.id)
      for (const id of staleActionIds(existingIds, r.actions.map((a) => a.id))) f.remove('node/bar', id)
      const { toRemove, toRegister } = diffActions(knownActionIds, r.actions)
      for (const id of toRemove) f.remove('node/bar', id)
      for (const def of toRegister) {
        // ★ 云端动作的进度由**后台**写进节点；底栏不要再写一遍（两支笔写同一张便利贴会来回跳）。
        const barAction = toBarAction(def, handlersFor(def))
        barAction.externalRunState = true
        nodeBar.register(ctx, barAction)
      }
      knownActionIds = r.actions.map((a) => a.id)
    } catch (err) {
      status.error = err instanceof Error ? err.message : String(err)
    }
  }

  // ==================== 3. 结果写入器（video / audio 必须自带）====================
  //
  // image / text 的写入器住在各自的节点插件里；但 video / audio 原本只注册在
  // plugin-web2api-tools 里 —— 云模式下不装它，任务跑到 done 却永远不落节点。
  // 注意：registerApplier 对同一个 kind 重复注册会抛错，所以只补这两个。
  const nodeBarForApplier = ctx.tryGet<BarService>('nodeBar')
  if (nodeBarForApplier) {
    // 产物地址要先落进**本画布资源目录**再写节点（用户口径：统统转成自己的 URL）。
    // resources 是可选服务：拿不到就按原样写地址（保住产物是底线）。
    const writeDeps = {
      resources: ctx.tryGet<ResourcesLike>('resources') as
        | { put(blob: Blob, opts?: { kind?: string; name?: string }): Promise<string>; resolve(ref: string): Promise<string | undefined> }
        | undefined,
    }
    for (const [kind, write] of [
      ['video', writeVideoResult],
      ['audio', writeAudioResult],
    ] as const) {
      try {
        nodeBarForApplier.registerApplier(ctx, kind, (nodeId: string, result: { urls?: string[]; text?: string }) =>
          write(doc, nodeId, result, writeDeps),
        )
      } catch {
        // 已经有人注册（老路径）：不重复注册、也不报错
      }
    }
  }

  // ==================== 4. 历史服务（ui 只读）====================
  const historyListeners = new Set<() => void>()
  const genHistory: GenHistoryService = {
    query: (q) => api.fetchHistory(q),
    subscribe(fn) {
      historyListeners.add(fn)
      return () => historyListeners.delete(fn)
    },
  }
  ctx.inject('gen-history', genHistory)

  const service: CloudClientService = {
    status: () => ({ ...status }),
    refreshActions: reloadActions,
  }
  ctx.inject('cloud-client', service)
  // 沿用老服务名：装配层 / 既有代码按 'cloud-save' 拿同步状态
  ctx.inject('cloud-save', { status: () => ({ ...status }), sync: async () => ({ ...status }) })

  // ==================== 5. 实时跟随（一条 SSE 带三件事）====================
  const sync = createRemoteSync({
    readCloud: async (type, key) => {
      // 画布那三个 key 直接问 adapter（它从服务器读）；其余从 save 读
      if (type === 'canvas') return adapter.get(key)
      return save ? save.get(key, type) : undefined
    },
    // 一次完整快照：nodes/edges/revision 同一次读取，避免撕裂快照。
    readSnapshot: async () => {
      const snap = await api.readCanvas(CID)
      return {
        nodes: snap.nodes,
        edges: snap.edges,
        ...(typeof snap.revision === 'number' ? { revision: snap.revision } : {}),
      }
    },
    // 定时 ping：只问版本，不拉画布。
    readRevision: async () => {
      const rev = await api.readCanvasRevision(CID)
      if (typeof rev === 'number') status.serverRevision = rev
      status.revisionSupported = typeof rev === 'number'
      status.deferred = sync.status().deferred
      return rev
    },
    canvasId: CID,
    graph: {
      getNodes: () => doc.getNodes() as never,
      getEdges: () => doc.getEdges() as never,
      applyPlan: (plan) => applyMergePlan(doc, plan),
      // 远端合并成功后同步推进保存基准：否则下一次本地保存会把刚合进来的
      // 远端节点当成“新增”再发一次（本地与云端来回打架）。
      noteServerSnapshot: (snapshot) => adapter.primeFromSnapshot(snapshot),
      onRevision: (revision) => {
        status.knownRevision = revision
      },
      // 用户正在拖节点时，不覆盖它的 position（其他字段/节点照常同步）。
      // 输入框正在编辑的节点整条 data 更新也暂缓——避免把打了一半的字换回旧值。
      editingFields: (nodeId) => editingFieldsOf(nodeId),
    },
    knownType: (type) => (doc.types ? doc.types.has(type) : true),
    subscribe: (onChange, onError) => api.subscribeChanges(onChange, onError),
    onActionsChanged: () => void reloadActions(),
    onHistoryChanged: () => {
      for (const fn of historyListeners) {
        try {
          fn()
        } catch {
          // 单个订阅者抛错不打断其它
        }
      }
    },
    onError: (msg, err) => console.warn('[cloud-client] ' + msg, err),
  })

  // 装完再开订阅：否则会拿空基准比一次，把远端已有的全当成"新增"再插一遍
  void ready.then(async () => {
    try {
      await sync.refreshBase()
      const initialSnapshot = sync.serverSnapshot()
      if (initialSnapshot) adapter.primeFromSnapshot(initialSnapshot)
      sync.start()
      // 启动时把版本同步进状态（设置页 / 诊断用）
      status.knownRevision = sync.status().knownRevision
    } catch (err) {
      status.error = err instanceof Error ? err.message : String(err)
      console.warn('[cloud-client] 实时通道建立失败（画布照常可用）', err)
    }
  })

  // ==================== 6. 启动 & 兜底轮询 ====================
  void reloadActions()
  let timer: ReturnType<typeof setInterval> | null = null
  if (typeof setInterval === 'function' && cfg.pollMs > 0) {
    timer = setInterval(() => void reloadActions(), cfg.pollMs)
  }

  // 设置里改了地址 → 立刻换（不用重装插件）
  settings?.onChange?.((key, value) => {
    if (key === 'cloudClientBaseUrl' && typeof value === 'string') {
      api.setBaseUrl(value)
      status.baseUrl = value
      void reloadActions()
    }
  })

  // 卸载清理：定时器 / 订阅随插件作用域一起收掉
  ctx.effect(() => () => {
    if (timer) clearInterval(timer)
    timer = null
    sync.stop()
  })
}

export const cloudClientPlugin: PluginModule = { name, inject, Config, apply }
