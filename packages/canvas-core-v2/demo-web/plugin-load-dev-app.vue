<script setup lang="ts">
// plugin-load-dev-app.vue —— 把宿主 nodeStore 里节点渲染成 VueFlow 画布(theme 壳)。
// 纯展示：宿主/插件状态都来自 ./plugin-load-dev.ts 导出的 state。
// 每次 state.epoch 变(首装/热更后)：清掉旧 text 节点 → 用当前插件实现重建一个 → 渲染。
import { markRaw, onMounted, provide, ref, watch } from 'vue'
import { VueFlow } from '@vue-flow/core'
import type { Edge, Node } from '@vue-flow/core'
import { HOST_KEY, NODE_REGISTRY_KEY } from '@mini-canvas/canvas-render'
import { state } from './plugin-load-dev'

const nodes = ref<Node[]>([])
const edges = ref<Edge[]>([])
const nodeTypes = ref<Record<string, unknown>>({})
const edgeTypes = ref<Record<string, unknown>>({})
const backgroundComp = ref<unknown>(undefined)

// —— provide 给 content 组件/主题壳：宿主句柄 + 节点展示注册表 ——
provide(HOST_KEY, state.hostRef as never)
provide(NODE_REGISTRY_KEY, (state.host as { nodeRegistry: unknown })?.nodeRegistry)

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
