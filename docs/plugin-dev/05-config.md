# 5 · 配置（Config schema + 监听变化实时生效）

> 目标：给插件声明可配置项——**导出 Config schema**，宿主自动长出一块设置面板；
> 用户改一项，只刷对应那一处、实时生效、**不整图重建**。
> 建立在第 1–4 篇跑通的基础上。

## 一句话（新版写法，取代旧的 ctx.settings.define）

插件想要"可配置"时：**在模块级导出一个 `Config` schema**，声明"哪些项、每项什么类型/默认值/
范围/文案/放哪组"。装配处给 config → 内核经 schema **校验 + 补齐默认值** → `apply(ctx, config)`
收到的永远是完整、合法的 config。校验不过 → 插件 FAILED + 响亮报错。

同时，内核会把 `Config` 的字段自动登记进 **settings 单一数据源**，渲染侧面板据此自动长控件；
你订阅"我这份 config 的变化"→ 拿到变化只窄更新对应一处 → 实时生效。旧的
`ctx.settings.define(...)` 那种"在 apply 里运行时声明"的方式**已废弃**，声明一律走模块级 Config。

## 先看仓库里真实的可配置插件（theme-default）

`packages/plugins/plugin-theme-default/src/index.ts` 是最标准的样板。它声明 7 项连线外观配置
（线型 / 颜色 / 线宽 / 流光 / 虚线 / 箭头 / 辉光），分组"连线"和"连线动效与箭头"：

```ts
// plugin-theme-default/src/index.ts (节选，真实现)
import type { Context, ConfigSchema, InferConfig } from '@mini-canvas/canvas-base'

export const name = 'theme-default'
export const inject = [] as string[]

/** 本插件可配置项 schema：type + default + label + group(+min/max/options) */
export const Config: ConfigSchema = {
  edgeType: {
    type: 'select', default: 'bezier', label: '线型', group: '连线',
    options: [
      { value: 'bezier', label: '贝塞尔' }, { value: 'straight', label: '直线' },
      { value: 'step', label: '直角' }, { value: 'smoothstep', label: '圆角折线' },
    ],
  },
  edgeColor:   { type: 'color',  default: '#3b82f6', label: '连线颜色', group: '连线' },
  edgeLineWidth: { type: 'number', default: 2, min: 1, max: 6, label: '线宽', group: '连线' },
  edgeAnimated:{ type: 'boolean', default: true, label: '选中流光', group: '连线动效与箭头' },
  // …（edgeDashed/edgeMarkerEnd/edgeGlowEnabled 同上面 pattern）
}

/** apply 收到的 config 类型（用 InferConfig 从 schema 推导，保持一致） */
export interface ThemeConfig extends InferConfig<typeof Config> {}

export function apply(ctx: Context, config?: ThemeConfig) {
  // config 已内核校验+补默认；这里不手写 settings.define（声明即 Config 导出）
  void config
  ctx.theme.register('nodeShell', BaseNode)
  ctx.theme.register('edge', CustomEdge)
  ctx.theme.register('background', DefaultBackground)
}
```

**这就是新版配置的正确形态**——注意它**没有**任何 `ctx.settings.define`。

## 你能配置的五种字段类型

| type | 默认值 | 说明 |
|---|---|---|
| `string` | `''` | 一段文本 |
| `number` | `0` | 数字；可配 `min`/`max`（越界装配会校验错） |
| `boolean` | `false` | 开关 |
| `color` | `'#000000'` | 十六进制颜色（`#rgb` / `#rrggbb` / `#rrggbbaa`） |
| `select` | 你给的 | 枚举下拉；`options: ['a','b']` 或 `[{value,label}, …]` |

`label`（UI 文案）和 `group`（面板分组名，缺省=插件名）可选。

> 想少打字？`@mini-canvas/canvas-base` 提供了 `F` 帮助函数：
> `import { F } from '@mini-canvas/canvas-base'`，然后
> `edgeColor: F.color('#3b82f6')`、`lineWidth: F.number(2).min(1).max(6)` 之类。
> 字段对象写法也行，两者等价。

## 你怎么在宿主里看到这块面板

跑 demo，画布右下角那块 **「连线外观」设置浮层**就是 theme-default 的 Config 变的：内核把它的
`group: '连线'`、`group: '连线动效与箭头'` 两组字段登记进 settings，渲染侧
`<PluginSettingsPanel>`（读 ctx.settings 自动长控件）把它们画了出来。拖线宽滑块 / 点颜色，
你会看到**对应的连线立刻变**，其它元素（节点、背景）纹丝不动——没有整幅重建。

> 怎么"把 Config 变成面板"不用你操心：内核负责登记、`PluginSettingsPanel` 负责按组画控件、
> 改动就 `settings.set(key, value)`。你要写的只是导出 `Config`。

## 装配处给 config：apply(ctx, config) 收到校验后的

宿主/清单装配插件时可给它一份 `config`（per-plugin 覆盖）。内核校验 + 补默认后传给 `apply` 第二参。
以清单为例（`packages/canvas-core-v2/demo-web/baseManifest.ts` 里有注释示例）：

