/**
 * miniMapConfig —— mini-map 插件可配置项（纯逻辑：schema + 从 settings 读当前值）。
 *
 * 对齐老版 MiniMapPlugin 的 5 个 panel 设置项（宽度/高度/X轴灵敏度/Y轴灵敏度/显示小地图），
 * 分组为独立一级「小地图」；标量字段经内核 SettingsStore（settings 单一数据源）
 * 登记进 ⚙ 设置面板，改动实时生效（浮层订阅 onChange 后重读本函数）。
 * 独立成文件避免 miniMapPlugin ↔ MiniMapOverlay 循环 import。
 */
import type { ConfigSchema, InferConfig } from '@mini-canvas/canvas-base'
import type { Context } from '@mini-canvas/canvas-base'

export const Config = {
  miniMapWidth: {
    type: 'number', default: 240, min: 120, max: 400, step: 10, label: '宽度', description: '小地图面板的宽度（px）。', group: '小地图' },
  miniMapHeight: {
    type: 'number', default: 160, min: 80, max: 300, step: 10, label: '高度', description: '小地图面板的高度（px）。', group: '小地图' },
  miniMapSensitivityX: {
    type: 'number', default: 1, min: 0.1, max: 3, step: 0.1, label: 'X轴灵敏度', description: '在小地图里拖动时，画布水平移动的倍率（1 = 完全跟随，>1 移得更快）。', group: '小地图' },
  miniMapSensitivityY: {
    type: 'number', default: 1, min: 0.1, max: 3, step: 0.1, label: 'Y轴灵敏度', description: '在小地图里拖动时，画布垂直移动的倍率。', group: '小地图' },
  miniMapVisible: {
    type: 'boolean', default: true, label: '显示小地图', description: '是否在画布角落显示小地图。也可用 Ctrl/Cmd + M 快捷切换。', group: '小地图' },
} satisfies ConfigSchema

export type MiniMapConfig = InferConfig<typeof Config>

/** 从 settings 读当前配置（未声明/未改时回落 schema 默认） */
export function miniMapConfigFrom(ctx: Context): MiniMapConfig {
  const settings = ctx.get<{ get(key: string): string | number | boolean | undefined }>('settings')
  const read = <T extends string | number | boolean>(key: string, fallback: T): T => {
    if (!settings) return fallback
    const v = settings.get(key)
    return (v === undefined || v === null ? fallback : v) as T
  }
  return {
    miniMapWidth: read('miniMapWidth', 240),
    miniMapHeight: read('miniMapHeight', 160),
    miniMapSensitivityX: read('miniMapSensitivityX', 1),
    miniMapSensitivityY: read('miniMapSensitivityY', 1),
    miniMapVisible: read('miniMapVisible', true),
  }
}
