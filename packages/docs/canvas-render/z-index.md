
# 画布层级 z-index

**一句话定位**：**「谁盖住谁」在画布里有四层不同的账本：节点之间看 VueFlow 的 `zIndex`、连线看宿主算的 `zIndex`、画布与外壳之间看 CSS `z-index`、节点内部看壳自己的 scoped 样式。改错了地方，数字加到一万也不会生效。**

**它属于哪一档**：**渲染层（canvas-render）的层级规则**，横跨 `canvasHostCore.ts` / `CanvasHost.vue` / `CanvasSurface.vue` / 主题壳组件 / 应用外壳。

## 先记住这条硬规则（不记住就会白改）

浏览器有一条规矩：**只要一个元素成了「层叠上下文」，它内部的 z-index 就全被关在门里，压不过外面的兄弟。**

画布里有两道这样的门：

| 是谁 | 为什么成为上下文 | 后果 |
| --- | --- | --- |
| `.vue-flow`（画布根） | 自带 `z-index: 0`（见 `@vue-flow/core/dist/style.css`） | 画布**里面**的 z 再大，也压不过画布**外面**的兄弟（`.csurface-overlay`、应用外壳的底栏…） |
| `.vue-flow__node`（每个节点） | 带 `transform`（VueFlow 用它定位节点） | 节点**内部**的 z 再大，也压不过节点**外面**的兄弟（连线、别的节点） |

**所以结论只有一句**：想让「节点里的某个东西」压过「节点外的东西」→ **加数字没用，必须把它挪出那层上下文**（挪到画布级浮层）。真实例子：节点底栏、分组控制栏、多选框都是这么改的 —— 见 `plugin-bottom-bar/src/NodeBottomBarOverlay.vue` 与 `plugin-group/src/GroupTopToolbarOverlay.vue` 的文件头注释（那里写明了踩过的现象与原因）。

## 它是什么：四本账

| 账本 | 谁盖住谁 | 在哪定 | 值 |
| --- | --- | --- | --- |
| ① 节点之间 | 分组容器 < 普通节点 < 选中节点 < 临时菜单卡 | `canvasHostCore.ts` 的 `nodesFromStore` | `-3 / -2`、`10`（`NODE_Z`）、`20`（`NODE_SELECTED_Z`）、`1001` |
| ② 连线 | 普通边（不写 z）→ 中间态边 `1000` → 「连线置顶」`1001` | `canvasHostCore.ts` 的 `edgesFromStore` + `CanvasHost.vue` 的 `syncFromStore` | `1000` / `1001` |
| ③ 画布 ↔ 外壳/浮层 | 画布 < 画布浮层 < 底栏/状态条 < 顶栏 < 模态/菜单 | `CanvasSurface.vue`、`packages/ui/src/components/CanvasShell.vue`、各浮层组件 | `20` / `30` / `60` / `100000` |
| ④ 节点内部 | 内容 < 标题条 < 吸附带 < 编辑浮层 < 控制栏 … | 主题壳的 scoped 样式（`BaseNode.vue` / `MovingHandle.vue`） | `0/3`、`21/22`、`25/26`、`30` 等 |

## 怎么用：改哪一层的层级 → 动哪个文件

### ① 节点之间 → `canvasHostCore.ts`

```ts
// 文件：packages/canvas-render/src/host/canvasHostCore.ts（节选，逐字来自源码）
export const NODE_Z = 10            // 普通节点（所有未选中节点同一层）
export const NODE_SELECTED_Z = 20   // 选中节点：抬一档，但仍在置顶连线（1001）之下
```

```ts
// 同一文件：nodesFromStore 里给每个节点算 z
const out = {
  id: n.id,
  // …
  zIndex: selected ? NODE_SELECTED_Z : NODE_Z,
}
// 容器型类型（transparent，例如分组）按嵌套深度垫到下面：
if (store.types.get(n.type)?.transparent === true) {
  out.zIndex = depth === 0 ? -3 : -2
}
// 中间态节点（拖线落空白的菜单卡）：恒在最上层
if (isTransient(n)) { out.zIndex = 1001 }
```

**为什么普通节点要 10、选中要 20**（源码注释里写了原因）：不给选中节点更高 z 时，所有节点 z 相同，谁在上面只由 DOM 顺序决定 —— 后建的节点会盖住选中的节点。抬一档但**仍在置顶连线（1001）之下**，这样「连线显示在最上层」打开时依旧压得过选中节点。

配套还有一行开关在 `CanvasSurface.vue` 的 `<VueFlow>` 上：**`:elevate-nodes-on-select="false"`**。这是 VueFlow 自带的「选中自动抬层」，我们**故意关掉**，改由 `nodesFromStore` 自己给值（否则会和置顶连线 1001 打架：引擎那一套是 +1000，顺序会翻）。

