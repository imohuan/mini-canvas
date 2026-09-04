# runbook 审核报告（canvas-core-v2-runbook.md 查漏补缺）

日期：2026-09-04 · 分支：feat/cordis-plugin-system
审核对象：`docs/plan/canvas-core-v2-runbook.md`（M0✅~M6）
复核基准：codegraph 索引 229 文件 / 3109 符号 + 逐一精读 v1 关键复杂件现状 + 逐条核对 v2 源码 `packages/canvas-core-v2/src` 与 `package.json` 实际落盘状态。
方法：不凭文档印象，全部以"我现在看到的代码/文件真实行数/依赖状态"为准核。

---

## 〇、一句话总评

runbook 的结构（北极星 + 铁律 + 里程碑链 + 验收命令 + owner）是对的、是能照着跑的；**但它拍脑袋时面向的是"完整内核能力"，而用户现在要的是"开发测试期先做基础功能最小闭环"——两者范围没有对上**。M1~M6 的粒度、image 何时进来、连接判断何时碰、Decoration 怎么移植，这几处是"文档自己以为覆盖了、实则没落到最小闭环能验收"的空洞。下面逐条给证据和可照做的修订。

---

## A. 范围澄清 —— runbook 没有明确回答"全迁 vs 只做基础"

### A1. 现状证据（runbook 内部自相矛盾）

- runbook M6（第 81~83 行）写"image/Video/panorama/image-compare 迁移……**另开任务，不在本 runbook**"，这看起来像"只做基础"。
- 但 M2（第 55~63 行）又把 `components/Decoration`（BaseNode 等）列为移植对象、M5（第 75~79 行）把 image/panorama 的声明式连接约束 `inputs/accepts/limit` 列为验收，M6 却又把 image/panorama 全推出去了——**M5 验收里写的"image/panorama 的连接约束可用 schema 表达"和 M6"image 另开任务"直接打架**：image 还没迁进来，M5 拿什么"验收 image 的约束"？
- 北极星验收标准第 1 条（第 12 行）只写"能拖拽/可编辑的 **text** 节点画布"——通篇没提 image。但用户三条要求里第 1 条明确讲"加 2 个节点：一个 text、一个 image"。

**结论**：runbook 的"范围"只覆盖了 text（M1/M2/M4 全是 text），image 只在 M6 一句话里被推走。用户要的"text + image 两节点最小闭环"，runbook **没有承接**。这是最大的空洞。

### A2. 建议的范围表述（当前 runbook 应聚焦）

给 runbook 加一节"本节目标范围 = **开发测试期基础功能最小闭环**，北极星验收里"text"改为"text + image"两节点"。清单化：

**本 runbook（M1~M5）必须落地：**
1. 2 个基础节点：**text**（M1 已有雏形）+ **最简 image**（只显示一张图，无裁剪/蒙版/backend 模型，见 B1）。
2. 画布基础操作：拖拽移动节点、**最简连一条边并做"能否连接"判断**、删除节点、多选基础（至少能框选 2 个）。
3. 起 vite 看得到东西 + 编辑 + 刷新恢复。

**明确"后续另开任务"（不是本 runbook，M6 重新定义）：**
- image 的裁剪/扩展/蒙版/backend 生成模型（ImageBottomToolbar.vue 910 行那套）→ 另开。
- Video / panorama / image-compare → 另开。
- 25+ 交互插件（history 完整/group/multi-select 完整/align-*/edge-cutting/mini-map/export…）→ 另开。
- MCP/云 authority 收敛 → 另开。

在文档顶部写一句"**本 runbook 只做上面的最小闭环；M6 以下的复杂件一律不允许在 M1~M5 顺手带上**"，把 owner 铁律第 3 条"一个 step 只碰自己列的文件"落实成"没列进 M1~M5 的东西=本 runbook 不做"。

---

## B. 漏项/缺口清单（逐条对应 M1~M5）

### B1. 【严重】image 节点怎么进 v2 —— runbook 完全没讲，且 M6 推走与用户要求冲突

