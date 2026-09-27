# 插件上下文与包边界执行计划

日期：2026-09-27  
状态：**T01–T10 全部落地**（每项独立提交 + 单测/浏览器验证）
规格：[canvas-plugin-context-and-boundaries-spec.md](../goal/canvas-plugin-context-and-boundaries-spec.md)  
审查：[canvas-base-data-render-theme-audit-2026-09-26.md](../tmp/canvas-base-data-render-theme-audit-2026-09-26.md)  
作者目标形态：[plugin-author-final-shape-pseudocode-2026-09-27.md](../tmp/plugin-author-final-shape-pseudocode-2026-09-27.md)

## 目的

把插件入口收成可依赖、可验证、可分批迁移的作者契约；修复重复事实源；让主题组件通过稳定渲染接口工作；减少业务插件对默认主题和第三方渲染细节的直接依赖。

本计划不是重做插件系统。通用 Registry、ctx.registryOf、画布能力段、节点区域、UI 目录、needs 能力包、ctx.surface 和命令快捷键已经存在，后续任务必须在这些机制上收敛。

## 开工前检查

每个执行者开始任务时先：

1. 读取 AGENTS.md 和 docs/STATUS.md，确认当前主线、红线和验证命令。
2. 查看 git status；保留已有未提交改动，不清理或覆盖用户文件。
3. 读取规格、架构审查和本计划中对应任务。
4. 在改源码前，为用户可见行为先写失败测试；修复后运行被影响包的 test、typecheck，Vue 文件还要跑 vue-tsc。
5. 每个任务独立提交并可独立回退；需要跨包临时不绿时，必须在任务说明中列出 integration gate。

禁止触碰根目录 src/ 与 packages/canvas-core v1。移动节点端口几何前，先完成端口值决策任务和现有核心节点契约检查。

## 现状基线：已完成与待做

| 项目 | 当前状态 | 本计划处理方式 |
|---|---|---|
| kernel Registry、registryOf、state、插件能力段 | 已实现 | 直接复用，不重做 |
| nodes/theme/commands/slots/settings 注册糖 | 已有 | 统一底层事实源与撤销语义 |
| 十个节点区域词、nodes.attach、能力袋 | 已有 | 不新增第二套区域或能力机制 |
| UI 目录、能力包每节点缓存、热换 | 已有 | 复用并补类型/消费端契约 |
| ctx.surface 自省 | 已有 | 补现有字段，不另建 introspection API |
| canvasBasePlugin 与 doc 门面 | 已完成 | 不重复搬迁；评估新的包归属前保留兼容出口 |
| theme-default 到部分节点插件的循环依赖 | 已断开 | 新任务只处理仍存在的业务插件反向依赖 |
| defineNode 字段透传 | 有已核实缺陷 | 单独修复和测试 |
| theme 与 node/region 双写及 order/回收 | 有已核实缺陷 | 第一批修复，之后才迁移消费者 |
| canvas-base 服务类型集中声明 | kernel 已有 Services 和 tryGet，但内置画布服务映射未集中 | 扩展兼容类型入口，分批迁移消费者 |
| VueFlow/render facade 就绪状态 | 未完成 | 先定义 ready 生命周期，再迁移主题组件 |
| theme-default 被业务插件当共享组件库 | 未收敛 | 用主题无关的组件目录契约分批迁移 |
| canvas-foundation 是否值得独立成包 | 未决 | 先做边界证明/决策，不先创建空壳包 |
| 端口几何默认 86 与 10 的差异 | 未决且属行为变化 | 由负责人先选值，选择前不改几何 |

## 推荐主线与阻塞关系

    T01 注册事实源与回收正确性 ─────────────┐
    T02 作者 SDK 字段与类型出口 → T03 类型化服务表
                                  └─→ T04 Flow facade 就绪契约
    T01 + T03 + T04 ───────────────→ T05 theme-default 迁移
                                          ├─→ T06 multi-select 迁移
                                          └─→ T07 image/text/video 依赖迁移
                                                    └─→ T08 依赖守卫与整装验证

    T02 + T03 ──→ T09 canvas-foundation go/no-go（可并行评估）

    T10 端口默认值负责人决策 → 独立几何实施/浏览器验证（不阻塞 T01-T09）

T06 与 T07 在 T05 完成后可并行。T07 虽合并三个相同类型的包级依赖迁移，但每个包必须分别完成测试/类型检查/适用的构建，失败可以按包单独定位与回退。T09 是架构决策结果，不得阻塞已基于现有包可完成的上下文迁移；只有明确 go 后才另开 foundation 实现 tickets。

