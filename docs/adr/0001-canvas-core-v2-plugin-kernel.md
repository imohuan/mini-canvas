# ADR-0001：canvas-core-v2 采用自研 Cordis 风格插件化内核

日期：2026-09-04 · 状态：**已接受** · 分支：feat/cordis-plugin-system

## 背景

现有 `packages/canvas-core/src`（180 文件）逻辑混乱、保存难受、`Canvas.vue` 是 741 行上帝组件。用户决定在**新项目 `packages/canvas-core-v2`** 整体重构，采用 Cordis 概念自建插件内核。

## 决策

1. **不用现成 Cordis 库**，自研一个"Cordis 风格"轻内核。理由：`@cordisjs/*` 官方自述 API 未稳定、文档在建、无 Vue/pinia/UI 绑定；本仓库要全权可控。
2. **不是推倒重写**：v1 的硬资产（Kahn 拓扑/状态机/回滚、EventBus handler 表、AssetStore + 内容寻址、ConnectionValidator 严格连接校验、各插件 API）**吸收**；只重写坏的（上帝组件、全局单例、字符串事件、手写卸载、一键一锅端持久化）。
3. **三个核心增量**（v1 缺的，是 v2 与 v1 分水岭）：
   - **作用域自动回收（Scope.dispose）**：插件卸载零泄漏，免手写 uninstall。
   - **服务注入 ctx.inject/get**：插件互调取代 getPluginAPI/字符串事件；缺服务抛错，禁静默降级。
   - **类型化事件 CanvasEventMap + 单源 emit**：删 window.dispatchEvent 副作用、删重复 emit。
4. **统一持久化 ctx.save.set(key,value,type)**，type 四类 config/canvas/resource/shortcut；本地默认/云端可插拔 adapter，改即入队+可靠 flush，禁卸载才存/手动才存/同数据写多处。
5. **节点 type 直接用业务类型**（废弃全 `custom` + data.nodeType），节点 id 用短数字累加（全局 `createNodeId()`）。
6. **废弃 selfRender 两路径**，统一单一 NodeRenderer + `node:{type}:*` 命名插槽。

API 契约全文见 `docs/plan/canvas-core-v2-api.md`。

## 后果

- 正向：画布核心逻辑收敛成可独立测试的内核；插件作者 setup(ctx) 一段式、零 uninstall；持久化单一入口。
- 成本：需新造 Scope 回收/注入/类型化总线；迁移期要逐步把 v1 插件挪进新壳（本任务只做最小内核 + 最小 text demo，其余另开任务）。
- 风险：Cordis 是自研，无社区背书——靠单测 + 行为契约 + 最小 demo 验证兜底。

## 行动项
1. M1 内核（Scope/Context/拓扑）纯 Node 可测。
2. M4 最小 text demo 当 tracer bullet，点亮"插件注册→UI 槽→持久化"全链。
3. v1 严格连接校验（useCanvasConnection/ConnectionValidator）作为行为契约保留吸收，**不许改坏**。
