import { computed, reactive } from 'vue'
import { createV2Logger } from '@mini-canvas/canvas-render'
export { readyHost, uiComponentOf, useUiComponentOutside, setReadyHost } from './ui/hostRuntime'
export type { TreeNode, HostApi, HostLike } from './ui/types'
export { DRAWER_TAB_ASSETS, DRAWER_TAB_CANVAS } from './drawerTabs'

const log = createV2Logger('config')
import { createUiState } from './ui/createUiState'
import { createUiHostScope } from './ui/useUiHost'
import { createCanvasTreeScope } from './ui/useCanvasTreeScope'
import { createCanvasListScope } from './ui/useCanvasList'
import { createHistoryScope } from './ui/useHistoryScope'
import { createAssetScope } from './ui/useAssetScope'
import { createAgentShellScope } from './ui/useAgentShell'
import { createCanvasTogglesScope } from './ui/useCanvasToggles'
import { createThemeScope } from './ui/useThemeScope'
import { createShortcutsScope } from './ui/useShortcutsScope'
import { createShellScope } from './ui/useShellControls'
import { createViewportScope } from './ui/useViewportControls'
import { createCanvasNodeActionsScope } from './ui/useCanvasNodeActions'
import { createCreateNodeScope } from './ui/useCreateNode'
import { createPanelResizeScope } from './ui/usePanelResize'
import { createUiLifecycle } from './ui/useUiLifecycle'

/**
 * useUi 的组合入口。
 *
 * 这里只把各域 hook 按原 ui.ts 的创建顺序接起来，并保持返回对象的键与形状不变。
 * 任何域内逻辑都不在这里重写 —— 改逻辑请改对应的 hook。
 */
