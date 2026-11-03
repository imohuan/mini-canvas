# 画布层级（z-index）—— 想改"谁盖住谁"看这一篇

> 来源（改前按这里的文件名核对，行号会变）：`packages/canvas-render/src/host/canvasHostCore.ts`、
> `packages/canvas-render/src/host/CanvasHost.vue`、`packages/canvas-render/src/host/CanvasSurface.vue`、
> `packages/plugins/plugin-theme-default/src/components/node/BaseNode.vue`、
> `packages/ui/src/components/CanvasShell.vue`。
> 相关：`docs/design/ui-style-guide.md`（§2.8 z-index）、`docs/plans/2026-09-29-canvas-z-layers.md`（实测数据与本轮修复记录）。

## 一句话

画布上「谁盖住谁」由 **两套层级** 共同决定：**节点之间**用 VueFlow 的 `zIndex`（在 `canvasHostCore.ts`），
**画布与外壳/浮层之间**用 CSS 的 `z-index`（在 `CanvasSurface.vue` + `CanvasShell.vue`）。
两者之间隔着一道**浏览器硬规则**（层叠上下文）—— 它决定了"能不能靠加数字解决"，下一节先说清。

---

## 一、先记住这条硬规则（不记住就会白改）

HTML 里有两层是**层叠上下文**（stacking context），会把内部所有 z-index **关在门里**：

| 是谁 | 为什么成上下文 | 后果 |
|---|---|---|
| `.vue-flow`（VueFlow 根） | 自己带 `z-index:0` | 画布里的 z 再大，也压不过画布**外面**的兄弟（`.csurface-overlay`、`.shell-dock`…） |
| `.vue-flow__node`（每个节点） | 带 `transform`（VueFlow 用它定位） | 节点里的 z 再大，也压不过节点**外面**的兄弟（边、别的节点） |

**所以：**「节点内某物要压过节点外某物」→ 加数字**没用**，必须把它**移出**那层上下文。
（底栏、分组控制栏、多选框都是这么改的：搬到画布级浮层，见各自文件头注释。）

---

## 二、改「节点之间」的层级 → `canvasHostCore.ts`

文件：`packages/canvas-render/src/host/canvasHostCore.ts`，函数 `nodesFromStore`。
这是**唯一**给节点定 z 的地方。当前取值：

| 节点 | z | 在哪定的 |
|---|---|---|
| 分组等容器 | `-3` / `-2`（按嵌套深度） | `nodesFromStore` 的 `transparent` 分支 |
| **普通节点** | `NODE_Z = 10` | 常量 `NODE_Z` |
| **选中节点** | `NODE_SELECTED_Z = 20` | 常量 `NODE_SELECTED_Z` |
| 临时菜单卡（拖线落空白） | `1001` | `isTransient` 分支 |

想调「选中要不要抬、抬多高」→ 改这两个常量。**别越过 1001**：那是"置顶连线"的高度，
越过去就破坏了"连线显示在最上层时压住选中节点"这条规则。

配套还有一行开关在 `CanvasSurface.vue`：

```html
:elevate-nodes-on-select="false"
```

这是 VueFlow 自带的"选中自动 +1000"，我们**故意关掉**，改由 `nodesFromStore` 自己给值
（否则会和"置顶连线 1001"打架）。想改用引擎那一套，就把这行改 `true` 并删掉 `NODE_SELECTED_Z` 赋值 ——
但注意 1000 < 1001，顺序会翻。

---

## 三、改「连线」的层级 → `CanvasHost.vue`

文件：`packages/canvas-render/src/host/CanvasHost.vue`，函数 `syncFromStore`：

```ts
edgeOnTop ? { ...e, zIndex: 1001 } : e
```

- 普通边**不写** z（跟节点同一层，靠 DOM 顺序落在节点下面）；想让它显式带值就改这里。
- 「连线显示在最上层」打开时给 `1001`，压过所有节点。**这个 1001 是"置顶线"的锚点**
  （节点选中抬层、临时菜单卡都按它定位），改它要连带检查上面那些值。

