# 对接详解 · Agent 插件

**一句话定位**：`plugin-agent` 是画布内的 AI 对话助手 —— 用户在画布边上打字，
它在 cloud-server 上跑一轮对话（可操作画布），把过程流式画进面板。

## 这篇能让你做什么

读完并照抄，你会有一个**能连上 cloud-server 对话的画布面板插件**：面板开合、流式收回答、
把节点引用进输入框、进设置页配模型。更复杂的能力（队列、目标、分支、审批 UI）都是在这个
骨架上叠状态与页面，骨架不变。

## 装上后你会看到

- 右上角多一个面板入口（快捷键 `Mod+J` 开合）；面板里是消息流 + 输入区。
- 输入框可以发消息；发出去后能看到「思考中 / 工具调用卡片 / 审批卡片 / 回答」逐段出现。
- 选中几个节点，多选框上多一个「引用到 Agent」按钮；点它，节点变成输入框里的引用标签。
- 设置面板多一页「Agent」：配模型渠道（密钥掩码显示）、技能、MCP 服务、系统提示词、审批规则。

## 完整代码（最小骨架）

真实插件有几千行（会话模型/队列/目标/分支……），下面抽出与后台对接的**最小骨架**，
结构逐字对齐真实写法：

```ts
// 文件：my-agent-plugin/src/index.ts
// 格式：TypeScript 模块（前端插件入口）
// 位置：一个对话类前端插件的骨架；真实版 = packages/plugins/plugin-agent
import { markRaw, reactive } from 'vue'
import type { Context, PluginModule } from '@mini-canvas/canvas-base'
import AgentConversation from './AgentConversation.vue'

export const name = 'my-agent'
// ① 不写 inject：后台地址做成配置（留空 = 与画布同源）；服务用 ctx.get 惰性取
export const inject = [] as string[]

export const Config = {
  agentBaseUrl: {
    type: 'string' as const,
    default: '',
    label: '后端地址',
    group: 'Agent',
    description: 'cloud-server 的根地址。留空 = 与画布同源（cloud-server 托管界面时就是这样）。
  },
}

/** 对话服务的形状（真实版见 plugin-agent/src/agentService.ts，这里有几十个字段/方法） */
export interface MyAgentService {
  state: { open: boolean; running: boolean; turns: unknown[] }
  toggle(): void
  show(): void
  /** 发一轮对话；后台跑 AgentRuntime，事件流式回来 */
  send(text: string): Promise<void>
  /** 把节点记成「待插入的引用」；面板打开后内容组件把它插成标签 */
  requestNodeRefs(ids: string[]): void
}

export function apply(ctx: Context): void {
  // ② 建服务并包成 reactive 再上架。真实插件的实测教训：服务是普通对象、
  //    只有里面的 state 是响应式 —— 不包 reactive，宿主读 state.docked 时依赖收集失败，
  //    状态变了界面不重算（面板停靠时画布没被挤窄就是这个坑）。
  const service = createMyAgentService()
  ctx.inject('agent', reactive(service))

  // ③ 内容槽：消息流 + 输入区。外壳（浮窗/停靠/拖宽）不在插件里 —— 那要用宿主的画布宽度绑定，
  //    插件够不到；「插件给内容、渲染层给外壳」与设置面板同构。
  ctx.slots.register('agent-conversation', {
    id: 'agent-conversation',
    order: 60,
    component: markRaw(AgentConversation),
  })

  // ④ 设置面板：「Agent」一级导航 + 整页正文。分组名必须与 Config 的 group 同名，
  //    面板才会把这一页接上（有导航没分组 → 右侧空白）。
  ctx.slots.register('settings.nav', {
    id: 'agent/nav', order: 5, component: markRaw(AgentNav), meta: { group: 'Agent' },
  })
  ctx.slots.register('settingsGroup/Agent', { id: 'agent/page', order: 5, component: markRaw(AgentPage) })

  // ⑤ 多选框的上控制栏挂「引用到 Agent」：与「加入资产库」同一条接缝（selection/region 场）。
  //    needs: ['selection'] → 组件按名取选中集，多选插件零改动。
  ctx.selectionRegion.attach({
    region: 'out:top',
    id: 'my-agent-refer',
    order: 30,
    component: markRaw(AgentRefToolbar),
    needs: ['selection'],
  })

  // ⑥ 命令：开合面板（keys 由渲染层统一分发，插件不自己绑 window）。
  ctx.commands.register({
    id: 'my-agent:toggle',
    title: '切换 Agent 面板',
    keys: ['mod+j'],
    run: () => service.toggle(),
  })

  // ⑦ 命令：把节点引用到输入框。areas: ['node'] → 出现在节点右键菜单里。
  ctx.commands.register({
    id: 'my-agent:reference',
    title: '引用到 Agent',
    areas: ['node'],
    group: '节点',
    run: (_c, payload: { nodeId?: string }) => {
      if (!payload?.nodeId) return false
      service.requestNodeRefs([payload.nodeId])
      service.show()
      return true
    },
  })
}
```