export function createUi() {
  const { state, cfg } = createUiState()
  const host = createUiHostScope()
  const canvasTree = createCanvasTreeScope(state, host)
  const canvasList = createCanvasListScope(state, host)
  const history = createHistoryScope(state, host, canvasList)
  const assets = createAssetScope(state, host)
  const agent = createAgentShellScope(state)
  const toggles = createCanvasTogglesScope(state, host)
  const theme = createThemeScope(state, host)
  const shortcuts = createShortcutsScope(state, () => host.hostEl.value ?? null)
  const shell = createShellScope(state, host, assets, history, shortcuts)
  const viewport = createViewportScope(state, host)
  const nodes = createCreateNodeScope(state, host, assets, viewport)
  const nodeActions = createCanvasNodeActionsScope(host, canvasTree, viewport)
  const panelResize = createPanelResizeScope(state)
  const lifecycle = createUiLifecycle({
    state, cfg, host, canvasTree, canvasList, history, assets, toggles, theme, viewport, shortcuts,
  })

  return {
    state, cfg, tree: canvasTree.tree, filteredTree: canvasTree.filteredTree, collapsed: canvasTree.collapsed,
    treeTotal: canvasTree.treeTotal, histVisible: history.histVisible, histCount: history.histCount,
    histErrorCount: history.histErrorCount, assetItems: assets.assetItems, filteredAssets: assets.filteredAssets,
    assetCount: history.histCount, shortcuts: shortcuts.shortcuts,
    loadMoreHistory: history.loadMoreHistory,
    batchDeleteHistory: history.batchDeleteHistory, batchRateHistory: history.batchRateHistory,
    batchSaveAssets: history.batchSaveAssets,
    currentCanvasId: canvasList.currentCanvasId, canvasListItems: canvasList.canvasListItems,
    canvasNameOf: canvasList.canvasNameOf, refreshCanvasList: canvasList.refreshCanvasList,
    openCanvas: canvasList.openCanvas, newCanvas: canvasList.newCanvas, renameCanvas: canvasList.renameCanvas,
    loadAssets: assets.loadAssets,
    openCanvasInNewWindow: canvasList.openCanvasInNewWindow, renameCanvasById: canvasList.renameCanvasById,
    duplicateCanvas: canvasList.duplicateCanvas, deleteCanvas: canvasList.deleteCanvas,
    canvasOptions: canvasList.canvasOptions, loadProjectName: canvasList.loadProjectName,
    renameProject: canvasList.renameProject, currentProjectId: canvasList.currentProjectId,
    flushCanvasSave: canvasList.flushCanvasSave, releasePendingSave: canvasList.releasePendingSave,
    minimapOn: toggles.minimapOn, toggleMinimap: toggles.toggleMinimap,
    agent: agent.agent, setAgentOpen: agent.setAgentOpen, toggleAgent: agent.toggleAgent,
    newAgentChat: agent.newAgentChat, toggleAgentHistory: agent.toggleAgentHistory,
    openAgentSession: agent.openAgentSession, renameAgentSession: agent.renameAgentSession,
    deleteAgentSession: agent.deleteAgentSession,
    openAgentConversation: agent.openAgentConversation, deleteAgentConversation: agent.deleteAgentConversation,
    toggleEdges: toggles.toggleEdges, toggleSnap: toggles.toggleSnap, organizeCanvas: toggles.organizeCanvas,
    setCanvasMode: toggles.setCanvasMode, unbindCanvasToggles: toggles.unbindCanvasToggles,
    unbindThemeMode: theme.unbindThemeMode,
    syncZoomDisplay: viewport.syncZoomDisplay, zoomInStep: viewport.zoomInStep, zoomOutStep: viewport.zoomOutStep,
    zoomToPercent: viewport.zoomToPercent, zoomToMax: viewport.zoomToMax, zoomFit: viewport.zoomFit,
    unbindZoomSync: viewport.unbindZoomSync,
    loadHistory: history.loadHistory, unbindHistory: history.unbindHistory,
    hostEl: host.hostEl, setHostEl: host.setHostEl, showToast: host.showToast, onReady: lifecycle.onReady,
    createNode: nodes.createNode, toggleTheme: theme.toggleTheme, applyTheme: theme.applyTheme,
    openDrawer: shell.openDrawer, showLeftDrawer: shell.showLeftDrawer, openDrawerTab: shell.openDrawerTab,
    closeSettings: lifecycle.closeSettings, runCommand: host.runCommand,
    addAssetToCanvas: nodes.addAssetToCanvas, dropAssetToCanvas: nodes.dropAssetToCanvas,
    addAssetToAgent: nodes.addAssetToAgent, addFolderToAgent: nodes.addFolderToAgent,
    addFolderAssetsToCanvas: nodes.addFolderAssetsToCanvas, screenToFlow: nodes.screenToFlow,
    createAssetNode: nodes.createAssetNode,
    addFilesToCanvas: nodes.addFilesToCanvas,
    importPackFile: nodes.importPackFile,
    importPackFromUrl: nodes.importPackFromUrl,
    uploadAssets: assets.uploadAssets, uploadAssetsTo: assets.uploadAssetsTo,
    uploadAssetsFromUrls: assets.uploadAssetsFromUrls, deleteAssetById: assets.deleteAssetById,
    assetFolders: assets.assetFolders, assetFolderTree: assets.assetFolderTree,
    flatFoldersForUpload: assets.flatFoldersForUpload, assetTagOptions: assets.assetTagOptions,
    loadAssetFolders: assets.loadAssetFolders, newAssetFolder: assets.newAssetFolder,
    moveAssetTo: assets.moveAssetTo,
    renameAssetById: assets.renameAssetById,
    renameAssetFolderById: assets.renameAssetFolderById, removeAssetFolder: assets.removeAssetFolder,
    moveSelectedAssets: assets.moveSelectedAssets, tagsForAsset: assets.tagsForAsset,
    setAssetFolderIcon: assets.setAssetFolderIcon,
    moveAssetFolderTo: assets.moveAssetFolderTo, createImageNodeWithUrl: nodes.createImageNodeWithUrl,
    toggleAssetBatch: assets.toggleAssetBatch, toggleAssetSelected: assets.toggleAssetSelected,
    unbindSettingsClose: lifecycle.unbindSettingsClose,
    toggleShortcuts: shell.toggleShortcuts, refreshShortcuts: shortcuts.refreshShortcuts,
    ensureShortcutManager: shortcuts.ensureShortcutManager,
    toggleHistory: shell.toggleHistory, toggleLeftCollapsed: shell.toggleLeftCollapsed,
    renameNode: nodeActions.renameNode, locateNode: nodeActions.locateNode,
    unbindCanvasTree: canvasTree.unbindCanvasTree, unbindAssetsChanged: lifecycle.unbindAssetsChanged,
    sendChat: shell.sendChat,
    removeNode: nodeActions.removeNode, duplicateNode: nodeActions.duplicateNode,
    referenceNodeToAgent: nodeActions.referenceNodeToAgent, ungroupNode: nodeActions.ungroupNode,
    renameChat: shell.renameChat, closeMenus: shell.closeMenus,
    startChatDrag: panelResize.startChatDrag, startDrawerResize: panelResize.startDrawerResize,
    startChatResize: panelResize.startChatResize, startChatCornerResize: panelResize.startChatCornerResize,
  }
}

type Ui = ReturnType<typeof createUi>
let inst: Ui | undefined
/** 共享单例：所有区域组件拿同一个状态对象 */
export function useUi(): Ui {
  inst ??= createUi()
  /**
   * 开发/排障用：把共享状态挂到 window。
   *
   * 生成历史这类"数据 → 渲染"的 bug 仅看 DOM 很难分辨"数据没换"还是"换了没画"；
   * 有这一个句柄就能在浏览器里直接读 historyItems / histPage / histTotal 来定性。
   * 只在浏览器里挂，SSR / 单测不受影响。
   */
  if (typeof window !== 'undefined') {
    ;(window as unknown as { __miniUiState?: unknown }).__miniUiState = inst.state
  }
  return inst
}
