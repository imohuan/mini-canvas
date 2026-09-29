# 节点底栏：修「点不进去」+ 复刻 LibTV 版式 + 参数注册对齐（2026-09-29）

> 用户诉求（原话归纳）：
> 1. 底栏输入框**点不进去、打不了字**；
> 2. 素材卡要**直接常显**（不是点「参考」才展开），点卡片能进预览；
> 3. 底栏 UI **完全复刻** LibTV 参考图（pill 行 / 素材卡 / 内联输入 / 底部行）；
> 4. 参数注册**照参考图填**（比例 · 画质 · 分辨率 · 张数），可视化显示一致；
> 5. 加载态：**无黑底卡片**、整区域铺满、带动画、取消按钮右下角小号、**不挡拖拽**；
> 6. 以上每条都必须用 **Chrome MCP 实测 + 截图**通过才算完成。
> 约束：**不做兼容**，按终态直接改。

---

## 0. 实测事实（Chrome MCP + Playwright，非推测）

### 0.1 「输入框点不进去」的根因（P0）

把图片节点摆到画布底部（底栏与底部工具栏重叠）后实测：

| 采样点 | 命中元素 | 结果 |
|---|---|---|
| 底栏输入区 **被工具栏覆盖的那一段** | `BUTTON.grid.size-8.place-items-center`（`.shell-dock` 里的按钮） | 打字**进不去**，`ProseMirror` 无内容 |
| 底栏输入区 **未被覆盖的那一段** | `ProseMirror` | 打字正常 |

**根因**：应用外壳的底部工具栏 `.shell-dock`（`packages/ui/src/components/CanvasShell.vue:95`，`position:fixed; z-index:30`）
压在节点底栏输入区之上，把点击整段截走。

底栏本身住在节点内插槽 `.v2-slot--bottom`（`BaseNode.vue:894`）。节点带 `transform`（定位用）**必然创建层叠上下文**，
所以节点内任何 `z-index` 都出不去，压不过作为画布**兄弟**的 `.shell-dock`。
这与 `plugin-group` 当年修「分组工具栏被节点盖住」是**同一个坑**
（见 `packages/plugins/plugin-group/src/GroupTopToolbarOverlay.vue` 文件头）。

实测确认：把节点平移到底栏与工具栏不重叠处，输入正常；重叠处输入丢失。

### 0.2 端口与 worktree（**审核修正：改用可复现的表述**）

`packages/ui/vite.config.ts` 里 `port: 5288, strictPort: false` —— 多个 worktree 同时起 dev，
谁先占 5288 谁就是 5288（本次实测：5288 曾被 worktree
`C:\Users\Administrator\.codex\worktrees\canvas-z-layers\mini-canvas`（分支 `codex/z-index-layers`）占用，
它跑的是**旧版底栏**：`.nb-top` / `.nb-chip` / `showMaterials` 要点击才展开 / 默认动作取 `actions[0]`）。
**结论与对策**：`5288` 不可信（随时可能是别人的代码）——
本次验证一律起**专属端口**并显式指定：

```
pnpm -C packages/ui exec vite --port 5296 --strictPort
```

`canvas-e2e.mjs` 的 `BASE` 硬编码 `http://localhost:5288/`（`e2e/canvas-e2e.mjs:18`），
**必须先参数化**（支持 `CANVAS_PORT`）才能作为证据（见 §3 改动清单）。

### 0.3 当前实现（本工作区，未提交）已具备的部分

- `NodeBottomBar.vue` 已按参考图重写：pill 行 + 素材卡常显（48×48 序号角标）+ 内联输入 + 底部行；
  默认动作**优先选 `needsPrompt`**（修「默认选中旋转 → 看不到输入框」）。
- `ToolParamGroup.vue`：把多个参数收成**一个合并下拉**（`16:9 · 标准画质 · 2K · 1张 ⌄`）。
- mock 动作参数已照参考图（比例/画质/分辨率/张数）。
- `NodeTaskOverlay.vue` 已是「铺满整卡 + 无盒子 + 右下角小取消 + `pointer-events:none`」。
  **注意（审核修正）**：「不挡拖拽」目前只有代码支撑 + 一次性手工实测，
  **没有自动化断言**；§4 第 5 条是**新增**用例，别当已有覆盖。

### 0.4 参考站权威 DOM 数值（LibTV，Chrome MCP 实测）

