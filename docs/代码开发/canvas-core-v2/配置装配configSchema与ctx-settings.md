# 配置装配：PluginModule.Config、configSchema、ctx.settings / SettingsStore

> 来源：packages/canvas-core-v2/src/core/configSchema.ts、settingsStore.ts、capabilities.ts、Context.ts

插件往往有一些"可被用户调"的项（颜色、开关、下拉选、数字范围……）。v2 的方式：

1. 插件在模块级导出 **`Config` schema** 声明这些项；
2. 装配处给 `ctx.plugin(mod, config)` 传原始值；
3. 内核**校验 + 补默认**后，把完整 config 作为 `apply(ctx, config)` 的第二参传给你；
4. 这些项同时自动登记进内核的 **SettingsStore（单一数据源）**，宿主 / 用户面板可读、可改、可订阅，改动**实时生效**。

---

## 1. 一个最小完整例子

```ts
import { Context, F, type PluginScope } from '@mini-canvas/canvas-core-v2'

export const name = 'theme-a'
export const Config = {
  edgeColor: F.color('#3b82f6'),                    // 颜色
  edgeType: F.select('bezier', ['bezier', 'straight']),  // 下拉
  lineWidth: { type: 'number', default: 2, min: 1, max: 6 },  // 数字带范围
  glow: F.boolean(true),                            // 开关
}
export function apply(ctx: PluginScope, config: { edgeColor: string; edgeType: string; lineWidth: number; glow: boolean }) {
  // config 一定完整：缺的都补默认，类型都校验过
  console.log(config)
  // 订阅自己的配置变化，就地实时生效
  ctx.settings.onChange('theme-a', (key, value) => {
    console.log(key, value)   // 只收声明方=theme-a 的变化
  })
}

// 装配方：给装配 config（可只给一部分，缺的补默认）
const ctx = new Context()
ctx.plugin(themeAModule, { edgeType: 'straight' })  // apply 收到 { edgeColor:'#3b82f6', edgeType:'straight', lineWidth:2, glow:true }
await ctx.start()
```

`apply` 收到的 `config` 永远**只含 schema 声明过的 key**（外来 key 被丢），类型已校验、默认已补齐。

---

## 2. configSchema：声明字段的类型

`ConfigSchema = Record<string, ConfigField>`。一个 `ConfigField`：

```ts
interface ConfigField {
  type: 'string' | 'color' | 'number' | 'boolean' | 'select' | 'array' | 'object'
  default: ConfigValue
  label?: string            // UI 文案（标量控件用）
  description?: string      // UI 说明（控件下方小字）
  group?: string            // UI 分组名（缺省 = 插件名）
  min?: number; max?: number   // number 用（装配越界 → 校验错 FAILED）
  options?: ConfigSelectOption[]  // select 用
  item?: ConfigField        // array 用：元素 schema
  fields?: ConfigSchema     // object 用：递归子 schema
}
```

`ConfigValue`：标量(string|number|boolean) 或 array/object 递归。

### 便捷构造 `F`

```ts
F.string(def = '')                    // { type:'string', default }
F.color(def = '#000000')              // { type:'color', default }
F.number(def = 0)                     // { type:'number', default }
F.boolean(def = false)                // { type:'boolean', default }
F.select(def = '', options)           // { type:'select', default, options }
F.array(def = [], item?)              // 数组；可给 item schema
F.object(def = {}, fields?)           // 嵌套对象；可给 fields 子 schema
```

### 类型推导 `InferConfig`

让 `apply` 的 config 参数拿正确 TS 类型：

```ts
import type { InferConfig, ConfigSchema } from '@mini-canvas/canvas-core-v2'

const Config = { targets: F.array([], F.string('')), layout: F.object({}, { gap: F.number(8) }) } satisfies ConfigSchema
type Cfg = InferConfig<typeof Config>
// Cfg = { targets: string[]; layout: { gap: number } }
```

---

## 3. 校验规则（resolveConfig）—— 校验失败响亮抛错

`resolveConfig(schema, raw)`：校验并归一。规则（源码为准）：

- 缺省用默认补齐；外来 key 忽略；无 schema 则原样返回 raw。
- **number**：必须 `typeof number` 且有限；越 min/max 抛错（`below min` / `exceeds max`）。
- **boolean**：必须布尔。
- **color**：必须匹配 `/^#([0-9a-fA-F]{3}|...{6}|...{8})$/` 十六进制色。
- **select**：值必须在 options 枚举里。
- **string**：必须 string。
- **array**：必须是数组；有 `item` 则逐元素递归校验（错误键名带下标，如 `"targets[1]"`）。
- **object**：必须普通对象；有 `fields` 则逐键递归补默认/丢未知 key（错误键名带路径，如 `"layout.align"`）。

失败抛 `ConfigError`（`[config] invalid config: <字段与期望>`）。插件激活时 config 校验失败 → 插件进 **FAILED** 并往上层抛错（start/installPlugin 会 reject/throw），半成品副作用已清，可重装同名复用。

