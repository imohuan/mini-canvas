<script setup lang="ts">
import { ref, computed, markRaw, onMounted } from 'vue'
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
  AutoSavePlugin,
  ClipboardPlugin,
  HistoryPlugin,
  MultiSelectPlugin,
  StoragePlugin,
  ShortcutManagerPlugin,
  GroupPlugin,
  FileDropPlugin,
  ThemePlugin,
  AutoLayoutPlugin,
  AlignArrangePlugin,
  CanvasExportPlugin,
  MiniMapPlugin,
  EdgeCuttingPlugin,
  type CanvasPlugin,
} from '@mini-canvas/canvas-core'
import { useMcpClient } from '../composables/useMcpClient'

const mcp = useMcpClient({ baseUrl: 'http://localhost:8765' })

const plugins = markRaw([
  TextNodePlugin, ImageNodePlugin, VideoNodePlugin, PanoramaNodePlugin, ImageCompareNodePlugin,
  ContextMenuPlugin, CustomHandlePlugin, NodeFindPlugin, AlignGuidePlugin, AutoSavePlugin,
  ClipboardPlugin, HistoryPlugin, MultiSelectPlugin, StoragePlugin, ShortcutManagerPlugin,
  GroupPlugin, FileDropPlugin, ThemePlugin, AutoLayoutPlugin, AlignArrangePlugin,
  CanvasExportPlugin, MiniMapPlugin, EdgeCuttingPlugin,
]) as CanvasPlugin[]

// 顶部工具条状态
const connecting = ref(false)

const statusText = computed(() => {
  if (!mcp.connected.value) return '未连接'
  if (!mcp.currentCanvasId.value) return '已连接，未选画布'
  return `画布: ${mcp.currentCanvasId.value}`
})

async function onConnect() {
  connecting.value = true
  await mcp.connect()
  connecting.value = false
}

async function onSwitch(id: string) {
  if (!id) return
  await mcp.switchCanvas(id)
}

async function onSave() {
  await mcp.save()
}

// 启动时自动连接后台
onMounted(async () => {
  await mcp.connect()
})
</script>

<template>
  <div class="mcp-canvas-view">
    <!-- 顶部工具条 -->
    <div class="mcp-toolbar">
      <div class="tb-left">
        <span class="tb-title">MCP 画布</span>
        <span class="tb-status" :class="{ on: mcp.connected.value }">{{ statusText }}</span>
      </div>
      <div class="tb-right">
        <button class="tb-btn" :disabled="connecting" @click="onConnect">
          {{ connecting ? '连接中…' : (mcp.connected.value ? '刷新列表' : '连接后台') }}
        </button>
        <select
          class="tb-select"
          :value="mcp.currentCanvasId.value ?? ''"
          :disabled="!mcp.connected.value"
          @change="onSwitch(($event.target as HTMLSelectElement).value)"
        >
          <option value="" disabled>选择画布…</option>
          <option v-for="c in mcp.canvases.value" :key="c.id" :value="c.id">
            {{ c.name }}（{{ c.nodeCount }} 节点）
          </option>
        </select>
        <button class="tb-btn tb-save" :disabled="!mcp.currentCanvasId.value || mcp.saving.value" @click="onSave">
          {{ mcp.saving.value ? '保存中…' : '保存' }}
        </button>
      </div>
    </div>

    <!-- 画布 -->
    <div class="mcp-canvas-wrap">
      <Canvas :plugins="plugins" />
    </div>
  </div>
</template>

<style scoped>
.mcp-canvas-view {
  width: 100vw;
  height: 100vh;
  position: relative;
}
.mcp-toolbar {
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 50;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 8px 16px;
  background: rgba(30, 30, 40, 0.9);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  color: #e5e5e5;
  font-size: 13px;
}
.tb-left { display: flex; align-items: center; gap: 12px; }
.tb-title { font-weight: 600; color: #fff; }
.tb-status { color: #ff6b6b; }
.tb-status.on { color: #51cf66; }
.tb-right { display: flex; align-items: center; gap: 8px; }
.tb-btn {
  background: #3b82f6;
  color: #fff;
  border: none;
  border-radius: 6px;
  padding: 6px 14px;
  cursor: pointer;
  font-size: 13px;
}
.tb-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.tb-save { background: #22c55e; }
.tb-select {
  background: #1f2937;
  color: #e5e5e5;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 6px;
  padding: 6px 8px;
  font-size: 13px;
}
.mcp-canvas-wrap { width: 100%; height: 100%; }
</style>
