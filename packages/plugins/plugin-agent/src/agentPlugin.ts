/**
 * plugin-agent —— 画布内的对话助手。
 *
 * 与 plugin-mini-map 同一条路（本仓库插件的标准做法）：
 * - **槽位**装 UI：内容组件（消息流 + 输入区）注册进 agent-conversation 槽，
 *   任何布局用 <SlotHost slot="agent-conversation" /> 自选位置；
 * - **服务**持状态：ctx.inject('agent', 服务)，宿主读它做布局、也用它调动作；
 * - **命令**给键盘：agent:toggle，键位由渲染层统一分发（插件不自己绑 window）。
 *
 * **外壳不在本插件里**（浮动框 / 停靠 / 拖宽 / 头部按钮归 packages/ui）：
 * 插件只提供「消息流 + 输入区」这一块内容，与设置内容「插件给内容、渲染层给外壳」同构。
 * 理由之一是技术上的：停靠要把画布挤窄，用的是 CanvasShell 的 right-width，插件够不到那个绑定。
 */
import { markRaw, reactive } from 'vue'
import type { Context, PluginModule } from '@mini-canvas/canvas-base'
import { createAgentService, type AgentService } from './agentService.js'
import AgentConversation from './components/AgentConversation.vue'
import AgentSettingsNav from './components/settings/AgentSettingsNav.vue'
import AgentSettingsPage from './components/settings/AgentSettingsPage.vue'

export const name = 'agent'
export const inject = [] as string[]

export interface AgentPluginConfig {
  agentBaseUrl?: string
}

export const Config = {
  agentBaseUrl: {
    type: 'string' as const,
    default: '',
    label: '后端地址',
    // 一级名就叫 Agent（不带二级段）：面板会把「有同名导航项的分组」直接当这一页的内容，
    // 于是不需要再额外注册 settingsTab —— 实测把整页塞进 settingsTab 会把页签条撑到 600px，
    // 内容区被压成 22px，整页都看不见了。
    group: 'Agent',
    description: 'cloud-server 的根地址。留空 = 与画布同源（由 cloud-server 托管界面时就是这样）。',
  },
}

export function apply(ctx: Context, config?: AgentPluginConfig): void {
  const service = createAgentService({ baseUrl: config?.agentBaseUrl ?? '' })
  // **服务本身必须包成响应式**（实测教训）：服务是 `{ state, 方法… }` 的普通对象，
  // 真正响应式的只有里面的 state。宿主（App.vue 的 right-width）通过服务读 state.docked 时，
  // 依赖是从**服务对象**上收集的 —— 它不可响应 → state 变了宿主也不重算
  // （现象：面板已停靠、画布却没被挤窄，右上角按钮压在面板上）。
  // 对比 plugin-mini-map：它直接把 reactive 对象当服务注入，所以从来没这个问题。
  ctx.inject('agent', reactive(service))

  // ① 内容槽：消息流 + 输入区（外壳由 packages/ui 提供）
  ctx.slots.register('agent-conversation', {
    id: 'agent-conversation',
    order: 60,
    component: markRaw(AgentConversation),
    meta: { title: 'Agent 对话' },
  })

  // ② 设置面板里的 Agent 页（一级导航 + 三个自定义页签）
  ctx.slots.register('settingsNav', {
    id: 'Agent',
    order: 5,
    component: markRaw(AgentSettingsNav),
    meta: { title: 'Agent' },
  })
  // 内容：段的正文来自 settingsGroup/<完整分组 key>。整页只注册这一处，
  // 页签切换由页面自己负责（用户口径：上面一排页签切换 provider / 技能 / MCP / 系统提示词…）。
  ctx.slots.register('settingsGroup/Agent', {
    id: 'agent-page',
    order: 5,
    component: markRaw(AgentSettingsPage),
  })

  // ③ 命令：键盘开合面板（外壳读 open 决定显隐）
  ctx.commands.register({
    id: 'agent:toggle',
    title: '切换 Agent 面板',
    keys: ['mod+j'],
    order: 60,
    run: () => service.toggle(),
  })
}

export const agentPlugin: PluginModule = { name, inject, Config, apply }
export type { AgentService }
