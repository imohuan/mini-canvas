# 连线 CustomEdge

**一句话**：画布上每一条连线的样子都由它画 —— 普通线、流光动画、箭头、选中加亮、
双击弹出的"剪切"按钮；拖线时那根临时线也是它画的（见
[ConnectionLine](/plugins/theme-components/connection-line)）。注册在主题槽 `edge`。

源码：`packages/plugins/plugin-theme-default/src/components/edge/CustomEdge.vue`（红线组件）。

## 功能说明

## 活演示

`BaseNode` 是 VueFlow 渲染每个节点时套上的壳，**离开画布宿主渲染不出来** —— 所以下面嵌一块真画布（装了默认主题 + 示例节点），你在真环境里看它：

<script setup>
import MiniCanvasStage from '../../.vitepress/theme/demos/MiniCanvasStage.vue'
</script>

<MiniCanvasStage :height="360" />

> 两条连线之间就是 `CustomEdge` 画的（流光、导轨、选中加亮）。试着点选节点看它变亮，或双击连线弹剪切钮。

- **路径**：`bezier` / `straight` / `step` / `smoothstep` 四种，默认 bezier。
- **外观**：线宽、虚线、箭头、辉光；以及"导轨 + 青色光斑沿线流动"的流光动画。
- **颜色两格制**：线色/流光色不在插件 Config 里，而在渲染层主题色板
  （`edgeRailColor` / `edgeFlowColor`，亮/暗各一格）。用 `useThemeColor` 取值，
  所以 SVG 的 `stroke` 这种"不吃 CSS 变量"的属性也能跟着换主题。
- **交互**：加宽透明点击热区（隐藏连线时仍可选中）、双击弹出剪切钮（走 `command:delete-edge` 命令）。
- **临时线语义**：`temporary` 或内核通用契约 `data.transient` 的边按"临时线"处理 ——
  永不被"隐藏连线"遮住、不参与高亮与剪切、不渲染点击热区。

## Props

组件声明的是 `CustomEdgeProps`：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `string?` | 边 id（剪切命令要用它） |
| `source` / `target` | `string?` | 起点/终点节点 id |
| `sourceX` / `sourceY` / `targetX` / `targetY` | `number?` | 两端坐标（缺省 0） |
| `sourcePosition` / `targetPosition` | `string?` | 两端端口方向；**必须来自 VueFlow**，写死会让曲线反向弯 |
| `sourceHandleId` / `targetHandleId` | `string \| null?` | 端口 id |
| `data` | `Record<string, unknown> \| null?` | 边数据（`transient` 标记在这里） |
| `selected` | `boolean?` | 是否被选中（选中/相连加亮） |
| `temporary` | `boolean?` | 临时线（拖线预览）；由 ConnectionLine 传 true |
| `forceFlow` | `boolean?` | 强制开流光 |
| `visual` | `EdgeVisual?` | 逐条覆盖外观（与上下文里那一份合并，本字段优先） |
| `geometry` | `EdgeAppearance?` | 几何/外观覆盖 |

> `EdgeVisual` 全字段（`edgeType` / `edgeLineWidth` / `edgeColor` /
> `edgeDashed` / `edgeMarkerEnd` / `edgeMarkerSize` / `edgeVisible` /
> `edgeVisibleOnSelect` / `edgeOnTop` / `edgeGlowEnabled` / `edgeGlowIntensity` /
> `edgeGlowColor` / 流光族字段）定义在
> `packages/canvas-render/src/contracts/edgeContext.ts`。

## Slots / 插槽

**没有插槽。** 连线是 SVG 内的自绘件，外形由 props + 主题色板 + 插件 Config 决定。

## 事件、方法或暴露能力

组件**不 emit**、**不 defineExpose**。它的两个"对外动作"是：

| 交互 | 结果 |
| --- | --- |
| 双击连线 | 在指针处弹出剪切按钮（内部状态） |
| 点剪切按钮 | 执行命令 `command:delete-edge`，payload `{ edgeId }` |

> 想程序化删边：调命令，别去操作这个组件。
> `ctx.commands.execute('command:delete-edge', { edgeId })`

## 使用方式与示例

它由主题槽装配，**你不直接用它**。常见的两种"用法"是换掉它、或给某些边单独改外观。

```ts
// 文件：packages/my-plugin/src/myEdgeTheme.ts
// 格式：TypeScript 模块（插件入口）
// 位置：一个换皮插件 —— 用自己画的边顶替默认边
import type { Context, PluginModule } from '@mini-canvas/canvas-base'
import MyEdge from './MyEdge.vue'

export const name = 'my-edge-theme'
export const inject = [] as string[]

export function apply(ctx: Context): void {
  // order 比默认皮(0)小 → 顶替默认边；卸掉本插件，默认边立刻回来
  ctx.theme.add('edge', MyEdge, { order: -1 })
}

export const myEdgeTheme: PluginModule = { name, inject, apply }
```

```ts
// 文件：packages/my-plugin/src/edgeVisualBootstrap.ts
// 格式：TypeScript 模块（插件入口）
// 位置：一个插件 —— 运行时给某几条边单独设外观（本字段优先于全局配置）
ctx.get('doc') // 画布数据门面；边的 data 里可以带 visual 覆盖
```

## 注意事项

1. **红线组件**：改它的路径几何/热区会连带影响选中与剪切，动前先读行为契约金标准。
2. **两格制色板**：线色写进 Config 会永远盖住主题色板（登记过就有值、不再回落），
   这正是它当初被上移进 `themePalette` 的原因 —— 想改线色请改主题色板。
3. **临时线与正式边是同一个组件**：改外观会同时改到两者，这是**有意**的
   （拖出来的线和落成的线看起来必须一模一样）。
4. **`sourcePosition` 不能写死**：从左侧端口拖出时写死 `Right` 会让贝塞尔控制点朝内、曲线弯反。
5. **隐藏连线的定位**：`edgeVisible: false` 时线不可见但**点击热区仍在**，这样仍能选中与双击删除。
