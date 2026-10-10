
# 交互状态 interactionState

**一句话定位**：**`interactionState` 是画布的「此刻正在发生什么」广播台 —— 拖节点、平移画布、缩放、框选、拖 resize 柄，每一件都有一面旗子；UI 和主题组件读这些旗子决定「这时候该藏什么、该压什么」。**

**它属于哪一档**：**渲染层的能力（canvas-render），由画布宿主维护**。源码：`packages/canvas-render/src/contracts/interactionContext.ts`（状态契约 + 驱动函数）、`host/CanvasHost.vue`（谁在写）、`host/CanvasSurface.vue`（塞进渲染上下文）。消费方写在自己的插件 / 组件里。

## 它是什么

类比：它是画布墙上的一排**指示灯**。以前只有「有人正在拖线」这一盏（那是另一套 `connectionState`），别的动作发生什么外界一概不知。现在这排灯有六面：

```
activity = {
  nodeDragging:  false, nodeDragId:   null,   // 有人在拖某个节点
  nodeResizing:  false, nodeResizeId: null,   // 有人在拖某个节点的 resize 柄
  paneDragging:  false,                      // 画布在平移（或滚轮/捏合缩放）
  zooming:       false,                      // 缩放手势位（留给将来细分）
  edgeDragging:  false, edgeDragId:   null,  // 重连一条边（已占位，交互暂未启用）
  selecting:     false,                      // 框选 / 多选手势进行中
}
```

**关键设计：多面旗子可以同时亮**，不是「一个状态机只允许一个值」。手势本来就能叠加（拖节点时手指掠过另一个节点、拖线时画布也在动），用一个 enum 表达会立刻遇到「该算哪个」的争执。每面旗子还带一个「指向谁」的 id（例如 `nodeResizeId`）。

## 为什么需要它

三个真实场景，都是踩过的坑：

**场景一：拖节点时，那些「浮在卡片外面的控制栏」会乱飞。** 节点上下控制栏挂在卡片外侧，拖动时它们跟着卡片跑、多选拖动时一排卡各刷出一片。用户的要求原话是「不管拖拽的是哪一个节点，都不应该显示这边的上下控制」。

**场景二：resize 时控制栏正挡在指针经过的地方。** 拖右下角改尺寸时，那排按钮会被甩走 —— 用户要求「节点 resize 的时候不显示上下的控制栏」。

**场景三：分组节点的控制栏住在卡片外面，读不到壳里的局部状态。** 普通节点的壳自己有 `isResizing` 就能压住控制栏；但分组节点的控制栏挂在画布级 overlay 槽（节点之外那层），它拿不到壳的局部变量。**必须有共享状态**，两条路径读同一份信号才一致。

## 怎么用

### 一、状态形状（`CanvasInteractionState`）

除了上面那排旗子，它还给了**派生便捷读**（全是 `ComputedRef<boolean>`，组件一把读，不必自己拼多面旗子）：

| 派生读 | 等价于 |
| --- | --- |
| `isNodeDragging` | `activity.nodeDragging` |
| `isNodeResizing` | `activity.nodeResizing` |
| `nodeResizeId` | `ComputedRef<string \| null>`，正在被 resize 的节点 id |
| `isPanning` | `activity.paneDragging` |
| `isZooming` | `activity.zooming` |
| `isEdgeDragging` | `activity.edgeDragging` |
| `isSelecting` | `activity.selecting` |
| `isBusyDragging` | 任一「物理拖拽手势」（节点拖 / resize / pan / 边拖 / 框选） |
| `isBusy` | 比 `isBusyDragging` 更宽：再加 `zooming`（含非拖拽手势） |

### 二、怎么拿到它（消费方）

```ts
// 片段：任何渲染子树里的组件（真实写法见 packages/plugins 下的浮层组件）
import { useCanvasRender } from '@mini-canvas/canvas-render'

const { interaction } = useCanvasRender()

// ① 直接读派生位（推荐）
const hideBars = computed(() => interaction.isNodeDragging.value)

// ② 需要知道「是谁」时读具体位
const isSelfResizing = computed(() => interaction.nodeResizeId.value === props.id)

// ③ 原样转发给纯函数（把判定逻辑收进可单测的函数里）
const visible = computed(() => resolveVisible({
  selecting: interaction.isSelecting.value,
  dragging:  interaction.isNodeDragging.value,
  resizingId: interaction.nodeResizeId.value,
}))
```

> 防御式读法：有些组件会写 `interaction?.isSelecting?.value === true` —— 这是在兼容「单测 / 极简宿主的渲染上下文桩里没有 interaction」的情况。生产宿主永远会给它，正常写即可。

### 三、谁在写（宿主侧，逐条对着源码）

写入分两类：**宿主接住 VueFlow 事件写**，和**组件自己写**。

