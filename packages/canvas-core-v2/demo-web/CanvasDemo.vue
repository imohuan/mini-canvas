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
import { HOST_KEY } from './demoInjection'
import type { CanvasHost } from '../src/demo/host'
import type { CanvasNode } from '../src/services/nodeStore'
import { bootCanvas } from '../src/demo/host'
import { LocalStorageAdapter } from '../src/services/storage/localStorageAdapter'
import { nodeImagePlugin } from '../src/plugins/nodeImage'
import type { TextNodeService } from '../src/plugins/nodeText'
import type { ImageNodeService } from '../src/plugins/nodeImage'

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

// —— 把 nodeStore 当前节点灌成 VueFlow 渲染态（boot 后 / restore 后调用） ——
function storeToFlow(): FlowNode[] {
  return host.value!.nodeStore.getNodes().map((n) => ({
    id: n.id,
    type: n.type,
    position: { ...n.position },
    data: { ...(n.data as Record<string, unknown>) },
  }))
}

/** 用最新渲染态覆盖 nodeStore 并落盘 */
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

function addTextNode(): void {
  const svc = host.value!.ctx.get<TextNodeService>('text')
  const id = svc.addTextNode({ x: 60 + nodes.value.length * 40, y: 60 })
  const n = host.value!.nodeStore.getNode(id)!
  nodes.value.push({ id: n.id, type: n.type, position: { ...n.position }, data: { ...(n.data as object) } })
  persistNodes()
}

function addImageNode(): void {
  const svc = host.value!.ctx.get<ImageNodeService>('image')
  const id = svc.addImageNode({ x: 60 + nodes.value.length * 60, y: 180 }, SAMPLE_IMG)
  const n = host.value!.nodeStore.getNode(id)!
  nodes.value.push({ id: n.id, type: n.type, position: { ...n.position }, data: { ...(n.data as object) } })
  persistNodes()
}

function removeNode(id: string): void {
  host.value!.nodeStore.removeNode(id)
  nodes.value = nodes.value.filter((f) => f.id !== id)
  edges.value = edges.value.filter((e) => e.source !== id && e.target !== id)
  selectedIds.value.delete(id)
  persistNodes()
}

function removeSelected(): void {
  for (const id of [...selectedIds.value]) removeNode(id)
}

// —— 拖拽结束：把最终 position 写回 nodeStore 并落盘 ——
function onNodeDragStop(e: { node: { id: string; position: { x: number; y: number } } }): void {
  const hit = nodes.value.find((f) => f.id === e.node.id)
  if (hit) {
    hit.position = { ...e.node.position }
    persistNodes()
  }
}

// —— 点节点 = 选中（供 Delete 键删除） ——
function onNodeClick(e: { node: { id: string } }): void {
  selectedIds.value = new Set([e.node.id])
}

function onPaneClick(): void {
  selectedIds.value = new Set()
}

// —— 连一条边：禁 self-loop ——
function isValidConnection(conn: Connection): boolean {
  return conn.source !== conn.target
}

function onConnect(conn: Connection): void {
  if (!isValidConnection(conn) || !conn.source || !conn.target) return
  const id = `e-${conn.source}-${conn.target}`
  edges.value = edges.value.filter((e) => e.id !== id).concat([{ id, source: conn.source, target: conn.target }])
  // M1：边只是 VueFlow 视觉态（内核尚无 edge store，M5 才接入连接内核），不落盘
}

function onKeydown(e: KeyboardEvent): void {
  const t = e.target as HTMLElement | null
  // 正在输入(文本编辑)时把 Delete 留给输入框，别删节点
  if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.isContentEditable)) return
  if (e.key === 'Delete' && selectedIds.value.size > 0) {
    e.preventDefault()
    removeSelected()
  }
}

onMounted(async () => {
  try {
    const h = await bootCanvas(new LocalStorageAdapter(), { plugins: [nodeImagePlugin] })
    host.value = h

    // 存储为空(首次) → seed 默认 text+image 并落盘；非空则 bootCanvas 已 restore
    if (h.nodeStore.getNodes().length === 0) {
      const textId = h.ctx.get<TextNodeService>('text').addTextNode({ x: 80, y: 80 })
      h.ctx.get<ImageNodeService>('image').addImageNode({ x: 500, y: 120 }, SAMPLE_IMG)
      h.nodeStore.updateNodeData(textId, { text: SAMPLE_TEXT })
      await h.save.flush()
    }

    nodes.value = storeToFlow()
    window.addEventListener('keydown', onKeydown)
  } catch (err) {
    bootError.value = err instanceof Error ? err.message : String(err)
  } finally {
    booting.value = false
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  void host.value?.save.flush()
  host.value?.stop()
})
</script>

<template>
  <div class="demo-root">
    <div class="toolbar">
      <button :disabled="booting" @click="addTextNode">+ 文本</button>
      <button :disabled="booting" @click="addImageNode">+ 图片</button>
      <button :disabled="selectedIds.size === 0" @click="removeSelected">删除选中 (Delete)</button>
      <span class="hint">拖节点移动 · 从圆点拖出连线 · 双击文本编辑 · 刷新不丢</span>
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
      />
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
</style>
