<script setup lang="ts">
// CanvasDemo —— M1(浏览器)最小闭环的画布宿主（demo 接线层，非内核契约）
// 职责：
//   1. bootCanvas(LocalStorageAdapter + text/image 插件) 建内核。
//   2. 首次(存储空)则 seed 默认 text+image 两节点并落盘。
//   3. 用 <VueFlow> 渲染 text+image（nodeTypes: 业务 type→内容组件）。
//   4. 接线：拖拽结束写回 position、连边(禁 self-loop)、删节点(Delete/按钮)。
// 边界：只做"演示接线"，不发明内核接口；持久化统一走 host.save/nodeStore(内核服务)。
import { onMounted, provide, ref, shallowRef, onBeforeUnmount } from 'vue'
import { VueFlow } from '@vue-flow/core'
import type { Connection } from '@vue-flow/core'
import TextContent from './components/TextContent.vue'
import ImageContent from './components/ImageContent.vue'
import BaseNode from '../src/components/BaseNode.vue'
import { NODE_REGISTRY_KEY } from '../src/components/nodeRegistryKey'
import { NodeRegistry } from '../src/core/registry/nodeRegistry'
import { validateConnection, typeConnectionDef } from '../src/services/connection'
import { HOST_KEY } from './demoInjection'
import type { CanvasHost } from '../src/demo/host'
import type { CanvasNode } from '../src/services/nodeStore'
import { bootCanvas } from '../src/demo/host'
import { LocalStorageAdapter } from '../src/services/storage/localStorageAdapter'
import { nodeImagePlugin } from '../src/plugins/nodeImage'
import type { TextNodeService } from '../src/plugins/nodeText'
import type { ImageNodeService } from '../src/plugins/nodeImage'
import { bindBrowserLifecycleFlush } from './browserFlush'
import type { BrowserFlushHandle } from './browserFlush'

/** VueFlow 用的流式节点形状 */
interface FlowNode {
  id: string
  type: string
  position: { x: number; y: number }
  data: Record<string, unknown>
}

// —— 运行状态 ——
const booting = ref(true)
const bootError = ref('')
const host = shallowRef<CanvasHost | undefined>()
const flushHandle = ref<BrowserFlushHandle>()
// setup 阶段同步 provide 宿主引用（boot 异步完成后填充），内容组件经 inject(HOST_KEY).value 取
provide(HOST_KEY, host)

// 节点展示注册表：把各业务 type 的 content 组件注册进去（NodeRenderer/BaseNode 消费），setup 同步 provide
const registry = new NodeRegistry()
registry.register('text', { content: TextContent })
registry.register('image', { content: ImageContent })
provide(NODE_REGISTRY_KEY, registry)

// VueFlow 的响应式节点/边（渲染态）
const nodes = ref<FlowNode[]>([])
const edges = ref<Array<{ id: string; source: string; target: string }>>([])
const selectedIds = ref<Set<string>>(new Set())

// 业务 type → 壳组件：所有节点都经 BaseNode(壳)渲染，BaseNode 按 node.type 经 NodeRenderer 解析 content
const nodeTypes = { text: BaseNode, image: BaseNode }

/** 默认 image seed：内联 SVG（离线可显示） */
const SAMPLE_IMG =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240"><rect width="320" height="240" fill="#dbeafe"/><text x="160" y="118" font-family="sans-serif" font-size="20" fill="#1d4ed8" text-anchor="middle">v2 image 节点</text><text x="160" y="142" font-family="sans-serif" font-size="13" fill="#64748b" text-anchor="middle">data.imageUrl</text></svg>`,
  )
const SAMPLE_TEXT = '双击我输入内容\n\n· 从左右圆点可拖出连线\n· 拖动节点可移动\n· 点节点再按 Delete 删除'

// —— 把 nodeStore 当前节点灌成 VueFlow 渲染态（boot/命令后调用），并清掉已删节点的边 ——
function storeToFlow(): FlowNode[] {
  return host.value!.nodeStore.getNodes().map((n) => ({
    id: n.id,
    type: n.type,
    position: { ...n.position },
    data: { ...(n.data as Record<string, unknown>) },
  }))
}
function syncFromStore(): void {
  const store = host.value!.nodeStore
  nodes.value = storeToFlow()
  const alive = new Set(nodes.value.map((f) => f.id))
  edges.value = edges.value.filter((e) => alive.has(e.source) && alive.has(e.target))
  canUndo.value = host.value!.history.canUndo()
  canRedo.value = host.value!.history.canRedo()
}
const canUndo = ref(false)
const canRedo = ref(false)

