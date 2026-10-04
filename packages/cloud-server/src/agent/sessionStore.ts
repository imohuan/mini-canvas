/**
 * AgentSessionStore —— 一个画布下的会话索引与转录（纯逻辑，注入数据根，可单测）。
 *
 * 为什么自己存一份：SDK 的 resumeSession 恢复的是模型上下文（它自己的 trace），
 * 而界面要渲染的是「我们这轮聊了什么」。两者用途不同：trace 给 SDK 续上下文，
 * 本文件给界面回放（刷新 / 重启后都读它）。
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { canvasAgentDir, canvasSessionFile, canvasSessionsDir, canvasSessionsFile } from './agentPaths.js'

export interface AgentTurn {
  role: 'user' | 'assistant' | 'thinking' | 'tool'
  text: string
  /**
   * 工具调用的结构化信息（role='tool' 时的正主）。
   *
   * 为什么不能只存 `text`（形如 `exec_command({...})`）：回放时分不出
   *   · 这条工具**还在跑**还是**早就跑完了**（界面据此画转圈还是画结果）；
   *   · 它原本是**卡片**（要审批的重活）还是**紧凑一行**。
   * 只存 text 的话，刷新后每条历史工具都会变回一个转圈的卡片（用户报的现象）。
   */
  tool?: { id: string; name: string; arguments: string; output?: string; card?: boolean }
  /** 这一轮结束时打的完成标记（没有 output 时也据此不再画转圈） */
  done?: boolean
  /**
   * 用户消息带的图片（data URL）。
   *
   * 落盘的理由：转录是给**界面回放**用的（刷新 / 切会话），图不存下来，
   * 重新打开历史就只剩一句光秃秃的文字，用户会以为图丢了。
   */
  images?: string[]
  ts: number
}

export interface AgentSessionMeta {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  provider: string
  modelId: string
  preview?: string
}

export interface AgentSessionRecord extends AgentSessionMeta {
  turns: AgentTurn[]
}

interface IndexFile {
  sessions: AgentSessionMeta[]
}

export class AgentSessionStore {
  constructor(private readonly root: string) {}