| 元素 | 数值 |
|---|---|
| 面板 | 660×248，`border-radius:16px`，`background:rgb(38,38,38)`，`padding:0` |
| 内层 | `gap:8px; padding:8px` |
| pill | 高 26，胶囊 `9999px`，底色 `rgba(255,255,255,0.05)`，`gap:2px; padding:4px 8px`，图标 12，文字 12px |
| 素材卡 | `48×48`（`size-12`），圆角 8，左下序号角标 |
| 参数合并下拉 | `button h-8`（32px），圆角 8，`gap:4px; padding:4px 8px`，文字 13px，右箭头 14px |
| 展开按钮 | `absolute right-2 top-2 size-7`（28×28） |
| 输入区 | `rounded-xl p-2 min-h-20 max-h-[100px]`，占位文字 13px |
| 发送按钮 | 圆 `size-8`（32px），圆角 12，白底深箭头 |

---

## 1. 目标（按用户口述整理）

1. **底栏能点、能打字、能 @ 引用**；不被任何外壳 UI 截走事件。
2. **素材卡常显**（连线连进来就出现），点卡片进预览。
3. UI **逐块对齐参考图**（pill / 卡片 / 输入 / 底部行四段）。
4. 参数注册值照参考图；合并下拉的摘要串一致。
5. 加载态：整卡铺满、无卡片底、有动画、右下角小取消、**不挡拖拽**。
6. 每条都要 Chrome MCP 实测 + 截图核对。

---

## 2. 方案

### D1（P0）底栏离开节点层叠上下文，提升为专属画布级层

**改法**：不再把底栏挂节点 `out:bottom`（`.v2-slot--bottom`），改挂**沿用的 overlay 槽机制**，
但**新开一层专属容器**（不是复用 `.csurface-overlay`，理由见下），由新组件定位到「卡片正下方」。
离开节点层叠上下文这条路，`GroupTopToolbarOverlay` / `SelectionFrame` 已经走通，不是新发明。

> **审核修正 1（关键）**：`.csurface-overlay` 自己是 `position:absolute; z-index:20` 的**层叠上下文**，
> 所以「给底栏自身设 z」**无效** —— 子元素再大也出不去。实测：容器保持 20、子元素 z:40 →
> `elementFromPoint` 仍命中工具栏；容器抬到 31 → 才命中子元素。
> 因此必须**抬容器**。又因为抬容器会连带影响该槽里**所有** occupant
> （多选框 / 对齐线 / 分组工具栏 / 边剪切），所以**新开一层专属容器**更稳。

新增画布级层（`CanvasSurface.vue`）：
```
<div class="csurface-node-bottombar-layer" :style="{ zIndex: LAYERS.nodeBottomBar }">
  <SlotHost slot="bottom-bar" item-class="csurface-bottombar-item" />
</div>
```
- 容器 `position:fixed; inset:0; pointer-events:none; z-index: nodeBottomBar`。
  **用 fixed 而不是 absolute**：审核指出 `.csurface-overlay` 的 `overflow:hidden` 会把贴近画布下缘的
  `absolute` 子元素裁掉；`fixed` 可逃逸裁剪（已确认整条祖先链无 `transform`）。
  这里更直接的做法是**新容器不写 `overflow:hidden`**，并给子层 `position:fixed`。
- 层值：`LAYERS` 里新增一档 `nodeBottomBar`，**排在 `appChrome` 之上**（见审核修正 2）。

新增：`packages/plugins/plugin-bottom-bar/src/NodeBottomBarOverlay.vue`
- 订阅 `selection`：**恰好单选一个**节点才显示。
- 位置：外层跟随视口 `translate(vp.x, vp.y) scale(vp.zoom)` + 内层锚盒 = 卡片矩形，
  再用 `resolveNodeSlotStyle({side:'bottom', offset, zoom})`（与节点内**同一个函数**）保证位置一致。
- **拖动跟随**（审核指出文档漏写）：拖动中位置要松手才落盘，必须照 `GroupTopToolbarOverlay` 的
  `NodeDragStart/NodeDrag/NodeDragEnd` 位移增量方案平移快照，否则会出现「底栏留在原地、松手才跳」。
- **补全壳的显隐压制**（审核指出文档漏写）：照 `BaseNode.hideToolbars` 的四条 ——
  框选中（`interaction.isSelecting`）、多选（`selectedCount > 1`）、**该节点正在 resize**
  （`interaction.nodeResizeId === id`）、低缩放（`lowDetail`）。