```ts
import { resolveConfig, F, ConfigError } from '@mini-canvas/canvas-core-v2'

const schema = { lineWidth: { type: 'number', default: 2, min: 1, max: 6 } }
resolveConfig(schema, { lineWidth: 3 })       // { lineWidth: 3 }
resolveConfig(schema, {})                     // { lineWidth: 2 }（补默认）
resolveConfig(schema, { lineWidth: 99 })      // 抛 ConfigError "exceeds max 6"
```

内核在 `tryActivate` 里替你做 resolveConfig；作者通常直接用，只需知道行为。

---

## 4. 标量字段会自动进 settings 单一数据源

插件激活时，内核把 `Config` 里**标量字段**（string/color/number/boolean/select）声明进内置 SettingsStore（scope = 插件名），初值 = 装配校验后的 config 值。**array/object 不进 settings**（它们是"给 apply 的结构化配置"；面板只长标量控件）。随插件 fiber 卸载自动清（removeByScope）。

> 你几乎不用手动 `define` —— 只要给了 `Config` schema，内核就自动把标量项声明好。源码里 `SettingsStore` 仍有 `define` 方法，但**能力段收口的 ctx.settings 没有 define 入口**，声明统一走 `Config` schema。

---

## 5. SettingsStore —— 分组配置单一数据源（可独立用）

`SettingsStore`（服务名 `'settings'`，内核恒有）是分组配置的单一数据源。内核自带的那个实例，宿主和插件读到**同一份**。

```ts
import { SettingsStore } from '@mini-canvas/canvas-core-v2'

const s = new SettingsStore()

// define：申报一组（scope = 声明方插件名，供按作用域订阅）
s.define('基础', {
  nodeFill: { type: 'color', default: '#fff', label: '底色' },
  corner: { type: 'number', default: 8, min: 0, max: 40, label: '圆角' },
}, 'theme-a')

s.get('nodeFill')            // '#fff'（初值 = default）
s.set('corner', 20)          // 改值（number 越界夹取；未知 key 抛错；没真变返回 false）
s.groups()                   // ['基础']
s.groupOf('基础')             // 该组全部项（SettingEntry[]）
s.has('nodeFill')            // true
s.setDefault('k', v)         // 装配覆盖默认（未定义项可预置）
s.removeByScope('theme-a')   // 移除某声明方全部项（热卸/重载随 scope 清）

// 订阅：onChange(cb, { scope? })
const sub = s.onChange((key, value) => console.log(key, value), { scope: 'theme-a' })
sub.dispose()                // 退订
```

`SettingSchema` 类型（与 ConfigField 标量几乎一致）：`type: 'color'|'number'|'select'|'boolean'|'text'`（注意 config 里的 string 在 settings 里叫 text）+ default/min/max/options/label/description。

> 内核把 Config 标量自动映射成 SettingSchema 时，会把 `type:'string'` 收敛成 `'text'`（`toSettingSchema`）。所以 settings 读到的标量 schema 的 type 是 text 而非 string。

### 5.1 onChange 按作用域过滤

传 `scope` = 只收"声明方是该 scope 的变化"；不传 = 收全局。插件通常订阅自己的名（scope = 本插件名），这样别的插件改自己的配置不会误触你。

```ts
c.settings.onChange('theme-a', (k, v) => { /* 只 theme-a 自己的配置变化才来 */ })
```

---

## 6. ctx.settings（能力段）—— 已装配 config 的读 + 订阅

插件 ctx 上的 `ctx.settings` 是对内置 SettingsStore 的收口（无 define 入口）：

```ts
set(key, value): boolean            // 改一项（未知 key 抛错；number 越界夹取，实时生效）
get(key): string | number | boolean // 读当前值
onChange(scope, cb): { dispose() }  // 订阅某作用域变化（scope = 本插件名 = 只收自己的）
groups(): string[]                  // 已装配(声明)的组名
```

```ts
apply(c) {
  c.settings.onChange('theme-a', (key, value) => { /* 就地更新 */ })
}
// host 侧也能读写同一份：
ctx.settings.set('edgeColor', '#0af')
ctx.settings.get('edgeColor')     // '#0af'
```

> 宿主经 `ctx.get('settings')` 与插件经 `ctx.settings` 读的是同一 SettingsStore（config 单一数据源）。

---

## 7. 坑与速记

1. `apply(ctx, config)` 的 config **已校验+补默认**，只含 schema 声明过的 key；别指望有外来 key。
2. 校验失败抛 `ConfigError`，插件进 FAILED 并往外抛。别在 apply 里吞——让内核响亮报错。
3. array/object 不进 settings 面板（只长标量控件）；string 在 settings 里叫 text。
4. number 在**装配校验**时越界是抛错（FAILED）；在**运行时面板 set** 时越界是夹取（不抛）——两套语义别混。
5. 订阅尽量带 scope = 本插件名，避免误触；config 改动想"实时就地更新"就在 apply 里 onChange。
6. 同 key 重复声明/define 抛错（`already defined` / `already registered`）；热卸某插件会清掉它声明的项（防残留与重装撞 key）。
7. 想给 apply 的 config 写类型，用 `InferConfig<typeof Config>`。
