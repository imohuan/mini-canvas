/**
 * configSchema —— 轻量"对象配置 schema"（自研 cordis ch5 语义，零第三方、零 Vue，Node 可单测）。
 *
 * 用途（docs/plan/plugin-cordis-migration-plan.md P4）：插件作者在模块级导出一个 `Config` schema，
 * 声明它这份插件的可配置项；装配处给 config → 内核 `resolveConfig` 校验 + 补齐默认值 → `apply(ctx, config)`
 * 收到的永远是"经 schema 校验、默认值已补齐"的完整 config。校验失败 → 插件 fiber 进 FAILED 并响亮报错。
 *
 * 与旧 ctx.settings 的关系：
 * - 本 schema 是"声明入口"；内核激活时把其字段 + 校验后初值登记进 SettingsStore（单一数据源），
 *   面板/demo/插件仍可按 group 读、set、onChange 就地窄更新（实时生效，逻辑同旧 settings.onChange）。
 * - 类型集合有意对齐旧 `SettingSchema`（color/number/select/boolean + string），扩成"对象级 schema"。
 */
export type ConfigPrimitive = string | number | boolean

/** select 的可选项：值字符串，或带展示文案的 { value, label } */
export type ConfigSelectOption = string | { value: string; label?: string }

/** 一个可配置字段的 schema（type 决定校验与 UI 控件） */
export interface ConfigField {
  /** 字段类型：string/color/number/boolean/select */
  type: 'string' | 'color' | 'number' | 'boolean' | 'select'
  /** 默认值（装配未提供时补齐；也作 UI/单一数据源初值） */
  default: ConfigPrimitive
  /** UI 显示文案 */
  label?: string
  /** UI 分组名（面板按组展示；缺省 = 插件名） */
  group?: string
  /** number 用：最小/最大（装配 raw 越界 → 校验错 FAILED；运行时面板 set 仍走 store 夹取） */
  min?: number
  max?: number
  /** select 用：可选枚举（raw 不在其中 → 校验错） */
  options?: ConfigSelectOption[]
}

/** 对象级 config schema：字段名 → 字段 schema */
export type ConfigSchema = Record<string, ConfigField>

/** 由 schema 推导出的 config 值 TS 类型（供作者给 apply 的 config 形参做类型） */
export type InferConfig<S extends ConfigSchema> = {
  [K in keyof S]: S[K]['type'] extends 'number'
    ? number
    : S[K]['type'] extends 'boolean'
      ? boolean
      : string
}

/** 便捷构造帮助（返回一个 ConfigField；default 用首参，min/max/options 等用对象展开补充） */
export const F = {
  string(def = ''): ConfigField {
    return { type: 'string', default: def }
  },
  color(def = '#000000'): ConfigField {
    return { type: 'color', default: def }
  },
  number(def = 0): ConfigField {
    return { type: 'number', default: def }
  },
  boolean(def = false): ConfigField {
    return { type: 'boolean', default: def }
  },
  select(def = '', options: ConfigSelectOption[] = []): ConfigField {
    return { type: 'select', default: def, options }
  },
}

/** 校验失败错误（响亮、带字段与期望，fiber 置 FAILED 供诊断） */
export class ConfigError extends Error {
  constructor(message: string) {
    super(`[config] invalid config: ${message}`)
    this.name = 'ConfigError'
  }
}

/**
 * 校验并归一一个 config 对象。
 * @param schema 插件的 Config schema（可缺省：无 schema 则原样返回 raw）
 * @param raw 装配处给的原始 config（可缺省）
 * @returns 校验后、默认值补齐的 config（仅含 schema 声明过的 key；外来 key 忽略）
 * @throws ConfigError 某字段类型不符、number 非有限/越界、select 不在枚举、color 非法时
 */
export function resolveConfig(
  schema: ConfigSchema | undefined,
  raw?: unknown,
): object | undefined {
  if (!schema) return (raw as object | undefined) ?? undefined
  const rawObj =
    raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const out: Record<string, ConfigPrimitive> = {}
  for (const [key, field] of Object.entries(schema)) {
    const present = key in rawObj && rawObj[key] !== undefined
    const input: unknown = present ? rawObj[key] : field.default
    out[key] = validateValue(key, field, input)
  }
  return out
}

function validateValue(key: string, field: ConfigField, raw: unknown): ConfigPrimitive {
  switch (field.type) {
    case 'number': {
      if (typeof raw !== 'number' || !Number.isFinite(raw)) {
        throw new ConfigError(`"${key}" expected number but got ${describe(raw)}`)
      }
      if (field.min !== undefined && raw < field.min) {
        throw new ConfigError(`"${key}" = ${raw} is below min ${field.min}`)
      }
      if (field.max !== undefined && raw > field.max) {
        throw new ConfigError(`"${key}" = ${raw} exceeds max ${field.max}`)
      }
      return raw
    }
    case 'boolean': {
      if (typeof raw !== 'boolean') {
        throw new ConfigError(`"${key}" expected boolean but got ${describe(raw)}`)
      }
      return raw
    }
    case 'color': {
      if (typeof raw !== 'string' || !/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(raw)) {
        throw new ConfigError(`"${key}" expected hex color but got ${describe(raw)}`)
      }
      return raw
    }
    case 'select': {
      const opts = optionValues(field.options)
      if (typeof raw !== 'string' || !opts.includes(raw)) {
        throw new ConfigError(`"${key}" expected one of ${opts.join(', ')} but got ${describe(raw)}`)
      }
      return raw
    }
    case 'string':
    default: {
      if (typeof raw !== 'string') {
        throw new ConfigError(`"${key}" expected string but got ${describe(raw)}`)
      }
      return raw
    }
  }
}

/** 取 select 可选项的值列表（支持 纯字符串 与 {value,label} 混合） */
export function optionValues(options?: ConfigSelectOption[]): string[] {
  return (options ?? []).map((o) => (typeof o === 'string' ? o : o.value))
}

/** 取 select 可选项的展示值（供 UI 面板映射 label；纯字符串则以自身为展示） */
export function selectOptionEntry(o: ConfigSelectOption): { value: string; label?: string } {
  return typeof o === 'string' ? { value: o } : { value: o.value, label: o.label }
}

function describe(v: unknown): string {
  if (v === null) return 'null'
  if (Array.isArray(v)) return 'an array'
  if (typeof v === 'object') return 'an object'
  return `"${String(v)}"`
}