- 内容：复用现有 `BottomBarHost`（读 `themeRegistry.winner('bottomBar')`），组件一行不改。
- 指针事件纪律（照 `GroupTopToolbarOverlay`）：外框零尺寸 + 锚盒 `pointer-events:none`，
  **只有底栏本体 `pointer-events:auto`**；容器侧补 `.csurface-bottombar-item { pointer-events:auto }`。

**审核修正 2（层序契约冲突）**：`docs/plans/2026-09-29-canvas-z-layers.md`（以及
`codex/z-index-layers` 分支的 `layers.ts`）把 `overlay:600` 排在 `appChrome:700` **之下**。
本计划要「底栏压过工具栏」，与那份表**直接冲突**，必须在一处定死。
**取法**：在 `layers.ts` 加 `nodeBottomBar` 一档排在 `appChrome` 之上（这是唯一能把两边说圆的写法），
并同步 `ui-style-guide §2.8` 表与 `layerTokens.test.ts`。
**落地顺序**：`codex/z-index-layers` 尚未并入 main，本分支**先按上面的语义加档**；
两分支合并时以「底栏 > 外壳 UI」为准。

注册：`nodeBarPlugin.apply` 把 `ctx.nodes.attach('*', {region:'out:bottom', ...})` 换成
`ctx.slots.register('bottom-bar', { id:'bottom-bar/overlay', order, component: NodeBottomBarOverlay })`；
`over:inset`（加载态覆盖层）保留在节点内不动。

**为什么不是「让工具栏让位」**：`.shell-dock` 是常驻主操作条（添加节点/移动/素材库/历史/快捷键），
只要选中节点就让它淡出 = 编辑任何节点时主工具栏不可用，是把常用 chrome 变成模态行为，代价更大。

### D2（P0）输入区可达性

浮层容器 `pointer-events:none`，真实可点的底栏本体 `pointer-events:auto`（照 `GroupTopToolbarOverlay`）。
输入区内所有交互元素 `stop` 掉拖拽/框选（`nodrag nopan nowheel`）。

### D3 素材卡常显 + 点击预览

- 卡片**不依赖任何开关**：`cards.length > 0` 即渲染（当前实现已如此，需实测确认）。
- 点卡片 → 打开预览浮层（图片看大图、文本看全文）；再点关闭。
- 卡片带**序号角标**（左下标，与参考图一致）。

### D4 参数注册对齐参考图

- 合并下拉摘要 = `16:9 · 标准画质 · 2K · 1张`（`fieldSummary` 用 ` · ` 连接）。
- 下拉里逐项可改，改完摘要实时更新。
- **两条 mock 动作分别说明**（审核指出文档写成统一描述，与代码不符）：
  - `mock-task:sync`：比例 4 项（16:9/4:3/1:1/9:16）+ 画质 + 分辨率 + 张数 1/2/4；
  - `mock-task:async`：比例 3 项（1:1/16:9/9:16）+ 画质 + 分辨率 + 张数 1/2。
  - 决策：**两条对齐成同一套**（都 4 项比例、张数 1/2/4），让「换动作参数不跳」更稳。

### D5 加载态：整卡铺满、无黑底、动画、右下小取消、不挡拖拽

- 保留 `NodeTaskOverlay` 的「`pointer-events:none` 根 + 只取消按钮 `auto`」→ **不挡拖拽**（已实测可拖）。
- 底色从 92% 降到更透（要让底下内容若隐若现），**去掉任何卡片/盒子**；加持续流光/脉冲动画。
- 取消按钮右下角、小号。
- `prefers-reduced-motion` 降级。

### D6 视觉逐块对齐参考图

按 §0.4 的实测数值调：面板 16 圆角 / 内层 8 padding·8 gap / pill 26 高 / 卡片 48 / 参数下拉 32 高 / 发送 32 圆。
调完用 Playwright 截底栏小图与参考图**并排比对**。

---

## 3. 改动清单（文件级）

