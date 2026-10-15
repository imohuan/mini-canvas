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
import { createDefaultStorageAdapter, resolveAppPlugins, seedDefaultCanvas } from './assembly'
import CanvasShell from './components/CanvasShell.vue'
import TopLeftArea from './components/areas/TopLeftArea.vue'
import TopRightArea from './components/areas/TopRightArea.vue'
import StatusArea from './components/areas/StatusArea.vue'
import DockArea from './components/areas/DockArea.vue'
import LeftDrawer from './components/areas/LeftDrawer.vue'
import AgentPanel from './components/areas/AgentPanel.vue'
import ModalsArea from './components/areas/ModalsArea.vue'
import AssetUploadHost from './components/AssetUploadHost.vue'
import AssetUiSlot from './components/AssetUiSlot.vue'
import { setReadyHost, useUi } from './composables/ui'
import { handleTab } from './tabPageOnly'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

const ui = useUi()
const s = ui.state
// 装载清单 = 静态装配 + 按运行环境追加的自带件（cloud-server 托管时含云端连接，见 assembly）
const plugins = resolveAppPlugins()

// ===== 小地图跟随定位：每帧读状态栏「切换小地图」按钮的屏幕矩形，把地图贴在它正上方 =====
// 为什么要逐帧（而不是监听事件）：抽屉开合走 transform 过渡（getBoundingClientRect 每帧都变），
// resize/scroll 都感知不到这种过渡；常驻 rAF 逐帧重摆，动画全程贴合、拖拽调宽也跟手。
// 摆位是无状态重放（按钮左缘 x + 顶边 y → translate 平移自身 0%/100%），不累计差量：
// 窗口变化、配置改宽高都直接落到正确位置。
const miniMapEl = ref<HTMLElement | null>(null)
let miniMapLast = ''
/** 是否已完成首次摆位：未就位前元素保持不可见（防止闪现在 (0,0) 再跳到正确位置——用户实测报障） */
const miniMapPlaced = ref(false)
let miniMapResizeOb: ResizeObserver | null = null
let miniMapMutationOb: MutationObserver | null = null
let miniMapRetryTimer: ReturnType<typeof setInterval> | null = null
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
          if (!miniMapPlaced.value) miniMapPlaced.value = true // 首次就位 → 放行显示（同帧无闪现）
        }
      }
    }
  }
}
onMounted(() => {
  placeMiniMap()
  // 事件驱动摆位（原常驻 rAF 每帧强制回流 17ms/帧，trace 实测 → 33.3ms 空闲帧）。
  // 坑（2026-10-15 用户实测）：onMounted 时锚点按钮往往**还没渲染**（canvas boot 完才出
  // 工具栏），旧 rAF 版每帧重查所以最终会贴上；改事件驱动后若只查一次就永远停在 (0,0) 左上角。
  // 修复：按钮未出现 → MutationObserver 监听 DOM 变化等它出现；出现后 RO 观察**按钮自身**
  // （显示/隐藏也触发回调）+ 父容器；另留 2s 低频兜底轮询（成本可忽略），不再逐帧。
  const anchor = document.querySelector('button[aria-label="切换小地图"]')
  if (anchor && anchor.parentElement) {
    miniMapResizeOb = new ResizeObserver(() => placeMiniMap())
    miniMapResizeOb.observe(anchor)
    miniMapResizeOb.observe(anchor.parentElement)
  } else {
    miniMapMutationOb = new MutationObserver(() => {
      const el = document.querySelector('button[aria-label="切换小地图"]')
      if (el && el.parentElement) {
        miniMapMutationOb?.disconnect()
        miniMapMutationOb = null
        placeMiniMap()
        miniMapResizeOb = new ResizeObserver(() => placeMiniMap())
        miniMapResizeOb.observe(el)
        miniMapResizeOb.observe(el.parentElement)
      }
    })
    miniMapMutationOb.observe(document.body, { childList: true, subtree: true })
  }
  miniMapRetryTimer = setInterval(placeMiniMap, 2000)
  window.addEventListener('resize', placeMiniMap)
})
onBeforeUnmount(() => {
  miniMapResizeOb?.disconnect()
  miniMapResizeOb = null
  miniMapMutationOb?.disconnect()
  miniMapMutationOb = null
  if (miniMapRetryTimer) {
    clearInterval(miniMapRetryTimer)
    miniMapRetryTimer = null
  }
  window.removeEventListener('resize', placeMiniMap)
})
const adapter = createDefaultStorageAdapter()
const DEV = import.meta.env.DEV

