ction__icon crayons-reaction__icon--inactive p-1">

                DeepSeek Harness (`dsh`) 插件开发教程

                      #architecture
                      #programming
                      #softwaredevelopment
                      #tutorial

  DeepSeek Harness (dsh) 插件开发教程

本教程面向想要为 dsh 编写插件的开发者，从概念到可运行的插件逐步走通。你将学会：认识"一切皆插件"的架构、写出函数插件、把它挂载到 dsh、做一个模型可见的工具插件、做一个拦截事件的钩子插件，最后了解如何做成正式包并过质量门。

  目录

- 核心概念：一切皆插件

- 环境准备

- 编写第一个插件

- 插件的四个导出：name / inject / Config / apply

- 把插件挂载到 dsh

- 实战一：模型可见的工具插件

- 实战二：拦截事件的钩子插件

- 声明式配置（Config）

- 能力缝：Service Definition / Provider / Consumer

- 仓库内开发一个正式包

- 测试与质量门

- 常见问题排查

  1. 核心概念：一切皆插件

dsh 由 vendored 的 Cordis 驱动。产品里没有任何特权核心：模型适配器、工具注册表、会话日志、甚至 agent 主循环本身都是插件，因此任何部分都可以从配置层面替换或扩展。整个产品就是启动时从若干层组合出来的一棵插件树。

五个必须记住的想法（详见 docs/cordis-primer.md）：

想法
含义

插件
一个实现了 Service 的对象：最常见的是带 apply(ctx) 的函数，也可以是有 inject 的对象或 Service 子类

上下文（Context）
服务的仓库。服务挂到稳定的 ctx.<key>（如 ctx.tools、ctx.llm、ctx.sessions），插件之间通过 key 找服务，不 import 具体实现

inject
声明插件需要的服务。loader 会等待这些服务存在后再执行插件，加载顺序由依赖决定而不是文件顺序

类型化事件
服务通过声明合并定义事件，用 emit / waterfall / parallel / serial 分发给监听者

可逆的注册
工具 schema、prompt 段、适配器、监听器都通过 ctx.effect() / ctx.on() 注册；插件卸载（HMR、热重载、关停）时一切自动回滚

扩展点（event / 服务）是 dsh 的"API"。改行为时优先挂在扩展点上，不要改 loop。完整的对应表见 docs/architecture.md 的 Where new behavior goes。

  2. 环境准备

推荐在一个 clone 下来的仓库里开发，这样能直接使用仓库的命令行和脚本。

CODEBLOCK_BEGIN
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
pnpm install

CODEBLOCK_END

    Enter fullscreen mode

    Exit fullscreen mode

日常命令（docs/development.md）：

CODEBLOCK_BEGIN
pnpm run typecheck     # 类型检查（strict，无 any 逃逸）
pnpm run lint          # oxlint
pnpm run test          # vitest 单元测试
pnpm run build         # tsc 产出 lib/types + tsdown 产出 lib/
pnpm dsh --profile headless "你好"   # 从源码跑一个一次性任务（需要 DEEPSEEK_API_KEY）

CODEBLOCK_END

    Enter fullscreen mode

    Exit fullscreen mode

运行真实模型需要 API Key。把 DEEPSEEK_API_KEY 放进根目录 .env，pnpm dsh 会自动加载。

注意：本教程第 3 章的"纯链路演示"不需要 Key；第 6 章起的工具/钩子插件要真正跑模型时需要 Key。没有 Key 也可以先写代码、跑单元测试和 dump-config 验证。

  3. 编写第一个插件

  3.1 最小函数插件

在任意开发目录（这里假设仓库根下的 tmp/hello-plugin/）创建 hello.ts：

CODEBLOCK_BEGIN
import type { Context } from '@deepseek-ai/cordis'

export const name = 'hello'

export function apply(ctx: Context) {
  ctx.logger.info('hello from my first plugin')
}

