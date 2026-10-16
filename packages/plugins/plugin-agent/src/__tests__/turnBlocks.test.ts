/**
 * 消息流的**顺序**与**合并**（纯逻辑）。
 *
 * 用户口径（2026-10-05）：
 * 1. 工具与文本要有先后顺序 —— 一段文字、三个工具、再一段文字，就要按这个顺序排；
 * 2. 中间**没有文字**隔开的多个工具，要合并成一组（参考 codex-base-ui 的 useGroups）。
 */
import { describe, it, expect } from 'vitest'
import { groupTurnBlocks } from '../turnBlocks'
import type { ToolCard, TurnStep } from '../sessionModel'

/**
 * 小工厂：一边造「按顺序的步骤」，一边造工具的明细表 —— 与 ChatModel 的真实产物同形
 * （steps 只记顺序与 id，工具内容在 tools 里）。
 */
function build(spec: Array<'t' | 'k' | { tool: string }>) {
  const steps: TurnStep[] = []
  const tools: ToolCard[] = []
  let n = 0
  for (const s of spec) {
    const id = 's' + ++n
    if (s === 't') steps.push({ type: 'text', id, text: 'T' + n, final: true })
    else if (s === 'k') steps.push({ type: 'thinking', id, text: 'K' + n, final: true })
    else {
      tools.push({ id: s.tool, name: s.tool, arguments: '{}' })
      steps.push({ type: 'tool', id: s.tool })
    }
  }
  return { steps, tools }
}

describe('groupTurnBlocks', () => {
  it('空输入 → 空输出', () => {
    expect(groupTurnBlocks([], [])).toEqual([])
  })

  it('保持到达顺序：文字 → 工具 → 文字', () => {
    const { steps, tools } = build(['t', { tool: 'a' }, 't'])
    const rows = groupTurnBlocks(steps, tools)
    expect(rows.map((r) => r.type)).toEqual(['text', 'tools', 'text'])
    expect(rows[0]).toMatchObject({ type: 'text' })
    expect(rows[2]).toMatchObject({ type: 'text' })
  })

  it('中间没有文字的多个工具合并成一组（不是各占一行）', () => {
    const { steps, tools } = build([{ tool: 'a' }, { tool: 'b' }, { tool: 'c' }])
    const rows = groupTurnBlocks(steps, tools)
    expect(rows).toHaveLength(1)
    expect(rows[0].type).toBe('tools')
    expect(rows[0].type === 'tools' && rows[0].tools).toHaveLength(3)
  })

  it('文字插进工具之间 → 分成两组（文字是分界线）', () => {
    const { steps, tools } = build([{ tool: 'a' }, { tool: 'b' }, 't', { tool: 'c' }])
    const rows = groupTurnBlocks(steps, tools)
    expect(rows.map((r) => r.type)).toEqual(['tools', 'text', 'tools'])
    expect(rows[0].type === 'tools' && rows[0].tools).toHaveLength(2)
    expect(rows[2].type === 'tools' && rows[2].tools).toHaveLength(1)
  })

  it('单个工具也成一行（调用方按数量决定画卡片还是一行）', () => {
    const { steps, tools } = build([{ tool: 'a' }])
    const rows = groupTurnBlocks(steps, tools)
    expect(rows).toHaveLength(1)
    expect(rows[0].type === 'tools' && rows[0].tools).toHaveLength(1)
  })

  it('连续的思考合并成一块', () => {
    const { steps, tools } = build(['k', 'k'])
    const rows = groupTurnBlocks(steps, tools)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ type: 'thinking' })
    expect(rows[0].type === 'thinking' && rows[0].text).toBe('K1K2')
  })

  it('每行都有稳定 key（相邻同类的第一块下标）', () => {
    const { steps, tools } = build([{ tool: 'a' }, { tool: 'b' }, 't'])
    const rows = groupTurnBlocks(steps, tools)
    expect(rows[0].key).toBe('b0')
    expect(rows[1].key).toBe('b2')
    // key 唯一，Vue 的 :key 不会撞
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length)
  })

  it('步骤指不到的工具被跳过，不画半截行', () => {
    const rows = groupTurnBlocks(
      [
        { type: 'tool', id: 'missing' },
        { type: 'text', id: 's2', text: 'hi', final: true },
      ],
      [],
    )
    expect(rows.map((r) => r.type)).toEqual(['text'])
  })

  /**
   * 用户口径修订（2026-10-16）：思考**也是分界线** —— 多轮思考按发生位置原位展示，
   * 旧口径（全部堆到顶部）让第三轮的思考跑进了第一轮的思考块里，中间明明隔着工具。
   */
  it('思考夹在工具中间 → 原位成行（思考是分界线）', () => {
    const { steps, tools } = build(['t', { tool: 'a' }, 'k', { tool: 'b' }, 'k', { tool: 'c' }])
    const rows = groupTurnBlocks(steps, tools)
    expect(rows.map((r) => r.type)).toEqual(['text', 'tools', 'thinking', 'tools', 'thinking', 'tools'])
    expect(rows[2].type === 'thinking' && rows[2].text).toBe('K3')
    expect(rows[4].type === 'thinking' && rows[4].text).toBe('K5')
  })

  it('正文文字仍然是分界线（思考不改变这一点）', () => {
    const { steps, tools } = build([{ tool: 'a' }, { tool: 'b' }, 't', { tool: 'c' }])
    const rows = groupTurnBlocks(steps, tools)
    expect(rows.map((r) => r.type)).toEqual(['tools', 'text', 'tools'])
  })
})
