<script setup lang="ts">
// App.vue —— 画布应用的**装配层**。
//
// 各区域已组件化（components/areas/*），这里只负责：
//   1. 从根级 Provider 取唯一的内核上下文（插件/存储/窗口句柄都在这）
//   2. 挂 CanvasShell 布局壳并把区域组件放进对应插槽
//   3. 挂真实 CanvasHost（只画画布，不再启动）
//   4. 全局键盘（Esc / Ctrl+/）
//
// 区域组件共享 useUi() 单例状态（composables/ui.ts），互相之间不需要 prop 透传。
import { CanvasHost, SettingsHost, SlotHost, mountCanvas, unmountCanvas } from '@mini-canvas/canvas-render'
import type { CanvasHostHandle } from '@mini-canvas/canvas-render'
import { MessageSquarePlus, Video, Type, Image as ImageIcon } from 'lucide-vue-next'
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
// 插槽调试覆盖层由默认主题提供（与主题的 Dropdown 同一套浮层与定位）
import DefaultSlotDebugOverlay from '@mini-canvas/plugin-theme-default/components/ui/SlotDebugOverlay.vue'
import { setReadyHost, useUi, useUiComponentOutside } from './composables/ui'
import { registerShellCommands } from './shellCommands'
import { handleTab } from './tabPageOnly'
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, watch } from 'vue'
import { provideMiniMapDockTarget } from './composables/miniMapDock'
import { flushPendingSave } from './composables/pendingSave'
import { CANVAS_PLUGINS, seedDefaultCanvas } from './assembly'
import { APP_SHELL_KEY, type AppShell } from './app-shell'
import { inject } from 'vue'

const ui = useUi()
/** 按钮在根 Provider ready 后才渲染，用宿主单例取件。 */
const Button = useUiComponentOutside('Button')
/** 插槽调试覆盖层按 ui 目录取；没装主题/没登记时回落默认皮。 */
const SlotDebugOverlay = useUiComponentOutside('slotDebugOverlay')
/** 模板 :is 用；目录没登记时回落默认皮。 */
const DebugOverlay = computed(() => SlotDebugOverlay.value ?? DefaultSlotDebugOverlay)
/**
 * 组件库使用标记：按需异步加载。
 *
 * 构建版也要能用（2026-11-02 用户反馈）：以前这里是 import.meta.env.DEV ? … : null，
 * cloud-server 托管的构建版永远是 null，开关打开了也看不到任何圆点。
 * 现在两种构建都保留这段代码；是否挂载仍由开关决定，关着时零开销。
 */
const UiKitDebugOverlay = defineAsyncComponent(
  () => import('@mini-canvas/plugin-theme-default/components/ui/UiKitDebugOverlay.vue'),
)
const s = ui.state

// 外壳命令（打开抽屉 / 切页签 / 收起展开）：注册在 Provider 的 ctx 上，
// 插件按钮通过 command 调用，不反向依赖 @mini-canvas/ui 的状态。
let shellCommandDisposers: Array<{ dispose(): void }> = []

// 根级应用底座：由 Root.vue 的 AppProvider 提供。画布会话在 onMounted 里挂上。
const shell = inject(APP_SHELL_KEY) as AppShell

