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

/** 一个 config 值：原始标量，或 array/object 的嵌套结构（递归）。 */
export type ConfigValue = ConfigPrimitive | ConfigValue[] | { [key: string]: ConfigValue }

/** select 的可选项：值字符串，或带展示文案的 { value, label } */
export type ConfigSelectOption = string | { value: string; label?: string }

/** 可配置字段的标量类型（settings 面板可长控件、SettingsStore 支持） */
export type ConfigScalarType = 'string' | 'color' | 'number' | 'boolean' | 'select'
/** 全部字段类型：标量 + array + object（DSH/Schemastery 的"数组/嵌套对象"子集） */
export type ConfigFieldType = ConfigScalarType | 'array' | 'object'

/**
 * 一个可配置字段的 schema（type 决定校验与 UI 控件）。
 * - 标量(string/color/number/boolean/select)：与旧 SettingSchema 对齐，登记 settings 面板长控件。
 * - `array`(如"多目标列表")：默认是数组；可配 `item` 描述元素 schema，逐元素递归校验/补默认。
 * - `object`(嵌套选项)：可配 `fields` 递归子 schema，逐键校验、补默认、丢未知 key。
 *   array/object 是"给 apply 的结构化配置"，不登记进 settings 单一数据源(面板为标量控件)。
 */
export interface ConfigField {
  /** 字段类型 */
  type: ConfigFieldType
  /** 默认值（装配未提供时补齐；标量也作 UI/单一数据源初值） */
  default: ConfigValue
  /** UI 显示文案（标量控件用） */
  label?: string
  /** UI 描述/说明（可选，标量控件在控件下方渲染小字；缺省不显示） */
  description?: string
  /** UI 分组名（面板按组展示；缺省 = 插件名） */
  group?: string
  /** number 用：最小/最大（装配 raw 越界 → 校验错 FAILED；运行时面板 set 仍走 store 夹取） */
  min?: number
  max?: number
  /** select 用：可选枚举（raw 不在其中 → 校验错） */
  options?: ConfigSelectOption[]
  /** array 用：元素 schema（缺省则只做"是数组"检查，元素原样保留） */
  item?: ConfigField
  /** object 用：递归子 schema（缺省则只做"是普通对象"检查，内部原样保留） */
  fields?: ConfigSchema
}

/** 对象级 config schema：字段名 → 字段 schema */
export type ConfigSchema = Record<string, ConfigField>

/** 由 schema 推导出的 config 值 TS 类型（供作者给 apply 的 config 形参做类型） */
export type InferConfig<S extends ConfigSchema> = {
  [K in keyof S]: S[K]['type'] extends 'array'
    ? S[K] extends { item: infer I }
      ? I extends ConfigField
        ? InferValue<I>[]
        : ConfigValue[]
      : ConfigValue[]
    : S[K]['type'] extends 'object'
      ? S[K] extends { fields: infer F }
        ? F extends ConfigSchema
          ? InferConfig<F>
          : { [key: string]: ConfigValue }
        : { [key: string]: ConfigValue }
      : S[K]['type'] extends 'number'
        ? number
        : S[K]['type'] extends 'boolean'
          ? boolean
          : string
}

/** 由单个字段 schema 推导其值类型（供 InferConfig 对 array item / 标量复用） */
type InferValue<F extends ConfigField> = F['type'] extends 'array'
  ? F extends { item: infer I }
    ? I extends ConfigField
      ? InferValue<I>[]
      : ConfigValue[]
    : ConfigValue[]
  : F['type'] extends 'object'
    ? F extends { fields: infer S }
      ? S extends ConfigSchema
        ? InferConfig<S>
        : { [key: string]: ConfigValue }
      : { [key: string]: ConfigValue }
    : F['type'] extends 'number'
      ? number
      : F['type'] extends 'boolean'
        ? boolean
        : string

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
  array(def: ConfigValue[] = [], item?: ConfigField): ConfigField {
    return item ? { type: 'array', default: def, item } : { type: 'array', default: def }
  },
  object(def: { [key: string]: ConfigValue } = {}, fields?: ConfigSchema): ConfigField {
    return fields ? { type: 'object', default: def, fields } : { type: 'object', default: def }
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
  const out: Record<string, ConfigValue> = {}
  for (const [key, field] of Object.entries(schema)) {
    const present = key in rawObj && rawObj[key] !== undefined
    const input: unknown = present ? rawObj[key] : field.default
    out[key] = validateValue(key, field, input)
  }
  return out
}

/** 判标量字段（type 在 settings 面板可长控件的 5 型内；array/object 是结构化配置） */
export function isScalarField(field: ConfigField): boolean {
  return field.type !== 'array' && field.type !== 'object'
}

function validateValue(key: string, field: ConfigField, raw: unknown): ConfigValue {
  switch (field.type) {
    case 'array':
      return validateArray(key, field, raw)
    case 'object':
      return validateObject(key, field, raw)
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

/** array 校验：必须是数组；每元素经 item schema 递归（无 item 则原样保留，只查数组形态） */
function validateArray(key: string, field: ConfigField, raw: unknown): ConfigValue {
  if (!Array.isArray(raw)) {
    throw new ConfigError(`"${key}" expected an array but got ${describe(raw)}`)
  }
  if (!field.item) return raw
  const itemField = field.item
  return raw.map((el, i) => validateValue(`${key}[${i}]`, itemField, el))
}

/** object 校验：必须是普通对象；逐键按 fields 子 schema 递归补默认/丢未知（无 fields 则原样保留） */
function validateObject(key: string, field: ConfigField, raw: unknown): ConfigValue {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ConfigError(`"${key}" expected an object but got ${describe(raw)}`)
  }
  const rawObj = raw as Record<string, unknown>
  if (!field.fields) return rawObj as ConfigValue
  const out: Record<string, ConfigValue> = {}
  for (const [subKey, subField] of Object.entries(field.fields)) {
    const present = subKey in rawObj && rawObj[subKey] !== undefined
    const input: unknown = present ? rawObj[subKey] : subField.default
    out[subKey] = validateValue(`${key}.${subKey}`, subField, input)
  }
  return out
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
