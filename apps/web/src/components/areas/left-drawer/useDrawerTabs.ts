import { computed, markRaw, onBeforeUnmount, ref, watch } from 'vue'
import { useCanvasContext } from '@plume-canvas/canvas-render'
import { useUi } from '../../../composables/ui'
import {
  DRAWER_TAB_ASSETS,
  DRAWER_TAB_CANVAS,
  fallbackDrawerTab,
  resolveDrawerTabs,
  type DrawerHost,
} from '../../../composables/drawerTabs'

/**
 * LeftDrawer 的插件页签接线。
 *
 * 从 LeftDrawer.vue 原样搬出：槽变化、插件装卸都重读，非法页签只提示一次。
 * 返回值字段与拆分前同名，调用顺序不变。
 */
export function useDrawerTabs() {
  const ui = useUi()
  const s = ui.state

  // ===== 插件页签（第三个及之后的页签）=====
  //
  // 这是“左侧抽屉里多出来的一页”，不是路由/设置页。宿主负责高亮、切换、开合；
  // 插件只交按钮 + meta.panel。槽变化、插件装卸都要重读。
  const { ctx } = useCanvasContext()
  const slotTick = ref(0)
  const bumpSlots = (): void => { slotTick.value += 1 }
  const slotRegistry = ctx.get<{ subscribe(cb: () => void): () => void }>('slots')
  const slotOff = slotRegistry?.subscribe?.(bumpSlots)
  const offInstalled = ctx.on('ctx:plugin-installed', bumpSlots)
  const offUninstalled = ctx.on('ctx:plugin-uninstalled', bumpSlots)

  const pluginTabsResult = computed(() => {
    void slotTick.value
    return resolveDrawerTabs(ctx.slots.occupants('shell.drawer.tabs'), {
      reserved: [DRAWER_TAB_CANVAS, DRAWER_TAB_ASSETS],
    })
  })

  const pluginTabs = computed(() =>
    pluginTabsResult.value.tabs.map((t) => ({
      ...t,
      button: markRaw(t.button as object),
      panel: markRaw(t.panel as object),
    })),
  )

  const activePluginTab = computed(() =>
    pluginTabs.value.find((t) => t.id === s.leftTab),
  )

  // 插件卸载后当前页签可能消失：自动回画布，避免留一个空白正文。
  watch(
    pluginTabs,
    (tabs) => {
      const next = fallbackDrawerTab(s.leftTab, tabs.map((t) => t.id))
      if (next !== s.leftTab) s.leftTab = next
    },
    { immediate: true },
  )

  const drawerHost: DrawerHost = {
    get activeTab() { return s.leftTab },
    get width() { return s.drawerWidth },
    get collapsed() { return s.leftCollapsed },
    openTab: (id: string) => ui.openDrawerTab(id),
    close: () => { s.drawer = null },
    toggleCollapsed: () => ui.toggleLeftCollapsed(),
  }

  /** 下发给插件页签的共享 props：抽屉函数（按钮由插件从 ui 注册表取） */
  const slotShared = {
    openDrawerTab: (id: string) => ui.openDrawerTab(id),
    closeDrawer: () => { s.drawer = null },
  }

  /** 插件页签按钮的宿主数据：active / onSelect / host（与之前逐个 <component> 下发的一致） */
  function drawerTabProps(entry: { id: string }): Record<string, unknown> {
    return {
      active: s.leftTab === entry.id,
      onSelect: () => ui.openDrawerTab(entry.id),
      host: drawerHost,
    }
  }

  // 非法页签只提示一次：热装期间短暂缺面板是正常现象，不该刷屏。
  const warnedInvalid = new Set<string>()
  watch(
    () => pluginTabsResult.value.invalid,
    (list) => {
      for (const item of list) {
        const key = item.id + ':' + item.reason
        if (warnedInvalid.has(key)) continue
        warnedInvalid.add(key)
        console.warn('[left-drawer] 忽略页签 ' + item.id + '：' + item.reason)
      }
    },
    { immediate: true },
  )

  onBeforeUnmount(() => {
    slotOff?.()
    offInstalled.dispose()
    offUninstalled.dispose()
  })

  return {
    s,
    activePluginTab,
    drawerHost,
    slotShared,
    drawerTabProps,
  }
}
