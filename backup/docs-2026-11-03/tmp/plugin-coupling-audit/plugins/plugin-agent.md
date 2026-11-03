# plugin-agent

## 一句话

画布内对话面板与 Agent 服务。它把面板内容、设置页和引用动作都注册出去，边界大体清楚；主要风险是设置页分组名与插槽 id 的隐式对应、以及多处各写一套「当前画布 id」解析。

## 清单

| 项 | 值 |
|---|---|
| 包名 `@mini-canvas/plugin-agent` | 插件名 `agent` |
| 身份 | builtin + serverBuiltin |
| 源码 / 测试 | 38 个生产源文件 / 38 个测试文件（全包 77 个文件） |
| 包依赖的其他插件 | 无（`package.json` 只有 canvas-base / canvas-render / kernel / prosemirror-editor-bundle、lucide-vue-next、vue-draggable-plus，均为框架/UI 依赖） |
| 是否引用其他插件内部入口 | 否：生产源码没有 `@mini-canvas/plugin-*` import |

## 跨包 import

| 目标 | 入口 | 是否公开出口 | 证据 |
|---|---|---|---|
| canvas-base | `Context` / `PluginModule` 类型、`registerEventName` | 是 | `src/agentPlugin.ts:15`、`src/refClickEvents.ts:17` |
| canvas-render | `useCanvasRender` / `useCapability` / `useUiComponent` | 是 | `src/components/AgentConversation.vue:27`、`src/components/AgentRefToolbar.vue:21` |
| canvas-data | 仅测试与类型推断使用 | 是 | `devDependencies`；生产源码按结构取服务 |
| 其他插件 | 无 | — | 没有跨插件源码 import |

## 运行时协作

| 依赖 | 方式 | 必需/可选 | 证据 |
|---|---|---|---|
| `agent` 服务 | 本插件 `ctx.inject` 上架，宿主 UI 按名读取 | 自有（对外契约） | `src/agentPlugin.ts:50`；消费方 `packages/ui/src/composables/ui.ts:990-991` |
| `agent-conversation` 槽 | 只注册面板内容，外壳在成品 UI | 契约 | `src/agentPlugin.ts:53-58`；`packages/ui/src/components/areas/AgentPanel.vue:295` |
| `settingsNav` + `settingsGroup/Agent` | 设置页导航与正文 | 契约（两个 id 必须同名） | `src/agentPlugin.ts:61-73`；消费逻辑 `packages/ui/src/components/settings/AppSettingsPanel.vue:274-300` |
| `ctx.selectionRegion.attach` | 多选框上控制栏的「引用到 Agent」 | **核心能力，公开但依赖多选插件消费** | `src/agentPlugin.ts:82-88`；能力实现 `packages/canvas-data/src/canvas/capabilities.ts:389-406`；消费者 `packages/plugins/plugin-multi-select/src/SelectionFrame.vue:1053` |
| `command` | 执行「引用到 Agent」命令 | 可选探测（缺则按钮不动作） | `src/components/AgentRefToolbar.vue:38-40` |
| `doc` / `nodeLayout` / `viewport` | 节点候选、聚焦节点 | 可选探测 | `src/components/AgentConversation.vue:452-495` |
| `agent:ref-click` 事件 | 引用标签被点 → 应用层打开资产 | 广播契约 | `src/refClickEvents.ts:20-23`；消费方 `packages/ui/src/composables/useAssetRefOpen.ts:16,30` |
| `agent:reference-node` 命令 | 右键菜单与上控制栏共用 | 契约（命令 id 被右键菜单按 `areas` 收集） | `src/agentCommands.ts:19`；`src/agentPlugin.ts:102-115` |

## 全局与宿主粘连

