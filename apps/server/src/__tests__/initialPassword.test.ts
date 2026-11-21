/**
 * 部署侧首次初始化：PLUME_INITIAL_PASSWORD 只在「没配置过密码」时生效。
 *
 * 为什么要有它：setup 接口只认容器内回环（防公网抢注），但云平台部署时
 * 部署者根本不在容器里。环境变量只有能进部署平台控制台的人能设，
 * 信任级别与「进容器」等价 —— 用它替代 SSH 进容器。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createAuthAccount } from '../authAccount.js'
import { applyInitialPassword } from '../initialPassword.js'

let dir: string

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'plume-initial-pw-'))
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('applyInitialPassword', () => {
  it('没配置过 + 有变量 → 设置成功，并能用该密码登录', async () => {
    const r = await applyInitialPassword({ dataDir: dir, password: 'plume-init-1' })
    expect(r).toBe('applied')
    const account = await createAuthAccount({ dataDir: dir })
    expect(await account.isConfigured()).toBe(true)
    expect(await account.verify('plume-init-1')).toBe(true)
  })

  it('已经配置过 → 忽略变量，不覆盖现有密码', async () => {
    const first = await createAuthAccount({ dataDir: dir })
    await first.setup('existing-pw')
    const r = await applyInitialPassword({ dataDir: dir, password: 'another-pw' })
    expect(r).toBe('exists')
    const again = await createAuthAccount({ dataDir: dir })
    expect(await again.verify('existing-pw')).toBe(true)
    expect(await again.verify('another-pw')).toBe(false)
  })

  it('没给变量 → 什么都不做', async () => {
    expect(await applyInitialPassword({ dataDir: dir, password: undefined })).toBe('skipped')
    expect(await applyInitialPassword({ dataDir: dir, password: '' })).toBe('skipped')
    expect(await applyInitialPassword({ dataDir: dir, password: '   ' })).toBe('skipped')
    const account = await createAuthAccount({ dataDir: dir })
    expect(await account.isConfigured()).toBe(false)
  })

  it('太短（少于 5 位）→ 不设置，返回 too-short', async () => {
    expect(await applyInitialPassword({ dataDir: dir, password: 'abcd' })).toBe('too-short')
    const account = await createAuthAccount({ dataDir: dir })
    expect(await account.isConfigured()).toBe(false)
  })

  it('首尾空白会被裁掉（复制粘贴最常见的事故）', async () => {
    await applyInitialPassword({ dataDir: dir, password: '  padded-pw  ' })
    const account = await createAuthAccount({ dataDir: dir })
    expect(await account.verify('padded-pw')).toBe(true)
  })
})
