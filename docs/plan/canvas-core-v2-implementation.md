# canvas-core-v2 内核实现方案（五路审计整合 · 待审批动工）

日期：2026-09-04 · 分支：feat/cordis-plugin-system · 状态：**待审批**
依据：5 路子代理深审（audit-kernel / audit-storage / audit-tools / audit-image-video / audit-simple-nodes）+ 架构文档 `canvas-core-v2-architecture.md`。
**用户已定调：先做能跑的最小 Demo；其余（旧节点全量迁移 / 云同步 / 多 view）另开任务，本任务不做。**

---

## 〇、先说结论（"怎么组合"的一句话答案）

**v1 不是没有好东西，是好东西被"上帝组件 + 全局单例 + 字符串事件 + 手写卸载"焊死在了一起。v2 不是重写，是把 v1 的硬资产（Kahn 拓扑/状态机/回滚、EventBus 表、AssetStore、各插件 API）抽出来，套上一个 Cordis 式的"作用域自动回收"壳 + 类型化注入/事件，再把 Canvas.vue 拆薄。**

最该记住的三条：
1. **作用域回收是 v2 与 v1 的分水岭，从零造**（v1 全靠插件手写 uninstall + 逐个 off，必漏）。
2. **v1 有死代码，别搬**：`PluginInstaller/PluginRegistry/PluginDependencyGraph`（第二套插件系统）、`MenuRegistry.resolveMenuItems`（第二份菜单解析器）、`registerComponent`（断头 API）、`useCanvasFlow` 的 nodeTypes、DialogRegistry（未接线）——全删。
3. **三个硬 bug 必须修**：EventBus.emit 每次往 window 抛 DOM 事件、PluginManager 私有 emit 无人收到（'plugins:ready' 死事件）、connect 事件被发两次。

---

## 一、内核实装方案（怎么把 v1 优雅组合）

### 1.1 直接搬进 v2 的硬资产（几乎零改）
| 资产 | 来源 | 处理 |
|---|---|---|
| Kahn 拓扑 + 循环/自依赖/缺失检测 + 可读环路径 | PluginManager.resolveOrder/buildCyclePath | 提成纯函数 `topoSort()` + 单测 |
| 生命周期状态机转换表 | PluginManager.setLifecycle | 保留；**裁掉从无调用路径的 deactivate/inactive 三态** |
| EventBus 的 on/off/emit handler 表结构 | PluginContext:58 | **删掉 emit 里 `window.dispatchEvent`** |
| 卸载前"有依赖方则拒卸"守卫 | PluginManager:182 | 保留 |
| 事件名常量 | CanvasConnectionEvents/CanvasGroupEvents | 并入类型化 EventMap |
| AssetStore 接口 + 三实现 | storage/adapters | **原样吸收为 Save 层 resource**（v1 最干净资产） |
| AssetManager 内容寻址(SHA-256)+去重+URL 重建 | storage/adapters/AssetManager | 继承思路 |

### 1.2 删掉（历史债务，别带进 v2）
- `PluginInstaller.ts` / `PluginRegistry.ts` / `PluginDependencyGraph.ts`（死三件套，第二套插件系统）
- `MenuRegistry.resolveMenuItems`（第二份菜单解析器，零调用）
- ctx `registerComponent`（断头 API，no-op）、`registerEdgeType`（冷门）
- `getPlugin`（已 deprecated）→ 只留 `ctx.get<Service>()`
- `useCanvasFlow.ts` 的 nodeTypes / `registerCustomNodeType` 双 authority
- `DialogRegistry`（未接线，v2 激活为 dialog-slot 或删）
- git 已跟踪的 `ImageBottomToolbar 备份.vue`、`crop-test.html`

### 1.3 重写为 Cordis 式内核（核心增量 = scope 自动回收）
把 v1 的"install/uninstall/activate/deactivate 四段 + createPluginContext 面条工厂"收敛成**一段 `setup(ctx)`**。

```ts
// —— ctx API 定稿（无 Vue 依赖 or 薄依赖，可纯 Node 单测）——
interface Context {
  plugin<T>(mod: { name: string; deps?: string[]; setup(ctx: PluginScope): void }, config?: T): this
  start(): void | Promise<void>   // 激活全部已 plugin 的（一次通知）
  stop(): void                    // 逆序 dispose 全部 scope

  inject<Service>(name: string, impl: Service): () => void  // 服务上架，返回撤销
  get<Service>(name: string): Service | null                // 服务取货（插件互调，取代 getPluginAPI）

  on<K extends keyof EventMap>(name: K, h: (p: EventMap[K]) => void): Disposable
  emit<K extends keyof EventMap>(name: K, payload: EventMap[K]): void
}
// PluginScope = 根 Context 的可回收子视图，暴露 on/emit/get/inject/effect/save
```

**作用域回收实现（内核第一验收项）**：
```ts
class Scope {
  private disposables: Array<() => void> = []
  onDispose(fn: () => void) { this.disposables.push(fn); return () => { /* 摘除 */ } }
  dispose() { for (const fn of this.disposables.reverse()) try { fn() } catch {}; this.disposables = [] }
}
```
每个副作用方法落当前 Scope：`ctx.on` → `scope.onDispose(() => bus.off(...))`；`ctx.effect(fn)` 统一包 timer/store.watch/DOM 监听/快捷键；`ctx.inject` 撤销挂 scope。**插件不写 uninstall 也零泄漏**。

**类型化事件**：全局 `CanvasEventMap`（事件名→payload 类型），插件 `declare module` 扩展。事件单源 emit、不碰 window。

