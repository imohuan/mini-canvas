/**
 * edgeCuttingConfig —— 连线切割插件可配置项（纯逻辑：schema + 从 settings 读当前值）。
 *
 * 对齐 v1 EdgeCuttingOptions / 现有 EdgeCuttingOptions 的可调项：
 *   总开关 / 命中容差 / 路径采样步长 / 轨迹色 / 刀锋色 / 是否显示完整拖拽轨迹。
 * 分组统一走「连线切割」；标量字段经内核 SettingsStore（settings 单一数据源）登记进 ⚙ 设置面板，
 * 改动实时生效（切割会话/绘制点读到本函数，不缓存 apply 时 config）。
 * 独立成文件避免 edgeCuttingPlugin ↔ edgeCuttingOverlay 循环 import。
 */
import type { ConfigSchema, InferConfig, Context } from '@mini-canvas/canvas-base'

/** 模块级 Config schema（P4：随插件模块导出，内核装配时校验 + 补默认 + 登记设置面板） */
export const Config = {
  enabled: {
    type: 'boolean',
    default: true,
    label: '启用连线切割',
    group: '连线切割',
    description:
      '总开关。关闭后 Alt+拖拽刀光不再装配/生效；重开即恢复，无需重载画布。',
  },
  tolerancePx: {
    type: 'number',
    default: 8,
    min: 1,
    max: 32,
    step: 1,
    label: '命中容差',
    group: '连线切割',
    description:
      '刀光与连线路径的命中容差（屏幕像素）。越大越容易切中（也更可能误切邻近线）。',
  },
  sampleStepPx: {
    type: 'number',
    default: 6,
    min: 2,
    max: 24,
    step: 1,
    label: '路径采样步长',
    group: '连线切割',
    description:
      '对每条连线路径按此步长均匀采样为折线后做相交判定（px）。越小越精确、开销略高。',
  },
  pathColor: {
    type: 'color',
    default: '#38bdf8',
    label: '切割轨迹颜色',
    group: '连线切割',
    description: 'Alt 拖拽时画出的完整轨迹线的颜色（半透明发光线条）。',
  },
  bladeColor: {
    type: 'color',
    default: '#38bdf8',
    label: '刀锋颜色',
    group: '连线切割',
    description: '刀锋尾迹/刀尖的主题色（发光描边颜色）。',
  },
  showCutPath: {
    type: 'boolean',
    default: true,
    label: '显示完整轨迹',
    group: '连线切割',
    description:
      '是否画出整条 Alt 拖拽轨迹。关闭后只显示刀锋（光标附近短尾迹）。',
  },
} satisfies ConfigSchema

/** apply 侧可用的配置 TS 类型（与 schema 对齐） */
export type EdgeCuttingConfig = InferConfig<typeof Config>

/** 从 settings 读当前配置（未声明/未改时回落 schema 默认；settings 未就绪则全走默认） */
export function edgeCuttingConfigFrom(ctx: Context): EdgeCuttingConfig {
  const settings = ctx.get<{ get(key: string): string | number | boolean | undefined } | undefined>('settings')
  const read = <T extends string | number | boolean>(key: string, fallback: T): T => {
    if (!settings) return fallback
    const v = settings.get(key)
    return (v === undefined || v === null ? fallback : v) as T
  }
  return {
    enabled: read('enabled', true),
    tolerancePx: read('tolerancePx', 8),
    sampleStepPx: read('sampleStepPx', 6),
    pathColor: read('pathColor', '#38bdf8'),
    bladeColor: read('bladeColor', '#38bdf8'),
    showCutPath: read('showCutPath', true),
  }
}
