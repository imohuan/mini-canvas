<script setup lang="ts">
// plugin-theme-default 预览 App —— 自己起个 VueFlow 渲染主题壳/边/背景 + 示例节点。
import { onMounted, ref } from 'vue'
import { VueFlow } from '@vue-flow/core'
import type { Node, Edge } from '@vue-flow/core'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import { createMiniCanvasHost, NodeRegistry } from '@mini-canvas/canvas-core-v2'
import type { CanvasHostHandle } from '@mini-canvas/canvas-core-v2'
import { themeDefaultPlugin } from '../src/index'
import { nodeTextPlugin } from '@mini-canvas/plugin-node-text'
import { nodeImagePlugin } from '@mini-canvas/plugin-node-image'

const host = ref<CanvasHostHandle>()
const nodes = ref<Node[]>([])
const edges = ref<Edge[]>([])
const nodeTypes = ref<Record<string, unknown>>({})
const edgeTypes = ref<Record<string, unknown>>({})
const backgroundComp = ref<unknown>(undefined)
const epoch = ref(0)

const sampleImg = () =>
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#ddd6fe"/><text x="60" y="90" font-family="sans-serif" fill="#7c3aed">主题预览 image</text></svg>`,
  )

onMounted(async () => {
  const registry = new NodeRegistry()
  const { host: h, exposeToWindow } = await createMiniCanvasHost({
    coldPlugins: [themeDefaultPlugin, nodeTextPlugin, nodeImagePlugin],
    nodeRegistry: registry,
  })
  host.value = h
  exposeToWindow('MiniCanvasThemePreview')

  const theme = h.themeRegistry
  const shell = theme.get('nodeShell')
  const edge = theme.get('edge')
  const bg = theme.get('background')
  for (const t of h.nodeStore.types.keys()) nodeTypes.value[t] = shell as unknown
  edgeTypes.value = { custom: (edge as unknown) || undefined }
  backgroundComp.value = bg

  const textId = h.ctx.get<{ addTextNode(p: { x: number; y: number }): string }>('text').addTextNode({ x: 160, y: 160 })
  const imgId = h.ctx.get<{ addImageNode(p: { x: number; y: number }, u: string): string }>('image').addImageNode({ x: 560, y: 160 }, sampleImg())
  nodes.value = h.nodeStore.getNodes().map((n) => ({
    id: n.id,
    type: n.type,
    position: { ...n.position },
    data: { ...(n.data as Record<string, unknown>) },
  }))
  edges.value = [{ id: `e-${textId}-${imgId}`, type: 'custom', source: textId, target: imgId }]
  epoch.value++
})
</script>

<template>
  <div style="height: 100vh; font-family: system-ui, sans-serif">
    <div v-if="host" class="bar">plugin-theme-default 独立预览（壳+端口 / 连线 / 背景全来自本插件）</div>
    <VueFlow
      :key="epoch"
      :nodes="nodes"
      :edges="edges"
      :node-types="nodeTypes"
      :edge-types="edgeTypes"
    >
      <component :is="backgroundComp" v-if="backgroundComp" />
    </VueFlow>
  </div>
</template>

<style scoped>
.bar {
  padding: 8px 12px;
  border-bottom: 1px solid #ddd;
  background: #fff;
  color: #6d28d9;
  font-size: 13px;
  z-index: 10;
}
</style>
