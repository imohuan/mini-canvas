# canvas-core-v2 自运行目标剧本（Goal-Driven Runbook）· 修订版

日期：2026-09-04 · 分支：feat/cordis-plugin-system · 类型：**持续运行直到成功的目标导向执行计划**
依据：五路审计 + `canvas-core-v2-api.md`(API 契约) + `canvas-core-v2-architecture.md`(五层) + `canvas-core-v2-depmap.md`(owner) + ADR-0001 + 网络重构方法论(`ai-refactor-coordination.md` 记忆) + **runbook 审核报告(`docs/tmp/canvas-core-v2-survey/runbook-review.md`，本文按它修订)**。

---

## 〇、北极星目标（一句话）
**把旧版画布(180 文件)收敛成自研 Cordis 风格内核，在 canvas-core-v2 里直接起 vite，让用户看到一张"有 text + image 两个节点、能拖、能连一条边并判断、能删、编辑刷新不丢"的可操作画布。全程不碰 src/ 老版。**

### 本 runbook 的范围 = 开发测试期基础功能最小闭环
**必须落地：**
1. **2 个基础节点**：text + **最简 image**（只显示一张图，content=`<img>`+`data.imageUrl`；**无**裁剪/蒙版/扩展/backend 生成模型/AssetStore 资产落盘）。
2. **画布基础操作**：拖拽移动节点、**连一条边并做"能否连接"判断**、删除节点、基础多选(至少框选 2 个)。
3. **起 vite 看得到 + 编辑 + 刷新恢复**(localStorage)。

**明确"另开任务"(M6，M1~M5 一律不许带上)：**
- image 复杂件(ImageBottomToolbar/裁剪/扩展/蒙版/backend 模型)
- Video / panorama / image-compare 节点
- 25+ 交互插件(history 完整/group/multi-select 完整/align-*/edge-cutting/mini-map/export/node-find…)
- MCP / 云 authority 收敛、多 view
- v1 `components/Decoration` 的**全量**移植(MovingHandle 吸附 468 行、ResizeHandle 高级 resize 等——M2 只搬"够跑的最小壳")

### 验收标准(Done when，能自查)
1. `pnpm dev` 起 vite，浏览器(或无头)能看到 text + image 节点画布。
2. 能拖节点、能连一条边并被 isValidConnection 判断、能删除。
3. 编辑文本 → 刷新 → 文本还在(localStorage)。
4. 全程在 `packages/canvas-core-v2/` 内，**不修改 src/(老版宿主)**。
5. 每里程碑 tsc 干净 + vitest 全绿 + 无头冒烟断言过。

---

## 一、铁律(每个 step 遵守)
1. **测试是唯一裁判**：每步亲眼看 vitest runner 输出全绿才前进；"以为过了"=没跑。浏览器可视只是演示层，**能跑/能恢复必须由无头测试兜底**，不靠肉眼。
2. **契约不自己发明**：涉及内核 ctx/registry/slot/save 的公开接口，只按 `canvas-core-v2-api.md` + ADR 实现/消费；要改契约 = 先改文档再动代码。
3. **文件 owner**：一个 step 只碰自己列的文件；不是唯一 agent，忽略无关编辑。**没列进 M1~M5 的东西 = 本 runbook 不做**，不许顺手带 M6 复杂件。
4. **Do not change the tests**(除非明确写"先改测试再实现")。
5. **卡住就停下**：不脑补、不无限重试；改法 >2 次失败 → 用新信息重写该 step 的 spec 或上报。
6. **每步绿了就 commit**(原子)，suite 全绿才进下一步；红了让路。
7. **安全网**：动高危模块(内核/save/连接)前先确认测试网在且绿；没有就先补。
8. 架构决策/接口契约/依赖排序/集成验证/评审关卡**永远留在主 agent**，不交给并行子代理。

---

## 二、里程碑链（M0 ✅ → M6；每步 = 可独立验证原子 commit）

### M0 ✅(已完成，勿重做)
M1 内核 + M4 tracer bullet 全链。测试 31 全绿。锚点 commit：9baf637 / 0683e7b / 7ed0606。

