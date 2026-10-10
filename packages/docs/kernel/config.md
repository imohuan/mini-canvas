# 配置装配：模块级 `Config` / `configSchema` / `ctx.settings`

**一句话定位**：**插件在模块里导出 `Config` 声明「我有哪些可调项」，装配处给一份值，内核校验 + 补默认后交给 `apply(ctx, config)` —— 作者永远拿到一份完整、合法的配置。**

**它属于哪一档**：**内核自带（框架层）**。源码：`packages/kernel/src/configSchema.ts`（schema / `resolveConfig` / `F` / `ConfigError`）、`packages/kernel/src/settingsStore.ts`（分组配置单一数据源）、`packages/kernel/src/Context.ts`（`tryActivate` 里调 `resolveConfig` 与能力层的 `declareConfig`）。画布侧把标量字段登记进设置面板的实现见 `packages/canvas-data/src/canvas/capabilityLayer.ts`。

## 它是什么

把配置想成**点菜**：

- 插件写一张**菜单**（`Config` schema）：这道菜叫什么、是什么类型、默认怎么做、可选哪几种。
- 装配处**点菜**（`ctx.plugin(mod, config)` 或清单里的 `config`）：想改哪道就改哪道，不想改的照菜单默认来。
- 内核当**厨房把关**：点的菜菜单上没有 → 直接报错（响亮）；没点的 → 按默认做好。
- 上桌（`apply(ctx, config)` 的第二个参数）永远是**一份完整合法的配置**，作者不用写 `config?.x ?? 默认值`。

它管的是四类里的**配置**那一类：不改画布数据、不做 UI，只管「有什么可调的、现在调成了什么」。

## 为什么需要它

没有这套东西，配置会这样长：

1. **默认值抄在不同地方**：schema 里一份、`apply` 里的 `??` 一份、设置面板里再一份 —— 三份必然漂移。
2. **非法值一路带到深处才炸**：用户把线宽填成 `9999`，等到画线时才崩，报错还看不出哪来的。
3. **设置面板长不出来**：面板不知道有哪些配置项、该用什么控件、该显示什么中文名，只能每个插件手写一份设置页。

有了 `Config`：**声明一次**，校验、补默认、登记进设置面板（标量字段）三件事全自动。

## 怎么用

### 一、推荐写法：模块级导出 `Config`

```ts
// 插件模块级（就是插件入口那个 .ts）
export const Config = { … } satisfies ConfigSchema
```

内核激活插件时的完整链路（`Context.tryActivate`）：

```
① 装配处给的 raw config
        ↓  resolveConfig(mod.Config, raw)
② 逐字段校验 + 从 schema.default 补默认（只保留 schema 声明过的 key）
        ↓  填 fiber.config
③ apply(ctx, config)   ← 你拿到的永远是完整的
        ↓  同时（能力层 declareConfig）
④ 标量字段登记进 settings 单一数据源（分组 / label / 范围一起带过去）
```

**校验失败会怎样**：抛 `ConfigError`（消息形如 `[config] invalid config: "lineWidth" = 99 exceeds max 6`）；
该插件的 fiber 置 **`failed`**（保留供诊断，可重装同名），错误继续往上抛 —— `start()` / `installPlugin()` 会 reject / throw。

```ts
// 文件：my-plugin/src/index.ts
import { F, type ConfigSchema, type InferConfig, type Context } from '@mini-canvas/canvas-base'

export const name = 'my-plugin'

// ① 声明可调项。key 建议带插件前缀（settings 的 key 是全局一张表，见下文「常见坑」）
export const Config = {
  glowEnabled: F.boolean(true),                     // 简写：默认 true
  glowColor: F.color('#3b82f6'),                    // 颜色
  glowStyle: F.select('soft', [                     // 下拉：纯字符串或 { value, label } 都行
    { value: 'soft', label: '柔光' },
    { value: 'hard', label: '硬边' },
  ]),
  glowWidth: {                                      // 需要 min/max/label 就直接写字段字面量
    type: 'number',
    default: 2,
    min: 1,
    max: 6,
    step: 0.5,
    label: '辉光宽度',
    group: '我的插件/外观',
    description: '边框辉光的粗细微调。',
  },
} satisfies ConfigSchema

/** apply 收到的 config 的 TS 类型（与 schema 对齐） */
export type MyPluginConfig = InferConfig<typeof Config>

// ② config 已经被校验 + 补默认；不传时就是「全部默认值」
export function apply(ctx: Context, config: MyPluginConfig = {} as MyPluginConfig): void {
  console.log(config.glowWidth)   // number，一定合法
}
```

