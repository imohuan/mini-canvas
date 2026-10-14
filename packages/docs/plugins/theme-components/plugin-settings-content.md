# 设置面板 PluginSettingsContent

**一句话**：设置弹窗里**中间那一层** —— 左边一级导航 + 右边内容区（可选二级页签）。
它注册在主题槽 `settingsPanel`（单赢家，`order: 0`，id `default`）。

**名字里没有 Dialog 是故意的**：它**不是弹窗**。遮罩、居中、标题栏、✕、Esc、点遮罩关闭、
浮动窗口、悬浮球全部由渲染层 `SettingsShell` 提供 —— 换皮的人只写内容区，
不重画窗口，也不用管怎么关。

源码：`packages/plugins/plugin-theme-default/src/components/settings/PluginSettingsContent.vue`。

## 功能说明

## 活演示

`BaseNode` 是 VueFlow 渲染每个节点时套上的壳，**离开画布宿主渲染不出来** —— 所以下面嵌一块真画布（装了默认主题 + 示例节点），你在真环境里看它：

<script setup>
import MiniCanvasStage from '../../.vitepress/theme/demos/MiniCanvasStage.vue'
</script>

<MiniCanvasStage :height="360" />

> 这一件不在画布里，它渲染在设置弹窗里：点顶部/右下角打开「设置」，左导航 + 右侧内容就是它画的。

- **分组即导航**：所有 `Config` 字段都带 `group`；`group` 里的 `/` 表示二级菜单
  （`常规/显示` → 一级 `常规`、二级 `显示`；没有 `/` 的扁平分组即"一级 = 自己"）。
- **页签只在需要时出现**：某一级下二级分组**多于一个**才显示页签条；只有一个就直接展示内容。
- **三套扩展插槽**（本页的重点）：别的插件不必换整张皮，就能改造导航/页签/正文。
- **自定义字段控件**：它 provide 了一个"标准字段渲染器"令牌，正文插槽组件可以拿来直接渲染某个控件。

## Props

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `settings` | `SettingsPanelSource` | 设置数据的实时源（渲染层 `SettingsHost` 喂进来）；非 Vue 响应式，靠 `settings.onChange` 驱动刷新 |

## Slots / 插槽

没有 Vue 插槽。它读的是**内核通用 UI 槽**（`ctx.slots.occupants(...)`），随插件装卸自动回收：

| 槽名 | 渲染位置 | occupant `id` 语义 |
| --- | --- | --- |
| `settingsNav` | 左一级导航 | id = 一级名：命中 → 顶替那一级默认项；不命中 → 末尾追加一个自定义一级项 |
| `settingsTab` | 右二级页签条 | id 首段 = 当前一级名才生效：命中某完整 key → 顶替那个页签；不命中 → 追加一个自定义页签 |
| `settingsGroup/<完整key>` | 右正文 | 接管某**完整 key** 的内容区；`meta.mode: 'replace'(缺省) / 'prepend' / 'append'` 控制是否与默认控件并存 |

## 事件、方法或暴露能力

组件**不 emit**、**不 defineExpose**。它对插槽组件下发两样东西：

1. **props** —— 导航/页签占位收到 `{ group, active, onSelect }`（`onSelect(key)` 用来切右侧；**不给就没反应**）；
   正文占位收到 `{ group, settings }`。
2. **provide 令牌 `SETTINGS_FIELD_RENDERER`** —— 正文组件 inject 后可以直接渲染某个标准字段控件。

```ts
// 文件：packages/my-plugin/src/components/MyPreviewPanel.vue
// 格式：Vue 单文件组件
// 位置：接管某个设置分组的正文；这里只渲染一个字段 + 自己的预览
import { injectSettingsFieldRenderer } from '@mini-canvas/canvas-render'

const FieldRenderer = injectSettingsFieldRenderer()   // 拿到标准字段控件
```

## 使用方式与示例

三种扩法，写在你自己插件的 `apply` 里：

```ts
// 文件：packages/my-plugin/src/myPlugin.ts
// 格式：TypeScript 模块（插件入口）
// 位置：一个插件 —— 往默认设置面板里加导航项 / 页签 / 正文
import type { Context, PluginModule } from '@mini-canvas/canvas-base'
import MyNavItem from './MyNavItem.vue'
import MyTabItem from './MyTabItem.vue'
import MyPreviewPanel from './MyPreviewPanel.vue'

export const name = 'my-settings'
export const inject = [] as string[]

// ① 一级导航 id 必须与一个 Config 分组同名，否则右侧内容区是空的
export const Config = {
  myPanelHint: { type: 'string', default: '', label: '我的面板', group: '我的分组' },
}

export function apply(ctx: Context): void {
  // ② 一级导航：id 命中一级名「外观」→ 顶替它；不命中就追加一项
  ctx.slots.register('settingsNav', { id: '我的分组', order: 8, component: MyNavItem })

  // ③ 二级页签：config 里把「我的分组」拆成 我的分组/A + 我的分组/B，才会出现页签条
  ctx.slots.register('settingsTab', { id: '我的分组/A', order: 0, component: MyTabItem })

  // ④ 正文：接管「我的分组/B」的内容区，与默认 schema 控件并存
  ctx.slots.register('settingsGroup/我的分组/B', {
    id: 'my-preview', order: 0, component: MyPreviewPanel, meta: { mode: 'append' },
  })
}

export const mySettingsPlugin: PluginModule = { name, inject, Config, apply }
```

```vue
<!-- 文件：packages/my-plugin/src/MyNavItem.vue -->
<!-- 格式：Vue 单文件组件 -->
<!-- 位置：设置面板左导航的一条自定义项；整条由你自绘，点它调 onSelect -->
<script setup lang="ts">
// 导航/页签占位收到的 props（onSelect 不给 → 点了没反应，这是最容易踩的坑）
defineProps<{ group?: string; active?: boolean; onSelect?: (group: string) => void }>()
</script>

<template>
  <button type="button" :class="{ 'is-active': active }" @click="onSelect?.(group ?? '')">
    我的分组
  </button>
</template>
```

**想整张皮都换掉**：往 `settingsPanel` 槽注册一个 `order` 更小的组件
（成品应用就是这么干的，见 `packages/ui/src/settingsPanelPlugin.ts`）。
注意换皮后**上面这三套插槽就没有了** —— 它们属于默认皮内容区的实现，不是槽的契约。

## 注意事项

1. **导航 id 必须与 Config 分组同名**，否则右侧内容区为空（皮的分组是从 `settings.groups()` 推导的，
   只注册 `settingsNav` 不产生分组）。
2. **`onSelect` 必须给**，否则点击无反应 —— 这是最常踩的一条。
3. **`meta.mode` 只对 `settingsGroup/<key>` 生效**：
   `prepend` / `append` 与默认控件并存，缺省 `replace` 整块接管并隐藏默认控件。
4. **别用 `:key` 重挂设置面板**（输入框每按键丢焦点）；要自刷新靠 `settings.onChange` 订阅。
5. **CSS 前缀是 `psd-`**（`psd-nav` / `psd-tabs` / `psd-content`）。
6. **跨一级隔离**：`settingsTab` 按"id 首段 === 当前一级名"过滤，不会串到别的一级里。
