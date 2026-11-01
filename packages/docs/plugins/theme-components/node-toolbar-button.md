# 按钮 NodeToolbarButton

**一句话**：节点上/下控制栏里的通用按钮 —— 32×32 图标钮、或带文案的文本钮、或两者组合。
登记在 `ui` 目录名 `button`。

源码：`packages/plugins/plugin-theme-default/src/components/ui/NodeToolbarButton.vue`。

> **新代码请直接用 shadcn 的 `Button`。** 节点上/下控制栏的按钮已改成
> `import { Button } from '@mini-canvas/ui-kit-shadcn'` + 全局类 `.mck-toolbar-btn`，
> 不再经 `toolbarButton` 这层转接。这个按名取的名字仍保留登记，供旧插件和 `toolbarDropdown` 用。

## 功能说明

## 活演示

<script setup>
import ThemeKitDemo from '../../.vitepress/theme/demos/ThemeKitDemo.vue'
</script>

<ThemeKitDemo name="button" />

> 上面这些按钮就是画布里节点控制栏用的那一份（同一份实现，样式由主题 token 决定）。

- 两种形态：**纯图标钮**（没给默认插槽）/ **带文案钮**（给了默认插槽）。
- 三种视觉语义：`ghost`（缺省，图标=灰底、带文案=文本按钮）/ `primary`（主按钮）/ `danger`（悬停转红）。
- **开关态**：传 `active` 就是开关（会报 `aria-pressed`）；**不传**就不当开关。
- **图标句柄 opaque**：SVG 字符串或 Vue 组件都收（与节点类型 `icon` 同一写法）。
- **无障碍**：`aria-label` 缺省回落 `title`；纯图标按钮必须给 `title`。

## Props

| 字段 | 类型 | 缺省 | 说明 |
| --- | --- | --- | --- |
| `title` | `string` | 必填 | 按钮文案；纯图标时它就是无障碍名称 |
| `ariaLabel` | `string?` | `undefined` | 单独的读屏名称；缺省 = `title` |
| `icon` | `unknown?` | `undefined` | 图标句柄（SVG 字符串或 Vue 组件）；不传则只渲染文案 |
| `variant` | `ghost / primary / danger` | `'ghost'` | 视觉语义（danger = 悬停转红） |
| `disabled` | `boolean` | `false` | 禁用 |
| `active` | `boolean?` | `undefined` | 开关类按钮的当前状态；**不传**就不报 `aria-pressed` |

## Slots / 插槽

| 插槽 | 说明 |
| --- | --- |
| 默认插槽 | 有内容 = 带文案的按钮（文案区）；空 = 纯图标按钮（按钮自动加 `is-icon-only` 类） |

## 事件、方法或暴露能力

| 事件 | 载荷 | 说明 |
| --- | --- | --- |
| `click` | `MouseEvent` | 点击。**由组件自己 emit**，不是把原生事件直接透传 |

没有 `defineExpose`。渲染出的根是一个 `button type="button"`。

## 使用方式与示例

```vue
<!-- 文件：packages/my-plugin/src/MyToolbar.vue -->
<!-- 格式：Vue 单文件组件（script setup lang="ts"） -->
<!-- 位置：节点上/下控制栏里的一条控件 —— 用默认主题的按钮 -->
<script setup lang="ts">
import { ref } from 'vue'
import { ToolbarIcon } from '@mini-canvas/canvas-render'
import { Button } from '@mini-canvas/ui-kit-shadcn'

const starred = ref(false)
// 图标句柄：SVG 字符串（也可以是 Vue 组件）
const STAR_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3l3 6 6 .9-4.5 4.3 1 6-5.5-3-5.5 3 1-6L3 9.9 9 9z"/></svg>'
</script>

<template>
  <!-- 1 纯图标 + 开关态（给了 active 才报 aria-pressed） -->
  <Button class="mck-toolbar-btn is-icon-only" :class="{ 'is-active': starred }" variant="ghost" size="sm" type="button"
    title="收藏" aria-label="收藏" :aria-pressed="starred ? 'true' : 'false'" @click="starred = !starred">
    <ToolbarIcon :icon="STAR_ICON" />
  </Button>

  <!-- 2 带文案的按钮 -->
  <Button class="mck-toolbar-btn mck-toolbar-btn--primary" variant="default" size="sm" type="button" title="下载">
    <span class="mck-toolbar-label">下载</span>
  </Button>

  <!-- 3 危险动作 -->
  <Button class="mck-toolbar-btn mck-toolbar-btn--danger" variant="destructive" size="sm" type="button" title="删除">
    <span class="mck-toolbar-label">删除</span>
  </Button>
</template>
```

## 注意事项

1. **纯图标按钮同时给 `title` 与 `aria-label`**：缺了读屏软件念不出来。
2. **开关按钮才写 `aria-pressed`**：普通按钮不写，否则读屏会当成开关。
3. **`is-icon-only` 要手写**：全局样式靠它区分 32×32 图标钮与文字钮。
4. **它只是"长得对"**：按钮不帮你做任何业务（不禁用重复点击、不管权限）—— 那些是调用方的事。
