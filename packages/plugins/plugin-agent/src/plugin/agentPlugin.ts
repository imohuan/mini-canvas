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
import { Bot } from 'lucide-vue-next'
import type { Context, PluginModule } from '@mini-canvas/canvas-base'
import { createAgentService, type AgentService } from '../service/agentService.js'
import AgentConversation from '../ui/conversation/AgentConversation.vue'
import ModelPicker from '../ui/conversation/ModelPicker.vue'
import ChoicePicker from '../ui/conversation/ChoicePicker.vue'
import AgentRefToolbar from '../ui/toolbar/AgentRefToolbar.vue'
import AgentSettingsNav from '../ui/settings/AgentSettingsNav.vue'
import AgentSettingsPage from '../ui/settings/AgentSettingsPage.vue'
import { AGENT_REFERENCE_COMMAND_ID } from './agentCommands.js'
import { createModelIconService } from '../ui/render/modelIconService.js'

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
    // 分组归属由 ctx.settingsMenu 的 section 决定；group 只是配置字段的稳定 key。
    group: '集成/Agent',
    placeholder: '留空 = 与画布同源，例如 http://127.0.0.1:{端口}',
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
  // 平台图标服务：底栏等插件按名取，避免各自再画一套「模型名 → 图形」
  // 用户口径（2026-11-07）：图标放 Agent 里，两处共用。
  ctx.provide('modelIcons', createModelIconService())
  // 模型选择面板：Agent 输入区与底栏共用同一件（用户 2026-11-07）。
  // 放 ui 场而不是用 import：底栏不能反向依赖 Agent 插件，只能按名取。
  ctx.registryOf<unknown>('ui').add('agentModelPicker', ModelPicker, { id: 'agent' })
  // 同一套「卡片 / 分栏」交互的通用版：图片 / 视频的生成动作也用它（用户 2026-11-07）。
  ctx.registryOf<unknown>('ui').add('agentChoicePicker', ChoicePicker, { id: 'agent' })

  // 菜单：进「集成 → Agent」。默认主题只提供默认树，本插件只注册自己的那一页。
  ctx.settingsMenu.nav({
    id: 'nav/integration/agent',
    category: 'category/integration',
    title: 'Agent',
    icon: Bot,
    order: 10,
    page: markRaw(AgentSettingsPage),
  })

  // ① 内容槽：消息流 + 输入区（外壳由 packages/ui 提供）
  ctx.slots.register('agent-conversation', {
    id: 'agent/conversation',
    order: 60,
    component: markRaw(AgentConversation),
    meta: { title: 'Agent 对话' },
  })

  // ② 设置面板里的 Agent 页（一级导航 + 三个自定义页签）
  ctx.slots.register('settings.nav', {
    id: 'agent/nav',
    order: 5,
    component: markRaw(AgentSettingsNav),
    // 只提供数据：外观由设置面板统一渲染，整页走 page，避免再自绘一套导航
    meta: { title: 'Agent', category: '集成', icon: Bot, page: markRaw(AgentSettingsPage), pageGroup: '集成/Agent' },
  })
  // 内容：段的正文来自 settingsGroup/<完整分组 key>。整页只注册这一处，
  // 页签切换由页面自己负责（用户口径：上面一排页签切换 provider / 技能 / MCP / 系统提示词…）。
  ctx.slots.register('settingsGroup/集成/Agent', {
    id: 'agent/page',
    order: 5,
    component: markRaw(AgentSettingsPage),
  })

  // ③ 「引用到 Agent」按钮 → **多选框的上控制栏**（与「加入资产库」同一条接缝）。
  //    用户口径（2026-10-08）：「向主节点的顶部控制栏注册一个按钮…参考『加入资产库』是怎么做的」——
  //    「加入资产库」挂在多选框（选择集）的顶栏，不是节点卡片自己的操作条，故这里走
  //    ctx.selectionRegion.attach（多选插件暴露的区域注册函数，多选插件零改动）。
  //    needs:['selection'] → 组件按名取选中集（与打组按钮、加入资产库按钮同一规矩）。
  //    定位（贴外框上缘 + 居中 + 反缩放）由 SelectionFrame 统一给，组件只放内容。
  //    @see AgentRefToolbar
  ctx.selectionRegion.attach({
    region: 'out:top',
    id: 'agent-refer-selection',
    order: 30,
    component: markRaw(AgentRefToolbar),
    needs: ['selection'],
  })

  // ③ 命令：键盘开合面板（外壳读 open 决定显隐）
  ctx.commands.register({
    id: 'agent:toggle',
    title: '切换 Agent 面板',
    keys: ['mod+j'],
    order: 60,
    run: () => service.toggle(),
  })

  // ④ 命令：把节点**引用到 Agent 输入框**（两个入口共用：节点右键菜单 + 多选上控制栏按钮）。
  //    areas:['node'] → 出现在节点的右键菜单里（沿用 context-menu 插件的 areas 语义）。
  //    做法：服务记下待插入的节点 id，面板打开后由内容组件插成标签（服务是两者唯一共享通道）。
  ctx.commands.register({
    id: AGENT_REFERENCE_COMMAND_ID,
    title: '引用到 Agent',
    areas: ['node'],
    group: '节点',
    order: 20,
    run: (_c, payload: { nodeId?: string; nodeIds?: string[] }) => {
      const nodeId = payload?.nodeId
      const ids = Array.isArray(payload?.nodeIds) ? payload.nodeIds : nodeId ? [nodeId] : []
      if (!ids.length) return
      service.requestNodeRefs(ids)
      service.show()
    },
  })
}

export const agentPlugin: PluginModule = { name, inject, Config, apply }
export type { AgentService }
