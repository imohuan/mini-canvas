import { describe, expect, it } from 'vitest'
import type { SpawnConfiner } from '@prismshadow/penguin-core'
import { PYTHON_UTF8_ENV, shellNameOf, utf8SpawnConfiner, withUtf8Command } from './commandEncoding.js'

describe('shellNameOf', () => {
  it('认得出常见 shell（带路径 / 带后缀）', () => {
    expect(shellNameOf('pwsh')).toBe('pwsh')
    expect(shellNameOf('pwsh.exe')).toBe('pwsh')
    expect(shellNameOf('C:\\Program Files\\PowerShell\\7\\pwsh.exe')).toBe('pwsh')
    expect(shellNameOf('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')).toBe('powershell')
    expect(shellNameOf('C:\\Windows\\system32\\cmd.exe')).toBe('cmd')
    expect(shellNameOf('/usr/bin/bash')).toBe('bash')
  })
})

describe('withUtf8Command', () => {
  it('PowerShell：前缀 + & {} 包裹', () => {
    const next = withUtf8Command('pwsh', 'echo 测试')
    expect(next).toContain('[Console]::OutputEncoding=[Text.Encoding]::UTF8')
    expect(next).toContain('& {')
    expect(next.endsWith('echo 测试\n}')).toBe(true)
  })

  it('PowerShell：已经手工切过编码的命令不再叠加前缀（幂等）', () => {
    const manual = '[Console]::OutputEncoding=[Text.Encoding]::UTF8; echo 中文'
    expect(withUtf8Command('pwsh', manual)).toBe(manual)
  })

  it('cmd：chcp 65001 前缀；已经带 chcp 的不再叠加', () => {
    expect(withUtf8Command('cmd', 'echo 中文')).toMatch(/^chcp 65001>nul & /)
    expect(withUtf8Command('cmd', 'chcp 65001>nul & echo 中文')).toBe('chcp 65001>nul & echo 中文')
  })

  it('bash 等其它 shell 原样返回', () => {
    expect(withUtf8Command('bash', 'echo 中文')).toBe('echo 中文')
  })
})

describe('utf8SpawnConfiner', () => {
  it('只改命令段，不动 shell 与参数', () => {
    const confine = utf8SpawnConfiner()
    const argv = ['pwsh', '-NoLogo', '-NoProfile', '-Command', 'echo 中文']
    const typed = confine as unknown as (a: readonly string[], o: { cwd: string; workspaceDir: string }) => readonly string[]
    const next = typed(argv, { cwd: 'C:\\tmp', workspaceDir: 'C:\\ws' }) as string[]
    expect(next.slice(0, -1)).toEqual(argv.slice(0, -1))
    expect(next.at(-1)).toContain('& {')
  })

  it('空 argv 原样返回', () => {
    const confine = utf8SpawnConfiner()
    const typed = confine as unknown as (a: readonly string[], o: { cwd: string; workspaceDir: string }) => readonly string[]
    expect(typed([], { cwd: '', workspaceDir: '' })).toEqual([])
  })
})

describe('PYTHON_UTF8_ENV', () => {
  it('Python 兜底变量齐全', () => {
    expect(PYTHON_UTF8_ENV.PYTHONUTF8).toBe('1')
    expect(PYTHON_UTF8_ENV.PYTHONIOENCODING).toBe('utf-8')
  })
})
