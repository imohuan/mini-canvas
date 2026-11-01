# 计划：分组节点遮挡成员（父子关系 / z-index）修复

日期：2026-09-15 · 分支：当前分支 · 状态：**待实施**
作者：code-developer（诊断）· 实施：待认领

> 用户诉求（原话）：
> 「你的这个 packages/plugins/ 中的 group 节点存在问题，如图，这里创建的组节点把节点[给]挡住了，请修复他的 z-index」

---

## 〇、一句话目标

打完组之后：**分组框永远垫在成员下面**（成员、标题、端口、连线都看得见、点得到），
并且成员停在**正确的位置**上（不是被甩到画布原点附近）。

---

## 一、根因（源码证据链，非猜测）

### 1.1 直接原因：父子关系根本没建立起来

内核存的是 `parentId`（相对坐标 + 父子语义），渲染层往 VueFlow 投影时却写成了
**`parentNodeId`** —— 而 VueFlow 1.48.2 读的字段叫 **`parentNode`**。

`packages/canvas-render/src/host/canvasHostCore.ts:82`

```ts
// 现状（错）
if (n.parentId) out.parentNodeId = n.parentId
```

`node_modules/@vue-flow/core/dist/vue-flow-core.mjs:4748`（`createGraphNodes`）

```js
const parsed = parseNode(node, findNode(node.id), node.parentNode)   // ← 只认 parentNode
if (node.parentNode) parentNodes[node.parentNode] = true
// ...
if (node.parentNode && !parentNode) triggerError(... NODE_MISSING_PARENT ...)
```

全仓搜 `parentNodeId` 在 VueFlow 产物里**只出现一次**，而且是「出口」不是「入口」——
它只是 VueFlow 把内部 `parentNode` 传给节点组件 props 时用的名字
（`vue-flow-core.mjs:9616`：`parentNodeId: node.parentNode`）。

类型定义也印证了这点（`@vue-flow/core/dist/types/node.d.ts`）：

| 行 | 字段 | 含义 |
|---|---|---|
| 73 | `parentNode?: string` | **输入**用这个（注释原文：define node as a child node by setting a parent node id）|
| 179 | `parent?: string` | 已废弃 |
| 187 | `parentNodeId?: string` | 同名但运行时代码没读 → 传了没反应 |

### 1.2 为什么表现成「被挡住」

VueFlow 的节点 DOM 是**扁平**的：所有 `.vue-flow__node` 都是 `.vue-flow__nodes` 下的兄弟
（`vue-flow-core.mjs:9759` 每个节点一个 `NodeWrapper`），兄弟之间**靠 z-index 分层**
（`style.css:140`：`.vue-flow__node { position: absolute; pointer-events: all }`）。

而 z-index 来自 `node.computedPosition.z`（`vue-flow-core.mjs:9575`）：

```js
zIndex: node.computedPosition.z ?? zIndex.value
```

`computedPosition.z` 初值是 **0**（`:3553`），**只有真正的父子关系才会把它抬高**
（`:3854` `getXYZPos`）：

```js
z: (parentPos.z > computedPosition.z ? parentPos.z : computedPosition.z) + 1
```

父子关系没建立 → 所有节点 z 全是 0 → 谁在 DOM 后面谁就盖上谁。
`group` 是打组时**最后新建并重灌**的节点，于是它盖住了它的成员。

### 1.3 顺带暴露的第二个问题：成员位置也错了

同一处字段名错了，VueFlow 就不会做「父绝对坐标 + 子相对坐标」的合成
（`:9534-9542`，`parentNode` 为空时直接 `computedPosition = {x: node.position.x, ...}`）。

而内核存子节点位置用的是**相对父的局部坐标**
（`packages/plugins/plugin-group/src/groupPlugin.ts:154`，经 `groupEngine.toRelativePosition`）。
于是成员会被当成绝对坐标渲染 → 视觉上甩到画布原点附近。

> 这两个症状是**同一根因**。用户截图里那个「空的分组框」两者都能解释（成员要么被底色盖住、
> 要么被甩到别处），所以 **T0 必须先实测定性**，不要凭猜开工。

