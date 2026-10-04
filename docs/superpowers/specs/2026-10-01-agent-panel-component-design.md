# Agent 面板 —— 可复用组件化设计（补充）

- 日期：2026-10-01
- 类型：界面设计补充（回答「怎么变成一个到处能用的组件」）
- 状态：**待评审**
- 前置：`2026-10-01-agent-panel-ui-design.md`（面板长什么样）、`2026-10-01-agent-plugin-design.md`（后台怎么给数据）

> 这份补的是用户提的那个真问题：**面板要是一件「放在哪都一样的组件」，不是一整套布局。**
> 现在 UI 里那套「浮动 + 停靠 + 拖拽」只是它的一种摆法。

## 零、先纠一处错（2026-10-01，用户指出）

上一版把**外壳**（浮动框 / 停靠 / 拖宽 / 缩放 / 头部按钮）放进了插件里，**这是错的**。
正确的分工与**设置面板完全一致**（逐行核实过）：

| 谁 | 提供什么 | 证据 |
|---|---|---|
| theme-default 插件 | **只有内容**：左导航 + 右侧设置项；**没有**遮罩、没有弹窗框 | `PluginSettingsContent.vue`（里面的 `psd-dialog` 是外壳的类名，只在注释里被提到，不是它画的） |
| 渲染层（canvas-render） | **外壳**：遮罩 / 居中 / 标题栏 / ✕ / Esc / 浮动窗 / 悬浮球 | `canvas-render/src/components/SettingsShell.vue` |
| 应用（packages/ui） | 决定**何时**渲染它 | `App.vue` 的 `<SettingsHost v-if="s.settingsOpen" />` |

所以 Agent 这边照抄：**插件只给「红框里那一块」（内容），外壳归应用（packages/ui）。**

技术上还有一条硬理由：**停靠时要把画布挤窄**，靠的是 `CanvasShell` 的 `right-width` 属性，
那个绑定在 packages/ui 里 —— 插件拿不到，也做不了。所以外壳本来就该在应用层。

## 一、结论：拆成三层（外壳那层归应用，不归插件）

| 层 | 名字 | 是什么 | 放在哪 |
|---|---|---|---|
| **逻辑** | `agent` 服务（`ctx` 上的） | 会话状态 + 全部动作（新建/发消息/停止/历史/改名/删除…） | 单例，跟着画布内核活 |
| **内容** | `AgentConversation.vue` | **图片里红框那一块**：消息流 + 输入区 | 任意布局自己摆 |
| **外壳** | `AgentPanel.vue`（**住在 packages/ui**，不是插件） | 浮动框 / 停靠 / 拖宽 / 缩放 + 头部那一行按钮 | 应用自己的一种摆法 |

关键点：**方法在服务上，不在组件上。** 下面第三节说为什么。

```
                    ┌──────────────────────────────┐
                    │  agent 服务（单例）           │
                    │  状态 + 全部动作方法          │
                    └───────┬──────────────┬───────┘
                            │ 读/写        │ 读/写
              ┌─────────────▼───┐      ┌───▼──────────────────┐
              │ AgentConversation│      │ AgentHeader / 外壳    │
              │ （红框：内容）    │      │ （框、头部按钮、拖拽） │
              └─────────────────┘      └──────────────────────┘
                        ▲                        ▲
                        │ 任何布局都可以放        │
              ┌─────────┴──────────┬─────────────┴──────┐
              │ 左侧抽屉 / 底部条   │ 悬浮框 / 停靠右缘    │
              └────────────────────┴────────────────────┘
```

## 二、服务：状态 + 方法（这就是「组件的 API」）

`ctx.inject('agent', state)`（计划 Task 10 已有雏形，这里把方法列全）。

### 2.1 状态（响应式，任何布局读了都实时）

```ts
export interface AgentServiceState {
  /** 面板可见性（悬浮壳用；只放内容的布局可以忽略它） */
  open: boolean
  /** 是否停靠（悬浮壳用） */
  docked: boolean
  /** 面板宽度（悬浮壳用） */
  width: number

  /** 当前会话 id；null = 还没建（第一句话才建） */
  sessionId: string | null
  /** 当前会话的标题 */
  title: string
  /** 正在跑一轮 */
  running: boolean
  /** 消息列表（内容组件直接渲染它） */
  turns: ChatTurn[]
  /** 会话列表（历史下拉 / 侧边列表读它） */
  sessions: Array<{ id: string; title: string; updatedAt: number; preview?: string }>
  /** 还没配模型 → 界面给引导 */
  needsModel: boolean
  /** 连不上后台（含当前地址，便于排查） */
  offline: boolean
  /** 上下文剩余百分比（0-100）；算不出来时 null */
  contextLeft: number | null
  /** 当前模型（面板与设置页共享同一个值） */
  model: { provider: string; modelId: string } | null
  /** 这一轮启用的技能名 */
  activeSkills: string[]
  /** 审批档位（面板与偏好弹窗共享同一个值） */
  approvalMode: 'auto' | 'ask'
}
```