| 对象 | 用途 | 风险 | 证据 |
|---|---|---|---|
| `/api/agent/*` 固定路由 | 模型、技能、MCP、会话、队列 | 中：前端与 cloud-server 没有共享路由类型 | `src/agentApi.ts:213-331,566-572` |
| `/api/kv/config?values=1` | 读通知开关、队列显示开关 | 中：路径与键名和 `packages/ui` 各写一份 | `src/agentNotify.ts:81,91-108`；`src/queuePrefs.ts:8-24`；对照 `packages/ui/src/composables/agentSettings.ts:28-40` |
| `mini-canvas:agent-queue-prefs-changed` window 事件 | 设置页改队列开关 → 面板重读 | 中：字符串事件名跨 bundle | 发出 `packages/ui/src/composables/agentSettings.ts:280`；监听 `src/components/AgentConversation.vue:394-395` |
| `localStorage['mini-canvas:agent:token-unit']` | token 单位偏好 | 低：插件自有键；无跨插件读写 | `src/components/AgentConversation.vue:1024-1030` |
| 从 URL 读画布 id | 会话与节点引用归属 | 中：与 cloud-client 各写一套规则 | `src/components/AgentConversation.vue:464-474`；对照 `src/agentService.ts:521-523` |
| `document.querySelector(sel).scrollIntoView` | 点「正在编辑」滚到消息 | 低：选择器限定在面板内类名 | `src/components/AgentConversation.vue:903-909` |
| `document` 捕获 `keydown` | Esc 取消编辑 | 低：面板挂载期才绑，卸载清理 | `src/components/AgentConversation.vue:1574-1575` |
| `navigator.clipboard` / `Notification` / `AudioContext` | 复制、系统通知、提示音 | 低：都有环境探测与失败降级 | `src/components/AgentConversation.vue:869`；`src/agentNotify.ts:135-150,160-194` |

## 内部职责与风险

1. **服务集中在 `agentService`，外壳在成品 UI**：插件不画浮动框/停靠，宿主按 `ctx.get('agent')` 读 `state`；这条分工清楚，但也意味着插件服务的 `state` 形状是宿主暗契约。
2. **设置页靠两个同名 id 拼起来**：`settingsNav.id = 'Agent'` 与 `settingsGroup/Agent` 必须逐字一致；这是跨插件/宿主共享的字符串契约，漏改一处这一页就找不到正文。
3. **上控制栏走 `ctx.selectionRegion`，不是私有服务**：能力在 `canvas-data` 有公开实现，Agent 依赖的是「多选插件会消费 `selection/region`」的运行时事实；不装多选时按钮自然不出现，但没有任何可见提示。
4. **画布 id 解析与 cloud-client 重复**：两处都从 `?canvas=` 和 `#/canvas/<id>` 取；规则一旦分叉，会话会写到另一张画布。
5. **通知/队列开关直接读后台 KV**：安装 Agent 但没装 cloud-client 时，读的是本地/同源接口；键名与 UI 设置页各写一份，靠注释约束而非共享类型。
6. **设置页、面板、工具卡都在同一个包**：`agentService` 与 UI 组件共享大量类型，包内耦合高，但对外只暴露服务、槽、命令、事件四类接缝，属于可接受的「厚插件」。

## 单独装卸判断

- 不装：无对话面板、无 `agent` 服务；右键菜单不会出现「引用到 Agent」。
- 不装多选：Agent 主体可用，多选上控制栏入口不出现。
- 不装 cloud-client：仍可指向独立 Agent 后台；通知/队列偏好读同源 KV。
- 卸载：服务、槽、命令随作用域回收（命令回收有测试：`src/__tests__/agentRefToolbar.test.ts:73-79`）；`localStorage` 的 token 单位键保留（插件私有，可接受）。

## 建议改法

1. **最小改动**：把 `settingsNav` 与 `settingsGroup/` 的 key 提成一个常量（如 `AGENT_NAV_ID`），与 `plugin-manager`、`cursor-effect` 共用同一写法，消除两处手写同名字符串。
2. **契约收口**：把「当前画布 id」解析提到 `canvas-base` 或 `canvas-data` 的公开函数，Agent 与 cloud-client 共用；这是最低成本的跨插件一致性修复。
3. **测试补边界**：补一条「不装多选时 Agent 仍可装载、设置页仍在」的装配测试；再补一条「设置页 id 改动会同时改导航与正文」的结构守卫。
4. **地址统一**：若确认 Agent 与 cloud-client 永远连同一个后台，共用一个设置项/服务；若允许不同后台，把这一点写进设置说明，避免用户以为填一次就够。

## 待验证

- 宿主 `packages/ui` 是否在任何装配形态下都提供 `agent-conversation` 槽与 `agent` 服务消费；当前只核对成品 UI。
- `selectionRegion` 在多选插件未装时的行为：能力仍可注册，但没有消费者；未做真机确认。
- Agent 后台地址与 cloud-client 地址在产品语义上是否应合并；需要产品口径确认。

