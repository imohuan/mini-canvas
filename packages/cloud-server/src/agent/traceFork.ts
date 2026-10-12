/**
 * traceFork —— 分支（fork）会话的 **SDK Trace 种子**。
 *
 * 背景（2026-10-06 P0）：fork 过去只往**前端转录**（canvases/<id>/agent/sessions/*.json）
 * 写了新会话，但 SDK 的 resumeSession 读的是它自己的 Trace 目录
 * <agentRoot>/<projectId>/agents/<agentId>/traces/<日期>/<sessionId>_<序号>.jsonl ——
 * 新 sessionId 在那里没有文件，一开口就抛「Session does not exist」。
 *
 * 修法：fork 时**同时**在这里写一份新 sessionId 的 Trace：
 *   首行 session_meta（能从父 Trace 拷就拷，拷不到就现算一份最小合法的），
 *   随后把拷贝的回合按 SDK OmniMessage 形态写成 model_msg。
 * 这样 SDK resume 的历史与界面转录逐字对齐；父 Trace 缺失（极老的会话 / 出错会话）
 * 则降级为「只有 meta」—— 模型上下文是空的，但会话照样能用，不阻塞 fork。
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { AGENT_ID, AGENT_PROJECT_ID, agentRoot, agentStateDir, canvasWorkspaceDir } from './agentPaths.js'
import type { AgentTurn } from './sessionStore.js'

/** SDK Trace 目录（与 penguin-core 的 tracesDir 同形） */
export function tracesDirOf(root: string): string {
  return path.join(agentRoot(root), AGENT_PROJECT_ID, 'agents', AGENT_ID, 'traces')
}

/** 由会话 id 推日期子目录（session-2026-10-06-… / session-2026-10-06T… 两种格式都认） */
function dateDirOf(sessionId: string): string {
  const m = /^session-(\d{4}-\d{2}-\d{2})/.exec(sessionId)
  return m ? m[1] : new Date().toISOString().slice(0, 10)
}

interface MetaPayload {
  session_id?: string
  provider?: string
  model_id?: string
  model_context_window?: number
  system_prompt?: string
  agent_state?: string
  workspace?: string
  [key: string]: unknown
}

/** 父 Trace 首行 session_meta 的 payload；读不到（缺失 / 损坏）返回 null */
async function readParentMeta(tracesDir: string, parentSessionId: string): Promise<MetaPayload | null> {
  let located: string | null = null
  try {
    const dates = await fs.readdir(tracesDir)
    for (const date of dates) {
      const dir = path.join(tracesDir, date)
      let files: string[] = []
      try {
        files = await fs.readdir(dir)
      } catch {
        continue
      }
      const hit = files.filter((f) => f.startsWith(parentSessionId + '_') && f.endsWith('.jsonl')).sort()
      if (hit.length) located = path.join(dir, hit[hit.length - 1])
    }
  } catch {
    return null
  }
  if (!located) return null
  try {
    const text = await fs.readFile(located, 'utf8')
    for (const line of text.split('\n')) {
      const s = line.trim()
      if (!s) continue
      const row = JSON.parse(s) as { type?: string; payload?: MetaPayload }
      if (row.type === 'session_meta' && row.payload) return row.payload
      // 首条非 meta 就停：meta 永远在文件头
      break
    }
  } catch {
    /* 损坏的父 Trace 按「没有 meta」处理，走降级路径 */
  }
  return null
}

/** 转录回合 → SDK OmniMessage 行（null = 这条没法表达，跳过） */
function turnToMessage(t: AgentTurn, order: number): Record<string, unknown> | null {
  const timestamp = new Date(t.ts ?? Date.now() + order).toISOString()
  if (t.role === 'user' || t.role === 'assistant') {
    return {
      timestamp,
      type: 'model_msg',
      payload: { type: 'text', role: t.role, text: t.text, stop_reason: 'completed' },
    }
  }
  if (t.role === 'thinking') {
    return {
      timestamp,
      type: 'model_msg',
      payload: { type: 'thinking', role: 'assistant', thinking: t.text, stop_reason: 'completed' },
    }
  }
  if (t.role === 'tool' && t.tool?.id) {
    const tool = t.tool
    return {
      timestamp,
      type: 'model_msg',
      payload: {
        type: 'tool_call',
        role: 'assistant',
        name: tool.name,
        arguments: tool.arguments,
        tool_call_id: tool.id,
        stop_reason: 'completed',
      },
    }
  }
  return null
}

