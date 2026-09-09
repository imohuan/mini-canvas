/**
 * settingsStore —— 分组化配置"单一数据源"（纯逻辑、零 Vue、Node 可单测）。
 *
 * 目的（docs/goal/plugin-system-goal.md 2.4 / 目标 B2）：插件把配置按"组"申报（schema：类型/默认/范围/label），
 * 内核做唯一数据源；UI 面板按分组自动长控件，改一项 → set(key, value) → 只推给"声明/关心该变化的那一方"，
 * 插件就地更新它注册的东西（实时生效），不全局广播、不整图重建。
 *
 * 语义：
 * - define({ group, items }): 插件申报一组配置项。组名唯一（同组重复申报抛错）。
 * - 值存于本 store（单一数据源）：初始值 = item.default（装配可经 manifest 覆盖，见 initValue）。
 * - set(key, value): 改一个已声明项的值；越界(min/max)静默夹取，未知 key 抛错（响亮失败便于定位）。
 * - onChange(scope, cb): 按"作用域"订阅——默认只把"变化发生在声明了该项的插件作用域内"推给该 cb。
 *   传 scope 插件名即"我只听我自己的配置变化"，别的插件改自己的不误触（满足性能约束①/④）。
 *   不传 scope = 全局订阅（显式声明才用）。
 * - 高频合帧：宿主/消费方可选把 set 改成 rAF 节流（见 host 侧设置面板）；本 store 变更即时入库、
 *   通知立即广播（纯同步，Node 可测）。真正"合帧应用"由消费方(主题)按需做，避免每帧全图重建。
 * - 保存快照（配置持久化桥 settingsPersist 使用）：setSavedSnapshot 注入"用户已保存值"，define 时
 *   命中快照的 key 以其为初值（优先于 schema.default）；set 同步写回快照；clearSavedKeys 恢复默认。
 *   热卸插件 removeByScope 删声明后重装 define 仍能恢复用户值。
 */
import type { Disposable } from './types'

/** 一项配置的 schema */
export interface SettingSchema {
  /** 控件类型：color/number/select/boolean/text */
  type: 'color' | 'number' | 'select' | 'boolean' | 'text'
  /** 默认值（作为单一数据源的初始值） */
  default: string | number | boolean
  /** UI 显示文案 */
  label?: string
  /** UI 描述/说明（可选，控件下方小字；缺省不显示） */
  description?: string
  /** number 用：最小/最大（越界夹取） */
  min?: number
  max?: number
  /** number 用：滑块步长（UI 用；缺省 1）。小数比例字段须显式给 step（如 0.05） */
  step?: number
  /** select 用：可选下拉项 */
  options?: Array<{ value: string; label?: string }>
}

/** 申报一组配置 */
export interface SettingGroupDef {
  group: string
  items: Record<string, SettingSchema>
}

/** 某配置项的当前值视图 */
export interface SettingEntry {
  group: string
  key: string
  schema: SettingSchema
  value: string | number | boolean
}

type Listener = (scope: string | undefined, key: string, value: unknown) => void

/** 一个"已声明项"在库内的登记：所属组 + schema + 当前值 */
interface DeclaredItem {
  group: string
  schema: SettingSchema
  value: string | number | boolean
  /** 声明它的插件名（change 的作用域归属） */
  scope?: string
}

export class SettingsStore {
  private items = new Map<string, DeclaredItem>()
  private listeners = new Set<Listener>()
  /** schema 变更订阅（define/removeByScope 触发；UI 分组列表刷新用） */
  private schemaListeners = new Set<() => void>()
  /** 用户已保存值快照（settingsPersist 桥注入）：define 命中即以快照值为初值；set 同步写回；clearSavedKeys 删除。 */
  private savedSnapshot: Record<string, string | number | boolean> | null = null

  /** 申报一组配置项。同组重复申报抛错（防覆盖）。scope = 申报方插件名(供按作用域订阅) */
  define(group: string, defs: Record<string, SettingSchema>, scope?: string): void {
    for (const [key, schema] of Object.entries(defs)) {
      if (this.items.has(key)) {
        throw new Error(`[settings] setting "${key}" is already defined`)
      }
      const saved = this.savedSnapshot ? this.savedSnapshot[key] : undefined
      this.items.set(key, { group, schema, value: saved ?? schema.default, scope })
    }
    this.notifySchema()
  }

  /** 装配覆盖某个默认值（manifest 在插件 apply 前调用）；未定义项可预置 */
  setDefault(key: string, value: string | number | boolean): void {
    const item = this.items.get(key)
    if (item) item.value = value
    else this.items.set(key, { group: '', schema: { type: 'text', default: value }, value, scope: undefined })
  }

