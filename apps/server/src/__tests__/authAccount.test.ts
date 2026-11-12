/**
 * 自定义登录令牌：只存哈希、最短 5 位、只允许首次设置一次。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createAuthAccount, MIN_AUTH_TOKEN_LENGTH } from '../authAccount.js'
import { createAuthSession } from '../authSession.js'

let dir: string

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'plume-auth-'))
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('authAccount', () => {
  it('一开始没有设置过', async () => {
    const account = await createAuthAccount({ dataDir: dir })
    expect(await account.isConfigured()).toBe(false)
    expect(await account.verify('abcdef')).toBe(false)
  })

  it('最短 5 位：4 位拒绝，5 位可以', async () => {
    const account = await createAuthAccount({ dataDir: dir })
    expect(MIN_AUTH_TOKEN_LENGTH).toBe(5)
    expect(await account.setup('abcd')).toBe('too-short')
    expect(await account.setup('abcde')).toBe('ok')
    expect(await account.verify('abcde')).toBe(true)
  })

  it('auth.json 里没有明文令牌，口令只是哈希', async () => {
    const account = await createAuthAccount({ dataDir: dir })
    await account.setup('my-secret-token')
    const raw = await fs.readFile(account.file, 'utf8')
    expect(raw).not.toContain('my-secret-token')
    const body = JSON.parse(raw) as { salt: string; hash: string; secret: string }
    expect(body.salt).toBeTruthy()
    expect(body.hash).toBeTruthy()
    expect(body.secret).toBeTruthy()
  })

  it('重复设置返回 exists，原令牌不变', async () => {
    const account = await createAuthAccount({ dataDir: dir })
    await account.setup('first-token')
    expect(await account.setup('second-token')).toBe('exists')
    expect(await account.verify('first-token')).toBe(true)
    expect(await account.verify('second-token')).toBe(false)
  })

  it('换令牌后旧令牌立即失效，会话密钥不变', async () => {
    const account = await createAuthAccount({ dataDir: dir })
    await account.setup('first-token')
    const before = await account.secret()
    expect(await account.change('second-token')).toBe('ok')
    expect(await account.verify('first-token')).toBe(false)
    expect(await account.verify('second-token')).toBe(true)
    expect(await account.secret()).toBe(before)
  })

  it('前后多余空白不影响校验', async () => {
    const account = await createAuthAccount({ dataDir: dir })
    await account.setup('  abcde  ')
    expect(await account.verify('abcde')).toBe(true)
  })

  it('auth.json 坏掉时按“未设置”处理，不抛', async () => {
    await fs.writeFile(path.join(dir, 'auth.json'), '{ nope', 'utf8')
    const account = await createAuthAccount({ dataDir: dir })
    expect(await account.isConfigured()).toBe(false)
  })
})

describe('authSession', () => {
  it('签发的 cookie 能验过；改了签名就不过', async () => {
    const account = await createAuthAccount({ dataDir: dir })
    await account.setup('abcde')
    const session = await createAuthSession(() => account.secret())
    const issued = await session.issue()
    expect(issued.cookie).toContain('HttpOnly')
    expect(await session.verify(issued.value)).toBe(true)
    expect(await session.verify(issued.value.slice(0, -1) + 'x')).toBe(false)
  })

  it('过期就不认', async () => {
    const account = await createAuthAccount({ dataDir: dir })
    await account.setup('abcde')
    const session = await createAuthSession(() => account.secret())
    const issued = await session.issue()
    const later = Date.now() + 31 * 24 * 60 * 60 * 1000
    expect(await session.verify(issued.value, later)).toBe(false)
  })

  it('没设置过令牌时签不出会话', async () => {
    const account = await createAuthAccount({ dataDir: dir })
    const session = await createAuthSession(() => account.secret())
    await expect(session.issue()).rejects.toThrow()
  })
})
