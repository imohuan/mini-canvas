/**
 * test 模型的节奏指令（用户口径 2026-10-09 第二版）。
 *
 * 用户原话：「你这个测试模型，它的响应速度太快了……我希望你的后台能够解析我发送的文本，
 *   比如说我会发送让你这个模型持续跑多久？你给我定一个规则，然后进行解析。
 *   我发送这条消息之后，你就会解析出这次的流需要多久才能完整返回。
 *   而且，我还可以自定义返回结果。」
 */
import { describe, it, expect } from 'vitest'
import {
  parseTimeToken,
  analyzeTestRequest,
  buildReply,
  planStream,
  DEFAULT_GAP_MS,
} from '../agent/testModel'

describe('parseTimeToken：时间词 → 毫秒', () => {
  it('无单位按秒', () => {
    expect(parseTimeToken('8')).toBe(8000)
    expect(parseTimeToken('0.5')).toBe(500)
  })
  it('带单位', () => {
    expect(parseTimeToken('8s')).toBe(8000)
    expect(parseTimeToken('800ms')).toBe(800)
    expect(parseTimeToken('2分')).toBe(120000)
    expect(parseTimeToken('1.5秒')).toBe(1500)
  })
  it('解析不了 → null（不瞎猜）', () => {
    expect(parseTimeToken('abc')).toBeNull()
    expect(parseTimeToken('')).toBeNull()
  })
})

describe('analyzeTestRequest：从消息里解析指令', () => {
  const msg = (text: string) => ({ messages: [{ role: 'user', content: text }] })

  it('没有指令 → 全 null，正文原样', () => {
    const r = analyzeTestRequest(msg('随便说点什么'))
    expect(r.directive).toEqual({ durationMs: null, gapMs: null, text: null })
    expect(r.cleanText).toBe('随便说点什么')
  })

  it('时长（中文键，单独一行）', () => {
    const r = analyzeTestRequest(msg('::test 时长=8s::'))
    expect(r.directive.durationMs).toBe(8000)
  })

  it('简写：::test 8s::', () => {
    expect(analyzeTestRequest(msg('::test 8s::')).directive.durationMs).toBe(8000)
  })

  it('间隔 + 自定义内容', () => {
    const r = analyzeTestRequest(msg('::test 间隔=200ms 内容=我是自定义回复::'))
    expect(r.directive.gapMs).toBe(200)
    expect(r.directive.text).toBe('我是自定义回复')
  })

  it('指令会从回显正文里剥掉', () => {
    const r = analyzeTestRequest(msg('::test 时长=1s:: 真正的正文'))
    expect(r.cleanText).not.toContain('::test')
    expect(r.cleanText).toContain('真正的正文')
  })

  it('指令在多条消息里也能找到（取带指令的那条）', () => {
    const r = analyzeTestRequest({
      messages: [
        { role: 'user', content: '::test 3s:: 干活' },
        { role: 'assistant', content: '好的' },
        { role: 'user', content: '继续' },
      ],
    })
    expect(r.directive.durationMs).toBe(3000)
  })
})

describe('planStream：按指令把流拉长', () => {
  it('给了时长 ⇒ 所有分片等待之和 ≈ 时长', () => {
    const reply = 'x'.repeat(60) // 10 片（每片 6 字）
    const plan = planStream('test模型', reply, { durationMs: 1000, gapMs: null, text: null })
    expect(plan.chunkCount).toBe(10)
    expect(plan.totalMs).toBeCloseTo(1000, 0)
    const waited = plan.waits.reduce((a, b) => a + b, 0)
    expect(waited).toBeCloseTo(1000, 0)
  })

  it('只给间隔 ⇒ 每片都等那么久', () => {
    const plan = planStream('test模型', 'x'.repeat(24), { durationMs: null, gapMs: 50, text: null })
    expect(plan.gapMs).toBe(50)
    expect(plan.totalMs).toBe(200)
  })

  it('都没给 ⇒ 默认间隔（肉眼能看清）', () => {
    const plan = planStream('test模型', 'x'.repeat(12), { durationMs: null, gapMs: null, text: null })
    expect(plan.gapMs).toBe(DEFAULT_GAP_MS)
    expect(plan.totalMs).toBeGreaterThan(0)
  })
})

describe('buildReply：自定义内容优先', () => {
  it('有自定义内容 ⇒ 原样返回', () => {
    expect(buildReply({ durationMs: null, gapMs: null, text: '我说了算' }, '忽略我')).toBe('我说了算')
  })
  it('没有 ⇒ 回显（默认行为不变）', () => {
    const r = buildReply({ durationMs: null, gapMs: null, text: null }, '你好呀')
    expect(r).toContain('你好呀')
    expect(r).toContain('test模型')
  })
})
