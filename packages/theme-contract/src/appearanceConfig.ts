/**
 * plugin-theme-components 的 config schema：外观形状 / 字体 / 尺寸 + 全站通用的调试开关。
 *
 * 纯数据（零 .vue）。画布那部分（端口 / 标题 / 吸附带 / 连线）在 canvasConfig.ts；
 * 两份合起来就是拆分前的 Config（见 index.ts 的 Config 并集，键不允许重复）。
 */
import type { ConfigSchema } from "@plume-canvas/canvas-base";
import {
  THEME_FONT_CHOICES,
  THEME_FONT_LABELS,
  THEME_RADIUS_CHOICES,
  THEME_RADIUS_LABELS,
  THEME_SIZE_CHOICES,
  THEME_SIZE_HINTS,
  THEME_SIZE_LABELS,
} from "./themeBridge";
import { DEFAULT_THEME_APPEARANCE, DEFAULT_THEME_DEBUG } from "./themeDefaults";

/** 通用组件侧的配置：外观形状 / 字体 / 尺寸，加上全站通用的调试开关。 */
export const AppearanceConfig: ConfigSchema = {
  // ===== 一级「常规」：调试 / 小地图等跨插件的常规设置收归一处 =====
  // 注意：连线颜色（导轨 / 流光）**不在这里声明** —— 已上移进渲染层主题色板
  //（themePalette 的 `edgeRailColor` / `edgeFlowColor`，各带亮/暗两格，
  //  见「外观/主题配色」与「外观/暗色主题配色」两个分组）。
  // 单值 Config 无法表达"两套主题各一个值"，留着反而会盖住色板。
  // —— 调试：开发校准开关 ——
  handleDebug: {
    type: "boolean",
    default: DEFAULT_THEME_DEBUG.handleDebug,
    label: "端口调试",
    group: "常规/调试",
    description:
      "打开后，端口上会画出半圆交互区/圆心/归位点/鼠标点辅助线，便于校准端口几何。",
  },
  connectionSnapDebugVisible: {
    type: "boolean",
    default: DEFAULT_THEME_DEBUG.connectionSnapDebugVisible,
    label: "吸附调试",
    group: "常规/调试",
    description:
      "打开后，拖线悬停到某节点时画出它的端口吸附带与卡片接收区，便于校准吸附判定。",
  },
  slotDebug: {
    type: "boolean",
    default: DEFAULT_THEME_DEBUG.slotDebug,
    label: "插槽调试",
    group: "常规/调试",
    description:
      "打开后，给所有插槽容器和槽内条目描边并显示插槽名/条目 id，便于确认有哪些插槽、该把按钮排到哪个 id 前后。",
  },
  uiKitDebug: {
    type: "boolean",
    default: DEFAULT_THEME_DEBUG.uiKitDebug,
    label: "组件库使用标记",
    group: "常规/调试",
    description:
      "打开后，每个来自组件库（shadcn）的组件右上角显示一个小圆点。鼠标移上去可看到使用了它的文件与行号；关掉后不渲染、不监听。",
  },
  // —— 外观：交接给组件库的形状 / 字体（颜色仍走 canvas-render 的 --ui-* 色板）——
  themeRadius: {
    type: "select",
    default: DEFAULT_THEME_APPEARANCE.themeRadius,
    label: "圆角",
    group: "外观/形状",
    description:
      "组件库（按钮 / 输入框 / 卡片 / 弹层）的圆角档位。默认跟随项目原有的 8px 控件圆角。",
    options: THEME_RADIUS_CHOICES.map((id) => ({
      value: id,
      label: THEME_RADIUS_LABELS[id],
    })),
  },
  themeFont: {
    type: "select",
    default: DEFAULT_THEME_APPEARANCE.themeFont,
    label: "正文字体",
    group: "外观/字体",
    description:
      "组件库组件的字体。选「跟随宿主」时用项目原有字体栈；这里不往页面里塞外部字体链接。",
    options: THEME_FONT_CHOICES.map((id) => ({ value: id, label: THEME_FONT_LABELS[id] })),
  },
  themeHeadingFont: {
    type: "select",
    default: DEFAULT_THEME_APPEARANCE.themeHeadingFont,
    label: "标题字体",
    group: "外观/字体",
    description: "设置页小标题、弹窗标题用的字体。「跟随正文」= 与上面正文保持一致。",
    options: THEME_FONT_CHOICES.map((id) => ({ value: id, label: THEME_FONT_LABELS[id] })),
  },
  themeSize: {
    type: "select",
    default: DEFAULT_THEME_APPEARANCE.themeSize,
    label: "控件尺寸",
    group: "外观/尺寸",
    description:
      "统一所有组件库控件（按钮 / 输入框 / 下拉 / 开关 / 页签 / 菜单行 / 卡片）的高度与字号。默认「跟随组件默认」= 各组件按自己的 size prop 显示。",
    options: THEME_SIZE_CHOICES.map((id) => ({
      value: id,
      label: THEME_SIZE_LABELS[id] + (THEME_SIZE_HINTS[id] ? " · " + THEME_SIZE_HINTS[id] : ""),
    })),
  },
  /**
   * 「颜色配方」整页的占位配置。
   *
   * 为什么必须有：设置面板的一级/二级导航只显示"真实存在配置分组"的段。
   * 颜色配方正文注册在 settingsGroup/外观/主题工作台 槽里，但如果没有这一格，
   * 「外观/主题工作台」这个分组就不存在，整节会被过滤掉 —— 表现为"卸载 demo-kit 后
   * 设置里找不到颜色配方"。这里声明一个不参与渲染的占位项，让分组成立。
   */
  themeStudioNote: {
    type: "string",
    default: "",
    label: "颜色配方",
    group: "外观/主题工作台",
    placeholder: "这一项只用于形成分组，可以留空",
    description: "挑一套主题模板，再点色签单独调；改过的颜色会变成「自定义」。",
  },
};