/** 用最新渲染态覆盖 nodeStore 并落盘（拖拽/数据已改到 VueFlow 侧时用） */
function persistNodes(): void {
  const store = host.value!.nodeStore
  const graph: CanvasNode[] = nodes.value.map((f) => {
    const existing = store.getNode(f.id)
    return {
      id: f.id,
      type: f.type,
      position: { ...f.position },
      data: existing ? { ...existing.data } : {},
    }
  })
  store.replaceAll(graph)
  host.value!.save.set('graph', store.getNodes(), 'canvas')
}

// —— 统一经内核命令建/删/撤销/重做；改完从 nodeStore 重灌渲染态 ——
function createNode(type: string): void {
  const pos = { x: 60 + nodes.value.length * 40, y: 60 + nodes.value.length * 40 }
  const payload: { type: string; position: { x: number; y: number }; imageUrl?: string } = { type, position: pos }
  if (type === 'image') payload.imageUrl = SAMPLE_IMG // image creator 经 extra 收 imageUrl
  host.value!.command.execute('command:create-node', payload)
  syncFromStore()
}

function deleteSelected(): void {
  if (selectedIds.value.size === 0) return
  host.value!.selection.set(selectedIds.value) // 把 UI 选中同步给内核，命令读它删
  host.value!.command.execute('command:delete')
  selectedIds.value = new Set()
  syncFromStore()
}

function undo(): void {
  host.value!.command.execute('command:undo')
  selectedIds.value = new Set()
  syncFromStore()
}

function redo(): void {
  host.value!.command.execute('command:redo')
  syncFromStore()
}

// —— 拖拽结束：把最终 position 写回 nodeStore 并落盘 ——
function onNodeDragStop(e: { node: { id: string; position: { x: number; y: number } } }): void {
  const hit = nodes.value.find((f) => f.id === e.node.id)
  if (hit) {
    hit.position = { ...e.node.position }
    persistNodes()
  }
}

// —— 点节点 = 选中（供 Delete 键 / 命令删除），并同步内核 selection ——
function onNodeClick(e: { node: { id: string } }): void {
  selectedIds.value = new Set([e.node.id])
  host.value!.selection.set(selectedIds.value)
}

function onPaneClick(): void {
  selectedIds.value = new Set()
  host.value!.selection.clear()
  closeMenu()
}

// —— 右键菜单：建 text/image / 删除选中 / 撤销 ——
const menu = ref<{ visible: boolean; x: number; y: number }>({ visible: false, x: 0, y: 0 })
function openMenuAt(x: number, y: number): void {
  menu.value = { visible: true, x, y }
}
function closeMenu(): void {
  menu.value.visible = false
}
/** 右键菜单里选一个类型去新建 */
function pick(type: string): void {
  closeMenu()
  createNode(type)
}
function menuAct(fn: () => void): void {
  closeMenu()
  fn()
}
function onNodeContextMenu(e: { event: MouseEvent }): void {
  e.event.preventDefault()
  openMenuAt(e.event.clientX, e.event.clientY)
}
function onPaneContextMenu(e: MouseEvent): void {
  e.preventDefault()
  openMenuAt(e.clientX, e.clientY)
}

// —— 连一条边：经内核连接服务(M5)校验(自连/环/重复/朝向/类型) ——
function isValidConnection(conn: Connection): boolean {
  const h = host.value
  if (!h || !conn.source || !conn.target) return false
  const nodes = new Map(h.nodeStore.getNodes().map((n) => [n.id, { id: n.id, type: n.type }]))
  const res = validateConnection(
    { source: conn.source, sourceHandle: conn.sourceHandle ?? undefined, target: conn.target, targetHandle: conn.targetHandle ?? undefined },
    { nodes, edges: edges.value, getTypeConn: (t) => typeConnectionDef(h.nodeStore.types.get(t)) },
  )
  return res.ok
}

function onConnect(conn: Connection): void {
  if (!isValidConnection(conn) || !conn.source || !conn.target) return
  const id = `e-${conn.source}-${conn.target}`
  edges.value = edges.value.filter((e) => e.id !== id).concat([{ id, source: conn.source, target: conn.target }])
  // M5：边仍是 VueFlow 视觉态(未落盘)；校验已走内核 validateConnection
}

