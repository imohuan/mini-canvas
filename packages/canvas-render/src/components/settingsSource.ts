/**
 * settingsSource —— 把内核分组配置单一数据源(ctx.get('settings')) 适配成设置面板消费的最小接口。
 *
 * 目的（settings-panel-slot-host-plan §三.A）：设置面板/宿主不必知道内核 SettingsStore 的完整 API，
 * 只消费它需要的 { groups, groupOf, set, onChange }。SettingsStore 已天然实现这些方法，
 * 这里做类型收口（SettingsPanelSource）+ 边界说明，作为渲染层导出的复用入口。
 *
 * SettingsStore 变更非响应式（plain class），面板侧用 onChange 订阅 + 版本号驱动刷新（见 SettingsHost/PluginSettingsPanel）。
 */
import type { Context } from '@mini-canvas/canvas-core-v2'
import type { SettingsPanelSource } from './settingsPanelTypes'

/** 从内核 ctx 取设置数据源（ctx.get('settings') 恒为内置 SettingsStore 实例，见 Context）。 */
export function settingsSourceFrom(ctx: Context): SettingsPanelSource {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const store = ctx.get<SettingsPanelSource>('settings')
  if (!store || typeof store.groups !== 'function') {
    throw new Error('[settingsSource] ctx 缺少 settings 服务：请确认宿主已注入(内置恒在,通常不会缺)')
  }
  return store
}