> `satisfies ConfigSchema` 这一步是「既检查 shape 又保留字面量类型」；写 `as ConfigSchema` 会丢掉 `InferConfig` 要的推导信息。

### 二、`F`：字段的便捷构造

```ts
F.string(def = '')                              // { type: 'string', default: def }
F.color(def = '#000000')                        // { type: 'color', default: def }
F.number(def = 0)                               // { type: 'number', default: def }
F.boolean(def = false)                          // { type: 'boolean', default: def }
F.select(def = '', options = [])                // { type: 'select', default: def, options }
F.array(def = [], item?)                        // 数组；给 item 就逐元素校验
F.object(def = {}, fields?)                     // 嵌套对象；给 fields 就逐键递归
```

**`F` 是「字段助手」，不是链式 DSL**：`F.number(2)` 返回的是普通字段对象，**没有** `.min()` / `.max()` 方法。
需要 `min` / `max` / `label` / `step` 就直接写字段字面量。

### 三、`ConfigField` 全字段表

签名逐字来自 `packages/kernel/src/configSchema.ts`：

```ts
interface ConfigField {
  type: ConfigFieldType          // 必填
  default: ConfigValue           // 必填
  label?: string
  description?: string
  group?: string
  min?: number
  max?: number
  step?: number
  options?: ConfigSelectOption[]
  item?: ConfigField
  fields?: ConfigSchema
  optional?: boolean
}
```

| 字段 | 什么时候用 | 语义（源码为准） |
| --- | --- | --- |
| `type` | 永远 | `'string' \| 'color' \| 'number' \| 'boolean' \| 'select' \| 'array' \| 'object'` |
| `default` | 永远 | 装配没给值时补它；标量还作设置面板的初值 |
| `label` | 标量 | 控件上显示的中文名 |
| `description` | 标量 | 控件下方的小字说明 |
| `group` | 标量 | 设置面板的分组名；**缺省 = 插件名** |
| `min` / `max` | number | **装配校验时越界 = 报错（fiber FAILED）**；运行时面板 `set` 才是夹取 |
| `step` | number | 滑块步长。**小数比例字段必须显式给**（如 `0.05`），否则滑块会卡死 |
| `options` | select | 候选值，允许多种写法：`['a','b']` 或 `[{ value:'a', label:'甲' }]` 混写 |
| `item` | array | 元素的子 schema；给了就**逐元素递归校验 / 补默认**（错误键名带下标：`targets[1]`） |
| `fields` | object | 子对象的递归 schema；给了就**逐键校验、补默认、丢未知 key**（错误键名带路径：`layout.gap`） |
| `optional` | **只对 color 有意义** | `true` 时空串 `''` 是合法值（= 没有自定义色，消费方回落主题色）；缺省 `false` = 必须有颜色 |

### 四、七种类型各自的校验规则

`resolveConfig(schema, raw)` 的行为：

- **没有 schema** → 原样返回 `raw`（不校验、不补默认；所以 `Config` 是可选的）。
- **有 schema** → 逐字段校验 + 补默认，**只保留 schema 声明过的 key**（外来 key 静静丢掉）。

