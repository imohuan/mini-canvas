# 调查：canvas-core-v2 为何有这么多 inject —— 双注入系统解剖

日期：2026-09-05 · 分支：feat/cordis-plugin-system · 范围：`packages/canvas-core-v2/src`
调查人：code-developer · 目的：回答"为什么这么多 inject / 是否有更好设计"

---

## 〇、结论先行

1. 你看到的"一堆 inject"是**两套同名不同物的系统**：内核服务注入 + Vue provide/inject，不是一回事。
2. **代码正处在一场进行中的重构中间态**：渲染宿主层(CanvasHost/令牌)已被抽到新包 `@mini-canvas/canvas-render`
   （git d3cf251 已执行 git mv）。你此刻看的 `canvas-core-v2/src` 是"抽完一部分、计划文档还标待批准"的过渡态。
3. "为什么不能全塞进 context"——**文档原意就是往这个方向走**，分两套不是因为设计更优，而是**分层代价**：
   内核坚持"无 Vue、Node 可单测"，但渲染要传的东西(.vue 组件/reactive)离不开 Vue，二者必须分离，中间有翻译层是躲不掉的。
4. 优化空间真实存在：`nodeWrite` 函数、纯配置类令牌(EDGE_VISUAL/CANVAS_PARAMS)理论上可并入内核 context 收敛，
   不必走 provide；`HOST_KEY`(boot 异步)才真需 provide。**但方向不是"塞回 context"，而是"渲染层已独立成 canvas-render 包"**
   ——这一步已经在做，正在把内核洗成纯逻辑。

---

## 一、两套系统的正面解剖（到底谁 inject 谁）

### 系统 A：内核服务注入 `ctx.inject / ctx.get`（纯 TS，无 Vue）

- 位置：`src/host/createMiniCanvasHost.ts:90-117`（注：该文件属渲染宿主层，正随迁 canvas-render）
- 动作：`ctx.inject('save', save)` × 8，往内核 `Context.services` Map 塞 8 个服务实例
  `save / nodeStore / nodeRegistry / themeRegistry / selection / history / command / nodeFactory`
- 谁能取：**插件**（`{name, setup(ctx)}`），在 setup 里 `ctx.get('nodeStore')` 按字符串取
- 机制：`src/core/Context.ts:179 inject` / `:190 get`；取不到抛错("not injected")，**不静默降级**
- 特性：`Context.ts` 内置热装/热卸 `installPlugin/uninstallPlugin/reloadPlugin`，服务登记进插件 Scope，
  插件卸载时 `scope.dispose()` 一次清光副作用（`core/Scope.ts`），插件零 uninstall 代码
- 动机：插件互调不靠 `getPluginAPI` 隐式耦合，改成 `ctx.get`（架构文档 L59 "等价 Cordis service"）
- **它不碰 Vue**：整条链路纯 TS，Node 可跑 → core/services 可单测

### 系统 B：Vue provide / inject（Symbol 令牌，组件树跨层传）

- 提供方：`src/host/CanvasHost.vue:94-132`，`provide(KEY, val)` × 6：
  1. `NODE_REGISTRY_KEY` → 一个 `new NodeRegistry()`（节点"长啥样"查表，content 组件注册进来）
  2. `HOST_KEY` → `hostRef`(shallowRef)，**先空盒子后填**宿主句柄（boot 异步）
  3. `NODE_WRITE_KEY` → `nodeWrite(id,patch)` 函数（就地改名→改 nodeStore+存盘）
  4. `EDGE_VISUAL_KEY` → reactive 边外观对象（颜色/箭头/发光…）
  5. `CANVAS_PARAMS_KEY` → reactive 端口外观对象（5 个尺寸数）
  6. `EDGE_SELECTION_KEY` → `{ selectedNodeIds, selectedEdgeIds }` 两个 ref（当前选中谁）