  /** 会话列表（新的在前）。索引不存在 = 还没有会话，返回空数组 */
  async list(canvasId: string): Promise<AgentSessionMeta[]> {
    const idx = await this.readIndex(canvasId)
    return [...idx.sessions].sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async get(canvasId: string, sessionId: string): Promise<AgentSessionRecord | undefined> {
    return readJson<AgentSessionRecord>(canvasSessionFile(this.root, canvasId, sessionId))
  }

  /** 落一份带元信息的转录文件；已存在则原样返回（不覆盖转录） */
  async ensure(canvasId: string, meta: Omit<AgentSessionMeta, 'updatedAt'>): Promise<AgentSessionRecord> {
    const existing = await this.get(canvasId, meta.id)
    if (existing) return existing
    const record: AgentSessionRecord = { ...meta, updatedAt: Date.now(), turns: [] }
    await this.writeRecord(canvasId, record)
    await this.upsertIndex(canvasId, record)
    return record
  }

  /** 追加一条并同步索引里的 updatedAt / preview（会话不存在时自动建） */
  async appendTurn(canvasId: string, sessionId: string, turn: AgentTurn): Promise<void> {
    let record = await this.get(canvasId, sessionId)
    if (!record) {
      record = await this.ensure(canvasId, {
        id: sessionId,
        title: '新会话',
        createdAt: turn.ts,
        provider: 'default',
        modelId: 'default',
      })
    }
    record.turns.push(turn)
    record.updatedAt = Date.now()
    if (turn.role === 'user' || turn.role === 'assistant') record.preview = turn.text.slice(0, 120)
    await this.writeRecord(canvasId, record)
    await this.upsertIndex(canvasId, record)
  }

  /**
   * 给某条工具记录补上后到的信息（目前只有 output）。
   *
   * 为什么必须**原地补**而不是新追加一条：转录回放是按顺序重演，
   * 新追加一条会让界面上出现「一个永远没结果的调用 + 一条孤立的结果」。
   * 按 tool.id 从后往前找（同一轮里 id 唯一，倒着找最快命中最新的那条）。
   */
  async patchTool(
    canvasId: string,
    sessionId: string,
    toolId: string,
    patch: Partial<NonNullable<AgentTurn['tool']>>,
  ): Promise<boolean> {
    const record = await this.get(canvasId, sessionId)
    if (!record) return false
    for (let i = record.turns.length - 1; i >= 0; i--) {
      const t = record.turns[i]
      if (t.role === 'tool' && t.tool?.id === toolId) {
        t.tool = { ...t.tool, ...patch }
        await this.writeRecord(canvasId, record)
        return true
      }
    }
    return false
  }

  /**
   * 一轮跑完：把这条会话里**所有**工具记录标成已完成。
   *
   * 为什么需要这个「兜底」：有些工具不会吐 output（比如失败被跳过、或只回一个空结果），
   * 只按 output 判断完成的话，它们刷新后会永远停在「正在执行」的转圈上。
   */
  async finishTools(canvasId: string, sessionId: string): Promise<void> {
    const record = await this.get(canvasId, sessionId)
    if (!record) return
    let changed = false
    for (const t of record.turns) {
      if (t.role === 'tool' && !t.done) {
        t.done = true
        changed = true
      }
    }
    if (changed) await this.writeRecord(canvasId, record)
  }

  /** 改标题；首句自动命名也走它 */
  async rename(canvasId: string, sessionId: string, title: string): Promise<boolean> {
    const record = await this.get(canvasId, sessionId)
    if (!record) return false
    record.title = title
    await this.writeRecord(canvasId, record)
    await this.upsertIndex(canvasId, record)
    return true
  }

  async remove(canvasId: string, sessionId: string): Promise<boolean> {
    const idx = await this.readIndex(canvasId)
    const next = idx.sessions.filter((s) => s.id !== sessionId)
    if (next.length === idx.sessions.length) return false
    await writeJson(canvasSessionsFile(this.root, canvasId), { sessions: next })
    await fs.rm(canvasSessionFile(this.root, canvasId, sessionId), { force: true })
    return true
  }

  /** 删整张画布的 agent 目录（删画布时调用；目录不存在也当成功） */
  async removeCanvas(canvasId: string): Promise<void> {
    await fs.rm(canvasAgentDir(this.root, canvasId), { recursive: true, force: true })
  }

  private async readIndex(canvasId: string): Promise<IndexFile> {
    const raw = await readJson<IndexFile>(canvasSessionsFile(this.root, canvasId))
    return { sessions: Array.isArray(raw?.sessions) ? raw.sessions : [] }
  }

  private async writeRecord(canvasId: string, record: AgentSessionRecord): Promise<void> {
    await fs.mkdir(canvasSessionsDir(this.root, canvasId), { recursive: true })
    await writeJson(canvasSessionFile(this.root, canvasId, record.id), record)
  }

  private async upsertIndex(canvasId: string, record: AgentSessionRecord): Promise<void> {
    const idx = await this.readIndex(canvasId)
    const meta: AgentSessionMeta = {
      id: record.id,
      title: record.title,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      provider: record.provider,
      modelId: record.modelId,
      ...(record.preview !== undefined ? { preview: record.preview } : {}),
    }
    const next = idx.sessions.filter((s) => s.id !== record.id)
    next.push(meta)
    await writeJson(canvasSessionsFile(this.root, canvasId), { sessions: next })
  }
}

/** 读 JSON；不存在 / 内容坏掉都返回 undefined 并出声（与 canvasStore 同口径） */
async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T
  } catch (err) {
    if (err instanceof SyntaxError) {
      console.warn('[agentSessionStore] ' + file + ' 不是合法 JSON，按缺失处理')
      return undefined
    }
    if (typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ENOENT') {
      return undefined
    }
    throw err
  }
}

/** 原子写（先临时文件再 rename），与 canvasStore 同一套做法 */
async function writeJson(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tmp = file + '.tmp-' + process.pid + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8)
  await fs.writeFile(tmp, JSON.stringify(value, null, 2), 'utf8')
  await fs.rename(tmp, file)
}
