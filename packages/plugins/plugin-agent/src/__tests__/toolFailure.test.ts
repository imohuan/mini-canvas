/**
 * 工具失败解析（Terminal / Stack Trace 的标题与状态来源）。
 *
 * 用户口径 2026-11-07：命令执行与失败提醒要照 AI Elements 的
 * Terminal / Stack Trace 文档来 —— 文档里标题是「Ran <命令>」「<命令> exited with code N」
 * 「Failed: <错误>」，状态是 running / error。这里锁住这一步的数据。
 */
import { describe, it, expect } from 'vitest'
import { commandOf, isTerminalTool, parseToolFailure } from '../model/toolFailure'

describe('parseToolFailure', () => {
  it('正常输出 ⇒ 不算失败', () => {
    expect(parseToolFailure('hello\n').failed).toBe(false)
    expect(parseToolFailure(undefined).failed).toBe(false)
  })

  it('JSON 的 ok:false ⇒ 失败，标题是 error 那一行', () => {
    const r = parseToolFailure(JSON.stringify({ ok: false, error: 'EPERM: operation not permitted' }))
    expect(r.failed).toBe(true)
    expect(r.message).toBe('EPERM: operation not permitted')
  })

  it('JSON 的 is_error:true ⇒ 失败', () => {
    const r = parseToolFailure(JSON.stringify({ is_error: true, error: 'boom' }))
    expect(r.failed).toBe(true)
    expect(r.message).toBe('boom')
  })

  it('exited with code 1 ⇒ 失败，带退出码', () => {
    const r = parseToolFailure('pnpm lint exited with code 1')
    expect(r.failed).toBe(true)
    expect(r.message).toBe('退出码 1')
  })

  it('文本第一行是 Error / EPERM ⇒ 失败', () => {
    expect(parseToolFailure('EPERM: operation not permitted, rename').failed).toBe(true)
    expect(parseToolFailure('Error: something broke').failed).toBe(true)
    expect(parseToolFailure('TypeError: Cannot read properties of undefined').failed).toBe(true)
  })

  it('堆栈帧只收 at / File 行（普通输出不往里塞）', () => {
    const out = [
      'TypeError: Cannot read properties of undefined',
      '    at AgentMessageList.vue:184:20',
      '    some plain log line',
      '  File "main.py", line 12, in run',
    ].join('\n')
    const r = parseToolFailure(out)
    expect(r.failed).toBe(true)
    expect(r.frames).toHaveLength(2)
    expect(r.frames[0]).toContain('at AgentMessageList.vue')
  })
})

describe('isTerminalTool / commandOf', () => {
  it('命令执行类工具走 Terminal', () => {
    expect(isTerminalTool('exec_command')).toBe(true)
    expect(isTerminalTool('mcp__smart__input_command')).toBe(true)
    expect(isTerminalTool('read_file')).toBe(false)
  })

  it('从入参里取命令（换行压成一行）', () => {
    expect(commandOf(JSON.stringify({ cmd: 'echo  hello\nworld' }))).toBe('echo hello world')
    expect(commandOf('not json')).toBe('')
  })
})
