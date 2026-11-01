# Code Review 结论文档 — 设置面板可替换 + 边下沉内核

- 审查范围：`37247aa..HEAD`（commit c24dcb7 阶段 A + c49c007 阶段 B）
- 基准：37247aa（merge-base 即此提交，`git rev-parse` 命中 `37247aab…`）
- 审查人：code-developer（agent）· 日期 2026-09-06
- Spec 来源：`docs/plan/settings-panel-slot-host-plan.md`
- 排除项：`plugin-theme-default/src/index.ts`（他人未提交改动，未审查、未计入）

## 验证执行情况（独立运行，非仅凭陈述）

| 验证项 | 命令 | 结果 |
|---|---|---|
| canvas-core-v2 测试 | `node node_modules/vitest/vitest.mjs run` | ✅ 21 文件 221 测试全绿（含新 edgeStore.test 7 条） |
| canvas-render 测试 | 同上 | ✅ 6 文件 47 测试全绿（含 settingsSource 4 条、fullchain 边下沉 4 条） |
| canvas-render vue-tsc | `node ../../node_modules/vue-tsc/bin/vue-tsc.js --noEmit -p tsconfig.vue.json` | ✅ exit 0，无错误 |
| plugin-theme-default tsc | `tsc --noEmit -p tsconfig.json` | ✅ exit 0 |
| plugin-canvas-commands tsc | 同上 | ✅ exit 0 |
| canvas-core-v2 整包 tsc | `tsc --noEmit -p tsconfig.json` | ⚠️ 1 处：`canvasServices.test.ts(44,25) TS2339 Property 'size' does not exist on type 'never'`。**git diff 37247aa HEAD 该文件为空 = 未在本次改动内**，且已在基准 37247aa 存在 → 确认为他人/历史预存错误，与本改动无关，不计入问题。 |

> 备注：Windows 下 `.bin/vitest` 是 POSIX shell 脚本无法直接跑，改用 `node node_modules/vitest/vitest.mjs run`（等价）。

---

# 1. Standards（规范）

### S1（建议改）新增 `GRAPH_KEY` 常量是死导出，`GRAPH_EDGES_KEY` 半途接入 — 字面量/常量不一致
- `keys.ts` 新增 `GRAPH_KEY`/`GRAPH_EDGES_KEY`，但 grep 全仓：
  - `GRAPH_KEY` **从未被任何代码 import 使用**（只在 keys.ts 定义 + index.ts 导出）。
  - 所有 `graph` 读写都硬编码字面量 `'graph'`（CanvasHost defaultWrite/dragStop、commands、node-text、node-image、createMiniCanvasHost boot restore、fullchain 测试）。
  - `graph-edges` 侧：CanvasHost、commands 用了常量 `GRAPH_EDGES_KEY`，但 **createMiniCanvasHost.ts:178 的 boot 恢复却写死字面量 `'graph-edges'`**。
- 修法建议：统一——要么全部走常量，要么删掉这两个没被用透的导出。至少把 boot restore 的字面量换成 `GRAPH_EDGES_KEY`，并让 `graph` 写入方用 `GRAPH_KEY`，消除"同类 key 一半常量一半字面量"的分裂。（不是硬错误，属一致性/维护性。）

### S2（建议改）`EdgeStore.pruneDanglingEdges` 生产路径死代码，悬挂清理逻辑重复两处
- 计划 §三.D 想让它作为兜底清悬挂边，但 CanvasHost `syncFromStore` 是**内联 `.filter(alive)`** 清悬挂，从不调用 `edgeStore.pruneDanglingEdges`（后者只被自己的单测调用）。
- 同一"按存活节点清悬挂"的意图存在两处实现（edgeStore 方法 + CanvasHost 映射内联 filter），属 Duplicated Code / 方法死了却没删。若内联 filter 足够，建议删掉 store 里的方法；若想保留方法语义，则由删除命令/restore 显式调用，别让渲染层内联再抄一遍。

### S3（轻微）`SettingsHost.vue` 里 `const props = defineProps(...)` 绑定未在脚本中引用（模板用 unwrap 后的 `emptyHint`）
- vue-tsc 绿（未开 noUnusedLocals 之类），不报错，仅 lint 层面可能提示未用变量。可改成不给返回值。

### S4（轻微）`edgeStore.replaceAll` 的 `{ ...e, id } as CanvasEdge` 强转
- 用 `as` 吞掉类型收口，`source/target/type` 在 `StoredEdgeInput` 侧 source/target 必填，`type` 可空，`as CanvasEdge` 后 type 仍可 undefined，符合 CanvasEdge 可选 type 语义，不算错，但 `as` 属薄弱收口。可加一个归一化构造而非断言（低优先）。

