<script setup lang="ts">
// CanvasDemo —— v2 画布 demo（消费 CanvasHost 的薄业务壳）。
//
// 职责：演示如何用 CanvasHost 一行渲染画布，外层只留 demo 业务 UI（工具栏 / SettingsPanel / 右键菜单）。
// 相比旧版：不再手写 VueFlow 装配 / provide 令牌 / store↔flow 双向同步 / 键盘事件——全部收进 CanvasHost。
// 数据改动(建/删/撤销/拖拽/编辑)经 nodeStore.subscribe 在 CanvasHost 内部自动刷渲染态，demo 无需手动同步。
//
// 边界：CanvasHost 不内置业务工具栏/菜单(建哪些节点是 app 层的事)，demo 经 CanvasHost 暴露的 host 驱动命令。
import { onBeforeUnmount, reactive, ref } from 'vue'
import type { PluginModule } from '../src/core'
import type { StorageAdapter } from '../src/services/storage/types'
import { LocalStorageAdapter } from '../src/services/storage/localStorageAdapter'
import type { CanvasNode } from '../src/services/nodeStore'
import type { SettingsStore } from '@mini-canvas/canvas-core-v2'
import { CanvasHost, PluginSettingsPanel, DEFAULT_HANDLE_VISUAL } from '@mini-canvas/canvas-render'
import { themeDefaultPlugin, DEFAULT_THEME_EDGE, EDGE_SETTING_KEYS } from '@mini-canvas/plugin-theme-default'
import { nodeTextPlugin } from '@mini-canvas/plugin-node-text'
import { nodeImagePlugin } from '@mini-canvas/plugin-node-image'
import { canvasCommandsPlugin } from '@mini-canvas/plugin-canvas-commands'
import SettingsPanel from './SettingsPanel.vue'
import { overlayCornerAPlugin, overlayCornerBPlugin } from './overlayPlugins'

// —— demo 外观配置：浮动端口给 SettingsPanel 实时调；连线外观改由 PluginSettingsPanel 走 theme-default 申报的
//    ctx.settings（单一数据源），见下方 bindThemeSettings ——
const cfg = reactive({
  // 连线外观初始值与 theme-default 申报的默认值一致；后续只由设置面板的 set→onChange 窄更新到"对应那一处"。
  edge: { ...DEFAULT_THEME_EDGE },
  handle: { ...DEFAULT_HANDLE_VISUAL },
})

// —— 组装插件 + 存储（CanvasHost 冷启动）——
// 末尾两个 overlayCorner* 是 Goal A"开放 UI 槽同屏按序渲染"的验证插件(同一 'overlay' 槽、order 0/1)
const plugins: PluginModule[] = [
  themeDefaultPlugin,
  nodeTextPlugin,
  nodeImagePlugin,
  canvasCommandsPlugin,
  overlayCornerAPlugin,
  overlayCornerBPlugin,
]
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

// —— 分组配置(主题外观)面板的数据源：boot 后取宿主共享的 settings store(theme-default 已在 apply 申报两组) ——
const settingsStore = ref<SettingsStore | null>(null)
let disposeSettingsBind: (() => void) | undefined

function onReady(): void {
  booted.value = true
  bindThemeSettings()
}

/**
 * 把 theme-default 申报的连线配置绑定到实时外观(cfg.edge)：
 * - 初始：把 settings 里当前值灌进 cfg.edge（theme 是单一数据源，改过则以改过为准）；
 * - 订阅：settings.set(key, value) 触发后，只把"声明过的那一项"窄更新到 cfg.edge 对应字段
 *   （Vue 响应式 → 只重绘受影响连线，无全图重建；也是 B2 性能约束②的 demo 侧落地）。
 * 仅处理 theme 声明过的 edge 键，避免把外来键误塞进 edge 视觉。
 */
function bindThemeSettings(): void {
  const ctx = hostEl.value?.host?.ctx
  if (!ctx) return
  const store = ctx.get<SettingsStore>('settings')
  settingsStore.value = store
  // ① 初始同步：theme 声明的各键当前值 → cfg.edge（单一数据源优先）
  for (const k of EDGE_SETTING_KEYS) {
    const v = store.get(k as string)
    if (v !== undefined) (cfg.edge as unknown as Record<string, unknown>)[k] = v
  }
  // ② 订阅变更窄更新（不限 scope=全局；但只认 theme 声明的 edge 键 → 天然只动连线那几处）
  disposeSettingsBind = store.onChange((key, value) => {
    if (!EDGE_SETTING_KEYS.includes(key as (typeof EDGE_SETTING_KEYS)[number])) return
    ;(cfg.edge as unknown as Record<string, unknown>)[key] = value
  }).dispose
}
function unbindThemeSettings(): void {
  disposeSettingsBind?.()
  disposeSettingsBind = undefined
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
onBeforeUnmount(unbindThemeSettings)
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
    <!-- 插件申报的分组配置面板：theme-default 在 apply 里 ctx.settings.define 声明了连线外观(连线/动效两组)，
         schema 自动长控件；改动经 set→onChange 窄更新到 cfg.edge → 只重绘对应连线、无全图重建。
         固定浮层，叠在右下角(与左上 debug 面板区分) -->
    <div v-if="settingsStore" class="theme-settings-dock">
      <PluginSettingsPanel :settings="settingsStore" />
    </div>

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
.theme-settings-dock {
  position: fixed;
  right: 12px;
  bottom: 12px;
  width: 260px;
  max-height: 46vh;
  overflow-y: auto;
  background: rgba(255, 255, 255, 0.94);
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 12px;
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.12);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  padding: 12px 14px;
  z-index: 900;
  font-family: system-ui, "Microsoft YaHei", sans-serif;
}
.theme-settings-dock:empty {
  display: none;
}
</style>
