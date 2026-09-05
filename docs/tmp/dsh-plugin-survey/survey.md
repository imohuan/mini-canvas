# deepseek-harness 插件/扩展系统架构调查报告

**调查对象**：`D:/Code/Git/mini-canvas/deepseek-harness`（基于 Cordis 的生产级 agent harness）
**服务目标**：`@mini-canvas/canvas-core-v2`（Cordis 风格画布引擎插件系统）架构借鉴
**性质**：只读调查，未改动 deepseek-harness / mini-canvas 任何文件。
**日期**：2026-09-05

> 证据一律落到 `docs/` 或 `packages/extensions/` 下的具体 md 文件。标"未确认"处为文档没讲清、需读源码才能定论的地方，本报告不臆测。

---

## 0. 一句话结论

dsh 的插件系统"有血有肉"，不是因为插件本身多复杂，而是因为**宿主在 `ctx` 上喂了一大堆具名服务 + 定义了成体系的"接缝（slot/事件/注册表）"让插件有地方可挂、能做出可见的、可被编排的事**。用户 mini-canvas-v2 缺的核心不是插件机制（它已经有 install/uninstall/reload、nodeRegistry/themeRegistry、inject/get），而是**宿主侧喂给插件的能力太少 + 插件能挂的"可见场景/槽位"太少 + 缺服务依赖的就绪编排（inject 等待）+ 缺每个插件实例的可诊断生命周期身份**。

---

## A. 插件系统的完整分层：Plugin / Package / 版本

**出处**：`docs/subsystems/extensions.zh.md`、`packages/extensions/README.zh.md`、`cordis-host-runner/README.zh.md`、`cordis-api/registry.zh.md`、`docs/cordis-primer.zh.md`

### 核心概念（Cordis 层，所有插件共有）
- **插件（Plugin）是"实现 Service 的对象"**：一个带 `inject` 声明 + `apply(ctx)`（函数直接当主体）的对象/函数/类。生命周期由 Cordis 挂载到当前上下文。出处：`cordis-primer.zh.md` §五个核心概念。
- **上下文（Context）是服务的容器**：一个服务占一个稳定 `ctx.<key>`，其他插件按 key 找服务，**绝不 import 具体实现**。出处同上。
- **依赖靠 `inject` 声明而非手动排队**：插件声明所需服务，等服务就绪才启动；加载顺序由依赖图决定（不是手动编排启动序列）。出处同上。→ 这是用户系统**缺的一环**（见 H）。
- **事件是类型化通信**：通过 TS 声明合并注册事件名，再按 `emit/waterfall/parallel/serial/bail` 分发。出处同上。

### 动态包（extensions 子系统，给"运行中的 agent 临时扩运行时"用）的额外分层
最完整的"插件"形态 = **一个 Plugin 持有若干不可变 Package 版本**，任一时刻可在各版本间 run / update：

| 概念 | 是什么 | 出处 |
|---|---|---|
| **Plugin** | 稳定身份（`pluginId`），可被会话引用、`@pluginId` 补全点名 | `cordis-host-runner/README.zh.md`：定义注册表"插件持有若干不可变的包"；`tool-cordis/README.zh.md` |
| **Package** | 一个**不可变**的包版本（定义之后永不改变）；包含源码、元数据、两半声明 | `cordis-host-runner/README.zh.md` §设计理念"版本是不可变的包" |
| **Run / 激活** | 某个 Package 版本被实际运行起来；`currentPackageId` / `nextPackageId` 记录"在跑"与"目标"版本 | 同上 + `extensions.zh.md` 的 `ctx.dynamicCordisRunner` |
| **runId（PluginRunId）** | 精确的一次激活身份，授权 host 调用 / client 装载 / 报错都点名它 | `extensions.zh.md` `invoke(pluginId, pluginRunId, method, ...)` |

### 为什么区分 immutable Package vs 活的 run？
文档给了两条明确理由（出处 `cordis-host-runner/README.zh.md` §设计理念 与 §run 会做什么）：
1. **失败后可修、可回滚、可版本切换**：model 写坏一版 → 追加"修正版"（新 Package）→ `mode:"update"` 切过去；老版本留着可切回。`cordis_stop` 停 run 但保留全部包版本可再跑；`cordis_undefine` 才彻底忘掉。
2. **沙箱/信任的可追溯**：定义先做语法预检（`cordis_define` 只校验参数与语法、不执行不请求审批），run 时才实际激活。immutable 保证"查到的定义 = 实际会跑的定义"、审计可回溯；活跃 run 才是"会动的那个"。`registry.ts` 的运行时不变式："definition registry 是无事件流的进程内存；run definition 与 host-half fiber/handler table 的关系在单个 awaited verb 内建立和释放。"

> 补充：动态包"定义只存进程内存、重启即清、不写仓库文件、不改配置"——这是 extensions 子系统的刻意边界（`packages/extensions/README.zh.md` 概述）。它不是仓库内插件的常态，而是"临时扩当前运行时"的工具。

