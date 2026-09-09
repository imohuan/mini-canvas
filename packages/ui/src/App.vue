<script setup lang="ts">
// App.vue —— @mini-canvas/ui 成品画布应用：一行 CanvasHost 渲染真实画布，顶部可"打开设置"弹出设置界面。
//
// 定位：@mini-canvas/ui 是整棵项目的"成品出口"——已组装好的应用，自带插件功能（画布 + 默认主题 + 设置界面）。
// index.html 在包根、代码全在 src/。CanvasHost(渲染抽象层) 冷启动一组插件(theme-default 皮[自带设置面板默认皮]
// + text/image 节点 + canvas-commands 命令)，画布即得可拖/连/建/删/撤销、刷新不丢的能力。
//
// 设置界面：顶部"⚙ 设置"按钮切换居中设置弹窗(modal)。弹窗 = <SettingsHost/> 渲染 settingsPanel 槽赢家
// (= theme-default 内置注册的 PluginSettingsDialog 默认皮)，把 ctx.settings 实时喂给它；改动经
// bindThemeSettings 窄更新到 cfg.edge → 连线外观实时变化。
import { onBeforeUnmount, reactive, ref } from 'vue'
import type { CanvasNode, SettingsStore, StorageAdapter } from '@mini-canvas/canvas-core-v2'
import { LocalStorageAdapter } from '@mini-canvas/canvas-core-v2'
import { CanvasHost, SettingsHost, createV2Logger } from '@mini-canvas/canvas-render'
import {
  themeDefaultPlugin,
  DEFAULT_THEME_EDGE,
  DEFAULT_THEME_HANDLE,
  DEFAULT_THEME_DEBUG,
  DEFAULT_THEME_SNAP_ZONE,
  EDGE_SETTING_KEYS,
  HANDLE_SETTING_KEYS,
  DEBUG_SETTING_KEYS,
  SNAP_ZONE_SETTING_KEYS,
} from '@mini-canvas/plugin-theme-default'
import { nodeTextPlugin } from '@mini-canvas/plugin-node-text'
import { nodeImagePlugin } from '@mini-canvas/plugin-node-image'
import { canvasCommandsPlugin } from '@mini-canvas/plugin-canvas-commands'
import { multiSelectPlugin } from '@mini-canvas/plugin-multi-select'
import { edgeCuttingPlugin } from '@mini-canvas/plugin-edge-cutting'
import { alignGuidePlugin } from '@mini-canvas/plugin-align-guide'
import { autoLayoutPlugin } from '@mini-canvas/plugin-auto-layout'
import { alignArrangePlugin } from '@mini-canvas/plugin-align-arrange'
import { contextMenuPlugin } from '@mini-canvas/plugin-context-menu'
import { clipboardPlugin } from '@mini-canvas/plugin-clipboard'
import { canvasExportPlugin } from '@mini-canvas/plugin-canvas-export'
import { nodeFindPlugin } from '@mini-canvas/plugin-node-find'
import { groupPlugin } from '@mini-canvas/plugin-group'
import { miniMapPlugin } from '@mini-canvas/plugin-mini-map'
import { shortcutManagerPlugin } from '@mini-canvas/plugin-shortcut-manager'

