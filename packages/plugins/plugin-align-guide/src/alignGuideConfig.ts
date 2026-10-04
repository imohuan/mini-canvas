/**
 * alignGuideConfig —— 对齐辅助线插件可配置项（纯逻辑：schema + 从 settings 读当前值）。
 *
 * 只放一个"总开关"，与老版 AlignGuidePlugin 的 panel 设置项「启用对齐辅助线」对齐（老版默认开）：
 * 关闭时拖节点就是纯自由移动 —— 既不做吸附（不写 updateNodeVisual）、也不显示参考线。
 * 分组对齐老版语义：它是"拖拽时的布局辅助"，归一级「布局」。
 *
 * 标量字段经内核 SettingsStore（settings 单一数据源）登记进 ⚙ 设置面板，改动实时生效
 * （apply 侧实时读本函数，不缓存装配时的快照）。
 *
 * key 命名注意：settings 的 key 是**全局平面命名**（跨插件同名会被先声明者占位丢弃），
 * 故本插件 key 加 alignGuide 前缀 —— 不能叫裸 enabled，那个已被 plugin-edge-cutting 占用。
 * 独立成文件避免 alignGuidePlugin ↔ 浮层组件循环 import。
 */
import type { ConfigSchema, InferConfig, Context } from '@mini-canvas/canvas-base'

/** 模块级 Config schema（P4：随插件模块导出，内核装配时校验 + 补默认 + 登记设置面板） */
export const Config = {
  alignGuideEnabled: {
    type: 'boolean',
    default: true,
    label: '启用对齐辅助线',
    group: '布局/对齐辅助线',
    description:
      '总开关。开启：拖动节点时自动吸附其它节点的边缘/中心，并显示参考线。关闭：拖动就是纯自由移动，不出参考线也不吸附；重开即恢复，无需重载画布。',
  },
  // 参考线颜色：**两格制**（亮/暗各一格），**可清空** —— 清空 = 跟随主题强调色（--ui-accent）。
  // 由本插件自己申报（用户口径："参考线的颜色放到专门的参考线插件里面"），
  // 卸载插件时配置跟着消失；CSS 侧 ui-theme.css 的 --ui-guide 兜底直通 --ui-accent。
  alignGuideColorLight: {
    type: 'color',
    default: '',
    optional: true,
    label: '参考线颜色',
    group: '常规/主题配色',
    description: '亮色主题下的参考线颜色。拖拽时的对齐辅助线颜色。清空 = 跟随主题强调色。',
  },
  alignGuideColorDark: {
    type: 'color',
    default: '',
    optional: true,
    label: '参考线颜色',
    group: '常规/暗色主题配色',
    description: '暗色主题下的参考线颜色。拖拽时的对齐辅助线颜色。清空 = 跟随主题强调色。',
  },
} satisfies ConfigSchema

/** apply 侧可用的配置 TS 类型（与 schema 对齐） */
export type AlignGuideConfig = InferConfig<typeof Config>

/** 参考线颜色的两个 settings key（亮/暗格）—— 组件按当前主题挑一格读 */
export const ALIGN_GUIDE_COLOR_KEYS = {
  light: 'alignGuideColorLight',
  dark: 'alignGuideColorDark',
} as const

/** 从 settings 读当前配置（未声明/未改时回落 schema 默认；settings 未就绪则全走默认） */
export function alignGuideConfigFrom(ctx: Context): AlignGuideConfig {
  const settings = ctx.tryGet('settings')
  const read = <T extends string | number | boolean>(key: string, fallback: T): T => {
    if (!settings) return fallback
    const v = settings.get(key)
    return (v === undefined || v === null ? fallback : v) as T
  }
  return {
    alignGuideEnabled: read('alignGuideEnabled', true),
    // 颜色格：读不到（未声明/未设置）回落空串 = 跟随主题强调色（组件侧不需要缓存这个值，
    // AlignGuideOverlay 走 CSS 变量、alignGuidePlugin 的 bindGuideColorVars 写内联，这里只为类型完整）
    alignGuideColorLight: read('alignGuideColorLight', ''),
    alignGuideColorDark: read('alignGuideColorDark', ''),
  }
}