| 谁写 | 触发时机 | 写了什么 |
| --- | --- | --- |
| `CanvasHost.vue` 的 `onNodeDragStart` | 用户按下并开始拖某个节点 | `beginNodeDrag(interaction, e.node.id)` |
| `CanvasHost.vue` 的 `onNodeDragStop` | 拖动结束 | `endNodeDrag(interaction)` |
| `CanvasHost.vue` 的 `onMoveStart` | 画布平移 / 滚轮缩放开始（VueFlow 同一套 move 事件） | `beginViewportMove(interaction)` |
| `CanvasHost.vue` 的 `onMoveEnd` | 视图移动结束 | `endViewportMove(interaction)` |
| `CanvasHost.vue` 的 `resetViewportMoveIfIdle` | 指针抬起 / 窗口失焦 / 页面隐藏（**兜底自愈**） | `endViewportMove(interaction)` |
| `plugin-multi-select/src/BoxSelectLayer.vue` | 自绘框选开始 / 结束 / 拖动中被卸载 | `beginSelecting` / `endSelecting` |
| `plugin-theme-default/src/components/node/BaseNode.vue` | 节点壳的 resize 拖柄按下 / 松开 | `beginNodeResize(interaction, props.id)` / `endNodeResize(interaction, props.id)` |

**为什么 `paneDragging` 需要兜底**（这段逻辑值得单独记住）：VueFlow 偶尔会漏发 `move-end`，那面旗子就会**永久卡在 true** —— 于是所有拿它当门的东西（比如端口按钮的显隐）被永久压死。所以宿主在任何「指针抬起 / 窗口失焦 / 页面隐藏」时无条件清一次：那一刻视图不可能还在移动，清了也安全（真在动会由 `move-start` 重新置位）。

### 四、驱动函数逐个看（签名逐字来自 `contracts/interactionContext.ts`）

| 函数 | 签名 | 干什么 |
| --- | --- | --- |
| `createInteractionState` | `(): CanvasInteractionState` | 建一份状态（ref + 派生 computed） |
| `updateActivity` | `(state, patch: Partial<InteractionActivity>): void` | 只更新给到的几位，其它位原样保留 |
| `clearActivity` | `(state): void` | 全部清零（回到全 idle） |
| `emptyActivity` | `(): InteractionActivity` | 造一份「空」活动位对象 |
| `beginNodeDrag` | `(state, nodeId: string): void` | 亮 `nodeDragging` + 记被拖节点 id（多选拖动传代表节点） |
| `endNodeDrag` | `(state): void` | 灭 `nodeDragging` + 清 id |
| `beginNodeResize` | `(state, nodeId: string): void` | 亮 `nodeResizing` + 记 id（**由节点壳自己调**，渲染层不掺 resize 业务） |
| `endNodeResize` | `(state, nodeId?: string): void` | 传 id 时**只在当前正在 resize 的就是它**才清（幂等 + 防误清）；不传则无条件清空（宿主级兜底） |
| `beginViewportMove` | `(state): void` | 亮 `paneDragging`（pan 与滚轮/捏合共用这一位） |
| `endViewportMove` | `(state): void` | 灭 `paneDragging` |
| `beginSelecting` | `(state): void` | 亮 `selecting` |
| `endSelecting` | `(state): void` | 灭 `selecting` |

`endNodeResize` 那条「传了 id 就只清自己」的语义值得抄进自己的代码：**多个节点实例各自持有会话**，A 的 `pointerup` 不该抹掉 B 的标记。

### 五、消费点：谁在读它（真实文件）

| 谁读 | 读哪一位 | 用它干什么 |
| --- | --- | --- |
| `plugin-theme-default/src/components/node/BaseNode.vue` | `isSelecting` / `nodeResizeId` / `isNodeDragging` | 收起上下控制栏（`hideToolbars` / `hideSlotBars`） |
| `plugin-bottom-bar/src/NodeBottomBarOverlay.vue` + `bottomBarOverlay.ts` | `isSelecting` / `nodeResizeId` / `isNodeDragging` | 底栏浮层的显隐门（框选中 / 多选 / 该节点 resize 中 / 画布上有节点在拖 → 收起） |
| `plugin-align-guide/src/AlignGuideOverlay.vue` | `isNodeDragging` | 拖拽结束的权威信号：翻成 false 就统一清掉对齐线 |
| `plugin-multi-select/src/SelectionFrame.vue` | `isSelecting` / `isNodeDragging` | 框选中不显示选择框；拖动中继续跟随 |
| `plugin-multi-select/src/BoxSelectLayer.vue` | `interaction`（写 + 读） | 自绘框选：自己起手写 `beginSelecting` |
| `plugin-group/src/GroupTopToolbarOverlay.vue` | `nodeResizeId` | 判断「被 resize 的是不是我」—— 分组控制栏住在节点外，只能读这份共享状态 |

