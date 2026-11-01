# 画布 z-index 统一分层（2026-09-29）

> 目标：把散在全仓的层级（z-index）数值收敛成**一份单一事实源**，并把「节点 / 连线 / 上下控制栏」三者的先后关系钉成契约。
> 本文档先记录 **Chrome MCP 实测现状**，再给**目标语义**与**迁移步骤**。
> 2026-09-29 当天已全部落地（见 §3），原 §6 的结构性问题按 A 方案解决（见 §4）。

---

## 1. 实测现状（Chrome 实跑，非推测）

来源：`packages/ui` dev（:5291）+ CDP `elementFromPoint` 采样 + `getComputedStyle`。

### 1.1 画布内的层叠树（真实 DOM）

```
.csurface                      (position:relative)
├─ .vue-flow                   z:0   relative
│   └─ .vue-flow__viewport     z:4   ← 层叠上下文（下面全部被关在这里）
│       └─ .vue-flow__pane     z:1
│           └─ .vue-flow__transformationpane  z:2  ← 层叠上下文（transform）
│               ├─ svg.vue-flow__marker        z:auto
│               ├─ svg.vue-flow__edges         z:0（每边一支；置顶时 1001）
│               ├─ .vue-flow__edge-labels      z:auto
│               └─ .vue-flow__nodes            z:auto
│                   └─ .vue-flow__node         z:0（分组 -3/-2；临时卡 1001）
├─ .csurface-overlay           z:20  ← **整棵 VueFlow 的兄弟，压在其上**
│   ├─ multi-select-box-layer / align-guide-layer …
│   └─ （分组上控制栏、小地图 … 走这里）
└─ （宿主 #ui 槽里的浮层，如小地图定位盒）  z:25 fixed
```

### 1.2 应用外壳（@mini-canvas/ui）

| 元素 | 值 |
|---|---|
| `.shell-topbar` | 60 |
| `.shell-status` / `.shell-dock` | 30 |
| 模态/菜单（AxDialog / AxDropdown / SettingsShell / ContextMenu …） | 100000（AxTooltip 100001） |

### 1.3 画布内所有 z-index 落点（全仓清单）

| 值 | 位置 | 文件 |
|---|---|---|
| 0 / 1001 | 边（默认 / `edgeOnTop` 时） | `canvas-render/src/host/CanvasHost.vue:296` |
| -3 / -2 | 分组容器（嵌套深度） | `canvas-render/src/host/canvasHostCore.ts:104` |
| 1001 | 临时菜单卡（拖线落空白） | `canvas-hostCore.ts:118` |
| 1000 | 临时边 | `canvasHostCore.ts:375` |
| 20 | 画布 overlay 槽 | `canvas-render/src/host/CanvasSurface.vue:406` |
| 25 | 小地图定位盒 | `ui/src/App.vue` |
| 30 / 60 | 外壳顶栏 / 底栏 | `ui/src/components/CanvasShell.vue:86,94,95` |
| 9998 / 9999 | 多选批量临时线 / 框选矩形 | `plugin-multi-select/…` |
| 10000 | 边剪切浮层 | `plugin-edge-cutting/…` |
| 100000+ | 模态 / 菜单 / 提示 | 多个包 |

节点**内部**还有一批本地层（`.v2-slot` 30、`.v2-title` 3、`.v2-overlay` 25、调试 21/22、多选标记 26、端口 10/11/2…），属节点自身排版，**保持默认不动**。

### 1.4 关键实测结论

1. **默认连线在节点之下** —— 边 svg `z:0`、节点 `z:0`，靠 **DOM 顺序**（边容器在节点容器之前）实现「节点压边」。**是隐式的、脆的**。
2. **`edgeOnTop` 打开 → 边 svg 被写成 `z:1001`**，压过所有节点。
3. **选中节点不抬层**：`elevate-nodes-on-select=false`（`CanvasSurface.vue`），所有节点恒 `z:0`。
4. **置顶连线会盖住节点的上/下控制栏**（实测）：让边横穿图片节点的下控制栏，`edgeOnTop=false` 时 **0 / 3888** 个采样点命中边；`edgeOnTop=true` 时 **216 / 3888** 命中边 —— 控制栏被边压住。
   - 根因：节点 `.vue-flow__node` 带 `transform`（VueFlow 定位用），**必然**创建层叠上下文，节点内部的 `.v2-slot`（z:30）**再大也出不去**，而边 svg（z:1001）是它的兄弟。这正是分组控制栏当年被迫改挂 `.csurface-overlay` 的同一个坑（见 `GroupTopToolbarOverlay.vue` 文件头）。

