/** 主题工作台读写 settings 所需的最小接口（主应用 / 预览内核都满足）。 */
import type { DeclaredColorField } from './catalog'

export interface LabSettingsStore {
  has?(key: string): boolean
  get(key: string): unknown
  set(key: string, value: string | number | boolean): boolean
  groups(): string[]
  groupOf(group: string): Array<{ key: string; schema: DeclaredColorField['schema']; value: string | number | boolean }>
  onChange(cb: (key: string, value: unknown) => void): { dispose(): void }
  onSchemaChange?(cb: () => void): { dispose(): void }
}
