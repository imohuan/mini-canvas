# canvas-core-v2 架构设计 —— 骨架草稿（待子代理侦察补全后修订）

日期：2026-09-04 · 分支：feat/cordis-plugin-system · 状态：草稿整合中（3 路子代理侦察 host/ui-slots/persist 进行中）

## 一、定位
`canvas-core-v2`：一个 **Cordis 风格的画布引擎内核**，把 v1 里乱耦合的"插件生命周期 + registry + 保存 + pinia + UI 挂载"收敛成清晰分层，全权可控、不背不稳定外部依赖。

## 二、分层设想（由内到外）
1. **Core（内核，无 Vue 依赖 or 薄依赖）**：Cordis 概念最小实现
   - `Context`：根上下文，`ctx.plugin(plugin, config)`、`ctx.start/stop`、`ctx.on/emit`（事件）、`ctx.registry`（插件作用域表）。
   - **服务/注入**：`ctx.inject<Service>(name, impl)` / `ctx.get(name)`（等价 Cordis service），实现"插件相互依赖、可调用别的插件导出函数"。
   - **作用域与副作用回收**：每个插件一个 scope，卸载时自动 dispose 其注册的 on/注入/timer/监听。
   - `disposable` / `effect` 生命周期。
2. **State（响应式状态层，接 pinia）**
   - pinia 统一管理：全局 store + 每插件命名空间 store（类似现 useCanvasStore.state.plugins[plugin]）。
   - 状态分两类：**运行时响应式 state**（存 pinia）与 **可持久化 key-value**（经 Save 层）。
3. **Save（统一 key-value 持久化层）** —— 用户核心诉求
   - `ctx.save.set(key, value, type?)` / `ctx.save.get(key, type?)` / `ctx.save.remove`。
   - type 内置：`config | canvas | resource | shortcut`（可扩展）。
   - 后端/本地可插拔 **存储后端(adapter)**：默认本地(localStorage/IndexedDB)、云端(BackendSync/REST) —— 对应"默认保存插件 vs 云端同步插件各管一套、互不干扰"。
   - pinia 负责响应式镜像，save 负责落盘；两者经一个绑定(hydrate + 变更订阅)打通。
4. **Registry + UI Slots（注册表 + 插槽渲染层）**
   - 命令/节点/工具栏/菜单/面板/对话框/浮层注册表 → 统一成"注册到命名插槽"，UI 由 **SlotRenderer** 按插槽渲染。
   - 用户提供插槽位：设置界面、画布内等（具体插槽名见 ui-slots 侦察后定稿）。
5. **Host 适配（Canvas.vue → 轻量宿主）**
   - v1 Canvas.vue 是上帝组件；v2 拆成：宿主只负责"建内核 + 提供根插槽容器"，其余全走插件/注册。

## 三、关键统一
- 快捷键：从"内存单例 + 卸载才写回" → 注册到 ctx（`ctx.on 快捷键` / 插件注册 shortcut），经 Save(type=shortcut) 改即持久化。
- 保存：四类（config/canvas/resource/shortcut）全部走 `ctx.save` 一个入口。

## 四、待子代理回来补
- host-runtime.md → 确定 v1 Canvas/composables 里哪些耦合点转成 v2 的 可注册/注入/slot。
- ui-slots.md → 确定插槽名集合与 slot 渲染机制。
- persist-inventory.md → 确定 save(key,value,type) 的 key 命名规则、四类字段清单、后端按 type 分发设计。