### 2.2 方法（**布局里就调这些**）

```ts
export interface AgentService {
  // —— 面板开合（悬浮壳用；只放内容的布局不需要）——
  toggle(): void
  show(): void
  hide(): void

  // —— 会话 ——
  /** 建一个新会话并清空消息区（不是删旧的）。返回新 id */
  newSession(): Promise<string | null>
  /** 拉会话列表（历史下拉 / 侧边列表用） */
  listSessions(): Promise<void>
  /** 切到某个已有会话：拉它的转录并替换消息区 */
  openSession(sessionId: string): Promise<void>
  renameSession(sessionId: string, title: string): Promise<void>
  deleteSession(sessionId: string): Promise<void>

  // —— 对话 ——
  send(text: string): Promise<void>
  /** 中止当前这一轮（会话与转录都留着） */
  stop(): void
  /** 重发最后一句（错误卡片上的「重试」） */
  retry(): Promise<void>

  // —— 这一轮的配置 ——
  setModel(provider: string, modelId: string): void
  toggleSkill(name: string): void
  setApprovalMode(mode: 'auto' | 'ask'): void

  // —— 诊断 ——
  /** 重新探一次后台（连不上时的「重试连接」） */
  refresh(): Promise<void>
}
```

## 三、怎么在布局里调这些方法（用户问的那句）

三条路，**推荐第一条**：

### 3.1 在画布渲染子树里（推荐）：`useAgent()`

```ts
import { useAgent } from '@mini-canvas/plugin-agent'

const agent = useAgent()        // 就是上面那个服务，响应式
agent.newSession()              // 直接调
```

实现（十行，与仓库里 `useCanvasRender()` 同一套写法）：

```ts
// packages/plugins/plugin-agent/src/useAgent.ts
import { useCanvasRender } from '@mini-canvas/canvas-render'
import type { AgentService } from './agentService'

/**
 * 取 agent 服务（单例）。必须在 <CanvasHost> 的渲染子树内调用。
 *
 * 为什么不让布局自己 ctx.get('agent')：布局代码（抽屉/底栏/侧栏）里写 ctx.get 要先拿到 ctx（useCanvasRender），
 * 再自己转类型；包成一行函数后，调用的地方只认这一件事。
 */
export function useAgent(): AgentService {
  const { ctx } = useCanvasRender()
  const svc = ctx.get<AgentService>('agent')
  if (!svc) throw new Error('[useAgent] 没找到 agent 服务：请确认装配里装了 plugin-agent')
  return svc
}
```

**边界（重要，这是仓库的既有约束）**：`useCanvasRender()` 只在 `<CanvasHost>` 的子树内可用。
`App.vue` 的 `<template #ui>` 里可以（它渲染在 CanvasSurface 内）；
但 `CanvasShell` 自己的具名插槽（`top-left` / `status` / `dock-append` 等）**在外面**，在里面调会直接抛错。

> 我在计划 Task 12 里本来写的是「把入口按钮挂在 `CanvasShell` 的 `dock-append` 槽」——
> **那条是错的**，要改成挂在 `#ui` 内并用 `position: fixed` 定位（`#ui` 在 `.csurface` 里，
> 而 `.csurface` 没有 transform，所以 fixed 定位能正常工作 —— 小地图就是这么做的）。
> 或者退一步：宿主保留一个纯触发按钮（只调 `agent.toggle()`、不含业务逻辑），
> 走 `ui.readyHost?.ctx?.get('agent')` —— `ui.ts` 里读 `mini-map` 服务就是这条路。

### 3.2 不在渲染子树里：经宿主句柄

```ts
// 宿主侧（例如 packages/ui 的某个区域组件）
const agent = ui.readyHost?.ctx?.get<AgentService>('agent')
agent?.toggle()
```

这就是 `ui.ts` 里 `minimapOn` 的现成写法，不需要新机制。

### 3.3 从别的插件调（跨插件）

```ts
// 别的插件的 apply(ctx) 里
const agent = ctx.get<AgentService>('agent')
agent?.send('把选中节点做成一张海报')
```

**这条最有用**：将来「选中节点 → 右键 → 让 Agent 处理」就是它。要保证服务名稳定（`agent`）。