// —— 装配插件 + 存储（CanvasHost 冷启动）——
const plugins = [
  themeDefaultPlugin, // 画布默认皮：节点壳 / 边 / 背景 / 设置面板(settingsPanel 默认赢家)
  nodeTextPlugin, // text 节点
  nodeImagePlugin, // image 节点
  edgeCuttingPlugin, // 连接线切割：按住 Alt 拖拽"刀光"划过连线即可删除
  canvasCommandsPlugin, // 建/删/撤销命令
  multiSelectPlugin, // 多选：Shift+拖框选 / Ctrl+A 全选 / Escape 清除
  alignGuidePlugin, // 对齐辅助线：拖节点时吸附其它节点边缘/中心并显示蓝线
  autoLayoutPlugin, // 自动布局：Ctrl/Cmd+L 布局 / F 聚焦选中 / R 适应视图
  alignArrangePlugin, // 对齐排列：Ctrl+方向键紧凑排列 / 对齐/等距命令
  groupPlugin, // 分组：选中≥2 Ctrl+G 打组 / Ctrl+Shift+G 解组
  contextMenuPlugin, // 右键菜单：空白新建节点 / 节点删除 / 边删除
  clipboardPlugin, // 复制粘贴：Ctrl/Cmd+C/V/X/D
  canvasExportPlugin, // 导出：Ctrl/Cmd+E 整图 / Ctrl/Cmd+Shift+E 选中
  nodeFindPlugin, // 搜索：Ctrl/Cmd+F
  miniMapPlugin, // 小地图：Ctrl/Cmd+M
  shortcutManagerPlugin, // 快捷键帮助：Ctrl/Cmd+/ 打开
]
const adapter: StorageAdapter = new LocalStorageAdapter()

const log = createV2Logger('config')

// 外观（取自 theme-default 申报的默认，保证与内核一致；设置改动会窄更新到 cfg.edge / cfg.handle / cfg.snapZone）
const cfg = reactive({
  edge: { ...DEFAULT_THEME_EDGE },
  handle: { ...DEFAULT_THEME_HANDLE },
  debug: { ...DEFAULT_THEME_DEBUG },
  snapZone: { ...DEFAULT_THEME_SNAP_ZONE },
})

// —— 设置面板开关（顶部按钮切换右下 dock 显隐）——
const settingsOpen = ref(false)

const SAMPLE_IMG =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240"><rect width="320" height="240" fill="#dbeafe"/><text x="160" y="118" font-family="sans-serif" font-size="20" fill="#1d4ed8" text-anchor="middle">v2 image 节点</text><text x="160" y="142" font-family="sans-serif" font-size="13" fill="#64748b" text-anchor="middle">data.imageUrl</text></svg>`,
  )
const SAMPLE_TEXT = '双击我输入内容\n\n· 从左右圆点可拖出连线\n· 拖动节点可移动\n· 点节点再按 Delete 删除'

// 首次(存储空)默认图
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let closeSub: { dispose(): void } | undefined

function onReady(): void {
  booted.value = true
  bindThemeSettings()
  // 设置弹窗内 ✕/遮罩/Esc → ctx 'settings:ui-close' → 本层把 settingsOpen 置 false（弹窗卸载）
  const ctx0 = hostEl.value?.host?.ctx
  closeSub = ctx0?.on('settings:ui-close', () => {
    settingsOpen.value = false
  })
}

/**
 * 把 theme-default 申报的外观配置绑定到实时外观(cfg.edge / cfg.handle)：
 * - 初始：把 settings 当前值分别灌进 cfg.edge / cfg.handle（theme 是单一数据源，改过则以改过为准）；
 * - 订阅：settings.set 触发后把"声明过的 edge/handle 键"窄更新到对应 cfg 分组（只重绘受影响连线/端口，无整图重建）。
 * 实现"在设置界面改连线颜色/线宽/端口尺寸 → 画布上连线与端口实时变"。
 */