**证据（image 真实复杂度，非想象）**：
- `nodes/image/` 共 10 个 .vue + 插件/模型 .ts，行数 3825+（ImageBottomToolbar.vue 910 行、ImageNode.vue 490 行、ImageMasker.vue 398、ImageCropper.vue 363、ImageExpander.vue 318）。另 audit-image-video P1~P12 把它定性为"最难迁移的两类"（selfRender 整卡自定义、_overlay 模式状态机、模型 provider 全局单例、backend 模型）。
- v2 目前（我逐文件核过 `src/`）**只有 text 插件**（`plugins/nodeText.ts` 68 行），NodeStore 里 `types` 只有 'text'。

**判断**：v1 image 那套全量迁进来在开发测试期显然不现实。**但用户要"加一个 image 节点"**，这跟 M6 把 image 整个推走是对不上的。

**修订建议（可照做）**：在 M1（或新插一个 M1.5/直接并进 M1）加一个**"最简 image 节点"**——只做两件事：① `ctx.plugin` 注册 `type:'image'`，defaultSize；② content 组件 = 一个 `<img>`，数据只需 `data.imageUrl`（或上传一个本地文件 → objectURL 塞进 imageUrl）。**明确排除**：裁剪/扩展/蒙版/生成模型/backend/ImageBottomToolbar/AssetStore 资产落盘（这些留在 M6）。这样最小闭环才有"text + image 两个节点"可连。
- 承接点：审计 audit-simple-nodes §3.5 和 audit-image-video §3.6 已经把"image 降级为纯 content + overlay slot"的组合方案写好了，M1 image 就是它最薄的一层（content=`<img>`），照抄思路即可，不用发明。

### B2. 【严重】"画布基础操作"没排进任何 M —— 用户明说要"可拖拽/可编辑/能连"

**证据**：
- 北极星验收第 1 条（runbook 第 12 行）说"可拖拽/可编辑的 text 画布"，但 M1~M6 **没有一条里程碑把"拖拽移动 / 删除 / 多选"单独列为可验收步骤**。M1 交付只有"起 vite + 渲染 text + localStorage 恢复"（第 39~48 行）；拖拽其实是 VueFlow `<VueFlow>` 白送的能力（default 即可拖），但 runbook 既没写"我要在 demo 里把 nodesDraggable 开起来验证能拖"，也没写删除/多选怎么验收。
- v2 NodeStore（我核过）目前只有 addNode/updateNodeData/replaceAll，**没有 removeNode**，也没有任何"多选"概念——这些不是 VueFlow 会自动有的，得写进 NodeStore + demo。

**修订建议**：给 M1（起 vite 那步）补一个明确的验收子项"**能在画布上拖拽移动 text/image 节点、能删除、能多选两个**"，并给 NodeStore 补 `removeNode(id)`（API 契约定稿 §三 3.4 NodeService 有 `createAt/updateData/getData`，删节点在 §三 3.2 的 `command:delete`——M1 可以先做一个最简 NodeStore.remove + demo 里接 VueFlow 的 onNodeClick 删除；完整删除命令留给 M3 的 command:delete）。至少 M1 要把"拖拽（VueFlow 白送）+ 删除 + 刷新不丢"验证到，否则北极星验收第 1 条悬空。

### B3. 【严重】连接判断（用户极在意）排到 M5 太靠后

**证据**：
- 用户三条要求第 2、3 条都强调"开发测试期就想要判断连接线是否链接""极在意连接判断别改坏"。
- runbook 把连接内核排在 **M5**（第 75 行），且在 M5 之前 M1~M4 **没有任何一条边/连接**——也就是说用户可能先做完 M1~M4 才第一次碰连接，这个"先碰连接"的时刻太晚。
- v1 `useCanvasConnection.ts` **1300 行**、`ConnectionValidator.ts` 有 `normalizeConnection`/`isValidCanvasConnection`（我 grep 核实，含环检测 wouldCreateCycle:197、重复边 isSameCanonicalConnection:221、canonical 规范化 normalizeConnection:166-184、吸附区域 findNearestValidTarget 302 / findNearestValidSource 359）。这不是一行 isValidConnection 的事，是整套严格规则。

