# 案例 4 · 配置与设置面板（Config 式）

想让用户能调你的插件（改尺寸、改开关、改颜色）？在插件里导出一个 `Config` schema
（模块级常量），内核会：校验配置 → 把每项登记进 ⚙ 设置面板 → 改动实时推给你。
你只要写"每个字段是什么类型、默认多少、归哪个分组"，面板控件全自动长出来。

## 这个案例能做到什么

装上后你会看到：⚙ 设置面板多出"示例时钟"分组，里面一个数字框"指针大小（px）"和
一个"启用"开关；数字框拖到 40 时画布右下角示例时钟的字号**立刻**变成 40px，不用刷新、
不用重装插件。改完的值随 save.settings 自动保存，刷新页面还在。

## 完整代码

目录就这几个文件：

    my-clock/
    ├── package.json            # 插件清单
    └── src/
        ├── index.ts            # 插件入口：Config schema + overlay 组件注册
        ├── clockConfig.ts      # 配置定义 + 从 settings 读当前值（照抄 mini-map 的分层）
        └── ClockOverlay.vue    # 读配置的浮层组件

```json
// 文件：my-clock/package.json
{
  "name": "my-clock",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "miniCanvas": {
    "title": "示例时钟",
    "description": "画布角落的时钟，字号和开关可在设置面板调",
    "pluginName": "my-clock",
    "installable": true
  },
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": { "types": "./src/index.ts", "default": "./src/index.ts" },
    "./*": "./src/*"
  },
  "scripts": { "typecheck": "tsc --noEmit" },
  "dependencies": { "@mini-canvas/canvas-base": "workspace:*" },
  "peerDependencies": {
    "@mini-canvas/canvas-render": "workspace:*",
    "vue": "^3.5.34"
  },
  "devDependencies": {
    "typescript": "~6.0.2",
    "vue": "^3.5.34"
  }
}
```

```ts
// 文件：my-clock/src/clockConfig.ts
// 配置定义单独一个文件：避免 index.ts ↔ ClockOverlay.vue 循环 import（mini-map 同款做法）
import type { ConfigSchema, InferConfig } from '@mini-canvas/canvas-base'
import type { Context } from '@mini-canvas/canvas-base'

// ① Config schema：每个字段 = 设置面板的一个控件。
//    键名加 myClock 前缀 —— 内核 settings 是全局同一张表，通用名会跟别的插件抢键
export const Config = {
  myClockEnabled: {
    type: 'boolean', default: true,
    label: '启用', description: '关掉就完全不显示时钟。',
    group: '示例时钟',               // 分组名 = 设置面板里的一级页
  },
  myClockSize: {
    type: 'number', default: 28, min: 12, max: 72, step: 1,
    label: '指针大小（px）',
    description: '时钟数字的字号。拖动滑块立刻生效。',
    group: '示例时钟',
  },
} satisfies ConfigSchema

// ② 从 schema 推出 TS 类型：Config 里写啥类型，这里就是啥类型
export type MyClockConfig = InferConfig<typeof Config>

// ③ 从 settings 读当前值：没登记/没改过回落 schema 默认。
//    （内核激活时已把 Config 各字段的初值登记进 settings store，这里读到的就是"用户现在设的"）
export function myClockConfigFrom(ctx: Context): MyClockConfig {
  const settings = ctx.tryGet('settings')
  const read = <T extends string | number | boolean>(key: string, fallback: T): T => {
    if (!settings) return fallback
    const v = settings.get(key)
    return (v === undefined || v === null ? fallback : v) as T
  }
  return {
    myClockEnabled: read('myClockEnabled', true),
    myClockSize: read('myClockSize', 28),
  }
}
```

```ts
// 文件：my-clock/src/index.ts
// 插件入口：Config 导出 + overlay 组件注册。组件自己订阅配置变化
import { markRaw } from 'vue'
import type { Context, PluginModule } from '@mini-canvas/canvas-base'
import { Config } from './clockConfig'
import ClockOverlay from './ClockOverlay.vue'

export const name = 'my-clock'
export const inject = [] as string[]

// ④ 把 Config 随插件一起导出：内核激活时校验 + 登记进设置面板（本篇的主题）
export { Config }

export function apply(ctx: Context): void {
  // ⑤ 时钟本身是一层 overlay（浮层）。写法与案例 2 完全一样，这里不再展开
  ctx.slots.register('overlay', {
    id: 'my-clock',
    order: 95,
    component: markRaw(ClockOverlay),
    meta: { title: '示例时钟' },
  })
}

export const clockPlugin: PluginModule = { name, inject, Config, apply }
```