CODEBLOCK_END

    Enter fullscreen mode

    Exit fullscreen mode

name 是可选显示元数据，用于诊断信息中标识插件。apply(ctx) 是插件贡献一切的地方。

再创建 cordis.yml：

CODEBLOCK_BEGIN
- name: './hello.ts'

CODEBLOCK_END

    Enter fullscreen mode

    Exit fullscreen mode

cordis.yml 是一组 Cordis 配置项列表，name 可以是相对路径或 npm 包名。loader 会挂载每一条。

  3.2 用 vendored loader 跑起来（不需要 Key）

仓库内带了 vendored 的 Cordis 启动器，可以直接走一遍最小的挂载链路：

CODEBLOCK_BEGIN
node --import tsx ../../vendor/cordis/bin.js

CODEBLOCK_END

    Enter fullscreen mode

    Exit fullscreen mode

预期输出：

CODEBLOCK_BEGIN
[info] hello from my first plugin

CODEBLOCK_END

    Enter fullscreen mode

    Exit fullscreen mode

发生了什么：

- 启动器创建根 Context 并挂载 Loader 插件。

- Loader 读取 cordis.yml，解析 ./hello.ts 并作为子插件挂载。

- Cordis 调用你的 apply(ctx)。

日志导出器装好后进程会一直等待事件，没有其他事件时 Ctrl-C 退出即可。这个例子摘取自正式的 Cordis 教程第 1 章，那里有更完整的讲解。

  3.3 插件不只是函数

Cordis 接受三种形态；在你需要公开服务之前，一直用函数形态：

CODEBLOCK_BEGIN
import { Service, type Context } from '@deepseek-ai/cordis'

// 1. 函数插件（最常见）
export function apply(ctx: Context) {}

// 2. 对象插件：带 apply 方法的对象
export const objectPlugin = {
  name: 'object-plugin',
  apply(ctx: Context) {},
}

// 3. 类插件：Service 子类（适合对外提供一个 ctx.<key> 服务）
export class MyService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'myService')
  }
}

CODEBLOCK_END

    Enter fullscreen mode

    Exit fullscreen mode

  4. 插件的四个导出：name / inject / Config / apply

一个正式的函数插件通常导出四个东西：

CODEBLOCK_BEGIN
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

/** 插件显示名，仅用于诊断。 */
export const name = 'my-plugin'

/** 声明依赖的必需服务；loader 会等它们存在再执行 apply。 */
export const inject = ['tools']

/** 部署期配置的 schemastery 校验 schema（可省略，见第 8 章）。 */
export interface Config {
  greeting: string
}
export const Config: z<Config> = z.object({
  greeting: z.string(),
})

/** 插件主体：注册一切贡献，并只注册为可逆 effect。 */
export function apply(ctx: Context, config: Config) {
  ctx.logger.info(config.greeting)
}

CODEBLOCK_END

    Enter fullscreen mode

    Exit fullscreen mode

要点：

-
inject 只声明必需服务。可选项用 ctx.get(name) 读取全局服务仓库，不要用属性代理（拓扑敏感）。

-
function 插件必须命名导出，不要配默认导出。混合两种形式会让 Loader 丢掉 inject 元数据（见 packages/AGENTS.md 的 postmortem 引用）。

-
apply 签名：有 Config 导出时是 (ctx, config)，没有时是 (ctx)。

-
误配置要 fail loud：加载失败会明确报错，不会静默跳过。

  5. 把插件挂载到 dsh

  5.1 插件树怎么来的

一个运行中的 dsh 由若干层组合而成，后层覆盖前层：

- profile 清单里列出的各 bundle（顺序加载）

- profile 的 cordis.patch.yml

- 家目录级 $DSH_HOME/cordis.patch.yml

-
--patch <path> 覆盖（按 argv 顺序）

查看你机器实际组合出的树：

CODEBLOCK_BEGIN
pnpm dsh --profile headless --dump-config

