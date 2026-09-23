<script setup lang="ts">
// App.vue —— 画布应用的**装配层**。
//
// 各区域已组件化（components/areas/*），这里只负责：
//   1. 挂 CanvasShell 布局壳并把区域组件放进对应插槽
//   2. 挂真实 CanvasHost（插件/数据/命令不动）
//   3. 全局键盘（Esc / Ctrl+/）
//
// 区域组件共享 useUi() 单例状态（composables/ui.ts），互相之间不需要 prop 透传。
import { onBeforeUnmount, onMounted, watch } from 'vue'
import { CanvasHost, SettingsHost } from '@mini-canvas/canvas-render'
import { SlotHost } from '@mini-canvas/canvas-render'
import { MessageSquarePlus, Video, Type, Image as ImageIcon } from 'lucide-vue-next'
import { APP_PLUGINS, createDefaultStorageAdapter, seedDefaultCanvas } from './assembly'
import { uiMiniMapPanelPlugin } from './miniMapPanelPlugin'
import CanvasShell from './components/CanvasShell.vue'
import TopLeftArea from './components/areas/TopLeftArea.vue'
import TopRightArea from './components/areas/TopRightArea.vue'
import StatusArea from './components/areas/StatusArea.vue'
import DockArea from './components/areas/DockArea.vue'
import LeftDrawer from './components/areas/LeftDrawer.vue'
import ChatPanel from './components/areas/ChatPanel.vue'
import ModalsArea from './components/areas/ModalsArea.vue'
import { useUi } from './composables/ui'

const ui = useUi()
const s = ui.state
const plugins = APP_PLUGINS
const adapter = createDefaultStorageAdapter()
const DEV = import.meta.env.DEV

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    s.shortcutsOpen = false
    s.historyOpen = false
    s.drawer = null
    s.settingsOpen = false
    ui.closeMenus()
  }
  if ((event.ctrlKey || event.metaKey) && event.key === '/') {
    event.preventDefault()
    ui.toggleShortcuts()
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  document.documentElement.dataset.canvasTheme = s.theme
})
watch(() => s.theme, (v) => { document.documentElement.dataset.canvasTheme = v })
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <CanvasShell
    class="app-root"
    :theme="s.theme"
    :left-width="s.drawer === 'left' ? s.drawerWidth : 0"
    :right-width="s.chatDocked && s.chatOpen ? s.chatWidth : 0"
    :push-status="true"
    :push-dock="true"
  >
    <template #top-left><TopLeftArea /></template>
    <template #top-right><TopRightArea /></template>

    <template #canvas>
      <div class="absolute inset-0">
        <!-- 故事板视图：三列面板（照 LibTV 实测 463/451/451） -->
        <div v-if="s.navMode === 'storyboard'" class="absolute inset-x-0 top-10 z-10 flex justify-center gap-2" aria-label="故事板视图">
          <section v-for="col in s.storyboard" :key="col.type" class="flex h-[807px] max-h-[calc(100vh-60px)] w-[451px] flex-col overflow-hidden rounded-t-xl bg-panel">
            <header class="flex items-center gap-2 px-4 py-3"><h3 class="text-sm font-medium">{{ col.type }}</h3><span class="rounded bg-chip px-1.5 text-[10px] text-ink-dim">{{ col.items.length }}</span></header>
            <div class="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-3 pb-3">
              <article v-for="item in col.items" :key="item.name" class="flex cursor-pointer items-center gap-2 rounded-lg bg-veil p-2 transition-colors hover:bg-hover" @click="ui.showToast('打开 ' + item.name)">
                <span class="grid size-8 place-items-center rounded-md bg-chip text-ink-mute"><component :is="item.icon === 'video' ? Video : item.icon === 'text' ? Type : ImageIcon" :size="16" /></span>
                <span class="min-w-0 flex-1"><strong class="block truncate text-xs">{{ item.name }}</strong><small class="block truncate text-[10px] text-ink-dim">{{ item.meta }}</small></span>
                <button class="grid size-6 place-items-center rounded-md text-ink-dim hover:bg-hover hover:text-ink" :aria-label="'对话 ' + item.name" @click.stop="ui.showToast('与 ' + item.name + ' 对话')"><MessageSquarePlus :size="14" /></button>
              </article>
            </div>
          </section>
        </div>
        <!-- 「正在跟随」协作横幅 -->
        <div v-if="s.following" class="absolute left-1/2 top-0 z-[55] flex -translate-x-1/2 items-center gap-2 rounded-b-xl bg-[#25e44e] px-3 py-1.5 text-[13px] text-ink shadow-[0_4px_12px_rgba(0,0,0,0.25)]" role="status">
          <span class="size-2 rounded-full bg-white"></span>
          <span>正在跟随</span>
          <button class="h-[18px] rounded-full bg-white px-2 text-[11px] font-medium leading-none text-[#111] transition-colors hover:bg-white/90" aria-label="退出跟随" @click="s.following = false">取消ESC</button>
        </div>
        <!-- 真实画布 -->
        <CanvasHost
          ref="ui.hostEl"
          :plugins="plugins"
          :adapter="adapter"
          :seed="seedDefaultCanvas"
          :edge-visual="ui.cfg.edge"
          :handle-visual="ui.cfg.handle"
          :debug-visual="ui.cfg.debug"
          :snap-zone-visual="ui.cfg.snapZone"
          :dev="DEV"
          window-key="MiniCanvasUI"
          @ready="ui.onReady()"
        >
          <template #ui>
            <SettingsHost v-if="s.settingsOpen" />
            <SlotHost slot="ui-mini-map" />
          </template>
        </CanvasHost>
      </div>
    </template>

    <template #status><StatusArea /></template>
    <template #dock><DockArea /></template>

    <LeftDrawer />
    <ChatPanel />
    <ModalsArea />

    <!-- 小地图：位置由 ui-mini-map 插件逐帧对齐状态栏「切换小地图」按钮，显隐走 mini-map 服务 -->
  </CanvasShell>
</template>

<style scoped>
.app-root { height: 100vh; overflow: hidden; }
</style>
