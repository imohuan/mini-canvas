/**
 * 工具标题与审批文案（用户口径 2026-11-07）。
 *
 * 现象：工具行标题显示的是工具输出里的 JSON 片段，看不出这次调用在干什么；
 * 审批卡也是整段 JSON。这里锁住「标题说人话、命令放摘要」的规则。
 */
import { describe, it, expect } from 'vitest'
import { approvalDescription, approvalTitle, bareToolName, terminalLineTitle, toolAction, toolLineTitle, toolTitleText } from '../model/toolMeta'

describe('工具行标题', () => {
  it('内置工具给人话动作（不是原始工具名）', () => {
    expect(toolTitleText('exec_command')).toBe('执行命令')
    expect(toolTitleText('read_file')).toBe('读取文件')
    expect(toolTitleText('mcp__canvas__canvas_overview')).toBe('查看画布概览')
  })

  it('认不出的工具退回工具名（去掉 MCP 前缀），也有东西显示', () => {
    expect(toolTitleText('mcp__smart__do_something')).toBe('do_something')
    expect(toolTitleText('')).toBe('工具调用')
  })

  it('标题**不含**命令 / 输出（那是摘要的位置）', () => {
    const title = toolTitleText('exec_command')
    expect(title).not.toContain('echo')
  })

  it('bareToolName 只剥一层 MCP 前缀', () => {
    expect(bareToolName('mcp__a__b')).toBe('b')
    expect(bareToolName('plain')).toBe('plain')
    expect(toolAction('web_search')).toBe('搜索网页')
  })
})

describe('工具行一句话标题（动作 + 内容）', () => {
  it('动作在前、内容在后，合成一句（交给 Title 的 truncate 管长度）', () => {
    // 有 description 时优先用它（用户口径 2026-11-07：这一句要显示出来）
    expect(toolLineTitle('exec_command', JSON.stringify({ cmd: 'echo hi', description: '打个招呼' })))
      .toBe('执行命令 打个招呼')
    expect(toolLineTitle('exec_command', JSON.stringify({ cmd: 'echo hi' }))).toBe('执行命令 echo hi')
    expect(toolLineTitle('read_file', JSON.stringify({ file_path: 'D:\\a\\b.png' }))).toBe('读取文件 b.png')
  })

  it('没有内容时只给动作（不拼空串）', () => {
    expect(toolLineTitle('exec_command', '{}')).toBe('执行命令')
    expect(toolLineTitle('mcp__smart__x', 'not json')).toBe('x')
  })

  it('超长命令由调用方截断（toolBrief 已按 60 字截），不会把标题撑爆', () => {
    const long = 'echo ' + 'a'.repeat(300)
    const out = toolLineTitle('exec_command', JSON.stringify({ cmd: long }))
    expect(out.length).toBeLessThanOrEqual(80)
    expect(out.endsWith('…')).toBe(true)
  })
})

describe('命令执行行标题（不带动作前缀）', () => {
  it('有 description 就只显示它（图标已表示是命令）', () => {
    expect(terminalLineTitle('exec_command', JSON.stringify({ cmd: 'echo hi', description: '输出颜色文字测试' })))
      .toBe('输出颜色文字测试')
  })

  it('没有 description 就显示命令本身', () => {
    expect(terminalLineTitle('exec_command', JSON.stringify({ cmd: 'echo hi' }))).toBe('echo hi')
  })

  it('两者都没有才退回动作名（不出现空标题）', () => {
    expect(terminalLineTitle('exec_command', '{}')).toBe('执行命令')
  })
})

describe('审批文案', () => {
  it('执行命令：标题说「运行 <命令>？」', () => {
    const args = JSON.stringify({ cmd: 'echo hello' })
    expect(approvalTitle('exec_command', args)).toBe('运行 echo hello？')
    expect(approvalDescription('exec_command', args)).toContain('当前项目')
  })

  it('读取 / 写入文件：标题带文件名', () => {
    expect(approvalTitle('read_file', JSON.stringify({ file_path: 'D:\\a\\b.png' }))).toBe('读取 b.png？')
    expect(approvalTitle('write_file', JSON.stringify({ path: 'D:\\a\\c.txt' }))).toBe('写入 c.txt？')
  })

  it('没有命令 / 文件名也给一句人话（不显示 JSON）', () => {
    expect(approvalTitle('exec_command', '{}')).toBe('运行一条命令？')
    expect(approvalTitle('mcp__smart__x', 'not json')).toBe('允许调用 x？')
  })
})
