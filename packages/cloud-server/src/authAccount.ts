/**
 * 自定义登录令牌（用户自己设，最短 5 位）。
 *
 * 为什么单独一份文件，而不是继续用 admin-token：
 * - admin-token 是**程序生成**的 64 位恢复钥匙，不适合给人记；
 * - 用户要的是一个“像密码一样”的自定义令牌，后台只保存加盐哈希，明文不落盘。
 *
 * 恢复通道：原来的 `admin-token` / `PLUME_ADMIN_TOKEN` 仍然能通过 x-admin-token 头使用。
 * 忘记自定义令牌时，用启动日志里的那串重新设置即可。
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'

/** 自定义令牌最短长度（用户口径 2026-11-12） */
export const MIN_AUTH_TOKEN_LENGTH = 5

interface AuthFile {
  v: 1
  salt: string
  hash: string
  /** 会话 cookie 的签名密钥；与令牌分开存，换令牌不必让所有会话失效 */
  secret: string
  createdAt: number
}

export interface AuthAccount {
  /** auth.json 的路径（设置页 / 日志用） */
  readonly file: string
  /** 是否已经设置过自定义令牌 */
  isConfigured(): Promise<boolean>
  /** 校验令牌；没设置过 / 不匹配都返回 false */
  verify(token: string | undefined): Promise<boolean>
  /** 首次设置；已经设置过返回 'exists' */
  setup(token: string): Promise<'ok' | 'exists' | 'too-short'>
  /** 换令牌（旧令牌作废，已有会话保留） */
  change(token: string): Promise<'ok' | 'not-configured' | 'too-short'>
  /** 会话签名密钥；没设置过时返回 undefined */
  secret(): Promise<string | undefined>
}

function hashOf(token: string, salt: string): string {
  return scryptSync(token, salt, 64).toString('hex')
}

function safeEqualHex(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex')
  const right = Buffer.from(b, 'hex')
  if (left.length !== right.length || left.length === 0) return false
  return timingSafeEqual(left, right)
}

function normalizeToken(token: string | undefined): string {
  return String(token ?? '').trim()
}

export async function createAuthAccount(opts: { dataDir: string }): Promise<AuthAccount> {
  const file = path.join(opts.dataDir, 'auth.json')
  let cached: AuthFile | null | undefined

  async function load(): Promise<AuthFile | null> {
    if (cached !== undefined) return cached
    try {
      const raw = JSON.parse(await fs.readFile(file, 'utf8')) as Partial<AuthFile>
      if (
        raw.v === 1 &&
        typeof raw.salt === 'string' &&
        typeof raw.hash === 'string' &&
        typeof raw.secret === 'string' &&
        raw.salt.length > 0 &&
        raw.hash.length > 0 &&
        raw.secret.length > 0
      ) {
        cached = raw as AuthFile
      } else {
        console.warn('[auth] auth.json 格式不合法，按“未设置”处理：' + file)
        cached = null
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('[auth] 读取 auth.json 失败，按“未设置”处理：' + file)
      }
      cached = null
    }
    return cached
  }

  async function save(next: AuthFile): Promise<void> {
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, JSON.stringify(next, null, 2), { encoding: 'utf8', mode: 0o600 })
    if (process.platform !== 'win32') await fs.chmod(file, 0o600)
    cached = next
  }

  async function make(token: string): Promise<AuthFile> {
    const salt = randomBytes(16).toString('hex')
    return { v: 1, salt, hash: hashOf(token, salt), secret: randomBytes(32).toString('hex'), createdAt: Date.now() }
  }

  return {
    file,
    async isConfigured() {
      return (await load()) !== null
    },
    async verify(token) {
      const t = normalizeToken(token)
      const current = await load()
      if (!current || !t) return false
      return safeEqualHex(hashOf(t, current.salt), current.hash)
    },
    async setup(token) {
      const t = normalizeToken(token)
      if (t.length < MIN_AUTH_TOKEN_LENGTH) return 'too-short'
      if (await load()) return 'exists'
      await save(await make(t))
      return 'ok'
    },
    async change(token) {
      const t = normalizeToken(token)
      if (t.length < MIN_AUTH_TOKEN_LENGTH) return 'too-short'
      const current = await load()
      if (!current) return 'not-configured'
      const next = await make(t)
      // 保留原来的会话签名密钥：换令牌后已登录的浏览器不会被踢下线
      await save({ ...next, secret: current.secret, createdAt: current.createdAt })
      return 'ok'
    },
    async secret() {
      return (await load())?.secret
    },
  }
}