### 3.4 为什么不把方法只放在组件上（用户问法的直答）

如果方法只在 `AgentConversation.vue` 上（靠 `defineExpose` + 模板 ref），会出现两个问题：

1. **组件没挂载时调不到**。比如键盘快捷键 / 底栏按钮要让 Agent「新建对话」，
   而那时面板可能根本没渲染（`v-if` 关着）。组件不存在，方法也就不存在。
   服务是常驻的，所以任何时候都调得到。
2. **同一块内容摆两处会变成两份状态**。左边抽屉一个、右边悬浮一个，各自一个组件实例，
   两个实例各自持有消息列表 → 两边看到的不一样。挂在服务上就只有一份状态。

所以：**服务是唯一事实来源；组件只是它的一张脸。**
顺手也支持模板 ref（布局作者如果习惯那种写法），做法是 `defineExpose` 里把方法转发到服务：

```ts
// AgentConversation.vue 里
defineExpose({
  newSession: () => agent.newSession(),
  send: (t: string) => agent.send(t),
  stop: () => agent.stop(),
  openSession: (id: string) => agent.openSession(id),
  listSessions: () => agent.listSessions(),
})
```

两种写法都通，但**文档里推荐 `useAgent()`**（不受挂载与否影响）。

## 四、内容组件：`AgentConversation.vue`（红框那一块）

### 4.1 职责边界（只做红框里的）

做：消息流（含思考/工具/错误卡片）、空态、输入框 + 发送/停止、底部一行（模型 / 技能 / 审批档位 / 上下文剩余）。

不做（这些留给布局）：外框、圆角、阴影、头部那一行按钮、拖拽、停靠、缩放、定位。

### 4.2 接口

```ts
// props 全是可选的「摆法微调」，没有一个内容是必需的
defineProps<{
  /** 紧凑模式：更小的行距与字号，给窄栏（抽屉）用 */
  density?: 'comfortable' | 'compact'
  /** 是否显示底部那一行（模型/技能/档位/上下文） */
  showControls?: boolean
  /** 空态文案（不传用默认） */
  emptyText?: string
  /** 是否显示输入框（只读浏览模式下可关掉） */
}>()
```

数据与方法一律走 `useAgent()`，**不走 props 注入**（避免又变成两份状态）。

### 4.3 三种摆法的示例

```vue
<!-- 摆法一：悬浮框 / 停靠右缘（现状那种，由 AgentPanel 外壳提供） -->
<AgentConversation />

<!-- 摆法二：左侧抽屉里，紧凑一点 -->
<AgentConversation density="compact" />

<!-- 摆法三：只读浏览（看历史，不给输入） -->
<AgentConversation :show-controls="false" />
```

三种摆法**共享同一个会话状态** —— 这是「在哪里点都一样」的技术保证。

### 4.4 用插槽注册出去，任何布局都能取

```ts
// agentPlugin.ts
ctx.slots.register('agent-conversation', {
  id: 'agent-conversation',
  order: 60,
  component: AgentConversation,
  meta: { title: 'Agent 对话内容' },
})
```

```vue
<!-- 布局甲：放左抽屉 -->
<SlotHost slot="agent-conversation" />

<!-- 布局乙：放底部条 -->
<SlotHost slot="agent-conversation" />
```

两个槽宿主同时存在也**不会打架**（同一个服务、同一份状态），只是同一块内容画了两份。

## 五、外壳：`AgentPanel.vue`（**归 packages/ui**，保留现状那种摆法）

它 = 头部（标题/新建/历史/偏好/停靠/关闭）+ 外框 + 拖拽 + 拖宽 + 缩放 + **把 `<AgentConversation />` 放进去**。

头部按钮全部只调服务方法，一行一个：

| 按钮 | 调用 |
|---|---|
| 新建 | `agent.newSession()` |
| 历史 | 读 `agent.sessions`；点一条 `agent.openSession(id)`；改名 `agent.renameSession`；删除 `agent.deleteSession` |
| 偏好 | 打开偏好弹窗（档位 / 通知），改的是 `agent.setApprovalMode` 与本地通知开关 |
| 停靠切换 | `agent.docked = !agent.docked` |
| 关闭 | `agent.hide()` |

外壳**不住在插件里**，也不占槽 —— 它是 packages/ui 自己的一个组件（就像 `SettingsShell` 是渲染层自己的组件）。

所以：**只需要一个槽**，就是内容槽 `agent-conversation`。上一版提的那个 `agent-panel` 槽**取消**
（它原本要装的正是现在搬到 packages/ui 的那个外壳）。

