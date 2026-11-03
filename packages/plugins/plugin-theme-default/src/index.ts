// plugin-theme-default —— 画布"默认主题"插件。
//
// 职责：把宿主渲染器收编成主题插件提供的默认皮 ——
//   nodeShell = BaseNode（完整节点壳：端口/标题就地改名/选中环/LOD/浮动端口）
//   edge      = CustomEdge（完整自定义边：流光/箭头/双击剪切）
//   background= DefaultBackground（跟随画布的圆点底）
// core 只留"槽位 + 令牌"契约，不再硬编码默认 .vue 渲染器；装本插件即有默认皮。
//
// P4 迁移：声明入口从 apply 里 ctx.settings.define → **模块级导出 `Config` schema**（cordis ch5 形态）。
// 装配处给 config → 内核经 schema 校验+补默认 → `apply(ctx, config)` 收完整 config；
// 同时 schema 字段自动登记进 settings 单一数据源(scope=theme-default)，demo/宿主读它做连线外观的
// "config 变化→就地窄更新、实时生效"（逻辑同旧 ctx.settings.onChange，不整图重建）。
import type { Context, InferConfig } from "@mini-canvas/canvas-base";
import type { PluginModule } from "@mini-canvas/canvas-base";
import { markRaw } from "vue";
// shadcn 组件库的样式入口：把 shadcn 语义色映射到本项目 --ui-* token。
// Tailwind 的 @source 在主应用入口（packages/ui/src/app.css）里登记。
import "@mini-canvas/ui-kit-shadcn/styles.css";
// 主题变量：包加载即生效（:root 定义 --canvas-node-*），壳/端口/边组件 CSS 消费。
import "./styles/node-theme.css";
// 界面浮层层级：组件库只管组件本身，宿主/主题在这里统一决定 Dialog / 菜单 / 预览谁盖谁。
import "./styles/ui-layers.css";
import { registerThemePreview } from "./themePreview";
import BaseNode from "./components/node/BaseNode.vue";
import {
  NodeToolbarService,
  type NodeToolbarMode,
} from "@mini-canvas/canvas-render";
import NodeModeTopBar from "./components/node/NodeModeTopBar.vue";
import NodeModeBottomBar from "./components/node/NodeModeBottomBar.vue";
import SettingsSchemaField from "./components/settings/SettingsSchemaField.vue";
import CustomEdge from "./components/edge/CustomEdge.vue";
import DefaultBackground from "./components/background/DefaultBackground.vue";
import ConnectionLine from "./components/edge/ConnectionLine.vue";
import MovingHandle from "./components/node/MovingHandle.vue";
import PluginSettingsContent from "./components/settings/PluginSettingsContent.vue";
import { registerDefaultSettingsMenu } from "./components/settings/defaultMenu";
import { registerEventName } from "@mini-canvas/canvas-base";
import {
  PrecisionSlider,
  ToolParamField,
  ColorField,
  NodeEmptyState,
  SlotDebugPopover,
} from "./components/ui";
import MediaViewer from "./components/ui/MediaViewer.vue";
import ToolParamGroup from "./components/ui/ToolParamGroup.vue";
import ToolOptionGrid from "./components/ui/ToolOptionGrid.vue";
import ToolRatioGrid from "./components/ui/ToolRatioGrid.vue";
import ToolParamSlider from "./components/ui/ToolParamSlider.vue";
import SlotDebugOverlay from "./components/ui/SlotDebugOverlay.vue";
import { SHADCN_COMPONENTS, withUiKitDebugMark } from "@mini-canvas/ui-kit-shadcn";
import { SettingsRow, SettingsSection } from "@mini-canvas/ui-kit-shadcn";
import { UiToaster } from "@mini-canvas/ui-kit-shadcn";
import { setStaticUiCatalog } from "@mini-canvas/canvas-render";
import { createNotifyService } from "./notifyService";
import { SETTINGS_NAV_ICON_NAMES } from "./components/settings/navIcon";
import {
  applyThemeBridge,
  clearThemeBridge,
  type ThemeBridgeInput,
  toThemeBridgeInput,
} from "./themeBridge";

// 设计文档 §7.4：emit 的事件名必须 registerEventName 登记，否则 dev 下 emit 时一条 warn。
// 设置弹窗（本插件默认皮）的 ✕/遮罩/Esc → 通知宿主关闭（消费方见 @mini-canvas/ui 的 App.vue）。
registerEventName('settings:ui-close')
// 设置面板的「动作项」（如快捷键打开帮助浮层）：面板广播，宿主执行
registerEventName('settings:ui-action')

