# 设置面板 PluginSettingsContent

**一句话**：设置弹窗里**中间那一层** —— 左边一级导航 + 右边内容区（可选二级页签）。
它注册在主题槽 `settingsPanel`（单赢家，`order: 0`，id `default`）。

**名字里没有 Dialog 是故意的**：它**不是弹窗**。遮罩、居中、标题栏、✕、Esc、点遮罩关闭、
浮动窗口、悬浮球全部由渲染层 `SettingsShell` 提供 —— 换皮的人只写内容区，
不重画窗口，也不用管怎么关。

源码：`packages/plugins/plugin-theme-components/src/components/settings/PluginSettingsContent.vue`。

## 功能说明

## 活演示

`BaseNode` 是 VueFlow 渲染每个节点时套上的壳，**离开画布宿主渲染不出来** —— 所以下面嵌一块真画布（装了默认主题 + 示例节点），你在真环境里看它：

<script setup>
import PlumeStage from '../../.vitepress/theme/demos/PlumeStage.vue'
</script>

<PlumeStage :height="360" />

> 这一件不在画布里，它渲染在设置弹窗里：点顶部/右下角打开「设置」，左导航 + 右侧内容就是它画的。

- **菜单由插件各自注册**：0 级分类、1 级菜单、2 级小节都经 `ctx.settingsMenu` 登记（见下）。
  `Config.group` 只决定字段落到哪个小节，不再决定菜单层级。
- **页签默认隐藏**：卡片模式按菜单的 2 级小节顺序一页排开；宿主显式传 `show-section-tabs`
  且一级下多于一个段时，才切成顶部页签。
- **菜单 + 三套旧插槽**（本页的重点）：新插件用 `ctx.settingsMenu` 声明层级；
  没迁移的插件仍可用 `settings.nav` / `settings.tab` / `settingsGroup/<key>` 改导航/页签/正文。
- **自定义字段控件**：它 provide 了一个"标准字段渲染器"令牌，正文插槽组件可以拿来直接渲染某个控件。

## Props

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `settings` | `SettingsPanelSource` | 设置数据的实时源（渲染层 `SettingsHost` 喂进来）；非 Vue 响应式，靠 `settings.onChange` 驱动刷新 |

## 菜单注册：`ctx.settingsMenu`

设置面板的 0 / 1 / 2 级菜单是**插件各写各的注册场**，不是一张需要大家共同维护的总表。
默认主题只在 `apply` 时登记一份默认树做兜底；插件用同 id、更小 `order` 覆盖标题或位置，
卸载后自动露出默认那条。

```ts
// 文件：packages/my-plugin/src/index.ts
// 位置：插件的 apply 里；三种注册都随本插件卸载自动回收
import type { Context } from '@plume-canvas/canvas-base'

export function apply(ctx: Context): void {
  // ① 0 级分类：自己造一个；order 小者排前面（已有分类用它的 id 即可，不必改默认表）
  ctx.settingsMenu.category({
    id: 'category/my', title: '我的', order: 60,
  })

  // ② 1 级菜单：category 填 0 级 id；page 可直接给插件自绘整页
  ctx.settingsMenu.nav({
    id: 'nav/my/tools',
    category: 'category/my',
    title: '工具',
    order: 50,
    page: MyToolsPage,          // 可选；有就优先于 2 级分组
  })

  // ③ 2 级小节：nav 填 1 级 id；groups 可把同一功能的几张卡片合并成一节
  ctx.settingsMenu.section({
    id: 'section/my/tools/cursor',
    nav: 'nav/my/tools',
    title: '光标',
    groups: ['工具/光标', '工具/光标特效'],
    order: 30,
  })
}
```

| 字段 | 作用 |
| --- | --- |
| `id` | 条目的稳定身份。不同插件用同一个 id 就是“覆盖同一格”；同一插件重复注册同 id 是热更替换自己那层。 |
| `order` | **既决定谁赢，也决定谁在前**：同一个 id 时 order 小者赢；不同 id 时 order 小者排前面。 |
| `before` / `after` | 只改位置，不改谁赢。填**同级条目的 id**（不是标题）；目标不存在时退回 `order`。 |
| `groups` | 2 级小节收拢的 `Config.group` 列表；字段 key 与持久化值都不变，只是合并展示。 |

解析后的菜单树里每个条目都带 `position`（0 起），它就是最终展示顺序，已经把 `order`
与 `before` / `after` 一起算过。设置面板直接按这个顺序渲染，**不会再按原始 order 排一次**，
否则相对位置会被覆盖。