### M1 —— 起 vite + 最小闭环骨架（本 runbook 第一刀）★核心
**目标**：先跑起来看到 text + image 两节点、能拖能连能删。
- 交付：
  1. `package.json` 把 vue/@vue-flow/core/pinia/vite/@vitejs/plugin-vue 从 peer 转实际依赖(root node_modules 已有这些，装包成本低)。
  2. `vite.config.ts` + `demo-web/index.html` + `demo-web/main.ts` + `demo-web/CanvasDemo.vue`：用 `<VueFlow>` 渲染 nodeStore 的 text + image 节点。
  3. `services/storage/localStorageAdapter.ts`(实现 StorageAdapter，`localStorage.setItem('type:key')`)+ host 浏览器版(adapter 传 localStorage 单例)。
  4. **最简 image 插件** `plugins/nodeImage.ts`：注册 `type:'image'`，content=`<img>`，`data.imageUrl`(拖本地文件→objectURL 或填 URL)；**禁止**搬 Masker/Cropper/backend/_overlay。
  5. **NodeStore 补 `removeNode(id)`**；demo 接 VueFlow `onConnect`(能连一条边) + 一个极简 `isValidConnection`(先只禁 self-loop)；删节点(onNodeClick 删/Delete 键)。
  6. **无头冒烟测试**：断言页面渲染出 text + image、能连一条边。
- 验收：
  - vitest 全绿(含 localStorage 用 mock 的逻辑测试 + 无头冒烟)。
  - tsc 干净。
  - `pnpm dev` 起服务；浏览器/无头看到 text + image，能拖能连能删，刷新文本还在。
- 失败纠偏：vite 起不来看报错(缺插件装 plugin-vue / 端口占用换端口)；VueFlow 渲染空 → 确认传了 `:node-types`(业务 type→组件)别漏；localStorage 恢复失败 → 查 SaveService key 前缀与 get 一致；连边被拒 → 补 `sourcePosition/targetPosition`(记忆 vueflow-node-handle-position)。
- 契约锚点：api.md §四(业务 type、image 降级 content 思路见 audit-image-video §3.6)。

### M2 —— NodeRenderer + 最小 BaseNode 壳 + node:{type}:* slot
**目标**：节点注册→渲染做成内核能力，但**只搬够 text+最简 image 渲染的最小壳**。
- 交付：
  - `core/registry/` 节点注册(注册即响应式)。
  - `core/NodeRenderer.ts` + 最小 `components/BaseNode.vue`：只做"壳 = 标题 + content + 可拖拽"，实现 `node:{type}:content/title/top-toolbar/bottom-toolbar` slot 的最小路由；top/bottom 缺省空。
  - **明确不做**：MovingHandle 吸附、ResizeHandle 高级 resize、overlay/_toolbarGroup 六插槽(等 M6 image 真进来需要再逐段移植+契约测试)。
  - text/image 改走 NodeRenderer + slot。
- 验收：
  - "type→content 组件"解析抽纯函数/或用组件测试(happy-dom)断言注册 text → NodeRenderer 查到其 content。
  - **若涉及 .vue 渲染断言**：先配 vitest environment 为 happy-dom/jsdom，否则把解析逻辑抽纯函数测试(C2)。
  - tsc + vitest 绿。
- 契约锚点：api.md §四(selfRender 废弃、slot 集)。

### M3 —— 右键菜单/命令/删除收敛
**目标**：删除收敛成统一 `command:delete`(多选删除要用)；一份节点创建。
- 交付：内核 `command:delete`(删选中+记历史最小版)、`createNodeAt(type,pos)` 工厂、菜单/命令注册最小集(能在画布上从菜单建 text/image)。
- 验收：多选删除经统一命令；v1 死代码(MenuRegistry.resolveMenuItems 等)不引入；tsc + vitest 绿。

### M4 —— Save 层完整 + 行为契约
**目标**：四类 type(config/canvas/resource/shortcut) 全走 ctx.save；落盘改即入队 + 可靠 flush。
- 交付：完整 SaveService(四类 adapter 分桶，localStorage/内存可切) + flush 时机(hidden/pagehide) + key 规范 + 契约测试网。
- 验收：四类数据互不干扰、可分别切 adapter；契约测试覆盖 save 边界(用 mock localStorage)；tsc + vitest 绿。

### M5 —— 连接内核(吸收 v1 严格校验，不许改坏)★加固里程碑
**目标**：把 v1 `useCanvasConnection`(1300 行)的拖线校验/环检测/去重/吸附 + `ConnectionValidator` 的 canonical 逻辑**原样吸收**成 v2 连接服务。**这是加固，不是首次碰连接(M1 已连过)**。
- 交付：连接内核服务 + 声明式 `inputs/accepts/limit`(api.md 定稿) + **行为契约测试**锁 v1 严格规则。
- 验收：连接测试全绿；用 **test-only 可连节点**(如 type:'t', inputs accept 'text')验证声明式约束——**不拿未迁入的 image/panorama 当验收对象**；`normalizeConnection` 环检测/去重/吸附有契约测试锁死。
- 契约锚点：ADR-0001 行动项 3(连接校验保留，不许改坏)。