```vue
<!-- 文件：my-clock/src/ClockOverlay.vue -->
<!-- 读配置的浮层：订阅 settings.onChange，配置一改立刻重读 —— 这就是"实时生效"的全部秘密 -->
<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { useCanvasRender } from '@mini-canvas/canvas-render'
import { myClockConfigFrom } from './clockConfig'

const { ctx } = useCanvasRender()

// ⑥ 初始读一次配置
const cfg = ref(myClockConfigFrom(ctx))

// ⑦ 订阅配置变化：面板改一项 → 内核 onChange 通知 → 重新读整套配置 → ref 变 → 视图更新
const settings = ctx.tryGet('settings')
const off = settings?.onChange((key) => {
  if (key.startsWith('myClock')) cfg.value = myClockConfigFrom(ctx)
})
onBeforeUnmount(() => off?.dispose())   // 组件级监听要自己清；插件级注册才由 ctx.effect 接管

// ⑧ 配置驱动 UI：开关关 = 整个浮层隐藏；size 直接当字号
const now = ref(new Date())
setInterval(() => { now.value = new Date() }, 1000) // 每秒刷新一次（简化示例，卸载靠组件销毁）

const timeText = computed(() => now.value.toLocaleTimeString())
const style = computed(() => ({
  display: cfg.value.myClockEnabled ? undefined : 'none',
  fontSize: cfg.value.myClockSize + 'px',
}))
</script>

<template>
  <div class="my-clock" :style="style">{{ timeText }}</div>
</template>

<style scoped>
.my-clock { position: absolute; right: 16px; bottom: 16px; padding: 4px 10px;
  border-radius: 8px; background: rgb(255 255 255 / 0.85); font-family: monospace; }
</style>
```

## 每一步在干什么

**① 模块级 `Config` schema。** 每个字段就是一个面板控件：`type` 决定控件长什么样
（boolean=开关、number=滑块+数字框、select=下拉、color=取色器、string=文本框），
`min/max/step` 是约束，`label`/`description` 是界面文案，`group` 决定落在哪个面板页。
键名必须带插件前缀（`myClockSize`）：内核 settings 是全局同一张表、先声明者独占，
两个插件都定义 `size` 就会撞键（先装的赢，后装的声明被忽略）。

**② `InferConfig<typeof Config>`。** 从 schema 推 TS 类型：`type: 'number'` 推成 `number`，
`type: 'boolean'` 推成 `boolean`。运行时读配置（步骤 ③）和消费端拿配置都靠这个类型，
不用手写一份接口再对着改。

**③ `myClockConfigFrom(ctx)` 运行时读当前值。** 读不到（settings 服务不在 / 该键还没登记）
回落 schema 默认。单独拆一个文件，是为了插件入口和 overlay 组件都能 import 它而不互相循环
引用 —— mini-map 的 `miniMapConfig.ts` 就是这么拆的（顶部注释写明了这个动机）。

**④ `export { Config }`。** 内核激活插件时读模块级 Config：装配给的 config 先过校验
（类型不对 / number 越界 → 插件 FAILED 响亮报错），再把各字段初值登记进 settings store，
设置面板按 `group` 自动长出控件。不导出 = 这个插件没有面板项，配置只能装配时给。

**⑤ overlay 注册（浮层本体）。** 配置面板只管"改"，改完谁消费谁自己订阅。本例是浮层消费
（时钟字号）；如果消费方是节点类型（改"文本节点默认尺寸"），不用自己写订阅 —— 内核提供了
`bindTypeDefaultSize` 辅助函数（见真实出处表 node-text 那行），内部就是 onChange → 更新类型默认尺寸。

**⑥ 初读 + onChange 订阅。** "实时生效"不是内核去改你的 DOM —— 是你的组件订阅
`settings.onChange`，收到通知后重读整套配置、更新自己的响应式状态。mini-map 的浮层组件就是
这么写的：`cfg = ref(miniMapConfigFrom(ctx))`，onChange 里 `cfg.value = miniMapConfigFrom(ctx)`。
组件级订阅用 `onBeforeUnmount` 手动清（组件销毁时调）；插件级注册才由 `ctx.effect` 自动回收。

**⑦ 配置直接驱动样式。** `display`/`fontSize` 都是 computed 读 `cfg`。配置值永远从
settings store 读，不要复制一份存别处 —— 存了第二份，迟早和面板对不上。

**另一种消费形态：`bindTypeDefaultSize`（node-text 同款）。** 如果你的配置是"某类节点的
默认尺寸"，不用自己写订阅 —— 内核提供了 `bindTypeDefaultSize(ctx, type, defaults, keys)`：
传入节点类型、兜底尺寸和两个 settings 键名，它内部订阅 onChange、把新值写进节点类型表，
没被手动调过尺寸的节点立刻跟着变。node-text 插件就用了它（见真实出处表），整套"实时生效"
只有一行。

