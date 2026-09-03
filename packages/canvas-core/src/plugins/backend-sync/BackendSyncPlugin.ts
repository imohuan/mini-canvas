import type { CanvasPlugin, PluginContext, CanvasActions } from '../types'
import type { Node, Edge } from '@vue-flow/core'
import { BackendRest, withAbsolutizedUrls } from './rest'
import { BackendSse } from './sse'

export type BackendSyncOptions = {
  /** 后台服务地址 */
  baseUrl?: string
  /** 连接后自动加载的画布 id；不填则列表第一个/上次记忆 */
  canvasId?: string
  /** 是否自动保存（本地改动自动上报后台） */
  autoSave?: boolean
  /** 自动保存防抖 ms */
  debounceMs?: number
  /** 本地是否作为持久化记忆 key（记住上次画布） */
  remember?: boolean
  /** 视图侧控制句柄：插件安装时写入可响应状态/能力，供视图绑定 */
  control?: BackendSyncControl
}

/** 视图侧可绑定的响应式控制句柄 */
export type BackendSyncControl = {
  connected: boolean
  canvasId: string | null
  canvases: { id: string; name: string; nodeCount: number; edgeCount: number }[]
  error: string | null
  loading: boolean
  api: BackendSyncAPI | null
}

export interface BackendSyncAPI {
  connected: boolean
  canvasId: string | null
  baseUrl: string
  connect(canvasId?: string): Promise<void>
  switchCanvas(canvasId: string): Promise<void>
  disconnect(): void
  saveNow(): Promise<void>
  createNode(type: string, args: Record<string, unknown>, position?: { x: number; y: number }): Promise<any>
  nodeStatus(nodeId: string): Promise<any>
  /** 订阅后端事件（node:updated/task 进度等） */
  on(event: string, handler: (payload: any) => void): () => void
}

const LS_KEY = 'backend-sync:canvas-id'

