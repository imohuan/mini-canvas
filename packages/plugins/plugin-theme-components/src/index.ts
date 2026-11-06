/**
 * @mini-canvas/plugin-theme-components —— 默认主题的**通用组件**半边（应用级常驻）。
 *
 * 只做与画布无关的事：
 * - 外观变量（圆角 / 字体 / 尺寸）交接给组件库
 * - 通用 UI 目录（Button / DropdownMenu / Toaster / mediaViewer …）
 * - 设置面板与设置菜单
 * - 全局通知服务
 *
 * 画布外观（节点壳 / 边 / 背景 / 节点工具栏）在 @mini-canvas/plugin-theme-canvas，
 * 两个包互不 import；共享的纯数据在 @mini-canvas/theme-contract。
 */
import type { InferConfig, PluginModule, PluginScope } from "@mini-canvas/canvas-base"
import "@mini-canvas/ui-kit-shadcn/styles.css"
// 主题变量：包加载即生效（:root 定义 --canvas-node-*），空状态等通用件也引这些变量。
import "@mini-canvas/theme-contract/styles/node-theme.css"
// 界面浮层层级：组件库只管组件本身，宿主/主题在这里统一决定 Dialog / 菜单 / 预览谁盖谁。
import "./styles/ui-layers.css"
// 全局滚动条观感（用户口径 2026-11-04：取消统一的滚动组件，改由主题统一定样式）。
import "./styles/scrollbars.css"
import { registerThemePreview } from "./themePreview"
import SettingsSchemaField from "./components/settings/SettingsSchemaField.vue"
import PluginSettingsContent from "./components/settings/PluginSettingsContent.vue"
import { registerDefaultSettingsMenu } from "./components/settings/defaultMenu"
import { registerEventName } from "@mini-canvas/canvas-base"
import {
  PrecisionSlider,
  ToolParamField,
  ColorField,
  NodeEmptyState,
  SlotDebugPopover,
} from "./components/ui"
import MediaViewer from "./components/ui/MediaViewer.vue"
import ToolParamGroup from "./components/ui/ToolParamGroup.vue"
import ToolOptionGrid from "./components/ui/ToolOptionGrid.vue"
import ToolRatioGrid from "./components/ui/ToolRatioGrid.vue"
import ToolParamSlider from "./components/ui/ToolParamSlider.vue"
import SlotDebugOverlay from "./components/ui/SlotDebugOverlay.vue"
import UiKitDebugOverlay from "./components/ui/UiKitDebugOverlay.vue"
import FeedbackHost from "./components/ui/FeedbackHost.vue"
import { SHADCN_COMPONENTS, withComponentConfig, withUiKitDebugMark } from "@mini-canvas/ui-kit-shadcn"
import ShadcnSettingsRow from "./components/settings/ShadcnSettingsRow.vue"
import ShadcnSettingsSection from "./components/settings/ShadcnSettingsSection.vue"
import { UiToaster } from "@mini-canvas/ui-kit-shadcn"
import { setStaticUiCatalog } from "@mini-canvas/canvas-render"
import { createFeedbackService, feedbackDebugSnapshot, setFeedbackService } from "@mini-canvas/canvas-render"
import {
  AppearanceConfig,
  DEFAULT_THEME_APPEARANCE,
  SETTINGS_NAV_ICON_NAMES,
  applyThemeBridge,
  clearThemeBridge,
  createNotifyService,
  toThemeBridgeInput,
  type ThemeBridgeInput,
} from "@mini-canvas/theme-contract"
import { setSettingsUiCatalog } from "./composables/useUiComponentOutside"

// 设计文档 §7.4：emit 的事件名必须 registerEventName 登记，否则 dev 下 emit 时一条 warn。
registerEventName('settings:ui-close')
registerEventName('settings:ui-action')

export const name = "theme-components"
/** 不依赖 doc：项目页也要用这些组件。 */
export const inject = [] as string[]
/** 本包的配置声明：外观形状 / 字体 / 尺寸 + 通用调试开关（纯数据来自 theme-contract）。 */
export const Config = AppearanceConfig

/**
 * 发布 Provider 外可用的静态组件目录。
 *
 * 项目列表页 / 根通知宿主在根 Context 创建之前就要渲染首帧；那时
 * registryOf('ui') 还不存在，只能读这份模块级目录。宿主就绪后仍以 host ctx 为准。
 */
export function publishStaticUiCatalog(): void {
  setStaticUiCatalog({
    ...SHADCN_COMPONENTS,
    settingsRow: ShadcnSettingsRow,
    settingsSection: ShadcnSettingsSection,
    Toaster: UiToaster,
    feedbackHost: FeedbackHost,
    slotDebugOverlay: SlotDebugOverlay,
    uiKitDebugOverlay: UiKitDebugOverlay,
    mediaViewer: MediaViewer,
  })
}

// 模块加载即发布一次：首帧渲染早于任何 apply。
publishStaticUiCatalog()

export interface ThemeComponentsConfig extends InferConfig<typeof Config> {}

