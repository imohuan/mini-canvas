# 插件系统重构计划 —— 插件抽成独立 packages 库（dsh 范式 + UI/逻辑一体）

日期：2026-09-04 · 分支：feat/cordis-plugin-system · 状态：**待用户审核**
作者：code-developer · 类型：架构重构（在已达成 M1~M5 的 v2 之上，重排插件承载形态）

依据：本次用户两条指令 + 五路审计/契约文档 + dsh 调研（`docs/tmp/dsh-plugin-research/dsh-research.md`）+ v1→v2 gap 审计（`docs/tmp/v2-plugin-refactor/*`）。

---

## 〇、北极星目标（一句话）

把 canvas-core-v2 里"散落在 demo-web 的 content UI 组件"与"src/plugins 的插件逻辑"合并成**每个节点/能力一个自包含的独立 pnpm 包**，放在新建的 `packages/plugins/` 目录下；插件按 **dsh 范式**书写（自描述、只露 `name/inject/Config/apply` 四口、宿主按清单加载、UI 靠注册进内核插槽、宿主零硬编码）。先以 **text + image 两个节点**做成端到端样板，跑绿全部现有测试 + 起 vite 目验，证明范式可行后再铺开 M6 其余节点。

---

## 一、为什么当前"插件逻辑有问题"（问题诊断）

现状的三处割裂（都违背用户"UI 和插件一体 + 独立成库"）：
1. **UI 与逻辑分家**：text/image 的逻辑在 `packages/canvas-core-v2/src/plugins/nodeText.ts / nodeImage.ts`，它们的 content 组件却躺在 `packages/canvas-core-v2/demo-web/components/TextContent.vue / ImageContent.vue`。谁删谁留、谁维护都不清晰。
2. **UI 组件由宿主手搓接线**：`CanvasDemo.vue:50-53` 由宿主 `registry.register('text', { content: TextContent })` 手动 seed 进 NodeRegistry，插件自己完全不声明白己的 UI。宿主对每个具体插件硬编码。
3. **插件不是独立包**：nodeText/nodeImage 只是内核包里的普通文件，不是可独立构建/复用/发布的 workspace 包；其它包无法复用，M6 新增节点只能继续往这个包里堆。

**根因**：v2 把"插件(逻辑)"和"节点展示(UI 注册表)"拆成了两套东西，且 UI 注册权在宿主手里——这与 dsh"每个能力是一个自描述包、宿主只按清单加载"的范式相反。

---

## 二、目标架构（dsh 范式映射到 Vue3 + VueFlow monorepo）

依赖方向（不可成环）：**插件包 → 内核(canvas-core-v2)；宿主/demo → 内核 + 插件清单。内核不反向依赖任何插件，宿主零硬编码具体插件。**

### 目录拓扑

```
packages/
  canvas-core-v2/                # 内核库（已是 workspace 包，补全"库"公共出口）
    src/ core/ services/ components/（BaseNode 壳/CustomEdge…）
  plugins/                       # ★新建：所有插件独立包都放这
    plugin-node-text/            # text 节点插件（逻辑 + TextContent.vue 一体）
    plugin-node-image/           # image 节点插件
    # …后续 M6：plugin-node-video / panorama / image-compare / 能力插件 都加在这
```

- `pnpm-workspace.yaml`：`packages/*` 之外**追加 `packages/plugins/*`**（pnpm 支持多 glob），让嵌套的插件目录成为独立 workspace 成员。

### 每个插件包内部（dsh 四导出契约 → Vue 映射）

```
packages/plugins/plugin-node-text/
  package.json        # name:@mini-canvas/plugin-node-text; deps: @mini-canvas/canvas-core-v2(vue 作 peer/依赖)
  src/
    index.ts          # 聚合导出
    TextNodePlugin.ts # dsh 契约：export name/inject/Config/apply(ctx)——逻辑 + 注册 UI 一体
    components/TextContent.vue   # UI 内容组件，随包走，不再放 demo
```

关键：**插件在 apply(ctx) 里用内核的节点注册 API 一次性登记 schema + content 组件**，宿主不再手 seed、也不再 import 具体插件的组件。UI 组件作为 `markRaw`/opaque 句柄经注册表交出去，内核渲染壳（BaseNode）只负责槽位，不反向依赖插件。

### 需要补的一个内核接缝（最小、不破坏 M1~M5）

现状注册是"两半 + 宿主 seed"：
- `nodeStore.registerType(type, {label,size})` 登记数据侧
- `NodeRegistry.register(type, {content: 组件})` 登记展示侧（CanvasDemo 手 seed）

为让"插件一次自描述"，把两半收拢成**一个内核公共注册 API**（对齐 api.md §四 的 `ctx.node.register(...)` 方向）：插件 `apply(ctx)` 里调一次 `ctx.registerNodeType({ type, label, defaultSize, content, … })`，由内核同时写数据注册表 + 展示注册表，并**消费方(宿主)免硬编码**。此接缝以"新增公共 API + 迁移宿主接线"实现，尽量不动已绿的 registry/测试行为。

> 注：api.md §四 的最终形态是 `ctx.node.register`（nodeService 上一等公民）。本次先落一个过渡但稳定的 `registerNodeType`，保持内核正交；是否一步到位演进成 `ctx.node.register` 可作为决策点 ③。

### UI 内容组件如何拿内核能力（内容组件 ↔ 插件逻辑解耦）