function onKeydown(e: KeyboardEvent): void {
  const t = e.target as HTMLElement | null
  // 正在输入(文本编辑)时把 Delete 留给输入框，别删节点
  if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.isContentEditable)) return
  if (e.key === 'Delete') {
    e.preventDefault()
    deleteSelected()
  } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault()
    if (e.shiftKey) redo()
    else undo()
  }
}

onMounted(async () => {
  try {
    const h = await bootCanvas({ adapter: new LocalStorageAdapter(), plugins: [nodeImagePlugin] })
    host.value = h

    // 存储为空(首次) → seed 默认 text+image 并落盘；非空则 bootCanvas 已 restore
    if (h.nodeStore.getNodes().length === 0) {
      const textId = h.ctx.get<TextNodeService>('text').addTextNode({ x: 80, y: 80 })
      h.ctx.get<ImageNodeService>('image').addImageNode({ x: 500, y: 120 }, SAMPLE_IMG)
      h.nodeStore.updateNodeData(textId, { text: SAMPLE_TEXT })
      await h.save.flush()
    }

    nodes.value = storeToFlow()
    // 页面隐藏/离开时把脏数据落盘（防刷新丢）
    flushHandle.value = bindBrowserLifecycleFlush(h.save)
    window.addEventListener('keydown', onKeydown)
  } catch (err) {
    bootError.value = err instanceof Error ? err.message : String(err)
  } finally {
    booting.value = false
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  flushHandle.value?.dispose()
  void host.value?.save.flush()
  host.value?.stop()
})
</script>

<template>
  <div class="demo-root">
    <div class="toolbar">
      <button :disabled="booting" @click="createNode('text')">+ 文本</button>
      <button :disabled="booting" @click="createNode('image')">+ 图片</button>
      <button :disabled="selectedIds.size === 0" @click="deleteSelected">删除选中 (Delete)</button>
      <button :disabled="booting || !canUndo" @click="undo">↶ 撤销</button>
      <button :disabled="booting || !canRedo" @click="redo">↷ 重做</button>
      <span class="hint">拖节点移动 · 从圆点拖出连线 · 双击文本编辑 · 右键菜单 · Ctrl+Z 撤销 · 刷新不丢</span>
    </div>

    <div v-if="booting" class="status">正在启动内核…</div>
    <div v-else-if="bootError" class="status err">启动失败：{{ bootError }}</div>

    <div v-else class="canvas-wrap">
      <VueFlow
        :nodes="nodes"
        :edges="edges"
        :node-types="nodeTypes"
        :is-valid-connection="isValidConnection"
        :min-zoom="0.2"
        :max-zoom="2"
        @connect="onConnect"
        @node-click="onNodeClick"
        @node-drag-stop="onNodeDragStop"
        @pane-click="onPaneClick"
        @node-context-menu="onNodeContextMenu"
        @pane-context-menu="onPaneContextMenu"
      />

      <!-- 最小右键菜单（M3） -->
      <div v-if="menu.visible" class="ctx-menu" :style="{ left: menu.x + 'px', top: menu.y + 'px' }">
        <div class="ctx-item" @click="pick('text')">+ 文本节点</div>
        <div class="ctx-item" @click="pick('image')">+ 图片节点</div>
        <div class="ctx-sep"></div>
        <div class="ctx-item" @click="menuAct(deleteSelected)">删除选中</div>
        <div class="ctx-item" @click="menuAct(undo)">撤销</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.demo-root {
  height: 100vh;
  display: flex;
  flex-direction: column;
  font-family: system-ui, sans-serif;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid #e5e7eb;
  background: #fff;
  z-index: 10;
}
.toolbar button {
  padding: 4px 12px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  background: #f9fafb;
  cursor: pointer;
  font-size: 13px;
}
.toolbar button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.toolbar .hint {
  margin-left: auto;
  color: #9ca3af;
  font-size: 12px;
}
.status {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #6b7280;
}
.status.err {
  color: #dc2626;
}
.canvas-wrap {
  flex: 1;
  position: relative;
}
.canvas-wrap :deep(.vue-flow__node) {
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
  font-size: 14px;
}
.ctx-menu {
  position: fixed;
  min-width: 140px;
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  padding: 4px;
  z-index: 100;
  font-size: 13px;
}
.ctx-item {
  padding: 6px 10px;
  border-radius: 5px;
  cursor: pointer;
}
.ctx-item:hover {
  background: #f3f4f6;
}
.ctx-sep {
  height: 1px;
  background: #e5e7eb;
  margin: 4px 6px;
}
</style>