function onKeydown(event: KeyboardEvent): void {
  /**
   * Tab：只在浮层内循环，页面上不漫游（用户口径 2026-10-14，见 tabPageOnly.ts 的说明）。
   *
   * 为什么必须真的拦：用户的批评「你 CSS 是关闭了，看不见了，但是它的实际功能依然存在。
   * 比如说 table 的时候，它依然会进行一个聚焦」—— focus-visible 的 outline 压掉只是**看不见**，
   * Tab 照样满屏跳。这里把它拦下来，才是真的解决。
   *
   * 位置在本函数**最前**：Tab 的接管不该被后面的 Esc / Ctrl+/ 分支影响。
   */
  if (event.key === 'Tab' && !event.ctrlKey && !event.metaKey && !event.altKey) {
    if (handleTab(document, document.activeElement, event.shiftKey)) event.preventDefault()
    return
  }
  if (event.key === 'Escape') {
    /**
     * 正在内联改名 / 正在拖拽时，Esc 只取消**那一件事**，不要顺带关掉整个抽屉。
     *
     * 为什么要挡（实测）：HTML5 拖拽的中途按 Esc 是「取消这次拖拽」的浏览器约定；
     * 而改名输入框自己的 Esc 已经处理了。若宿主在这里照样 s.drawer = null，
     * 用户按 Esc 取消拖拽的瞬间整个抽屉消失（数据还在、但看着像操作失败）。
     * 这两类状态由各自组件声明（data 属性 = 跨组件的最小契约）。
     */
    if (document.querySelector('input[data-row-rename], input[data-manage-rename], [data-dragging="1"]')) return
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
  // 撤掉画布开关的设置订阅（edgeVisible / snapToGrid / nodesDraggable 的镜像同步）。
  ui.unbindCanvasToggles()
  // 撤掉主题模式的设置订阅（themeMode 的镜像同步）。
  ui.unbindThemeMode()
  // 撤掉视口订阅（缩放读数的同步）。
  ui.unbindZoomSync()
  // 撤掉历史订阅（后台有新生成时的重拉）。
  ui.unbindHistory()
  // 撤掉画布树订阅（左侧抽屉跟着画布数据实时画的订阅）。
  ui.unbindCanvasTree()
  // 注销「离开画布前落盘」钩子（宿主已销毁，钩子里取不到 ctx 了）。
  ui.releasePendingSave()
})
</script>

