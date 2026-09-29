# 画布 z-index 统一分层（2026-09-29）

> 目标：把散在全仓的层级（z-index）数值收敛成**一份单一事实源**，并把「节点 / 连线 / 上下控制栏」三者的先后关系钉成契约。

---

## 1. 实测现状（Chrome 实跑，非推测）

来源：`packages/ui` dev + CDP `elementFromPoint` 采样 + `getComputedStyle`。

### 1.1 画布内的层叠树（真实 DOM）

```
.csurface                      (position:relative)
├─ .vue-flow                   z:0   relative   ← 层叠上下文（下面全关在里面）
│   └─ .vue-flow__viewport     z:4
│       └─ .vue-flow__pane     z:1
│           └─ .vue-flow__transformationpane  z:2  ← 层叠上下文（transform）
│               ├─ svg.vue-flow__marker        z:auto
│               ├─ svg.vue-flow__edges         z:0（每边一支；置顶时 1001）
│               ├─ .vue-flow__edge-labels      z:auto
│               └─ .vue-flow__nodes            z:auto
│                   └─ .vue-flow__node         z:0（分组 -3/-2；临时卡 1001）
├─ .csurface-overlay           z:20  ← **整棵 VueFlow 的兄弟，压在其上**
└─ （宿主 #ui 槽里的浮层）      z:25 fixed
```

### 1.2 关键实测结论

1. **默认连线在节点之下** —— 边 svg `z:0`、节点 `z:0`，靠 **DOM 顺序**（边容器在节点容器之前）实现。**是隐式的、脆的**。
2. **`edgeOnTop` 打开 → 边 svg 被写成 `z:1001`**，压过所有节点。
3. **选中节点不抬层**：`elevate-nodes-on-select=false`，所有节点恒 `z:0`。
4. **置顶连线会盖住节点的上/下控制栏**（实测）：让边横穿图片节点的下控制栏，
   `edgeOnTop=false` 时 **0 / 3888** 个采样点命中边；`edgeOnTop=true` 时 **216 / 3888** 命中边。
   - 根因：节点 `.vue-flow__node` 带 `transform`，**必然**创建层叠上下文，节点内部的 `.v2-slot`（z:30）
     **再大也出不去**，而边 svg（z:1001）是它的兄弟。

---

## 2. 目标语义（按用户口述整理）

自下而上：背景 → 分组容器 → **连线/节点同属一级**（默认节点压边；`edgeOnTop` 时边升到选中节点之上）
→ 选中节点抬层（始终低于置顶连线）→ 置顶连线 → **节点上下控制栏（始终在置顶连线之上）**
→ 选择框/画布浮层 → 外壳 UI → 模态。

---

## 3. 已落地（本次提交）

新增 `packages/canvas-render/src/contracts/layers.ts`（唯一事实源）+ `ui-theme.css` 的 `--layer-*` CSS 出口
（两处由 `layerTokens.test.ts` 扫描比对，漂移即报错）：

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

验证：全仓 27 包测试全绿；官方 e2e 连续 6 次 **50/50**。

---

## 4. 剩余：让「节点上下控制栏」压过置顶连线（需拍板）

**这是本次唯一未做的一条**，因为它要离开节点的层叠上下文（见 §1.2-4），属结构性改动。

### 两条路

- **A（推荐，行为符合用户口述）画布级控制栏浮层**：新增一层（画布浮层带之上），由渲染层统一把
  「当前单选节点的 `out:top`/`out:bottom`/`over:inset`」摆到卡片外侧对应位置。节点插件继续注册区域条目、
  观感不变。分组已走这条路（`GroupTopToolbarOverlay`）、多选也走这条路（`SelectionFrame`）。
  - 代价：`BaseNode.vue`（红线核心件）不再自己画这三段；须同步更新核心节点契约与
    `baseNodeSlotsRender.test.ts`（约 30 条）以及 e2e 里三段相关断言。
  - **必须三段一起搬**：`out:top` 按钮与 `over:inset` 面板共享同一个「每节点一份」能力实例
    （决策 9 第②条）；只搬其中一段会让两条目拿到不同实例、状态不共享。
- **B（保守）控制栏留在节点内**：只保留 §3 的收敛与选中抬层；置顶连线仍会盖住控制栏（保持现状）。

---

## 5. 红线与风险

- `BaseNode.vue` 在红线清单里：改动前须读 `docs/tmp/canvas-core-v2-survey/core-node-contract.md`，
  改后六件 66 条不变量与 27 条易碎点必须全绿。
- 层序变动后视觉回归基线（现 6/6）与 e2e（现 50/50）都要重跑。

