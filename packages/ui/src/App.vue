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
import type { SettingsStore } from '@mini-canvas/kernel'
import { CanvasHost, SettingsHost, createV2Logger } from '@mini-canvas/canvas-render'
import {
  DEFAULT_THEME_EDGE,
  DEFAULT_THEME_HANDLE,
  DEFAULT_THEME_DEBUG,
  DEFAULT_THEME_SNAP_ZONE,
  EDGE_SETTING_KEYS,
  HANDLE_SETTING_KEYS,
  DEBUG_SETTING_KEYS,
  SNAP_ZONE_SETTING_KEYS,
} from '@mini-canvas/plugin-theme-default'
// 插件清单与存储后端住在 ./assembly.ts：本组件只管"页面长什么样"，换一套插件组合不用改这里。
import { APP_PLUGINS, SAMPLE_IMAGE_URL, createDefaultStorageAdapter, seedDefaultCanvas } from './assembly'

// —— 装配插件 + 存储（CanvasHost 冷启动）——
const plugins = APP_PLUGINS
const adapter = createDefaultStorageAdapter()

const log = createV2Logger('config')

/**
 * 开发态开关 → CanvasHost 的 :dev → ctx.isDev（决策 9 的 needs 缺项裁决靠它分 dev/prod）。
 *
 * 为什么在这里读 `import.meta.env`：vite 的 env 替换只作用于**应用包自身源码**；
 * canvas-render 是独立 workspace 包，它自己的源码读 `import.meta.env` 拿不到替换（实测 undefined），
 * 于是判定会静默失效。应用包这一层是可靠的，所以由这里显式往下传。
 */
const DEV = import.meta.env.DEV

// 外观（取自 theme-default 申报的默认，保证与内核一致；设置改动会窄更新到 cfg.edge / cfg.handle / cfg.snapZone）
const cfg = reactive({
  edge: { ...DEFAULT_THEME_EDGE },
  handle: { ...DEFAULT_THEME_HANDLE },
  debug: { ...DEFAULT_THEME_DEBUG },
  snapZone: { ...DEFAULT_THEME_SNAP_ZONE },
})

// —— 设置面板开关（顶部按钮切换右下 dock 显隐）——
const settingsOpen = ref(false)

// 首次(存储空)默认图 = assembly.ts 的 seedDefaultCanvas()（示例图/文本也住在那里）
const seedDefault = seedDefaultCanvas

// —— 画布宿主句柄（经 CanvasHost 暴露）——
const hostEl = ref<InstanceType<typeof CanvasHost> | null>(null)
const booted = ref(false)

let disposeSettingsBind: (() => void) | undefined
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let closeSub: { dispose(): void } | undefined

/** 外部插件清单里的一项（cloud-server 的 /plugin-manifest.json 形状） */
interface ManifestEntry {
  id: string
  url: string
  disabled?: boolean
}

/**
 * 从外部清单装插件。
 *
 * 这份 ui 是"成品出口"：它自己带一批源码插件（上面的 plugins 数组）。
 * 除此之外，还允许运行环境把额外插件挂进来——由 cloud-server 扫描它本地的
 * 插件产物目录生成 /plugin-manifest.json，本函数读它并逐个装上。
 *
 * 于是"云端保存"这类能力不必写进 ui：起个 cloud-server、把插件放进它的插件目录，
 * 画布打开时自己就装上了。`pnpm dev`（没有后台）时这份清单拿不到，静默跳过，不影响画布。
 */
async function installExternalPlugins(): Promise<void> {
  const manager = hostEl.value?.manager
  if (!manager) return
  const manifest = await fetch('/plugin-manifest.json')
    .then((r) => (r.ok ? r.json() : { plugins: [] }))
    .catch(() => ({ plugins: [] }))
  const entries: ManifestEntry[] = Array.isArray(manifest?.plugins) ? manifest.plugins : []
  // 开发期 ui 与后台往往不同源（ui dev 在 5288、cloud-server 在 8865）：
  // 用 VITE_CLOUD_BASE_URL 告诉云端保存插件去哪儿读写，省得每次手填设置。
  const cloudBase = (import.meta.env?.VITE_CLOUD_BASE_URL as string | undefined) ?? ''
  for (const entry of entries) {
    if (entry.disabled) continue
    try {
      // 只给云端保存插件塞地址（别的插件各有自己的 Config，不替它们做决定）
      const config =
        cloudBase && entry.id.includes('cloud-save') ? { cloudSaveBaseUrl: cloudBase } : undefined
      await manager.install({ url: entry.url }, config ? { config } : undefined)
      log.log(`外部插件已装载: ${entry.id}`)
    } catch (err) {
      // 单个外部插件坏掉不该拖垮画布：记一条告警继续装下一个
      console.warn(`[ui] 外部插件装载失败: ${entry.id}`, err)
    }
  }
}

async function onReady(): Promise<void> {
  booted.value = true
  bindThemeSettings()
  // 设置弹窗内 ✕/遮罩/Esc → ctx 'settings:ui-close' → 本层把 settingsOpen 置 false（弹窗卸载）
  const ctx0 = hostEl.value?.host?.ctx
  closeSub = ctx0?.on('settings:ui-close', () => {
    settingsOpen.value = false
  })
  await installExternalPlugins()
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
function createNode(type: 'text' | 'image' | 'video'): void {
  const host = hostEl.value?.host
  if (!host) return
  const count = host.nodeStore.getNodes().length
  const payload: { type: string; position: { x: number; y: number }; imageUrl?: string } = {
    type,
    position: { x: 80 + (count % 5) * 48, y: 80 + Math.floor(count / 5) * 60 },
  }
  if (type === 'image') payload.imageUrl = SAMPLE_IMAGE_URL
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
      <button :disabled="!booted" @click="createNode('video')">+ 视频</button>
      <button :disabled="!booted" @click="deleteSelected">删除选中 (Delete)</button>
      <button :disabled="!booted" @click="undo">↶ 撤销</button>
      <button :disabled="!booted" @click="redo">↷ 重做</button>
      <span class="toolbar-sep"></span>
      <button :disabled="!booted" class="settings-btn" :class="{ active: settingsOpen }" @click="settingsOpen = !settingsOpen">
        ⚙ 设置
      </button>
      <span class="brand">@mini-canvas/ui</span>
      <span class="hint">把图片/视频/文本文件直接拖到画布上，或 Ctrl+V 粘贴 → 自动建节点 · 拖节点移动(靠近其它节点边缘/中心会吸附并显示蓝线) · 从圆点拖出连线 · Shift+拖空白框选 · Ctrl+A 全选 · Esc 清除 · Delete 删除 · 刷新不丢</span>
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
        :dev="DEV"
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