---

## 2. 目标语义（按用户口述整理）

自下而上：

1. 背景
2. **分组容器**（垫底）
3. **连线**与**节点**同属一级：
   - 默认：节点在连线之上
   - `edgeOnTop=true`：连线升到**选中节点之上**
4. **选中节点抬层**（高于普通节点，但**始终低于置顶连线**）
5. **置顶连线**（`edgeOnTop=true` 时）
6. **节点上/下控制栏**（跟随节点选中出现，**始终在置顶连线之上**）
7. 选择框 / 画布级浮层 / 外壳 UI / 模态

---

## 3. 与现状的差距

| # | 期望 | 现状 | 需改 |
|---|---|---|---|
| 1 | 节点/连线/控制栏的层序是一份契约 | 数值散在 6+ 个文件 | 收敛成常量模块 |
| 2 | 默认「节点压边」 | 靠 DOM 顺序（隐式） | 改显式 z 值 |
| 3 | 选中节点抬层 | 关闭（恒 0） | 打开并纳入同一套 |
| 4 | **控制栏在置顶连线之上** | 被压住（实测） | **结构改动，见 §6** |

---

## 4. 方案：单一层级表（`canvas-render/src/contracts/layers.ts`）

```ts
/** 画布层叠带（唯一事实源）。数值只在此定义；别处一律 import。 */
export const LAYERS = {
  groupBase:    50,   // 分组容器（垫底；嵌套再按深度细分）
  edge:        100,   // 普通连线
  node:        200,   // 普通节点卡片
  nodeSelected:300,   // 选中节点（抬层）
  boxSelect:   350,   // 框选矩形
  edgeTop:     400,   // 置顶连线（edgeOnTop）
  nodeToolbar: 500,   // 节点上/下控制栏 + 编辑浮层
  overlay:     600,   // 画布级浮层槽（小地图/对齐线/批量临时线）
  appChrome:   700,   // 外壳顶栏/底栏
  modal:    100000,   // 模态/菜单（沿用现约定）
} as const
```

> 每一条都带注释说明「为什么在这个位置」，并在 `docs/design/ui-style-guide.md §2.8` 与核心节点契约里登记（替换现有「技术债：z-index 待收敛」）。

---

## 5. 迁移步骤（待确认后按 TDD 执行）

1. 新建 `layers.ts` + 单测（纯常量，锁「相对顺序」而非具体数字：如 `edge < node < nodeSelected < edgeTop < nodeToolbar`）。
2. `canvasHostCore`：分组/临时卡/临时边改读常量。
3. `CanvasHost`：`edgeOnTop` 用 `LAYERS.edgeTop`；默认边 `LAYERS.edge`。
4. `nodesFromStore`：普通节点 `LAYERS.node`；选中 `LAYERS.nodeSelected`。
5. `CanvasSurface`：overlay 容器用 `LAYERS.overlay`。
6. `ui`（CanvasShell/App）与各插件浮层改读常量。
7. 浏览器实测脚本：把 §1.4-4 的「置顶连线 vs 控制栏」采样固化成回归断言。

---

## 6. 待确认的结构性问题（唯一的硬骨头）

**要让「节点上/下控制栏」压过置顶连线，控制栏必须离开节点的层叠上下文。** 因为节点带 z-index 就创建层叠上下文，节点内部的任何 z-index 都出不去。

两条路：

