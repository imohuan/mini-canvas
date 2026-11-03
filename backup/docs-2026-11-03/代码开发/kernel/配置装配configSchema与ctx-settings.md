# 配置装配：模块级 `Config`、`configSchema`、`ctx.settings` / `SettingsStore`

> 来源：`packages/kernel/src/configSchema.ts`、`packages/kernel/src/settingsStore.ts`、`packages/kernel/src/Context.ts`（`tryActivate` 里的 `resolveConfig` / `declareConfig`）、
> 能力层实现在 `packages/canvas-data/src/canvas/capabilityLayer.ts` 与 `packages/canvas-data/src/canvas/capabilities.ts`（`ctx.settings` 段）。

插件往往有些"可以被用户调"的项（颜色、开关、下拉、数字范围……）。做法：

1. 插件模块级导出 **`Config` schema** 声明这些项；
2. 装配处给 `ctx.plugin(mod, config)` 传原始值；
3. 内核**校验 + 补默认**后，把完整 config 作为 `apply(ctx, config)` 的第二个参数递给你；
4. 配置里的**标量字段**同时自动登记进 `SettingsStore`（单一数据源），面板可读、可改、可订阅，改动实时生效。

---

## 1. 一个最小完整例子

```ts
import { F } from '@mini-canvas/kernel'
import type { ConfigSchema, InferConfig, PluginScope } from '@mini-canvas/kernel'

export const name = 'theme-a'
export const Config = {
  edgeColor: F.color('#3b82f6'), // 颜色
  edgeType: F.select('bezier', ['bezier', 'straight']), // 下拉
  lineWidth: { type: 'number', default: 2, min: 1, max: 6 }, // 也可以直接写字面对象
  glow: F.boolean(true), // 开关
} satisfies ConfigSchema

export type ThemeAConfig = InferConfig<typeof Config>

export function apply(ctx: PluginScope, config: ThemeAConfig) {
  // config 永远完整：缺的补默认、类型校验过、只含 schema 声明过的 key
  console.log(config)
  // 订阅自己这份配置的变化，就地实时生效
  ctx.settings.onChange('theme-a', (key, value) => {
    console.log(key, value) // 只收“声明方 = theme-a”的变化
  })
}
```

装配方给配置（可以只给一部分，缺的补默认）：

```ts
import { Context } from '@mini-canvas/canvas-data' // 想纯内核就用 '@mini-canvas/kernel'
import * as themeAModule from './theme-a' // 上面那份模块（文件名叫 theme-a.ts）
const ctx = new Context()
ctx.plugin(themeAModule, { edgeType: 'straight' })
// apply 收到：{ edgeColor: '#3b82f6', edgeType: 'straight', lineWidth: 2, glow: true }
await ctx.start()
```

> 上面 `Config` 用到了 `ConfigSchema`（类型）和 `satisfies`，记得 import。

---

## 2. configSchema：怎么声明字段

`ConfigSchema = Record<string, ConfigField>`。一个 `ConfigField`（`packages/kernel/src/configSchema.ts:33`）：

```ts
interface ConfigField {
  type: 'string' | 'color' | 'number' | 'boolean' | 'select' | 'array' | 'object'
  default: ConfigValue
  label?: string // UI 文案（标量控件用）
  description?: string // UI 说明（控件下方小字）
  group?: string // UI 分组名（缺省 = 插件名）
  min?: number; max?: number // number 用（装配越界 → 校验错 FAILED）
  step?: number // number 用：滑块步长（小数比例字段要给，如 0.05）
  options?: ConfigSelectOption[] // select 用
  item?: ConfigField // array 用：元素 schema
  fields?: ConfigSchema // object 用：递归子 schema
}
```

### 便捷构造 `F`

```ts
F.string(def = '') // { type: 'string', default }
F.color(def = '#000000') // { type: 'color', default }
F.number(def = 0) // { type: 'number', default }
F.boolean(def = false) // { type: 'boolean', default }
F.select(def = '', options) // { type: 'select', default, options }
F.array(def = [], item?) // 数组；可给 item schema
F.object(def = {}, fields?) // 嵌套对象；可给 fields 子 schema
```