### 六、`isBusyDragging` 与 `isBusy` 的取舍（容易用错）

```
isBusyDragging = 节点拖 | resize | pan | 边拖 | 框选      ← 都是「按下 + 拖动」类手势
isBusy         = 上面全部 + zooming                        ← 更宽，覆盖滚轮这类非拖拽手势
```

真实代码里有一条**明确的告诫**：《不要用 `isBusyDragging` 当端口压制门》。原因写在 `plugin-multi-select/src/SelectionFrame.vue` 与 `BaseNode.vue` 的注释里：它把 `paneDragging` 也算进去，而 `paneDragging` 与滚轮缩放共用 VueFlow 的 move 事件 —— 用户滚一下轮就会被误判成「正在拖拽」，且一旦漏发 `move-end` 就会永久卡 true。

所以选门的口诀是：**要「谁在拖节点上的东西」→ 读 `isNodeDragging`；要「指针是不是按着」→ 用自己插件的指针按下状态；要「整块画布忙不忙」→ 才用 `isBusyDragging` / `isBusy`。**

## 会在哪里用到

| 文件 | 它在干什么 |
| --- | --- |
| `packages/canvas-render/src/contracts/interactionContext.ts` | 状态契约 + 12 个驱动函数 |
| `packages/canvas-render/src/host/CanvasHost.vue` | `createInteractionState()` 建一份；在 nodeDragStart/Stop、moveStart/End、兜底复位里写 |
| `packages/canvas-render/src/host/CanvasSurface.vue` | 把它塞进 `renderCtx.interaction` |
| `packages/canvas-render/src/contracts/renderContext.ts` | `CanvasRenderContext.interaction` 字段的类型与注释 |
| `packages/canvas-render/src/contracts/__tests__/interactionContext.test.ts` | 状态与驱动函数的单测 |
| `packages/plugins/plugin-multi-select/src/BoxSelectLayer.vue` | 唯一「组件自己写」的生产例子（框选） |
| `packages/plugins/plugin-theme-default/src/components/node/BaseNode.vue` | 主要消费方（控制栏显隐 + resize 起手上报） |

## 完整例子

一个**真能跑**的插件：拖动任意节点时在画布右上角显示「正在拖动 n1」，并顺手把上下控制栏的判定逻辑收进可单测的纯函数。

### 目录长这样

```
plugin-interaction-demo/
├── package.json               # 插件清单
└── src/
    ├── index.ts               # 插件入口：往 overlay 槽挂状态角标
    ├── DragStatusBadge.vue    # 角标组件：读 interaction 的几位并显示
    └── visibility.ts          # 纯函数：把活动位翻译成「该不该显示」（可单测）
```

（这一篇的例子是单一插件，正文两个文件就是全部内容，照抄即可。）

### 文件一：清单

```json
// 文件：plugin-interaction-demo/package.json
// 格式：JSON（npm 包清单）
// 位置：插件包根目录
{
  "name": "plugin-interaction-demo",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "miniCanvas": {
    "title": "交互状态角标",
    "description": "读 interaction 显示画布此刻在干什么",
    "pluginName": "interaction-demo",
    "installable": true
  },
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": { "types": "./src/index.ts", "default": "./src/index.ts" } },
  "dependencies": { "@mini-canvas/canvas-base": "workspace:*" },
  "peerDependencies": { "@mini-canvas/canvas-render": "workspace:*", "vue": "^3.5.34" }
}
```

### 文件二：纯函数（把「谁在忙」翻成「显示什么」）

```ts
// 文件：plugin-interaction-demo/src/visibility.ts
// 格式：TypeScript 模块（纯函数，零 Vue，可单测）
// 位置：插件内部 —— 判定逻辑不写在组件里，方便测试与复用
export interface ActivitySnapshot {
  nodeDragging: boolean
  nodeDragId: string | null
  nodeResizeId: string | null
  selecting: boolean
  panning: boolean
}

export function activityText(s: ActivitySnapshot): string {
  // ① 明确的优先级：resize > 拖节点 > 框选 > 平移，同时发生时显示最「具体」的那一个
  if (s.nodeResizeId) return '正在改尺寸：' + s.nodeResizeId
  if (s.nodeDragging) return '正在拖动：' + (s.nodeDragId ?? '（未知节点）')
  if (s.selecting) return '正在框选'
  if (s.panning) return '正在平移画布'
  return '空闲'
}
```

### 文件三：角标组件