| `type` | 校验 | 失败消息示例 |
| --- | --- | --- |
| `string` | 必须是字符串 | `"title" expected string but got 42` |
| `color` | 必须匹配 `#rgb` / `#rrggbb` / `#rrggbbaa`；`optional: true` 时另放行空串 | `"glowColor" expected hex color but got "red"` |
| `number` | 必须是**有限数**；给了 `min` / `max` 时不得越界 | `"glowWidth" = 99 exceeds max 6` |
| `boolean` | 必须是布尔 | `"glowEnabled" expected boolean but got "yes"` |
| `select` | 必须是 `options` 里的某一个值 | `"glowStyle" expected one of soft, hard but got "x"` |
| `array` | 必须是数组；有 `item` 就逐元素递归（无 `item` 只查「是数组」） | `"targets" expected an array but got "a"` |
| `object` | 必须是普通对象（不能是数组 / `null`）；有 `fields` 就逐键递归 | `"layout" expected an object but got 1` |

失败时抛 `ConfigError`，`name` 就是 `'ConfigError'`，`message` 前面统一带 `[config] invalid config: ` 前缀。

### 五、标量字段自动进 settings 单一数据源

插件激活时，内核把 `Config` 里的**标量字段**（`string` / `color` / `number` / `boolean` / `select`）
登记进 `SettingsStore`（`scope` = 插件名）。映射细节（`packages/canvas-data/src/canvas/capabilityLayer.ts` 的 `toSettingSchema`）：

- `type: 'string'` → settings 侧的 `'text'`（控件类型叫 text）；
- 分组名取字段的 `group`，没写就用**插件名**；
- `min` / `max` / `step` / `options` / `label` / `description` / `optional` 原样带过去；
- **同一个 key 已被别的插件声明过 → 不覆盖**（先到者保留所有权），dev 下给一条 `console.warn`；
- 插件卸载时随 fiber 清（`settings.removeByScope(插件名)`），所以**热卸再重装不会撞 key**。

**`array` / `object` 不登记进 settings** —— 它们是「给 `apply` 的结构化配置」，设置面板只长标量控件。

同一个 key 的**初值优先级**（很重要，踩过坑）：**用户已保存值 > 装配 config > schema 默认**。
理由：插件可能是运行期热装的（比如云端清单装进来的插件），刷新时持久化桥先恢复了用户改过的值，
如果这时无条件用 schema 默认再 `set` 一次，用户就会遇到「改了配置、刷新就回退」。源码注释在 `capabilityLayer.declareConfig` 里。

想读 / 改 / 订阅这份单一数据源，用 `ctx.settings` 能力段：

```ts
ctx.settings.get(key)                             // 读当前值（未声明的 key 返回 undefined）
ctx.settings.set(key, value)                      // 写：未知 key 抛错、number 越界静默夹取
ctx.settings.groups()                             // 已声明的组名
ctx.settings.onChange(插件名, (key, value) => {})  // 订阅「只属于我这个插件」的配置变化
```

> `ctx.settings.onChange` 的 **`scope` 参数是必填的**（底层 `store.onChange(cb, { scope })` 的 scope 才是可选）。
> 传本插件名 = 只听自己的；要全局订阅就用 `ctx.get('settings').onChange(cb)`。
> `SettingsStore` 的完整方法表、面板怎么消费它，见 [`settings` 服务](/services/settings)。

### 六、在插件里「就地面向 config 变化做窄更新」

`apply` 拿到的 config 是**激活那一刻**的快照。用户后来在设置面板改值，要通过订阅拿到：

```ts
// 文件：my-plugin/src/index.ts 里的一小段
export function apply(ctx: Context, config: MyPluginConfig): void {
  const style = ref(config.glowStyle)   // 当前值

  // 订阅自己这份配置的变化；scope 传本插件名，别的插件改自己的不会误触这里
  ctx.settings.onChange(name, (key, value) => {
    if (key === 'glowStyle') style.value = String(value)   // 就地改，实时生效，不重建画布
  })
}
```

真实例子：`packages/plugins/plugin-theme-default/src/index.ts` 导出几十项外观参数，
`packages/plugins/plugin-align-guide/src/alignGuidePlugin.ts` 用 `ctx.tryGet('settings')` + `onChange` 把颜色实时写进 CSS 变量。

## 会在哪里用到

