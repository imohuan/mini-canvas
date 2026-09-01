/**
 * useMcpClient — 前端连接 MCP 后台服务
 *
 * 通过 HTTP(REST) 读写后台画布（数据权威在后台），通过 SSE 实时刷新。
 * 命令操作经后台，前端不自己持久化。
 *
 * 用法：
 *   const mcp = useMcpClient({ baseUrl: 'http://localhost:8765' })
 *   await mcp.connect()          // 拉取画布列表
 *   await mcp.switchCanvas(id)   // 切换并加载画布到 VueFlow
 *   await mcp.save()             // 保存到后台
 */
import { ref, shallowRef, onUnmounted, nextTick } from 'vue'
import { useVueFlow } from '@vue-flow/core'

export interface McpCanvasInfo {
  id: string
  name: string
  nodeCount: number
  edgeCount: number
}

export interface UseMcpClientOptions {
  baseUrl?: string
}

const LS_CANVAS_ID = 'mcp-canvas-current-id'

export function useMcpClient(options: UseMcpClientOptions = {}) {
  const baseUrl = options.baseUrl ?? 'http://localhost:8765'
  const vf = useVueFlow('main-canvas')

  // 状态
  const connected = ref(false)
  const canvases = shallowRef<McpCanvasInfo[]>([])
  const currentCanvasId = ref<string | null>(null)
  const error = ref<string | null>(null)
  const saving = ref(false)

  // SSE 事件源
  let eventSource: EventSource | null = null

  /** HTTP 请求封装 */
  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${baseUrl}${path}`, init)
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${path}`)
    return (await res.json()) as T
  }

  /** 建立 SSE 连接，实时接收画布变化 */
  function connectSse(canvasId: string): void {
    eventSource?.close()
    const url = `${baseUrl}/events?canvasId=${canvasId}`
    eventSource = new EventSource(url)
    eventSource.onmessage = (e) => {
      try {
        const evt = JSON.parse(e.data)
        if (evt.canvasId === currentCanvasId.value) void loadIntoFlow(canvasId)
      } catch {
        // 忽略无法解析的 SSE 消息
      }
    }
    eventSource.onerror = () => {
      // 断线自动重连（EventSource 内置）
    }
  }

  /** 把后台画布数据加载进 VueFlow */
  async function loadIntoFlow(canvasId: string): Promise<void> {
    const data = await request<{ nodes: any[]; edges: any[] }>(`/api/canvases/${canvasId}`)
    vf.setNodes(data.nodes)
    vf.setEdges(data.edges)
    await nextTick()
    // fitView 把节点适配到视口：避免“画布空白的、缩放才出现”的显示问题
    try {
      await vf.fitView({ padding: 0.2, duration: 200 })
    } catch {
      // fitView 在节点尚未初始化完成时可能失败，忽略即可
    }
  }

  /** 切换画布：加载到画布并订阅 SSE */
  async function switchCanvas(canvasId: string): Promise<void> {
    currentCanvasId.value = canvasId
    localStorage.setItem(LS_CANVAS_ID, canvasId)
    // 先建立 SSE 订阅（独立于 load，确保实时通道一定建立）
    connectSse(canvasId)
    try {
      await loadIntoFlow(canvasId)
    } catch (err) {
      error.value = `加载画布失败: ${(err as Error).message}`
    }
  }

  /** 连接服务，拉取画布列表 */
  async function connect(): Promise<void> {
    try {
      const data = await request<{ canvases: McpCanvasInfo[] }>('/api/canvases')
      canvases.value = data.canvases
      connected.value = true
      error.value = null
    } catch (err) {
      connected.value = false
      error.value = (err as Error).message
    }
  }

  /** 自动恢复上次打开的画布（刷新后无需手动选择） */
  async function restoreLastCanvas(): Promise<void> {
    const lastId = localStorage.getItem(LS_CANVAS_ID)
    if (lastId && canvases.value.some((c) => c.id === lastId)) {
      await switchCanvas(lastId)
    }
  }

  /** 保存当前画布到后台（数据权威在后台，保存动作归后台） */
  async function save(): Promise<void> {
    if (!currentCanvasId.value) return
    saving.value = true
    try {
      // 先把前端当前节点/边状态同步给后台（用 VueFlow 当前数据）
      await request(`/api/canvases/${currentCanvasId.value}/save`, { method: 'POST' })
    } finally {
      saving.value = false
    }
  }

  /** 创建节点（经后台） */
  async function createNode(type: string, position?: { x: number; y: number }, data?: Record<string, unknown>) {
    if (!currentCanvasId.value) throw new Error('未选择画布')
    return request(`/api/canvases/${currentCanvasId.value}/nodes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type, position, data }),
    })
  }

  /** 创建任务（经后台） */
  async function createTask(kind: string, targetNodeId: string, payload: Record<string, unknown> = {}) {
    if (!currentCanvasId.value) throw new Error('未选择画布')
    return request('/api/tasks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind, canvasId: currentCanvasId.value, targetNodeId, payload }),
    })
  }

  onUnmounted(() => {
    eventSource?.close()
  })

  return {
    connected,
    canvases,
    currentCanvasId,
    error,
    saving,
    connect,
    switchCanvas,
    restoreLastCanvas,
    save,
    createNode,
    createTask,
    baseUrl,
  }
}