/** 补写工具结果：output 单独一条，按 SDK 的 tool_call_output 形态 */
function toolOutputMessage(t: AgentTurn): Record<string, unknown> | null {
  if (t.role !== 'tool' || !t.tool?.id || t.tool.output === undefined) return null
  return {
    timestamp: new Date((t.ts ?? Date.now()) + 1).toISOString(),
    type: 'model_msg',
    payload: {
      type: 'tool_call_output',
      role: 'user',
      output: t.tool.output,
      tool_call_id: t.tool.id,
      stop_reason: 'completed',
    },
  }
}

export interface ForkTraceSeed {
  parentSessionId: string
  forkSessionId: string
  canvasId: string
  /** 拷进新会话的转录回合（forkFrom 已拷好的那份） */
  turns: AgentTurn[]
  /** 新会话的基本信息（父 Trace 缺失时现算 meta 用） */
  provider?: string
  modelId?: string
  log?: (message: string, extra?: unknown) => void
}

/**
 * 给 fork 出的新会话写一份 SDK Trace（新文件，wx 防覆盖）。
 * 抛错 = 写盘真的失败，调用方决定是否回滚；父 Trace 缺失走降级，不抛。
 */
export async function seedForkTrace(root: string, seed: ForkTraceSeed): Promise<string> {
  const tracesDir = tracesDirOf(root)
  const parent = await readParentMeta(tracesDir, seed.parentSessionId)
  let meta: MetaPayload
  if (parent) {
    meta = { ...parent, session_id: seed.forkSessionId }
    /**
     * 种子里给了模型引用就用它**覆盖**父 meta 的 provider / model_id。
     *
     * 为什么必须有这一步（code review 2026-10-11 抓到的 P1）：切换模型也走这条种子路，
     * 而切模型的前提恰恰是「模型要换」。父 meta 里钉的是**旧模型** —— 不覆盖的话，
     * 宿主记录、界面分段、模型下拉都显示新模型，SDK resume 出来的会话却仍向旧模型发请求，
     * 用户眼里就是「切了没效果」。
     *
     * 为什么对 fork（编辑重发）无害：fork 路由传的就是父记录的 provider/modelId，
     * 与父 meta 相同 —— 覆盖等于 no-op，语义不变。
     */
    if (seed.provider) meta.provider = seed.provider
    if (seed.modelId) meta.model_id = seed.modelId
  } else {
    seed.log?.('parent trace missing; seed minimal meta', { parent: seed.parentSessionId, fork: seed.forkSessionId })
    meta = {
      session_id: seed.forkSessionId,
      ...(seed.provider ? { provider: seed.provider } : {}),
      ...(seed.modelId ? { model_id: seed.modelId } : {}),
      agent_state: agentStateDir(root),
      workspace: canvasWorkspaceDir(root, seed.canvasId),
    }
  }
  // Trace 回合结构（penguin-core resumeTrace 只认这个）：
  //   <user model_msg> → event_msg request_begin → <assistant 输出 / tool_call / tool_call_output>
  //   → event_msg request_end(status=completed)。缺 begin/end 包裹时 resume 会把
  //   assistant 的 thinking/text 全部丢弃（实测：fork 出的会话模型看不到历史）。
  // 转录里 user 回合之后的所有条目（assistant/thinking/tool）都算同一轮的输出；
  // 下一条 user 开启新回合。
  const lines: string[] = [
    JSON.stringify({ timestamp: new Date().toISOString(), type: 'session_meta', payload: meta }),
  ]
  let inRequest = false
  const closeRequest = (): void => {
    if (!inRequest) return
    lines.push(JSON.stringify({ timestamp: new Date().toISOString(), type: 'event_msg', payload: { type: 'request_end', status: 'completed' } }))
    inRequest = false
  }
  for (const t of seed.turns) {
    if (t.role === 'user') {
      closeRequest()
      lines.push(JSON.stringify(turnToMessage(t, lines.length)!))
      inRequest = true
      lines.push(JSON.stringify({ timestamp: new Date().toISOString(), type: 'event_msg', payload: { type: 'request_begin' } }))
      continue
    }
    const msg = turnToMessage(t, lines.length)
    if (!msg) continue
    lines.push(JSON.stringify(msg))
    if (t.role === 'tool' && t.tool?.id) {
      const out = toolOutputMessage(t)
      if (out) lines.push(JSON.stringify(out))
    }
  }
  closeRequest()
  const dir = path.join(tracesDir, dateDirOf(seed.forkSessionId))
  const file = path.join(dir, seed.forkSessionId + '_001.jsonl')
  await fs.mkdir(dir, { recursive: true })
  // wx：服务侧 Trace 导入只造新文件（与 SDK 同一约定），已存在说明并发 fork，报错不覆盖
  await fs.writeFile(file, lines.join('\n') + '\n', { flag: 'wx' })
  return file
}