| 文件 | 它在干什么 |
| --- | --- |
| `packages/kernel/src/configSchema.ts` | `ConfigField` / `ConfigSchema` / `F` / `resolveConfig` / `ConfigError` / `InferConfig` |
| `packages/kernel/src/settingsStore.ts` | `SettingsStore`：分组配置单一数据源（纯逻辑、零 Vue、Node 可单测） |
| `packages/kernel/src/Context.ts` | `tryActivate`：校验 config → 填 `fiber.config` → 调能力层 `declareConfig` → 传 `apply` |
| `packages/canvas-data/src/canvas/capabilityLayer.ts` | `declareConfig`：标量字段 → settings；返回的清理函数登记进插件 fiber |
| `packages/canvas-data/src/canvas/capabilities.ts` | `ctx.settings` 能力段的实现（define / set / get / onChange / groups） |
| `packages/plugins/plugin-theme-default/src/index.ts` | 真实的大 `Config`：几十项外观参数全靠 schema 登记进设置面板 |
| `packages/ui/src/App.vue` | 成品应用把装配 config（`ui.cfg.*`）逐项喂给宿主 |

## 完整例子

一个能跑的插件包：声明配置 → 内核校验补默认 → `apply` 里用起来，并按分组显示在设置面板里。

### 目录长这样

```
plugin-config-demo/
├── package.json          # 插件清单
└── src/
    ├── index.ts          # 插件入口：导出 name / Config / apply
    └── main.ts           # 装配脚本：故意传一个越界值，看它响亮报错
```

同样的文件在仓库里也放了一份，可直接打开对照：`packages/docs/public/examples/kernel/plugin-config-demo/`。

> 说明：示例能在**纯内核**（`@mini-canvas/kernel` 的 `Context`）里直接跑，所以订阅那段用
> `ctx.tryGet('settings')` 探测 —— `ctx.settings` 那一段是**画布能力层**给的，纯内核里没有。
> 在画布插件里请直接写 `ctx.settings.onChange(插件名, cb)`。

### 文件一：插件入口

```ts
// 文件：packages\docs\public\examples\kernel\plugin-config-demo/src/index.ts
// 格式：TypeScript 模块（插件入口：导出 name / Config / apply）
// 位置：一个可安装插件包的源码入口
import { F, type ConfigSchema, type InferConfig, type Context, type PluginModule } from '@mini-canvas/kernel'

export const name = 'config-demo'

// ① 配置声明：key 带插件前缀 —— settings 的 key 是全局一张表，通用名（size/enabled）会和别人抢号
export const Config = {
  configDemoEnabled: {
    type: 'boolean',
    default: true,
    label: '启用演示',
    group: '配置演示',              // 设置面板里的一级分组
    description: '关掉它，下面的行为全部静默。',
  },
  configDemoWidth: {
    type: 'number',
    default: 4,
    min: 1,
    max: 12,
    step: 1,                        // 数字类给 step，面板滑块才顺滑
    label: '演示宽度',
    group: '配置演示',
    description: '装配时给越界值会直接让插件进 failed（响亮报错）。',
  },
  configDemoMode: F.select('a', [
    { value: 'a', label: '模式 A' },
    { value: 'b', label: '模式 B' },
  ]),
  // ② array / object 不登记进设置面板，但同样会被校验 + 补默认（结构化配置）
  configDemoTargets: F.array([], F.string('')),
  configDemoLayout: F.object({}, { gap: F.number(8) }),
} satisfies ConfigSchema

/** apply 收到的 config 类型 */
export type ConfigDemoConfig = InferConfig<typeof Config>

/** settings 段的窄接口（演示用：不依赖画布包也能写出类型） */
type SettingsLike = {
  get(key: string): unknown
  onChange(cb: (key: string, value: unknown) => void, opts?: { scope?: string }): { dispose(): void }
}

export function apply(ctx: Context, config: ConfigDemoConfig): void {
  // ③ config 一定完整：没传的字段已补默认、类型已经校验过
  console.log('[config-demo] 生效配置：', config)

  // ④ 订阅自己这份配置的变化。
  //    注意：ctx.settings 是「画布能力层」提供的段 —— 画布插件里直接写
  //    ctx.settings.onChange(name, cb) 就行；这里用 tryGet 探测，
  //    让同一份代码在「纯内核」里也能跑（纯内核没有 settings 段）。
  const settings = ctx.tryGet<SettingsLike>('settings')
  settings?.onChange((key, value) => {
    console.log('[config-demo] 配置变了：', key, '→', value)
  }, { scope: name })

  ctx.on('ctx:ready', () => {
    // ⑤ 从单一数据源读「现在的值」（和 config 快照不同：这里读的是最新值）
    console.log('[config-demo] settings 里的宽度：', settings?.get('configDemoWidth'))
  })
}

export const configDemoPlugin: PluginModule = { name, Config, apply }
```

