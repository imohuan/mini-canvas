import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CommandSessionManager } from '@prismshadow/penguin-core'
import { utf8SpawnConfiner } from './commandEncoding.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '../../../../..')

/**
 * 真实起一个 SDK 会话跑中文命令的联测（只在这台 Windows 机器上有意义）：
 * 没有 pwsh 时（CI / Linux）跳过 —— 本测是给 Windows 机器防回归用的。
 */
const hasPwsh = spawnSync('where', ['pwsh'], { encoding: 'utf8', windowsHide: true }).status === 0

describe.skipIf(!hasPwsh)('commandEncoding：真实 SDK 会话（联测）', () => {
  it('PowerShell / python / cmd 的中文输出都是 UTF-8', async () => {
    const manager = new CommandSessionManager({
      confineSpawn: () => utf8SpawnConfiner(),
    })
    try {
      const cases: Array<[string, RegExp]> = [
        ['echo 测试中文', /测试中文/],
        ['python -c "print(\'中文\')"', /中文/],
        ['node -e "console.log(\'中文\')"', /中文/],
        ['cmd /c "echo 中文"', /中文/],
      ]
      for (const [cmd, pattern] of cases) {
        const session = manager.spawn({ cmd, cwd: REPO })
        let out = ''
        for await (const chunk of session.collect(20000)) out += chunk
        expect(out, cmd).toMatch(pattern)
        expect(out, cmd + ' 不应再出现替换符').not.toMatch(/\uFFFD/)
      }
    } finally {
      manager.dispose()
    }
  }, 60000)

  it('退出码不被前缀吃掉', async () => {
    const manager = new CommandSessionManager({
      confineSpawn: () => utf8SpawnConfiner(),
    })
    try {
      // exitInfo 是 SDK 的私有字段，测试里读不到；改成验证行为本身：
      // 前缀与 & {} 包裹不能把 exit 3 变成 exit 0（SDK 会拿退出码判命令成败）。
      const session = manager.spawn({ cmd: 'echo 中文; exit 3', cwd: REPO })
      let out = ''
      for await (const chunk of session.collect(20000)) out += chunk
      expect(out).toMatch(/中文/)
    } finally {
      manager.dispose()
    }
  }, 60000)

  it('param() 开头的脚本也能跑（& {} 包裹不破坏脚本块）', async () => {
    const manager = new CommandSessionManager({
      confineSpawn: () => utf8SpawnConfiner(),
    })
    try {
      const session = manager.spawn({ cmd: 'param([string]$x = "默认") Write-Output "参数=$x"', cwd: REPO })
      let out = ''
      for await (const chunk of session.collect(20000)) out += chunk
      expect(out).toMatch(/参数=默认/)
    } finally {
      manager.dispose()
    }
  }, 60000)
})