```ts
// 文件：my-agent-plugin/src/agentApi.ts
// 格式：TypeScript 模块（与后台说话的唯一一处）
// 位置：所有 fetch 收口在这个类 —— 换后台地址只改一个变量
export class MyAgentApi {
  private baseUrl: string
  constructor(baseUrl = '') { this.baseUrl = baseUrl }
  setBaseUrl(u: string) { this.baseUrl = u }
  absolute(p: string) { return /^https?:/i.test(p) ? p : this.baseUrl + p }

  /** 发一轮对话。真实版走 SSE 流式收事件（thinking/tool-call/approval/answer…） */
  async send(canvasId: string, text: string, sessionId: string) {
    const res = await fetch(this.absolute('/api/agent/canvases/' + canvasId + '/sessions/' + sessionId + '/send'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    })
    if (!res.ok) throw new Error('发送失败 ' + res.status)
    return res.body   // 流
  }
}
```

## 每一步在干什么

1. **`inject` 留空**：后台地址是配置不是依赖；对话服务在自己 apply 里建，不给别人提供可复用的数据能力。
2. **服务包 `reactive` 再上架**：宿主外壳要读面板状态（显隐/停靠/宽度）来布局，不包 reactive 状态变了界面不跟 —— 真实插件注释里记了这个实测教训。
3. **内容与外壳分离**：插件只给「消息流 + 输入区」，浮动框/停靠/拖宽在 `packages/ui`。因为停靠要把画布挤窄，用的是宿主的画布宽度绑定，插件层面够不到。
4. **「引用到 Agent」走 `selectionRegion.attach`**：挂的是**多选框**的上控制栏（不是节点自己的），与「加入资产库」「打组」同一条接缝 —— 多选插件零改动。
5. **`areas: ['node']` 的命令**：会出现在节点右键菜单里。两个入口（右键 + 多选栏按钮）都只调 `service.requestNodeRefs`，服务是两个入口的唯一共享通道。
6. **流式收事件**：后台 AgentRuntime 是异步生成器，边跑边 `yield` 事件；前端经 SSE 逐个收，把 `thinking` / `tool-call` / `approval` / `answer` 逐段画进面板。

## 它调的后台接口（真实枚举）

| 接口 | 干什么 |
| --- | --- |
| `/api/agent/canvases/:id/sessions/…` | 会话：列表/新建/发送（SSE 流式）/队列/目标 |
| `/api/agent/models`、`/models/default`、`/models/vision`、`/models/bulk` | 模型渠道管理（密钥掩码回显，明文不回传） |
| `/api/agent/skills/`、`/skills/sources`、`/skills/import` | 技能扫描与导入 |
| `/api/agent/mcp`、`/mcp/probe` | MCP 服务配置与主动探测（连没连上、拿到哪些工具） |
| `/api/agent/prompts`、`/system-prompt`、`/title-model` | 提示词与标题模型 |
| `/api/agent/policy` | 审批规则（哪些工具要问用户） |
| `/api/agent/config` | 全局配置读写 |

## 与后台插件系统的握手点

**后台插件经 `ctx.agent.use` 注册的中间件，拦截的正是本插件发来的每一轮对话**：
HTTP 路由收到 `{canvasId, text}` → 先跑中间件链（可改写 text / 直接拦截）→ 再交给 AgentRuntime。
所以你可以不碰前端一行代码，就在后台给对话脱敏、补上下文、按配额拦截 ——
见 [agent 能力详解](/cloud-server/capabilities-agent)。

## 源码出处

| 这篇里的做法 | 真实文件 | 真实行为 |
| --- | --- | --- |
| 服务包 reactive 再上架 | `packages/plugins/plugin-agent/src/agentPlugin.ts` | `ctx.inject('agent', reactive(service))`，注释记了不包的后果 |
| 内容槽 + 设置页两个槽 | 同上 | `agent-conversation` / `settingsNav` / `settingsGroup/Agent` 三处注册 |
| 引用按钮挂多选框 | 同上 | `ctx.selectionRegion.attach({ region:'out:top', needs:['selection'] })` |
| `mod+j` 与 `areas:['node']` 命令 | 同上 | `agent:toggle` 与 `AGENT_REFERENCE_COMMAND_ID` |
| 与后台的唯一对话通道 | `packages/plugins/plugin-agent/src/agentApi.ts` | AgentApi 类，SSE 流式收 ChatEvent |
| 会话/队列/目标状态镜像 | `packages/plugins/plugin-agent/src/agentService.ts` | AgentServiceState（真相在后台会话文件，前端是镜像 + SSE 同步） |

## 常见坑

1. **服务不包 reactive**：宿主读状态不重算（实测踩过，真实插件注释里写了）。
2. **设置页只注册 settingsNav 不声明同名 group**：右侧内容区空白 —— 导航 id 必须与一个 Config 分组名一致。
3. **把外壳做进插件**：停靠要挤画布宽度，插件够不到宿主绑定；内容归插件、外壳归宿主。
4. **自己绑 window 键盘事件**：快捷键一律走 `commands.register({ keys })`，渲染层统一分发 —— 自己绑会和别的插件抢。