- **A（推荐）画布级控制栏浮层**：新增一层（在 `edgeTop` 之上），由渲染层统一把「当前单选节点的 `out:top`/`out:bottom`」摆到卡片外侧的对应位置。节点插件继续注册区域条目、观感不变；分组已走这条路（`GroupTopToolbarOverlay`）、多选也走这条路（`SelectionFrame`），等于把已成型的做法收编成通用能力。
  - 代价：要动 `BaseNode.vue`（红线核心节点件）—— 它不再自己画 `out:top`/`out:bottom`；需要同步更新核心节点契约与 `baseNodeSlotsRender.test.ts`（约 30 条）。
  - 收益：三处（节点/分组/多选）的控制栏终于同一层、同一套定位，不再各写一遍。

- **B（保守）控制栏留在节点内**：只做 §4/§5 的常量收敛与选中抬层；置顶连线仍会盖住控制栏（保持现状）。

---

## 7. 红线与风险

- `BaseNode.vue` 在红线清单里：改动前须读 `docs/tmp/canvas-core-v2-survey/core-node-contract.md`，改后六件 66 条不变量与 27 条易碎点必须全绿。
- 目标层序一旦变动，视觉回归基线（现 6/6）与 e2e（现 50/50）都要重跑。
---

## 8. 落地记录（2026-09-29 当天已全部实现）

§4/§5 的方案当天落地，§6 那个结构性问题按 **A 方案**解决 —— 全仓 30 包单测全绿、
官方 e2e 连续 3 次 **50/50**、多选回归 29/29、视觉回归 6/6、主题色板 19/19。

新增 `packages/canvas-render/src/contracts/layers.ts`（唯一事实源）+ `ui-theme.css` 的 `--layer-*`
CSS 出口（两处由 `layerTokens.test.ts` 扫描比对，漂移即报错）。最终层序：

```
分组 50/60 < 连线 100 < 节点 200 < 选中节点 300 < 临时边 380 < 置顶连线 400
  < 临时菜单卡 450 < 节点控制栏 500 < 画布浮层 600 < 应用浮标 650 < 外壳 UI 700
  < 手势层 900 < 模态 100000 < 模态提示 100001
```

接线（全仓）：canvasHostCore（节点/分组/临时卡显式分层 + **选中抬层**）、CanvasHost（`edgeOnTop` 走
`LAYERS.edgeTop`，不覆盖临时边自身层）、CanvasSurface（overlay 容器）、CanvasShell / AxDialog /
AxDropdown / AxTooltip / SettingsShell / context-menu / shortcut-manager / theme Dropdown / node-find /
3d-preview / node-video / node-image / canvas-export，以及 multi-select 框选与 edge-cutting 刀光（gesture 档）。

两处隐式依赖改为显式：节点不再只靠 DOM 顺序压边；选中节点由 `nodesFromStore` 显式抬层。

**§6 的硬骨头（控制栏压过置顶连线）也是当天做完的**，做法即 A 方案（只搬 DOM、不搬逻辑）：

- CanvasSurface 新增画布级宿主层 `.csurface-node-toolbar-layer`（z = `LAYERS.nodeToolbar`，
  压在置顶连线之上、画布浮层之下），内层跟随视口 transform 以便按 flow 坐标定位；
- 新增注入令牌 `NODE_TOOLBAR_HOST_KEY`；BaseNode 取到宿主就把 `out:top`/`out:bottom` Teleport
  过去，并补一块「与卡片同位置同尺寸」的定位锚（`calc(100% ± offset)` 才仍等于「离卡片这条边的距离」）；
  区域条目、能力实例缓存、定位样式**全部仍在壳内**，所以同一节点上「按钮」与「它打开的面板」
  照旧共享同一个能力实例（决策 9 第②条）。未装宿主（SSR 单测 / 极简宿主）→ 原地渲染，行为逐字不变。
- 实测：置顶连线横穿下控制栏的命中点由 **216 → 0**，控制栏按钮仍可点；分组内子节点的控制栏锚点
  与卡片精确重合。

顺带修一处被这次改动暴露的既有问题：端口跟随区 `.port-follow-zone` 的命中盒是矩形，而可见形状是
「贴卡边的矩形 + 外侧半椭圆」—— 那块看不见的矩形死区会吃 mousedown。节点一选中就抬层
（`LAYERS.nodeSelected`），死区便压住紧邻节点、把点击整个吃掉（e2e 因此卡在「选中图片节点」）。
改为用与可见形状逐点一致的 clip-path 裁剪命中区。

