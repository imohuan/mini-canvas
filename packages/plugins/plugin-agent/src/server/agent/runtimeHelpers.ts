/**
 * AgentRuntime 共用的纯函数与路径导出。
 *
 * 从 runtime.ts 原样搬出：函数体、导出名与导入路径未改。
 */
import path from 'node:path'
import { AGENT_ID, AGENT_PROJECT_ID, agentRoot, canvasWorkspaceDir } from './agentPaths.js'
import { namesOfKind, stripMarkupToPlain } from './referenceMarkup.js'
import type { SessionPrefs } from './runtimeTypes.js'

/**
 * 会话的**即时名**（首轮首句剥标记后截 24 字）—— 这份公式全仓只有这一份。
 *
 * 为什么必须单份：落盘名用 maybeAutoTitle、AI 起名的「是否已被用户改过」判定用
 * spawnBackgroundTitle，两处比对的是同一个字符串。公式各写一份的话，改了一处忘另一处，
 * 判定永假 → 会话永远不被 AI 改名（审查发现的隐患）。
 */
export function immediateTitleOf(firstText: string): string {
  return stripMarkupToPlain(firstText).trim().replace(/\s+/g, ' ').slice(0, 24)
}

/**
 * 把一段小节渲染成 `# 标题 + 正文`，但**正文自带同名标题时不重复加**。
 *
 * 为什么要这一条：引用标记说明的正文第一行本来就是 `## 引用标记（引用元素）`，
 * 再加一遍标题，模型会看到连着两行几乎一样的标题（真机组装出来实测到了）。
 * 判据只认「第一行是标题且文字与 title 相同」—— 正文里别处出现同名标题不算。
 */
export function renderSection(title: string, text: string): string {
  const firstLine = text.split('\n', 1)[0] ?? ''
  const headed = /^#{1,6}\s+/.test(firstLine) && firstLine.replace(/^#{1,6}\s+/, '').trim() === title.trim()
  return headed ? text : '# ' + title + '\n' + text
}

/**
 * 把正文标记里声明的 MCP 并进这次会话的 prefs。
 *
 * 为什么还要保留显式 prefs：老客户端 / 中间件仍可能直接传 mcpServers。
 * 两条来源合并去重 —— 标记是「这轮正文里写了什么」，prefs 是「调用方额外指定了什么」。
 * 都没有时返回原值（undefined 或空），让 ensureSession 走「全部已配置」的默认路径。
 */
export function mergeMarkupPrefs(prefs: SessionPrefs | undefined, text: string): SessionPrefs | undefined {
  // 工具级引用（name 形如 `服务.工具`）只取服务段：system_config 只认服务名，
  // 工具全名模型从标记 value（`mcp__服务__工具`）里读，不需要进过滤名单。
  const fromMarkup = namesOfKind(text, 'mcp').map((n) => n.split('.')[0]!)
  if (!fromMarkup.length) return prefs
  const merged = [...new Set([...(prefs?.mcpServers ?? []), ...fromMarkup])]
  return { ...(prefs ?? {}), mcpServers: merged }
}

/** 与 agentRoot 一起导出，路由层建 agent 时要用 */
export { agentRoot, AGENT_ID, AGENT_PROJECT_ID }

/** 会话工作目录（路由层也会用到） */
export function sessionWorkspaceDir(root: string, canvasId: string): string {
  return canvasWorkspaceDir(root, canvasId)
}

/** 便于调用方判断路径归属 */
export function agentDataRoot(root: string): string {
  return agentRoot(root)
}

/** 供路由层拼技能路径 */
export function skillsRoot(root: string): string {
  return path.join(agentRoot(root), AGENT_PROJECT_ID, 'agents', AGENT_ID, 'agent_state', 'skills')
}