```vue
<!-- 文件：plugin-interaction-demo/src/DragStatusBadge.vue
     格式：Vue 单文件组件（挂在 overlay 槽，由 SlotHost 渲染）
     位置：插件包内部 —— 只读交互状态，不写 -->
<script setup lang="ts">
import { computed } from 'vue'
import { useCanvasRender } from '@mini-canvas/canvas-render'
import { activityText } from './visibility'

const { interaction } = useCanvasRender()

// ① activity 是 Ref，先取 .value；② 派生位也是 Ref，同样 .value
const text = computed(() =>
  activityText({
    nodeDragging: interaction.activity.value.nodeDragging,
    nodeDragId: interaction.activity.value.nodeDragId,
    nodeResizeId: interaction.nodeResizeId.value,
    selecting: interaction.isSelecting.value,
    panning: interaction.isPanning.value,
  }),
)
</script>

<template>
  <!-- overlay 那层不接鼠标，角标只显示状态 -->
  <div class="isd-badge" data-testid="interaction-badge">{{ text }}</div>
</template>

<style scoped>
.isd-badge {
  position: absolute; right: 12px; top: 12px; padding: 2px 8px; border-radius: 6px;
  background: rgba(0, 0, 0, 0.55); color: #fff; font-size: 12px; pointer-events: none;
}
</style>
```

### 文件四：插件入口

```ts
// 文件：plugin-interaction-demo/src/index.ts
// 格式：TypeScript 模块（插件入口：导出 name / inject / apply）
// 位置：一个可安装插件包的源码入口
import type { Context, PluginModule } from '@mini-canvas/canvas-base'
import DragStatusBadge from './DragStatusBadge.vue'

export const name = 'interaction-demo'
export const inject = [] as string[]   // ① 交互状态不是服务：它从渲染上下文来，不进 inject

export function apply(ctx: Context): void {
  // ② 挂 overlay 槽：CanvasSurface 里那一行 SlotHost 会渲染它
  ctx.slots.register('overlay', {
    id: 'interaction-demo/badge',
    order: 5,          // 比别人的角标更靠前（order 越小越靠前）
    component: DragStatusBadge,
  })
}

/** 兼容旧装配的 PluginModule 出口 */
export const interactionDemoPlugin: PluginModule = { name, inject, apply }
```

### 怎么验证

1. 装上插件后，画布右上角出现角标，初始显示「空闲」。
2. 按住一个节点拖动：角标变成「正在拖动：<节点 id>」，松手立刻回到「空闲」。
3. 按住画布空白拖动（平移）：显示「正在平移画布」。
4. 选一个可 resize 的节点（如文本节点）拖右下角拖柄：显示「正在改尺寸：<节点 id>」（这面旗子是**节点壳自己**写的）。
5. 单测纯函数（不依赖浏览器）：

```ts
// 文件：plugin-interaction-demo/src/__tests__/visibility.test.ts
// 格式：TypeScript 测试模块（vitest）
// 位置：验证优先级（resize 盖过拖节点、拖节点盖过平移）
import { describe, expect, it } from 'vitest'
import { activityText } from '../visibility'

describe('activityText', () => {
  it('resize 优先于拖动', () => {
    expect(activityText({ nodeDragging: true, nodeDragId: 'n1', nodeResizeId: 'n2', selecting: false, panning: false }))
      .toBe('正在改尺寸：n2')
  })
  it('全 idle 显示空闲', () => {
    expect(activityText({ nodeDragging: false, nodeDragId: null, nodeResizeId: null, selecting: false, panning: false }))
      .toBe('空闲')
  })
})
```

## 常见坑

1. **`interaction` 不是 ctx 服务**。它挂在渲染上下文里（`useCanvasRender().interaction`），`ctx.get('interaction')` 拿不到。它是「已就绪的渲染数据」，不是可替换的服务。
2. **写状态别只写一半**。用 `updateActivity(state, { nodeDragging: true })` 时只有这一位变，`nodeDragId` 还是旧值 —— 所以成对的「亮/灭」要用 `beginXxx` / `endXxx` 这组函数（它们把 id 一起管理）。
3. **`endNodeResize` 传 id 是「只清自己」**。这是防误清：A 节点松手不该抹掉 B 的 resize 标记。宿主级兜底（会话异常中断）才不传 id 无条件清。
4. **`paneDragging` 混了 pan 与滚轮缩放**。VueFlow 的 pan 和 wheel/pinch 缩放共用同一套 move 事件，所以这一位是「视图在动」的意思，不是严格的「在拖画布」。要细分请用 `zooming`（目前保留给将来）。
5. **别拿 `isBusyDragging` 当「端口显隐门」**。它含 `paneDragging`，滚一下就误判；而且它一旦因漏发 `move-end` 卡住，会把依赖它的显隐门永久压死。要「有没有节点在拖」就读 `isNodeDragging`。
6. **旗子可以同时亮，读的时候要自己定优先级**。示例里 `activityText` 就是显式的优先级列表 —— 别写成「if/else 随便挑一个」，否则两个手势叠加时显示会飘。
