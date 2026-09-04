<script setup lang="ts">
// CanvasDemo —— M1(浏览器)最小闭环的画布宿主（demo 接线层，非内核契约）
// 职责：
//   1. bootCanvas(LocalStorageAdapter + text/image 插件) 建内核。
//   2. 首次(存储空)则 seed 默认 text+image 两节点并落盘。
//   3. 用 <VueFlow> 渲染 text+image（nodeTypes: 业务 type→内容组件）。
//   4. 接线：拖拽结束写回 position、连边(禁 self-loop)、删节点(Delete/按钮)。
// 边界：只做"演示接线"，不发明内核接口；持久化统一走 host.save/nodeStore(内核服务)。
import { onMounted, provide, reactive, ref, shallowRef, onBeforeUnmount } from 'vue'
import { VueFlow } from '@vue-flow/core'
import type { Connection } from '@vue-flow/core'
import SettingsPanel from './SettingsPanel.vue'
import BaseNode from '../src/components/BaseNode.vue'
import { NODE_REGISTRY_KEY, NODE_WRITE_KEY } from '../src/components/nodeRegistryKey'
import { CANVAS_PARAMS_KEY } from '../src/components/canvasParamKey'
import { NodeRegistry } from '../src/core/registry/nodeRegistry'
import { validateConnection, typeConnectionDef } from '../src/services/connection'
import { HOST_KEY } from '@mini-canvas/canvas-core-v2'
import type { CanvasNode } from '../src/services/nodeStore'
import { LocalStorageAdapter } from '../src/services/storage/localStorageAdapter'
import { createMiniCanvasHost } from '@mini-canvas/canvas-core-v2'
import type { CanvasHostHandle } from '@mini-canvas/canvas-core-v2'
import { canvasCommandsPlugin } from '../src/plugins/canvasCommands'
import { nodeTextPlugin } from '@mini-canvas/plugin-node-text'
import { nodeImagePlugin } from '@mini-canvas/plugin-node-image'
import { themeDefaultPlugin } from '@mini-canvas/plugin-theme-default'
import type { TextNodeService } from '@mini-canvas/plugin-node-text'
import type { ImageNodeService } from '@mini-canvas/plugin-node-image'
import { bindBrowserLifecycleFlush } from './browserFlush'
import type { BrowserFlushHandle } from './browserFlush'
import CustomEdge from '../src/components/CustomEdge.vue'
import { EDGE_VISUAL_KEY, EDGE_SELECTION_KEY, type EdgeVisual } from '../src/components/edgeContext'

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
const host = shallowRef<CanvasHostHandle | undefined>()
const flushHandle = ref<BrowserFlushHandle>()
const hotSubs: Array<{ dispose(): void }> = [] // 插件装载事件订阅(卸载时清理)
// setup 阶段同步 provide 宿主引用（boot 异步完成后填充），内容组件经 inject(HOST_KEY).value 取
provide(HOST_KEY, host)

// 节点展示注册表：demo 自建一个并同步 provide，同时传入 bootCanvas → 插件 apply 经
// ctx.get('nodeRegistry') 把 content 组件注册进来（宿主零手 seed）。BaseNode 壳经本表解析 content。
const registry = new NodeRegistry()
provide(NODE_REGISTRY_KEY, registry)
// 标题就地重命名写回：改内核 nodeStore data 并落盘；整体替换 nodes 数组触发 VueFlow 更新渲染态
provide(NODE_WRITE_KEY, (id: string, patch: Record<string, unknown>) => {
  const h = host.value
  if (!h) return
  if (!nodes.value.some((f) => f.id === id)) return
  nodes.value = nodes.value.map((f) =>
    f.id === id ? { ...f, data: { ...f.data, ...patch } } : f,
  )
  const existing = h.nodeStore.getNode(id)
  if (existing) h.nodeStore.updateNodeData(id, patch) // updateNodeData 为 patch 语义
  void h.save.set('graph', h.nodeStore.getNodes(), 'canvas')
})

