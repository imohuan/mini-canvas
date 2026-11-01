# plugin-context-menu

## 一句话

右键菜单与拖线落地菜单。它按命令的 `areas` 聚合条目，方向正确；主要风险是连线菜单把“菜单”做成真节点 + 专属主题壳，以及浮层手动挂到 `body`、依赖若干 VueFlow DOM 类名。

## 清单

| 项 | 值 |
|---|---|
| 包名 `@mini-canvas/plugin-context-menu` | 插件名 `context-menu` |
| 身份 | builtin |
| 源码 / 测试 | 11 个生产源文件 / 6 个测试文件（全包 17 个文件） |
| 包依赖的其他插件 | 无 |
| 是否引用其他插件内部入口 | 否：没有 `@mini-canvas/plugin-*` import |

## 跨包 import

| 目标 | 入口 | 是否公开出口 | 证据 |
|---|---|---|---|
| canvas-base | `Context`、`ConfigSchema`、`PluginModule`、`registerEventName` | 是 | `src/contextMenuPlugin.ts:20`；`src/connectionMenu.ts:18` |
| canvas-data | `DocService`、`SelectionService`、`NodeFactoryService`、`typeConnectionDef`、`isTransient`、`validateConnection` | 是 | `src/contextMenuPlugin.ts:21-24`；`src/connectionMenu.ts:15-16` |
| canvas-render | `RenderEvents`、`nodeShellSlot`、`ConnectionDropPayload`、`Handle`/`Position` | 是（但 `ConnectionDropPayload` 是渲染层事件形状） | `src/contextMenuPlugin.ts:25`；`src/ConnectionMenuNode.vue:14-15` |
| kernel | `CommandService` 类型、`iconRenderMode` | 是 | `src/contextMenuPlugin.ts:22`；`src/menuEnrich.ts:11` |

## 运行时协作

| 依赖 | 方式 | 必需/可选 | 证据 |
|---|---|---|---|
| `doc` / `selection` / `nodeFactory` | `inject` 硬依赖 | 硬 | `src/contextMenuPlugin.ts:48,94-96` |
| `command` | 读 `list()`、执行 `execute()` | 硬（缺则菜单空/点击无效） | `src/contextMenuPlugin.ts:160,354-369` |
| `nodeLayout` | 判节点是否已量测 | 可选（缺则默认已就绪） | `src/contextMenuPlugin.ts:198-203` |
| `settings` | 读 `dragThreshold` | 可选 | `src/contextMenuPlugin.ts:205-209` |
| `RenderEvents.ContextMenuPane/Node/Edge` | 右键事件源 | 契约 | `src/contextMenuPlugin.ts:374-397` |
| `RenderEvents.ConnectionDropBlank` | 拖线落空白 | 契约 | `src/contextMenuPlugin.ts:379-381` |
| `ctx.nodes.register` + `ctx.theme.register(nodeShellSlot)` | 连线菜单“真节点 + 专属壳” | 契约，但把 UI 塞进节点模型 | `src/contextMenuPlugin.ts:101-110` |
| `CONNECTION_MENU_*` 事件 | 卡片 → 插件回传 | 自有 | `src/connectionMenu.ts:22-33`；`src/ConnectionMenuContent.vue:38-42` |
| 命令 `context-menu:delete-node/edge` | 菜单删除 | 自有 | `src/contextMenuPlugin.ts:114-138` |
| 命令 `command:create-node` | 新建节点 | 跨插件命令约定 | `src/contextMenuPlugin.ts:355-359` |

## 全局与宿主粘连

