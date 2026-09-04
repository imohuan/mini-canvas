# canvas-core-v2 自运行目标剧本（Goal-Driven Runbook）

日期：2026-09-04 · 分支：feat/cordis-plugin-system · 类型：**持续运行直到成功的目标导向执行计划**
配合：五路审计（docs/tmp/.../audit-*.md）+ `canvas-core-v2-api.md`(API 契约) + `canvas-core-v2-architecture.md`(五层) + `canvas-core-v2-depmap.md`(依赖图/owner) + ADR-0001 + 网络重构方法论(见 `ai-refactor-coordination.md` 记忆)。

---

## 〇、北极星目标（一句话）
**把旧版画布（180 文件乱摊子）收敛成自研 Cordis 风格内核，最终在 canvas-core-v2 里直接起一个 vite 服务可视化展示（不碰 src/ 老版），让 v2 画布真实可操作。**

验收标准（Done when，能自查）：
1. `canvas-core-v2` 包内 `pnpm dev` 起 vite，浏览器打开能看到一个可拖拽/可编辑的 text 节点画布。
2. 编辑文本 → 刷新页面 → 文本还在（localStorage 落盘恢复）。
3. 全程在 `packages/canvas-core-v2/` 内完成，**不修改 `src/`（老版宿主）**。
4. 每里程碑 tsc 干净 + 测试全绿。

---

## 一、铁律（每个 step 都要遵守，源自网络重构方法论）
1. **测试是唯一裁判**：每步必须亲眼看 vitest runner 输出全绿才前进；"以为过了"=没跑。
2. **契约不自己发明**：涉及内核 ctx/registry/slot/save 的公开接口，只按 `canvas-core-v2-api.md` + ADR 实现/消费；要改契约 = 改文档再动代码。
3. **文件 owner**：一个 step 内只碰自己列的文件；不是唯一 agent，忽略无关编辑。
4. **Do not change the tests**（除非明确写"先改测试再实现"）。
5. **遇到规范外/卡住**：不脑补、不无限重试。改法 >2 次失败就停下，用新信息重写该 step 的 spec 或上报。
6. **每步绿了就 commit**（原子），suite 全绿才进下一步；红了让路。
7. **安全网**：先补测试网（本 runbook 已含 golden/契约测试）再动高危模块。
8. 架构决策 / 接口契约 / 依赖排序 / 集成验证 / 评审关卡 **永远留在主 agent**，不交给并行子代理。

---

## 二、里程碑链（M0 已完成 → M6；每步 = 可独立验证的原子 commit）

### M0 ✅（已完成，勿重做）
- M1 内核 + M4 tracer bullet 全链 demo。测试 31 全绿。
- 锚点 commit：9baf637 / 0683e7b / 7ed0606。

### M1 —— 浏览器可视化宿主（在 canvas-core-v2 内起 vite）★本 runbook 第一目标
**目标**：不碰 src/，在 v2 包内装 vue + @vue-flow/core + vite，起一个最小可看页面。
- 交付：
  - `packages/canvas-core-v2/package.json` 把 vue/vue-flow/vite 从 peer 转为实际依赖（M4 用 localStorage 需浏览器）。
  - `packages/canvas-core-v2/vite.config.ts` + `demo-web/index.html` + `demo-web/main.ts`。
  - `demo-web/CanvasDemo.vue`：用 `<VueFlow>` 渲染 nodeStore 的节点，节点组件 = 最简 text（双击 textarea 编辑 → 经 ctx.save 落 localStorage）。
  - localStorage 适配器 `services/storage/localStorageAdapter.ts`（实现 StorageAdapter，set 用 `localStorage.setItem(type:key)`）。
  - host 支持浏览器版：boot 时 adapter 传 localStorage 单例。
- 验收：
  - `node ./node_modules/vitest/vitest.mjs run` 全绿（含新 localStorageAdapter 逻辑测试用 mock）。
  - `pnpm dev` 起服务无错；浏览器能看到 text 节点、能编辑、刷新文本还在。
  - tsc 干净。
- 失败纠偏：
  - vite 起不来 → 看报错（端口占用换端口 / 缺插件装 @vitejs/plugin-vue）。
  - vue-flow 渲染空 → 确认给 `<VueFlow>` 传了 nodeTypes 映射（业务 type→组件），别漏。
  - localStorage 恢复失败 → 检查 SaveService 的 key 前缀与 get 一致。
- 契约锚点：`canvas-core-v2-api.md` §四节点(业务 type)+ §三save。

### M2 —— Registry + NodeRenderer + 命名插槽（node:{type}:* 最小集）
**目标**：把"注册节点 → 渲染成 BaseNode 壳 + slot"做成内核能力，消除 v1 selfRender 两路径。
- 交付：
  - `core/registry/` 节点/工具栏/命令注册表（沿用 v1 reactive(Map) 思路，但收进内核）。
  - `core/NodeRenderer.ts`：永远渲染 `<BaseNode>` 壳，content/title/top-toolbar/bottom-toolbar 来自 `node:{type}:{segment}` slot + `toolbar:{position}` provider。
  - `components/BaseNode.vue` 等（从 v1 components/Decoration 移植精简）。
  - text 节点改为走 NodeRenderer + slot（不再硬编码单组件）。
- 验收：v2 的 registry 注册即响应式；text 节点渲染经过 NodeRenderer；tsc + vitest 绿。
- 契约锚点：`canvas-core-v2-api.md` §四（selfRender 废弃、slot 集）。