---

## B. Host half vs Client half：后台逻辑 / 前端脚本 / 前端 UI 三 half 的结合

**出处**：`packages/extensions/cordis-host-runner/README.zh.md`、`cordis-client-runner/README.zh.md`、`ui-cordis/README.zh.md`、`tool-cordis/README.zh.md`、`docs/subsystems/extensions.zh.md`

这是 dsh 插件最特别、也最值得用户系统看的一处。一个动态包由**两个半（half）**组成，可以只有其一、也可以都要：

### 三种"half"的准确含义
dsh 实际是"后台逻辑 + 前端脚本 + 前端 UI"三件套，但前端脚本和前端 UI 是**分开的两层**：

| 概念 | 跑在哪 | 是什么 | 靠什么挂载 |
|---|---|---|---|
| **host 半（后台逻辑）** | Node 进程（`node:vm` 沙箱） | 纯 JS；拿到 `ctx.fs/ctx.web/ctx.bash` 与定时器 helper 等 Cordis 服务替身；注册服务、监听事件、提供 host handler | `DynamicCordisRunnerService` 在本进程激活 host 半（`lifecycle.ts` 在 `cordis-dynamic` fiber 组下启动） |
| **client 半（前端脚本）** | 浏览器页面 | 纯 JS async 函数（无 JSX/TS/import）；拿到 `React/console/styles/host` 固定符号面；返回一个"插件对象"（只能 `apply(ctx)` + 声明 `inject`） | 页面经 `loader.create` 挂载成活的浏览器插件，映射到 Cordis `ctx` |
| **client UI（前端 UI）** | 浏览器页面 | React 组件，由 client 半里的插件代码经 **slot** 贡献进宿主页面 | 经 `ctx.slots.register()`（见 D 节） |

出处：`cordis-client-runner/README.zh.md` §页面会做什么、§一次 run 如何执行；`packages/extensions/README.zh.md` 表格。

### host 与 client 怎么互相调用（远程调用 / 事件 / inspect）
1. **`@Remote` 方法 / Remote namespace**：host 侧的服务方法标 `@Remote('name')`（如 `runHostHalf`/`getClientCode`/`resolveRequestRun`/`invoke`），生成跨 realm RPC 载体，浏览器端 `ctx.remote.$on` 订阅 host 广播的转发事件。出处 `extensions.zh.md`（多处 `@Remote` 注解）。
2. **`host.call(method, args)`**：client 半调用它自己 host 半注册的方法，经 Remote namespace 路由回 host。出处 `cordis-client-runner/README.zh.md`。
3. **四条转发事件**：`cordis/request-run`、`cordis/request-run-resolved`、`cordis/dynamic-package`、`cordis/dynamic-retract` 声明在 client 安全 `./types` 子路径，浏览器经 `ctx.remote.$on` 收到它们。出处 `cordis-host-runner/README.zh.md` §理解实现。
4. **Inspect 注册表**：host 注册 Host provider；client 镜像其 provider manifest（`syncInspectManifest`）。一个查询可路由到 host 本地执行、或跨页等第一个有效 client 应答。出处 `extensions.zh.md` 的 `ctx.cordisInspect` + `ctx.inspector`。

### 一套代码怎么既跑 host 又出现在浏览器 UI
不是同一份代码跑两处——是**一个 Package 里并排装两份"半"**，host 半代码在进程跑（管逻辑/服务/数据），client 半代码被页面装载（管 React UI），两半靠 Remote/事件双向通信。run 一个带两半的包时：先 host 半、再取 client 源码、再浏览器半装载，一次结算（`orchestrator.ts`）。出处：`cordis-client-runner/README.zh.md` §一次 run 如何执行。

### 浏览器半的"纯净性"（用户系统最值得抄的设计之一）
client 半代码**不 import 模块、无 TS/JSX、不用浏览器全局**（fetch/setTimeout 都扣下），只拿到一张白名单符号面 `{React, console, styles, host}` + 白名单 `ctx`（生命周期动词 + 自己 inject 声明的服务）。这保证"一个陌生插件在页面里只做它能声明的事"，可审计、可限权。出处：`cordis-client-runner/README.zh.md` §页面会做什么、§guard 是白名单；`tool-cordis/README.zh.md` §已知限制（只支持纯 JS、无 import）。

> **对用户系统最直接的启示**：node 插件的 `.vue` content 组件正是"client UI"，它的"前端脚本"是 setup(ctx) 里的建节点/编辑逻辑。dsh 的做法提示：**把插件的"可见 UI 如何进宿主页"和"可被调的能力边界"显式定义清楚**，而不是让插件直连 VueFlow 内部。

---

## C. ctx 到底喂了插件哪些能力（ctx 能力总表）

**出处**：`docs/cordis-api/context.zh.md`、`events.zh.md`、`fiber.zh.md`、`registry.zh.md`、`service.zh.md`、`docs/cordis-api/inherited.md`、`docs/capability-seams.zh.md`（服务目录表）、`cordis-primer.zh.md`

