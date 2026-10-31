# `settings` · 配置

**一句话定位**：**`settings` 是全画布唯一的"配置本子" —— 所有插件的可调项都登记在这一个地方，改一项只通知关心它的那一家。**

**它属于哪一档**：**内核内置服务，由画布能力层提供**（`SlotRegistry` 与它同一档，见 `packages/canvas-data/src/canvas/capabilityLayer.ts`）。类本身住在 `packages/kernel/src/settingsStore.ts`，是纯逻辑、零 Vue 的 `SettingsStore`；能力层在 `new Context()` 时建好它并登记为内置服务。

## 用法

### 声明：**推荐用模块级 `Config` schema**（不是手写 `define`）

现在的推荐写法是：插件在模块里导出 `Config`，内核激活它时把 schema 里的**标量字段**自动登记进 settings（分组、默认值、范围、label 一起带过去）。作者不写一行 `define`，配置项就出现在设置面板里了。

```ts
// 文件：my-plugin/src/index.ts 里的一小段
import { F, type ConfigSchema, type InferConfig } from '@mini-canvas/canvas-base'

export const Config = {
  glowEnabled: F.boolean(true),               // 简写：默认值 true
  glowColor: {
    type: 'color',
    default: '#3b82f6',
    label: '辉光颜色',
    group: '我的插件/外观',                    // 分组 = 设置面板里的层级
    description: '边框辉光的颜色。',
  },
  glowWidth: {
    type: 'number', default: 2, min: 1, max: 6, step: 0.5,
    label: '辉光宽度', group: '我的插件/外观',
  },
} satisfies ConfigSchema

export type MyConfig = InferConfig<typeof Config>

export function apply(ctx: Context, config?: MyConfig) {
  // config 是内核校验 + 补默认之后给你的完整对象
  void config
}
```

字段类型有五种（`string` / `color` / `number` / `boolean` / `select`），这五种会登记进 settings 长控件；`array` / `object` 是"给 apply 的结构化配置"，**不**登记进设置面板（面板只长标量控件）。

`ConfigField` 上可写的属性（`packages/kernel/src/configSchema.ts`）：`type`、`default`、`label`、`description`、`group`、`min`、`max`、`step`、`options`、`item`、`fields`、`optional`。

### 声明：手动 `define`（给不导出 Config 的场景）

```ts
// ctx.settings 的语法糖形状（能力段）
ctx.settings.define({                          // ① 平铺式：不写分组，组名自动用本插件名
  myPluginEnabled: { type: 'boolean', default: true, label: '启用我的插件' },
})

ctx.settings.define('我的插件/外观', {            // ② 分组式：group + items
  glowWidth: { type: 'number', default: 2, min: 1, max: 6, step: 0.5, label: '辉光宽度' },
})
```

两条硬规矩：

- **同一个 key 全局只能声明一次**。走 `ctx.settings.define` 时重复声明直接抛 `[settings] setting "xxx" is already defined`；走插件 `Config` schema 时（内核批量登记那条路）后一个会被跳过（开发态另有 `console.warn` 提示），保留第一个声明者。
- key 是**全局平铺命名**、没有命名空间。所以给自己的 key 加前缀（比如 `web2apiMcpEndpoint`、`imageGenBaseUrl`）是硬要求 —— 不然两个插件都想叫 `size`，必有一个声明不进去。

### 读写与订阅：两种入口

| 你可以用 | 形状（来自源码） | 说明 |
| --- | --- | --- |
| `ctx.settings` | 语法糖：`define` / `set` / `get` / `onChange(scope, cb)` / `groups` | `onChange` **必须**先给 scope（字符串 = 插件名） |
| `ctx.get('settings')` | 原始 `SettingsStore` 实例，方法见下表 | 面板、持久化桥、宿主用这个 |

```ts
const store = ctx.get<SettingsStore>('settings')

store.set('glowWidth', 4)        // → true（值真的变了）；越界会被夹进 min/max
store.get('glowWidth')           // → 4
store.groups()                   // → ['我的插件/外观', ...]  所有已申报的分组名
store.groupOf('我的插件/外观')     // → [{ group, key, schema, value }, ...]
store.has('glowWidth')           // → true
```

### `SettingsStore` 完整方法表

签名逐字来自 `packages/kernel/src/settingsStore.ts`：

