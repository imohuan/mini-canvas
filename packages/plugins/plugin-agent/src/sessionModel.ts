/**
 * sessionModel —— 把 SSE 事件合并成界面上那一串消息（纯逻辑，零 Vue，可单测）。
 *
 * 一条**从参考项目学来的硬要求**：同一块内容既会以 delta 流式来、也会以 final 整块来，
 * 两者都追加就会让回答显示两遍（实测本项目的探针也复现了：「收到收到」）。
 * 做法：每个 turn 记一份 committed 位，首次收到 delta 就置位；
 * final 到来时若已置位则**整块替换**（不是追加），未置位才整块落上。
 *
 * 一次对话里会出现四种东西（用户点名的四种状态）：
 * 1. 思考        —— turn.thinking（可折叠）
 * 2. 普通对话    —— turn.text（Markdown 渲染）
 * 3. 工具卡片    —— turn.tools 里的 card=true 那些（要审批/重活）；其余是紧凑一行
 * 4. 审批卡片    —— kind='approval' 的独立一条（点允许/拒绝后变成结果态）
 */
import type { ChatEvent } from './agentApi.js'

export interface ToolCard {
  id: string
  name: string
  arguments: string
  output?: string
  /** 是否显示成「卡片」（其余工具只占一行，界面更简洁） */
  card?: boolean
  /**
   * 这条工具**已经结束**（拿到结果，或整轮收尾时被标记）。
   *
   * 界面的转圈只认这个位：没有它就画「正在执行」。回放老转录时也要显式给上，
   * 否则历史里的卡片会全部停在转圈状态（用户报的「刷新后像在加载」）。
   */
  settled?: boolean
}

export interface ApprovalCard {
  id: string
  toolName: string
  arguments: string
  decision?: 'allow' | 'deny'
}

export interface AgentTurnView {
  id: string
  kind: 'user' | 'assistant' | 'approval'
  text: string
  /**
   * 用户这条消息带的图片（data URL）。
   *
   * 为什么存 data URL 而不是服务端路径：Agent 的图片入口是 SDK 的 imageUrlMessage，
   * 它认 URL 或 data URL；用 data URL 就不必再开一条「先上传再引用」的链路，
   * 图就在这条消息里，回放时也照样能画出来。
   */
  images?: string[]
  thinking: string
  tools: ToolCard[]
  notice?: string
  error?: string
  streaming: boolean
  /** 审批卡片（kind='approval' 时一定有） */
  approval?: ApprovalCard
}

let seq = 0
const nextId = (): string => 't' + ++seq

export class ChatModel {
  readonly turns: AgentTurnView[] = []
  /** turnId → 该块是否已被 delta 写过（决定 final 是替换还是落上） */
  private readonly committed = new Map<string, { text: boolean; thinking: boolean }>()

  private markDue(id: string, key: 'text' | 'thinking'): void {
    const cur = this.committed.get(id) ?? { text: false, thinking: false }
    cur[key] = true
    this.committed.set(id, cur)
  }

  /** 记下用户这句（可带图）并开一条空的助手消息；返回助手那条的 id */
  send(text: string, images?: string[]): string {
    const replyId = nextId()
    this.turns.push({
      id: nextId(),
      kind: 'user',
      text,
      ...(images?.length ? { images: [...images] } : {}),
      thinking: '',
      tools: [],
      streaming: false,
    })
    this.turns.push({
      id: replyId,
      kind: 'assistant',
      text: '',
      thinking: '',
      tools: [],
      streaming: true,
    })
    return replyId
  }

  private lastAssistant(): AgentTurnView | undefined {
    for (let i = this.turns.length - 1; i >= 0; i--) {
      if (this.turns[i].kind === 'assistant') return this.turns[i]
    }
    return undefined
  }