---

## 四、改「画布 ↔ 外壳/浮层」的层级 → `CanvasSurface.vue` + `CanvasShell.vue`

| 元素 | 值 | 文件 |
|---|---|---|
| 画布 UI 浮层（小地图 / 对齐线 / 框选 / 底栏浮层…） | `20` | `CanvasSurface.vue` 的 `.csurface-overlay` |
| 应用顶栏 | `60` | `ui/src/components/CanvasShell.vue` 的 `.shell-topbar` |
| 应用底栏 / 左下状态条 | `30` | 同文件 `.shell-dock` / `.shell-status` |
| 模态 / 菜单（全仓统一约定） | `100000` | 各浮层（见 `ui-style-guide.md` §2.8） |

- 想让**所有**画布浮层高于/低于顶栏底栏 → 调 `.csurface-overlay` 那一个值，里面的 occupant 跟着走。
- 想让**某个具体浮层**单独一层 → 在该插件自己的样式里给值（如底栏浮层 `60`、边切割 `10000`、
  框选 `9999`），但别超过 `100000`（模态专用）。

---

## 五、改「节点内部」的层级 → `BaseNode.vue`（一般不用动）

节点**肚子里的排版**在 `plugin-theme-default/src/components/node/BaseNode.vue` 的 `<style scoped>`，
是一组小数字：标题条 `3`、吸附调试 `21/22`、编辑浮层 `25`、多选标记/新增区域 `26`、控制栏/拖柄 `30`、
端口 `10/11/2`。这些是**节点内部**的相对次序，跟"节点之间谁压谁"无关，通常不用碰。
真要改，先读 `docs/tmp/canvas-core-v2-survey/core-node-contract.md` §1.3 的层级表
（BaseNode / MovingHandle 是**红线核心件**，改了要跑契约测试）。

> 端口命中区另有一处易踩：`.port-follow-zone` 的盒子是**矩形**，但看得见的是"矩形 + 半圆耳朵"。
> 抬层后那块看不见的矩形会抢邻节点的点击，所以它用 `clip-path` 裁成可见形状
> （`MovingHandle.vue` 的 `zoneClipPath`）。**改端口几何时别把这层裁剪删掉。**

---

## 六、速查：我想改 X，动哪里？

| 我想… | 改哪里 |
|---|---|
| 选中节点抬得更高 / 不抬层 | `canvasHostCore.ts` 的 `NODE_Z` / `NODE_SELECTED_Z` |
| 分组卡片垫底的分层 | `canvasHostCore.ts` 的 `transparent` 分支 |
| 连线默认层级 | `CanvasHost.vue` 的 `syncFromStore` |
| "连线置顶"到底多高 | `CanvasHost.vue` 里的 `1001` |
| 画布浮层（小地图/对齐线/底栏）与外壳的先后 | `CanvasSurface.vue` 的 `.csurface-overlay` |
| 应用顶栏 / 底栏 | `CanvasShell.vue` 的 `.shell-topbar` / `.shell-dock` |
| 模态 / 菜单 | 统一 `100000`（`ui-style-guide.md` §2.8） |
| 节点内部某个部件 | `BaseNode.vue` 的 scoped 样式（先读核心节点契约） |
| 让"节点里某物"压过"节点外某物" | **不能靠加数字** —— 搬到画布级浮层（见 §一） |

---

## 七、改完必须做的验证

1. 单测：`pnpm -C packages/canvas-render test`（层级断言在 `host/__tests__/canvasHostCore.test.ts`）。
2. 浏览器实测（唯一裁判）：`node packages/ui/e2e/canvas-e2e.mjs`（含"置顶连线 vs 控制栏"等重叠断言）。
3. 起画布看画面：`pnpm -C packages/ui dev`（:5288），把两个节点叠一起，确认**选中的在上面**。