> **`F` 是"字段助手"，不是链式 DSL**：`F.number(2)` 返回的是**普通字段对象**，没有 `.min()` / `.max()` 方法。
> 需要 `min` / `max` / `label` / `step` 就直接写字段字面量（像上面例子里的 `lineWidth`）。

### 类型推导 `InferConfig`

```ts
import type { InferConfig, ConfigSchema } from '@mini-canvas/kernel'

const Config = {
  targets: F.array([], F.string('')),
  layout: F.object({}, { gap: F.number(8) }),
} satisfies ConfigSchema

type Cfg = InferConfig<typeof Config>
// Cfg = { targets: string[]; layout: { gap: number } }
```

---

## 3. 校验规则（`resolveConfig`）—— 失败就响亮抛错

`resolveConfig(schema, raw)`（`packages/kernel/src/configSchema.ts:140`）：

- 无 schema → 原样返回 `raw`；有 schema → 逐字段校验并补默认，**只保留 schema 声明过的 key**（外来 key 丢弃）。
- **`number`**：必须是有限数；越 `min` / `max` 抛错（`is below min` / `exceeds max`）。
- **`boolean`**：必须是布尔。
- **`color`**：必须匹配 `#rgb` / `#rrggbb` / `#rrggbbaa` 十六进制色。
- **`select`**：值必须在 `options` 枚举里。
- **`string`**：必须是字符串。
- **`array`**：必须是数组；有 `item` 就逐元素递归校验（错误键名带下标，如 `targets[1]`）。
- **`object`**：必须是普通对象（不能是数组 / null）；有 `fields` 就逐键递归补默认 / 丢未知 key（错误键名带路径，如 `layout.gap`）。

失败抛 `ConfigError`，消息形如 `[config] invalid config: "lineWidth" = 99 exceeds max 6`。

```ts
import { resolveConfig, F, ConfigError } from '@mini-canvas/kernel'

const schema = { lineWidth: { type: 'number', default: 2, min: 1, max: 6 } }
resolveConfig(schema, { lineWidth: 3 }) // { lineWidth: 3 }
resolveConfig(schema, {}) // { lineWidth: 2 }（补默认）
resolveConfig(schema, { lineWidth: 99 }) // 抛 ConfigError: exceeds max 6
```

插件激活时，内核（`Context.tryActivate`）替你做这一步：校验失败 → fiber 置 `failed` 并把错误往上抛（`start()` / `installPlugin()` 会 throw），插件被移出可装载表但 fiber 保留供诊断。

**另有三个小工具**同在这个模块里，面板 / 工具链会用到：

- `isScalarField(field)` —— 是不是标量字段（`type` 不在 `array` / `object` 里）；
- `optionValues(options)` / `selectOptionEntry(option)` —— 取 select 可选项的值列表 / 展示项（`options` 允许 `'a'` 或 `{ value, label }` 混写）。

---

## 4. 标量字段会自动进 settings 单一数据源

插件激活时，内核把 `Config` 里的**标量字段**（string / color / number / boolean / select）声明进 `SettingsStore`（`scope` = 插件名），
初值 = 装配校验后的 config 值。**array / object 不进 settings**（它们是"给 apply 的结构化配置"，面板只长标量控件）。

映射细节（`packages/canvas-data/src/canvas/capabilityLayer.ts:18` 的 `toSettingSchema`）：

- `type: 'string'` 收敛成 `'text'`（settings 侧的控件类型叫 text）；
- 分组名取字段的 `group`，没写就用插件名；
- 同一个 key 已被别的插件声明过 → **不覆盖**（先到者保留），dev 下给一条 warn。

随插件 fiber 卸载自动清（`removeByScope`）—— 所以热卸再重装不会撞 key。

---

## 5. `SettingsStore` —— 分组配置单一数据源（可独立用）

`SettingsStore`（`packages/kernel/src/settingsStore.ts:67`）是分组配置的单一数据源。画布内核里的那个实例，宿主和插件读到的是**同一份**。