**判断**：M5 单独做"连接内核"是合理的**收口**里程碑，不该删；但"开发测试期就想看到能连、能判断"不能等到 M5。VueFlow 自带 `onConnect` + 最基础的连边渲染（`is-valid-connection` prop 就能接回调），M1 起 vite 时只要给 `<VueFlow>` 加一条 `onConnect` 就能先连起来。

**修订建议**：把"最简连接（能连一条边 + 一个极简 isValidConnection 判断）"提前并进 **M1**，作为最小闭环的"画布操作"一部分；M5 保留"吸收 v1 1300 行严格校验（环/去重/吸附）+ 行为契约测试"作为**加固里程碑**。M1 的"最简 isValidConnection"只做一条规则即可（如"不许 self-loop / 不许连自己"），并把 v1 的 `normalizeConnection` 的 canonical 判定思想抄成一个纯函数版本 + 写进契约，保证 M5 吸收时不推倒重来。这样用户开发测试期就能"连上线 + 看判断结果"，M5 再锁死严格规则。注意：给 VueFlow 程序化连边/自定义 handle 时补 `sourcePosition/targetPosition`（见工作区记忆 vueflow-node-handle-position）。

### B4. 【中】Decoration（BaseNode 等）"一次移植"是否现实

**证据（真实复杂度）**：
- `components/Decoration/` 6 文件 **1714 行**：BaseNode.vue 783、MovingHandle.vue 468、ToolbarButton.vue 170、BaseTitle.vue 115、NodeToolbar.vue 111、ResizeHandle.vue 67（我 wc -l 核实）。
- depmap 把它列进 owner D（"简单节点+渲染体系"），audit-simple-nodes §2.3/★2.3、audit-image-video P1 都指出 v1 的 BaseNode 跟 selfRender/registry 纠缠很深（BaseNode 具名 slot 被 image/video 自渲染路径整段复用）。

**判断**：runbook M2 写"从 v1 components/Decoration 移植精简"（第 60 行），方向对，但**没说清"移植多少、精简到什么程度"**。783 行 BaseNode 一次全搬进来做 text 最小闭环是**过载**——text 只需要"一个壳：标题 + 内容 + 可拖拽 + 双击编辑"，用不到 BaseNode 里为 image/video 服务的六插槽/overlay/_toolbarGroup 那套。

**修订建议**：M2 明确为"**先做够跑的最小 BaseNode 壳**"：只实现 `node:{type}:*` slot 路由里的 content + title + 默认空 top/bottom toolbar，不搬 MovingHandle 吸附那 468 行、不搬 ResizeHandle 的高级 resize（text 用 VueFlow 自带 handle 或最简一个），等 image（M6）真正进来需要六插槽/overlay 时再逐段从 v1 移植并配契约测试。一句话：**M2 搬"够 text+最简 image 渲染"的最小壳，不是把 1714 行一次吞进来**。同时把 v1 BaseNode 作为"只读借鉴/后续移植源"，写进 owner 严禁碰清单（runbook 第 110 行已写"老版 components/Decoration 只可读借鉴"——对，保持住）。

### B5. 【中】M5 验收里 image/panorama 约束与 M6 冲突（同 A1），需自洽

runbook M5 验收（第 78 行）"image/panorama 的连接约束可用 schema 表达"——既然 image/panorama 在 M6 另开，M5 这句话应删掉或改为"为将来 image/panorama 预留的声明式 `inputs/accepts/limit` 机制已就绪，用假想类型（如一个 test-only 可连节点）验证，不用等 image"。建议 M5 用一个最小"可连"节点（type:'t'，inputs accept 'text'）当连接闭环载体，别拿未迁入的 image/panorama 当验收对象。

---

## C. runbook 自身质量问题（每步验收/纠偏够不够自查）

### C1. 每步验收命令大多可执行，但"浏览器肉眼看"无法自动化自查

runbook 铁律第 1 条说"测试是唯一裁判""以为过了=没跑"（第 20 行），但 M1 验收第 2 条"`pnpm dev` 起服务无错；**浏览器能看到** text 节点、能编辑、刷新文本还在"（第 47 行）是**人工肉眼看**，没有自动化判据。这与"测试是唯一裁判"的铁律自相矛盾。