### 1.4 为什么 V1 没这问题

V1 显式把分组压在最底层，不去依赖 VueFlow 的父子 z 提升：

- `packages/canvas-core/src/plugins/group/GroupPlugin.ts:149` —— 建组时写死 `zIndex: 0`
- `packages/canvas-core/src/plugins/group/GroupNode.vue` —— 内容层 `pointer-events: none`，
  文档注释写明 `group-node__body { pointer-events: none }`

V2 两条都丢了，于是问题复现。

---

## 二、目标 / 非目标

### 目标

1. 分组框**永远**在成员与其它普通节点之下（不依赖 DOM 顺序）。
2. 成员渲染在**正确的绝对位置**（相对坐标被正确合成）。
3. 两项都进**自动化测试**（canvas-render 单测 + 浏览器实测），避免再退化。

### 非目标（本轮不做，别顺手扩）

- 拖动分组时成员跟着走（`groupPlugin.ts` 顶部注释已声明 v2 暂不做）。
- 组内成员拖出自动解组 / 分组边界随成员重算（同上）。
- `plugin-align-guide` 对子节点的吸附精度（**已知潜在问题**，见 §六 风险 3；
  修前修后都不对，本轮不引入也不负责）。

---

## 三、修复设计

两条一起做，缺一不可：**修字段**（让父子真的生效）+ **给容器型节点一个明确的低层级**（不赌 DOM 顺序）。

### 3.1 修投影字段

`canvasHostCore.nodesFromStore`：`parentNodeId` → `parentNode`。

修完 VueFlow 会自动：合成成员绝对坐标、把成员 z 抬到「父 z + 1」、给分组加 `isParent`。

### 3.2 类型级能力 `container`：容器节点垫底

只修字段的话，分组和**无关的**普通节点仍是同一个 z（都是 0，按 DOM 顺序），
分组照样可能盖住压在它上面的别的节点。分组在语义上就是「背景容器」，应该显式沉底。

按项目既有做法（`resizable` / `frameless` 都是**类型级能力，由类型自己声明、不让外壳猜**），
在 `CanvasNodeType` 上加一个同层字段，由 `plugin-group` 声明，渲染层读它决定 z：

| 节点 | z-index | 说明 |
|---|---|---|
| 声明了 `container: true` 的类型（当前只有 `group`）| `0` | 容器，垫底 |
| 其余普通节点 | `1` | 永远在容器之上 |
| 容器成员（有父）| VueFlow 算出的 `max(父 z, 自身 z) + 1` = `2` | 仍在容器之上 |
| 中间态脚手架节点 | `1000`（现状不动）| 已有逻辑 |

这样无论打组先后、无论重灌顺序，层级都是确定的。

---

## 四、任务拆解

> 每个任务写明：**改哪个文件 / 改什么 / 怎么测 / 完成标准**。顺序即依赖顺序；T0 不通过不要开 T1。

### T0（先做，必须留证据）复现并定性

**为什么**：§1.3 的两个假设（被盖住 / 被甩走）需要实测区分，否则修完无法判断是否真修好。

**做什么**：`cd packages/ui` 然后 `pnpm dev` → 打开 `http://localhost:5288` →
新画布上放 2~3 个节点 → 选中 ≥2 个 → 按 Ctrl+G 打组。

**记录四样东西**（贴进本文件 §八 验收记录）：

1. 截图（打组前 / 打组后）。
2. 每个 `.vue-flow__node` 的 `getComputedStyle(el).zIndex`（分组与成员各一条）。
3. 每个节点 `el.style.transform`（看成员是被合成成绝对坐标，还是停在相对坐标）。
4. 分组与其成员的**内核实测矩形**（`host.nodeLayout.getNodeRect(id)`）与屏幕位置对比。

**完成标准**：能明确回答「成员是被盖上，还是位置就被渲染错了」，并留下数字/截图。

---

### T1 canvas-render：投影字段改为 `parentNode`

**文件**：`packages/canvas-render/src/host/canvasHostCore.ts`

**改什么**：