CODEBLOCK_END

    Enter fullscreen mode

    Exit fullscreen mode

任何打印出来的行，都可以用你自己的 patch 替换。patch 按行 id 定位：要么替换那行的整个 config（不是深合并），要么插入新行。

CODEBLOCK_BEGIN
# overlay.yml
- id: my-tool
  name: '@deepseek-ai/dsh-tool-mine'
  config:
    option: value

CODEBLOCK_END

    Enter fullscreen mode

    Exit fullscreen mode

  5.2 三条挂载路径

路径
适用
做法

外置插件（推荐大多数场景）
自研、不开源、单独发布
独立 npm 包，profile 里 dsh plugin add 安装；package.json 声明 "dsh": {"bundle": ...} 可自动进 bundle 层

临时 overlay
调试、演示
pnpm dsh --profile <name> --patch ./overlay.yml "任务"

仓库内包
给 dsh 本身贡献代码
放 packages/<group>/<pkg>，见第 10 章

  5.3 安装外置插件

dsh plugin 子命令在 profile 目录里调用 pnpm，动词直接透传：

CODEBLOCK_BEGIN
pnpm dsh plugin --profile headless add /path/to/my-plugin
pnpm dsh plugin --profile headless add github:some-org/my-plugin
pnpm dsh plugin --profile headless remove my-plugin

CODEBLOCK_END

    Enter fullscreen mode

    Exit fullscreen mode

- 相对路径（.、../plugin）锚定到命令行所在目录。

- 包依赖里声明了 "dsh": { "bundle": ... } 的，自动进入该 profile 的 bundle 层。

- Git 托管的插件用 prepare 脚本构建；pnpm ≥10 需要在 profile 的 pnpm-workspace.yaml 里允许构建（按报错提示复制 allowBuilds key）。

  6. 实战一：模型可见的工具插件

插件最常见的用途是给模型加工具。工具注册在 ctx.tools 上，schema 会自动进入 prompt 组装，模型就能"看到"它。

下面是一个完整可运行的最小工具（省略 import）：

CODEBLOCK_BEGIN
import { readFile } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'demo-tool'
export const inject = ['tools']

export function apply(ctx: Context) {
  ctx.tools.register(defineTool({
    name: 'read_file',
    description: 'Read a file from disk.',       // 模型看到的能力描述
    parameters: {
      path: { type: 'string', required: true, description: 'Absolute path' },
      limit: { type: 'number' },                  // 可选项，默认不要求提供
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args, exec) {
      // args 已经被 defineTool 按 schema 校验并推导了类型
      return readFile(args.path, { encoding: 'utf8', signal: exec.signal })
    },
  }))
}

CODEBLOCK_END

    Enter fullscreen mode

    Exit fullscreen mode

execute() 契约的几条硬规则（完整版见 docs/cookbook/adding-a-tool.md）：

-
args 自动校验：defineTool 会在 execute 前校验模型生成的参数，execute 里拿到的 args 类型和 schema 一致。

-
只返回一个规范 JSON 值：output.schema 定义返回值；execute 只返回这个值。抛异常 = isError；成功的领域结果（如非零退出码）也要放进规范值返回。

-
遵守 exec.signal：信号触发时要取消进行中的工作。

-
只注册一次：注册借用的是只有读权限的 definition，不要事后改 schema；想换工具就释放它所属的 effect 再注册。

-
UI 卡片是独立设计：模型看到的内容由 output.render 决定；UI 卡片由 presentCall / presentResult 返回 generic / terminal / diff 渲染意图。

  6.1 后台长任务

需要 run_in_background 且由部署配置开关（不能写死在代码里）的工具，通过 ctx.jobs.start() 注册为后台任务更合理，模型侧返回带 jobId 的规范句柄，job_output / job_kill 负责收集与停止。见 adding-a-tool.md 的 Long-running work。

  6.2 工具如何渲染成 UI

选中 card 标签的渲染意图，按类型给卡片：

