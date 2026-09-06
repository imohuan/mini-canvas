<script setup lang="ts">
// CanvasApp —— @mini-canvas/ui 自包含成品演示：一行 CanvasHost 渲染真实画布 + 设置面板。
//
// 定位：ui 包自带的 `pnpm dev` 演示页(dev/)，取代被删的 canvas-core-v2/demo-web，
// 展示本包开箱即用的"最终效果"——能拖/连/建/删/撤销的真实画布，右下设置面板实时调连线外观。
//
// 装配要点（全部走 @mini-canvas/* 包名，不再依赖包内相对路径）：
// - CanvasHost(渲染抽象层) 冷启动 plugins(theme-default 皮 + node-text/image 节点 + canvas-commands 命令)。
// - theme-default/settings 的 settingsPanelPlugin 把 @mini-canvas/ui 的 PluginSettingsPanel 注册进
//   settingsPanel 槽；CanvasHost 的 #ui 宿主业务 UI 区放 <SettingsHost/> 即渲染该默认皮。
// - 连线/连接点外观：设置面板改的是 ctx.settings(单一数据源)；此处 bindThemeSettings 把声明过的键
//   窄更新到 cfg.edge/handle，Vue 响应式只重绘受影响连线（体现"改设置 → 实时看到变化"）。
import { onBeforeUnmount, reactive, ref } from 'vue'
import type { CanvasNode, SettingsStore } from '@mini-canvas/canvas-core-v2'
import type { StorageAdapter } from '@mini-canvas/canvas-core-v2'
import { LocalStorageAdapter } from '@mini-canvas/canvas-core-v2'
import {
  CanvasHost,
  SettingsHost,
  DEFAULT_HANDLE_VISUAL,
} from '@mini-canvas/canvas-render'
import { themeDefaultPlugin, DEFAULT_THEME_EDGE, EDGE_SETTING_KEYS } from '@mini-canvas/plugin-theme-default'
import { nodeTextPlugin } from '@mini-canvas/plugin-node-text'
import { nodeImagePlugin } from '@mini-canvas/plugin-node-image'
import { canvasCommandsPlugin } from '@mini-canvas/plugin-canvas-commands'
import { uiDefaultSettingsPlugin } from '../src/defaultSettingsPlugin'

// —— 外观配置：连线外观由设置面板走 ctx.settings(单一数据源)，见 bindThemeSettings ——
const cfg = reactive({
  edge: { ...DEFAULT_THEME_EDGE },
  handle: { ...DEFAULT_HANDLE_VISUAL },
})

// —— 装配插件 + 存储（CanvasHost 冷启动）——
const plugins = [
  themeDefaultPlugin,
  uiDefaultSettingsPlugin, // @mini-canvas/ui 默认装配：把本包 PluginSettingsPanel 注册到 settingsPanel 槽 → SettingsHost 渲染它
  nodeTextPlugin,
  nodeImagePlugin,
  canvasCommandsPlugin,
]
const adapter: StorageAdapter = new LocalStorageAdapter()

const SAMPLE_IMG =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240"><rect width="320" height="240" fill="#dbeafe"/><text x="160" y="118" font-family="sans-serif" font-size="20" fill="#1d4ed8" text-anchor="middle">v2 image 节点</text><text x="160" y="142" font-family="sans-serif" font-size="13" fill="#64748b" text-anchor="middle">data.imageUrl</text></svg>`,
  )
const SAMPLE_TEXT = '双击我输入内容\n\n· 从左右圆点可拖出连线\n· 拖动节点可移动\n· 点节点再按 Delete 删除'

// 首次(存储空)默认图：text + image 两节点
function seedDefault(): CanvasNode[] {
  return [
    { id: '1', type: 'text', position: { x: 120, y: 120 }, data: { text: SAMPLE_TEXT } },
    { id: '2', type: 'image', position: { x: 560, y: 160 }, data: { imageUrl: SAMPLE_IMG } },
  ]
}