| 文件 | 动作 |
|---|---|
| `packages/plugins/plugin-bottom-bar/src/NodeBottomBarOverlay.vue` | **新增**：画布级浮层宿主（定位 + 单选订阅 + 复用 BottomBarHost） |
| `packages/plugins/plugin-bottom-bar/src/nodeBarPlugin.ts` | 改挂载：`out:bottom` → `slots.register('overlay')`；覆盖层保持 `over:inset` |
| `packages/plugins/plugin-bottom-bar/src/index.ts` | 导出新组件（若需） |
| `packages/plugins/plugin-bottom-bar/src/NodeBottomBar.vue` | 版式微调对齐 §0.4；输入区可点性；卡片常显/预览 |
| `packages/plugins/plugin-bottom-bar/src/NodeTaskOverlay.vue` | 底色更透 + 动画增强（保留不挡拖拽） |
| `packages/plugins/plugin-bottom-bar/src/__tests__/bottomBarRender.test.ts` | 补/改断言：卡片常显、浮层挂载点、参数摘要 |
| `packages/plugins/plugin-theme-default/src/components/ui/ToolParamGroup.vue` | 视觉对齐（32 高、13px、箭头 14） |
| `packages/plugins/plugin-mock-task-backend/src/mockTaskPlugin.ts` | 参数文案/顺序对齐参考图 |
| `packages/plugins/plugin-bottom-bar/README.md` | 更正挂载点说明（out:bottom → overlay） |
| `packages/canvas-render/src/contracts/layers.ts` | **新增**（或按合并后的 `LAYERS`）加 `nodeBottomBar` 档，排 `appChrome` 之上 |
| `packages/canvas-render/src/host/CanvasSurface.vue` | 新增 `.csurface-node-bottombar-layer` + `<SlotHost slot="bottom-bar">` |
| `docs/design/ui-style-guide.md` | §2.8 层叠带表加 `nodeBottomBar`（若该表已存在） |
| `packages/ui/e2e/canvas-e2e.mjs` | **必改**（审核指出漏项）：`*/out:bottom.length===1` 断言与检查名要改；`BASE` **参数化**（支持 `CANVAS_PORT`），否则打到 5288 的其它 worktree 得假结果 |

---

## 4. 测试与验收

**单元 / 类型**

```
pnpm -C packages/plugins/plugin-bottom-bar test
pnpm -C packages/plugins/plugin-bottom-bar typecheck
pnpm -C packages/plugins/plugin-theme-default typecheck
pnpm -C packages/plugins/plugin-mock-task-backend test
pnpm -C packages/ui test
pnpm -C packages/canvas-render test
```

**e2e**（先把 `BASE` 参数化，再跑，否则会打到别的 worktree）

```
CANVAS_PORT=5296 node packages/ui/e2e/canvas-e2e.mjs
```

**浏览器实测（Chrome MCP + Playwright，必须全过）**

1. 选中图片节点（底栏与底部工具栏**故意重叠**）：点输入区 → 真实键盘打字 → 读回 `ProseMirror.textContent` 与计数**非空**。
   （判定标准：`elementFromPoint(重叠点)` 命中 `ProseMirror`，不是工具栏按钮。）
2. 素材卡：连线连进来就**直接显示**（不用点任何按钮），数量/序号角标正确。
3. 点素材卡 → 出现预览；再点关闭。
4. 输入 `@` → 弹菜单、列出文本/图片素材、位置贴光标。
5. 点发送 → 卡片出现加载态（整卡铺满、无盒子）→ 加载态**期间拖拽节点仍能移动**
   （**新增可复跑断言**：拖前后节点 position 必须变；现有 e2e 无这条）。
6. 点取消 → 任务中断、加载态消失。
7. 截图底栏小图，与参考图逐块比对（pill / 卡片 / 输入 / 底部行）。
8. **拖动节点**：底栏跟着走（不能停在原地等松手才跳）。
9. **节点贴画布下缘**：底栏不被裁掉（fixed / 不裁剪容器）。
10. **多选 / 框选 / resize 中**：底栏收起。

---

## 5. 风险与红线

- **红线**：`BaseNode.vue` 在禁止改坏的清单里。本方案**不改 `BaseNode.vue`**，只改挂载点（`out:bottom` 不再被 bottom-bar 占据）。
  但要点：`out:bottom` 区域仍属核心节点件能力，`BaseNode` 侧代码不动，只是没有 occupant。
- 已逐条读过、**不受影响**：`baseNodeSlotsRender` / `baseNodeRegionsRender` / `baseNodeCapabilitiesRender`
  （都自注册探针，与谁是 occupant 无关）、三个节点 smoke（断的是「本包不再自占 out:bottom」= `undefined`）、
  `nodePluginsAssembly.test.ts` 的 `EXPECTED`。
  **审核修正**：`nodeRegionTypeLock.test.ts` **不含** `out:bottom` 断言（它只测已下线老词），
  原文写「它对 out:bottom 的断言已是不再自占」是错的。