**修订建议**：M1 起 vite 那步**先加一个 Playwright/无头浏览器测试**作为自动化验收（环境里 chrome-devtools MCP 有浏览器全流程能力可用），判据 = "打开 localhost 端口 → 断言页面出现 text 节点 → 模拟编辑 → 刷新 → 断言文本还在"。浏览器可视化是**给用户看的演示层**，但"能跑、能恢复"必须有无头测试兜底，否则铁律第 1 条对 M1 失效。可降级做法：把"localStorage 恢复"已经在 `demo.test.ts` 用 MemoryStorageAdapter 覆盖了（我核过该测试第 2 条已测刷新恢复），M1 只要把"起服务 + 页面有节点渲染"补一个冒烟断言即可。

### C2. M2/M3 验收缺"看得到"的判据

- M2 验收（第 62 行）"registry 注册即响应式；text 节点渲染经过 NodeRenderer；tsc + vitest 绿"——"响应式"和"经过 NodeRenderer"是**实现细节**，没写成可断言的输出。建议写清：新增的 vitest 组件测试（如果走 @vue/test-utils）或至少一个契约测试断言"注册 type → NodeRenderer 按 type 查到 content 组件"。若 v2 组件测试环境没搭（vitest.config environment:'node'，我核过 v2 是 node 环境），**M2 涉及 .vue 渲染就测不了**——需要先把 vitest environment 配成 happy-dom/jsdom 或让 NodeRenderer 逻辑抽成纯函数测试。这是个隐藏的前提缺口，runbook 没提。
- M3 验收（第 68 行）"画布上能右键建 text"——又回到肉眼看。建议同理补无头断言或降级为"命令执行 + store 断言"。

### C3. owner/红线已较完整，但缺一条显式"别把 M6 复杂件带进 M1~M5"

runbook 全局严禁碰 `src/`（老版宿主）这条写得很清楚（第 14 行、第 109 行、第 130 行）——好，这条必须保留。缺的是：**没有显式写"image/video 的复杂件（backend 模型、_overlay、ImageBottomToolbar 那套）不进入 M1~M5"**。执行期最容易的越界就是"我在做 image 最简节点时顺手把 Masker/Cropper 结构抄进来了"。建议在"不碰"清单加一行：`canvas-core/src/nodes/{image,Video,panorama,image-compare} 复杂件 = M6，M1~M5 只允许借鉴其"content=<img>/<video>"最薄渲染，严禁搬运 backend/_overlay/编辑模式`。

### C4. 每步 commit 粒度与"原子性"已写，但"集成验证留主 agent"这条建议在每个 M 里点名

runbook §三.2/铁律第 8 条（第 27 行）已写"集成验证/评审关卡永远留在主 agent"。好，够。建议在 M1（第一个起 vite、涉及 package.json 依赖变更 + 浏览器）时主 agent 亲自做一次"tsc + 全量测试 + 起服务"三连验证，作为后续 owner 划分的模板（呼应记忆 ai-refactor-coordination 第 6 条汇合关卡）。

---

## D. 修订建议 —— 把 M1~M5 重排成"开发测试期基础功能最小闭环"

目标形态：用户跑完本 runbook，能**在 vite 里看到 text + image 两个节点、能拖、能连一条边并能判断、能删、刷新不丢**。建议重排如下（只改 M1/M2 的粒度与顺序，M3/M4/M5 保留但补 image/操作内容；M6 保持另开）：

**M1（起 vite + 最小闭环骨架）—— 先跑起来看到东西**
1. `package.json` 把 vue/@vue-flow/core/vite/@vitejs/plugin-vue 从 peer 转实际依赖（runbook 已写，保持），根 node_modules 里 vue/vue-flow/vite/@vitejs 都已存在（我核过 root 有），装包成本低。
2. 建 `vite.config.ts` + `demo-web/index.html` + `demo-web/main.ts` + `CanvasDemo.vue`（runbook M1 交付，目前 v2 目录里 **还没有** 这些文件——我 ls 核实只有 src/，demo-web/vite.config 都不存在，所以 M1 是真实待做，不是已完成）。
3. localStorageAdapter.ts（runbook M1 已列，未做——目前 v2 只有 memoryAdapter，localStorage 版未实现）。
4. **本步新增**：NodeStore 补 `removeNode(id)`；demo 里接 VueFlow `onConnect` 让"能连一条边"先通；`<VueFlow>` 补一个最简 `isValidConnection`（先只禁 self-loop）。
5. **本步新增**：最简 image 节点插件（content=`<img>`，data.imageUrl，见 B1）。
6. 验收：无头冒烟测试断言"页面渲染出 text+image 节点 + 能连一条边" + 原有 demo.test.ts 全绿 + 浏览器肉眼看（演示层）。

