<script setup lang="ts">
/**
 * GalleryCanvasStage —— 展厅里嵌的**真画布**（节点壳 / 连线 / 背景 / 浮动端口只有在这里才跑得起来）。
 *
 * 为什么不能把它们直接塞进浮层：节点壳（BaseNode）是 VueFlow 渲染每个节点时套上去的壳，
 * 连线是 SVG 里画的边，背景要读视口 —— 它们都必须住在 <CanvasHost> 的渲染子树里。
 * 所以这里挂一块真的小画布，装默认主题 + 本插件的示例节点类型。
 *
 * 安全性：存储用内存适配器（刷新即丢），绝不碰用户数据；persistViewport 关掉。
 *
 * 为什么不用 <ClientOnly>：那是 VitePress / Nuxt 一类 SSR 框架提供的全局组件，本插件跑在
 * 纯浏览器画布宿主里，没有谁注册它 —— 写了只会让 Vue 报一句
 * "Failed to resolve component: ClientOnly"，然后把它当成未知原生元素直接渲染出来
 * （等于白写，还留一条控制台告警）。画布宿主本来就只在浏览器里跑，不需要这层 SSR 兜底。
 */
import { CanvasHost } from '@mini-canvas/canvas-render'
import { MemoryStorageAdapter, GRAPH_KEY, GRAPH_EDGES_KEY, scopedKey, type CanvasNode, type CanvasEdge } from '@mini-canvas/canvas-data'
import { themeDefaultPlugin } from '@mini-canvas/plugin-theme-default'
import { galleryDemoNodesPlugin } from './demoNodes'

withDefaults(defineProps<{ height?: number }>(), { height: 300 })

const plugins = [themeDefaultPlugin, galleryDemoNodesPlugin]

// 两块示例卡 + 一条连线：节点壳 / 端口 / 连线 / 背景一次看全
const NODES: CanvasNode[] = [
  { id: '1', type: 'demo-basic', position: { x: 40, y: 60 }, data: { text: '普通节点：标题 + 内容 + 端口' } },
  { id: '2', type: 'demo-toolbar', position: { x: 330, y: 190 }, data: { text: '这个节点带了 out:top 控制栏' } },
]
const EDGES: CanvasEdge[] = [
  // 端口 id 用 demo-basic/demo-toolbar 的默认端口（useNodeCapability 缺省 target/source）
  { id: 'e1', source: '1', target: '2', sourceHandle: 'source', targetHandle: 'target' },
]

/**
 * 预置内容的存储。注意 adapter 是**物理层**：存的是带 type 前缀的物理 key（save 层才认裸 key），
 * 所以这里用 scopedKey 拼真实物理名，否则读不到、画布会是空的。
 */
function makeAdapter(): MemoryStorageAdapter {
  const adapter = new MemoryStorageAdapter()
  void adapter.set(scopedKey('canvas', GRAPH_KEY), NODES)
  void adapter.set(scopedKey('canvas', GRAPH_EDGES_KEY), EDGES)
  return adapter
}

const adapter = makeAdapter()
</script>

<template>
  <div class="gcs-stage" :style="{ height: (height ?? 300) + 'px' }">
    <CanvasHost :plugins="plugins" :adapter="adapter" :persist-viewport="false" />
  </div>
</template>

<style scoped>
.gcs-stage {
  position: relative;
  overflow: hidden;
  border-radius: 12px;
  border: 1px solid rgba(0, 0, 0, 0.08); /* 主题色白名单: 展厅嵌画布的外框（展示容器） */
  background: #f8fafc; /* 主题色白名单: 画布底色（与 DefaultBackground 绘制基色同口径，暗色由 CSS invert 反相） */
}
</style>