| 对象 | 用途 | 风险 | 证据 |
|---|---|---|---|
| `document.body` + `createApp` | 菜单浮层手动挂载 | 中：绕过画布子树，主题/上下文靠全局 CSS；需手动卸载 | `src/contextMenuPlugin.ts:402-433` |
| `.ctx-menu` / `[data-connection-menu]` | 点外关闭判定 | 低：类名限定在插件自身 | `src/contextMenuPlugin.ts:412-448` |
| `document pointerdown`、`window keydown/blur`、`document scroll` | 关闭菜单 | 中：全局捕获/冒泡监听，卸载需逐条解绑 | `src/contextMenuPlugin.ts:420-429,454-459` |
| `requestAnimationFrame` | 等节点量测的一帧 | 低：无 rAF 环境有回落 | `src/contextMenuPlugin.ts:215-225` |
| 固定节点类型名 `connection-menu` | 临时菜单节点 | 中：会进 nodeStore，靠 `transient` 隔离历史/落盘 | `src/connectionMenu.ts:21,77-84`；`src/contextMenuPlugin.ts:272-311` |
| 端口/边容量校验 | 走 `validateConnection` / `typeConnectionDef` | 契约 | `src/contextMenuPlugin.ts:254-261`；`src/connectionMenu.ts:224-228` |

## 内部职责与风险

1. **命令聚合是对的**：命令声明 `areas` 即可进菜单，不需要白名单；这是本插件最好的解耦点。
2. **连线菜单做成真节点**：好处是缩放/平移天然对齐、临时边和正式边同一条渲染链；代价是菜单进入节点数据模型，必须有 `transient` 过滤、专属主题壳、取消清理三套配套逻辑，任何一处漏掉都会污染存档/历史。
3. **硬依赖 `nodeFactory`**：列出可创建类型必须有 creator；没有节点插件的宿主里菜单为空，但插件本身仍能装载。
4. **手动 `createApp` 挂 body**：浮层不在 `CanvasHost` 子树内，拿不到渲染上下文，只能靠全局 CSS；主题变量依赖 `ui-theme.css`，换皮/Shadow DOM 下可能失效。
5. **两个菜单系统并存**：右键浮层是自绘 `ContextMenu.vue`，拖线菜单是节点壳；交互语义（点外关闭、Esc、滚动关闭）分别实现，容易出现两套行为不一致。
6. **量测判据未接上**：`isNodeMeasured` 在 `src/contextMenuPlugin.ts:198-203` 定义，但两处 `addEdgeWhenNodeReady` 都传 `isNodeReady: () => true`（`src/contextMenuPlugin.ts:297,334`）；注释与实现不一致，等量测这条设计没有真正落地。

## 单独装卸判断

- 不装：右键菜单退回浏览器默认；删除节点/连线命令仍可能被快捷键或其它插件调用。
- 不装节点插件：新建节点区为空，删除仍可用。
- 卸载：菜单 app、全局监听、节点类型、主题壳随作用域回收；临时节点若处于中间态，依赖 `ctx.effect` 清理。
- 多菜单同时打开：右键浮层与拖线菜单各自维护状态，未看到互斥清理的统一入口。

## 建议改法

1. **最小改动**：把 `isNodeMeasured` 真正接进 `addEdgeWhenNodeReady`，或删掉未用分支并改注释，减少“看起来处理了时序、实际没处理”的误导。
2. **契约收口**：把拖线菜单的尺寸、端口落点、临时节点类型收进一份公开的“连线菜单协议”，由渲染层提供“节点已就绪”查询，插件不猜时序。
3. **浮层宿主**：把右键菜单改为通过渲染层提供的浮层槽/Teleport 宿主挂载，复用主题与上下文；至少补一条主题换皮后菜单仍可读的测试。
4. **测试补边界**：补“菜单打开时卸载插件”“临时节点取消后不落盘/不进历史”“右键与拖线菜单互斥”三条装配测试。

## 待验证

- `isNodeMeasured` 未使用是否是刻意简化；若刻意，注释与实现应统一。
- `document.body` 上的菜单在主题切换/多画布下是否共享同一份 CSS 变量；未做真机验证。
- 临时菜单节点在异常关闭（浏览器崩溃/插件热卸）时是否可能残留进存档；代码有 `transient` 过滤，但未跑恢复测试。