沿用现有 dsh/Cordis 精神：内容组件**不自造**，经 provide/inject 令牌拿宿主句柄再 `ctx.get('text'|'image')` 服务（现状 HOST_KEY 路线），或后续演进成 api.md 的"注入 ctx"路线。本次先不动这层（决策点 ④）。

---

## 三、实施步骤（每步 = 可独立验证的原子 commit）

> 纪律：跑 `cd packages/canvas-core-v2 && node ./node_modules/vitest/vitest.mjs run` + tsc + 起 vite 目验；**不碰 src/(老版宿主)**；不把 M6 复杂件带进来；Do not change the tests。

### Step 1 —— workspace 收编插件目录 + 建空插件骨架
- `pnpm-workspace.yaml` 加 `packages/plugins/*`。
- 建 `packages/plugins/plugin-node-text/` 与 `plugin-node-image/` 空骨架（package.json / src/index.ts 空占位），验证 `pnpm install` 认到新包、不报错。
- 验收：pnpm 能列出 3 个新成员；原 83 测试仍绿；tsc 干净。

### Step 2 —— 内核补节点注册公共接缝 `ctx.registerNodeType`
- 在 canvas-core-v2 内核加 `registerNodeType(def)`：内部写 `nodeStore.registerType` + `NodeRegistry.register`（组件句柄经 opaque 注入）。
- 提供类型：`NodeTypeDef { type,label,defaultSize?, content?, title?, resizable?, … }`。
- 验收：新增最小单测锁"一次调用同时落数据表与展示表"；原 83 测试绿。

### Step 3 —— 迁 text：plugin-node-text = 逻辑(nodeText) + TextContent.vue 一体
- 把 `src/plugins/nodeText.ts` 逻辑迁成插件包 `TextNodePlugin`，`apply(ctx)` 内调 `ctx.registerNodeType({type:'text', content:TextContent,…})` + 保留既有 `nodeFactory.register('text',…)` + `ctx.inject('text', service)`。
- `TextContent.vue` 从 demo-web/components 移入插件包 components/。
- 验收：包可被内核宿主加载；text 仍能建/编辑/落盘；测试绿。

### Step 4 —— 迁 image：plugin-node-image 同样搬完
- 同 Step 3 处理 image（含最简 image 红线：不搬 M6 裁剪/蒙版/backend）。

### Step 5 —— 宿主(demo-web)改为按清单加载插件、删除手 seed
- `CanvasDemo.vue` 删掉 `registry.register('text'|'image', {content})` 手接线，改为把 `nodeTextPlugin/imageNodePlugin` 传进 `bootCanvas(plugins:[…])`，由内核经注册 API 自动接线；VueFlow `nodeTypes` 改由内核依据注册结果提供（或仍显式但组件取自注册表，宿主不再 import content 组件）。
- 验收：起 vite，text+image 能建/拖/连/删/编辑/刷新不丢——UI 来自插件包，宿主零硬编码。

### Step 6 —— 全量回归 + 文档/README 更新
- 全测试绿 + tsc + 起 vite 目验 + 无头冒烟。
- 更新 `docs/STATUS.md`、`docs/plan/canvas-core-v2-api.md`、ADR（记插件承载形态与目录约定），写一篇 `docs/tmp/` 外的插件开发 README（dsh 范式 → 本项目怎么新增一个节点插件）。
- 验收：文档与代码一致；给出插件新增指南。

---

## 四、决策点（需你拍板）

| # | 问题 | 我的推荐 |
|---|---|---|
| ① | 插件目录命名 | `packages/plugins/`（子包前缀 `@mini-canvas/plugin-node-text`）——即你说"新插件 packages 目录" |
| ② | 本次范围 | 只迁 **text + image** 做通样板（M6 其余照此续建），一步到位铺开反而难验收 |
| ③ | 内核接缝形态 | 落 `ctx.registerNodeType` 过渡稳定版；是否演进成 api.md §四 的 `ctx.node.register` 一等公民后续再议 |
| ④ | 内容组件取内核能力的方式 | 本次保留现有 provide/inject 宿主句柄路线，不动（避免扩散）；后续再演进 api.md 注入 ctx 路线 |
| ⑤ | canvas-core-v2 包名 | 保持 `@mini-canvas/canvas-core-v2`（本次不改名防扩散） |

---

## 五、验证命令（每次改完跑）

```bash
pnpm install                     # 收编新 workspace 成员
cd packages/canvas-core-v2
node ./node_modules/vitest/vitest.mjs run     # 83 测试全绿才前进
node ../../node_modules/typescript/bin/tsc --noEmit
pnpm dev                        # 起 vite 目验 text+image 从插件包来
```

## 六、风险与注意事项

- **依赖方向防环**：内核绝不 import 插件包；宿主 import 插件。靠 pnpm workspace + 代码 owner 守。
- **.vue 跨包消费**：内核渲染壳只经注册表拿 opaque 组件句柄，不反向编译插件 .vue；Vue 作为插件包依赖。
- **不破坏 M1~M5**：新增注册接缝是"加新公共 API + 迁宿主接线"，尽量不动已绿测试与 registry 现有行为；每步全绿才 commit。
- **红线**：不碰 `src/`(老版宿主)、不带 M6 复杂件、Do not change the tests、一个文件一个 owner。

---
*本计划已执行完成（text+image 最小样板跑通）。执行记录见 `packages/plugins/README.md`、`packages/plugins/` 下两个样板包、`docs/STATUS.md`。*