### 1.4 Canvas.vue 拆薄（741→<100 行宿主）
采纳 v1 未接线的 `usePluginSystem/useCanvasFlow/useCanvasPanelState` 思路：
- 宿主 = 建内核 + 把 vueflow/pinia/dom 当 service `inject` 进去 + 逐个 `plugin()` + 提供根 `<slot>`
- 事件适配器声明式自动转发，不再模板逐条手写
- `ShortcutManager`/store 从全局单例改为**每画布 Context 一份**，随 start/stop 创建销毁

---

## 二、各插件/节点在 v2 的归位（怎么组合）

### 2.1 交互工具插件 —— 4 类
| 类 | 插件 | v2 归位 |
|---|---|---|
| **内核级能力**（收进 ctx 服务） | history、multi-select、group、clipboard、context-menu、file-drop | 服务化 + `ctx.get` 互调 + 命名插槽，**补统一删除命令、变更即历史** |
| **单用途工具**（服务化） | align-arrange、align-guide、auto-layout、custom-handle | arrange/alignGuide/layout 服务 + 命令，auto-layout 用 `ctx.get('group')` |
| **演示/旁路 UI**（收进 overlay 槽或降 demo） | mini-map、node-find、canvas-export、edge-cutting | overlay/minimap + 命令入口，先定定位 |
| **要优先重构再进** | context-menu、group、multi-select | 菜单解析唯一化、去掉裸 DOM capture 与 createApp、group 假依赖修正 |

**共享服务收编**（消除重复）：
- 统一菜单 resolver（删死的那份）
- 节点创建工厂 `createNodeAt(type,pos)`（吸收 ContextMenu/FileDrop 两份）
- 统一鼠标坐标 `ctx.mouse`（吸收 clipboard/file-drop/context-menu 三份）
- 统一删除命令 `command:delete`（吸收 history/context-menu/multi-select 三条）
- 变更即历史（内核层，替代各插件手写 history:record）
- 组框计算（group.recalculateBounds 与 auto-layout.groupBounds 合并）
- 节点尺寸/绝对坐标工具服务（替代 5+ 处各自猜尺寸）

### 2.2 节点 —— selfRender 是假概念，废弃
v1 的"组装/自渲染"两路径是**能力不平等的墙**（selfRender 节点能直达 BaseNode 插槽，普通节点只能进 #content）。v2 **废弃 selfRender**，统一单一 `NodeRenderer`：
- 内核永远渲染 `<BaseNode>` 壳
- 各段来自 `node:{type}:content/title/top-toolbar/bottom-toolbar` slot + `toolbar:{position}` provider
- 连接约束从插件手写 connect 监听 → 声明式 `inputs/outputs/onExcessInput` schema
- 节点组件 window 事件（nodeDoubleClick/panorama:fullscreen）→ ctx.on/emit

**M4 载体 = 最简 text**（去掉 6 个 noop stub 按钮、编辑写回 data）。image/video/panorama/image-compare 迁移**全部留到另开的任务**。

---

## 三、本任务范围（严格对齐"先最小 Demo"）

### M1 —— 内核（纯 Node，vitest 可测）
- `Scope` 作用域回收（第一验收项）
- `Context` 类：plugin/start/stop/inject/get/on/emit + 类型化 CanvasEventMap + 单源事件（不碰 window）
- 吸收 `topoSort`（Kahn+环检测）、生命周期状态机（裁三态）、失败回滚
- 删除死三件套确认不引入
- 单测：scope.dispose 零泄漏 / 拓扑环报错 / 依赖拒卸 / 事件类型化

### M2 —— Save 层最小闭环（type=config 起步）
- `ctx.save.set/get/remove(key,value,type)` + flush
- 本地 adapter（localStorage 分键，不再一锅端）+ 字段级防抖
- type 枚举 `config|canvas|resource|shortcut`（M2 先落 config；canvas/resource/shortcut adapter 留架构，接口先定义）

### M3 —— Registry + NodeRenderer + 命名插槽（node:{type}:* 最小集）
- NodeRegistry 改 reactive(Map)、节点 schema（去掉 topToolbar/bottomToolbar/titleIcon/selfRender 条件字段）
- 单一 `NodeRenderer.vue`（永远包 BaseNode 壳）+ content/title/top-toolbar/bottom-toolbar slot

### M4 —— 最小 Demo（可跑闭环 = 用户验收）
- 最简 **text 节点**（显示 + 双击编辑 + `ctx.updateData` 写回 data，**无 stub 工具栏**）
- 一个最简宿主：建内核 → 装 text 插件 + 内核服务 → 画布渲染 → 编辑 → `save(key,value,'config')` → 刷新恢复
- **验收标准**：新建 → 双击改文本 → 刷新后文本还在、配置还在

> image/video/panorama/image-compare、context-menu/group/multi-select 深度重构、云同步、多 view、旧包迁移 —— **全部不在本任务**，落盘为后续任务票据即可。

---

## 四、我建议开工的第一刀（等你点头）

M1 内核是最纯粹、最能验证"Cordis 化"价值、又不碰任何迁移包袱的一步。**先写 M1 + M4 最小 text demo**（用 demo 反推内核 API 是否顺手），一旦闭环通了，再回头看要不要按 M2/M3 顺序补齐。

请你批：
1. **同意先写 M1 内核 + M4 最小 text demo**（用 demo 反推内核，而不是空写内核），M2/M3 随后？
2. 还是**严格 M1→M2→M3→M4 顺序**？

其余（迁移、云、image/video、深度重构）确认另开任务，我不动。

---
说人话：五路审计全齐，v1 的好东西和烂东西都摸清了。方案一句话：把 v1 的拓扑/状态机/AssetStore 抽出来，套一个"卸载自动清干净"的 Cordis 壳，Canvas.vue 拆薄，selfRender 废弃、节点统一走命名插槽。本任务只做"能跑的内核 + 最简 text demo"，其它另开。你点个头我就从内核开写。