### 框架自带（每插件都有的底层 ctx 面，来自 Cordis vendor）
出处：`inherited.md` + 各 cordis-api 页

| 能力 | API | 说明 |
|---|---|---|
| 事件 | `on/once` + `emit/parallel/serial/bail/waterfall` | **5 种分发模式**，不只 emit 一种。见下 |
| 装载子插件/声明依赖 | `plugin(mod, config)` / `inject(deps, cb)` | `inject` 简写 = `plugin({inject, apply})`；依赖服务变化会自动卸载重跑 |
| 副作用回收 | `effect(fn)` | 与 fiber 绑定，卸载/teardown 逆序自动撤销 |
| 服务存储 | `get/set/provide/accessor/mixin` | `provide` 注册归当前 fiber；`get` 读。**`accessor`=计算属性、`mixin`=把服务成员铺到 ctx** |
| 子上下文 | `extend/isolate/intercept` | `isolate(name)` 给某个服务独立作用域；`intercept` 给服务注入拦截配置 |
| 环境句柄 | `root/fiber/registry/reflect/events/logger` | `ctx.fiber`=当前运行实例（uid/state/config/dispose/restart/update） |
| 定时器 | `timer(+interval/timeout/throttle/debounce)` | 可释放定时器助手 |
| loader/hmr | `loader`、`hmr` | 配置装载器 + 热重载 watcher |

### 5 种事件分发模式（用户现在只有 emit，这是最实用的一处）
出处：`cordis-primer.zh.md` §分发模式 表格 + `events.zh.md`

| 模式 | await? | 顺序 | 返回值 | 用途 |
|---|---|---|---|---|
| `emit` | 否 | 注册序观察 | 无 | 广播通知 |
| `waterfall` | 否(同步组合) | 注册序 | 是 | 环绕中间件（`(…args,next)`），可包装/短路 |
| `parallel` | 是 | 并行 | 无 | 并发扇出 |
| `serial` | 是 | 注册序 | 是 | 依次执行直到 bail |
| `bail` | 否 | 注册序 | 是 | 首个非 null/false 即停 |

waterfall 语义：`next()` 调下游，下游返回值可被当前层包装；不调 next 直接返回=短路（作"策略监听器"用，例如 permission gate 在 `tools/pre-execute` 直接 deny）。出处 `cordis-primer.zh.md` §Cordis Waterfall 语义。

### 宿主喂给插件的高层服务（dsh 的"血和肉"就藏在这张表里）
出处：`docs/capability-seams.zh.md`（`ctx 键` 表）+ 各子系统页。每个服务角色分 `core`（宿主实现）/ `seam`（可替换能力接缝，多个 provider 注册）/ `bundle`/配套插件。摘用户系统可能有映射的：

| ctx 键 | 角色 | 一句话 |
|---|---|---|
| `ctx.commands` | core | 插件注册"直接面向人的命令"，不发给模型 —— 对应 user 的 commandRegistry |
| `ctx.settings` | seam | 插件注册命名空间 schema、解析分层值；provider 存原始文档 |
| `ctx.systemPrompt` | core | 插件注册"提示词片段/schema"组装 —— 用户系统类比 = 插件往画布注入 UI 片段？ |
| `ctx.tools` | core | 注册能力 + PTC mode + 策略门禁（pre-execute/execute/post-execute/result） |
| `ctx.slots` | (client) | 类型化 React 组合系统（见 D） |
| `ctx.sessions/agents/sessionQuery`… | — | agent 专属，用户系统不抄 |
| `ctx.web/fs/shell/sandbox/codeRuntime`… | seam | I/O/沙箱/执行能力 —— 画布不需要 |
| `ctx.attachments/fileUploads` | seam | 附件/上传 |
| `ctx.webhookRuntime` | core | 可信插件注册 webhook 规则 |
| `ctx.dynamicCordisRunner`/`cordisInspect` | core | 动态包宿主 runner（扩展自身用） |

**插件能"主动发起的"**（在 harness 层面）：注册工具、命令、服务、系统提示词章节、UI slot 内容、webhook、定时任务、监听 agent 生命周期事件并 `followup`/`inject`。订阅的"生命周期事件"见 `inherited.md`：`internal/plugin`、`internal/status`（fiber 状态转换）、`internal/update`、`hmr/reload`、`exit` 等。

**关键点**：dsh 的 ctx 不是"一套固定方法"，而是"一个**由很多宿主包各自 `inject` 上架、插件按 key 拉取**的开放服务场"——`capability-seams.md` 就是这张服务场的目录（含实现包/消费方/配套插件，且有完整性守卫保证目录与实际一致）。插件"不空壳"正是因为宿主把几十个具名服务喂到 ctx 上，插件能挑着用。

---

## D. 注册/装配模型：slot / 注册表 / 接缝体系

**出处**：`docs/subsystems/slots.zh.md`（核心）、`cordis-primer.zh.md`、`capability-seams.zh.md`、`extension-cookbook.zh.md`（功能→机制映射表）