### M3 —— 右键菜单 + 工具栏 + 命令（context-menu/命令桥收敛）
**目标**：一份节点创建工厂 + 一份菜单 resolver + 统一删除命令（消除 v1 双解析器/三份 createNode/三条删除路径）。
- 交付：内核 `createNodeAt(type,pos)`、统一 resolver、`command:delete`、工具栏走 `toolbar:{position}`。
- 验收：画布上能右键建 text、有工具栏按钮执行命令、删除经统一命令；v1 死代码不引入。

### M4 —— Save 层完整 + 行为契约测试
**目标**：四类 type(config/canvas/resource/shortcut) 全走 ctx.save；落盘改即入队+可靠 flush；为高危逻辑(内核/连接校验)写 golden/契约测试。
- 交付：完整 SaveService(四类 adapter 分桶) + flush 时机(hidden/pagehide) + key 命名规范 + 测试网。
- 验收：四类数据互不干扰、可分别切 adapter；契约测试覆盖 save 边界。

### M5 —— 连接内核（吸收 v1 严格连接校验，不许改坏）
**目标**：把 v1 `useCanvasConnection` 的拖线校验/吸附/环检测 + `ConnectionValidator` 原样吸收成 v2 连接服务。
- 交付：连接内核服务 + 声明式 `inputs/accepts/limit`(API 契约定稿) + **行为契约测试**(锁 v1 的严格规则)。
- 验收：连接测试全绿，覆盖"先判断"严格规则；image/panorama 的连接约束可用 schema 表达。
- 契约锚点：ADR-0001 行动项 3（连接校验保留，不许改坏）。

### M6 —— 复杂节点 + 云/多 view（**另开任务，不在本 runbook**）
- 交付：image/Video/panorama/image-compare 迁移、BackendStorage/云同步、MCP 视图 authority 收敛。
- 触发条件：M5 达成后单独拆 ticket，不并入本 runbook。

---

## 三、执行策略（如何"持续运行直到成功"）
1. **串行逐 M**，每 M 内：
   - 先写/补测试（能锁该步行为的）→ 实现 → 跑全量 → commit。
   - 红 = 停下：读报错，若是"契约/边界不清"→ 回到对应锚点文档补齐再动；若是实现 bug → 修。
2. **每 M 需要时派子代理**：探索/实现某独立包可并行，但**必须读同一份契约文档 + 自己的文件 owner**，并命令 "Do not change the tests"。主 agent 保留集成验证。
3. **子代理 prompt 模板**（每个 worker 给足）：
   ```
   Goal: <一句话结果>
   Where: <文件/符号，禁止探索阶段>   ← 已用 codegraph/依赖图预查
   Constraints: 不得改 <公开API/schema>; 不得碰 <src/ 老版>; 不得碰 <他人 owner 文件>
   Done when: <exit 0 命令>          ← 你自己能跑验证
   Out of scope: <它想顺手修的相邻东西>
   Do not change the tests.
   ```
4. **风险闸**：改连接/save/scope 这类高危前，先确认测试网在(跑绿)；没有就先补。
5. **成功定义 = 北极星 4 条全满足**，任一不满足继续对应 M，不提前宣布完成。

---

## 四、文件 owner 与"不碰"清单
| owner/step | 允许碰 | 严禁碰 |
|---|---|---|
| M1 宿主 | packages/canvas-core-v2/demo-web + vite + package.json | src/、canvas-core(老版)、docs 已定稿 |
| M2 registry | packages/canvas-core-v2/src/core/registry + components/ | 老版 components/Decoration 只可读借鉴 |
| M3 命令/菜单 | core/registry 命令菜单部分 + plugins | v1 ContextMenuPlugin 只读借鉴 |
| M4 save | services/storage/* | 老版 StoragePlugin 逻辑只读借鉴 |
| M5 连接 | core/connection + validator | v1 useCanvasConnection 原样吸收，可复制但不许改坏其规则 |
| 全局 | — | **src/（老版宿主）、架构.html、mini-cordis-guide.html（用户私有）** |

## 五、即时验证命令速查（win32 bash）
```bash
cd packages/canvas-core-v2
node ./node_modules/vitest/vitest.mjs run          # 测试(唯一裁判)
node ../../node_modules/typescript/bin/tsc --noEmit # 类型检查
pnpm dev                                            # 起 vite(需先装 vue/vue-flow/vite)
```

---

## 六、风险与注意
- v2 目前纯 TS 无浏览器依赖；M1 要把 vue/vue-flow/vite 加进依赖并 `pnpm install`(锁文件会变)。
- 起 vite 需 @vitejs/plugin-vue；端口冲突换端口。
- 可视化仅演示用，真替换 src/ 老版宿主不在本 runbook(那是更大的迁移任务)。
- 记住：**红线 = 不碰 src/、不发明契约、测试绿了才前进、卡住上报不脑补。**

---
说人话：这是一份能照着跑到成功的目标剧本——北极星是在 v2 里直接起 vite 看到能编辑、刷新不丢的 text 画布,全程不碰老版 src/。已经完成的 M0 跳过,从 M1(起服务)一路做到 M5(严格连接校验),每步有验收命令和失败纠偏,卡住就停下用新信息重写而不是瞎撞。M6 复杂节点/云另开任务。
