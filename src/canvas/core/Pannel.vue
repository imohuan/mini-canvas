<script setup lang="ts">
import { ref } from 'vue'
import { ConnectionMode } from '@vue-flow/core'
import type { EdgeType } from './useCanvasStore'
import type { StorageStatus, ProjectMeta } from './plugins/storage/StoragePlugin'
import PanelTabGeneral from './components/panel/PanelTabGeneral.vue'
import PanelTabTheme from './components/panel/PanelTabTheme.vue'
import PanelTabStorage from './components/panel/PanelTabStorage.vue'
import PanelTabLayout from './components/panel/PanelTabLayout.vue'

export interface ToggleDef {
  key: string
  label: string
  get: () => boolean
  set: (v: boolean) => void
  tip?: string
}

export interface PluginDef {
  name: string
  label: string
  description: string
  enabled: boolean
}

const props = defineProps<{
  toggles: ToggleDef[]
  connectionMode: ConnectionMode
  edgeLineWidth: number
  edgeColor: string
  edgeType: EdgeType
  edgeDashed: boolean
  edgeAnimated: boolean
  minZoom: number
  maxZoom: number
  topToolbarOffset: number
  bottomToolbarOffset: number
  handleDebug: boolean
  handleRadius: number
  handleRestOffset: number
  handleCursorGap: number
  handleButtonSize: number
  handleOverlap: number
  connectionSnapDebugVisible: boolean
  connectionSnapOuterRatio: number
  connectionSnapInnerRatio: number
  connectionSnapHeightRatio: number
  selectionFramePaddingX: number
  selectionFramePaddingTop: number
  selectionFramePaddingBottom: number
  plugins?: PluginDef[]
  themePreset?: string
  themeAccent?: string
  themeSurface?: string
  layoutDirection?: string
  layoutIntraSpacingX?: number
  layoutIntraSpacingY?: number
  layoutInterSpacingX?: number
  layoutInterSpacingY?: number
  layoutFocusHeightRatio?: number
  storageStatus?: StorageStatus & { projects: ProjectMeta[] }
}>()

const emit = defineEmits<{
  (e: 'toggleMode'): void
  (e: 'zoomIn'): void
  (e: 'zoomOut'): void
  (e: 'fitView'): void
  (e: 'update:edgeLineWidth', v: number): void
  (e: 'update:edgeColor', v: string): void
  (e: 'update:edgeType', v: EdgeType): void
  (e: 'toggleEdgeDashed'): void
  (e: 'toggleEdgeAnimated'): void
  (e: 'update:minZoom', v: number): void
  (e: 'update:maxZoom', v: number): void
  (e: 'update:topToolbarOffset', v: number): void
  (e: 'update:bottomToolbarOffset', v: number): void
  (e: 'update:handleDebug', v: boolean): void
  (e: 'update:handleRadius', v: number): void
  (e: 'update:handleRestOffset', v: number): void
  (e: 'update:handleCursorGap', v: number): void
  (e: 'update:handleButtonSize', v: number): void
  (e: 'update:handleOverlap', v: number): void
  (e: 'update:connectionSnapDebugVisible', v: boolean): void
  (e: 'update:connectionSnapOuterRatio', v: number): void
  (e: 'update:connectionSnapInnerRatio', v: number): void
  (e: 'update:connectionSnapHeightRatio', v: number): void
  (e: 'update:selectionFramePaddingX', v: number): void
  (e: 'update:selectionFramePaddingTop', v: number): void
  (e: 'update:selectionFramePaddingBottom', v: number): void
  (e: 'applyThemePreset', name: string): void
  (e: 'applyCustomTheme', accent: string): void
  (e: 'storageConnect'): void
  (e: 'storageDisconnect'): void
  (e: 'storageCreateProject', name: string): void
  (e: 'storageDeleteProject', id: string): void
  (e: 'storageSwitchProject', id: string): void
  (e: 'autoLayout'): void
  (e: 'focusSelected'): void
  (e: 'update:layoutDirection', v: string): void
  (e: 'update:layoutIntraSpacingX', v: number): void
  (e: 'update:layoutIntraSpacingY', v: number): void
  (e: 'update:layoutInterSpacingX', v: number): void
  (e: 'update:layoutInterSpacingY', v: number): void
  (e: 'update:layoutFocusHeightRatio', v: number): void
}>()