### dsh 的 UI 组合 = 类型化 Slots 系统（最接近用户 nodeRegistry/themeRegistry 的部分）
出处：`docs/subsystems/slots.zh.md`

- `SlotMap` 是**编译期注册表**（TS 声明合并写入 key），运行时声明 = 拥有该渲染位置的组件在 children 里给出的条目。
- 每个 slot 声明 **cardinality（基数）** 与 **scope** 两个独立维度：

| 维度 | 值 | 含义 |
|---|---|---|
| cardinality | `single` | 单格，渲染当前 priority 胜者（= 替换点） |
| | `list` | 多格，按 `id` 定址、先 `order` 后注册序排列（= 增量添加点） |
| | `keyed` | owner 传 `entryKey`，按 key 渲染匹配 props |
| | `chain` | 每格提供 `select(owner)`，第一个非 null 选中，否则 owner fallback |
| scope | `root` / `session-maybe` / `session` | 决定渲染时给组件哪些数据 |

- **API**：插件用 `ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({name, id, order}, Component))`。owner 折叠时它的 effect 自动移除、child slot 递归折叠。`root` 是唯一内建声明，ui-renderer 调 `renderSlot('root')` 渲染整棵树。注册/声明都走 Cordis effect 生命周期。
- **组件绝不收到 ctx**：owner 值经 props、共享视图状态用声明的 store + selector hook、私有数据走注册项 `inject` factory、child 渲染经 `renderSlot`。React 内容不通过注入值传递，而是靠 child slot 组合。
- 现成层级（slots.zh.md 给了一整棵声明树）：`sidebar.footer.action`、`conversation.session.header.actions`、`conversation.chat.node`（业务节点，**正是 node-content 的类比**）、`tool.call.toolview` 等。任何 slot 的 occupant 都能被 `cordis_inspect what:"client"` 查实时树。

### 对照用户系统：dsh slot 体系强在哪
用户 `themeRegistry.registerThemeSlot` / `nodeRegistry.registerNodeType`（`packages/canvas-core-v2/src/core/registry/*`）本质是 dsh slots 的**极简单格版**：

| 维度 | dsh slots | 用户 registry（themeRegistry） | dsh 强在哪 |
|---|---|---|---|
| 多格/单格 | cardinality 4 种（single/list/keyed/chain） | 单格 + 重复注册**抛错** | dsh 能增量添加多个 entry（list/keyed）；用户"防覆盖=单赢家"，一个槽只能有一个填 |
| 数据注入 | owner props + scope + slot 级 inject face + hooks | 组件句柄 opaque，未知形状 | dsh 明确组件输入（哪个 owner、哪些 hooks、哪些私有数据） |
| 顺序/替换 | `order`/`priority` 排序；用新 list id 增量、复用已占 keyed=替换 | 无排序概念 | dsh 支持"叠加多个 + 显式替换"，不是 one-shot |
| 折叠 | child slot 递归、owner 生命周期即子树生死 | unregister 回退默认 | dsh 有整棵子树的组合/回收语义 |
| 消费方 | `ctx.slots.inject` 等 host 生命周期 | 读注册表 get/set | dsh 的注册是 effect、随 scope 自动清理（用户其实已有 scope，但 registry 单格简化了） |
| 可见性 | 目录树 + inspect 可查 | 手动诊断 | dsh 有"宿主知道有哪些、在哪"的内省 |

**给用户的直接对照判断**：dsh 的多格 + 排序 + 明确组件输入，正是 nodeRegistry/themeRegistry 从"够用"变"有血有肉"要补的 3 件小事之一。但**别把 dsh 全套 cardinality/scope 照抄**（见 H 不该抄清单）。

### 非 UI 的"接缝"（harness 层）——插件安东西的地方
出处 `capability-seams.zh.md` + `extension-cookbook.zh.md` §功能→机制映射表：工具 `ctx.tools.register`、命令 `ctx.commands`、设置卡 `ctx.settings`、LLM 适配器、subagent provider、skill provider、webhook、定时任务、UI slot、系统提示词章节、inspect provider。**每样产品功能都映射到一个文档化扩展点上的监听器**（"微内核声明可验证"）——没有任何一行修改 agent 循环本身。

---

## E. 安全 / 授权 / 沙箱

**出处**：`cordis-host-runner/README.zh.md`（沙箱与信任）、`cordis-client-runner/README.zh.md`（guard）、`docs/subsystems/code-runtime.zh.md`、`approval.zh.md`、`capability-seams.zh.md`（`ctx.approval`、`ctx.codeRuntime`、`ctx.sandbox`）

### 为什么需要审批 / 权限 / 凭据 / 沙箱
因为动态包 = **agent 能加载并运行陌生人写的代码**（含可触达宿主文件系统/网络的代码）。文档立场（多处一致）：**"沙箱隔离全局变量，但**不是安全边界**——对待动态包要像对待 bash 访问一样；加载插件的慎重程度 = 授予 bash 工具。"** 出处 `cordis-host-runner/README.zh.md` §信任立场、`tool-cordis/README.zh.md` §已知限制。

