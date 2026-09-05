import type { SettingSchema, SettingEntry } from '@mini-canvas/canvas-core-v2'

/** 面板消费的最小 settings 接口（与内核 SettingsStore / ctx.settings 能力对齐）。独立 .ts 以便 plain tsc 导出类型。 */
export interface SettingsPanelSource {
  groups(): string[]
  groupOf(group: string): SettingEntry[]
  set(key: string, value: string | number | boolean): boolean
  onChange(cb: (key: string, value: unknown) => void): { dispose(): void }
}

export type { SettingSchema, SettingEntry }