### M6 —— image 复杂件/Video/panorama/image-compare/云/多 view（**另开任务**）
- 交付：image 裁剪/扩展/蒙版/backend(ImageBottomToolbar 那套)、其余节点、交互插件、MCP/云 authority 收敛、Decoration 全量。
- 触发：M5 达成后单独拆 ticket。**顶部已声明 image 最简版在 M1 落地，M6 只做 image 复杂件 + 其余**。

---

## 三、执行策略(如何"持续运行直到成功")
1. **串行逐 M**：每 M 先写/补测试(锁行为)→ 实现 → 跑全量 → commit。红 = 停下读报错；契约不清 → 回锚点文档补齐；实现 bug → 修。
2. **每 M 需要时派子代理**(探索/独立包可并行)，但**必须读同一契约文档 + 自己的文件 owner + Do not change the tests**。主 agent 保留集成验证。
3. **子代理 prompt 模板**：
   ```
   Goal: <一句话结果>
   Where: <文件/符号，禁探索阶段>   ← 已用 codegraph/依赖图预查
   Constraints: 不得改 <公开API/schema>; 不得碰 <src/ 老版>; 不得碰 <他人 owner>; 不得带 M6 复杂件
   Done when: <exit 0 命令>
   Out of scope: <它想顺手修的相邻东西>
   Do not change the tests.
   ```
4. **风险闸**：改连接/save/scope 高危前先确认测试网绿；没有先补。
5. **成功 = 北极星 5 条全满足**，任一不满足继续对应 M，不提前宣布完成。

---

## 四、文件 owner 与"不碰"清单
| owner/step | 允许碰 | 严禁碰 |
|---|---|---|
| M1 宿主 | canvas-core-v2/demo-web + vite.config + package.json + localStorageAdapter + nodeImage | **src/、canvas-core(老版)、用户私有 html** |
| M1 最简 image | plugins/nodeImage.ts | **canvas-core/src/nodes/image 复杂件**(backend/_overlay/ImageBottomToolbar)只读借鉴 content 渲染 |
| M2 registry/NodeRenderer | canvas-core-v2/src/core/registry + components | **老版 components/Decoration 只读借鉴**，不整吞 1714 行 |
| M3 命令/菜单 | core/registry 命令菜单部分 + plugins | v1 ContextMenuPlugin 只读借鉴 |
| M4 save | services/storage/* | 老版 StoragePlugin 逻辑只读借鉴 |
| M5 连接 | core/connection + validator | v1 useCanvasConnection 原样吸收可复制，**不许改坏其规则** |
| 全局 | — | **src/(老版宿主)、architecture.html、mini-cordis-guide.html(用户私有)、canvas-core/src/nodes/{image,Video,panorama,image-compare} 复杂件 = M6** |

## 五、即时验证命令(win32 bash)
```bash
cd packages/canvas-core-v2
node ./node_modules/vitest/vitest.mjs run           # 测试(唯一裁判)
node ../../node_modules/typescript/bin/tsc --noEmit  # 类型检查
pnpm dev                                              # 起 vite
```

## 六、风险与注意
- v2 目前纯 TS 无浏览器渲染、无 demo-web/CanvasDemo/vite.config、localStorageAdapter 未做、NodeStore 无 removeNode——M1 是真实待做，不是已完成。
- 起 vite 需 @vitejs/plugin-vue；端口冲突换端口。
- v2 vitest 是 node 环境，测不了 .vue；M2 涉及 .vue 渲染要先配 happy-dom 或抽纯函数。
- 可视化是演示层；"能跑/能恢复"靠无头测试兜底。
- **红线 = 不碰 src/、不发明契约、不把 M6 复杂件带进 M1~M5、测试绿了才前进、卡住上报不脑补。**

---
说人话：按审核意见把 runbook 改对了焦——北极星从"只看 text"改成"text+最简 image 两节点、能拖能连能删、起 vite 看到、刷新不丢"。最简 image 和最简连接判断提前进 M1,M2 的 BaseNode 只搬够跑的最小壳不吞 1714 行,M5 变"加固"不拿没迁的 image 验收。还加了红线:M1~M5 不许顺手带 image 复杂件。审核发现的四个真漏洞(scope 不清/image 缺失/连接太晚/BaseNode 过载)全补上了。