- **沙箱**：host 半在 `node:vm` 里跑；Node 全局变量不存在或重定向到 Cordis 服务（`ctx.fs/web/bash` + timer helper）；拿到的是"不含框架内部机制的 façade"。`vmTimeoutMs`(5000) 只约束同步求值（async 可逃出——协作式信任）。
- **client 侧 guard**：浏览器半拿到的 `ctx` 是白名单（生命周期动词 + 自己 inject 的服务），fetch/setTimeout 等浏览器全局扣下，替代为 Cordis 注入的 client timer 服务。两半 guard "对称"，作者两侧见同一约定。
- **审批（approval）**：带 client 半的包 run 会 emit `cordis/request-run` 挂起，等人在 UI 面板批准/拒绝（也可顺带 `approveFutureVersions` 覆盖同插件未来版本）。headless/ACP 无页面连接则一直挂到轮次取消。这是"第三方插件被宿主加载"的人为闸门。
- 生产 harness 还有 sandbox（进程级）/ permission / approval / credentials seam，但那是给"agent 自己跑 bash/code"用的，**跟"加载外部插件"是两回事**，用户系统（单机画布、同仓可信插件）现阶段完全不抄（见 H 不该抄清单）。

### 能抄的**姿态**，不是机制
dsh 反复强调 trust posture + "运行的成功 ≠ 渲染的成功"（run 回执后 React 还可能崩，靠事后 channel `reportRenderFailure` 上报）——说明它把"插件是不可信第三方、会失败、会弄脏环境"当成默认前提来设计。用户系统即使全同仓可信，也应至少保留"失败可逆 + 失败可上报"。

---

## F. 生命周期与可逆性

**出处**：`docs/cordis-api/fiber.zh.md`、`docs/cordis-tutorial/02-lifecycle-and-effects.zh.md`、`cordis-host-runner/README.zh.md`、`docs/subsystems/scope.zh.md`、`capability-seams.zh.md`

### Cordis 的 Fiber 状态机（对照用户 Lifecycle 枚举）
出处 `cordis-tutorial/02` + `fiber.zh.md`：

```
PENDING → LOADING → ACTIVE → UNLOADING → DISPOSED
                 ↘ FAILED
```
- **PENDING**：已声明但所需服务（inject）未就绪 —— 最常见的"为什么没输出"。
- fiber 是"一次插件应用的运行时实例"：`uid`、`ctx`（子上下文）、`config`（校验过）、`state`（状态转换 emit `internal/status`）、`store`（所需服务快照）、`inertia`（在途 load/unload transition）。
- `fiber.dispose()` **等所有清理（含异步 disposer）完成**，并递归卸载子插件。
- `fiber.restart()`/`fiber.update(config)`：dispose 后按当前/新 config 重载；update 先跑 `internal/update` waterfall 让 HMR/钩子可否决或接管重启。

### effect 自动回收 vs 手动
出处 `02-lifecycle-and-effects.zh.md`：**内置注册 API 本身就是 effect**——`ctx.on`（卸载即移监听）、`ctx.plugin(child)`（随父 dispose）、服务注册、`ctx.tools.register` 等 harness 注册表返回的 disposer 都自动附着到调用插件。**只有 Cordis 不管理的资源**（timer/连接/watcher）才要自己包 `ctx.effect()` 返回 disposer。disposer 逆序执行；多个异步 disposer **并发**，若拆除需严格有序就把步骤放同一个 disposer 里依次 await。

### dsh 在"可逆性"上比用户系统进一步的地方
| 维度 | 用户 mini-canvas-v2 | dsh |
|---|---|---|
| 状态机 | `Lifecycle` 枚举（installing→…→uninstalled→error） | 同上思路 + **PENDING 态**（依赖未就绪就等着，服务到了自动激活）——用户现在没有"等依赖" |
| run 身份 | 无 run id；卸载靠 scope.dispose | **runId/currentPackageId** 精确点名"哪次激活在授权/在报错" |
| 版本 | 无 immutable Package 概念 | immutable Package + run/update 切换、stop 保留版本可再跑、undefine 才忘 |
| 卸载 | scope.dispose 逆序清理 | fiber.dispose 等全部(含异步)清理完成 + 递归卸子 + status 广播 |
| 更新 | 无"改配置重载"内置 | fiber.update 跑 internal/update waterfall（可 veto/接管） |
| 失败诊断 | 有半成品副作用回收 | + `getEffects()` 元数据树、fiber.await() 重抛启动错误、错误码 `INACTIVE_EFFECT` |

用户已经做对了核心（scope 逆序、幂等 dispose、子先于父）——比 v1 好得多。缺的是"**每个插件实例有可诊断身份 + 依赖就绪的 PENDING**"与"**热装/热卸时若依赖它的其他插件在跑该怎么办**"。

---

## G. 测试与"文档即契约"