## 六、上下文剩余百分比：怎么做（**不删了**）

SDK 给两处真数据：

| 数据 | 出处 | 含义 |
|---|---|---|
| `model_context_window` | `session_meta` 里 | 这个模型的上下文窗口总量（number 或 string） |
| `request.total` | `token_usage` 事件里 | 当前上下文实际用量（SDK 文档原话：current context usage figure） |
| `session.total` | 同上 | 本次会话累计用量（不是我们要显示的那个） |
| `compaction.max_context_length` | Agent 配置里（默认 256000） | 触发压缩的阈值 |

算法：

```ts
// 有效上限 = 模型窗口与压缩阈值取小（压缩一到，旧内容就被摘要了）
const limit = Math.min(Number(modelContextWindow) || Infinity, compactionMaxContextLength)
const used = requestTotal
const left = Math.max(0, Math.min(100, Math.round((1 - used / limit) * 100)))
```

落点：

1. 后端在 `translate.ts` 里把 `session_meta.model_context_window` 与 `token_usage.request.total` 带出来，
   加一条新事件 `{ type: 'usage'; usedTokens: number; limitTokens: number }`；
2. 前端 `ChatEvent` 加同一形状，`agent.contextLeft` 在收到它时更新；
3. 没收到过 `token_usage` 时 `contextLeft = null`，界面上**不显示**这一项（宁可没有，不显示假数）。

> 这个事件只在**正常完成**时才产生（SDK 注释写明），所以对话进行中可能暂时是上一轮的数字 ——
> 这是真实情况，不做插值。

## 七、这与「设置界面」是同一种通用性

用户说的那个类比很准：设置面板的皮就是「一块内容，挂在槽上，摆哪都一样」。这里照抄同一套：

| | 设置面板 | Agent 对话 |
|---|---|---|
| 外壳 | `SettingsShell`（遮罩/框/✕/浮动/悬浮球） | `AgentPanel`（浮动/停靠/拖宽/缩放） |
| 内容 | 皮（左导航 + 设置项），挂 `settingsPanel` 槽 | `AgentConversation`，挂 `agent-conversation` 槽 |
| 状态 | `ctx.settings`（单一数据源） | `agent` 服务（单一数据源） |
| 换摆法 | 换皮或改 `order` | 换个槽宿主，或直接 import 组件 |

差别只在一点：设置面板的内容是「当前赢家」单选（`theme.winner`），
Agent 对话是「可以同时挂多处」多选（`SlotHost` 渲染全部 occupant）—— 这正是「在哪都能用」需要的。

## 八、要改的计划任务

| Task | 改动 |
|---|---|
| Task 10（骨架） | **只注册一个 `agent-conversation` 槽**（放内容组件）；**不再注册 `agent-panel` 槽**；`AgentPanel.vue` 从插件里删掉 |
| Task 11（接口与合并） | `ChatEvent` 加 `usage` 一条；`AgentApi` 加 `listSessions` / `renameSession` / `deleteSession`（已有）与 `getSession`（已有） |
| Task 12（接真后台） | 拆出 `AgentService`（状态 + 方法，独立文件 `agentService.ts`）与 `useAgent.ts`；面板里的逻辑从组件搬进服务；模板与样式按 UI 设计改成 BEM 类 |
| Task 12（宿主） | **在 packages/ui 里新建外壳组件** ~`components/AgentPanel.vue`（浮动框 + 头部按钮 + 拖拽 + 停靠，照 `SettingsShell` 的分工）；入口按钮**挂 `#ui` 内**（不是 `dock-append`，见 §3.1）；应用侧通过 `agent` 服务调方法 |
| Task 13（设置页） | 不变（那一块与对话内容无关） |
| Task 14（清理） | 不变 |

## 九、待你确认（**已按纠正后的分工改写**）

1. **服务名定为 `agent`、内容槽名定为 `agent-conversation`** —— 可以吗？
   （名字要稳定：将来别的插件用它来「让 Agent 处理选中的节点」。外壳不占槽，所以没有外壳槽名了。）
2. **应用侧（packages/ui）那个外壳，叫什么、住哪儿**？建议：
   `packages/ui/src/components/AgentPanel.vue`（与 `ChatPanel.vue` 同级、同命名习惯，替换它）。
3. **内容组件默认显示底部那一行**（模型 / 技能 / 档位 / 上下文剩余）；放到窄抽屉里时要不要默认收起？
4. **上下文剩余的分母**用「模型窗口与压缩阈值取小」（我的建议：到 0% 正好触发压缩，对用户更有意义），
   还是你想看相对模型窗口的原始比例？
