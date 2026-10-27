<!-- 文件：packages/docs/public/examples/canvas-render/canvas-host/src/App.vue
     格式：Vue 单文件组件
     位置：应用装配层 —— 挂画布 + 用 @ready 拿到的句柄驱动业务 -->
<script setup lang="ts">
import { ref, shallowRef } from 'vue'
import { CanvasHost, CanvasProvider, type CanvasHostHandle } from '@mini-canvas/canvas-render'
import { LocalStorageAdapter } from '@mini-canvas/canvas-data'
import { themeDefaultPlugin } from '@mini-canvas/plugin-theme-default'
import { nodeTextPlugin } from '@mini-canvas/plugin-node-text'
import { edge, handle } from './uiState'

// ① 装配清单：顺序即装载顺序（皮在前，业务节点在后）
const plugins = [themeDefaultPlugin, nodeTextPlugin]
const adapter = new LocalStorageAdapter()   // 刷新后画布还在

// ② 宿主句柄：@ready 之后才有值，所以用 shallowRef（组件句柄不该深代理）
const host = shallowRef<CanvasHostHandle | undefined>()
const canvas = ref<{ manager?: { list(): Array<{ name: string }> } } | null>(null)

function onReady(h: CanvasHostHandle) {
  host.value = h
  // ③ 顺手把「装了哪些插件」打到控制台，验证装配顺序
  console.log('已装插件：', h.ctx.listPlugins())
}

function addText() {
  // ④ 走命令（等价于快捷键 / 右键菜单那条公共入口）
  host.value?.command.execute('command:create-node', {
    type: 'text',
    position: { x: 260, y: 200 },
  })
}

function undo() {
  host.value?.command.execute('command:undo')
}

function toggleEdgeColor() {
  // ⑤ 改响应式外观对象 → 画布上连线立刻变色（不用重建宿主）
  edge.edgeColor = edge.edgeColor === '#3b82f6' ? '#16a34a' : '#3b82f6'
}
</script>

<template>
  <div style="width: 100vw; height: 100vh">
    <CanvasProvider
      :plugins="plugins"
      :adapter="adapter"
      :dev="import.meta.env.DEV"
      window-key="MiniCanvasHostDemo"
    >
      <CanvasHost
        ref="canvas"
        :edge-visual="edge"
        :handle-visual="handle"
        @ready="onReady"
        @plugin-issue="(p) => console.warn('插件出问题了：', p.name, p.lifecycle)"
      >
        <!-- ⑥ 业务 UI 放 #ui 里：这里的组件能 useCanvasRender() 读 ctx -->
        <template #ui>
          <div class="demo-bar">
            <button @click="addText">加文本节点</button>
            <button @click="undo">撤销</button>
            <button @click="toggleEdgeColor">换连线颜色</button>
          </div>
        </template>
      </CanvasHost>
    </CanvasProvider>
  </div>
</template>

<style scoped>
/* 浮在画布左上角的一条小工具条：定位自己负责，CanvasHost 不提供布局 */
.demo-bar { position: absolute; left: 12px; top: 12px; display: flex; gap: 6px; z-index: 30; }
.demo-bar button { padding: 4px 10px; border-radius: 6px; border: 1px solid var(--ui-line, #e2e5ea); cursor: pointer; }
</style>