// ===== 小地图位置：Teleport 到状态栏按钮旁的挂点 =====
//
// 旧实现（2026-10-28 用户报障）：地图在画布 #ui 的 fixed 容器里，位置靠 JS 读按钮矩形
// 再写 transform。抽屉开合是 CSS transform 动画，尺寸不变 → ResizeObserver 收不到，
// 只能等 2 秒轮询 → 地图落后按钮 0.5~2 秒「闪」过去。
//
// 现在：StatusArea 里的「切换小地图」按钮旁有一个零尺寸挂点，地图 Teleport 到那里，
// 用 absolute 浮在按钮正上方。地图与按钮处于同一个 transform 上下文，父级动画一起走，
// 不需要任何读坐标 / 定时器。Teleport 的目标不在画布子树内也不影响：SlotHost 只需要
// 渲染上下文，Provider 在最外层已经给它包好了。
const miniMapDock = provideMiniMapDockTarget()
function bindHost(host: CanvasHostHandle): void {
  setReadyHost(host)
  ui.setHostEl({ host })
  // 插件管理服务必须**在宿主就绪时就拿到安装句柄**，不能等用户打开「设置 → 插件」页。
  // 启动时它会按安装名单补装上次装过、这次冷启动没装的插件（小地图 / 自动布局这类）；
  // 只在页面里 bind 的话，没打开过设置页的会话里这些补装全部失败（错误落在 row.error，
  // 界面显示「宿主没有提供 host.manager」，插件看起来像装了又消失）。
  // bindManager 幂等：页面挂载时再绑一次是同一个句柄，不会重复安装。
  const pluginManager = host.ctx.tryGet<{ bindManager?(m: unknown): Promise<void> }>('plugin-manager')
  if (pluginManager?.bindManager) void pluginManager.bindManager(host.manager)
  void ui.onReady()
  for (const d of shellCommandDisposers) d.dispose()
  shellCommandDisposers = registerShellCommands(host.ctx, ui)
}

/** 当前画布会话；离开画布时先落盘再卸。 */
let session: Awaited<ReturnType<typeof mountCanvas>> | undefined
let disposed = false

onMounted(async () => {
  try {
    session = await mountCanvas({
      ctx: shell.ctx,
      appBase: shell.appBase,
      seed: seedDefaultCanvas,
      dev: import.meta.env.DEV,
      plugins: CANVAS_PLUGINS,
    })
    if (disposed) {
      await session.dispose()
      session = undefined
      return
    }
    shell.setSession(session)
    bindHost(session.host)
  } catch (err) {
    console.error('[ui] 画布会话启动失败', err)
  }
})

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
  disposed = true
  window.removeEventListener('keydown', onKeydown)
  for (const d of shellCommandDisposers) d.dispose()
  shellCommandDisposers = []
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
  // 先把脏改动写完，再卸画布会话（卸掉后 save 服务就不在了）。
  // 这里不能 await：Vue 的卸载钩子是同步的；路由守卫里还有一次 await flushPendingSave，
  // 两处合起来保证"离开前写完"。
  void flushPendingSave()
  const current = session
  session = undefined
  shell.setSession(undefined)
  void current?.dispose()
})
</script>