### ② 连线 → `CanvasHost.vue` 的 `syncFromStore`

```ts
// 文件：packages/canvas-render/src/host/CanvasHost.vue（节选）
const edgeOnTop = (edgeVisualToProvide as { edgeOnTop?: boolean } | undefined)?.edgeOnTop ?? false
edges.value = edgesFromStore(h.edgeStore.getEdges(), alive).map((e) =>
  // 连线置顶：VueFlow 每条边是独立的 svg，zIndex 越高越盖过节点层
  edgeOnTop ? { ...e, zIndex: 1001 } : e,
)
```

| 情况 | z | 说明 |
| --- | --- | --- |
| 普通边 | **不写**（`undefined`） | 与节点同层，靠 DOM 顺序落在节点下面 |
| 中间态边（拖线占位） | `1000` | 由 `edgesFromStore` 的 `isTransient` 分支给（同时 `selectable/focusable/deletable` 全关） |
| 「连线显示在最上层」打开 | `1001` | 压过所有节点 |

**1001 是锚点值**：节点选中抬层（20）、临时菜单卡（1001）、拖线临时线的 CSS 层（VueFlow 自带的 `.vue-flow__connectionline { z-index: 1001 }`）都按它定位。改它必须连带检查这些地方。

### ③ 画布 ↔ 外壳 / 浮层 → `CanvasSurface.vue` + `CanvasShell.vue` + 各浮层

```css
/* 文件：packages/canvas-render/src/host/CanvasSurface.vue（节选） */
.csurface { position: relative; width: 100%; height: 100%; }
.csurface-overlay {
  position: absolute; inset: 0;
  pointer-events: none;   /* 不挡画布交互；浮层控件自己开 pointer-events 才能点 */
  z-index: 20;
  overflow: hidden;
}
```

```css
/* 文件：packages/ui/src/components/CanvasShell.vue（节选，逐字来自源码） */
.shell-topbar { position: absolute; inset: 8px 8px auto; z-index: 60; }   /* 顶栏 */
.shell-status { position: fixed; left: 8px; bottom: 12px; z-index: 30; }  /* 左下状态条 */
.shell-dock   { position: fixed; left: 50%; bottom: 12px; z-index: 30; }  /* 底部工具条 */
```

| 元素 | 值 | 文件 |
| --- | --- | --- |
| 画布 UI 浮层（overlay 槽：小地图 / 对齐线 / 框选 / 底栏浮层…） | `20` | `canvas-render/src/host/CanvasSurface.vue` 的 `.csurface-overlay` |
| 应用底栏 / 左下状态条 | `30` | `packages/ui/src/components/CanvasShell.vue` |
| 应用顶栏 | `60` | 同上 |
| 设置面板外壳 | `100000`（悬浮球 `100001`） | `canvas-render/src/components/SettingsShell.vue` |
| 全应用统一的模态 / 菜单 | `100000` | 各浮层（设计规范见 `docs/design/ui-style-guide.md` §2.8） |
| 工具提示 | `100001` | 主题皮的 `Tooltip.vue` |
| 媒体查看器（要盖过设置面板） | `100200` | 主题皮的 `MediaViewer.vue` |
| 光标特效（要盖过一切） | `2147483000` | `plugin-cursor-effect/src/CursorEffectOverlay.vue` |

也有的浮层按需给独立值，但都**远低于 100000**：节点底栏浮层与参考选择浮层 `60` / `55`（`plugin-bottom-bar`）、框选层 `9999`（`plugin-multi-select/src/BoxSelectLayer.vue`）。

### ④ 节点内部 → 主题壳的 scoped 样式（一般不用动）

节点**肚子里**的排版在 `packages/plugins/plugin-theme-default/src/components/node/BaseNode.vue` 与 `MovingHandle.vue` 的 `<style scoped>`，是一组小数字：

| 部件 | 值 | 出处 |
| --- | --- | --- |
| 标题条（`.v2-title`，卡片上缘外） | `3` | `BaseNode.vue` |
| 标题条组件自身的基准（`BaseTitle.vue`） | `0` | `BaseTitle.vue` |
| 吸附带（`.snap-band`）/ 吸附调试带 | `21` / `22` | `BaseNode.vue` |
| 非法连接遮罩（`::after`）/ 编辑浮层（`.v2-edit-overlay`） | `25` | `BaseNode.vue` |
| 多选圆形标记 / 区域渲染位（`.v2-region`） | `26` | `BaseNode.vue` |
| 上/下控制栏（`.v2-slot`）/ resize 拖柄 | `30` | `BaseNode.vue` |
| 非法气泡 / 满额替换提示 | `60` | `BaseNode.vue` |
| 端口锚点（`.handle-anchor`）/ 端口命中区（zone） | `10` / `11` | `MovingHandle.vue` |
| 端口 3D 反馈 / 端口圆球 | `2` / `3` | `MovingHandle.vue` |