### 无明显硬错误 / 无明显死代码残留
- CanvasHost 移除 `edgeId`/`pruneDanglingEdges` import 后，`canvasHostCore` 仍导出它们、`index.ts` 仍导出（`edgeId` 现无人用但作为公开 API 保留可接受；`pruneDanglingEdges` 见 S2）。
- SettingsHost 事件名 `ctx:plugin-installed/uninstalled` 与内核 EventBus `knownEvents` 完全一致，正确。
- demo CanvasDemo 无残留死引用：`SettingsStore`(bindThemeSettings 用)、debug `SettingsPanel` 均仍使用。

---

# 2. Spec / 设计符合度

## 目标达成总体判断
两阶段目标**基本达成**：
- 阶段 A：设置面板 = theme 单赢家槽 `settingsPanel`，`SettingsHost` 读 `winner('settingsPanel')`（winner 取 order 最小者，已核 themeRegistry 排序：小 order 赢）渲染 + 实时喂 `ctx.settings`；默认皮由 `plugin-theme-default/settings.ts` 独立模块注册（避免动他人 index.ts，符合计划 §三.B）；宿主 UI 区 `#ui` 转发到 CanvasSurface 作用域内，SlotHost/SettingsHost 嵌套可用。✅ 可替换目标达成。
- 阶段 B：EdgeStore 纯逻辑内核服务、注入 ctx+host、history 快照扩为 `{nodes,edges}`、节点 `graph` + 边 `graph-edges` 分存、旧纯数组兼容、CanvasHost/commands 改读写内核边。✅ 主要目标达成。

## 你列出的顾虑逐条回答

### (a) history restore 双 store 不一致窗口 —— **可接受（有前提）**
`restore` 里 `nodeStore.replaceAll` 与 `edgeStore.replaceAll` 顺序执行，各自同步 `notify` → `syncFromStore` 连续跑两遍（节点已换、边未换的中间态会触发一次过滤）。但因两者都在 `history.undo()/redo()` **同一同步调用栈内**完成，Vue 只在本轮微任务末尾渲染一次，**无可见闪烁/不一致窗口**。前提：没有"非 Vue、只订阅 nodeStore 又去读边"的第三方消费方（当前无）。结论：逻辑上不原子但工程上安全，可接受。

### (b) SettingsHost 放 #ui 槽的 ctx 时序 —— **无问题**
CanvasSurface **boot 完成后才挂载**（CanvasHost 里 `v-else`，booting=false 后才进子树），其 provide 作用域覆盖 `<slot name="ui"/>`（#ui 在 `.csurface` 内、VueFlow 之外）。SettingsHost 经 `useCanvasRender()` 拿裸 ctx 时宿主必已就绪 → 零 `.value`、零判空，时序成立。唯一约束：宿主须把设置 UI 放 `#ui`（不能塞进默认槽进 VueFlow 内部）——demo 已照做。✅

### (c) 边独立 key 分存 vs 计划文档的单信封 —— **偏离计划但取舍合理；有 1 个真实缺口（见 Must-1 / W-2）**
- 计划 §三.D 文字写的是 `graph` 值升级为 `{nodes,edges}` 信封；实现改为 `graph`(仅节点) + `graph-edges`(独立边)。**这是对已拍板文档的主动偏离**，未同步更新计划文字（计划仍写信封），文档与代码不一致，建议回填文档说明分存决策。
- 但分存本身是**更安全**的取舍：仓库里 node-text/node-image/CanvasHost 等大量既有写入方都写**纯节点数组**到 `graph`。若按信封设计，这些写方把节点数组覆盖上去，boot 按数组解读 → **边会整体丢失**；分存后这些写方只碰 `graph`，`graph-edges` 不受影响 → 反而防住了"节点插件弄丢边"。这是分存的主要优点，成立。
- 两 key flush 不同步风险：`SaveService.set` 把同 type 的两 key 放进同一 dirty 批、一次 flush 顺序写，崩溃窗口极小；且各写入路径各自维护本 key 一致（onConnect 只写边、节点写方只写节点、command:delete 双写）。**未见会导致两 key 长期失配的路径**。唯一缺口见 W-2（undo/redo 不落盘，两 key 同时停留在撤销前快照，彼此仍一致，只是刷新丢撤销——这是**既有**行为，非本次引入）。
- 防御性信封读取分支（`else if (saved && Array.isArray(saved.nodes))`）**无任何写方产生信封、无测试覆盖** → 属 Speculative Generality 死分支，建议删或补测试。

### (d) commands 插件 import GRAPH_EDGES_KEY 自 canvas-core-v2 —— **依赖方向可接受**
canvas-commands → canvas-core-v2 本就是"插件→内核"的正常依赖方向（node-text/image 已同样依赖 core）。内核拥有持久化 key 常量、插件/渲染层引用它，方向正确。真正的隐患不在 import 方向，而在 **key 归属分散**：CanvasHost(渲染层) 和 commands(插件) 都各自知道"graph 存节点、graph-edges 存边"的约定并各自实现双写/单写，靠约定保持同步、无单一入口 —— 属 Shotgun Surgery 类的耦合信号（见 W-1）。常量放在 core 是合理的收拢点，问题是没有一个"落盘当前图(节点+边)"的内核级 helper 让各方复用，导致 onConnect 只写边、defaultWrite 只写节点、commands 才双写。