export const name = "theme-default";
// 本插件不声明任何 inject：apply 里只做 ctx.theme.register（主题槽 + 设置面板），不消费任何服务。
//
// 步骤 7（拆插件循环依赖）删掉了历史上的 inject:['text'] + `import type {} from "@mini-canvas/plugin-node-text"`：
// 那条声明是"为了读 node-text 的类型增强"，但本插件从不读 ctx.text（全仓 rg 无消费点），是提前写的死声明。
// 代价是包级循环——theme-default devDeps→node-text，node-text→theme-default（复用本插件 MovingHandle/Select），
// 双向即成环。删除后本插件不依赖任何节点插件，环消失且无行为损失（皮肤不再因缺 text 插件而 PENDING）。
export const inject = [] as string[];

/**
 * Provider 外的静态组件目录：模块加载就发布一份导出名 → 组件。
 *
 * 项目列表页 / 根通知宿主在 CanvasProvider 之外，首次打开时还没有内核 ctx；
 * 只靠 @ready 会整块不渲染（真机截图）。主题包仍是唯一 import 组件库的地方，
 * 这里只是把同一批句柄主动交给渲染层，宿主目录就绪后仍以 host ctx 为准。
 */
setStaticUiCatalog({
  ...SHADCN_COMPONENTS,
  settingsRow: SettingsRow,
  settingsSection: SettingsSection,
  Toaster: UiToaster,
});

// 默认值、key 映射与 Config schema 都是纯数据表，搬到 themeConfig.ts（导出名与值不变）。
export {
  DEFAULT_THEME_EDGE,
  DEFAULT_THEME_HANDLE,
  DEFAULT_THEME_DEBUG,
  DEFAULT_THEME_APPEARANCE,
  DEFAULT_THEME_TITLE,
  DEFAULT_THEME_CULLED,
  DEFAULT_THEME_MULTI_RADIO,
  DEFAULT_THEME_LAYOUT,
  DEFAULT_THEME_PANEL,
  DEFAULT_THEME_SNAP_ZONE,
  EDGE_SETTING_KEYS,
  HANDLE_SETTING_KEYS,
  DEBUG_SETTING_KEYS,
  TITLE_SETTING_KEYS,
  LAYOUT_SETTING_KEYS,
  PANEL_SETTING_KEYS,
  SNAP_ZONE_SETTING_KEYS,
  Config,
} from "./themeConfig";
import { DEFAULT_THEME_APPEARANCE, Config } from "./themeConfig";
/** apply 收到的 config TS 类型（与 schema 对齐） */
export interface ThemeConfig extends InferConfig<typeof Config> {}

