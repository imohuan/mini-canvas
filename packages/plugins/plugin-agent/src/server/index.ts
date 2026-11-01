/**
 * plugin-agent 的**后台入口**（server 侧门面）。
 *
 * 谁用：
 *   - cloud-server：`assembleAgentServices({ ports })` 建服务组，`createAgentPlugins(ctx)` 挂路由；
 *   - 打单文件产物（`pnpm build:server`）时，esbuild 从本文件出发，把 Agent 后台整棵依赖树打进一份
 *     `dist/server.js`，交给宿主的 server-plugins 目录加载。
 *
 * 刻意**不导出**插件前端那半边（Vue 组件）：后台产物里不能带 DOM，也不该拖进 vue。
 */
export { assembleAgentServices, type AgentServices, type AssembleAgentOptions } from './agent/assembleAgent.js'
export type { AgentHostPorts, AgentKvPort, AgentPromptSectionView, AgentTurnEnvelope, AgentTurnOutcome } from './ports.js'
export { agentPlugins, createAgentSessionPlugin, AGENT_SERVICES } from './routes/plugin.js'
export { canvasDir, isSafeCanvasId, agentRoot, agentDirPath, sessionScratchpadPath, AGENT_ID, AGENT_PROJECT_ID } from './agent/agentPaths.js'
export { setVendorPluginsDir, vendorPluginsDir } from './agent/vendorPlugins.js'
