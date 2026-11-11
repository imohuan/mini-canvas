import type { SettingsStore } from '@plume-canvas/kernel'
import {
  EDGE_SETTING_KEYS, HANDLE_SETTING_KEYS, DEBUG_SETTING_KEYS, SNAP_ZONE_SETTING_KEYS,
} from '@plume-canvas/theme-contract'
import { registerPendingSave } from '../pendingSave'
import type { UiConfig, UiState } from './createUiState'
import type { UiHostScope } from './useUiHost'
import type { CanvasTreeScope } from './useCanvasTreeScope'
import type { CanvasListScope } from './useCanvasList'
import type { HistoryScope } from './useHistoryScope'
import type { AssetScope } from './useAssetScope'
import type { CanvasTogglesScope } from './useCanvasToggles'
import type { ThemeScope } from './useThemeScope'
import type { ViewportScope } from './useViewportControls'

/**
 * 外壳生命周期：设置/主题/开关/视口/画布树订阅与 onReady 的安装顺序。
 *
 * 顺序逐条照搬原 ui.ts 的 onReady（registerPendingSave → 主题 → 设置关闭 → 开关 →
 * 视口 → 画布树 → 当前画布/历史 → 资产/项目 → 插件 → 历史 → 资产变更广播）。
 */
export function createUiLifecycle(deps: {
  state: UiState
  cfg: UiConfig
  host: UiHostScope
  canvasTree: CanvasTreeScope
  canvasList: CanvasListScope
  history: HistoryScope
  assets: AssetScope
  toggles: CanvasTogglesScope
  theme: ThemeScope
  viewport: ViewportScope
  shortcuts: { refreshShortcuts(): void }
}) {
  const { state, cfg, host, canvasTree, canvasList, history, assets, toggles, theme, viewport, shortcuts } = deps
  const { hostEl } = host
  const { flushCanvasSave } = canvasList
  const { loadHistory } = history
  let disposeSettingsBind: (() => void) | undefined

  /**
   * 内核事件 'settings:ui-close' 的订阅句柄。
   *
   * 为什么必须有：settingsPanel 是**可替换槽**，面板的关闭动作统一经 ctx.emit('settings:ui-close')
   * 通知宿主（渲染层 SettingsShell 的 ✕ / 遮罩 / Esc 都从这里出去，皮不需要自己发）。装配层若不订阅，
   * ✕ / 点遮罩就**静默失效**：不报错、不 warn、画面照旧，只有全局 Esc 兜得住。
   * 这里是那次广播的落点（把 settingsOpen 置 false → <SettingsHost v-if> 卸载面板）。
   */
  let disposeSettingsClose: (() => void) | undefined
  /** 设置面板里的「动作项」（如快捷键）广播；与关闭通道同处订阅，换皮不影响 */
  let disposeSettingsAction: (() => void) | undefined

  /**
   * 订阅设置面板的关闭广播（内核事件 settings:ui-close）。
   *
   * 面板换皮后关闭动作仍走同一条内核事件，所以这里订阅的是**契约**而不是某个具体皮：
   * 渲染层 SettingsShell 统一 emit 它（任何皮都用同一个外壳，所以换皮不改变关闭行为）。
   * 重复调用（宿主重建 / 热重载）先撤旧订阅，避免回调堆积。
   */
  function bindSettingsClose(): void {
    disposeSettingsClose?.()
    disposeSettingsClose = undefined
    disposeSettingsAction?.()
    disposeSettingsAction = undefined
    const ctx = hostEl.value?.host?.ctx
    if (!ctx) return
    disposeSettingsClose = ctx.on('settings:ui-close', closeSettings).dispose
    // ctx.on 的类型签名只声明无参回调；payload 由事件总线原样转发，这里显式收窄。
    const onSettingsAction = (payload?: { action?: string }): void => {
      if (payload?.action === 'shortcuts') {
        // 「快捷键」不是配置页：关掉设置，打开画布已有的快捷键帮助浮层
        closeSettings()
        shortcuts.refreshShortcuts()
        state.shortcutsOpen = true
      }
    }
    disposeSettingsAction = ctx.on('settings:ui-action', onSettingsAction as unknown as () => void).dispose
  }

  /** 撤掉关闭广播订阅（宿主销毁时调用；重复 onReady 时由 bindSettingsClose 内部自动撤）。 */
  function unbindSettingsClose(): void {
    disposeSettingsClose?.()
    disposeSettingsClose = undefined
    disposeSettingsAction?.()
    disposeSettingsAction = undefined
  }

  /** 关闭设置面板：面板经内核事件 settings:ui-close 广播进来，装配层其它部件也可直接调用。 */
  function closeSettings(): void {
    state.settingsOpen = false
  }

  function bindThemeSettings(): void {
    const ctx = hostEl.value?.host?.ctx
    if (!ctx) return
    const store = ctx.get<SettingsStore>('settings')
    const targetOf = (key: string): Record<string, unknown> | undefined =>
      (EDGE_SETTING_KEYS as readonly string[]).includes(key) ? (cfg.edge as unknown as Record<string, unknown>)
        : (HANDLE_SETTING_KEYS as readonly string[]).includes(key) ? (cfg.handle as unknown as Record<string, unknown>)
          : (DEBUG_SETTING_KEYS as readonly string[]).includes(key) ? (cfg.debug as unknown as Record<string, unknown>)
            : (SNAP_ZONE_SETTING_KEYS as readonly string[]).includes(key) ? (cfg.snapZone as unknown as Record<string, unknown>)
              : undefined
    for (const k of [...EDGE_SETTING_KEYS, ...HANDLE_SETTING_KEYS, ...DEBUG_SETTING_KEYS, ...SNAP_ZONE_SETTING_KEYS]) {
      const v = store.get(k as string)
      const t = targetOf(k as string)
      if (v !== undefined && t) t[k as string] = v
    }
    // 插槽调试开关 = <html data-slot-debug>：CSS（canvas-render）与调试覆盖层（主题）都只看它，
    // 不再由每个外壳区域传 debug 参数。
    const syncSlotDebug = (): void => {
      // 单测（node 环境）没有 document：跳过即可，不影响任何逻辑
      if (typeof document === 'undefined') return
      const root = document.documentElement
      if (store.get('slotDebug') === true) root.setAttribute('data-slot-debug', 'on')
      else root.removeAttribute('data-slot-debug')
    }
    syncSlotDebug()
    // 组件库使用标记：外壳只负责把开关同步成 <html> 属性；调试层是否挂载由 App.vue 决定。
    // 属性名带 -enabled 后缀：调试层按 [data-ui-kit-debug] 找"使用点"，
    // 根节点若用同名属性会被当成一个组件（属性值 "on" 不是定位串，白扫一遍）。
    const syncUiKitDebug = (): void => {
      if (typeof document === 'undefined') return
      const root = document.documentElement
      if (store.get('uiKitDebug') === true) root.setAttribute('data-ui-kit-debug-enabled', 'on')
      else root.removeAttribute('data-ui-kit-debug-enabled')
    }
    syncUiKitDebug()
    disposeSettingsBind = store.onChange((key, value) => {
      const t = targetOf(key)
      if (t) t[key] = value
      if (key === 'slotDebug') syncSlotDebug()
      if (key === 'uiKitDebug') syncUiKitDebug()
    }).dispose
  }

  async function installExternalPlugins(): Promise<void> {
    // 有意空实现：装载入口在「插件管理」面板（plugin-manager 插件）。
    return
  }

  async function onReady(): Promise<void> {
    // 每次宿主就绪都重新注册：上一次离开画布时 App.vue 已把它注销了（见 releasePendingSave）
    registerPendingSave(flushCanvasSave)
    bindThemeSettings()
    theme.bindThemeMode()
    bindSettingsClose()
    toggles.bindCanvasToggles()
    viewport.bindZoomSync()
    canvasTree.bindCanvasTree()
    // 当前画布 / 画布清单：从 URL 认当前是哪张，再拉（可能跨项目）它的清单
    canvasList.currentCanvasId.value = canvasList.canvasIdFromUrl()
    // 换了画布（切画布 / 从项目页进另一张）：历史页码与签名要跟着复位，否则会拿旧页码去拉
    history.alignHistoryToCanvas()
    void canvasList.refreshCanvasList()
    void assets.loadAssets()
    // 文件夹清单也在就绪时拉一次（不只等「打开资产 tab」）：
    // 「加入资产库」上传弹窗的"保存位置"下拉、节点/多选的资产入口都要用它，
    // 那些入口在抽屉关着时也能用 —— 只在开 tab 时拉就会看到空/过期的下拉。
    void assets.loadAssetFolders()
    void canvasList.loadProjectName()
    await installExternalPlugins()
    // 外部插件装完（云插件会挂上 cloud-client:history 服务）再拉历史；顺带订阅"有新生成"
    void loadHistory()
    history.bindHistoryUpdates()
    history.bindHistoryFilters()
    // 外部插件（多选工具栏 / 节点右键）往资产库塞了新东西时刷新清单
    bindAssetsChanged()
  }

  /**
   * 订阅「资产库被外部入口改了」（多选工具栏「加入资产库」、节点右键「加入资产库」）：
   * 那些入口走插件、直接 POST /api/assets，不经过 ui 层 —— 发一条 window 事件，
   * 这里收到就重拉资产清单，左侧面板立刻能看到新条目。
   */
  let disposeAssetsChanged = false
  function onAssetsChanged(): void {
    void assets.loadAssets()
    if (state.leftTab === 'assets') void assets.loadAssetFolders()
  }
  function bindAssetsChanged(): void {
    if (typeof window === 'undefined') return // Node 单测环境无 window：跳过副作用
    window.removeEventListener('plume-canvas:assets-changed', onAssetsChanged)
    window.addEventListener('plume-canvas:assets-changed', onAssetsChanged)
    disposeAssetsChanged = true
  }
  function unbindAssetsChanged(): void {
    if (typeof window === 'undefined') return
    window.removeEventListener('plume-canvas:assets-changed', onAssetsChanged)
    disposeAssetsChanged = false
  }

  return {
    onReady, bindThemeSettings, closeSettings, bindSettingsClose, unbindSettingsClose, bindAssetsChanged, unbindAssetsChanged,
  }
}

export type UiLifecycle = ReturnType<typeof createUiLifecycle>