export function apply(ctx: Context, config?: ThemeConfig) {
  // 主题工作台的预览由主题插件自己画：两个节点 + 一条连线 + 基础状态色。
  // 其它插件把各自的浮层注册进同一个预览槽，主题页不需要认识它们。
  registerThemePreview(ctx);
  // 设置菜单的默认 0/1/2 级定义。插件可注册同 id 覆盖，也可注册自己的 id；
  // 这里不是“总表”，不要求其它插件改它。
  registerDefaultSettingsMenu(ctx.settingsMenu)

  // P4：config 已经内核经 Config schema 校验 + 补默认；这里无需再手写 settings.define（声明即 Config 导出）。
  // 如需在插件内"就地订阅自己 config 的变化并窄更新"，可 ctx.settings.onChange(name, ...)（demo 侧已演示该链路）。
  // ===== 外观交接：圆角 / 字体 → 组件库消费的 --mct-* 变量 =====
  // 颜色不走这里：项目统一用 --ui-* 语义色，组件库 host.css 已经映射过去；
  // 在这里再写一份色板，会让「设置 → 主题配色」改了颜色而组件库不跟着变。
  let appearance: ThemeBridgeInput = toThemeBridgeInput({
    themeRadius: config?.themeRadius ?? DEFAULT_THEME_APPEARANCE.themeRadius,
    themeFont: config?.themeFont ?? DEFAULT_THEME_APPEARANCE.themeFont,
    themeHeadingFont: config?.themeHeadingFont ?? DEFAULT_THEME_APPEARANCE.themeHeadingFont,
    themeSize: config?.themeSize ?? DEFAULT_THEME_APPEARANCE.themeSize,
    themePopupArrow: config?.themePopupArrow ?? DEFAULT_THEME_APPEARANCE.themePopupArrow,
    themePopupGap: config?.themePopupGap ?? DEFAULT_THEME_APPEARANCE.themePopupGap,
    themePopupSubGap: config?.themePopupSubGap ?? DEFAULT_THEME_APPEARANCE.themePopupSubGap,
    themePopupSelectedStyle:
      config?.themePopupSelectedStyle ?? DEFAULT_THEME_APPEARANCE.themePopupSelectedStyle,
  });
  applyThemeBridge(appearance);
  // 设置面板改了就重写：订阅整表 onChange，只认外观这几个 key，别的变化不做事
  const appearanceOff = ctx
    .tryGet<{ onChange(cb: (key: string, value: unknown) => void): { dispose(): void } }>('settings')
    ?.onChange((key, value) => {
      if (
        key !== 'themeRadius' &&
        key !== 'themeFont' &&
        key !== 'themeHeadingFont' &&
        key !== 'themeSize' &&
        key !== 'themePopupArrow' &&
        key !== 'themePopupGap' &&
        key !== 'themePopupSubGap' &&
        key !== 'themePopupSelectedStyle'
      )
        return
      appearance = toThemeBridgeInput({
        themeRadius: key === 'themeRadius' ? value : appearance.radius,
        themeFont: key === 'themeFont' ? value : appearance.font,
        themeHeadingFont: key === 'themeHeadingFont' ? value : appearance.heading,
        themeSize: key === 'themeSize' ? value : appearance.size,
        themePopupArrow: key === 'themePopupArrow' ? value : appearance.popup?.arrow,
        themePopupGap: key === 'themePopupGap' ? value : appearance.popup?.gap,
        themePopupSubGap: key === 'themePopupSubGap' ? value : appearance.popup?.subGap,
        themePopupSelectedStyle:
          key === 'themePopupSelectedStyle' ? value : appearance.popup?.selectedStyle,
      })
      applyThemeBridge(appearance)
    });
  // 订阅与内联变量都随插件 fiber 回收：卸载时清掉，否则会挡住下一套主题
  ctx.effect(() => () => {
    appearanceOff?.dispose();
    clearThemeBridge();
  });

  // ===== 节点上下状态栏基础设施（用户口径 2026-10-29 重构）=====
  //
  // nodeToolbar 服务 = 注册表 + 会话。归属**渲染层**（Spec D4）：模式注册与会话不能随主题
  // 卸载而丢；主题只负责画那一格。bottom-bar 降级为「默认底栏的内容贡献者」，与裁剪模式完全平等。
  //
  // 用法（任意插件，按服务名取，不 import 别的插件）：
  //   const svc = ctx.tryGet<NodeToolbarService>('nodeToolbar')
  //   svc?.registerMode({ id: 'default', types: ['image'], bottomBar: NodeBottomBar, order: 100 })
  //   svc?.registerMode({ id: 'image/crop', types: ['image'], topBar: CropTopBar, bottomBar: CropPanel })
  //   svc?.enter(nodeId, 'image/crop')  /  svc?.exit(nodeId)
  //
  // 渲染（两条腿，各自只有一个入口）：
  // - 上栏：NodeModeTopBar 挂在节点壳的 out:top 锚点（带主题的偏移配置 + 居中 + 反缩放）；
  // - 下栏：NodeModeBottomBar 挂在节点壳的 out:bottom 锚点（与上栏同一套定位）。
  // 两者都只做「问服务 → 渲染那一格」，模式/默认没有第二套渲染路径。
  // 服务由宿主 createMiniCanvasHost 在装业务插件前注入；这里只挂两个解析面板。
  const toolbarSvc = ctx.tryGet<NodeToolbarService>("nodeToolbar");
  void toolbarSvc;

  // 上/下两根栏各一个解析面板，都挂节点壳的锚点（同一套定位：偏移/居中/反缩放）。
  //
  // 老的上传条（图片/视频/音频）不受影响：服务解析出「没注册」时透传宿主默认内容。
  // 下栏同理：bottom-bar 把默认生成 UI 注册成 id='default' 的 bottomBar，解析出来就渲染它。
  ctx.nodes.attach("*", { region: "out:top", id: "theme-default/node-top-slot", component: NodeModeTopBar });
  ctx.nodes.attach("*", { region: "out:bottom", id: "theme-default/node-bottom-slot", component: NodeModeBottomBar });


  // 渲染皮：nodeShell/edge/background/edgeDefaultType
  ctx.theme.register("nodeShell", BaseNode); // 完整节点壳（收编自 core）
  ctx.theme.register("edge", CustomEdge); // 完整自定义连线（收编自 core）
  ctx.theme.register("background", DefaultBackground); // 画布背景
  ctx.theme.register("connectionLine", ConnectionLine); // 拖线临时连接线（canvas-render #connection-line 渲染它）
  ctx.theme.register("edgeDefaultType", "custom");

  // 设计系统组件目录（设计文档 §4.5 / 案例 4 / 决策 4）：把"希望被主题整体换掉"的
  // 通用件按名字登记进 ui 场 —— 别的插件按名取用，换一套主题时它们一起变、业务插件零改动。
  // 其它插件一律从这里按名取，不再直接 import 组件库（用户口径 2026-11-03）。
  const ui = ctx.registryOf<unknown>("ui");
  // 全局通知服务：底层 vue-sonner，宿主只挂一个 Toaster（从 ui 目录取）。
  ctx.provide("notify", createNotifyService());
  ui.add("Toaster", UiToaster, { id: "default" });
  // 工具栏按钮 / 下拉按导出名登记（Button / DropdownMenu / …），调用点从 ui 目录取，
  // 再配全局 .mck-toolbar-btn 样式。
  // 统一空状态：节点插件按名取用（图片/视频/音频/3D 共用同一套图标/文案/动作布局）。
  ui.add("nodeEmptyState", NodeEmptyState, { id: "default" });
  // 插槽调试小点的悬停说明面板：外壳（底栏/状态条/抽屉/设置导航）按名取
  ui.add("slotDebugPopover", SlotDebugPopover, { id: "default" });
  // 全屏媒体预览（文本/图片/视频/音频内置；#stage 插槽可扩展新资源类型）。
  // 底栏插件的素材预览浮层与成品应用（生成历史/资产面板）都用它；换主题时一起换。
  ui.add("mediaViewer", MediaViewer, { id: "default" });
  ui.add("slider", PrecisionSlider, { id: "default" });
  ui.add("toolParamField", ToolParamField, { id: "default" });
  // 参数合并展示件：把「比例 · 画质 · 2K · 1张」那种多参数收敛成一个下拉（参考 LibTV 的底行样式）。
  ui.add("toolParamGroup", ToolParamGroup, { id: "default" });
  // 参数预设件（「识别到固定类型参数就用预设组件」的那一层；判定表见 components/ui/paramKind.ts）：
  // 业务插件只声明 param.kind，ToolParamField 按名从本目录取件 —— 换主题时这些件一起换。
  ui.add("toolParamGrid", ToolOptionGrid, { id: "default" });
  ui.add("toolParamRatio", ToolRatioGrid, { id: "default" });
  ui.add("toolParamSlider", ToolParamSlider, { id: "default" });
  ui.add("color", ColorField, { id: "default" });
  // 端口与拖线临时线的外观件也进目录（T06）：业务插件（多选）按名取同款组件，
  // 于是它们不必再直接依赖本主题包；换主题时这些件跟着一起换。
  ui.add("movingHandle", MovingHandle, { id: "default" });
  ui.add("connectionLine", ConnectionLine, { id: "default" });
  // 状态栏解析件（用户口径 2026-10-29 重构）：按 nodeToolbar 服务解析「这一格显示什么」。
  // 换主题时一起被顶掉；业务插件不必认识它们，只认 nodeToolbar 服务。
  ui.add("nodeModeTopBar", NodeModeTopBar, { id: "default" });
  ui.add("nodeModeBottomBar", NodeModeBottomBar, { id: "default" });
  // 设置字段渲染器：设置面板的正文与插件自绘页都按名取，换主题时字段控件一起换。
  // 宿主此前直接 import 本包的这个 .vue，换主题后仍会显示默认皮 —— 从这里登记后走目录。
  ui.add("settingsField", SettingsSchemaField, { id: "default" });
  // 插槽调试说明层：外壳按名取，换主题时一起换（它只读 DOM 上的 data-slot*，不需要 props）。
  ui.add("slotDebugOverlay", SlotDebugOverlay, { id: "default" });
  // ===== shadcn-vue 原始组件：全部登记进 ui 场，供业务插件按名取用 =====
  // 注册名 = 源码导出名（Button / DropdownMenuContent …），与 shadcn-vue 的 import 名对齐。
  // 与上面的语义件（slider / color / mediaViewer …）是两层：上面是主题自造的复合件，
  // 这里是"组件库原子件"，名字按导出名大写，两层不会撞名。
  // 值就是 shadcn-vue 生成的那个组件，不做功能适配层；只包一层透明标记，
  // 让「按名取用」的组件也能在组件库使用标记里显示登记点（模板直写的那种由 Vite 插件注入）。
  //
  // 构建版同样要包（2026-11-02 用户反馈）：以前只在 DEV 下包，cloud-server 托管的
  // 构建版里按名取的组件没有任何标记。这一层不产生 DOM、不改 props/slots/事件，
  // 调试层关闭时连读属性的人都没有，所以两种构建保持同一份实现。
  for (const [uiName, component] of Object.entries(SHADCN_COMPONENTS)) {
    const marked = withUiKitDebugMark(
      component,
      "packages/plugins/plugin-theme-default/src/index.ts",
      uiName,
    );
    ui.add(uiName, marked, { id: "shadcn" });
  }
  // 设置页排版件（非 shadcn 生成件，但同属组件库）：设置页只能经注册表取，
  // 业务插件不直接 import 组件库（用户口径 2026-11-03）。
  ui.add("settingsRow", SettingsRow, { id: "default" });
  ui.add("settingsSection", SettingsSection, { id: "default" });
  // 设置导航图标：独立场域，按一级分组名登记。优先级高（order 小）的赢。
  const navIcons = ctx.registryOf<unknown>("settings/navIcon");
  for (const [group, icon] of SETTINGS_NAV_ICON_NAMES) {
    navIcons.add(group, icon, { id: "default" });
  }
  // 设置面板皮：settingsPanel 槽默认赢家（渲染抽象层 SettingsHost 消费 winner，把 ctx.settings 实时喂给它）；
  // 其它宿主想换皮装个 order 更小的插件 `ctx.theme.register('settingsPanel', 新组件, {order:-1})` 即顶替。
  ctx.theme.register("settingsPanel", PluginSettingsContent, {
    id: "default",
    order: 0,
  });

}