- **会红、必须同步改**：`packages/ui/e2e/canvas-e2e.mjs` 断言
  `field.list('*/out:bottom').length === 1`，检查名叫「底栏装配：out:bottom 宿主…」——一挪就变 0。
- `bottomBarRender.test.ts` 里若断言「挂在 out:bottom」需同步改。
- 层级：底栏浮层 > `.shell-dock`。这是**有意**的（激活态 UI 压过全局工具栏）；如果审核认为不妥，
  备选是「底栏出现时工具栏淡出」，代价是要动 `packages/ui` 外壳。

---

## 6. 开工前核对

- [x] 审核通过（子代理 plan_reviewer；四点修正已并入 §2 D1 / §0.2 / §3 / §4）
- [x] 起本工作区 dev：`pnpm -C packages/ui exec vite --port 5296 --strictPort`（5288 被别的 worktree 占着）

---

## 7. 实际落地（与计划的差异，按实说）

**比计划更小的改法**：没有新开画布级层、也没有改 `CanvasSurface`。
根因只是「底栏住在节点层叠上下文里」——那就**只把 DOM 挪出去**：
`NodeBottomBarOverlay` 注册在**既有 overlay 槽**，再把内容 **Teleport 到 body**、
按**屏幕坐标 fixed** 定位（本插件 @ 菜单早已用同一手法）。
好处：`.csurface-overlay` 的 `z-index:20` 层叠上下文、`overflow:hidden` 裁剪、层序契约冲突
——三个坑一次性绕开，且不动 `canvas-render`。

落地清单（实际改的文件）：

| 文件 | 改了什么 |
|---|---|
| `plugin-bottom-bar/src/NodeBottomBarOverlay.vue` | **新增**：注册进 overlay 槽的浮层宿主（单选订阅 + 量卡片 DOM 定位 + Teleport 到 body + 补齐壳的压制条件） |
| `plugin-bottom-bar/src/nodeBarPlugin.ts` | 挂载点：`out:bottom` → `ctx.slots.register('overlay', …)`；新增导出 `BOTTOM_BAR_SLOT_NAME` |
| `plugin-bottom-bar/src/BottomBarHost.vue` | `v-if="winner"`（换皮插件卸载后不留空壳） |
| `plugin-bottom-bar/src/NodeBottomBar.vue` | 顶行补「标记 / 风格」两枚 pill（对齐参考图三枚） |
| `plugin-bottom-bar/src/NodeTaskOverlay.vue` | 加载材质：92% 实底 → 62% + 呼吸动画（「不要黑底卡片」） |
| `plugin-bottom-bar/src/__tests__/bottomBarRender.test.ts` | 两条断言改到新事实（动作收在底部模型下拉 / 默认选可输入那条） |
| `plugin-mock-task-backend/src/mockTaskPlugin.ts` | 两条 mock 动作参数统一成同一套（比例 4 项、张数 1/2/4） |
| `ui/e2e/canvas-e2e.mjs` | `BASE` 支持 `CANVAS_PORT`；底栏装配断言由 `*/out:bottom` 改为 overlay 槽里认领 `bottom-bar/host` |

**过程中真发现的坑（值得记为经验）**：
浮层实例会在不同节点间复用 —— 只换 `id` prop 时，`NodeBottomBar` 只在 setup 读一次节点类型，
于是「选中图片节点却按文本节点渲染、整栏空白」。修法是给 `BottomBarHost` 加 `:key="selectedId"`。
这条在单元测试里照不出来（SSR 单测每个用例都是新实例），只有真浏览器 + 先缩放再选中的序列才能复现。

**验证结果**：`plugin-bottom-bar` 32/32、`plugin-theme-default` 213/213、`canvas-render` 405/405、
`ui` 44/44、`plugin-mock-task-backend` 3/3、`plugin-node-text` 31/31、`plugin-node-image` 111/111；
e2e **50/50**；三个 typecheck 全过。
浏览器实测（Chrome MCP + Playwright，1440×900）：输入区与底部工具栏重叠处点击 → 命中 `ProseMirror`、打字成功；
素材卡常显 2 张带 1/2 角标；点卡片出预览；`@` 菜单贴光标且不出屏；拖动节点底栏跟随（位移 180px）；
加载态无黑底卡片、取消按钮在右下角、**加载中拖动节点位置仍变**。
