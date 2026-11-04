/**
 * theme-components —— 默认主题里的**通用组件**部分（应用级常驻）。
 *
 * 只做与画布无关的事：
 * - 外观变量（圆角 / 字体）
 * - 通用 UI 目录（Button / DropdownMenu / Toaster / mediaViewer …）
 * - 设置面板与设置菜单
 *
 * 项目页没有 doc 也能用这些；画布外观（节点壳 / 边 / 背景）在 theme-canvas 里。
 * 旧入口 themeDefaultPlugin 仍然把两者组合在一起，现有调用方不用改。
 */
import type { InferConfig, PluginModule, PluginScope } from "@mini-canvas/canvas-base"
import { markRaw } from "vue"
import "@mini-canvas/ui-kit-shadcn/styles.css"
import "./styles/node-theme.css"
import "./styles/ui-layers.css"
import "./styles/scrollbars.css"
import { registerThemePreview } from "./themePreview"
import SettingsSchemaField from "./components/settings/SettingsSchemaField.vue"
import PluginSettingsContent from "./components/settings/PluginSettingsContent.vue"
import SettingsShortcutPage from "./components/settings/SettingsShortcutPage.vue"
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
import { SHADCN_COMPONENTS, withComponentConfig, withUiKitDebugMark } from "@mini-canvas/ui-kit-shadcn"
import ShadcnSettingsRow from "./components/settings/ShadcnSettingsRow.vue"
import ShadcnSettingsSection from "./components/settings/ShadcnSettingsSection.vue"
import { UiToaster } from "@mini-canvas/ui-kit-shadcn"
import { setStaticUiCatalog } from "@mini-canvas/canvas-render"
import { setSettingsUiCatalog } from "./composables/useUiComponentOutside"
import { createNotifyService } from "./notifyService"
import { SETTINGS_NAV_ICON_NAMES } from "./components/settings/navIcon"
import {
  applyThemeBridge,
  clearThemeBridge,
  type ThemeBridgeInput,
  toThemeBridgeInput,
} from "./themeBridge"
import { DEFAULT_THEME_APPEARANCE, Config } from "./themeConfig"

registerEventName('settings:ui-close')
registerEventName('settings:ui-action')

export const name = "theme-components"
/** 不依赖 doc：项目页也要用这些组件。 */
export const inject = [] as string[]
export { Config }

export interface ThemeComponentsConfig extends InferConfig<typeof Config> {}

export function apply(ctx: PluginScope, config?: ThemeComponentsConfig) {
  // 主题预览注册只用运行时能力（theme/slots/registry），类型上按 Context 收口即可。
  registerThemePreview(ctx as never)
  registerDefaultSettingsMenu(ctx.settingsMenu)

  let appearance: ThemeBridgeInput = toThemeBridgeInput({
    themeRadius: config?.themeRadius ?? DEFAULT_THEME_APPEARANCE.themeRadius,
    themeFont: config?.themeFont ?? DEFAULT_THEME_APPEARANCE.themeFont,
    themeHeadingFont: config?.themeHeadingFont ?? DEFAULT_THEME_APPEARANCE.themeHeadingFont,
    themeSize: config?.themeSize ?? DEFAULT_THEME_APPEARANCE.themeSize,
  })
  applyThemeBridge(appearance)
  void setSettingsUiCatalog
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
  ui.add("Toaster", UiToaster, { id: "default" })
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

  for (const [uiName, component] of Object.entries(SHADCN_COMPONENTS)) {
    const configured = withComponentConfig(component, uiName)
    const marked = withUiKitDebugMark(
      configured,
      "packages/plugins/plugin-theme-default/src/themeComponents.ts",
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
  ctx.theme.register("settingsPanel", PluginSettingsContent, { id: "default", order: 0 })
  ctx.slots.register("settings.nav", {
    id: "nav/personal/shortcuts",
    order: 20,
    component: SettingsShortcutPage,
    meta: { title: "快捷键", category: "个人" },
  })
}

export const themeComponentsPlugin: PluginModule = { name, inject, Config, apply }
