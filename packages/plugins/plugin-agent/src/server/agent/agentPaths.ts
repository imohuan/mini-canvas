/**
 * agent 子系统的路径推导（纯函数，零依赖）。
 *
 * 两类数据落点不同，本文件把这件事钉在一处：
 * - 全局配置（模型 / 技能 / MCP）→ <root>/agent/<projectId>/agents/<agentId>/agent_state，
 *   与 penguin SDK 自己算的路径必须逐字一致（否则我们写一份、SDK 读另一份）。
 * - 会话（转录 + 索引 + 工作目录）→ <root>/canvases/<canvasId>/agent/，
 *   跟着画布走：删画布 = 删这个目录。
 */
import path from 'node:path'
import os from 'node:os'

/**
 * 画布 id 白名单：字母 / 数字 / 下划线 / 连字符，1-64 位。
 *
 * 这里**故意复制**宿主 canvasPaths 的同名规则，而不是 import 它：
 * Agent 后台现在是插件的后台半，要能独立打单文件产物（不能 import 宿主包）。
 * 规则漂了会被 Agent 侧的路径单测抓到（非法 id 必须抛错）。
 */
const CANVAS_ID_RE = /^[A-Za-z0-9_-]{1,64}$/

export function isSafeCanvasId(id: string): boolean {
  return CANVAS_ID_RE.test(id)
}

/**
 * 某个画布的目录：`<root>/canvases/<canvasId>`。
 *
 * 与宿主布局逐字一致（画布的存档、资源、会话都在这棵树下）。
 * 只拼路径、不读不写；id 先过白名单，拼不出子目录也逃不出根。
 */
export function canvasDir(root: string, id: string): string {
  if (!isSafeCanvasId(id)) throw new Error('[agentPaths] 非法画布 id: ' + id)
  return path.join(root, 'canvases', id)
}

/** penguin 项目 id（全局一个；模型/技能/MCP 都挂它下面） */
export const AGENT_PROJECT_ID = 'plume-canvas'
/** Agent id（全局一个；会话不按 agent 分，按画布分） */
export const AGENT_ID = 'canvas-agent'

/** 全部 agent 数据的根：SDK 的 root 参数就是它 */
export function agentRoot(root: string): string {
  return path.join(root, 'agent')
}

/** <agentRoot>/<projectId>/agents/<agentId> */
export function agentDirPath(root: string): string {
  return path.join(agentRoot(root), AGENT_PROJECT_ID, 'agents', AGENT_ID)
}

/** <agentDir>/agent_state（与 SDK 的 agentStateDir 同形） */
export function agentStateDir(root: string): string {
  return path.join(agentDirPath(root), 'agent_state')
}

/**
 * 一键导入技能的候选来源目录。
 *
 * 默认扫用户自己的技能收藏夹；测试里经 createCloudServer 的 agentSkillSources 覆盖，
 * 不去读真实家目录。
 */
export function agentSkillSources(): string[] {
  const home = process.env.USERPROFILE ?? process.env.HOME ?? os.homedir()
  return [path.join(home, '.agents', 'skills')]
}

/** 会话 id 白名单：字母数字下划线连字符，1-128 位（SDK 的 session-2026-... 形态），拒 .. */
export function isSafeSessionId(id: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(id)
}

/** <root>/canvases/<canvasId>/agent */
export function canvasAgentDir(root: string, canvasId: string): string {
  if (!isSafeCanvasId(canvasId)) throw new Error('[agentPaths] 非法画布 id: ' + canvasId)
  return path.join(canvasDir(root, canvasId), 'agent')
}

export function canvasSessionsFile(root: string, canvasId: string): string {
  return path.join(canvasAgentDir(root, canvasId), 'sessions.json')
}

export function canvasSessionsDir(root: string, canvasId: string): string {
  return path.join(canvasAgentDir(root, canvasId), 'sessions')
}

export function canvasSessionFile(root: string, canvasId: string, sessionId: string): string {
  if (!isSafeSessionId(sessionId)) throw new Error('[agentPaths] 非法会话 id: ' + sessionId)
  return path.join(canvasSessionsDir(root, canvasId), sessionId + '.json')
}

/** 会话的工作目录（Agent 的文件类工具被限制在本画布目录内） */
export function canvasWorkspaceDir(root: string, canvasId: string): string {
  return path.join(canvasAgentDir(root, canvasId), 'workspace')
}

/**
 * SDK 的**会话草稿目录**（scratchpad），本仓库侧的路径推导。
 *
 * 与 SDK 的 `sessionScratchpadDir(root, projectId, agentId, sessionId)` 必须逐字一致
 * （否则我们读一份、SDK 与插件写另一份）：`<root>/<projectId>/agents/<agentId>/scratchpad/<sessionId>`。
 * 目标的 GOAL.json 就落在这里（插件约定）。
 */
export function sessionScratchpadPath(root: string, sessionId: string): string {
  if (!isSafeSessionId(sessionId)) throw new Error('[agentPaths] 非法会话 id: ' + sessionId)
  /**
   * 与 SDK 的 `sessionScratchpadDir(root, projectId, agentId, sessionId)` **逐字同形**：
   *   `<root>/<projectId>/agents/<agentId>/scratchpad/<sessionId>`
   * 其中 `root` 是 **SDK 口径的 root**（= 本仓的 `agentRoot(dataDir)`），
   * SDK 内部就是从这个 root 起拼 projectId / agents / agentId 三段的。
   *
   * 踩过的坑（真机）：这里曾经走 `agentStateDir(root)` —— 那个函数期望的是**数据根**、
   * 自己会再拼一层 `agent/`，于是传 SDK root 进去就拼成了
   * `<dataDir>/agent/agent/<projectId>/...`（多一层）：GOAL.json 写到那个假目录里，
   * 插件在真目录里读不到 ⇒ 目标永远不结束、界面也永远看不到目标状态。
   * 所以这里**不复用**任何别的路径函数，按 SDK 的公式逐段拼，一眼能对上。
   */
  return path.join(root, AGENT_PROJECT_ID, 'agents', AGENT_ID, 'scratchpad', sessionId)
}