1. `FlowNode` 接口（:56）：`parentNodeId?: string` → `parentNode?: string`，并把注释里的
   依据写清（VueFlow 入口字段是 `parentNode`，`parentNodeId` 只是它回传给组件的名字）。
2. `nodesFromStore`（:82）：`out.parentNodeId = n.parentId` → `out.parentNode = n.parentId`。

**怎么测**：`packages/canvas-render/src/host/__tests__/canvasHostCore.test.ts`
现有那条 `parentId/size 投影：parentId → parentNodeId、size → style`（:56-67）
**锁的正是错字段**，必须同步改断言（改后它才是真的在保护行为）：

```ts
it('parentId 投影成 VueFlow 认的 parentNode（而不是 parentNodeId）', () => {
  // 建父 g 与子 c，然后：
  expect(g.parentNode).toBeUndefined()
  expect(c.parentNode).toBe('g')
  // 反向锁定：绝不能再用 VueFlow 不认的那个名字
  expect(c.parentNodeId).toBeUndefined()
})
```

**完成标准**：`packages/canvas-render` 下 `node ./node_modules/vitest/vitest.mjs run` 全绿；
`node ./node_modules/typescript/bin/tsc --noEmit` 0 错。

---

### T2 canvas-data：新增类型级能力 `container`

**文件**：`packages/canvas-data/src/nodeStore.ts`（`CanvasNodeType`，:65-83）

**改什么**：加一个可选布尔字段，与 `frameless` 同层、同风格：

```ts
/**
 * 容器型节点（如分组）：渲染层把它垫在普通节点之下（z-index 更低）。
 * 它是「用来装别的节点的框」，盖住成员就失去意义；层级由类型自己声明，不让外壳猜类型。
 */
container?: boolean
```

**怎么测**：`packages/canvas-data/src/__tests__/nodeStoreV2.test.ts`（或就近文件）加一条：
注册带 `container: true` 的类型后 `store.types.get(t)?.container === true`；不带则该字段 undefined。

**完成标准**：`packages/canvas-data` 下 vitest 全绿。

> 注：这一步只加「声明位」，不改任何行为；行为在 T3 落地。

---

### T3 canvas-render：按 `container` 输出 z-index

**文件**：`packages/canvas-render/src/host/canvasHostCore.ts`

**改什么**：

1. 加两个具名常量（别散落魔法数字）：

```ts
/** 容器型节点（分组）的层级：垫在所有普通节点之下 */
export const NODE_Z_CONTAINER = 0
/** 普通节点层级：永远在容器之上 */
export const NODE_Z_DEFAULT = 1
```

2. `FlowNode` 补 `zIndex?: number`（VueFlow 的节点支持该字段：
   `vue-flow-core.mjs:9478` 读 `Number(node.zIndex ?? getStyle.value.zIndex ?? 0)`，
   并经 `computedPosition.z` 落到 DOM 的 `zIndex`）。
3. `nodesFromStore` 里按类型能力给层级：

```ts
const isContainer = store.types.get(n.type)?.container === true
out.zIndex = isContainer ? NODE_Z_CONTAINER : NODE_Z_DEFAULT
```

**怎么测**：canvasHostCore.test.ts 新增一条，锁「容器垫底、普通节点在上」：

```ts
it('container 类型节点 z-index 更低（分组不盖成员）', () => {
  // store 注册 group(container:true) 与 text，各建一个，断言：
  // groupNode.zIndex === NODE_Z_CONTAINER (0)
  // textNode.zIndex  === NODE_Z_DEFAULT  (1)
})
```

**完成标准**：canvas-render 全绿 + tsc 0 错。

---

### T4 plugin-group：声明自己是容器

**文件**：`packages/plugins/plugin-group/src/groupPlugin.ts`（`ctx.nodes.register` 处，约 :269-275）

**改什么**：注册 group 类型时加 `container: true`（与已有的 `type/label/size/content` 并列）。

**怎么测**：`packages/plugins/plugin-group/src/__tests__/groupPlugin.test.ts` 加一条：
装配后 `nodeStore.types.get(GROUP_NODE_TYPE)?.container === true`。