export const BackendSyncPlugin: CanvasPlugin<BackendSyncOptions, BackendSyncAPI> = {
  name: 'backend-sync',
  version: '0.1.0',
  dependencies: [],

  async install(context: PluginContext, options: BackendSyncOptions = {}) {
    const baseUrl = options.baseUrl ?? 'http://localhost:8765'
    const autoSave = options.autoSave ?? true
    const debounceMs = options.debounceMs ?? 400
    const remember = options.remember ?? true
    const rest = new BackendRest(baseUrl)
    const actions: CanvasActions = context.actions
    const control: BackendSyncControl | undefined = options.control

    // ===== 状态 =====
    let connected = false
    let canvasId: string | null = options.canvasId ?? (remember ? localStorage.getItem(LS_KEY) : null) ?? null
    let canvases: { id: string; name: string; nodeCount: number; edgeCount: number }[] = []
    let sse: BackendSse | null = null
    let applyingRemote = false
    let flushTimer: ReturnType<typeof setTimeout> | null = null

    const externalListeners = new Map<string, Set<(...args: any[]) => void>>()

    function syncControl(partial?: Partial<BackendSyncControl>): void {
      if (!control) return
      control.connected = partial?.connected ?? connected
      control.canvasId = partial?.canvasId !== undefined ? partial.canvasId : canvasId
      control.canvases = canvases
      control.api = api
      if (partial?.error !== undefined) control.error = partial.error
    }
    function syncLoading(v: boolean): void { if (control) control.loading = v }

    function emitBus(event: string, payload: unknown): void {
      context.emit(event, payload)
      for (const h of externalListeners.get(event) ?? []) h(payload)
    }

    // ===== 节点字段 URL 补全 =====
    function absolutizeNode(n: Node): Node {
      if (!n.data) return n
      return { ...n, data: withAbsolutizedUrls(baseUrl, n.data) }
    }

    // ===== 全量替换 =====
    function replaceAll(nodes: Node[], edges: Edge[]): void {
      applyingRemote = true
      try {
        const curNodes = actions.getNodes().map((n: Node) => n.id)
        const curEdges = actions.getEdges().map((e: Edge) => e.id)
        if (curNodes.length) actions.removeNodes(curNodes)
        if (curEdges.length) actions.removeEdges(curEdges)
        if (nodes.length) actions.addNodes(nodes.map(absolutizeNode))
        if (edges.length) actions.addEdges(edges)
      } finally {
        applyingRemote = false
      }
    }

    // ===== 下行：SSE 增量应用到本地（无损：只针对目标节点/边，不整 reload） =====
    function applyRemoteEvent(evt: any): void {
      // task/进度都表现为 node:updated(带全量 node)
      if (evt.canvasId && evt.canvasId !== canvasId) return
      applyingRemote = true
      try {
        switch (evt.type) {
          case 'node:added': {
            if (evt.node && !actions.getNodes().some((n: Node) => n.id === evt.node.id)) {
              actions.addNodes([absolutizeNode(evt.node)])
            }
            break
          }
          case 'node:updated': {
            if (evt.node) {
              const local = actions.getNodes().find((n: Node) => n.id === evt.node.id)
              if (local) {
                // 全量节点替换（保留前端本地运行时字段 selected 等），data 用后台合并后全量
                const data = withAbsolutizedUrls(baseUrl, evt.node.data ?? local.data)
                actions.updateNode(evt.node.id, { data: { ...local.data, ...data }, position: evt.node.position ?? local.position })
              } else {
                actions.addNodes([absolutizeNode(evt.node)])
              }
            }
            break
          }
          case 'node:removed': {
            if (actions.getNodes().some((n: Node) => n.id === evt.nodeId)) actions.removeNodes([evt.nodeId])
            break
          }
          case 'edge:added': {
            if (evt.edge && !actions.getEdges().some((e: Edge) => e.id === evt.edge.id)) {
              actions.addEdges([evt.edge])
            }
            break
          }
          case 'edge:removed': {
            if (actions.getEdges().some((e: Edge) => e.id === evt.edgeId)) actions.removeEdges([evt.edgeId])
            break
          }
          // batch:done / graph:changed：可作 reconcile 提示，此处不整 reload（增量已足够）
          default:
            break
        }
      } finally {
        applyingRemote = false
      }
    }

    // ===== 全量 reconcile（断线重连后兜底） =====
    async function reconcile(): Promise<void> {
      if (!canvasId) return
      try {
        const data = await rest.getCanvas(canvasId)
        replaceAll(data.nodes, data.edges)
      } catch (err) {
        context.logger.error('[backend-sync] reconcile 失败:', err)
      }
    }

    // ===== 上行：本地改动收集 → 上报后台（自动保存） =====
    // 用事件总线，但应用 Remote 期间置 applyingRemote 抑制（切掉回环）
    const pending = { nodeAdd: new Map<string, any>(), nodeRemove: new Set<string>(), nodePos: new Map<string, { x: number; y: number }>(), edgeAdd: new Map<string, any>(), edgeRemove: new Set<string>() }

    function scheduleFlush(): void {
      if (!autoSave || !connected || !canvasId) return
      if (flushTimer) clearTimeout(flushTimer)
      flushTimer = setTimeout(() => { void flushNow() }, debounceMs)
    }

    async function flushNow(): Promise<void> {
      if (flushTimer) { clearTimeout(flushTimer); flushTimer = null }
      if (!connected || !canvasId) return
      const nAdd = [...pending.nodeAdd.values()].map(normalizeNodeForUp)
      const nDel = [...pending.nodeRemove]
      const nUpd: any[] = [...pending.nodePos.entries()].map(([id, pos]) => ({ id, position: pos }))
      const eAdd = [...pending.edgeAdd.values()]
      const eDel = [...pending.edgeRemove]
      pending.nodeAdd.clear(); pending.nodeRemove.clear(); pending.nodePos.clear(); pending.edgeAdd.clear(); pending.edgeRemove.clear()
      try {
        if (nAdd.length || nDel.length || nUpd.length) {
          await rest.batchNodes(canvasId, { add: nAdd, delete: nDel, update: nUpd })
        }
        if (eAdd.length || eDel.length) {
          await rest.batchEdges(canvasId, { add: eAdd, delete: eDel })
        }
      } catch (err) {
        context.logger.error('[backend-sync] 上行保存失败（数据仅本地保留，稍后重试）:', err)
      }
    }

    /** 把本地新增节点归一成后台 batch add 入参（去掉 selected/__isGroup 等运行时字段） */
    function normalizeNodeForUp(n: Node): Record<string, unknown> {
      const data = { ...n.data } as Record<string, unknown>
      delete data.selected
      return { type: (n.type as string) === 'custom' ? (data.nodeType as string) || 'custom' : (n.type as string), id: n.id, position: n.position, data }
    }

    // 订阅本地事件收集上行 delta（用户真实操作触发）
    const offNodes = context.on('nodesChange', (changes: any[]) => {
      if (applyingRemote || !connected) return
      let changed = false
      for (const c of changes ?? []) {
        if (c.type === 'add') { changed = true }
        else if (c.type === 'remove') { pending.nodeRemove.add(c.id); changed = true }
        else if (c.type === 'position' && !c.dragging) {
          // 非拖拽程序化位移（少见）；由 nodeDragStop 处理最终拖拽位置
          if (c.position) { pending.nodePos.set(c.id, c.position); changed = true }
        }
      }
      if (changed) scheduleFlush()
    })
    const offEdges = context.on('edgesChange', (changes: any[]) => {
      if (applyingRemote || !connected) return
      let changed = false
      for (const c of changes ?? []) {
        if (c.type === 'remove') { pending.edgeRemove.add(c.id); changed = true }
      }
      if (changed) scheduleFlush()
    })
    const offDrag = context.on('nodeDragStop', (e: any) => {
      if (applyingRemote || !connected) return
      if (e?.node) {
        pending.nodePos.set(e.node.id, e.node.position)
        scheduleFlush()
      }
    })
    const offConnect = context.on('connect', (conn: any) => {
      if (applyingRemote || !connected) return
      if (conn?.source && conn?.target) {
        pending.edgeAdd.set(conn.id ?? `${conn.source}__${conn.target}`, {
          source: conn.source, target: conn.target, sourceHandle: conn.sourceHandle ?? 'source', targetHandle: conn.targetHandle ?? 'target',
        })
        scheduleFlush()
      }
    })
    // 保存即保存：监听 auto-save:saved? 不需要。卸载 flush + visibility flush 兜底
    function flushBeforeHide(): void {
      if (pendingHasData()) void flushNow()
    }
    function pendingHasData(): boolean {
      return pending.nodeAdd.size + pending.nodeRemove.size + pending.nodePos.size + pending.edgeAdd.size + pending.edgeRemove.size > 0
    }
    const onVis = () => { if (document.visibilityState === 'hidden') flushBeforeHide() }
    document.addEventListener('visibilitychange', onVis)

    // ===== 连接 / 切画布 =====
    async function loadCanvas(cid: string): Promise<void> {
      canvasId = cid
      if (remember) localStorage.setItem(LS_KEY, cid)
      syncControl()
      const data = await rest.getCanvas(cid)
      replaceAll(data.nodes, data.edges)
      // 建立 SSE 订阅
      if (sse) sse.setCanvas(cid)
      else {
        sse = new BackendSse(baseUrl, cid, applyRemoteEvent, (isRe) => { if (isRe) void reconcile() })
        sse.connect()
      }
      emitBus('backend-sync:canvas', { canvasId: cid, connected: true })
    }

    async function connect(cid?: string): Promise<void> {
      syncLoading(true)
      try {
        const cvs = await rest.listCanvases()
        canvases = cvs.canvases
        syncControl()
        let target = cid ?? canvasId
        if (!target || !canvases.some((c) => c.id === target)) {
          target = canvases[0]?.id ?? null
        }
        if (!target) {
          connected = false
          syncControl({ connected: false, error: '后台没有画布，请先 create_canvas' })
          emitBus('backend-sync:state', { connected: false, error: '后台没有画布，请先 create_canvas' })
          return
        }
        connected = true
        await loadCanvas(target)
        syncControl({ error: null })
        emitBus('backend-sync:state', { connected: true, canvasId: target })
      } catch (err) {
        connected = false
        syncControl({ connected: false, error: (err as Error).message })
        context.logger.error('[backend-sync] connect 失败:', err)
      } finally {
        syncLoading(false)
      }
    }

    async function switchCanvas(cid: string): Promise<void> {
      syncLoading(true)
      try {
        connected = true
        await loadCanvas(cid)
        syncControl({ error: null })
        emitBus('backend-sync:state', { connected: true, canvasId: cid })
      } catch (err) {
        syncControl({ error: (err as Error).message })
        context.logger.error('[backend-sync] switchCanvas 失败:', err)
      } finally {
        syncLoading(false)
      }
    }

    function disconnect(): void {
      if (flushTimer) clearTimeout(flushTimer)
      sse?.close(); sse = null
      connected = false
      syncControl()
    }

    const api: BackendSyncAPI = {
      get connected() { return connected },
      get canvasId() { return canvasId },
      baseUrl,
      connect,
      switchCanvas,
      disconnect,
      saveNow: () => flushNow(),
      createNode: (type, args, position) => rest.createNode(canvasId ?? '', { type, args, position }),
      nodeStatus: (nodeId) => rest.nodeStatus(canvasId ?? '', nodeId),
      on(event: string, handler: (...args: any[]) => void) {
        if (!externalListeners.has(event)) externalListeners.set(event, new Set())
        externalListeners.get(event)!.add(handler)
        context.on(event, handler)
        return () => { context.off(event, handler); externalListeners.get(event)?.delete(handler) }
      },
    }

    // install 结束时：若给了默认 canvasId 且标记自动连接，则异步连接（不阻塞 install）
    if (options.canvasId || canvasId) {
      void connect(options.canvasId).catch((err) => context.logger.error('[backend-sync] 自动连接失败:', err))
    } else {
      // 无目标画布：仅标记可用，等待外部调 connect()
      connected = false
    }

    return {
      api,
      uninstall() {
        disconnect()
        document.removeEventListener('visibilitychange', onVis)
        offNodes(); offEdges(); offDrag(); offConnect()
        for (const [event, handlers] of externalListeners) {
          for (const h of handlers) context.off(event, h)
        }
        externalListeners.clear()
      },
    }
  },
}
