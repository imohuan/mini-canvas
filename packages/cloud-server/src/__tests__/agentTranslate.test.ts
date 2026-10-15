/** SDK 消息 → 前端事件：重点是「成功不误报」与「用量能算出剩余百分比」 */
import { describe, it, expect } from 'vitest'
import { createTranslateState, translateMessage, contextLeftPercent, normalizeContextWindow } from '../agent/translate'

const model = (payload: Record<string, unknown>) => ({ type: 'model_msg', payload })
const event = (payload: Record<string, unknown>) => ({ type: 'event_msg', payload })

describe('模型消息', () => {
  it('delta 与完整块分别出 partial / final（去重交给前端）', () => {
    const st = createTranslateState()
    expect(translateMessage(model({ type: 'partial_text', event_type: 'delta', text: '你' }), st)).toEqual([
      { type: 'text', delta: '你', partial: true },
    ])
    expect(translateMessage(model({ type: 'text', text: '你好' }), st)).toEqual([
      { type: 'text', text: '你好', final: true },
    ])
  })

  it('thinking 与 tool_call / tool_output', () => {
    const st = createTranslateState()
    expect(translateMessage(model({ type: 'thinking', thinking: '想好了' }), st)).toEqual([
      { type: 'thinking', text: '想好了', final: true },
    ])
    expect(
      translateMessage(model({ type: 'tool_call', tool_call_id: 't1', name: 'read_file', arguments: '{}' }), st),
    ).toEqual([{ type: 'tool_call', id: 't1', name: 'read_file', arguments: '{}' }])
    expect(translateMessage(model({ type: 'tool_call_output', tool_call_id: 't1', output: 'ok' }), st)).toEqual([
      { type: 'tool_output', id: 't1', output: 'ok' },
    ])
  })

  it('没见过的模型消息类型：出声但不产出事件', () => {
    const st = createTranslateState()
    const warned: string[] = []
    expect(translateMessage(model({ type: 'brand_new' }), st, (m) => warned.push(m))).toEqual([])
    expect(warned).toHaveLength(1)
  })

  /**
   * 真 bug（2026-10-09 真机）：目标的 harness 协议文本（sender:'harness' 的用户文本）
   * 被原样当成**助手文本**，于是转录里夹进了一堆
   * 「This message was sent automatically by goal mode: work toward the objective…」，
   * 界面也跟着显示。它不是助手说的话，必须挡在翻译层之外。
   */
  it('harness 注入的用户文本（sender 非 user）不当成助手文本', () => {
    const st = createTranslateState()
    const out = translateMessage(
      model({ type: 'text', role: 'user', sender: 'harness', text: 'This message was sent automatically by goal mode' }),
      st,
    )
    expect(out).toEqual([])
  })

  it('server / parent_agent 注入的用户文本同样不透明成助手文本', () => {
    const st = createTranslateState()
    for (const sender of ['server', 'parent_agent']) {
      expect(translateMessage(model({ type: 'text', role: 'user', sender, text: 'x' }), st)).toEqual([])
    }
  })

  /**
   * 真 bug（2026-10-16 真机截图）：队列自动发的那条经 SDK steering 投递后，
   * trace 里的用户文本带 [user_steering] 块但没有 sender 戳（userText 不带第二参
   * 时不写 sender）—— 旧条件只挡 sender!==undefined 的，这条漏网，
   * 被当成助手正文追加到错误卡片下面显示（用户看到裸标记块）。
   * 用户文本（role:user）不管有没有 sender 都不是助手说的话，一律不进助手流。
   */
  it('没有 sender 戳的用户文本（steering 块）也不当助手文本', () => {
    const st = createTranslateState()
    const out = translateMessage(
      model({ type: 'text', role: 'user', text: '[user_steering]\n我已经点击了呀，为什么没反应\n[/user_steering]' }),
      st,
    )
    expect(out).toEqual([])
  })
})

