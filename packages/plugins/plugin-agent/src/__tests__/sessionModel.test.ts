/** 事件合并：去重是硬要求（delta + final 不能显示两遍），另加四种状态 */
import { describe, it, expect } from 'vitest'
import { ChatModel } from '../sessionModel'

describe('基本形态', () => {
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
