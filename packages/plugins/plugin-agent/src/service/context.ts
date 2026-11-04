import type { AgentApi, ChatEvent, SendOptions } from '../api/agentApi.js'
import type { ChatModel } from '../model/sessionModel.js'
import type { AgentServiceState } from './types.js'

/** 默认画布 id（宿主没有经 setCanvasId 喂进来时回落它） */
export const CANVAS_ID = 'default'

/** 首屏装载的转录条数（一轮对话占好几条；30 条约等于最后三四轮，用户口径 2026-10-15） */
export const TURNS_PAGE = 30

/** 各域共用的服务内部状态 */
export interface AgentServiceContext {
  state: AgentServiceState
  api: AgentApi
  model: ChatModel
  /** send / sendGoal 共用的“我主动停这一轮”句柄（保持原父闭包变量） */
  abortRef: { value: AbortController | null }
  /** 帧级水位（send / 常驻流 / 压缩共用；保持原父闭包变量） */
  seqRef: { value: number }
  canvasId(): string
  currentSessionId(): string | null
  sync(): void
  setError(message: string): void
}

/** 跨域方法：装配时一次性填好，调用时机都在 createAgentService 返回之后 */
export interface AgentServiceDeps {
  applyEvent(ev: ChatEvent): void
  acceptSeq(seq: number): boolean
  attachStream(sessionId: string): void
  detachStream(): void
  refresh(): Promise<void>
  restoreCurrentSession(): Promise<void>
  listSessions(): Promise<void>
  refreshPagers(): Promise<void>
  newSession(): Promise<void>
  openSession(id: string): Promise<void>
  ensureSession(): Promise<string | null>
  sendOptions(): SendOptions
  send(text: string, images?: string[]): Promise<void>
  cancelEdit(): void
  activePromptText(): string
  ensurePromptFresh(): Promise<void>
  setActivePrompt(id: string): Promise<void>
  loadPrompts(): Promise<void>
  cancelAllEdits(sessionId: string): Promise<void>
  retireSendingItemOnUserMessage(text: string, images?: string[]): void
}