这些是**节点内部**的相对次序，跟「节点之间谁压谁」无关。真要动，先读行为契约：`docs/tmp/canvas-core-v2-survey/core-node-contract.md`（`BaseNode` / `MovingHandle` 属于红线核心件，改完必须跑契约测试）。

`MovingHandle.vue` 里还有一条**易踩的注释**值得记住：端口命中区的盒子是矩形，但看起来是「矩形 + 半圆耳朵」；它必须显式抬层（`z-index: 11` > 锚点的 `10`），否则会被后来的 VueFlow pane 盖住 → `elementFromPoint` 命中的是 pane、`mouseenter` 永远不触发。

## 会在哪里用到

| 文件 | 它在干什么 |
| --- | --- |
| `packages/canvas-render/src/host/canvasHostCore.ts` | 节点 z（`NODE_Z` / `NODE_SELECTED_Z` / 分组 `-3/-2` / 临时 `1001`）与中间态边 z（`1000`） |
| `packages/canvas-render/src/host/CanvasHost.vue` | 「连线置顶」时给边 `zIndex: 1001` |
| `packages/canvas-render/src/host/CanvasSurface.vue` | `.csurface-overlay { z-index: 20 }`；`:elevate-nodes-on-select="false"` |
| `packages/canvas-render/src/host/__tests__/canvasHostCore.test.ts` | 层级断言（改常量后这里会先红） |
| `packages/plugins/plugin-theme-default/src/components/node/BaseNode.vue` | 节点内部那一组小数字 |
| `packages/plugins/plugin-group/src/GroupTopToolbarOverlay.vue` | 文件头写了「为什么分组控制栏必须搬到画布浮层」的完整推理 |
| `packages/plugins/plugin-bottom-bar/src/NodeBottomBarOverlay.vue` | 同上（底栏为什么不能住在节点里） |
| `packages/ui/src/components/CanvasShell.vue` | 外壳三块（顶栏 / 状态条 / 底栏）的值 |
| `docs/design/ui-style-guide.md` §2.8 | 全仓浮层 z-index 的统一约定（`100000`） |

## 完整例子：一个「永远在最上层」的角标（先踩坑，再修对）

这是个**故意写错再改对**的例子，把那条硬规则演示清楚。

### 目录长这样

```
plugin-always-top/
├── package.json            # 插件清单
└── src/
    ├── index.ts            # 插件入口（A 版：挂在节点里；B 版：挂到画布浮层）
    ├── NodeBadge.vue       # ❌ 错误示范：想盖住旁边的节点，却挂在节点内部
    └── CanvasBadge.vue     # ✅ 正确示范：挂到 overlay 槽（画布级浮层）
```

（这一篇的例子是单文件插件，正文就是全部内容，照抄即可。）

### 文件一：清单

```json
// 文件：plugin-always-top/package.json
// 格式：JSON（npm 包清单）
// 位置：插件包根目录
{
  "name": "plugin-always-top",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "miniCanvas": {
    "title": "最上层角标",
    "description": "演示层叠上下文：为什么加 z-index 没用、搬到画布浮层才有用",
    "pluginName": "always-top",
    "installable": true
  },
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": { "types": "./src/index.ts", "default": "./src/index.ts" } },
  "dependencies": { "@mini-canvas/canvas-base": "workspace:*" },
  "peerDependencies": { "@mini-canvas/canvas-render": "workspace:*", "vue": "^3.5.34" }
}
```

### 文件二：❌ 错误示范（挂在节点内部的角标）

```vue
<!-- 文件：plugin-always-top/src/NodeBadge.vue
     格式：Vue 单文件组件（挂到节点区域，例如 over:outset）
     位置：❌ 反例 —— 这个角标想「盖住旁边的节点」，但它住在节点里 -->
<script setup lang="ts">
defineProps<{ id?: string; data?: Record<string, unknown> }>()
</script>

<template>
  <!-- 这里把 z-index 加到 999999 也没用：
       节点的 .vue-flow__node 带 transform，已经是一个层叠上下文，
       这个盒子永远被关在该节点内部，压不过兄弟节点。 -->
  <div class="node-badge">我压不住别人</div>
</template>

<style scoped>
.node-badge {
  position: absolute; left: 0; top: -22px;
  padding: 2px 6px; border-radius: 6px;
  background: #ef4444; color: #fff; font-size: 11px;
  z-index: 999999;   /* ← 数字再大也越不过 .vue-flow__node 那道门 */
}
</style>
```

### 文件三：✅ 正确示范（挂到画布级浮层）