## 任务清单

详细 ticket 位于 .scratch/canvas-plugin-context-boundaries/issues/，按依赖顺序编号。

| ID | 标题 | 阻塞项 | 状态（提交号） |
|---|---|---|---|
| T01 | 统一主题与节点区域注册事实源 | 无 | ✅ c50b108 |
| T02 | 修正作者 SDK 节点字段透传与包内类型入口 | 无 | ✅ e129d76 |
| T03 | 为作者上下文建立集中服务类型 | T02 | ✅ 2bbe6bc |
| T04 | 为 VueFlow 能力建立有就绪状态的渲染 facade | T03 | ✅ b88f4ad |
| T05 | 让默认主题通过渲染契约消费宿主能力 | T01、T03、T04 | ✅ d56c4de |
| T06 | 把多选组件从默认主题依赖迁到主题可替换目录 | T05 | ✅ 70bbb59 |
| T07 | 把 image/text/video 的共享 UI 依赖迁出默认主题 | T05 | ✅ 5cb5310 |
| T08 | 锁定插件依赖方向并运行整装回归 | T06、T07 | ✅ 28d6e1d |
| T09 | 评估 canvas-foundation 拆包的收益与兼容成本 | T02、T03 | ✅ 1a13f41 · **no-go** |
| T10 | 决定端口几何的唯一默认值 | 负责人输入 | ✅ 方案 A（10/0.55/0.8，已实施 + 浏览器验证） |

### 追加（2026-09-28，计划外收尾票）

| ID | 标题 | 阻塞项 | 状态（提交号） |
|---|---|---|---|
| T11 | 全量迁移到最新 API + 作者 SDK 类型收口 + 兼容面清理 | T01–T10 | ✅ f036634 / 4739928 / c4b9d0f / 5f571ae |

T11 不是原计划的一部分，是用户复核时提出的收尾要求（"所有插件改成最新 API，不要兼容代码"）。
它修掉 0786bd4 迁移留下的回归，并把 T03 的"按服务名推导"补全到渲染服务（`nodeLayout`/`viewport`）——
此前那两条类型只在 canvas-render declare，只依赖 canvas-base 的纯逻辑插件推不出来。详见
`docs/STATUS.md` 的 2026-09-28 追加段。

## 任务说明

### T01 注册事实源与生命周期

修复 theme.register 对 ThemeRegistry 和 registryOf('theme') 双写造成的残留；修复 theme.add/remove 的写口不一致；修复 nodes.contribute 对显式 order 的处理分叉。先确定哪个注册场是唯一写入事实，再让旧注册表成为读取适配器或删除重复状态。必须保留既有 winner/order/热卸载行为。

完成时，真实插件注册并卸载后，场条目、兼容读取口和渲染选择完全一致；同 id 顶替后只剩当前所有者；dispose 幂等。

### T02 作者 SDK 字段与类型入口

让 defineNode 的声明字段与运行时转发一致，覆盖 icon、resizable、frameless、transparent、segments、inputs、outputs、create 等字段。移除 canvas-base 内部对自身 package name 的类型导入。增加一个只从 canvas-base 导入类型的编译 fixture。

不要因为 define* 缺少生产调用就删 API；先修正确性，再由 T03/T09 评估作者 SDK 范围。

### T03 类型化服务表

在作者 SDK 的一个权威位置扩展已有 Services 映射，让 get/tryGet 按服务名推导类型。可继续兼容第三方模块扩展；禁止每个插件为内置服务各写一份 cast 或重复声明。先覆盖 doc、selection、resources、command、nodeFactory、nodeLayout、viewport 等现有宿主服务，不改变运行时服务名。

迁移量控制在类型出口和 compile fixture；全插件改用新类型入口应按包另开后续 ticket，不在本任务一次性批量改。

### T04 Render facade 就绪状态

在稳定 render contract 中定义 Flow/DOM 能力的窄接口。实现必须明确未就绪行为：apply 阶段对象可被注入但 VueFlow/DOM 尚未连接；CanvasSurface mounted 后 VueFlow 操作可用；pane/renderer DOM 捕获后 DOM 查询能力才可用；host.stop 后能力销毁。不同能力可分阶段 ready，不把 DOM ready 强加给纯视口操作。

