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
  /**
   * 对应的工具调用 id（SDK 的 tool_call_id）。
   *
   * 有它就能精确找到这条工具（同名工具可能有好几个）；没有（老数据）才退回按名字找。
   */
  toolCallId?: string
  decision?: 'allow' | 'deny'
}

/**
 * 一轮里的一个「步骤」—— 只记**顺序**与**指到哪块内容**，正文/工具内容在别处。
 *
 * 为什么不能只按「文字 + 工具」两个槽累加：那样一收到工具就把顺序抹平了，
 * 界面只能把所有工具堆到开头。有了 steps，界面就能按真实时序排
 * （用户口径 2026-10-05：工具与文本有先后顺序）。
 */
export type TurnStep =
  | { type: 'text'; id: string; text: string; final?: boolean }
  | { type: 'thinking'; id: string; text: string; final?: boolean }
  | { type: 'tool'; id: string }

export interface AgentTurnView {
  id: string
  kind: 'user' | 'assistant' | 'approval'
  text: string
  /**
   * 这条消息的时间（毫秒）。用户消息 hover 显示「发出时间」用（用户口径 2026-10-06）。
   * 回放时来自转录的 ts；内存里 send() 现记。
   */
  ts?: number
  /**
   * 用户这条消息带的图片（data URL）。
   *
   * 为什么存 data URL 而不是服务端路径：Agent 的图片入口是 SDK 的 imageUrlMessage，
   * 它认 URL 或 data URL；用 data URL 就不必再开一条「先上传再引用」的链路，
   * 图就在这条消息里，回放时也照样能画出来。
   */
  images?: string[]
  /**
   * 这条用户消息是**引导**（插队进进行中的那一轮）而不是普通发送。
   *
   * 为什么要区分：引导是"插队"，与排队/直接发是三种不同的语义，界面上给它一个
   * 小标（用户口径 2026-10-08）。后端落转录时也带这个标记，回放时照样能画出来。
   */
  steered?: boolean
  thinking: string
  /** 按到达顺序的步骤（见 TurnStep）。界面据此还原「文字 / 工具」的真实时序。 */
  steps: TurnStep[]
  tools: ToolCard[]
  notice?: string
  error?: string
  streaming: boolean
  /** 审批卡片（kind='approval' 时一定有） */
  approval?: ApprovalCard
  /**
   * 这条消息**正在被编辑**（用户口径 2026-10-06：标签是「正在编辑」+ 高亮，
   * 发送后此点成为分支根）。内存态，不落盘。
   */
  editing?: boolean
}

let seq = 0
const nextId = (): string => 't' + ++seq

export class ChatModel {
  readonly turns: AgentTurnView[] = []
  /**
   * turnId → 这块（文字 / 思考）**是不是正开着**。
   *
   * 语义：收到 partial 时开一块、后续 delta 往里加；收到 final 时若有开着的块就**整块替换**
   * （delta + final 两条都来时不显示两遍 —— 这是从参考项目学来的硬要求），否则新开一块。
   * 一轮结束时全部关掉，避免下一轮的 final 误替换上一轮的尾块。
   */
  private readonly open = new Map<string, { text: boolean; thinking: boolean }>()

  /** 正在被编辑的用户消息（单选；null = 没有编辑流程） */
  editingId: string | null = null

  /** 文字/思考共用的步骤 id（工具用事件里的 id） */
  private nextStepId(turn: AgentTurnView): string {
    return 's' + (turn.steps.length + 1)
  }

  /** turn.text 由文字步骤现算 —— steps 是唯一真相，两处不会漂移 */
  private recomputeText(turn: AgentTurnView): void {
    turn.text = turn.steps
      .filter((s): s is Extract<TurnStep, { type: 'text' }> => s.type === 'text')
      .map((s) => s.text)
      .join('')
  }

  /** thinking 由思考步骤现算（同 recomputeText 的道理：steps 是唯一真相） */
  private recomputeThinking(turn: AgentTurnView): void {
    turn.thinking = turn.steps
      .filter((s): s is Extract<TurnStep, { type: 'thinking' }> => s.type === 'thinking')
      .map((s) => s.text)
      .join('')
  }