**完成标准**：`packages/plugins/plugin-group` 下 vitest 全绿。

---

### T5 整装回归（不要只跑单包）

**为什么**：改的是**所有节点**的投影与层级，必须确认没打坏别的插件。

**怎么测**（每个包目录下执行）：

```
node ./node_modules/vitest/vitest.mjs run
```

覆盖：`packages/ui`、`packages/canvas-render`、`packages/canvas-data`、
`packages/plugins/plugin-theme-default`、`plugin-node-text`、`plugin-node-image`、
`plugin-multi-select`、`plugin-align-guide`、`plugin-group`。

**完成标准**：全部全绿；`packages/ui` 的 `vue-tsc` 0 错。

---

### T6 浏览器实测（唯一裁判，逐条过）

`cd packages/ui` 然后 `pnpm dev` → `http://localhost:5288`（热重载，不用重启）：

| # | 操作 | 期望 |
|---|---|---|
| 1 | 2~3 个节点 → Ctrl+G | 分组框在**底下**；成员、标题、端口、连线**全部可见可点** |
| 2 | 每个 `.vue-flow__node` 的 `zIndex` | 分组 `0`、普通节点 `1`、成员 `2` |
| 3 | 成员的 `transform` | 与 `host.nodeLayout.getNodeRect(成员)` 的绝对坐标一致（不再甩到原点） |
| 4 | 拖动**分组** | 分组框跟手；成员保持不动（本轮已知限制，见 T7） |
| 5 | 拖动**成员**出组 | `ungroupIfLeft` 生效，成员回到顶层且位置正确 |
| 6 | 解组（Ctrl+Shift+G / 右上角按钮） | 成员回绝对坐标、分组消失、层级恢复正常 |
| 7 | 打组后**刷新页面** | 恢复后层级与位置仍然正确（走 localStorage 存档） |
| 8 | 分组**与其它节点重叠** | 其它普通节点仍盖在分组之上（这是 T3 相比只修字段的增量价值） |

**完成标准**：8 条全过，并截图留证（贴 §八）。

---

### T7 记录已知限制（不修，但要写下来）

**文件**：`packages/plugins/plugin-group/src/groupPlugin.ts` 顶部注释

**改什么**：把「拖动分组时成员不跟随」从「暂不做」升级成明确记录：
现状 + 原因（VueFlow 父子拖拽语义未接线）+ 影响面。避免下次有人当 bug 重查。

**完成标准**：注释里能读到本轮结论，不需要翻聊天记录。

---

### T8 文档收尾

**文件**：`docs/STATUS.md`（顶部「本轮」）

**改什么**：写清根因（字段名不匹配 + z 全 0）、改法（§三）、证据（T0 的数字 + T6 的 8 条）、
测试数、以及 §六 的遗留。**不写没实测过的结论**。

**完成标准**：`docs/STATUS.md` 的「本轮」能独立复现判断，后来者只读它就能接手。

---

## 五、改动清单（一屏总览）

| 文件 | 改动 | 任务 |
|---|---|---|
| `packages/canvas-render/src/host/canvasHostCore.ts` | `parentNodeId`→`parentNode`；加 `NODE_Z_*` 常量；按 `container` 输出 `zIndex` | T1 T3 |
| `packages/canvas-data/src/nodeStore.ts` | `CanvasNodeType` 加 `container?: boolean` | T2 |
| `packages/plugins/plugin-group/src/groupPlugin.ts` | 类型注册加 `container: true`；补已知限制注释 | T4 T7 |
| `packages/canvas-render/src/host/__tests__/canvasHostCore.test.ts` | 改断言（旧断言锁的是错字段）+ 新增层级测试 | T1 T3 |
| `packages/canvas-data/src/__tests__/nodeStoreV2.test.ts` | 新增 `container` 声明测试 | T2 |
| `packages/plugins/plugin-group/src/__tests__/groupPlugin.test.ts` | 新增 `container: true` 装配测试 | T4 |
| `docs/STATUS.md` | 本轮记录 | T8 |

**不动的文件（重要）**：

