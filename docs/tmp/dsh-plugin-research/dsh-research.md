# DeepSeek Harness (dsh) 插件体系研究笔记

> 目的：为 mini-canvas（Vue3 + VueFlow）画布应用的插件系统重构提供事实依据。
> 目标问题：插件能否"完全抽离成独立 packages 库"、倾向 dsh 式实现、"插件 UI 与逻辑一体"。

**抓取对象与结论前置说明（重要）**
- 用户钦点文章：https://dev.to/henry_lin_3ac6363747f45b4/deepseek-harness-dsh-cha-jian-kai-fa-jiao-cheng-4h6j （《DeepSeek Harness (dsh) 插件开发教程》，中文，作者 Henry Lin）——抓取成功。
- 该文章描述的确实是 DeepSeek AI 官方开源项目 `deepseek-ai/deepseek-harness`（npm 包 `@deepseek-ai/dsh`，Node，2026-08-13 发布），底层由 vendored 的 **Cordis** 插件框架驱动。
- 注意存在同名但无关的第三方仓库（Python 的 `HenryZ838978/deepseek-harness`），与官方体系无关，已排除。
- 官方资料源：官方文档站 https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/ 、GitHub 仓库 docs/architecture.md、以及 Web UI 架构资料（deepseekdocs.com）。
- 本文所有结论均来自上述真实抓取内容，未做臆测。

---

## 1. 核心机制：插件是什么、如何被加载/注册

**一句话理念：一切皆插件，产品里没有特权核心。** 模型适配器、工具注册表、会话日志、乃至 agent 主循环本身都是插件，任何一部分都能从配置层面替换或扩展。整个产品 = 启动时从若干有序"层"组合出来的一棵插件树。

### 1.1 插件的最小编程模型（Cordis 驱动）
一个插件就是一个 **TypeScript 模块，导出 `apply` 函数**；框架加载插件时调用 `apply` 并传入一个共享的 **`ctx` 上下文对象**，插件通过 `ctx` 注册能力。

```
import type { Context } from '@deepseek-ai/cordis'
export const name = 'my-plugin'            // (a) 可选，仅诊断显示用
export const inject = ['tools']            // (b) 声明依赖的必需服务
export interface Config { greeting: string }
export const Config = z.object({ greeting: z.string() })  // (c) 部署期配置的校验 schema
export function apply(ctx: Context, config: Config) {     // (d) 插件主体
  ctx.logger.info(config.greeting)
}
```

**插件四个标准导出：`name` / `inject` / `Config` / `apply`。**
- 三种书写形态：函数（最常用）、对象（`{ name, inject, apply }`）、类（继承 `Service`，当插件要给别人提供服务时用）。
- `apply(ctx, config)` 是插件贡献一切的地方；注册的内容都应做成**可逆 effect**（卸载时自动回收，无需手写 removeListener/clearInterval；需要显式清理的资源用 `ctx.effect(disposer)`）。
- `inject` 是**依赖注入声明**：loader 会等 `inject` 里列出的服务都存在，才执行 `apply`——依赖就绪由框架保证。

### 1.2 加载 / 挂载方式（三条路径，见文章第 5 章）
| 路径 | 适用 | 做法 |
|---|---|---|
| **外置插件**（官方推荐大多数场景） | 自研、单独发布、不开源 | 独立 npm 包，profile 里 `dsh plugin add` 安装 |
| 临时 overlay | 调试/演示 | `pnpm dsh --profile <p> --patch ./overlay.yml` |
| 仓库内包 | 给 dsh 贡献代码 | 放 `packages/<group>/<name>/` |

- 配置载体是 **`cordis.yml`**：一组 Cordis 配置项列表，`name` 可以是相对路径或 npm 包名，loader 逐条挂载。
- 通过 `--patch ./x.yml` 或 profile 的 `cordis.patch.yml`，可按 id 定位并**整行替换/插入**某插件的配置——这就是"从配置层替换/扩展"的落点。

### 1.3 插件树与生命周期
- 运行中的 dsh = 启动时从 ordered layers 组合的**插件树**：每层按 profile 列出的 bundle 顺序 → profile 的 patch → home 级 patch → `--patch` overlay 依次作用到空 entry 列表上。
- **自动清理**：凡是经 `ctx` 注册的（事件监听、工具、定时器）在插件卸载时自动回收；需要显式释放的资源交给 `ctx.effect()`。