/** 插件模块出口 */
export const themeDefaultPlugin: PluginModule = { name, inject, Config, apply };

/**
 * 通用 UI 组件出口（供其它插件复用，避免各节点面板自绘一套近似的参数控件）。
 *
 * 下拉 / 选择 / 提示不再从这里提供：它们统一使用 ui 目录里登记的
 * 分离件（DropdownMenu / Select / Tooltip），本主题不再维护第二套实现。
 */
export { PrecisionSlider, ToolParamField, ColorField, NodeEmptyState } from "./components/ui";
export { MediaViewer } from "./components/ui";

/**
 * 节点工具栏基础设施出口（用户口径 2026-10-29 重构）：
 * - NodeToolbarService / NodeToolbarMode：模式注册表 + 会话（服务已按名 'nodeToolbar' 上架，
 *   插件内用 ctx.get('nodeToolbar')；这里导出类型供 declare module 增强用）。
 * - NodeModeTopBar / NodeModeBottomBar：默认渲染器（BaseNode 的上/下段经它们透传或替换）。
 */
export { NodeToolbarService } from "@mini-canvas/canvas-render";
export type { NodeToolbarMode } from "@mini-canvas/canvas-render";
export { default as NodeModeTopBar } from "./components/node/NodeModeTopBar.vue";
export { default as NodeModeBottomBar } from "./components/node/NodeModeBottomBar.vue";

/**
 * 渲染件出口（供其它插件复用同一套外观，避免各自手绘一份必然漂移）。
 *
 * - `MovingHandle`：节点浮动端口。支持 `preview` 模式 —— 只复用外观、不注册 VueFlow 真实连接点，
 *   并 emit `connectStart`，正好给"挂在自己浮层上的临时端口"用（如多选框的批量连线端口）。
 * - `ConnectionLine` / `CustomEdge`：拖线临时线与正式边。`ConnectionLine` 内部把渲染完全委托给
 *   `CustomEdge`，所以拖出来的临时线和落成的正式边**长得一模一样**（含流光/箭头/配置/动画）。
 */
export { default as MovingHandle } from "./components/node/MovingHandle.vue";
export { default as ConnectionLine } from "./components/edge/ConnectionLine.vue";
export { default as CustomEdge } from "./components/edge/CustomEdge.vue";
export { ThemePreviewBase, registerThemePreview } from "./themePreview";
