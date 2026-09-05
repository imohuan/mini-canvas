# 3 · 让插件可配置（给插件加设置面板）

> 目标：给插件声明一份**分组配置**（颜色、数字、开关…），宿主会自动长出一块设置面板；
> 用户改一项，**只有对应的那一处**实时更新，不整图重建。
> 建立在第 1/2 篇跑通的基础上。

## 前提

- 跑通 `cd packages/canvas-core-v2 && pnpm dev` → http://localhost:5199。
- 会改你第 2 篇那个插件（或直接用仓库里的真实插件 `theme-default` 当样板看）。

## 想法（一句话）

插件想要"可配置"时，**不用自己画表单**：你在 `apply(ctx)` 里调用
`ctx.settings.define({ group, items })` 申报「哪几组、每组哪些项、每项什么类型/默认值/范围/文案」，
内核把它当成**唯一数据源**；渲染侧的设置面板读这份申报**自动长控件**。用户一改 →
面板调 `ctx.settings.set(key, value)` → 订阅方只更新它关心的那一处 → 实时可见。

## 做

1. 在插件里声明两组配置（照抄进你插件的 `apply`）：

```ts
export function apply(ctx: Context) {
  // ① 申报两组：schema 里 type/默认值/范围/中文 label
  ctx.settings.define({
    group: '外观',
    items: {
      lineColor: { type: 'color', default: '#b1b1b7', label: '连线颜色' },
      lineWidth: { type: 'number', default: 2, min: 1, max: 6, label: '线宽' },
    },
  })
  ctx.settings.define({
    group: '动效',
    items: {
      animated: { type: 'boolean', default: true, label: '选中流光' },
    },
  })
}
```

> 类型支持 `color / number / select / boolean / text`。面板会自动按类型长对应控件。

2. 想"改一项 → 我只更新那一处"：订阅**自己插件**的变更（别的插件改它自己的不会误触你）：

```ts
export function apply(ctx: Context) {
  ctx.settings.define({ group: '外观', items: { /* … */ } })

  // ② 只订我自己的变更；scope 传本插件名 → 别的插件改配置不会触发这里
  ctx.effect(() =>
    ctx.settings.onChange(name, (key, value) => {
      if (key === 'lineColor') updateEdgeStroke(value)      // 只刷连线那条的 stroke
      if (key === 'lineWidth') updateEdgeWidth(value)       // 只刷线宽
      // 千万别整图重建；一行只动一处
    }),
  )
}
```

> `updateEdgeStroke / updateEdgeWidth` 是你自己把值落到某个响应式外观对象上的函数——
> 只要你更新的是**宿主已注入的响应式外观对象**里"那一个字段"，Vue 就只重绘受影响的边/节点，
> 天然无全图重建。

## 你要在 demo 里看到的东西

- 画布右下会出现「插件设置」浮层，按你声明的**组**列出控件：外观组有颜色 + 线宽滑块，动效组有开关。
- 拖颜色/滑块：画面里对应的连线**立刻**变色/变宽，其它元素（节点、背景）纹丝不动——没有整幅重建。

> 想直接看一个现成的：仓库插件 `theme-default` 就是这样写的——
> 打开 `packages/plugins/plugin-theme-default/src/index.ts` 看它的 `ctx.settings.define`（两组连线配置），
> 以及 `packages/canvas-core-v2/demo-web/CanvasDemo.vue` 里怎么把 `ctx.get('settings')` 喂给
> `<PluginSettingsPanel>`（右下角那块面板）——两处对照着看最清楚。

## 这背后发生了什么（一句话）

`ctx.settings` 是"单一数据源"：插件只申报 schema 与默认值，UI 面板与业务都读写内核这一份；
`onChange(scope)` 按声明插件的**作用域**过滤广播（不误触别人、无全局风暴），
消费方拿到变化只更新它注册的那一处 → 实时生效、不整图重建、可热卸回收（插件卸载自动清掉它声明的配置项）。

## 下一步

插件要给别人用了：把它**打包并装进别的画布**，想卸就卸、还能换版本 → 学第 4 篇「打包并装进别的画布」。

---
> 想看真实现成的可配置插件？`@mini-canvas/plugin-theme-default` 就是按本文的
> `ctx.settings.define` 申报、配合 `<PluginSettingsPanel>` 自动长面板的真实例子。