-
{ card: 'generic', title, locations? } —— 通用卡片；locations: [{ path, line? }] 让编辑器跳转工具碰过的文件。

-
{ card: 'terminal', title, cwd? } —— 你的调用就是 shell 命令（参考 dsh-tool-bash）。

-
{ card: 'diff', title, diffs } —— 创建/修改文件，内联 diff 卡片（参考 dsh-tool-fs 的 write/edit）。

  7. 实战二：拦截事件的钩子插件

不需要新工具，只想在某个环节插一脚时，用事件监听器。主循环通过事件驱动，钩子插件就是在这些事件上挂监听器。

  7.1 一个权限门示例

下面的插件在 tools/pre-execute 上拦截每一次工具调用，按规则允许或拒绝：

CODEBLOCK_BEGIN
import type { Context } from '@deepseek-ai/cordis'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'

declare function isAllowed(exec: ToolExecution): Promise<boolean>

export const name = 'permission-gate'

export function apply(ctx: Context) {
  ctx.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> => {
    if (!(await isAllowed(exec))) {
      return { kind: 'deny', reason: 'Denied by policy.' }
    }
    return next()
  })
}

CODEBLOCK_END

    Enter fullscreen mode

    Exit fullscreen mode

tools/pre-execute 是 waterfall 事件：监听器收到 (...args, next)，调用 next() 把结果传给下一个监听器；不调 next() 直接 return 就是短路（截断整条链）。这是 Cordis waterfall 的核心语义，写监听器时最容易踩的坑就是忘了 next()。

  7.2 挑选正确的扩展点

你要做的
用哪个

允许 / 拒绝 / 询问工具调用

tools/pre-execute，返回 {kind:'deny'} / {kind:'ask'}

工具调用必须被最终否决、不可被撤销
ctx.tools.guard()

包裹工具执行生命周期（超时/重试/指标）

tools/execute（只有 exec.signal 可替换）

显式改写工具结果或呈现内容
tools/post-execute

只观察不可变最终结果（审计/捕获）
tools/result

改写模型请求配置

agent/request（waterfall，返回替换后的 LlmCallConfig）

改写/拒绝进入 step 的消息

agent/pre-step（waterfall，返回 PreStepDecision）

收尾 turn / 强制再走一步

agent/turn-stopping（serial，无 next()）

监听最终不可变输出（工具结果、状态、error）
对应 emit 事件 + session/event 上的 durable 会话事件

事件的生产者 / 消费者完整清单见 docs/event-producer-consumer.md。

  7.3 durable 事件和 live 事件的分工

