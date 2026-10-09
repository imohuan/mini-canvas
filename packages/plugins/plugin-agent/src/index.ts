export { agentPlugin, name, inject, Config, apply } from './agentPlugin.js'
export type { AgentPluginConfig } from './agentPlugin.js'
export { createAgentService, CANVAS_ID } from './agentService.js'
export type {
  AgentService,
  AgentServiceState,
  ModelRow,
  ProviderRow,
  SkillRow,
  McpRow,
  ApprovalRuleRow,
  ApprovalPolicyView,
} from './agentService.js'
export { useAgent } from './useAgent.js'
// 「引用标签被点了」这条系统事件的**唯一一份**名字与载荷定义（应用层按名监听，见 packages/ui 的
// useAssetRefOpen）。放这里是因为发事件的是本插件；消费方只取类型与常量，不 import 任何组件。
export { REF_CLICK_EVENT, refClickPayloadOf } from './refClickEvents.js'
export type { RefClickPayload, RefClickSource } from './refClickEvents.js'
export { AgentApi } from './agentApi.js'
export type { ChatEvent, SessionMetaView, SessionRecordView, SendOptions } from './agentApi.js'
export { ChatModel } from './sessionModel.js'
export type { AgentTurnView, ToolCard, ApprovalCard } from './sessionModel.js'
