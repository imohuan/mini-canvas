// Canvas Core — Public API
// 画布引擎核心包入口

import "./components/Decoration/node-theme.css"

// ─── Core Canvas Component ───────────────────────────────────────────
export { default as Canvas } from './Canvas.vue'

// ─── Node Plugins ────────────────────────────────────────────────────
export { TextNodePlugin } from './nodes/text/TextNodePlugin'
export { ImageNodePlugin } from './nodes/image/ImageNodePlugin'
export { VideoNodePlugin } from './nodes/Video/VideoNodePlugin'
export { PanoramaNodePlugin } from './nodes/panorama/PanoramaNodePlugin'
export { ImageCompareNodePlugin } from './nodes/image-compare/ImageCompareNodePlugin'

// ─── Feature Plugins ─────────────────────────────────────────────────
export { ContextMenuPlugin } from './plugins/context-menu'
export { CustomHandlePlugin } from './plugins/custom-handle'
export { NodeFindPlugin } from './plugins/node-find'
export { AlignGuidePlugin } from './plugins/align-guide'
export { AutoSavePlugin } from './plugins/auto-save'
export { ClipboardPlugin } from './plugins/clipboard'
export { HistoryPlugin } from './plugins/history'
export { MultiSelectPlugin } from './plugins/multi-select'
export { StoragePlugin } from './plugins/storage'
export { ShortcutManagerPlugin } from './plugins/shortcut-manager'
export { GroupPlugin } from './plugins/group'
export { FileDropPlugin } from './plugins/file-drop'
export { ThemePlugin } from './plugins/theme'
export { AutoLayoutPlugin } from './plugins/auto-layout'
export { AlignArrangePlugin } from './plugins/align-arrange'
export { CanvasExportPlugin } from './plugins/canvas-export'
export { MiniMapPlugin } from './plugins/mini-map'

// ─── Plugin Types ────────────────────────────────────────────────────
export type { CanvasPlugin, CanvasConfig, PluginManifest, PluginContext } from './plugins/types'

// ─── Runtime ─────────────────────────────────────────────────────────
export { CanvasRuntime, CanvasRuntimeKey, CanvasRuntimeProvider, useCanvasRuntime, usePluginApi } from './runtime'

// ─── Composables ─────────────────────────────────────────────────────
export { useCanvasStore } from './composables/useCanvasStore'
export { useCanvasBootstrap } from './composables/useCanvasBootstrap'
export { useCanvasConnection } from './composables/useCanvasConnection'
export { useCanvasFlow } from './composables/useCanvasFlow'
export { useCanvasPerformance } from './composables/useCanvasPerformance'
export { useCanvasShortcuts } from './composables/useCanvasShortcuts'
export { useCanvasPanelState } from './composables/useCanvasPanelState'
export { useTheme } from './composables/useTheme'
export { usePluginSystem } from './composables/usePluginSystem'

// ─── Registry ────────────────────────────────────────────────────────
export { NodeRegistry } from './registry/NodeRegistry'
export { CommandRegistry } from './registry/CommandRegistry'
export { ToolbarRegistry } from './registry/ToolbarRegistry'
export { PanelRegistry } from './registry/PanelRegistry'
export { MenuRegistry } from './registry/MenuRegistry'
export { DialogRegistry } from './registry/DialogRegistry'
export type { CommandRegistryAPI, ToolbarRegistryAPI, PanelRegistryAPI, MenuRegistryAPI } from './registry/types'

// ─── Types ───────────────────────────────────────────────────────────
export type * from './types/CanvasNodeData'

// ─── Utils ───────────────────────────────────────────────────────────
export { formatFileSize, formatDuration } from './utils/format'
export { canvasToScreen, screenToCanvas } from './utils/viewportSpace'

// ─── Plugin Manager ──────────────────────────────────────────────────
export { PluginManager } from './plugins/PluginManager'
export { createPluginContext } from './plugins/PluginContext'
export { ShortcutManager } from './plugins/ShortcutManager'

// ─── UI Components ───────────────────────────────────────────────────
export {
  AxButton,
  AxInput,
  AxDropdown,
  AxSelect,
  AxSwitch,
  AxSlider,
  useFloating,
  useTeleportTarget,
  ROUNDED_CLASSES,
  CONTROL_SIZE_CLASSES,
} from './components/Ui'
export type { DropdownTrigger, UseFloatingOptions, ControlSize, ButtonSize } from './components/Ui'

// ─── Custom Connection Validator ─────────────────────────────────────
export { isValidCanvasConnection, normalizeConnection } from './plugins/custom-handle'

// ─── Storage Adapters ────────────────────────────────────────────────
export { AssetManager } from './plugins/storage/adapters/AssetManager'
export type { AssetStore, AssetRecord } from './plugins/storage'

// ─── Theme Utilities ─────────────────────────────────────────────────
export {
  THEME_CSS_VARS,
  THEME_PRESETS,
  getPresetsList,
  getPreset,
  computeThemeVars,
  applyThemeToDOM,
} from './plugins/theme'

// ─── Layout Utilities ────────────────────────────────────────────────
export { runAutoLayout, calculateGroupBounds, buildClusters } from './plugins/auto-layout'
