import { reactive } from 'vue'
import { DRAWER_TAB_ASSETS } from '../drawerTabs'
import type { UiState } from './createUiState'
import type { UiHostScope } from './useUiHost'
import type { AssetScope } from './useAssetScope'
import type { HistoryScope } from './useHistoryScope'
import type { ShortcutsScope } from './useShortcutsScope'

/**
 * 外壳面板开关与抽屉：抽屉页签、快捷键/历史弹窗、侧栏收起、菜单收口。
 */
export function createShellScope(
  state: UiState,
  host: UiHostScope,
  assets: AssetScope,
  history: HistoryScope,
  shortcuts: ShortcutsScope,
) {
  const { showToast } = host
  const { loadAssets, loadAssetFolders } = assets

  function openDrawer(which: 'left' | 'roles'): void {
    state.drawer = state.drawer === which ? null : which
  }
  /** 打开左侧抽屉，保留当前页签（外壳命令用）。 */
  function showLeftDrawer(): void {
    state.drawer = 'left'
  }
  /**
   * 打开左侧抽屉并切到指定页签。
   *
   * 唯一入口：内置页签、插件页签、外壳命令都走它，避免各处直接写 state.leftTab
   * 后漏掉“打开资产页时要拉清单”这类副作用。
   */
  function openDrawerTab(id: string): void {
    state.leftTab = id
    state.drawer = 'left'
    if (id === DRAWER_TAB_ASSETS) {
      void loadAssets()
      void loadAssetFolders()
    }
  }
  /** 开面板前先重读一次注册表（插件热装/热卸后开面板即见最新键位） */
  function toggleShortcuts(): void {
    if (!state.shortcutsOpen) {
      shortcuts.ensureShortcutManager()
      shortcuts.refreshShortcuts()
    }
    state.shortcutsOpen = !state.shortcutsOpen
  }
  /** 开关历史弹窗：打开时重拉一页（后台那边可能已经有新的了） */
  function toggleHistory(): void {
    state.historyOpen = !state.historyOpen
    if (!state.historyOpen) return
    /**
     * 每次打开都从第 1 页开始，但按这套筛选**上次加载到的页数**一次补齐 ——
     * 只拉第 1 页会让用户以为之前翻的页丢了（用户口径 2026-10-28）。
     */
    history.resetHistoryRequest()
    state.histPage = 1
    history.openHistoryView()
  }
  function toggleLeftCollapsed(): void {
    state.leftCollapsed = !state.leftCollapsed
    if (state.leftCollapsed) {
      state.drawer = null
      showToast('已收起节点侧栏')
    } else {
      state.drawer = 'left'
      showToast('已展开节点侧栏')
    }
  }

  function closeMenus(): void {
    state.canvasMenuOpen = false
    state.addMenuOpen = false
    state.filterTypeOpen = false
    state.filterRatingOpen = false
  }
  return {
    openDrawer, showLeftDrawer, openDrawerTab, toggleShortcuts, toggleHistory, toggleLeftCollapsed,
    closeMenus,
  }
}

export type ShellScope = ReturnType<typeof createShellScope>