describe('事件消息', () => {
  it('request_end 成功 / 用户中止都不说话', () => {
    const st = createTranslateState()
    expect(translateMessage(event({ type: 'request_end', status: 'completed' }), st)).toEqual([])
    expect(translateMessage(event({ type: 'request_end', status: 'aborted' }), st)).toEqual([])
  })

  it('request_end 失败：fatal 报错、可重试只提示', () => {
    const st = createTranslateState()
    const fatal = translateMessage(event({ type: 'request_end', status: 'fatal', error_message: '密钥无效' }), st)
    expect(fatal[0].type).toBe('error')
    expect(String((fatal[0] as { message: string }).message)).toContain('密钥无效')
    const retry = translateMessage(event({ type: 'request_end', status: 'retryable', error_message: '超时' }), st)
    expect(retry[0].type).toBe('notice')
  })

  it('MCP 连不上时把原因说出来（否则用户只看到模型没工具）', () => {
    const st = createTranslateState()
    const out = translateMessage(
      event({ type: 'mcp_connect_end', results: [{ server: 'smart', status: 'error', error: 'ECONNREFUSED' }] }),
      st,
    )
    expect(out[0].type).toBe('error')
    expect(String((out[0] as { message: string }).message)).toContain('smart')
    const ok = translateMessage(
      event({ type: 'mcp_connect_end', results: [{ server: 'smart', status: 'completed', tools: 7 }] }),
      st,
    )
    expect(ok[0]).toEqual({ type: 'notice', message: '已连接 MCP：smart(7 个工具)' })
  })
})

describe('上下文用量', () => {
  it('session_meta 记下模型窗口', () => {
    const st = createTranslateState()
    translateMessage({ type: 'session_meta', payload: { session_id: 's1', model_context_window: 1048576 } }, st)
    expect(st.contextWindow).toBe(1048576)
    expect(normalizeContextWindow('262144')).toBe(262144)
    expect(normalizeContextWindow('unknown')).toBeNull()
  })

  it('token_usage 产出 usage 事件，分母取窗口与压缩阈值的小者', () => {
    const st = createTranslateState()
    translateMessage({ type: 'session_meta', payload: { session_id: 's1', model_context_window: 1_048_576 } }, st)
    const out = translateMessage(
      event({ type: 'token_usage', session: { total: 999 }, request: { total: 256_000 } }),
      st,
    )
    // spent = 这次请求的**实际花费**（total − cache_read）；没给 cache_read 就当 0 ⇒ 等于 total。
    // 界面靠它把目标的「已用」跟着每次请求实时加上（用户口径 2026-10-11）。
    expect(out).toEqual([{ type: 'usage', usedTokens: 256_000, limitTokens: 256_000, spent: 256_000 }])
    expect(contextLeftPercent(256_000, 256_000)).toBe(0)
    expect(contextLeftPercent(128_000, 256_000)).toBe(50)
    expect(contextLeftPercent(1, null)).toBeNull()
  })

  it('spent 扣掉 cache_read（与 goal 插件的记账同口径）', () => {
    const st = createTranslateState()
    const out = translateMessage(
      event({ type: 'token_usage', session: { total: 1 }, request: { total: 10_000, cache_read: 6_000 } }),
      st,
    )
    expect(out).toEqual([{ type: 'usage', usedTokens: 10_000, limitTokens: 256_000, spent: 4_000 }])
  })
})

/**
 * 压缩事件（用户口径 2026-10-11）。
 *
 * 为什么必须有这条翻译：SDK 的 compaction 默认开着（阈值 256k），它会在用户没打招呼的
 * 时候自己把历史总结掉；主动压缩（「压缩」命令）更是点了就要有回音 ——
 * 不翻这两个事件，界面上两种情况都是"毫无动静"，用户只会觉得对话忽然失忆。
 */
describe('上下文压缩事件', () => {
  it('compaction_begin 翻成 compact/begin（带 reason 与 mode）', () => {
    const st = createTranslateState()
    expect(
      translateMessage(event({ type: 'compaction_begin', reason: 'manual', mode: 'summarize', context: 180_000, turns: 12 }), st),
    ).toEqual([{ type: 'compact', phase: 'begin', reason: 'manual', mode: 'summarize', context: 180_000 }])
  })

  it('compaction_end 翻成 compact/end（completed = 压成功；其它 = 放弃并带原因）', () => {
    const st = createTranslateState()
    expect(translateMessage(event({ type: 'compaction_end', reason: 'manual', mode: 'summarize', status: 'completed' }), st)).toEqual([
      { type: 'compact', phase: 'end', reason: 'manual', mode: 'summarize', status: 'completed' },
    ])
    const failed = translateMessage(
      event({ type: 'compaction_end', reason: 'context', mode: 'summarize', status: 'retryable', error_message: '超时' }),
      st,
    )
    expect(failed[0]).toMatchObject({ type: 'compact', phase: 'end', status: 'retryable', error: '超时' })
  })
})