### 文件二：装配脚本（先正常、再故意传错）

```ts
// 文件：packages\docs\public\examples\kernel\plugin-config-demo/src/main.ts
// 格式：TypeScript 模块（装配脚本，`npx tsx src/main.ts` 即可跑）
// 位置：演示「只给一部分 config，其余补默认」与「越界响亮报错」
import { Context } from '@mini-canvas/kernel'
import { configDemoPlugin } from './index'

// ① 正常装配：只给一项，其余全走默认
const ctx = new Context({ dev: true })
ctx.plugin(configDemoPlugin, { configDemoWidth: 6 })
await ctx.start()
ctx.stop()

// ② 故意越界：fiber 进 failed，错误从 start() 抛出来
const bad = new Context()
bad.plugin(configDemoPlugin, { configDemoWidth: 999 })
try {
  await bad.start()
} catch (err) {
  console.log('[main] 响亮报错：', (err as Error).message)
  // → [config] invalid config: "configDemoWidth" = 999 exceeds max 12
}
console.log('[main] 该插件状态：', bad.inspectPlugins()[0]?.state)   // 'failed'
```

实测输出：

```
[config-demo] 生效配置： {
  configDemoEnabled: true,
  configDemoWidth: 6,
  configDemoMode: 'a',
  configDemoTargets: [],
  configDemoLayout: { gap: 8 }
}
[main] 响亮报错： [config] invalid config: "configDemoWidth" = 999 exceeds max 12
[main] 该插件状态： failed
```

> 注意第一条输出：**只给了 `configDemoWidth: 6`，其余字段全部补好了默认值** —— 这就是「apply 永远拿到完整 config」。

## 常见坑

1. **`Config` 是可选的**：没有 schema 时 `resolveConfig` 原样返回 `raw`（不校验、不补默认、不登记 settings）。
   所以「配置没生效」先确认模块里真的导出了 `Config`。
2. **越界的两种语义不一样**：**装配校验**（`resolveConfig`）越界 = **抛错、fiber FAILED**；
   **运行时 `set`**（面板 / `SettingsStore.set`）越界 = **静默夹取**到 `min` / `max`。排查「值怎么不对」时先分清走的是哪条路。
3. **`array` / `object` 不登记进设置面板**（面板只长标量控件），而且 `object` 会**丢掉未声明的 key**、`array` 无 `item` 时元素原样保留。
   需要「面板可调」就用标量字段。
4. **`optional` 只对 `color` 有意义**，其他类型写了不生效（源码只在这个分支读它）。
5. **settings 的 key 是全局平铺的一张表**，没有命名空间：两个插件都用 `size`，第二个会在 dev 下收到
   `config key "size" from "xxx" collides with an existing declaration; skipping (keep first owner)`
   并被跳过。**给自己的 key 加插件前缀是硬要求**。
6. **`ctx.settings.onChange` 的 `scope` 必填**（与底层 store 的可选 scope 形状不同）。漏了它会把回调当 scope 用，订阅永远收不到东西。
7. **`apply` 里的 `config` 是激活时的快照**，用户改面板不会变它 —— 要拿最新值请用 `ctx.settings.get(key)` 或订阅 `onChange`。
8. **`string` 在 settings 侧叫 `text`**：读 `SettingSchema` / 面板相关代码时注意这个改名（`toSettingSchema` 里转换的）。


