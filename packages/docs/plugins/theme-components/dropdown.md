# 下拉浮层 Dropdown

**一句话**：一个**下拉浮层外壳** —— 你给它触发区，它把浮层挂到 body 上，负责定位、翻转防溢出、点外面关闭、Esc 关闭、与别的下拉互斥。选项逻辑（怎么选、选什么）**不归它管**。

登记在 `ui` 目录名 `dropdown`。成品应用会用 `order: -1` 注册 `AxDropdown` 顶替它（见末尾注意事项）。

源码：`packages/plugins/plugin-theme-default/src/components/ui/Dropdown.vue`。

## 功能说明

## 活演示

<script setup>
import ThemeKitDemo from '../../.vitepress/theme/demos/ThemeKitDemo.vue'
</script>

<ThemeKitDemo name="dropdown" />

> 点"更多"打开浮层；选项逻辑不归它管，那属于 Select。

- **三种触发方式**：`click`（左键）/ `hover`（悬停，带延迟关闭）/ `contextmenu`（右键）。
- **两种滚法**：`overlay-scroll`（整个浮层滚，适合短菜单）/ `inner-scroll`（浮层只当外框，内容区自己滚）。
- **定位**：`fixed` 加简单翻转防溢出（不引 floating-ui）；浮层最大高度取"调用方给的值"与"视口可用高度"的较小者。
- **互斥**：全局同一张登记表，开一个下拉会通知别的下拉让位。**但不关自己的祖先** ——
  嵌在别人浮层面板里的下拉（如底栏参数面板里的「格式」）打开时，那块外层板子留着。
- **受控非受控都行**：给 `v-model` 就是受控；不给就用内部状态。

## Props

| 字段 | 类型 | 缺省 | 说明 |
| --- | --- | --- | --- |
| `modelValue` | `boolean` | `false` | 开关（配 `v-model` 用） |
| `placement` | `string` | `'bottom-start'` | 浮层相对触发区的位置 |
| `offset` | `number` | `6` | 与触发区的间距（px） |
| `matchWidth` | `boolean` | `false` | 浮层与触发区同宽 |
| `trigger` | `click / hover / contextmenu` | `'click'` | 触发方式 |
| `hoverCloseDelay` | `number` | `150` | hover 模式下鼠标离开后延迟关闭（ms） |
| `menuWidth` | `string` | `''` | 浮层宽（内联样式，优先级最高） |
| `menuMaxWidth` | `string` | `''` | 浮层最大宽 |
| `menuMaxHeight` | `string` | `''` | 浮层最大高；实际取它与"视口可用高度"的较小者 |
| `bodyClass` | `string` | `''` | 浮层内容区扩展类（**会替换默认内边距**） |
| `teleport` | `boolean` | `true` | 是否把浮层 Teleport 到 body |
| `menuRole` | `string` | `'menu'` | 浮层 `role`（选项列表用 `listbox`） |
| `layout` | `overlay-scroll / inner-scroll` | `'overlay-scroll'` | 滚动结构（见上） |

## Slots / 插槽

| 插槽 | 收到的 props | 说明 |
| --- | --- | --- |
| `trigger` | `{ open, toggle, close }` | 触发区内容；用 `open` 画箭头翻转、用 `toggle` 绑定点击 |
| 默认插槽 | `{ close }` | 浮层内容；选项点完记得调 `close()` 关掉 |

## 事件、方法或暴露能力

| 事件 | 载荷 | 说明 |
| --- | --- | --- |
| `update:modelValue` | `boolean` | 开关变化（配 `v-model`） |

没有 `defineExpose`。但默认插槽收到的 `close` 就是它的关闭能力。

## 使用方式与示例

```vue
<!-- 文件：packages/my-plugin/src/MyMenu.vue -->
<!-- 格式：Vue 单文件组件（script setup lang="ts"） -->
<!-- 位置：插件里的一个下拉菜单 —— 用默认主题的浮层外壳 -->
<script setup lang="ts">
import { ref } from 'vue'
import { useUiComponent } from '@mini-canvas/canvas-render'

const Dropdown = useUiComponent('dropdown')

const open = ref(false)
const items = ['重命名', '复制', '删除']

function pick(label: string, close: () => void): void {
  // ... 你的业务
  close()          // 2 选项点完关掉浮层
}
</script>

<template>
  <!-- 1 trigger 插槽收到 { open, toggle }；默认插槽收到 { close } -->
  <Dropdown v-model="open" :match-width="true" menu-role="menu">
    <template #trigger="{ open: isOpen, toggle }">
      <button type="button" @click="toggle">更多 {{ isOpen ? '▲' : '▼' }}</button>
    </template>

    <template #default="{ close }">
      <button v-for="it in items" :key="it" type="button" @click="pick(it, close)">{{ it }}</button>
    </template>
  </Dropdown>
</template>
```

## 注意事项

1. **它只管浮层，不管选项**：单选列表的键盘导航与选中态属于 [Select](/plugins/theme-components/select)；自己写菜单就得自己管键盘与焦点。
2. **`bodyClass` 会替换默认内边距**：传它等于接管内容区的 padding。
3. **浮层最大高度受视口限制**：调用方给的 `menuMaxHeight` 会用 `min()` 与视口可用高度取小，所以"面板比屏幕还高"顶不出去。
4. **`teleport` 默认开**：浮层挂在 body 上，样式与裁剪上下文（如祖先的 `overflow: hidden`）不再影响它；关掉要自己保证不被裁。
5. **成品应用里按名取到的不是这一份**：`packages/ui` 注册了 `AxDropdown`（`order: -1`）；想拿主题包这份就具名 import。
6. **嵌在另一个浮层里不用额外声明**：浮层根带 `data-floating-chain`，里层的下拉读一下自己的
   祖先就知道「我是谁的儿子」，打开时不会把外层面板顶掉。
   **两套下拉实现各有一份自己的判链与互斥代码**（本主题包的在 `components/ui/floatingChain.ts`
   与 `dropdownRegistry.ts`；`@mini-canvas/ui` 的在它自己的 `components/hooks/` 下）——
   插件相互独立，谁都不改核心层；两边**只共享 `data-floating-chain` 这个 DOM 契约**，
   所以两套浮层混在同屏也认得出父子关系。