不能用 viewport 默认值、坐标原样回传或 no-op 掩盖未就绪。对外提供 ready 检查或统一 NotReady 错误。测试覆盖 apply 阶段、mounted 后和 stop 后三种调用时序。

### T05 默认主题消费 render contract

迁移 BaseNode、DefaultBackground、CustomEdge、MovingHandle 和设置组件当前直接使用的宿主能力到 typed render facade / 稳定 render contract。主题组件不再自行对 canvas-data、kernel 的运行时接口做宽泛 get/cast；render 层内部可以依赖 data/kernel。

theme-default 的 apply 只注册主题和目录项。测试区分插件装载依赖与组件渲染环境：apply 可在没有具体 Vue 实例时完成注册；挂到错误宿主时应有明确 fail-fast 结果。

### T06 多选共享组件迁移

让 multi-select 通过主题可替换的组件目录或同等级稳定 render contract 获取 MovingHandle 和 ConnectionLine。替换主题时组件可以来自新主题；未安装组件提供方时有定义好的降级或显式缺项行为。移除对 plugin-theme-default 的 runtime/package 依赖。

### T07 image/text/video 共享 UI 迁移

对 plugin-node-image、plugin-node-text、plugin-node-video 执行相同迁移。保持当前 useUiComponent 动态目录消费方式；清理对应包生产源码、测试、打包 external 和 package.json 中仍直指 theme-default 的依赖。测试经真实 UI 目录注册或独立 fixture 提供控件，不从默认主题包偷 import 实现。

每个子批次只改一个插件包及其对应构建配置，分别运行该插件的 test/typecheck/build；总票完成标准是三个包各自通过，避免跨包结果相互掩盖。

### T08 依赖守卫与整装验证

在现有插件依赖图测试基础上，添加正向规则：逻辑插件使用作者 SDK；组件插件仅 peer 必需 Vue/render contract；业务插件不得依赖 plugin-theme-default；canvas-base 不引入 Vue/VueFlow/具体 UI 第三方包。

跑受影响包回归、canvas-render/vue-tsc、packages/ui typecheck/build/e2e。浏览器用例必须证明同一业务插件在默认主题与替代主题下都能被装配并渲染。

### T09 canvas-foundation go/no-go

对 canvas-data 现存数据能力与画布语义作 import 分类，证明新包能移走哪些真实依赖、有哪些现有宿主会消费、兼容出口会保留多久。完成书面 go/no-go。

只有同时证明职责更清楚、无反向依赖、第二个 headless/render adapter 有真实消费收益、迁移不重复移动 doc/canvasBasePlugin，才开独立 foundation 实现任务。否则记录 no-go，留在现有分层收敛，不创建只换名的包。

### T10 端口几何负责人决策

决策材料列出现值、取值路径、对命中面积/端口外观/存量设置的影响。由项目负责人指定规范默认值并确认是否需迁移保存设置。该 ticket 只记录决策，不顺手实现几何；后续几何实现使用独立 ticket、行为测试和浏览器回归。

## 每个 ticket 的完成门槛

- 有覆盖外部行为的失败测试；行为缺陷的 ticket 必须先证明 RED，再做 GREEN。
- 当前任务涉及的包测试、typecheck 通过；涉及 .vue 时 vue-tsc 通过。
- 兼容入口仍工作，除非同一 ticket 明确完成迁移并提供删除理由。
- 包依赖无环，生成 bundle 不意外内嵌 Vue/VueFlow/内核副本。
- 变更足够局部，可单独回退；真实宿主集成任务有 UI e2e 或浏览器验证。
- 维护 STATUS 文档中实际已完成状态；不能只根据旧设计文档中的未勾项宣称未做。

## 现在能开的任务

全部四波与收尾均已完成（T01–T10）。T09 结论为 no-go，未产生 foundation 实现任务。

## 发布方式与待确认项

本仓库未找到 docs/agents/issue-tracker.md，也未配置本地 .scratch ticket 目录或可调用的 GitHub/Linear issue 工具。因此本计划和逐项 ticket 先作为本地文档草案，不会声称已经发布到远端 Tracker。

建议票据粒度为 10 项，其中 8 项为代码/验证切片、1 项包拆分 go/no-go、1 项需要负责人选定端口默认值。image/text/video 的迁移同形，合并一票但保留分包验证。用户确认粒度与阻塞边后，票据可以转为 ready-for-agent；foundation 和端口行为决定另设闸门，避免被误实现。