没有登记的 `Config.group` 不会消失：注册场会把它补成 `auto` 小节并给出 issue，
方便开发期发现“配置写了、菜单忘了挂”。

左侧导航、分类标题与右上角的窗口按钮全部用 `@plume-canvas/ui-kit-shadcn` 渲染：
导航项是 `Button`（`ghost` + `sm`），滚动条是 `ScrollArea`，窗口按钮是 `Button`
（`ghost` + `icon-sm`）。尺寸跟主题的「控件尺寸」档位一起变，默认导航行高 32px。
图标取不到组件时回落到 `Circle`，不会留下空位。

## Slots / 插槽

没有 Vue 插槽。它读的是**内核通用 UI 槽**（`ctx.slots.occupants(...)`），随插件装卸自动回收：

| 槽名 | 渲染位置 | occupant `id` 语义 |
| --- | --- | --- |
| `settings.nav` | 左一级导航 | 按 id / `meta.title` 命中菜单项时只补 `page` / `component` / 图标；没命中时作为旧入口追加 |
| `settings.tab` | 右二级页签条 | id 首段 = 当前一级名才生效：命中某完整 key → 顶替那个页签；不命中 → 追加一个自定义页签 |
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
import { injectSettingsFieldRenderer } from '@plume-canvas/canvas-render'

const FieldRenderer = injectSettingsFieldRenderer()   // 拿到标准字段控件
```

## 使用方式与示例

一个最小扩法，写在你自己插件的 `apply` 里：

```ts
// 文件：packages/my-plugin/src/myPlugin.ts
// 格式：TypeScript 模块（插件入口）
// 位置：一个插件 —— 往默认设置面板里加菜单项 / 正文
import type { Context, PluginModule } from '@plume-canvas/canvas-base'
import MyPreviewPanel from './MyPreviewPanel.vue'

export const name = 'my-settings'
export const inject = [] as string[]

// ① 旧入口：id / meta.title 命中一个 Config 分组首段，右侧才有内容
export const Config = {
  myPanelHint: { type: 'string', default: '', label: '我的面板', group: '我的分组' },
}

export function apply(ctx: Context): void {
  // ② 新插件优先注册菜单：引用默认分类 id，只声明自己的 1 级与 2 级
  ctx.settingsMenu.nav({
    id: 'nav/my/settings', category: 'category/personal', title: '我的分组', order: 60,
  })
  ctx.settingsMenu.section({
    id: 'section/my/settings', nav: 'nav/my/settings', title: '我的分组', group: '我的分组', order: 10,
  })

  // ③ 正文：接管完整分组的正文，与默认 schema 控件并存
  ctx.slots.register('settingsGroup/我的分组', {
    id: 'my-preview', order: 0, component: MyPreviewPanel, meta: { mode: 'append' },
  })
}

export const mySettingsPlugin: PluginModule = { name, inject, Config, apply }
```

**想整张皮都换掉**：往 `settingsPanel` 槽注册一个 `order` 更小的组件
（默认赢家是本文件的 `PluginSettingsContent`，`order: 0`；2026-11-04 起成品应用不再自己换皮，
设置界面就这一份）。
注意换皮后**上面这些插槽就没有了** —— 它们属于默认皮内容区的实现，不是槽的契约。

## 注意事项

1. **新插件用 `ctx.settingsMenu` 挂菜单，旧插件仍可只写 `settings.nav`**。旧入口的 id 或
   `meta.title` 必须能命中一个 `Config.group` 的首段，否则右侧没有内容；菜单注册的 section
   必须声明真实存在的 `groups`，否则这一节会被过滤掉。
2. **旧导航/页签组件记得给 `onSelect`**，否则点击无反应。新菜单（`ctx.settingsMenu`）不需要它，
   面板统一画导航；只有仍在自绘的 `settings.nav` / `settings.tab` 组件要自己调。
3. **`meta.mode` 只对 `settingsGroup/<key>` 生效**：
   `prepend` / `append` 与默认控件并存，缺省 `replace` 整块接管并隐藏默认控件。
4. **别用 `:key` 重挂设置面板**（输入框每按键丢焦点）；要自刷新靠 `settings.onChange` 订阅。
5. **CSS 前缀是 `psd-`**（`psd-nav` / `psd-tabs` / `psd-content`）。
6. **跨一级隔离**：旧 `settings.tab` 按「id 首段 === 当前一级名」过滤，不会串到别的一级里。