<template>
  <CanvasShell class="app-root" :theme="s.theme" :left-width="s.drawer === 'left' ? s.drawerWidth : 0"
    :right-width="ui.agent.open && ui.agent.docked ? ui.agent.width : 0" :push-status="true" :push-dock="true">
    <template #top-left>
      <TopLeftArea />
    </template>
    <template #top-right>
      <TopRightArea />
    </template>

    <template #canvas>
      <div class="absolute inset-0">
        <!-- 故事板视图：三列面板（照 LibTV 实测 463/451/451） -->
        <div v-if="s.navMode === 'storyboard'" class="absolute inset-x-0 top-10 z-10 flex justify-center gap-2"
          aria-label="故事板视图">
          <section v-for="col in s.storyboard" :key="col.type"
            class="flex h-[807px] max-h-[calc(100vh-60px)] w-[451px] flex-col overflow-hidden rounded-t-xl bg-panel">
            <header class="flex items-center gap-2 px-4 py-3">
              <h3 class="text-sm font-medium">{{ col.type }}</h3><span
                class="rounded bg-chip px-1.5 text-[10px] text-ink-dim">{{ col.items.length }}</span>
            </header>
            <div class="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-3 pb-3">
              <article v-for="item in col.items" :key="item.name"
                class="flex cursor-pointer items-center gap-2 rounded-lg bg-veil p-2 transition-colors hover:bg-hover"
                @click="ui.showToast('打开 ' + item.name)">
                <span class="grid size-8 place-items-center rounded-md bg-chip text-ink-mute">
                  <component :is="item.icon === 'video' ? Video : item.icon === 'text' ? Type : ImageIcon" :size="16" />
                </span>
                <span class="min-w-0 flex-1"><strong class="block truncate text-xs">{{ item.name }}</strong><small
                    class="block truncate text-[10px] text-ink-dim">{{ item.meta }}</small></span>
                <button class="grid size-6 place-items-center rounded-md text-ink-dim hover:bg-hover hover:text-ink"
                  :aria-label="'对话 ' + item.name" @click.stop="ui.showToast('与 ' + item.name + ' 对话')">
                  <MessageSquarePlus :size="14" />
                </button>
              </article>
            </div>
          </section>
        </div>
        <!-- 「正在跟随」协作横幅 -->
        <!-- 这是一条**语义状态色**（"正在跟随"= 亮绿，同"录制中"用红）：底色不随主题变，
             所以前景也必须恒为深色才有对比（用 text-ink 的话暗色主题下白字压绿底会看不清）。 -->
        <!-- 主题色白名单: 「正在跟随」横幅的语义状态色（亮绿），恒亮绿底 + 恒深前景，不随主题变 -->
        <div v-if="s.following" role="status" class="absolute left-1/2 top-0 z-[55] flex -translate-x-1/2 items-center gap-2 rounded-b-xl bg-[#25e44e] px-3 py-1.5 text-[13px] text-[#111] shadow-[0_4px_12px_rgba(0,0,0,0.25)]">
          <span class="size-2 rounded-full bg-white"></span>
          <span>正在跟随</span>
          <!-- 主题色白名单: 横幅内的白胶囊按钮，压在恒亮绿底上需恒定对比 -->
          <button class="h-[18px] rounded-full bg-white px-2 text-[11px] font-medium leading-none text-[#111] transition-colors hover:bg-white/90" aria-label="退出跟随" @click="s.following = false">取消ESC</button>
        </div>
        <!-- 真实画布 -->
        <!-- 函数 ref：字符串 ref("ui.hostEl") 带点号 Vue 绑不上（hostEl 恒 null → 设置改动永远到不了画布）。
             必须经 setHostEl 写 ref.value；直接 `ui.hostEl = el` 只会覆盖属性、写不进 ref（绑定仍失效）。 -->
        <CanvasHost :ref="ui.setHostEl" :plugins="plugins" :adapter="adapter" :seed="seedDefaultCanvas"
          :edge-visual="ui.cfg.edge" :handle-visual="ui.cfg.handle" :debug-visual="ui.cfg.debug"
          :snap-zone-visual="ui.cfg.snapZone" :dev="DEV" window-key="MiniCanvasUI" @ready="onCanvasReady">
          <template #ui>
            <SettingsHost v-if="s.settingsOpen" />
            <!-- Agent 面板外壳：放在 #ui 里（它在 <CanvasHost> 渲染子树内），
                 里面的 <SlotHost slot="agent-conversation" /> 才拿得到渲染上下文；
                 组件自己用 fixed 定位，所以放哪一层不影响它出现在哪。 -->
            <AgentPanel />
            <!-- 小地图：插件注册在 mini-map 专用槽；这里只给它一个宿主选择的位置（逐帧跟随状态栏按钮） -->
            <div ref="miniMapEl" class="fixed left-0 top-0 z-[25]" :style="{ pointerEvents: 'none', visibility: miniMapPlaced ? 'visible' : 'hidden' }">
              <div style="pointer-events: auto">
                <SlotHost slot="mini-map" />
              </div>
            </div>
            <!-- 资产浮层（资产管理弹窗 / 全屏预览）+ 「引用被点了」事件的监听。
                 必须待在渲染子树里（ctx.on 与主题注册件都只有子树内取得到），组件本身不占位。 -->
            <AssetUiSlot />
          </template>
        </CanvasHost>
      </div>
    </template>

    <template #status>
      <StatusArea />
    </template>
    <template #dock>
      <DockArea />
    </template>

    <LeftDrawer />
    <ModalsArea />
    <!-- 「加入资产库」贴进来的图 → 复用左侧同一个上传弹窗（节点右键 / 多选上控制栏两条入口） -->
    <AssetUploadHost />

  </CanvasShell>
</template>

<style scoped>
.app-root {
  height: 100vh;
  overflow: hidden;
}
</style>