## 2. 事件 = 扩展点（三域）
- **Session 事件**：追加式持久化事实（`session/event`），需要跨 reload 存活时用它。`turn/*`、`step/*`、`user/message`、`assistant/*`、`tool/*` 是 durable 的。
- **Agent 事件** `agent/*`：携带实时 Agent（inbox、step、status…），用于观察/拦截在途工作。
- **能力事件**（`fs/*`、`tools/*`、`telemetry/*`）：在能力缝上挂策略与适配器。
- 其中部分是 **waterfall**（如 `agent/pre-step`、`agent/request`、`llm/stream`、`tools/*`），监听者必须调用 `next()` 向下委托，可改写甚至拒绝内容——这是"钩子插件"拦截事件的实现方式（文章第 7 章实战）。

## 3. 可替换能力 = "缝"（Capability Seam），三角色
当一项能力需要可替换时，dsh 用的不是"一个类"，而是**缝**——三个角色一起设计：

| 角色 | 职责 | 例子 |
|---|---|---|
| **Service Definition** | 声明接口（服务 + 事件词汇），挂到 `ctx.<x>` | `dsh-subagent` 提供 `ctx.subagents` |
| **Service Provider** | 实现该接口 | `dsh-subagent-spawn-in-process`、`-fork`、`-acp`… |
| **Consumer** | 消费它，通常是模型可见的工具 | `dsh-tool-subagent` 把 provider 暴露给模型 |

> 一个角色不算缝；新增能力要设计全部三个角色——即使开始时 Provider 只有一个。经典模板是 shell 三件套 `packages/shell/`。
> 好处：换一个 Provider 整体改变产品行为（文件系统 + 子进程共享同一执行世界，`ctx.shell` 指向远程沙箱，bash/PTY/LSP 一起换）。

## 4. 插件与"宿主 UI / Agent"的关系（关键：不是纯逻辑，是"双面包"）

**插件可以同时带"宿主(Host)逻辑半面"和"浏览器(Client)UI 半面"——一个包里两个半面共存。**

官方 Web UI 是"宿主进程 + 浏览器侧"的**双进程架构**：
- **Host**（`host/`）：持有 agents 与能力（agent loop、tools、sandbox）。
- **Client**（`client/`）：浏览器里的 **React 插件壳**，通过连接层订阅事件流；浏览器本身**不持有真实能力**，只订阅。

插件按同一套拆分成"双面"：**Host 半面在宿主里跑（`ctx` 上注册能力）**，**Client 半面在浏览器里跑（注册 UI 插槽/slot）**。

### 4.1 一个双面包的 package.json 形态
```json
{
  "exports": {
    ".": "./lib/index.js",      // host 半面
    "./client": "./lib/client.js" // browser 半面
  },
  "dsh": { "client": { "inject": ["slots", "connection"], "platform": "web" } }
}
```
- 包内目录约定：**Host 半面在 `src/`，浏览器半面在 `src/client/`**，导出为 `./client`，用 `dsh.client` 声明。
- 客户端模块系统会**扫描启用的 Loader 条目**里声明了 `dsh.client` 的包，把每个包构建出的 `./client` 导出服务到页面——**插件挂进 `cordis.yml` 后，页面立刻出现它的 UI，无需重编译整个 web 应用**。

### 4.2 UI 的挂载机制 = Slot（插槽）系统
浏览器半面通过 `ctx.slots.inject(...)` + `ctx.slots.register(...)` 把自己的 React 组件注册到命名插槽：
```ts
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('settings.section', () =>
    ctx.slots.register({ name: 'settings.section', id: 'plugins', order: 60, label: () => 'Plugins' }, PluginPanel))
}
```
- 命名插槽如 `settings.section`、`settings.*`，第三方插件不必硬编码进 Web UI 源码，**找准插槽挂进去即可**。
- 设置页卡片以 **namespace（设置命名空间）** 为 join key：Host 半面用 `ctx.settings.<x>.section()` 注册命名空间、Client 半面在对应 namespace 下注册卡片，两者自动配对。消费端"命名空间被提供 + 卡片已注册"交集成立才渲染——未被组合的半面不留任何痕迹。
- **理想的双面划分**：Host 半面是纯逻辑/数据（在 `ctx` 注册服务、设置 schema、工具、事件），Client 半面是纯 UI（React 组件），两半面通过命名空间 + 事件流解耦，都不 import 对方内部实现（bundle 纯度门禁禁止跨插件 import 值）。

> 类比到 mini-canvas：一个 Vue 插件包可以 = `src/`（Host 逻辑：注册节点/边/数据服务、命令、事件钩子）+ `src/client/` 或同级（Vue 组件：节点面板、工具面板、设置卡片），通过"能力命名空间 + 事件/插槽"解耦，UI 与逻辑一体但分层。

## 5. 把插件做成独立、可复用"库/包"的约定（文章第 10 章 + cookbook）

