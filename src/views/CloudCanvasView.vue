<script setup lang="ts">
import { reactive, markRaw, onMounted, nextTick, watch } from 'vue'
import {
  Canvas,
  TextNodePlugin,
  ImageNodePlugin,
  VideoNodePlugin,
  PanoramaNodePlugin,
  ImageCompareNodePlugin,
  ContextMenuPlugin,
  CustomHandlePlugin,
  NodeFindPlugin,
  AlignGuidePlugin,
  BackendSyncPlugin,
  ClipboardPlugin,
  HistoryPlugin,
  MultiSelectPlugin,
  ShortcutManagerPlugin,
  GroupPlugin,
  FileDropPlugin,
  ThemePlugin,
  AutoLayoutPlugin,
  AlignArrangePlugin,
  CanvasExportPlugin,
  MiniMapPlugin,
  EdgeCuttingPlugin,
  BackendImageModelProvider,
  configureImageModels,
  type CanvasPlugin,
  type BackendSyncControl,
} from '@mini-canvas/canvas-core'

const BACKEND_URL = 'http://localhost:8765'
/** 后台图片模型 provider：工具栏模型下拉/能力走后端，发送走后台任务 */
const backendImageModels = new BackendImageModelProvider(BACKEND_URL)

const ctrl = reactive<BackendSyncControl>({
  connected: false,
  canvasId: null,
  canvases: [],
  error: null,
  loading: false,
  api: null,
})

const plugins = markRaw([
  TextNodePlugin, ImageNodePlugin, VideoNodePlugin, PanoramaNodePlugin, ImageCompareNodePlugin,
  ContextMenuPlugin, CustomHandlePlugin, NodeFindPlugin, AlignGuidePlugin,
  ClipboardPlugin, HistoryPlugin, MultiSelectPlugin, ShortcutManagerPlugin,
  GroupPlugin, FileDropPlugin, ThemePlugin, AutoLayoutPlugin, AlignArrangePlugin,
  CanvasExportPlugin, MiniMapPlugin, EdgeCuttingPlugin,
  // backend-sync 取代 storage/auto-save：保存归后台
  { ...BackendSyncPlugin, options: { baseUrl: 'http://localhost:8765', control: ctrl, autoSave: true } },
]) as CanvasPlugin[]

async function onConnect() {
  if (!ctrl.api) return
  await ctrl.api.connect()
}
async function onSwitch(e: Event) {
  const id = (e.target as HTMLSelectElement).value
  if (!id || !ctrl.api) return
  await ctrl.api.switchCanvas(id)
}

// 图片工具栏模型数据/发送跟随后台：连上并选定画布 → 切到后台 provider；断连 → 回落本地 mock
watch(
  () => [ctrl.connected, ctrl.canvasId] as const,
  ([connected, canvasId]) => {
    if (connected && canvasId) {
      backendImageModels.setCanvasId(canvasId)
      configureImageModels(backendImageModels)
      void backendImageModels.warmUp()
    } else {
      backendImageModels.setCanvasId(null)
      configureImageModels(null)
    }
  },
  { immediate: true },
)

// 等 Canvas 装好插件后，用插件加载后台画布
onMounted(async () => {
  await nextTick()
  // 轮询等 api 就绪（Canvas onMounted install 是异步的，多等一拍）
  for (let i = 0; i < 20 && !ctrl.api; i++) { await new Promise((r) => setTimeout(r, 100)) }
  if (ctrl.api) await ctrl.api.connect()
})
</script>

<template>
  <div class="cloud-canvas-view">
    <div class="cc-toolbar">
      <div class="cc-left">
        <span class="cc-title">云端画布（后台同步）</span>
        <span class="cc-status" :class="{ on: ctrl.connected }">
          {{ ctrl.connected ? (ctrl.canvasId ? `画布: ${ctrl.canvasId}` : '已连接') : '未连接' }}
        </span>
        <span v-if="ctrl.error" class="cc-err">{{ ctrl.error }}</span>
      </div>
      <div class="cc-right">
        <button class="cc-btn" :disabled="ctrl.loading" @click="onConnect">
          {{ ctrl.loading ? '连接中…' : (ctrl.connected ? '刷新' : '连接后台') }}
        </button>
        <select class="cc-select" :value="ctrl.canvasId ?? ''" :disabled="!ctrl.connected" @change="onSwitch">
          <option value="" disabled>选择画布…</option>
          <option v-for="c in ctrl.canvases" :key="c.id" :value="c.id">{{ c.name }}（{{ c.nodeCount }} 节点）</option>
        </select>
      </div>
    </div>
    <div class="cc-canvas">
      <Canvas :plugins="plugins" :skip-default-load="true" />
    </div>
  </div>
</template>

<style scoped>
.cloud-canvas-view { width: 100vw; height: 100vh; position: relative; }
.cc-toolbar {
  position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 50;
  display: flex; align-items: center; gap: 16px; padding: 8px 16px;
  background: rgba(30,30,40,.9); border: 1px solid rgba(255,255,255,.1); border-radius: 8px;
  color: #e5e5e5; font-size: 13px; max-width: 90vw; flex-wrap: wrap;
}
.cc-left { display: flex; align-items: center; gap: 12px; }
.cc-title { font-weight: 600; color: #fff; }
.cc-status { color: #ff6b6b; }
.cc-status.on { color: #51cf66; }
.cc-err { color: #ffa94d; font-size: 12px; max-width: 40ch; }
.cc-right { display: flex; align-items: center; gap: 8px; }
.cc-btn { background: #3b82f6; color: #fff; border: none; border-radius: 6px; padding: 6px 14px; cursor: pointer; font-size: 13px; }
.cc-btn:disabled { opacity: .5; cursor: not-allowed; }
.cc-select { background: #1f2937; color: #e5e5e5; border: 1px solid rgba(255,255,255,.2); border-radius: 6px; padding: 6px 8px; font-size: 13px; }
.cc-canvas { width: 100%; height: 100%; }
</style>
