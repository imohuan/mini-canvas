<script setup lang="ts">
// plugin-load-dev-app.vue —— 把宿主 nodeStore 里节点渲染成 VueFlow 画布(theme 壳)。
// 纯展示：宿主/插件状态都来自 ./plugin-load-dev.ts 导出的 state。
// 每次 state.epoch 变(首装/热更后)：清掉旧 text 节点 → 用当前插件实现重建一个 → 渲染。
import { markRaw, onMounted, provide, reactive, ref, watch } from 'vue'
import { VueFlow } from '@vue-flow/core'
import type { Edge, Node } from '@vue-flow/core'
import {
  HOST_KEY,
  NODE_REGISTRY_KEY,
  RENDER_CONTEXT_KEY,
  type CanvasRenderContext,
  type CanvasHostHandle,
  DEFAULT_EDGE_VISUAL,
  DEFAULT_HANDLE_VISUAL,
} from '@mini-canvas/canvas-render'
import type { Context, NodeRegistry } from '@mini-canvas/canvas-core-v2'
import { state } from './plugin-load-dev'

const nodes = ref<Node[]>([])
const edges = ref<Edge[]>([])
const nodeTypes = ref<Record<string, unknown>>({})
const edgeTypes = ref<Record<string, unknown>>({})
const backgroundComp = ref<unknown>(undefined)

// —— provide 给 content 组件/主题壳：宿主句柄 + 节点展示注册表 ——
provide(HOST_KEY, state.hostRef as never)
provide(NODE_REGISTRY_KEY, (state.host as { nodeRegistry: unknown })?.nodeRegistry)

// 渲染上下文（CanvasRenderContext）：本页自建 VueFlow、绕过 CanvasHost，故手动补 provide。
// BaseNode/壳/边/content(theme/node-text) 现在都经 useCanvasRender() 取上下文，缺 RENDER_CONTEXT_KEY 会抛。
// ctx/host 用真实宿主(createMiniCanvasHost 建)；外观用默认值(本页无设置面板)；选中集置空。
const hostRefLoose = state.host as unknown as {
  ctx: Context
  nodeRegistry: NodeRegistry
}
const emptySel = ref<ReadonlySet<string>>(new Set())
const renderCtx: CanvasRenderContext = {
  ctx: hostRefLoose.ctx,
  host: state.hostRef.value as CanvasHostHandle,
  registry: hostRefLoose.nodeRegistry as NodeRegistry,
  // 就地重命名写回：走内核 nodeStore + save（与 CanvasHost.defaultWrite 同语义）
  nodeWrite: (id, patch) => {
    const ctx = hostRefLoose.ctx
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ns = ctx.get<any>('nodeStore')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const save = ctx.get<any>('save')
    const node = ns?.getNode?.(id)
    if (!node) return
    ns.updateNodeData(id, patch)
    void save.set('graph', ns.getNodes(), 'canvas')
  },
  handleParams: reactive({ ...DEFAULT_HANDLE_VISUAL }),
  edgeVisual: reactive({ ...DEFAULT_EDGE_VISUAL }),
  edgeSelection: { selectedNodeIds: emptySel, selectedEdgeIds: emptySel },
}
provide(RENDER_CONTEXT_KEY, renderCtx)

function rebuildTextNode() {
  const store = state.api.getNodeStore()
  for (const n of store.getNodes()) if (n.type === 'text') store.removeNode(n.id)
  const svc = state.api.getContext().get<{ addTextNode(p: { x: number; y: number }): string }>('text')
  svc.addTextNode({ x: 260, y: 160 })
}

/** 从宿主 theme 槽位 + nodeStore 装配 VueFlow 渲染 */
function sync() {
  const host = state.host as { themeRegistry: { get(s: string): unknown } } | null
  if (!host) return
  const theme = host.themeRegistry
  const shell = theme.get('nodeShell')
  const edge = theme.get('edge')
  const bg = theme.get('background')
  const store = state.api.getNodeStore()
  nodeTypes.value = {}
  // 壳/内容组件不能放进 ref/reactive，否则 Vue 告警"Component made reactive"→ 用 markRaw 包住。
  for (const n of store.getNodes()) nodeTypes.value[n.type] = markRaw(shell)
  edgeTypes.value = { custom: markRaw(edge) }
  backgroundComp.value = markRaw(bg)
  nodes.value = store.getNodes().map((n) => ({
    id: n.id,
    type: n.type,
    position: { ...n.position },
    data: { ...(n.data as Record<string, unknown>) },
  })) as unknown as Node[]
}

onMounted(() => {
  rebuildTextNode()
  sync()
})

// epoch 变(热更后) → 重建节点(新实现) + 重装配
watch(
  () => state.epoch.value,
  () => {
    rebuildTextNode()
    sync()
  },
)
</script>

<template>
  <div style="height: 100vh; font-family: system-ui, sans-serif">
    <div
      style="
        padding: 6px 12px; border-bottom: 1px solid #ddd; background: #fff; color: #2563eb;
        font-size: 13px; z-index: 10;
      "
    >
      宿主(5199) ←跨端口← text 插件 dev(5311)：改插件源码即热更，无需刷新
    </div>
    <VueFlow
      :key="state.epoch.value"
      :nodes="nodes"
      :edges="edges"
      :node-types="nodeTypes"
      :edge-types="edgeTypes"
    >
      <component :is="backgroundComp" v-if="backgroundComp" />
    </VueFlow>
  </div>
</template>
