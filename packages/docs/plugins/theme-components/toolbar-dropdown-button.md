# 工具栏下拉按钮 ToolbarDropdownButton

**一句话**：工具栏里「一个按钮 + 点开一串菜单」的公共件。菜单项可以只是一行字，也可以在右边打开一块自定义面板（宫格选择器、色板、滑杆组都行）。

登记在 `ui` 目录名 `toolbarDropdown`。源码：`packages/plugins/plugin-theme-default/src/components/ui/ToolbarDropdownButton.vue`，子面板内容在 `ToolbarDropdownSubPanel.vue`。

## 这个组件能做到什么

- 触发器就是主题按钮：和旁边的普通工具按钮一样高、一样的圆角。
- 普通菜单行：点了发出 `pick`。
- `children`：右边展开一串**文字**二级菜单。
- `panel`：右边展开**你自己画的面板**。面板里点格子、拖滑块时，外面的菜单会留着；
  面板自己决定什么时候收起（宫格是点一下就收）。
- 菜单、二级菜单、自定义面板都是独立浮层（Teleport 到 body），不会被节点卡片的边框裁掉。
  打开一个会关掉别的下拉，点外面或按 Esc 也会关。

## 活演示

<script setup>
import ToolbarDropdownDemo from '../../.vitepress/theme/demos/ToolbarDropdownDemo.vue'
</script>

<ToolbarDropdownDemo />

## Props

| 字段 | 类型 | 缺省 | 说明 |
| --- | --- | --- | --- |
| `title` | `string` | 必填 | 按钮文字，也是菜单的无障碍名称 |
| `items` | `ToolbarMenuNode[]` | `[]` | 菜单项（形状见下） |
| `icon` | `unknown?` | — | 按钮图标（SVG 字符串或 Vue 组件） |
| `variant` | `ghost / primary / danger` | `'ghost'` | 按钮视觉语义 |
| `active` | `boolean?` | — | 开关态 |
| `disabled` | `boolean` | `false` | 禁用 |
| `menuWidth` | `string` | `'220px'` | 菜单最小宽 |
| `arrow` | `boolean` | `false` | 菜单上方的小箭头 |
| `placement` | `string` | `'bottom-start'` | 方向 + 对齐（`bottom` / `bottom-start` / `bottom-end` / `top-…`） |
| `align` | `auto / start / center / end` | `'auto'` | 横向对齐的显式开关，覆盖 `placement` 后缀 |

菜单项 `ToolbarMenuNode`：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `key` | `string` | 唯一标识，`pick` 回传它 |
| `label` | `string` | 显示文字 |
| `disabled` | `boolean?` | 禁用这一行 |
| `danger` | `boolean?` | 红色文字 |
| `children` | `ToolbarMenuNode[]?` | 文字二级菜单 |
| `panel` | `ToolbarMenuPanel?` | 自定义二级面板（和 `children` 同时给时，`panel` 优先） |

`ToolbarMenuPanel`：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `component` | `Component?` | 直接渲染的面板组件；会额外收到 `panel` 这个 prop |
| `props` | `Record<string, unknown>?` | 透传给 `component` 的 props（事件写 `onXxx`） |
| `render` | `(ctx) => VNodeChild?` | 自己组内容；`ctx` 里有 `close` / `pick` / `state` |
| `width` | `string?` | 面板最小宽，缺省跟主菜单一致 |
| `state` | `Record<string, unknown>?` | 面板要读的共享状态（传 `reactive` 对象就能实时更新） |

## Slots / 插槽

| 插槽 | 说明 |
| --- | --- |
| 默认插槽 | 按钮里的文字；不写就用 `title` |

## 事件、方法或暴露能力

| 事件 | 载荷 | 说明 |
| --- | --- | --- |
| `pick` | `(key, path, close)` | 选中一行。`path` 是层级路径；`close()` 收起整个下拉 |

自定义面板通过 `panel` 拿到的上下文：

| 字段 | 说明 |
| --- | --- |
| `key` / `label` / `path` / `node` | 当前菜单项的信息 |
| `state` | 就是 `panel.state` |
| `closePanel()` | 只关右侧面板，保留主菜单 |
| `close()` | 关掉整个下拉 |
| `pick(key?, path?)` | 当成选了某一项：发 `pick` 并关闭 |

## 使用方式与示例

```vue
<!-- 文件：packages/my-plugin/src/MyGridToolbar.vue -->
<!-- 格式：Vue 单文件组件（script setup lang="ts"） -->
<!-- 位置：图片节点顶栏里 —— 用默认主题的下拉按钮 -->
<script setup lang="ts">
import { h, reactive } from 'vue'
import { useUiComponent } from '@mini-canvas/canvas-render'
import MyGridPicker from './MyGridPicker.vue'

const DropdownButton = useUiComponent('toolbarDropdown')

const custom = reactive({ rows: 3, cols: 3 })

const items = [
  { key: 'grid:2:2', label: '4 宫格（2×2）' },
  { key: 'grid:3:3', label: '9 宫格（3×3）' },
  {
    key: 'grid:custom',
    label: '自定义',
    panel: {
      width: '200px',
      state: custom,
      // 写法 A：直接给组件，事件写成 onXxx；组件收到的 panel prop 里有 close()
      component: MyGridPicker,
      props: {
        initialRows: custom.rows,
        initialCols: custom.cols,
        // 点格子 = 确认：收行列，再收起下拉
        onConfirm: (rows: number, cols: number) => {
          custom.rows = rows
          custom.cols = cols
        },
      },
      // 写法 B：render 能直接拿 close
      // render: ({ close }) => h(MyGridPicker, { initialRows: custom.rows, onConfirm: close }),
    },
  },
]

function onPick(key: string, _path: string[], close: () => void): void {
  // ... 你的业务
  close() // 普通行选完就关
}
</script>

<template>
  <component :is="DropdownButton" title="宫格切分" :items="items" @pick="onPick" />
</template>
```

## 注意事项

1. **面板是一个独立的 `component`**：`component` 和 `render` 选一个。给 `component` 时，
   子面板会多传一个 `panel` prop（上下文），要收起就调用 `panel.close()`。
2. **选中就收起由面板自己决定**：组件写法用 `panel.close()`，`render` 写法用 `ctx.close()`。
   需要连点、拖选的场景（比如色板）就晚一点关。
3. **面板宽度要够**：`panel.width` 太窄，宫格这类内容会被压扁。宽度也会参与「右边放不下就翻到左边」的判断。
4. **状态不要写进节点 data**：面板里的行列这类临时选择用插件内的 `reactive` 会话，
   免得每个格子都被记进撤销栈。
5. **不要自己再造一个「自定义」按钮**：以前宫格切分就是两个并列入口；现在放到同一个 `items` 里，
   用户看到的是「自定义 ›」，和参考稿一致。
6. **`panel` 优先于 `children`**：两种都写时只画面板；只想排一串文字子项就只写 `children`。

## 真实插件参照

| 想抄什么 | 看哪里 |
| --- | --- |
| 「预设行 + 自定义宫格面板」的完整接法 | `packages/plugins/plugin-image-grid-split/src/GridSplitEntry.vue` |
| 面板本体（滑选行列、点一下即确认） | `packages/plugins/plugin-image-grid-split/src/GridSizePicker.vue` |
| 普通下拉与二级文字菜单的用法 | `packages/plugins/plugin-ui-demo/src/DemoTopEntry.vue` |
| 下拉的定位与浮层链 | `packages/plugins/plugin-theme-default/src/components/ui/Dropdown.vue`、`floatingChain.ts` |