```vue
<!-- 文件：plugin-always-top/src/CanvasBadge.vue
     格式：Vue 单文件组件（挂到 overlay 槽，由 SlotHost 渲染）
     位置：✅ 正解 —— 它在 .csurface-overlay（z-index:20，整棵 VueFlow 的兄弟）里，压得过所有节点 -->
<script setup lang="ts">
import { computed } from 'vue'
import { useCanvasRender } from '@mini-canvas/canvas-render'

const { renderNodes } = useCanvasRender()

// ① 角标贴在第一个节点右上角：浮层坐标 = 画布(flow)坐标，VueFlow 自己做变换
const anchor = computed(() => {
  const n = renderNodes.value[0]
  if (!n) return null
  return { x: n.position.x, y: n.position.y }
})
</script>

<template>
  <div v-if="anchor" class="canvas-badge">永远在最上层</div>
</template>

<style scoped>
/* overlay 那层已经铺满画布且 pointer-events:none；这里自己决定摆哪儿 */
.canvas-badge {
  position: absolute; left: 16px; top: 16px;
  padding: 2px 8px; border-radius: 6px;
  background: #16a34a; color: #fff; font-size: 12px;
  pointer-events: none;
}
</style>
```

### 文件四：插件入口（两种挂法只差一行）

```ts
// 文件：plugin-always-top/src/index.ts
// 格式：TypeScript 模块（插件入口）
// 位置：演示「同一个小 UI，挂哪儿决定它能压过谁」
import type { Context, PluginModule } from '@mini-canvas/canvas-base'
import NodeBadge from './NodeBadge.vue'
import CanvasBadge from './CanvasBadge.vue'

export const name = 'always-top'
export const inject = [] as string[]

export function apply(ctx: Context): void {
  // ❌ 挂在节点区域里：受节点那道层叠上下文限制（想「盖过别的节点」时一定失望）
  // ctx.nodes.attach('*', { region: 'over:outset', component: NodeBadge, id: 'always-top/node' })

  // ✅ 挂到画布级浮层：整棵 VueFlow 的兄弟，压得过所有节点
  ctx.slots.register('overlay', {
    id: 'always-top/canvas',
    order: 1,            // 越小越靠前（同一槽内）
    component: CanvasBadge,
  })
}

/** 兼容旧装配的 PluginModule 出口 */
export const alwaysTopPlugin: PluginModule = { name, inject, apply }
```

### 怎么验证（层级问题必须用眼睛看）

1. 先用 ❌ 那一行（注释掉 ✅ 那行）：把两个节点叠在一起，会发现红色角标被**后面那个节点**盖住 —— 即使它的 `z-index` 写着 `999999`。
2. 换成 ✅ 那一行：绿色角标稳稳压在**所有节点之上**。
3. 再把「连线显示在最上层」打开（设置里或改 `edgeVisual.edgeOnTop`）：绿色角标仍在节点之上、但连线会压过节点（角标在浮层里，比 `.vue-flow` 整层更高）。

## 常见坑

1. **以为「数字大就赢」**。只要中间隔着一道层叠上下文（`.vue-flow` 的 `z-index:0`、节点的 `transform`），数字再大也越不过去。先问「我和它是不是同一个父级的兄弟」，不是就搬出去。
2. **改了常量没改锚点**。`1001` 同时是「连线置顶」「临时菜单卡」「VueFlow 拖线临时线（库自带）」的锚点。改动之后要连带看：选中抬层是否仍在其下、临时卡是否仍在最上、置顶连线是否仍压得住选中节点。
3. **打开 VueFlow 的 `elevateNodesOnSelect` 会和现有设计打架**。我们刻意关着它（`:elevate-nodes-on-select="false"`），因为引擎那套是 +1000，会让「选中节点」跑到「置顶连线 1001」之上，顺序翻过来。想改用引擎那一套，就得删掉 `NODE_SELECTED_Z` 并重新排整条链。
4. **浮层不给 `pointer-events` 会「看着能点其实点不到」**。`.csurface-overlay` 是 `pointer-events: none` 的（不挡画布交互），它里面的 occupant 要自己恢复 `pointer-events: auto`（`CanvasSurface` 用 `item-class="csurface-overlay-item"` 统一处理）。
5. **别用 `overflow: hidden` 的容器装浮层**。被裁掉和「层级不够」看着很像，但原因完全不同：浮层要盖出容器边界时，要么换容器（如 `.csurface` 不裁），要么把它挂到更外层的槽。
6. **改完必须做验证**（数字对不上就是白改）：

```bash
pnpm -C packages/canvas-render test     # ① 单测：层级断言在 host/__tests__/canvasHostCore.test.ts
pnpm -C packages/canvas-render typecheck
pnpm -C packages/ui dev                 # ② 起画布看画面（:5288）：把两个节点叠一起，确认「选中的在上面」
```

改的是节点内部（`BaseNode` / `MovingHandle`）时，额外读 `docs/tmp/canvas-core-v2-survey/core-node-contract.md` 的层级表 —— 那两件是红线核心件，改完要跑契约测试。
