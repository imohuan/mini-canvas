/** 事件合并：去重是硬要求（delta + final 不能显示两遍），另加四种状态 */
import { describe, it, expect } from 'vitest'
import { ChatModel } from '../sessionModel'

describe('审批卡片的补渲染与去重', () => {
  /**
   * 真 bug（用户实测 2026-10-10）：审批只在「发生的那一刻」经 SSE 推一次，
   * 页面刷新后事件早没了 ⇒ 后端还挂着等审批，界面上却没有卡片，
   * 这一轮永远结束不了（右下角按钮永远停在「停止」）。
   * GET 会话返回的 approvals 必须能补出一张卡片。
   */
  it('restoreApprovals：把挂起审批补成卡片（刷新后能看见）', () => {
    const m = new ChatModel()
    m.send('跑个命令')
    m.apply({ type: 'tool_call', id: 't1', name: 'exec_command', arguments: '{}' })
    m.restoreApprovals([{ id: 'ap-1', toolName: 'exec_command', arguments: '{"cmd":"ls"}', createdAt: 5 }])
    const card = m.turns.find((t) => t.kind === 'approval')
    expect(card?.approval).toMatchObject({ id: 'ap-1', toolName: 'exec_command' })
    // 没有决定 = 仍然可点（界面靠 decision 变结果态）
    expect(card?.approval?.decision).toBeUndefined()
  })

  /** 重连回放会把 approval_request 再推一遍；同一张卡片不能画两次 */
  it('同一 approval id 只画一张卡片（重连回放不重复）', () => {
    const m = new ChatModel()
    m.send('跑个命令')
    const ev = { type: 'approval_request' as const, approval: { id: 'ap-2', toolName: 'exec_command', arguments: '{}', createdAt: 1 } }
    m.apply(ev)
    m.apply(ev)
    expect(m.turns.filter((t) => t.kind === 'approval')).toHaveLength(1)
  })

  it('restoreApprovals 与随后的事件叠加也不会重复', () => {
    const m = new ChatModel()
    m.send('跑个命令')
    m.restoreApprovals([{ id: 'ap-3', toolName: 'exec_command', arguments: '{}' }])
    m.apply({ type: 'approval_request', approval: { id: 'ap-3', toolName: 'exec_command', arguments: '{}', createdAt: 1 } })
    expect(m.turns.filter((t) => t.kind === 'approval')).toHaveLength(1)
  })

  /**
   * 真缺陷（代码审查实测）：审批挂起期间用户**插队引导** ⇒ 转录里多了一条更新的消息。
   * restoreApprovals 若直接 push 到末尾，卡片会跑到那条引导之后，与它对应的工具调用分家。
   * 按 toolCallId 找到归属回合，卡片就该插在**那条工具所在回合**的后面。
   */
  it('restoreApprovals 按 toolCallId 落点（卡片不跑到后面那条消息之后）', () => {
    const m = new ChatModel()
    m.send('先跑个命令')
    m.apply({ type: 'tool_call', id: 'call-1', name: 'exec_command', arguments: '{}' })
    // 审批挂起期间，用户又插队说了一句 ⇒ 转录末尾是新的助手回合
    m.acceptUserMessage('插队的一句', undefined, true)
    m.apply({ type: 'tool_call', id: 'call-2', name: 'read_file', arguments: '{}' })
    m.restoreApprovals([{ id: 'ap-9', toolName: 'exec_command', arguments: '{}', toolCallId: 'call-1' }])
    const cardIdx = m.turns.findIndex((t) => t.kind === 'approval')
    const ownerIdx = m.turns.findIndex((t) => t.tools.some((x) => x.id === 'call-1'))
    expect(cardIdx).toBe(ownerIdx + 1)
    // 卡片一定在「插队那条」之前
    expect(cardIdx).toBeLessThan(m.turns.findIndex((t) => t.kind === 'user' && t.text === '插队的一句'))
  })

  /** 精确落到那条工具上（同名工具有好几个时不标错） */
  it('同名工具：卡片标记给 toolCallId 命中的那一条，不碰别的', () => {
    const m = new ChatModel()
    m.send('跑两个命令')
    m.apply({ type: 'tool_call', id: 'c-1', name: 'exec_command', arguments: '{"a":1}' })
    m.apply({ type: 'tool_call', id: 'c-2', name: 'exec_command', arguments: '{"b":2}' })
    m.restoreApprovals([{ id: 'ap-10', toolName: 'exec_command', arguments: '{"b":2}', toolCallId: 'c-2' }])
    const turn = m.turns.find((t) => t.kind === 'assistant')!
    expect(turn.tools.find((x) => x.id === 'c-1')?.card).toBeUndefined()
    expect(turn.tools.find((x) => x.id === 'c-2')?.card).toBe(true)
  })
})