  /** 记下用户这句（可带图）并开一条空的助手消息；返回助手那条的 id */
  send(text: string, images?: string[]): string {
    const replyId = nextId()
    const now = Date.now()
    this.turns.push({
      id: nextId(),
      kind: 'user',
      text,
      ts: now,
      ...(images?.length ? { images: [...images] } : {}),
      thinking: '',
      steps: [],
      tools: [],
      streaming: false,
    })
    this.turns.push({
      id: replyId,
      kind: 'assistant',
      text: '',
      thinking: '',
      steps: [],
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

  /**
   * 后端推来的"这一轮的用户消息"⇒ 补一个用户气泡 + 开一条空的助手消息。
   *
   * 为什么要去重：用户**自己点发送**时前端已经造过气泡了，而后端这一轮也会推同一条
   * （后端不知道是谁发起的）。判据：最后一条 turn 就是 kind==='user' 且文本相同 ⇒
   * 已经造过了，只补上"还没有助手占位"的那一步。
   *
   * 为什么必须存在：队列自动发的那一条前端完全没参与 —— 不补气泡的话界面上只有
   * AI 的回答，看起来像"AI 对着空气说话"（用户实测截图）。
   */
  acceptUserMessage(text: string, images?: string[], steered?: boolean): void {
    /**
     * 去重判据：**倒数第二条**是同样的用户消息 + 最后一条是空的助手占位。
     *
     * 为什么看"倒数第二条"而不是最后一条：用户自己点发送时，`send()` 一口气推了
     * 「用户气泡 + 空的助手占位」两条 —— 后端这一轮再推同一条时，最后一条已经是
     * 那个助手占位了，只盯最后一条就判不出来，会重复长出一个用户气泡
     * （单元测试抓到的真 bug）。
     *
     * 只认"空的助手占位"（text 与 steps 都空）是关键：如果那条助手已经有内容了，
     * 说明上一轮早跑完了 —— 此时的同文本用户消息是**用户真的又发了一遍**，必须补气泡。
     */
    const n = this.turns.length
    const maybeUser = n >= 2 ? this.turns[n - 2] : undefined
    const maybeAssistant = n >= 1 ? this.turns[n - 1] : undefined
    const sameAsLastUser =
      maybeUser !== undefined &&
      maybeAssistant !== undefined &&
      maybeUser.kind === 'user' &&
      maybeUser.text === text &&
      JSON.stringify(maybeUser.images ?? []) === JSON.stringify(images ?? []) &&
      maybeAssistant.kind === 'assistant' &&
      maybeAssistant.text === '' &&
      maybeAssistant.steps.length === 0 &&
      maybeAssistant.tools.length === 0
    if (!sameAsLastUser) {
      this.turns.push({
        id: nextId(),
        kind: 'user',
        text,
        ts: Date.now(),
        ...(images?.length ? { images: [...images] } : {}),
        ...(steered ? { steered: true } : {}),
        thinking: '',
        steps: [],
        tools: [],
        streaming: false,
      })
    }
    // 无论刚造过还是已有，都要保证后面紧跟一条空的助手占位：
    // 不然随后的 text 事件会找不到"正在回复的那条"，内容就飘到上一条助手消息里去了
    // （用户实测：回答显示在了 AI 那一侧的上一条里）。
    const tail = this.turns[this.turns.length - 1]
    if (!tail || tail.kind !== 'assistant') {
      this.turns.push({
        id: nextId(),
        kind: 'assistant',
        text: '',
        thinking: '',
        steps: [],
        tools: [],
        streaming: true,
      })
    }
  }

  apply(ev: ChatEvent): void {
    switch (ev.type) {
      case 'text': {
        const turn = this.lastAssistant()
        if (!turn) return
        const marks = this.open.get(turn.id) ?? { text: false, thinking: false }
        if (ev.partial && typeof ev.delta === 'string') {
          // 正开着就往里加；没开着（新的一段文字）就新开一块
          let last = turn.steps[turn.steps.length - 1]
          if (!marks.text || !last || last.type !== 'text') {
            turn.steps.push({ type: 'text', id: this.nextStepId(turn), text: '', final: false })
            marks.text = true
            this.open.set(turn.id, marks)
            last = turn.steps[turn.steps.length - 1]
          }
          if (last.type === 'text') last.text += ev.delta
          this.recomputeText(turn)
        } else if (ev.final && typeof ev.text === 'string') {
          const last = turn.steps[turn.steps.length - 1]
          // 有开着的块 → 整块替换（delta 已经加过，再追加就显示两遍）；否则新开一块
          if (marks.text && last && last.type === 'text' && !last.final) {
            last.text = ev.text
            last.final = true
          } else {
            turn.steps.push({ type: 'text', id: this.nextStepId(turn), text: ev.text, final: true })
          }
          marks.text = false
          this.open.set(turn.id, marks)
          this.recomputeText(turn)
        }
        return
      }
      case 'thinking': {
        const turn = this.lastAssistant()
        if (!turn) return
        const marks = this.open.get(turn.id) ?? { text: false, thinking: false }
        if (ev.partial && typeof ev.delta === 'string') {
          let last = turn.steps[turn.steps.length - 1]
          if (!marks.thinking || !last || last.type !== 'thinking') {
            turn.steps.push({ type: 'thinking', id: this.nextStepId(turn), text: '', final: false })
            marks.thinking = true
            this.open.set(turn.id, marks)
            last = turn.steps[turn.steps.length - 1]
          }
          if (last.type === 'thinking') last.text += ev.delta
          this.recomputeThinking(turn)
        } else if (ev.final && typeof ev.text === 'string') {
          const last = turn.steps[turn.steps.length - 1]
          if (marks.thinking && last && last.type === 'thinking' && !last.final) {
            last.text = ev.text
            last.final = true
          } else {
            turn.steps.push({ type: 'thinking', id: this.nextStepId(turn), text: ev.text, final: true })
          }
          marks.thinking = false
          this.open.set(turn.id, marks)
          this.recomputeThinking(turn)
        }
        return
      }
      case 'tool_call': {
        const turn = this.lastAssistant()
        if (!turn) return
        turn.tools.push({ id: ev.id, name: ev.name, arguments: ev.arguments })
        turn.steps.push({ type: 'tool', id: ev.id })
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
        // 同一张卡片只画一次：刷新 / SSE 重连会把 approval_request 回放一遍
        //（它不落转录，所以重连水位推不过它），不判重就会出现两张一模一样的审批卡片。
        if (this.turns.some((t) => t.approval?.id === ev.approval.id)) return
        this.pushApprovalCard(ev.approval)
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
        // 收尾时把「正开着」的块关掉：下一轮的第一条 final 不该替换掉上一轮的尾块
        this.open.clear()
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
      /** 转录里的时间戳（用户消息 hover 显示「发出时间」用）；老数据可能没有 */
      ts?: number
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
        // 回放用转录里的真实时间（send 现记的只是回放那一刻）
        if (current && t.ts) current.ts = t.ts
        continue
      }
      if (!current) {
        // 转录以助手开头时补一条空助手（正常路径不会走到）
        const id = nextId()
        current = { id, kind: 'assistant', text: '', thinking: '', steps: [], tools: [], streaming: false }
        this.turns.push(current)
      }
      if (t.role === 'assistant') {
        current.text = current.text ? current.text + String.fromCharCode(10) + t.text : t.text
        // 每一段助手文字各自成一步：回放时「文字 / 工具 / 文字」的顺序照样还原得出来
        current.steps.push({ type: 'text', id: this.nextStepId(current), text: t.text, final: true })
      } else if (t.role === 'thinking') {
        current.steps.push({ type: 'thinking', id: this.nextStepId(current), text: t.text, final: true })
        this.recomputeThinking(current)
      } else if (t.tool) {
        // 结构化记录：还原成当时的样子（卡片还是一行、跑完没跑完），
        // 而不是一律当「正在跑、要显示成卡片」——那正是刷新后满屏转圈的根因。
        const toolId = t.tool.id || 'h' + current.tools.length
        current.tools.push({
          id: toolId,
          name: t.tool.name,
          arguments: t.tool.arguments,
          ...(t.tool.output ? { output: t.tool.output } : {}),
          ...(t.tool.card ? { card: true } : {}),
          // 历史工具一律算已完成：转录里不会有「此刻还在跑」的工具
          // （在跑的那条属于内存态，刷新后本来就没了）。
          settled: true,
        })
        current.steps.push({ type: 'tool', id: toolId })
      } else {
        // 老转录（只有一行 text）的兼容路径：至少把名字/参数拆出来，且标成**已完成** ——
        // 宁可显示成朴素的一行，也不要让历史工具全变成转圈的卡片。
        const m = /^([^(]+)\((.*)\)$/s.exec(t.text ?? '')
        const toolId = 'h' + current.tools.length
        current.tools.push({
          id: toolId,
          name: (m?.[1] ?? t.text ?? '').trim(),
          arguments: m?.[2] ?? '',
          output: '',
          settled: true,
        })
        current.steps.push({ type: 'tool', id: toolId })
      }
    }
    for (const t of this.turns) t.streaming = false
  }

  /** 有没有任何一条助手消息里有「卡片级」的工具（界面据此决定要不要留白/分组） */
  hasCard(): boolean {
    return this.turns.some((t) => t.tools.some((x) => x.card) || t.kind === 'approval')
  }

  /**
   * 补渲染**挂起中**的审批（刷新 / 切会话后）。
   *
   * 审批卡片平时是随 approval_request 事件当场画出来的，可那一路只在「审批发生的那一刻」
   * 有效 —— 页面一刷新，事件早就过去了，界面就把它丢了。而后台还停在原地等这张卡片：
   * 不补回来，这一轮永远结束不了（右下角按钮永远停在「停止」，点它也没用）。
   * GET 会话返回的 approvals 就是为这一步准备的。
   */
  restoreApprovals(
    list: Array<{ id: string; toolName: string; arguments: string; createdAt?: number; toolCallId?: string }>,
  ): void {
    for (const a of list) {
      this.apply({
        type: 'approval_request',
        approval: {
          id: a.id,
          toolName: a.toolName,
          arguments: a.arguments,
          createdAt: typeof a.createdAt === 'number' ? a.createdAt : Date.now(),
          ...(a.toolCallId ? { toolCallId: a.toolCallId } : {}),
        },
      })
    }
  }

  /**
   * 画一张审批卡片：把对应工具标成卡片，并把它插到**那条工具所属的助手回合之后**。
   *
   * 为什么不直接 push 到末尾：刷新补渲染时，审批挂起期间可能又有新消息进了转录
   *（最典型是用户在审批挂着时插队引导）—— 直接追加会让卡片跑到最后一条消息之后，
   * 与它对应的工具调用分家（代码审查实测）。按 tool_call_id 找到那条工具，
   * 卡片就插在它所在的回合后面，位置始终对得上。
   */
  private pushApprovalCard(a: { id: string; toolName: string; arguments: string; toolCallId?: string }): void {
    let ownerIdx = -1
    let tool: ToolCard | undefined
    for (let i = this.turns.length - 1; i >= 0; i--) {
      const t = this.turns[i]
      if (t.kind !== 'assistant') continue
      const hit = a.toolCallId
        ? t.tools.find((x) => x.id === a.toolCallId)
        : t.tools.find((x) => x.name === a.toolName && !x.card)
      if (hit) {
        ownerIdx = i
        tool = hit
        break
      }
    }
    if (tool) tool.card = true
    const card: AgentTurnView = {
      id: nextId(),
      kind: 'approval',
      text: '',
      thinking: '',
      steps: [],
      tools: [],
      streaming: true,
      approval: {
        id: a.id,
        toolName: a.toolName,
        arguments: a.arguments,
        ...(a.toolCallId ? { toolCallId: a.toolCallId } : {}),
      },
    }
    // 找到归属回合就插在它后面；找不到（老数据没有 id、工具也对不上）才追加到末尾
    if (ownerIdx >= 0) this.turns.splice(ownerIdx + 1, 0, card)
    else this.turns.push(card)
  }

  /** 进入编辑：这条消息高亮「正在编辑」，输入框联动标记点它可滚回这里 */
  beginEdit(turnId: string): void {
    const t = this.turns.find((x) => x.id === turnId)
    if (!t || t.kind !== 'user') return
    this.editingId = turnId
    for (const x of this.turns) x.editing = x.id === turnId
  }

  /** 取消编辑（徽标与高亮一起消失） */
  cancelEdit(): void {
    this.editingId = null
    for (const x of this.turns) x.editing = false
  }

  reset(): void {
    this.turns.length = 0
    this.open.clear()
    this.editingId = null
  }
}
