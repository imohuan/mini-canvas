/**
 * defaults —— 默认主题的**启动默认值 + 设置键表**（零 Vue / 零 DOM，Node 可单测）。
 *
 * 为什么住在 canvas-render：
 * - 宿主 `apps/web` 在装任何插件**之前**就要建 `cfg.edge / cfg.handle / cfg.snapZone / cfg.debug`，
 *   再传给 `CanvasHost`。这些值不能等「主题插件装好」才出现，否则插件没装时画布直接坏。
 * - 渲染层本来就有 `DEFAULT_EDGE_VISUAL / DEFAULT_HANDLE_VISUAL / DEFAULT_DEBUG_VISUAL`，
 *   同类默认值放在一起，不再出现两份真相。
 * - 两个主题插件互不 import；它们都依赖引擎，于是共享默认值有了中立的位置。
 *
 * 非颜色的边外观（线宽 / 虚线 / 光斑参数）留在这里；颜色走渲染层色板
 * （`themePalette` 的 edgeRailColor / edgeFlowColor，各带亮暗两格），不在单值 Config 里。
 */

/** 连线外观默认值（作为主题插件 config schema 的初始值） */
export const DEFAULT_THEME_EDGE = {
  edgeType: 'adaptive',
  edgeLineWidth: 1.5,
  edgeDashed: false,
  edgeMarkerEnd: false,
  edgeMarkerSize: 8,
  edgeGlowEnabled: true,
  edgeGlowIntensity: 1,
  edgeVisible: true,
  edgeVisibleOnSelect: false,
  edgeOnTop: false,
  // —— 连线新视觉（导轨 + 色块流动）——
  edgeFlowEnabled: true,
  edgeFlowCount: 3,
  edgeFlowRatio: 20,
  edgeFlowSpeed: 1,
  edgeFlowFade: 35,
  edgeFlowIntensity: 0.9,
  // 正交避障：节点矩形外扩边距 / 拐角圆角
  edgeAvoidMargin: 18,
  edgeAvoidRadius: 8,
  edgeAvoidClearance: 6,
} as const

/**
 * 浮动端口(half)外观默认值（全仓权威默认）。
 *
 * `DEFAULT_HANDLE_VISUAL`（canvasHostCore）与这里的端口区参数保持一致：
 * 装不装主题插件，端口几何都不变。
 */
export const DEFAULT_THEME_HANDLE = {
  handleRestOffset: 36,
  handleCursorGap: 24,
  handleButtonSize: 32,
  portZoneWidth: 10,
  portZoneHeightRatio: 0.55,
  portZoneOffset: 0,
  portZoneShape: 'arc',
  portZoneArcRatio: 0.8,
} as const

/** 调试可视化开关默认值（与 host 的 DEFAULT_DEBUG_VISUAL 同义；额外含 slot / uiKit 两项） */
export const DEFAULT_THEME_DEBUG = {
  handleDebug: false,
  connectionSnapDebugVisible: false,
  slotDebug: false,
  uiKitDebug: false,
} as const

/** 吸附带配置默认值（字段名 = SnapZoneConfig，可直接作 :snap-zone-visual 注入） */
export const DEFAULT_THEME_SNAP_ZONE = {
  heightRatio: 0.8,
  // 显式给值（不回落 portZoneWidth）：调试带 / 命中带必须看得见、摸得着。
  width: 24,
  offset: 0,
  shape: 'rect',
} as const

/** 控制栏贴边距离默认值（节点顶部/底部浮出栏离卡片边的像素距离） */
export const DEFAULT_THEME_LAYOUT = {
  toolbarTopOffset: 6,
  toolbarBottomOffset: 6,
} as const

/** 可配置项 → 连线外观字段的键表（宿主收到 settings 变化时按它窄更新） */
export const EDGE_SETTING_KEYS: ReadonlyArray<keyof typeof DEFAULT_THEME_EDGE> =
  Object.keys(DEFAULT_THEME_EDGE) as (keyof typeof DEFAULT_THEME_EDGE)[]

/** 可配置项 → 端口参数字段的键表 */
export const HANDLE_SETTING_KEYS: ReadonlyArray<keyof typeof DEFAULT_THEME_HANDLE> =
  Object.keys(DEFAULT_THEME_HANDLE) as (keyof typeof DEFAULT_THEME_HANDLE)[]

/** 可配置项 → 调试开关的键表 */
export const DEBUG_SETTING_KEYS: ReadonlyArray<keyof typeof DEFAULT_THEME_DEBUG> =
  Object.keys(DEFAULT_THEME_DEBUG) as (keyof typeof DEFAULT_THEME_DEBUG)[]

/** 可配置项 → 吸附带配置的键表 */
export const SNAP_ZONE_SETTING_KEYS: ReadonlyArray<keyof typeof DEFAULT_THEME_SNAP_ZONE> =
  Object.keys(DEFAULT_THEME_SNAP_ZONE) as (keyof typeof DEFAULT_THEME_SNAP_ZONE)[]