describe('基本形态', () => {
  /**
   * 用户口径（2026-10-05）：工具与文本有先后顺序。
   * 一段文字 → 三个工具 → 再一段文字，`steps` 必须按这个顺序记下来
   * （否则界面只能把所有工具堆在开头，看不到真实时序）。
   */
  it('按到达顺序记下「文字 / 工具 / 文字」的步骤（不再丢顺序）', () => {
    const m = new ChatModel()
    const id = m.send('问')
    m.apply({ type: 'text', text: '我先说一句', final: true })
    m.apply({ type: 'tool_call', id: 't1', name: 'a', arguments: '{}' })
    m.apply({ type: 'tool_call', id: 't2', name: 'b', arguments: '{}' })
    m.apply({ type: 'text', text: '再说一句', final: true })
    const t = m.turns.find((x) => x.id === id)!
    expect(t.steps.map((s) => (s.type === 'tool' ? { type: s.type, id: s.id } : s.type))).toEqual([
      'text',
      { type: 'tool', id: 't1' },
      { type: 'tool', id: 't2' },
      'text',
    ])
    expect(t.text).toBe('我先说一句再说一句')
  })

  it('发送后立刻有用户消息与一条空的助手消息', () => {
    const m = new ChatModel()
    const id = m.send('你好')
    expect(m.turns.map((t) => t.kind)).toEqual(['user', 'assistant'])
    expect(m.turns[1].streaming).toBe(true)
    expect(m.turns[1].id).toBe(id)
  })

  it('delta 累积成正文；final 不重复追加', () => {
    const m = new ChatModel()
    const id = m.send('在吗')
    m.apply({ type: 'text', delta: '你', partial: true })
    m.apply({ type: 'text', delta: '好', partial: true })
    m.apply({ type: 'text', text: '你好', final: true })
    expect(m.turns.find((t) => t.id === id)?.text).toBe('你好')
  })

  it('只有 final（没有 delta）时整块落上', () => {
    const m = new ChatModel()
    const id = m.send('问')
    m.apply({ type: 'text', text: '完整回答', final: true })
    expect(m.turns.find((t) => t.id === id)?.text).toBe('完整回答')
  })

  it('思考走独立字段，不混进正文', () => {
    const m = new ChatModel()
    const id = m.send('问')
    m.apply({ type: 'thinking', delta: '想', partial: true })
    m.apply({ type: 'text', delta: '答', partial: true })
    const t = m.turns.find((x) => x.id === id)!
    expect(t.thinking).toBe('想')
    expect(t.text).toBe('答')
  })
})

describe('工具与审批', () => {
  it('普通工具只占一行（不是卡片）', () => {
    const m = new ChatModel()
    const id = m.send('问')
    m.apply({ type: 'tool_call', id: 't1', name: 'read_file', arguments: '{}' })
    m.apply({ type: 'tool_output', id: 't1', output: 'ok' })
    const tool = m.turns.find((x) => x.id === id)!.tools[0]
    expect(tool.card).toBeFalsy()
    expect(tool.output).toBe('ok')
    expect(m.hasCard()).toBe(false)
  })

  it('审批请求：插一条审批卡片，并把对应工具标成卡片级', () => {
    const m = new ChatModel()
    m.send('跑个命令')
    m.apply({ type: 'tool_call', id: 't1', name: 'exec_command', arguments: '{"cmd":"ls"}' })
    m.apply({
      type: 'approval_request',
      approval: { id: 'ap1', toolName: 'exec_command', arguments: '{"cmd":"ls"}', createdAt: 1 },
    })
    expect(m.turns.filter((t) => t.kind === 'approval')).toHaveLength(1)
    expect(m.turns.find((t) => t.kind === 'assistant')?.tools[0].card).toBe(true)
    expect(m.hasCard()).toBe(true)
  })

  it('审批结果落到那张卡片上（点过就变结果态）', () => {
    const m = new ChatModel()
    m.send('x')
    m.apply({ type: 'approval_request', approval: { id: 'ap1', toolName: 'exec_command', arguments: '{}', createdAt: 1 } })
    m.apply({ type: 'approval_result', id: 'ap1', decision: 'deny' })
    const card = m.turns.find((t) => t.kind === 'approval')!
    expect(card.approval?.decision).toBe('deny')
    expect(card.streaming).toBe(false)
  })

  it('notice 与 error 各归其位', () => {
    const m = new ChatModel()
    const id = m.send('问')
    m.apply({ type: 'notice', message: '已连接 MCP：smart(3 个工具)' })
    m.apply({ type: 'done' })
    const t = m.turns.find((x) => x.id === id)!
    expect(String(t.notice)).toContain('smart')
    expect(t.streaming).toBe(false)
    m.apply({ type: 'error', message: '网络断了' })
    expect(t.error).toBe('网络断了')
  })
})