  /** 改一个已声明项的值（未知 key 抛错；越界夹取）；返回是否真的变了 */
  set(key: string, value: string | number | boolean): boolean {
    const item = this.items.get(key)
    if (!item) {
      throw new Error(`[settings] setting "${key}" is not defined. Define it first via settings.define.`)
    }
    const clamped = this.clamp(item.schema, value)
    if (Object.is(item.value, clamped)) return false
    item.value = clamped
    // 同步进保存快照：热卸插件 removeByScope 后重装 define 时能恢复用户值（而非 schema.default）
    if (this.savedSnapshot) this.savedSnapshot[key] = clamped
    this.notify(item.scope, key, clamped)
    return true
  }

  /** 读某项当前值 */
  get(key: string): string | number | boolean {
    const item = this.items.get(key)
    if (!item) return undefined as unknown as string
    return item.value
  }

  /** 某组全部项（UI 面板按组列） */
  groupOf(group: string): SettingEntry[] {
    const out: SettingEntry[] = []
    for (const [key, item] of this.items) {
      if (item.group === group) out.push({ group, key, schema: item.schema, value: item.value })
    }
    return out
  }

  /** 已申报的所有组名 */
  groups(): string[] {
    return [...new Set([...this.items.values()].map((i) => i.group))].filter((g) => g !== '')
  }

  /** 是否已声明某 key */
  has(key: string): boolean {
    return this.items.has(key)
  }

  /** 移除某"声明作用域"(插件名)下的全部配置项(热卸/重载插件时随 scope 清理, 防残留与重载撞 key) */
  removeByScope(scope: string | undefined): void {
    if (scope === undefined) return
    for (const [key, item] of this.items) {
      if (item.scope === scope) this.items.delete(key)
    }
    this.notifySchema()
  }

  // ==================== 保存快照（配置持久化桥 settingsPersist 用） ====================

  /** 注入"用户已保存值"快照（持久化恢复）。随后 define 的新项若 key 命中快照则以其为初值；
   *  已声明项立即覆盖为快照值。传空对象 = 清除快照（从未保存过）。 */
  setSavedSnapshot(saved: Record<string, string | number | boolean>): void {
    this.savedSnapshot = { ...saved }
    // 已声明项立即应用并通知（供持久化恢复阶段晚于插件声明的场景）
    for (const [key, value] of Object.entries(saved)) {
      const item = this.items.get(key)
      if (item && item.value !== value) {
        item.value = value
        this.notify(item.scope, key, value)
      }
    }
  }

  /**
   * 订阅 schema 变更（define 新增项 / removeByScope 移除项后触发）。
   * 供设置面板等 UI 在插件热装/热卸后刷新分组列表；返回取消函数。
   */
  onSchemaChange(cb: () => void): Disposable {
    this.schemaListeners.add(cb)
    return { dispose: () => this.schemaListeners.delete(cb) }
  }

  /** 当前保存快照（持久化桥导出用；null=从未注入过，空对象=注入过但无保存值） */
  getSavedSnapshot(): Record<string, string | number | boolean> | null {
    return this.savedSnapshot ? { ...this.savedSnapshot } : null
  }

  /** 清除保存快照中的某些 key（用户"恢复默认"时调用；已声明项同步回到 schema.default） */
  clearSavedKeys(keys: string[]): void {
    if (!this.savedSnapshot) return
    for (const key of keys) {
      delete this.savedSnapshot[key]
      const item = this.items.get(key)
      if (item) {
        item.value = item.schema.default
        this.notify(item.scope, key, item.value)
      }
    }
  }

  /** 当前全部已声明项（key → 值），供桥把"现网值"导出为保存快照 */
  entries(): Record<string, string | number | boolean> {
    const out: Record<string, string | number | boolean> = {}
    for (const [key, item] of this.items) out[key] = item.value
    return out
  }

  /**
   * 订阅配置变化。
   * @param cb(key, value)
   * @param opts.scope 只收"声明方 scope 匹配的变化"；不传 = 收全部(全局)
   * @returns 取消句柄
   */
  onChange(cb: (key: string, value: unknown) => void, opts?: { scope?: string }): Disposable {
    const listener: Listener = (scope, key, value) => {
      if (opts?.scope !== undefined && scope !== opts.scope) return // 按作用域过滤：不误触别人
      cb(key, value)
    }
    this.listeners.add(listener)
    return { dispose: () => this.listeners.delete(listener) }
  }

  private notifySchema(): void {
    for (const l of this.schemaListeners) {
      try { l() } catch { /* 忽略单个订阅者异常 */ }
    }
  }

  private notify(scope: string | undefined, key: string, value: unknown): void {
    // P2-6：坏订阅者异常不阻断其它订阅者/写操作
    for (const l of this.listeners) {
      try { l(scope, key, value) } catch { /* 忽略单个订阅者异常 */ }
    }
  }

  private clamp(schema: SettingSchema, value: string | number | boolean): string | number | boolean {
    if (schema.type === 'number' && typeof value === 'number') {
      if (schema.min !== undefined && value < schema.min) return schema.min
      if (schema.max !== undefined && value > schema.max) return schema.max
    }
    return value
  }
}