-
durable 会话事件（turn/*、step/*、user/message、assistant/*、tool/*）追加进会话日志，重启后仍可重建。模型能看到的任何东西都必须能从这个日志重建（模型可见 ⟺ 已记录）。

-
live 事件（agent/*、tools/*）只做运行期协调：queue/status、拦截、请求构造、steering。

要给模型加新的可见输入，就遵从这条规则：往扩展 SessionEventMap 里加一种新事件类型，从日志渲染，而不是绕过日志。

  8. 声明式配置（Config）

部署期可调的选择不能写死在插件里，而是做成 Config 字段，从 cordis.yml 修改。

  8.1 定义 schema

用 @deepseek-ai/schemastery（它也是 Cordis 的校验器），类型和运行时校验合一：

CODEBLOCK_BEGIN
import z from '@deepseek-ai/schemastery'

export interface Config {
  allowParallelInProgress: boolean
}

export const Config: z<Config> = z.object({
  allowParallelInProgress: z.boolean().required(),
})

CODEBLOCK_END

    Enter fullscreen mode

    Exit fullscreen mode

  8.2 在 cordis.yml 里装配

CODEBLOCK_BEGIN
- id: todo
  name: '@deepseek-ai/dsh-tool-todo'
  config:
    allowParallelInProgress: true

CODEBLOCK_END

    Enter fullscreen mode

    Exit fullscreen mode

  8.3 配置只是 metadata，条件组合用 overlay

- cordis.yml 的 !!js 只允许出现在插件 config 和条目 disabled 下；其他 metadata 保持字面量（loader 语义）。

- 按环境选插件用 overlay，不要用 !js。

CODEBLOCK_BEGIN
# patch 里按环境取值是合法用法
- id: sandbox-policy
  name: '@deepseek-ai/dsh-sandbox-policy'
  config:
    mode: !!js "process.env.DSH_PERMISSION_MODE ?? 'workspace-write'"

CODEBLOCK_END

    Enter fullscreen mode

    Exit fullscreen mode

  9. 能力缝：Service Definition / Provider / Consumer

当一个能力需要"可替换"时，dsh 用的不是一个类，而是缝（seam）：三个角色。

角色
职责
例子

Service Definition
声明接口（服务 + 事件词汇），挂在 ctx.<key>

dsh-subagent 提供 ctx.subagents 和一次调用词汇

Service Provider
实现这个接口

dsh-subagent-spawn-in-process、-fork、-acp、-codex…

Consumer
消费它，通常是模型可用的工具

dsh-tool-subagent 把配置好的 provider 暴露给模型

换一个 Provider 就整体改变产品行为：文件系统和子进程 Provider 共享同一执行世界，把 ctx.shell 指向远程沙箱，bash / PTY / LSP 一起跟着换，不用派生 Provider（见 docs/architecture.md 的 Capability seams）。

一个角色不算缝。要新增能力，就设计全部三个角色——即使开始时 Provider 只有一个。经典模板是 shell 三件套，代码在 packages/shell/。

  10. 仓库内开发一个正式包

如果你的插件要成为 @deepseek-ai/dsh-<name> 的一部分，按 checklist 建包。完整文件级清单见 docs/cookbook/adding-a-package.md，这里说核心：

CODEBLOCK_BEGIN
packages/<group>/<pkg>/
  package.json     # private: true；version 与根 package.json 一致；type: module
                   # main/types/exports 指向 lib/；@deepseek-ai/cordis 在 peer+dev deps
  tsconfig.json    # extends ../../../tsconfig.base.json；references 指向依赖的 workspace 包
  src/index.ts     # 函数插件命名导出 name/inject/Config/apply；服务类默认导出类
  README.md        # 服务 API、事件、扩展点、Model Experience 段

CODEBLOCK_END

    Enter fullscreen mode

    Exit fullscreen mode

流程：

-
选组：core、llm、shell、fs、web 等已有组匹配能力角色就放进组的 packages/<group>/<pkg>。

-
注册：tsconfig.host.json / tsconfig.client.json 的 references 加一行；新组才动 tsconfig.base.json。

-
命名：接口包命名能力（dsh-subagent），实现包加机制（-in-process、-fork）。ctx key 单数表示一个引擎，复数表示注册表。

-
验证：跑下面的质量门。

  11. 测试与质量门

  11.1 本地必跑

新增/修改包后，逐级往上跑（尽量只跑影响的，CI 才全量；详见 docs/testing.md）：

CODEBLOCK_BEGIN
pnpm run constraints   # workspace 约束
pnpm run typecheck
pnpm run lint
pnpm run build
pnpm run hygiene       # knip + publint + NodeNext 消费检查
pnpm run doc-sync      # 文档门
pnpm run test          # 单元测试

CODEBLOCK_END

    Enter fullscreen mode

    Exit fullscreen mode

  11.2 测试方针

-
行为测试描述行为，不计正确性；改行为要改测试并说明原因。

- 每文件 100% 覆盖率是 CI 门槛（pnpm run test:coverage）。

- 产品可见的插件要有一个真实组合测试：通过 Loader 和 app/process 启动 cordis.yml，而不是只用手搭的 ctx.plugin(...) 单测。

- 每个非平凡、模型可见 / 产品用户可见的行为变化，都要在同一个 PR 里补一个可回放的 keyless 快照（pnpm run test:snapshot）。

- 注册可逆性用 HMR 安全测试验证：释放 fiber 后注册消失。

  11.3 文档义务

- 每个非平凡改动带一篇 Agent Note（.agents/notes/）。

- 改行为（config key、默认值、错误码、wire 字段）要和 README / JSDoc 同 commit 更新。

- 包 README 要按规范写 Model Experience 段和 Known Limitations 段。

  12. 常见问题排查

现象
原因 / 处理

插件没生效
先查 name 拼写：模块解析失败只记日志不崩溃，且启动早期可能丢失。再 --dump-config 确认真实组合树里有没有它

apply 抛异常
插件加载失败会明确终止进程，是设计如此，不会静默跳过

新配置项没效果
patch 按 id 替换整个 config，不是深合并；检查是否覆盖丢了其他字段

!!js 报错

!!js 只允许在插件 config 和条目 disabled 下，别处要用 overlay

模型看不到我的工具
工具 schema 自动进 prompt，但 scope（预设隔离）或 restrict() 可能把它滤掉了

忘记 next()

waterfall 监听器不调 next() 会短路整条链；要放行必须调用

HMR 热重载后残留
注册必须是 ctx.effect() / ctx.on() 系，apply 里裸干的事不会被回滚

dsh plugin add 构建失败
pnpm ≥10 需要在 profile 的 pnpm-workspace.yaml 允许 allowBuilds

  延伸阅读

-
Cordis 入门：五个想法 + dispatch 模式

-
Cordis 教程 7 章：逐章吃透生命周期、服务、事件、配置、HMR

-
扩展 cookbook：工具 / 钩子 / UI / 协议驱动的参考片段 + 功能→机制映射表

-
添加一个工具：execute() 契约与 UI 渲染的完整参考

-
添加一个包：仓库内正式包文件级 checklist

- 测试方针

-
可运行 leaf 示例：examples/headless-agent/、examples/acp-agent/

- 完整插件实例：通达信市场数据插件（一个真实的 5 工具行情插件，含客户端移植、离线单测与挂载文档）

-
本项目使用教程：安装、配置、日常使用与插件管理的用户侧视角

          Top comments (0)

          Subscribe

        Personal
        Trusted User

        Create template

      Templates let you quickly answer FAQs or store snippets for re-use.

      Submit
      Preview
      Dismiss

  Code of Conduct
  •
  Report abuse

        Are you sure you want to hide this comment? It will become hidden in your post, but will still be visible via the comment's permalink.

        Hide child comments as well

          Confirm

  For further actions, you may consider blocking this person and/or reporting abuse

      Henry Lin

  Follow

-

          Joined

          Aug 20, 2025

            More from Henry Lin

              # RD-Agent Tutorial - Chapter 2: Core Functions

                  #agents
                  #cli
                  #python
                  #tutorial

              NautilusTrader Chapter 4: Data Import and Processing

                  #data
                  #dataengineering
                  #python
                  #tutorial

              NautilusTrader 第4章：数据导入与处理

                  #dataengineering
                  #programming
                  #python
                  #tutorial

      DEV Community — A space to discuss and keep up software development and manage your software career

-

      Home

-

      DEV Challenges

-

      DEV++

-

      Videos

-

      DEV Education Tracks

-

      DEV Help

-

      Advertise on DEV

-

      Organization Accounts

-

      DEV Showcase

-

      About

-

      Contact

-

      Free Postgres Database

-

      DEV Shop

-

      MLH

-

      Code of Conduct

-

      Privacy Policy

-

      Terms of Use

      Built on Forem — the open source software that powers DEV and other inclusive communities.

      Made with love and Ruby on Rails. DEV Community © 2016 - 2026.

          We're a place where coders share, stay up-to-date and grow their careers.

        Log in

        Create account