**出处**：`docs/testing.zh.md`、`docs/cordis-api/*`（`BEGIN GENERATED` 标记）、`docs/subsystems/*.zh.md`、`capability-seams.zh.md`、`extension-cookbook.zh.md`

### 测试分层
出处 `docs/testing.zh.md`：单元（vitest，每注册表都要有 **HMR 安全测试**：对贡献者 fiber 执行 dispose 并断言清理完成）→ 覆盖率门禁（按文件 100%，未覆盖行往往是该删的死代码）→ 真实 API e2e（带密钥，缺 key 自动跳过）→ expected 输出 → 快照（录制 session 回放）→ Web 浏览器快照。**原则**："优先用真实实现而非 mock，只 mock 开销高/不确定的边界"；"验证外部世界而非自我报告"；"测试真实入口路径（构建产物）"。

> 对用户：最值得抄的是"**每个 registry 有一个卸载/热重载安全测试**"（dispose 一个已注册插件的 scope，断言它贡献的东西清干净）——用户已写 `scope.test.ts`、`themeRegistry.test.ts`，这类正是 Cordis 强调的 HMR 安全测试。

### "文档即契约 / 自动生成 cordis-catalog"
dsh 用 `scripts/gen-cordis-catalog.ts` 从源码 JSDoc 自动生成 `ctx.*` API 目录（`docs/subsystems/extensions.zh.md`、`docs/cordis-api/*` 内 `BEGIN/END GENERATED cordis-surface` 标记），并 `verify-cordis-catalog` 守其新鲜度、交叉校验声明与分发调用点；`capability-seams.md` 由 `gen-doc-graphs.ts` 生成服务目录且带"完整性守卫"。**值得学吗**：这是"仓库巨大、API 繁多、跨端 client/host 各自维护类型"时的强需求（防止文档与源码漂移 + 让 agent/作者能精确查到某服务签名）。用户单包画布、API 少、作者就是本人 —— **现阶段不值得为它上自动 catalog 工具链**，但"**给每个公开 ctx 服务/注册函数写死 JSDoc、把签名当 API 契约**"的习惯成本很低、收益直接（尤其 type 由 declare module 扩展而来）。

---

## H. 给 mini-canvas-v2 的可落地借鉴（最重要）

### H0. 用户插件"像空壳"，到底缺的是什么

把两边摆一起诊断（基于读到的用户代码 `packages/canvas-core-v2/src/**` 与 dsh 文档）：

**缺的排序（按对"有血有肉"的贡献）**：
1. **缺"宿主喂给插件的高层服务 + 可见 slot 太少"（最缺）**。dsh 插件能做出东西，是因为 ctx 上有 commands/settings/tools/slots/几十个 seam 可挑；用户 ctx 目前只给 nodeStore/nodeFactory/save/selection/history 等"数据服务"，加上 nodeRegistry/themeRegistry。插件除了"注册一种节点/主题 + 建节点 + 写 nodeStore"几乎没有别的可干、也没有"UI 有多个可叠加的落点"。这造成"每个插件只能在一个槽填一个组件，槽一满就 nothing"的空壳感。
2. **缺"插件能挂的可见场景/交互层"**。dsh 有 sidebar/conversation.header.actions/chat.node/tool.call.toolview 一整棵 slot 树；用户没有"工具栏按钮、右键菜单、画布面板、节点装饰、快捷键、状态栏、设置面板"这类**有语义的落点**。没有落点，注册表再多也是空的。
3. **缺"服务依赖就绪编排（inject 等待/PENDING）"**。用户 `deps:[]` + `ctx.get` 取不到就抛错；插件之间没有"等服务到位再启动、服务被换/卸时自动卸载重跑"的协作。dsh 这是核心（Cordis primer 头两条概念）。
4. **缺"插件实例的可诊断生命周期身份"**。用户卸载靠 scope 匿名清理，没 per-plugin 的 fiber 身份/状态机诊断（谁在跑、跑哪个版本、配置为何、inject 谁）。

**"身份/版本/生命周期编排"其实用户已经有了 install/uninstall/reload + Lifecycle 状态机 + 事件，并不算最缺。** 最缺的是 **1 和 2**——给插件"足够能力 + 足够可挂的可见场景"。

### H1. 5–10 条最小可行、能照抄的具体动作

每条 = dsh 怎么做的 → 用户现状 → 最小落地建议。

**1. 把 ctx 从"方法集"升级成"开放服务场"，并且给插件更多可做的宿主服务。**
dsh：宿主几十个包各自 `inject` 上架服务，插件按 key 拉取（capability-seams.md 目录）。
用户：`Context.inject/get` 已是 String→服务表，机制在。
落地：**先盘点并补几个"插件真的会用"的宿主服务**，例如 `ctx.commands`（现有 commandRegistry 已可当服务上架）、`ctx.shortcuts`、`ctx.selection`、`ctx.history`、`ctx.save`——重点是**把它们以服务身份 `inject` 上 ctx 并写清 JSDoc**，让插件 setup(ctx) 里能 `ctx.get` 到、而不是只靠 4 个内部注册函数。别一次性做几十个，先补 3~5 个高频的。