```ts
import { themeDefaultPlugin } from '@mini-canvas/plugin-theme-default'

// 给 theme-default 覆写两处：其它 5 项没给，自动用 Config 的默认值补上
const manifest = {
  plugins: [
    { id: 'theme-default', source: themeDefaultPlugin,
      config: { edgeColor: '#16a34a', edgeLineWidth: 3 } },
  ],
}
// manager.applyManifest(manifest)
```

浏览器控制台也能直接装带 config 的插件，验证"默认补齐 + 覆写"：

```js
// 用 theme-default 的 Config 补默认：只给 color，其它项自动用 schema 默认
window.MiniCanvasManager.install({
  name: 'my-config-plugin',
  inject: [],
  Config: {
    title:    { type: 'string', default: '你好', label: '标题', group: '文案' },
    loud:     { type: 'boolean', default: true, label: '大声', group: '文案' },
    accent:   { type: 'color', default: '#3b82f6', label: '强调色', group: '外观' },
  },
  apply(ctx, config) {
    // config 一定合法：没给的项已被 schema 默认补齐
    console.log('[config-demo]', config) // { title:'你好', loud:true, accent:'#3b82f6' }
  },
})
```

## 校验不过：响亮报错（不是静默忽略）

装配给的 config 若不合 schema（类型错 / 越界 / select 不在枚举 / color 非法），插件**加载失败**：

```js
// 装配处带非法 config（manager.install 第二参 opts.config 是装配 config）
window.MiniCanvasManager.install(
  {
    name: 'bad-config',
    inject: [],
    Config: { accent: { type: 'color', default: '#3b82f6', label: '强调色' } },
    apply(ctx, config) { console.log(config) },
  },
  { config: { accent: 'red' } },   // ← 'red' 不是合法 hex 颜色
)
```

会抛 `[config] invalid config: "accent" expected hex color but got "red"`，插件 fiber 进 **FAILED**；
`manager.list()`（或左下角面板）里能看到 `bad-config` 标 FAILED + 报错。绝不带着残缺 config 启动。

## 监听"我这份 config 的变化"→ 就地窄更新、实时生效（机制要会）

配置的妙处不止"装配时校验一次"——它还活着：用户在你 Config 长出的面板上改一项时，
内核会广播 `key → value` 的变化。你**订阅自己这份 config**（scope 传本插件名 = 只收自己的，不误触别人），
拿到变化就**只更新对应那一处**，实现"实时生效、不整图重建"。

demo 的 `CanvasDemo.vue` 里 `bindThemeSettings()` 就是这条链路的真身（宿主侧把 settings 变化窄更新到
edge 视觉对象 → Vue 只重绘那几条边）：

```ts
// CanvasDemo.vue bindThemeSettings() (真实代码的精简)
const ctx = host.ctx
const store = ctx.get('settings')          // 取 settings 单一数据源
for (const k of EDGE_SETTING_KEYS) {       // ① 初始把当前值灌进外观
  const v = store.get(k); if (v !== undefined) cfg.edge[k] = v
}
store.onChange((key, value) => {           // ② 订阅变化
  if (!EDGE_SETTING_KEYS.includes(key)) return   // 只认 theme 声明的键
  cfg.edge[key] = value                    // 只窄更新那一条线的外观 → 无全图重建
})
```

作者侧（在你的插件 `apply` 里）想监听**自己**的 config 变化做窄更新，用 `ctx.settings.onChange`：

```ts
export function apply(ctx: Context, config: MyConfig) {
  // 只收自己这份 config 的变化（scope=本插件名）
  ctx.effect(() =>
    ctx.settings.onChange(name, (key, value) => {
      if (key === 'accent') updateAccent(value)   // 只刷用到强调色的那一处
      if (key === 'title')  updateTitle(value)    // 只刷标题那处
      // 千万别整图重建；一行只动一处
    }),
  )
}
```

> 内核把 Config 字段登记进单一数据源时，`group` 分组自动带好，`<PluginSettingsPanel>` 就按组画控件、
> 用户改动 `settings.set` → 触发上面的 `onChange`。你的回调拿到 `key/value` 窄更新对应一处即可。
> `updateAccent/updateTitle` 是你自己把值落到某响应式对象上"那一个字段"的函数——Vue 只重绘受影响的边/节点。

## 这背后发生了什么（一句话）

声明走**模块级 Config schema**（取代旧的运行时 `ctx.settings.define`）：装配给 config → 内核校验 +
补默认 → `apply(ctx, config)` 收合法值；字段自动登记进 settings 单一数据源 → 面板按组分长控件 →
`settings.set` 广播变化 → 你的 `onChange(scope=本插件)` 收到只窄更新那处 → 实时生效、不整图重建。
校验不过响亮报错进 FAILED，绝不带着残缺 config 启动。

## 下一步

你已经能写一个带节点 + 服务 + 事件 + 配置的插件了。下一篇讲怎么**把一堆插件装进画布**：
用装配清单（manifest）按序装、热卸 / 换版本，以及诊断为什么有个插件一直卡 PENDING（第 3 篇那个
状态在你真做多插件时超常见）→ [第 6 篇 · 组合与热重载（manager / manifest / PENDING 诊断）](./06-composition-hmr.md)。