describe('历史回放', () => {
  it('转录回放成消息列表（user/assistant/thinking/tool 各有所归）', () => {
    const m = new ChatModel()
    m.load([
      { role: 'user', text: '第一句' },
      { role: 'thinking', text: '想了下' },
      { role: 'tool', text: 'read_file({})' },
      { role: 'assistant', text: '回答' },
    ])
    expect(m.turns).toHaveLength(2)
    expect(m.turns[0].text).toBe('第一句')
    expect(m.turns[1].thinking).toBe('想了下')
    // 老转录（只有一行 text）现在会把名字/参数拆开：名字干净、参数单独放，
    // 而且要标成**已完成** —— 否则刷新后每条历史工具都显示成正在转圈的卡片。
    expect(m.turns[1].tools[0].name).toBe('read_file')
    expect(m.turns[1].tools[0].arguments).toBe('{}')
    expect(m.turns[1].tools[0].settled).toBe(true)
    expect(m.turns[1].text).toBe('回答')
    expect(m.turns.every((t) => !t.streaming)).toBe(true)
  })

  /**
   * 刷新后工具不能看起来「还在跑」（用户报的：图 1 里历史工具带个转圈）。
   * 结构化记录要还原成「卡片还是一行 + 已完成」，老转录也要标完成。
   */
  it('结构化工具记录还原成当时的样子（卡片/一行、已完成）', () => {
    const m = new ChatModel()
    m.load([
      { role: 'user', text: '查一下' },
      { role: 'tool', text: '', tool: { id: 't1', name: 'exec_command', arguments: '{"cmd":"ls"}', output: 'a\nb', card: true }, done: true },
      { role: 'tool', text: '', tool: { id: 't2', name: 'mcp__smart__status', arguments: '{}' }, done: true },
      { role: 'assistant', text: '好了' },
    ])
    const tools = m.turns[1].tools
    expect(tools).toHaveLength(2)
    // 卡片那条：还原 card + output
    expect(tools[0].name).toBe('exec_command')
    expect(tools[0].card).toBe(true)
    expect(tools[0].output).toBe('a\nb')
    expect(tools[0].settled).toBe(true)
    // 一行那条：没有 output 也不能是「正在跑」
    expect(tools[1].card).toBeUndefined()
    expect(tools[1].output).toBeUndefined()
    expect(tools[1].settled).toBe(true)
  })

  it('正在跑的工具（还没收到 done）不该被当成已完成', () => {
    const m = new ChatModel()
    m.send('跑个命令')
    m.apply({ type: 'tool_call', id: 't1', name: 'exec_command', arguments: '{}' })
    expect(m.turns[1].tools[0].settled).toBeUndefined()
    // 整轮结束时统一收尾
    m.apply({ type: 'done' })
    expect(m.turns[1].tools[0].settled).toBe(true)
  })

  it('reset 清空', () => {
    const m = new ChatModel()
    m.send('x')
    m.reset()
    expect(m.turns).toEqual([])
  })
})

describe('编辑状态（分支回填的第一步）', () => {
  /**
   * 用户口径（2026-10-06）：点「编辑」→ 消息上显示「**正在编辑**」徽标 + 高亮，
   * 输入框联动标记可点回这里；发送后这个点成为分支根。标签语义是「正在编辑」不是「已编辑」。
   */
  it('beginEdit / cancelEdit：正在编辑的消息 id，单选', () => {
    const m = new ChatModel()
    m.send('第一条')
    m.send('第二条')
    const target = m.turns.find((t) => t.kind === 'user' && t.text === '第一条')!
    m.beginEdit(target.id)
    expect(m.editingId).toBe(target.id)
    expect(m.turns.find((t) => t.id === target.id)?.editing).toBe(true)
    // 换一条 = 换选中（不是多选）
    const other = m.turns.find((t) => t.kind === 'user' && t.text === '第二条')!
    m.beginEdit(other.id)
    expect(m.editingId).toBe(other.id)
    expect(m.turns.find((t) => t.id === target.id)?.editing).toBe(false)
    m.cancelEdit()
    expect(m.editingId).toBeNull()
    expect(m.turns.every((t) => !t.editing)).toBe(true)
  })

  it('load 回放后 editing 全空（编辑是内存态，不落盘）', () => {
    const m = new ChatModel()
    m.load([{ role: 'user', text: 'hi', ts: 1 }])
    m.beginEdit(m.turns[0].id)
    const m2 = new ChatModel()
    m2.load([{ role: 'user', text: 'hi', ts: 1 }])
    expect(m2.editingId).toBeNull()
    expect(m2.turns.every((t) => !t.editing)).toBe(true)
  })
})
