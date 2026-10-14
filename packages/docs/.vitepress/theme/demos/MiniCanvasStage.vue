<script setup lang="ts">
/**
 * MiniCanvasStage —— 在文档页里挂一块**真的小画布**。
 *
 * 为什么用真宿主而不是假上下文：默认主题的组件（节点壳 / 连线 / 背景 / 拖线临时线 / 浮动端口）
 * 本来就是"宿主里的东西"，硬造上下文只能看到个大概。挂一块真画布，这些组件就是**真的在跑** ——
 * 你能拖节点、看流光、拉连线。
 *
 * 它装的是自带插件（默认主题 + 图片节点 + 文本节点），存储用内存适配器（刷新即丢，不碰用户数据）。
 */
import { CanvasHost } from '@mini-canvas/canvas-render'
// 样式三件套：VueFlow 自身样式 + 画布通用 UI token + 默认主题的节点变量
import '@vue-flow/core/dist/style.css'
import '@mini-canvas/canvas-render/styles/ui-theme.css'
import '@mini-canvas/plugin-theme-default/styles/node-theme.css'
import { themeDefaultPlugin } from '@mini-canvas/plugin-theme-default'
import { nodeImagePlugin } from '@mini-canvas/plugin-node-image'
import { nodeTextPlugin } from '@mini-canvas/plugin-node-text'
import { MemoryStorageAdapter, GRAPH_KEY, GRAPH_EDGES_KEY, scopedKey, type CanvasNode, type CanvasEdge } from '@mini-canvas/canvas-data'

const props = withDefaults(defineProps<{ height?: number }>(), { height: 420 })

const plugins = [themeDefaultPlugin, nodeImagePlugin, nodeTextPlugin]

// 默认内容：两个文本框 + 一条连线 —— 让"节点壳 / 连线 / 背景 / 浮动端口"都看得见
const DEFAULT_NODES: CanvasNode[] = [
  { id: '1', type: 'text', position: { x: 60, y: 60 }, data: { text: '这是文档页里的真画布\n拖动我试试' } },
  { id: '2', type: 'text', position: { x: 420, y: 220 }, data: { text: '两个节点之间有一条真的连线' } },
]
const DEFAULT_EDGES: CanvasEdge[] = [
  { id: 'e1', source: '1', target: '2', sourceHandle: 'source', targetHandle: 'target' },
]

/**
 * 预置内容的存储：内存适配器（不碰用户数据），但先把默认节点与连线写进去 ——
 * 这样画布一挂载就有东西可看，而不是一张空白底。
 */
function makeAdapter(): MemoryStorageAdapter {
  const adapter = new MemoryStorageAdapter()
  // 注意：adapter 是**物理层**，存的是带 type 前缀的物理 key（save 层才认裸 key）。
  // 直接写裸 'graph' 读不到 —— 画布会是空的。这里用 scopedKey 拼出真实物理名。
  void adapter.set(scopedKey('canvas', GRAPH_KEY), DEFAULT_NODES)
  void adapter.set(scopedKey('canvas', GRAPH_EDGES_KEY), DEFAULT_EDGES)
  return adapter
}

const adapter = makeAdapter()
</script>

<template>
  <ClientOnly>
    <div class="mc-stage" :style="{ height: (props.height ?? 420) + 'px' }">
      <CanvasHost :plugins="plugins" :adapter="adapter" :persist-viewport="false" />
    </div>
    <template #fallback>
      <div class="mc-stage mc-stage--loading" :style="{ height: (props.height ?? 420) + 'px' }">
        画布在浏览器里挂载…
      </div>
    </template>
  </ClientOnly>
</template>

<style scoped>
.mc-stage {
  position: relative;
  overflow: hidden;
  border-radius: 12px;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-soft);
}
.mc-stage--loading {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--vp-c-text-3);
  font-size: 13px;
}
</style>