<template>
  <!-- 会话挂载完成前只显示占位：CanvasHost 在 setup 里就读 host，空值会让整页白屏。 -->
  <div v-if="!shell.sessionHost.value" class="canvas-session-loading">正在打开画布…</div>
  <CanvasShell v-else class="app-root" :theme="s.theme" :left-width="s.drawer === 'left' ? s.drawerWidth : 0"
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
                    <component :is="item.icon === 'video' ? Video : item.icon === 'text' ? Type : ImageIcon"
                      :size="16" />
                  </span>
                  <span class="min-w-0 flex-1"><strong class="block truncate text-xs">{{ item.name }}</strong><small
                      class="block truncate text-[10px] text-ink-dim">{{ item.meta }}</small></span>
                  <Button variant="ghost" size="icon-xs" class="text-ink-dim hover:text-ink"
                    :aria-label="'对话 ' + item.name" @click.stop="ui.showToast('与 ' + item.name + ' 对话')">
                    <MessageSquarePlus :size="14" />
                  </Button>
                </article>
              </div>
            </section>
          </div>
          <!-- 「正在跟随」协作横幅 -->
          <!-- 这是一条**语义状态色**（"正在跟随"= 亮绿，同"录制中"用红）：底色不随主题变，
             所以前景也必须恒为深色才有对比（用 text-ink 的话暗色主题下白字压绿底会看不清）。 -->
          <!-- 主题色白名单: 「正在跟随」横幅的语义状态色（亮绿），恒亮绿底 + 恒深前景，不随主题变 -->
          <div v-if="s.following" role="status"
            class="absolute left-1/2 top-0 z-[55] flex -translate-x-1/2 items-center gap-2 rounded-b-xl bg-[#25e44e] px-3 py-1.5 text-[13px] text-[#111] shadow-[0_4px_12px_rgba(0,0,0,0.25)]"><!-- 主题色白名单: 语义状态色（亮绿横幅），见上方注释 -->
            <span class="size-2 rounded-full bg-white"></span>
            <span>正在跟随</span>
            <!-- 主题色白名单: 横幅内的白胶囊按钮，压在恒亮绿底上需恒定对比 -->
            <Button
              variant="ghost" size="xs"
              class="h-[18px] rounded-full bg-white px-2 text-[11px] font-medium leading-none text-[#111] hover:bg-white/90"><!-- 主题色白名单: 恒亮绿底上的恒白胶囊，见上方注释 -->
              aria-label="退出跟随" @click="s.following = false">取消ESC</Button>
          </div>
          <!-- 真实画布 -->
          <!-- 函数 ref：字符串 ref("ui.hostEl") 带点号 Vue 绑不上（hostEl 恒 null → 设置改动永远到不了画布）。
             必须经 setHostEl 写 ref.value；直接 `ui.hostEl = el` 只会覆盖属性、写不进 ref（绑定仍失效）。 -->
          <CanvasHost :edge-visual="ui.cfg.edge" :handle-visual="ui.cfg.handle" :debug-visual="ui.cfg.debug"
            :snap-zone-visual="ui.cfg.snapZone">
            <template #ui>
              <SettingsHost v-if="s.settingsOpen" />
              <!-- Agent 面板外壳：放在 #ui 里（它在 <CanvasHost> 渲染子树内），
                 里面的 <SlotHost slot="agent-conversation" /> 才拿得到渲染上下文；
                 组件自己用 fixed 定位，所以放哪一层不影响它出现在哪。 -->
              <AgentPanel />
              <!-- 小地图：插件注册在 mini-map 专用槽。
                 Teleport 到状态栏按钮旁的零尺寸挂点（见 miniMapDock.ts），absolute 浮在按钮
                 正上方 —— 地图与按钮共享父级 transform，开合抽屉时同一帧一起移动。 -->
              <!-- 挂点还没渲染时整段不渲染：不要退回 body，否则会在地图第一次出现时闪到左上角 -->
              <Teleport v-if="miniMapDock" :to="miniMapDock" defer>
                <div class="mini-map-dock-layer">
                  <SlotHost slot="mini-map" />
                </div>
              </Teleport>
              <!-- 资产浮层（资产管理弹窗 / 全屏预览）+ 「引用被点了」事件的监听。
                 必须待在渲染子树里（ctx.on 与主题注册件都只有子树内取得到），组件本身不占位。 -->
              <AssetUiSlot />
            </template>
          </CanvasHost>
        </div>
      </template>

      <template #status>
        <div class="flex items-end gap-1">
          <StatusArea />
        </div>
      </template>
      <template #dock>
        <DockArea />
      </template>

      <LeftDrawer />
      <ModalsArea />
      <!-- 「加入资产库」贴进来的图 → 复用左侧同一个上传弹窗（节点右键 / 多选上控制栏两条入口） -->
      <AssetUploadHost />
      <!-- 插槽调试覆盖层：默认主题提供，全应用只挂一次。
           它读 <html data-slot-debug="on"> 与 data-slot / data-slot-id，不需要各区域传参。 -->
      <component :is="DebugOverlay" />
      <!-- 组件库使用标记：默认关闭；关闭时组件不挂载，监听与扫描都不存在。 -->
      <component :is="UiKitDebugOverlay" v-if="UiKitDebugOverlay && s.cfg.debug.uiKitDebug" />

    </CanvasShell>
</template>

<style scoped>
.app-root {
  height: 100vh;
  overflow: hidden;
}
.canvas-session-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100vh;
  color: var(--ui-ink-dim, #6b7280);
  background: var(--ui-canvas-bg, #f5f6f8);
  font: 13px system-ui, 'Microsoft YaHei', sans-serif;
}
</style>