export function apply(ctx: PluginScope, config?: ThemeComponentsConfig) {
  registerThemePreview(ctx as never)
  registerDefaultSettingsMenu(ctx.settingsMenu)

  let appearance: ThemeBridgeInput = toThemeBridgeInput({
    themeRadius: config?.themeRadius ?? DEFAULT_THEME_APPEARANCE.themeRadius,
    themeFont: config?.themeFont ?? DEFAULT_THEME_APPEARANCE.themeFont,
    themeHeadingFont: config?.themeHeadingFont ?? DEFAULT_THEME_APPEARANCE.themeHeadingFont,
    themeSize: config?.themeSize ?? DEFAULT_THEME_APPEARANCE.themeSize,
  })
  applyThemeBridge(appearance)
  // 设置面板在画布树外，字段控件要走同一份 ui 目录：这里把宿主目录接上，
  // 面板就能按名取到 settingsField / settingsRow 等件。
  setSettingsUiCatalog(ctx as unknown as { registryOf?: (kind: string) => unknown })
  // 组件库静态目录：项目页首帧（宿主 ctx 还没就绪）也按名取得到 Button / Toaster。
  publishStaticUiCatalog()
  const appearanceOff = ctx
    .tryGet<{ onChange(cb: (key: string, value: unknown) => void): { dispose(): void } }>('settings')
    ?.onChange((key, value) => {
      if (
        key !== 'themeRadius' &&
        key !== 'themeFont' &&
        key !== 'themeHeadingFont' &&
        key !== 'themeSize'
      )
        return
      appearance = toThemeBridgeInput({
        themeRadius: key === 'themeRadius' ? value : appearance.radius,
        themeFont: key === 'themeFont' ? value : appearance.font,
        themeHeadingFont: key === 'themeHeadingFont' ? value : appearance.heading,
        themeSize: key === 'themeSize' ? value : appearance.size,
      })
      applyThemeBridge(appearance)
    })
  ctx.effect(() => () => {
    appearanceOff?.dispose()
    clearThemeBridge()
  })

  const ui = ctx.registryOf<unknown>("ui")
  ctx.provide("notify", createNotifyService())
  // 统一确认 / 输入 / 告知：禁止各处再用浏览器原生 confirm / prompt / alert。
  // 服务只排一次（应用级常驻插件），面板由下面的 feedbackHost 取件渲染。
  const feedback = createFeedbackService()
  ctx.provide("feedback", feedback)
  setFeedbackService(feedback)
  ctx.effect(() => () => setFeedbackService(undefined))
  // 开发期排障：真机点按钮没反应时，先在控制台看这里 —— 是「没调用服务」还是「面板没画」。
  if (typeof window !== "undefined") {
    ;(window as unknown as Record<string, unknown>).__miniFeedback = () => feedbackDebugSnapshot()
    ;(window as unknown as Record<string, unknown>).__miniFeedbackService = feedback
  }
  ui.add("Toaster", UiToaster, { id: "default" })
  ui.add("feedbackHost", FeedbackHost, { id: "default" })
  ui.add("nodeEmptyState", NodeEmptyState, { id: "default" })
  ui.add("slotDebugPopover", SlotDebugPopover, { id: "default" })
  ui.add("mediaViewer", MediaViewer, { id: "default" })
  ui.add("slider", PrecisionSlider, { id: "default" })
  ui.add("toolParamField", ToolParamField, { id: "default" })
  ui.add("toolParamGroup", ToolParamGroup, { id: "default" })
  ui.add("toolParamGrid", ToolOptionGrid, { id: "default" })
  ui.add("toolParamRatio", ToolRatioGrid, { id: "default" })
  ui.add("toolParamSlider", ToolParamSlider, { id: "default" })
  ui.add("color", ColorField, { id: "default" })
  ui.add("settingsField", SettingsSchemaField, { id: "default" })
  ui.add("slotDebugOverlay", SlotDebugOverlay, { id: "default" })
  // 组件库使用标记（设置 → 调试 → 组件库使用标记）：外壳按名取，换主题时一起换。
  ui.add("uiKitDebugOverlay", UiKitDebugOverlay, { id: "default" })

  for (const [uiName, component] of Object.entries(SHADCN_COMPONENTS)) {
    const configured = withComponentConfig(component, uiName)
    const marked = withUiKitDebugMark(
      configured,
      "packages/plugins/plugin-theme-components/src/index.ts",
      uiName,
    )
    ui.add(uiName, marked, { id: "shadcn" })
  }
  ui.add("settingsRow", ShadcnSettingsRow, { id: "default" })
  ui.add("settingsSection", ShadcnSettingsSection, { id: "default" })

  const navIcons = ctx.registryOf<unknown>("settings/navIcon")
  for (const [group, icon] of SETTINGS_NAV_ICON_NAMES) {
    navIcons.add(group, icon, { id: "default" })
  }
  // 设置面板皮：settingsPanel 槽默认赢家。
  ctx.theme.register("settingsPanel", PluginSettingsContent, { id: "default", order: 0 })
}

export const themeComponentsPlugin: PluginModule = { name, inject, Config, apply }

/**
 * 通用 UI 组件出口（供其它插件复用，避免各节点面板自绘一套近似的参数控件）。
 *
 * 下拉 / 选择 / 提示不再从这里提供：它们统一使用 ui 目录里登记的
 * 分离件（DropdownMenu / Select / Tooltip），本主题不再维护第二套实现。
 */
export { PrecisionSlider, ToolParamField, ColorField, NodeEmptyState } from "./components/ui"
export { MediaViewer } from "./components/ui"
export { ThemePreviewBase, registerThemePreview } from "./themePreview"