| 方法 | 签名 | 干什么 |
| --- | --- | --- |
| `define` | `define(group: string, defs: Record<string, SettingSchema>, scope?: string): void` | 申报一组配置项；同 key 重复申报抛错。`scope` = 申报方插件名（供按作用域订阅） |
| `setDefault` | `setDefault(key: string, value: string \| number \| boolean): void` | 装配时覆盖某个默认值（manifest 在插件 apply 前调）；未声明的 key 可预置 |
| `set` | `set(key: string, value: string \| number \| boolean): boolean` | 改一个**已声明**项；未知 key 抛错、数字越界静默夹取。返回"是否真的变了" |
| `get` | `get(key: string): string \| number \| boolean` | 读当前值；**未声明时返回 `undefined`**（类型上没体现，要自己判） |
| `groupOf` | `groupOf(group: string): SettingEntry[]` | 某组全部项（UI 面板按组列控件） |
| `groups` | `groups(): string[]` | 已申报的所有组名 |
| `has` | `has(key: string): boolean` | 是否已声明某 key |
| `removeByScope` | `removeByScope(scope: string \| undefined): void` | 移除某插件名下的全部配置项（热卸/重载清场，防重装撞 key） |
| `onChange` | `onChange(cb: (key: string, value: unknown) => void, opts?: { scope?: string }): Disposable` | 订阅变化；给 `opts.scope` = 只听自己声明的；不给 = 全局订阅 |
| `onSchemaChange` | `onSchemaChange(cb: () => void): Disposable` | 订阅"声明表变了"（插件热装热卸后刷新设置面板） |
| `setSavedSnapshot` | `setSavedSnapshot(saved: Record<string, string \| number \| boolean>): void` | 注入"用户已保存值"；之后 `define` 命中快照的 key 以快照值为初值 |
| `getSavedSnapshot` | `getSavedSnapshot(): Record<string, string \| number \| boolean> \| null` | 导出当前保存快照（`null` = 从没注入过） |
| `clearSavedKeys` | `clearSavedKeys(keys: string[]): void` | 清除某些 key 的保存值（"恢复默认"用） |
| `entries` | `entries(): Record<string, string \| number \| boolean>` | 当前全部已声明项的值（持久化桥导出用） |

### `SettingSchema`（手动 define 时写的形状）

```ts
interface SettingSchema {
  type: 'color' | 'number' | 'select' | 'boolean' | 'text'
  default: string | number | boolean
  optional?: boolean                                   // color 用：允许留空 = 回落主题色
  label?: string                                       // UI 显示文案
  description?: string                                 // 控件下方小字
  min?: number
  max?: number                                         // number 用：越界夹取
  step?: number                                        // number 用：滑块步长（小数比例要显式给，如 0.05）
  options?: Array<{ value: string; label?: string }>   // select 用
}
```

## 注意事项

1. **`ctx.settings.get()` 对没声明过的 key 返回 `undefined`，但类型签名上写的是 `string | number | boolean`**。这是 `SettingsStore.get` 里显式写的 `undefined as unknown as string` —— 于是"读到 undefined"在编译期不会报错，运行期才暴露。所以要么先 `has(key)` 判一下，要么给读到的值做一次 `?? 回退`。
2. **重复声明同一个 key 会抛错**，而且 key 没有命名空间。两个插件都用 `size` 这个名字，第二个会在开发态收到 `[settings] config key "size" ... collides ...` 警告并被跳过（保留第一个声明者）。所以给自己的 key 加插件前缀（`demoHaloSize` 而不是 `size`），是实践里的硬要求而不是风格建议。
3. **`set` 对未声明的 key 抛错**，不是静默忽略：`[settings] setting "xxx" is not defined. Define it first via settings.define.`。热卸载之后再 `set` 旧 key 就会踩这条（`removeByScope` 已经把声明清掉了）。改值之前用 `has` 确认，或者把 `set` 包进 `try` 里。
4. **数字越界是"静默夹取"，不是报错**。`set('demoHaloSize', 99999)` 不会抛，实际存进去的是 `max`（640）。所以回读 `get` 拿到的值可能与你写入的不同 —— 想确认到底存了多少，看 `set` 的返回值（它只告诉你"变没变"，值还得再 `get`）。
5. **`ctx.settings.onChange` 的 scope 参数是必填的（语法糖）**，而底层 `store.onChange(cb, { scope })` 的 scope 是可选。写 `ctx.settings.onChange(cb)` 会把它当成 scope 用一个函数值，结果订阅永远收不到东西。插件里照抄例子里的 `ctx.settings.onChange(name, cb)` 即可；要"全局订阅"就用 `ctx.get('settings').onChange(cb)`。
6. **配置是内存里的（本页只管读写真值）**。刷新后要不要还在，归持久化桥 `save.settings` 管 —— 它把值的快照写进 `save(config)`，启动时用 `setSavedSnapshot` 注入回来。所以"改了没保存"和"没生效"是两回事，排查时先看桥在不在（`ctx.get('save').settings`）。