- `packages/plugins/plugin-theme-default/src/components/node/BaseNode.vue`（核心节点件，AGENTS 红线）
- `packages/plugins/plugin-group/src/GroupContent.vue`（层级问题不在它的 CSS）
- `src/`（老版宿主，AGENTS 红线）

---

## 六、回归风险清单（改完逐条确认）

1. **成员坐标语义变化（预期内的修正）**：修字段后成员的 DOM 位置会从「相对坐标」变成「绝对坐标」。
   对**已存在的旧存档**，成员会在修好后「归位」，看起来像位置变了 —— 这是修对，不是回归。
   T6-3 用数字确认。
2. **拖动落盘仍写相对坐标**：`CanvasHost.onNodeDragStop` 写回的是 `e.node.position`，
   而 VueFlow 对子节点保留 `position`（相对）、把绝对放 `computedPosition`。
   所以「相对进、相对出」是自洽的。**必须实测**：T6-5 拖成员后刷新，位置不偏。
3. **`plugin-align-guide` 对子节点吸附**：它用 `RenderEvents.NodeDrag` 的 payload（子节点是相对坐标）
   去和 `visibleNodes()`（绝对坐标）比。修前修后对子节点都不准，**不是本轮引入**。
   若实测发现明显异常，登记到 `docs/STATUS.md` 遗留，不在本轮修。
4. **`hitNodeIdAt` / 命中测试**：走 `nodeLayout`（已按父链拍平为绝对），不受影响。
5. **`plugin-clipboard`**：复制粘贴读的是内核 `parentId`（相对坐标成对搬运），不受影响。
6. **`isParent` 带来的新 DOM class**：VueFlow 会给分组节点加 `parent` 类。
   确认没有主题 CSS 依赖它（当前无），也没有插件按 `isParent` 分支。

---

## 七、回滚

改动集中在 3 个源文件、且都是「投影 / 声明」层，无数据迁移、无存档格式变化：

```
git checkout -- packages/canvas-render/src/host/canvasHostCore.ts
git checkout -- packages/canvas-data/src/nodeStore.ts
git checkout -- packages/plugins/plugin-group/src/groupPlugin.ts
```

（测试文件同期回滚即可。存档里 `parentId` / 相对坐标的写法**本轮不变**，所以回滚不需要动数据。）

---

## 八、验收记录（实施时填写）

### T0 复现定性

- [ ] 截图（打组前 / 打组后）
- [ ] 分组与成员的 `getComputedStyle(el).zIndex`
- [ ] 分组与成员的 `el.style.transform`
- [ ] 内核实测矩形 vs 屏幕位置对照
- 结论（成员是被盖上 / 还是位置就错了）：____

### T1~T5 测试

- [ ] canvas-render 全绿（__ 条）
- [ ] canvas-data 全绿（__ 条）
- [ ] plugin-group 全绿（__ 条）
- [ ] ui 整装全绿（__ 条）
- [ ] 其余相关包全绿（主题 / text / image / multi-select / align-guide）
- [ ] `tsc` / `vue-tsc` 0 错

### T6 浏览器实测

- [ ] 8 条逐条通过 + 截图

### 遗留

- ____（对齐辅助线对子节点吸附；分组拖动不带走成员）

---

## 九、为什么这么修（给后来者的判断依据）

- **不选「只给分组加个 CSS `z-index: -1`」**：分组节点由 VueFlow 渲染，
  层级写在自身 CSS 里会被 VueFlow 的内联 `zIndex` 覆盖（`:9575`，内联样式优先），
  而且治不了「成员位置错」那一半。
- **不选「只修字段」**：分组与无关普通节点仍同为 z=0，按 DOM 顺序决定谁盖谁 ——
  打组顺序一变问题就回来。显式层级才稳。
- **不选「在 GroupContent.vue 里调 CSS 盖过去」**：层级不是它的问题（§五 不动该文件），
  在那儿改只会把根因藏起来。
- **新增 `container` 而不是让渲染层判断 `type === group`**：渲染层不认识业务类型，
  这与项目既有约定一致（`resizable` / `frameless` 都这么办），也让将来别的容器型节点白拿。

