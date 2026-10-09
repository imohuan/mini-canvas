/** 审批规则（纯函数）：默认只问「本地命令 / 写文件」，其余放行 */
import { describe, it, expect } from 'vitest'
import { DEFAULT_POLICY, decideTool, matchesPattern, normalizePolicy } from '../agent/approval'

describe('通配匹配', () => {
  it('精确名', () => {
    expect(matchesPattern('exec_command', 'exec_command')).toBe(true)
    expect(matchesPattern('exec_command', 'read_file')).toBe(false)
  })
  it('前缀星与后缀星', () => {
    expect(matchesPattern('mcp__smart__*', 'mcp__smart__search')).toBe(true)
    expect(matchesPattern('mcp__smart__*', 'mcp__other__x')).toBe(false)
    expect(matchesPattern('*generate*', 'doubao-generate-image')).toBe(true)
    expect(matchesPattern('*generate*', 'canvas_get')).toBe(false)
    // 模式里的点是字面量（不是「任意字符」），所以带点的模式只匹配带点的工具名
    expect(matchesPattern('*.generate*', 'x.generate-image')).toBe(true)
    expect(matchesPattern('*.generate*', 'doubao-generate-image')).toBe(false)
  })
  it('星号不当通配滥用：a*b 不匹配 xaXbY', () => {
    expect(matchesPattern('a*b', 'xaXbY')).toBe(false)
    expect(matchesPattern('a*b', 'aXb')).toBe(true)
  })
})

describe('默认策略', () => {
  it('默认开启；本地命令与写文件要问，画布/读取类直接放行', () => {
    expect(DEFAULT_POLICY.enabled).toBe(true)
    for (const name of ['exec_command', 'input_command', 'write_file', 'edit_file']) {
      expect(decideTool(DEFAULT_POLICY, name), name).toBe('ask')
    }
    for (const name of ['read_file', 'canvas_get', 'mcp__smart__status']) {
      expect(decideTool(DEFAULT_POLICY, name), name).toBe('allow')
    }
  })

  it('关掉总开关 = 全放行', () => {
    const p = normalizePolicy({ enabled: false, rules: DEFAULT_POLICY.rules })
    expect(decideTool(p, 'exec_command')).toBe('allow')
  })

  it('规则顺序即优先级：先命中的说话', () => {
    const p = normalizePolicy({
      enabled: true,
      rules: [
        { pattern: 'mcp__smart__*', ask: false },
        { pattern: 'exec_command', ask: true },
      ],
    })
    expect(decideTool(p, 'mcp__smart__run')).toBe('allow')
    expect(decideTool(p, 'exec_command')).toBe('ask')
  })
})

describe('策略归一', () => {
  it('丢掉空 pattern 与重复 pattern，坏输入回默认', () => {
    const p = normalizePolicy({ enabled: true, rules: [{ pattern: ' ' }, { pattern: 'a' }, { pattern: 'a' }] })
    expect(p.rules.map((r) => r.pattern)).toEqual(['a'])
    expect(normalizePolicy(null)).toEqual(DEFAULT_POLICY)
    expect(normalizePolicy({ rules: 5 }).rules).toEqual([])
  })

  it('ask 缺省为 true（写规则时漏了 ask 应当按「要问」处理）', () => {
    expect(normalizePolicy({ rules: [{ pattern: 'x' }] }).rules[0].ask).toBe(true)
    expect(normalizePolicy({ rules: [{ pattern: 'x', ask: false }] }).rules[0].ask).toBe(false)
  })
})