const collapsed = ref(true)
function toggleCollapsed() { collapsed.value = !collapsed.value }

type TabKey = 'general' | 'theme' | 'storage' | 'layout'
const activeTab = ref<TabKey>('general')
const tabs: { key: TabKey; label: string }[] = [
  { key: 'general', label: '通用' },
  { key: 'theme', label: '主题' },
  { key: 'storage', label: '存储' },
  { key: 'layout', label: '布局' },
]

const tabBase = 'px-3 py-1.5 rounded-t-md text-[11px] font-semibold transition-colors cursor-pointer border border-b-0'
const tabActive = 'bg-[#1e1c21] text-[#f0f0f2] border-[#3a3740]'
const tabInactive = 'bg-transparent text-[#78767b] border-transparent hover:text-[#b2b0b9]'
</script>

<template>
  <Panel
    position="top-right"
    class="pannel-container"
    :class="{ 'pannel-collapsed': collapsed }"
  >
    <div class="pannel-inner">
      <button class="pannel-toggle" @click="toggleCollapsed">
        {{ collapsed ? '◀' : '▶' }}
      </button>

      <div v-if="!collapsed" class="pannel-body">
        <!-- Tab headers -->
        <div class="flex gap-0 border-b border-[#3a3740] mb-2">
          <button v-for="tab in tabs" :key="tab.key"
            :class="[tabBase, activeTab === tab.key ? tabActive : tabInactive]"
            @click="activeTab = tab.key">
            {{ tab.label }}
          </button>
        </div>

        <!-- Tab content -->
        <PanelTabGeneral v-if="activeTab === 'general'"
          :toggles="toggles"
          :connection-mode="connectionMode"
          :edge-line-width="edgeLineWidth"
          :edge-color="edgeColor"
          :edge-type="edgeType"
          :edge-dashed="edgeDashed"
          :edge-animated="edgeAnimated"
          :min-zoom="minZoom"
          :max-zoom="maxZoom"
          :top-toolbar-offset="topToolbarOffset"
          :bottom-toolbar-offset="bottomToolbarOffset"
          :handle-debug="handleDebug"
          :handle-radius="handleRadius"
          :handle-rest-offset="handleRestOffset"
          :handle-cursor-gap="handleCursorGap"
          :handle-button-size="handleButtonSize"
          :handle-overlap="handleOverlap"
          :connection-snap-debug-visible="connectionSnapDebugVisible"
          :connection-snap-outer-ratio="connectionSnapOuterRatio"
          :connection-snap-inner-ratio="connectionSnapInnerRatio"
          :connection-snap-height-ratio="connectionSnapHeightRatio"
          :selection-frame-padding-x="selectionFramePaddingX"
          :selection-frame-padding-top="selectionFramePaddingTop"
          :selection-frame-padding-bottom="selectionFramePaddingBottom"
          :plugins="plugins"
          @toggle-mode="emit('toggleMode')"
          @zoom-in="emit('zoomIn')"
          @zoom-out="emit('zoomOut')"
          @fit-view="emit('fitView')"
          @update:edge-line-width="emit('update:edgeLineWidth', $event)"
          @update:edge-color="emit('update:edgeColor', $event)"
          @update:edge-type="emit('update:edgeType', $event)"
          @toggle-edge-dashed="emit('toggleEdgeDashed')"
          @toggle-edge-animated="emit('toggleEdgeAnimated')"
          @update:min-zoom="emit('update:minZoom', $event)"
          @update:max-zoom="emit('update:maxZoom', $event)"
          @update:top-toolbar-offset="emit('update:topToolbarOffset', $event)"
          @update:bottom-toolbar-offset="emit('update:bottomToolbarOffset', $event)"
          @update:handle-debug="emit('update:handleDebug', $event)"
          @update:handle-radius="emit('update:handleRadius', $event)"
          @update:handle-rest-offset="emit('update:handleRestOffset', $event)"
          @update:handle-cursor-gap="emit('update:handleCursorGap', $event)"
          @update:handle-button-size="emit('update:handleButtonSize', $event)"
          @update:handle-overlap="emit('update:handleOverlap', $event)"
          @update:connection-snap-debug-visible="emit('update:connectionSnapDebugVisible', $event)"
          @update:connection-snap-outer-ratio="emit('update:connectionSnapOuterRatio', $event)"
          @update:connection-snap-inner-ratio="emit('update:connectionSnapInnerRatio', $event)"
          @update:connection-snap-height-ratio="emit('update:connectionSnapHeightRatio', $event)"
          @update:selection-frame-padding-x="emit('update:selectionFramePaddingX', $event)"
          @update:selection-frame-padding-top="emit('update:selectionFramePaddingTop', $event)"
          @update:selection-frame-padding-bottom="emit('update:selectionFramePaddingBottom', $event)"
        />

        <PanelTabTheme v-if="activeTab === 'theme'"
          :theme-preset="themePreset"
          :theme-accent="themeAccent"
          :theme-surface="themeSurface"
          @apply-theme-preset="emit('applyThemePreset', $event)"
          @apply-custom-theme="emit('applyCustomTheme', $event)"
        />

        <PanelTabStorage v-if="activeTab === 'storage'"
          :storage-status="storageStatus"
          @storage-connect="emit('storageConnect')"
          @storage-disconnect="emit('storageDisconnect')"
          @storage-create-project="emit('storageCreateProject', $event)"
          @storage-delete-project="emit('storageDeleteProject', $event)"
          @storage-switch-project="emit('storageSwitchProject', $event)"
        />

        <PanelTabLayout v-if="activeTab === 'layout'"
          :layout-direction="layoutDirection"
          :layout-intra-spacing-x="layoutIntraSpacingX"
          :layout-intra-spacing-y="layoutIntraSpacingY"
          :layout-inter-spacing-x="layoutInterSpacingX"
          :layout-inter-spacing-y="layoutInterSpacingY"
          :layout-focus-height-ratio="layoutFocusHeightRatio"
          @auto-layout="emit('autoLayout')"
          @focus-selected="emit('focusSelected')"
          @update:layout-direction="emit('update:layoutDirection', $event)"
          @update:layout-intra-spacing-x="emit('update:layoutIntraSpacingX', $event)"
          @update:layout-intra-spacing-y="emit('update:layoutIntraSpacingY', $event)"
          @update:layout-inter-spacing-x="emit('update:layoutInterSpacingX', $event)"
          @update:layout-inter-spacing-y="emit('update:layoutInterSpacingY', $event)"
          @update:layout-focus-height-ratio="emit('update:layoutFocusHeightRatio', $event)"
        />
      </div>
    </div>
  </Panel>
</template>

<style scoped>
.pannel-container {
  background: rgb(18 16 20 / 0.92) !important;
  backdrop-filter: blur(12px);
  border: 1px solid rgb(255 255 255 / 0.06) !important;
  border-radius: 14px !important;
  box-shadow: 0 22px 70px rgb(0 0 0 / 0.45) !important;
  padding: 0 !important;
  font-size: 11px !important;
}

.pannel-collapsed {
  min-width: auto !important;
}

.pannel-inner {
  padding: 8px;
}

.pannel-toggle {
  background: transparent;
  border: 0;
  color: #78767b;
  cursor: pointer;
  font-size: 12px;
  padding: 2px 4px;
  border-radius: 4px;
}

.pannel-toggle:hover {
  background: rgb(255 255 255 / 0.06);
  color: #f0f0f2;
}

.pannel-body {
  margin-top: 4px;
  max-height: 70vh;
  overflow-y: auto;
}
</style>