### 5.1 仓库内正式包 checklist
1. **选组**：`core`、`llm`、`shell`、`fs`、`web` 等已有组匹配能力角色，放进组的 `packages/<group>/<name>/`。
2. **注册**：`tsconfig.host.json` / `tsconfig.client.json` 的 `references` 加一行；新组才动 `tsconfig.base.json`。
3. **命名**：接口/能力包按"能力"命名（如 `dsh-subagent`）；实现包加"机制"后缀（`-in-process`、`-fork`）。
   - `ctx` key 约定：**单数 = 一个引擎实例，复数 = 注册表**。
4. **验证**：跑质量门（strict TS、oxlint、vitest、tsc 产出类型、tsdown 产出 bundle）。
5. **双面包**：`dsh.client` + `dsh.bundle` 等字段在 `package.json` 的 `dsh` 命名空间下声明自己。
   - `dsh.profile`：列出 profile 组合的 bundles。
   - `dsh.bundle`：指向 bundle 的 patch 文件。
   - `dsh.client`：声明浏览器半面。

### 5.2 独立外置包（不 fork dsh 也能做）
- 独立 npm 包，`dsh plugin add` 安装进 profile。
- **package.json 里声明 `"dsh": { "bundle": ... }` 的，会自动进入该 profile 的 bundle 层**。
- 依赖/peer 依赖用普通 npm 声明；包要 import 的类型来自 `@deepseek-ai/cordis`。
- 浏览器半面要自行复刻 client 模块系统的构建格式（官方 `tsdown.config.ts` 是共享 preset，未对外发布，包外需自己产出 lazy-CJS factory 格式）——这是外置 UI 包的已知门槛。

### 5.3 清单/manifest、作用域、生命周期概念（逐一回答）
- **manifest**：有。`package.json` 的 `dsh` 字段（`profile` / `bundle` / `client`）+ `exports` 的 `./client` 分半面；另有 `cordis.yml` 作为运行期配置清单。
- **作用域 / 隔离（scope）**：有 `core/scope` —— 按 agent 做"scoped registration"原语；`core/tools` 是 scoped 工具注册表；`isolate` realm 可给单个 session 不同的能力集（agent preset 里的 service row 需要它）。会话/agent 粒度可隔离能力。
- **生命周期管理**：有。插件树分层组合、`apply`/`inject` 依赖就绪、`ctx.effect()` 显式资源回收 + 自动清理、waterfall 事件（`next()` 委托）、reload 时按 layer 重放、patch 可整行替换/禁用某插件。

## 6. 对 mini-canvas 重构可直接落地的结论

1. **"插件完全抽离成独立 packages 库"在 dsh 是默认形态**：插件 = 自描述 npm 包（`name` + `exports` + `dsh.*` metadata），主进程/宿主只按 `cordis.yml`/loader 条目加载。mini-canvas 的插件同样可做成独立包，宿主只依赖一个"加载清单"。
2. **UI 与逻辑一体是支持的，但分半面**：一个插件包 = Host 逻辑面 + Client UI 面（`src/` + `src/client/`，`dsh.client` 声明），用**命名空间 + 事件流 + Slot** 解耦。这对 Vue 插件很有参考价值：包内分 `src/`(逻辑/数据/命令) 与 `client/`(Vue 组件)，宿主通过命名空间注册组件容器。
3. **对外暴露的编程契约极小**：只需 `name / inject / Config / apply(ctx, config)` 四件事；依赖用 `inject` 声明式声明，由框架保证就绪顺序——宿主不需要自己排加载顺序。
4. **能力抽象成"缝"的三角色**（Definition / Provider / Consumer）是让功能可替换、可插拔的成熟模板；Provider 单一即可起步，但接口要独立成包（接口包按能力命名，实现包加机制后缀）。
5. **UI 挂载用"命名插槽 + join key"，宿主零硬编码**：卡片/面板组件不进宿主源码，靠 slot key（如 namespace）配对，宿主只提供容器插槽。部署里没组合的半面自动不渲染、不留痕迹。
6. **注册都要可逆 effect + 自动清理**，宿主/框架负责卸载回收——插件卸载不该留垃圾。

### 已知门槛（诚实提醒）
- 官方 Web UI 是 **React** + 自己的 client 模块系统 / slot / bundle 构建 preset；其 slot 模型可直接借鉴思路，但代码/格式无法整搬到 Vue3 + VueFlow。mini-canvas 应**学其架构范式**（插件树、四导出契约、双面包、命名插槽、可逆 effect、作用域），而非搬运其 React 实现。
- 外置插件若带浏览器 UI，需自行实现 client 构建格式与动态加载机制（官方 preset 未对外发布）。