- 谁能取：**通用壳组件**（Vue 组件树底层），经 `inject(KEY)`：
  - `BaseNode.vue`（plugin-theme-default）用 NODE_REGISTRY / NODE_WRITE / CANVAS_PARAMS
  - `CustomEdge.vue` 用 EDGE_VISUAL / EDGE_SELECTION
  - `TextContent.vue`（plugin-node-text）用 HOST_KEY
- 机制：令牌定义在 `src/contracts/*.ts`，是 `Symbol`，**同符号两端才命中**
- 特性：消费方基本都带默认值兜底（`inject(KEY, DEFAULT)`），宿主不 provide 则安全降级
- 动机：底层组件保持"通用、无 store 耦合"，不直接 import 具体 store/context

### 两者的桥

`CanvasHost.vue` `provide(HOST_KEY, hostRef)`，底层组件 `inject(HOST_KEY)` 拿 host →
`host.ctx.get('save')` 够到内核服务。**HOST_KEY 是 Vue 世界 ↔ 内核世界的唯一入口。**

### 对照表

| 维度 | 系统 A 内核 inject | 系统 B Vue provide/inject |
|---|---|---|
| 物理位置 | 纯 TS（无界面） | Vue 组件树 |
| 提供者 | createMiniCanvasHost（宿主门面） | CanvasHost.vue |
| 内容 | 8 个服务实例（带方法的类） | 6 个令牌值（组件/reactive/函数/ref） |
| 消费者 | 插件 setup | 底层通用壳组件 |
| 取值方式 | 字符串 'save' | Symbol KEY |
| 缺省行为 | 取不到抛错 | 有默认值兜底降级 |
| 能否进纯 Node 单测 | 能 | 不能（带 .vue/reactive） |
| 你要取的服务 | 有，全在这 | 没有（是渲染家当） |

---

## 二、"为什么不全塞进 context" —— 文档的原意与现实的偏离

### 项目自己的架构文档怎么说

`docs/plan/canvas-core-v2-architecture.md`：
- L37-38 / L44：Core 内核 = Context/ctx.plugin/ctx.inject/ctx.on/作用域回收，**"可脱离 Vue/pinia 独立单测"**
- L131：**"Core 无 Vue/pinia 依赖 | 可独立单测，是最想保住的价值"** ← 硬约束
- L64-65：响应式 state（选中/拖线/viewport）"统一由 pinia/State 层管"，分运行时不落盘 vs 落盘两类
- L98：要"显式化为命名 slot + provider，注册即响应式"

**即：作者原意是内核只管纯逻辑 + 另起一个统一 State/provider 层管渲染状态。**
CanvasHost 现在的实现没有照 L64-65 走独立 State 层，而是**用 Vue 自带 provide/inject + reactive 兜底**临时顶替
那个"State 层"的角色 → 于是碎成 6 个 Symbol 令牌，观感混乱。**你的直觉方向与文档一致。**

### 为什么不能真塞回内核 context（硬骨头）

6 个令牌里能塞回纯逻辑 context 的有限：
| 令牌 | 能否并入内核 context | 理由 |
|---|---|---|
| NODE_WRITE(③函数) | ✅ 应该 | 本质=改 nodeStore+存盘，内核已有，纯壳 |
| EDGE_VISUAL/CANVAS_PARAMS(④⑤配置) | ✅ 可以 | 若纯配置，内核读一遍给 Vue 即可 |
| NODE_REGISTRY(①) | ⚠️ 半 | 内含 .vue 组件不能进内核；可派生只读快照 |
| EDGE_SELECTION(⑥) | ⚠️ 半 | 数据源在内核 selection，Vue 只是响应式镜像 |
| HOST_KEY(②) | ❌ 必须 provide | boot 异步，组件树传响应式盒子最顺 |

**塞不进的那部分，恰恰是".vue 组件 / reactive ref"这类"要画的活物"**——它们必须活在 Vue 响应式世界，
塞进纯 TS 内核 context 就会让内核 import vue → Node 单测全废 → 丢掉 v2 最想保的价值(L131)。

**结论：分两套不是最优解，但"翻译层必须存在"是真的。** 问题不是"要不要这层"，而是"这层现在碎成 6 令牌、能并成一个干净上下文对象吗"——能。