**2. 给插件"多种基数 + 可排序 + 可增量添加"的槽，替换"单格 + 重复抛错"。**
dsh：cardinality 有 single/list/keyed/chain；用新 list id 增量、复用已占 keyed 才替换（slots.zh.md）。
用户：themeRegistry.register 单格、重复抛错；nodeRegistry 类似。
落地：给 `themeRegistry`/`nodeRegistry` 加**多格/list 语义**：注册项带 `id`+`order`，`renderSlot`/消费方按 order 排，允许一个槽多个 occupant。**最小改动**：不必做 full cardinality，只把"槽"从"填一个"改成"叠多个 + 排序 + 显式替换"即可让"主题 A 叠加装饰 B"成为可能——这一条最接近让 registry 从空变活。

**3. 每个注册项给明确"组件输入契约"，别让组件拿到裸 ctx / opaque。**
dsh：组件绝不收 ctx；owner 值走 props、共享视图状态走 store+selector、私有数据走注册项 inject（slots.zh.md）。
用户：nodeRegistry 存 opaque content/title/toolbar 组件句柄，host 渲染时靠什么喂数据？textContent 靠 `ctx.get('text')`（服务可全局拿到，耦合）。
落地：给 node/theme 注册项定义 `registerNodeType(ctx, {type, label, segments:{content, title, toolbar}})` 的**组件 props 形状**（例如 content 收到 `{nodeId, data, store-like hooks}`），让内容组件从"全局 get 服务"改成"收声明好的 props"，解耦 + 可被宿主统一喂数据。不必搬 dsh 的 inject-face 全套。

**4. 补 inject 依赖"就绪等待"，把 PENDING 引入生命周期。**
dsh：inject 声明服务→等服务就绪才 apply；服务变/卸→自动卸载重跑（registry.zh.md、fiber PENDING）。
用户：deps 目前仅用于 topo 排序 + 启动前校验；运行中热装时若依赖还没装，setup 里 ctx.get 直接抛。
落地：**最实用的一小步**——热装/热卸时不强制 topo 重排，而是让依赖没就绪的插件进入"待命(PENDING)"、其 setup 暂缓执行，等服务 `inject` 上架的瞬间再跑 setup、服务被卸时自动把依赖它的插件卸载/待命。这可让"动态加装 + 互相依赖"真正可用。

**5. 给每个插件实例一个可诊断的身份 + 状态机 + 失败上报。**
dsh：fiber.uid/state/store/config、状态转换 emit `internal/status`、getEffects() 诊断、fiber.await() 重抛启动错误、错误码 INACTIVE_EFFECT。
用户：有 Lifecycle 枚举 + ctx:lifecycle-change 事件，但无 per-plugin 可查的"当前状态/依赖/配置/在跑版本"，热装抛错也只删记录。
落地：给 `installPlugin`/`plugin` 返回/记录一个 `fiber`-like 句柄对象：`{name, state, deps, config, scope}`，并让 setup 抛错/卸载走一个统一的 `reportFailure(name, err)` 广播（对应 ctx:lifecycle-error）。**成本低，诊断价值立刻有**。

**6. 生命周期注册默认 = effect（尽量让插件不写 uninstall）。**
dsh：所有内置注册 API 本身就是 effect，plugin 很少手写 ctx.effect（02-lifecycle）。
用户：registerNodeType/factory.register 靠插件手写 `ctx.effect(()=>()=>factory.unregister())`；registry 内部未必自动回收。
落地：让 `registerNodeType(ctx,def)` / `registerThemeSlot` / `factory.register` / `commandRegistry` **返回的撤销动作自动登记进调用插件的 scope**（像 ctx.inject 已做的那样），插件就不用每次包 effect。这一条直接减样板、杜绝"卸载漏清"。

**7. 给事件加分发模式（至少加 waterfall/bail），用于"可协商/可拦截"的点。**
dsh：5 种分发模式；waterfall 做 permission gate、prepend 控制顺序（cordis-primer、events）。
用户：EventBus 只有 emit（广播）+ on/once。
落地：选 1~2 个画布上"需要协商/拦截"的语义点做成事件。**最自然的候选**：`before:node-create`/`before:connect`/`before:delete`（bail：任一插件可否决，替代现在 connection.ts 里手写的策略），或 `node:render` waterfall（让主题/节点可包装）。给 EventBus 加 `waterfall` 和 `bail` 两种（eventBus 现在纯同步 emit，改造成本可控），比抄全部 5 种更划算。`commands`/`edit` 这类"希望多个插件都能拦/能接力"的点，正是 waterfall 场景。