**要点只有一个：配置的唯一来源是 settings store。** 任何副本（`cfg` ref、组件内的 reactive）
都只是为了渲染而存在，改值只改 settings、读值只读 store/重读函数 —— 存了第二份可写的副本，
迟早和面板对不上。

**ConfigField 字段速查**（全部见 `packages/kernel/src/configSchema.ts:24`）：

| 字段 | 适用类型 | 作用 |
| --- | --- | --- |
| `type` | 全部 | 控件类型：string/color/number/boolean/select（+ array/object 结构化配置，不进面板） |
| `default` | 全部 | 默认值；装配没给就用它，也是面板初值 |
| `label` / `description` | 全部 | 面板文案；description 渲染成控件下方小字 |
| `group` | 全部 | 分组路径（`常规/小地图` = 一级"常规"下的二级页签） |
| `min` / `max` / `step` | number | 装配越界校验 FAILED；面板 set 时静默夹取；step 是滑块步长 |
| `options` | select | 可选枚举（纯字符串或 `{ value, label }`）；装配值不在枚举 → FAILED |
| `optional` | color | 允许留空（空串 = 回落主题色） |
| `item` / `fields` | array/object | 递归子 schema（结构化配置用，面板不渲染） |

## 仓库里的真实出处

| 真实文件 | 对应示例 | 行为 |
| --- | --- | --- |
| `packages/plugins/plugin-mini-map/src/miniMapConfig.ts:12` | 步骤 ①②③ | 5 个配置项（宽/高/灵敏度/显隐）`satisfies ConfigSchema`，`group: '常规/小地图'` 分到"常规"下的二级页；`miniMapConfigFrom(ctx)` 读当前值 |
| `packages/plugins/plugin-mini-map/src/miniMapPlugin.ts:36` | 消费端 | `const initial = miniMapConfigFrom(ctx)` —— 插件启动时读配置决定初始状态 |
| `packages/plugins/plugin-mini-map/src/MiniMapOverlay.vue:42` | 消费端 | 组件里 `cfg = ref(miniMapConfigFrom(ctx))` + `settings.onChange(...)` 重读 —— 面板改动实时到达浮层 |
| `packages/plugins/plugin-node-text/src/nodeTextPlugin.ts:27` | Config 另一种用法 | `textDefaultWidth/Height` 两项注册到"布局/文本节点尺寸"分组 |
| `packages/plugins/plugin-node-text/src/nodeTextPlugin.ts:186` | `bindTypeDefaultSize` | `bindTypeDefaultSize(ctx, 'text', { w: 300, h: 200 }, { widthKey: 'textDefaultWidth', heightKey: 'textDefaultHeight' })` —— 配置一改，内核把新默认尺寸写进节点类型表，没手动调过尺寸的文本节点立刻跟着变 |
| `packages/canvas-base/src/bindTypeDefaultSize.ts:35` | 内核辅助函数 | 内部就是 `settings.onChange` → `doc.updateTypeSize`：改配置 → 更新类型默认尺寸，全是现成 API |
| `packages/kernel/src/configSchema.ts:65` | ConfigSchema 定义 | `Record<string, ConfigField>`；字段支持 string/color/number/boolean/select + array/object 嵌套 |
| `packages/kernel/src/configSchema.ts:108` | 便捷构造 F | `F.number(28)`、`F.boolean(true)` 等 helper，比手写对象字面量短 |
| `packages/kernel/src/configSchema.ts:24` | 标量控件类型 | `ConfigScalarType = 'string' | 'color' | 'number' | 'boolean' | 'select'` —— 面板可长控件的全部类型 |

## 常见坑

- **键名不带前缀 = 和别的插件抢键**。内核 settings 是"全局同一张表、先声明者独占"。
  你定义 `{ size: … }`，别的插件也定义 `{ size: … }`，后装的声明会被忽略（先到先得）。
  所有真实插件都加前缀：`textDefaultWidth`、`miniMapVisible`、`cursorFxSize`。
- **只导出 Config、不订阅 onChange = 改了没反应**。面板改值只改 settings store 里那个数字；
  你的组件不改自己不会动。要么像 ClockOverlay 那样订阅 onChange 重读，要么用 `bindTypeDefaultSize`
  这类内核辅助函数（它内部帮你订阅了）。
- **number 字段忘了 `step`**。滑块步长缺省 1；你要 0.1~3 的灵敏度却不写 `step: 0.1`，
  滑块只能在整数之间跳（mini-map 的灵敏度字段显式写了 `step: 0.1`，就是防这个）。
- **group 名是面板页的"身份证"**。两个插件写同一个 group 名，它们的配置项会混在同一个页里。
  想独占一页就用插件独有的名字（如 `示例时钟`）；想并进"常规"页就写 `常规/小地图`
  这种二级路径（`/` 前是一级导航，后面是二级页签）。
