# 节点壳 BaseNode

**一句话**：画布上每一个节点的外形都由它画 —— 卡片、标题、端口、选中环、上/下控制栏，
全在这一件里决定。注册在主题槽 `nodeShell`（单赢家，`order: 0`）。

源码：`packages/plugins/plugin-theme-default/src/components/node/BaseNode.vue`。
它属于 AGENTS.md 里的**红线组件**（改坏会破坏核心交互），动之前先读行为契约金标准。

## 功能说明

## 活演示

`BaseNode` 是 VueFlow 渲染每个节点时套上的壳，**离开画布宿主渲染不出来** —— 所以下面嵌一块真画布（装了默认主题 + 示例节点），你在真环境里看它：

<script setup>
import MiniCanvasStage from '../../.vitepress/theme/demos/MiniCanvasStage.vue'
</script>

<MiniCanvasStage :height="360" />

> 能拖着玩：拖节点、悬停看浮动端口、双击标题就地改名、拉端口连线。

- **卡片外壳**：圆角、发丝边框、内阴影；声明 `frameless` 的节点类型会关掉那圈边框。
- **标题条**：图标 + 名称 + 右侧附加信息（分辨率之类）。双击就地改名（Enter 提交 / Esc 取消）。
- **端口**：左右浮动端口（真实的 VueFlow 连接点 + 可移动的半圆交互区），由
  [MovingHandle](/plugins/theme-components/moving-handle) 实现。
- **区域渲染位（十个）**：插件往节点上叠 UI 的**唯一**正规入口 ——
  `in` / `title` / `out:top` / `out:bottom` / `out:left` /
  `out:right` / `on:top` / `on:bottom` / `over:inset` / `over:outset`。
- **能力包**：每条区域条目可以声明 `needs: ['node','zoom','selection',...]`，
  由它按条目取袋并 provide 给子树（每个节点一份实例）。
- **其它**：低细节模式（缩小到一定程度只画框）、多选标记、可选拖拽缩放手柄、连接反馈高亮。

## Props

组件声明的是 `defineProps<NodeProps>()` —— 也就是 VueFlow 传给自定义节点组件的引擎 props，
**不是**本插件自定的接口。常用字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `string` | 节点 id（区域条目共享状态、读写节点都靠它） |
| `type` | `string` | 节点类型名（查类型定义、查区域条目都用它） |
| `data` | `Record<string, unknown>` | 节点业务数据（标题、内容字段都在里面） |
| `selected` | `boolean` | 是否被选中（选中环、端口常显、控制栏显隐） |
| `connectable` | `HandleConnectable` | 是否允许连线（会转发给真实端口） |
| `position` | `XYPosition` | 相对坐标（VueFlow 已标 deprecated，改看 `computedPosition`） |
| `dimensions` | `Dimensions` | DOM 实测尺寸 |
| `sourcePosition` / `targetPosition` | `Position` | 出/入端口方向（Top/Bottom/Left/Right） |

> 完整的 `NodeProps` 形状来自 `@vue-flow/core`，由 `@mini-canvas/canvas-render` 转出。

## Slots / 插槽

**没有 Vue 插槽。** 往节点上加东西走**区域注册**（见下），不走 `<slot>`。

区域分两条写路径（都按 `type/区域词` 落键，`type` 可以是 `'*'` 通配）：

```ts
// 写法一：注册进 node/region 场（不改节点类型定义，任何插件都能加）
ctx.registryOf('node/region').add('text/out:top', { component: MyToolbar }, { id: 'my-toolbar', order: 0 })

// 写法二：节点类型自己声明（注册类型时一起给）
ctx.nodes.register({ type: 'text', /* ... */ segments: { 'out:top': MyToolbar } })
```

十个区域词的位置含义：

| 区域词 | 位置 |
| --- | --- |
| `in` | 卡片内容区（**最常用**，节点的正文组件住这里） |
| `title` | 标题条（单格换肤点，取最外一条替换默认标题） |
| `out:top` / `out:bottom` | 卡片上缘 / 下缘之外，可叠加 |
| `out:left` / `out:right` | 卡片左右外侧 |
| `on:top` / `on:bottom` | 贴在卡片边框线上（进度条） |
| `over:inset` | 盖住整张卡片，**受卡片边界裁剪**（编辑浮层），与上下控制栏同级 |
| `over:outset` | 盖住整张卡且**允许超出卡片边界**（拖拽手柄、悬停放大） |

## 事件、方法或暴露能力

组件**不 emit 事件**、**不 defineExpose**。它的对外行为全部体现在：

- 内部读渲染上下文 `useCanvasRender()`（`nodeWrite` 写回、`handleParams` 端口外观、
  `interaction`、`registry`、`flow.viewport`）。
- 它把**能力包** provide 给区域条目子树（见 `packages/canvas-render/src/contracts/capabilities.ts`）。

> 想从外面"操作某个节点"，不要去戳这个组件：用 `ctx.get('doc')` 改数据、
> 用 `ctx.commands` 调命令、用 `ctx.get('nodeLayout')` 量尺寸。

## 使用方式与示例

它由主题槽装配，**你通常不直接用它**。你要做的是"往它画的节点上叠东西"。

```ts
// 文件：packages/my-plugin/src/myPlugin.ts
// 格式：TypeScript 模块（插件入口）
// 位置：一个插件包 —— 往 text 节点的顶部控制栏加一条自己的控件
import type { Context, PluginModule } from '@mini-canvas/canvas-base'
import MyToolbar from './MyToolbar.vue'

export const name = 'my-toolbar'
export const inject = [] as string[]

export function apply(ctx: Context): void {
  // ① 按「类型/区域词」落键；order 小者靠外
  const region = ctx.registryOf<{ component: unknown; props?: Record<string, unknown>; needs?: string[] }>('node/region')
  region.add('text/out:top', { component: MyToolbar }, { id: 'my-toolbar', order: 10 })
}

export const myToolbarPlugin: PluginModule = { name, inject, apply }
```

```vue
<!-- 文件：packages/my-plugin/src/MyToolbar.vue -->
<!-- 格式：Vue 单文件组件 -->
<!-- 位置：被上面的区域条目渲染的一条控件；它只拿自己声明过的能力 -->
<script setup lang="ts">
import { useCapability } from '@mini-canvas/canvas-render'
// 声明 needs 后，从能力袋按名取（@see RegionEntryHost）
const node = useCapability('node')
</script>

<template>
  <button type="button" @click="node.write({ label: '被改过了' })">改标题</button>
</template>
```

> 想让条目拿到能力包，注册时把 `needs` 一起写进值里：`region.add(key, { component, needs: ['node'] }, { id })`。

## 注意事项

1. **这是红线组件**。它的行为契约有专门的 66 条不变量文档（`docs/tmp/canvas-core-v2-survey/core-node-contract.md`），
   改端口几何前必须先读，尤其 §9「端口区默认值双源漂移」。
2. **老段名已下线**：`content` / `top-toolbar` / `bottom-toolbar` / `overlay`
   传进去会**当场抛错**（不静默忽略），改用十个区域词。
3. **区域场是非响应式的普通对象**：组件内部订了它的变更事件来驱动重渲染，所以运行期直接 `add`
   也会立刻出现；但别指望在模板里像 ref 那样直接用。
4. **同一区域可以叠多层**：按 `order` 升序（小者在外），同 id 会去重。
5. **标题条只有单格换肤**：往 `title` 区域注册会用你那条替换默认标题条，
   想"保留默认再叠东西"要用别的区域。