function bindThemeSettings(): void {
  const ctx = hostEl.value?.host?.ctx
  if (!ctx) return
  const store = ctx.get<SettingsStore>('settings')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const targetOf = (key: string): Record<string, unknown> | undefined =>
    (EDGE_SETTING_KEYS as readonly string[]).includes(key)
      ? (cfg.edge as unknown as Record<string, unknown>)
      : (HANDLE_SETTING_KEYS as readonly string[]).includes(key)
        ? (cfg.handle as unknown as Record<string, unknown>)
        : (DEBUG_SETTING_KEYS as readonly string[]).includes(key)
          ? (cfg.debug as unknown as Record<string, unknown>)
          : (SNAP_ZONE_SETTING_KEYS as readonly string[]).includes(key)
            ? (cfg.snapZone as unknown as Record<string, unknown>)
            : undefined
  for (const k of [
    ...EDGE_SETTING_KEYS,
    ...HANDLE_SETTING_KEYS,
    ...DEBUG_SETTING_KEYS,
    ...SNAP_ZONE_SETTING_KEYS,
  ]) {
    const v = store.get(k as string)
    const t = targetOf(k as string)
    if (v !== undefined && t) t[k as string] = v
  }
  log.log('bindThemeSettings 初始灌入', {
    edge: cfg.edge,
    handle: cfg.handle,
    debug: cfg.debug,
    snapZone: cfg.snapZone,
  })
  disposeSettingsBind = store.onChange((key, value) => {
    const t = targetOf(key)
    if (t) {
      t[key] = value
      const grp = Object.prototype.hasOwnProperty.call(cfg.edge, key)
        ? 'cfg.edge'
        : Object.prototype.hasOwnProperty.call(cfg.handle, key)
          ? 'cfg.handle'
          : Object.prototype.hasOwnProperty.call(cfg.snapZone, key)
            ? 'cfg.snapZone'
            : 'cfg.debug'
      log.log(`settings.set ${key}=${JSON.stringify(value)} → 窄更新到 ${grp}`)
    }
  }).dispose
}
function unbindThemeSettings(): void {
  disposeSettingsBind?.()
  disposeSettingsBind = undefined
}

// —— 业务命令（经 CanvasHost 的 host 驱动）——
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

onBeforeUnmount(() => {
  unbindThemeSettings()
  closeSub?.dispose()
})
</script>

<template>
  <div class="app-root">
    <div class="toolbar">
      <button :disabled="!booted" @click="createNode('text')">+ 文本</button>
      <button :disabled="!booted" @click="createNode('image')">+ 图片</button>
      <button :disabled="!booted" @click="deleteSelected">删除选中 (Delete)</button>
      <button :disabled="!booted" @click="undo">↶ 撤销</button>
      <button :disabled="!booted" @click="redo">↷ 重做</button>
      <span class="toolbar-sep"></span>
      <button :disabled="!booted" class="settings-btn" :class="{ active: settingsOpen }" @click="settingsOpen = !settingsOpen">
        ⚙ 设置
      </button>
      <span class="brand">@mini-canvas/ui</span>
      <span class="hint">拖节点移动(靠近其它节点边缘/中心会吸附并显示蓝线) · 从圆点拖出连线 · Shift+拖空白框选 · Ctrl+A 全选 · Esc 清除 · Delete 删除 · 刷新不丢</span>
    </div>

    <div class="canvas-wrap">
      <CanvasHost
        ref="hostEl"
        :plugins="plugins"
        :adapter="adapter"
        :seed="seedDefault"
        :edge-visual="cfg.edge"
        :handle-visual="cfg.handle"
        :debug-visual="cfg.debug"
        :snap-zone-visual="cfg.snapZone"
        :min-zoom="0.2"
        :max-zoom="2"
        window-key="MiniCanvasUI"
        @ready="onReady"
      >
        <!-- 宿主业务 UI 区(#ui)：右上"⚙ 设置"按钮控制设置弹窗显隐。SettingsHost 渲染 settingsPanel 槽赢家
             (= theme-default apply 内置注册的 PluginSettingsDialog 默认皮)；弹窗本体自居中，✕/遮罩/Esc
             经 ctx 'settings:ui-close' 事件通知本层关闭 -->
        <template #ui>
          <SettingsHost v-if="settingsOpen" />
        </template>
      </CanvasHost>
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
.toolbar-sep {
  width: 1px;
  height: 18px;
  background: #e5e7eb;
  margin: 0 2px;
}
.toolbar .settings-btn {
  border-color: #cbd5e1;
  background: #f8fafc;
}
.toolbar .settings-btn.active {
  border-color: #4f7cff;
  background: #eef2ff;
  color: #3b5bdb;
}
.canvas-wrap {
  flex: 1;
  position: relative;
  min-height: 0;
}
</style>