// —— 画布宿主句柄（经 CanvasHost 暴露）——
const hostEl = ref<InstanceType<typeof CanvasHost> | null>(null)
const booted = ref(false)

let disposeSettingsBind: (() => void) | undefined

function onReady(): void {
  booted.value = true
  bindThemeSettings()
}

/**
 * 把 theme-default 申报的连线配置绑定到实时外观(cfg.edge)：
 * - 初始：把 settings 当前值灌进 cfg.edge（theme 是单一数据源，改过则以改过为准）；
 * - 订阅：settings.set 触发后只把"声明过的 edge 键"窄更新到 cfg.edge（只重绘受影响连线）。
 */
function bindThemeSettings(): void {
  const ctx = hostEl.value?.host?.ctx
  if (!ctx) return
  const store = ctx.get<SettingsStore>('settings')
  for (const k of EDGE_SETTING_KEYS) {
    const v = store.get(k as string)
    if (v !== undefined) (cfg.edge as unknown as Record<string, unknown>)[k] = v
  }
  disposeSettingsBind = store.onChange((key, value) => {
    if (!EDGE_SETTING_KEYS.includes(key as (typeof EDGE_SETTING_KEYS)[number])) return
    ;(cfg.edge as unknown as Record<string, unknown>)[key] = value
  }).dispose
}
function unbindThemeSettings(): void {
  disposeSettingsBind?.()
  disposeSettingsBind = undefined
}

// 右键菜单：CanvasHost 透传坐标 + kind
const menu = ref<{ visible: boolean; x: number; y: number; nodeId?: string }>({ visible: false, x: 0, y: 0 })
function onContextMenu(p: { kind: 'node' | 'pane'; clientX: number; clientY: number; nodeId?: string }): void {
  closeMenu()
  menu.value = { visible: true, x: p.clientX, y: p.clientY, nodeId: p.nodeId }
}
function closeMenu(): void {
  menu.value.visible = false
}

// —— 业务命令（经 CanvasHost 的 host 驱动；nodeStore 变化自动刷渲染态）——
function createNode(type: 'text' | 'image'): void {
  const host = hostEl.value?.host
  if (!host) return
  const count = host.nodeStore.getNodes().length
  const payload: { type: string; position: { x: number; y: number }; imageUrl?: string } = {
    type,
    position: { x: 80 + (count % 5) * 48, y: 80 + Math.floor(count / 5) * 60 },
  }
  if (type === 'image') payload.imageUrl = SAMPLE_IMG
  host.command.execute('command:create-node', payload)
}
function deleteSelected(): void {
  hostEl.value?.host?.command.execute('command:delete')
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
  <div class="app-root">
    <div class="toolbar">
      <button :disabled="!booted" @click="createNode('text')">+ 文本</button>
      <button :disabled="!booted" @click="createNode('image')">+ 图片</button>
      <button :disabled="!booted" @click="deleteSelected">删除选中 (Delete)</button>
      <button :disabled="!booted" @click="undo">↶ 撤销</button>
      <button :disabled="!booted" @click="redo">↷ 重做</button>
      <span class="brand">@mini-canvas/ui 成品演示</span>
      <span class="hint">拖节点移动 · 从圆点拖出连线 · 双击文本编辑 · 右键菜单 · Ctrl+Z 撤销 · 右下角调设置 · 刷新不丢</span>
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
        window-key="MiniCanvasUI"
        @ready="onReady"
        @context-menu="onContextMenu"
      >
        <!-- 宿主业务 UI 区(#ui)：设置面板。默认皮=settingsPanelPlugin 注册的 @mini-canvas/ui PluginSettingsPanel -->
        <template #ui>
          <div class="theme-settings-dock">
            <SettingsHost />
          </div>
        </template>
      </CanvasHost>
    </div>

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
.app-root {
  height: 100vh;
  display: flex;
  flex-direction: column;
  font-family: system-ui, "Microsoft YaHei", sans-serif;
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
.toolbar .brand {
  margin-left: 12px;
  font-weight: 600;
  font-size: 13px;
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
}
.theme-settings-dock:empty {
  display: none;
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
