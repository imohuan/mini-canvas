import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  createAdminAuth,
  isAdminPath,
  ADMIN_WRITE_PREFIXES,
  ADMIN_POST_ONLY_PREFIXES,
} from '../adminAuth'

let dir: string

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'admin-auth-'))
})

afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  await fs.rm(dir, { recursive: true, force: true })
})

describe('createAdminAuth：文件令牌', () => {
  it('首次生成 64 位 hex，并把同一个值写进 admin-token', async () => {
    const auth = await createAdminAuth({ dataDir: dir })
    expect(auth.source).toBe('file')
    expect(auth.token).toMatch(/^[0-9a-f]{64}$/)
    expect(auth.tokenFile).toBe(path.join(dir, 'admin-token'))
    expect(await fs.readFile(auth.tokenFile!, 'utf8')).toBe(auth.token)
  })

  it('再次打开同一目录会复用已有令牌（重启不失效）', async () => {
    const first = await createAdminAuth({ dataDir: dir })
    const second = await createAdminAuth({ dataDir: dir })
    expect(second.token).toBe(first.token)
    expect(second.source).toBe('file')
  })

  it('文件末尾带换行也能读；内容不合法则重新生成并警告', async () => {
    const file = path.join(dir, 'admin-token')
    const good = 'a'.repeat(64)
    await fs.writeFile(file, good + '\n')
    expect((await createAdminAuth({ dataDir: dir })).token).toBe(good)

    await fs.writeFile(file, 'not-a-token')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const rebuilt = await createAdminAuth({ dataDir: dir })
    expect(rebuilt.token).toMatch(/^[0-9a-f]{64}$/)
    expect(rebuilt.token).not.toBe('not-a-token')
    expect(warn).toHaveBeenCalled()
    expect(await fs.readFile(file, 'utf8')).toBe(rebuilt.token)
  })

  it('数据目录不存在时会先创建', async () => {
    const nested = path.join(dir, 'a', 'b')
    const auth = await createAdminAuth({ dataDir: nested })
    expect(await fs.readFile(path.join(nested, 'admin-token'), 'utf8')).toBe(auth.token)
  })
})

describe('createAdminAuth：固定令牌与开关', () => {
  it('传 fixedToken 时不读也不写文件，source=env', async () => {
    const fixed = 'b'.repeat(64)
    await fs.writeFile(path.join(dir, 'admin-token'), 'c'.repeat(64))
    const auth = await createAdminAuth({ dataDir: dir, fixedToken: fixed })
    expect(auth.source).toBe('env')
    expect(auth.token).toBe(fixed)
    expect(auth.tokenFile).toBeNull()
    expect(await fs.readFile(path.join(dir, 'admin-token'), 'utf8')).toBe('c'.repeat(64))
  })

  it('环境变量 MINI_CANVAS_ADMIN_TOKEN 同样优先，且不生成文件', async () => {
    const envToken = 'd'.repeat(64)
    vi.stubEnv('MINI_CANVAS_ADMIN_TOKEN', envToken)
    const auth = await createAdminAuth({ dataDir: dir })
    expect(auth.source).toBe('env')
    expect(auth.token).toBe(envToken)
    await expect(fs.access(path.join(dir, 'admin-token'))).rejects.toThrow()
  })

  it('enabled=false：token 为空串、tokenFile 为 null、verify 恒 ok', async () => {
    const auth = await createAdminAuth({ dataDir: dir, enabled: false, fixedToken: 'e'.repeat(64) })
    expect(auth.source).toBe('disabled')
    expect(auth.token).toBe('')
    expect(auth.tokenFile).toBeNull()
    expect(auth.verify(undefined)).toBe('ok')
    expect(auth.verify('whatever')).toBe('ok')
    await expect(fs.access(path.join(dir, 'admin-token'))).rejects.toThrow()
  })
})

describe('verify', () => {
  it('缺失 / 正确 / 错误 / 长度不同分别返回 missing / ok / bad / bad（不抛）', async () => {
    const auth = await createAdminAuth({ dataDir: dir })
    expect(auth.verify(undefined)).toBe('missing')
    expect(auth.verify('')).toBe('missing')
    expect(auth.verify(auth.token)).toBe('ok')
    expect(auth.verify(auth.token)).toBe('ok')
    expect(auth.verify(auth.token.toUpperCase())).toBe('bad')
    expect(auth.verify('0'.repeat(64))).toBe('bad')
    expect(() => auth.verify('x')).not.toThrow()
    expect(auth.verify('x')).toBe('bad')
  })
})

describe('isAdminPath', () => {
  it('只认四种写方法；读方法与预检一律放行', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(isAdminPath(method, '/api/task/call')).toBe(true)
    }
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      expect(isAdminPath(method, '/api/task/call')).toBe(false)
    }
  })

  it('任意写方法前缀命中；GET 命中也不拦', () => {
    for (const prefix of ADMIN_WRITE_PREFIXES) {
      const exact = prefix.replace(/\/$/, '')
      expect(isAdminPath('PUT', exact)).toBe(true)
      expect(isAdminPath('POST', exact + '/child')).toBe(true)
    }
  })

  it('/api/canvases/ 与 /api/canvas/ 只拦 POST（PUT 是整画布保存）', () => {
    for (const prefix of ADMIN_POST_ONLY_PREFIXES) {
      const exact = prefix.replace(/\/$/, '')
      expect(isAdminPath('POST', exact + '/x/nodes')).toBe(true)
      expect(isAdminPath('PUT', exact + '/x/nodes')).toBe(false)
      expect(isAdminPath('PATCH', exact + '/x')).toBe(false)
      expect(isAdminPath('DELETE', exact + '/x')).toBe(false)
      expect(isAdminPath('GET', exact + '/x')).toBe(false)
    }
  })

  it('前缀边界：/api/tasks、/api/taskfoo 不命中', () => {
    expect(isAdminPath('POST', '/api/tasks')).toBe(false)
    expect(isAdminPath('POST', '/api/taskfoo')).toBe(false)
  })

  it('不在清单里的写接口放行（资产/项目/历史/KV）', () => {
    expect(isAdminPath('POST', '/api/assets')).toBe(false)
    expect(isAdminPath('PUT', '/api/projects/x')).toBe(false)
    expect(isAdminPath('PUT', '/api/kv/x')).toBe(false)
  })
})