**M2（NodeRenderer + 最小 BaseNode 壳 + node:{type}:* slot）**
- 只搬"够 text+最简 image 渲染"的最小壳（B4），不自吞 1714 行 Decoration。
- text 改走 NodeRenderer + slot（runbook 原 M2 已写）。
- **补充**：若涉及 .vue 组件渲染断言，先配 vitest environment 为 happy-dom 或把 NodeRenderer 的"type→content 组件"解析抽纯函数测试（C2）。

**M3（右键/命令/删除收敛）** —— 保持，删除收敛成 command:delete（用户多选删除要用）。

**M4（Save 完整 + 行为契约）** —— 保持（localStorage/四类 type 已在 M1 用上最小版，M4 把它做完整）。

**M5（连接内核 + 严格校验吸收）** —— 保持，作为"加固"而非"首次碰连接"；用 test-only 可连节点验证声明式约束（B5），不拿 image/panorama 当验收对象；写 v1 `normalizeConnection`/环检测/吸附的行为契约测试锁死。

**M6（image 全功能/Video/panorama/image-compare/云）** —— 保持另开，但顶部加一句"image 最简版已在 M1 落地，M6 只做 image 的复杂件 + 其余节点 + 云"。

### 每步"最小可跑"产出句式（照此写进每 M 的交付）
> 每 M 结束时应有一个能 `pnpm dev` + 无头测试同时通过的产物，且北极星 4 条（vite 可视 / text+image 编辑恢复 / 不碰 src/ / tsc+测试绿）任一不满足就继续该 M，不提前宣布完成（runbook 铁律第 5 条已有此义，保持并扩到 image）。

---

## 附：审核中确认的关键代码事实（供照做时引用，全部经 codegraph/read 核实）

| 事实 | 证据 |
|---|---|
| v2 目前纯 TS 无浏览器渲染、无 demo-web/CanvasDemo/vite.config | 我 ls `packages/canvas-core-v2/` 只有 node_modules/package.json/src/tsconfig/vitest.config |
| vue/vue-flow/vite/@vitejs/plugin-vue 在 root node_modules 已存在 | `node_modules/{vue,@vue-flow,vite,@vitejs}` 均在 |
| v2 package.json deps 空、peer 有 vue/vue-flow/pinia | 已 cat |
| v2 只有 text 插件、NodeStore 无 removeNode | 已读 nodeText.ts / nodeStore.ts |
| v2 vitest environment='node'（测不了 .vue） | 已读 vitest.config.ts |
| Decoration 1714 行（BaseNode 783） | wc -l 核实 |
| useCanvasConnection 1300 行、ConnectionValidator 有环/去重/吸附/canonical | wc -l + grep 核实（wouldCreateCycle:197 / isSameCanonicalConnection:221 / findNearestValidTarget:302） |
| image 目录 3825+ 行、ImageBottomToolbar 910、ImageMasker 398、ImageCropper 363 | wc -l 核实 |
| v1 默认画布 createDefaultCanvasData 只建 3 个 image，text 无默认实例 | audit-simple-nodes §1.1/★2.13 |

---

说人话：runbook 骨架没问题，但对错了焦——它只写了 text，把用户要的 image 推给了 M6，连接判断又拖到 M5 才第一次碰。最小闭环（text+image 两节点+能拖能连能删+起 vite 看到+刷新不丢）需要把 image 最简版提前进 M1、把最简连接判断也提前进 M1、把 M1~M5 的验收从"肉眼看"补成无头断言，M2 的 BaseNode 别一次吞 1714 行只搬够跑的最小壳。修订都落到具体文件/行了，照 D 节顺序就能跑出用户要的东西。