// VueFlow 的响应式节点/边（渲染态）
const nodes = ref<FlowNode[]>([])
const edges = ref<Array<{ id: string; type?: string; source: string; target: string }>>([])
const selectedIds = ref<Set<string>>(new Set<string>())

// 业务 type → 壳组件：所有节点都经 BaseNode(壳)渲染，BaseNode 按 node.type 经 NodeRenderer 解析 content。
// nodeTypes 是响应式的：从内核 nodeStore 已注册 type 动态生成，热装/热卸插件新增/移除类型后自动增减，
// 新增类型无需改这段代码(宿主零硬编码)。
const nodeTypes = ref<Record<string, unknown>>({})
const nodeEpoch = ref(0) // 插件变更后 bump → 触发 VueFlow 子树重挂，让 content 解析用最新注册表
// 当前用的"节点外壳组件"：宿主默认 BaseNode；主题插件注册了 nodeShell 则用它（applyTheme 设置）。
const nodeShell = ref<unknown>(BaseNode)
/** 按 nodeStore 已注册 type 重建 nodeTypes + 触发重挂（宿主新增/热卸插件后调用） */
function syncNodeTypes(): void {
  const map: Record<string, unknown> = {}
  for (const t of host.value?.nodeStore.types.keys() ?? []) map[t] = nodeShell.value
  nodeTypes.value = map
  nodeEpoch.value += 1
}
/** 读主题插件注册的 nodeShell/edge/background 槽位，装配 VueFlow 渲染（主题没给则回退宿主默认） */
function applyTheme(): void {
  const theme = host.value?.themeRegistry
  if (!theme) return
  const shell = theme.get('nodeShell')
  if (shell) nodeShell.value = shell // 主题外壳替换 BaseNode
  const edge = theme.get('edge')
  edgeTypes.value = { custom: (edge as unknown) || CustomEdge } // 主题边 or 宿主默认 CustomEdge
  backgroundComp.value = theme.get('background')
}
// 边类型：所有边走 CustomEdge(自定义边)。可被主题插件经 themeRegistry 换掉。
// edgeTypes 是响应式的：boot 后从 themeRegistry 读主题提供的 edge/background 装配。
// 主题没提供就回退宿主默认(CustomEdge / 无背景)。
const edgeTypes = ref<Record<string, unknown>>({ custom: CustomEdge })
const backgroundComp = ref<unknown>(undefined)
// —— 调试配置面板数据：一个响应式根对象，分 edge/handle 命名空间。
//    SettingsPanel 直接改写它；分别 provide 给 CustomEdge(EDGE_VISUAL_KEY)/BaseNode+端口(CANVAS_PARAMS_KEY)，
//    消费方 computed 会实时追踪改动 → 面板即调即见效果。
//    默认值对齐 contract §0（edgeColor #3b82f6 / bezier / lineWidth 2 / 流光开 / 箭头默认关 / handle 尺寸）。
const cfg = reactive<{
  edge: EdgeVisual
  handle: {
    handleRadius: number
    handleRestOffset: number
    handleCursorGap: number
    handleButtonSize: number
    handleOverlap: number
  }
}>({
  edge: {
    edgeType: 'bezier',
    edgeLineWidth: 2,
    edgeColor: '#3b82f6',
    edgeDashed: false,
    edgeAnimated: true,
    edgeMarkerEnd: false,
    edgeGlowEnabled: true,
    edgeGlowIntensity: 1,
  },
  handle: {
    handleRadius: 86,
    handleRestOffset: 36,
    handleCursorGap: 24,
    handleButtonSize: 32,
    handleOverlap: 16,
  },
})
// 自定义边外观 / 浮动端口尺寸：随 cfg 实时注入
provide(EDGE_VISUAL_KEY, cfg.edge)
provide(CANVAS_PARAMS_KEY, cfg.handle)
// 选中集合注入给 CustomEdge：节点被选 → 相连边高亮流光
const emptyEdgeSel = ref<ReadonlySet<string>>(new Set())
provide(EDGE_SELECTION_KEY, { selectedNodeIds: selectedIds, selectedEdgeIds: emptyEdgeSel })

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
  edges.value = edges.value
    .filter((e) => e.id !== id)
    .concat([{ id, type: 'custom', source: conn.source, target: conn.target }])
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
    // 用可复用门面建宿主：冷启动插件在 coldPlugins 里给全(顺序即装载序)，宿主不手 seed content。
    // 门面把 runtime 暴露到 window.MiniCanvas，源码插件 / 打包 js 插件都经 window.MiniCanvas.installPlugin 安装。
    const { host: h, exposeToWindow } = await createMiniCanvasHost({
      adapter: new LocalStorageAdapter(),
      coldPlugins: [themeDefaultPlugin, nodeTextPlugin, nodeImagePlugin, canvasCommandsPlugin], // 主题+业务插件都在这
      nodeRegistry: registry, // demo 同步 provide 的展示注册表，插件 setup 往里注册 content
    })
    exposeToWindow('MiniCanvas') // window.MiniCanvas = { installPlugin/uninstallPlugin/reloadPlugin/... }
    host.value = h

    // 存储为空(首次) → seed 默认 text+image 并落盘；非空则门面已 restore
    if (h.nodeStore.getNodes().length === 0) {
      const textId = h.ctx.get<TextNodeService>('text').addTextNode({ x: 80, y: 80 })
      const imgId = h.ctx.get<ImageNodeService>('image').addImageNode({ x: 500, y: 120 }, SAMPLE_IMG)
      h.nodeStore.updateNodeData(textId, { text: SAMPLE_TEXT })
      await h.save.flush()
      // 示例边：让首屏即展示 CustomEdge(自定义边)的流光观感（纯视觉态，未落盘）
      nodes.value = storeToFlow()
      edges.value = [{ id: `e-${textId}-${imgId}`, type: 'custom', source: textId, target: imgId }]
    } else {
      nodes.value = storeToFlow()
    }
    applyTheme() // 先读主题插件注册的 nodeShell/edge/background
    syncNodeTypes() // 再按 nodeStore type + 当前 nodeShell 生成 nodeTypes + bump epoch

    // 宿主订阅插件装载事件：热装/热卸/热重载插件后应用主题 + 重建 nodeTypes + 触发 VueFlow 重挂(改动实时生效)
    hotSubs.push(h.ctx.on('ctx:plugin-installed', () => { applyTheme(); syncNodeTypes() }))
    hotSubs.push(h.ctx.on('ctx:plugin-uninstalled', () => { applyTheme(); syncNodeTypes() }))

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
  for (const s of hotSubs) s.dispose()
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

    <!-- 右上角调试配置面板（对齐主项目 DynamicSettingsPanel） -->
    <SettingsPanel :model="cfg" />

    <div v-if="booting" class="status">正在启动内核…</div>
    <div v-else-if="bootError" class="status err">启动失败：{{ bootError }}</div>

    <div v-else class="canvas-wrap">
      <VueFlow
        :key="nodeEpoch"
        :nodes="nodes"
        :edges="edges"
        :node-types="nodeTypes"
        :edge-types="edgeTypes"
        :is-valid-connection="isValidConnection"
        :min-zoom="0.2"
        :max-zoom="2"
        @connect="onConnect"
        @node-click="onNodeClick"
        @node-drag-stop="onNodeDragStop"
        @pane-click="onPaneClick"
        @node-context-menu="onNodeContextMenu"
        @pane-context-menu="onPaneContextMenu"
      >
        <!-- 主题插件提供的画布背景（低层叠加，垫在节点之下；没提供则空） -->
        <component :is="backgroundComp" v-if="backgroundComp" />
      </VueFlow>

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
  /* 卡片外观由 BaseNode 的 .v2-card 统一负责；这里只保留布局与光标 */
  font-size: 14px;
  background: transparent;
  border: none;
  box-shadow: none;
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
