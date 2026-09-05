<script setup lang="ts">
// plugin-theme-default 独立预览 —— 用官方 CanvasHost 一行渲染"默认主题"壳/边/背景 + 示例节点。
// 相比手写装配版：不再自起 VueFlow / provide 令牌 / 从 themeRegistry 取壳边背景 / 同步渲染态——
// 全部收进 @mini-canvas/canvas-core-v2 的 CanvasHost 组件。这里只 seed 两个示例节点即可。
import { ref } from 'vue'
import { CanvasHost } from '@mini-canvas/canvas-core-v2'
import type { CanvasNode } from '@mini-canvas/canvas-core-v2'
import { themeDefaultPlugin } from '../src/index'
import { nodeTextPlugin } from '@mini-canvas/plugin-node-text'
import { nodeImagePlugin } from '@mini-canvas/plugin-node-image'
import { canvasCommandsPlugin } from '@mini-canvas/canvas-core-v2'

const sampleImg = () =>
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#ddd6fe"/><text x="60" y="90" font-family="sans-serif" fill="#7c3aed">主题预览 image</text></svg>`,
  )

// 首次(存储空)默认图：text + image 两节点，展示壳(端口/标题/就地改名) + content。
function seedDefault(): CanvasNode[] {
  return [
    { id: '1', type: 'text', position: { x: 160, y: 160 }, data: { text: '双击我输入内容\n\n· 拖圆点连线' } },
    { id: '2', type: 'image', position: { x: 560, y: 160 }, data: { imageUrl: sampleImg() } },
  ]
}

const ready = ref(false)
</script>

<template>
  <div class="preview-root">
    <div v-if="ready" class="bar">plugin-theme-default 独立预览（壳+端口 / 连线 / 背景全来自本插件 · 装配逻辑全在 CanvasHost）</div>
    <CanvasHost
      class="canvas-area"
      :plugins="[themeDefaultPlugin, nodeTextPlugin, nodeImagePlugin, canvasCommandsPlugin]"
      :seed="seedDefault"
      window-key="MiniCanvasThemePreview"
      @ready="ready = true"
    />
  </div>
</template>

<style scoped>
.preview-root {
  height: 100vh;
  display: flex;
  flex-direction: column;
  font-family: system-ui, sans-serif;
}
.bar {
  padding: 8px 12px;
  border-bottom: 1px solid #ddd;
  background: #fff;
  color: #6d28d9;
  font-size: 13px;
  z-index: 10;
}
.canvas-area {
  flex: 1;
  min-height: 0;
}
</style>