### (e) isValidConnection 读本地 edges.value 而非 edgeStore —— **可接受**
计划 §三.D 字面要求读 `edgeStore.getEdges()`，实现仍读 `edges.value`。但 `edges.value` 现由 `edgeStore.subscribe` 驱动、每次变化立即重建（`filter(alive)` 只剔除悬挂边，而悬挂边的端点已不在 nodeStore，本就无法再连），对"重复/自连/环/朝向"校验而言与直读 store **等价甚至更严**。故行为正确，仅与文档措辞不符，属轻微 spec 措辞偏离，无需改。

## 逐档结论

### 🔴 必须修（Must-fix）
**Must-1（Spec 缺口）：画一条新边（onConnect→addEdge）不包进 history → 新边不可撤销。**
计划 §三.D 明确"边增删/删节点清边都包进 withRecord，undo/redo 对边全部生效"。现状：`command:delete` 删节点带清边**有** history 包裹（undo 能还原边，测试覆盖）；但 `CanvasHost.onConnect` 里 `edgeStore.addEdge` **没有任何 `history.withRecord` 包裹** → 用户刚拉一条连线，Ctrl+Z 无法撤销它，边一旦画出只能靠删端点节点清掉。这与"边进历史、可撤销"的主目标相悖。建议在 onConnect 里用 `history.withRecord(() => h.edgeStore.addEdge(...))` 包一层（并让 record 落盘双 key），补一条"拉边→undo 消失"的测试。（注：addEdge 前校验 + record 的 before/after 快照因边 id 稳定，能正常识别变化。）

### 🟡 建议改（Should-fix / 一致性）
- **W-1**：边持久化"双 key + 谁负责写哪个"的约定散在渲染层(CanvasHost)与 commands 插件，建议内核提供单一"落盘图(节点+边)"helper（如 `persistGraph(save,nodeStore,edgeStore)`）让各方复用，消灭 onConnect 只写边 / defaultWrite 只写节点 / delete 双写的人为对齐负担，降低未来漏写一侧的风险。
- **W-2**：undo/redo 只改内存不 `persist()`（`command:undo/redo` 未落盘）——节点旧行为如此（非本次引入），但边下沉后问题随边一起放大：撤销后刷新页面会回到撤销前状态。既然本次在"落盘含边"上下了功夫，建议顺手让 undo/redo 也 persist 双 key（可与 W-1 同处落）。属既有模式延伸，非本 diff 新增回归，故列为建议。
- **W-3（文档回填）**：计划 §三.D 仍写"graph 信封 {nodes,edges}"，实现已改为分存，文档与代码不一致；同时新增的防御性信封读取分支既无写方又无测试。建议：回填计划说明分存决策；信封分支要么补测试要么删。
- **W-4**：见 Standards S1（key 常量半接入）/ S2（pruneDanglingEdges 死代码 + 悬挂清理重复）。

### 🟢 可接受（Acceptable）
- 分存设计整体（见 (c) 分析，比信封更抗"节点插件覆盖丢边"）。
- 事件时序 (#ui 提供 ctx)、event 名、SettingsHost 特化喂 settings 的数据流（§三.A 方案 i 现取）——均符合计划。
- (a)/(e) 所述窗口与 store 直读问题，行为均正确。
- canvas-core-v2 的 canvasServices.test.ts tsc 预存错误与本改动无关（已核实该文件在范围内零改动、错误基准即存在）。
- vue-tsc / 各插件 tsc / 两包测试全绿。

## 改动清单（文件级）
- **内核 canvas-core-v2**：`src/services/edgeStore.ts`(新) / `index.ts`(导出) / `storage/keys.ts`(GRAPH_KEY/GRAPH_EDGES_KEY) / `src/services/__tests__/edgeStore.test.ts`(新)。
- **渲染 canvas-render**：`components/SettingsHost.vue`(新)、`settingsSource.ts`(新)、`settingsPanelTypes.ts`(沿用)、`settingsSource.test.ts`(新)；`host/CanvasHost.vue`、`CanvasSurface.vue`(#ui)、`createMiniCanvasHost.ts`(注入 edgeStore + history 信封 + boot 兼容恢复)；`host/__tests__/fullchain.test.ts`(边下沉 4 条)；`index.ts`(导出)。
- **插件**：`plugin-theme-default/src/settings.ts`(新，注册默认设置面板)；`plugin-canvas-commands/src/canvasCommandsPlugin.ts`(删节点连带清边 + persist 双 key)。
- **demo**：`canvas-core-v2/demo-web/CanvasDemo.vue`（#ui 内 SettingsHost，删硬写 PluginSettingsPanel）。

---
**说明**：本报告为只读审查，未改动任何代码。中间文档按惯例留于 `docs/tmp/`（本任务目录 code-review-settings-edge/），任务结束后如需清理可再议。