```ts
import { SettingsStore } from '@mini-canvas/kernel'

const s = new SettingsStore()

// define(group, defs, scope?)：申报一组（scope = 声明方插件名，供按作用域订阅）
s.define('基础', {
  nodeFill: { type: 'color', default: '#fff', label: '底色' },
  corner: { type: 'number', default: 8, min: 0, max: 40, label: '圆角' },
}, 'theme-a')

s.get('nodeFill') // '#fff'（初值 = default）
s.set('corner', 20) // 改值：number 越界夹取；未知 key 抛错；没真变返回 false
s.groups() // ['基础']
s.groupOf('基础') // 该组全部项（SettingEntry[]）
s.has('nodeFill') // true
s.setDefault('k', v) // 装配覆盖默认（未定义项也可预置）
s.removeByScope('theme-a') // 移除某声明方的全部项（热卸/重载随 scope 清）

// 订阅：onChange(cb, { scope? })
const sub = s.onChange((key, value) => console.log(key, value), { scope: 'theme-a' })
sub.dispose() // 退订
```

`SettingSchema` 的 `type` 是 `'color' | 'number' | 'select' | 'boolean' | 'text'`（注意：config 里的 `string` 在 settings 里叫 `text`），
另有 `default` / `label` / `description` / `min` / `max` / `step` / `options`。

旁路接口还有：`onSchemaChange(cb)`（声明增删时通知 UI 刷新分组）、`entries()`（导出当前全部值）、
`setSavedSnapshot` / `getSavedSnapshot` / `clearSavedKeys`（配置持久化桥用）。

### 5.1 `onChange` 按作用域过滤

传 `scope` = 只收"声明方是该 scope 的变化"；不传 = 收全局。插件通常订阅自己的名字，这样别的插件改自己的配置不会误触你。

---

## 6. `ctx.settings`（能力段）—— 读 + 订阅 + 申报

插件 ctx 上的 `ctx.settings` 是对内置 `SettingsStore` 的收口（`packages/canvas-data/src/canvas/capabilities.ts:404`）：

```ts
// 申报一组配置项（两组件：分组式，或 (group, items) 平铺式）
define(items: Record<string, SettingDefineItem>, group?: string): void
define(group: string, items: Record<string, SettingDefineItem>): void
set(key: string, value: string | number | boolean): boolean // 未知 key 抛错；number 越界夹取
get(key: string): string | number | boolean // 读当前值
onChange(scope: string, cb: (key: string, value: unknown) => void): { dispose(): void }
groups(): string[] // 已申报的组名
```

```ts
apply(c) {
  c.settings.onChange('theme-a', (key, value) => { /* 就地更新 */ })
}
// 宿主侧读同一份：
ctx.get('settings').set('edgeColor', '#0af')
ctx.get('settings').get('edgeColor') // '#0af'
```

> **两个重点**：
> 1. `ctx.settings.onChange` 的**第一个参数 `scope` 是必填的**（与 store 的 `onChange(cb, { scope })` 形状不同），传本插件名就只收自己的变化。
> 2. 平时**不用手动 `define`**：插件模块级给了 `Config`，内核就会自动把标量字段声明好。`define` 是给"没有 `Config` schema 也想申报配置项"的场景留的口子。

---

## 7. 坑与速记

1. `apply(ctx, config)` 的 config **已校验 + 补默认**，且只含 schema 声明过的 key；别指望里面有外来 key。
2. 校验失败抛 `ConfigError`，插件进 `failed` 并往外抛。别在 apply 里吞掉——让内核响亮报错。
3. `array` / `object` 不进 settings 面板（面板只长标量控件）；`string` 在 settings 里叫 `text`。
4. number 越界在**装配校验**时是**抛错**（FAILED）；在**运行时面板 set / store.set** 时是**夹取**（不抛）。两套语义别混。
5. 想给 apply 的 config 写类型，用 `InferConfig<typeof Config>`（`F.number(...)` 之类返回普通对象，不能链式调用）。
6. **settings 的 key 是全局平面的**：跨插件同名会被先声明者占位（后者只在 dev 下 warn）。所以 key 建议带插件前缀，别用裸 `enabled`。
7. 同 key 重复 `define` 会抛 `setting "xxx" is already defined`；热卸某插件会清掉它声明的项（防残留与重装撞 key）。