  apply(ev: ChatEvent): void {
    switch (ev.type) {
      case 'text': {
        const turn = this.lastAssistant()
        if (!turn) return
        const marks = this.committed.get(turn.id) ?? { text: false, thinking: false }
        if (ev.partial && typeof ev.delta === 'string') {
          this.markDue(turn.id, 'text')
          turn.text += ev.delta
        } else if (ev.final && typeof ev.text === 'string') {
          turn.text = marks.text ? ev.text : turn.text + ev.text
        }
        return
      }
      case 'thinking': {
        const turn = this.lastAssistant()
        if (!turn) return
        const marks = this.committed.get(turn.id) ?? { text: false, thinking: false }
        if (ev.partial && typeof ev.delta === 'string') {
          this.markDue(turn.id, 'thinking')
          turn.thinking += ev.delta
        } else if (ev.final && typeof ev.text === 'string') {
          turn.thinking = marks.thinking ? ev.text : turn.thinking + ev.text
        }
        return
      }
      case 'tool_call': {
        this.lastAssistant()?.tools.push({ id: ev.id, name: ev.name, arguments: ev.arguments })
        return
      }
      case 'tool_output': {
        const turn = this.lastAssistant()
        const tool = turn?.tools.find((t) => t.id === ev.id)
        if (tool) {
          tool.output = ev.output
          tool.settled = true
        }
        return
      }
      case 'approval_request': {
        // 审批卡片单独一条，插在当前回复之后；同时把对应工具标成「要显示成卡片」
        const turn = this.lastAssistant()
        const tool = turn?.tools.find((t) => t.name === ev.approval.toolName && !t.card)
        if (tool) tool.card = true
        this.turns.push({
          id: nextId(),
          kind: 'approval',
          text: '',
          thinking: '',
          tools: [],
          streaming: true,
          approval: {
            id: ev.approval.id,
            toolName: ev.approval.toolName,
            arguments: ev.approval.arguments,
          },
        })
        return
      }
      case 'approval_result': {
        const card = this.turns.find((t) => t.approval?.id === ev.id)
        if (card?.approval) {
          card.approval.decision = ev.decision
          card.streaming = false
        }
        return
      }
      case 'notice': {
        const turn = this.lastAssistant()
        if (turn) turn.notice = ev.message
        return
      }
      case 'error': {
        const turn = this.lastAssistant()
        if (turn) {
          turn.error = ev.message
          turn.streaming = false
        }
        return
      }
      case 'done': {
        for (const t of this.turns) {
          if (t.kind === 'assistant') t.streaming = false
          // 整轮结束：还没标完成的工具一律收尾，别让转圈一直转下去
          for (const tool of t.tools) tool.settled = true
        }
        return
      }
      default:
        return
    }
  }

  /** 把历史转录回放成消息列表（刷新 / 切会话时用） */
  load(
    turns: Array<{
      role: string
      text: string
      images?: string[]
      tool?: { id: string; name: string; arguments: string; output?: string; card?: boolean }
      done?: boolean
    }>,
  ): void {
    this.reset()
    let current: AgentTurnView | undefined
    for (const t of turns) {
      if (t.role === 'user') {
        // send 会同时建出「用户那条」与「空的助手那条」，助手那条就是后面几条的落点
        const replyId = this.send(t.text, t.images)
        current = this.turns.find((x) => x.id === replyId)
        continue
      }
      if (!current) {
        // 转录以助手开头时补一条空助手（正常路径不会走到）
        const id = nextId()
        current = { id, kind: 'assistant', text: '', thinking: '', tools: [], streaming: false }
        this.turns.push(current)
      }
      if (t.role === 'assistant') current.text = current.text ? current.text + String.fromCharCode(10) + t.text : t.text
      else if (t.role === 'thinking') current.thinking += t.text
      else if (t.tool) {
        // 结构化记录：还原成当时的样子（卡片还是一行、跑完没跑完），
        // 而不是一律当「正在跑、要显示成卡片」——那正是刷新后满屏转圈的根因。
        current.tools.push({
          id: t.tool.id || 'h' + current.tools.length,
          name: t.tool.name,
          arguments: t.tool.arguments,
          ...(t.tool.output ? { output: t.tool.output } : {}),
          ...(t.tool.card ? { card: true } : {}),
          // 历史工具一律算已完成：转录里不会有「此刻还在跑」的工具
          // （在跑的那条属于内存态，刷新后本来就没了）。
          settled: true,
        })
      } else {
        // 老转录（只有一行 text）的兼容路径：至少把名字/参数拆出来，且标成**已完成** ——
        // 宁可显示成朴素的一行，也不要让历史工具全变成转圈的卡片。
        const m = /^([^(]+)\((.*)\)$/s.exec(t.text ?? '')
        current.tools.push({
          id: 'h' + current.tools.length,
          name: (m?.[1] ?? t.text ?? '').trim(),
          arguments: m?.[2] ?? '',
          output: '',
          settled: true,
        })
      }
    }
    for (const t of this.turns) t.streaming = false
  }

  /** 有没有任何一条助手消息里有「卡片级」的工具（界面据此决定要不要留白/分组） */
  hasCard(): boolean {
    return this.turns.some((t) => t.tools.some((x) => x.card) || t.kind === 'approval')
  }

  reset(): void {
    this.turns.length = 0
    this.committed.clear()
  }
}
