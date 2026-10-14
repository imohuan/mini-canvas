# 浮动端口 MovingHandle

**一句话**：节点左右两侧那个"会跳出来跟着鼠标走的圆球" —— 它是**真实的 VueFlow 连接点**
外面包了一层半圆交互区，鼠标进入区域时圆球从卡片边缘跳出、跟随鼠标，离开后归位淡出。

它注册在两处：主题槽 `nodeShell` 由 [BaseNode](/plugins/theme-components/base-node) 内部使用；
`ui` 目录名 `movingHandle` 供插件按名取（如多选框的批量连线端口）。

源码：`packages/plugins/plugin-theme-default/src/components/node/MovingHandle.vue`（红线组件）。

## 功能说明

- **锚点 + 交互区 + 圆球**三件套：锚点是 1×1px 的真实 `<Handle>`；交互区是半圆（或矩形）区域；
  圆球是给用户看与点的可见物。
- **跟随动画带滞回**：球每帧按比例靠近鼠标，不是瞬移 —— 有"追着跑"的手感。
- **归位**：鼠标离开 180ms 内球回静止位并淡出（`restoreDuration`）。
- **两种模式**：
  - 正常模式：底层就是真实 VueFlow `<Handle>`，能真正连出线；
  - `preview` 模式：**只复用外观**，不注册真实连接点，改为 emit `connectStart` ——
    给"挂在插件自己浮层上的临时端口"用（多选框的批量连线端口就是它）。
- **硬压制** `blocked`：为 true 时**整个端口区不接指针事件**（不只是按钮不亮）。
  为什么要它：那圈透明"吸附接收区"（约 87×176）原本始终 `pointer-events: all`，
  多选/抓手/低细节时按钮虽已隐藏，按住那块看不见的区域照样能拖出连线。
- **调试可视化** `debug`：画半圆、圆心、静止点、鼠标点辅助线。

## Props

| 字段 | 类型 | 缺省 | 说明 |
| --- | --- | --- | --- |
| `id` | `string` | 必填 | 端口 id（VueFlow 连接点身份） |
| `type` | `'source' 或 'target'` | 必填 | 出端口或入端口 |
| `position` | `Position` | 必填 | 端口方向（Left/Right/Top/Bottom） |
| `visible` | `boolean?` | `undefined` | 只控制圆球 opacity（**不控指针**） |
| `disabled` | `boolean?` | `undefined` | 禁用 |
| `radius` | `number?` | `76` | 半圆交互区半径（px） |
| `restOffset` | `number?` | `36` | 静止位：球心距节点边缘的距离（px） |
| `cursorGap` | `number?` | `24` | 跟随时球心与鼠标之间保留的间隙（px） |
| `buttonSize` | `number?` | `32` | 圆球尺寸（px） |
| `overlap` | `number?` | `buttonSize / 2` | 圆球收进卡内的距离（px，仅静止/归位位用） |
| `selected` | `boolean?` | `undefined` | 节点被选中 → 圆球常显（不依赖区域 hover） |
| `blocked` | `boolean?` | `undefined` | **整块端口区不接指针事件**（见功能说明） |
| `zoneWidth` | `number?` | `radius` | 交互区宽 |
| `zoneHeight` | `number?` | `radius` | 交互区高 |
| `zoneOffset` | `number?` | `0` | 交互区偏移 |
| `zoneShape` | `'rect' 或 'arc'` | `'arc'` | 交互区形状 |
| `zoneArcRatio` | `number?` | `1` | 半椭圆弧的垂直胖瘦（0.2–1；1 = 正半圆） |
| `preview` | `boolean?` | `undefined` | 只复用外观，不注册真实连接点 |
| `debug` | `boolean?` | `undefined` | 画调试辅助线 |

## Slots / 插槽

**没有插槽。**

## 事件、方法或暴露能力

| 事件 | 载荷 | 说明 |
| --- | --- | --- |
| `hover` | `boolean` | 交互区 hover 进出 |
| `connectStart` | `{ event: MouseEvent, type: 'source' 或 'target' }` | **只在 `preview` 模式下**：用户按下预览端口，宿主据此开始自己的连线流程 |

暴露方法（`defineExpose`）：

| 方法 | 签名 | 说明 |
| --- | --- | --- |
| `handleCardLeave` | `(fromInside: boolean) => void` | 父层（BaseNode 卡片根 `mouseleave`）调用，做"从卡片方向离场"的兜底归位 |

> 为什么需要 `handleCardLeave`：起点在卡内、往卡内更深处走的鼠标出不去"交互区的那条边"
> （它从区域最内端起就在区域内），只靠区域的 leave 会把球永远留在卡内一侧。

## 使用方式与示例

```vue
<!-- 文件：packages/my-plugin/src/BatchConnectPort.vue -->
<!-- 格式：Vue 单文件组件（script setup lang="ts"） -->
<!-- 位置：插件浮层上的一个"临时端口" —— 复用默认主题的端口外观开始批量连线 -->
<script setup lang="ts">
import { useUiComponent } from '@mini-canvas/canvas-render'

// preview 模式：不注册真实连接点，只在按下时把事件交给我
const MovingHandle = useUiComponent('movingHandle')

function onConnectStart(payload: { event: MouseEvent; type: 'source' | 'target' }): void {
  // 自己接管拖线过程（例如批量连到选中的多个节点）
  console.log('开始连线', payload.type)
}
</script>

<template>
  <MovingHandle
    id="__batch_port__"
    type="source"
    position="Right"
    preview
    :button-size="32"
    @connect-start="onConnectStart"
  />
</template>
```

## 注意事项

1. **红线组件**：端口几何有"双源漂移"历史（宿主回落 `portZoneWidth = 86` 与本插件 Config 默认 `10`），
   动端口前必须先对齐 —— 见 `docs/tmp/canvas-core-v2-survey/core-node-contract.md` §9。
2. **`visible` 与 `blocked` 是两件事**：前者只让球变透明，那块区域**照样能点**；
   要真正不能连必须用 `blocked`。这是当年"按钮藏了还能拖出线"那个 bug 的修法。
3. **`position` 必须与节点实际端口方向一致**：写死方向会让跟随与停靠位置算错。
4. **`preview` 模式没有任何连接语义**：真实连线全靠你接 `connectStart` 自己实现。
5. **端口只在"移动工具"下显示**：抓手模式下 `BaseNode` 会把端口算成 `blocked`
   （用户要求：抓手模式拖动是平移画布，端口留着只会误导）。