---

## 三、⭐ 关键发现：这段代码正在被整体迁移（影响你对问题的判断）

查 git 与未跟踪文档后确认，**你以为在看的"现在架构"，其实一半已经/正在抽走**：

- 分支 `feat/cordis-plugin-system`，有未跟踪迁移文档：
  - `docs/plan/canvas-render-layer-plan.md`（渲染宿主层迁出内核，标"待用户批准"）
  - `docs/tmp/render-layer-migration/`（依赖图/工程约定实证）
- git 已执行：`d3cf251 refactor(canvas-render): extract render-host layer out of canvas-core-v2 into @mini-canvas/canvas-render`
- **新包 `packages/canvas-render` 已经存在**，里面复制了完整的一份：
  `src/host/CanvasHost.vue` + `canvasHostCore.ts` + `createMiniCanvasHost.ts` + `vueFlowBridge.ts` + `contracts/`(5 令牌) + host 测试
- 而 `canvas-core-v2/src/host`、`contracts/` 里**仍残留同一份文件** → 现在两处是**双份**，处于迁移中间态

### 这改变什么

1. 你盯着 `canvas-core-v2/src` 问"为什么这么多 inject"，但**这段渲染层代码的目的地是 canvas-render 包**。
2. 迁移后内核只剩 `core/`(纯 Context/registry) + `services/`(纯逻辑服务)，顶层不再 re-export 任何 `.vue`/渲染令牌。
3. 计划文档(§四#2)明确：**默认皮组件(BaseNode/CustomEdge…)不挪进渲染包**，保持插件可替换。
4. 也就是说：**"合并 inject / 收敛令牌"这一重构，方向已被更彻底的一步(渲染层独立成包)取代**——内核已朝"纯逻辑单 context"收，渲染家当整体搬到 canvas-render。

---

## 四、结论 & 建议（回答"没有更好的设计吗"）

1. **你感受到的混乱是真的**：双份渲染层(内核残留 + canvas-render) + 6 个 Symbol 令牌 + 8 个字符串服务，叠加在进行中的迁移，必然乱。
2. **比"塞回 context"更好的设计，正是迁移计划在做的那步**：把渲染宿主层整体从内核剥离成 `@mini-canvas/canvas-render` 包，
   内核洗成纯逻辑。这比把 .vue 塞进内核 context 干净得多，且保住"内核无 Vue 可单测"。
3. **若还想进一步收敛渲染包内部**，可把 6 令牌并成单个 `provide(HOST, ctxObject)`，组件要啥 `host.value.x`，
   减少记忆负担 —— 这是渲染包内部的可选优化，不影响内核纯度。
4. **下一步建议**（供你拍板）：
   - 先确认 canvas-render 迁移是否完成/要不要完成（现有未跟踪计划文档）
   - 若完成，`canvas-core-v2/src/host|contracts(除 edgeGeometry)` 应删残留，避免双份维护
   - 在 canvas-render 内评估"6 令牌并 1 上下文"重构（非必须）

---

## 参考证据（代码/文档位置）

- 8 个服务注入：`src/host/createMiniCanvasHost.ts:90-117`
- Context inject/get：`src/core/Context.ts:179,190,200`；热装卸 `Context.ts:118+`
- Scope 作用域回收：`src/core/Scope.ts`（v2 分水岭）
- 6 个 provide：`src/host/CanvasHost.vue:94-132`
- 令牌定义：`src/contracts/{contentBridge,nodeRegistryKey,edgeContext,canvasParamKey}.ts`
- 令牌消费：`plugin-theme-default/src/{BaseNode,CustomEdge}.vue`、`plugin-node-text/src/TextContent.vue`
- 架构原意：`docs/plan/canvas-core-v2-architecture.md` L37-38,44,58-59,64-65,98,116,131,134
- CanvasHost 收编：`docs/plan/canvas-host-component-plan.md`
- **迁移进行中**：`docs/plan/canvas-render-layer-plan.md`、git `d3cf251`、新包 `packages/canvas-render/`
