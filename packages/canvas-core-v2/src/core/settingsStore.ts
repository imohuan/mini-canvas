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
  /** number 用：最小/最大（越界夹取） */
  min?: number
  max?: number
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

  /** 申报一组配置项。同组重复申报抛错（防覆盖）。scope = 申报方插件名(供按作用域订阅) */
  define(group: string, defs: Record<string, SettingSchema>, scope?: string): void {
    for (const [key, schema] of Object.entries(defs)) {
      if (this.items.has(key)) {
        throw new Error(`[settings] setting "${key}" is already defined`)
      }
      this.items.set(key, { group, schema, value: schema.default, scope })
    }
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

  private notify(scope: string | undefined, key: string, value: unknown): void {
    for (const l of this.listeners) l(scope, key, value)
  }

  private clamp(schema: SettingSchema, value: string | number | boolean): string | number | boolean {
    if (schema.type === 'number' && typeof value === 'number') {
      if (schema.min !== undefined && value < schema.min) return schema.min
      if (schema.max !== undefined && value > schema.max) return schema.max
    }
    return value
  }
}