**8. "宿主发现插件 & 渲染它们"要有一条清晰、可内省的路径。**
dsh：ui-renderer 从 `root` 渲染整棵 slot 树 + `cordis_inspect` 可查实时树/occupant（slots.zh.md）。
用户：host `CanvasHost.vue`/`canvasHostCore.ts` 读 registry 渲染，但**没有"宿主当前装了什么插件、它们各填了哪些槽、每个槽有几个 occupant"的清单视图**；dev 阶段有 listPlugins()/injectedServices()，但无 slot 级。
落地：给核心加一个轻量 **`inspect()`**：`ctx.slots()`/`registry.list()` 返回"槽名→occupant（order/id/组件名）"，demo 侧放个 dev 面板打印。这让"插件到底有没有填进去、填对没有"一目了然——治"空壳感"最直接的可见手段。

**9. 以"功能→机制映射"写一份自己版本的 cookbook / 扩展点清单。**
dsh：extension-cookbook.md 有一整张"产品功能→插件机制"表，并强调"每个功能映射到一个文档化扩展点、不修改循环本身"。
用户：核心机制已有（scope/inject/get/registry/events），但没有一份"**画布功能应该挂在哪个扩展点**"的清单（建节点走哪、连线校验走哪、右键菜单走哪、保存走哪、撤销走哪）。
落地：写一页 docs 表（不必像 dsh 那样自动生成），列"你要做的功能 → 用 ctx 哪个服务/注册哪个槽/发哪个事件"。**这是把系统"教给作者/未来插件"的地图**，也是 user 觉得空壳的原因之一——没有这张图，作者不知道该在哪加。

**10. 别低估"文档/README 讲清楚插件能干嘛"的杠杆。**
dsh：每个扩展包 README 有标准章节 + 每个 `@Remote`/事件都生成签名 + limitations 诚实列出。
落地：给核心 API 写死 JSDoc + 一篇"插件作者指南"（形似 dsh cordis-tutorial：1 建个最小 text 插件、2 生命周期/effect、3 服务共享、4 事件、5 配一个 node+主题+命令的完整插件）。**写这份东西时往往就暴露"宿主没给够能力/没给够落点"**——是诊断空壳感最好用的镜子。

### H2. dsh 做法里用户**不该抄**的（过度设计）

1. **host/client 双 half + 进程/浏览器分离 + @Remote + approval**：用户单机画布，插件与宿主同仓、同进程、同页，不需要跨 realm RPC、不需要"浏览器半由页面装载"、不需要 host 沙箱与审批闸门。要的是"插件能注册 UI 组件 + 服务 + 命令，宿主同页装配"，不是"陌生人代码进页面要人批"。
2. **extensions 的 immutable Package + run/update 版本管理**：那是给"agent 运行中反复改代码、可修可回滚"设计的。用户节点/主题插件是一次性写死发版，不需要版本栈。
3. **5 种完整分发模式 + cardinality 4 型 + scope(root/session) + inject-face**：抄核心子集即可（加 waterfall/bail、加 list 多格），全套只会让最小内核变重。
4. **agent harness 特有的服务**：sessions/agents/systemPrompt/tools 的 PTC/审批/sandbox/webhook/code-runtime/credentials —— 画布完全不相关，别为"像 dsh"而造。
5. **自动 cordis-catalog 文档工具链 + 双语 i18n**：API 少、作者即用户时不值当。
6. **"定义只在进程内存、重启即清"**：dsh 因为它是运行时临时工具才这么设计；用户插件是工程化 workspace 包，应保留静态装配。

---

## 附：读到的核心文件索引（证据）
- `deepseek-harness/docs/cordis-primer.zh.md` —— 5 核心概念 / dispatch modes / waterfall / 实践规则
- `deepseek-harness/docs/capability-seams.zh.md` —— 服务角色(seam/core)+服务目录大表（ctx 血和肉）
- `deepseek-harness/docs/cordis-api/`（context/events/fiber/registry/service/inherited）—— ctx 能力总表
- `deepseek-harness/docs/subsystems/extensions.zh.md` —— 动态包 API（动态注册/run/版本/审批/inspect/事件）
- `deepseek-harness/docs/subsystems/slots.zh.md` —— 类型化 UI slots（cardinality/scope/渲染树/inspect）
- `deepseek-harness/docs/cordis-tutorial/02` —— fiber 状态机 / effect 生命周期
- `deepseek-harness/docs/testing.zh.md` —— 测试分层 + HMR 安全测试
- `deepseek-harness/docs/cookbook/extension-cookbook.zh.md` —— 扩展插件形态 + 功能→机制映射
- `deepseek-harness/packages/extensions/{cordis-host-runner,cordis-client-runner,ui-cordis,tool-cordis}/README.zh.md` —— 双 half 实现细节与信任立场
- `mini-canvas/packages/canvas-core-v2/src/**`（Context/Scope/types/nodeRegistry/themeRegistry/plugin-node-text）—— 对照对象现状

**未确认项**：`ctx.agents`/`sessions`/`sessionQuery` 等 agent 服务内部行为细节、`cordis-client-runner`/`ui-cordis` README 截断未全读的尾部、packages/extensions 真实源码里 guard/slot 准入的精确实现——均不影响本报告核心结论。
