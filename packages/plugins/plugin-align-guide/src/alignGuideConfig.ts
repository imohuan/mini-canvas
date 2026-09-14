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
} satisfies ConfigSchema

/** apply 侧可用的配置 TS 类型（与 schema 对齐） */
export type AlignGuideConfig = InferConfig<typeof Config>

/** 从 settings 读当前配置（未声明/未改时回落 schema 默认；settings 未就绪则全走默认） */
export function alignGuideConfigFrom(ctx: Context): AlignGuideConfig {
  const settings = ctx.get<{ get(key: string): string | number | boolean | undefined } | undefined>('settings')
  const read = <T extends string | number | boolean>(key: string, fallback: T): T => {
    if (!settings) return fallback
    const v = settings.get(key)
    return (v === undefined || v === null ? fallback : v) as T
  }
  return {
    alignGuideEnabled: read('alignGuideEnabled', true),
  }
}
