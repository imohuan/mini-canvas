<script setup lang="ts">
// CanvasDemo —— v2 画布 demo（消费 CanvasHost 的薄业务壳）。
//
// 职责：演示如何用 CanvasHost 一行渲染画布，外层只留 demo 业务 UI（工具栏 / SettingsPanel / 右键菜单）。
// 相比旧版：不再手写 VueFlow 装配 / provide 令牌 / store↔flow 双向同步 / 键盘事件——全部收进 CanvasHost。
// 数据改动(建/删/撤销/拖拽/编辑)经 nodeStore.subscribe 在 CanvasHost 内部自动刷渲染态，demo 无需手动同步。
//
// 边界：CanvasHost 不内置业务工具栏/菜单(建哪些节点是 app 层的事)，demo 经 CanvasHost 暴露的 host 驱动命令。
import { reactive, ref } from 'vue'
import type { PluginModule } from '../src/core'
import type { StorageAdapter } from '../src/services/storage/types'
import { LocalStorageAdapter } from '../src/services/storage/localStorageAdapter'
import type { CanvasNode } from '../src/services/nodeStore'
import CanvasHost from '../src/host/CanvasHost.vue'
import { themeDefaultPlugin } from '@mini-canvas/plugin-theme-default'
import { nodeTextPlugin } from '@mini-canvas/plugin-node-text'
import { nodeImagePlugin } from '@mini-canvas/plugin-node-image'
import { canvasCommandsPlugin } from '../src/plugins/canvasCommands'
import { DEFAULT_EDGE_VISUAL, DEFAULT_HANDLE_VISUAL } from '../src/host/canvasHostCore'
import SettingsPanel from './SettingsPanel.vue'

// —— demo 外观配置：给 SettingsPanel 实时调(边/连接点)，并传给 CanvasHost 实时生效 ——
const cfg = reactive({
  edge: { ...DEFAULT_EDGE_VISUAL },
  handle: { ...DEFAULT_HANDLE_VISUAL },
})

// —— 组装插件 + 存储（CanvasHost 冷启动）——
const plugins: PluginModule[] = [themeDefaultPlugin, nodeTextPlugin, nodeImagePlugin, canvasCommandsPlugin]
const adapter: StorageAdapter = new LocalStorageAdapter()

const SAMPLE_IMG =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240"><rect width="320" height="240" fill="#dbeafe"/><text x="160" y="118" font-family="sans-serif" font-size="20" fill="#1d4ed8" text-anchor="middle">v2 image 节点</text><text x="160" y="142" font-family="sans-serif" font-size="13" fill="#64748b" text-anchor="middle">data.imageUrl</text></svg>`,
  )
const SAMPLE_TEXT = '双击我输入内容\n\n· 从左右圆点可拖出连线\n· 拖动节点可移动\n· 点节点再按 Delete 删除'

// 首次(存储空)默认图：text + image 两节点。type 在 coldPlugins 已注册；返回数字 id 节点即 replaceAll。
function seedDefault(): CanvasNode[] {
  return [
    { id: '1', type: 'text', position: { x: 120, y: 120 }, data: { text: SAMPLE_TEXT } },
    { id: '2', type: 'image', position: { x: 560, y: 160 }, data: { imageUrl: SAMPLE_IMG } },
  ]
}

// —— 画布宿主句柄（经 CanvasHost 暴露）——
const hostEl = ref<InstanceType<typeof CanvasHost> | null>(null)
const booted = ref(false)
function onReady(): void {
  booted.value = true
}

// 右键菜单状态：由 CanvasHost 透传坐标 + kind
const menu = ref<{ visible: boolean; x: number; y: number; nodeId?: string }>({ visible: false, x: 0, y: 0 })
function onContextMenu(p: { kind: 'node' | 'pane'; clientX: number; clientY: number; nodeId?: string }): void {
  closeMenu()
  menu.value = { visible: true, x: p.clientX, y: p.clientY, nodeId: p.nodeId }
}
function closeMenu(): void {
  menu.value.visible = false
}

// —— 业务命令（经 CanvasHost 的 host 驱动；nodeStore 变化自动刷渲染态，无需手动 sync）——
function createNode(type: 'text' | 'image'): void {
  const host = hostEl.value?.host
  if (!host) return
  const count = host.nodeStore.getNodes().length
  const payload: { type: string; position: { x: number; y: number }; imageUrl?: string } = {
    type,
    position: { x: 80 + count * 48, y: 80 + count * 48 },
  }
  if (type === 'image') payload.imageUrl = SAMPLE_IMG
  host.command.execute('command:create-node', payload)
}
function deleteSelected(): void {
  const host = hostEl.value?.host
  if (!host) return
  host.command.execute('command:delete') // 读 host.selection（CanvasHost 已把 node-click 同步进来）
}
function undo(): void {
  hostEl.value?.host?.command.execute('command:undo')
}
function redo(): void {
  hostEl.value?.host?.command.execute('command:redo')
}
function menuAct(fn: () => void): void {
  closeMenu()
  fn()
}
</script>

<template>
  <div class="demo-root">
    <div class="toolbar">
      <button :disabled="!booted" @click="createNode('text')">+ 文本</button>
      <button :disabled="!booted" @click="createNode('image')">+ 图片</button>
      <button :disabled="!booted" @click="deleteSelected">删除选中 (Delete)</button>
      <button :disabled="!booted" @click="undo">↶ 撤销</button>
      <button :disabled="!booted" @click="redo">↷ 重做</button>
      <span class="hint">拖节点移动 · 从圆点拖出连线 · 双击文本编辑 · 右键菜单 · Ctrl+Z 撤销 · 刷新不丢</span>
    </div>

    <!-- 右上角调试配置面板（实时调边/连接点外观） -->
    <SettingsPanel :model="cfg" />

    <div class="canvas-wrap">
      <CanvasHost
        ref="hostEl"
        :plugins="plugins"
        :adapter="adapter"
        :seed="seedDefault"
        :edge-visual="cfg.edge"
        :handle-visual="cfg.handle"
        :min-zoom="0.2"
        :max-zoom="2"
        window-key="MiniCanvas"
        @ready="onReady"
        @context-menu="onContextMenu"
      />
    </div>

    <!-- 最小右键菜单（业务：建节点 / 删除选中 / 撤销） -->
    <div v-if="menu.visible" class="ctx-menu" :style="{ left: menu.x + 'px', top: menu.y + 'px' }">
      <div class="ctx-item" @click="menuAct(() => createNode('text'))">+ 文本节点</div>
      <div class="ctx-item" @click="menuAct(() => createNode('image'))">+ 图片节点</div>
      <div class="ctx-sep"></div>
      <div class="ctx-item" @click="menuAct(deleteSelected)">删除选中</div>
      <div class="ctx-item" @click="menuAct(undo)">撤销</div>
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
.canvas-wrap {
  flex: 1;
  position: relative;
  min-height: 0;
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
