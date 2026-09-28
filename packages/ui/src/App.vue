<script setup lang="ts">
// App.vue —— 画布应用的**装配层**。
//
// 各区域已组件化（components/areas/*），这里只负责：
//   1. 挂 CanvasShell 布局壳并把区域组件放进对应插槽
//   2. 挂真实 CanvasHost（插件/数据/命令不动）
//   3. 全局键盘（Esc / Ctrl+/）
//
// 区域组件共享 useUi() 单例状态（composables/ui.ts），互相之间不需要 prop 透传。
import { CanvasHost, SettingsHost } from '@mini-canvas/canvas-render'
import { SlotHost } from '@mini-canvas/canvas-render'
import { MessageSquarePlus, Video, Type, Image as ImageIcon } from 'lucide-vue-next'
import { APP_PLUGINS, createDefaultStorageAdapter, seedDefaultCanvas } from './assembly'
import CanvasShell from './components/CanvasShell.vue'
import TopLeftArea from './components/areas/TopLeftArea.vue'
import TopRightArea from './components/areas/TopRightArea.vue'
import StatusArea from './components/areas/StatusArea.vue'
import DockArea from './components/areas/DockArea.vue'
import LeftDrawer from './components/areas/LeftDrawer.vue'
import ChatPanel from './components/areas/ChatPanel.vue'
import ModalsArea from './components/areas/ModalsArea.vue'
import { setReadyHost, useUi } from './composables/ui'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

const ui = useUi()
const s = ui.state
const plugins = APP_PLUGINS

// ===== 小地图跟随定位：每帧读状态栏「切换小地图」按钮的屏幕矩形，把地图贴在它正上方 =====
// 为什么要逐帧（而不是监听事件）：抽屉开合走 transform 过渡（getBoundingClientRect 每帧都变），
// resize/scroll 都感知不到这种过渡；常驻 rAF 逐帧重摆，动画全程贴合、拖拽调宽也跟手。
// 摆位是无状态重放（按钮左缘 x + 顶边 y → translate 平移自身 0%/100%），不累计差量：
// 窗口变化、配置改宽高都直接落到正确位置。
const miniMapEl = ref<HTMLElement | null>(null)
let miniMapRaf = 0
let miniMapLast = ''
function onCanvasReady(host: unknown): void {
  setReadyHost(host)
  void ui.onReady()
}
function placeMiniMap(): void {
  const root = miniMapEl.value
  if (root) {
    const anchor = document.querySelector('button[aria-label="切换小地图"]')
    if (anchor) {
      const r = anchor.getBoundingClientRect()
      if (r.width > 0 || r.height > 0) {
        // 地图左缘 = 按钮左缘；底边 = 按钮顶边上方 8px
        const t = 'translate(' + r.left + 'px, calc(' + (r.top - 8) + 'px - 100%))'
        if (t !== miniMapLast) {
          miniMapLast = t
          root.style.transform = t
        }
      }
    }
  }
  miniMapRaf = requestAnimationFrame(placeMiniMap) // 常驻循环：下一帧继续贴
}
onMounted(() => {
  miniMapRaf = requestAnimationFrame(placeMiniMap)
})
onBeforeUnmount(() => {
  if (miniMapRaf) cancelAnimationFrame(miniMapRaf)
  miniMapRaf = 0
})
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
  ui.applyTheme(s.theme)
})
watch(() => s.theme, (v) => ui.applyTheme(v))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  // 撤掉 settings:ui-close 订阅：面板关闭广播的唯一落点，宿主销毁时不该继续持有 ctx 回调。
  ui.unbindSettingsClose()
})
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
        <!-- 这是一条**语义状态色**（"正在跟随"= 亮绿，同"录制中"用红）：底色不随主题变，
             所以前景也必须恒为深色才有对比（用 text-ink 的话暗色主题下白字压绿底会看不清）。 -->
        <!-- 主题色白名单: 跟随横幅的语义状态色，恒亮绿底 + 恒深前景（不随主题变） -->
        <div v-if="s.following" class="absolute left-1/2 top-0 z-[55] flex -translate-x-1/2 items-center gap-2 rounded-b-xl bg-[#25e44e] px-3 py-1.5 text-[13px] text-[#111] shadow-[0_4px_12px_rgba(0,0,0,0.25)]" role="status">
          <span class="size-2 rounded-full bg-white"></span>
          <span>正在跟随</span>
          <!-- 同上：白胶囊 + 深字压在恒亮绿横幅上，靠固定对比度保证可读，不随主题变 -->
          <!-- 主题色白名单: 跟随横幅内的白胶囊按钮，压在恒亮绿底上需恒定对比 -->
          <button class="h-[18px] rounded-full bg-white px-2 text-[11px] font-medium leading-none text-[#111] transition-colors hover:bg-white/90" aria-label="退出跟随" @click="s.following = false">取消ESC</button>
        </div>
        <!-- 真实画布 -->
        <!-- 函数 ref：字符串 ref("ui.hostEl") 带点号 Vue 绑不上（hostEl 恒 null → 设置改动永远到不了画布）。
             必须经 setHostEl 写 ref.value；直接 `ui.hostEl = el` 只会覆盖属性、写不进 ref（绑定仍失效）。 -->
        <CanvasHost
          :ref="ui.setHostEl"
          :plugins="plugins"
          :adapter="adapter"
          :seed="seedDefaultCanvas"
          :edge-visual="ui.cfg.edge"
          :handle-visual="ui.cfg.handle"
          :debug-visual="ui.cfg.debug"
          :snap-zone-visual="ui.cfg.snapZone"
          :dev="DEV"
          window-key="MiniCanvasUI"
          @ready="onCanvasReady"
        >
          <template #ui>
            <SettingsHost v-if="s.settingsOpen" />
            <!-- 小地图：插件注册在 mini-map 专用槽；这里只给它一个宿主选择的位置（逐帧跟随状态栏按钮） -->
            <div ref="miniMapEl" class="fixed left-0 top-0 z-[25]" style="pointer-events: none">
              <div style="pointer-events: auto">
                <SlotHost slot="mini-map" />
              </div>
            </div>
          </template>
        </CanvasHost>
      </div>
    </template>

    <template #status><StatusArea /></template>
    <template #dock><DockArea /></template>

    <LeftDrawer />
    <ChatPanel />
    <ModalsArea />

  </CanvasShell>
</template>

<style scoped>
.app-root { height: 100vh; overflow: hidden; }
</style>
